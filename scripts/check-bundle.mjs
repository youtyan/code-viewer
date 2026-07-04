import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bundles = [
  {
    entry: "web-src/app.ts",
    format: "iife",
    outfile: "app.js",
  },
  {
    entry: "web-src/mermaid-entry.ts",
    format: "esm",
    outfile: "mermaid.js",
  },
  {
    entry: "web-src/shiki-entry.ts",
    format: "esm",
    outfile: "shiki.js",
  },
  {
    entry: "web-src/highlight-entry.ts",
    format: "iife",
    outfile: "highlight.min.js",
  },
];

const dirs = [
  mkdtempSync(join(tmpdir(), "code-viewer-bundle-a-")),
  mkdtempSync(join(tmpdir(), "code-viewer-bundle-b-")),
];

function runBuild(dir) {
  for (const bundle of bundles) {
    const result = spawnSync(
      "bun",
      [
        "build",
        "--target=browser",
        `--format=${bundle.format}`,
        `--outfile=${join(dir, bundle.outfile)}`,
        bundle.entry,
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

try {
  runBuild(dirs[0]);
  runBuild(dirs[1]);

  for (const bundle of bundles) {
    const firstPath = join(dirs[0], bundle.outfile);
    const secondPath = join(dirs[1], bundle.outfile);
    if (!existsSync(firstPath) || !existsSync(secondPath)) {
      throw new Error(`missing bundle output: ${bundle.outfile}`);
    }
    const first = readFileSync(firstPath);
    const second = readFileSync(secondPath);
    if (!first.equals(second)) {
      throw new Error(`non-deterministic bundle output: ${bundle.outfile}`);
    }
  }
} finally {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}
