// 「プロジェクトを追加」のダイアログ。サーバのディレクトリの一覧
// (GET /_agent/projects/directories) をたどって、今の場所を登録する。
//
// ブラウザの標準のフォルダ選択は絶対パスを返さないので使わない。型は
// ui-dialog.ts の showFormDialog のまま (本文に、パスの入力欄・子の
// ディレクトリの一覧・隠しの切替を置く)。登録は呼び出し側の register
// (既存の POST /_agent/projects) で、その失敗は showFormDialog がダイアログの
// 中に全文で出す。一覧の失敗は本文の中の行に全文で出す。
//
// 押すたびに一覧を取り直すので、遅れて返った古い一覧は世代で捨てる。

import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import { formatErrorDetail } from "../../core/error-detail";
import { FOLDER_ICON_PATHS } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import type { ProjectDirectoryListing } from "../../core/projects";
import { iconTemplate } from "../ui/icon";
import { detachedElement } from "../ui/renderer";
import { showFormDialog } from "../ui-dialog";
import type { ProjectsText } from "./projects-i18n";

export type ProjectDirectoryDialogDeps = {
  text: ProjectsText;
  /** 最初に開く場所 (絶対パスか `~`)。 */
  start: string;
  list(path: string, hidden: boolean): Promise<ProjectDirectoryListing>;
  /** 今の場所を登録する。失敗は投げる (ダイアログの中に出す)。 */
  register(path: string): Promise<void>;
};

function childPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

export type ProjectDirectoryRow = {
  label: string;
  /** 一つ上・確かめられなかったフォルダの印の class。 */
  className: string;
  title: string;
  git: boolean;
  onOpen: () => void;
};

export type ProjectDirectoryProps = {
  text: ProjectsText;
  rows: ProjectDirectoryRow[];
  status: string;
  failure: string;
  refs: {
    input: Ref<HTMLInputElement>;
    hidden: Ref<HTMLInputElement>;
    list: Ref<HTMLElement>;
  };
  onInputKeydown: (event: KeyboardEvent) => void;
  onHiddenChange: () => void;
};

export type ProjectDirectoryView = (props: ProjectDirectoryProps) => unknown;

export const DEFAULT_VIEW: ProjectDirectoryView = (p) => {
  const t = p.text;
  return html`<div class="project-directory"><input
      class="gdp-dialog-input project-directory-path"
      type="text"
      autocomplete="off"
      spellcheck="false"
      aria-label=${t.addProjectPathLabel}
      title=${t.addProjectPathHint}
      ${ref(p.refs.input)}
      @keydown=${p.onInputKeydown}
    /><label class="project-directory-hidden"><input
        type="checkbox"
        ${ref(p.refs.hidden)}
        @change=${p.onHiddenChange}
      />${t.addProjectShowHidden}</label
    ><div class="gdp-dialog-error project-directory-error" role="alert"
      >${p.failure}</div
    ><div
      class="project-directory-list"
      role="list"
      aria-label=${t.addProjectListLabel}
      ${ref(p.refs.list)}
    >${p.rows.map(
      (row) =>
        html`<button
          type="button"
          class=${row.className ? `project-directory-row ${row.className}` : "project-directory-row "}
          role="listitem"
          title=${row.title}
          @click=${row.onOpen}
        >${iconTemplate(FOLDER_ICON_PATHS.closed, "project-directory-icon")}<span
            class="project-directory-name"
            >${row.label}</span
          >${
            row.git
              ? html`<span class="project-directory-git" title=${t.addProjectGitMark}
                  >git</span
                >`
              : nothing
          }</button>`,
    )}</div
    ><div class="project-directory-status">${p.status}</div></div>`;
};

/** 登録したパスを返す。取り消したら null。 */
export function showProjectDirectoryDialog(
  deps: ProjectDirectoryDialogDeps,
  view: ProjectDirectoryView = DEFAULT_VIEW,
): Promise<string | null> {
  const t = deps.text;
  const refs: ProjectDirectoryProps["refs"] = {
    input: createRef(),
    hidden: createRef(),
    list: createRef(),
  };
  const field = <T extends Element>(target: Ref<T>, name: string): T => {
    if (!target.value)
      throw new Error(`project directory dialog: the ${name} was not drawn`);
    return target.value;
  };

  let current: ProjectDirectoryListing | null = null;
  let generation = 0;
  let rows: ProjectDirectoryRow[] = [];
  let status = "";
  let failure = "";

  const box = detachedElement(() =>
    view({
      text: t,
      rows,
      status,
      failure,
      refs,
      onInputKeydown: (event) => {
        if (event.key !== "Enter" || isImeComposing(event)) return;
        // ダイアログの Enter (= 登録) に渡さず、打った場所へ移る。
        event.preventDefault();
        event.stopPropagation();
        const value = input().value.trim();
        if (value) void go(value);
      },
      onHiddenChange: () => {
        void go(current?.path ?? (input().value.trim() || deps.start));
      },
    }),
  );
  const input = () => field(refs.input, "path field");
  const hidden = () => field(refs.hidden, "hidden-folder switch");

  function showListing(listing: ProjectDirectoryListing): void {
    const list = field(refs.list, "list");
    const hadFocus = list.contains(document.activeElement);
    const next: ProjectDirectoryRow[] = [];
    if (listing.parent !== null) {
      const parent = listing.parent;
      next.push({
        label: "..",
        className: "project-directory-up",
        title: t.addProjectUp(parent),
        git: false,
        onOpen: () => void go(parent),
      });
    }
    for (const entry of listing.entries) {
      const path = childPath(listing.path, entry.name);
      next.push({
        label: entry.name,
        className: entry.issue ? "project-directory-unchecked" : "",
        title: entry.issue ? `${path}\n${entry.issue}` : path,
        git: entry.git,
        onOpen: () => void go(path),
      });
    }
    rows = next;
    status =
      listing.entries.length === 0
        ? t.addProjectEmpty
        : listing.truncated
          ? t.addProjectTruncated(listing.entries.length, listing.total)
          : "";
    box.draw();
    if (hadFocus) list.querySelector<HTMLElement>("button")?.focus();
  }

  async function go(path: string): Promise<void> {
    const mine = ++generation;
    failure = "";
    status = t.addProjectLoading;
    box.draw();
    let listing: ProjectDirectoryListing;
    try {
      listing = await deps.list(path, hidden().checked);
    } catch (error) {
      if (mine !== generation) return;
      console.error("[code-viewer] directory listing failed", error);
      // 失敗した場所は登録させない (入力欄は打ったまま残して直せるように)。
      current = null;
      rows = [];
      status = "";
      failure = formatErrorDetail(error);
      box.draw();
      return;
    }
    if (mine !== generation) return;
    current = listing;
    input().value = listing.path;
    showListing(listing);
  }

  input().value = deps.start;
  void go(deps.start);
  return showFormDialog({
    title: t.addProjectTitle,
    description: t.addProjectDescription,
    body: box.element,
    wide: true,
    focusTarget: input(),
    submitLabel: t.addProjectSubmit,
    cancelLabel: t.cancel,
    validate: () => (input().value.trim() ? null : t.addProjectNoPlace),
    submit: async () => {
      // 入力欄を打ち変えて Enter を押さずに登録したら、打った場所を登録する
      // (その場所を一覧で確かめ、正規化したパスを送る。無ければその理由が出る)。
      const typed = input().value.trim();
      const place =
        current && current.path === typed
          ? current
          : await deps.list(typed, hidden().checked);
      await deps.register(place.path);
      return place.path;
    },
  });
}
