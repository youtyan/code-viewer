// ヘッダ左端のリポジトリ名から開く、プロジェクトの切替。
//
//   ┌ プロジェクト                 ↑↓ 移動 · Enter 開く ┐
//   │ [絞り込む                                    ]    │
//   │ ● sample-repo   ~/work/sample-repo   この画面     │
//   │   another-repo  ~/work/another-repo  ◆1 ●2        │
//   │   third-repo    ~/work/third-repo    停止中        │
//   │ ───────────────────────────────────────────────── │
//   │ パスを入力して登録…                               │
//   └────────────────────────────────────────────────────┘
//
// 並べるのは登録したプロジェクトだけ (利用者が決めた順)。件数とサーバの
// 状態は、どの画面でも動いているエージェントの取り直し (agent-monitor) の
// 結果をそのまま使う (新しい取得は足さない)。選ぶと同じタブで、いまと同じ
// 画面へ移る。動いていなければ起こしてから (project-actions)。
//
// 登録が 1 つも無いときは、いま見ているリポジトリを登録する案内だけを出す。
// ヘッダの幅は増やさない (ボタンは既存のリポジトリ名そのもの)。

import {
  type AgentOverviewResponse,
  type AgentProjectInfo,
  headerAgentCounts,
} from "../../core/agent-overview";
import { CHEVRON_DOWN_12_PATH, iconSvg } from "../../core/icons";
import { matchesProjectQuery } from "../../core/projects";
import type { ProjectActions } from "./project-actions";
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
};

export type ProjectSwitcher = {
  toggle(): void;
  isOpen(): boolean;
  localize(): void;
};

export function mountProjectSwitcher(
  deps: ProjectSwitcherDeps,
): ProjectSwitcher {
  const { button } = deps;
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  // 押すと一覧が開くことを示す小さな山形 (ほかの開く・畳むと同じアイコン)。
  const chevron = document.createElement("span");
  chevron.className = "brand-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_12_PATH);
  button.appendChild(chevron);

  let panel: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let list: HTMLElement | null = null;
  let extra: HTMLElement | null = null;
  let hint: HTMLElement | null = null;
  let active = 0;
  let cleanup: (() => void) | null = null;

  function registered(overview: AgentOverviewResponse): AgentProjectInfo[] {
    return overview.projects
      .filter((info) => info.registered !== null)
      .sort((a, b) => (a.registered?.order ?? 0) - (b.registered?.order ?? 0));
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
    const query = input?.value ?? "";
    return registered(overview).filter((info) =>
      matchesProjectQuery(info, query),
    );
  }

  function countsFor(root: string): { waiting: number; working: number } {
    const panes = deps.getOverview()?.panes ?? [];
    return headerAgentCounts(panes.filter((pane) => pane.project === root));
  }

  function mark(state: "waiting" | "working", count: number): HTMLElement {
    const chip = document.createElement("span");
    chip.className = `agents-count agents-count-${state}`;
    const dot = document.createElement("i");
    dot.className = `terminal-mark terminal-mark-${state}`;
    dot.setAttribute("aria-hidden", "true");
    chip.append(dot, String(count));
    return chip;
  }

  function row(info: AgentProjectInfo, index: number): HTMLElement {
    const t = deps.getText();
    const item = document.createElement("button");
    item.type = "button";
    item.className = "project-switcher-row";
    item.setAttribute("role", "option");
    item.id = `project-switcher-option-${index}`;
    item.classList.toggle("active", index === active);
    item.setAttribute("aria-selected", String(index === active));
    const current = info.server.status === "current";
    item.classList.toggle("current", current);

    const name = document.createElement("span");
    name.className = "project-switcher-name";
    name.textContent = info.name;
    const path = document.createElement("span");
    path.className = "project-switcher-path terminal-mono";
    path.textContent = info.displayRoot;
    const status = document.createElement("span");
    status.className = "project-switcher-status";
    const counts = countsFor(info.root);
    const activity = deps.actions.activity(info.root);
    if (activity?.kind === "starting") {
      status.textContent = t.starting;
    } else {
      if (counts.waiting > 0)
        status.appendChild(mark("waiting", counts.waiting));
      if (counts.working > 0)
        status.appendChild(mark("working", counts.working));
      const note = current
        ? t.switcherCurrent
        : info.server.status === "absent"
          ? t.switcherStopped
          : "";
      if (note) {
        const label = document.createElement("span");
        label.className = "project-switcher-note";
        label.textContent = note;
        status.appendChild(label);
      }
    }
    item.append(name, path, status);
    item.title = [
      info.root,
      t.switcherCounts(counts.waiting, counts.working),
      info.error,
    ]
      .filter(Boolean)
      .join("\n");
    item.addEventListener("mousemove", () => {
      if (active === index) return;
      active = index;
      renderList();
    });
    item.addEventListener("click", () => choose(info));
    return item;
  }

  function choose(info: AgentProjectInfo): void {
    if (info.server.status === "current") {
      close();
      return;
    }
    void deps.actions.open(info, deps.currentPath());
  }

  function renderList(): void {
    if (!list || !extra) return;
    const t = deps.getText();
    const overview = deps.getOverview();
    const projects = visibleProjects();
    if (active >= projects.length) active = Math.max(0, projects.length - 1);
    list.replaceChildren();
    const noneRegistered = !!overview && registered(overview).length === 0;
    // 登録が無いときは案内だけ (絞り込みも移動の説明も要らない)。
    input?.toggleAttribute("hidden", noneRegistered);
    hint?.toggleAttribute("hidden", noneRegistered);
    if (!overview) {
      list.appendChild(message(""));
    } else if (noneRegistered) {
      list.appendChild(message(t.switcherRegisterCurrentHint));
    } else if (projects.length === 0) {
      list.appendChild(message(t.switcherNoMatch));
    }
    projects.forEach((info, index) => {
      list?.appendChild(row(info, index));
    });
    const selected = projects[active];
    if (selected && input) {
      input.setAttribute(
        "aria-activedescendant",
        `project-switcher-option-${active}`,
      );
    }

    extra.replaceChildren();
    // 失敗 (起こせない・登録できない) は理由の全文をここに出す。
    for (const info of [...projects, { root: "", name: "" }]) {
      const activity = deps.actions.activity(info.root);
      if (activity?.kind !== "failed") continue;
      const box = document.createElement("div");
      box.className = "project-switcher-error";
      box.setAttribute("role", "alert");
      const title = document.createElement("strong");
      title.textContent = activity.title;
      const detail = document.createElement("pre");
      detail.className = "terminal-observation-errors";
      detail.textContent = activity.detail;
      box.append(title, detail);
      extra.appendChild(box);
    }
    const here = currentProject(overview);
    const actions = document.createElement("div");
    actions.className = "project-switcher-actions";
    if (overview && !here?.registered) {
      actions.appendChild(
        action(
          t.switcherRegisterCurrent(here?.name ?? deps.currentName()),
          () => deps.actions.registerCurrent(),
        ),
      );
    }
    if (overview) {
      actions.appendChild(
        action(t.switcherAddPath, () => {
          close();
          return deps.actions.registerByPath();
        }),
      );
    }
    if (actions.childElementCount > 0) extra.appendChild(actions);
  }

  function message(text: string): HTMLElement {
    const p = document.createElement("p");
    p.className = "project-switcher-message";
    p.textContent = text;
    return p;
  }

  function action(label: string, run: () => Promise<void>): HTMLElement {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "project-switcher-action";
    item.textContent = label;
    item.addEventListener("click", () => void run());
    return item;
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
      list
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
    const t = deps.getText();
    panel = document.createElement("div");
    panel.className = "project-switcher";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t.switcherTitle);
    const head = document.createElement("div");
    head.className = "project-switcher-head";
    const title = document.createElement("strong");
    title.textContent = t.switcherTitle;
    hint = document.createElement("span");
    hint.className = "project-switcher-hint";
    hint.textContent = t.switcherHint;
    head.append(title, hint);
    input = document.createElement("input");
    input.type = "text";
    input.className = "project-switcher-input";
    input.placeholder = t.switcherPlaceholder;
    input.setAttribute("aria-label", t.switcherPlaceholder);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-controls", "project-switcher-list");
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", () => {
      active = 0;
      renderList();
    });
    list = document.createElement("div");
    list.className = "project-switcher-list";
    list.id = "project-switcher-list";
    list.setAttribute("role", "listbox");
    extra = document.createElement("div");
    extra.className = "project-switcher-extra";
    panel.append(head, input, list, extra);
    panel.addEventListener("keydown", onKeydown);
    document.body.appendChild(panel);

    const rect = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8, rect.left)}px`;
    panel.style.top = `${rect.bottom + 4}px`;

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
    renderList();
    button.setAttribute("aria-expanded", "true");
    const unsubscribeOverview = deps.subscribe(renderList);
    const unsubscribeActions = deps.actions.subscribe(renderList);
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (panel?.contains(target) || button.contains(target)) return;
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
    if (input.hidden) {
      extra.querySelector<HTMLElement>("button")?.focus();
    } else {
      input.focus();
    }
  }

  function close(): void {
    if (!panel) return;
    cleanup?.();
    cleanup = null;
    panel.remove();
    panel = null;
    input = null;
    list = null;
    extra = null;
    hint = null;
    button.setAttribute("aria-expanded", "false");
  }

  function localize(): void {
    const title = deps.getText().switcherButtonTitle(deps.shortcutLabel());
    button.title = title;
    button.setAttribute("aria-label", title);
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
