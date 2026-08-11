// yaml を lazy import する共通ローダ。JSON/YAML ツールからだけ呼ばれる。
// mermaid / shiki と同じく別バンドル (web/yaml.js) にしてあるので、ツールを
// 開くまでパーサのコードは落ちてこない。失敗時は原因を呼び出し側へ伝播する。

import { createBundleLoader } from "./lazy-bundle";

// yaml の YAMLParseError / YAMLWarning のうち、表示に使う分だけを写した形。
// message は yaml 側が "... at line 3, column 5" と該当行の抜粋まで含めた
// 文字列を作ってくれるので、こちらで位置を組み立て直す必要はない。
export type YamlIssue = {
  message: string;
};

export type YamlDocument = {
  errors: YamlIssue[];
  warnings: YamlIssue[];
  toJS(): unknown;
};

export type YamlApi = {
  parseDocument(text: string): YamlDocument;
  stringify(value: unknown, options?: { indent?: number }): string;
};

export const loadYaml = createBundleLoader<YamlApi>("yaml.js");
