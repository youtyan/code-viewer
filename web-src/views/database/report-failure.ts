import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";

/** Which part of the Data page failed; the console line starts with it. */
export type DatastoreFailureKind =
  | "S3"
  | "DynamoDB"
  | "Elasticsearch"
  | "Redis"
  | "SQL";

// 失敗の理由を err.message だけに潰すと、どの操作のどの対象で何が起きたかが
// 消える。console には error そのものと操作・対象を渡し、画面に出す文字列
// として cause の連鎖ごとの全文を返す。
export function reportDatastoreFailure(
  kind: DatastoreFailureKind,
  operation: string,
  error: unknown,
  ...context: unknown[]
): string {
  console.error(`[code-viewer] ${kind} ${operation} failed`, ...context, error);
  return formatErrorDetail(error);
}

/**
 * Throw a failed response as an error that names the operation, the HTTP
 * status and the body, so the caller's catch reports it like any other failure.
 */
export async function requireOkResponse(
  response: Response,
  operation: string,
): Promise<void> {
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, operation));
  }
}

/**
 * 失敗の本文がサーバの JSON (`{error, code, …}`) なら、その error (code があれば
 * 添える) を返す。画面では理由をこれで先頭に出し、全文 (formatErrorDetail) は
 * 「詳細」に畳む。以前は HTTP の本文の JSON をそのまま並べ、理由 (no such table
 * など) が長い JSON の末尾に埋もれていた。cause の連鎖も順に見る。
 */
export function serverErrorSummary(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const summary = summaryFromMessage(current.message);
    if (summary !== null) return summary;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return null;
}

// responseErrorMessage の形: `<操作> (HTTP <状態>[ <文言>]): <本文>`。
const RESPONSE_BODY = /\(HTTP \d{3}[^)]*\): (\{[\s\S]*\})\s*$/;

function summaryFromMessage(message: string): string | null {
  const match = RESPONSE_BODY.exec(message);
  if (!match) return null;
  let body: unknown;
  try {
    body = JSON.parse(match[1]);
  } catch {
    // 本文が JSON でなければ、要約は無い (全文はそのまま出す)。
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const { error, code } = body as { error?: unknown; code?: unknown };
  if (typeof error !== "string" || !error) return null;
  return typeof code === "string" && code ? `${error} (${code})` : error;
}
