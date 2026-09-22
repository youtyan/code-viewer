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
