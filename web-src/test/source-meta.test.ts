import { describe, expect, test } from "bun:test";
import {
  isDotenvName,
  isLikelyTextBytes,
  sourceDisplayKind,
  sourceInternalPathKind,
} from "../core/source-meta";

describe("source metadata", () => {
  test("treats dotenv examples and variants as text sources", () => {
    expect(sourceDisplayKind("apps/mastra/.env.example")).toBe("text");
    expect(sourceDisplayKind(".env.local")).toBe("text");
    expect(sourceDisplayKind("apps/api/service.env.sample")).toBe("text");
    expect(isDotenvName("environment.example")).toBe(false);
  });

  test("treats rule and prompt-like files as text sources", () => {
    expect(sourceDisplayKind(".ai/codex-rules/default.rules")).toBe("text");
    expect(sourceDisplayKind("agents/default.prompt")).toBe("text");
    expect(sourceDisplayKind("docs/setup.instructions")).toBe("text");
  });

  test("detects text-like bytes without accepting binary data", () => {
    const encoder = new TextEncoder();
    expect(isLikelyTextBytes(encoder.encode("name: value\nnext: ok\n"))).toBe(
      true,
    );
    expect(isLikelyTextBytes(new Uint8Array([0x7b, 0x00, 0x7d]))).toBe(false);
    expect(isLikelyTextBytes(new Uint8Array([0xff, 0xfe, 0x00, 0x00]))).toBe(
      false,
    );
  });

  test("detects internal metadata paths before source rendering", () => {
    expect(sourceInternalPathKind(".code-viewer/settings.json")).toBe(
      "code-viewer",
    );
    expect(sourceInternalPathKind("packages/app/.code-viewer/state.json")).toBe(
      "code-viewer",
    );
    expect(sourceInternalPathKind(".git/config")).toBe("git");
    expect(sourceInternalPathKind("src/code-viewer/readme.md")).toBe(null);
  });
});
