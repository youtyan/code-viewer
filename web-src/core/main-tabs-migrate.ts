// 前の版の保存 (プロジェクトごとの配置 + 共通のタブ) を、全プロジェクト共通の
// 1 つの配置へ移す (純ロジック)。サーバ (server/main-tabs-store.ts) が、前の版の
// ファイルを読んだときにロックの中で 1 回だけ使う。
//
// 前の版の形: `{ version: 1, projects: { <根>: { layout, savedAt } },
// common?: { tabs, savedAt } }`。layout は各プロジェクトの配置 (LAYOUT_VERSION
// 1〜4)、common.tabs はプロジェクトに属さないタブ (COMMON_TABS_VERSION 1)。
//
// 移し方:
// - 最後に保存したプロジェクトの配置を土台にする (前面・フォーカス・2 面の比は
//   その窓のもの)。ほかのプロジェクトのタブは、同じ面の末尾へ保存の新しい順に足す
// - プロジェクトの持ち物のタブ (ファイル・画像・Diff などの画面) には、その配置の
//   根を持たせる。シェル・全体ボードなどは持ち物を持たない
// - 同じ中身 (どのプロジェクトの配置にもあったシェルなど) は 1 枚にまとめる
// - 共通のタブの保存にあって、どの配置にも無いものは左の面の末尾に足す
// - id がぶつかれば付け直す
// - 読めない配置・知らない種類のタブは捨てずに、場所・理由・元の値を unmigrated
//   に返す (呼び出し側は元のファイルを写して残し、理由を出す)

import {
  assertLayout,
  canPlace,
  DEFAULT_SPLIT,
  emptyLayout,
  isNewerLayoutVersion,
  type Layout,
  parseLayout,
  type SerializedLayout,
  type SerializedPageRoute,
  sameTarget,
  serializeLayout,
  type Tab,
  type TabTarget,
  parseCommonTabs,
} from "./main-tabs";

export type Unmigrated = { at: string; reason: string; raw: unknown };

export type MigratedTabs = {
  layout: SerializedLayout;
  /** 移したタブの数 (まとめた重なりを除く)。 */
  moved: number;
  /** 同じ中身だったので 1 枚にまとめたタブ (場所と中身)。 */
  merged: Array<{ at: string; target: TabTarget }>;
  /**
   * 前の版の読み方でも落としていた Files のタブ (廃止。フォルダ表示は左の面の
   * 本文の既定)。消えたのではないので unmigrated と分ける。
   */
  retired: Array<{ at: string; raw: unknown }>;
  /** 移せなかったもの。捨てずに理由と元の値を返す。 */
  unmigrated: Unmigrated[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 前の版 (プロジェクトごと) のファイルか。 */
export function isPerProjectTabsFile(raw: unknown): boolean {
  return isRecord(raw) && raw.version === 1 && isRecord(raw.projects);
}

export function migratePerProjectTabs(raw: unknown): MigratedTabs {
  if (!isPerProjectTabsFile(raw))
    throw new Error(
      `main tabs migration: not a per-project tabs file (version ${JSON.stringify(isRecord(raw) ? raw.version : raw)})`,
    );
  const file = raw as {
    projects: Record<string, unknown>;
    common?: unknown;
  };
  const unmigrated: Unmigrated[] = [];
  const merged: MigratedTabs["merged"] = [];
  const retired: MigratedTabs["retired"] = [];
  const entries = Object.entries(file.projects)
    .map(([root, entry]) => ({
      root,
      entry,
      savedAt:
        isRecord(entry) && typeof entry.savedAt === "number"
          ? entry.savedAt
          : 0,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
  let layout: Layout | null = null;
  const routes: Record<string, SerializedPageRoute> = {};
  const used = new Set<string>();
  let moved = 0;
  const freshId = (id: string) => {
    let next = id;
    for (let n = 2; used.has(next); n += 1) next = `${id}-${n}`;
    used.add(next);
    return next;
  };
  for (const { root, entry } of entries) {
    const at = `projects[${JSON.stringify(root)}]`;
    if (!isRecord(entry) || !("layout" in entry)) {
      unmigrated.push({ at, reason: "the entry has no layout", raw: entry });
      continue;
    }
    if (isNewerLayoutVersion(entry.layout)) {
      unmigrated.push({
        at,
        reason: `the layout was written by a newer version (${JSON.stringify((entry.layout as { version: unknown }).version)})`,
        raw: entry.layout,
      });
      continue;
    }
    let parsed: ReturnType<typeof parseLayout>;
    try {
      parsed = parseLayout(entry.layout, { project: root });
    } catch (error) {
      unmigrated.push({
        at,
        reason: error instanceof Error ? error.message : String(error),
        raw: entry.layout,
      });
      continue;
    }
    for (const item of parsed.dropped)
      unmigrated.push({
        at: `${at}.layout.${item.at}`,
        reason: "unknown tab kind",
        raw: item.raw,
      });
    // Files のタブ (廃止) と右の面の画面の移動は前の版の読み方どおり。
    for (const item of parsed.retired)
      retired.push({ at: `${at}.layout.${item.at}`, raw: item.raw });
    const renamed = new Map<string, string>();
    const renamedLayout = mapIds(parsed.layout, (id) => {
      const next = freshId(id);
      renamed.set(id, next);
      return next;
    });
    for (const [id, route] of Object.entries(parsed.pageRoutes))
      routes[renamed.get(id) ?? id] = route;
    if (!layout) {
      layout = renamedLayout;
      moved += countTabs(renamedLayout);
      continue;
    }
    for (const side of ["left", "right"] as const) {
      const pane =
        side === "left" ? renamedLayout.panes.left : renamedLayout.panes.right;
      for (const tab of pane?.tabs ?? []) {
        const dest: "left" | "right" =
          side === "right" &&
          layout.panes.right &&
          canPlace(tab.target, "right")
            ? "right"
            : "left";
        if (hasSame(layout, dest, tab.target)) {
          merged.push({
            at: `${at}.layout ${side} ${tab.id}`,
            target: tab.target,
          });
          continue;
        }
        layout = appendTab(layout, dest, tab);
        moved += 1;
      }
    }
  }
  let result = layout ?? emptyLayout();
  if ("common" in file && file.common !== undefined) {
    const common = file.common as unknown;
    const tabs = isRecord(common) ? common.tabs : undefined;
    try {
      const parsed = parseCommonTabs(tabs);
      if (parsed.kind === "newer")
        unmigrated.push({
          at: "common",
          reason: `the common tabs were written by a newer version (${parsed.version})`,
          raw: common,
        });
      else if (parsed.kind === "ok") {
        for (const item of parsed.dropped)
          unmigrated.push({
            at: `common.${item.at}`,
            reason: "unknown tab kind",
            raw: item.raw,
          });
        for (const target of parsed.targets) {
          if (
            hasSame(result, "left", target) ||
            hasSame(result, "right", target)
          )
            continue;
          result = appendTab(result, "left", {
            id: freshId("c1"),
            target,
            preview: false,
          });
          moved += 1;
        }
      }
    } catch (error) {
      unmigrated.push({
        at: "common",
        reason: error instanceof Error ? error.message : String(error),
        raw: common,
      });
    }
  }
  assertLayout(result);
  return {
    layout: serializeLayout(result, (tab) => routes[tab.id]),
    moved,
    merged,
    retired,
    unmigrated,
  };
}

function countTabs(layout: Layout): number {
  return layout.panes.left.tabs.length + (layout.panes.right?.tabs.length ?? 0);
}

function mapIds(layout: Layout, rename: (id: string) => string): Layout {
  const names = new Map<string, string>();
  const name = (id: string) => {
    let next = names.get(id);
    if (!next) {
      next = rename(id);
      names.set(id, next);
    }
    return next;
  };
  const pane = (p: Layout["panes"]["left"]) => ({
    tabs: p.tabs.map((tab) => ({ ...tab, id: name(tab.id) })),
    activeId: p.activeId === null ? null : name(p.activeId),
    recent: p.recent.map(name),
  });
  return {
    ...layout,
    panes: {
      left: pane(layout.panes.left),
      ...(layout.panes.right ? { right: pane(layout.panes.right) } : {}),
    },
  };
}

/** 同じ中身を置けないか (ファイルは面ごとに 1 つ、ほかは全体で 1 つ)。 */
function hasSame(
  layout: Layout,
  side: "left" | "right",
  target: TabTarget,
): boolean {
  const sides = target.kind === "file" ? [side] : (["left", "right"] as const);
  return sides.some((s) =>
    (s === "left" ? layout.panes.left : layout.panes.right)?.tabs.some((tab) =>
      sameTarget(tab.target, target),
    ),
  );
}

function appendTab(layout: Layout, side: "left" | "right", tab: Tab): Layout {
  const pane = side === "left" ? layout.panes.left : layout.panes.right;
  if (!pane) throw new Error(`main tabs migration: no ${side} pane`);
  const next = { ...pane, tabs: [...pane.tabs, tab] };
  return {
    ...layout,
    panes:
      side === "left"
        ? { ...layout.panes, left: next }
        : { ...layout.panes, right: next },
    ...(side === "right" && layout.split === undefined
      ? { split: DEFAULT_SPLIT }
      : {}),
  };
}
