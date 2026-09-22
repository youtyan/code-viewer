// メインの面のタブの配置 (純ロジック)。DOM・fetch・i18n に依存しない。
//
// 面は 1 つか 2 つ (left / right)。各面はタブの並びと選択中のタブを持ち、
// フォーカスのある面が 1 つある。操作はどれも新しい状態を返す純関数で、
// 渡された状態を書き換えない。
//
// 不変条件 (assertLayout が検査する):
// - タブの id は全体で一意
// - activeId は面の中に存在する (空の面は null)
// - 仮のタブ (preview) は面ごとに最大 1
// - 同じ中身 (sameTarget) のタブは全体で最大 1 (page はその特別な場合)
//
// 表示名は画面側 (i18n) が作る。ここは同一判定だけを持つ。

import type { SourceLineTarget } from "./routes";

/** page の種類。AppRoute の screen のうち、タブとして開く画面。 */
export const PAGE_KINDS = [
  "repo",
  "diff",
  "history",
  "worktree",
  "database",
  "journal",
  "agents",
  "help",
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];

export type TabTarget =
  | { kind: "file"; path: string; line?: SourceLineTarget }
  | { kind: "terminal"; session: string }
  | { kind: "image"; path: string }
  | { kind: "page"; page: PageKind };

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
};

export type OpenOptions = {
  pane?: "focused" | "left" | "right" | "other-if-split";
  /** 既定 true。page と terminal は常に固定で開く。 */
  preview?: boolean;
  /** 新しいタブの id。既定は使われていない `t<n>`。 */
  newId?: () => string;
};

export type TabMenuState = {
  close: boolean;
  closeOthers: boolean;
  closeToRight: boolean;
  keepOpen: boolean;
  splitRight: boolean;
  moveToOtherSide: boolean;
  copyPath: boolean;
};

export type MoveResult =
  | { layout: Layout; moved: true }
  | {
      layout: Layout;
      moved: false;
      reason: "unknown-tab" | "no-such-pane" | "duplicate-target";
    };

export const LAYOUT_VERSION = 1;

function emptyPane(): Pane {
  return { tabs: [], activeId: null, recent: [] };
}

export function emptyLayout(): Layout {
  return { panes: { left: emptyPane() }, focused: "left" };
}

export function sameTarget(a: TabTarget, b: TabTarget): boolean {
  switch (a.kind) {
    case "file":
      return b.kind === "file" && a.path === b.path;
    case "image":
      return b.kind === "image" && a.path === b.path;
    case "terminal":
      return b.kind === "terminal" && a.session === b.session;
    case "page":
      return b.kind === "page" && a.page === b.page;
  }
}

function sides(layout: Layout): PaneSide[] {
  return layout.panes.right ? ["left", "right"] : ["left"];
}

function paneOf(layout: Layout, side: PaneSide): Pane | null {
  return side === "left" ? layout.panes.left : (layout.panes.right ?? null);
}

export function isSplit(layout: Layout): boolean {
  return !!layout.panes.right;
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

function findTarget(
  layout: Layout,
  target: TabTarget,
): { side: PaneSide; tab: Tab } | null {
  for (const side of sides(layout)) {
    const tab = paneOf(layout, side)?.tabs.find((item) =>
      sameTarget(item.target, target),
    );
    if (tab) return { side, tab };
  }
  return null;
}

/** フォーカスのある面の選択中のタブ。 */
export function activeTab(layout: Layout): Tab | null {
  const pane = paneOf(layout, layout.focused);
  if (!pane?.activeId) return null;
  return pane.tabs.find((tab) => tab.id === pane.activeId) ?? null;
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
 * 開く。同じ中身のタブがどこかにあれば、それを前面に出してその面へ
 * フォーカスを移す (中身は新しい target に差し替える: 行の指定が変わる)。
 * 無ければ、仮で開くときに面に仮のタブがあればそれを置き換え、無ければ
 * 選択中のタブの右に足す。
 */
export function open(
  layout: Layout,
  target: TabTarget,
  opts: OpenOptions = {},
): Layout {
  const existing = findTarget(layout, target);
  if (existing) {
    const pane = paneOf(layout, existing.side) as Pane;
    const tabs = pane.tabs.map((tab) =>
      tab.id === existing.tab.id ? { ...tab, target } : tab,
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
  const side = resolveSide(layout, opts.pane);
  const pane = paneOf(layout, side) as Pane;
  const preview =
    target.kind === "page" || target.kind === "terminal"
      ? false
      : opts.preview !== false;
  const tab: Tab = { id: nextId(layout, opts.newId), target, preview };
  const previewIndex = preview
    ? pane.tabs.findIndex((item) => item.preview)
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
    const activeIndex = pane.tabs.findIndex(
      (item) => item.id === pane.activeId,
    );
    const at = activeIndex >= 0 ? activeIndex + 1 : pane.tabs.length;
    tabs = [...pane.tabs.slice(0, at), tab, ...pane.tabs.slice(at)];
  }
  return {
    ...withPane(layout, side, selectIn({ ...pane, tabs, recent }, tab.id)),
    focused: side,
  };
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

/** 2 面のときに空になった面を消して 1 面に戻す。 */
function collapseEmpty(layout: Layout): Layout {
  const right = layout.panes.right;
  if (!right) return layout;
  if (right.tabs.length === 0)
    return { panes: { left: layout.panes.left }, focused: "left" };
  if (layout.panes.left.tabs.length === 0)
    return { panes: { left: right }, focused: "left" };
  return layout;
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
 */
export function move(
  layout: Layout,
  id: string,
  side: PaneSide,
  index: number,
): MoveResult {
  const found = findTab(layout, id);
  if (!found) return { layout, moved: false, reason: "unknown-tab" };
  const dest = paneOf(layout, side);
  if (!dest) return { layout, moved: false, reason: "no-such-pane" };
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
  // 移した先で仮のタブが 2 つにならないよう、先の仮のタブは固定にする。
  const destTabs = dest.tabs.map((tab) =>
    found.tab.preview && tab.preview ? { ...tab, preview: false } : tab,
  );
  const at = Math.max(0, Math.min(index, destTabs.length));
  const tabs = [...destTabs.slice(0, at), found.tab, ...destTabs.slice(at)];
  const moved = withPane(without, side, selectIn({ ...dest, tabs }, id));
  return { layout: collapseEmpty({ ...moved, focused: side }), moved: true };
}

export function canSplit(layout: Layout): boolean {
  return !layout.panes.right;
}

export function canMoveToOtherSide(layout: Layout): boolean {
  return !!layout.panes.right;
}

export function splitRight(layout: Layout, id: string): Layout {
  const found = findTab(layout, id);
  if (!found || !canSplit(layout) || layout.panes.left.tabs.length < 2)
    return layout;
  const left = removeFromPane(layout.panes.left, new Set([id]));
  return {
    panes: { left, right: selectIn(emptyPaneWith(found.tab), id) },
    focused: "right",
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

export function tabMenu(layout: Layout, id: string): TabMenuState {
  const found = findTab(layout, id);
  if (!found)
    return {
      close: false,
      closeOthers: false,
      closeToRight: false,
      keepOpen: false,
      splitRight: false,
      moveToOtherSide: false,
      copyPath: false,
    };
  const pane = paneOf(layout, found.side) as Pane;
  return {
    close: true,
    closeOthers: pane.tabs.length > 1,
    closeToRight: found.index < pane.tabs.length - 1,
    keepOpen: found.tab.preview,
    splitRight: canSplit(layout) && pane.tabs.length > 1,
    moveToOtherSide: canMoveToOtherSide(layout),
    copyPath:
      found.tab.target.kind === "file" || found.tab.target.kind === "image",
  };
}

// ---- 保存 ----

export type SerializedLayout = {
  version: typeof LAYOUT_VERSION;
  focused: PaneSide;
  panes: Array<{
    side: PaneSide;
    activeId: string | null;
    tabs: Array<{ id: string; preview: boolean; target: TabTarget }>;
  }>;
};

export function serializeLayout(layout: Layout): SerializedLayout {
  return {
    version: LAYOUT_VERSION,
    focused: layout.focused,
    panes: sides(layout).map((side) => {
      const pane = paneOf(layout, side) as Pane;
      return {
        side,
        activeId: pane.activeId,
        tabs: pane.tabs.map((tab) => ({
          id: tab.id,
          preview: tab.preview,
          target: tab.target,
        })),
      };
    }),
  };
}

export type ParsedLayout = {
  layout: Layout;
  /** 種類が分からず落としたタブ (場所と元の値)。 */
  dropped: Array<{ at: string; raw: unknown }>;
};

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

/** target を読む。不明な種類は null (落とす)、壊れていれば理由の文字列。 */
function parseTarget(raw: unknown): TabTarget | null | string {
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
      return line === undefined
        ? { kind: "file", path: raw.path as string }
        : { kind: "file", path: raw.path as string, line };
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
 */
export function parseLayout(raw: unknown): ParsedLayout {
  const problems: string[] = [];
  const dropped: ParsedLayout["dropped"] = [];
  if (!isRecord(raw)) throw new Error("main tab layout: not an object");
  if (raw.version !== LAYOUT_VERSION)
    problems.push(
      `version is ${JSON.stringify(raw.version)}, expected ${LAYOUT_VERSION}`,
    );
  if (raw.focused !== "left" && raw.focused !== "right")
    problems.push(`focused is ${JSON.stringify(raw.focused)}`);
  const panesRaw = Array.isArray(raw.panes) ? raw.panes : null;
  if (!panesRaw) problems.push("panes is not an array");
  else if (panesRaw.length < 1 || panesRaw.length > 2)
    problems.push(`panes has ${panesRaw.length} entries (1 or 2 allowed)`);
  const panes: Partial<Record<PaneSide, Pane>> = {};
  const seenIds = new Map<string, string>();
  const seenTargets: Array<{ target: TabTarget; at: string }> = [];
  (panesRaw ?? []).slice(0, 2).forEach((paneRaw, paneIndex) => {
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
      const target = parseTarget(tabRaw.target);
      if (target === null) {
        dropped.push({ at, raw: tabRaw });
        return;
      }
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
      const dupTarget = seenTargets.find((item) =>
        sameTarget(item.target, target),
      );
      if (dupTarget)
        problems.push(
          `${at}: ${target.kind} ${JSON.stringify(target)} is also open at ${dupTarget.at}`,
        );
      seenTargets.push({ target, at });
      tabs.push({ id: tabRaw.id, target, preview: tabRaw.preview === true });
    });
    const previews = tabs.filter((tab) => tab.preview);
    if (previews.length > 1)
      problems.push(
        `${where} has ${previews.length} preview tabs (${previews.map((t) => t.id).join(", ")}); at most 1`,
      );
    let activeId: string | null = null;
    if (paneRaw.activeId === null) {
      if (tabs.length > 0)
        problems.push(`${where}.activeId is null but the pane has tabs`);
    } else if (typeof paneRaw.activeId !== "string") {
      problems.push(`${where}.activeId is ${JSON.stringify(paneRaw.activeId)}`);
    } else if (tabs.some((tab) => tab.id === paneRaw.activeId)) {
      activeId = paneRaw.activeId;
    } else if (
      dropped.some(
        (item) => isRecord(item.raw) && item.raw.id === paneRaw.activeId,
      )
    ) {
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
  let layout: Layout = {
    panes: {
      left: panes.left as Pane,
      ...(panes.right ? { right: panes.right } : {}),
    },
    focused: raw.focused as PaneSide,
  };
  layout = collapseEmpty(layout);
  if (!paneOf(layout, layout.focused)) layout = { ...layout, focused: "left" };
  return { layout, dropped };
}

/** 不変条件の検査。破れていれば理由を全部並べて投げる (テストと開発用)。 */
export function assertLayout(layout: Layout): void {
  const problems: string[] = [];
  const ids = new Set<string>();
  const targets: TabTarget[] = [];
  if (!paneOf(layout, layout.focused))
    problems.push(`focused pane ${layout.focused} is missing`);
  for (const side of sides(layout)) {
    const pane = paneOf(layout, side) as Pane;
    for (const tab of pane.tabs) {
      if (ids.has(tab.id)) problems.push(`duplicate id ${tab.id}`);
      ids.add(tab.id);
      if (targets.some((t) => sameTarget(t, tab.target)))
        problems.push(`duplicate target ${JSON.stringify(tab.target)}`);
      targets.push(tab.target);
    }
    if (pane.tabs.filter((tab) => tab.preview).length > 1)
      problems.push(`${side} has more than one preview tab`);
    if (
      pane.tabs.length === 0
        ? pane.activeId !== null
        : !pane.tabs.some((t) => t.id === pane.activeId)
    )
      problems.push(`${side}.activeId ${pane.activeId} is not in the pane`);
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
}
