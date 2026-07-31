// Tools overlay. 画面を離れずに開ける貼り付け専用のスクラッチパッド置き場で、
// Markdown / Mermaid / JSON・YAML の 3 ツールをタブで切り替える。
// 開閉の作りは doctor sheet (views/doctor-view.ts) と同じ右ドロワー
// (hidden + inert + overlay + body クラス) を踏襲している。
//
// 入力内容は .code-viewer/tools.json に保存する (localStorage は使わない)。
// 読み書きとも deps.trackLoad を通す。app.ts の installFetch が全ての fetch を
// AbortController で包むので、追跡の有無に関わらず保存はナビゲーションで
// 中断されうる。だから中断・失敗した保存は dirty のまま残して送り直す。

import { attachDragResizer } from "../../core/drag-resizer";
import {
  DEFAULT_TOOL_ID,
  MAX_TOOLS_SHEET_WIDTH,
  MIN_TOOLS_SHEET_WIDTH,
  TOOL_IDS,
  type ToolId,
} from "../../core/tools";
import type { ToolsState } from "../../core/types";
import { type ToolsLang, type ToolsText, toolsText } from "./i18n";
import { createJsonTool } from "./json-tool";
import { createMarkdownTool } from "./markdown-tool";
import { createMermaidTool } from "./mermaid-tool";
import type { ScratchpadPane } from "./scratchpad-pane";

const SAVE_DEBOUNCE_MS = 800;
/** 保存が中断・失敗したときに送り直すまでの間隔。 */
const SAVE_RETRY_MS = 1500;
/** 連続失敗で諦めるまでの再送回数。 */
const SAVE_RETRY_LIMIT = 3;
/** keepalive 付き fetch のボディ上限 (Fetch Standard の 64 KiB)。 */
const KEEPALIVE_BODY_LIMIT_BYTES = 64 * 1024;

type ToolPane = ScratchpadPane & {
  localizeActions?(text: ToolsText): void;
};

export type ToolsViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T | null;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  getLanguage(): ToolsLang;
  /** 副作用リクエスト用のヘッダ (app.ts の actionHeaders)。 */
  actionHeaders(): HeadersInit;
  onCloseRequest?: () => void;
  /** 表示中のツールが変わったとき。URL 同期に使う。 */
  onToolChange?: (tool: ToolId) => void;
};

export type ToolsViewHandle = {
  open(tool?: ToolId): Promise<void>;
  close(): void;
  isOpen(): boolean;
  getActiveTool(): ToolId;
  localize(): void;
  /** 保留中のタイマーと window リスナを外す。アプリ本体は破棄しないので、
   * 主にテストで view を作り直すときに使う。 */
  dispose(): void;
};

export function createToolsView(deps: ToolsViewDeps): ToolsViewHandle {
  let panes: Record<ToolId, ToolPane> | null = null;
  let tabs: Record<ToolId, HTMLButtonElement> | null = null;
  let titleEl: HTMLElement | null = null;
  let closeBtn: HTMLButtonElement | null = null;
  let activeTool: ToolId = DEFAULT_TOOL_ID;
  let stateLoaded = false;
  let savedActiveTool: ToolId | null = null;
  const drafts: Partial<Record<ToolId, string>> = {};
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveRetryTimer: ReturnType<typeof setTimeout> | null = null;
  // 送るべき変更が残っているか。保存が中断・失敗しても false に戻さないので、
  // 次の機会 (入力・閉じる・離脱) に必ず送り直される。
  let dirty = false;
  // PATCH は 1 本ずつ。並走させると到着順が保証されず、古い本文が後から
  // 上書きしてしまう。送信中の変更は dirty に溜めて完了後に送る。
  let saveInFlight = false;
  /** 送信中の保存を離脱時に打ち切るためのハンドル。 */
  let saveController: AbortController | null = null;
  /** 「保存できません」を出したペイン。保存が通ったらそこだけ消す。 */
  /** 送り直しても通らない保存が残っている。 */
  let saveFailed = false;
  /** 連続した保存失敗の回数。無期限に再送し続けないための歯止め。 */
  let saveRetries = 0;
  /** 保存済みの下書きをまだ読み出せていない。 */
  let loadFailed = false;
  /** dispose 済み。後から返ってきた非同期処理が再開しないようにする。 */
  let disposed = false;
  let sheetWidth: number | null = null;
  // GET を待つ間にユーザーが動かしたかどうか。動かしていたら、読み込んだ
  // 保存値でそれを巻き戻さない。
  let toolTouched = false;
  let widthTouched = false;
  // open / loadState の世代。閉じたり開き直したりした後に、待っていた GET の
  // 続きがタブや URL を書き換えないようにする。
  let generation = 0;

  function text(): ToolsText {
    return toolsText(deps.getLanguage());
  }

  function getMount(): HTMLElement | null {
    return deps.$<HTMLElement>("#tools-sheet");
  }

  function getOverlay(): HTMLElement | null {
    return deps.$<HTMLElement>("#tools-sheet-overlay");
  }

  /** サーバが「送り直しても同じ」と答えたか (4xx)。上限超えの下書きなどが
   * これに当たり、再送し続けても永久に通らない。 */
  function isPermanentSaveFailure(status: number): boolean {
    return status >= 400 && status < 500;
  }

  // 読めていない / 保存できていないことは、描画やコピー結果で消えると状況が
  // 分からなくなる。全ペインの固定ステータスとして出し、解消したら外す。
  // 読み込みの方が重い (既存の下書きを上書きしかねない) ので先に出す。
  function syncFailureStatus(): void {
    if (!panes) return;
    const current = text();
    const message = loadFailed
      ? current.loadFailed
      : saveFailed
        ? current.saveFailed
        : null;
    for (const id of TOOL_IDS) panes[id].setPinnedStatus(message);
  }

  function reportSaveFailure(): void {
    saveFailed = true;
    syncFailureStatus();
  }

  function clearSaveFailure(): void {
    saveRetries = 0;
    if (!saveFailed) return;
    saveFailed = false;
    syncFailureStatus();
  }

  /** 読み出せなかったことを伝える。黙って空で始めると、ユーザーが空欄に
   * 書いた瞬間に既存の下書きを上書きしてしまう。 */
  function reportLoadFailure(): void {
    loadFailed = true;
    syncFailureStatus();
  }

  // 保存はグローバルの installFetch 経由なので、ナビゲーション時の
  // cancelInFlightRequests でも中断されうる。中断・一時的な失敗では書きかけを
  // 捨てず、dirty のまま残して送り直す。
  function save(options: { keepalive?: boolean } = {}): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (disposed) return;
    // 連続失敗で諦めた後は、次にユーザーが何か変えるまで投げ直さない。
    if (!options.keepalive && saveRetries > SAVE_RETRY_LIMIT) return;
    // 離脱時は送信中の分も改めて送る。通常の fetch はページ終了で切られる
    // ので、送信済みに見えても届いているとは限らない。
    const pending = dirty || (options.keepalive === true && saveInFlight);
    if (!pending) return;
    if (saveInFlight && !options.keepalive) return;
    // 離脱時は送信中のものを打ち切ってから送る。2 本を並走させると到着順が
    // 保証されず、古い本文が後から勝ちうる。
    if (options.keepalive) saveController?.abort();
    dirty = false;
    const body = JSON.stringify({
      activeTool,
      drafts,
      ...(sheetWidth === null ? {} : { width: sheetWidth }),
    });
    // keepalive のボディ上限は 64 KiB (Fetch Standard)。下書きはそれより
    // 大きくなりうるので、超えるときは keepalive を諦めて普通に送る
    // (届かないかもしれないが、確実に弾かれるよりはよい)。
    const keepalive =
      options.keepalive === true &&
      new TextEncoder().encode(body).length <= KEEPALIVE_BODY_LIMIT_BYTES;
    const controller = new AbortController();
    if (!options.keepalive) {
      saveInFlight = true;
      saveController = controller;
    }
    void deps
      .trackLoad(
        fetch("/_state/tools", {
          method: "PATCH",
          headers: deps.actionHeaders(),
          body,
          keepalive,
          signal: controller.signal,
        }),
      )
      .then((res) => {
        if (res.ok) {
          clearSaveFailure();
          return;
        }
        if (isPermanentSaveFailure(res.status)) {
          // 送り直しても通らない。書きかけを抱え続けず、理由を出して諦める。
          reportSaveFailure();
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      })
      .catch(() => {
        if (disposed) return;
        dirty = true;
        saveRetries += 1;
        if (saveRetries > SAVE_RETRY_LIMIT) {
          // 落ち続けているサーバに投げ続けても仕方がない。次にユーザーが
          // 何か変えたら (scheduleSave が回数を戻して) また送りに行く。
          reportSaveFailure();
          return;
        }
        // 離脱時の keepalive 送信は再試行しても届かないので、ここでは張らない。
        if (options.keepalive || saveRetryTimer) return;
        saveRetryTimer = setTimeout(() => {
          saveRetryTimer = null;
          save();
        }, SAVE_RETRY_MS);
      })
      .finally(() => {
        if (options.keepalive) return;
        saveInFlight = false;
        if (saveController === controller) saveController = null;
        if (disposed) return;
        // 送信中に増えた変更をここで送る。
        if (dirty && !saveRetryTimer) save();
      });
  }

  function scheduleSave(): void {
    dirty = true;
    // 新しい変更が来たら、諦めていた再送をもう一度試す。
    saveRetries = 0;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, SAVE_DEBOUNCE_MS);
  }

  function onDraftInput(tool: ToolId, value: string): void {
    drafts[tool] = value;
    // 入力も「このツールを使っている」という操作。読み込みが終わった後に
    // 保存値のタブへ連れて行かれないようにする。
    toolTouched = true;
    scheduleSave();
  }

  function createPanes(current: ToolsText): Record<ToolId, ToolPane> {
    return {
      markdown: createMarkdownTool(current, drafts.markdown ?? "", (value) =>
        onDraftInput("markdown", value),
      ),
      mermaid: createMermaidTool(current, drafts.mermaid ?? "", (value) =>
        onDraftInput("mermaid", value),
      ),
      json: createJsonTool(current, drafts.json ?? "", (value) =>
        onDraftInput("json", value),
      ),
    };
  }

  function setActiveTool(tool: ToolId, notify: boolean): void {
    activeTool = tool;
    if (!panes || !tabs) return;
    for (const id of TOOL_IDS) {
      tabs[id].classList.toggle("active", id === tool);
      tabs[id].setAttribute("aria-pressed", String(id === tool));
      panes[id].el.hidden = id !== tool;
    }
    // 非表示の間は描画を止めているので、表に出したときに描き直す。
    panes[tool].refresh();
    panes[tool].focus();
    // notify は「URL を書き換えるか」。URL から直接開いたツール (notify=false)
    // も「最後に使ったツール」として覚える必要があるので、保存の判定は別。
    if (notify) deps.onToolChange?.(tool);
    // 保存済みの値をそのまま復元しただけのときは書き戻さない。
    if (savedActiveTool === tool) return;
    savedActiveTool = tool;
    scheduleSave();
  }

  // ドロワー幅。左端のハンドルを左に動かすほど広がるので direction は -1。
  // 画面に収める上限は CSS 側の min(…, 96vw) が持つ。ここでウィンドウ幅まで
  // 詰めてしまうと、小さいウィンドウで開いた瞬間に覚えていた幅が縮む。
  function applySheetWidth(host: HTMLElement, width: number): void {
    const clamped = Math.round(
      Math.max(MIN_TOOLS_SHEET_WIDTH, Math.min(MAX_TOOLS_SHEET_WIDTH, width)),
    );
    sheetWidth = clamped;
    host.style.setProperty("--tools-sheet-width", `${clamped}px`);
  }

  function mount(host: HTMLElement): void {
    if (panes) return;
    const current = text();
    host.replaceChildren();

    const sheetResizer = document.createElement("div");
    sheetResizer.className = "tools-sheet-resizer";
    sheetResizer.role = "separator";
    sheetResizer.tabIndex = 0;
    sheetResizer.setAttribute("aria-orientation", "vertical");
    sheetResizer.setAttribute("aria-label", current.resizeSheet);
    attachDragResizer({
      handle: sheetResizer,
      getSize: () => host.getBoundingClientRect().width,
      applySize: (width) => {
        // 読み込み中にドラッグされたら、保存値でその幅を巻き戻さない。
        widthTouched = true;
        applySheetWidth(host, width);
      },
      direction: -1,
      onEnd: scheduleSave,
      activeClassTarget: host,
      activeClassName: "tools-sheet-resizing",
    });

    const header = document.createElement("header");
    header.className = "tools-header";
    titleEl = document.createElement("h1");
    titleEl.textContent = current.title;
    const tabList = document.createElement("div");
    tabList.className = "seg tools-tabs";
    tabList.role = "group";
    tabList.setAttribute("aria-label", current.title);
    closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tools-close";
    closeBtn.textContent = "×";
    closeBtn.title = current.close;
    closeBtn.setAttribute("aria-label", current.close);
    closeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      deps.onCloseRequest?.();
    });
    header.append(titleEl, tabList, closeBtn);

    panes = createPanes(current);
    tabs = {} as Record<ToolId, HTMLButtonElement>;
    const body = document.createElement("div");
    body.className = "tools-body";
    for (const id of TOOL_IDS) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.textContent = current.tabs[id];
      tab.addEventListener("click", () => {
        // 読み込み中に切り替えたら、保存値でそのタブを巻き戻さない。
        toolTouched = true;
        setActiveTool(id, true);
      });
      tabs[id] = tab;
      tabList.appendChild(tab);
      // 下書きの読み込みが終わって setActiveTool が走るまでは 1 枚だけ見せる。
      panes[id].el.hidden = id !== activeTool;
      tab.classList.toggle("active", id === activeTool);
      body.appendChild(panes[id].el);
    }

    host.append(sheetResizer, header, body);
  }

  async function loadState(myGen: number): Promise<void> {
    if (stateLoaded) return;
    try {
      const res = await deps.trackLoad(fetch("/_state/tools"));
      // 世代が変わっていたらこの読み込みは無効。stateLoaded も立てない
      // (立てると開き直したときに二度と読みに行かなくなる)。本文を読み切る
      // までは「読めた」と見なさない。
      if (myGen !== generation) return;
      if (!res.ok) {
        // 読めていないまま空で始めると、ユーザーが空欄に書いた瞬間に既存の
        // 下書きを上書きしてしまう。開き直したときに読み直せるようにする。
        reportLoadFailure();
        return;
      }
      const data = (await res.json()) as ToolsState;
      if (myGen !== generation) return;
      stateLoaded = true;
      if (loadFailed) {
        loadFailed = false;
        syncFailureStatus();
      }
      // 待っている間にユーザーが動かした分は、保存値で巻き戻さない。
      if (!toolTouched) savedActiveTool = data.activeTool ?? null;
      const host = getMount();
      if (host && !widthTouched && typeof data.width === "number")
        applySheetWidth(host, data.width);
      for (const id of TOOL_IDS) {
        const draft = data.drafts?.[id];
        if (typeof draft !== "string") continue;
        // 読み込みを待つ間にユーザーが書き始めていたら、その入力が正。
        // drafts に載っている = onDraftInput が走った、なので触らない。
        if (id in drafts) continue;
        drafts[id] = draft;
        panes?.[id].setText(draft);
      }
    } catch {
      // 中断・通信断も同じ。読めていないことを伝え、次に開いたときに読み直す。
      if (myGen === generation) reportLoadFailure();
    }
  }

  function isOpen(): boolean {
    const host = getMount();
    return host ? !host.hidden : false;
  }

  async function open(tool?: ToolId): Promise<void> {
    const host = getMount();
    if (!host) return;
    const myGen = ++generation;
    mount(host);
    host.hidden = false;
    host.setAttribute("aria-hidden", "false");
    // ドロワーはスライドアウトのため [hidden] でも display:block のままなので、
    // 閉じている間に Tab フォーカスが入らないよう inert を併用する。
    host.removeAttribute("inert");
    const overlay = getOverlay();
    if (overlay) {
      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("tools-sheet-open");
    await loadState(myGen);
    // 読み込みを待つ間に閉じられた / 開き直された場合、この open はもう
    // 過去のもの。タブも URL も触らずに終わる。
    if (myGen !== generation || !isOpen()) return;
    setActiveTool(tool ?? savedActiveTool ?? DEFAULT_TOOL_ID, !tool);
  }

  function close(): void {
    const host = getMount();
    if (!host) return;
    host.hidden = true;
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("inert", "");
    const overlay = getOverlay();
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("tools-sheet-open");
    // 読み込み中だった GET と、その後の setActiveTool を無効化する。
    generation += 1;
    // 書きかけの下書きはここで確定させる (失敗すれば dirty のまま再送される)。
    save();
  }

  function localize(): void {
    if (!panes || !tabs) return;
    const current = text();
    if (titleEl) titleEl.textContent = current.title;
    if (closeBtn) {
      closeBtn.title = current.close;
      closeBtn.setAttribute("aria-label", current.close);
    }
    for (const id of TOOL_IDS) tabs[id].textContent = current.tabs[id];
    panes.markdown.localize(
      current,
      current.markdown.output,
      current.markdown.placeholder,
    );
    panes.mermaid.localize(
      current,
      current.mermaid.output,
      current.mermaid.placeholder,
    );
    panes.json.localize(current, current.json.output, current.json.placeholder);
    for (const id of TOOL_IDS) panes[id].localizeActions?.(current);
    panes[activeTool].refresh();
    // 固定メッセージは描画では貼り直されないので、ここで言語を反映する。
    syncFailureStatus();
  }

  // 送信中の分もここで送り直す。通常の fetch はページ終了で切られるので、
  // 「送った」ことは「届いた」ことを意味しない。
  const onBeforeUnload = () => {
    if (dirty || saveInFlight) save({ keepalive: true });
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  return {
    open,
    close,
    isOpen,
    getActiveTool: () => activeTool,
    localize,
    dispose() {
      disposed = true;
      // 待機中の GET を無効化し、送信中の保存は打ち切る。後から返ってきた
      // 処理がタイマーや保存を再開しないようにする。
      generation += 1;
      saveController?.abort();
      saveController = null;
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      if (saveRetryTimer) clearTimeout(saveRetryTimer);
      saveRetryTimer = null;
      if (!panes) return;
      for (const id of TOOL_IDS) panes[id].dispose();
    },
  };
}
