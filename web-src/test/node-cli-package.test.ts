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
