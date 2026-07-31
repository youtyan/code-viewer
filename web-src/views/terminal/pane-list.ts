// ドロワー上部のペイン選択。セッションをタブで切り替え、その中のウィンドウ
// ごとにペインを並べる。
//
// 一覧の主役はペインタイトル。tmux 上で動いている AI CLI は作業内容を
// タイトルに出すので、どのペインで何が進んでいるかはここだけで分かる。

import type {
  TmuxPane,
  TmuxPaneId,
  TmuxPanesResponse,
  TmuxSession,
} from "../../core/tmux";
import type { TerminalText } from "./i18n";

export type PaneListDeps = {
  getText(): TerminalText;
  onSelect(pane: TmuxPane): void;
};

export type PaneListHandle = {
  el: HTMLElement;
  /** 一覧を差し替える。選択中のペインが残っていれば選択を保つ。 */
  setData(data: TmuxPanesResponse | null): void;
  setSelected(paneId: TmuxPaneId | null): void;
  localize(): void;
};

export function createPaneList(deps: PaneListDeps): PaneListHandle {
  const el = document.createElement("div");
  el.className = "terminal-panes";

  const sessionTabs = document.createElement("div");
  sessionTabs.className = "seg terminal-sessions";
  sessionTabs.role = "group";

  const list = document.createElement("div");
  list.className = "terminal-pane-list";

  const empty = document.createElement("p");
  empty.className = "terminal-empty";
  empty.hidden = true;

  el.append(sessionTabs, list, empty);

  let data: TmuxPanesResponse | null = null;
  let activeSession: string | null = null;
  let selectedPaneId: TmuxPaneId | null = null;

  function currentSession(): TmuxSession | null {
    if (!data) return null;
    const found = data.sessions.find(
      (session) => session.name === activeSession,
    );
    return found ?? data.sessions[0] ?? null;
  }

  function emptyMessage(): string | null {
    const text = deps.getText();
    if (!data) return null;
    if (!data.available) return text.notInstalled;
    if (!data.running || data.sessions.length === 0) return text.noSessions;
    return null;
  }

  function createPaneButton(pane: TmuxPane): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "terminal-pane-item";
    button.dataset.pane = pane.id;
    button.classList.toggle("active", pane.id === selectedPaneId);
    if (pane.active) button.classList.add("current");

    const title = document.createElement("span");
    title.className = "terminal-pane-title";
    // タイトルが空のペインもある (起動直後など)。その場合はコマンド名を出す。
    title.textContent = pane.title || pane.command;

    const meta = document.createElement("span");
    meta.className = "terminal-pane-meta";
    meta.textContent = `${pane.label} · ${pane.command} · ${deps
      .getText()
      .paneSize(pane.width, pane.height)}`;

    button.append(title, meta);
    button.title = `${pane.label}\n${pane.title || pane.command}\n${pane.path}`;
    button.addEventListener("click", () => {
      deps.onSelect(pane);
    });
    return button;
  }

  function renderList(): void {
    list.replaceChildren();
    const session = currentSession();
    if (!session) return;
    for (const window of session.windows) {
      const group = document.createElement("div");
      group.className = "terminal-window-group";
      const heading = document.createElement("div");
      heading.className = "terminal-window-name";
      heading.textContent = window.name
        ? `${window.index} · ${window.name}`
        : String(window.index);
      group.appendChild(heading);
      for (const pane of window.panes)
        group.appendChild(createPaneButton(pane));
      list.appendChild(group);
    }
  }

  function renderSessions(): void {
    sessionTabs.replaceChildren();
    const session = currentSession();
    if (!data) return;
    for (const item of data.sessions) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.textContent = item.name;
      tab.classList.toggle("active", item.name === session?.name);
      tab.addEventListener("click", () => {
        activeSession = item.name;
        render();
      });
      sessionTabs.appendChild(tab);
    }
  }

  function render(): void {
    const message = emptyMessage();
    empty.textContent = message ?? "";
    empty.hidden = message === null;
    sessionTabs.hidden = message !== null;
    list.hidden = message !== null;
    if (message !== null) {
      sessionTabs.replaceChildren();
      list.replaceChildren();
      return;
    }
    sessionTabs.setAttribute("aria-label", deps.getText().panes);
    renderSessions();
    renderList();
  }

  return {
    el,
    setData(next) {
      data = next;
      // 選択中のペインがまだ在るなら、そのセッションを開いたままにする。
      if (next && selectedPaneId) {
        const owner = next.sessions.find((session) =>
          session.windows.some((window) =>
            window.panes.some((pane) => pane.id === selectedPaneId),
          ),
        );
        if (owner) activeSession = owner.name;
      }
      render();
    },
    setSelected(paneId) {
      selectedPaneId = paneId;
      for (const button of list.querySelectorAll<HTMLButtonElement>(
        ".terminal-pane-item",
      )) {
        button.classList.toggle("active", button.dataset.pane === paneId);
      }
    },
    localize() {
      render();
    },
  };
}
