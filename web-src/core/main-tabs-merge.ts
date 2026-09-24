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
  parseLayout,
  type SerializedLayout,
  type SerializedPageRoute,
  sameTarget,
  serializeLayout,
  type Tab,
  targetProject,
} from "./main-tabs";

type Place = {
  side: PaneSide;
  preview: boolean;
  target: string;
};

const SIDES: readonly PaneSide[] = ["left", "right"];

function paneOf(layout: Layout, side: PaneSide): Pane | undefined {
  return side === "left" ? layout.panes.left : layout.panes.right;
}

/** 各タブの面・仮か・中身。 */
function placesOf(layout: Layout): Map<string, Place> {
  const out = new Map<string, Place>();
  for (const side of SIDES)
    for (const tab of paneOf(layout, side)?.tabs ?? [])
      out.set(tab.id, {
        side,
        preview: tab.preview,
        target: JSON.stringify(tab.target),
      });
  return out;
}

/** 2 つの並びの最長共通部分列 (同じ長さが複数あれば a の前のほうを残す)。 */
function commonOrder(a: readonly string[], b: readonly string[]): string[] {
  // longest[i][j] = a[i..] と b[j..] の最長共通部分列の長さ。
  const longest = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      longest[i][j] =
        a[i] === b[j]
          ? longest[i + 1][j + 1] + 1
          : Math.max(longest[i + 1][j], longest[i][j + 1]);
  const out: string[] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      out.push(a[i]);
      i += 1;
      j += 1;
    } else if (longest[i + 1][j] >= longest[i][j + 1]) i += 1;
    else j += 1;
  }
  return out;
}

/**
 * before から after へ、面を変えずに並びも保ったタブ (両方にあるタブの並びの
 * 最長共通部分列に入るもの)。それ以外が「動かした」タブ。1 つ動かしただけで
 * 隣のタブまで「動かした」と数えないため (前はすぐ左のタブが変わったタブを
 * 全部動かしたと数え、どちらの窓も動かしていないタブが端へ飛んでいた)。
 */
function stayedIn(
  before: Layout,
  after: Layout,
  shared: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const side of SIDES) {
    const order = (layout: Layout) =>
      (paneOf(layout, side)?.tabs ?? [])
        .map((tab) => tab.id)
        .filter((id) => shared.has(id));
    for (const id of commonOrder(order(before), order(after))) out.add(id);
  }
  return out;
}

/** 各タブの面と、面の中の位置。 */
function positionsOf(
  layout: Layout,
): Map<string, { side: PaneSide; index: number }> {
  const out = new Map<string, { side: PaneSide; index: number }>();
  for (const side of SIDES)
    (paneOf(layout, side)?.tabs ?? []).forEach((tab, index) => {
      out.set(tab.id, { side, index });
    });
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
  const basePlaces = base ? placesOf(base) : new Map<string, Place>();
  const minePlaces = placesOf(mine);
  const stayed = base ? stayedIn(base, mine, kept) : new Set<string>();
  const positions = [base, mine, theirs].map((layout) =>
    layout ? positionsOf(layout) : null,
  );
  /** a と b が 3 つとも side の面で同じ前後なら、a が前で -1・後で 1。ほかは 0。 */
  const agreedOrder = (a: string, b: string, side: PaneSide): number => {
    let sign = 0;
    for (const where of positions) {
      const from = where?.get(a);
      const to = where?.get(b);
      if (!from || !to || from.side !== side || to.side !== side) return 0;
      const now = Math.sign(from.index - to.index);
      if (sign !== 0 && now !== sign) return 0;
      sign = now;
    }
    return sign;
  };
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
      const now = minePlaces.get(tab.id);
      if (!now) throw new Error(`main tabs merge: tab ${tab.id} is not placed`);
      const inTheirs = has(tab.id);
      if (was && !inTheirs) return; // 相手が閉じた: 閉じたまま。
      const moved = !was || !stayed.has(tab.id);
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
      // 右隣は動かしていないタブだけを見る (開いた・動かしたタブはこの後で
      // このタブの右へ置き直すので、今の場所を基準にすると左端へ行けない)。
      const list = panes[side];
      let at = -1;
      for (let i = index - 1; i >= 0 && at < 0; i -= 1) {
        const left = list.findIndex((item) => item.id === tabs[i].id);
        if (left >= 0) at = left + 1;
      }
      for (let i = index + 1; i < tabs.length && at < 0; i += 1) {
        if (!stayed.has(tabs[i].id)) continue;
        const right = list.findIndex((item) => item.id === tabs[i].id);
        if (right >= 0) at = right;
      }
      if (at < 0) at = list.length;
      // base・この窓・相手の 3 つとも同じ前後にある 2 つのタブは、重ねた後も
      // その前後にする (どちらの窓もその 2 つの前後を変えていない)。すぐ左の
      // タブを相手が動かしていると、その右へ置くだけでは前後が崩れる。
      let low = 0;
      let high = list.length;
      list.forEach((item, position) => {
        const order = agreedOrder(item.id, tab.id, side);
        if (order < 0) low = Math.max(low, position + 1);
        if (order > 0) high = Math.min(high, position);
      });
      at = Math.min(Math.max(at, low), high);
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
  // 畳んだグループはグループごとに重ねる: この窓が base から畳んだ・開いた
  // グループはこの窓の値、ほかは相手の値 (配列ごとに選ぶと、2 つの窓で別々の
  // グループを同時に畳んだとき片方が消えていた)。
  const baseCollapsed = new Set(base?.collapsed ?? []);
  const mineCollapsed = new Set(mine.collapsed ?? []);
  const collapsed = (theirs.collapsed ?? []).filter(
    (key) => !baseCollapsed.has(key) || mineCollapsed.has(key),
  );
  for (const key of mineCollapsed)
    if (!baseCollapsed.has(key) && !collapsed.includes(key))
      collapsed.push(key);
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
