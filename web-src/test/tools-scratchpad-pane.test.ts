import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { toolsText } from "../views/tools/i18n";
import {
  createScratchpadPane,
  type ScratchpadPane,
} from "../views/tools/scratchpad-pane";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const TEXT = toolsText("en");

type RenderCall = { value: string; signal: AbortSignal };

let calls: RenderCall[];
let inputs: string[];

/** 描画が終わらないペイン。走っている描画の扱いだけを見たいときに使う。 */
function createPendingPane(initialText: string): ScratchpadPane {
  const pane = createScratchpadPane(TEXT, "Output", "Input", {
    toolClassName: "tools-pane-test",
    initialText,
    onInput: (value) => inputs.push(value),
    render: (value, _output, signal) => {
      calls.push({ value, signal });
      return new Promise<void>(() => undefined);
    },
  });
  document.body.replaceChildren(pane.el);
  return pane;
}

function statusText(pane: ScratchpadPane): string {
  return (
    pane.el.querySelector<HTMLElement>(".tools-pane-status")?.textContent ?? ""
  );
}

beforeEach(() => {
  calls = [];
  inputs = [];
  document.body.replaceChildren();
});

describe("scratchpad pane render lifecycle", () => {
  test("typing aborts the render that is still running", () => {
    const pane = createPendingPane("first");
    pane.refresh();
    expect(calls.length).toBe(1);
    expect(calls[0].signal.aborted).toBe(false);

    pane.input.value = "second";
    pane.input.dispatchEvent(new Event("input", { bubbles: true }));

    // デバウンス明けを待たずに、この時点で古い描画は無効になる。
    expect(calls[0].signal.aborted).toBe(true);
    pane.dispose();
  });

  test("reports every input immediately so drafts are never behind", () => {
    const pane = createPendingPane("");
    pane.input.value = "a";
    pane.input.dispatchEvent(new Event("input", { bubbles: true }));
    pane.input.value = "ab";
    pane.input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(inputs).toEqual(["a", "ab"]);
    pane.dispose();
  });

  test("an empty input shows the placeholder without calling render", () => {
    const pane = createPendingPane("");
    pane.refresh();

    expect(calls).toEqual([]);
    expect(pane.output.textContent).toBe(TEXT.pane.emptyInput);
    pane.dispose();
  });

  test("clearing empties the input, reports it, and drops the render", () => {
    const pane = createPendingPane("something");
    pane.refresh();
    const clear =
      pane.el.querySelector<HTMLButtonElement>(".tools-pane-action");
    clear?.click();

    expect(pane.input.value).toBe("");
    expect(inputs).toEqual([""]);
    expect(calls[0].signal.aborted).toBe(true);
    pane.dispose();
  });

  test("restores the status hidden behind a pinned message", () => {
    const pane = createPendingPane("first");
    pane.setStatus("render failed", "error");
    expect(statusText(pane)).toBe("render failed");

    pane.setPinnedStatus("could not save this draft");
    expect(statusText(pane)).toBe("could not save this draft");

    // 固定中に出た分も覚えておき、解除したら元に戻す。
    pane.setStatus("render failed again", "error");
    expect(statusText(pane)).toBe("could not save this draft");

    pane.setPinnedStatus(null);
    expect(statusText(pane)).toBe("render failed again");
    pane.dispose();
  });

  test("a flash cannot break through a pinned message", () => {
    const pane = createPendingPane("first");
    pane.setPinnedStatus("could not save this draft");
    pane.flashStatus("copied");

    expect(statusText(pane)).toBe("could not save this draft");
    pane.dispose();
  });

  test("disposing aborts the render in flight", () => {
    const pane = createPendingPane("first");
    pane.refresh();
    pane.dispose();

    expect(calls[0].signal.aborted).toBe(true);
  });
});
