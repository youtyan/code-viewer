/** Build an Error with a retained cause on runtimes whose TypeScript lib omits ErrorOptions. */
export function errorWithCause(message: string, cause: unknown): Error {
  return Object.assign(new Error(message), { cause });
}

/** Build one Error that retains every independent failure as structured data. */
export function errorWithCauses(
  message: string,
  errors: readonly unknown[],
): Error {
  return Object.assign(new Error(message), { errors: [...errors] });
}

const OMIT_VALUE = Symbol("omit-sensitive-error-field");

type SanitizedValue = {
  value: unknown;
  removedSensitive: boolean;
};

function isSensitiveFieldName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized === "auth" ||
    normalized.endsWith("auth") ||
    (normalized.startsWith("auth") && !normalized.startsWith("author")) ||
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("passwd") ||
    normalized.includes("secret") ||
    normalized.includes("credential") ||
    normalized.includes("apikey") ||
    normalized.includes("privatekey")
  );
}

function errorName(error: Error): string {
  try {
    return typeof error.name === "string" ? error.name : "Error";
  } catch {
    return "Error";
  }
}

function errorMessage(error: Error): string {
  try {
    return typeof error.message === "string"
      ? error.message
      : "unable to read error message";
  } catch {
    return "unable to read error message";
  }
}

function sanitizeObjectFields(
  value: object,
  ancestors: Set<object>,
  excludedKeys: ReadonlySet<string> = new Set(),
): SanitizedValue | typeof OMIT_VALUE {
  let keys: string[];
  try {
    keys = Object.getOwnPropertyNames(value);
  } catch {
    return { value: "[Unserializable object]", removedSensitive: false };
  }

  const output: Record<string, unknown> = Object.create(null);
  let removedSensitive = false;
  for (const key of keys) {
    if (excludedKeys.has(key)) continue;
    if (isSensitiveFieldName(key)) {
      removedSensitive = true;
      continue;
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      output[key] = "[Unserializable field]";
      continue;
    }
    if (!descriptor) continue;
    if (!("value" in descriptor)) {
      output[key] = "[Accessor]";
      continue;
    }

    const sanitized = sanitizeValue(descriptor.value, ancestors);
    if (sanitized === OMIT_VALUE) {
      removedSensitive = true;
      continue;
    }
    output[key] = sanitized.value;
    removedSensitive ||= sanitized.removedSensitive;
  }

  if (Object.keys(output).length === 0 && removedSensitive) return OMIT_VALUE;
  return { value: output, removedSensitive };
}

function sanitizeError(error: Error, ancestors: Set<object>): SanitizedValue {
  const output: Record<string, unknown> = Object.create(null);
  output.name = errorName(error);
  output.message = errorMessage(error);
  const fields = sanitizeObjectFields(
    error,
    ancestors,
    new Set(["name", "message", "stack"]),
  );
  if (fields !== OMIT_VALUE) Object.assign(output, fields.value);
  return {
    value: output,
    removedSensitive: fields === OMIT_VALUE ? true : fields.removedSensitive,
  };
}

function sanitizeValue(
  value: unknown,
  ancestors: Set<object>,
): SanitizedValue | typeof OMIT_VALUE {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return { value, removedSensitive: false };
  if (typeof value === "number") {
    return {
      value: Number.isFinite(value) ? value : String(value),
      removedSensitive: false,
    };
  }
  if (typeof value === "bigint") {
    return { value: `${value}n`, removedSensitive: false };
  }
  if (typeof value === "undefined") {
    return { value: "[undefined]", removedSensitive: false };
  }
  if (typeof value === "symbol") {
    return { value: "[symbol]", removedSensitive: false };
  }
  if (typeof value === "function") {
    return { value: "[function]", removedSensitive: false };
  }

  const objectValue = value as object;
  if (ancestors.has(objectValue)) {
    return { value: "[Circular]", removedSensitive: false };
  }
  ancestors.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      const output: unknown[] = [];
      let removedSensitive = false;
      for (const item of objectValue) {
        const sanitized = sanitizeValue(item, ancestors);
        if (sanitized === OMIT_VALUE) {
          removedSensitive = true;
          continue;
        }
        output.push(sanitized.value);
        removedSensitive ||= sanitized.removedSensitive;
      }
      if (output.length === 0 && removedSensitive) return OMIT_VALUE;
      return { value: output, removedSensitive };
    }
    if (objectValue instanceof Error)
      return sanitizeError(objectValue, ancestors);
    return sanitizeObjectFields(objectValue, ancestors);
  } catch {
    return { value: "[Unserializable object]", removedSensitive: false };
  } finally {
    ancestors.delete(objectValue);
  }
}

function formatNonError(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const sanitized = sanitizeValue(value, new Set());
    const serializable = sanitized === OMIT_VALUE ? {} : sanitized.value;
    return JSON.stringify(serializable);
  } catch {
    return "[Unserializable value]";
  }
}

function formatErrorFields(error: Error): string {
  const fields = sanitizeObjectFields(
    error,
    new Set([error]),
    new Set(["name", "message", "stack", "cause"]),
  );
  if (fields === OMIT_VALUE) return "";
  const output = fields.value as Record<string, unknown>;
  return Object.keys(output).length > 0
    ? `\nDetails: ${JSON.stringify(output)}`
    : "";
}

/** Preserve the complete Error cause chain in text shown by the browser or HTTP handlers. */
export function formatErrorDetail(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    parts.push(
      `${errorName(current)}: ${errorMessage(current)}${formatErrorFields(current)}`,
    );
    try {
      current = (current as Error & { cause?: unknown }).cause;
    } catch {
      current = "[Unserializable error cause]";
    }
  }
  if (current !== undefined) {
    parts.push(
      seen.has(current)
        ? "Error cause cycle detected"
        : formatNonError(current),
    );
  }
  return parts.join("\nCaused by: ") || formatNonError(error);
}

/** Keep the operation, HTTP status, status text, and response body together. */
export async function responseErrorMessage(
  response: Response,
  operation: string,
): Promise<string> {
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  const prefix = `${operation} (HTTP ${response.status}${statusText})`;
  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    throw errorWithCause(`${prefix}: failed to read response body`, error);
  }
  return body ? `${prefix}: ${body}` : prefix;
}
