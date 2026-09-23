// エージェント一覧の画面 (/agents)。
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
// 取り直しは agent-monitor が持つ。ここは最新の結果を購読して描くだけ。
// 描き直しても、選んでいる行・スクロール位置・畳んだプロジェクト・キーボード
// の位置が飛ばないように、行を鍵で覚えて描き直し後に戻す。
//
// 行を押す (Enter) と、既存のターミナルパネルでそのペインを開く
// (/_tmux/open と同じ経路。新しい接続は作らない)。

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
  matchesStateFilter,
  notifyPermissionView,
} from "../../core/agent-overview";
import {
  CHEVRON_DOWN_16_PATH,
  iconSvg,
  KEBAB_16_PATH,
  PLUS_16_PATH,
  SYNC_16_PATH,
  X_16_PATH,
} from "../../core/icons";
import type { PageView } from "../page-view";
import type { ProjectActions } from "../projects/project-actions";
import { showProjectMenu } from "../projects/project-menu";
import type { AccountsBand } from "./accounts-band";
import { fillAgentCard } from "./agent-card";
import type { AgentMonitor } from "./agent-monitor";
import type { AgentsText } from "./i18n";
import { paneText } from "./pane-text";

export type AgentsViewDeps = {
  monitor: AgentMonitor;
  getText(): AgentsText;
  setPageMode(): void;
  syncHeaderMenu(): void;
  /** そのペインを下のターミナルパネルで開く。 */
  /** opposite は反対の面 (Alt＋クリック)。 */
  openPane(pane: string, destination?: "opposite"): void;
  /** 設定画面の通知の項目へ。 */
  openNotificationSettings(): void;
  /** フックの状態。まだ取っていなければ null。 */
  getHookStatus(): AgentHooksResponse | null;
  refreshHookStatus(): Promise<void>;
  hookHintDismissed(): boolean;
  dismissHookHint(): void;
  /** 設定画面のエージェント連携の節へ。 */
  openHookSettings(): void;
  /** 一覧の上に出すアカウントの帯。 */
  accountsBand: AccountsBand;
  /** アカウントの一覧 (まだ取っていなければ null)。行の名前に使う。 */
  getAccounts(): AccountsResponse | null;
  /** 「新しいエージェント」の画面を開く。project は選んでおくプロジェクト。 */
  launch(project?: string): void;
  /** 一覧に入った・出たとき (アカウントの取り直しを始める・止める)。 */
  onVisibilityChange(visible: boolean): void;
  /** プロジェクトの登録・開く・止める (ヘッダの切替と共通)。 */
  projects: ProjectActions;
};

export type AgentsView = PageView;

/** 描き直しの前後で同じ要素を指すための鍵。 */
const NAV_ATTR = "data-agent-nav";

export function createAgentsView(deps: AgentsViewDeps): AgentsView {
  const root = document.createElement("section");
  root.className = "agents-page";

  const header = document.createElement("header");
  header.className = "agents-header";
  const title = document.createElement("h1");
  title.className = "agents-title";
  const spacer = document.createElement("span");
  spacer.className = "agents-spacer";
  const notifyBox = document.createElement("div");
  notifyBox.className = "agents-notify";
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "agents-icon-action agents-refresh";
  refreshButton.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);
  refreshButton.addEventListener("click", () => void deps.monitor.refresh());
  const launchButton = document.createElement("button");
  launchButton.type = "button";
  launchButton.className = "agents-primary agents-launch";
  const launchIcon = document.createElement("span");
  launchIcon.className = "agents-primary-icon";
  launchIcon.innerHTML = iconSvg("octicon-plus", PLUS_16_PATH);
  launchIcon.setAttribute("aria-hidden", "true");
  const launchLabel = document.createElement("span");
  launchButton.append(launchIcon, launchLabel);
  launchButton.addEventListener("click", () => deps.launch());
  header.append(title, spacer, notifyBox, refreshButton, launchButton);

  // フックが未設定のときだけ出す 1 行。通知の許可ボタンとは離して、
  // ヘッダの下に置く (ヘッダの右端に操作を並べて騒がしくしない)。
  const hookHint = document.createElement("div");
  hookHint.className = "agents-hook-hint";
  hookHint.hidden = true;
  const hookHintText = document.createElement("span");
  hookHintText.className = "agents-hook-hint-text";
  const hookHintOpen = document.createElement("button");
  hookHintOpen.type = "button";
  hookHintOpen.className = "agents-hook-hint-open";
  hookHintOpen.addEventListener("click", () => deps.openHookSettings());
  const hookHintClose = document.createElement("button");
  hookHintClose.type = "button";
  hookHintClose.className = "agents-icon-action agents-hook-hint-close";
  hookHintClose.innerHTML = iconSvg("octicon-x", X_16_PATH);
  hookHintClose.addEventListener("click", () => {
    deps.dismissHookHint();
    render(true);
  });
  hookHint.append(hookHintText, hookHintOpen, hookHintClose);

  const problems = document.createElement("details");
  problems.className = "agents-problems";
  const problemsSummary = document.createElement("summary");
  const problemsBody = document.createElement("pre");
  problemsBody.className = "terminal-observation-errors";
  problems.append(problemsSummary, problemsBody);
  problems.hidden = true;

  // 表の上の 1 行: 見出しと件数・状態の絞り込み・すべてのペイン・キーの案内。
  const board = document.createElement("section");
  board.className = "agents-board";
  const toolbar = document.createElement("div");
  toolbar.className = "agents-toolbar";
  const boardTitle = document.createElement("h2");
  boardTitle.className = "agents-section-title";
  const boardTitleText = document.createElement("span");
  const boardCount = document.createElement("span");
  boardCount.className = "agents-chip";
  boardTitle.append(boardTitleText, boardCount);
  const filterGroup = document.createElement("div");
  filterGroup.className = "agents-filter";
  filterGroup.role = "group";
  const filterButtons = new Map<AgentStateFilter, HTMLButtonElement>();
  for (const filter of AGENT_STATE_FILTERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.filter = filter;
    const label = document.createElement("span");
    label.className = "agents-filter-label";
    const count = document.createElement("span");
    count.className = "agents-chip agents-filter-count";
    button.append(label, count);
    button.addEventListener("click", () => {
      stateFilter = filter;
      render(true);
    });
    filterButtons.set(filter, button);
    filterGroup.appendChild(button);
  }
  const allPanesLabel = document.createElement("label");
  allPanesLabel.className = "agents-all-panes";
  const allPanesInput = document.createElement("input");
  allPanesInput.type = "checkbox";
  const allPanesText = document.createElement("span");
  allPanesLabel.append(allPanesInput, allPanesText);
  allPanesInput.addEventListener("change", () => {
    allPanes = allPanesInput.checked;
    render(true);
  });
  const toolbarSpacer = document.createElement("span");
  toolbarSpacer.className = "agents-spacer";
  const hint = document.createElement("span");
  hint.className = "agents-hint";
  toolbar.append(boardTitle, filterGroup, allPanesLabel, toolbarSpacer, hint);

  const list = document.createElement("div");
  list.className = "agents-list";
  list.role = "tree";
  list.addEventListener("keydown", onListKeydown);
  board.append(toolbar, list);

  root.append(header, hookHint, problems, deps.accountsBand.element, board);

  let mounted = false;
  let stateFilter: AgentStateFilter = "all";
  let allPanes = false;
  let selected: string | null = null;
  /** 畳んだプロジェクト (root)。取り直しを跨いで保つ。 */
  const collapsed = new Set<string>();
  /** 前回描いた中身。同じなら DOM を触らない (hover や選択を乱さない)。 */
  let lastSignature = "";
  let unsubscribe: (() => void) | null = null;
  let notifyRequestError = "";

  function text(): AgentsText {
    return deps.getText();
  }

  function filterLabel(filter: AgentStateFilter): string {
    const current = text();
    if (filter === "all") return current.filterAll;
    if (filter === "idle") return current.filterIdle;
    return current.state[filter];
  }

  function select(pane: AgentPane, destination?: "opposite"): void {
    selected = pane.id;
    deps.monitor.markRead(pane.id);
    deps.openPane(pane.id, destination);
    render(true);
  }

  function createRow(pane: AgentPane): HTMLElement {
    const current = text();
    const unread = deps.monitor.snapshot().unread.get(pane.id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `agents-row agents-row-${pane.state}`;
    row.setAttribute(NAV_ATTR, `pane:${pane.id}`);
    row.role = "treeitem";
    row.tabIndex = -1;
    row.classList.toggle("active", pane.id === selected);
    row.classList.toggle("unread", unread !== undefined);
    if (pane.id === selected) row.setAttribute("aria-current", "true");

    // 左のサイドバーと同じ 2 行組のカード (agent-card.ts)。この画面は幅が
    // あるので、補足にアカウントと tmux の場所も足す。
    const place = document.createElement("span");
    place.className = "agents-place terminal-mono";
    place.textContent = pane.label;
    const card = fillAgentCard(row, pane, current, unread, [
      accountLabel(pane),
      place,
    ]);
    row.title = [
      paneText(pane, current).title,
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
      .join("\n");
    // 左のサイドバーの行と同じ押し分け (中ボタン・⌘/Ctrl は 1 回押すと同じ、
    // Alt は反対の面)。
    const openBy = (event: MouseEvent) => {
      if (event.button > 1) return;
      event.preventDefault();
      select(pane, event.altKey ? "opposite" : undefined);
    };
    row.addEventListener("click", openBy);
    row.addEventListener("auxclick", openBy);
    return row;
  }

  /** 行に出すアカウント名。 */
  function accountLabel(pane: AgentPane): HTMLElement {
    const t = text().accounts;
    const label = document.createElement("span");
    label.className = "agents-account";
    const account = pane.account;
    if (!account) return label;
    const data = deps.getAccounts();
    if (account.kind === "default" || account.kind === "registered") {
      const entry = data?.accounts.find((item) => item.id === account.id);
      label.textContent =
        account.kind === "default"
          ? t.defaultName
          : (entry?.name ?? account.id);
      label.title = t.paneAccountTitle(
        label.textContent,
        entry?.configDir ?? "",
      );
    } else if (account.kind === "unregistered") {
      label.classList.add("agents-account-unregistered");
      label.textContent = t.unregistered;
      label.title = t.unregisteredTitle(account.configDir);
    } else {
      label.classList.add("agents-account-unknown");
      label.textContent = t.unknownAccount;
      label.title = t.unknownAccountTitle(account.reason);
    }
    return label;
  }

  /**
   * 見出しの「開く」(同じタブで移る)。この画面のサーバなら文字だけ。
   * 起こしている間もボタンの大きさは変えず、押せなくするだけ (進み具合は
   * 見出しの下の行に出す)。
   */
  function projectServer(group: AgentProjectGroup): HTMLElement | null {
    const current = text();
    const info = group.info;
    const server = info.server;
    if (server.status === "current") {
      const here = document.createElement("span");
      here.className = "agents-server-here";
      here.textContent = current.currentServer;
      here.title = current.currentServerTitle;
      return here;
    }
    if (server.status === "unreachable" || server.status === "invalid") {
      const warn = document.createElement("span");
      warn.className = "agents-server-problem";
      warn.textContent = "!";
      warn.title = current.serverProblem(server.detail);
      warn.setAttribute("aria-label", warn.title);
      return warn;
    }
    if (!info.git) return null;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "agents-server-link";
    open.textContent = current.openServer;
    const starting = deps.projects.activity(info.root)?.kind === "starting";
    open.disabled = starting;
    open.setAttribute("aria-busy", String(starting));
    open.title =
      server.status === "running"
        ? current.projects.openTitle(info.name)
        : info.registered
          ? current.projects.openStoppedTitle(info.name)
          : current.projects.openUnregisteredTitle(info.name);
    if (server.status !== "running") open.classList.add("stopped");
    // 一覧から移るときは、移り先の既定の画面 (リポジトリ) へ。同じ一覧に
    // 移っても、見ている中身 (全体のエージェント) は変わらないため。
    open.addEventListener("click", () => void deps.projects.open(info, "/"));
    return open;
  }

  function projectMenu(group: AgentProjectGroup, anchor: HTMLElement): void {
    showProjectMenu(anchor, group.info, {
      actions: deps.projects,
      text: text().projects,
      registeredCount:
        deps.monitor.snapshot().overview?.registry.projects.length ?? 0,
    });
  }

  /** 起こしている最中・失敗を、見出しのすぐ下に出す (失敗は理由の全文)。 */
  function projectActivity(root: string, name: string): HTMLElement | null {
    const t = text().projects;
    const activity = deps.projects.activity(root);
    if (!activity) return null;
    const box = document.createElement("div");
    box.className = `agents-project-activity agents-project-${activity.kind}`;
    box.setAttribute("role", activity.kind === "failed" ? "alert" : "status");
    if (activity.kind === "starting") {
      box.textContent = t.startingTitle(name);
      return box;
    }
    const head = document.createElement("div");
    head.className = "agents-project-activity-head";
    const title = document.createElement("strong");
    title.textContent = activity.title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "agents-icon-action";
    close.innerHTML = iconSvg("octicon-x", X_16_PATH);
    close.title = t.dismiss;
    close.setAttribute("aria-label", t.dismiss);
    close.addEventListener("click", () => deps.projects.dismiss(root));
    head.append(title, close);
    const detail = document.createElement("pre");
    detail.className = "terminal-observation-errors";
    detail.textContent = activity.detail;
    box.append(head, detail);
    return box;
  }

  function createProject(group: AgentProjectGroup): HTMLElement {
    const current = text();
    const section = document.createElement("section");
    section.className = "agents-project";
    const isCollapsed = collapsed.has(group.info.root);

    const head = document.createElement("div");
    head.className = "agents-project-head";
    const summary: string[] = [];
    for (const state of ["waiting", "working", "done", "idle"] as const) {
      const n = group.counts[state];
      if (n > 0) summary.push(`${current.state[state]} ${n}`);
    }
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "agents-project-toggle";
    toggle.setAttribute(NAV_ATTR, `project:${group.info.root}`);
    toggle.tabIndex = -1;
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    // 見出しは名前だけにする (絵のとおり)。パス・件数・Git の外かどうかは
    // ツールチップに書く。
    toggle.title = [
      group.info.git
        ? group.info.displayRoot
        : `${group.info.displayRoot} · ${current.outsideGit}`,
      current.board.projectCounts(summary.join(" · ")),
      current.toggleProject,
    ].join("\n");
    const name = document.createElement("span");
    name.className = "agents-project-name";
    name.textContent = group.info.name;
    const twisty = document.createElement("span");
    twisty.className = "terminal-tree-twisty agents-project-twisty";
    twisty.classList.toggle("collapsed", isCollapsed);
    twisty.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
    twisty.setAttribute("aria-hidden", "true");
    toggle.append(name, twisty);
    toggle.addEventListener("click", () => {
      if (collapsed.has(group.info.root)) collapsed.delete(group.info.root);
      else collapsed.add(group.info.root);
      render(true);
    });
    head.appendChild(toggle);
    // 失敗は隠さない (hover を待たずに常に出す)。
    if (group.info.error) {
      const error = document.createElement("span");
      error.className = "agents-server-problem";
      error.textContent = "!";
      error.title = current.projectError(group.info.error);
      error.setAttribute("aria-label", error.title);
      head.appendChild(error);
    }

    // 開く・起動・⋯ は、見出しに載ったとき (hover・フォーカス) に出す。場所は
    // 最初から取っておき、出ても名前が動かない (左のサイドバーの見出しと同じ)。
    const actions = document.createElement("span");
    actions.className = "agents-project-actions";
    const server = projectServer(group);
    if (server) actions.appendChild(server);
    if (group.info.git) {
      const launch = document.createElement("button");
      launch.type = "button";
      launch.className = "agents-icon-action agents-project-launch";
      launch.innerHTML = iconSvg("octicon-plus", PLUS_16_PATH);
      launch.title = current.accounts.launchProjectTitle(group.info.name);
      launch.setAttribute("aria-label", launch.title);
      launch.addEventListener("click", () => deps.launch(group.info.root));
      actions.appendChild(launch);
    }
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "agents-icon-action agents-project-menu";
    menu.innerHTML = iconSvg("octicon-kebab-horizontal", KEBAB_16_PATH);
    menu.title = current.projects.menuTitle(group.info.name);
    menu.setAttribute("aria-label", menu.title);
    menu.setAttribute("aria-haspopup", "menu");
    menu.addEventListener("click", (event) => {
      // 文書全体の click で閉じる処理 (リポジトリ画面のメニュー) に、開いた
      // ばかりのメニューを閉じさせない。作業ツリー画面の ⋯ と同じ。
      event.stopPropagation();
      projectMenu(group, menu);
    });
    actions.appendChild(menu);
    head.appendChild(actions);

    section.appendChild(head);
    const activity = projectActivity(group.info.root, group.info.name);
    if (activity) section.appendChild(activity);
    // エージェントの居ない登録プロジェクトは見出しと「エージェントはいません」。
    if (group.panes.length === 0) {
      section.classList.add("agents-project-empty");
      const none = document.createElement("div");
      none.className = "agents-project-none";
      none.textContent = current.board.noAgents;
      none.hidden = isCollapsed;
      section.appendChild(none);
      return section;
    }
    const rows = document.createElement("div");
    rows.className = "agents-rows";
    rows.role = "group";
    rows.hidden = isCollapsed;
    for (const pane of group.panes) rows.appendChild(createRow(pane));
    section.appendChild(rows);
    return section;
  }

  function emptyState(
    heading: string,
    body: string,
    action?: { label: string; run(): void },
  ): HTMLElement {
    const box = document.createElement("div");
    box.className = "agents-empty";
    const h = document.createElement("strong");
    h.textContent = heading;
    const p = document.createElement("p");
    p.textContent = body;
    box.append(h, p);
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "agents-secondary";
      button.textContent = action.label;
      button.addEventListener("click", action.run);
      box.appendChild(button);
    }
    return box;
  }

  function renderNotify(): void {
    const current = text();
    notifyBox.replaceChildren();
    const view = notifyPermissionView(
      deps.monitor.permission(),
      deps.monitor.snapshot().permissionAsked,
    );
    const status = document.createElement("span");
    status.className = "agents-notify-status";
    if (view === "ask" || view === "ask-again") {
      if (view === "ask-again") {
        status.textContent = current.notifyNotYet;
        notifyBox.appendChild(status);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "agents-secondary agents-notify-enable";
      button.textContent =
        view === "ask" ? current.notifyEnable : current.notifyAskAgain;
      button.title = current.notifyEnableTitle;
      button.addEventListener("click", () => {
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
            notifyRequestError = `${current.notifyRequestFailed}: ${
              cause instanceof Error ? cause.message : String(cause)
            }`;
            render(true);
          },
        );
      });
      notifyBox.appendChild(button);
    } else if (view === "granted") {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "agents-text-action agents-notify-on";
      link.textContent = current.notifyOn;
      link.title = current.notifyOnTitle;
      link.addEventListener("click", () => deps.openNotificationSettings());
      notifyBox.appendChild(link);
    } else if (view === "denied") {
      status.classList.add("agents-notify-denied");
      status.textContent = current.notifyDenied;
      status.title = current.notifyDeniedHelp;
      const help = document.createElement("span");
      help.className = "agents-notify-help";
      help.textContent = current.notifyDeniedHelp;
      notifyBox.append(status, help);
    } else {
      status.textContent = current.notifyUnsupported;
      notifyBox.appendChild(status);
    }
    const failure = notifyRequestError || deps.monitor.snapshot().notifyError;
    if (failure) {
      const error = document.createElement("span");
      error.className = "agents-notify-error";
      error.textContent = "!";
      error.title = failure;
      error.setAttribute("aria-label", failure);
      notifyBox.appendChild(error);
    }
  }

  function renderHookHint(): void {
    const current = text();
    const panes = deps.monitor.snapshot().overview?.panes ?? [];
    const agents = deps.hookHintDismissed()
      ? []
      : agentsNeedingHooks(
          panes.map((pane) => pane.kind),
          deps.getHookStatus(),
        );
    hookHint.hidden = agents.length === 0;
    if (agents.length === 0) return;
    hookHintText.textContent = current.hookHint(agents.join(" / "));
    hookHintOpen.textContent = current.hookHintOpen;
    hookHintClose.title = current.hookHintClose;
    hookHintClose.setAttribute("aria-label", current.hookHintClose);
  }

  function renderBody(): void {
    const current = text();
    const { overview, error } = deps.monitor.snapshot();
    const panes = overview?.panes ?? [];
    const scoped = panes.filter((pane) => allPanes || pane.kind !== null);
    for (const [filter, button] of filterButtons) {
      const label = button.querySelector(".agents-filter-label");
      const count = button.querySelector(".agents-filter-count");
      if (label) label.textContent = filterLabel(filter);
      if (count)
        count.textContent = String(
          scoped.filter((pane) => matchesStateFilter(pane.state, filter))
            .length,
        );
      button.classList.toggle("active", stateFilter === filter);
      button.setAttribute("aria-pressed", String(stateFilter === filter));
    }
    boardCount.textContent = String(scoped.length);

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
    problems.hidden = problemLines.length === 0;
    problemsSummary.textContent = current.problems(problemLines.length);
    problemsBody.textContent = problemLines.join("\n\n");
    // tmux の一覧そのものが取れないときは、中身を見なくても分かるよう開く。
    if (overview?.tmux.error || (error && !overview)) problems.open = true;

    list.replaceChildren();
    // どのプロジェクトにも属さない失敗 (パスを入力しての登録など)。
    const general = projectActivity("", "");
    if (general) list.appendChild(general);
    if (!overview) {
      if (!error) list.appendChild(emptyState(current.loading, ""));
      return;
    }
    // 登録したプロジェクトは、エージェントが居なくても (tmux が無くても)
    // 見出しだけで並べる。案内の箱はその上に出す。
    const registeredOnly = () => {
      for (const group of groupAgentPanes([], overview.projects, {
        includeEmptyRegistered: true,
      })) {
        list.appendChild(createProject(group));
      }
    };
    if (overview.tmux.error) {
      registeredOnly();
      return;
    }
    if (!overview.tmux.available) {
      list.appendChild(
        emptyState(
          current.emptyNotInstalledTitle,
          current.emptyNotInstalledBody,
        ),
      );
      registeredOnly();
      return;
    }
    if (!overview.tmux.running) {
      list.appendChild(
        emptyState(current.emptyNoTmuxTitle, current.emptyNoTmuxBody),
      );
      registeredOnly();
      return;
    }
    if (scoped.length === 0) {
      list.appendChild(
        emptyState(
          current.emptyNoAgentsTitle,
          current.emptyNoAgentsBody,
          allPanes || panes.length === 0
            ? undefined
            : {
                label: current.emptyNoAgentsAction,
                run: () => {
                  allPanes = true;
                  render(true);
                },
              },
        ),
      );
      registeredOnly();
      return;
    }
    const visible = filterAgentPanes(panes, { allPanes, state: stateFilter });
    if (visible.length === 0) {
      list.appendChild(
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
      return;
    }
    // 絞り込み中は、エージェントの居ない登録プロジェクトを出さない
    // (「入力待ちだけ」を見たいときに、関係の無い見出しが並ばないように)。
    for (const group of groupAgentPanes(visible, overview.projects, {
      includeEmptyRegistered: stateFilter === "all",
    })) {
      list.appendChild(createProject(group));
    }
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
   * 描き直す。キーボードの位置は鍵で覚えて戻す。スクロール位置は、箱を
   * 作り直さず中身だけ入れ替えるので、そのまま残る。
   */
  function render(force = false): void {
    if (!mounted) return;
    const next = signature();
    if (!force && next === lastSignature) return;
    lastSignature = next;
    const current = text();
    const focusedKey =
      document.activeElement instanceof HTMLElement &&
      list.contains(document.activeElement)
        ? document.activeElement.getAttribute(NAV_ATTR)
        : null;

    root.setAttribute("aria-label", current.ariaLabel);
    title.textContent = current.title;
    boardTitleText.textContent = current.board.allAgents;
    filterGroup.setAttribute("aria-label", current.filterLabel);
    allPanesText.textContent = current.allPanes;
    allPanesLabel.title = current.allPanesTitle;
    allPanesInput.checked = allPanes;
    hint.textContent = current.keyboardHint;
    // 狭いと末尾を省くので、全文はカーソルを置いたときに出す。
    hint.title = current.keyboardHint;
    refreshButton.title = current.refresh;
    refreshButton.setAttribute("aria-label", current.refresh);
    launchLabel.textContent = current.accounts.launchButton;
    launchButton.title = current.accounts.launchButtonTitle;
    hookHintClose.title = current.hookHintClose;
    hookHintClose.setAttribute("aria-label", current.hookHintClose);
    renderNotify();
    deps.accountsBand.render();
    renderHookHint();
    renderBody();

    const navs = navItems();
    const restore =
      (focusedKey &&
        navs.find((item) => item.getAttribute(NAV_ATTR) === focusedKey)) ||
      null;
    // 行へ Tab で入れるのは 1 つだけ (矢印で動く)。選んでいる行、無ければ
    // 一番上の行 (並び順で最も急ぐもの)。Enter 1 回でそこへ行ける。
    const tabStop =
      restore ??
      navs.find((item) => item.classList.contains("active")) ??
      navs.find((item) => item.classList.contains("agents-row")) ??
      navs[0];
    if (tabStop) tabStop.tabIndex = 0;
    restore?.focus({ preventScroll: true });
  }

  function navItems(): HTMLElement[] {
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
    document.body.classList.add("gdp-agents-page");
    deps.setPageMode();
    deps.syncHeaderMenu();
    const offMonitor = deps.monitor.subscribe(() => render());
    const offProjects = deps.projects.subscribe(() => render());
    unsubscribe = () => {
      offMonitor();
      offProjects();
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
        list.querySelector<HTMLElement>('[tabindex="0"]')?.focus({
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
