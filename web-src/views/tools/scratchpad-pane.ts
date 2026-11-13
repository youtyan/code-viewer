// cv-scratchpad-pane: Tools の 3 つの道具が共有する「左に貼り付け、右に結果」の
// 2 面。入力の受け取り・デバウンス・描画の世代管理・幅のドラッグ調整・状態の
// 文言はここに集め、道具ごとの違いは結果の描き方 (renderOutput) と、結果の見出しに
// 並べる操作 (actions) だけにする。Tools の画面の中だけで使う部品なので、この
// ディレクトリに置く (定義は tools-presenter が描く前に行う)。
//
// 結果の描き方は毎回 AbortController を張り替える。mermaid / shiki / yaml の lazy
// import を待っている間に次の入力が来ても、古い描画結果が後から結果の欄を
// 上書きしないようにするため (Request Lifecycle Discipline と同じ考え方を、fetch
// ではなく描画に当てたもの)。

import { live } from "lit/directives/live.js";
import { html, nothing, render } from "lit/html.js";
import { formatErrorDetail } from "../../core/error-detail";
import { defineElement } from "../ui/element";
import { emptyStateTemplate } from "../ui/empty-state";
import type { ToolsText } from "./i18n";

export const CV_SCRATCHPAD_PANE = "cv-scratchpad-pane";

const RENDER_DEBOUNCE_MS = 200;
/** 状態の文言を消すまでの時間。コピー結果のような一過性の文言に使う。 */
const STATUS_CLEAR_MS = 1800;
/** 入力側の最小幅。 */
const MIN_SIDE_WIDTH = 220;

export type StatusTone = "info" | "error";

export type ScratchpadRenderContext = {
  signal: AbortSignal;
  /** 結果の欄に出す (テンプレート・要素)。 */
  show(content: unknown): void;
  /** 見出しの固定幅の欄に文言を出す。tone="error" で警告の色。 */
  setStatus(message: string, tone?: StatusTone): void;
};

export type ScratchpadRender = (
  text: string,
  context: ScratchpadRenderContext,
) => void | Promise<void>;

/** 一定時間で消える文言。seq が変わるたびに 1 回出す。 */
export type ScratchpadFlash = {
  message: string;
  tone: StatusTone;
  seq: number;
};

export type ScratchpadPaneProps = {
  /** 道具ごとのクラス (tools-pane-markdown など)。CSS の取っ掛かり。 */
  toolClass: string;
  text: ToolsText;
  outputTitle: string;
  placeholder: string;
  /** 入力の中身。外から変わったときだけ欄に入れる (入力も描画も起こさない)。 */
  value: string;
  /** 表に出しているか。出していない間は .tools-pane に hidden を付ける。 */
  active: boolean;
  renderOutput: ScratchpadRender;
  /** 結果の見出しに並べる操作。 */
  actions?: unknown;
  /** 解消するまで出し続ける文言。描画やコピー結果で消えない。 */
  pinnedStatus: string | null;
  flash?: ScratchpadFlash | null;
  /** 変わるたびに結果を描き直す (表に出したとき・言語やテーマを変えたとき)。 */
  refreshKey: number;
  /** 変わるたびに入力の欄へフォーカスを移す。 */
  focusKey: number;
};

/** 入力が変わったときに出す。detail.value は欄の中身。 */
export type DraftInputEvent = CustomEvent<{ value: string }>;

type StatusState = { message: string; tone: StatusTone };

export type CvScratchpadPane = HTMLElement &
  ScratchpadPaneProps & {
    /** いまの入力で結果を描き直す。 */
    refresh(): void;
  };

export function defineCvScratchpadPane(): void {
  defineElement(
    CV_SCRATCHPAD_PANE,
    (Base) =>
      class extends Base {
        static props = [
          "toolClass",
          "text",
          "outputTitle",
          "placeholder",
          "value",
          "active",
          "actions",
          "pinnedStatus",
          "flash",
          "refreshKey",
          "focusKey",
          // 描き方は描き直しを起こさないが、受け取ったものは次の描画から使う。
          "renderOutput",
        ];
        declare toolClass: string;
        declare text: ToolsText;
        declare outputTitle: string;
        declare placeholder: string;
        declare value: string;
        declare active: boolean;
        declare renderOutput: ScratchpadRender;
        declare actions: unknown;
        declare pinnedStatus: string | null;
        declare flash: ScratchpadFlash | null;
        declare refreshKey: number;
        declare focusKey: number;

        /** 固定の文言に隠れている間の通常の文言。固定を外したらこれに戻す。 */
        #normalStatus: StatusState = { message: "", tone: "info" };
        /** 一過性の文言 (時間が来たら消す)。 */
        #flashing: StatusState | null = null;
        #statusTimer: ReturnType<typeof setTimeout> | null = null;
        #renderController: AbortController | null = null;
        #debounceTimer: ReturnType<typeof setTimeout> | null = null;
        #seenRefreshKey: number | undefined;
        #seenFocusKey: number | undefined;
        #seenFlashSeq: number | undefined;
        #inputWidth: number | null = null;

        #textarea(): HTMLTextAreaElement | null {
          return this.querySelector(".tools-textarea");
        }

        #output(): HTMLElement | null {
          return this.querySelector(".tools-pane-body");
        }

        #pane(): HTMLElement | null {
          return this.querySelector(".tools-pane");
        }

        /** 見出しに出す文言。固定 > 一過性 > 通常 の順。 */
        #shownStatus(): StatusState {
          if (this.pinnedStatus)
            return { message: this.pinnedStatus, tone: "error" };
          return this.#flashing ?? this.#normalStatus;
        }

        #setStatus(message: string, tone: StatusTone = "info"): void {
          this.#clearStatusTimer();
          this.#flashing = null;
          this.#normalStatus = { message, tone };
          this.requestRender();
        }

        #flashStatus(message: string, tone: StatusTone): void {
          this.#clearStatusTimer();
          // 固定の文言が出ている間は割り込まない。
          if (this.pinnedStatus) return;
          this.#flashing = { message, tone };
          this.requestRender();
          this.#statusTimer = setTimeout(() => {
            this.#statusTimer = null;
            this.#flashing = null;
            this.requestRender();
          }, STATUS_CLEAR_MS);
        }

        #clearStatusTimer(): void {
          if (!this.#statusTimer) return;
          clearTimeout(this.#statusTimer);
          this.#statusTimer = null;
        }

        refresh(): void {
          this.#renderOutputNow();
        }

        #renderOutputNow(): void {
          this.#renderController?.abort();
          const controller = new AbortController();
          this.#renderController = controller;
          const output = this.#output();
          if (!output) return;
          const value = this.#textarea()?.value ?? this.value ?? "";
          const text = this.text;
          if (!value.trim()) {
            // 入力が空: 何をするか (一行と補足) と主なキー (共通の空の案内)。
            render(
              emptyStateTemplate({
                title: text.pane.emptyTitle,
                hint: text.pane.emptyInput,
                keys: [{ keys: "⌘V", label: text.pane.emptyKeyPaste }],
                keysLabel: text.pane.emptyKeysLabel,
                compact: true,
              }),
              output,
            );
            this.#setStatus("");
            return;
          }
          const context: ScratchpadRenderContext = {
            signal: controller.signal,
            show: (content) => {
              if (controller.signal.aborted) return;
              render(content, output);
            },
            setStatus: (message, tone) => {
              if (controller.signal.aborted) return;
              this.#setStatus(message, tone);
            },
          };
          void (async () => {
            try {
              await this.renderOutput(value, context);
            } catch (err) {
              if (controller.signal.aborted) return;
              console.error("[code-viewer] tools render failed", err);
              this.#setStatus(formatErrorDetail(err), "error");
            }
          })();
        }

        #scheduleOutput(): void {
          if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
          this.#debounceTimer = setTimeout(() => {
            this.#debounceTimer = null;
            this.#renderOutputNow();
          }, RENDER_DEBOUNCE_MS);
        }

        #emitInput(value: string): void {
          // 欄の中身がいまの値。描き直しで前の値に戻さないよう、外から渡された
          // 値も描き直しを起こさずに合わせておく。
          this.propValues.value = value;
          this.dispatchEvent(
            new CustomEvent("cv-draft-input", { detail: { value } }),
          );
        }

        #onInput = (event: Event) => {
          const value = (event.target as HTMLTextAreaElement).value;
          this.#emitInput(value);
          // 走っている描画の結果はもう古い。デバウンス明けを待たずここで捨てないと、
          // lazy import を待っている描画が先に終わって結果を上書きする。
          this.#renderController?.abort();
          this.#renderController = null;
          this.#scheduleOutput();
        };

        #onClear = () => {
          const textarea = this.#textarea();
          if (!textarea?.value) return;
          textarea.value = "";
          this.#emitInput("");
          textarea.focus();
          this.#renderOutputNow();
        };

        // 幅の調整。grid の 1 列目を px 固定にして、残りを結果の側が受け取る。
        #applyInputWidth = (width: number) => {
          const pane = this.#pane();
          if (!pane) return;
          const total = pane.getBoundingClientRect().width;
          const max = Math.max(MIN_SIDE_WIDTH, total - MIN_SIDE_WIDTH);
          this.#inputWidth = Math.round(
            Math.max(MIN_SIDE_WIDTH, Math.min(max, width)),
          );
          this.renderNow();
        };

        #inputSideWidth = () =>
          this.querySelector(".tools-pane-input")?.getBoundingClientRect()
            .width ?? 0;

        protected template() {
          const text = this.text;
          if (!text) return nothing;
          // 固定の文言が出たら、一過性の文言は捨てる (固定を外したときは通常の
          // 文言に戻す)。
          if (this.pinnedStatus && this.#flashing) {
            this.#clearStatusTimer();
            this.#flashing = null;
          }
          const status = this.#shownStatus();
          return html`<div
            class=${`tools-pane ${this.toolClass}`}
            ?hidden=${!this.active}
            style=${this.#inputWidth === null ? nothing : `--tools-input-width: ${this.#inputWidth}px;`}
          >
            <section class="tools-pane-side tools-pane-input">
              <header class="tools-pane-head">
                <span class="tools-pane-title">${text.pane.input}</span>
                <cv-button
                  .cls=${"tools-pane-action"}
                  .label=${text.pane.clear}
                  .title=${text.pane.clearTitle}
                  @click=${this.#onClear}
                ></cv-button>
              </header>
              <textarea
                class="tools-textarea"
                spellcheck="false"
                placeholder=${this.placeholder}
                aria-label=${this.placeholder}
                .value=${live(this.value ?? "")}
                @input=${this.#onInput}
              ></textarea>
            </section>
            <cv-resizer
              .cls=${"tools-pane-resizer"}
              .label=${text.pane.resize}
              .direction=${1}
              .getSize=${this.#inputSideWidth}
              .applySize=${this.#applyInputWidth}
              .activeClassName=${"tools-pane-resizing"}
              .activeTarget=${() => this.#pane()}
            ></cv-resizer>
            <section class="tools-pane-side tools-pane-output">
              <header class="tools-pane-head">
                <span class="tools-pane-title">${this.outputTitle}</span>
                <div class="tools-pane-actions">${this.actions ?? nothing}</div>
                <span
                  class=${status.tone === "error" ? "tools-pane-status tools-pane-status-error" : "tools-pane-status"}
                  role="status"
                  title=${status.message}
                >${status.message}</span>
              </header>
              <div class="tools-pane-body"></div>
            </section>
          </div>`;
        }

        protected rendered(): void {
          if (this.flash && this.flash.seq !== this.#seenFlashSeq) {
            this.#seenFlashSeq = this.flash.seq;
            this.#flashStatus(this.flash.message, this.flash.tone);
          }
          if (this.refreshKey !== this.#seenRefreshKey) {
            const first = this.#seenRefreshKey === undefined;
            this.#seenRefreshKey = this.refreshKey;
            // 最初に描いたときは結果を描かない (表に出すときに描く)。
            if (!first || this.refreshKey > 0) this.#renderOutputNow();
          }
          if (this.focusKey !== this.#seenFocusKey) {
            const first = this.#seenFocusKey === undefined;
            this.#seenFocusKey = this.focusKey;
            if (!first || this.focusKey > 0) this.#textarea()?.focus();
          }
        }

        disconnectedCallback(): void {
          super.disconnectedCallback();
          this.#renderController?.abort();
          this.#renderController = null;
          if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
          this.#debounceTimer = null;
          this.#clearStatusTimer();
        }
      },
  );
}
