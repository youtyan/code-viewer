// ドロワー左側。tmux の入れ子をそのままツリーで見せつつ、人間の番のものを
// 上に出す。
//
//   [このリポジトリ / すべて]        ← 出す範囲
//   あなたの番 (n) … カード …
//   [絞り込み] [+ 新しいシェル]
//   ▾ シェル                        ← このドロワーが開いた PTY
//       ● zsh  14:03  → 0:1.2       ← tmux を映していればその宛先も出す
//   ▾ tmux
//     ▾ 0                           ← tmux セッション
//       ▾ 0 · main                  ← ウィンドウ
//           ◆ 待ち  .0  タスク名 …  ← ペイン
//
// 平坦な 1 枚の表にすると、どのウィンドウのペインか分からなくなる。tmux 上で
// 見えている並びと突き合わせられるよう、セッション・ウィンドウ・ペインを
// そのまま入れ子にする。
//
// 押したときの意味は行の種類で変わる。シェルはそれ自体がターミナルなので
// そのまま映し、tmux ペインは「そこへ連れて行ってほしい」という依頼になる
// (サーバが switch-client するか、シェルを開いて attach する)。
//
// 行の組み立てと並び順は core/terminal-board の純関数が決める。ここは描画と
// 入力の受け取りだけを持つ。

import {
  type AgentState,
  type AgentStateObservationError,
  type AgentStateRecord,
  isAgentState,
} from "../../core/agent-state";
import {
  CHEVRON_DOWN_16_PATH,
  iconSvg,
  PLUS_16_PATH,
  TERMINAL_16_PATHS,
} from "../../core/icons";
import type { ShellSession, ShellSessionId } from "../../core/shell";
import {
  attentionRows,
  type BoardRow,
  type BoardScope,
  type BoardShellBranch,
  buildBoardRows,
  buildBoardTree,
  countBoardStates,
  elapsedBucket,
  filterBoardRows,
  filterByScope,
  type WindowGroup,
} from "../../core/terminal-board";
import type { TmuxClient, TmuxPanesResponse } from "../../core/tmux";
import type { TerminalText } from "./i18n";

export type SessionBoardDeps = {
  getText(): TerminalText;
  /** シェルの行。そのままターミナルに映す。 */
  onSelectShell(row: BoardRow): void;
  /** tmux ペインの行。そこへ連れて行ってもらう。 */
  onOpenPane(row: BoardRow): void;
  onCreateShell(): void;
  onCloseShell(id: ShellSessionId): void;
  onMarkRead(row: BoardRow): void;
};

export type SessionBoardData = {
  panes: TmuxPanesResponse | null;
  shells: ShellSession[];
  clients: TmuxClient[];
  shellAvailable: boolean;
  shellUnavailableReason: string;
  states: AgentStateRecord[];
  stateErrors: AgentStateObservationError[];
};

export type SessionBoardHandle = {
  el: HTMLElement;
  setData(data: SessionBoardData): void;
  setSelected(target: string | null): void;
  localize(): void;
};

const FILTER_ORDER: AgentState[] = ["waiting", "done", "working", "idle"];

/** 枝を畳み状態の集合で指すための鍵。セッション名と衝突しない値。 */
const SHELL_BRANCH = " shell";
const TMUX_BRANCH = " tmux";

/**
 * 鍵をつなぐ区切り。ASCII の Unit Separator (0x1F)。セッション名にもウィンドウ
 * 名にも現れないので、`work` + `0` と `work0` + `` を取り違えない。
 *
 * 生の制御文字はソースに直接置かない。見た目が空文字と区別できず、消えていても
 * 気付けない (server/tmux/panes.ts の FIELD_SEP と同じ理由)。
 */
const BRANCH_KEY_SEP = String.fromCharCode(31);

/** 枝の鍵を組み立てる。畳み状態はこの文字列で覚える。 */
function branchKey(...parts: string[]): string {
  return parts.join(BRANCH_KEY_SEP);
}

export function createSessionBoard(deps: SessionBoardDeps): SessionBoardHandle {
  const el = document.createElement("div");
  el.className = "terminal-board";

  const scopeBar = document.createElement("div");
  scopeBar.className = "terminal-scope";
  const scopeSelect = document.createElement("select");
  scopeSelect.className = "terminal-scope-select";
  const scopeHint = document.createElement("span");
  scopeHint.className = "terminal-scope-hint";
  scopeBar.append(scopeSelect, scopeHint);

  const attentionSection = document.createElement("section");
  attentionSection.className = "terminal-attention";
  const attentionHead = document.createElement("div");
  attentionHead.className = "terminal-section-head";
  const attentionTitle = document.createElement("b");
  const attentionCount = document.createElement("span");
  attentionCount.className = "terminal-section-count";
  attentionHead.append(attentionTitle, attentionCount);
  const attentionCards = document.createElement("div");
  attentionCards.className = "terminal-attention-cards";
  const attentionEmpty = document.createElement("p");
  attentionEmpty.className = "terminal-empty";
  attentionSection.append(attentionHead, attentionCards, attentionEmpty);

  const observationErrors = document.createElement("pre");
  observationErrors.className = "terminal-observation-errors";
  observationErrors.setAttribute("role", "alert");
  observationErrors.hidden = true;

  const filters = document.createElement("div");
  filters.className = "terminal-filters";
  const stateSelect = document.createElement("select");
  stateSelect.className = "terminal-state-select";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "terminal-search";
  const newShell = document.createElement("button");
  newShell.type = "button";
  newShell.className = "terminal-shell-new";
  newShell.innerHTML = iconSvg("octicon-plus", PLUS_16_PATH);
  newShell.addEventListener("click", () => deps.onCreateShell());

  filters.append(stateSelect, search, newShell);

  const tree = document.createElement("div");
  tree.className = "terminal-tree";
  tree.role = "tree";
  const treeEmpty = document.createElement("p");
  treeEmpty.className = "terminal-empty";

  el.append(scopeBar, observationErrors, attentionSection, filters, tree);

  let data: SessionBoardData = {
    panes: null,
    shells: [],
    clients: [],
    shellAvailable: true,
    shellUnavailableReason: "",
    states: [],
    stateErrors: [],
  };
  let selected: string | null = null;
  let stateFilter: AgentState | null = null;
  let scope: BoardScope = "repo";
  /**
   * 畳んである枝。既定は全部開いた状態にする。tmux を開いている人はウィンドウ
   * が数個なので、開いていることのほうが多い。
   */
  const collapsed = new Set<string>();

  search.addEventListener("input", () => render());
  scopeSelect.addEventListener("change", () => {
    scope = scopeSelect.value === "all" ? "all" : "repo";
    render();
  });
  stateSelect.addEventListener("change", () => {
    stateFilter = isAgentState(stateSelect.value) ? stateSelect.value : null;
    render();
  });

  function stateLabel(state: AgentState): string {
    const text = deps.getText();
    if (state === "working") return text.stateWorking;
    if (state === "waiting") return text.stateWaiting;
    if (state === "done") return text.stateDone;
    return text.stateIdle;
  }

  /** 状態の印。色だけに頼らないよう、形も状態ごとに変える。 */
  function stateMark(state: AgentState): HTMLElement {
    const mark = document.createElement("i");
    mark.className = `terminal-mark terminal-mark-${state}`;
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }

  function elapsedText(row: BoardRow): string {
    if (row.updatedAt === 0) return "";
    return deps.getText().elapsed(elapsedBucket(Date.now() - row.updatedAt));
  }

  /**
   * その行が今ターミナルに出ているか。
   *
   * シェルは選ばれていればそのまま出ている。tmux ペインは、それを映している
   * シェル (linkedTarget) が選ばれていれば出ている。ツリー上でどれが目の前の
   * 画面なのかが分かるように、同じ扱いにする。
   */
  function createCard(row: BoardRow): HTMLElement {
    const text = deps.getText();
    const card = document.createElement("div");
    card.className = `terminal-card terminal-card-${row.state}`;

    const task = document.createElement("div");
    task.className = "terminal-card-task";
    task.textContent = row.task;

    const meta = document.createElement("div");
    meta.className = "terminal-card-meta";
    const where = document.createElement("span");
    where.className = "terminal-tag terminal-mono";
    // どのセッションのどのウィンドウのどのペインか。カードからでも辿れる。
    where.textContent = row.kind === "tmux" ? row.locator : text.shells;
    const place = document.createElement("span");
    place.className = "terminal-tag";
    place.textContent = row.place;
    const agent = document.createElement("span");
    agent.textContent = `${row.agent} · ${elapsedText(row)}`;
    meta.append(where, place, agent);
    card.append(task, meta);

    for (const [label, body] of [
      [text.lastPrompt, row.lastPrompt],
      [stateLabel(row.state), row.note],
    ] as const) {
      if (!body) continue;
      const quote = document.createElement("div");
      quote.className = "terminal-card-quote";
      const head = document.createElement("span");
      head.textContent = label;
      quote.append(head, document.createTextNode(body));
      card.appendChild(quote);
    }

    const actions = document.createElement("div");
    actions.className = "terminal-card-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.className = `terminal-card-open terminal-card-open-${row.state}`;
    open.textContent = text.openTarget;
    open.addEventListener("click", () => activate(row));
    actions.appendChild(open);
    if (row.state === "done") {
      const read = document.createElement("button");
      read.type = "button";
      read.className = "terminal-card-read";
      read.textContent = text.markRead;
      read.addEventListener("click", () => deps.onMarkRead(row));
      actions.appendChild(read);
    }
    card.appendChild(actions);
    return card;
  }

  /** 押されたときの振り分け。シェルは映すだけ、tmux は連れて行ってもらう。 */
  function activate(row: BoardRow): void {
    if (row.kind === "shell") deps.onSelectShell(row);
    else deps.onOpenPane(row);
  }

  /**
   * 1 行を組み立てる。
   *
   * @param session そのシェルが中で動かしている tmux のセッション名。渡された
   *   ときだけ、行に tmux の印とセッション名が付く (繋がっていないシェルとの
   *   区別がここで付く)。
   */
  function createRow(row: BoardRow, session = ""): HTMLElement {
    const text = deps.getText();
    const wrap = document.createElement("div");
    wrap.className = "terminal-row";
    wrap.role = "treeitem";

    const button = document.createElement("button");
    button.type = "button";
    button.className = `terminal-row-item terminal-row-item-${row.kind}`;
    button.dataset.target = row.target;
    const isSelected = row.target === selected;
    button.classList.toggle("active", isSelected);
    button.classList.toggle(
      "related-active",
      !isSelected && row.linkedTarget === selected,
    );
    if (isSelected) button.setAttribute("aria-current", "true");

    const index = document.createElement("span");
    index.className = "terminal-row-index terminal-mono";
    // tmux はペイン番号、シェルは開いた時刻。行頭の 1 列で位置が分かる。
    index.textContent = row.kind === "tmux" ? `.${row.paneIndex}` : row.locator;

    const state = document.createElement("span");
    state.className = `terminal-row-state terminal-row-state-${row.state}`;
    state.textContent = stateLabel(row.state);

    const task = document.createElement("span");
    task.className = "terminal-row-task";
    task.textContent = row.task;

    const agent = document.createElement("span");
    agent.className = "terminal-row-agent";
    agent.textContent = row.agent;

    const size = document.createElement("span");
    size.className = "terminal-row-size terminal-mono";
    size.textContent = text.paneSize(row.cols, row.rows);

    const age = document.createElement("span");
    age.className = "terminal-row-age";
    age.textContent = elapsedText(row);

    // そのシェルが tmux を動かしていれば、印とセッション名を添える。素の
    // シェルとの区別がここで付く。要素は空でも必ず置く。行ごとに有無が
    // 変わると、その列から先の桁が行ごとにずれる。
    const link = document.createElement("span");
    link.className = "terminal-row-link terminal-mono";
    if (session) {
      link.innerHTML = iconSvg("octicon-terminal", TERMINAL_16_PATHS);
      link.append(session);
      link.title = text.attachedTo(session);
    }

    button.append(
      stateMark(row.state),
      index,
      state,
      task,
      agent,
      size,
      link,
      age,
    );
    button.title = [
      row.task,
      row.kind === "tmux" ? `${row.locator} · ${row.place}` : row.place,
      row.source && row.source !== "hook" ? text.guessed : "",
      row.lastPrompt ? `${text.lastPrompt}: ${row.lastPrompt}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    button.addEventListener("click", () => activate(row));
    wrap.appendChild(button);

    if (row.kind === "shell") {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "terminal-shell-close";
      close.textContent = "×";
      close.title = text.closeShell;
      close.setAttribute("aria-label", text.closeShell);
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        deps.onCloseShell(row.target);
      });
      wrap.appendChild(close);
    }
    return wrap;
  }

  function renderScope(all: BoardRow[], scoped: BoardRow[]): void {
    const text = deps.getText();
    scopeSelect.replaceChildren();
    const hidden = all.length - scoped.length;
    for (const [value, label] of [
      ["repo", text.scopeRepo],
      ["all", text.scopeAll],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = scope === value;
      scopeSelect.appendChild(option);
    }
    scopeSelect.setAttribute("aria-label", text.scopeLabel);
    scopeHint.textContent =
      scope === "repo" && hidden > 0 ? text.hiddenOther(hidden) : "";
    scopeSelect.title = scopeHint.textContent || text.scopeLabel;
  }

  function renderFilters(rows: BoardRow[]): void {
    const text = deps.getText();
    const counts = countBoardStates(rows);
    stateSelect.replaceChildren();
    for (const state of [null, ...FILTER_ORDER]) {
      const option = document.createElement("option");
      option.value = state ?? "";
      option.textContent = state
        ? `${stateLabel(state)} ${counts[state]}`
        : `${text.filterAll} ${rows.length}`;
      option.selected = stateFilter === state;
      stateSelect.appendChild(option);
    }
    stateSelect.setAttribute("aria-label", text.stateFilterLabel);
    stateSelect.title = text.stateFilterLabel;
    search.placeholder = text.filterPlaceholder;
    search.setAttribute("aria-label", text.filterPlaceholder);
    newShell.title = text.newShellTitle;
    newShell.setAttribute("aria-label", text.newShellTitle);
    newShell.disabled = !data.shellAvailable;
  }

  /**
   * 枝の見出し。押すと畳む / 開く。
   *
   * 畳んだ状態は枝の鍵で覚える。取り直しのたびに作り直しても、開いていた枝は
   * 開いたままになる。
   */
  function createBranch(
    key: string,
    label: string,
    depth: number,
    count: number,
  ): { head: HTMLElement; children: HTMLElement } {
    const isCollapsed = collapsed.has(key);
    const head = document.createElement("button");
    head.type = "button";
    head.className = `terminal-tree-head terminal-tree-head-${depth}`;
    head.setAttribute("aria-expanded", String(!isCollapsed));

    const twisty = document.createElement("span");
    twisty.className = "terminal-tree-twisty";
    twisty.classList.toggle("collapsed", isCollapsed);
    twisty.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
    twisty.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "terminal-tree-name";
    name.textContent = label;

    const badge = document.createElement("span");
    badge.className = "terminal-tree-count";
    badge.textContent = String(count);

    head.append(twisty, name, badge);
    head.addEventListener("click", () => {
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      render();
    });

    const children = document.createElement("div");
    children.className = "terminal-tree-children";
    children.role = "group";
    children.hidden = isCollapsed;
    return { head, children };
  }

  /** ペインの数を数える。枝の見出しに出す件数。 */
  function countPanes(windows: WindowGroup[]): number {
    return windows.reduce((total, window) => total + window.rows.length, 0);
  }

  /**
   * ウィンドウとペインを親の枝の下に並べる。
   *
   * 上段 (シェルの中の tmux) でも下段 (まだ開いていないセッション) でも形は
   * 同じなので、置き場所と鍵の前置きだけを変えて使い回す。
   */
  function appendWindows(
    parent: HTMLElement,
    keyPrefix: string,
    windows: WindowGroup[],
    depth: number,
  ): void {
    for (const window of windows) {
      const nested = document.createElement("div");
      nested.className = "terminal-tree-group";
      const inner = createBranch(
        `${keyPrefix}${window.window}`,
        window.window,
        depth,
        window.rows.length,
      );
      nested.append(inner.head, inner.children);
      for (const row of window.rows) inner.children.appendChild(createRow(row));
      parent.appendChild(nested);
    }
  }

  /**
   * シェル 1 本ぶんの枝。
   *
   * シェルの行そのものが枝の見出しを兼ねる。tmux を動かしていれば、その
   * セッションのウィンドウとペインがこの下にぶら下がる。素のシェルは
   * 折りたたむものが無いので行だけ。
   */
  function createShellBranch(branch: BoardShellBranch): HTMLElement {
    const group = document.createElement("div");
    group.className = "terminal-tree-group";
    const row = createRow(branch.shell, branch.session);
    group.appendChild(row);
    if (branch.windows.length === 0) return group;

    const key = branchKey(SHELL_BRANCH, branch.shell.target);
    const isCollapsed = collapsed.has(key);
    // 折りたたみは行の頭に付ける。行そのものは押すと画面が切り替わるので、
    // 開閉は別のボタンに分けないと、見るつもりが移動になってしまう。
    const twisty = document.createElement("button");
    twisty.type = "button";
    twisty.className = "terminal-tree-twisty terminal-tree-twisty-inline";
    twisty.classList.toggle("collapsed", isCollapsed);
    twisty.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
    twisty.setAttribute("aria-expanded", String(!isCollapsed));
    twisty.setAttribute("aria-label", deps.getText().toggleBranch);
    twisty.addEventListener("click", (event) => {
      event.stopPropagation();
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      render();
    });
    row.insertBefore(twisty, row.firstChild);

    const children = document.createElement("div");
    children.className = "terminal-tree-children";
    children.role = "group";
    children.hidden = isCollapsed;
    appendWindows(children, key, branch.windows, 1);
    group.appendChild(children);
    return group;
  }

  /** 上段。開いているシェルと、その中で動いている tmux。 */
  function renderShellBranch(branches: BoardShellBranch[]): HTMLElement {
    const text = deps.getText();
    const branch = document.createElement("div");
    branch.className = "terminal-tree-group";
    const { head, children } = createBranch(
      SHELL_BRANCH,
      text.shells,
      0,
      branches.length,
    );
    branch.append(head, children);
    if (branches.length > 0) {
      for (const item of branches)
        children.appendChild(createShellBranch(item));
      return branch;
    }
    // 1 つも無いときは、なぜ無いのかをその場に出す (node-pty が無い環境か、
    // まだ開いていないだけか)。
    const empty = document.createElement("p");
    empty.className = "terminal-empty terminal-tree-empty";
    empty.textContent = data.shellAvailable
      ? text.noShells
      : data.shellUnavailableReason || text.shellUnavailable;
    children.appendChild(empty);
    return branch;
  }

  function renderTree(scoped: BoardRow[]): void {
    const text = deps.getText();
    const visible = filterBoardRows(scoped, {
      state: stateFilter,
      query: search.value,
    });
    tree.replaceChildren();

    // 上段はシェル、下段はまだシェルで開いていないセッション。同じセッションが
    // 両方に出ることはなく、開けば上へ、閉じれば下へ勝手に移る。
    const { shells, sessions } = buildBoardTree(visible);
    tree.appendChild(renderShellBranch(shells));

    const tmuxCount = sessions.reduce(
      (total, session) => total + countPanes(session.windows),
      0,
    );
    const tmuxBranch = document.createElement("div");
    tmuxBranch.className = "terminal-tree-group";
    const tmux = createBranch(TMUX_BRANCH, "tmux", 0, tmuxCount);
    tmuxBranch.append(tmux.head, tmux.children);

    for (const session of sessions) {
      const branch = document.createElement("div");
      branch.className = "terminal-tree-group";
      const key = branchKey(TMUX_BRANCH, session.session);
      const { head, children } = createBranch(
        key,
        session.session,
        1,
        countPanes(session.windows),
      );
      branch.append(head, children);
      appendWindows(children, key, session.windows, 2);
      tmux.children.appendChild(branch);
    }
    tree.appendChild(tmuxBranch);

    // tmux の枝が 1 つも無いときだけ、その理由をツリーの下に出す。シェルの枝は
    // 常に在るので、ツリー全体が空になることはない。
    const hasTmux = visible.some((row) => row.kind === "tmux");
    const message = hasTmux
      ? null
      : scoped.some((row) => row.kind === "tmux")
        ? text.noMatches
        : data.panes && !data.panes.available
          ? text.notInstalled
          : text.noSessions;
    treeEmpty.textContent = message ?? "";
    treeEmpty.hidden = message === null;
    tmux.children.appendChild(treeEmpty);
  }

  function render(): void {
    const text = deps.getText();
    const all = buildBoardRows(
      data.panes,
      data.shells,
      data.states,
      data.clients,
    );
    const scoped = filterByScope(all, scope);

    observationErrors.textContent = data.stateErrors
      .map((error) => {
        const target = error.target ? ` ${error.target}` : "";
        return `[${error.operation}${target}]\n${error.detail}${
          error.stack ? `\n${error.stack}` : ""
        }`;
      })
      .join("\n\n");
    observationErrors.hidden = data.stateErrors.length === 0;

    renderScope(all, scoped);

    const attention = attentionRows(scoped);
    attentionTitle.textContent = text.yourTurn;
    attentionCount.textContent = String(attention.length);
    attentionCards.replaceChildren(...attention.map(createCard));
    attentionCards.hidden = attention.length === 0;
    attentionEmpty.textContent = text.yourTurnEmpty;
    attentionEmpty.hidden = attention.length > 0;
    attentionSection.classList.toggle("is-empty", attention.length === 0);

    renderFilters(scoped);
    renderTree(scoped);
  }

  render();

  return {
    el,
    setData(next) {
      data = next;
      render();
    },
    setSelected(target) {
      selected = target;
      // 選択は「今どの画面が出ているか」の印で、tmux ペインの行にも付く
      // (そのペインを映しているシェルが選ばれていれば、その行も点く)。
      // 対応関係は行の組み立て側が持っているので、素直に描き直す。
      render();
    },
    localize() {
      render();
    },
  };
}
