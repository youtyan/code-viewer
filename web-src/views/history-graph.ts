// 履歴の一覧の左の列に描くグラフ (枝の線と節点)。
//
// 一覧に並んだ順 (新しい順) のコミットと親から、各行で「どの列に節点を置くか」
// 「上から来て下へ抜ける線」「節点へ合流する線」「節点から分かれる線」を決める。
// 描くのは一覧の行の中の小さな SVG で、行の高さは CSS が決める (縦の位置は
// 行の高さに対する割合で書く)。
//
// 一覧が全体の履歴でないとき (絞り込み中・1 ファイルの履歴) は、並んだ行が
// 親子とは限らない。そのときは linear で呼び、行を上から順につないだ 1 本の
// 線にする (枝を作り話で描かない)。

export type GraphCommit = {
  readonly sha: string;
  readonly parents: readonly string[];
};

export type GraphRow = {
  /** 節点を置く列。 */
  readonly lane: number;
  /** 行の上端から下端まで素通りする列。 */
  readonly through: readonly number[];
  /** 上の行から節点へ入る線があるか (この節点を親として待つ子がいた)。 */
  readonly fromAbove: boolean;
  /** 節点から真下へ出る線があるか (最初の親へ続く)。 */
  readonly toBelow: boolean;
  /** 上端のこの列から節点へ合流する線 (同じ親を待っていた別の枝)。 */
  readonly mergeFrom: readonly number[];
  /** 節点から下端のこの列へ分かれる線 (2 つ目以降の親)。 */
  readonly branchTo: readonly number[];
};

export type Graph = {
  readonly rows: readonly GraphRow[];
  /** 一覧のどこかで使う列の数 (列の幅をそろえるため)。 */
  readonly lanes: number;
};

function firstFree(lanes: (string | null)[], skip: number): number {
  for (let i = 0; i < lanes.length; i++) {
    if (i !== skip && lanes[i] === null) return i;
  }
  return lanes.length;
}

function occupied(lanes: readonly (string | null)[]): number[] {
  const out: number[] = [];
  lanes.forEach((sha, i) => {
    if (sha !== null) out.push(i);
  });
  return out;
}

export function buildHistoryGraph(
  commits: readonly GraphCommit[],
  options: { linear: boolean },
): Graph {
  const source = options.linear
    ? commits.map((commit, i) => ({
        sha: commit.sha,
        parents: i + 1 < commits.length ? [commits[i + 1].sha] : [],
      }))
    : commits;
  // 列ごとに「次にここへ来るはずのコミット」。null は空いている列。
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  // 既に上に出たコミット。時刻が同じだと親が子より上に並ぶことがあり、その親を
  // 待つ列を取ると線が一覧の下端まで伸び続ける (つなぐ先が下に無い)。
  const seen = new Set<string>();
  let width = 0;
  for (const commit of source) {
    seen.add(commit.sha);
    let lane = lanes.indexOf(commit.sha);
    const fromAbove = lane >= 0;
    if (lane < 0) {
      lane = firstFree(lanes, -1);
      lanes[lane] = commit.sha;
    }
    const mergeFrom: number[] = [];
    lanes.forEach((sha, i) => {
      if (i !== lane && sha === commit.sha) mergeFrom.push(i);
    });
    const through = occupied(lanes).filter(
      (i) => i !== lane && !mergeFrom.includes(i),
    );
    for (const i of mergeFrom) lanes[i] = null;
    const [first, ...rest] = commit.parents.filter(
      (parent) => !seen.has(parent),
    );
    lanes[lane] = first ?? null;
    const branchTo: number[] = [];
    for (const parent of rest) {
      const existing = lanes.indexOf(parent);
      if (existing >= 0) {
        branchTo.push(existing);
        continue;
      }
      const free = firstFree(lanes, lane);
      lanes[free] = parent;
      branchTo.push(free);
    }
    width = Math.max(width, lanes.length);
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({
      lane,
      through,
      fromAbove,
      toBelow: first !== undefined,
      mergeFrom,
      branchTo,
    });
  }
  return { rows, lanes: Math.max(width, 1) };
}

/** 行と行の間 (日付の見出しの行など) を素通りする列。次の行の上端と同じ。 */
export function passingLanes(row: GraphRow | undefined): number[] {
  if (!row) return [];
  const lanes = [...row.through, ...row.mergeFrom];
  if (row.fromAbove) lanes.push(row.lane);
  return lanes.sort((a, b) => a - b);
}

/** 1 列の幅 (px)。SVG の幅はこれと列の数から決まり、CSS は SVG の幅に従う。 */
export const GRAPH_LANE_WIDTH = 12;

function laneX(lane: number): number {
  return lane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2;
}

function laneClass(lane: number): string {
  return lane === 0 ? "history-graph-main" : "history-graph-branch";
}

function vertical(lane: number, from: string, to: string): string {
  const x = laneX(lane);
  return `<line class="${laneClass(lane)}" x1="${x}" y1="${from}" x2="${x}" y2="${to}"/>`;
}

/** コミットの行の SVG。 */
export function historyGraphSvg(row: GraphRow, lanes: number): string {
  const width = lanes * GRAPH_LANE_WIDTH;
  const parts: string[] = [];
  for (const lane of row.through) parts.push(vertical(lane, "0", "100%"));
  if (row.fromAbove) parts.push(vertical(row.lane, "0", "50%"));
  if (row.toBelow) parts.push(vertical(row.lane, "50%", "100%"));
  const nodeX = laneX(row.lane);
  for (const lane of row.mergeFrom) {
    parts.push(
      `<line class="${laneClass(lane)}" x1="${laneX(lane)}" y1="0" x2="${nodeX}" y2="50%"/>`,
    );
  }
  for (const lane of row.branchTo) {
    parts.push(
      `<line class="${laneClass(lane)}" x1="${nodeX}" y1="50%" x2="${laneX(lane)}" y2="100%"/>`,
    );
  }
  parts.push(
    `<circle class="${laneClass(row.lane)} history-graph-node" cx="${nodeX}" cy="50%" r="3"/>`,
  );
  return `<svg class="history-graph" width="${width}" aria-hidden="true">${parts.join("")}</svg>`;
}

/** 行と行の間に挟まる行 (日付の見出し) の SVG。素通りする線だけ。 */
export function historyGraphPassSvg(
  lanesThrough: readonly number[],
  lanes: number,
): string {
  const width = lanes * GRAPH_LANE_WIDTH;
  const parts = lanesThrough.map((lane) => vertical(lane, "0", "100%"));
  return `<svg class="history-graph" width="${width}" aria-hidden="true">${parts.join("")}</svg>`;
}
