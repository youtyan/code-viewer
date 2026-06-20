#!/usr/bin/env node

export {};

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
