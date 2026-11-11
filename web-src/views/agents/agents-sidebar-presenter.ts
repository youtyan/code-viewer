import { withoutProjectPrefix } from "../../core/api-url";
import { formatErrorDetail } from "../../core/error-detail";
import type { SplitDir } from "../../core/workspace";
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
//
// presenter。表示は注入した view (既定は agents-sidebar-view.ts の DEFAULT_VIEW)。

import {
  type AgentPane,
  type AgentProjectGroup,
  type AgentProjectInfo,
  groupAgentPanesByPlace,
  notifyPermissionView,
} from "../../core/agent-overview";
import { SOFT_KEYS_MEDIA_QUERY } from "../../core/mobile-layout";
import {
  partitionProjectsByRunning,
  runningProjectRoots,
} from "../../core/project-running";
import { projectDropBefore } from "../../core/projects";
import { showContextMenu } from "../context-menu";
import type { ProjectActions } from "../projects/project-actions";
import { projectLook } from "../projects/project-looks";
import { showProjectMenu } from "../projects/project-menu";
import { createRenderer } from "../ui/renderer";
import { agentCardTemplate } from "./agent-card";
import type { AgentMonitor } from "./agent-monitor";
import { type HandoffMenuActions, handoffMenuItems } from "./handoff";
import type { AgentsText } from "./i18n";
import {
  type AgentRowProps,
  type AgentsSidebarView,
  type AgentsSidebarViewProps,
  DEFAULT_VIEW,
  FOCUS_ATTR,
  NAV_ATTR,
  ORDER_ATTR,
  type SidebarNote,
  type SidebarProjectProps,
} from "./agents-sidebar-view";
import { PANE_PREVIEW, type PanePreview } from "./pane-preview";
import { paneText } from "./pane-text";

export type AgentsSidebarDeps = {
  root: HTMLElement;
  monitor: AgentMonitor;
  projects: ProjectActions;
  getText(): AgentsText;
  /** そのペインをターミナルで開く。 */
  openPane(pane: string): void;
  /** 今の面を分けて、そのプロジェクトを開く (外側のページだけ。無ければメニューに出さない)。 */
  splitProject?(root: string, dir: SplitDir): void;
  /** いまターミナルで見ているペイン (行の選択の印)。 */
  viewingPane(): string | null;
  /** タブのグループと同じメニューを、選んだプロジェクトの＋から開く。 */
  openProjectMenu(root: string, anchor: HTMLElement): void;
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

/** 見出しのドラッグの dataTransfer の型 (文字の欄へ落としても名前を入れない)。 */
const PROJECT_DRAG_TYPE = "application/x-code-viewer-project";

export function createAgentsSidebarPresenter(
  deps: AgentsSidebarDeps,
  view: AgentsSidebarView = DEFAULT_VIEW,
): AgentsSidebar {
  const { root } = deps;
  root.role = "tree";
  const renderer = createRenderer(root, () => view(viewProps()));
  // 箱 (root) そのものに付く受け口。中身は view が描く。
  root.addEventListener("keydown", (event) => onKeydown(event));
  root.addEventListener("dragover", (event) => onDragOver(event));
  root.addEventListener("dragleave", (event) => onDragLeave(event));
  root.addEventListener("drop", (event) => onDrop(event));
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

  function agentRowProps(
    pane: AgentPane,
    viewing: string | null,
  ): AgentRowProps {
    const current = text();
    const unread = deps.monitor.snapshot().unread.get(pane.id);
    // 2 行組のカード (全体ボードと同じ部品。agent-card.ts)。作業の要約は
    // 「＋」・パレット・タブと同じ決まり (pane-text.ts)。tmux の既定の題名
    // (ホスト名など) は出さない。
    const shown = paneText(pane, current);
    const card = agentCardTemplate(pane, current, unread);
    return {
      id: pane.id,
      state: pane.state,
      active: pane.id === viewing,
      unread: unread !== undefined,
      title: [
        shown.title,
        pane.worktree ? current.worktreeTitle(pane.worktree) : "",
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
      ariaLabel: `${current.state[pane.state]} · ${shown.kind} · ${shown.summary}`,
      previewName: shown.row,
      card: card.template,
    };
  }

  function openHere(paneId: string): void {
    deps.monitor.markRead(paneId);
    deps.openPane(paneId);
    render(true);
  }

  function findPane(id: string): AgentPane | undefined {
    return deps.monitor
      .snapshot()
      .overview?.panes.find((pane) => pane.id === id);
  }

  /** 描いたプロジェクト (root → グループ)。操作の受け口が引く。 */
  let shownGroups = new Map<string, AgentProjectGroup>();

  function projectProps(
    group: AgentProjectGroup,
    viewing: string | null,
  ): SidebarProjectProps {
    const current = text();
    const info = group.info;
    shownGroups.set(info.root, group);
    const isCollapsed = collapsed.has(info.root);
    const hasAgents = group.panes.length > 0;
    const here = info.server.status === "current";
    const starting = deps.projects.activity(info.root)?.kind === "starting";
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
    const activity = deps.projects.activity(info.root);
    return {
      root: info.root,
      name: info.name,
      look: projectLook(info),
      here,
      starting,
      collapsed: isCollapsed,
      hasAgents,
      registered: !!info.registered,
      draggable:
        !!info.registered &&
        !window.matchMedia?.(SOFT_KEYS_MEDIA_QUERY).matches,
      toggleTitle: [
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
        .join("\n"),
      twistyLabel: current.toggleProject,
      mark: starting ? "starting" : projectState,
      startingLabel: starting ? current.sidebar.starting : null,
      // 件数は右端 (＋と ⋯ の場所)。見出しに載ったとき (hover・フォーカス) は
      // 操作に場所を譲る。
      count: hasAgents ? group.panes.length : null,
      problem: info.error
        ? current.projectError(info.error)
        : info.server.status === "unreachable"
          ? current.serverProblem(info.server.detail)
          : null,
      open: info.git
        ? { title: current.sidebar.openProjectTitle(info.name) }
        : null,
      menuTitle: current.projects.menuTitle(info.name),
      // 起こせなかった・登録できなかったときは、見出しのすぐ下に理由の全文。
      // (起こしている最中は見出しの中の「起動中…」だけ。)
      activity:
        activity?.kind === "failed"
          ? {
              title: activity.title,
              detail: activity.detail,
              dismissLabel: current.projects.dismiss,
            }
          : null,
      rows: hasAgents
        ? group.panes.map((pane) => agentRowProps(pane, viewing))
        : [],
    };
  }

  function openProjectMenuOf(
    rootKey: string,
    anchor: HTMLElement,
    at?: { x: number; y: number },
  ): void {
    const info = shownGroups.get(rootKey)?.info;
    if (!info) return;
    const current = text();
    const splitProject = deps.splitProject;
    showProjectMenu(anchor, info, {
      actions: deps.projects,
      text: current.projects,
      registeredCount:
        deps.monitor.snapshot().overview?.registry.projects.length ?? 0,
      at,
      ...(splitProject
        ? { split: (dir: SplitDir) => splitProject(info.root, dir) }
        : {}),
    });
  }

  function switchTo(rootKey: string): void {
    const info = shownGroups.get(rootKey)?.info;
    if (!info) return;
    // いま見ているプロジェクトは何もしない (読み直さない)。起こしている
    // 最中の押し直しは project-actions が無視する。
    if (info.server.status === "current" || !info.git) return;
    // 同じタブで移る。登録していなければ確かめずに登録してから移る。
    if (deps.switchProject) {
      deps.switchProject(info);
      return;
    }
    void deps.projects.open(info, currentPath(), { confirmRegister: false });
  }

  /**
   * 上の区画の見出しを掴んで並べ替える。落とす先は隙間の線だけで示し、
   * 落とすまで何も動かさない。指の画面では掴まない (長押しはメニュー)。
   */
  function onProjectDragStart(rootKey: string, event: DragEvent): void {
    const head = event.currentTarget as HTMLElement;
    const section = head.closest<HTMLElement>(".nav-project");
    if (!section) return;
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

  function onDragOver(event: DragEvent): void {
    clearDropMarks();
    const target = dropTarget(event.clientY);
    if (!target) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const sections = orderedSections();
    const at = sections[target.gap];
    if (at) at.classList.add("nav-project-drop-before");
    else sections[sections.length - 1]?.classList.add("nav-project-drop-after");
  }
  function onDragLeave(event: DragEvent): void {
    if (!root.contains(event.relatedTarget as Node | null)) clearDropMarks();
  }
  function onDrop(event: DragEvent): void {
    const target = dropTarget(event.clientY);
    const info = dragRoot === null ? undefined : registeredInfos.get(dragRoot);
    endDrag();
    if (!target || !info) return;
    event.preventDefault();
    void deps.projects.place(info, target.before);
  }
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
  function stoppedProps(
    groups: AgentProjectGroup[],
    viewing: string | null,
  ): AgentsSidebarViewProps["stopped"] {
    const current = text();
    const errors = groups
      .map((group) => group.info.error)
      .filter((error) => error !== "");
    return {
      open: deps.isStoppedOpen(),
      label: current.sidebar.stopped(groups.length),
      title: current.sidebar.stoppedTitle,
      problem:
        errors.length > 0
          ? errors.map((error) => current.projectError(error)).join("\n")
          : null,
      projects: groups.map((group) => projectProps(group, viewing)),
    };
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
  function notifyProps(current: AgentsText): AgentsSidebarViewProps["notify"] {
    const again =
      notifyPermissionView(
        deps.monitor.permission(),
        deps.monitor.snapshot().permissionAsked,
      ) === "ask-again";
    return {
      body: again ? current.notifyNotYet : current.notifyHint,
      allow: again ? current.notifyAskAgain : current.notifyEnable,
      hide: current.hookHintClose,
    };
  }

  function allowNotify(): void {
    const current = text();
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
  }

  /** いまの値 (render が signature を確かめてから描く)。 */
  let currentProps: AgentsSidebarViewProps | null = null;

  function viewProps(): AgentsSidebarViewProps {
    if (!currentProps) throw new Error("agents sidebar: drawn before render");
    return currentProps;
  }

  /** 描く値を組み立てる。 */
  function buildProps(): AgentsSidebarViewProps {
    const current = text();
    const { overview, error } = deps.monitor.snapshot();
    shownGroups = new Map();
    const handlers = {
      onOpenPane(id: string, event: MouseEvent) {
        if (event.button > 1) return;
        event.preventDefault();
        openHere(id);
      },
      onPaneMenu(id: string, event: MouseEvent) {
        event.preventDefault();
        const pane = findPane(id);
        if (!pane) return;
        const menuText = text();
        showContextMenu(
          event.currentTarget as HTMLElement,
          [
            { label: menuText.openPane, onSelect: () => openHere(id) },
            ...handoffMenuItems(pane, menuText, deps.handoff),
          ],
          { at: { x: event.clientX, y: event.clientY } },
        );
      },
      onToggleCollapsed: toggleCollapsed,
      onSwitchProject: switchTo,
      onProjectMenu(rootKey: string, anchor: HTMLElement, event?: MouseEvent) {
        // 右クリック (電話では長押し) で ⋯ と同じメニュー (上へ・下へを含む)。
        openProjectMenuOf(
          rootKey,
          anchor,
          event ? { x: event.clientX, y: event.clientY } : undefined,
        );
      },
      onOpenProjectMenu: (rootKey: string, anchor: HTMLElement) =>
        deps.openProjectMenu(rootKey, anchor),
      onProjectDragStart,
      onProjectDragEnd: endDrag,
      onDismissActivity: (rootKey: string) => deps.projects.dismiss(rootKey),
      onToggleStopped: () => setStoppedOpen(!deps.isStoppedOpen()),
      onRegisterCurrent: () => void deps.projects.registerCurrent(),
      onRegisterByPath: () => void deps.projects.registerByPath(),
      onNotifyAllow: allowNotify,
      onNotifyHide() {
        deps.dismissNotifyHint();
        render(true);
      },
      onOpenBoard: () => deps.openBoard(),
    };
    // 登録の失敗は理由を読めるように全文を出す (title だけだと気付けない)。
    const generalActivity = deps.projects.activity("");
    const general: SidebarNote[] =
      generalActivity?.kind === "failed"
        ? [
            { cls: "nav-note-error", text: generalActivity.title },
            { cls: "nav-note-error", text: generalActivity.detail },
          ]
        : [];
    const base = {
      ...handlers,
      ariaLabel: current.sidebar.ariaLabel,
      general,
      running: [],
      empty: null,
      detected: null,
      stopped: null,
      notes: [],
      notify: null,
      notifyError: null,
      problems: null,
    };
    if (!overview) {
      return {
        ...base,
        loading: error
          ? { cls: "nav-note-error", text: current.loadFailed, title: error }
          : { cls: "nav-note-muted", text: current.loading },
      };
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
    const problems =
      (error ? 1 : 0) +
      (overview.registry.error ? 1 : 0) +
      (overview.tmux.error ? 1 : 0) +
      overview.errors.length;
    // 狭い列なので 1 行だけ。次に何をするかは全体ボードと同じ文を title に。
    const notes: SidebarNote[] = !overview.tmux.available
      ? [
          {
            cls: "nav-note-muted",
            text: current.sidebar.notInstalled,
            title: current.emptyNotInstalledBody,
          },
        ]
      : !overview.tmux.running
        ? [
            {
              cls: "nav-note-muted",
              text: current.sidebar.noTmux,
              title: current.emptyNoTmuxBody,
            },
          ]
        : panes.length === 0
          ? [
              {
                cls: "nav-note-muted",
                text: current.sidebar.noAgents,
                title: current.emptyNoAgentsBody,
              },
            ]
          : [];
    return {
      ...base,
      loading: null,
      running: split.running.map((group) => projectProps(group, viewing)),
      // 登録が 1 つも無い: いま見ているリポジトリを登録する入口 (ヘッダの
      // 切替と同じ操作)。いま見ている場所がリポジトリでなければ登録は断られる
      // ので、パスを入れて登録する道も最初から出す。
      empty:
        registered.length === 0
          ? {
              title: current.sidebar.noProjectsTitle,
              body: current.sidebar.noProjectsBody,
              register: {
                label: current.projects.switcherRegisterCurrent(
                  deps.currentName(),
                ),
                title: current.projects.switcherRegisterCurrentHint,
              },
              byPath: current.projects.addProjectMenu,
            }
          : null,
      detected:
        detected.length > 0
          ? {
              title: current.sidebar.detected,
              tooltip: current.sidebar.detectedTitle,
              projects: detected.map((group) => projectProps(group, viewing)),
            }
          : null,
      stopped:
        split.stopped.length > 0 ? stoppedProps(split.stopped, viewing) : null,
      notes,
      notify: showsNotifyHint() ? notifyProps(current) : null,
      notifyError: notifyRequestError || null,
      // 中身の全文は全体ボードの「問題」の欄にある。ここは入口だけ。
      problems: problems > 0 ? current.sidebar.problems(problems) : null,
    };
  }

  function render(force = false): void {
    if (dragRoot !== null) {
      renderDeferred = true;
      return;
    }
    const next = signature();
    if (!force && next === lastSignature) return;
    lastSignature = next;
    const focused = focusedKeys();
    currentProps = buildProps();
    root.setAttribute("aria-label", currentProps.ariaLabel);
    // 描いた直後にフォーカスを戻し、Tab で入る 1 つを決めるので、まとめずに
    // いまここで描く。
    renderer.flush();
    if (currentProps.loading) return;

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
