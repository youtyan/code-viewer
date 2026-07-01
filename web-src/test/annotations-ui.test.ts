import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AnnotationsUiDeps } from "../views/annotations-ui";
import { createAnnotationsUi } from "../views/annotations-ui";
import { q } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function setupDom() {
  document.body.innerHTML = `
    <aside id="annotation-panel" hidden>
      <button id="annotations-toggle" type="button"></button>
      <button id="annotation-panel-close" type="button"></button>
      <button id="annotation-capture-db" type="button" hidden></button>
      <input id="annotation-follow" type="checkbox" />
      <button id="annotation-clear" type="button"></button>
      <span id="annotations-count"></span>
      <span id="annotation-list-count"></span>
      <div id="annotation-sessions"></div>
      <div id="annotation-detail" hidden>
        <div class="annotation-detail-head">
          <span id="annotation-detail-session"></span>
          <span id="annotation-detail-time"></span>
          <span id="annotation-detail-step"></span>
          <button id="annotation-detail-prev" type="button" title="legacy">‹</button>
          <button id="annotation-detail-next" type="button" title="legacy">›</button>
          <button id="annotation-detail-close" type="button">close</button>
        </div>
        <a id="annotation-detail-location" href="#"></a>
        <div id="annotation-detail-body"></div>
      </div>
    </aside>
  `;
}

function createDeps(): AnnotationsUiDeps {
  return {
    $: <T extends Element = HTMLElement>(sel: string) => q<T>(document, sel),
    diffCardSelector: () => "",
    diffRowLineNumber: () => null,
    focusDiffLine: () => false,
    scrollDiffElementIntoView: () => undefined,
    expandAllFileContext: () => Promise.resolve(),
    scrollToFile: () => undefined,
    renderStandaloneSource: () => Promise.resolve(undefined),
    removeStandaloneSource: () => undefined,
    cancelActiveSourceLoad: () => false,
    setRoute: () => undefined,
    setPageMode: () => undefined,
    syncRefInputs: () => undefined,
    load: () => Promise.resolve(undefined),
    currentRange: () => ({ from: "HEAD~1", to: "HEAD" }),
    getFiles: () => [],
    getRoute: () => ({ screen: "diff", range: { from: "HEAD~1", to: "HEAD" } }),
    setRange: () => undefined,
    getAnnotationPanelOpen: () => false,
    setAnnotationPanelOpenState: () => undefined,
    getAnnotationPanelWidth: () => undefined,
    setAnnotationPanelWidth: () => undefined,
    getAnnotationFollow: () => false,
    setAnnotationFollow: () => undefined,
    leaveDatabaseView: () => undefined,
    openDatabaseAnnotation: () => Promise.resolve(),
    captureDatabaseAnnotationTarget: () => null,
  };
}

describe("annotations detail panel nav buttons", () => {
  test("renders icon-only prev/next controls with accessible labels", () => {
    setupDom();
    createAnnotationsUi(createDeps());

    const prev = q<HTMLButtonElement>(document, "#annotation-detail-prev");
    const next = q<HTMLButtonElement>(document, "#annotation-detail-next");

    expect(prev.querySelector("svg.octicon-skip-back")).toBeTruthy();
    expect(next.querySelector("svg.octicon-skip-forward")).toBeTruthy();
    expect([prev, next].map((el) => el.textContent).join("")).toBe("");
    expect(prev.getAttribute("aria-label")).toBe("previous annotation");
    expect(next.getAttribute("aria-label")).toBe("next annotation");
    expect(prev.title).toBe("previous annotation");
    expect(next.title).toBe("next annotation");
  });
});
