// エージェント一覧の画面 (/agents) の presenter。
//
// このマシンの tmux の全ペインを、ペインの cwd から求めたプロジェクトごとに
// 束ねて並べる。1 行で「どのプロジェクトの・どの種類が・どの状態で・何を
// しているか」が読めることを優先し、tmux の入れ子はペインの列に畳む。
//
//   Agents                                  [通知] ⟳ [+ New agent]
//   Accounts                                            Manage
//   ┌ claude  Default ┐ ┌ claude  Work ┐ ┌ codex ┐ ┌ codex Personal ┐
//   All agents 3  [All][Needs input 1][Working 1][Idle 1]  □All panes
//   Status        Agent   Account  Task          Pane      Elapsed
//   sample-app                                       Open + ⋯
//   ◆ Needs input claude  Default  Review plan   work:0.0  3m     •
//
// 取り直しは agent-monitor が持つ。ここは最新の結果を購読して、表示 (既定は
// agents-view.ts の DEFAULT_VIEW) に渡す値を組み立てるだけ。描き直しても、
// 選んでいる行・スクロール位置・畳んだプロジェクト・キーボードの位置が飛ばない
// ように、行を鍵で覚えて描き直し後に戻す。
//
// 行を押す (Enter) と、既存のターミナルパネルでそのペインを開く
// (/_tmux/open と同じ経路。新しい接続は作らない)。

import { html } from "lit/html.js";
import type { AccountsResponse } from "../../core/agent-accounts";
import {
  type AgentHooksResponse,
  agentsNeedingHooks,
} from "../../core/agent-hooks";
import {
  AGENT_STATE_FILTERS,
  type AgentPane,
  type AgentProjectGroup,
  type AgentStateFilter,
  filterAgentPanes,
  groupAgentPanes,
  groupAgentPanesByUrgency,
  matchesStateFilter,
  nestAgentPanes,
  notifyPermissionView,
} from "../../core/agent-overview";
import { formatErrorDetail } from "../../core/error-detail";
import { PLUS_16_PATH } from "../../core/icons";
import {
  partitionProjectsByRunning,
  runningProjectRoots,
} from "../../core/project-running";
import { showContextMenu } from "../context-menu";
import type { PageView } from "../page-view";
import type { ProjectActions } from "../projects/project-actions";
import { projectLook } from "../projects/project-looks";
import { showProjectMenu } from "../projects/project-menu";
import { emptyStateTemplate } from "../ui/empty-state";
import { createRenderer, templateElement } from "../ui/renderer";
import { accountTagListTemplate } from "./account-tags";
import type { AccountsBand } from "./accounts-band";
import { paneAccountName } from "./accounts-dialogs";
import { type AgentCardExtra, agentCardTemplate } from "./agent-card";
import type { AgentMonitor } from "./agent-monitor";
import {
  type AgentsBoardView,
  type AgentsBoardViewProps,
  type BoardActivity,
  type BoardListEntry,
  type BoardOrder,
  type BoardProjectProps,
  type BoardRowProps,
  DEFAULT_VIEW,
  NAV_ATTR,
} from "./agents-view";
import { type HandoffMenuActions, handoffMenuItems } from "./handoff";
import type { AgentsText } from "./i18n";
import { PANE_PREVIEW, type PanePreview } from "./pane-preview";
import { paneText } from "./pane-text";
import { markUnreadMenuItems } from "./unread-menu";

export type AgentsViewDeps = {
  monitor: AgentMonitor;
  getText(): AgentsText;
  setPageMode(): void;
  syncHeaderMenu(): void;
  /** そのペインを下のターミナルパネルで開く。 */
  openPane(pane: string): void;
  /** 設定画面の通知の項目へ。 */
  openNotificationSettings(): void;
  /** ページを読み込み直す (通知をブラウザで許可した後)。 */
  reloadPage(): void;
  /** フックの状態。まだ取っていなければ null。 */
  getHookStatus(): AgentHooksResponse | null;
  refreshHookStatus(): Promise<void>;
  hookHintDismissed(): boolean;
  dismissHookHint(): void;
  /** 設定画面のエージェント連携の節へ。 */
  openHookSettings(): void;
  /**
   * tmux が無いときの入れ方 (コピーのボタンつきのコマンドとヘルプへのリンク。
   * views/install-help.ts)。
   */
  /** tmux が無いときの入れ方の案内 (テンプレート)。 */
  tmuxInstallHelp(): unknown;
  /** 一覧の上に出すアカウントの帯。 */
  accountsBand: AccountsBand;
  /** アカウントの一覧 (まだ取っていなければ null)。行の名前に使う。 */
  getAccounts(): AccountsResponse | null;
  /** 「新しいエージェント」の画面を開く。project は選んでおくプロジェクト。 */
  launch(project?: string): void;
  /** 行の右クリックのメニューの「別のアカウントで続ける…」(handoff.ts)。 */
  handoff: HandoffMenuActions;
  /** 一覧に入った・出たとき (アカウントの取り直しを始める・止める)。 */
  onVisibilityChange(visible: boolean): void;
  /** プロジェクトの登録・開く・止める (ヘッダの切替と共通)。 */
  projects: ProjectActions;
  /** 行に載せたときの覗き窓 (既定は左のサイドバーと共有の 1 つ)。 */
  preview?: PanePreview;
  /**
   * 選んだ並びを覚える所 (ユーザー単位の設定 `agentsBoardOrder`)。無ければ
   * この画面のメモリだけ。
   */
  boardOrder?: { get(): BoardOrder | null; set(order: BoardOrder): void };
};

export type AgentsView = PageView;

export function createAgentsPresenter(
  deps: AgentsViewDeps,
  view: AgentsBoardView = DEFAULT_VIEW,
): AgentsView {
  const root = templateElement(html`<section class="agents-page"></section>`);
  const renderer = createRenderer(root, () => view(currentProps()));

  let mounted = false;
  let stateFilter: AgentStateFilter = "all";
  let allPanes = false;
  /**
   * この画面で選んだ並び。選ぶまでは覚えた並び (deps.boardOrder)、それも無ければ
   * プロジェクトごと。設定は読み込みが後から届くので、選ぶまでは毎回読む。
   */
  let chosenOrder: BoardOrder | null = null;
  const currentOrder = (): BoardOrder =>
    chosenOrder ?? deps.boardOrder?.get() ?? "project";
  /**
   * 上に留めたペイン (全体ボードだけ。左のサイドバーは行を動かさない)。メモリだけで、
   * ペインが一覧から消えたら外す。
   */
  const pinned = new Set<string>();
  let selected: string | null = null;
  /** 畳んだプロジェクト (root)。取り直しを跨いで保つ。 */
  const collapsed = new Set<string>();
  /** 停止中のプロジェクトの節を開いているか (プロジェクトの畳みと同じくメモリだけ。既定は畳む)。 */
  let stoppedOpen = false;
  /** 前回描いた中身。同じなら DOM を触らない (hover や選択を乱さない)。 */
  let lastSignature = "";
  let unsubscribe: (() => void) | null = null;
  let notifyRequestError = "";
  /** 描いている一覧の箱 (覗き窓とキーで動く行の入れ物)。 */
  let list: HTMLElement | null = null;
  let props: AgentsBoardViewProps | null = null;
  /** 描いたプロジェクト (root → グループ)。操作の受け口が引く。 */
  let shownGroups = new Map<string, AgentProjectGroup>();

  function currentProps(): AgentsBoardViewProps {
    if (!props) throw new Error("agents board: drawn before render");
    return props;
  }

  function text(): AgentsText {
    return deps.getText();
  }

  function filterLabel(filter: AgentStateFilter): string {
    const current = text();
    if (filter === "all") return current.filterAll;
    if (filter === "idle") return current.filterIdle;
    return current.state[filter];
  }

  function findPane(id: string): AgentPane | undefined {
    return deps.monitor
      .snapshot()
      .overview?.panes.find((pane) => pane.id === id);
  }

  function select(pane: AgentPane): void {
    selected = pane.id;
    deps.monitor.markRead(pane.id);
    deps.openPane(pane.id);
    render(true);
  }

  function rowProps(pane: AgentPane, project?: AgentCardExtra): BoardRowProps {
    const current = text();
    const unread = deps.monitor.snapshot().unread.get(pane.id);
    // 左のサイドバーと同じ 2 行組のカード (agent-card.ts)。この画面は幅が
    // あるので、補足にアカウントと tmux の場所も足す。急ぐ順ではプロジェクトも。
    const card = agentCardTemplate(pane, current, unread, [
      ...(project ? [project] : []),
      accountLabel(pane),
      { cls: "agents-place terminal-mono", text: pane.label },
    ]);
    const shown = paneText(pane, current);
    return {
      id: pane.id,
      state: pane.state,
      active: pane.id === selected,
      unread: unread !== undefined,
      title: [
        shown.title,
        pane.path,
        unread
          ? unread === "waiting"
            ? current.unreadWaiting
            : current.unreadFinished
          : "",
        card.ageTitle,
        current.openPane,
      ]
        .filter(Boolean)
        .join("\n"),
      previewName: shown.row,
      card: card.template,
    };
  }

  /** 行に出すアカウント名と、そのアカウントのタグの札。 */
  function accountLabel(pane: AgentPane): AgentCardExtra {
    const t = text().accounts;
    const account = pane.account;
    if (!account) return { cls: "agents-account", text: "" };
    const data = deps.getAccounts();
    const name = paneAccountName(pane, data, t);
    if (account.kind === "default" || account.kind === "registered") {
      const entry = data?.accounts.find((item) => item.id === account.id);
      return {
        cls: "agents-account",
        text: name,
        title: t.paneAccountTitle(name, entry?.configDir ?? ""),
        after: accountTagListTemplate(entry?.tags),
      };
    }
    if (account.kind === "unregistered")
      return {
        cls: "agents-account agents-account-unregistered",
        text: name,
        title: t.unregisteredTitle(account.configDir),
      };
    return {
      cls: "agents-account agents-account-unknown",
      text: name,
      title: t.unknownAccountTitle(account.reason),
    };
  }

  /**
   * 見出しの「開く」(同じタブで移る)。この画面のサーバなら文字だけ。
   * 起こしている間もボタンの大きさは変えず、押せなくするだけ (進み具合は
   * 見出しの下の行に出す)。
   */
  function serverProps(group: AgentProjectGroup): BoardProjectProps["server"] {
    const current = text();
    const info = group.info;
    const server = info.server;
    if (server.status === "current")
      return {
        kind: "here",
        text: current.currentServer,
        title: current.currentServerTitle,
      };
    if (server.status === "unreachable" || server.status === "invalid")
      return { kind: "problem", title: current.serverProblem(server.detail) };
    if (!info.git) return null;
    return {
      kind: "open",
      text: current.openServer,
      starting: deps.projects.activity(info.root)?.kind === "starting",
      stopped: server.status !== "running",
      title:
        server.status === "running"
          ? current.projects.openTitle(info.name)
          : info.registered
            ? current.projects.openStoppedTitle(info.name)
            : current.projects.openUnregisteredTitle(info.name),
    };
  }

  /** 起こしている最中・失敗を、見出しのすぐ下に出す (失敗は理由の全文)。 */
  function activityProps(root: string, name: string): BoardActivity | null {
    const t = text().projects;
    const activity = deps.projects.activity(root);
    if (!activity) return null;
    if (activity.kind === "starting")
      return { kind: "starting", text: t.startingTitle(name) };
    return {
      kind: "failed",
      title: activity.title,
      detail: activity.detail,
      dismissLabel: t.dismiss,
    };
  }

  function projectProps(group: AgentProjectGroup): BoardProjectProps {
    const current = text();
    shownGroups.set(group.info.root, group);
    const summary: string[] = [];
    for (const state of ["waiting", "working", "done", "idle"] as const) {
      const n = group.counts[state];
      if (n > 0) summary.push(`${current.state[state]} ${n}`);
    }
    return {
      root: group.info.root,
      name: group.info.name,
      look: projectLook(group.info),
      collapsed: collapsed.has(group.info.root),
      // 見出しはプロジェクトの色の四角と頭文字・名前だけにする (絵のとおり)。
      // パス・件数・Git の外かどうかはツールチップに書く。
      toggleTitle: [
        group.info.git
          ? group.info.displayRoot
          : `${group.info.displayRoot} · ${current.outsideGit}`,
        current.board.projectCounts(summary.join(" · ")),
        current.toggleProject,
      ].join("\n"),
      // 失敗は隠さない (hover を待たずに常に出す)。
      error: group.info.error ? current.projectError(group.info.error) : null,
      server: serverProps(group),
      launchTitle: group.info.git
        ? current.accounts.launchProjectTitle(group.info.name)
        : null,
      menuTitle: current.projects.menuTitle(group.info.name),
      activity: activityProps(group.info.root, group.info.name),
      // エージェントの居ない登録プロジェクトは見出しと「エージェントはいません」。
      noAgents: group.panes.length === 0 ? current.board.noAgents : null,
      // 子エージェント (@agent-parent) は親のすぐ下に字下げして並べる。
      rows: nestAgentPanes(group.panes).map(({ pane, depth }) => ({
        ...rowProps(pane),
        depth,
      })),
    };
  }

  /** 一覧の中の空の案内 (共通の部品 views/ui/empty-state.ts)。 */
  function emptyState(
    heading: string,
    body: string,
    action?: { label: string; run(): void },
  ): BoardListEntry {
    return {
      kind: "content",
      content: emptyStateTemplate({
        title: heading,
        ...(body ? { hint: body } : {}),
        actions: action ? [action] : [],
        compact: true,
      }),
    };
  }

  /**
   * エージェントが 1 つも居ないときの案内: 次にやること (新しいエージェント・
   * プロジェクトの登録) と、ボードへ戻るキー。ペインはあるがエージェントで
   * ないだけなら、登録の代わりに「すべてのペインを表示」を出す (今までの操作)。
   */
  function noAgentsState(showAllPanes: (() => void) | null): BoardListEntry {
    const current = text();
    return {
      kind: "content",
      content: emptyStateTemplate({
        icon: PLUS_16_PATH,
        title: current.emptyNoAgentsTitle,
        hint: current.emptyNoAgentsBody,
        actions: [
          {
            label: current.accounts.launchButton,
            title: current.accounts.launchButtonTitle,
            primary: true,
            run: () => deps.launch(),
          },
          showAllPanes
            ? { label: current.emptyNoAgentsAction, run: showAllPanes }
            : {
                label: current.emptyRegisterProject,
                run: () => void deps.projects.registerByPath(),
              },
        ],
        keys: [{ keys: "g a", label: current.emptyKeyBoard }],
        keysLabel: current.emptyKeysLabel,
        compact: true,
      }),
    };
  }

  function notifyProps(): Pick<AgentsBoardViewProps, "notify" | "notifyError"> {
    const current = text();
    const permission = notifyPermissionView(
      deps.monitor.permission(),
      deps.monitor.snapshot().permissionAsked,
    );
    const failure = notifyRequestError || deps.monitor.snapshot().notifyError;
    const notifyError = failure || null;
    if (permission === "ask" || permission === "ask-again")
      return {
        notify: {
          kind: "ask",
          status: permission === "ask-again" ? current.notifyNotYet : null,
          label:
            permission === "ask"
              ? current.notifyEnable
              : current.notifyAskAgain,
          title: current.notifyEnableTitle,
        },
        notifyError,
      };
    if (permission === "granted")
      return {
        notify: {
          kind: "granted",
          label: current.notifyOn,
          title: current.notifyOnTitle,
        },
        notifyError,
      };
    if (permission === "denied")
      return {
        notify: {
          kind: "denied",
          status: current.notifyDenied,
          help: current.notifyDeniedHelp,
          reload: current.notifyReload,
        },
        notifyError,
      };
    return {
      notify: { kind: "unsupported", status: current.notifyUnsupported },
      notifyError,
    };
  }

  function hookHintProps(): AgentsBoardViewProps["hookHint"] {
    const current = text();
    const panes = deps.monitor.snapshot().overview?.panes ?? [];
    const agents = deps.hookHintDismissed()
      ? []
      : agentsNeedingHooks(
          panes.map((pane) => pane.kind),
          deps.getHookStatus(),
        );
    if (agents.length === 0) return null;
    return {
      text: current.hookHint(agents.join(" / ")),
      open: current.hookHintOpen,
      close: current.hookHintClose,
    };
  }

  function problemsProps(): AgentsBoardViewProps["problems"] {
    const current = text();
    const { overview, error } = deps.monitor.snapshot();
    const problemLines = [
      ...(error ? [error] : []),
      ...(overview?.registry.error
        ? [current.projects.registryProblem(overview.registry.error)]
        : []),
      ...(overview?.tmux.error
        ? [`${current.tmuxFailed}\n${overview.tmux.error}`]
        : []),
      ...(overview?.errors ?? []).map((item) => {
        const target = item.target ? ` ${item.target}` : "";
        return `[${item.operation}${target}]\n${item.detail}${
          item.stack ? `\n${item.stack}` : ""
        }`;
      }),
    ];
    if (problemLines.length === 0) return null;
    return {
      summary: current.problems(problemLines.length),
      body: problemLines.join("\n\n"),
      // tmux の一覧そのものが取れないときは、中身を見なくても分かるよう開く。
      forceOpen: !!(overview?.tmux.error || (error && !overview)),
    };
  }

  function listEntries(): BoardListEntry[] {
    const current = text();
    const { overview, error } = deps.monitor.snapshot();
    const panes = overview?.panes ?? [];
    const scoped = panes.filter((pane) => allPanes || pane.kind !== null);
    const entries: BoardListEntry[] = [];
    // どのプロジェクトにも属さない失敗 (パスを入力しての登録など)。
    const general = activityProps("", "");
    if (general)
      entries.push({ kind: "activity", activity: general, root: "" });
    if (!overview) {
      if (!error) entries.push(emptyState(current.loading, ""));
      return entries;
    }
    // 登録したプロジェクトは、エージェントが居なくても (tmux が無くても)
    // 見出しだけで並べる。案内の箱はその上に出す。
    const registeredOnly = () =>
      entries.push(
        ...groupEntries(
          groupAgentPanes([], overview.projects, {
            includeEmptyRegistered: true,
          }),
        ),
      );
    if (overview.tmux.error) {
      registeredOnly();
      return entries;
    }
    if (!overview.tmux.available) {
      entries.push(
        emptyState(
          current.emptyNotInstalledTitle,
          current.emptyNotInstalledBody,
        ),
        { kind: "content", content: deps.tmuxInstallHelp() },
      );
      registeredOnly();
      return entries;
    }
    if (!overview.tmux.running) {
      entries.push(
        emptyState(current.emptyNoTmuxTitle, current.emptyNoTmuxBody),
      );
      registeredOnly();
      return entries;
    }
    if (scoped.length === 0) {
      entries.push(
        noAgentsState(
          allPanes || panes.length === 0
            ? null
            : () => {
                allPanes = true;
                render(true);
              },
        ),
      );
      registeredOnly();
      return entries;
    }
    const visible = filterAgentPanes(panes, { allPanes, state: stateFilter });
    if (visible.length === 0) {
      entries.push(
        emptyState(
          current.emptyNoMatchTitle(filterLabel(stateFilter)),
          current.emptyNoMatchBody,
          {
            label: current.emptyNoMatchAction,
            run: () => {
              stateFilter = "all";
              render(true);
            },
          },
        ),
      );
      return entries;
    }
    // 留めたものは並びに関係なく先頭の段へ (その段の中は急ぐ順と同じ並び)。
    for (const id of [...pinned]) {
      if (!panes.some((pane) => pane.id === id)) pinned.delete(id);
    }
    const pinnedPanes = visible.filter((pane) => pinned.has(pane.id));
    if (pinnedPanes.length > 0) {
      entries.push({
        kind: "section",
        state: null,
        label: current.board.pinned,
        rows: groupAgentPanesByUrgency(pinnedPanes).flatMap((group) =>
          group.panes.map((pane) => rowProps(pane, projectLabel(pane))),
        ),
      });
    }
    const rest = visible.filter((pane) => !pinned.has(pane.id));
    if (currentOrder() === "urgency") {
      entries.push(...urgencyEntries(rest));
      return entries;
    }
    // 絞り込み中は、エージェントの居ない登録プロジェクトを出さない
    // (「入力待ちだけ」を見たいときに、関係の無い見出しが並ばないように)。
    entries.push(
      ...groupEntries(
        groupAgentPanes(rest, overview.projects, {
          includeEmptyRegistered: stateFilter === "all",
        }),
      ),
    );
    return entries;
  }

  /**
   * 急ぐ順: プロジェクトをまたいで状態ごとの段に並べる (groupAgentPanesByUrgency)。
   * 行の補足にプロジェクトの名前を足す (見出しがプロジェクトでないので)。
   */
  function urgencyEntries(panes: AgentPane[]): BoardListEntry[] {
    const current = text();
    return groupAgentPanesByUrgency(panes).map((group) => ({
      kind: "section",
      state: group.state,
      label: current.state[group.state],
      rows: group.panes.map((pane) => rowProps(pane, projectLabel(pane))),
    }));
  }

  /** 行の補足に足すプロジェクトの名前 (見出しがプロジェクトでない段)。 */
  function projectLabel(pane: AgentPane): AgentCardExtra {
    const info = deps.monitor
      .snapshot()
      .overview?.projects.find((item) => item.root === pane.project);
    return { cls: "agents-project-label", text: info?.name ?? pane.project };
  }

  /**
   * プロジェクトを並べる。行の無い登録プロジェクトのうち起動中でないもの
   * (core/project-running.ts。左のサイドバーと同じ判定) は、一覧の下の畳める
   * 「停止中」の節へ。並びはどちらも渡した順 (登録の順) のまま。
   */
  function groupEntries(groups: AgentProjectGroup[]): BoardListEntry[] {
    const overview = deps.monitor.snapshot().overview;
    if (!overview) return [];
    const starting = overview.projects
      .filter((info) => deps.projects.activity(info.root)?.kind === "starting")
      .map((info) => info.root);
    const running = runningProjectRoots(overview, starting);
    // 行のあるもの (すべてのペインを出しているときのシェルだけのペインも) は
    // 畳みに入れない。
    for (const group of groups) {
      if (group.panes.length > 0) running.add(group.info.root);
    }
    const split = partitionProjectsByRunning(
      groups,
      (group) => group.info.root,
      running,
    );
    const entries: BoardListEntry[] = split.running.map((group) => ({
      kind: "project",
      project: projectProps(group),
    }));
    if (split.stopped.length === 0) return entries;
    const current = text();
    entries.push({
      kind: "stopped",
      open: stoppedOpen,
      label: current.sidebar.stopped(split.stopped.length),
      title: current.sidebar.stoppedTitle,
      projects: split.stopped.map(projectProps),
    });
    return entries;
  }

  function buildProps(): AgentsBoardViewProps {
    const current = text();
    shownGroups = new Map();
    const { overview } = deps.monitor.snapshot();
    const panes = overview?.panes ?? [];
    const scoped = panes.filter((pane) => allPanes || pane.kind !== null);
    return {
      ariaLabel: current.ariaLabel,
      title: current.title,
      refreshLabel: current.refresh,
      launch: {
        label: current.accounts.launchButton,
        title: current.accounts.launchButtonTitle,
      },
      ...notifyProps(),
      hookHint: hookHintProps(),
      problems: problemsProps(),
      accountsBand: deps.accountsBand.element,
      board: {
        title: current.board.allAgents,
        count: scoped.length,
        filterLabel: current.filterLabel,
        filters: AGENT_STATE_FILTERS.map((filter) => ({
          filter,
          label: filterLabel(filter),
          count: scoped.filter((pane) => matchesStateFilter(pane.state, filter))
            .length,
          active: stateFilter === filter,
        })),
        allPanes: {
          label: current.allPanes,
          title: current.allPanesTitle,
          checked: allPanes,
        },
        order: {
          label: current.board.orderLabel,
          options: (["project", "urgency"] as const).map((item) => ({
            order: item,
            label:
              item === "project"
                ? current.board.orderByProject
                : current.board.orderByUrgency,
            title: item === "urgency" ? current.board.orderByUrgencyTitle : "",
            active: currentOrder() === item,
          })),
        },
        // 狭いと末尾を省くので、全文はカーソルを置いたときに出す。
        hint: current.keyboardHint,
      },
      list: listEntries(),
      onRefresh: () => void deps.monitor.refresh(),
      onLaunch: (project) => deps.launch(project),
      onNotifyEnable() {
        const failed = text().notifyRequestFailed;
        deps.monitor.requestPermission().then(
          () => {
            notifyRequestError = "";
            render(true);
          },
          (cause: unknown) => {
            console.error(
              "[code-viewer] notification permission failed",
              cause,
            );
            notifyRequestError = `${failed}: ${formatErrorDetail(cause)}`;
            render(true);
          },
        );
      },
      onNotifySettings: () => deps.openNotificationSettings(),
      onReload: () => deps.reloadPage(),
      onHookOpen: () => deps.openHookSettings(),
      onHookClose() {
        deps.dismissHookHint();
        render(true);
      },
      onFilter(filter) {
        stateFilter = filter;
        render(true);
      },
      onAllPanes(checked) {
        allPanes = checked;
        render(true);
      },
      onOrder(next) {
        chosenOrder = next;
        deps.boardOrder?.set(next);
        render(true);
      },
      onListKeydown,
      onOpenPane(id, event) {
        // 左のサイドバーの行と同じ押し分け (中ボタン・⌘/Ctrl・Alt は 1 回押すと同じ)。
        if (event.button > 1) return;
        event.preventDefault();
        const pane = findPane(id);
        if (pane) select(pane);
      },
      onPaneMenu(id, event) {
        // 左のサイドバーの行と同じメニュー。
        event.preventDefault();
        const pane = findPane(id);
        if (!pane) return;
        const current = text();
        showContextMenu(
          event.currentTarget as HTMLElement,
          [
            { label: current.openPane, onSelect: () => select(pane) },
            {
              label: pinned.has(pane.id)
                ? current.board.unpin
                : current.board.pin,
              onSelect: () => {
                if (pinned.has(pane.id)) pinned.delete(pane.id);
                else pinned.add(pane.id);
                render(true);
              },
            },
            ...markUnreadMenuItems(pane, current, deps.monitor),
            ...handoffMenuItems(pane, current, deps.handoff),
          ],
          { at: { x: event.clientX, y: event.clientY } },
        );
      },
      onToggleProject(rootKey) {
        if (collapsed.has(rootKey)) collapsed.delete(rootKey);
        else collapsed.add(rootKey);
        render(true);
      },
      onOpenProject(rootKey) {
        const info = shownGroups.get(rootKey)?.info;
        // 一覧から移るときは、移り先の既定の画面 (リポジトリ) へ。同じ一覧に
        // 移っても、見ている中身 (全体のエージェント) は変わらないため。
        if (info) void deps.projects.open(info, "/");
      },
      onProjectMenu(rootKey, anchor) {
        const group = shownGroups.get(rootKey);
        if (!group) return;
        showProjectMenu(anchor, group.info, {
          actions: deps.projects,
          text: text().projects,
          registeredCount:
            deps.monitor.snapshot().overview?.registry.projects.length ?? 0,
        });
      },
      onDismissActivity: (rootKey) => deps.projects.dismiss(rootKey),
      onToggleStopped() {
        stoppedOpen = !stoppedOpen;
        render(true);
      },
      listRef(el) {
        list = el instanceof HTMLElement ? el : null;
      },
    };
  }

  function signature(): string {
    const snapshot = deps.monitor.snapshot();
    const now = Date.now();
    return JSON.stringify([
      text().title,
      stateFilter,
      allPanes,
      selected,
      [...collapsed],
      stoppedOpen,
      [...snapshot.unread],
      snapshot.error,
      snapshot.notifyError,
      notifyRequestError,
      deps.monitor.permission(),
      deps.hookHintDismissed(),
      deps.getHookStatus(),
      deps.accountsBand.signature(),
      deps.projects.signature(),
      snapshot.overview,
      // 経過時間は分単位でしか変わらない。
      Math.floor(now / 60_000),
    ]);
  }

  /**
   * 描き直す。キーボードの位置は鍵で覚えて戻す。描いた直後にフォーカスを戻し、
   * Tab で入る行を決めるので、まとめずにいまここで描く。
   */
  function render(force = false): void {
    if (!mounted) return;
    const next = signature();
    if (!force && next === lastSignature) return;
    lastSignature = next;
    const focusedKey =
      document.activeElement instanceof HTMLElement &&
      list?.contains(document.activeElement)
        ? document.activeElement.getAttribute(NAV_ATTR)
        : null;
    props = buildProps();
    root.setAttribute("aria-label", props.ariaLabel);
    deps.accountsBand.render();
    renderer.flush();

    const navs = navItems();
    const restore =
      (focusedKey &&
        navs.find((item) => item.getAttribute(NAV_ATTR) === focusedKey)) ||
      null;
    // 行へ Tab で入れるのは 1 つだけ (矢印で動く)。選んでいる行、無ければ
    // 一番上の行 (先頭のプロジェクトの最も急ぐもの)。Enter 1 回でそこへ行ける。
    const tabStop =
      restore ??
      navs.find((item) => item.classList.contains("active")) ??
      navs.find((item) => item.classList.contains("agents-row")) ??
      navs[0];
    if (tabStop) tabStop.tabIndex = 0;
    restore?.focus({ preventScroll: true });
  }

  function navItems(): HTMLElement[] {
    if (!list) return [];
    return [...list.querySelectorAll<HTMLElement>(`[${NAV_ATTR}]`)].filter(
      (item) => !item.closest("[hidden]"),
    );
  }

  function onListKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // Enter は行・見出しを押したのと同じにする。ボタンの既定の動作に任せる
    // と、キーの届き方によっては click にならないことがあるので、ここで
    // 1 回だけ押す (既定の動作は止めて二重にしない)。
    if (event.key === "Enter") {
      const target = event.target;
      if (target instanceof HTMLElement && target.hasAttribute(NAV_ATTR)) {
        event.preventDefault();
        target.click();
      }
      return;
    }
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const navs = navItems();
    if (navs.length === 0) return;
    const index = navs.indexOf(document.activeElement as HTMLElement);
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(navs.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else next = navs.length - 1;
    const target = navs[next];
    if (!target) return;
    event.preventDefault();
    for (const item of navs) item.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  }

  function mount(): void {
    if (mounted) return;
    const content = document.getElementById("content");
    if (!content) return;
    document.getElementById("diff")?.setAttribute("hidden", "true");
    document.getElementById("empty")?.classList.add("hidden");
    document
      .getElementById("history-commit-info")
      ?.setAttribute("hidden", "true");
    content.appendChild(root);
    mounted = true;
    // 一覧の箱を描いてから、覗き窓に見張らせる。
    render(true);
    document.body.classList.add("gdp-agents-page");
    deps.setPageMode();
    deps.syncHeaderMenu();
    const offMonitor = deps.monitor.subscribe(() => render());
    const offProjects = deps.projects.subscribe(() => render());
    // 行は横に長いので、覗き窓は行の下に重ねる。
    if (!list) throw new Error("agents board: the list was not drawn");
    const offPreview = (deps.preview ?? PANE_PREVIEW).watch(list, {
      placement: "below",
      getText: () => text().preview,
    });
    unsubscribe = () => {
      offMonitor();
      offProjects();
      offPreview();
    };
    deps.onVisibilityChange(true);
  }

  async function enter(): Promise<void> {
    const wasMounted = mounted;
    mount();
    render(true);
    if (!wasMounted) {
      // 画面に入ったらキーボードですぐ動けるように、行へ入る。入力中の
      // 欄から奪わないよう、どこにもフォーカスが無いときだけ。
      const active = document.activeElement;
      if (!active || active === document.body) {
        list?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({
          preventScroll: true,
        });
      }
    }
    await Promise.all([deps.monitor.refresh(), deps.refreshHookStatus()]);
  }

  function suspend(): void {
    if (mounted) deps.onVisibilityChange(false);
    unsubscribe?.();
    unsubscribe = null;
    root.remove();
    document.body.classList.remove("gdp-agents-page");
    document.getElementById("diff")?.removeAttribute("hidden");
    mounted = false;
    lastSignature = "";
  }

  return {
    enter,
    suspend,
    handleSse() {
      // この一覧はファイルの変更通知では変わらない。取り直しは agent-monitor
      // の周期に任せる。
    },
    localize() {
      render(true);
    },
  };
}
