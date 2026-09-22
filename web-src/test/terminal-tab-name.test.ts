import { describe, expect, test } from "vitest";
import { BRANCH_SHARE } from "../core/brand-fit";
import { terminalTabName } from "../core/terminal-tab-name";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

// ターミナルのタブの名前 (core/terminal-tab-name.ts)。別のプロジェクトの
// ペインだけ「プロジェクト名 · 題」。題はエージェントの「種類 · 作業の題」か、
// 作業の題が無ければ「種類 · 状態」。
describe("terminalTabName", () => {
  const withTask = "claude · sample agent task";
  const withoutTask = "claude · Waiting";
  test.each([
    {
      name: "今のプロジェクト・題あり",
      title: withTask,
      project: { name: "repo-a", current: true },
      expected: { project: null, title: withTask, full: withTask },
    },
    {
      name: "今のプロジェクト・題なし",
      title: withoutTask,
      project: { name: "repo-a", current: true },
      expected: { project: null, title: withoutTask, full: withoutTask },
    },
    {
      name: "別のプロジェクト・題あり",
      title: withTask,
      project: { name: "repo-b", current: false },
      expected: {
        project: "repo-b",
        title: withTask,
        full: `repo-b · ${withTask}`,
      },
    },
    {
      name: "別のプロジェクト・題なし",
      title: withoutTask,
      project: { name: "repo-b", current: false },
      expected: {
        project: "repo-b",
        title: withoutTask,
        full: `repo-b · ${withoutTask}`,
      },
    },
    {
      name: "プロジェクトが分からない",
      title: withTask,
      project: null,
      expected: { project: null, title: withTask, full: withTask },
    },
    {
      name: "別のプロジェクトだが名前が空",
      title: withTask,
      project: { name: "", current: false },
      expected: { project: null, title: withTask, full: withTask },
    },
  ])("$name", ({ title, project, expected }) => {
    expect(terminalTabName(title, project)).toEqual(expected);
  });
});

// 狭くなったときは題より先にプロジェクト名を省略する: プロジェクト名は題より
// 縮みやすいが、名前と題で分け合う幅の 40% (fitBrandWidths の BRANCH_SHARE) と
// 自分の幅の小さいほうで止まる (自動の最小幅。flex-basis は中身、width が 40%、
// overflow はスクロールしない clip)。そこからは題が縮む。どちらも省略記号で切る。
describe("terminal tab name css", () => {
  const rules = baseRules(loadStyleSheet());
  const of = (selector: string) =>
    cascadedDeclarations(rules, (candidate) => candidate === selector);
  const name = of(".main-tab-name.main-tab-name-project");
  const project = of(".main-tab-project");
  const title = of(".main-tab-title");
  const flexPart = (flex: string | undefined, index: number) =>
    (flex ?? "").split(/\s+/)[index];

  test("プロジェクト名が先に縮み、分け合う幅の 40% で止まる", () => {
    expect({
      display: name.get("display"),
      projectFirst:
        Number(flexPart(project.get("flex"), 1)) >
        Number(flexPart(title.get("flex"), 1)),
      projectBasis: flexPart(project.get("flex"), 2),
      projectFloor: project.get("width"),
      projectMin: project.get("min-width"),
      projectEllipsis: [project.get("overflow"), project.get("text-overflow")],
      titleEllipsis: [title.get("overflow"), title.get("text-overflow")],
      titleMin: title.get("min-width"),
    }).toEqual({
      display: "flex",
      projectFirst: true,
      projectBasis: "content",
      projectFloor: `calc(100% * ${BRANCH_SHARE})`,
      projectMin: "auto",
      projectEllipsis: ["clip", "ellipsis"],
      titleEllipsis: ["hidden", "ellipsis"],
      titleMin: "0",
    });
  });
});
