// yaml を lazy import する共通ローダ。JSON/YAML ツールからだけ呼ばれる。
// mermaid / shiki と同じく別バンドル (web/yaml.js) にしてあるので、ツールを
// 開くまでパーサのコードは落ちてこない。失敗時は null (呼び出し側で fallback)。

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

let yamlPromise: Promise<YamlApi | null> | null = null;

export function loadYaml(): Promise<YamlApi | null> {
  if (!yamlPromise) {
    yamlPromise = import(`/${"yaml.js"}`)
      .then((mod: unknown) => mod as YamlApi)
      .catch(() => null);
  }
  return yamlPromise;
}
