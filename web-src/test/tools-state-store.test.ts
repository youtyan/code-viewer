import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleStateRoute } from "../server/state-route";
import {
  loadToolsState,
  patchToolsState,
  sanitizeTools,
} from "../server/state-store";

// ai-dup-check: allow -- ok:local temp-project helper keeps this store test self-contained.
async function withTempProject(
  run: (dir: string) => void | Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-tools-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LONG_DRAFT = "x".repeat(200_001);

describe("tools state sanitizer", () => {
  test.each([
    {
      name: "drops a non-object payload",
      raw: "nope",
      expected: { version: 1 },
    },
    {
      name: "keeps a known active tool",
      raw: { activeTool: "mermaid" },
      expected: { version: 1, activeTool: "mermaid" },
    },
    {
      name: "drops an unknown active tool",
      raw: { activeTool: "spreadsheet" },
      expected: { version: 1 },
    },
    {
      name: "keeps drafts for known tools only",
      raw: { drafts: { markdown: "# hi", nope: "x" } },
      expected: { version: 1, drafts: { markdown: "# hi" } },
    },
    {
      name: "drops an empty draft",
      raw: { drafts: { markdown: "" } },
      expected: { version: 1 },
    },
    {
      name: "drops a non-string draft",
      raw: { drafts: { markdown: 42 } },
      expected: { version: 1 },
    },
    {
      name: "drops a draft above the size limit",
      raw: { drafts: { markdown: LONG_DRAFT } },
      expected: { version: 1 },
    },
    {
      name: "keeps a width inside the allowed range",
      raw: { width: 900 },
      expected: { version: 1, width: 900 },
    },
    {
      name: "clamps a width below the minimum",
      raw: { width: 100 },
      expected: { version: 1, width: 480 },
    },
    {
      name: "clamps a width above the maximum",
      raw: { width: 99_999 },
      expected: { version: 1, width: 4000 },
    },
    {
      name: "drops a non-numeric width",
      raw: { width: "wide" },
      expected: { version: 1 },
    },
  ])("$name", ({ raw, expected }) => {
    expect(sanitizeTools(raw)).toEqual(expected);
  });
});

describe("tools state route", () => {
  async function patchViaRoute(dir: string, patch: unknown): Promise<Response> {
    const req = new Request("http://localhost/_state/tools", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const res = await handleStateRoute(
      req,
      new URL("http://localhost/_state/tools"),
      dir,
      () => true,
    );
    if (!res) throw new Error("no response");
    return res;
  }

  test("accepts drafts that individually fit but exceed the shared 1 MB limit", async () => {
    await withTempProject(async (dir) => {
      // 20 万文字の日本語は UTF-8 で約 600 KB。2 ツール分で 1 MB を超える。
      const draft = "あ".repeat(200_000);
      const res = await patchViaRoute(dir, {
        drafts: { markdown: draft, mermaid: draft },
      });

      expect(res.status).toBe(200);
      const saved = await loadToolsState(dir);
      expect(saved.drafts?.markdown?.length).toBe(200_000);
      expect(saved.drafts?.mermaid?.length).toBe(200_000);
    });
  });

  test("still rejects a draft past the per-tool limit with 413", async () => {
    await withTempProject(async (dir) => {
      const res = await patchViaRoute(dir, {
        drafts: { markdown: LONG_DRAFT },
      });

      expect(res.status).toBe(413);
      expect(await res.text()).toBe("tools state too large");
    });
  });
});

describe("tools state patching", () => {
  test("starts empty and keeps what was written", async () => {
    await withTempProject(async (dir) => {
      expect(await loadToolsState(dir)).toEqual({ version: 1 });
      await patchToolsState(dir, {
        activeTool: "json",
        drafts: { json: '{"a":1}' },
        width: 1200,
      });
      expect(await loadToolsState(dir)).toEqual({
        version: 1,
        activeTool: "json",
        width: 1200,
        drafts: { json: '{"a":1}' },
      });
    });
  });

  test("patches one draft without disturbing the others", async () => {
    await withTempProject(async (dir) => {
      await patchToolsState(dir, {
        drafts: { markdown: "# one", mermaid: "graph TD" },
      });
      const after = await patchToolsState(dir, {
        drafts: { markdown: "# two" },
      });
      expect(after.drafts).toEqual({
        markdown: "# two",
        mermaid: "graph TD",
      });
    });
  });

  // 下書きが全部消えたら drafts ごと undefined に縮退する (db-ui の prefs と
  // 同じで、空オブジェクトをファイルに残さない)。
  test.each([
    { name: "an empty string clears a draft", value: "" },
    { name: "null clears a draft", value: null },
  ])("$name", async ({ value }) => {
    await withTempProject(async (dir) => {
      await patchToolsState(dir, { drafts: { markdown: "# one" } });
      const after = await patchToolsState(dir, { drafts: { markdown: value } });
      expect(after.drafts).toBeUndefined();
    });
  });

  test("clearing one draft keeps the remaining ones", async () => {
    await withTempProject(async (dir) => {
      await patchToolsState(dir, {
        drafts: { markdown: "# one", json: "{}" },
      });
      const after = await patchToolsState(dir, { drafts: { markdown: "" } });
      expect(after.drafts).toEqual({ json: "{}" });
    });
  });

  test("rejects an oversized draft instead of dropping the stored one", async () => {
    await withTempProject(async (dir) => {
      await patchToolsState(dir, { drafts: { markdown: "# keep" } });
      let message = "";
      try {
        await patchToolsState(dir, { drafts: { markdown: LONG_DRAFT } });
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toBe("tools state too large");
      // 413 で弾くだけで、既に入っていた下書きは巻き添えにしない。
      expect((await loadToolsState(dir)).drafts).toEqual({
        markdown: "# keep",
      });
    });
  });

  test.each([
    { name: "a number", value: 42 },
    { name: "an object", value: { nested: true } },
    { name: "a boolean", value: true },
  ])("ignores $name draft and keeps the stored one", async ({ value }) => {
    await withTempProject(async (dir) => {
      await patchToolsState(dir, { drafts: { markdown: "# keep" } });
      const after = await patchToolsState(dir, {
        drafts: { markdown: value },
      });
      expect(after.drafts).toEqual({ markdown: "# keep" });
    });
  });

  test.each([
    { name: "an unknown tool name", value: "spreadsheet" },
    { name: "a number", value: 7 },
    { name: "an object", value: { nested: true } },
  ])("ignores $name as activeTool and keeps the stored one", async ({
    value,
  }) => {
    await withTempProject(async (dir) => {
      await patchToolsState(dir, { activeTool: "json" });
      const after = await patchToolsState(dir, { activeTool: value });
      expect(after.activeTool).toBe("json");
    });
  });

  test.each([
    { name: "a string", value: "wide" },
    { name: "NaN", value: Number.NaN },
    { name: "an object", value: {} },
  ])("ignores $name as width and keeps the stored one", async ({ value }) => {
    await withTempProject(async (dir) => {
      await patchToolsState(dir, { width: 1200 });
      const after = await patchToolsState(dir, { width: value });
      expect(after.width).toBe(1200);
    });
  });

  test.each([
    { name: "activeTool", patch: { activeTool: null }, key: "activeTool" },
    { name: "width", patch: { width: null }, key: "width" },
  ])("clears $name when null is sent", async ({ patch, key }) => {
    await withTempProject(async (dir) => {
      await patchToolsState(dir, { activeTool: "json", width: 1200 });
      const after = await patchToolsState(dir, patch);
      expect(after[key as "activeTool" | "width"]).toBeUndefined();
    });
  });

  test("keeps the stored width when a later patch omits it", async () => {
    await withTempProject(async (dir) => {
      await patchToolsState(dir, { width: 1500 });
      const after = await patchToolsState(dir, { activeTool: "mermaid" });
      expect(after).toEqual({
        version: 1,
        activeTool: "mermaid",
        width: 1500,
      });
    });
  });
});
