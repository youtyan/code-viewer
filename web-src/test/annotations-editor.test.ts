// 注釈を書く画面 (views/annotations/editor.ts) の presenter。描き方を記録する view
// に差し替え、下見に切り替えたときに渡す値と、保存で送る中身を見る。
// パス・語はすべて架空。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import {
  type AnnotationEditorProps,
  createAnnotationEditor,
  DEFAULT_VIEW,
} from "../views/annotations/editor";

afterEach(() => {
  document.body.replaceChildren();
});

describe("the annotation editor presenter", () => {
  test("gives the view the preview and sends the typed note on save", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const shown: AnnotationEditorProps[] = [];
    const saved: Record<string, unknown>[] = [];
    const editor = createAnnotationEditor(
      {
        container,
        target: null,
        route: {
          screen: "file",
          path: "src/sample.ts",
          ref: "worktree",
          line: 3,
          range: { from: "HEAD", to: "worktree" },
        },
        range: { from: "HEAD", to: "worktree" },
        sessions: [],
        sessionId: null,
        getLanguage: () => "en",
        getHighlighter: () => null,
        save: async (payload) => {
          saved.push(payload);
        },
        cancel: () => undefined,
        reportError: (error) => {
          throw error;
        },
      },
      (props) => {
        shown.push(props);
        return DEFAULT_VIEW(props);
      },
    );
    const last = () => shown[shown.length - 1];
    expect([
      last()?.location?.path.defaultValue,
      last()?.location?.start.defaultValue,
      last()?.session?.name.hidden,
      last()?.tabs.previewing,
    ]).toEqual(["src/sample.ts", "3", false, false]);

    const body = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="body"]',
    );
    if (!body) throw new Error("no body field");
    body.value = "**sample** note";
    body.dispatchEvent(new Event("input"));
    last()?.tabs.onPreview();
    expect([
      last()?.tabs.previewing,
      last()?.preview.html.includes("<strong>sample</strong>"),
      editor.isDirty(),
    ]).toEqual([true, true, true]);

    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toEqual([
      {
        action: "add",
        session_id: undefined,
        session_title: "Reading notes",
        target: undefined,
        path: "src/sample.ts",
        line: { start: 3, end: 3 },
        range: { from: "HEAD", to: "worktree" },
        title: "",
        body: "**sample** note",
      },
    ]);
  });
});
