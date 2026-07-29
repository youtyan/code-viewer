// Markdown プレビュー内のリポジトリ相対リンクを SPA 遷移に落とす配線。
// repo-view (README プレビュー) と source-view (ファイルプレビュー) が同じ
// 分岐を必要とするため、両方から呼べる形でここに置いてある。
//
// GitHub の markdown と同じ行き先を再現する:
//   ./guide.md            -> blob ビュー
//   ./guide.md#section    -> blob ビュー + 見出しへスクロール
//   ./assets/data.json    -> blob ビュー
//   ./sub/                -> リポジトリ一覧 (tree ビュー相当)
//   ../                   -> 親ディレクトリの一覧

import type { MarkdownNavigationTarget } from "../core/markdown-preview";
import {
  type AppRoute,
  buildRawFileUrl,
  type DiffRange,
  type SourceFileTarget,
} from "../core/routes";
import { sourcePreviewKind } from "../core/source-meta";

export type MarkdownLinkNavigationDeps = {
  setRoute(route: AppRoute, replace?: boolean): void;
  currentRange(): DiffRange;
  loadRepo(): Promise<void>;
  repoRoute(ref: string, path: string): AppRoute;
  renderStandaloneSource(target: SourceFileTarget): Promise<unknown>;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  isAbortError(err: unknown): boolean;
};

export async function openMarkdownLink(
  target: MarkdownNavigationTarget,
  deps: MarkdownLinkNavigationDeps,
): Promise<void> {
  const ref = target.ref || "worktree";
  // 種別判定はサーバーへの問い合わせを挟むことがある。その間にユーザーが
  // 別の場所へ移動していたら、遅れて届いた判定で今の画面を上書きしない。
  const routeAtClick = currentRouteKey();
  const directory = await isMarkdownDirectoryLink(target, deps);
  if (directory === null || currentRouteKey() !== routeAtClick) return;
  if (directory) {
    deps.setRoute(deps.repoRoute(ref, target.path));
    await deps.loadRepo();
    return;
  }
  const anchorInMarkdown =
    !!target.hash && sourcePreviewKind(target.path) === "markdown";
  deps.setRoute({
    screen: "file",
    path: target.path,
    ref,
    view: "blob",
    // アンカーはレンダリング後の見出しを指すので、Code タブのままでは飛べない。
    // GitHub と同じくプレビュー側を開いてからスクロールさせる。
    ...(anchorInMarkdown ? { preview: true as const } : {}),
    range: deps.currentRange(),
  });
  applyMarkdownLinkHash(target.hash);
  await deps.renderStandaloneSource({ path: target.path, ref });
}

/** SPA のルートを表す文字列。setRoute / popstate / サイドバー操作の
 * いずれでも URL は必ず変わるので、これが遷移の有無の判定に使える。 */
function currentRouteKey(): string {
  return window.location.pathname + window.location.search;
}

/** リンク先がディレクトリか。末尾スラッシュ・拡張子で決められない
 * `../docs` のようなリンクだけサーバーに確認する。
 * null は「判定を中断したので遷移しない」。 */
async function isMarkdownDirectoryLink(
  target: MarkdownNavigationTarget,
  deps: MarkdownLinkNavigationDeps,
): Promise<boolean | null> {
  if (target.directory) return true;
  // 空文字はリポジトリルート。
  if (!target.path) return true;
  const name = target.path.split("/").pop() || "";
  if (/.\.[^.]+$/.test(name)) return false;
  try {
    // /_file はディレクトリにも存在しないパスにも 404 を返す (rawFileSize が
    // 通常ファイル以外を弾く)。拡張子の無いパスはディレクトリのほうが
    // 圧倒的に多いので、404 のときだけディレクトリ扱いにする。500/403 は
    // ディレクトリの証拠にならないので blob ビューでエラーを見せる。
    const res = await deps.trackLoad(
      fetch(buildRawFileUrl({ path: target.path, ref: target.ref }), {
        method: "HEAD",
      }),
    );
    return res.status === 404;
  } catch (err) {
    // ユーザー操作でキャンセルされた fetch を「ファイル」と読み替えて遷移
    // させない (キャンセルボタンは URL を変えないのでルート比較では拾えない)。
    if (deps.isAbortError(err)) return null;
    // ネットワーク断はファイル扱いに倒す。blob ビューなら読み込み失敗が
    // そのまま画面に出るが、tree ビューだと空の一覧に見えてしまう。
    return false;
  }
}

/** setRoute は hash を落とすので、遷移直後に載せ直す。プレビュー側の
 * scrollInitialMarkdownHash が location.hash を読んで見出しまで飛ばす。 */
function applyMarkdownLinkHash(hash: string): void {
  if (!hash) return;
  const base = window.location.pathname + window.location.search;
  history.replaceState(
    history.state,
    "",
    `${base}#${encodeURIComponent(hash)}`,
  );
}
