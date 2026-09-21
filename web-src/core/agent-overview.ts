// エージェント一覧 (/agents) とヘッダの件数表示・通知が共有する純ロジック。
//
// 元になるのは、サーバがもう持っているもの 2 つだけ。tmux のペイン一覧と、
// 画面観測・申告で決めた状態 (terminal/activity.ts)。これにペインの cwd から
// 求めたプロジェクトを付けて 1 本の応答にし、画面側はここの関数で束ね・並べ・
// 絞り込む。状態の判定規則そのものはここでは持たない。
//
// DOM にもブラウザ API にも触らないので、束ね方・並び順・未読・通知の条件は
// ここだけで確かめられる。

import type { PaneAccount } from "./agent-accounts";
import type {
  AgentState,
  AgentStateObservationError,
  AgentStateRecord,
  AgentStateSource,
} from "./agent-state";
import type {
  ProjectRegistrySnapshot,
  RegisteredProjectInfo,
} from "./projects";
import { basenameOf } from "./terminal-board";
import type { TmuxPaneId } from "./tmux";

/**
 * エージェントの種類。claude / codex はペインで動いているコマンド名か、
 * フックが名乗った種類で見分ける。それ以外でも状態を申告してきたもの
 * (フックを入れたエージェント) は other にする。どれにも当たらないペインは
 * ただのシェルなどで、種類は null。
 */
export const AGENT_KINDS = ["claude", "codex", "other"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

/** 申告の記録のうち、種類の判定に使う部分。 */
export type AgentKindReport = Pick<AgentStateRecord, "agent" | "ended">;

/**
 * コマンド名と申告から種類を決める。
 *
 * claude の単体版は、版番号の名前を持つ実行ファイル (`2.1.0` など) として
 * 起動するので、tmux の pane_current_command には版番号がそのまま出る。
 * 数字 3 つの形だけを claude とみなす。npm 版は node として動くので、
 * コマンド名からは分からない。フックが名乗った種類で補う。
 *
 * 最後の申告がセッションの終了なら、名乗った種類は使わない (そのペインは
 * もうシェルに戻っている)。
 */
export function agentKindOf(
  command: string,
  source: AgentStateSource | null,
  report: AgentKindReport | null = null,
): AgentKind | null {
  const name = command.trim().toLowerCase();
  if (name === "claude" || /^\d+\.\d+\.\d+$/.test(name)) return "claude";
  if (name === "codex") return "codex";
  if (report?.ended) return null;
  if (report?.agent) return report.agent;
  return source === "hook" ? "other" : null;
}

/** 一覧の 1 行。tmux のペイン 1 つぶん。 */
export type AgentPane = {
  id: TmuxPaneId;
  /** tmux 上の場所 (`session:window.pane`)。 */
  label: string;
  session: string;
  /** ペインのタイトル。AI CLI は作業内容をここに出す。 */
  title: string;
  command: string;
  path: string;
  kind: AgentKind | null;
  state: AgentState;
  /** まだ観測が無ければ null (state は idle のまま)。 */
  source: AgentStateSource | null;
  /**
   * その状態になった時刻 (epoch ms)。変わった瞬間を見ていなければ 0。
   * 見始めた時点で既にその状態だったものに時刻を出すと、実際より短い経過
   * 時間を断定することになるので、ここには入れない。
   */
  updatedAt: number;
  /**
   * updatedAt が 0 のとき、遅くともこの時刻から今の状態だった (見始めた時刻)。
   * 「N 分以上」の下限にだけ使う。分からなければ 0。
   */
  watchedSince: number;
  /** 属するプロジェクトの鍵 (AgentProject.root)。 */
  project: string;
  /**
   * 本体とは別の作業ツリーで動いているとき、その作業ツリーのフォルダ名。
   * 本体や git 管理外では空。
   */
  worktree: string;
  /**
   * このサーバのブラウザシェルのうち、いまこのペインを映しているものの ID。
   * 無ければ空。「そのペインをいま見ているか」の判定に使う。
   */
  shownInShell: string;
  /**
   * claude / codex の行だけ。どのアカウントで動いているか (エージェントの
   * プロセスの CLAUDE_CONFIG_DIR / CODEX_HOME から)。それ以外の行は null。
   */
  account: PaneAccount | null;
};

/**
 * AI CLI がタイトルの頭に付ける状態の記号 (✳ や点字のスピナー)。状態は
 * 別の列で出すので、作業内容の読みやすさを優先して落とす。
 */
const TITLE_STATUS_PREFIX = /^[⠀-⣿✳✻✽✶✢*·•]+\s+/;

export function paneTaskText(pane: AgentPane): string {
  const title = pane.title.replace(TITLE_STATUS_PREFIX, "").trim();
  return title || pane.command;
}

/**
 * ホーム配下のパスを `~/…` に縮める。見出しの横幅をホームの長いパスに
 * 取られないため。ホームそのものは `~`。`/home/sample-old` のように前方だけ
 * 一致するものは縮めない (区切りまで見る)。
 */
export function abbreviateHome(path: string, home: string): string {
  const base = home.replace(/\/+$/, "");
  if (!base) return path;
  if (path === base) return "~";
  if (path.startsWith(`${base}/`)) return `~${path.slice(base.length)}`;
  return path;
}

/** プロジェクトを開いている code-viewer サーバ。 */
export type AgentProjectServer =
  /** この画面を出しているサーバ自身。 */
  | { status: "current" }
  /** launched: code-viewer が起こしたサーバ (一覧のメニューから止められる)。 */
  | { status: "running"; url: string; launched: boolean }
  /** 動いていない。 */
  | { status: "absent" }
  /** 登録はあるが確かめられなかった。理由を出す。 */
  | { status: "unreachable" | "invalid"; detail: string }
  /** git 管理外。サーバの登録簿は git のルートで引くので調べない。 */
  | { status: "none" };

export type AgentProjectInfo = {
  /**
   * 束ねる鍵。git の本体の作業ツリーのルート。worktree で動いているペインも
   * 本体のルートに寄せる。git 管理外ならペインの cwd そのもの。
   */
  root: string;
  /** 表示名。root のフォルダ名。 */
  name: string;
  /** 見出しに出すパス。ホーム配下は `~/…` に縮める (全体は root)。 */
  displayRoot: string;
  git: boolean;
  /** git を呼べなかったときの理由。空なら問題なし。 */
  error: string;
  server: AgentProjectServer;
  /**
   * 登録したプロジェクトなら、その登録 (表示名は name に反映済み)。
   * 登録していなければ null。
   */
  registered: RegisteredProjectInfo | null;
};

export type AgentOverviewResponse = {
  /**
   * 応答したサーバのプロセスを見分ける値。状態はサーバのメモリにしか無いので、
   * これが変わったら (サーバの再起動) 前回の状態と比べてはいけない。比べると、
   * 覚え直す前の「待機」を「作業中から止まった」と取り違えて通知してしまう。
   */
  serverInstance: string;
  tmux: {
    /** tmux の実行ファイルが在るか。 */
    available: boolean;
    /** tmux サーバが動いているか。 */
    running: boolean;
    /** 一覧を取れなかった理由。空なら取れた。 */
    error: string;
  };
  panes: AgentPane[];
  /**
   * ペインから見つかったプロジェクトと、登録したプロジェクト (エージェントが
   * 居なくても載る) を合わせたもの。同じ git ルートは 1 つ。
   */
  projects: AgentProjectInfo[];
  /** 画面観測の失敗 (/_agent/states と同じもの)。 */
  errors: AgentStateObservationError[];
  /** 登録簿そのもの (読めなかった理由を含む)。 */
  registry: ProjectRegistrySnapshot;
};

/**
 * 並べるときの状態の順位。小さいほど上。人間の番のもの (入力待ち、
 * 終わったが未読) が先、次に作業中。
 */
const STATE_RANK: Record<AgentState, number> = {
  waiting: 0,
  done: 1,
  working: 2,
  idle: 3,
};

/** 絞り込みの札。done は「終わった」ものなので待機に含める。 */
export const AGENT_STATE_FILTERS = [
  "all",
  "waiting",
  "working",
  "idle",
] as const;

export type AgentStateFilter = (typeof AGENT_STATE_FILTERS)[number];

export function isAgentStateFilter(value: unknown): value is AgentStateFilter {
  return (
    typeof value === "string" &&
    (AGENT_STATE_FILTERS as readonly string[]).includes(value)
  );
}

export function matchesStateFilter(
  state: AgentState,
  filter: AgentStateFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "idle") return state === "idle" || state === "done";
  return state === filter;
}

export type AgentListFilter = {
  /** false ならエージェントが動いているペインだけ。 */
  allPanes: boolean;
  state: AgentStateFilter;
};

export function filterAgentPanes(
  panes: AgentPane[],
  filter: AgentListFilter,
): AgentPane[] {
  return panes.filter(
    (pane) =>
      (filter.allPanes || pane.kind !== null) &&
      matchesStateFilter(pane.state, filter.state),
  );
}

/**
 * 同じプロジェクトの中の並び。状態の順位、同じ順位なら状態が変わったのが
 * 新しい順。時刻の分からない行 (0) はその順位の最後。それも同じなら tmux の
 * 並び順のまま (sort は安定)。
 */
function comparePanes(a: AgentPane, b: AgentPane): number {
  const rank = STATE_RANK[a.state] - STATE_RANK[b.state];
  if (rank !== 0) return rank;
  return b.updatedAt - a.updatedAt;
}

export type AgentProjectGroup = {
  info: AgentProjectInfo;
  panes: AgentPane[];
  counts: Record<AgentState, number>;
};

export function countAgentStates(
  panes: AgentPane[],
): Record<AgentState, number> {
  const counts: Record<AgentState, number> = {
    working: 0,
    waiting: 0,
    done: 0,
    idle: 0,
  };
  for (const pane of panes) counts[pane.state] += 1;
  return counts;
}

/**
 * 並びの段。人間の番のもの (入力待ち・完了) と作業中を含むプロジェクトが
 * 先 (0)。それ以外は、登録したプロジェクト (利用者が決めた順, 1) →
 * 登録していないプロジェクト (2)。
 */
function projectTier(group: AgentProjectGroup): number {
  const [head] = group.panes;
  if (head && head.state !== "idle") return 0;
  return group.info.registered ? 1 : 2;
}

function compareGroups(a: AgentProjectGroup, b: AgentProjectGroup): number {
  const tier = projectTier(a) - projectTier(b);
  if (tier !== 0) return tier;
  const [headA] = a.panes;
  const [headB] = b.panes;
  if (projectTier(a) === 1) {
    const order =
      (a.info.registered?.order ?? 0) - (b.info.registered?.order ?? 0);
    if (order !== 0) return order;
  } else if (headA && headB) {
    const byHead = comparePanes(headA, headB);
    if (byHead !== 0) return byHead;
  }
  return a.info.name.localeCompare(b.info.name);
}

/**
 * ペインをプロジェクトごとに束ねて並べる。
 *
 * プロジェクトの並びは compareGroups (入力待ち・完了・作業中を含むものが
 * 中の一番上の行と同じ規則で先、次に登録順、最後に登録していないもの)。
 *
 * ペインが 1 つも残らないプロジェクトは、登録したものだけ includeEmpty の
 * ときに見出しだけで出す (絞り込み中は出さない)。
 */
export function groupAgentPanes(
  panes: AgentPane[],
  projects: AgentProjectInfo[],
  options: { includeEmptyRegistered?: boolean } = {},
): AgentProjectGroup[] {
  const infoByRoot = new Map(projects.map((info) => [info.root, info]));
  const byRoot = new Map<string, AgentPane[]>();
  for (const pane of panes) {
    const list = byRoot.get(pane.project);
    if (list) list.push(pane);
    else byRoot.set(pane.project, [pane]);
  }
  const groups: AgentProjectGroup[] = [];
  for (const [root, list] of byRoot) {
    const sorted = [...list].sort(comparePanes);
    groups.push({
      info: infoByRoot.get(root) ?? {
        root,
        name: basenameOf(root),
        displayRoot: root,
        git: false,
        error: "",
        server: { status: "none" },
        registered: null,
      },
      panes: sorted,
      counts: countAgentStates(sorted),
    });
  }
  if (options.includeEmptyRegistered) {
    for (const info of projects) {
      if (!info.registered || byRoot.has(info.root)) continue;
      groups.push({ info, panes: [], counts: countAgentStates([]) });
    }
  }
  return groups.sort(compareGroups);
}

/** ヘッダの件数表示に出す数。エージェントのペインだけを数える。 */
export function headerAgentCounts(panes: AgentPane[]): {
  waiting: number;
  working: number;
} {
  let waiting = 0;
  let working = 0;
  for (const pane of panes) {
    if (pane.kind === null) continue;
    if (pane.state === "waiting") waiting += 1;
    else if (pane.state === "working") working += 1;
  }
  return { waiting, working };
}

/**
 * 知らせる変化。作業中から入力待ちに変わったか、作業中から止まった
 * (待機か、申告による完了) か。
 */
export type AgentTransition = "waiting" | "finished";

export function agentTransition(
  previous: AgentState | undefined,
  next: AgentState,
): AgentTransition | null {
  // 完了は申告でしか出ないので、作業中を見逃していても確かな変化として扱う
  // (1.5 秒おきの取り直しの間に始まって終わったターンも拾う)。
  if (next === "done" && previous !== undefined && previous !== "done") {
    return "finished";
  }
  if (previous !== "working") return null;
  if (next === "waiting") return "waiting";
  if (next === "idle" || next === "done") return "finished";
  return null;
}

export type AgentUnreadUpdate = {
  /** 更新後の未読。ペイン ID → 何で未読になったか。 */
  unread: Map<TmuxPaneId, AgentTransition>;
  /** 今回新たに起きた変化。通知の候補。 */
  transitions: { pane: AgentPane; transition: AgentTransition }[];
};

/**
 * 前回の状態と今回の一覧から、未読と通知候補を求める。
 *
 * - 前回が無い (最初の取得) ときは何も起きたことにしない。開いた瞬間に
 *   既に止まっているものを全部「今終わった」と言わないため
 * - エージェントのペインだけを見る
 * - いま見ているペインは未読にしない。既に未読でも、見た時点で解く
 *   (ターミナルのツリーから開いた場合も含め、見えたら読んだことになる)
 * - 作業中に戻ったものは未読を解く (誰かが応えて再開した)
 * - 消えたペインの未読は落とす
 */
export function nextAgentUnread(
  unread: ReadonlyMap<TmuxPaneId, AgentTransition>,
  previous: ReadonlyMap<TmuxPaneId, AgentState> | null,
  panes: AgentPane[],
  viewing: (pane: AgentPane) => boolean,
): AgentUnreadUpdate {
  const next = new Map<TmuxPaneId, AgentTransition>();
  const transitions: AgentUnreadUpdate["transitions"] = [];
  for (const pane of panes) {
    if (pane.kind === null) continue;
    const kept = unread.get(pane.id);
    const seen = viewing(pane);
    if (kept && pane.state !== "working" && !seen) next.set(pane.id, kept);
    if (!previous) continue;
    const transition = agentTransition(previous.get(pane.id), pane.state);
    if (!transition) continue;
    transitions.push({ pane, transition });
    if (!seen) next.set(pane.id, transition);
  }
  return { unread: next, transitions };
}

export type AgentNotifySettings = {
  waiting: boolean;
  finished: boolean;
};

export type AgentNotifyContext = {
  settings: AgentNotifySettings;
  /** Notification.permission。API が無ければ unsupported。 */
  permission: "granted" | "denied" | "default" | "unsupported";
  /** タブが前面で、そのペインをいまターミナルで見ているか。 */
  viewing: boolean;
};

/** ブラウザの通知を出すか。 */
export function shouldNotifyAgent(
  transition: AgentTransition,
  context: AgentNotifyContext,
): boolean {
  if (context.permission !== "granted") return false;
  if (context.viewing) return false;
  return transition === "waiting"
    ? context.settings.waiting
    : context.settings.finished;
}

/** タブのタイトル。未読があれば先頭に件数を付ける。 */
export function titleWithUnread(base: string, unread: number): string {
  return unread > 0 ? `(${unread}) ${base}` : base;
}
