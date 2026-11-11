// Tools の 2 面の部品 (cv-scratchpad-pane) を 1 つだけ置くテストの道具。
// DOM はテストの側で先に登録しておく (./_dom、または登録の後の動的 import)。

import { toolsText } from "../views/tools/i18n";
import {
  type CvScratchpadPane,
  CV_SCRATCHPAD_PANE,
  defineCvScratchpadPane,
  type ScratchpadPaneProps,
} from "../views/tools/scratchpad-pane";
import { defineUiComponents } from "../views/ui/components";
import { flushRenders } from "../views/ui/render-queue";
import { q } from "./_test-helpers";

/** 2 面を body に置いて描く。props は既定 (英語・表に出している) への上書き。 */
export function mountScratchpadPane(
  props: Partial<ScratchpadPaneProps> &
    Pick<ScratchpadPaneProps, "renderOutput">,
): CvScratchpadPane {
  defineUiComponents();
  defineCvScratchpadPane();
  const pane = document.createElement(CV_SCRATCHPAD_PANE) as CvScratchpadPane;
  Object.assign(pane, {
    toolClass: "tools-pane-test",
    text: toolsText("en"),
    outputTitle: "Output",
    placeholder: "Input",
    value: "",
    active: true,
    pinnedStatus: null,
    flash: null,
    refreshKey: 0,
    focusKey: 0,
    ...props,
  });
  document.body.replaceChildren(pane);
  flushRenders();
  return pane;
}

export function paneStatusText(pane: HTMLElement): string {
  flushRenders();
  return (
    pane.querySelector<HTMLElement>(".tools-pane-status")?.textContent ?? ""
  );
}

export function paneTextarea(pane: HTMLElement): HTMLTextAreaElement {
  return q<HTMLTextAreaElement>(pane, ".tools-textarea");
}
