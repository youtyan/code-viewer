// シェルが終わったターミナルのタブを閉じるための部品。
//
// タブの中身のシェルが終わる道は 2 つある。前面のタブは購読している流れに
// 「終わった」が届く (terminal-screen.ts の exited)。前面でないタブは購読して
// いないので届かない。そちらは、全画面共通の取り直し (/_agent/overview。
// 数秒ごと) に載る生きているシェルの一覧から、前回あって今回無いものを拾う。
//
// 閉じたことは、最下段に短い知らせで伝える (黙ってタブが消えると、何が
// 起きたか分からない)。知らせの形は最下段の操作の塊の既存の吹き出し
// (`.goi-feedback`。AI 向けのコピーの結果と同じ)。

/** 知らせを出しておく時間。 */
export const SHELL_END_NOTICE_MS = 5000;

/**
 * 生きているシェルの一覧を受け取るたびに、前回あって今回無いシェルのうち、
 * タブで開いているものを返す。一度も一覧で見ていないシェルは返さない
 * (開いた直後のシェルは、次の一覧に載る前に取り直しが返ることがある)。
 */
export function createShellEndTracker(): {
  update(live: readonly string[], tabbed: readonly string[]): string[];
} {
  let seen = new Set<string>();
  return {
    update(live, tabbed) {
      const now = new Set(live);
      const ended = tabbed.filter((id) => seen.has(id) && !now.has(id));
      seen = now;
      return ended;
    },
  };
}

/** 最下段の操作の塊に、短い知らせの吹き出しを 1 つ置く。 */
export function createShellEndNotice(host: HTMLElement): {
  show(message: string): void;
  dispose(): void;
} {
  const el = document.createElement("span");
  el.className = "goi-feedback shell-end-notice";
  el.role = "status";
  el.hidden = true;
  host.append(el);
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    show(message) {
      el.textContent = message;
      el.hidden = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        el.hidden = true;
      }, SHELL_END_NOTICE_MS);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      el.remove();
    },
  };
}
