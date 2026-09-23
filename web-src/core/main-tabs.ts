// メインの面のタブの配置 (純ロジック)。DOM・fetch・i18n に依存しない。
//
// 面は 1 つか 2 つ (left / right)。各面はタブの並びと選択中のタブを持ち、
// フォーカスのある面が 1 つある。操作はどれも新しい状態を返す純関数で、
// 渡された状態を書き換えない。
//
// 本文 (route で中身が決まる page) を描ける場所は 1 つしか無いので、page の
// タブは左の面にだけ置く。file はソース表示を面ごとに持つので右の面にも置ける
// (canPlace)。左の面はタブを選んでいなくてよい: そのときは本文の既定 (フォルダ
// 表示) を出す。
//
// 不変条件 (assertLayout が検査する):
// - タブの id は全体で一意
// - activeId は面の中に存在するか null。null は左の面だけ (本文の既定を出す)。
//   右の面は空にならず (空になれば 1 面に戻る)、必ずどれかを選んでいる
// - 右の面のタブは canPlace(target, "right") を満たす
// - 仮のタブ (preview) は面ごと・プロジェクトごとに最大 1
// - 同じ中身 (sameTarget) のタブは、ファイルなら面ごとに最大 1 (左右で同じ
//   ファイルは開ける)、ほかは全体で最大 1 (perPaneTarget)
//
// タブは全プロジェクト共通の 1 つの配置で、タブはプロジェクトの持ち物を持つ
// (target の project = そのプロジェクトの根のパス)。ファイル・リポジトリの画像・
// Diff などの画面はそのプロジェクトのもの (isProjectKind)。シェル・全体ボード・
// Tools・設定と案内・ターミナルに出た画像 (絶対パス) は持ち物を持たない。シェルの
// タブのグループは、そのシェルが動いているフォルダで画面側が決める (target には
// 持たない)。同じパスでもプロジェクトが違えば別のタブ。
//
// タブ列はプロジェクトごとのグループに分けて並べる (regroup・tabGroups)。グループの
// 並びは画面側が決める順 (左の一覧のプロジェクトの並び)、中のタブの順は利用者が
// 並べたとおり。
//
// 表示名は画面側 (i18n) が作る。ここは同一判定だけを持つ。

import type { SourceLineTarget } from "./routes";

/**
 * page の種類。AppRoute の screen のうち、タブとして開く画面。repo (フォルダ
 * 表示) はタブにしない: 左の面の本文の既定 (タブを選んでいないときに出す)。
 */
export const PAGE_KINDS = [
  "diff",
  "history",
  "worktree",
  "database",
  "journal",
  "agents",
  "tools",
  "search",
  "help",
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];

export type TabTarget =
  | {
      kind: "file";
      path: string;
      line?: SourceLineTarget;
      /**
       * 作業ツリー以外の版 (コミット・ブランチ・HEAD)。作業ツリーなら持たない。
       * 版が違えば別のタブ (sameTarget)。
       */
      ref?: string;
      /** 持ち物のプロジェクトの根 (isProjectKind の種類だけ。下の project の決まり)。 */
      project?: string;
    }
  | { kind: "terminal"; session: string }
  | { kind: "image"; path: string; project?: string }
  | { kind: "page"; page: PageKind; project?: string };

// ---- タブの持ち物のプロジェクト ----
//
// project はプロジェクトの根のパス (登録簿・サーバの根と同じ文字列)。持たない
// のは「どのプロジェクトのものでもない」タブ。持ち物になりうる種類 (isProjectKind)
// でも持っていないことがある (根を知らないまま開いた画面・テスト) ので、そのときも
// どのプロジェクトのものでもない扱い (グループの外、タブ列の右端) にする。

// Tools (書き捨ての Markdown・Mermaid・JSON) はリポジトリの中身を見ない。
// Search (grep の結果) はそのリポジトリの結果なのでプロジェクトのもの。
const PROJECT_FREE_PAGES: ReadonlySet<PageKind> = new Set([
  "agents",
  "tools",
  "help",
]);

/** その種類のタブがプロジェクトの中身を見せるか (project を持つ種類)。 */
export function isProjectKind(target: TabTarget): boolean {
  switch (target.kind) {
    case "terminal":
      return false;
    case "image":
      // ターミナルに出た画像は絶対パス。リポジトリの画像はリポジトリの中の相対パス。
      return !target.path.startsWith("/");
    case "page":
      return !PROJECT_FREE_PAGES.has(target.page);
    case "file":
      return true;
  }
}

/** target が持っている持ち物のプロジェクト (無ければ null。シェルは画面側が決める)。 */
export function targetProject(target: TabTarget): string | null {
  return target.kind === "terminal" ? null : (target.project ?? null);
}

/** 持ち物になりうる種類に、持ち物のプロジェクトを付ける (持っていれば変えない)。 */
export function withProject(target: TabTarget, project: string): TabTarget {
  if (!isProjectKind(target) || target.kind === "terminal") return target;
  if (target.project !== undefined) return target;
  return { ...target, project };
}

export type Tab = {
  id: string;
  target: TabTarget;
  /** 仮のタブ。次の仮のタブに置き換わる。 */
  preview: boolean;
};

export type PaneSide = "left" | "right";

export type Pane = {
  tabs: Tab[];
  activeId: string | null;
  /** 選択した順 (古い → 新しい)。閉じたときの次の選択に使う。 */
  recent: string[];
};

export type Layout = {
  panes: { left: Pane; right?: Pane };
  focused: PaneSide;
  /**
   * 2 面のときの左の面の幅の比 (0 より大きく 1 より小さい)。1 面では持たない。
   * 画面の幅に対する比で持つので、窓の幅が変わっても比が保たれる。
   */
  split?: number;
  /**
   * グループ (プロジェクトの根) ごとの、最後に前面だったタブの id。左の一覧で
   * そのプロジェクトへ切り替えたときに前面に出す (画面側が noteGroupFronts で書く)。
   */
  groupFronts?: Record<string, string>;
  /** 畳んだグループ (プロジェクトの根)。左右の面で共通。 */
  collapsed?: string[];
  /**
   * シェルのタブのグループの控え (シェルの id → プロジェクトの根)。シェルの
   * グループは動いているフォルダで決まり、画面はエージェントの一覧が届くまで
   * 分からない。控えが無いと、読み込み直後にシェルのタブが右端に並び、一覧が
   * 届いたときにグループへ飛んでタブ列が動く。
   */
  terminalGroups?: Record<string, string>;
};

/** 分割した直後の左の面の比。 */
export const DEFAULT_SPLIT = 0.5;

/** 左の面の比を変える。1 面なら何もしない。0 と 1 は面が消えるので含めない。 */
export function setSplit(layout: Layout, ratio: number): Layout {
  if (!layout.panes.right || !(ratio > 0 && ratio < 1)) return layout;
  return { ...layout, split: ratio };
}

export type OpenOptions = {
  pane?: "focused" | "left" | "right" | "other-if-split";
  /** 既定 true。page と terminal は常に固定で開く。 */
  preview?: boolean;
  /** 新しいタブの id。既定は使われていない `t<n>`。 */
  newId?: () => string;
  /**
   * タブのグループ (プロジェクトの根。無ければ null)。渡すと、新しいタブは同じ
   * グループのタブの隣に入り (前面が別のグループなら、そのグループの末尾)、仮の
   * タブは同じグループの仮のタブだけを置き換える。渡さなければ target の project。
   */
  groupOf?: (target: TabTarget) => string | null;
};

type TabMenuState = {
  close: boolean;
  closeOthers: boolean;
  closeToRight: boolean;
  keepOpen: boolean;
  splitRight: boolean;
  moveToOtherSide: boolean;
  /** 同じ面の中で 1 つ左 / 右へ (ドラッグと Ctrl+Shift+PageUp / PageDown の代わり)。 */
  moveLeft: boolean;
  moveRight: boolean;
  copyPath: boolean;
};

type MoveResult =
  | { layout: Layout; moved: true }
  | {
      layout: Layout;
      moved: false;
      reason:
        | "unknown-tab"
        | "no-such-pane"
        | "duplicate-target"
        | "not-placeable"
        | "invalid-index";
    };

/**
 * 5: タブは全プロジェクト共通の 1 つの配置。ファイル・画像・画面のタブが持ち物の
 *    プロジェクト (target の project) を持ち、配置がグループの前面 (groupFronts) と
 *    畳んだグループ (collapsed) を持つ。4 までの配置はプロジェクトごとの保存で、
 *    読むときに parseLayout の project で持ち物を付ける (core/main-tabs-migrate.ts)。
 * 4: ファイルのタブが版 (ref) を持つ。同じパスでも版が違えば別のタブ。
 *    3 までしか読めない古いアプリは版を読まずに同じパスのタブを 2 つと数え、
 *    壊れた配置として捨てるので、版を分けて「版が違う」と報告させる。
 * 3: 右の面に file を置け、左右で同じファイルを開ける (同じ中身は面ごとに 1 つ)。
 *    形は 2 と同じ。版を分けたのは、2 までしか読めない古いアプリがこの配置を
 *    読まずに「版が違う」と報告するため (左右の同じファイルを壊れた配置として
 *    黙って捨てさせない)。
 * 2: repo の page タブを廃止し、左の面の activeId に null (本文の既定) を
 *    許した。
 * 1〜3 の値も読む (repo のタブは落とし、右の面の page のタブは左へ移す。3 までのファイルのタブは作業ツリーの版)。
 */
export const LAYOUT_VERSION = 5;

/** 作業ツリーの版。ファイルのタブの target には書かない (ref が無い = 作業ツリー)。 */
export const WORKTREE_REF = "worktree";

/** その種類のタブをその面に置けるか。page (本文の画面) は左の面だけ。 */
export function canPlace(target: TabTarget, side: PaneSide): boolean {
  return side === "left" || target.kind !== "page";
}

function emptyPane(): Pane {
  return { tabs: [], activeId: null, recent: [] };
}

export function emptyLayout(): Layout {
  return { panes: { left: emptyPane() }, focused: "left" };
}

export function sameTarget(a: TabTarget, b: TabTarget): boolean {
  // 同じパス・同じ画面でも、プロジェクトが違えば別のタブ。
  if (targetProject(a) !== targetProject(b)) return false;
  switch (a.kind) {
    case "file":
      // 行の指定は見ない (同じ版の中の移動は同じタブ)。版は見る。
      return (
        b.kind === "file" &&
        a.path === b.path &&
        (a.ref ?? WORKTREE_REF) === (b.ref ?? WORKTREE_REF)
      );
    case "image":
      return b.kind === "image" && a.path === b.path;
    case "terminal":
      return b.kind === "terminal" && a.session === b.session;
    case "page":
      return b.kind === "page" && a.page === b.page;
  }
}

/** open の groupOf が無いときのグループ (target の project)。 */
function groupKeyOf(opts: Pick<OpenOptions, "groupOf">) {
  return opts.groupOf ?? targetProject;
}

function sides(layout: Layout): PaneSide[] {
  return layout.panes.right ? ["left", "right"] : ["left"];
}

function paneOf(layout: Layout, side: PaneSide): Pane | null {
  return side === "left" ? layout.panes.left : (layout.panes.right ?? null);
}

export function findTab(
  layout: Layout,
  id: string,
): { side: PaneSide; index: number; tab: Tab } | null {
  for (const side of sides(layout)) {
    const pane = paneOf(layout, side);
    const index = pane?.tabs.findIndex((tab) => tab.id === id) ?? -1;
    if (pane && index >= 0) return { side, index, tab: pane.tabs[index] };
  }
  return null;
}

/** 同じ中身のタブを、sides の順に探す。 */
function findTarget(
  layout: Layout,
  target: TabTarget,
  order: PaneSide[] = sides(layout),
): { side: PaneSide; tab: Tab } | null {
  for (const side of order) {
    const tab = paneOf(layout, side)?.tabs.find((item) =>
      sameTarget(item.target, target),
    );
    if (tab) return { side, tab };
  }
  return null;
}

/** その面の選択中のタブ (面が無いか、何も選んでいなければ null)。 */
export function frontTab(layout: Layout, side: PaneSide): Tab | null {
  const pane = paneOf(layout, side);
  if (!pane?.activeId) return null;
  return pane.tabs.find((tab) => tab.id === pane.activeId) ?? null;
}

/** フォーカスのある面の選択中のタブ。 */
export function activeTab(layout: Layout): Tab | null {
  return frontTab(layout, layout.focused);
}

/** 両方の面のタブ (左の面から順に)。 */
export function allTabs(layout: Layout): Tab[] {
  return sides(layout).flatMap((side) => (paneOf(layout, side) as Pane).tabs);
}

/** 同じ中身のタブがある面 (左を先に見る)。無ければ null。 */
export function sideOfTarget(
  layout: Layout,
  target: TabTarget,
): PaneSide | null {
  return findTarget(layout, target)?.side ?? null;
}

function withPane(layout: Layout, side: PaneSide, pane: Pane): Layout {
  return {
    ...layout,
    panes:
      side === "left"
        ? { ...layout.panes, left: pane }
        : { ...layout.panes, right: pane },
  };
}

function selectIn(pane: Pane, id: string | null): Pane {
  if (!id) return { ...pane, activeId: null };
  return {
    ...pane,
    activeId: id,
    recent: [...pane.recent.filter((item) => item !== id), id],
  };
}

function nextId(layout: Layout, newId?: () => string): string {
  const used = new Set<string>();
  for (const side of sides(layout))
    for (const tab of paneOf(layout, side)?.tabs ?? []) used.add(tab.id);
  if (newId) {
    const id = newId();
    if (id.length === 0) throw new Error("new tab id must be non-empty");
    if (used.has(id))
      throw new Error(`new tab id already exists: ${JSON.stringify(id)}`);
    return id;
  }
  let n = used.size + 1;
  while (used.has(`t${n}`)) n += 1;
  return `t${n}`;
}

function resolveSide(
  layout: Layout,
  pane: OpenOptions["pane"] = "focused",
): PaneSide {
  if (pane === "left") return "left";
  if (pane === "right") return layout.panes.right ? "right" : "left";
  if (pane === "other-if-split") {
    if (!layout.panes.right) return layout.focused;
    return layout.focused === "left" ? "right" : "left";
  }
  return layout.focused;
}

/**
 * 開く。同じ中身のタブがあれば、それを前面に出してその面へフォーカスを移す
 * (中身は新しい target に差し替える: 行の指定が変わる。固定で開いたなら
 * 仮のタブも固定にする: 「新しいタブで開く」が仮のまま残らない)。探す面は、面を指定
 * しないとき (focused) はフォーカスのある面 → 反対の面、指定したとき (Alt+
 * クリックの反対の面など) はその面だけ (左右で同じファイルを開ける)。
 * 無ければ、仮で開くときに面に仮のタブがあればそれを置き換え、無ければ
 * 選択中のタブの右に足す。
 */
export function open(
  layout: Layout,
  target: TabTarget,
  opts: OpenOptions = {},
): Layout {
  const { side, existing } = openPlan(layout, target, opts);
  if (existing) {
    const pane = paneOf(layout, existing.side) as Pane;
    const tabs = pane.tabs.map((tab) =>
      tab.id === existing.tab.id
        ? { ...tab, target, preview: tab.preview && opts.preview !== false }
        : tab,
    );
    return {
      ...withPane(
        layout,
        existing.side,
        selectIn({ ...pane, tabs }, existing.tab.id),
      ),
      focused: existing.side,
    };
  }
  const pane = paneOf(layout, side) as Pane;
  const tab = newTab(layout, target, opts);
  const groupOf = groupKeyOf(opts);
  const group = groupOf(target);
  const preview = tab.preview;
  // 仮のタブは同じグループの仮のタブだけを置き換える (別のプロジェクトで見ていた
  // 仮のタブを消さない)。
  const previewIndex = preview
    ? pane.tabs.findIndex(
        (item) => item.preview && groupOf(item.target) === group,
      )
    : -1;
  let tabs: Tab[];
  let recent = pane.recent;
  if (previewIndex >= 0) {
    const replaced = pane.tabs[previewIndex].id;
    tabs = pane.tabs.map((item, index) =>
      index === previewIndex ? tab : item,
    );
    recent = recent.filter((item) => item !== replaced);
  } else {
    const at = insertionIndex(pane, group, groupOf);
    tabs = [...pane.tabs.slice(0, at), tab, ...pane.tabs.slice(at)];
  }
  return {
    ...withPane(layout, side, selectIn({ ...pane, tabs, recent }, tab.id)),
    focused: side,
  };
}

/**
 * 新しいタブを入れる位置: 前面が同じグループならその右、別のグループなら同じ
 * グループの末尾の右、同じグループのタブが無ければ面の末尾 (グループの並びは
 * 画面側が regroup で整える)。
 */
function insertionIndex(
  pane: Pane,
  group: string | null,
  groupOf: (target: TabTarget) => string | null,
): number {
  const activeIndex = pane.tabs.findIndex((item) => item.id === pane.activeId);
  if (activeIndex >= 0 && groupOf(pane.tabs[activeIndex].target) === group)
    return activeIndex + 1;
  for (let index = pane.tabs.length - 1; index >= 0; index -= 1)
    if (groupOf(pane.tabs[index].target) === group) return index + 1;
  return pane.tabs.length;
}

/** open が同じ中身を探す面と、無ければ入れる面。 */
function openPlan(
  layout: Layout,
  target: TabTarget,
  opts: OpenOptions,
): { side: PaneSide; existing: { side: PaneSide; tab: Tab } | null } {
  const wanted = resolveSide(layout, opts.pane);
  const side = canPlace(target, wanted) ? wanted : "left";
  // 面を指定したときにその面の中だけを探すのは、左右に並べられるファイルだけ。
  // シェル・画像・画面は 1 つの場所にしか置かない (反対の面のタブを前面に出す)。
  const existing =
    opts.pane === undefined || opts.pane === "focused" || !perPaneTarget(target)
      ? findTarget(
          layout,
          target,
          layout.focused === "right" ? ["right", "left"] : sides(layout),
        )
      : findTarget(layout, target, [side]);
  return { side, existing };
}

/**
 * 同じ中身を左右の面に 1 つずつ置けるか。ファイルだけ (面ごとのソース表示)。
 * シェルは 1 つを 2 か所に映せず、画像・画面も 2 つ並べる意味が無い。
 */
function perPaneTarget(target: TabTarget): boolean {
  return target.kind === "file";
}

/** open が target を前面に出す面 (同じ中身があればその面、無ければ入れる面)。 */
export function openSide(
  layout: Layout,
  target: TabTarget,
  opts: OpenOptions = {},
): PaneSide {
  const plan = openPlan(layout, target, opts);
  return plan.existing?.side ?? plan.side;
}

function newTab(layout: Layout, target: TabTarget, opts: OpenOptions): Tab {
  const preview =
    target.kind === "page" || target.kind === "terminal"
      ? false
      : opts.preview !== false;
  return { id: nextId(layout, opts.newId), target, preview };
}

/**
 * 右の面に開く (Alt+クリックの反対の面)。2 面なら右の面の中で open と同じ。
 * 1 面なら新しいタブだけの右の面を作る (左に同じファイルがあっても動かさない:
 * 左右に同じファイルを並べられる)。ファイル以外は全体で 1 つ (perPaneTarget)
 * なので、左にあればそれを前面に出す。右に置けない種類 (page) は左の面で open。
 */
export function openRight(
  layout: Layout,
  target: TabTarget,
  opts: Omit<OpenOptions, "pane"> = {},
): Layout {
  if (!canPlace(target, "right"))
    return open(layout, target, { ...opts, pane: "left" });
  if (layout.panes.right)
    return open(layout, target, { ...opts, pane: "right" });
  if (!perPaneTarget(target) && findTarget(layout, target))
    return open(layout, target, opts);
  const tab = newTab(layout, target, opts);
  return {
    panes: {
      left: layout.panes.left,
      right: selectIn(emptyPaneWith(tab), tab.id),
    },
    focused: "right",
    split: DEFAULT_SPLIT,
  };
}

/** 窓が狭くて 2 面を出せない間、預かっておく右の面と比。 */
export type ParkedRight = { pane: Pane; split: number };

/**
 * 右の面を預かりに外して 1 面にする (窓が 2 面を出せる幅より狭いとき)。
 * 右の面が無ければ何もしない (parked は null)。フォーカスは左へ。
 */
export function parkRight(layout: Layout): {
  layout: Layout;
  parked: ParkedRight | null;
} {
  const right = layout.panes.right;
  if (!right) return { layout, parked: null };
  return {
    layout: { panes: { left: layout.panes.left }, focused: "left" },
    parked: { pane: right, split: layout.split ?? DEFAULT_SPLIT },
  };
}

/**
 * 預かった右の面を戻す (窓が広がった・保存するとき)。預かっている間に左で
 * 開いたものと重なるタブは落とす: 同じ id、ファイル以外の同じ中身 (全体で 1 つ。
 * perPaneTarget)、右に置けない種類。残りが無ければ 1 面のまま。
 */
export function unparkRight(layout: Layout, parked: ParkedRight): Layout {
  if (layout.panes.right) return layout;
  const left = layout.panes.left;
  const tabs = parked.pane.tabs.filter(
    (tab) =>
      canPlace(tab.target, "right") &&
      !left.tabs.some(
        (item) =>
          item.id === tab.id ||
          (!perPaneTarget(tab.target) && sameTarget(item.target, tab.target)),
      ),
  );
  if (tabs.length === 0) return layout;
  const kept = new Set(tabs.map((tab) => tab.id));
  const activeId =
    parked.pane.activeId && kept.has(parked.pane.activeId)
      ? parked.pane.activeId
      : tabs[0].id;
  return {
    panes: {
      left,
      right: {
        tabs,
        activeId,
        recent: parked.pane.recent.filter((id) => kept.has(id)),
      },
    },
    focused: layout.focused,
    split: parked.split,
  };
}

/**
 * 預かった右の面のタブを左の面の末尾へ移して前面に出す (電話の段のタブの
 * 一覧。電話では右の面を出さないので、預けたタブにはここからしか届かない)。
 * 左に同じ中身のタブがあれば、それを前面に出して預けた側からは落とす。
 * 預けた面が空になれば parked は null。
 */
export function takeParked(
  layout: Layout,
  parked: ParkedRight,
  id: string,
): { layout: Layout; parked: ParkedRight | null } {
  const tab = parked.pane.tabs.find((item) => item.id === id);
  if (!tab)
    throw new Error(`main tabs: parked tab ${JSON.stringify(id)} is missing`);
  const rest = closeParked(parked, id);
  const left = layout.panes.left;
  const existing = left.tabs.find((item) =>
    sameTarget(item.target, tab.target),
  );
  const pane = existing
    ? selectIn(left, existing.id)
    : selectIn({ ...left, tabs: [...left.tabs, tab] }, tab.id);
  return {
    layout: { ...withPane(layout, "left", pane), focused: "left" },
    parked: rest,
  };
}

/** 預かった右の面からタブを 1 つ閉じる。空になれば null。 */
export function closeParked(
  parked: ParkedRight,
  id: string,
): ParkedRight | null {
  const pane = removeFromPane(parked.pane, new Set([id]));
  return pane.tabs.length > 0 ? { ...parked, pane } : null;
}

export function keepOpen(layout: Layout, id: string): Layout {
  const found = findTab(layout, id);
  if (!found?.tab.preview) return layout;
  const pane = paneOf(layout, found.side) as Pane;
  return withPane(layout, found.side, {
    ...pane,
    tabs: pane.tabs.map((tab) =>
      tab.id === id ? { ...tab, preview: false } : tab,
    ),
  });
}

export function activate(layout: Layout, id: string): Layout {
  const found = findTab(layout, id);
  if (!found) return layout;
  const pane = paneOf(layout, found.side) as Pane;
  return {
    ...withPane(layout, found.side, selectIn(pane, id)),
    focused: found.side,
  };
}

/**
 * 左の面の選択を外して本文の既定 (フォルダ表示) を出す。タブは閉じない。
 * フォーカスは左の面へ。
 */
export function showHome(layout: Layout): Layout {
  return {
    ...withPane(layout, "left", selectIn(layout.panes.left, null)),
    focused: "left",
  };
}

export function focusPane(layout: Layout, side: PaneSide): Layout {
  if (!paneOf(layout, side)) return layout;
  return { ...layout, focused: side };
}

/** 面からタブを取り除く。選択中なら直前に選んだタブ → 右隣 → 左隣。 */
function removeFromPane(pane: Pane, ids: ReadonlySet<string>): Pane {
  const tabs = pane.tabs.filter((tab) => !ids.has(tab.id));
  const recent = pane.recent.filter((id) => !ids.has(id));
  if (!pane.activeId || !ids.has(pane.activeId))
    return { tabs, activeId: pane.activeId, recent };
  const fromHistory = [...recent]
    .reverse()
    .find((id) => tabs.some((tab) => tab.id === id));
  if (fromHistory)
    return selectIn({ tabs, activeId: null, recent }, fromHistory);
  const index = pane.tabs.findIndex((tab) => tab.id === pane.activeId);
  const right = pane.tabs.slice(index + 1).find((tab) => !ids.has(tab.id));
  const left = [...pane.tabs.slice(0, index)]
    .reverse()
    .find((tab) => !ids.has(tab.id));
  const next = right ?? left ?? null;
  return selectIn({ tabs, activeId: null, recent }, next?.id ?? null);
}

/**
 * 右の面が空になったら 1 面に戻す。左の面は空でもよい (本文の既定を出す)
 * ので、右の面のタブを左へ寄せたりしない。
 */
function collapseEmpty(layout: Layout): Layout {
  const right = layout.panes.right;
  if (!right || right.tabs.length > 0) return layout;
  return { panes: { left: layout.panes.left }, focused: "left" };
}

function removeIds(layout: Layout, side: PaneSide, ids: Set<string>): Layout {
  if (ids.size === 0) return layout;
  const pane = paneOf(layout, side) as Pane;
  return collapseEmpty(withPane(layout, side, removeFromPane(pane, ids)));
}

export function close(layout: Layout, id: string): Layout {
  const found = findTab(layout, id);
  if (!found) return layout;
  return removeIds(layout, found.side, new Set([id]));
}

export function closeOthers(layout: Layout, id: string): Layout {
  const found = findTab(layout, id);
  if (!found) return layout;
  const pane = paneOf(layout, found.side) as Pane;
  const ids = new Set(pane.tabs.filter((t) => t.id !== id).map((t) => t.id));
  return activate(removeIds(layout, found.side, ids), id);
}

export function closeToRight(layout: Layout, id: string): Layout {
  const found = findTab(layout, id);
  if (!found) return layout;
  const pane = paneOf(layout, found.side) as Pane;
  const ids = new Set(pane.tabs.slice(found.index + 1).map((t) => t.id));
  return removeIds(layout, found.side, ids);
}

/**
 * 並べ替え (同じ面) と、反対の面への移動。移動先に同じ中身のタブがあれば
 * 動かさず、理由を返す。
 *
 * `index` は整数だけを受ける。NaN や undefined を通すと Math.min / slice が
 * 黙って先頭へ入れてしまい、呼び出し側は「意図した場所へ動いた」と区別
 * できない。端の外は今までどおり端へ寄せる。
 */
export function move(
  layout: Layout,
  id: string,
  side: PaneSide,
  index: number,
): MoveResult {
  if (!Number.isInteger(index))
    return { layout, moved: false, reason: "invalid-index" };
  const found = findTab(layout, id);
  if (!found) return { layout, moved: false, reason: "unknown-tab" };
  const dest = paneOf(layout, side);
  if (!dest) return { layout, moved: false, reason: "no-such-pane" };
  if (!canPlace(found.tab.target, side))
    return { layout, moved: false, reason: "not-placeable" };
  if (found.side === side) {
    const rest = dest.tabs.filter((tab) => tab.id !== id);
    const at = Math.max(0, Math.min(index, rest.length));
    const tabs = [...rest.slice(0, at), found.tab, ...rest.slice(at)];
    return { layout: withPane(layout, side, { ...dest, tabs }), moved: true };
  }
  if (dest.tabs.some((tab) => sameTarget(tab.target, found.tab.target)))
    return { layout, moved: false, reason: "duplicate-target" };
  const source = paneOf(layout, found.side) as Pane;
  const without = withPane(
    layout,
    found.side,
    removeFromPane(source, new Set([id])),
  );
  // 移した先で (同じプロジェクトの) 仮のタブが 2 つにならないよう、先の仮のタブは固定にする。
  const movingProject = targetProject(found.tab.target);
  const destTabs = dest.tabs.map((tab) =>
    found.tab.preview &&
    tab.preview &&
    targetProject(tab.target) === movingProject
      ? { ...tab, preview: false }
      : tab,
  );
  const at = Math.max(0, Math.min(index, destTabs.length));
  const tabs = [...destTabs.slice(0, at), found.tab, ...destTabs.slice(at)];
  const moved = withPane(without, side, selectIn({ ...dest, tabs }, id));
  return { layout: collapseEmpty({ ...moved, focused: side }), moved: true };
}

// ---- 閉じたタブの履歴 (最後に閉じたタブを開き直す) ----
//
// 面ごとでなく全体で 1 本、新しい順に CLOSED_HISTORY_LIMIT 件まで。保存しない
// (ページを開いている間だけ)。どの閉じ方を積むかは画面側が決める (利用者が
// 閉じたときだけ。シェルが消えて閉じたタブなどは積まない)。

export const CLOSED_HISTORY_LIMIT = 10;

/** 閉じたタブ。index は閉じる前のその面の中の位置 (0 始まり)。 */
export type ClosedTab = { target: TabTarget; side: PaneSide; index: number };

/** before にあって after に無いタブ (閉じたタブ)。面ごとに並びの順。 */
export function closedTabs(before: Layout, after: Layout): ClosedTab[] {
  const out: ClosedTab[] = [];
  for (const side of sides(before))
    (paneOf(before, side) as Pane).tabs.forEach((tab, index) => {
      if (!findTab(after, tab.id))
        out.push({ target: tab.target, side, index });
    });
  return out;
}

/**
 * 閉じたタブを履歴の先頭に積む (closed の後ろほど新しい扱い)。同じ中身の
 * 古い項は落とし、CLOSED_HISTORY_LIMIT 件で切る。
 */
export function pushClosed(
  history: readonly ClosedTab[],
  closed: readonly ClosedTab[],
): ClosedTab[] {
  let next = [...history];
  for (const item of closed)
    next = [
      item,
      ...next.filter((old) => !sameTarget(old.target, item.target)),
    ];
  return next.slice(0, CLOSED_HISTORY_LIMIT);
}

/**
 * いちばん新しく閉じたタブを固定のタブで開き直し、前面に出す。閉じた面の
 * 元の位置に入れ、その位置がもう無ければ (タブが減った) 面の末尾。閉じた面が
 * もう無ければ (1 面に戻った) 左の面の末尾。今開いているものは飛ばして
 * 履歴から落とす。開き直せるものが無ければ layout はそのまま、reopened は null。
 */
export function reopenClosed(
  layout: Layout,
  history: readonly ClosedTab[],
  opts: Pick<OpenOptions, "newId"> = {},
): { layout: Layout; history: ClosedTab[]; reopened: ClosedTab | null } {
  const rest = [...history];
  while (rest.length > 0) {
    const item = rest.shift() as ClosedTab;
    const isOpen = perPaneTarget(item.target)
      ? paneOf(layout, item.side)?.tabs.some((tab) =>
          sameTarget(tab.target, item.target),
        )
      : findTarget(layout, item.target) !== null;
    if (isOpen) continue;
    const side = paneOf(layout, item.side) ? item.side : "left";
    const opened = open(layout, item.target, {
      ...opts,
      pane: side,
      preview: false,
    });
    const tab = activeTab(opened) as Tab;
    const at = findTab(opened, tab.id) as { side: PaneSide };
    const count = (paneOf(opened, at.side) as Pane).tabs.length;
    const index =
      at.side === item.side && item.index < count ? item.index : count - 1;
    const placed = move(opened, tab.id, at.side, index);
    if (placed.moved === false)
      throw new Error(
        `main tabs: the reopened tab ${tab.id} could not be placed: ${placed.reason}`,
      );
    return { layout: placed.layout, history: rest, reopened: item };
  }
  return { layout, history: rest, reopened: null };
}

export function canSplit(layout: Layout): boolean {
  return !layout.panes.right;
}

/**
 * タブ列の分割のボタンで左の前面を右へ出せない理由 (出せるなら null)。
 * 窓の幅はここでは見ない (描画側が足す)。
 */
type SplitBlocker = "split" | "no-front" | "page";

export function splitBlocker(layout: Layout): SplitBlocker | null {
  if (!canSplit(layout)) return "split";
  const pane = layout.panes.left;
  const front = pane.tabs.find((tab) => tab.id === pane.activeId);
  if (!front) return "no-front";
  return canPlace(front.target, "right") ? null : "page";
}

export function canMoveToOtherSide(layout: Layout): boolean {
  return !!layout.panes.right;
}

/**
 * そのタブを右の面へ出して 2 面にする。右に置ける種類 (canPlace) だけ。
 * 左の面が空になっても本文の既定が出るので、タブが 1 つでも分けられる。
 */
export function splitRight(layout: Layout, id: string): Layout {
  const found = findTab(layout, id);
  if (!found || !canSplit(layout) || !canPlace(found.tab.target, "right"))
    return layout;
  const left = removeFromPane(layout.panes.left, new Set([id]));
  return {
    panes: { left, right: selectIn(emptyPaneWith(found.tab), id) },
    focused: "right",
    split: DEFAULT_SPLIT,
  };
}

function emptyPaneWith(tab: Tab): Pane {
  return { tabs: [tab], activeId: null, recent: [] };
}

export function moveToOtherSide(layout: Layout, id: string): Layout {
  const found = findTab(layout, id);
  if (!found || !canMoveToOtherSide(layout)) return layout;
  const other: PaneSide = found.side === "left" ? "right" : "left";
  const dest = paneOf(layout, other) as Pane;
  return move(layout, id, other, dest.tabs.length).layout;
}

/**
 * 1 面に戻す。右の面のタブを順に左の面の末尾へ移し、左に同じファイルがある
 * ものは右を閉じる (ファイル以外の同じ中身は元から左右に 1 つ)。フォーカスと
 * 前面は左の前面のまま。左に仮のタブがあれば、右から来た仮のタブは固定にする。
 */
export function unsplit(layout: Layout): Layout {
  const right = layout.panes.right;
  if (!right) return layout;
  const left = layout.panes.left;
  const previewProjects = new Set(
    left.tabs
      .filter((tab) => tab.preview)
      .map((tab) => targetProject(tab.target)),
  );
  const moved = right.tabs
    .filter((tab) => !left.tabs.some((t) => sameTarget(t.target, tab.target)))
    .map((tab) =>
      tab.preview && previewProjects.has(targetProject(tab.target))
        ? { ...tab, preview: false }
        : tab,
    );
  return {
    panes: { left: { ...left, tabs: [...left.tabs, ...moved] } },
    focused: "left",
  };
}

function stepTab(layout: Layout, delta: number): Layout {
  const pane = paneOf(layout, layout.focused) as Pane;
  if (pane.tabs.length === 0) return layout;
  const index = pane.tabs.findIndex((tab) => tab.id === pane.activeId);
  const next =
    (((index < 0 ? 0 : index + delta) % pane.tabs.length) + pane.tabs.length) %
    pane.tabs.length;
  return activate(layout, pane.tabs[next].id);
}

export function nextTab(layout: Layout): Layout {
  return stepTab(layout, 1);
}

export function prevTab(layout: Layout): Layout {
  return stepTab(layout, -1);
}

/** フォーカスのある面の n 番目 (1 始まり)。無ければ何もしない。 */
export function activateIndex(layout: Layout, n: number): Layout {
  const pane = paneOf(layout, layout.focused) as Pane;
  const tab = pane.tabs[n - 1];
  return tab ? activate(layout, tab.id) : layout;
}

/**
 * keyOf を渡すと、左へ・右へ はグループの中だけ (グループをまたいで動かせない:
 * 持ち物が違う)。
 */
export function tabMenu(
  layout: Layout,
  id: string,
  keyOf?: (tab: Tab) => string | null,
): TabMenuState {
  const found = findTab(layout, id);
  if (!found)
    return {
      close: false,
      closeOthers: false,
      closeToRight: false,
      keepOpen: false,
      splitRight: false,
      moveToOtherSide: false,
      moveLeft: false,
      moveRight: false,
      copyPath: false,
    };
  const pane = paneOf(layout, found.side) as Pane;
  const other: PaneSide = found.side === "left" ? "right" : "left";
  return {
    close: true,
    closeOthers: pane.tabs.length > 1,
    closeToRight: found.index < pane.tabs.length - 1,
    keepOpen: found.tab.preview,
    splitRight: canSplit(layout) && canPlace(found.tab.target, "right"),
    moveToOtherSide:
      canMoveToOtherSide(layout) && canPlace(found.tab.target, other),
    moveLeft:
      found.index > 0 &&
      (!keyOf || keyOf(pane.tabs[found.index - 1]) === keyOf(found.tab)),
    moveRight:
      found.index < pane.tabs.length - 1 &&
      (!keyOf || keyOf(pane.tabs[found.index + 1]) === keyOf(found.tab)),
    copyPath:
      found.tab.target.kind === "file" || found.tab.target.kind === "image",
  };
}

// ---- グループ (プロジェクトごと) ----
//
// タブ列はプロジェクトごとのグループに分けて並べる。モデルの並びもグループの順に
// 保つ (regroup) ので、キー・右クリック・ドラッグの位置はそのまま並びの位置になる。
// グループの鍵 (keyOf) は画面が決める: ファイルなどは target の project、シェルは
// 動いているフォルダのプロジェクト。null はどのプロジェクトのものでもない。

export type TabGroup = { key: string | null; tabs: Tab[] };

/**
 * 面ごとに、タブをグループの順 (rankOf の小さい順。同じなら今の並び) に並べ直す。
 * 中のタブの順は変えない。変わらなければ同じ layout を返す。
 */
export function regroup(layout: Layout, rankOf: (tab: Tab) => number): Layout {
  let next = layout;
  for (const side of sides(layout)) {
    const pane = paneOf(next, side) as Pane;
    const ranked = pane.tabs.map((tab, index) => ({
      tab,
      index,
      rank: rankOf(tab),
    }));
    ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
    if (ranked.every((item, index) => item.index === index)) continue;
    next = withPane(next, side, {
      ...pane,
      tabs: ranked.map((item) => item.tab),
    });
  }
  return next;
}

/** 並び (regroup した後) を、続いている同じ鍵のタブのまとまりに分ける。 */
export function tabGroups(
  tabs: readonly Tab[],
  keyOf: (tab: Tab) => string | null,
): TabGroup[] {
  const groups: TabGroup[] = [];
  for (const tab of tabs) {
    const key = keyOf(tab);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.tabs.push(tab);
    else groups.push({ key, tabs: [tab] });
  }
  return groups;
}

/** 面の前面のタブを、そのグループの「最後に前面だったタブ」として覚える。 */
export function noteGroupFronts(
  layout: Layout,
  keyOf: (tab: Tab) => string | null,
): Layout {
  let fronts = layout.groupFronts;
  for (const side of sides(layout)) {
    const tab = frontTab(layout, side);
    const key = tab ? keyOf(tab) : null;
    if (!tab || key === null || fronts?.[key] === tab.id) continue;
    fronts = { ...fronts, [key]: tab.id };
  }
  return fronts === layout.groupFronts
    ? layout
    : { ...layout, groupFronts: fronts };
}

/** そのグループで最後に前面だったタブ (もう無ければ、そのグループの先頭のタブ)。 */
export function groupFront(
  layout: Layout,
  key: string,
  keyOf: (tab: Tab) => string | null,
): Tab | null {
  const id = layout.groupFronts?.[key];
  const remembered = id ? findTab(layout, id)?.tab : undefined;
  if (remembered && keyOf(remembered) === key) return remembered;
  return allTabs(layout).find((tab) => keyOf(tab) === key) ?? null;
}

/** グループを畳む・開く。 */
export function setCollapsed(
  layout: Layout,
  key: string,
  collapsed: boolean,
): Layout {
  const now = layout.collapsed ?? [];
  if (now.includes(key) === collapsed) return layout;
  const next = collapsed ? [...now, key] : now.filter((item) => item !== key);
  if (next.length > 0) return { ...layout, collapsed: next };
  const { collapsed: _dropped, ...rest } = layout;
  return rest;
}

/** そのグループのタブを全部閉じる (グループの ▾ の「このグループを閉じる」)。 */
export function closeGroup(
  layout: Layout,
  key: string,
  keyOf: (tab: Tab) => string | null,
): Layout {
  let next = layout;
  for (const side of sides(layout)) {
    const pane = paneOf(next, side);
    if (!pane) continue;
    const ids = new Set(
      pane.tabs.filter((tab) => keyOf(tab) === key).map((tab) => tab.id),
    );
    next = removeIds(next, side, ids);
  }
  return setCollapsed(next, key, false);
}

// ---- 保存 ----

/**
 * タブが覚えている route のうち、保存して読み戻すもの。Search の検索語と
 * Tools の道具は URL からも target からも作り直せないので、これだけ載せる
 * (別のタブを前面にしてリロードすると Search が空で戻っていた)。ファイルの
 * タブは Preview を見ていたか (preview。前面でないタブがリロードで Code に
 * 戻っていた)。
 *
 * 省略できる欄なので `LAYOUT_VERSION` は上げない。これを持たない古い保存値は
 * 今までどおり読め、この欄を知らない古いアプリはこの欄を見ないだけで済む
 * (版を上げると、古いアプリが配置ごと「版が違う」と断ってしまう)。
 */
export type SerializedPageRoute = {
  q?: string;
  tool?: string;
  preview?: true;
};

export type SerializedLayout = {
  version: typeof LAYOUT_VERSION;
  focused: PaneSide;
  /** 2 面のときだけ。左の面の幅の比。 */
  split?: number;
  /** グループ (プロジェクトの根) ごとの、最後に前面だったタブの id。 */
  groupFronts?: Record<string, string>;
  /** 畳んだグループ (プロジェクトの根)。 */
  collapsed?: string[];
  /** シェルのタブのグループの控え (シェルの id → プロジェクトの根)。 */
  terminalGroups?: Record<string, string>;
  panes: Array<{
    side: PaneSide;
    activeId: string | null;
    tabs: Array<{
      id: string;
      preview: boolean;
      target: TabTarget;
      route?: SerializedPageRoute;
    }>;
  }>;
};

/**
 * `pageRoute` は page とファイルのタブが今見せている route を返す (画面側が
 * 持っている)。渡さなければ route を書かない。
 */
export function serializeLayout(
  layout: Layout,
  pageRoute?: (tab: Tab) => SerializedPageRoute | undefined,
): SerializedLayout {
  return {
    version: LAYOUT_VERSION,
    focused: layout.focused,
    // 比を持っている 2 面だけ書く (持っていない配置に既定の値を作って書かない)。
    ...(layout.panes.right && layout.split !== undefined
      ? { split: layout.split }
      : {}),
    ...(layout.groupFronts && Object.keys(layout.groupFronts).length > 0
      ? { groupFronts: { ...layout.groupFronts } }
      : {}),
    ...(layout.collapsed && layout.collapsed.length > 0
      ? { collapsed: [...layout.collapsed] }
      : {}),
    ...(layout.terminalGroups && Object.keys(layout.terminalGroups).length > 0
      ? { terminalGroups: { ...layout.terminalGroups } }
      : {}),
    panes: sides(layout).map((side) => {
      const pane = paneOf(layout, side) as Pane;
      return {
        side,
        activeId: pane.activeId,
        tabs: pane.tabs.map((tab) => {
          const route =
            tab.target.kind === "page" || tab.target.kind === "file"
              ? pageRoute?.(tab)
              : undefined;
          return {
            id: tab.id,
            preview: tab.preview,
            target: tab.target,
            ...(route ? { route } : {}),
          };
        }),
      };
    }),
  };
}

type ParsedLayout = {
  layout: Layout;
  /** 種類が分からず落としたタブ (場所と元の値)。 */
  dropped: Array<{ at: string; raw: unknown }>;
  /** 廃止した種類 (repo の page = Files) なので落としたタブ (場所と元の値)。 */
  retired: Array<{ at: string; raw: unknown }>;
  /** 右の面に置けない種類 (page) だったので左の面へ移したタブ。 */
  relocated: Array<{ at: string; id: string }>;
  /** タブの id ごとの、保存してあった page の route (Search の語・Tools の道具)。 */
  pageRoutes: Record<string, SerializedPageRoute>;
  /** もう無いタブを指していたので落としたグループの前面。 */
  staleGroupFronts: Array<{ group: string; id: string }>;
};

/** 読める版。1 は repo の page タブと、右の面の page のタブを持ちうる。 */
const READABLE_VERSIONS: readonly unknown[] = [1, 2, 3, 4, LAYOUT_VERSION];

/**
 * このアプリより新しい版で保存された配置か (古い版のアプリへ戻したとき)。
 * 読めないので使わず、上書きもしない (新しい版へ戻れば元の配置が残る)。
 */
export function isNewerLayoutVersion(raw: unknown): boolean {
  return (
    isRecord(raw) &&
    typeof raw.version === "number" &&
    raw.version > LAYOUT_VERSION
  );
}

function isRetiredTarget(raw: unknown): boolean {
  return isRecord(raw) && raw.kind === "page" && raw.page === "repo";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseLine(raw: unknown): SourceLineTarget | undefined | "bad" {
  if (raw === undefined) return undefined;
  if (typeof raw === "number")
    return Number.isInteger(raw) && raw > 0 ? raw : "bad";
  if (
    isRecord(raw) &&
    Number.isInteger(raw.start) &&
    Number.isInteger(raw.end) &&
    (raw.start as number) > 0 &&
    (raw.end as number) >= (raw.start as number)
  )
    return { start: raw.start as number, end: raw.end as number };
  return "bad";
}

const KNOWN_KINDS = new Set(["file", "terminal", "image", "page"]);

/** page の route を読む。無ければ undefined、壊れていれば理由の文字列。 */
function parsePageRoute(
  raw: unknown,
): SerializedPageRoute | undefined | string {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) return `route is ${JSON.stringify(raw)}`;
  const out: SerializedPageRoute = {};
  for (const key of ["q", "tool"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0)
      return `route.${key} is ${JSON.stringify(value)}`;
    out[key] = value;
  }
  if (raw.preview !== undefined) {
    if (raw.preview !== true)
      return `route.preview is ${JSON.stringify(raw.preview)}`;
    out.preview = true;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * target を読む。不明な種類は null (落とす)、壊れていれば理由の文字列。
 * project は持ち物になりうる種類だけが、絶対パスで持てる。
 */
function parseTarget(raw: unknown): TabTarget | null | string {
  const target = parseTargetBody(raw);
  if (target === null || typeof target === "string") return target;
  const project = (raw as Record<string, unknown>).project;
  if (project === undefined) return target;
  if (typeof project !== "string" || !project.startsWith("/"))
    return `${target.kind} target has a bad project: ${JSON.stringify(project)}`;
  if (!isProjectKind(target))
    return `${target.kind} target cannot belong to a project: ${JSON.stringify(project)}`;
  return withProject(target, project);
}

function parseTargetBody(raw: unknown): TabTarget | null | string {
  if (!isRecord(raw)) return "target is not an object";
  if (typeof raw.kind !== "string" || !KNOWN_KINDS.has(raw.kind)) return null;
  const nonEmpty = (value: unknown) =>
    typeof value === "string" && value.length > 0;
  switch (raw.kind) {
    case "file": {
      if (!nonEmpty(raw.path)) return "file target has no path";
      const line = parseLine(raw.line);
      if (line === "bad")
        return `file target has a bad line: ${JSON.stringify(raw.line)}`;
      if (
        raw.ref !== undefined &&
        (!nonEmpty(raw.ref) || raw.ref === WORKTREE_REF)
      )
        return `file target has a bad ref: ${JSON.stringify(raw.ref)}`;
      return {
        kind: "file",
        path: raw.path as string,
        ...(line === undefined ? {} : { line }),
        ...(raw.ref === undefined ? {} : { ref: raw.ref as string }),
      };
    }
    case "image":
      return nonEmpty(raw.path)
        ? { kind: "image", path: raw.path as string }
        : "image target has no path";
    case "terminal":
      return nonEmpty(raw.session)
        ? { kind: "terminal", session: raw.session as string }
        : "terminal target has no session";
    default:
      return (PAGE_KINDS as readonly unknown[]).includes(raw.page)
        ? { kind: "page", page: raw.page as PageKind }
        : null;
  }
}

/**
 * 保存した値を読む。壊れていれば、見つけた理由を全部 (どの面のどのタブの
 * 何か) 並べた Error を投げる。種類の分からないタブは落とし、dropped に返す。
 * options.project は 4 までの (プロジェクトごとの) 配置を読むときの、その配置の
 * プロジェクトの根: 持ち物になりうるタブに付ける。
 */
export function parseLayout(
  raw: unknown,
  options: { project?: string } = {},
): ParsedLayout {
  const problems: string[] = [];
  const dropped: ParsedLayout["dropped"] = [];
  const retired: ParsedLayout["retired"] = [];
  const pageRoutes: ParsedLayout["pageRoutes"] = {};
  if (!isRecord(raw)) throw new Error("main tab layout: not an object");
  if (!READABLE_VERSIONS.includes(raw.version))
    problems.push(
      `version is ${JSON.stringify(raw.version)}, expected one of ${READABLE_VERSIONS.join(", ")}`,
    );
  if (
    raw.split !== undefined &&
    !(typeof raw.split === "number" && raw.split > 0 && raw.split < 1)
  )
    problems.push(`split is ${JSON.stringify(raw.split)} (0 < split < 1)`);
  if (raw.focused !== "left" && raw.focused !== "right")
    problems.push(`focused is ${JSON.stringify(raw.focused)}`);
  const panesRaw = Array.isArray(raw.panes) ? raw.panes : null;
  if (!panesRaw) problems.push("panes is not an array");
  else if (panesRaw.length < 1 || panesRaw.length > 2)
    problems.push(`panes has ${panesRaw.length} entries (1 or 2 allowed)`);
  const panes: Partial<Record<PaneSide, Pane>> = {};
  const seenIds = new Map<string, string>();
  // 左右に同じものを置けるのはファイルだけ (perPaneTarget)。シェル・画像・
  // page は左右を通して 1 つ (版 1 の右の page は左へ移すので、重なると壊れた
  // 配置として報告する)。
  const seenEverywhere: Array<{ target: TabTarget; at: string }> = [];
  (panesRaw ?? []).slice(0, 2).forEach((paneRaw, paneIndex) => {
    const seenTargets: Array<{ target: TabTarget; at: string }> = [];
    const where = `panes[${paneIndex}]`;
    if (!isRecord(paneRaw)) {
      problems.push(`${where} is not an object`);
      return;
    }
    const side = paneRaw.side;
    if (side !== "left" && side !== "right") {
      problems.push(`${where}.side is ${JSON.stringify(side)}`);
      return;
    }
    if (panes[side]) problems.push(`${where}: side "${side}" appears twice`);
    const tabsRaw = Array.isArray(paneRaw.tabs) ? paneRaw.tabs : null;
    if (!tabsRaw) problems.push(`${where}.tabs is not an array`);
    const tabs: Tab[] = [];
    (tabsRaw ?? []).forEach((tabRaw, tabIndex) => {
      const at = `${where}.tabs[${tabIndex}]`;
      if (!isRecord(tabRaw)) {
        problems.push(`${at} is not an object`);
        return;
      }
      if (isRetiredTarget(tabRaw.target)) {
        retired.push({ at, raw: tabRaw });
        return;
      }
      const read = parseTarget(tabRaw.target);
      if (read === null) {
        dropped.push({ at, raw: tabRaw });
        return;
      }
      const target =
        typeof read !== "string" &&
        options.project !== undefined &&
        raw.version !== LAYOUT_VERSION
          ? withProject(read, options.project)
          : read;
      if (typeof target === "string") {
        problems.push(`${at}: ${target}`);
        return;
      }
      if (typeof tabRaw.id !== "string" || tabRaw.id.length === 0) {
        problems.push(`${at}.id is ${JSON.stringify(tabRaw.id)}`);
        return;
      }
      if (typeof tabRaw.preview !== "boolean")
        problems.push(`${at}.preview is ${JSON.stringify(tabRaw.preview)}`);
      const dupId = seenIds.get(tabRaw.id);
      if (dupId)
        problems.push(`${at}: id "${tabRaw.id}" is also used at ${dupId}`);
      seenIds.set(tabRaw.id, at);
      const seen = perPaneTarget(target) ? seenTargets : seenEverywhere;
      const dupTarget = seen.find((item) => sameTarget(item.target, target));
      if (dupTarget)
        problems.push(
          `${at}: ${target.kind} ${JSON.stringify(target)} is also open at ${dupTarget.at}`,
        );
      seen.push({ target, at });
      const pageRoute = parsePageRoute(tabRaw.route);
      if (typeof pageRoute === "string") problems.push(`${at}.${pageRoute}`);
      else if (pageRoute) pageRoutes[tabRaw.id] = pageRoute;
      tabs.push({ id: tabRaw.id, target, preview: tabRaw.preview === true });
    });
    for (const previews of previewsByProject(tabs))
      if (previews.length > 1)
        problems.push(
          `${where} has ${previews.length} preview tabs (${previews.map((t) => t.id).join(", ")}); at most 1${previewProjectNote(previews[0])}`,
        );
    let activeId: string | null = null;
    const removed = (list: Array<{ raw: unknown }>) =>
      list.some(
        (item) => isRecord(item.raw) && item.raw.id === paneRaw.activeId,
      );
    if (paneRaw.activeId === null) {
      // 左の面は選ばなくてよい (本文の既定)。右の面は必ず選んでいる。
      if (side === "right" && tabs.length > 0)
        problems.push(`${where}.activeId is null but the pane has tabs`);
    } else if (typeof paneRaw.activeId !== "string") {
      problems.push(`${where}.activeId is ${JSON.stringify(paneRaw.activeId)}`);
    } else if (tabs.some((tab) => tab.id === paneRaw.activeId)) {
      activeId = paneRaw.activeId;
    } else if (removed(retired)) {
      // Files のタブを選んでいた: 左なら本文の既定 (同じもの)、右なら先頭。
      activeId = side === "left" ? null : (tabs[0]?.id ?? null);
    } else if (removed(dropped)) {
      // 選んでいたタブを落とした: 残りの先頭を選ぶ。
      activeId = tabs[0]?.id ?? null;
    } else {
      problems.push(
        `${where}.activeId "${paneRaw.activeId}" is not a tab of the pane`,
      );
    }
    panes[side] = { tabs, activeId, recent: activeId ? [activeId] : [] };
  });
  if (panesRaw && !panes.left && problems.length === 0)
    problems.push("no left pane");
  if (problems.length > 0)
    throw new Error(
      `main tab layout is broken (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n- ${problems.join("\n- ")}`,
    );
  // 右の面の page のタブ (版 1) は、左の面の末尾へ移す。右の面で選んでいて
  // フォーカスも右にあった (見ていた) なら、左の面で選んでフォーカスも左へ。
  const relocated: ParsedLayout["relocated"] = [];
  let left = panes.left as Pane;
  let right = panes.right;
  let focused = raw.focused as PaneSide;
  if (right) {
    const moving = right.tabs.filter((tab) => !canPlace(tab.target, "right"));
    if (moving.length > 0) {
      const ids = new Set(moving.map((tab) => tab.id));
      for (const tab of moving)
        relocated.push({
          at: `right pane tab ${JSON.stringify(tab.id)}`,
          id: tab.id,
        });
      const wasActive = right.activeId !== null && ids.has(right.activeId);
      left = { ...left, tabs: [...left.tabs, ...moving] };
      if (wasActive && focused === "right") {
        left = selectIn(left, right.activeId);
        focused = "left";
      }
      right = removeFromPane(right, ids);
    }
  }
  let layout: Layout = {
    panes: { left, ...(right ? { right } : {}) },
    focused,
    ...(right
      ? { split: typeof raw.split === "number" ? raw.split : DEFAULT_SPLIT }
      : {}),
  };
  layout = collapseEmpty(layout);
  if (!paneOf(layout, layout.focused)) layout = { ...layout, focused: "left" };
  const groups = parseGroupState(raw, layout);
  return {
    layout: { ...layout, ...groups.state },
    dropped,
    retired,
    relocated,
    pageRoutes,
    staleGroupFronts: groups.stale,
  };
}

/** 仮のタブをプロジェクトごとに分ける (仮のタブは面ごと・プロジェクトごとに 1 つ)。 */
function previewsByProject(tabs: readonly Tab[]): Tab[][] {
  const out = new Map<string | null, Tab[]>();
  for (const tab of tabs) {
    if (!tab.preview) continue;
    const key = targetProject(tab.target);
    out.set(key, [...(out.get(key) ?? []), tab]);
  }
  return [...out.values()];
}

function previewProjectNote(tab: Tab): string {
  const project = targetProject(tab.target);
  return project === null ? "" : ` in project ${JSON.stringify(project)}`;
}

/**
 * groupFronts と collapsed を読む。形が違えば壊れた配置として投げる。もう無い
 * タブを指すグループの前面は落とし、stale に返す (閉じた後の保存では起きない
 * が、手で直したファイルなどで起きうる)。
 */
function parseGroupState(
  raw: Record<string, unknown>,
  layout: Layout,
): {
  state: Pick<Layout, "groupFronts" | "collapsed" | "terminalGroups">;
  stale: Array<{ group: string; id: string }>;
} {
  const problems: string[] = [];
  const state: Pick<Layout, "groupFronts" | "collapsed" | "terminalGroups"> =
    {};
  const stale: Array<{ group: string; id: string }> = [];
  if (raw.groupFronts !== undefined) {
    if (!isRecord(raw.groupFronts))
      problems.push(`groupFronts is ${JSON.stringify(raw.groupFronts)}`);
    else {
      const fronts: Record<string, string> = {};
      for (const [group, id] of Object.entries(raw.groupFronts)) {
        if (typeof id !== "string" || id.length === 0) {
          problems.push(
            `groupFronts[${JSON.stringify(group)}] is ${JSON.stringify(id)}`,
          );
          continue;
        }
        if (findTab(layout, id)) fronts[group] = id;
        else stale.push({ group, id });
      }
      if (Object.keys(fronts).length > 0) state.groupFronts = fronts;
    }
  }
  if (raw.collapsed !== undefined) {
    const list = raw.collapsed;
    if (
      !Array.isArray(list) ||
      list.some((item) => typeof item !== "string" || item.length === 0)
    )
      problems.push(`collapsed is ${JSON.stringify(list)}`);
    else if (list.length > 0) state.collapsed = [...new Set(list as string[])];
  }
  if (raw.terminalGroups !== undefined) {
    if (!isRecord(raw.terminalGroups))
      problems.push(`terminalGroups is ${JSON.stringify(raw.terminalGroups)}`);
    else {
      const groups: Record<string, string> = {};
      const open = new Set(
        allTabs(layout).flatMap((tab) =>
          tab.target.kind === "terminal" ? [tab.target.session] : [],
        ),
      );
      for (const [session, root] of Object.entries(raw.terminalGroups)) {
        if (typeof root !== "string" || !root.startsWith("/"))
          problems.push(
            `terminalGroups[${JSON.stringify(session)}] is ${JSON.stringify(root)}`,
          );
        // 閉じたシェルの控えは読まない (次の保存で消える)。
        else if (open.has(session)) groups[session] = root;
      }
      if (Object.keys(groups).length > 0) state.terminalGroups = groups;
    }
  }
  if (problems.length > 0)
    throw new Error(
      `main tab layout is broken (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n- ${problems.join("\n- ")}`,
    );
  return { state, stale };
}

// ---- 前の版の共通のタブ (読むだけ) ----
//
// 前の版はタブの配置をプロジェクトごとに保存し、プロジェクトに属さないタブ
// (シェル・全体ボード・Tools・設定と案内・ターミナルに出た画像) の集まりだけを
// 別に持っていた (`main-tabs.json` の common)。今は全部が 1 つの配置なので、読むのは
// 前の版の保存を移すとき (core/main-tabs-migrate.ts) だけ。

/** 前の版の共通のタブの保存の版。 */
export const COMMON_TABS_VERSION = 1;

type ParsedCommonTabs =
  /** 保存が無い。 */
  | { kind: "none" }
  /** 新しい版の保存。読めない。 */
  | { kind: "newer"; version: number }
  | {
      kind: "ok";
      targets: TabTarget[];
      /** 種類が分からず落とした項目 (場所と元の値)。 */
      dropped: Array<{ at: string; raw: unknown }>;
    };

/**
 * 前の版の共通のタブを読む。壊れていれば理由を全部並べた Error を投げる。
 * プロジェクトの持ち物になる種類 (ファイルなど) や重なりも壊れた値として扱う。
 */
export function parseCommonTabs(raw: unknown): ParsedCommonTabs {
  if (raw === null || raw === undefined) return { kind: "none" };
  if (!isRecord(raw)) throw new Error("common tabs: not an object");
  if (typeof raw.version === "number" && raw.version > COMMON_TABS_VERSION)
    return { kind: "newer", version: raw.version };
  const problems: string[] = [];
  if (raw.version !== COMMON_TABS_VERSION)
    problems.push(
      `version is ${JSON.stringify(raw.version)}, expected ${COMMON_TABS_VERSION}`,
    );
  const list = Array.isArray(raw.targets) ? raw.targets : null;
  if (!list) problems.push("targets is not an array");
  const targets: TabTarget[] = [];
  const dropped: Array<{ at: string; raw: unknown }> = [];
  (list ?? []).forEach((item, index) => {
    const at = `targets[${index}]`;
    const target = parseTarget(item);
    if (target === null) {
      dropped.push({ at, raw: item });
      return;
    }
    if (typeof target === "string") {
      problems.push(`${at}: ${target}`);
      return;
    }
    if (isProjectKind(target)) {
      problems.push(
        `${at}: ${target.kind} ${JSON.stringify(target)} is not a common tab`,
      );
      return;
    }
    if (targets.some((seen) => sameTarget(seen, target))) {
      problems.push(`${at}: ${JSON.stringify(target)} appears twice`);
      return;
    }
    targets.push(target);
  });
  if (problems.length > 0)
    throw new Error(
      `common tabs are broken (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n- ${problems.join("\n- ")}`,
    );
  return { kind: "ok", targets, dropped };
}

/** 不変条件の検査。破れていれば理由を全部並べて投げる (テストと開発用)。 */
export function assertLayout(layout: Layout): void {
  const problems: string[] = [];
  const ids = new Set<string>();
  // ファイル以外の同じ中身は左右を通して 1 つ (perPaneTarget)。
  const everywhere: TabTarget[] = [];
  if (!paneOf(layout, layout.focused))
    problems.push(`focused pane ${layout.focused} is missing`);
  if (layout.panes.right?.tabs.length === 0)
    problems.push("right pane is empty");
  for (const side of sides(layout)) {
    const pane = paneOf(layout, side) as Pane;
    const targets: TabTarget[] = [];
    for (const tab of pane.tabs) {
      if (ids.has(tab.id)) problems.push(`duplicate id ${tab.id}`);
      ids.add(tab.id);
      const seen = perPaneTarget(tab.target) ? targets : everywhere;
      if (seen.some((t) => sameTarget(t, tab.target)))
        problems.push(
          `duplicate target ${JSON.stringify(tab.target)} in ${side}`,
        );
      seen.push(tab.target);
    }
    for (const previews of previewsByProject(pane.tabs))
      if (previews.length > 1)
        problems.push(
          `${side} has more than one preview tab${previewProjectNote(previews[0])}`,
        );
    if (
      pane.activeId === null
        ? side === "right" && pane.tabs.length > 0
        : !pane.tabs.some((t) => t.id === pane.activeId)
    )
      problems.push(`${side}.activeId ${pane.activeId} is not in the pane`);
    for (const tab of pane.tabs)
      if (!canPlace(tab.target, side))
        problems.push(`${side} holds ${tab.target.kind} tab ${tab.id}`);
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
}
