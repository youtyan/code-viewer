// xterm.js を lazy import する共通ローダ。terminal ドロワーからだけ呼ばれる。
// mermaid / shiki / yaml と同じく別バンドル (web/xterm.js) にしてあるので、
// ドロワーを開くまでターミナルエミュレータのコードは落ちてこない。
// 失敗時は null (呼び出し側で fallback)。
//
// 型は @xterm/xterm の d.ts をそのまま使わず、ここで使う分だけを写している
// (mermaid-loader / shiki-loader と同じ扱い)。ローダの利用側が xterm の型に
// 直接依存しないので、バンドル境界がそのまま型の境界になる。

import { createBundleLoader } from "./lazy-bundle";

export type XtermDisposable = {
  dispose(): void;
};

/** 実際に指定しているオプションだけ。xterm 側にはこの何倍もある。 */
export type XtermOptions = {
  cols?: number;
  rows?: number;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  scrollback?: number;
  cursorBlink?: boolean;
  /** 画面に出さない書き込み専用にするとき (読み取り専用ペイン)。 */
  disableStdin?: boolean;
  /** capture-pane の出力は行末に改行しか持たないので CR を補う。 */
  convertEol?: boolean;
  theme?: XtermTheme;
};

/** xterm の ITheme のうち、こちらで指定する色だけ。 */
export type XtermTheme = {
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
};

export type XtermTerminal = {
  readonly cols: number;
  readonly rows: number;
  readonly element: HTMLElement | undefined;
  readonly textarea: HTMLTextAreaElement | undefined;
  options: XtermOptions;
  open(parent: HTMLElement): void;
  write(data: string | Uint8Array, callback?: () => void): void;
  resize(columns: number, rows: number): void;
  focus(): void;
  blur(): void;
  clear(): void;
  reset(): void;
  dispose(): void;
  loadAddon(addon: XtermAddon): void;
  onData(handler: (data: string) => void): XtermDisposable;
  onResize(
    handler: (size: { cols: number; rows: number }) => void,
  ): XtermDisposable;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
};

export type XtermAddon = {
  activate(terminal: XtermTerminal): void;
  dispose(): void;
};

export type XtermFitAddon = XtermAddon & {
  fit(): void;
  proposeDimensions(): { cols: number; rows: number } | undefined;
};

export type XtermApi = {
  Terminal: new (options?: XtermOptions) => XtermTerminal;
  FitAddon: new () => XtermFitAddon;
};

export const loadXterm = createBundleLoader<XtermApi>("xterm.js");
