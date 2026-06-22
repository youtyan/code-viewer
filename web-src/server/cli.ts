#!/usr/bin/env node

export {};

const REQUIRED_NODE_MAJOR = 20;
const nodeMajor = Number.parseInt(
  (process.versions.node || "0").split(".")[0] || "0",
  10,
);
if (!Number.isFinite(nodeMajor) || nodeMajor < REQUIRED_NODE_MAJOR) {
  process.stderr.write(
    `code-viewer requires Node.js >= ${REQUIRED_NODE_MAJOR}.0.0, but found ${process.versions.node}.\n` +
      `Please upgrade Node.js (e.g. via nvm, volta, or your package manager) and retry.\n`,
  );
  process.exit(1);
}

if (process.argv[2] === "annotate") {
  const { runAnnotateCli } = await import("./annotate-cli");
  await runAnnotateCli(process.argv.slice(3));
} else if (process.argv[2] === "query") {
  const { runQueryCli } = await import("./query-cli");
  await runQueryCli(process.argv.slice(3));
} else if (process.argv[2] === "skill") {
  const { runSkillCli } = await import("./skill-cli");
  runSkillCli(process.argv.slice(3));
} else {
  await import("./preview");
}
