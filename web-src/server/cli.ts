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

async function preflightSqlite(subcommand: string): Promise<void> {
  const { describeSqliteDriver } = await import("./database/sqlite-driver");
  const status = await describeSqliteDriver();
  if (status.kind === "ok") return;
  if (status.kind === "abi-mismatch") {
    process.stderr.write(
      `[code-viewer] ${subcommand}: better-sqlite3 ABI mismatch — ` +
        `compiled for NODE_MODULE_VERSION=${status.compiledAbi}, ` +
        `but this Node.js (v${process.versions.node}) requires ${status.runtimeAbi}.\n` +
        (status.modulePath
          ? `[code-viewer] module: ${status.modulePath}\n`
          : "") +
        `[code-viewer] ${status.hint}\n`,
    );
    process.exit(1);
  }
  process.stderr.write(
    `[code-viewer] ${subcommand}: SQLite driver unavailable. ${status.message}\n` +
      `[code-viewer] ${status.hint}\n`,
  );
  process.exit(1);
}

if (process.argv[2] === "agent-help") {
  // Top-level `code-viewer agent-help` is a pure stdout index — no SQLite,
  // no server, no filesystem. It must work in any environment so an AI
  // agent can discover the per-subcommand guides as its very first call.
  const { runAgentHelp } = await import("./agent-help");
  runAgentHelp(process.argv.slice(3));
} else if (process.argv[2] === "annotate") {
  const { runAnnotateCli } = await import("./annotate-cli");
  await runAnnotateCli(process.argv.slice(3));
} else if (process.argv[2] === "query") {
  const sub = process.argv[3];
  const helpOnly =
    !sub ||
    sub === "help" ||
    sub === "agent-help" ||
    sub === "--help" ||
    sub === "-h";
  if (!helpOnly) await preflightSqlite("query");
  const { runQueryCli } = await import("./query-cli");
  await runQueryCli(process.argv.slice(3));
} else if (process.argv[2] === "search") {
  // `search` is a thin /_grep wrapper. help / agent-help never touch the
  // server, so they run without preflight (mirrors the `query` branch's
  // helpOnly handling for the SQLite driver). All other branches need a
  // reachable code-viewer server, but no SQLite driver of their own.
  const { runSearchCli } = await import("./search-cli");
  await runSearchCli(process.argv.slice(3));
} else if (process.argv[2] === "file") {
  // `file` delegates blame / history / show straight to git.ts — no SQLite
  // and no running code-viewer server are needed, so the dispatch skips
  // preflight entirely.
  const { runFileCli } = await import("./file-cli");
  await runFileCli(process.argv.slice(3));
} else if (process.argv[2] === "skill") {
  const { runSkillCli } = await import("./skill-cli");
  runSkillCli(process.argv.slice(3));
} else if (process.argv[2] === "doctor") {
  const { runDoctorCli } = await import("./doctor-cli");
  await runDoctorCli(process.argv.slice(3));
} else if (process.argv[2] === "help") {
  // `code-viewer help` mirrors `code-viewer --help` so we don't silently
  // start the server when a new user types the most natural query.
  process.argv[2] = "--help";
  await import("./preview");
} else {
  await import("./preview");
}
