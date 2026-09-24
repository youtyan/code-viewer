import type { PaneSide } from "../core/main-tabs";
import type { MainTabsHandle } from "./main-tabs/main-tabs-view";

type Tabs = Pick<
  MainTabsHandle,
  "front" | "panes" | "closeTab" | "hasTerminal" | "openTerminal"
>;

export type ImageTabReturn = {
  /** 画像のタブを開く run を包み、開く前に前面だったシェルを覚える。 */
  open(run: () => void): void;
  /** その面の前面の画像のタブを閉じ、覚えたシェルがあればそこへ戻す。 */
  close(side: PaneSide): void;
};

/**
 * 端末 (棚・画面のリンク) から開いた画像のタブを閉じたら、開いたシェルへ戻す。
 * 1 面では閉じると同じ面の直前のタブ (開いたシェル) が前面に戻るが、2 面では
 * 画像は反対の面に開くので、閉じてもフォーカスが画像の面に残る。
 */
export function createImageTabReturn(tabs: Tabs): ImageTabReturn {
  let opener: { tab: string; session: string } | null = null;
  return {
    open(run) {
      const from = tabs.front();
      run();
      const opened = tabs.front();
      opener =
        from?.target.kind === "terminal" && opened?.target.kind === "image"
          ? { tab: opened.id, session: from.target.session }
          : null;
    },
    close(side) {
      const tab = tabs.panes().fronts[side];
      if (tab?.target.kind !== "image")
        throw new Error(
          `image tab close: the ${side} pane front is ${tab ? `a ${tab.target.kind} tab` : "empty"}, not an image tab`,
        );
      const session = opener?.tab === tab.id ? opener.session : null;
      if (session) opener = null;
      tabs.closeTab(tab.id);
      if (!session || !tabs.hasTerminal(session)) return;
      const front = tabs.front();
      if (front?.target.kind === "terminal" && front.target.session === session)
        return;
      tabs.openTerminal(session);
    },
  };
}
