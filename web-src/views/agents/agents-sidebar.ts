import { withoutProjectPrefix } from "../../core/api-url";
import { formatErrorDetail } from "../../core/error-detail";
// 左のサイドバーの「プロジェクト → エージェント」の一覧。どの画面にいても出る。
//
//   PROJECTS                              [全体ボード]
//   ▾ SA sample-app ◆                        ← いま見ているプロジェクト (その色で薄く塗る)
//       ◆ claude  Review plan        3m      ← 押すとターミナルでそのペインを開く
//       ◠ codex   Add tests          8m
//   ▾ SL sample-lib
//       ○ claude  Idle              12m
//   ▸ SD sample-docs                         ← エージェントの居ないプロジェクトは 1 行
//   ▸ 停止中 (3)                              ← 起動中でない登録プロジェクト (既定は畳む)
//   (SA などはプロジェクトの色の四角と頭文字。views/projects/project-looks.ts)
//
// 並び・登録プロジェクトと tmux から見つかったプロジェクトの合流・未読は
// エージェントの全体ボード (agents-view.ts) と同じ純関数 (core/agent-overview)
// と同じ取り直し (agent-monitor) をそのまま使う。開く・止める・名前などの
// 操作も同じ (project-actions / project-menu)。ここは狭い幅に向けた描き方だけ
// を持つ。絞り込みやアカウントの帯・通知の許可は全体ボードに任せる。

import {
  type AgentPane,
  type AgentProjectGroup,
  type AgentProjectInfo,
  groupAgentPanesByPlace,
  notifyPermissionView,
} from "../../core/agent-overview";
import {
  CHEVRON_DOWN_16_PATH,
  iconSvg,
  KEBAB_16_PATH,
  PLUS_16_PATH,
} from "../../core/icons";
import { SOFT_KEYS_MEDIA_QUERY } from "../../core/mobile-layout";
import {
  partitionProjectsByRunning,
  runningProjectRoots,
} from "../../core/project-running";
import { projectDropBefore } from "../../core/projects";
import { showContextMenu } from "../context-menu";
import type { ProjectActions } from "../projects/project-actions";
import {
  paintProjectColor,
  projectLook,
  projectMark,
} from "../projects/project-looks";
import { showProjectMenu } from "../projects/project-menu";
import { agentStateMark, fillAgentCard } from "./agent-card";
import type { AgentMonitor } from "./agent-monitor";
import { type HandoffMenuActions, handoffMenuItems } from "./handoff";
import type { AgentsText } from "./i18n";
import { markPreviewRow, PANE_PREVIEW, type PanePreview } from "./pane-preview";
import { paneText } from "./pane-text";

export type AgentsSidebarDeps = {
  root: HTMLElement;
  monitor: AgentMonitor;
  projects: ProjectActions;
  getText(): AgentsText;
  /** そのペインをターミナルで開く。opposite は反対の面 (1 面なら右へ分割)。 */
  openPane(pane: string, destination?: "opposite"): void;
  /** いまターミナルで見ているペイン (行の選択の印)。 */
  viewingPane(): string | null;
  /** 「新しいエージェント」の画面。project は選んでおくプロジェクト。 */
  launch(project?: string): void;
  /** 行の右クリックのメニューの「別のアカウントで続ける…」(handoff.ts)。 */
  handoff: HandoffMenuActions;
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
  /**
   * 停止中のプロジェクトの節を開いているか・開く / 畳む。畳んだプロジェクトと
   * 同じく全プロジェクト共通の設定に置く。既定は畳む。
   */
  isStoppedOpen(): boolean;
  setStoppedOpen(open: boolean): void;
  /** 最初の入力待ちの「通知を許可すると…」を閉じたか・閉じる。 */
  notifyHintDismissed(): boolean;
  dismissNotifyHint(): void;
  /** 行に載せたときの覗き窓 (既定は全体ボードと共有の 1 つ)。 */
  preview?: PanePreview;
  /**
   * プロジェクトの見出しを押した: そのプロジェクトへ移る。前面はそのプロジェクトの
   * タブのグループで最後に前面だったタブ (無ければフォルダ表示)。app.ts の
   * switchToProjectGroup。無ければ、いま見ている画面のまま移る。
   */
  switchProject?(info: AgentProjectInfo): void;
};

export type AgentsSidebar = {
  localize(): void;
  /** ターミナルで見ているペインが変わったとき。 */
  refresh(): void;
  /** 設定が読み込まれた・外から変わったとき (畳んだプロジェクト)。 */
  syncCollapsed(): void;
};

/** 描き直しの前後で同じ要素を指すための鍵。木の行 (矢印で動く) の分。 */
const NAV_ATTR = "data-nav-item";
/**
 * 木の行でない操作 (＋・⋯・案内や登録のボタン) の鍵。取り直しのたびに
 * 描き直すので、鍵が無いとフォーカスが body に落ち、次の Tab が差し替わった
 * 同じボタンにもう一度止まる。
 */
const FOCUS_ATTR = "data-nav-focus";
/** 見出しのドラッグの dataTransfer の型 (文字の欄へ落としても名前を入れない)。 */
const PROJECT_DRAG_TYPE = "application/x-code-viewer-project";
/** 上の区画 (登録したもの) のプロジェクトの箱の印。値は root。並べ替えの対象。 */
const ORDER_ATTR = "data-nav-order";

export function mountAgentsSidebar(deps: AgentsSidebarDeps): AgentsSidebar {
  const { root } = deps;
  root.role = "tree";
  root.addEventListener("keydown", onKeydown);
  /** 畳んだプロジェクト (root)。 */
  const collapsed = new Set<string>(deps.getCollapsed());
  let lastSignature = "";
  const preview = deps.preview ?? PANE_PREVIEW;
  preview.watch(root, { placement: "right", getText: () => text().preview });
  /** 登録したプロジェクト (上の区画) の root → 情報。並べ替えのキーとドロップに使う。 */
  let registeredInfos = new Map<string, AgentProjectInfo>();
  /**
   * 掴んでいる見出しの root。掴んでいる間は描き直さない (落とす先の線のほかは
   * 何も動かさない。掴んだ要素を差し替えると dragend が届かないこともある)。
   */
  let dragRoot: string | null = null;
  let renderDeferred = false;

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

    // 2 行組のカード (全体ボードと同じ部品。agent-card.ts)。作業の要約は
    // 「＋」・パレット・タブと同じ決まり (pane-text.ts)。tmux の既定の題名
    // (ホスト名など) は出さない。
    const shown = paneText(pane, current);
    markPreviewRow(row, pane.id, shown.row);
    const card = fillAgentCard(row, pane, current, unread);
    row.title = [
      shown.title,
      pane.worktree ? current.worktreeTitle(pane.worktree) : "",
      unread
        ? unread === "waiting"
          ? current.unreadWaiting
          : current.unreadFinished
        : "",
      card.ageTitle,
      current.openPane,
      current.openPaneOppositeHint,
    ]
      .filter(Boolean)
      .join("\n");
    row.setAttribute(
      "aria-label",
      `${current.state[pane.state]} · ${shown.kind} · ${shown.summary}`,
    );
    const openHere = (destination?: "opposite") => {
      deps.monitor.markRead(pane.id);
      deps.openPane(pane.id, destination);
      render(true);
    };
    // ターミナルは 1 か所にしか置けず、仮にもならないので、中ボタン・⌘/Ctrl
    // も 1 回押すと同じ (開くか前面に出す)。Alt は反対の面 (ui-surface.md の
    // 「タブの決まり」の例外の表)。
    const openBy = (event: MouseEvent) => {
      if (event.button > 1) return;
      event.preventDefault();
      openHere(event.altKey ? "opposite" : undefined);
    };
    row.addEventListener("click", openBy);
    row.addEventListener("auxclick", openBy);
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showContextMenu(
        row,
        [
          { label: current.openPane, onSelect: () => openHere() },
          {
            label: current.openPaneOpposite,
            onSelect: () => openHere("opposite"),
          },
          ...handoffMenuItems(pane, current, deps.handoff),
        ],
        { at: { x: event.clientX, y: event.clientY } },
      );
    });
    return row;
  }

  function iconButton(
    className: string,
    focusKey: string,
    svg: string,
    title: string,
    onClick: (event: MouseEvent, button: HTMLButtonElement) => void,
  ): HTMLButtonElement {
    const button = el("button", `nav-row-action ${className}`);
    button.type = "button";
    button.setAttribute(FOCUS_ATTR, focusKey);
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
    // いま見ているプロジェクトの見出しは、その色で薄く塗る (.current)。
    paintProjectColor(head, info.registered?.color ?? null);
    const starting = deps.projects.activity(info.root)?.kind === "starting";
    head.classList.toggle("starting", starting);

    // 畳む / 開くは左の山形だけ。名前を押すと移る (2 つを分ける)。
    const twisty = el("button", "nav-twisty");
    twisty.type = "button";
    twisty.tabIndex = -1;
    twisty.setAttribute(FOCUS_ATTR, `twisty:${info.root}`);
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
      info.registered ? current.sidebar.reorderHint : "",
    ]
      .filter(Boolean)
      .join("\n");
    // 見出しの頭はプロジェクトの色の四角と頭文字 (タブのグループ・ファイル一覧の
    // 頭と同じ)。名前の後ろに、起こしている最中は回る点線、人の番のもの (入力待ち・
    // 完了・作業中) があればその印 (畳んでいても中に何があるか分かる)。
    const projectState =
      group.counts.waiting > 0
        ? "waiting"
        : group.counts.done > 0
          ? "done"
          : group.counts.working > 0
            ? "working"
            : null;
    const name = el("span", "nav-project-name", info.name);
    toggle.append(projectMark(projectLook(info), "nav-project-mark"), name);
    if (starting || projectState) {
      const state = el("span", "nav-project-state");
      state.setAttribute("aria-hidden", "true");
      state.appendChild(
        starting
          ? el("i", "terminal-mark nav-mark-starting")
          : agentStateMark(projectState as NonNullable<typeof projectState>),
      );
      toggle.appendChild(state);
    }
    if (starting) {
      toggle.appendChild(
        el("span", "nav-project-status", current.sidebar.starting),
      );
    }
    toggle.addEventListener("click", () => {
      // いま見ているプロジェクトは何もしない (読み直さない)。起こしている
      // 最中の押し直しは project-actions が無視する。
      if (here || !info.git) return;
      // 同じタブで移る。登録していなければ確かめずに登録してから移る。
      if (deps.switchProject) {
        deps.switchProject(info);
        return;
      }
      void deps.projects.open(info, currentPath(), { confirmRegister: false });
    });
    head.append(twisty, toggle);
    const openMenu = (anchor: HTMLElement, at?: { x: number; y: number }) =>
      showProjectMenu(anchor, info, {
        actions: deps.projects,
        text: current.projects,
        registeredCount:
          deps.monitor.snapshot().overview?.registry.projects.length ?? 0,
        at,
      });
    // 右クリック (電話では長押し) で ⋯ と同じメニュー (上へ・下へを含む)。
    head.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMenu(head, { x: event.clientX, y: event.clientY });
    });
    if (info.registered) wireProjectDrag(section, head, info.root);

    // 件数は右端 (＋と ⋯ の場所)。見出しに載ったとき (hover・フォーカス) は
    // 操作に場所を譲る。
    if (hasAgents) {
      const count = el("span", "nav-project-count", String(group.panes.length));
      count.setAttribute("aria-hidden", "true");
      head.appendChild(count);
    }
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
          `launch:${info.root}`,
          iconSvg("octicon-plus", PLUS_16_PATH),
          current.accounts.launchProjectTitle(info.name),
          () => deps.launch(info.root),
        ),
      );
    }
    actions.appendChild(
      iconButton(
        "nav-project-menu",
        `menu:${info.root}`,
        iconSvg("octicon-kebab-horizontal", KEBAB_16_PATH),
        current.projects.menuTitle(info.name),
        (_event, button) => openMenu(button),
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
      close.setAttribute(FOCUS_ATTR, `dismiss:${info.root}`);
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

  /**
   * 上の区画の見出しを掴んで並べ替える。落とす先は隙間の線だけで示し、
   * 落とすまで何も動かさない。指の画面では掴まない (長押しはメニュー)。
   */
  function wireProjectDrag(
    section: HTMLElement,
    head: HTMLElement,
    rootKey: string,
  ): void {
    section.setAttribute(ORDER_ATTR, rootKey);
    if (window.matchMedia?.(SOFT_KEYS_MEDIA_QUERY).matches) return;
    head.draggable = true;
    head.addEventListener("dragstart", (event) => {
      dragRoot = rootKey;
      preview.setPaused(true);
      section.classList.add("nav-project-dragging");
      const transfer = event.dataTransfer;
      if (!transfer) return;
      transfer.setData(PROJECT_DRAG_TYPE, rootKey);
      transfer.effectAllowed = "move";
      // 下のエージェントも一緒に動くことを、掴んだ絵 (箱ごと) で見せる。
      const rect = section.getBoundingClientRect();
      transfer.setDragImage(
        section,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    });
    head.addEventListener("dragend", endDrag);
  }

  function orderedSections(): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(`:scope > [${ORDER_ATTR}]`)];
  }

  /**
   * ポインタの高さから落とす隙間 (0 = 先頭の前) と、送る before。見出しの
   * 真ん中より下なら、その箱 (下のエージェントを含む) の後ろ。
   */
  function dropTarget(
    clientY: number,
  ): { gap: number; before: string | null } | null {
    if (dragRoot === null) return null;
    const sections = orderedSections();
    const gap = sections.filter((section) => {
      const head = section.querySelector(".nav-project-head") ?? section;
      const rect = head.getBoundingClientRect();
      return rect.top + rect.height / 2 < clientY;
    }).length;
    const order = sections.map((item) => item.getAttribute(ORDER_ATTR) ?? "");
    const drop = projectDropBefore(order, dragRoot, gap);
    return drop && { gap, before: drop.before };
  }

  function clearDropMarks(): void {
    for (const section of root.querySelectorAll(
      ".nav-project-drop-before, .nav-project-drop-after",
    )) {
      section.classList.remove("nav-project-drop-before");
      section.classList.remove("nav-project-drop-after");
    }
  }

  function endDrag(): void {
    if (dragRoot === null) return;
    dragRoot = null;
    clearDropMarks();
    for (const section of root.querySelectorAll(".nav-project-dragging")) {
      section.classList.remove("nav-project-dragging");
    }
    preview.setPaused(false);
    if (renderDeferred) {
      renderDeferred = false;
      render(true);
    }
  }

  root.addEventListener("dragover", (event) => {
    clearDropMarks();
    const target = dropTarget(event.clientY);
    if (!target) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const sections = orderedSections();
    const at = sections[target.gap];
    if (at) at.classList.add("nav-project-drop-before");
    else sections[sections.length - 1]?.classList.add("nav-project-drop-after");
  });
  root.addEventListener("dragleave", (event) => {
    if (!root.contains(event.relatedTarget as Node | null)) clearDropMarks();
  });
  root.addEventListener("drop", (event) => {
    const target = dropTarget(event.clientY);
    const info = dragRoot === null ? undefined : registeredInfos.get(dragRoot);
    endDrag();
    if (!target || !info) return;
    event.preventDefault();
    void deps.projects.place(info, target.before);
  });
  // 描き直しなどで dragend が届かなかったとき (タブの列と同じ)。ドラッグの間は
  // ポインタの移動が届かないので、ボタンを離した移動が来たら終わっている。
  document.addEventListener(
    "pointermove",
    (event) => {
      if (dragRoot !== null && event.buttons === 0) endDrag();
    },
    { passive: true },
  );

  function setStoppedOpen(open: boolean): void {
    if (deps.isStoppedOpen() === open) return;
    deps.setStoppedOpen(open);
    render(true);
  }

  /**
   * 停止中 (エージェントもシェルも無く、裏のプロセスも動いていない) の登録
   * プロジェクトを、一覧の下の畳める節にまとめる。中の行は 1 行ずつで、押せば
   * 今までどおり開く (開けば起動中へ移る)。畳んでいても、中に問題があれば見出しに
   * 印を出す (隠さない)。
   */
  function stoppedSection(
    groups: AgentProjectGroup[],
    viewing: string | null,
  ): HTMLElement {
    const current = text();
    const open = deps.isStoppedOpen();
    const section = el("div", "nav-stopped");
    section.role = "group";
    const toggle = el("button", "nav-section-title nav-stopped-toggle");
    toggle.type = "button";
    toggle.id = "nav-stopped-title";
    toggle.role = "treeitem";
    toggle.tabIndex = -1;
    toggle.setAttribute(NAV_ATTR, "stopped");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.title = current.sidebar.stoppedTitle;
    toggle.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
    toggle.append(current.sidebar.stopped(groups.length));
    const errors = groups
      .map((group) => group.info.error)
      .filter((error) => error !== "");
    if (errors.length > 0) {
      const problem = el("span", "nav-project-problem", "!");
      problem.title = errors
        .map((error) => current.projectError(error))
        .join("\n");
      problem.setAttribute("aria-label", problem.title);
      toggle.appendChild(problem);
    }
    toggle.addEventListener("click", () => setStoppedOpen(!open));
    section.setAttribute("aria-labelledby", toggle.id);
    const list = el("div", "nav-stopped-list");
    list.hidden = !open;
    for (const group of groups) list.appendChild(createProject(group, viewing));
    section.append(toggle, list);
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
      deps.isStoppedOpen(),
      deps.projects.signature(),
      // 巡回を終えた時刻は描かない。含めると取り直しのたびに描き直す。
      snapshot.overview && { ...snapshot.overview, observedAt: 0 },
      showsNotifyHint(),
      notifyRequestError,
      // 経過時間は分単位でしか変わらない。
      Math.floor(Date.now() / 60_000),
    ]);
  }

  /** 案内から許可を求めて失敗した理由。空なら無し。 */
  let notifyRequestError = "";

  /** 入力待ちを見た・許可をまだ訊いていない・閉じていない。 */
  function showsNotifyHint(): boolean {
    return (
      deps.monitor.snapshot().sawWaiting &&
      deps.monitor.permission() === "default" &&
      !deps.notifyHintDismissed()
    );
  }

  /**
   * 通知の許可の案内。許可かブロックを選ぶか、閉じたら二度と出さない。
   * 窓を閉じただけ (default のまま) は答えていないので、「もう一度求める」で残す。
   */
  function notifyHint(current: AgentsText): HTMLElement[] {
    const again =
      notifyPermissionView(
        deps.monitor.permission(),
        deps.monitor.snapshot().permissionAsked,
      ) === "ask-again";
    const box = el("div", "nav-empty");
    box.setAttribute("role", "note");
    const allow = el(
      "button",
      "nav-note-link nav-empty-action",
      again ? current.notifyAskAgain : current.notifyEnable,
    );
    allow.type = "button";
    allow.setAttribute(FOCUS_ATTR, "notify-allow");
    allow.addEventListener("click", () => {
      deps.monitor.requestPermission().then(
        (result) => {
          if (result !== "default") deps.dismissNotifyHint();
          notifyRequestError = "";
          render(true);
        },
        (cause: unknown) => {
          // 全体ボードの「通知を有効にする」と同じ扱い: 理由を出す。
          console.error("[code-viewer] notification permission failed", cause);
          notifyRequestError = `${current.notifyRequestFailed}: ${formatErrorDetail(cause)}`;
          render(true);
        },
      );
    });
    const hide = el("button", "nav-note nav-note-link", current.hookHintClose);
    hide.type = "button";
    hide.setAttribute(FOCUS_ATTR, "notify-hide");
    hide.addEventListener("click", () => {
      deps.dismissNotifyHint();
      render(true);
    });
    box.append(
      el(
        "span",
        "nav-empty-body",
        again ? current.notifyNotYet : current.notifyHint,
      ),
      allow,
    );
    return [box, hide];
  }

  function render(force = false): void {
    if (dragRoot !== null) {
      renderDeferred = true;
      return;
    }
    const next = signature();
    if (!force && next === lastSignature) return;
    lastSignature = next;
    const current = text();
    const { overview, error } = deps.monitor.snapshot();
    const focused = focusedKeys();
    root.setAttribute("aria-label", current.sidebar.ariaLabel);
    root.replaceChildren();

    // 登録の失敗は理由を読めるように全文を出す (title だけだと気付けない)。
    const general = deps.projects.activity("");
    if (general?.kind === "failed") {
      root.appendChild(note("nav-note-error", general.title));
      root.appendChild(note("nav-note-error", general.detail));
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
    registeredInfos = new Map(
      registered.map((group) => [group.info.root, group.info]),
    );
    // 登録したものは起動中と停止中に分ける。起動中は今までどおり直下に (見出しは
    // 出さない。「起動中…」は見出しの中で「起こしている最中」の意味で使っている)、
    // 停止中は一覧の下の畳める節へ。どちらの中も登録の順。
    const starting = overview.projects
      .filter((info) => deps.projects.activity(info.root)?.kind === "starting")
      .map((info) => info.root);
    const split = partitionProjectsByRunning(
      registered,
      (group) => group.info.root,
      runningProjectRoots(overview, starting),
    );
    for (const group of split.running) {
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
      register.setAttribute(FOCUS_ATTR, "register-current");
      register.title = current.projects.switcherRegisterCurrentHint;
      register.addEventListener(
        "click",
        () => void deps.projects.registerCurrent(),
      );
      // いま見ている場所がリポジトリでなければ上の登録は断られるので、
      // パスを入れて登録する道も最初から出す。
      const byPath = el(
        "button",
        "nav-note nav-note-link",
        current.projects.addProjectMenu,
      );
      byPath.type = "button";
      byPath.setAttribute(FOCUS_ATTR, "register-path");
      byPath.addEventListener(
        "click",
        () => void deps.projects.registerByPath(),
      );
      empty.append(
        el("strong", "nav-empty-title", current.sidebar.noProjectsTitle),
        el("span", "nav-empty-body", current.sidebar.noProjectsBody),
        register,
      );
      root.append(empty, byPath);
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
    if (split.stopped.length > 0) {
      root.appendChild(stoppedSection(split.stopped, viewing));
    }
    const problems =
      (error ? 1 : 0) +
      (overview.registry.error ? 1 : 0) +
      (overview.tmux.error ? 1 : 0) +
      overview.errors.length;
    // 狭い列なので 1 行だけ。次に何をするかは全体ボードと同じ文を title に。
    if (!overview.tmux.available) {
      root.appendChild(
        note(
          "nav-note-muted",
          current.sidebar.notInstalled,
          current.emptyNotInstalledBody,
        ),
      );
    } else if (!overview.tmux.running) {
      root.appendChild(
        note("nav-note-muted", current.sidebar.noTmux, current.emptyNoTmuxBody),
      );
    } else if (panes.length === 0) {
      root.appendChild(
        note(
          "nav-note-muted",
          current.sidebar.noAgents,
          current.emptyNoAgentsBody,
        ),
      );
    }
    if (showsNotifyHint()) root.append(...notifyHint(current));
    if (notifyRequestError) {
      root.appendChild(note("nav-note-error", notifyRequestError));
    }
    if (problems > 0) {
      // 中身の全文は全体ボードの「問題」の欄にある。ここは入口だけ。
      const link = el(
        "button",
        "nav-note nav-note-error nav-note-link",
        current.sidebar.problems(problems),
      );
      link.type = "button";
      link.setAttribute(FOCUS_ATTR, "problems");
      link.addEventListener("click", () => deps.openBoard());
      root.appendChild(link);
    }

    const items = navItems();
    const find = (attr: string, key: string | null) =>
      key === null
        ? undefined
        : [...root.querySelectorAll<HTMLElement>(`[${attr}]`)].find(
            (node) =>
              node.getAttribute(attr) === key && !node.closest("[hidden]"),
          );
    // フォーカスは同じ役目の部品へ戻す。それが無くなったら (案内を閉じた・
    // エージェントが終わった) 同じプロジェクトの見出し、それも無ければ木の入口。
    const action = find(FOCUS_ATTR, focused?.action ?? null);
    const restore = action
      ? undefined
      : (find(NAV_ATTR, focused?.item ?? null) ??
        find(NAV_ATTR, focused?.project ?? null));
    // Tab で入れるのは 1 つだけ (矢印で動く)。選んでいる行、無ければ先頭。
    const tabStop =
      restore ??
      items.find((item) => item.classList.contains("active")) ??
      items[0];
    if (tabStop) tabStop.tabIndex = 0;
    if (focused) (action ?? tabStop)?.focus({ preventScroll: true });
  }

  /** 描き直す前にフォーカスが root の中にあれば、その鍵と属するプロジェクト。 */
  function focusedKeys(): {
    item: string | null;
    action: string | null;
    project: string | null;
  } | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
    return {
      item: active.getAttribute(NAV_ATTR),
      action: active.getAttribute(FOCUS_ATTR),
      project:
        active
          .closest(".nav-project")
          ?.querySelector(`[${NAV_ATTR}^="project:"]`)
          ?.getAttribute(NAV_ATTR) ?? null,
    };
  }

  function navItems(): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(`[${NAV_ATTR}]`)].filter(
      (item) => !item.closest("[hidden]"),
    );
  }

  function onKeydown(event: KeyboardEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute(NAV_ATTR)) {
      return;
    }
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      // 見出しで Alt+↑↓ は並べ替え (メニューの「上へ」「下へ」と同じ)。
      // フォーカスは描き直しが同じ見出しへ戻す。
      const key = target.getAttribute(NAV_ATTR) ?? "";
      const info = key.startsWith("project:")
        ? registeredInfos.get(key.slice("project:".length))
        : undefined;
      if (!info) return;
      event.preventDefault();
      void deps.projects.move(info, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter") {
      // ボタンの既定の動作に任せると届き方で click にならないことがある
      // (全体ボードと同じ)。1 回だけ押す。
      event.preventDefault();
      target.click();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const key = target.getAttribute(NAV_ATTR) ?? "";
      if (key === "stopped") {
        event.preventDefault();
        setStoppedOpen(event.key === "ArrowRight");
        return;
      }
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
