// mermaid を lazy import する共通ローダ。markdown preview (fence ```mermaid)
// と Tools の Mermaid から呼ばれる。読み込みはプロセス内で 1 度だけ。
// 失敗時は原因を呼び出し側へ伝播する。

import { createBundleLoader } from "./lazy-bundle";
import { PROJECT_COLORS } from "./project-colors";

export type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  // nodes は Element[] で受ける (markdown-preview が Element[]、Tools が
  // HTMLElement[] を渡すので、共通の base クラスで揃える)。
  run(options: { nodes: Element[]; suppressErrors?: boolean }): Promise<void>;
  parse?: (text: string) => Promise<unknown>;
};

type MermaidModule = { default: MermaidApi };

// 図の色はアプリの色の名前から作る。mermaid は渡した色から別の色を計算する
// (khroma) ので var() は渡せず、描く時点の値を read で読んで渡す。
//
// mermaid の既定 (theme: "default") はライトの配色で、ダークの面では矢印の文字と
// 線が地に沈み、サブグラフの黄色い面が浮いていた。アプリの色を base テーマに渡し、
// どのテーマ・明暗でも本文と同じ色で描く。色分け (円グラフ・タイムライン) は
// プロジェクトの色 (明暗ごとに 1 組、上の文字 --project-ink との差は
// project-colors.test.ts が見る)。ここで決めない色は mermaid が primaryColor から
// 作る。initialize は呼ぶたびに既定値から設定し直すので、全部の項目をここに書く。
export function mermaidConfig(
  read: (token: string) => string,
  dark: boolean,
): Record<string, unknown> {
  const doc = read("--color-doc");
  const inset = read("--color-inset");
  const text = read("--color-text");
  const text2 = read("--color-text-2");
  const text3 = read("--color-text-3");
  const lineStrong = read("--color-line-strong");
  const ink = read("--project-ink");
  const categories = PROJECT_COLORS.map((color) => read(`--project-${color}`));
  return {
    startOnLoad: false,
    securityLevel: "strict",
    er: { useMaxWidth: false },
    theme: "base",
    themeVariables: {
      darkMode: dark,
      background: doc,
      fontFamily: read("--font-ui"),
      primaryColor: read("--color-select"),
      primaryTextColor: text,
      primaryBorderColor: read("--color-accent"),
      textColor: text,
      titleColor: text,
      nodeTextColor: text,
      lineColor: text2,
      arrowheadColor: text2,
      edgeLabelBackground: doc,
      clusterBkg: inset,
      clusterBorder: lineStrong,
      noteBkgColor: read("--color-raised"),
      noteTextColor: text,
      noteBorderColor: text3,
      signalColor: text2,
      signalTextColor: text,
      labelTextColor: text,
      loopTextColor: text,
      actorLineColor: text3,
      altSectionBkgColor: doc,
      gridColor: lineStrong,
      excludeBkgColor: inset,
      doneTaskBkgColor: inset,
      doneTaskBorderColor: text3,
      pieStrokeColor: doc,
      pieOuterStrokeColor: lineStrong,
      pieTitleTextColor: text,
      pieSectionTextColor: ink,
      pieLegendTextColor: text,
      ...Object.fromEntries(
        categories.flatMap((color, i) => [
          [`pie${i + 1}`, color],
          [`cScale${i}`, color],
          [`cScaleLabel${i}`, ink],
        ]),
      ),
    },
  };
}

const loadMermaidModule = createBundleLoader<MermaidModule>("mermaid.js");
let mermaidPromise: Promise<MermaidApi> | null = null;
let appliedConfig = "";

// 呼ぶたびにいまの明暗・テーマの色を読み、前に渡した設定と違えば渡し直す
// (読み込み直後と、テーマを変えた後の最初の描画)。
export async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise)
    mermaidPromise = loadMermaidModule().then((mod) => mod.default);
  const mermaid = await mermaidPromise;
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const config = mermaidConfig((token) => {
    const value = style.getPropertyValue(token).trim();
    if (!value)
      throw new Error(`Mermaid colors: the CSS variable ${token} has no value`);
    return value;
  }, root.dataset.theme === "dark");
  const key = JSON.stringify(config);
  if (key !== appliedConfig) {
    mermaid.initialize(config);
    appliedConfig = key;
  }
  return mermaid;
}

/**
 * 明暗・テーマ (html の data-theme / data-color-theme) が変わったら listener を
 * 呼ぶ。描いた図の SVG には色が焼き込まれているので、描き直す側が使う。同じ値を
 * 書き直しただけ (applyTheme は変わらなくても書く) では呼ばない。
 */
export function onMermaidLookChange(listener: () => void): () => void {
  const root = document.documentElement;
  const lookKey = () =>
    `${root.dataset.theme ?? ""}\n${root.dataset.colorTheme ?? ""}`;
  let last = lookKey();
  const observer = new MutationObserver(() => {
    const next = lookKey();
    if (next === last) return;
    last = next;
    listener();
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["data-theme", "data-color-theme"],
  });
  return () => observer.disconnect();
}
