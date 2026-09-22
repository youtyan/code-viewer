// 一覧の Tab の止まり場所を 1 つにする (roving tabindex)。Diff の変更ファイル
// (views/sidebar.ts の差分の一覧)・History のコミット・作業ツリーの一覧と変更
// ファイルが使う。決まりは Files の木 (sidebar.ts の syncTreeTabStop) と同じ:
// 選んでいる行 (無ければ見えている先頭の行) だけが tabIndex 0、ほかは -1。
// 行の中のボタンは止まり場所の行の分だけ Tab に入れる。
//
// フォーカスの戻し方: 行 (か、その中の部品) にフォーカスがあったら、選び直した
// なら選んだ行へ、そうでなければ同じ行の同じ部品へ戻す。行を作り直す一覧は、
// 作り直す前に focusedListRow で控えて渡す (作り直すとフォーカスが body へ落ちる)。

/**
 * フォーカスのあった行 (鍵) と、それが行そのものか中の部品か。部品なら、行の中の
 * フォーカスできる部品の何番目か (作り直した後の同じ部品へ戻す)。
 */
export type FocusedListRow = {
  key: string;
  onAction: boolean;
  actionIndex?: number;
};

/** 行の中でフォーカスできる部品 (何番目かを数える)。 */
const ROW_CONTROL_SELECTOR =
  "button, a[href], input, select, textarea, [tabindex]";

function focusedRowOf(row: HTMLElement, focused: HTMLElement, key: string) {
  if (focused === row) return { key, onAction: false };
  const controls = [...row.querySelectorAll<HTMLElement>(ROW_CONTROL_SELECTOR)];
  return { key, onAction: true, actionIndex: controls.indexOf(focused) };
}

export type ListTabStopOptions = {
  /** 一覧の全部の行 (見えていない行も。tabIndex を -1 に戻すため)。 */
  rows: readonly HTMLElement[];
  /** 見えている行 (止まり場所の候補)。省略すると rows。 */
  shown?: readonly HTMLElement[];
  /** 行の鍵 (作り直しをまたいで同じ行を見つける)。 */
  keyOf(row: HTMLElement): string;
  /** 選んでいる行か。 */
  isActive(row: HTMLElement): boolean;
  /** 行の中で Tab に入れる部品 (止まり場所の行の分だけ)。 */
  actionSelector?: string;
  /** 選んでいる行に aria-selected を付けるか (listbox・tree の行)。 */
  ariaSelected?: boolean;
  /** 控えたフォーカス。無ければ今のフォーカスから読む。 */
  focused?: FocusedListRow | null;
  /** 戻す先の行が無いときにフォーカスを置く箱。 */
  fallback?: HTMLElement | null;
  /**
   * 前回選んでいた行の鍵を覚えておく要素。省略すると list。一覧の要素ごと
   * 作り直す画面は、作り直さない外側の箱を渡す。
   */
  memo?: HTMLElement;
};

/** list の行 (rowSelector) にフォーカスがあれば、その鍵を返す。 */
export function focusedListRow(
  list: HTMLElement,
  rowSelector: string,
  keyOf: (row: HTMLElement) => string,
): FocusedListRow | null {
  const focused = document.activeElement as HTMLElement | null;
  if (!focused || !list.contains(focused)) return null;
  const row = focused.closest<HTMLElement>(rowSelector);
  if (!row || !list.contains(row)) return null;
  return focusedRowOf(row, focused, keyOf(row));
}

/**
 * 止まり場所を付け直し、控えたフォーカスを戻す。選び直したかは、前回の選んで
 * いた行の鍵 (memo か list の data-tab-stop-active) と比べて決める。止まり場所の
 * 行を返す。
 */
export function syncListTabStop(
  list: HTMLElement,
  options: ListTabStopOptions,
): HTMLElement | null {
  const { rows, keyOf, isActive, actionSelector } = options;
  const shown = options.shown ?? rows;
  const active = rows.find((row) => isActive(row)) ?? null;
  const stop =
    (active && shown.includes(active) ? active : null) ?? shown[0] ?? null;
  const actionsOf = (row: HTMLElement) =>
    actionSelector
      ? [...row.querySelectorAll<HTMLElement>(actionSelector)]
      : [];
  for (const row of rows) {
    row.tabIndex = row === stop ? 0 : -1;
    if (options.ariaSelected)
      row.setAttribute("aria-selected", String(row === active));
    for (const action of actionsOf(row))
      action.tabIndex = row === stop ? 0 : -1;
  }
  const activeKey = active ? keyOf(active) : "";
  const memo = options.memo ?? list;
  const previousKey = memo.dataset.tabStopActive ?? "";
  memo.dataset.tabStopActive = activeKey;
  const focused =
    options.focused === undefined
      ? focusedFrom(list, rows, keyOf)
      : options.focused;
  if (!focused) return stop;
  const moved = active !== null && activeKey !== previousKey;
  const same = rows.find((row) => keyOf(row) === focused.key) ?? null;
  const target = moved ? active : (same ?? active ?? stop);
  const restored =
    !moved && focused.onAction && target
      ? (sameControl(target, focused.actionIndex) ??
        actionsOf(target)[0] ??
        null)
      : null;
  const next = restored ?? target ?? options.fallback ?? null;
  if (next && document.activeElement !== next)
    next.focus({ preventScroll: true });
  return stop;
}

function sameControl(
  row: HTMLElement,
  index: number | undefined,
): HTMLElement | null {
  if (index === undefined || index < 0) return null;
  const control =
    row.querySelectorAll<HTMLElement>(ROW_CONTROL_SELECTOR)[index];
  return control && control.tabIndex >= 0 ? control : null;
}

function focusedFrom(
  list: HTMLElement,
  rows: readonly HTMLElement[],
  keyOf: (row: HTMLElement) => string,
): FocusedListRow | null {
  const focused = document.activeElement as HTMLElement | null;
  if (!focused || !list.contains(focused)) return null;
  const row = rows.find((item) => item === focused || item.contains(focused));
  return row ? focusedRowOf(row, focused, keyOf(row)) : null;
}

/** 行の上のキー (修飾キー無し)。一覧ごとに動きを渡す。 */
export type ListRowKeys = Partial<
  Record<
    "ArrowDown" | "ArrowUp" | "Home" | "End" | "Enter",
    (row: HTMLElement) => void
  >
>;

/**
 * list の行 (rowSelector) の上のキーを keys に渡す。処理したキーは
 * preventDefault する (ページのキー割り当ては defaultPrevented を見て抜ける)。
 * 行の中の部品 (ボタン) の上のキーは部品に任せる。受けるのをやめる関数を返す
 * (一覧の箱を付け替える画面は、付け替えるたびに外す)。
 */
export function onListRowKeys(
  list: HTMLElement,
  rowSelector: string,
  keys: ListRowKeys,
): () => void {
  const listener = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (!target?.matches(rowSelector)) return;
    const handle = keys[event.key as keyof ListRowKeys];
    if (!handle) return;
    event.preventDefault();
    handle(target);
  };
  list.addEventListener("keydown", listener);
  return () => list.removeEventListener("keydown", listener);
}

/** 並んでいる行の隣 (端で止まる)。 */
export function adjacentRow(
  rows: readonly HTMLElement[],
  row: HTMLElement,
  delta: 1 | -1,
): HTMLElement | null {
  const index = rows.indexOf(row);
  if (index < 0) return null;
  return rows[Math.max(0, Math.min(rows.length - 1, index + delta))] ?? null;
}
