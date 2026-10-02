import { expect, test } from "vitest";
import { nodeVersionSupported } from "../server/node-requirement";

test.each([
  { name: "old major (Node 20)", version: "20.18.0", expected: false },
  { name: "major just below", version: "21.99.0", expected: false },
  { name: "minor just below 22.14", version: "22.13.1", expected: false },
  { name: "on the minimum 22.14.0", version: "22.14.0", expected: true },
  { name: "minor just above 22.14", version: "22.15.0", expected: true },
  { name: "next major", version: "23.0.0", expected: true },
  { name: "current LTS", version: "24.19.0", expected: true },
  { name: "empty", version: "", expected: false },
  { name: "not a version", version: "unknown", expected: false },
])("$name: Node $version supported = $expected", ({ version, expected }) => {
  expect(nodeVersionSupported(version)).toBe(expected);
});
