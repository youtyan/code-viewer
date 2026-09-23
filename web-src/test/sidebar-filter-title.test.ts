// Files の木の絞り込み欄の title は使い方の説明 (app.ts が言語ごとに付ける)。
// 正規表現の誤りの間だけ理由に差し替え、直ったら説明に戻す。以前は正しい
// 絞り込みのたびに空で上書きし、説明が最初の描画で消えていた。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { createSidebarForTest, installSidebarDom } from "./_sidebar-fixture";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

const HELP = "Filter files. /pattern/ is a regex.";
const HELP_JA = "ファイルを絞り込みます。/pattern/ は正規表現。";

function mount() {
  installSidebarDom();
  const sidebar = createSidebarForTest();
  sidebar.renderSidebar(
    [
      { path: "src", type: "tree" as const },
      { path: "src/alpha.ts", type: "blob" as const },
    ],
    () => {
      /* noop */
    },
  );
  const input = document.querySelector<HTMLInputElement>("#sb-filter");
  if (!input) throw new Error("missing #sb-filter");
  // app.ts の localize と同じく、説明を title に付ける。
  input.title = HELP;
  const filterWith = (value: string) => {
    input.value = value;
    sidebar.applyFilter();
    return { title: input.title, invalid: input.hasAttribute("aria-invalid") };
  };
  return { input, filterWith };
}

test.each([
  ["", { title: HELP, invalid: false }],
  ["alpha", { title: HELP, invalid: false }],
  ["/alp.a/", { title: HELP, invalid: false }],
])("a valid filter %j keeps the explanation", (value, expected) => {
  const { filterWith } = mount();
  expect(filterWith(value)).toEqual(expected);
});

test("a broken regex shows the reason, and fixing it brings the explanation back", () => {
  const { filterWith } = mount();
  const broken = filterWith("/[/");
  expect({
    invalid: broken.invalid,
    showsReason: broken.title !== HELP && broken.title.length > 0,
  }).toEqual({ invalid: true, showsReason: true });
  expect(filterWith("/[a]/")).toEqual({ title: HELP, invalid: false });
});

test("the language changed while the regex was broken: the new explanation comes back", () => {
  const { input, filterWith } = mount();
  filterWith("/[/");
  // app.ts が言語の切替で説明を付け直す。
  input.title = HELP_JA;
  expect(filterWith("/[/").invalid).toBe(true);
  expect(filterWith("alpha")).toEqual({ title: HELP_JA, invalid: false });
});
