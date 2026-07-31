// tools オーバーレイに並ぶ全ツールが共有する「左に貼り付け、右に結果」の
// 2 ペイン。入力の受け取り・デバウンス・描画の世代管理・幅のドラッグ調整は
// ここに集約し、各ツールは render() の中身だけを書けばよい。
//
// 描画は毎回 AbortController を張り替える。mermaid / shiki / yaml の lazy
// import を待っている間に次の入力が来ても、古い描画結果が後から出力ペインを
// 上書きしないようにするため (AGENTS.md の Request Lifecycle Discipline と
// 同じ考え方を、fetch ではなく描画に当てたもの)。

import { attachDragResizer } from "../../core/drag-resizer";
import type { ToolsText } from "./i18n";

const RENDER_DEBOUNCE_MS = 200;
/** ステータス表示を消すまでの時間。コピー結果のような一過性の文言に使う。 */
const STATUS_CLEAR_MS = 1800;

export type ScratchpadRender = (
  text: string,
  output: HTMLElement,
  signal: AbortSignal,
) => void | Promise<void>;

export type ScratchpadPaneOptions = {
  /** ツール固有のクラス。CSS の取っ掛かりにする。 */
  toolClassName: string;
  initialText: string;
  /** 入力が変わるたびに即座に呼ばれる (保存は呼び出し側で間引く)。 */
  onInput: (text: string) => void;
  render: ScratchpadRender;
  /** 出力ペインのヘッダに載せるコントロール。 */
  outputActions?: HTMLElement[];
};

export type ScratchpadPane = {
  el: HTMLElement;
  input: HTMLTextAreaElement;
  /** 出力ペインの本体。ツール側が中身を差し替える。 */
  output: HTMLElement;
  /** ヘッダの固定幅スロットに文言を出す。tone="error" で警告色。
   * 固定メッセージ (setPinnedStatus) が出ている間は無視される。 */
  setStatus(message: string, tone?: "info" | "error"): void;
  /** 一定時間で自動的に消えるステータス。コピー結果など。 */
  flashStatus(message: string, tone?: "info" | "error"): void;
  /** 解消するまで出し続ける文言。描画やコピー結果で消えない。null で解除。
   * 「保存できません」のように、消えると状況が分からなくなるものに使う。 */
  setPinnedStatus(message: string | null, tone?: "info" | "error"): void;
  /** 現在の入力で描画をやり直す (言語・テーマ変更や再表示時)。 */
  refresh(): void;
  /** 入力を差し替える。onInput も描画も走らないので、表に出すときに refresh()
   * を呼ぶ側が描画のタイミングを決める (保存済み下書きの復元用)。 */
  setText(text: string): void;
  getText(): string;
  localize(text: ToolsText, outputTitle: string, placeholder: string): void;
  focus(): void;
  dispose(): void;
};

/** ペインのヘッダに置くボタン。ツール側のツールバー用にも公開する。 */
export function createPaneAction(
  label: string,
  title: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tools-pane-action";
  button.textContent = label;
  button.title = title;
  return button;
}

function createHead(title: string): {
  head: HTMLElement;
  titleEl: HTMLElement;
} {
  const head = document.createElement("header");
  head.className = "tools-pane-head";
  const titleEl = document.createElement("span");
  titleEl.className = "tools-pane-title";
  titleEl.textContent = title;
  head.appendChild(titleEl);
  return { head, titleEl };
}

export function createScratchpadPane(
  text: ToolsText,
  outputTitle: string,
  placeholder: string,
  options: ScratchpadPaneOptions,
): ScratchpadPane {
  // localize() で差し替わるので、描画時に読む文言はこの変数から取る。
  let currentText = text;

  const el = document.createElement("div");
  el.className = `tools-pane ${options.toolClassName}`;

  const inputSide = document.createElement("section");
  inputSide.className = "tools-pane-side tools-pane-input";
  const { head: inputHead, titleEl: inputTitle } = createHead(text.pane.input);
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "tools-pane-action";
  clearBtn.textContent = text.pane.clear;
  clearBtn.title = text.pane.clearTitle;
  inputHead.appendChild(clearBtn);
  const input = document.createElement("textarea");
  input.className = "tools-textarea";
  input.spellcheck = false;
  input.placeholder = placeholder;
  input.value = options.initialText;
  inputSide.append(inputHead, input);

  const resizer = document.createElement("div");
  resizer.className = "tools-pane-resizer";
  resizer.role = "separator";
  resizer.tabIndex = 0;
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-label", text.pane.resize);

  const outputSide = document.createElement("section");
  outputSide.className = "tools-pane-side tools-pane-output";
  const { head: outputHead, titleEl: outputTitleEl } = createHead(outputTitle);
  const actions = document.createElement("div");
  actions.className = "tools-pane-actions";
  for (const action of options.outputActions ?? []) actions.appendChild(action);
  const status = document.createElement("span");
  status.className = "tools-pane-status";
  status.role = "status";
  outputHead.append(actions, status);
  const output = document.createElement("div");
  output.className = "tools-pane-body";
  outputSide.append(outputHead, output);

  el.append(inputSide, resizer, outputSide);

  type StatusState = { message: string; tone: "info" | "error" };

  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  // 解消するまで出し続ける文言。これが出ている間、描画やコピー結果は
  // ステータス欄を触らない。
  let pinnedStatus: StatusState | null = null;
  // 固定表示に隠されている間の通常ステータス。固定を解除したらこれに戻す。
  // 保持しないと、固定中に出た描画エラーが解除後に消えてしまう。
  let normalStatus: StatusState = { message: "", tone: "info" };

  function applyStatus(state: StatusState): void {
    status.textContent = state.message;
    status.classList.toggle("tools-pane-status-error", state.tone === "error");
  }

  function clearStatusTimer(): void {
    if (!statusTimer) return;
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  function setStatus(message: string, tone: "info" | "error" = "info"): void {
    clearStatusTimer();
    normalStatus = { message, tone };
    if (pinnedStatus) return;
    applyStatus(normalStatus);
  }

  function flashStatus(message: string, tone: "info" | "error" = "info"): void {
    clearStatusTimer();
    // 一過性の通知なので normalStatus は塗り替えず、時間が来たら戻す。
    if (pinnedStatus) return;
    applyStatus({ message, tone });
    statusTimer = setTimeout(() => {
      statusTimer = null;
      applyStatus(pinnedStatus ?? normalStatus);
    }, STATUS_CLEAR_MS);
  }

  function setPinnedStatus(
    message: string | null,
    tone: "info" | "error" = "error",
  ): void {
    clearStatusTimer();
    pinnedStatus = message ? { message, tone } : null;
    applyStatus(pinnedStatus ?? normalStatus);
  }

  let renderController: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function renderNow(): void {
    renderController?.abort();
    const controller = new AbortController();
    renderController = controller;
    const value = input.value;
    if (!value.trim()) {
      const empty = document.createElement("p");
      empty.className = "tools-pane-empty";
      empty.textContent = currentText.pane.emptyInput;
      output.replaceChildren(empty);
      setStatus("");
      return;
    }
    void (async () => {
      try {
        await options.render(value, output, controller.signal);
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setStatus(message, "error");
      }
    })();
  }

  function scheduleRender(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      renderNow();
    }, RENDER_DEBOUNCE_MS);
  }

  input.addEventListener("input", () => {
    options.onInput(input.value);
    // 走っている描画の結果はもう古い。デバウンス明けを待たずここで捨てないと、
    // lazy import を待っている描画が先に完了して出力を上書きする。
    renderController?.abort();
    renderController = null;
    scheduleRender();
  });

  clearBtn.addEventListener("click", () => {
    if (!input.value) return;
    input.value = "";
    options.onInput("");
    input.focus();
    renderNow();
  });

  // 幅の調整。grid の 1 列目を px 固定にして、残りを出力側が受け取る。
  const MIN_SIDE_WIDTH = 220;

  function applyInputWidth(width: number): void {
    const total = el.getBoundingClientRect().width;
    const max = Math.max(MIN_SIDE_WIDTH, total - MIN_SIDE_WIDTH);
    const clamped = Math.max(MIN_SIDE_WIDTH, Math.min(max, width));
    el.style.setProperty("--tools-input-width", `${Math.round(clamped)}px`);
  }

  const detachResizer = attachDragResizer({
    handle: resizer,
    getSize: () => inputSide.getBoundingClientRect().width,
    applySize: applyInputWidth,
    direction: 1,
    activeClassTarget: el,
    activeClassName: "tools-pane-resizing",
  });

  return {
    el,
    input,
    output,
    setStatus,
    flashStatus,
    setPinnedStatus,
    refresh: renderNow,
    setText(next: string) {
      input.value = next;
    },
    getText: () => input.value,
    localize(nextText: ToolsText, nextOutputTitle: string, nextPlaceholder) {
      currentText = nextText;
      inputTitle.textContent = nextText.pane.input;
      clearBtn.textContent = nextText.pane.clear;
      clearBtn.title = nextText.pane.clearTitle;
      resizer.setAttribute("aria-label", nextText.pane.resize);
      outputTitleEl.textContent = nextOutputTitle;
      input.placeholder = nextPlaceholder;
    },
    focus: () => input.focus(),
    dispose() {
      detachResizer();
      renderController?.abort();
      renderController = null;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = null;
    },
  };
}
