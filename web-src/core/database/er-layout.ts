// ER 図のテーブルの箱を並べる。FK の向き (参照する表 → 参照される表) で列を決め、
// 参照される表を左、参照する表を右に置く。関係で繋がった表の塊ごとに並べ、
// 関係を持たない表は最後に格子状に詰める。DOM を持たない計算だけで、箱の大きさは
// 呼び出し側が測って渡す。同じ入力からは常に同じ配置を返す (入力の順を崩さない)。

export type ErLayoutNode = { id: string; width: number; height: number };

/** from が FK を持つ表 (参照する側)、to が参照される表。 */
export type ErLayoutEdge = { from: string; to: string };

export type ErLayoutGap = {
  /** 列 (FK の段) の間。線の端の記号と曲がりが入る幅。 */
  column: number;
  /** 同じ列の中の箱の上下の間。関係を持たない表の格子の間もこれ。 */
  row: number;
  /** 関係で繋がった塊どうしの間。 */
  group: number;
};

export type ErLayout = {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
};

type Placement = { node: number; x: number; y: number };
type Block = { width: number; height: number; places: Placement[] };

// 並べ替えの往復の回数。表の数が数百でも配置が落ち着く回数で、増やしても
// 交差はほとんど減らない。
const ORDER_SWEEPS = 8;

// aspect は図を見せる場所の 幅 / 高さ。FK が長く続いて横に長くなった塊は、
// この比に近づくよう列を何段かに折り返す。
export function layoutErDiagram(
  nodes: readonly ErLayoutNode[],
  edges: readonly ErLayoutEdge[],
  gap: ErLayoutGap,
  aspect: number,
): ErLayout {
  if (!(aspect > 0) || !Number.isFinite(aspect))
    throw new Error(
      `ER layout: aspect must be a positive number, got ${aspect}`,
    );
  const index = new Map<string, number>();
  nodes.forEach((node, i) => {
    if (index.has(node.id))
      throw new Error(
        `ER layout: duplicate table id ${JSON.stringify(node.id)}`,
      );
    index.set(node.id, i);
  });
  const parents = nodes.map(() => new Set<number>());
  const children = nodes.map(() => new Set<number>());
  for (const edge of edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    // 自分自身への FK は列を決めない (線だけ箱の横に回す)。
    if (from === undefined || to === undefined || from === to) continue;
    parents[from].add(to);
    children[to].add(from);
  }

  const groups = connectedGroups(nodes.length, parents, children);
  const linked = groups.filter((group) => group.length > 1);
  linked.sort((a, b) => b.length - a.length);
  const lone = groups.filter((group) => group.length === 1).map((g) => g[0]);

  const blocks = linked.map((group) =>
    layeredBlock(group, nodes, parents, children, gap, aspect),
  );
  const positions = new Map<string, { x: number; y: number }>();
  let width = 0;
  let height = 0;
  const place = (block: Block, x: number, y: number) => {
    for (const p of block.places) {
      positions.set(nodes[p.node].id, { x: x + p.x, y: y + p.y });
    }
    width = Math.max(width, x + block.width);
    height = Math.max(height, y + block.height);
  };

  const loneBlocks: Block[] = lone.map((node) => ({
    width: nodes[node].width,
    height: nodes[node].height,
    places: [{ node, x: 0, y: 0 }],
  }));
  const shelfWidth = Math.max(
    ...blocks.map((b) => b.width),
    ...loneBlocks.map((b) => b.width),
    Math.sqrt(
      aspect *
        [...blocks, ...loneBlocks].reduce(
          (sum, b) => sum + (b.width + gap.group) * (b.height + gap.group),
          0,
        ),
    ),
  );
  let top = shelve(blocks, shelfWidth, gap.group, 0, place);
  if (blocks.length > 0 && loneBlocks.length > 0) top += gap.group;
  shelve(loneBlocks, shelfWidth, gap.row, top, place);
  return { positions, width, height };
}

// 左から詰め、幅を超えたら次の段へ送る。段の高さはその段で一番高い箱。
// 戻り値は最後の段の下端。
function shelve(
  blocks: readonly Block[],
  shelfWidth: number,
  space: number,
  top: number,
  place: (block: Block, x: number, y: number) => void,
): number {
  let x = 0;
  let y = top;
  let shelfHeight = 0;
  for (const block of blocks) {
    if (x > 0 && x + block.width > shelfWidth) {
      y += shelfHeight + space;
      x = 0;
      shelfHeight = 0;
    }
    place(block, x, y);
    x += block.width + space;
    shelfHeight = Math.max(shelfHeight, block.height);
  }
  return y + shelfHeight;
}

function connectedGroups(
  count: number,
  parents: readonly Set<number>[],
  children: readonly Set<number>[],
): number[][] {
  const seen = new Array<boolean>(count).fill(false);
  const groups: number[][] = [];
  for (let start = 0; start < count; start++) {
    if (seen[start]) continue;
    seen[start] = true;
    const group = [start];
    for (let i = 0; i < group.length; i++) {
      for (const next of [...parents[group[i]], ...children[group[i]]]) {
        if (seen[next]) continue;
        seen[next] = true;
        group.push(next);
      }
    }
    group.sort((a, b) => a - b);
    groups.push(group);
  }
  return groups;
}

function layeredBlock(
  group: readonly number[],
  nodes: readonly ErLayoutNode[],
  parents: readonly Set<number>[],
  children: readonly Set<number>[],
  gap: ErLayoutGap,
  aspect: number,
): Block {
  const rank = assignRanks(group, parents);
  const layerCount = Math.max(...group.map((n) => rank.get(n) ?? 0)) + 1;
  const layers: number[][] = Array.from({ length: layerCount }, () => []);
  for (const node of group) layers[rank.get(node) ?? 0].push(node);
  orderLayers(layers, parents, children);

  // 1 つの段に箱が多いと縦に長い 1 列になる (多くの表が参照する表の右など)。
  // 塊を aspect の比の長方形に収めたときの高さを目安にして、超える段は横に
  // 分けた列にする。
  const area = group.reduce(
    (sum, n) =>
      sum + (nodes[n].width + gap.column) * (nodes[n].height + gap.row),
    0,
  );
  const tallestNode = Math.max(...group.map((n) => nodes[n].height));
  const columnLimit = Math.max(tallestNode, Math.sqrt(area / aspect) * 1.2);
  const columns: number[][] = [];
  for (const layer of layers) {
    let column: number[] = [];
    let used = 0;
    for (const node of layer) {
      const h = nodes[node].height;
      if (column.length > 0 && used + gap.row + h > columnLimit) {
        columns.push(column);
        column = [];
        used = 0;
      }
      used += (column.length > 0 ? gap.row : 0) + h;
      column.push(node);
    }
    if (column.length > 0) columns.push(column);
  }

  const columnHeight = (column: readonly number[]) =>
    column.reduce((sum, n) => sum + nodes[n].height, 0) +
    gap.row * (column.length - 1);
  const columnWidth = (column: readonly number[]) =>
    Math.max(...column.map((n) => nodes[n].width));
  const widths = columns.map(columnWidth);
  const totalWidth =
    widths.reduce((sum, w) => sum + w, 0) + gap.column * (columns.length - 1);
  const tallestColumn = Math.max(...columns.map(columnHeight));

  // 列を何段に折り返すか: 段の数ごとの 幅 / 高さ が aspect に一番近いもの。
  let bandCount = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let k = 1; k <= columns.length; k++) {
    const w = totalWidth / k;
    const h = k * tallestColumn + (k - 1) * gap.group;
    const score = Math.abs(Math.log(w / h / aspect));
    if (score < bestScore) {
      bestScore = score;
      bandCount = k;
    }
  }
  const bandLimit = totalWidth / bandCount;
  const bands: number[][] = [[]];
  let used = 0;
  columns.forEach((_, i) => {
    const band = bands[bands.length - 1];
    const extra = (band.length > 0 ? gap.column : 0) + widths[i];
    if (
      band.length > 0 &&
      used + extra > bandLimit &&
      bands.length < bandCount
    ) {
      bands.push([i]);
      used = widths[i];
      return;
    }
    band.push(i);
    used += extra;
  });

  const places: Placement[] = [];
  let top = 0;
  let width = 0;
  for (const band of bands) {
    const bandHeight = Math.max(...band.map((i) => columnHeight(columns[i])));
    let x = 0;
    for (const i of band) {
      // 列ごとに段の上下の中央へ寄せ、短い列の線が段の上端に偏らないようにする。
      let y = top + (bandHeight - columnHeight(columns[i])) / 2;
      for (const node of columns[i]) {
        places.push({ node, x, y });
        y += nodes[node].height + gap.row;
      }
      x += widths[i] + gap.column;
    }
    width = Math.max(width, x - gap.column);
    top += bandHeight + gap.group;
  }
  return { width, height: top - gap.group, places };
}

// 段の番号: 参照される表ほど小さい (左)。循環する FK は深さ優先で戻る辺を
// 外してから数える。どの表も「参照する表のどれよりも 1 つ左」に寄せ、
// 参照される表が左端に取り残されて線が長くなるのを避ける。
function assignRanks(
  group: readonly number[],
  parents: readonly Set<number>[],
): Map<number, number> {
  const inGroup = new Set(group);
  const dagParents = new Map<number, number[]>();
  const state = new Map<number, "open" | "done">();
  for (const root of group) {
    if (state.has(root)) continue;
    // 再帰の深さが表の数に比例しないよう、積み上げで深さ優先にたどる。
    const stack: Array<{ node: number; next: number[] }> = [];
    const enter = (node: number) => {
      state.set(node, "open");
      dagParents.set(node, []);
      stack.push({
        node,
        next: [...parents[node]].filter((p) => inGroup.has(p)),
      });
    };
    enter(root);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const parent = top.next.shift();
      if (parent === undefined) {
        state.set(top.node, "done");
        stack.pop();
        continue;
      }
      const seen = state.get(parent);
      if (seen === "open") continue; // 戻る辺: 循環を断つ
      dagParents.get(top.node)?.push(parent);
      if (seen === undefined) enter(parent);
    }
  }

  const dagChildren = new Map<number, number[]>(group.map((n) => [n, []]));
  for (const [node, ps] of dagParents) {
    for (const p of ps) dagChildren.get(p)?.push(node);
  }
  const rank = new Map<number, number>();
  const longest = (node: number): number => {
    const known = rank.get(node);
    if (known !== undefined) return known;
    const stack = [node];
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const pending = (dagParents.get(current) ?? []).filter(
        (p) => !rank.has(p),
      );
      if (pending.length > 0) {
        stack.push(...pending);
        continue;
      }
      stack.pop();
      if (rank.has(current)) continue;
      const ps = dagParents.get(current) ?? [];
      rank.set(
        current,
        ps.length === 0 ? 0 : Math.max(...ps.map((p) => rank.get(p) ?? 0)) + 1,
      );
    }
    return rank.get(node) ?? 0;
  };
  for (const node of group) longest(node);

  const byRankDesc = [...group].sort(
    (a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0) || a - b,
  );
  for (const node of byRankDesc) {
    const cs = dagChildren.get(node) ?? [];
    if (cs.length === 0) continue;
    rank.set(node, Math.min(...cs.map((c) => rank.get(c) ?? 0)) - 1);
  }
  return rank;
}

// 段の中の並びを、繋がった箱の位置の平均 (重心) で並べ替えて線の交差を減らす。
function orderLayers(
  layers: number[][],
  parents: readonly Set<number>[],
  children: readonly Set<number>[],
): void {
  const position = new Map<number, number>();
  const record = (layer: readonly number[]) => {
    layer.forEach((node, i) => {
      position.set(node, (i + 0.5) / layer.length);
    });
  };
  for (const layer of layers) record(layer);
  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
    const order = sweep % 2 === 0 ? layers : [...layers].reverse();
    for (const layer of order) {
      const weight = new Map<number, number>();
      for (const node of layer) {
        const around = [...parents[node], ...children[node]]
          .map((n) => position.get(n))
          .filter((p): p is number => p !== undefined);
        weight.set(
          node,
          around.length === 0
            ? (position.get(node) ?? 0)
            : around.reduce((sum, p) => sum + p, 0) / around.length,
        );
      }
      layer.sort((a, b) => (weight.get(a) ?? 0) - (weight.get(b) ?? 0));
      record(layer);
    }
  }
}

export type ErBox = { x: number; y: number; width: number; height: number };

export type ErEdgeShape = {
  /** 箱の端から端までの線。 */
  line: string;
  /** 線の両端の記号 (カラスの足と縦棒)。 */
  marks: string;
  /** 「0」を表す白抜きの丸。面の色で塗って線を隠す。 */
  dots: string;
};

// 線の端の寸法。箱の端から STUB だけまっすぐ出し、その上に記号を置く。
const STUB = 20;
const FOOT = 12;
const MARK_HALF = 6;
const NEAR_BAR = 6;
const FAR_MARK = 15;
const DOT_RADIUS = 3.5;
const BEND = 32;

// FK の線の形。from は FK を持つ表の箱と、その列の行の高さ (中心の y)、to は
// 参照される表の箱と列の行の高さ。記号はカラスの足記法:
//   参照する側: 最大が多 (カラスの足) か 1 (列が一意なら)、最小は 0 (丸)
//   参照される側: 最大は 1 (縦棒)、最小は FK が NULL を許せば 0 (丸)、許さなければ 1
// 箱が左右に離れていれば向かい合う端どうしを、縦に重なっていれば (自分自身への
// FK・同じ列の箱) どちらも右の端から出して外側を回す。
export function erEdgeShape(
  from: ErBox,
  fromY: number,
  to: ErBox,
  toY: number,
  ends: { unique: boolean; nullable: boolean },
): ErEdgeShape {
  let sx: number;
  let ds: 1 | -1;
  let tx: number;
  let dt: 1 | -1;
  if (to.x >= from.x + from.width) {
    sx = from.x + from.width;
    ds = 1;
    tx = to.x;
    dt = -1;
  } else if (to.x + to.width <= from.x) {
    sx = from.x;
    ds = -1;
    tx = to.x + to.width;
    dt = 1;
  } else {
    sx = from.x + from.width;
    ds = 1;
    tx = to.x + to.width;
    dt = 1;
  }
  const a = sx + ds * STUB;
  const b = tx + dt * STUB;
  let curve: string;
  if (ds !== dt) {
    const dx = Math.max(BEND, Math.abs(b - a) / 2);
    curve = `C ${n(a + ds * dx)} ${n(fromY)} ${n(b + dt * dx)} ${n(toY)} ${n(b)} ${n(toY)}`;
  } else {
    const bulge = Math.max(a, b) + BEND;
    curve = `C ${n(bulge)} ${n(fromY)} ${n(bulge)} ${n(toY)} ${n(b)} ${n(toY)}`;
  }
  const line = `M ${n(sx)} ${n(fromY)} L ${n(a)} ${n(fromY)} ${curve} L ${n(tx)} ${n(toY)}`;

  const marks: string[] = [];
  const dots: string[] = [];
  const bar = (x: number, y: number) =>
    marks.push(`M ${n(x)} ${n(y - MARK_HALF)} L ${n(x)} ${n(y + MARK_HALF)}`);
  const dot = (x: number, y: number) =>
    dots.push(
      `M ${n(x - DOT_RADIUS)} ${n(y)} a ${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${DOT_RADIUS * 2} 0 a ${DOT_RADIUS} ${DOT_RADIUS} 0 1 0 ${-DOT_RADIUS * 2} 0`,
    );
  if (ends.unique) {
    bar(sx + ds * NEAR_BAR, fromY);
  } else {
    const tip = sx + ds * FOOT;
    marks.push(
      `M ${n(tip)} ${n(fromY)} L ${n(sx)} ${n(fromY - MARK_HALF)} M ${n(tip)} ${n(fromY)} L ${n(sx)} ${n(fromY + MARK_HALF)}`,
    );
  }
  dot(sx + ds * FAR_MARK, fromY);
  bar(tx + dt * NEAR_BAR, toY);
  if (ends.nullable) dot(tx + dt * FAR_MARK, toY);
  else bar(tx + dt * FAR_MARK, toY);
  return { line, marks: marks.join(" "), dots: dots.join(" ") };
}

function n(value: number): string {
  return String(Math.round(value * 10) / 10);
}
