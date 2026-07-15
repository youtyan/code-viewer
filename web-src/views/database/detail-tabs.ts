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
export function createDetailTabs<TId extends string>(
  specs: readonly DetailTabSpec<TId>[],
  initial: TId,
  onSelect: (tab: TId) => void,
): DetailTabs<TId> {
  const tabsEl = document.createElement("div");
  tabsEl.className = "db-detail-tabs";
  const buttons = {} as Record<TId, HTMLButtonElement>;
  const bodies = {} as Record<TId, HTMLElement>;
  let active = initial;

  function setActive(tab: TId): void {
    active = tab;
    for (const spec of specs) {
      buttons[spec.id].classList.toggle("active", spec.id === tab);
      bodies[spec.id].hidden = spec.id !== tab;
    }
  }

  for (const spec of specs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "db-detail-tab";
    btn.textContent = spec.label;
    btn.addEventListener("click", () => {
      setActive(spec.id);
      onSelect(spec.id);
    });
    buttons[spec.id] = btn;
    tabsEl.appendChild(btn);
    const body = document.createElement("div");
    body.className = "db-detail-tab-body";
    bodies[spec.id] = body;
  }
  setActive(initial);

  function setLabels(labels: Record<TId, string>): void {
    for (const spec of specs) buttons[spec.id].textContent = labels[spec.id];
  }

  return { tabsEl, bodies, getActive: () => active, setActive, setLabels };
}
