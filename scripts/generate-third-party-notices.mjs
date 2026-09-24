import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(projectRoot, "web/vendor/THIRD_PARTY_NOTICES.txt");

const distributedPackageRoots = [
  "@redis/client",
  "@xterm/addon-fit",
  "@xterm/addon-webgl",
  "@xterm/xterm",
  "d3-dsv",
  "highlight.js",
  "markdown-it",
  "markdown-it-anchor",
  "markdown-it-footnote",
  "mermaid",
  "mysql2",
  "pg",
  "shiki",
  "yaml",
];

// npm の依存としては入れず、値だけを写したもの (配布物の web/style.css などに載る)。
// パッケージを入れていないので上の自動の収集では拾えない。写すものを足したらここに
// 1 件足す (手順は .agents/skills/project-rules/references/dependencies.md)。
// 許諾の本文は写した版のパッケージの LICENSE をそのまま貼る。
const copiedValueSources = [
  {
    name: "@primer/primitives",
    version: "11.10.0",
    license: "MIT",
    source: "https://github.com/primer/primitives",
    copied:
      "Color values of the functional light and dark themes (surfaces, text, borders, states, diff and syntax colors).",
    copiedTo: 'web/style.css (the [data-color-theme="github"] theme blocks)',
    licenseText: `The MIT License (MIT)

Copyright (c) 2018 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  },
];

const seen = new Map();
const skippedOptional = [];

function findPackageJson(packageName, baseDir) {
  const baseRequire = createRequire(join(baseDir, "__package-resolver.cjs"));
  let packageJsonError;
  try {
    return realpathSync(baseRequire.resolve(`${packageName}/package.json`));
  } catch (error) {
    // Some packages do not export package.json.
    packageJsonError = error;
  }

  for (const modulesDir of baseRequire.resolve.paths(packageName) ?? []) {
    const candidate = join(modulesDir, packageName, "package.json");
    if (existsSync(candidate)) return realpathSync(candidate);
  }

  let entry;
  try {
    entry = baseRequire.resolve(packageName);
  } catch (error) {
    throw new Error(`unable to resolve ${packageName} from ${baseDir}`, {
      cause: new AggregateError(
        [packageJsonError, error],
        `package metadata and entrypoint resolution failed for ${packageName}`,
      ),
    });
  }
  for (let dir = dirname(entry); ; dir = dirname(dir)) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, "utf8"));
      if (parsed.name === packageName) return candidate;
    }
    if (dir === dirname(dir)) break;
  }

  throw new Error(`unable to resolve ${packageName} from ${baseDir}`, {
    cause: packageJsonError,
  });
}

function readPackage(
  packageName,
  baseDir,
  packageJsonPath = findPackageJson(packageName, baseDir),
) {
  const packageDir = dirname(packageJsonPath);
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;

  const licenseFiles = readdirSync(packageDir)
    .filter((name) => /^(licen[cs]e|notice|copying)(\.|$|-|_)?/i.test(name))
    .map((name) => join(packageDir, name))
    .filter((path) => statSync(path).isFile())
    .sort((a, b) => a.localeCompare(b));

  const inferredLicense = inferLicenseFromFiles(licenseFiles);
  seen.set(key, {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license || pkg.licenses || inferredLicense || "UNKNOWN",
    homepage:
      pkg.homepage ||
      (typeof pkg.repository === "string"
        ? pkg.repository
        : pkg.repository?.url) ||
      "",
    packageJsonPath,
    licenseFiles,
  });

  for (const depName of Object.keys(pkg.dependencies || {}).sort()) {
    readPackage(depName, packageDir);
  }
  for (const depName of Object.keys(pkg.optionalDependencies || {}).sort()) {
    // 入っていない (見つからない) optional だけを飛ばす。入っているのに読めない・
    // 壊れているものは投げる。理由は配布物に載るので、手元のパスを含む cause は
    // 載せず 1 行目だけにする。
    let optionalPackageJson;
    try {
      optionalPackageJson = findPackageJson(depName, packageDir);
    } catch (error) {
      skippedOptional.push({
        from: key,
        name: depName,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    readPackage(depName, packageDir, optionalPackageJson);
  }
}

function inferLicenseFromFiles(licenseFiles) {
  for (const file of licenseFiles) {
    const text = readFileSync(file, "utf8").slice(0, 500).toLowerCase();
    if (text.includes("mit license")) return "MIT";
    if (text.includes("apache license")) return "Apache-2.0";
    if (text.includes("bsd 3-clause")) return "BSD-3-Clause";
    if (text.includes("bsd 2-clause")) return "BSD-2-Clause";
    if (text.includes("isc license")) return "ISC";
    if (text.includes("mozilla public license version 2.0")) return "MPL-2.0";
  }
  return "";
}

function formatLicense(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

for (const root of distributedPackageRoots) {
  readPackage(root, projectRoot);
}

const packages = [...seen.values()].sort((a, b) => {
  const byName = a.name.localeCompare(b.name);
  return byName || a.version.localeCompare(b.version);
});

const lines = [
  "Third Party Notices",
  "===================",
  "",
  "This file is generated by scripts/generate-third-party-notices.mjs.",
  "It covers npm packages used by the distributed browser bundles and server runtime,",
  "and values copied from other packages into the distributed files (Copied Values).",
  "",
  "Package Summary",
  "---------------",
  "",
  "| Package | Version | License | Source |",
  "| --- | --- | --- | --- |",
];

for (const pkg of packages) {
  lines.push(
    `| ${escapeCell(pkg.name)} | ${escapeCell(pkg.version)} | ${escapeCell(
      formatLicense(pkg.license),
    )} | ${escapeCell(pkg.homepage || relative(projectRoot, pkg.packageJsonPath))} |`,
  );
}

if (skippedOptional.length > 0) {
  lines.push("", "Skipped optional packages:", "");
  for (const item of skippedOptional) {
    lines.push(`- ${item.name} from ${item.from}: ${item.reason}`);
  }
}

lines.push(
  "",
  "Copied Values",
  "-------------",
  "",
  "These packages are not installed. Their values were copied into the files below.",
  "",
  "| Package | Version | License | Source | Copied into |",
  "| --- | --- | --- | --- | --- |",
);
for (const item of copiedValueSources) {
  lines.push(
    `| ${escapeCell(item.name)} | ${escapeCell(item.version)} | ${escapeCell(
      item.license,
    )} | ${escapeCell(item.source)} | ${escapeCell(item.copiedTo)} |`,
  );
}
for (const item of copiedValueSources) {
  const title = `${item.name}@${item.version} (copied values)`;
  lines.push(
    "",
    title,
    "-".repeat(title.length),
    "",
    `License: ${item.license}`,
    `Source: ${item.source}`,
    `Copied: ${item.copied}`,
    `Copied into: ${item.copiedTo}`,
    "",
    item.licenseText.trimEnd(),
  );
}

lines.push("", "License Texts", "-------------", "");

for (const pkg of packages) {
  lines.push(
    `${pkg.name}@${pkg.version}`,
    "-".repeat(`${pkg.name}@${pkg.version}`.length),
    "",
    `License metadata: ${formatLicense(pkg.license)}`,
  );
  if (pkg.homepage) lines.push(`Source: ${pkg.homepage}`);
  lines.push(`Package metadata: ${relative(projectRoot, pkg.packageJsonPath)}`);

  if (pkg.licenseFiles.length === 0) {
    lines.push(
      "",
      "No license or notice file was found in the installed package.",
      "",
    );
    continue;
  }

  for (const file of pkg.licenseFiles) {
    lines.push("", `File: ${relative(projectRoot, file)}`, "");
    lines.push(readFileSync(file, "utf8").trimEnd(), "");
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
