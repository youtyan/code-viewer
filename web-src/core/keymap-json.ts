// 利用者が書いたショートカットの JSON (設定の「ショートカット」の直接編集と読み込み)
// を、どの行・どの欄がどう違うかを付けて検査する。
//
// サーバに保存するときの sanitizeKeymapOverrides (keymap.ts) は、手で壊した設定
// ファイルでもほかの設定を残すために、読めない項目を黙って落とす。画面で書いた
// JSON はそれでは困る (直したつもりの行が消えて保存される) ので、ここでは 1 つでも
// 違えば保存させず、違う所を全部返す。JSON.parse は位置を返さない (ブラウザごとに
// 文言も違う) ので、位置を覚えながら読む小さな読み手を持つ。

import {
  KEYMAP_ACTIONS,
  type KeyChord,
  type KeymapAction,
  type KeymapOverrides,
  keyChordId,
  MAX_CHORD_KEY_LENGTH,
  MAX_CHORDS_PER_ACTION,
  normalizeKeyName,
} from "./keymap";
import { unassignableChord } from "./pwa";

type Pos = { line: number; column: number };

type JsonNode =
  | {
      kind: "object";
      pos: Pos;
      entries: { key: string; pos: Pos; value: JsonNode }[];
    }
  | { kind: "array"; pos: Pos; items: JsonNode[] }
  | { kind: "string"; pos: Pos; value: string }
  | { kind: "number" | "boolean" | "null"; pos: Pos; value: unknown };

export type KeymapJsonIssueCode =
  /** JSON として読めない。detail は見つかった文字 (終わりなら無し) */
  | "syntax"
  | "not-object"
  | "unknown-action"
  | "duplicate-action"
  | "not-array"
  | "too-many-keys"
  | "chord-not-object"
  | "missing-key"
  | "empty-key"
  | "key-too-long"
  | "unknown-field"
  | "duplicate-field"
  | "not-boolean"
  | "duplicate-chord"
  /** 割り当てられないキー。detail は理由 (core/pwa.ts の unassignableChord) */
  | "reserved-chord";

export type KeymapJsonIssue = {
  /** 1 始まり */
  line: number;
  /** 1 始まり (文字の数) */
  column: number;
  /** `toggle-theme[0].shift` の形。全体は `$` */
  path: string;
  code: KeymapJsonIssueCode;
  detail?: string;
};

export type KeymapJsonResult =
  | { ok: true; value: KeymapOverrides }
  | { ok: false; issues: KeymapJsonIssue[] };

const CHORD_FIELDS = [
  "key",
  "ctrl",
  "meta",
  "alt",
  "shift",
  "pendingG",
  "inputs",
  "terminal",
  "pwa",
] as const;
type ChordField = (typeof CHORD_FIELDS)[number];
const BOOLEAN_FIELDS = CHORD_FIELDS.filter(
  (field): field is Exclude<ChordField, "key"> => field !== "key",
);

class JsonSyntaxError extends Error {
  constructor(
    readonly pos: Pos,
    /** 見つかった文字 (終わりなら空)。文字列の中身が読めないときは JSON.parse の理由 */
    readonly found: string,
  ) {
    super(`unexpected ${found ? `"${found}"` : "end of text"}`);
  }
}

function parseJsonWithPositions(text: string): JsonNode {
  let index = 0;
  let line = 1;
  let lineStart = 0;

  const pos = (): Pos => ({ line, column: index - lineStart + 1 });
  const fail = (): never => {
    throw new JsonSyntaxError(pos(), text[index] ?? "");
  };

  function skipSpace(): void {
    while (index < text.length) {
      const char = text[index];
      if (char === "\n") {
        index += 1;
        line += 1;
        lineStart = index;
      } else if (char === " " || char === "\t" || char === "\r") index += 1;
      else return;
    }
  }

  function expect(char: string): void {
    if (text[index] !== char) fail();
    index += 1;
  }

  function readString(): string {
    const start = index;
    expect('"');
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index += 1;
        // 中身の検査 (エスケープ・制御文字) は JSON.parse に任せる。位置は開きの引用符。
        try {
          return JSON.parse(text.slice(start, index)) as string;
        } catch (error) {
          index = start;
          throw Object.assign(
            new JsonSyntaxError(
              pos(),
              error instanceof Error ? error.message : String(error),
            ),
            { cause: error },
          );
        }
      }
      if (char === "\n") return fail();
      index += char === "\\" ? 2 : 1;
    }
    return fail();
  }

  function readValue(): JsonNode {
    skipSpace();
    const at = pos();
    const char = text[index];
    if (char === "{") {
      index += 1;
      const entries: { key: string; pos: Pos; value: JsonNode }[] = [];
      skipSpace();
      if (text[index] === "}") {
        index += 1;
        return { kind: "object", pos: at, entries };
      }
      for (;;) {
        skipSpace();
        const keyPos = pos();
        const key = readString();
        skipSpace();
        expect(":");
        const value = readValue();
        entries.push({ key, pos: keyPos, value });
        skipSpace();
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        expect("}");
        return { kind: "object", pos: at, entries };
      }
    }
    if (char === "[") {
      index += 1;
      const items: JsonNode[] = [];
      skipSpace();
      if (text[index] === "]") {
        index += 1;
        return { kind: "array", pos: at, items };
      }
      for (;;) {
        items.push(readValue());
        skipSpace();
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        expect("]");
        return { kind: "array", pos: at, items };
      }
    }
    if (char === '"') return { kind: "string", pos: at, value: readString() };
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(word, index)) {
        index += word.length;
        return { kind: value === null ? "null" : "boolean", pos: at, value };
      }
    }
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(
      text.slice(index),
    );
    if (number) {
      index += number[0].length;
      return { kind: "number", pos: at, value: Number(number[0]) };
    }
    return fail();
  }

  const root = readValue();
  skipSpace();
  if (index < text.length) fail();
  return root;
}

/**
 * ショートカットの JSON を読む。形が違えば、違う所を全部返す (1 つでもあれば
 * value は返さない)。空の文字は「何も変えていない」 ({})。
 */
export function parseKeymapJson(text: string, mac: boolean): KeymapJsonResult {
  if (!text.trim()) return { ok: true, value: {} };
  let root: JsonNode;
  try {
    root = parseJsonWithPositions(text);
  } catch (error) {
    if (!(error instanceof JsonSyntaxError)) throw error;
    return {
      ok: false,
      issues: [
        {
          ...error.pos,
          path: "$",
          code: "syntax",
          ...(error.found ? { detail: error.found } : {}),
        },
      ],
    };
  }
  const issues: KeymapJsonIssue[] = [];
  const issue = (
    at: Pos,
    path: string,
    code: KeymapJsonIssueCode,
    detail?: string,
  ) => {
    issues.push({ ...at, path, code, ...(detail ? { detail } : {}) });
  };
  if (root.kind !== "object") {
    issue(root.pos, "$", "not-object");
    return { ok: false, issues };
  }
  const known = new Set<string>(KEYMAP_ACTIONS);
  const value: KeymapOverrides = {};
  for (const entry of root.entries) {
    if (!known.has(entry.key)) {
      issue(entry.pos, entry.key, "unknown-action");
      continue;
    }
    const action = entry.key as KeymapAction;
    if (value[action]) {
      issue(entry.pos, action, "duplicate-action");
      continue;
    }
    if (entry.value.kind !== "array") {
      issue(entry.value.pos, action, "not-array");
      continue;
    }
    if (entry.value.items.length > MAX_CHORDS_PER_ACTION)
      issue(
        entry.value.pos,
        action,
        "too-many-keys",
        String(MAX_CHORDS_PER_ACTION),
      );
    const chords: KeyChord[] = [];
    const seen = new Set<string>();
    entry.value.items.forEach((item, index) => {
      const path = `${action}[${index}]`;
      const chord = readChord(item, path, issue);
      if (!chord) return;
      const reserved = unassignableChord(chord, mac);
      if (reserved) {
        issue(item.pos, path, "reserved-chord", reserved);
        return;
      }
      const id = keyChordId(chord);
      if (seen.has(id)) {
        issue(item.pos, path, "duplicate-chord");
        return;
      }
      seen.add(id);
      chords.push(chord);
    });
    value[action] = chords;
  }
  return issues.length ? { ok: false, issues } : { ok: true, value };
}

function readChord(
  node: JsonNode,
  path: string,
  issue: (at: Pos, path: string, code: KeymapJsonIssueCode) => void,
): KeyChord | null {
  if (node.kind !== "object") {
    issue(node.pos, path, "chord-not-object");
    return null;
  }
  let ok = true;
  const fields = new Map<string, JsonNode>();
  for (const entry of node.entries) {
    const at = `${path}.${entry.key}`;
    if (!(CHORD_FIELDS as readonly string[]).includes(entry.key)) {
      issue(entry.pos, at, "unknown-field");
      ok = false;
    } else if (fields.has(entry.key)) {
      issue(entry.pos, at, "duplicate-field");
      ok = false;
    } else fields.set(entry.key, entry.value);
  }
  const key = fields.get("key");
  const name = key?.kind === "string" ? normalizeKeyName(key.value) : "";
  if (!key) {
    issue(node.pos, `${path}.key`, "missing-key");
    ok = false;
  } else if (!name) {
    issue(key.pos, `${path}.key`, "empty-key");
    ok = false;
  } else if (name.length > MAX_CHORD_KEY_LENGTH) {
    issue(key.pos, `${path}.key`, "key-too-long");
    ok = false;
  }
  const chord: KeyChord = { key: name };
  for (const field of BOOLEAN_FIELDS) {
    const flag = fields.get(field);
    if (!flag) continue;
    if (flag.kind !== "boolean") {
      issue(flag.pos, `${path}.${field}`, "not-boolean");
      ok = false;
      continue;
    }
    // 修飾キーと g は true のときだけ書く (false と書かないのと同じ)。効く所は
    // false にも意味がある (既定では効く所を止める)。
    if (flag.value === true || !isModifierField(field))
      chord[field] = flag.value as boolean;
  }
  return ok ? chord : null;
}

function isModifierField(field: Exclude<ChordField, "key">): boolean {
  return field !== "inputs" && field !== "terminal" && field !== "pwa";
}
