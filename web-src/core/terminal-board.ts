// ドロワーに並べる 1 行を組み立てる。
//
// 元になるものが 3 つある。tmux のペイン一覧、ブラウザシェルの一覧、そして
// サーバが持っている状態。これを 1 本の行にまとめるので、画面側は tmux か
// シェルかを気にせず同じ表に流し込める。
//
// 「1 つのリポジトリでエージェントを大量に走らせる」のが前提なので、見分ける
// 軸はリポジトリではなく「いま何をしているか」に置く。tmux 上のエージェントは
// 作業内容をペインタイトルに出すため、これがそのまま使える。
//
// DOM を触らないので、並び順と絞り込みの規則はここだけで確かめられる。

import type {
  AgentState,
  AgentStateRecord,
  AgentStateSource,
} from "./agent-state";
import { needsAttention } from "./agent-state";
import type { ShellSession } from "./shell";
import type { TmuxPanesResponse } from "./tmux";

export type BoardRowKind = "tmux" | "shell";

/**
 * 出す範囲。既定はこのリポジトリ。tmux サーバは 1 つで全プロジェクトの
 * エージェントが同居するので、既定を「すべて」にすると件数も「あなたの番」も
 * 他プロジェクトの作業で埋まり、この画面の意味が無くなる。
 */
export type BoardScope = "repo" | "all";

export type BoardRow = {
  /** tmux ペイン ID かシェルのセッション ID。選択と申告の宛先。 */
  target: string;
  kind: BoardRowKind;
  /** いま何をしているか。一覧の主役。 */
  task: string;
  /** どこで動いているか。worktree を切っていればその名前になる。 */
  place: string;
  /** tmux の 0:1.2 や、シェルを開いた時刻。 */
  locator: string;
  /** tmux のセッション名。シェルは空。横タブの振り分けに使う。 */
  session: string;
  /** tmux のウィンドウ見出し (`1 · test`)。シェルは空。 */
  window: string;
  /** tmux のペイン番号。行の頭に出して入れ子を見せる。シェルは空。 */
  paneIndex: string;
  /** このリポジトリの作業ツリー配下か。シェルは常に true。 */
  inRepo: boolean;
  /** 動いているコマンド名。 */
  agent: string;
  state: AgentState;
  /** 状態の出どころ。まだ何も分かっていなければ null。 */
  source: AgentStateSource | null;
  lastPrompt: string;
  note: string;
  /** 状態が変わった時刻 (epoch ms)。分かっていなければ 0。 */
  updatedAt: number;
  cols: number;
  rows: number;
  /** シェルだけ。終了済みかどうか。 */
  exited: boolean;
};

/** パスの末尾。worktree を切っていれば、その名前がここに出る。 */
export function basenameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

/**
 * 状態が分かっていない対象の既定値。
 *
 * 「稼働」にすると、実際は止まっているものまで動いて見える。「停止」にすると、
 * 待っているものを見落とす。どちらも嘘になるので、観測が入るまでは停止として
 * 出し、人間の番には数えない (needsAttention が false)。
 */
const UNKNOWN_STATE: AgentState = "idle";

function toRow(
  base: Omit<
    BoardRow,
    "state" | "source" | "lastPrompt" | "note" | "updatedAt"
  >,
  record: AgentStateRecord | undefined,
): BoardRow {
  return {
    ...base,
    state: record?.state ?? UNKNOWN_STATE,
    source: record?.source ?? null,
    lastPrompt: record?.lastPrompt ?? "",
    note: record?.note ?? "",
    updatedAt: record?.updatedAt ?? 0,
  };
}

export function buildBoardRows(
  panes: TmuxPanesResponse | null,
  shells: ShellSession[],
  states: AgentStateRecord[],
): BoardRow[] {
  const byTarget = new Map(states.map((record) => [record.target, record]));
  const rows: BoardRow[] = [];

  // セッション → ウィンドウ → ペインの入れ子をそのまま辿る。平坦化すると
  // どのウィンドウのペインかが行から消え、tmux 側の構造が見えなくなる。
  for (const session of panes?.sessions ?? []) {
    for (const window of session.windows) {
      const windowLabel = window.name
        ? `${window.index} · ${window.name}`
        : String(window.index);
      for (const pane of window.panes) {
        rows.push(
          toRow(
            {
              target: pane.id,
              kind: "tmux",
              // タイトルが空のペインもある (起動直後など)。その場合はコマンド名。
              task: pane.title || pane.command,
              place: basenameOf(pane.path),
              locator: pane.label,
              session: session.name,
              window: windowLabel,
              paneIndex: String(pane.paneIndex),
              inRepo: pane.inRepo,
              agent: pane.command,
              cols: pane.width,
              rows: pane.height,
              exited: false,
            },
            byTarget.get(pane.id),
          ),
        );
      }
    }
  }

  for (const session of shells) {
    rows.push(
      toRow(
        {
          target: session.id,
          kind: "shell",
          task: session.command,
          place: basenameOf(session.cwd),
          // 開いた時刻。同じコマンドのシェルを並べたときの見分けになる。
          locator: session.createdAt.slice(11, 16),
          session: "",
          window: "",
          paneIndex: "",
          // シェルはこのサーバが開いたものなので、必ずこのリポジトリ。
          inRepo: true,
          agent: basenameOf(session.command),
          cols: session.cols,
          rows: session.rows,
          exited: session.exited,
        },
        byTarget.get(session.id),
      ),
    );
  }

  // 並べ替えない。tmux で見えている順のまま返すことで、タブの並びもウィンドウ
  // の中のペインの並びも動かなくなる。状態で並べ替えるのは上段のボードだけ。
  // ここで並べ替えると、状態が変わるたびにタブが入れ替わって狙って押せない。
  return rows;
}

/**
 * 人間の番のものが先。その中では待たせている順 (古い順) に並べる。
 *
 * 待たせている時間が分からない行 (updatedAt が 0) は最後に回す。先頭に来ると、
 * 何も分かっていない行が一番目立つ場所を占めてしまう。
 */
export function sortBoardRows(rows: BoardRow[]): BoardRow[] {
  return [...rows].sort((a, b) => {
    const mine =
      Number(needsAttention(b.state)) - Number(needsAttention(a.state));
    if (mine !== 0) return mine;
    if (a.updatedAt === 0 || b.updatedAt === 0) {
      return (a.updatedAt === 0 ? 1 : 0) - (b.updatedAt === 0 ? 1 : 0);
    }
    return a.updatedAt - b.updatedAt;
  });
}

/**
 * 人間の番の行だけ。上段のボードに出す。
 *
 * ここだけは並べ替える。待たせている順に出したいのと、カードは押す場所が
 * 決まっていないので並びが変わっても困らないため。
 */
export function attentionRows(rows: BoardRow[]): BoardRow[] {
  return sortBoardRows(rows.filter((row) => needsAttention(row.state)));
}

export type BoardCounts = Record<AgentState, number>;

export function countBoardStates(rows: BoardRow[]): BoardCounts {
  const counts: BoardCounts = { working: 0, waiting: 0, done: 0, idle: 0 };
  for (const row of rows) counts[row.state] += 1;
  return counts;
}

/** 出す範囲で絞る。ここを通した結果が、件数にも「あなたの番」にも効く。 */
export function filterByScope(rows: BoardRow[], scope: BoardScope): BoardRow[] {
  return scope === "all" ? rows : rows.filter((row) => row.inRepo);
}

/** 横タブに並べる見出し。tmux のセッション名を出現順に、重複なく返す。 */
export function sessionNames(rows: BoardRow[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    if (row.kind !== "tmux" || !row.session) continue;
    if (!names.includes(row.session)) names.push(row.session);
  }
  return names;
}

export type WindowGroup = { window: string; rows: BoardRow[] };

/**
 * 1 つのセッションの中を、ウィンドウごとにまとめる。tmux の並び順をそのまま
 * 保つので、見出しの順は tmux で見たときと同じになる。
 */
export function groupByWindow(
  rows: BoardRow[],
  session: string,
): WindowGroup[] {
  const groups: WindowGroup[] = [];
  for (const row of rows) {
    if (row.kind !== "tmux" || row.session !== session) continue;
    const found = groups.find((group) => group.window === row.window);
    if (found) found.rows.push(row);
    else groups.push({ window: row.window, rows: [row] });
  }
  return groups;
}

export type BoardFilter = {
  /** null なら状態で絞らない。 */
  state: AgentState | null;
  /** 空なら文字で絞らない。 */
  query: string;
};

/** 絞り込み。状態と、タスク・置き場所・宛先への部分一致。 */
export function filterBoardRows(
  rows: BoardRow[],
  filter: BoardFilter,
): BoardRow[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.state !== null && row.state !== filter.state) return false;
    if (!query) return true;
    return [row.task, row.place, row.locator, row.agent, row.target].some(
      (field) => field.toLowerCase().includes(query),
    );
  });
}

/**
 * 経過時間の粗い刻み。秒まで出すと 1 秒ごとに描き直すことになるので、分から。
 * 1 分未満は「たった今」に丸める。
 */
export function elapsedBucket(ms: number): {
  unit: "now" | "minute" | "hour" | "day";
  value: number;
} {
  if (!Number.isFinite(ms) || ms < 60_000) return { unit: "now", value: 0 };
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { unit: "minute", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hour", value: hours };
  return { unit: "day", value: Math.floor(hours / 24) };
}
