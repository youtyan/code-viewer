// 窓 (このアプリの窓のどれかの文書) にフォーカスがあるか。無い間は
// html[data-window-inactive] を付け、選んでいる行を中立の色にする
// (style.css の --color-select-inactive)。窓にフォーカスがある間の選択は強調色の面。
//
// 窓は外側のページ (host) と面 (iframe の pane) でできている。フォーカスが面へ移ると
// host の window は blur するので、窓全体のフォーカスは host の文書の hasFocus()
// (子の面にフォーカスがあっても true) で読む。窓の外へ移ったときは、フォーカスを
// 持っていた文書にしか blur が来ないので、同じ起点の文書へ知らせて全部が読み直す。

import { workspaceRole } from "./workspace";

const CHANNEL = "code-viewer-window-active";

function windowDocument(): Document {
  return workspaceRole() === "pane" && window.parent
    ? window.parent.document
    : document;
}

export function installWindowActive(): void {
  const channel = new BroadcastChannel(CHANNEL);
  const sync = () =>
    document.documentElement.toggleAttribute(
      "data-window-inactive",
      !windowDocument().hasFocus(),
    );
  // focus / blur の直後は、移った先の文書の hasFocus() がまだ true にならない。
  const changed = () =>
    setTimeout(() => {
      sync();
      channel.postMessage(null);
    }, 0);
  window.addEventListener("focus", changed);
  window.addEventListener("blur", changed);
  channel.addEventListener("message", sync);
  sync();
}
