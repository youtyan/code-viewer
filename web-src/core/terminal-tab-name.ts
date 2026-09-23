// ターミナルのタブの名前。別のプロジェクトのペインを映すタブは、題だけだと
// 同じ題 (「claude · 作業の題」) が並んで見分けが付かないので、プロジェクト名を
// 前に付ける。今のプロジェクトのペインと、エージェントを映していないシェルは
// 題だけ。DOM に触らない (配線は views/main-tabs/main-tabs-view.ts の renderTab)。

export type TerminalTabProject = {
  /** プロジェクトの名前 (一覧に出る名前)。 */
  name: string;
  /** 今開いているプロジェクト。 */
  current: boolean;
};

export type TerminalTabName = {
  /** 名前の前に付けるプロジェクト名。付けないなら null。 */
  project: string | null;
  /** 題 (エージェントなら「種類 · 作業の題か状態」、シェルなら「Shell 2」など)。 */
  title: string;
  /** 全体 (title 属性と閉じるボタンの説明に使う)。 */
  full: string;
};

/** プロジェクト名と題の間。 */
export const TAB_PROJECT_SEPARATOR = " · ";

export function terminalTabName(
  title: string,
  project: TerminalTabProject | null,
): TerminalTabName {
  if (!project || project.current || project.name === "")
    return { project: null, title, full: title };
  return {
    project: project.name,
    title,
    full: `${project.name}${TAB_PROJECT_SEPARATOR}${title}`,
  };
}

/**
 * パス (シェルを起こしたフォルダ) を含むプロジェクトの根。いちばん深いものを
 * 選ぶ (入れ子のリポジトリで外側に寄せない)。どれにも入らなければ null。
 * シェルのタブのグループ (views/main-tabs) に使う。
 */
export function projectRootOfPath(
  path: string,
  roots: readonly string[],
): string | null {
  let best: string | null = null;
  for (const root of roots) {
    const inside =
      path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
    if (inside && (best === null || root.length > best.length)) best = root;
  }
  return best;
}
