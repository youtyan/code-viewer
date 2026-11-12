// ヘッダ左端のリポジトリ名から開く、プロジェクトの切替。
//
//   ┌ プロジェクト                 ↑↓ 移動 · Enter 開く ┐
//   │ [絞り込む                                    ]    │
//   │ SR sample-repo   ~/work/sample-repo   この画面    │
//   │ AR another-repo  ~/work/another-repo  ◆1 ●2       │
//   │ TR third-repo    ~/work/third-repo    停止中       │
//   │ ───────────────────────────────────────────────── │
//   │ プロジェクトを追加…                               │
//   └────────────────────────────────────────────────────┘
//
// 並べるのは登録したプロジェクトだけ。起動中のもの (左のサイドバーと同じ判定。
// core/project-running.ts) が先で、停止中のものは区切りの後。それぞれの中は
// 利用者が決めた順。絞り込みと ↑↓ で選ぶ一覧なので畳まない。件数とサーバの
// 状態は、どの画面でも動いているエージェントの取り直し (agent-monitor) の
// 結果をそのまま使う (新しい取得は足さない)。選ぶと同じタブで、いまと同じ
// 画面へ移る。動いていなければ起こしてから (project-actions)。
//
// 行の頭はプロジェクトの色の四角と頭文字 (左のサイドバーの見出しと同じ)。
// 登録が 1 つも無いときは、いま見ているリポジトリを登録する案内だけを出す。
// ヘッダの幅は増やさない (ボタンは既存のリポジトリ名そのもの)。

import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import {
  type AgentOverviewResponse,
  type AgentProjectInfo,
  headerAgentCounts,
} from "../../core/agent-overview";
import { CHEVRON_DOWN_12_PATH } from "../../core/icons";
import { TOUCH_MEDIA_QUERY } from "../../core/mobile-layout";
import {
  partitionProjectsByRunning,
  runningProjectRoots,
} from "../../core/project-running";
import { matchesProjectQuery } from "../../core/projects";
import { iconTemplate } from "../ui/icon";
import { detachedElement, templateElement } from "../ui/renderer";
import type { ProjectActions } from "./project-actions";
import { projectLook, projectMarkTemplate } from "./project-looks";
import type { ProjectsText } from "./projects-i18n";

export type ProjectSwitcherDeps = {
  button: HTMLElement;
  actions: ProjectActions;
  getText(): ProjectsText;
  getOverview(): AgentOverviewResponse | null;
  subscribe(listener: () => void): () => void;
  /** 移り先で開く画面のパス (いまの画面)。 */
  currentPath(): string;
  /** いま見ているリポジトリの名前 (登録の案内に出す)。 */
  currentName(): string;
  /** ボタンの説明に出すキー (キー割り当ての表示)。 */
  shortcutLabel(): string;
  /**
   * 選んだプロジェクトへ移る。左の一覧の見出しと同じく、そのプロジェクトのタブの
   * グループで最後に前面だったタブを前面に (app.ts の switchToProjectGroup)。無ければ
   * いまの画面のまま移る (currentPath)。
   */
  switchProject?(info: AgentProjectInfo): void;
};

export type ProjectSwitcher = {
  toggle(): void;
  isOpen(): boolean;
  localize(): void;
};

export type ProjectSwitcherRow = {
  index: number;
  info: AgentProjectInfo;
  active: boolean;
  current: boolean;
  /** 起こしている途中なら、その文 (数と注記の代わりに出す)。 */
  starting: string | null;
  counts: { waiting: number; working: number };
  note: string;
  title: string;
  /** 停止中の最初の行なら、前に置く区切りの文。 */
  dividerBefore: string | null;
  onPoint: () => void;
  onChoose: () => void;
};

export type ProjectSwitcherProps = {
  text: ProjectsText;
  /** 登録が無いときは案内だけ (絞り込みも移動の説明も要らない)。 */
  noneRegistered: boolean;
  /** 行の代わりに出す文 (読み込み前は空文字)。 */
  message: string | null;
  rows: ProjectSwitcherRow[];
  activeId: string | null;
  /** 起こせない・登録できない理由の全文。 */
  errors: { title: string; detail: string }[];
  actions: { label: string; run: () => void }[];
  refs: {
    input: Ref<HTMLInputElement>;
    list: Ref<HTMLElement>;
    extra: Ref<HTMLElement>;
  };
  onInput: () => void;
  onKeydown: (event: KeyboardEvent) => void;
};

export type ProjectSwitcherView = {
  /** 切り替えのボタンの右の小さな山形。 */
  chevron: () => unknown;
  panel: (props: ProjectSwitcherProps) => unknown;
};

function countMark(state: "waiting" | "working", count: number): unknown {
  return html`<span class=${`agents-count agents-count-${state}`}><i
      class=${`terminal-mark terminal-mark-${state}`}
      aria-hidden="true"
    ></i>${count}</span>`;
}

export const DEFAULT_VIEW: ProjectSwitcherView = {
  // 押すと一覧が開くことを示す小さな山形 (ほかの開く・畳むと同じアイコン)。
  chevron: () =>
    html`<span class="brand-chevron" aria-hidden="true">${iconTemplate(
      CHEVRON_DOWN_12_PATH,
      "octicon-chevron-down",
      16,
    )}</span>`,
  panel: (p) => {
    const t = p.text;
    return html`<div
      class="project-switcher"
      role="dialog"
      aria-label=${t.switcherTitle}
      @keydown=${p.onKeydown}
    ><div class="project-switcher-head"><strong>${t.switcherTitle}</strong><span
          class="project-switcher-hint gdp-key-hint"
          ?hidden=${p.noneRegistered}
          >${t.switcherHint}</span
        ></div
      ><input
        type="text"
        class="project-switcher-input"
        placeholder=${t.switcherPlaceholder}
        aria-label=${t.switcherPlaceholder}
        role="combobox"
        aria-controls="project-switcher-list"
        aria-activedescendant=${p.activeId ?? nothing}
        autocomplete="off"
        spellcheck="false"
        ?hidden=${p.noneRegistered}
        ${ref(p.refs.input)}
        @input=${p.onInput}
      /><div
        class="project-switcher-list"
        id="project-switcher-list"
        role="listbox"
        ${ref(p.refs.list)}
      >${
        p.message === null
          ? nothing
          : html`<p class="project-switcher-message">${p.message}</p>`
      }${p.rows.map(
        (row) =>
          html`${
            // 停止中の最初の行の前に区切り。読み上げは行の「停止中」の注記に任せる。
            row.dividerBefore === null
              ? nothing
              : html`<div class="project-switcher-divider" aria-hidden="true"
                  >${row.dividerBefore}</div
                >`
          }<button
            type="button"
            class=${[
              "project-switcher-row",
              row.active ? "active" : "",
              row.current ? "current" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="option"
            id=${`project-switcher-option-${row.index}`}
            aria-selected=${String(row.active)}
            title=${row.title}
            @mousemove=${row.onPoint}
            @click=${row.onChoose}
          >${projectMarkTemplate(
            projectLook(row.info),
            "project-switcher-mark",
          )}<span class="project-switcher-name">${row.info.name}</span><span
              class="project-switcher-path terminal-mono"
              >${row.info.displayRoot}</span
            ><span class="project-switcher-status">${
              row.starting !== null
                ? row.starting
                : html`${
                    row.counts.waiting > 0
                      ? countMark("waiting", row.counts.waiting)
                      : nothing
                  }${
                    row.counts.working > 0
                      ? countMark("working", row.counts.working)
                      : nothing
                  }${
                    row.note
                      ? html`<span class="project-switcher-note">${row.note}</span>`
                      : nothing
                  }`
            }</span></button>`,
      )}</div
      ><div class="project-switcher-extra" ${ref(p.refs.extra)}>${p.errors.map(
        (error) =>
          html`<div class="project-switcher-error" role="alert"><strong
              >${error.title}</strong
            ><pre class="terminal-observation-errors">${error.detail}</pre></div>`,
      )}${
        p.actions.length > 0
          ? html`<div class="project-switcher-actions">${p.actions.map(
              (action) =>
                html`<button
                  type="button"
                  class="project-switcher-action"
                  @click=${action.run}
                >${action.label}</button>`,
            )}</div>`
          : nothing
      }</div></div>`;
  },
};

export function mountProjectSwitcher(
  deps: ProjectSwitcherDeps,
  view: ProjectSwitcherView = DEFAULT_VIEW,
): ProjectSwitcher {
  const { button } = deps;
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.appendChild(templateElement(view.chevron()));

  const refs: ProjectSwitcherProps["refs"] = {
    input: createRef(),
    list: createRef(),
    extra: createRef(),
  };
  let panel: { element: HTMLElement; draw(): void } | null = null;
  let active = 0;
  let cleanup: (() => void) | null = null;

  function runningRoots(overview: AgentOverviewResponse): Set<string> {
    const starting = overview.projects
      .filter((info) => deps.actions.activity(info.root)?.kind === "starting")
      .map((info) => info.root);
    return runningProjectRoots(overview, starting);
  }

  /** 登録したプロジェクト。起動中 → 停止中、それぞれの中は登録の順。 */
  function registered(overview: AgentOverviewResponse): AgentProjectInfo[] {
    const split = partitionProjectsByRunning(
      overview.projects
        .filter((info) => info.registered !== null)
        .sort(
          (a, b) => (a.registered?.order ?? 0) - (b.registered?.order ?? 0),
        ),
      (info) => info.root,
      runningRoots(overview),
    );
    return [...split.running, ...split.stopped];
  }

  function currentProject(
    overview: AgentOverviewResponse | null,
  ): AgentProjectInfo | null {
    return (
      overview?.projects.find((info) => info.server.status === "current") ??
      null
    );
  }

  function visibleProjects(): AgentProjectInfo[] {
    const overview = deps.getOverview();
    if (!overview) return [];
    const query = refs.input.value?.value ?? "";
    return registered(overview).filter((info) =>
      matchesProjectQuery(info, query),
    );
  }

  function countsFor(root: string): { waiting: number; working: number } {
    const panes = deps.getOverview()?.panes ?? [];
    return headerAgentCounts(panes.filter((pane) => pane.project === root));
  }

  function rowProps(
    info: AgentProjectInfo,
    index: number,
    dividerBefore: string | null,
  ): ProjectSwitcherRow {
    const t = deps.getText();
    const current = info.server.status === "current";
    const counts = countsFor(info.root);
    const activity = deps.actions.activity(info.root);
    return {
      index,
      info,
      active: index === active,
      current,
      starting: activity?.kind === "starting" ? t.starting : null,
      counts,
      note: current
        ? t.switcherCurrent
        : info.server.status === "absent"
          ? t.switcherStopped
          : "",
      title: [
        info.root,
        t.switcherCounts(counts.waiting, counts.working),
        info.error,
      ]
        .filter(Boolean)
        .join("\n"),
      dividerBefore,
      onPoint: () => {
        if (active === index) return;
        active = index;
        renderList();
      },
      onChoose: () => choose(info),
    };
  }

  function choose(info: AgentProjectInfo): void {
    if (info.server.status === "current") {
      close();
      return;
    }
    if (deps.switchProject) {
      deps.switchProject(info);
      return;
    }
    void deps.actions.open(info, deps.currentPath());
  }

  function panelProps(): ProjectSwitcherProps {
    const t = deps.getText();
    const overview = deps.getOverview();
    const projects = visibleProjects();
    if (active >= projects.length) active = Math.max(0, projects.length - 1);
    const noneRegistered = !!overview && registered(overview).length === 0;
    const running = overview ? runningRoots(overview) : new Set<string>();
    const firstStopped = projects.findIndex((info) => !running.has(info.root));
    const here = currentProject(overview);
    const actions: ProjectSwitcherProps["actions"] = [];
    if (overview && !here?.registered)
      actions.push({
        label: t.switcherRegisterCurrent(here?.name ?? deps.currentName()),
        run: () => void deps.actions.registerCurrent(),
      });
    if (overview)
      actions.push({
        label: t.addProjectMenu,
        run: () => {
          close();
          void deps.actions.registerByPath();
        },
      });
    const errors: ProjectSwitcherProps["errors"] = [];
    // 失敗 (起こせない・登録できない) は理由の全文をここに出す。
    for (const info of [...projects, { root: "", name: "" }]) {
      const activity = deps.actions.activity(info.root);
      if (activity?.kind !== "failed") continue;
      errors.push({ title: activity.title, detail: activity.detail });
    }
    return {
      text: t,
      noneRegistered,
      message: !overview
        ? ""
        : noneRegistered
          ? t.switcherRegisterCurrentHint
          : projects.length === 0
            ? t.switcherNoMatch
            : null,
      rows: projects.map((info, index) =>
        rowProps(
          info,
          index,
          index === firstStopped && index > 0 ? t.switcherStopped : null,
        ),
      ),
      activeId: projects[active] ? `project-switcher-option-${active}` : null,
      errors,
      actions,
      refs,
      onInput: () => {
        active = 0;
        renderList();
      },
      onKeydown,
    };
  }

  function renderList(): void {
    panel?.draw();
  }

  function onKeydown(event: KeyboardEvent): void {
    const projects = visibleProjects();
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      button.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (projects.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      active = (active + step + projects.length) % projects.length;
      renderList();
      refs.list.value
        ?.querySelector<HTMLElement>(".project-switcher-row.active")
        ?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter" && !event.isComposing) {
      const target = projects[active];
      if (!target) return;
      event.preventDefault();
      choose(target);
    }
  }

  function open(): void {
    if (panel) return;
    // いま居るプロジェクトから始める (Enter 1 回で「次」へは行かない)。
    const overview = deps.getOverview();
    active = Math.max(
      0,
      overview
        ? registered(overview).findIndex(
            (info) => info.server.status === "current",
          )
        : 0,
    );
    const opened = detachedElement(() => view.panel(panelProps()));
    panel = opened;
    document.body.appendChild(opened.element);

    const rect = button.getBoundingClientRect();
    opened.element.style.left = `${Math.max(8, rect.left)}px`;
    opened.element.style.top = `${rect.bottom + 4}px`;
    button.setAttribute("aria-expanded", "true");
    const unsubscribeOverview = deps.subscribe(renderList);
    const unsubscribeActions = deps.actions.subscribe(renderList);
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (panel?.element.contains(target) || button.contains(target)) return;
      close();
    };
    // ダイアログ (登録の確認など) を開いたら、それを邪魔しないよう閉じる。
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", close);
    cleanup = () => {
      unsubscribeOverview();
      unsubscribeActions();
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", close);
    };
    const input = refs.input.value;
    if (input?.hidden) {
      refs.extra.value?.querySelector<HTMLElement>("button")?.focus();
    } else if (!window.matchMedia?.(TOUCH_MEDIA_QUERY).matches) {
      // 指の画面では絞り込みの欄に焦点を置かない (ソフトキーボードが出て、選ぶ
      // 一覧を隠した)。
      input?.focus();
    }
  }

  function close(): void {
    if (!panel) return;
    cleanup?.();
    cleanup = null;
    panel.element.remove();
    panel = null;
    button.setAttribute("aria-expanded", "false");
  }

  // 読み上げの名前はボタンの中身 (プロジェクト名と枝)。aria-label を付けると
  // 中身を上書きし、名前も枝も読まれなかった (省略した全体も中身の文字で読む)。
  // 何をするボタンかは説明 (title) で伝える。
  function localize(): void {
    button.title = deps.getText().switcherButtonTitle(deps.shortcutLabel());
    if (panel) {
      close();
      open();
    }
  }

  button.addEventListener("click", () => (panel ? close() : open()));
  localize();

  return {
    toggle: () => (panel ? close() : open()),
    isOpen: () => panel !== null,
    localize,
  };
}
