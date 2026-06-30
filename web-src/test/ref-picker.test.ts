import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AppRoute } from "../core/routes";
import { createRefPicker } from "../views/ref-picker";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function installRefPickerDom() {
  document.body.innerHTML = `
    <div data-ref-selector><input id="ref-from" /></div>
    <div data-ref-selector><input id="ref-to" /></div>
    <div id="repo-target-wrap" data-ref-selector><input id="repo-target" /></div>
    <div id="ref-popover" hidden>
      <input class="rp-search" />
      <div class="rp-body"></div>
    </div>
  `;
}

function createPickerForRoute(route: AppRoute) {
  let currentRoute = route;
  const routes: AppRoute[] = [];
  let repoLoads = 0;
  const picker = createRefPicker({
    $: <T extends Element = HTMLElement>(selector: string): T => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el as T;
    },
    escapeHtml: (value) => String(value),
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    setRange: () => undefined,
    setRoute: (nextRoute) => {
      currentRoute = nextRoute;
      routes.push(nextRoute);
    },
    loadRepo: async () => {
      repoLoads++;
    },
    renderStandaloneSource: async () => undefined,
    getFrom: () => "HEAD",
    getTo: () => "worktree",
    getRepoRef: () => "worktree",
    getRoute: () => currentRoute,
  });
  if (!picker) throw new Error("picker not created");
  return { routes, repoLoads: () => repoLoads };
}

describe("repository ref picker", () => {
  test("changing the repository target reloads the current repo path with the new ref", () => {
    installRefPickerDom();
    const range = { from: "HEAD", to: "worktree" };
    const { routes, repoLoads } = createPickerForRoute({
      screen: "repo",
      ref: "worktree",
      path: "web-src/views",
      range,
    });

    const input = document.querySelector<HTMLInputElement>("#repo-target");
    if (!input) throw new Error("missing repo target");
    input.value = "main";
    input.dispatchEvent(new Event("change"));

    expect(routes).toEqual([
      {
        screen: "repo",
        ref: "main",
        path: "web-src/views",
        range,
      },
    ]);
    expect(repoLoads()).toBe(1);
  });
});
