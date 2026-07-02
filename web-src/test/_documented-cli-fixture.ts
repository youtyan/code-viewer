function codeFenceLines(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence || trimmed.startsWith("#")) continue;
    out.push(raw);
  }
  return out;
}

function joinBackslashContinuations(lines: string[]): string[] {
  const joined: string[] = [];
  let acc = "";
  for (const line of lines) {
    if (/\\\s*$/.test(line)) {
      acc += `${line.replace(/\\\s*$/, "")} `;
    } else {
      joined.push((acc + line).trim());
      acc = "";
    }
  }
  if (acc) joined.push(acc.trim());
  return joined.filter((line) => line.length > 0);
}

function shellSplit(s: string): string[] {
  const result: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      else buf += c;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      else if (c === "\\" && i + 1 < s.length) {
        buf += s[i + 1];
        i++;
      } else buf += c;
      continue;
    }
    if (c === "'") inSingle = true;
    else if (c === '"') inDouble = true;
    else if (c === " " || c === "\t") {
      if (buf.length > 0) {
        result.push(buf);
        buf = "";
      }
    } else buf += c;
  }
  if (buf.length > 0) result.push(buf);
  return result;
}

export function extractDocumentedSubcommandInvocations(
  text: string,
  subcommand: string,
): string[][] {
  const lines = joinBackslashContinuations(codeFenceLines(text));
  const out: string[][] = [];
  for (const line of lines) {
    const parts = shellSplit(line);
    const idx = parts.findIndex(
      (part, index) =>
        (part === "code-viewer" || part.endsWith("/code-viewer")) &&
        parts[index + 1] === subcommand,
    );
    if (idx < 0) continue;
    out.push(parts.slice(idx + 2));
  }
  return out;
}
