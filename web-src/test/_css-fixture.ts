// web/style.css を「文字列」ではなく「カスケードの結果」として検査するための道具。
//
// CSS の生文字列を includes で検査すると、整形しただけで落ちるうえ、同じ文字列が
// 別の規則にも現れると黙って無関係な規則を守り始める (実際に .gdp-markdown-toc を
// 検査していたはずのアサーションが .app-panel を守っていた)。
//
// happy-dom の getComputedStyle は var() / calc() を解決せず空文字を返すので、
// 変数を含む寸法はこちら側で解決する。セレクタが効いているかどうかだけなら
// happy-dom に実 CSS を流し込むほうが簡単 (ref-picker.test.ts が実例)。

import { readFileSync } from "node:fs";

export type CssRule = {
  selector: string;
  declarations: Map<string, string>;
  /** 出現順。詳細度が同じときの勝敗に使う。 */
  order: number;
  specificity: [number, number, number];
  /**
   * この規則を囲っている at-rule のプレリュード (`@media (max-width: 1100px)` など)。
   * 素の規則なら null。
   *
   * これを持たずに全規則を同列でカスケードすると、@media 内の上書きが常に勝ってしまい、
   * 「デスクトップでは sticky なのに static だと報告される」形で嘘の結果が出る。
   * デスクトップの見た目を検査したいなら baseRules() で絞る。
   */
  atRule: string | null;
  /**
   * 囲っている at-rule を外側から全部 (@media の中の @container など)。atRule は
   * このうちいちばん内側。
   */
  atRules: string[];
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseDeclarations(block: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const raw of block.split(";")) {
    const index = raw.indexOf(":");
    if (index < 0) continue;
    const prop = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (prop && value) declarations.set(prop, value);
  }
  return declarations;
}

type Specificity = [number, number, number];

function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * 詳細度 (Selectors Level 4)。`:is()` `:not()` `:has()` は引数の中で最も高いもの、
 * `:where()` は 0。属性選択子は class と同じ段、疑似要素は要素と同じ段。
 */
function specificity(selector: string): Specificity {
  const total: Specificity = [0, 0, 0];
  let rest = "";
  for (let i = 0; i < selector.length; i += 1) {
    const functional = /^:(is|not|has|where)\(/.exec(selector.slice(i));
    if (!functional) {
      rest += selector[i];
      continue;
    }
    let depth = 0;
    let end = i + functional[0].length - 1;
    for (; end < selector.length; end += 1) {
      if (selector[end] === "(") depth += 1;
      else if (selector[end] === ")" && --depth === 0) break;
    }
    if (functional[1] !== "where") {
      const inner = selector.slice(i + functional[0].length, end);
      const highest = splitSelectorList(inner)
        .map(specificity)
        .reduce((a, b) => (compareSpecificity(a, b) >= 0 ? a : b), [0, 0, 0]);
      for (let k = 0; k < 3; k++) total[k] += highest[k];
    }
    rest += " ";
    i = end;
  }
  const withoutAttributes = rest.replace(/\[[^\]]*\]/g, " [] ");
  // `::after` は `:after` としても数えてしまうので、その分を class の段から引く。
  const pseudoElements = (withoutAttributes.match(/::[\w-]+/g) || []).length;
  total[0] += (withoutAttributes.match(/#[\w-]+/g) || []).length;
  total[1] +=
    (withoutAttributes.match(/\.[\w-]+/g) || []).length +
    (withoutAttributes.match(/\[\]/g) || []).length +
    (withoutAttributes.match(/:[\w-]+/g) || []).length -
    pseudoElements;
  total[2] +=
    (withoutAttributes.match(/(^|[\s>+~])([a-z][\w-]*)/gi) || []).length +
    pseudoElements;
  return total;
}

/**
 * 選択子の並びを 1 つずつに分ける。`:is(a, b)` や `[title="a, b"]` の中のカンマでは
 * 切らない (切ると壊れた断片が規則になり、要素に当てられない)。
 */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const char = list[i];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  // 整形で折り返した選択子 (`:is(\n  [a],\n  [b]\n)`) を 1 行に戻す。happy-dom の
  // matches は括弧の内側の改行を受け付けない。空白の並びは CSS では 1 つと同じ。
  return parts
    .map((part) =>
      part
        .replace(/\s+/g, " ")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        .trim(),
    )
    .filter(Boolean);
}

export function parseCss(source: string): CssRule[] {
  const rules: CssRule[] = [];
  const text = stripComments(source);
  /** いま入っている at-rule のプレリュード。@media の入れ子にも耐える。 */
  const atRuleStack: string[] = [];
  let prelude = "";
  let order = 0;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (char === "}") {
      atRuleStack.pop();
      prelude = "";
      index++;
      continue;
    }
    if (char !== "{") {
      prelude += char;
      index++;
      continue;
    }

    const head = prelude.trim();
    prelude = "";
    if (head.startsWith("@")) {
      atRuleStack.push(head);
      index++;
      continue;
    }
    // 通常の規則。ネストは使っていないので、次の } までが宣言ブロック。
    const close = text.indexOf("}", index + 1);
    const end = close < 0 ? text.length : close;
    const block = text.slice(index + 1, end);
    const atRule = atRuleStack.length
      ? atRuleStack[atRuleStack.length - 1]
      : null;
    for (const selector of splitSelectorList(head)) {
      rules.push({
        selector,
        declarations: parseDeclarations(block),
        order: order++,
        specificity: specificity(selector),
        atRule,
        atRules: [...atRuleStack],
      });
    }
    index = end + 1;
  }
  return rules;
}

/** 配布している実物の style.css を読む。 */
export function loadStyleSheet(): CssRule[] {
  return parseCss(readFileSync("web/style.css", "utf8"));
}

/**
 * @media 等に囲まれていない素の規則だけ。
 * このアプリはデスクトップ専用なので、既定の見た目を検査するときはこちらを使う。
 */
export function baseRules(rules: CssRule[]): CssRule[] {
  return rules.filter((rule) => rule.atRule === null);
}

/**
 * matches が真になる規則だけを詳細度と出現順で解決し、勝ち残った宣言を返す。
 * どのセレクタを対象にするかは呼び出し側が決める (この道具は要素ツリーを持たない)。
 */
export function cascadedDeclarations(
  rules: CssRule[],
  matches: (selector: string) => boolean,
): Map<string, string> {
  const applied = new Map<
    string,
    { value: string; specificity: [number, number, number]; order: number }
  >();
  for (const rule of rules) {
    if (!matches(rule.selector)) continue;
    for (const [prop, value] of rule.declarations) {
      const previous = applied.get(prop);
      const wins =
        !previous ||
        compareSpecificity(rule.specificity, previous.specificity) > 0 ||
        (compareSpecificity(rule.specificity, previous.specificity) === 0 &&
          rule.order > previous.order);
      if (wins)
        applied.set(prop, {
          value,
          specificity: rule.specificity,
          order: rule.order,
        });
    }
  }
  return new Map([...applied].map(([prop, entry]) => [prop, entry.value]));
}

/** var() を variables で置き換えきる。解決できない変数があれば投げる。 */
export function resolveVar(
  value: string,
  variables: Map<string, string>,
): string {
  let resolvedValue = value;
  for (let i = 0; i < 8; i++) {
    const next = resolvedValue.replace(
      /var\((--[\w-]+)\)/g,
      (_, name: string) => {
        const resolved = variables.get(name);
        if (!resolved) throw new Error(`Unresolved CSS variable ${name}`);
        return resolved;
      },
    );
    if (next === resolvedValue) return next;
    resolvedValue = next;
  }
  throw new Error(`Could not resolve CSS variables in ${value}`);
}

/**
 * 長さを px の数にする。var() を variables で解いてから、px と数と四則と calc()
 * だけの式を計算する (それ以外が残れば投げる)。
 */
export function resolvePx(
  value: string,
  variables: Map<string, string>,
): number {
  const resolved = resolveVar(value, variables);
  const expression = resolved
    .replace(/calc\(/g, "(")
    .replace(/(\d*\.?\d+)px/g, "$1");
  if (!/^[\d\s.+\-*/()]+$/.test(expression))
    throw new Error(`not a plain length: ${value} (${resolved})`);
  return Number(new Function(`return (${expression});`)());
}
