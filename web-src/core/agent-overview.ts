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
import {
  type AgentAttention,
  type AgentConversation,
  type AgentState,
  type AgentStateObservationError,
  type AgentStateRecord,
  type AgentStateSource,
  needsAttention,
} from "./agent-state";
import type {
  ProjectRegistrySnapshot,
  RegisteredProjectInfo,
} from "./projects";
import { basenameOf } from "./terminal-board";
import type { TmuxClientWindow, TmuxPaneId } from "./tmux";

/**
 * エージェントの種類。claude / codex / opencode はペインで動いているコマンド名か、
 * フックが名乗った種類で見分ける。それ以外でも状態を申告してきたもの
 * (フックを入れたエージェント) は other にする。どれにも当たらないペインは
 * ただのシェルなどで、種類は null。
 */
export const AGENT_KINDS = ["claude", "codex", "opencode", "other"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

/** 申告の記録のうち、種類の判定に使う部分。 */
export type AgentKindReport = Pick<AgentStateRecord, "agent" | "ended">;

/** プロセスの引数から決まる種類 (フックを名乗らないので other は無い)。 */
export type ProcessAgentKind = Exclude<AgentKind, "other">;

/**
 * 中のプログラムで種類が決まる前面のコマンド (インタプリタ)。npm で入れた
 * claude・codex・opencode は `node` などとして動き、tmux の pane_current_command
 * にはインタプリタの名前が出る。
 */
const INTERPRETERS = new Set(["node", "nodejs", "bun", "deno"]);

/** `<シェル> -c '<コマンド>' …` を包みとしてほどくシェル。 */
const WRAPPING_SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish"]);

export function isInterpreterCommand(command: string): boolean {
  return INTERPRETERS.has(command.trim().toLowerCase());
}

/** 実行ファイルの名前だけで決まる種類 (agentKindOf のコマンド名と同じ決まり)。 */
function kindOfProgramName(name: string): ProcessAgentKind | null {
  if (name === "claude" || /^\d+\.\d+\.\d+$/.test(name)) return "claude";
  if (name === "codex") return "codex";
  if (name === "opencode") return "opencode";
  return null;
}

/**
 * インタプリタが動かしているスクリプトの場所から決める種類。npm の
 * パッケージの場所 (`…/@anthropic-ai/claude-code/cli.js` など) か、
 * bin のリンクの名前 (`…/bin/claude`)。
 */
function kindOfScript(path: string): ProcessAgentKind | null {
  if (path.includes("/@anthropic-ai/claude-code/")) return "claude";
  if (path.includes("/@openai/codex/")) return "codex";
  if (path.includes("/opencode-ai/")) return "opencode";
  const name = (path.split("/").pop() ?? "")
    .toLowerCase()
    .replace(/\.(c|m)?js$|\.ts$/, "");
  return name === "claude" || name === "codex" || name === "opencode"
    ? name
    : null;
}

/**
 * 前面のプロセスの引数 (`ps -o args=` の 1 行。引用符は付かず空白で区切られる)
 * から種類を決める。インタプリタなら最初のスクリプトの引数、対話シェルの包み
 * (`zsh -ic 'claude "$@"' zsh …`) なら -c の次の語を見る。決められなければ null。
 * 引数に空白を含むパスは切れるので決められないことがある (null に倒す)。
 */
export function agentKindFromArgs(args: string): ProcessAgentKind | null {
  let words = args
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^['"]+|['"]+$/g, ""))
    .filter(Boolean);
  // 包みの中にまた包みがあっても、ほどくのは数段まで。
  for (let depth = 0; depth < 4 && words.length > 0; depth += 1) {
    const name = (words[0]?.split("/").pop() ?? "").toLowerCase();
    const direct = kindOfProgramName(name);
    if (direct) return direct;
    if (INTERPRETERS.has(name)) {
      const script = words
        .slice(1)
        .find((word) => !word.startsWith("-") && word !== "run");
      return script ? kindOfScript(script) : null;
    }
    if (WRAPPING_SHELLS.has(name)) {
      const flag = words.findIndex(
        (word, index) => index > 0 && /^-[a-z]*c[a-z]*$/i.test(word),
      );
      if (flag < 0) return null;
      words = words.slice(flag + 1);
      continue;
    }
    return null;
  }
  return null;
}

/**
 * コマンド名と申告から種類を決める。
 *
 * claude の単体版は、版番号の名前を持つ実行ファイル (`2.1.0` など) として
 * 起動するので、tmux の pane_current_command には版番号がそのまま出る。
 * 数字 3 つの形だけを claude とみなす。npm 版は node として動くので、
 * コマンド名からは分からない。前面のプロセスの引数から当てた種類
 * (processKind。agentKindFromArgs) と、フックが名乗った種類で補う。
 *
 * 最後の申告がセッションの終了なら、名乗った種類は使わない (そのペインは
 * もうシェルに戻っている)。
 */
export function agentKindOf(
  command: string,
  source: AgentStateSource | null,
  report: AgentKindReport | null = null,
  processKind: ProcessAgentKind | null = null,
): AgentKind | null {
  const name = command.trim().toLowerCase();
  // opencode は単体の実行ファイル (`opencode`) として動く。
  const direct = kindOfProgramName(name);
  if (direct) return direct;
  // インタプリタ (node など) の中のプログラムを引数から当てたもの
  // (server/terminal/process-kind.ts。コマンドがインタプリタのときだけ調べる)。
  if (processKind && isInterpreterCommand(name)) return processKind;
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
  /** ウインドウの番号 (`#{window_index}`)。タブが映していた場所として保存する (TmuxPlace)。 */
  window: number;
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
  /**
   * フックが渡した会話の場所 (core/agent-state.ts の AgentConversation)。
   * フックが無い・まだ申告が来ていない・セッションが終わったペインと、
   * この欄を持たない古い版のサーバでは無い。
   */
  conversation?: AgentConversation;
  /**
   * 入力待ちの理由 (許可・質問・エラーで停止)。フックが知らせた入力待ちの
   * ペインだけ。古い版のサーバには無い。
   */
  attention?: AgentAttention;
  /**
   * このペインを起こしたエージェントのペイン (tmux の `@agent-parent`)。親が
   * 一覧に居れば、行を親の下に字下げして並べる (nestAgentPanes)。
   */
  parent?: TmuxPaneId;
};

/**
 * AI CLI がタイトルの頭に付ける状態の記号 (✳ や点字のスピナー)。状態は
 * 別の列で出すので、作業内容の読みやすさを優先して落とす。
 */
const TITLE_STATUS_PREFIX = /^[⠀-⣿✳✻✽✶✢*·•]+\s+/;

/**
 * opencode が題名の頭に付ける自分の名前 (`OC | <会話の題>`。1.19.5 で観測)。
 * 種類は別の列で出すので落とす。opencode のペインに限る。
 */
const OPENCODE_TITLE_PREFIX = /^OC \| /;

export function paneTaskText(pane: AgentPane): string {
  let title = pane.title.replace(TITLE_STATUS_PREFIX, "");
  if (pane.kind === "opencode")
    title = title.replace(OPENCODE_TITLE_PREFIX, "");
  title = title.trim();
  return title || pane.command;
}

/**
 * 作業の要約。AI CLI が書いた説明的な題名だけを返し、tmux / shell の既定の
 * 題名は null: 空・コマンド名・状態の記号も無い ASCII の 1 語 (ホスト名など)。
 * 空白を含むか ASCII 以外を含む題名、状態の記号を取った題名は要約とみなす。
 */
export function paneTaskSummary(pane: AgentPane): string | null {
  const raw = pane.title.trim();
  const summary = paneTaskText(pane);
  if (!raw || summary === pane.command) return null;
  if (summary === raw && !/\s/.test(raw) && !/[^\p{ASCII}]/u.test(raw))
    return null;
  return summary;
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
  /**
   * 開けないプロジェクト (git の外で、登録もしていないペインの作業場所)。
   * サーバを調べない。
   */
  | { status: "none" };

export type AgentProjectInfo = {
  /**
   * 束ねる鍵。git の本体の作業ツリーのルート。worktree で動いているペインも
   * 本体のルートに寄せる。git 管理外なら、それを含む登録したプロジェクト (git の
   * 外のフォルダを登録したもの) の根、無ければペインの cwd そのもの。
   */
  root: string;
  /** 表示名。root のフォルダ名。 */
  name: string;
  /** 見出しに出すパス。ホーム配下は `~/…` に縮める (全体は root)。 */
  displayRoot: string;
  /**
   * git のリポジトリか。開ける・エージェントを起動できるかは、これではなく
   * projectOpenable (git の外のフォルダも登録すれば開ける)。
   */
  git: boolean;
  /** git を呼べなかったときの理由。空なら問題なし。 */
  error: string;
  server: AgentProjectServer;
  /**
   * 登録したプロジェクトなら、その登録 (表示名は name に反映済み)。
   * 登録していなければ null。
   */
  registered: RegisteredProjectInfo | null;
  /**
   * 今のブランチと上流との差 (左のサイドバーの行)。まだ読んでいない・git でない・
   * 読めなかった (理由は errors) ときは無い。この欄を持たない古い版のサーバでも無い。
   */
  branch?: {
    branch: string | null;
    ahead: number;
    behind: number;
    upstream: boolean;
  };
};

/**
 * プロジェクトとして開ける (裏を起こせる・エージェントを起動できる) か。git の
 * リポジトリか、登録したプロジェクト (git の外のフォルダも登録できる)。git の外で
 * 登録していないペインの作業場所 (一時フォルダなど) は開かない: 押しただけで
 * 任意の作業場所がプロジェクトに加わらないように、先に登録してもらう。
 */
export function projectOpenable(
  info: Pick<AgentProjectInfo, "git" | "registered">,
): boolean {
  return info.git || info.registered !== null;
}

/**
 * 左のサイドバーの行の、名前の後ろの補足: 主でないブランチと上流との差 (`feature ↑2 ↓1`)。
 * main・master と、プロジェクトの名前と同じブランチ (worktree はたいていブランチの名前)
 * は言うまでもないので出さない。差が無く出すブランチも無ければ null。
 */
export function projectBranchTail(
  name: string,
  status: AgentProjectInfo["branch"],
): string | null {
  if (!status) return null;
  const branch = status.branch;
  const shown =
    branch &&
    branch !== "main" &&
    branch !== "master" &&
    branch.toLowerCase() !== name.toLowerCase()
      ? branch
      : "";
  const parts = [
    shown,
    status.ahead > 0 ? `↑${status.ahead}` : "",
    status.behind > 0 ? `↓${status.behind}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

export type AgentOverviewResponse = {
  /**
   * 応答したサーバのプロセスを見分ける値。状態はサーバのメモリにしか無いので、
   * これが変わったら (サーバの再起動) 前回の状態と比べてはいけない。比べると、
   * 覚え直す前の「待機」を「作業中から止まった」と取り違えて通知してしまう。
   */
  serverInstance: string;
  /** 画面状態の巡回を最後に完了した時刻。0 はまだ一度も完了していない。 */
  observedAt: number;
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
  /**
   * サーバが覚えている未読 (作業中 → 入力待ち・止まった、をまだ見ていない
   * もの)。サーバのメモリにあるので、画面を読み直しても・プロジェクトを
   * 移っても消えない。この欄を持たない古い版のサーバでは無い。
   */
  unread?: AgentUnreadEntry[];
  /**
   * 全体ボードで上に留めたペイン (サーバのメモリ。どの窓でも同じ)。この欄を
   * 持たない古い版のサーバでは無い (画面のメモリだけで留める)。
   */
  pinned?: TmuxPaneId[];
  /**
   * このサーバが開いているシェル (ブラウザのターミナルのタブの中身) と、
   * その中で tmux が動いていれば、その端末とウインドウの大きさ。ブラウザは
   * これで、終わったシェルのタブを閉じ (前面でないタブにはシェルの終わりが
   * 届かない)、tmux がウインドウの外に描く点を覆う。この欄を持たない古い版の
   * サーバでは無い。
   */
  shells?: AgentOverviewShell[];
};

export type AgentOverviewShell = {
  id: string;
  /**
   * シェルを起こした場所。どのプロジェクトのシェルかを決める (起動中の判定。
   * core/project-running.ts)。この欄を持たない古い版のサーバでは無い。
   */
  cwd?: string;
  /** tmux のクライアントとして繋がっていなければ (大きさが読めなければ) null。 */
  window: TmuxClientWindow | null;
};

export type AgentUnreadEntry = {
  pane: TmuxPaneId;
  transition: AgentTransition;
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

/** ペインをプロジェクトごとに束ねる (並べる前)。 */
function collectAgentGroups(
  panes: AgentPane[],
  projects: AgentProjectInfo[],
  includeEmptyRegistered: boolean,
  comparePane: (a: AgentPane, b: AgentPane) => number,
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
    const sorted = [...list].sort(comparePane);
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
  if (includeEmptyRegistered) {
    for (const info of projects) {
      if (!info.registered || byRoot.has(info.root)) continue;
      groups.push({ info, panes: [], counts: countAgentStates([]) });
    }
  }
  return groups;
}

/**
 * ペインをプロジェクトごとに束ねる (エージェントの全体ボード)。
 *
 * プロジェクトの並びは左のサイドバーと同じ 1 つの順 (compareGroupsByRegistry:
 * 利用者が並べた登録順 → 登録していないもの)。中の行は急ぐ順 (comparePanes)。
 * 「いま手が要るもの」は行の順・絞り込み (入力待ち)・見出しの印で見せ、
 * プロジェクトの位置は状態で動かさない。
 *
 * ペインが 1 つも残らないプロジェクトは、登録したものだけ includeEmpty の
 * ときに見出しだけで出す (絞り込み中は出さない)。
 */
export function groupAgentPanes(
  panes: AgentPane[],
  projects: AgentProjectInfo[],
  options: { includeEmptyRegistered?: boolean } = {},
): AgentProjectGroup[] {
  return collectAgentGroups(
    panes,
    projects,
    options.includeEmptyRegistered === true,
    comparePanes,
  ).sort(compareGroupsByRegistry);
}

/** tmux の場所 `session:window.pane` を、比べられる形に分ける。 */
function panePlace(pane: AgentPane): [string, number, number] {
  const match = /^(.*):(\d+)\.(\d+)$/.exec(pane.label);
  if (!match) return [pane.label, 0, 0];
  return [match[1] ?? "", Number(match[2]), Number(match[3])];
}

function comparePanePlace(a: AgentPane, b: AgentPane): number {
  const [sessionA, windowA, paneA] = panePlace(a);
  const [sessionB, windowB, paneB] = panePlace(b);
  if (sessionA !== sessionB) return sessionA < sessionB ? -1 : 1;
  return windowA - windowB || paneA - paneB || (a.id < b.id ? -1 : 1);
}

/**
 * プロジェクトの並び (左のサイドバー・全体ボード・タブのグループで共通):
 * 登録した順 → 登録していないもの (名前の順、同じ名前はパスの順)。
 */
export function compareProjectsByRegistry(
  a: Pick<AgentProjectInfo, "registered" | "name" | "root">,
  b: Pick<AgentProjectInfo, "registered" | "name" | "root">,
): number {
  const regA = a.registered;
  const regB = b.registered;
  if (regA && regB) return regA.order - regB.order;
  if (regA) return -1;
  if (regB) return 1;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.root < b.root ? -1 : a.root > b.root ? 1 : 0;
}

function compareGroupsByRegistry(
  a: AgentProjectGroup,
  b: AgentProjectGroup,
): number {
  return compareProjectsByRegistry(a.info, b.info);
}

/**
 * ペインをプロジェクトごとに束ねて、動かない順に並べる (左のサイドバー)。
 *
 * 状態では並べ替えない。行が勝手に上下すると、押そうとしたものが逃げる。
 * プロジェクトは登録順 → 登録していないもの (名前の順、同じ名前はパスの順)、
 * 中の行は tmux の場所 (セッション名 → ウィンドウ番号 → ペイン番号) の順。
 * 気づかせる役目は、行の状態の印・畳んだ見出しの印・件数・通知が持つ。
 */
export function groupAgentPanesByPlace(
  panes: AgentPane[],
  projects: AgentProjectInfo[],
  options: { includeEmptyRegistered?: boolean } = {},
): AgentProjectGroup[] {
  return collectAgentGroups(
    panes,
    projects,
    options.includeEmptyRegistered === true,
    comparePanePlace,
  ).sort(compareGroupsByRegistry);
}

/** 子エージェントの字下げの最大の段。深い入れ子でも行が細くなりすぎないように。 */
export const MAX_AGENT_DEPTH = 3;

/**
 * 子エージェント (parent の付いたペイン) を親のすぐ下に並べ、段 (depth) を付ける。
 * 親が同じ一覧に居ない子・親の輪 (互いに親) は、渡した順のまま 0 段で残す。
 * 兄弟の順は渡した順。段は MAX_AGENT_DEPTH まで。
 */
export function nestAgentPanes<T extends { id: string; parent?: string }>(
  panes: readonly T[],
): { pane: T; depth: number }[] {
  const listed = new Map(panes.map((pane) => [pane.id, pane]));
  // 親が一覧に居て、たどっても輪にならない子だけを木に入れる。
  const parentOf = (pane: T): T | null => {
    const parent = pane.parent ? listed.get(pane.parent) : undefined;
    if (!parent) return null;
    const seen = new Set([pane.id]);
    for (let at: T | undefined = parent; at; ) {
      if (seen.has(at.id)) return null;
      seen.add(at.id);
      at = at.parent ? listed.get(at.parent) : undefined;
    }
    return parent;
  };
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const pane of panes) {
    const parent = parentOf(pane);
    if (!parent) {
      roots.push(pane);
      continue;
    }
    const list = children.get(parent.id) ?? [];
    list.push(pane);
    children.set(parent.id, list);
  }
  const out: { pane: T; depth: number }[] = [];
  const walk = (pane: T, depth: number) => {
    out.push({ pane, depth: Math.min(depth, MAX_AGENT_DEPTH) });
    for (const child of children.get(pane.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return out;
}

/** 全体ボードの「急ぐ順」の段の順。 */
export const URGENCY_ORDER = ["waiting", "done", "working", "idle"] as const;

/**
 * プロジェクトをまたいで状態ごとの段に分ける (全体ボードの「急ぐ順」)。段の
 * 中は変わったのが新しい順 (変わった瞬間を見ていないものは後ろ)、同じなら
 * tmux の場所の順。空の段は返さない。左のサイドバーは使わない (行が動くと
 * 押そうとしたものが逃げる)。
 */
export function groupAgentPanesByUrgency(
  panes: AgentPane[],
): { state: AgentState; panes: AgentPane[] }[] {
  return URGENCY_ORDER.map((state) => ({
    state,
    panes: panes
      .filter((pane) => pane.state === state)
      .sort((a, b) => b.updatedAt - a.updatedAt || comparePanePlace(a, b)),
  })).filter((group) => group.panes.length > 0);
}

/**
 * 全体ボードの「急ぐ順」の段。子エージェント (@agent-parent) は親の下に字下げした
 * まま、親子のまとまり (木) ごと段に入る。木の段は木の中で一番急ぐ状態 (作業役が
 * 入力待ちなら、指揮役の行ごと入力待ちの段に上がる)。段の中は、その状態のものが
 * 変わったのが新しい順、同じなら親の tmux の場所の順。空の段は返さない。
 */
export function groupAgentTreesByUrgency(
  panes: AgentPane[],
): { state: AgentState; rows: { pane: AgentPane; depth: number }[] }[] {
  const trees: { pane: AgentPane; depth: number }[][] = [];
  for (const entry of nestAgentPanes(panes)) {
    const tree = trees[trees.length - 1];
    if (entry.depth === 0 || !tree) trees.push([entry]);
    else tree.push(entry);
  }
  const rank = (state: AgentState) => URGENCY_ORDER.indexOf(state);
  const ranked = trees.map((tree) => {
    const head = tree[0].pane;
    const state = tree.reduce<AgentState>(
      (best, { pane }) => (rank(pane.state) < rank(best) ? pane.state : best),
      head.state,
    );
    const at = Math.max(
      ...tree
        .filter(({ pane }) => pane.state === state)
        .map(({ pane }) => pane.updatedAt),
    );
    return { tree, head, state, at };
  });
  return URGENCY_ORDER.map((state) => ({
    state,
    rows: ranked
      .filter((item) => item.state === state)
      .sort((a, b) => b.at - a.at || comparePanePlace(a.head, b.head))
      .flatMap((item) => item.tree),
  })).filter((group) => group.rows.length > 0);
}

/**
 * 手が要るエージェント (入力待ち → 完了・未読) を回る順。キーで次・前へ移る
 * ときに使う。同じ段の中は tmux の場所の順にして、回っている間に順が入れ
 * 替わらないようにする。渡す一覧は未読の完了を done にした後のもの
 * (withFinishedAsDone)。
 */
export function attentionPanes(panes: AgentPane[]): AgentPane[] {
  const rank = (pane: AgentPane) => (pane.state === "waiting" ? 0 : 1);
  return panes
    .filter((pane) => pane.kind !== null && needsAttention(pane.state))
    .sort((a, b) => rank(a) - rank(b) || comparePanePlace(a, b));
}

/**
 * current (いま見ているペイン。無ければ null) から direction の向きに次の
 * 手が要るエージェント。current が回る順に無ければ (読んで待機に戻った・
 * 見ていない)、次は先頭・前は末尾。回るものが無ければ null。current しか
 * 無ければ current を返す。
 */
export function nextAttentionPane(
  panes: AgentPane[],
  current: TmuxPaneId | null,
  direction: 1 | -1,
): AgentPane | null {
  const order = attentionPanes(panes);
  if (order.length === 0) return null;
  const index = order.findIndex((pane) => pane.id === current);
  if (index < 0) return order[direction === 1 ? 0 : order.length - 1] ?? null;
  return order[(index + direction + order.length) % order.length] ?? null;
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

/**
 * 画面に出す状態。フックの申告が無くても、作業中 → 止まったのを見てまだ
 * 読んでいないもの (未読の finished) は「完了」にする。完了を申告だけに頼ると、
 * フックを入れていない人には見出しの印・全体ボードの並び・パレットの上位で
 * 完了が出ない。読めば未読が解けて待機に戻る (申告の done が read で戻るのと同じ)。
 */
export function withFinishedAsDone(
  panes: AgentPane[],
  unread: ReadonlyMap<TmuxPaneId, AgentTransition>,
): AgentPane[] {
  return panes.map((pane) =>
    pane.state === "idle" && unread.get(pane.id) === "finished"
      ? { ...pane, state: "done" }
      : pane,
  );
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
  identity: (pane: AgentPane) => TmuxPaneId = (pane) => pane.id,
): AgentUnreadUpdate {
  const next = new Map<TmuxPaneId, AgentTransition>();
  const transitions: AgentUnreadUpdate["transitions"] = [];
  for (const pane of panes) {
    if (pane.kind === null) continue;
    const key = identity(pane);
    const kept = unread.get(key);
    const seen = viewing(pane);
    if (kept && pane.state !== "working" && !seen) next.set(key, kept);
    if (!previous) continue;
    const transition = agentTransition(previous.get(key), pane.state);
    if (!transition) continue;
    transitions.push({ pane, transition });
    if (!seen) next.set(key, transition);
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

/**
 * 通知の許可の見せ方。default でも、この画面で 1 度訊いて窓を閉じられたら
 * ask-again (「まだ許可されていません」と「もう一度求める」)。
 */
export type NotifyPermissionView =
  | "ask"
  | "ask-again"
  | Exclude<AgentNotifyContext["permission"], "default">;

export function notifyPermissionView(
  permission: AgentNotifyContext["permission"],
  asked: boolean,
): NotifyPermissionView {
  if (permission !== "default") return permission;
  return asked ? "ask-again" : "ask";
}

/**
 * 子エージェント (一覧に親が居る、@agent-parent のペイン) の完了は親に任せる:
 * 知らせず (窓の中・OS・音)、未読にもしない (タブの題名の件数・未読の印・`g n` と
 * 揃える)。入力待ちは人の手が要るので知らせる。親が一覧に居なければ普通に扱う。
 */
export function isChildFinish(
  pane: Pick<AgentPane, "parent">,
  transition: AgentTransition,
  panes: readonly Pick<AgentPane, "id">[],
): boolean {
  return (
    transition === "finished" &&
    pane.parent !== undefined &&
    panes.some((item) => item.id === pane.parent)
  );
}

/**
 * 知らせをどこに出すか。見ているペイン・種類ごとの設定で切ったものは出さない。
 * 窓が前面 (見えていて、キーを受けている) なら窓の中の知らせ (押すとそこへ)。
 * 前面で作業している人に OS の通知の帯は届きにくく、押してもタブを探すため。
 * 窓が前面でなければ、許可があるときだけ OS の通知。
 */
export function agentAlertPlace(
  transition: AgentTransition,
  context: AgentNotifyContext & { windowInFront: boolean; canToast: boolean },
): "toast" | "os" | null {
  if (context.viewing) return null;
  const wanted =
    transition === "waiting"
      ? context.settings.waiting
      : context.settings.finished;
  if (!wanted) return null;
  if (context.canToast && context.windowInFront) return "toast";
  return context.permission === "granted" ? "os" : null;
}

/** タブのタイトル。未読があれば先頭に件数を付ける。 */
export function titleWithUnread(base: string, unread: number): string {
  return unread > 0 ? `(${unread}) ${base}` : base;
}
