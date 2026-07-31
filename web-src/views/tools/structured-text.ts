// JSON / YAML ツールの純ロジック。DOM にも lazy import にも触らないので、
// パーサ (YamlApi) は呼び出し側から注入する。

import type { YamlApi } from "../../core/yaml-loader";

export type StructuredFormat = "json" | "yaml";

// 判別は文字列リテラルで行う。tsconfig が strict: false なので、boolean の
// 判別プロパティ (ok: true / false) では絞り込みが効かない。
export type StructuredParseResult =
  | {
      status: "ok";
      source: StructuredFormat;
      value: unknown;
      /** 解釈はできたが引っかかった点 (YAML の警告)。 */
      warnings?: string[];
    }
  | { status: "error"; message: string };

const JSON_INDENT = 2;

/** 入力を JSON として読み、駄目なら YAML として読む。JSON は YAML の部分集合
 * ではないケース (タブ字下げなど) があるので、JSON を先に試す。 */
export function parseStructuredText(
  text: string,
  yaml: YamlApi | null,
): StructuredParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { status: "error", message: "empty input" };
  let jsonMessage = "";
  try {
    return { status: "ok", source: "json", value: JSON.parse(trimmed) };
  } catch (err) {
    jsonMessage = err instanceof Error ? err.message : String(err);
  }
  if (!yaml) return { status: "error", message: jsonMessage };
  try {
    const doc = yaml.parseDocument(text);
    // 1 件だけ出すと、直した先にまだ残っていることが見えない。まとめて返す。
    if (doc.errors.length > 0)
      return {
        status: "error",
        message: doc.errors.map((issue) => issue.message).join("\n\n"),
      };
    const warnings = doc.warnings.map((issue) => issue.message);
    return {
      status: "ok",
      source: "yaml",
      value: doc.toJS(),
      ...(warnings.length ? { warnings } : {}),
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 解析済みの値を指定形式の文字列に戻す。yaml が無いまま YAML を要求された
 * ときだけ null を返す (呼び出し側でローダ失敗を伝える)。 */
export function formatStructured(
  value: unknown,
  format: StructuredFormat,
  minify: boolean,
  yaml: YamlApi | null,
): string | null {
  if (format === "yaml") {
    if (!yaml) return null;
    return yaml.stringify(value, { indent: JSON_INDENT });
  }
  return JSON.stringify(value, null, minify ? 0 : JSON_INDENT) ?? "";
}
