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

import { formatErrorDetail } from "../../core/error-detail";
import { FOLDER_ICON_PATHS, iconSvg } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import type { ProjectDirectoryListing } from "../../core/projects";
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

/** 登録したパスを返す。取り消したら null。 */
export function showProjectDirectoryDialog(
  deps: ProjectDirectoryDialogDeps,
): Promise<string | null> {
  const t = deps.text;
  const body = document.createElement("div");
  body.className = "project-directory";

  const input = document.createElement("input");
  input.className = "gdp-dialog-input project-directory-path";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", t.addProjectPathLabel);
  input.title = t.addProjectPathHint;

  const hiddenLabel = document.createElement("label");
  hiddenLabel.className = "project-directory-hidden";
  const hidden = document.createElement("input");
  hidden.type = "checkbox";
  hiddenLabel.append(hidden, t.addProjectShowHidden);

  const status = document.createElement("div");
  status.className = "project-directory-status";
  const failure = document.createElement("div");
  failure.className = "gdp-dialog-error project-directory-error";
  failure.setAttribute("role", "alert");

  const list = document.createElement("div");
  list.className = "project-directory-list";
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", t.addProjectListLabel);

  body.append(input, hiddenLabel, failure, list, status);

  let current: ProjectDirectoryListing | null = null;
  let generation = 0;

  function row(
    label: string,
    className: string,
    title: string,
    run: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-directory-row ${className}`;
    button.setAttribute("role", "listitem");
    button.title = title;
    const name = document.createElement("span");
    name.className = "project-directory-name";
    name.textContent = label;
    button.innerHTML = iconSvg(
      "project-directory-icon",
      FOLDER_ICON_PATHS.closed,
    );
    button.appendChild(name);
    button.addEventListener("click", run);
    return button;
  }

  function render(listing: ProjectDirectoryListing): void {
    const hadFocus = list.contains(document.activeElement);
    const rows: HTMLElement[] = [];
    if (listing.parent !== null) {
      const parent = listing.parent;
      rows.push(
        row("..", "project-directory-up", t.addProjectUp(parent), () =>
          go(parent),
        ),
      );
    }
    for (const entry of listing.entries) {
      const path = childPath(listing.path, entry.name);
      const button = row(
        entry.name,
        entry.issue ? "project-directory-unchecked" : "",
        entry.issue ? `${path}\n${entry.issue}` : path,
        () => go(path),
      );
      if (entry.git) {
        const mark = document.createElement("span");
        mark.className = "project-directory-git";
        mark.textContent = "git";
        mark.title = t.addProjectGitMark;
        button.appendChild(mark);
      }
      rows.push(button);
    }
    list.replaceChildren(...rows);
    status.textContent =
      listing.entries.length === 0
        ? t.addProjectEmpty
        : listing.truncated
          ? t.addProjectTruncated(listing.entries.length, listing.total)
          : "";
    if (hadFocus) rows[0]?.focus();
  }

  async function go(path: string): Promise<void> {
    const mine = ++generation;
    failure.textContent = "";
    status.textContent = t.addProjectLoading;
    let listing: ProjectDirectoryListing;
    try {
      listing = await deps.list(path, hidden.checked);
    } catch (error) {
      if (mine !== generation) return;
      console.error("[code-viewer] directory listing failed", error);
      // 失敗した場所は登録させない (入力欄は打ったまま残して直せるように)。
      current = null;
      list.replaceChildren();
      status.textContent = "";
      failure.textContent = formatErrorDetail(error);
      return;
    }
    if (mine !== generation) return;
    current = listing;
    input.value = listing.path;
    render(listing);
  }

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || isImeComposing(event)) return;
    // ダイアログの Enter (= 登録) に渡さず、打った場所へ移る。
    event.preventDefault();
    event.stopPropagation();
    const value = input.value.trim();
    if (value) void go(value);
  });
  hidden.addEventListener("change", () => {
    void go(current?.path ?? (input.value.trim() || deps.start));
  });

  input.value = deps.start;
  void go(deps.start);
  return showFormDialog({
    title: t.addProjectTitle,
    description: t.addProjectDescription,
    body,
    wide: true,
    focusTarget: input,
    submitLabel: t.addProjectSubmit,
    cancelLabel: t.cancel,
    validate: () => (input.value.trim() ? null : t.addProjectNoPlace),
    submit: async () => {
      // 入力欄を打ち変えて Enter を押さずに登録したら、打った場所を登録する
      // (その場所を一覧で確かめ、正規化したパスを送る。無ければその理由が出る)。
      const typed = input.value.trim();
      const place =
        current && current.path === typed
          ? current
          : await deps.list(typed, hidden.checked);
      await deps.register(place.path);
      return place.path;
    },
  });
}
