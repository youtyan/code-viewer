import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

describe("node cli package metadata", () => {
  test("publishes Node executable bins for npx", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as {
      bin: Record<string, string>;
      files: string[];
      engines?: Record<string, string>;
    };

    expect(pkg.bin["code-viewer"]).toBe("dist/code-viewer.js");
    expect(pkg.bin["git-diff-preview"]).toBe("dist/code-viewer.js");
    expect(pkg.files.includes("dist")).toBe(true);
    expect(typeof pkg.engines?.node).toBe("string");
  });

  test("production server entrypoints do not use Bun runtime globals directly", () => {
    const checkedFiles = productionServerFiles(join(root, "web-src", "server"));
    const offenders = checkedFiles.filter((path) =>
      readFileSync(path, "utf8").includes("Bun."),
    );

    expect(offenders).toEqual([]);
  });

  test("third-party notices include transitive runtime dependencies", () => {
    const notices = readFileSync(
      join(root, "web", "vendor", "THIRD_PARTY_NOTICES.txt"),
      "utf8",
    );

    expect(notices).toContain("\ncluster-key-slot@");
  });

  // 依存として入れずに値だけを写したもの (generate-third-party-notices.mjs の
  // copiedValueSources) も、著作権表記と許諾の本文ごと載る。
  test("third-party notices include values copied from other packages", () => {
    const notices = readFileSync(
      join(root, "web", "vendor", "THIRD_PARTY_NOTICES.txt"),
      "utf8",
    );
    const heading = "\n@primer/primitives@11.10.0 (copied values)\n";
    const entry = notices.slice(notices.indexOf(heading));

    expect(notices).toContain("\nCopied Values\n");
    expect(notices).toContain(heading);
    expect(entry).toContain(
      'Copied into: web/style.css (the [data-color-theme="github"] theme blocks)',
    );
    expect(entry).toContain("Copyright (c) 2018 GitHub Inc.");
    expect(entry).toContain(
      "The above copyright notice and this permission notice shall be included in all",
    );
  });
});

function productionServerFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) continue;
    if (!entry.endsWith(".ts")) continue;
    if (entry === "dev.ts") continue;
    files.push(path);
  }
  return files;
}
