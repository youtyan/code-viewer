import "./_dom";
import { beforeEach, describe, expect, test } from "vitest";
import { toolsText } from "../views/tools/i18n";
import type {
  CvScratchpadPane,
  ScratchpadRenderContext,
} from "../views/tools/scratchpad-pane";
import { flushRenders } from "../views/ui/render-queue";
import {
  mountScratchpadPane,
  paneStatusText,
  paneTextarea,
} from "./_tools-pane";

const TEXT = toolsText("en");

type RenderCall = {
  value: string;
  signal: AbortSignal;
  context: ScratchpadRenderContext;
};

let calls: RenderCall[];
let inputs: string[];

/** 描画が終わらない 2 面。走っている描画の扱いだけを見たいときに使う。 */
function createPendingPane(initialText: string): CvScratchpadPane {
  const pane = mountScratchpadPane({
    value: initialText,
    renderOutput: (value, context) => {
      calls.push({ value, signal: context.signal, context });
      return new Promise<void>(() => undefined);
    },
  });
  pane.addEventListener("cv-draft-input", (event) =>
    inputs.push((event as CustomEvent<{ value: string }>).detail.value),
  );
  return pane;
}

function type(pane: CvScratchpadPane, value: string): void {
  const textarea = paneTextarea(pane);
  textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  calls = [];
  inputs = [];
  document.body.replaceChildren();
});

describe("scratchpad pane input name", () => {
  test("the input is named by its placeholder, also after switching language", () => {
    const pane = createPendingPane("");
    expect(paneTextarea(pane).getAttribute("aria-label")).toBe("Input");
    const ja = toolsText("ja");
    pane.text = ja;
    pane.placeholder = ja.markdown.placeholder;
    flushRenders();
    expect(paneTextarea(pane).getAttribute("aria-label")).toBe(
      ja.markdown.placeholder,
    );
  });
});

describe("scratchpad pane render lifecycle", () => {
  test("typing aborts the render that is still running", () => {
    const pane = createPendingPane("first");
    pane.refresh();
    expect(calls.length).toBe(1);
    expect(calls[0].signal.aborted).toBe(false);

    type(pane, "second");

    // デバウンス明けを待たずに、この時点で古い描画は無効になる。
    expect(calls[0].signal.aborted).toBe(true);
    pane.remove();
  });

  test("reports every input immediately so drafts are never behind", () => {
    const pane = createPendingPane("");
    type(pane, "a");
    type(pane, "ab");

    expect(inputs).toEqual(["a", "ab"]);
    pane.remove();
  });

  test("an empty input shows the placeholder without calling render", () => {
    const pane = createPendingPane("");
    pane.refresh();

    const output = pane.querySelector<HTMLElement>(".tools-pane-body");
    expect(calls).toEqual([]);
    // 共通の空の案内: 一行・補足 (今までの一文)・貼り付けのキー。
    expect([
      output?.querySelector("h2")?.textContent,
      output?.querySelector("p")?.textContent,
      [...(output?.querySelectorAll(".empty-key kbd") ?? [])].map(
        (key) => key.textContent,
      ),
    ]).toEqual([TEXT.pane.emptyTitle, TEXT.pane.emptyInput, ["⌘V"]]);
    pane.remove();
  });

  test("clearing empties the input, reports it, and drops the render", () => {
    const pane = createPendingPane("something");
    pane.refresh();
    pane.querySelector<HTMLButtonElement>(".tools-pane-action")?.click();

    expect(paneTextarea(pane).value).toBe("");
    expect(inputs).toEqual([""]);
    expect(calls[0].signal.aborted).toBe(true);
    pane.remove();
  });

  test("restores the status hidden behind a pinned message", () => {
    const pane = createPendingPane("first");
    pane.refresh();
    calls[0].context.setStatus("render failed", "error");
    expect(paneStatusText(pane)).toBe("render failed");

    pane.pinnedStatus = "could not save this draft";
    expect(paneStatusText(pane)).toBe("could not save this draft");

    // 固定中に出た分も覚えておき、解除したら元に戻す。
    pane.refresh();
    calls[1].context.setStatus("render failed again", "error");
    expect(paneStatusText(pane)).toBe("could not save this draft");

    pane.pinnedStatus = null;
    expect(paneStatusText(pane)).toBe("render failed again");
    pane.remove();
  });

  test("a flash cannot break through a pinned message", () => {
    const pane = createPendingPane("first");
    pane.pinnedStatus = "could not save this draft";
    flushRenders();
    pane.flash = { message: "copied", tone: "info", seq: 1 };

    expect(paneStatusText(pane)).toBe("could not save this draft");
    pane.remove();
  });

  test("removing the pane aborts the render in flight", () => {
    const pane = createPendingPane("first");
    pane.refresh();
    pane.remove();

    expect(calls[0].signal.aborted).toBe(true);
  });
});
