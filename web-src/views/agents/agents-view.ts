// エージェント一覧の画面 (/agents)。
//
// このマシンの tmux の全ペインを、ペインの cwd から求めたプロジェクトごとに
// 束ねて並べる。1 行で「どのプロジェクトの・どの種類が・どの状態で・何を
// しているか」が読めることを優先し、tmux の入れ子は場所の列に畳む。
//
//   [すべて 12][入力待ち 1][作業中 3][待機 8]  □すべてのペイン   [通知を有効にする]
//   ▾ sample-repo  ~/work/sample-repo   ◆1 ●2        開く
//       ● ◆ 入力待ち  claude  Fix the parser …   feature-x   work:1.0   3分
//
// 取り直しは agent-monitor が持つ。ここは最新の結果を購読して描くだけ。
// 描き直しても、選んでいる行・スクロール位置・畳んだプロジェクト・キーボード
// の位置が飛ばないように、行を鍵で覚えて描き直し後に戻す。
//
// 行を押す (Enter) と、既存のターミナルパネルでそのペインを開く
// (/_tmux/open と同じ経路。新しい接続は作らない)。

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
  paneTaskText,
} from "../../core/agent-overview";
import { CHEVRON_DOWN_16_PATH, iconSvg } from "../../core/icons";
import type { PageView } from "../page-view";
import type { AgentMonitor } from "./agent-monitor";
import type { AgentsText } from "./i18n";

export type AgentsViewDeps = {
  monitor: AgentMonitor;
  getText(): AgentsText;
  setPageMode(): void;
  syncHeaderMenu(): void;
  /** そのペインを下のターミナルパネルで開く。 */
  openPane(pane: string): void;
  /** 設定画面の通知の項目へ。 */
  openNotificationSettings(): void;
  /** フックの状態。まだ取っていなければ null。 */
  getHookStatus(): AgentHooksResponse | null;
  refreshHookStatus(): Promise<void>;
  hookHintDismissed(): boolean;
  dismissHookHint(): void;
  /** 設定画面のエージェント連携の節へ。 */
  openHookSettings(): void;
};

export type AgentsView = PageView;

/** 描き直しの前後で同じ要素を指すための鍵。 */
const NAV_ATTR = "data-agent-nav";

export function createAgentsView(deps: AgentsViewDeps): AgentsView {
  const root = document.createElement("section");
  root.className = "agents-page";

  const header = document.createElement("header");
  header.className = "agents-header";
  const title = document.createElement("strong");
  title.className = "agents-title";
  const filterGroup = document.createElement("div");
  filterGroup.className = "seg agents-filter";
  filterGroup.role = "group";
  const filterButtons = new Map<AgentStateFilter, HTMLButtonElement>();
  for (const filter of AGENT_STATE_FILTERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.filter = filter;
    const label = document.createElement("span");
    label.className = "agents-filter-label";
    const count = document.createElement("span");
    count.className = "agents-filter-count";
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
  const hint = document.createElement("span");
  hint.className = "agents-hint";
  const spacer = document.createElement("span");
  spacer.className = "agents-spacer";
  const notifyBox = document.createElement("div");
  notifyBox.className = "agents-notify";
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "agents-refresh";
  refreshButton.textContent = "⟳";
  refreshButton.addEventListener("click", () => void deps.monitor.refresh());
  header.append(
    title,
    filterGroup,
    allPanesLabel,
    hint,
    spacer,
    notifyBox,
    refreshButton,
  );

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
  hookHintClose.className = "agents-hook-hint-close";
  hookHintClose.textContent = "×";
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

  const list = document.createElement("div");
  list.className = "agents-list";
  list.role = "tree";
  list.addEventListener("keydown", onListKeydown);

  root.append(header, hookHint, problems, list);

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

  function stateMark(state: AgentPane["state"]): HTMLElement {
    const mark = document.createElement("i");
    mark.className = `terminal-mark terminal-mark-${state}`;
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }

  function select(pane: AgentPane): void {
    selected = pane.id;
    deps.monitor.markRead(pane.id);
    deps.openPane(pane.id);
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

    const dot = document.createElement("span");
    dot.className = "agents-unread";
    if (unread) {
      dot.title =
        unread === "waiting" ? current.unreadWaiting : current.unreadFinished;
      dot.setAttribute("aria-label", current.unread);
    }

    const state = document.createElement("span");
    state.className = `agents-state terminal-row-state-${pane.state}`;
    state.append(stateMark(pane.state), current.state[pane.state]);

    const kind = document.createElement("span");
    kind.className = `agents-kind agents-kind-${pane.kind ?? "shell"}`;
    kind.textContent = pane.kind ? current.kind[pane.kind] : current.kindShell;

    const task = document.createElement("span");
    task.className = "agents-task";
    task.textContent = paneTaskText(pane);

    const worktree = document.createElement("span");
    worktree.className = "agents-worktree";
    if (pane.worktree) {
      worktree.textContent = pane.worktree;
      worktree.title = current.worktreeTitle(pane.worktree);
    }

    const place = document.createElement("span");
    place.className = "agents-place terminal-mono";
    place.textContent = pane.label;

    const age = document.createElement("span");
    age.className = "agents-age";
    // 変わった瞬間を見たものだけ時間を出す。それ以外は種類を問わず同じ
    // 「–」にして、分かっている下限だけをツールチップに書く。
    if (pane.updatedAt > 0) {
      age.textContent = current.elapsed(Date.now() - pane.updatedAt);
    } else {
      age.textContent = current.elapsedUnknown;
      const watched =
        pane.watchedSince > 0 ? Date.now() - pane.watchedSince : 0;
      age.title =
        watched >= 60_000
          ? current.elapsedAtLeast(current.elapsed(watched))
          : current.elapsedJustWatched;
    }

    row.append(dot, state, kind, task, worktree, place, age);
    row.title = [
      pane.title || pane.command,
      `${pane.label} · ${pane.command}`,
      pane.path,
      unread ? dot.title : "",
      age.title,
      current.openPane,
    ]
      .filter(Boolean)
      .join("\n");
    row.addEventListener("click", () => select(pane));
    return row;
  }

  function projectServer(group: AgentProjectGroup): HTMLElement | null {
    const current = text();
    const server = group.info.server;
    if (server.status === "running") {
      const link = document.createElement("a");
      link.className = "agents-server-link";
      link.href = server.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = current.openServer;
      link.title = current.openServerTitle(server.url);
      return link;
    }
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
    return null;
  }

  function createProject(group: AgentProjectGroup): HTMLElement {
    const current = text();
    const section = document.createElement("section");
    section.className = "agents-project";
    const isCollapsed = collapsed.has(group.info.root);

    const head = document.createElement("div");
    head.className = "agents-project-head";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "agents-project-toggle";
    toggle.setAttribute(NAV_ATTR, `project:${group.info.root}`);
    toggle.tabIndex = -1;
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    toggle.title = `${group.info.root}\n${current.toggleProject}`;
    const twisty = document.createElement("span");
    twisty.className = "terminal-tree-twisty";
    twisty.classList.toggle("collapsed", isCollapsed);
    twisty.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
    twisty.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "agents-project-name";
    name.textContent = group.info.name;
    const path = document.createElement("span");
    path.className = "agents-project-path terminal-mono";
    path.textContent = group.info.git
      ? group.info.displayRoot
      : `${group.info.displayRoot} · ${current.outsideGit}`;
    toggle.append(twisty, name, path);
    toggle.addEventListener("click", () => {
      if (collapsed.has(group.info.root)) collapsed.delete(group.info.root);
      else collapsed.add(group.info.root);
      render(true);
    });

    const counts = document.createElement("span");
    counts.className = "agents-project-counts";
    const summary: string[] = [];
    for (const state of ["waiting", "working", "done", "idle"] as const) {
      const n = group.counts[state];
      if (n === 0) continue;
      const chip = document.createElement("span");
      chip.className = `agents-count agents-count-${state}`;
      chip.append(stateMark(state), String(n));
      counts.appendChild(chip);
      summary.push(`${current.state[state]} ${n}`);
    }
    counts.title = summary.join(" · ");

    head.append(toggle, counts);
    if (group.info.error) {
      const error = document.createElement("span");
      error.className = "agents-server-problem";
      error.textContent = "!";
      error.title = current.projectError(group.info.error);
      error.setAttribute("aria-label", error.title);
      head.appendChild(error);
    }
    const server = projectServer(group);
    if (server) head.appendChild(server);

    const rows = document.createElement("div");
    rows.className = "agents-rows";
    rows.role = "group";
    rows.hidden = isCollapsed;
    for (const pane of group.panes) rows.appendChild(createRow(pane));
    section.append(head, rows);
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
      button.className = "gdp-btn gdp-btn-sm";
      button.textContent = action.label;
      button.addEventListener("click", action.run);
      box.appendChild(button);
    }
    return box;
  }

  function renderNotify(): void {
    const current = text();
    notifyBox.replaceChildren();
    const permission = deps.monitor.permission();
    const status = document.createElement("span");
    status.className = "agents-notify-status";
    if (permission === "default") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gdp-btn gdp-btn-sm agents-notify-enable";
      button.textContent = current.notifyEnable;
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
    } else if (permission === "granted") {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "agents-notify-on";
      link.textContent = current.notifyOn;
      link.title = current.notifyOnTitle;
      link.addEventListener("click", () => deps.openNotificationSettings());
      notifyBox.appendChild(link);
    } else if (permission === "denied") {
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

    const problemLines = [
      ...(error ? [error] : []),
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
    if (!overview) {
      if (!error) list.appendChild(emptyState(current.loading, ""));
      return;
    }
    if (overview.tmux.error) return;
    if (!overview.tmux.available) {
      list.appendChild(
        emptyState(
          current.emptyNotInstalledTitle,
          current.emptyNotInstalledBody,
        ),
      );
      return;
    }
    if (!overview.tmux.running) {
      list.appendChild(
        emptyState(current.emptyNoTmuxTitle, current.emptyNoTmuxBody),
      );
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
    for (const group of groupAgentPanes(visible, overview.projects)) {
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
    filterGroup.setAttribute("aria-label", current.filterLabel);
    allPanesText.textContent = current.allPanes;
    allPanesLabel.title = current.allPanesTitle;
    allPanesInput.checked = allPanes;
    hint.textContent = current.keyboardHint;
    refreshButton.title = current.refresh;
    refreshButton.setAttribute("aria-label", current.refresh);
    renderNotify();
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
    unsubscribe = deps.monitor.subscribe(() => render());
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
