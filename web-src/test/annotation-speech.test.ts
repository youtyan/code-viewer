// web-src/test/annotation-speech.test.ts
import { describe, expect, test } from "bun:test";
import {
  annotationDisplayMs,
  annotationSpeechText,
} from "../core/annotation-speech";

describe("annotationSpeechText", () => {
  test("removes fenced code blocks entirely", () => {
    const body = "before\n```ts\nconst x = 1;\n```\nafter";
    expect(annotationSpeechText(body)).toBe("before after");
  });

  test("keeps inline code text without backticks", () => {
    expect(annotationSpeechText("use `foo()` here")).toBe("use foo() here");
  });

  test("keeps link text and drops url", () => {
    expect(annotationSpeechText("see [docs](https://example.com)")).toBe(
      "see docs",
    );
  });

  test("strips markdown markers and normalizes whitespace", () => {
    const body = "# Title\n\n> quoted **bold** _em_\n\n- item one\n- item two";
    expect(annotationSpeechText(body)).toBe(
      "Title quoted bold em item one item two",
    );
  });

  test("collapses bare urls to a short token", () => {
    expect(
      annotationSpeechText("see https://example.com/very/long?x=1 now"),
    ).toBe("see URL now");
  });

  test("drops everything after an unterminated fence", () => {
    expect(annotationSpeechText("intro\n```\nno closing")).toBe("intro");
  });

  test("returns empty string for code-only body", () => {
    expect(annotationSpeechText("```\nonly code\n```")).toBe("");
  });
});

describe("annotationDisplayMs", () => {
  test("has a 3 second floor", () => {
    expect(annotationDisplayMs("hi")).toBe(3000);
  });

  test("scales with character count at 150ms per char", () => {
    const text = "a".repeat(40); // 40 * 150 = 6000
    expect(annotationDisplayMs(text)).toBe(6000);
  });
});
