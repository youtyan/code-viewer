// git のリポジトリでないプロジェクト (git の外のフォルダを登録したもの) で、git が
// 要る画面 (core/git-features.ts の routeNeedsGit) を開いたときの案内。
//
// - 本文 (#content) の中の箱に空の案内を描き、出している間は body に
//   data-git-unavailable を付ける (style.css が本文のほかの中身を隠す)。各画面の
//   取得は始めない (app.ts が画面に入らない)。URL はそのままなので、git init の
//   後に設定を取り直すと、同じ URL のまま画面が出る
// - 押せない入口 (画面の入口の列・タブの ＋・グループの ▾・パレット・キー) の
//   理由の文言もここに置く (どの入口も同じ文言にする)

import { html, nothing } from "lit/html.js";
import { gitFeaturesUnavailable, pageNeedsGit } from "../core/git-features";
import { GIT_BRANCH_16_PATH } from "../core/icons";
import type { GitRepositoryState } from "../core/types";
import { pageLanguage } from "./page-language";
import { emptyStateTemplate } from "./ui/empty-state";
import { createRenderer } from "./ui/renderer";

export type GitUnavailableText = {
  /** 押せない入口の title・パレットの行の補足。 */
  reason: string;
  /** 空の案内の見出し。 */
  title: string;
  /** 空の案内の補足 (どうすれば使えるか)。 */
  hint: string;
  /** 空の案内のボタン (フォルダ表示へ)。 */
  openFiles: string;
};

export const GIT_UNAVAILABLE_TEXT: Record<"en" | "ja", GitUnavailableText> = {
  en: {
    reason: "Unavailable: this project is not a git repository",
    title: "This project is not a git repository",
    hint: "Diffs, history, worktrees, blame and refs need git. Run git init in this folder to use them; they become available without a restart.",
    openFiles: "Open Files",
  },
  ja: {
    reason: "git のリポジトリではないので使えません",
    title: "このプロジェクトは git のリポジトリではありません",
    hint: "差分・履歴・作業ツリー・blame・ref は git が要ります。このフォルダで git init すると、再起動せずに使えるようになります。",
    openFiles: "ファイルを開く",
  },
};

/**
 * いま見ているプロジェクトが git のリポジトリか (app.ts が設定 /_settings の
 * git_repository を読むたびに入れる)。画面の言語 (pageLanguage) と同じく、
 * ファイルのタブ・ref の選択のような小さな部品が引数を通さずに読む。
 */
let repositoryState: GitRepositoryState = "unknown";

export function setGitRepositoryState(state: GitRepositoryState): void {
  repositoryState = state;
}

export function gitRepositoryState(): GitRepositoryState {
  return repositoryState;
}

/** git の機能を押せない理由 (押せるなら null)。 */
export function gitUnavailableReason(): string | null {
  return gitFeaturesUnavailable(repositoryState)
    ? GIT_UNAVAILABLE_TEXT[pageLanguage()].reason
    : null;
}

/**
 * 画面の入口の列 (index.html の .view-strip-item) の git が要る入口を押せない印に
 * する (消さない)。名前とキーは aria-label に残し、title だけを理由に替える。
 * 押しても移らないのは app.ts のリンクの click (aria-disabled を見る)。
 */
export function markGitEntryPoints(
  links: Iterable<HTMLElement>,
  reason: string | null,
): void {
  for (const link of links) {
    const blocked = reason !== null && pageNeedsGit(link.dataset.route ?? "");
    if (blocked) link.setAttribute("aria-disabled", "true");
    else link.removeAttribute("aria-disabled");
    link.title = blocked ? reason : (link.getAttribute("aria-label") ?? "");
  }
}

export type GitUnavailableProps = {
  shown: boolean;
  title: string;
  hint: string;
  openFilesLabel: string;
  onOpenFiles(): void;
};

export type GitUnavailableView = (props: GitUnavailableProps) => unknown;

export const DEFAULT_VIEW: GitUnavailableView = (props) =>
  props.shown
    ? html`<div class="git-unavailable" role="status">${emptyStateTemplate({
        icon: GIT_BRANCH_16_PATH,
        title: props.title,
        hint: props.hint,
        actions: [
          {
            label: props.openFilesLabel,
            primary: true,
            run: props.onOpenFiles,
          },
        ],
      })}</div>`
    : nothing;

export type GitUnavailableDeps = {
  /** 案内を描く箱 (index.html の #git-unavailable。本文 #content の中)。 */
  host: HTMLElement;
  text(): GitUnavailableText;
  /** フォルダ表示 (本文の既定) へ移る。 */
  openFiles(): void;
};

export function createGitUnavailable(
  deps: GitUnavailableDeps,
  view: GitUnavailableView = DEFAULT_VIEW,
) {
  let shown = false;
  const renderer = createRenderer(deps.host, () => {
    const text = deps.text();
    return view({
      shown,
      title: text.title,
      hint: text.hint,
      openFilesLabel: text.openFiles,
      onOpenFiles: () => deps.openFiles(),
    });
  });

  function set(next: boolean): void {
    shown = next;
    document.body.toggleAttribute("data-git-unavailable", next);
    renderer.request();
  }

  return {
    show: () => set(true),
    hide: () => {
      if (shown) set(false);
    },
    shown: () => shown,
    /** 言語が変わった。 */
    localize: () => renderer.request(),
  };
}

export type GitUnavailable = ReturnType<typeof createGitUnavailable>;
