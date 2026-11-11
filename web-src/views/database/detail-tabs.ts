import { html } from "lit/html.js";
import { detachedElement, templateElement } from "../ui/renderer";

export type DetailTabSpec<TId extends string> = {
  id: TId;
  label: string;
};

export type DetailTabs<TId extends string> = {
  tabsEl: HTMLElement;
  bodies: Record<TId, HTMLElement>;
  getActive(): TId;
  setActive(tab: TId): void;
  setLabels(labels: Record<TId, string>): void;
};

// es-explorer の mapping/doc タブと dynamodb-explorer の structure/item タブが
// ほぼ同一の切替ロジック(ボタン active トグル + body hidden トグル)を個別実装
// していた重複を解消する共通の2択(以上)詳細タブウィジェット。setActive() は
// 初期化・復元・アイテム選択時の自動切替などプログラムからの呼び出し用で、
// onSelect は呼ばない。タブボタンをユーザーがクリックしたときだけ onSelect を
// 呼ぶ(呼び出し元は selectItem() 等で既に自前の notify を行っているため)。
/** 詳細のタブの並び (createDetailTabs) の描き方。 */
export type DetailTabsView = (props: {
  tabs: { label: string; active: boolean; onClick(): void }[];
}) => unknown;

export const DEFAULT_VIEW: DetailTabsView = (props) => html`<div
  class="db-detail-tabs"
>${props.tabs.map(
  (tab) => html`<button
    type="button"
    class=${tab.active ? "db-detail-tab active" : "db-detail-tab"}
    @click=${tab.onClick}
  >${tab.label}</button>`,
)}</div>`;

export function createDetailTabs<TId extends string>(
  specs: readonly DetailTabSpec<TId>[],
  initial: TId,
  onSelect: (tab: TId) => void,
  view: DetailTabsView = DEFAULT_VIEW,
): DetailTabs<TId> {
  let active = initial;
  const labels = Object.fromEntries(
    specs.map((spec) => [spec.id, spec.label]),
  ) as Record<TId, string>;
  const bodies = {} as Record<TId, HTMLElement>;
  for (const spec of specs)
    bodies[spec.id] = templateElement(
      html`<div class="db-detail-tab-body"></div>`,
    );

  const tabs = detachedElement(() =>
    view({
      tabs: specs.map((spec) => ({
        label: labels[spec.id],
        active: spec.id === active,
        onClick: () => {
          setActive(spec.id);
          onSelect(spec.id);
        },
      })),
    }),
  );

  function setActive(tab: TId): void {
    active = tab;
    tabs.draw();
    // 中身の箱は呼び手が描く。見せるのは選んだタブの箱だけ。
    for (const spec of specs) bodies[spec.id].hidden = spec.id !== tab;
  }
  setActive(initial);

  function setLabels(next: Record<TId, string>): void {
    for (const spec of specs) labels[spec.id] = next[spec.id];
    tabs.draw();
  }

  return {
    tabsEl: tabs.element,
    bodies,
    getActive: () => active,
    setActive,
    setLabels,
  };
}
