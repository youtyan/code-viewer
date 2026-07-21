import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AppRoute } from "../core/routes";
import { createRefPicker } from "../views/ref-picker";
import { waitFor } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

function installRefPickerDom() {
  document.body.innerHTML = `
    <div data-ref-selector><input id="ref-from" /></div>
    <div data-ref-selector><input id="ref-to" /></div>
    <div id="repo-target-wrap" data-ref-selector><input id="repo-target" /></div>
    <div id="ref-popover" hidden>
      <button class="rp-tab" data-tab="commits"></button>
      <button class="rp-tab" data-tab="branches"></button>
      <button class="rp-tab" data-tab="tags"></button>
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
  return { picker, routes, repoLoads: () => repoLoads };
}

describe("repository ref picker", () => {
  test("loads branch refs only when the branch picker is opened", async () => {
    installRefPickerDom();
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Promise.resolve({
        json: async () => ({
          branches: [{ name: "feature/sample", when: "" }],
          tags: [],
          commits: [],
          current: "feature/sample",
        }),
      } as Response);
    }) as typeof fetch;

    try {
      const { picker } = createPickerForRoute({
        screen: "repo",
        ref: "worktree",
        path: "web-src/views",
        range: { from: "HEAD", to: "worktree" },
      });

      expect(requestedUrls).toEqual([]);
      const input = document.querySelector<HTMLInputElement>("#repo-target");
      if (!input) throw new Error("missing repo target");
      picker.openPopover(input);
      document
        .querySelector<HTMLButtonElement>('[data-tab="branches"]')
        ?.click();
      await waitFor(
        () =>
          document
            .querySelector(".rp-body")
            ?.textContent?.includes("feature/sample") === true,
      );

      expect(requestedUrls).toEqual(["/_refs"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("repository target is only displayed in repository sidebar modes", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.appendChild(style);

    const wrap = document.createElement("span");
    wrap.id = "repo-target-wrap";
    wrap.className = "ref-selector ref-selector-in-grid";
    wrap.hidden = false;
    document.body.appendChild(wrap);

    document.body.className = "";
    expect(getComputedStyle(wrap).display).toBe("none");

    document.body.className = "gdp-repo-page";
    expect(getComputedStyle(wrap).display).toBe("flex");

    document.body.className = "gdp-file-detail-page gdp-repo-blob-page";
    expect(getComputedStyle(wrap).display).toBe("flex");

    wrap.hidden = true;
    expect(getComputedStyle(wrap).display).toBe("none");
  });

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
