import { withoutProjectPrefix } from "../../core/api-url";
// 左のサイドバーの「プロジェクト → エージェント」の一覧。どの画面にいても出る。
//
//   PROJECTS                              [全体ボード]
//   ▾ ▣ sample-app            ●              ← いま見ているプロジェクト
//       ◆ claude  Review plan        3m      ← 押すとターミナルでそのペインを開く
//       ◠ codex   Add tests          8m
//   ▾ ▣ sample-lib
//       ○ claude  Idle              12m
//   ▸ ▣ sample-docs                          ← エージェントの居ないプロジェクトは 1 行
//
// 並び・登録プロジェクトと tmux から見つかったプロジェクトの合流・未読は
// エージェントの全体ボード (agents-view.ts) と同じ純関数 (core/agent-overview)
// と同じ取り直し (agent-monitor) をそのまま使う。開く・止める・名前などの
// 操作も同じ (project-actions / project-menu)。ここは狭い幅に向けた描き方だけ
// を持つ。絞り込みやアカウントの帯・通知の許可は全体ボードに任せる。

import {
  type AgentPane,
  type AgentProjectGroup,
  groupAgentPanesByPlace,
  paneTaskText,
} from "../../core/agent-overview";
import {
  CHEVRON_DOWN_16_PATH,
  FOLDER_ICON_PATHS,
  iconSvg,
  KEBAB_16_PATH,
  PLUS_16_PATH,
} from "../../core/icons";
import { showContextMenu } from "../context-menu";
import type { ProjectActions } from "../projects/project-actions";
import { showProjectMenu } from "../projects/project-menu";
import type { AgentMonitor } from "./agent-monitor";
import type { AgentsText } from "./i18n";

export type AgentsSidebarDeps = {
  root: HTMLElement;
  monitor: AgentMonitor;
  projects: ProjectActions;
  getText(): AgentsText;
  /** そのペインをターミナルで開く (既定はメインの面のタブ)。 */
  openPane(pane: string, where?: "tab" | "panel"): void;
  /** いまターミナルで見ているペイン (行の選択の印)。 */
  viewingPane(): string | null;
  /** 「新しいエージェント」の画面。project は選んでおくプロジェクト。 */
  launch(project?: string): void;
  /** エージェントの全体ボードへ。 */
  openBoard(): void;
  /**
   * 畳んだプロジェクト (root)。全プロジェクト共通の設定に置く (移っても
   * サイドバーが同じに見えるように)。
   */
  getCollapsed(): readonly string[];
  /** いま見ているリポジトリの名前 (登録が 1 つも無いときの案内に出す)。 */
  currentName(): string;
  saveCollapsed(roots: string[]): void;
};

export type AgentsSidebar = {
  localize(): void;
  /** ターミナルで見ているペインが変わったとき。 */
  refresh(): void;
  /** 設定が読み込まれた・外から変わったとき (畳んだプロジェクト)。 */
  syncCollapsed(): void;
};

/** 描き直しの前後で同じ要素を指すための鍵。 */
const NAV_ATTR = "data-nav-item";

export function mountAgentsSidebar(deps: AgentsSidebarDeps): AgentsSidebar {
  const { root } = deps;
  root.role = "tree";
  root.addEventListener("keydown", onKeydown);
  /** 畳んだプロジェクト (root)。 */
  const collapsed = new Set<string>(deps.getCollapsed());
  let lastSignature = "";

  function text(): AgentsText {
    return deps.getText();
  }

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    content?: string,
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function stateMark(state: AgentPane["state"]): HTMLElement {
    const mark = el("i", `terminal-mark terminal-mark-${state}`);
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }

  function ageText(pane: AgentPane): { text: string; title: string } {
    const current = text();
    // 変わった瞬間を見たものだけ時間を出す (全体ボードと同じ決まり)。
    if (pane.updatedAt > 0) {
      return { text: current.elapsed(Date.now() - pane.updatedAt), title: "" };
    }
    const watched = pane.watchedSince > 0 ? Date.now() - pane.watchedSince : 0;
    return {
      text: current.elapsedUnknown,
      title:
        watched >= 60_000
          ? current.elapsedAtLeast(current.elapsed(watched))
          : current.elapsedJustWatched,
    };
  }

  function createAgentRow(pane: AgentPane, viewing: string | null) {
    const current = text();
    const unread = deps.monitor.snapshot().unread.get(pane.id);
    const row = el("button", `nav-agent nav-agent-${pane.state}`);
    row.type = "button";
    row.role = "treeitem";
    row.tabIndex = -1;
    row.setAttribute(NAV_ATTR, `pane:${pane.id}`);
    const active = pane.id === viewing;
    row.classList.toggle("active", active);
    row.classList.toggle("unread", unread !== undefined);
    if (active) row.setAttribute("aria-current", "true");

    const kind = el(
      "span",
      "nav-agent-kind",
      pane.kind ? current.kind[pane.kind] : current.kindShell,
    );
    const paneTask = paneTaskText(pane);
    // tmux / shell の既定の題名はホスト名やコマンド名のような 1 語になる。
    // それを作業内容として見せず、AI CLI が書いた説明的な題名だけを使う。
    const rawTitle = pane.title.trim();
    const task = el(
      "span",
      "nav-agent-task",
      paneTask !== pane.command &&
        (paneTask !== rawTitle ||
          /\s/.test(rawTitle) ||
          /[^\p{ASCII}]/u.test(rawTitle))
        ? paneTask
        : current.state[pane.state],
    );
    const age = ageText(pane);
    const time = el("span", "nav-agent-age", age.text);
    if (age.title) time.title = age.title;
    const dot = el("span", "nav-agent-unread");
    dot.setAttribute("aria-hidden", "true");
    row.append(stateMark(pane.state), kind, task, time, dot);
    row.title = [
      `${current.state[pane.state]} · ${task.textContent}`,
      `${pane.label} · ${pane.command}`,
      pane.worktree ? current.worktreeTitle(pane.worktree) : "",
      unread
        ? unread === "waiting"
          ? current.unreadWaiting
          : current.unreadFinished
        : "",
      age.title,
      current.openPane,
      current.openPaneInPanelHint,
    ]
      .filter(Boolean)
      .join("\n");
    row.setAttribute(
      "aria-label",
      `${current.state[pane.state]} · ${kind.textContent} · ${task.textContent}`,
    );
    const openHere = (where: "tab" | "panel") => {
      deps.monitor.markRead(pane.id);
      deps.openPane(pane.id, where);
      render(true);
    };
    row.addEventListener("click", (event) =>
      openHere(event.altKey ? "panel" : "tab"),
    );
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showContextMenu(
        row,
        [
          { label: current.openPane, onSelect: () => openHere("tab") },
          { label: current.openPaneInPanel, onSelect: () => openHere("panel") },
        ],
        { at: { x: event.clientX, y: event.clientY } },
      );
    });
    return row;
  }

  function iconButton(
    className: string,
    svg: string,
    title: string,
    onClick: (event: MouseEvent, button: HTMLButtonElement) => void,
  ): HTMLButtonElement {
    const button = el("button", `nav-row-action ${className}`);
    button.type = "button";
    button.innerHTML = svg;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", (event) => {
      // 行 (畳む / 開く) の click にしない。メニューは文書全体の click で
      // 閉じるので、開いたばかりのメニューを閉じさせない。
      event.stopPropagation();
      onClick(event, button);
    });
    return button;
  }

  function createProject(group: AgentProjectGroup, viewing: string | null) {
    const current = text();
    const info = group.info;
    const section = el("div", "nav-project");
    const isCollapsed = collapsed.has(info.root);
    const hasAgents = group.panes.length > 0;
    const here = info.server.status === "current";

    const head = el("div", "nav-project-head");
    head.classList.toggle("current", here);
    const starting = deps.projects.activity(info.root)?.kind === "starting";
    head.classList.toggle("starting", starting);

    // 畳む / 開くは左の山形だけ。名前を押すと移る (2 つを分ける)。
    const twisty = el("button", "nav-twisty");
    twisty.type = "button";
    twisty.tabIndex = -1;
    twisty.classList.toggle("collapsed", isCollapsed || !hasAgents);
    twisty.classList.toggle("empty", !hasAgents);
    twisty.disabled = !hasAgents;
    twisty.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
    twisty.title = current.toggleProject;
    twisty.setAttribute("aria-label", current.toggleProject);
    twisty.addEventListener("click", () => toggleCollapsed(info.root));

    const toggle = el("button", "nav-project-toggle");
    toggle.type = "button";
    toggle.role = "treeitem";
    toggle.tabIndex = -1;
    toggle.setAttribute(NAV_ATTR, `project:${info.root}`);
    if (hasAgents) toggle.setAttribute("aria-expanded", String(!isCollapsed));
    if (here) toggle.setAttribute("aria-current", "page");
    toggle.setAttribute("aria-busy", String(starting));
    toggle.title = [
      info.displayRoot,
      here
        ? current.sidebar.current
        : starting
          ? current.projects.startingTitle(info.name)
          : info.server.status === "running"
            ? current.projects.openTitle(info.name)
            : info.registered
              ? current.projects.openStoppedTitle(info.name)
              : current.projects.openUnregisteredTitle(info.name),
    ].join("\n");
    // 見出しの絵: 起こしている最中は回る点線、人の番のもの (入力待ち・完了)
    // があればその印 (畳んでいても中に何があるか分かる)、無ければフォルダ。
    const projectState =
      group.counts.waiting > 0
        ? "waiting"
        : group.counts.done > 0
          ? "done"
          : group.counts.working > 0
            ? "working"
            : null;
    const icon = el("span", "nav-project-icon");
    icon.setAttribute("aria-hidden", "true");
    if (starting) {
      icon.appendChild(el("i", "terminal-mark nav-mark-starting"));
    } else if (projectState) {
      icon.appendChild(stateMark(projectState));
    } else {
      icon.innerHTML = iconSvg(
        "octicon-file-directory",
        FOLDER_ICON_PATHS.closed,
      );
    }
    const name = el("span", "nav-project-name", info.name);
    toggle.append(icon, name);
    if (starting) {
      toggle.appendChild(
        el("span", "nav-project-status", current.sidebar.starting),
      );
    }
    toggle.addEventListener("click", () => {
      // いま見ているプロジェクトは何もしない (読み直さない)。起こしている
      // 最中の押し直しは project-actions が無視する。
      if (here || !info.git) return;
      // 同じタブで、いま見ている画面のまま移る (ヘッダの切替と同じ)。
      // 登録していなければ確かめずに登録してから移る。
      void deps.projects.open(info, currentPath(), { confirmRegister: false });
    });
    head.append(twisty, toggle);

    const actions = el("span", "nav-project-actions");
    if (info.error || info.server.status === "unreachable") {
      const problem = el("span", "nav-project-problem", "!");
      problem.title = info.error
        ? current.projectError(info.error)
        : info.server.status === "unreachable"
          ? current.serverProblem(info.server.detail)
          : "";
      problem.setAttribute("aria-label", problem.title);
      head.appendChild(problem);
    }
    if (info.git) {
      actions.appendChild(
        iconButton(
          "nav-project-launch",
          iconSvg("octicon-plus", PLUS_16_PATH),
          current.accounts.launchProjectTitle(info.name),
          () => deps.launch(info.root),
        ),
      );
    }
    actions.appendChild(
      iconButton(
        "nav-project-menu",
        iconSvg("octicon-kebab-horizontal", KEBAB_16_PATH),
        current.projects.menuTitle(info.name),
        (_event, button) =>
          showProjectMenu(button, info, {
            actions: deps.projects,
            text: current.projects,
            registeredCount:
              deps.monitor.snapshot().overview?.registry.projects.length ?? 0,
          }),
      ),
    );
    head.appendChild(actions);
    section.appendChild(head);

    // 起こせなかった・登録できなかったときは、見出しのすぐ下に理由の全文。
    // (起こしている最中は見出しの中の「起動中…」だけ。)
    const activity = deps.projects.activity(info.root);
    if (activity?.kind === "failed") {
      const box = el("div", "nav-project-activity nav-project-activity-failed");
      box.setAttribute("role", "alert");
      const head = el("div", "nav-project-activity-head");
      const title = el("strong", "", activity.title);
      const close = el("button", "nav-row-action", "×");
      close.type = "button";
      close.title = current.projects.dismiss;
      close.setAttribute("aria-label", current.projects.dismiss);
      close.addEventListener("click", () => deps.projects.dismiss(info.root));
      head.append(title, close);
      const detail = el("pre", "nav-project-activity-detail", activity.detail);
      box.append(head, detail);
      section.appendChild(box);
    }

    if (hasAgents) {
      const rows = el("div", "nav-agents");
      rows.role = "group";
      rows.hidden = isCollapsed;
      for (const pane of group.panes) {
        rows.appendChild(createAgentRow(pane, viewing));
      }
      section.appendChild(rows);
    }
    return section;
  }

  function toggleCollapsed(root: string): void {
    if (collapsed.has(root)) collapsed.delete(root);
    else collapsed.add(root);
    deps.saveCollapsed([...collapsed]);
    render(true);
  }

  /** いまの画面のパス (前置きを外したもの)。プロジェクトを移るときの移り先。 */
  function currentPath(): string {
    return withoutProjectPrefix(
      document
        .querySelector<HTMLAnchorElement>("a.app-menu-item.active")
        ?.getAttribute("href") ?? "/",
    );
  }

  function note(className: string, message: string, title = ""): HTMLElement {
    const line = el("div", `nav-note ${className}`, message);
    if (title) line.title = title;
    return line;
  }

  function signature(): string {
    const snapshot = deps.monitor.snapshot();
    return JSON.stringify([
      text().sidebar.projects,
      [...collapsed],
      [...snapshot.unread],
      snapshot.error,
      deps.viewingPane(),
      deps.projects.signature(),
      snapshot.overview,
      // 経過時間は分単位でしか変わらない。
      Math.floor(Date.now() / 60_000),
    ]);
  }

  function render(force = false): void {
    const next = signature();
    if (!force && next === lastSignature) return;
    lastSignature = next;
    const current = text();
    const { overview, error } = deps.monitor.snapshot();
    const focusedKey =
      document.activeElement instanceof HTMLElement &&
      root.contains(document.activeElement)
        ? document.activeElement.getAttribute(NAV_ATTR)
        : null;
    root.setAttribute("aria-label", current.sidebar.ariaLabel);
    root.replaceChildren();

    const general = deps.projects.activity("");
    if (general?.kind === "failed") {
      root.appendChild(note("nav-note-error", general.title, general.detail));
    }
    if (!overview) {
      root.appendChild(
        error
          ? note("nav-note-error", current.loadFailed, error)
          : note("nav-note-muted", current.loading),
      );
      return;
    }
    const panes = overview.panes.filter((pane) => pane.kind !== null);
    const viewing = deps.viewingPane();
    // 2 つの区画に分ける。上 (見出しは枠の「PROJECTS」) は登録したもので、
    // エージェントが居なくても 1 行、利用者の決めた順で動かない。下は登録して
    // いないが tmux にエージェントが居るもの。エージェントの起動・終了で
    // 出入りするのは下の区画の中だけで、上の行の位置は動かない。
    const groups = groupAgentPanesByPlace(panes, overview.projects, {
      includeEmptyRegistered: true,
    });
    const registered = groups.filter((group) => group.info.registered);
    const detected = groups.filter((group) => !group.info.registered);
    for (const group of registered) {
      root.appendChild(createProject(group, viewing));
    }
    if (registered.length === 0) {
      // 登録が 1 つも無い: いま見ているリポジトリを登録する入口 (ヘッダの
      // 切替と同じ操作)。登録すると上の区画に 1 行で常に出る。
      const empty = el("div", "nav-empty");
      const register = el(
        "button",
        "nav-note-link nav-empty-action",
        current.projects.switcherRegisterCurrent(deps.currentName()),
      );
      register.type = "button";
      register.title = current.projects.switcherRegisterCurrentHint;
      register.addEventListener(
        "click",
        () => void deps.projects.registerCurrent(),
      );
      empty.append(
        el("strong", "nav-empty-title", current.sidebar.noProjectsTitle),
        el("span", "nav-empty-body", current.sidebar.noProjectsBody),
        register,
      );
      root.appendChild(empty);
    }
    if (detected.length > 0) {
      const section = el("div", "nav-detected");
      section.role = "group";
      const heading = el(
        "div",
        "nav-section-title nav-detected-title",
        current.sidebar.detected,
      );
      heading.id = "nav-detected-title";
      heading.title = current.sidebar.detectedTitle;
      section.setAttribute("aria-labelledby", heading.id);
      section.appendChild(heading);
      for (const group of detected) {
        section.appendChild(createProject(group, viewing));
      }
      root.appendChild(section);
    }
    const problems =
      (error ? 1 : 0) +
      (overview.registry.error ? 1 : 0) +
      (overview.tmux.error ? 1 : 0) +
      overview.errors.length;
    if (!overview.tmux.available) {
      root.appendChild(note("nav-note-muted", current.sidebar.notInstalled));
    } else if (!overview.tmux.running) {
      root.appendChild(note("nav-note-muted", current.sidebar.noTmux));
    } else if (panes.length === 0) {
      root.appendChild(note("nav-note-muted", current.sidebar.noAgents));
    }
    if (problems > 0) {
      // 中身の全文は全体ボードの「問題」の欄にある。ここは入口だけ。
      const link = el(
        "button",
        "nav-note nav-note-error nav-note-link",
        current.sidebar.problems(problems),
      );
      link.type = "button";
      link.addEventListener("click", () => deps.openBoard());
      root.appendChild(link);
    }

    const items = navItems();
    const restore =
      (focusedKey &&
        items.find((item) => item.getAttribute(NAV_ATTR) === focusedKey)) ||
      null;
    // Tab で入れるのは 1 つだけ (矢印で動く)。選んでいる行、無ければ先頭。
    const tabStop =
      restore ??
      items.find((item) => item.classList.contains("active")) ??
      items[0];
    if (tabStop) tabStop.tabIndex = 0;
    restore?.focus({ preventScroll: true });
  }

  function navItems(): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(`[${NAV_ATTR}]`)].filter(
      (item) => !item.closest("[hidden]"),
    );
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute(NAV_ATTR)) {
      return;
    }
    if (event.key === "Enter") {
      // ボタンの既定の動作に任せると届き方で click にならないことがある
      // (全体ボードと同じ)。1 回だけ押す。
      event.preventDefault();
      target.click();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const key = target.getAttribute(NAV_ATTR) ?? "";
      if (!key.startsWith("project:")) return;
      const rootKey = key.slice("project:".length);
      const wantCollapsed = event.key === "ArrowLeft";
      if (collapsed.has(rootKey) === wantCollapsed) return;
      if (target.getAttribute("aria-expanded") === null) return;
      event.preventDefault();
      // Enter (= 押す) は移る。畳む / 開くは山形と同じ動きを直接呼ぶ。
      toggleCollapsed(rootKey);
      return;
    }
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const items = navItems();
    if (items.length === 0) return;
    const index = items.indexOf(target);
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(items.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else next = items.length - 1;
    const item = items[next];
    if (!item) return;
    event.preventDefault();
    for (const other of items) other.tabIndex = -1;
    item.tabIndex = 0;
    item.focus();
    item.scrollIntoView({ block: "nearest" });
  }

  deps.monitor.subscribe(() => render());
  deps.projects.subscribe(() => render());
  render(true);
  return {
    localize: () => render(true),
    refresh: () => render(),
    syncCollapsed() {
      collapsed.clear();
      for (const root of deps.getCollapsed()) collapsed.add(root);
      render(true);
    },
  };
}
