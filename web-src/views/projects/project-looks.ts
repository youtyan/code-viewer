// プロジェクトの色と頭文字を、画面のどこからでも取る口。
//
// 左のサイドバーの見出し・全体ボード・切替の小窓・インストールした窓の上端の帯
// (theme-color) と、タブのグループ・ファイル一覧の頭が同じものを使う。
//
//   PROJECT_LOOKS.get(root)     そのプロジェクトの色と頭文字 (知らなければ null)
//   PROJECT_LOOKS.current()     いま見ているプロジェクト
//   PROJECT_LOOKS.order()       一覧の並び (根。左の一覧と同じ順 = compareProjectsByRegistry。
//                               タブのグループの並び。一覧から消えた根も前の位置に残す)
//   PROJECT_LOOKS.subscribe(fn) 色・名前・いま見ているものが変わったら呼ぶ
//   projectMark(look)           色の四角と頭文字の要素 (.project-mark)
//   paintProjectColor(el, c)    要素に色を付ける。子孫の CSS は var(--project-color)
//                               で読む (頭文字の色は var(--project-ink))
//   projectColorValue(c)        CSS 変数を読めない先 (meta の theme-color) へ渡す値
//
// 元は agent-monitor の取り直しの結果 (登録簿の色・一覧の名前)。app.ts が
// 取り直すたびに update へ渡す。色の値そのものは web/style.css の名前の層にある
// (core/project-colors.ts の先頭)。

import {
  type AgentOverviewResponse,
  type AgentProjectInfo,
  compareProjectsByRegistry,
} from "../../core/agent-overview";
import { type ProjectColor, projectInitials } from "../../core/project-colors";

export type ProjectLook = {
  root: string;
  name: string;
  /** 頭文字 2 文字 (色だけに頼らないよう、いつも色と一緒に出す)。 */
  initials: string;
  /** 登録していないプロジェクトは null (色なしの灰色で出す)。 */
  color: ProjectColor | null;
};

export function projectLook(
  info: Pick<AgentProjectInfo, "root" | "name" | "registered">,
): ProjectLook {
  return {
    root: info.root,
    name: info.name,
    initials: projectInitials(info.name),
    color: info.registered?.color ?? null,
  };
}

/** 要素に色を付ける。色が無い (登録していない) ものは灰色。 */
export function paintProjectColor(
  element: HTMLElement,
  color: ProjectColor | null,
): void {
  element.dataset.projectColor = color ?? "none";
}

/** 色の四角と頭文字。名前は隣に書くので、読み上げには出さない。 */
export function projectMark(look: ProjectLook, className = ""): HTMLElement {
  const mark = document.createElement("span");
  mark.className = className ? `project-mark ${className}` : "project-mark";
  paintProjectColor(mark, look.color);
  mark.textContent = look.initials;
  mark.setAttribute("aria-hidden", "true");
  return mark;
}

/** 今のテーマでの色の値 (#rrggbb)。 */
export function projectColorValue(
  color: ProjectColor | null,
  root: HTMLElement = document.documentElement,
): string {
  const name = `--project-${color ?? "none"}`;
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  if (!value) {
    throw new Error(
      `project colors: ${name} is empty on <html data-theme="${root.dataset.theme ?? ""}">`,
    );
  }
  return value;
}

export type ProjectLooks = {
  update(overview: AgentOverviewResponse | null): void;
  get(root: string): ProjectLook | null;
  current(): ProjectLook | null;
  order(): readonly string[];
  subscribe(listener: () => void): () => void;
};

/**
 * 一覧から消えた根を、前の並びのすぐ左にあったもの (今も並びにあるもの) の
 * 右へ残す。消えたプロジェクトのタブのグループが、一覧に無いもの全部と同じ
 * 位置 (末尾) へ飛ばないように。
 */
function keepGone(previous: readonly string[], present: string[]): string[] {
  const out = [...present];
  previous.forEach((root, at) => {
    if (out.includes(root)) return;
    let place = 0;
    for (let left = at - 1; left >= 0; left -= 1) {
      const found = out.indexOf(previous[left]);
      if (found >= 0) {
        place = found + 1;
        break;
      }
    }
    out.splice(place, 0, root);
  });
  return out;
}

export function createProjectLooks(): ProjectLooks {
  let looks = new Map<string, ProjectLook>();
  let current: string | null = null;
  let order: string[] = [];
  let signature = "";
  const listeners = new Set<() => void>();
  return {
    update(overview) {
      if (!overview) return;
      // tmux の一覧が取れなかった応答はプロジェクトが空で届く。前の並びと色を
      // 保つ (空にすると、グループの札の色と頭文字が一瞬消え、並びも崩れた)。
      if (overview.tmux.error) return;
      const sorted = [...overview.projects].sort(compareProjectsByRegistry);
      const next = new Map(
        sorted.map((info) => [info.root, projectLook(info)]),
      );
      const here =
        overview.projects.find((info) => info.server.status === "current")
          ?.root ?? null;
      const nextOrder = keepGone(
        order,
        sorted.map((info) => info.root),
      );
      const nextSignature = JSON.stringify([
        here,
        [...next.values()],
        nextOrder,
      ]);
      if (nextSignature === signature) return;
      signature = nextSignature;
      looks = next;
      current = here;
      order = nextOrder;
      for (const listener of listeners) listener();
    },
    get: (root) => looks.get(root) ?? null,
    current: () => (current === null ? null : (looks.get(current) ?? null)),
    order: () => order,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const PROJECT_LOOKS: ProjectLooks = createProjectLooks();
