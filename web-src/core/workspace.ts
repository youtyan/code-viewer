// 窓の面の並び (面の木) と、面ごとの保存。DOM に触らない。
//
// 窓 (外側のページ) は面 (iframe の app) を木で並べる。葉が面、節が 2 つに分けた
// 所 (row = 左右、column = 上下。ratio は a の側の割合)。面は入れ子にでき、左右と
// 上下を混ぜてよい。面ごとに持つのは、その面の URL (読み直したときに開く画面と
// プロジェクト) と、タブの配置 (core/main-tabs.ts の SerializedLayout。面の中の
// app が読み書きする。ここでは中身を見ない)。
//
// 保存 (server/main-tabs-store.ts) は窓ごとにこの形を 1 つ持つ。書くのは外側の
// ページだけ (面は変更を外側のページへ送る)。

import { projectKey } from "./api-url";
import { LAYOUT_VERSION, type SerializedLayout } from "./main-tabs";

export const WORKSPACE_VERSION = 6;

export type PaneId = string;
export type SplitDir = "row" | "column";

export type PaneNode =
  | { pane: PaneId }
  | { dir: SplitDir; ratio: number; a: PaneNode; b: PaneNode };

export type PaneEntry = {
  /** 面が最後に開いていた画面 (origin を除いた path・search・hash)。 */
  url: string;
  /** 面のタブの配置。まだ一度も保存していなければ null。 */
  layout: unknown | null;
};

export type Workspace = {
  version: typeof WORKSPACE_VERSION;
  tree: PaneNode;
  focused: PaneId;
  panes: Record<PaneId, PaneEntry>;
};

/** 面の最小の大きさ (px)。これより小さくなる窓では、フォーカスのある面だけを出す。 */
export const MIN_PANE_WIDTH = 440;
export const MIN_PANE_HEIGHT = 240;
/** 面の間の境界の太さ (px)。 */
export const PANE_DIVIDER = 4;
/** 分けた比の端 (面を潰しきらない)。 */
const RATIO_MIN = 0.1;
const RATIO_MAX = 0.9;

export function singlePane(id: PaneId, url: string): Workspace {
  return {
    version: WORKSPACE_VERSION,
    tree: { pane: id },
    focused: id,
    panes: { [id]: { url, layout: null } },
  };
}

/** 木の葉の並び (左上から)。 */
export function paneIds(tree: PaneNode): PaneId[] {
  return "pane" in tree
    ? [tree.pane]
    : [...paneIds(tree.a), ...paneIds(tree.b)];
}

/** まだ使っていない面の id (p1, p2, ...)。 */
export function freshPaneId(workspace: Workspace): PaneId {
  for (let n = 1; ; n++) {
    const id = `p${n}`;
    if (!(id in workspace.panes)) return id;
  }
}

/**
 * target の面を dir の向きに 2 つに分け、新しい面 (id・entry) を後ろ (右か下) に
 * 置く。新しい面にフォーカスを移す。
 */
export function splitPane(
  workspace: Workspace,
  target: PaneId,
  dir: SplitDir,
  id: PaneId,
  entry: PaneEntry,
): Workspace {
  if (!(target in workspace.panes))
    throw new Error(`split: no pane ${JSON.stringify(target)}`);
  if (id in workspace.panes)
    throw new Error(`split: pane ${JSON.stringify(id)} already exists`);
  const replace = (node: PaneNode): PaneNode => {
    if ("pane" in node)
      return node.pane === target
        ? { dir, ratio: 0.5, a: node, b: { pane: id } }
        : node;
    return { ...node, a: replace(node.a), b: replace(node.b) };
  };
  return {
    ...workspace,
    tree: replace(workspace.tree),
    focused: id,
    panes: { ...workspace.panes, [id]: entry },
  };
}

/**
 * 面を閉じる。分けていた所は残った側が親の場所に入る。最後の 1 つは閉じない
 * (同じ workspace を返す)。フォーカスが閉じた面にあれば、残った側の最初の面へ。
 */
export function closePane(workspace: Workspace, id: PaneId): Workspace {
  if (!(id in workspace.panes)) return workspace;
  if ("pane" in workspace.tree) return workspace;
  let sibling: PaneNode | null = null;
  const remove = (node: PaneNode): PaneNode => {
    if ("pane" in node) return node;
    if ("pane" in node.a && node.a.pane === id) {
      sibling = node.b;
      return node.b;
    }
    if ("pane" in node.b && node.b.pane === id) {
      sibling = node.a;
      return node.a;
    }
    return { ...node, a: remove(node.a), b: remove(node.b) };
  };
  const tree = remove(workspace.tree);
  const { [id]: _closed, ...panes } = workspace.panes;
  const rest: PaneNode | null = sibling;
  const focused =
    workspace.focused === id && rest ? paneIds(rest)[0] : workspace.focused;
  return { ...workspace, tree, focused, panes };
}

/** 分けた所の位置 (根からの a / b の道)。 */
export type SplitPath = ("a" | "b")[];

/** その道の分けた所の比を変える (端は RATIO_MIN〜RATIO_MAX に収める)。 */
export function setRatio(
  workspace: Workspace,
  path: SplitPath,
  ratio: number,
): Workspace {
  const clamped = Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));
  const update = (node: PaneNode, rest: SplitPath): PaneNode => {
    if ("pane" in node)
      throw new Error(`setRatio: ${path.join("")} is not a split`);
    if (rest.length === 0) return { ...node, ratio: clamped };
    const [step, ...more] = rest;
    return { ...node, [step]: update(node[step], more) };
  };
  return { ...workspace, tree: update(workspace.tree, path) };
}

export type Rect = { x: number; y: number; width: number; height: number };

export type PaneLayout = {
  panes: Array<{ id: PaneId; rect: Rect }>;
  dividers: Array<{ path: SplitPath; dir: SplitDir; rect: Rect; span: Rect }>;
};

/**
 * 面と境界の場所 (窓の中の rect を分ける)。境界の span は、その分けた所が
 * 分けている範囲 (境界を引いたときの比の計算に使う)。px は整数に丸める。
 */
export function paneRects(tree: PaneNode, area: Rect): PaneLayout {
  const out: PaneLayout = { panes: [], dividers: [] };
  const walk = (node: PaneNode, rect: Rect, path: SplitPath) => {
    if ("pane" in node) {
      out.panes.push({ id: node.pane, rect });
      return;
    }
    const along = node.dir === "row" ? rect.width : rect.height;
    const first = Math.round((along - PANE_DIVIDER) * node.ratio);
    const second = along - PANE_DIVIDER - first;
    if (node.dir === "row") {
      walk(node.a, { ...rect, width: first }, [...path, "a"]);
      out.dividers.push({
        path,
        dir: "row",
        rect: { ...rect, x: rect.x + first, width: PANE_DIVIDER },
        span: rect,
      });
      walk(
        node.b,
        { ...rect, x: rect.x + first + PANE_DIVIDER, width: second },
        [...path, "b"],
      );
    } else {
      walk(node.a, { ...rect, height: first }, [...path, "a"]);
      out.dividers.push({
        path,
        dir: "column",
        rect: { ...rect, y: rect.y + first, height: PANE_DIVIDER },
        span: rect,
      });
      walk(
        node.b,
        { ...rect, y: rect.y + first + PANE_DIVIDER, height: second },
        [...path, "b"],
      );
    }
  };
  walk(tree, area, []);
  return out;
}

/** どの面も最小の大きさ以上で並ぶか。 */
export function panesFit(tree: PaneNode, area: Rect): boolean {
  return paneRects(tree, area).panes.every(
    ({ rect }) =>
      rect.width >= MIN_PANE_WIDTH && rect.height >= MIN_PANE_HEIGHT,
  );
}

export type Direction = "left" | "right" | "up" | "down";

/**
 * from の面からその向きの隣の面 (無ければ null)。向きの側にあって、横 (縦) の
 * 範囲が重なるもののうち一番近いもの。
 */
export function neighborPane(
  tree: PaneNode,
  from: PaneId,
  direction: Direction,
): PaneId | null {
  const { panes } = paneRects(tree, {
    x: 0,
    y: 0,
    width: 10000,
    height: 10000,
  });
  const here = panes.find((item) => item.id === from)?.rect;
  if (!here) return null;
  const horizontal = direction === "left" || direction === "right";
  let best: { id: PaneId; distance: number } | null = null;
  for (const { id, rect } of panes) {
    if (id === from) continue;
    const overlaps = horizontal
      ? rect.y < here.y + here.height && here.y < rect.y + rect.height
      : rect.x < here.x + here.width && here.x < rect.x + rect.width;
    const distance =
      direction === "left"
        ? here.x - (rect.x + rect.width)
        : direction === "right"
          ? rect.x - (here.x + here.width)
          : direction === "up"
            ? here.y - (rect.y + rect.height)
            : rect.y - (here.y + here.height);
    if (!overlaps || distance < 0) continue;
    if (!best || distance < best.distance) best = { id, distance };
  }
  return best?.id ?? null;
}

/** 葉の並びで次 (+1) / 前 (-1) の面 (端では回る)。 */
export function stepPane(tree: PaneNode, from: PaneId, delta: 1 | -1): PaneId {
  const ids = paneIds(tree);
  const index = ids.indexOf(from);
  return ids[
    (((index < 0 ? 0 : index + delta) % ids.length) + ids.length) % ids.length
  ];
}

/**
 * 窓を開いた URL (アドレス欄。origin を除いた path・search・hash) を、どの面で
 * 開くか。フォーカスのある面が同じプロジェクト (/p/<鍵>) ならその面、同じ
 * プロジェクトの面があればその面 (フォーカスも移す)、無ければフォーカスのある面を
 * そのプロジェクトに替える。面の URL がもう同じなら何も変えない。
 */
export function routeUrl(workspace: Workspace, url: string): Workspace {
  const focused = workspace.panes[workspace.focused];
  if (focused?.url === url) return workspace;
  const key = projectKey(url.split(/[?#]/)[0]);
  const keyOf = (id: PaneId) =>
    projectKey((workspace.panes[id]?.url ?? "").split(/[?#]/)[0]);
  const same =
    keyOf(workspace.focused) === key
      ? workspace.focused
      : (paneIds(workspace.tree).find((id) => keyOf(id) === key) ??
        workspace.focused);
  return {
    ...workspace,
    focused: same,
    panes: {
      ...workspace.panes,
      [same]: { ...workspace.panes[same], url },
    },
  };
}

// ---- 保存の形 ----

/** 保存した値を読む。形が違えば理由を全部並べて投げる (直さずに使わない)。 */
export function parseWorkspace(raw: unknown): Workspace {
  const problems: string[] = [];
  if (!isRecord(raw)) throw new Error("workspace: not an object");
  if (raw.version !== WORKSPACE_VERSION)
    problems.push(
      `version is ${JSON.stringify(raw.version)}, expected ${WORKSPACE_VERSION}`,
    );
  const seen: PaneId[] = [];
  const parseNode = (node: unknown, at: string): PaneNode | null => {
    if (!isRecord(node)) {
      problems.push(`${at} is not an object`);
      return null;
    }
    if ("pane" in node) {
      if (typeof node.pane !== "string" || node.pane === "") {
        problems.push(`${at}.pane is ${JSON.stringify(node.pane)}`);
        return null;
      }
      if (seen.includes(node.pane))
        problems.push(`${at}: pane ${JSON.stringify(node.pane)} appears twice`);
      seen.push(node.pane);
      return { pane: node.pane };
    }
    if (node.dir !== "row" && node.dir !== "column")
      problems.push(`${at}.dir is ${JSON.stringify(node.dir)}`);
    if (typeof node.ratio !== "number" || !(node.ratio > 0 && node.ratio < 1))
      problems.push(`${at}.ratio is ${JSON.stringify(node.ratio)}`);
    const a = parseNode(node.a, `${at}.a`);
    const b = parseNode(node.b, `${at}.b`);
    if (!a || !b || (node.dir !== "row" && node.dir !== "column")) return null;
    return { dir: node.dir, ratio: node.ratio as number, a, b };
  };
  const tree = parseNode(raw.tree, "tree");
  const panes: Record<PaneId, PaneEntry> = {};
  if (!isRecord(raw.panes)) problems.push("panes is not an object");
  else
    for (const [id, entry] of Object.entries(raw.panes)) {
      if (!seen.includes(id)) {
        problems.push(`panes.${id} is not in the tree`);
        continue;
      }
      if (!isRecord(entry) || typeof entry.url !== "string") {
        problems.push(`panes.${id}.url is not a string`);
        continue;
      }
      panes[id] = { url: entry.url, layout: entry.layout ?? null };
    }
  for (const id of seen)
    if (!(id in panes) && isRecord(raw.panes) && !(id in raw.panes))
      problems.push(`the tree has pane ${JSON.stringify(id)} without an entry`);
  if (typeof raw.focused !== "string" || !seen.includes(raw.focused))
    problems.push(`focused is ${JSON.stringify(raw.focused)}`);
  if (problems.length > 0 || !tree)
    throw new Error(
      `workspace is broken (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n- ${problems.join("\n- ")}`,
    );
  return {
    version: WORKSPACE_VERSION,
    tree,
    focused: raw.focused as PaneId,
    panes,
  };
}

/**
 * 前の版の配置 (1 つの配置に左右 2 面) を面の木に移す。左の面を p1、右の面を
 * p2 にし (比はそのまま)、右の面のタブは p2 の面 (面の中では左) へ移す。
 * グループの控え (前面・畳んだもの・シェルのグループと場所) は両方の面に写す
 * (その面に無いタブの控えは使われない)。url は面の URL が分からないので、
 * 左の面は今の URL、右の面はプロジェクトのフォルダ表示 (rightUrl) から始める。
 */
export function migrateLayout(
  raw: SerializedLayout,
  leftUrl: string,
  rightUrl: string,
): Workspace {
  if (raw.version !== LAYOUT_VERSION)
    throw new Error(
      `migrate: layout version is ${JSON.stringify(raw.version)}, expected ${LAYOUT_VERSION}`,
    );
  const { panes, split, focused, ...shared } = raw;
  const left = panes.find((pane) => pane.side === "left");
  const right = panes.find((pane) => pane.side === "right");
  if (!left) throw new Error("migrate: the layout has no left pane");
  const one = (pane: SerializedLayout["panes"][number]): SerializedLayout => ({
    ...shared,
    version: LAYOUT_VERSION,
    focused: "left",
    panes: [{ ...pane, side: "left" }],
  });
  if (!right)
    return {
      version: WORKSPACE_VERSION,
      tree: { pane: "p1" },
      focused: "p1",
      panes: { p1: { url: leftUrl, layout: one(left) } },
    };
  return {
    version: WORKSPACE_VERSION,
    tree: {
      dir: "row",
      ratio: split ?? 0.5,
      a: { pane: "p1" },
      b: { pane: "p2" },
    },
    focused: focused === "right" ? "p2" : "p1",
    panes: {
      p1: { url: leftUrl, layout: one(left) },
      p2: { url: rightUrl, layout: one(right) },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
