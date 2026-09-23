// 右の列の頭のプロジェクト名のボタンは、読み上げでプロジェクト名と枝が聞こえる。
// 「プロジェクトを切り替える」の aria-label が中身を上書きしていて、名前も枝も
// 読まれなかった (省略して切れた名前も、中身の文字なら全体が読まれる)。何をする
// ボタンかは説明 (title) に置く。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { ProjectActions } from "../views/projects/project-actions";
import { mountProjectSwitcher } from "../views/projects/project-switcher";
import {
  PROJECTS_EN,
  PROJECTS_JA,
  type ProjectsText,
} from "../views/projects/projects-i18n";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

test.each([
  { lang: "en", text: PROJECTS_EN },
  { lang: "ja", text: PROJECTS_JA },
])("$lang: the name and the branch are the button's name; the action is its description", ({
  text,
}) => {
  // index.html の #project-switcher と同じ形。
  document.body.innerHTML = `<button id="project-switcher" class="brand" type="button">
      <span class="title" id="project-title">sample-repo-with-a-long-name</span>
      <span id="project-branch" class="project-branch"><span class="goi-icon" aria-hidden="true"></span><span class="project-branch-name">feature/sample-branch</span></span>
    </button>`;
  const button = document.querySelector<HTMLElement>("#project-switcher");
  if (!button) throw new Error("no #project-switcher");
  let current: ProjectsText = PROJECTS_EN;
  const switcher = mountProjectSwitcher({
    button,
    actions: {} as ProjectActions,
    getText: () => current,
    getOverview: () => null,
    subscribe: () => () => undefined,
    currentPath: () => "/",
    currentName: () => "sample-repo-with-a-long-name",
    shortcutLabel: () => "p",
  });
  current = text;
  switcher.localize();
  expect([
    button.hasAttribute("aria-label"),
    button.textContent?.replace(/\s+/g, " ").trim(),
    button.title,
  ]).toEqual([
    false,
    "sample-repo-with-a-long-name feature/sample-branch",
    text.switcherButtonTitle("p"),
  ]);
});
