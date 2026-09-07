import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";
import {
  COPY_16_PATHS,
  iconSvg,
  SEARCH_16_PATH,
  TERMINAL_16_PATHS,
} from "../../core/icons";
import type { ShellSession } from "../../core/shell";
import {
  findTerminalLinks,
  readTerminalLogicalLine,
  searchTerminalBuffer,
  type TerminalLinkTarget,
} from "../../core/terminal-content";
import type { TerminalPathResponse } from "../../core/types";
import type { XtermTerminal } from "../../core/xterm-loader";
import type { TerminalText } from "./i18n";

export function createScreenTools(deps: {
  getText(): TerminalText;
  getTerminal(): XtermTerminal | null;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  actionHeaders(): HeadersInit;
  sendKey(value: string): void;
  onStatus(message: string | null): void;
  onOpenPath(
    target: Exclude<TerminalPathResponse, { kind: "external" }>,
    line?: number,
  ): void;
  onCreateShell(): void;
}) {
  let target: ShellSession | null = null;
  let generation = 0;
  let enabled = true;
  let connected = false;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let matchIndex = -1;
  let matches: ReturnType<typeof searchTerminalBuffer> = [];
  const labels = new Map<HTMLElement, keyof TerminalText>();
  const toolbar = document.createElement("div");
  toolbar.className = "terminal-screen-toolbar";
  const context = document.createElement("button");
  context.type = "button";
  context.className = "terminal-context";
  context.addEventListener("click", () => {
    if (target) void openLink({ kind: "path", value: target.cwd });
  });
  toolbar.append(context);

  function button(
    parent: HTMLElement,
    key: keyof TerminalText,
    content: string,
    action: () => void,
  ) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "terminal-reload terminal-action";
    el.innerHTML = content;
    el.addEventListener("click", action);
    labels.set(el, key);
    parent.append(el);
    return el;
  }

  const searchButton = button(
    toolbar,
    "searchOutput",
    iconSvg("", SEARCH_16_PATH),
    () => showSearch(search.hidden),
  );
  const copyButton = button(
    toolbar,
    "copyOutput",
    iconSvg("", COPY_16_PATHS),
    () => void copyOutput(),
  );
  const latestButton = button(toolbar, "scrollLatest", "↓", () =>
    deps.getTerminal()?.scrollToBottom(),
  );
  const interrupt = button(toolbar, "interrupt", "■", () =>
    deps.sendKey(String.fromCharCode(3)),
  );
  const search = document.createElement("div");
  search.className = "terminal-output-search";
  search.hidden = true;
  const query = document.createElement("input");
  query.type = "search";
  query.className = "search-results-input";
  const count = document.createElement("span");
  count.className = "terminal-match-count";
  count.role = "status";
  search.append(query, count);
  const prev = button(search, "previousMatch", "↑", () => moveMatch(-1));
  const next = button(search, "nextMatch", "↓", () => moveMatch(1));
  button(search, "closeSearch", "×", () => showSearch(false));
  query.addEventListener("input", () => updateSearch());
  query.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") showSearch(false);
    else moveMatch(event.shiftKey ? -1 : 1);
  });

  const empty = document.createElement("div");
  empty.className = "terminal-welcome";
  const emptyIcon = document.createElement("div");
  emptyIcon.className = "terminal-welcome-icon";
  emptyIcon.innerHTML = iconSvg("", TERMINAL_16_PATHS);
  const emptyTitle = document.createElement("strong");
  const emptyHint = document.createElement("p");
  empty.append(emptyIcon, emptyTitle, emptyHint);
  const createButton = button(empty, "newShellTitle", "+", deps.onCreateShell);
  createButton.className = "terminal-welcome-create tools-pane-action";

  function report(key: "openPathFailed" | "copyFailed", error: unknown) {
    console.error(`[code-viewer] terminal ${key}`, error);
    deps.onStatus(`${deps.getText()[key]}\n${formatErrorDetail(error)}`);
  }

  async function openLink(link: TerminalLinkTarget) {
    if (link.kind === "url") {
      // OSC links can supply other schemes; output must never execute a script URL.
      if (/^https?:\/\//i.test(link.value))
        window.open(link.value, "_blank", "noopener,noreferrer");
      return;
    }
    const myGen = generation;
    try {
      const res = await deps.trackLoad(
        fetch("/_shell/open-path", {
          method: "POST",
          headers: {
            ...deps.actionHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: link.value }),
        }),
      );
      if (!res.ok)
        throw new Error(
          await responseErrorMessage(
            res,
            `${deps.getText().openPathFailed}: ${link.value}`,
          ),
        );
      const result = (await res.json()) as TerminalPathResponse;
      if (myGen !== generation) return;
      if (result.kind !== "external") deps.onOpenPath(result, link.line);
    } catch (error) {
      if (myGen === generation) report("openPathFailed", error);
      else
        console.error(
          "[code-viewer] previous terminal path open failed",
          error,
        );
    }
  }

  async function copyOutput() {
    const terminal = deps.getTerminal();
    if (!terminal) return;
    const selected = terminal.getSelection();
    let value = selected;
    if (!value) {
      const lines: string[] = [];
      const buffer = terminal.buffer.active;
      for (let row = 0; row < buffer.length; row += 1) {
        const line = buffer.getLine(row);
        if (!line) continue;
        const text = line.translateToString(
          !buffer.getLine(row + 1)?.isWrapped,
        );
        if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
        else lines.push(text);
      }
      value = lines.join("\n").trimEnd();
    }
    try {
      await navigator.clipboard.writeText(value);
      deps.onStatus(deps.getText().copiedOutput);
    } catch (error) {
      report("copyFailed", error);
    }
  }

  function showSearch(show: boolean) {
    search.hidden = !show;
    searchButton.setAttribute("aria-pressed", String(show));
    if (show) {
      query.focus();
      query.select();
      updateSearch();
    } else {
      deps.getTerminal()?.clearSelection();
      deps.getTerminal()?.focus();
    }
  }

  function updateSearch(navigate = true) {
    const terminal = deps.getTerminal();
    matches = terminal
      ? searchTerminalBuffer(terminal.buffer.active, terminal.cols, query.value)
      : [];
    matchIndex = matches.length
      ? navigate
        ? 0
        : Math.max(0, Math.min(matchIndex, matches.length - 1))
      : -1;
    selectMatch(navigate);
  }

  function moveMatch(direction: number) {
    if (!matches.length) return;
    matchIndex = (matchIndex + direction + matches.length) % matches.length;
    selectMatch();
  }

  function selectMatch(navigate = true) {
    count.textContent = query.value
      ? `${matchIndex + 1} / ${matches.length}`
      : "";
    prev.disabled = next.disabled = matches.length === 0;
    // Streaming output updates the count without pulling the reader away.
    if (!navigate) return;
    const terminal = deps.getTerminal();
    const match = matches[matchIndex];
    if (!match) {
      terminal?.clearSelection();
      return;
    }
    terminal?.select(match.col, match.row, match.length);
    terminal?.scrollToLine(Math.max(0, match.row - 2));
  }

  function sync() {
    const text = deps.getText();
    context.textContent = target
      ? `${target.command.split(/[\\/]/).pop()}  ·  ${target.cwd}`
      : text.title;
    context.title = target
      ? `${text.openWorkingDirectory}\n${target.cwd}`
      : text.title;
    context.disabled = !target;
    toolbar.dataset.connected = String(connected);
    empty.hidden = !!target;
    interrupt.disabled = !target || !connected || !enabled;
    copyButton.disabled =
      searchButton.disabled =
      latestButton.disabled =
        !target;
    query.placeholder = text.searchOutput;
    query.setAttribute("aria-label", text.searchOutput);
    emptyTitle.textContent = text.welcomeTitle;
    emptyHint.textContent = text.welcomeHint;
    createButton.textContent = text.newShell;
    for (const [el, key] of labels) {
      const label = text[key];
      if (typeof label !== "string") continue;
      el.title = label;
      el.setAttribute("aria-label", label);
    }
  }

  sync();
  return {
    toolbar,
    search,
    empty,
    localize: sync,
    openLink,
    setTarget(session: ShellSession | null) {
      generation += 1;
      target = session;
      connected = false;
      matches = [];
      query.value = "";
      search.hidden = true;
      searchButton.setAttribute("aria-pressed", "false");
      sync();
    },
    setConnected(value: boolean) {
      connected = value;
      sync();
    },
    setInputEnabled(value: boolean) {
      enabled = value;
      sync();
    },
    install(terminal: XtermTerminal) {
      terminal.registerLinkProvider({
        provideLinks(row, callback) {
          const line = readTerminalLogicalLine(
            terminal.buffer.active,
            row - 1,
            terminal.cols,
          );
          callback(
            findTerminalLinks(line.text).map((link) => {
              const start = line.starts[link.start];
              const end = line.ends[link.end - 1] - 1;
              return {
                text: link.value,
                range: {
                  start: {
                    x: (start % terminal.cols) + 1,
                    y: Math.floor(start / terminal.cols) + 1,
                  },
                  end: {
                    x: (end % terminal.cols) + 1,
                    y: Math.floor(end / terminal.cols) + 1,
                  },
                },
                activate: () => {
                  void openLink(link);
                },
                hover: () => {
                  if (terminal.element)
                    terminal.element.title = `${deps.getText().openLink}: ${link.value}`;
                },
                leave: () => {
                  terminal.element?.removeAttribute("title");
                },
              };
            }),
          );
        },
      });
      terminal.onScroll(() => {
        latestButton.classList.toggle(
          "active",
          terminal.buffer.active.viewportY < terminal.buffer.active.baseY,
        );
      });
    },
    onOutput() {
      if (search.hidden || searchTimer) return;
      searchTimer = setTimeout(() => {
        searchTimer = null;
        if (!search.hidden) updateSearch(false);
      }, 200);
    },
    handleKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        if (event.type === "keydown") {
          event.preventDefault();
          event.stopPropagation();
          showSearch(true);
        }
        return false;
      }
      return true;
    },
    dispose() {
      generation += 1;
      if (searchTimer) clearTimeout(searchTimer);
    },
  };
}
