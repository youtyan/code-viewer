#!/usr/bin/env node

export {};

if (process.argv[2] === "annotate") {
  const { runAnnotateCli } = await import("./annotate-cli");
  await runAnnotateCli(process.argv.slice(3));
} else {
  await import("./preview");
}
