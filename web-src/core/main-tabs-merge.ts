// 窓どうしのタブの変更の突き合わせ (純ロジック)。DOM・fetch に依存しない。
//
// タブは全プロジェクト共通で、保存は 1 つ (`<状態>/main-tabs.json`)。窓を 2 つ
// 開くと、それぞれが自分の配置を持ち、あとから保存した窓がもう一方の変更を消して
// いた。そこで保存を「前に読んだ値 (base) からの自分の変更」を今の保存 (theirs) に
// 当てる形にする: 自分が開いたタブは足し、閉じたタブは消し、動かしたタブは動かす。
// 自分が触っていないタブは相手の並びのまま (相手が閉じたものは消えたまま)。
//
// 前面・フォーカス・2 面の比は窓ごとのもの (自分の値を使う)。相手の窓の前面を
// 自分の窓へ持ち込まない。
//
// タブの同一性は id (画面が窓ごとにぶつからない値を振る。views/main-tabs)。
// 両方の窓が同じ中身を別々に開いたときは、相手のタブに寄せる (同じ中身の 2 枚目を
// 作らない)。

import {
  canPlace,
  DEFAULT_SPLIT,
  type Layout,
  type Pane,
  type PaneSide,
  type SerializedLayout,
  type SerializedPageRoute,
  sameTarget,
  serializeLayout,
  parseLayout,
  type Tab,
  targetProject,
} from "./main-tabs";

type Place = {
  side: PaneSide;
  /** 同じ面の中で、base と mine の両方にあるタブのうち、すぐ左のもの。 */
  anchor: string | null;
  preview: boolean;
  target: string;
};

const SIDES: readonly PaneSide[] = ["left", "right"];

function paneOf(layout: Layout, side: PaneSide): Pane | undefined {
  return side === "left" ? layout.panes.left : layout.panes.right;
}

/** 各タブの面・並びの基準 (両方にあるタブの中のすぐ左)・仮か・中身。 */
function placesOf(
  layout: Layout,
  shared: ReadonlySet<string>,
): Map<string, Place> {
  const out = new Map<string, Place>();
  for (const side of SIDES) {
    let anchor: string | null = null;
    for (const tab of paneOf(layout, side)?.tabs ?? []) {
      out.set(tab.id, {
        side,
        anchor,
        preview: tab.preview,
        target: JSON.stringify(tab.target),
      });
      if (shared.has(tab.id)) anchor = tab.id;
    }
  }
  return out;
}

function idsOf(layout: Layout): Set<string> {
  const out = new Set<string>();
  for (const side of SIDES)
    for (const tab of paneOf(layout, side)?.tabs ?? []) out.add(tab.id);
  return out;
}

/** 同じ中身が置けない場所に既にあるか (ファイルは面ごとに 1 つ、ほかは全体で 1 つ)。 */
function duplicateOf(
  panes: Record<PaneSide, Tab[]>,
  side: PaneSide,
  tab: Tab,
): Tab | null {
  const where = tab.target.kind === "file" ? [side] : SIDES;
  for (const other of where) {
    const found = panes[other].find(
      (item) => item.id !== tab.id && sameTarget(item.target, tab.target),
    );
    if (found) return found;
  }
  return null;
}

export type MergedLayout = {
  layout: Layout;
  /**
   * 自分が開いたタブのうち、相手が同じ中身を開いていたので相手のタブに寄せた
   * もの (自分の id → 相手の id)。画面はタブごとに覚えた route を移し替える。
   */
  renamed: Map<string, string>;
};

/**
 * base (前に読んだ保存) からの mine (この窓) の変更を theirs (今の保存) に当てる。
 * base が null (まだ読めていない・保存が無かった) なら、mine のタブは全部「開いた」
 * として足す (閉じたものは無い)。
 */
export function mergeLayouts(
  base: Layout | null,
  mine: Layout,
  theirs: Layout,
): MergedLayout {
  const baseIds = base ? idsOf(base) : new Set<string>();
  const mineIds = idsOf(mine);
  const kept = new Set([...baseIds].filter((id) => mineIds.has(id)));
  const basePlaces = base ? placesOf(base, kept) : new Map<string, Place>();
  const minePlaces = placesOf(mine, kept);
  const panes: Record<PaneSide, Tab[]> = {
    left: [...theirs.panes.left.tabs],
    right: [...(theirs.panes.right?.tabs ?? [])],
  };
  const remove = (id: string) => {
    for (const side of SIDES)
      panes[side] = panes[side].filter((tab) => tab.id !== id);
  };
  const has = (id: string) =>
    SIDES.some((side) => panes[side].some((tab) => tab.id === id));
  // 1. この窓で閉じたもの。
  for (const id of baseIds) if (!mineIds.has(id)) remove(id);
  // 2. この窓で開いた・動かした・変えたもの (並びの左から順に)。
  const renamed = new Map<string, string>();
  for (const side of SIDES) {
    const tabs = paneOf(mine, side)?.tabs ?? [];
    tabs.forEach((tab, index) => {
      const was = basePlaces.get(tab.id);
      const now = minePlaces.get(tab.id) as Place;
      const inTheirs = has(tab.id);
      if (was && !inTheirs) return; // 相手が閉じた: 閉じたまま。
      const moved = !was || was.side !== now.side || was.anchor !== now.anchor;
      const changed =
        !was || was.preview !== now.preview || was.target !== now.target;
      if (!moved && !changed) return;
      if (!moved) {
        // 中身 (行の指定・仮か) だけ変えた: 相手の場所のまま差し替える。
        for (const s of SIDES)
          panes[s] = panes[s].map((item) =>
            item.id === tab.id ? { ...tab } : item,
          );
        return;
      }
      if (!canPlace(tab.target, side)) return;
      remove(tab.id);
      const duplicate = duplicateOf(panes, side, tab);
      if (duplicate) {
        if (!was) renamed.set(tab.id, duplicate.id);
        return;
      }
      // すぐ左にあるタブ (相手の並びにもあるもの) の右へ。無ければ右隣の左へ。
      const list = panes[side];
      let at = -1;
      for (let i = index - 1; i >= 0 && at < 0; i -= 1) {
        const left = list.findIndex((item) => item.id === tabs[i].id);
        if (left >= 0) at = left + 1;
      }
      for (let i = index + 1; i < tabs.length && at < 0; i += 1) {
        const right = list.findIndex((item) => item.id === tabs[i].id);
        if (right >= 0) at = right;
      }
      if (at < 0) at = list.length;
      panes[side] = [...list.slice(0, at), tab, ...list.slice(at)];
    });
  }
  // 3. 仮のタブは面ごと・プロジェクトごとに 1 つ。この窓の仮を残し、ほかは固定にする。
  const minePreview = new Set(
    SIDES.flatMap((side) =>
      (paneOf(mine, side)?.tabs ?? [])
        .filter((tab) => tab.preview)
        .map((tab) => tab.id),
    ),
  );
  for (const side of SIDES) {
    const seen = new Map<string | null, string>();
    const ordered = [
      ...panes[side].filter((tab) => minePreview.has(tab.id)),
      ...panes[side].filter((tab) => !minePreview.has(tab.id)),
    ];
    for (const tab of ordered) {
      if (!tab.preview) continue;
      const key = targetProject(tab.target);
      if (!seen.has(key)) seen.set(key, tab.id);
    }
    panes[side] = panes[side].map((tab) =>
      tab.preview && seen.get(targetProject(tab.target)) !== tab.id
        ? { ...tab, preview: false }
        : tab,
    );
  }
  return { layout: windowState(mine, theirs, base, panes, renamed), renamed };
}

/** 前面・フォーカス・比・畳んだグループ・グループの前面を決め直す。 */
function windowState(
  mine: Layout,
  theirs: Layout,
  base: Layout | null,
  panes: Record<PaneSide, Tab[]>,
  renamed: Map<string, string>,
): Layout {
  const map = (id: string | null) => (id ? (renamed.get(id) ?? id) : null);
  const pick = (side: PaneSide): Pane | undefined => {
    const tabs = panes[side];
    if (side === "right" && tabs.length === 0) return undefined;
    const ids = new Set(tabs.map((tab) => tab.id));
    const own = paneOf(mine, side);
    const recent = (own?.recent ?? [])
      .map((id) => map(id) as string)
      .filter((id, i, all) => ids.has(id) && all.indexOf(id) === i);
    const wanted = map(own?.activeId ?? null);
    let activeId: string | null;
    if (wanted && ids.has(wanted)) activeId = wanted;
    else if (own && own.activeId === null && side === "left") activeId = null;
    else {
      const fromTheirs = paneOf(theirs, side)?.activeId ?? null;
      activeId =
        recent[recent.length - 1] ??
        (fromTheirs && ids.has(fromTheirs) ? fromTheirs : null) ??
        (side === "right" ? tabs[0].id : null);
    }
    return {
      tabs,
      activeId,
      recent: activeId
        ? [...recent.filter((id) => id !== activeId), activeId]
        : recent,
    };
  };
  const left = pick("left") as Pane;
  const right = pick("right");
  const focused: PaneSide =
    mine.focused === "right" && right ? "right" : "left";
  const split = right
    ? ((mine.panes.right ? mine.split : theirs.split) ?? DEFAULT_SPLIT)
    : undefined;
  const ids = new Set([...left.tabs, ...(right?.tabs ?? [])].map((t) => t.id));
  const collapsed =
    JSON.stringify(mine.collapsed ?? []) !==
    JSON.stringify(base?.collapsed ?? [])
      ? mine.collapsed
      : theirs.collapsed;
  const fronts: Record<string, string> = { ...(theirs.groupFronts ?? {}) };
  for (const [group, id] of Object.entries(mine.groupFronts ?? {}))
    if (base?.groupFronts?.[group] !== id) fronts[group] = map(id) as string;
  for (const [group, id] of Object.entries(fronts))
    if (!ids.has(id)) delete fronts[group];
  // シェルのグループの控えは両方の値を合わせる (どちらも見えた値の控え)。
  const sessions = new Set(
    [...left.tabs, ...(right?.tabs ?? [])].flatMap((tab) =>
      tab.target.kind === "terminal" ? [tab.target.session] : [],
    ),
  );
  const terminalGroups: Record<string, string> = {};
  for (const [session, root] of Object.entries({
    ...(theirs.terminalGroups ?? {}),
    ...(mine.terminalGroups ?? {}),
  }))
    if (sessions.has(session)) terminalGroups[session] = root;
  // 映していた tmux の場所も同じ (同じシェルはこの窓の値)。
  const terminalTmux: NonNullable<Layout["terminalTmux"]> = {};
  for (const [session, place] of Object.entries({
    ...(theirs.terminalTmux ?? {}),
    ...(mine.terminalTmux ?? {}),
  }))
    if (sessions.has(session)) terminalTmux[session] = place;
  return {
    panes: { left, ...(right ? { right } : {}) },
    focused,
    ...(split !== undefined ? { split } : {}),
    ...(collapsed && collapsed.length > 0 ? { collapsed: [...collapsed] } : {}),
    ...(Object.keys(fronts).length > 0 ? { groupFronts: fronts } : {}),
    ...(Object.keys(terminalGroups).length > 0 ? { terminalGroups } : {}),
    ...(Object.keys(terminalTmux).length > 0 ? { terminalTmux } : {}),
  };
}

/**
 * 保存の形のまま突き合わせる (サーバが、別の窓が先に書いた保存と重ねるときに
 * 使う)。タブごとの route (検索語・道具・Preview) は、この窓のものを優先する。
 */
export function mergeSerializedLayouts(
  base: unknown,
  mine: unknown,
  theirs: unknown,
): SerializedLayout {
  const parsedBase = base === null ? null : parseLayout(base);
  const parsedMine = parseLayout(mine);
  const parsedTheirs = parseLayout(theirs);
  const { layout, renamed } = mergeLayouts(
    parsedBase?.layout ?? null,
    parsedMine.layout,
    parsedTheirs.layout,
  );
  const routes: Record<string, SerializedPageRoute> = {
    ...parsedTheirs.pageRoutes,
  };
  for (const [id, route] of Object.entries(parsedMine.pageRoutes))
    routes[renamed.get(id) ?? id] = route;
  return serializeLayout(layout, (tab) => routes[tab.id]);
}
