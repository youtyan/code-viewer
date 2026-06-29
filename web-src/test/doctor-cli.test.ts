import { describe, expect, test } from "bun:test";
import type { DoctorReport } from "../core/doctor-types";
import {
  exitCodeForReport,
  formatDoctorReportText,
  parseDoctorCliArgs,
} from "../server/doctor-cli";

describe("parseDoctorCliArgs", () => {
  test("returns help when --help is present", () => {
    expect(parseDoctorCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseDoctorCliArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseDoctorCliArgs(["help"])).toEqual({ kind: "help" });
  });

  test("returns agent-help when subcommand is agent-help", () => {
    expect(parseDoctorCliArgs(["agent-help"])).toEqual({ kind: "agent-help" });
  });

  test("defaults port to 0 and cwd to process.cwd()", () => {
    const result = parseDoctorCliArgs([]);
    expect(result.kind).toBe("run");
    if (result.kind === "run") {
      expect(result.args.port).toBe(0);
      expect(result.args.json).toBe(false);
      expect(result.args.cwd).toBe(process.cwd());
    }
  });

  test("parses --cwd and --port", () => {
    const result = parseDoctorCliArgs([
      "--cwd",
      "/tmp/example",
      "--port",
      "8080",
      "--json",
    ]);
    expect(result).toEqual({
      kind: "run",
      args: { cwd: "/tmp/example", port: 8080, json: true },
    });
  });

  test("rejects --cwd / --port without a value", () => {
    expect(parseDoctorCliArgs(["--cwd"])).toEqual({
      kind: "error",
      message: "--cwd requires a value",
    });
    expect(parseDoctorCliArgs(["--port"])).toEqual({
      kind: "error",
      message: "--port requires a value",
    });
  });

  test("rejects out-of-range port", () => {
    const result = parseDoctorCliArgs(["--port", "99999"]);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/--port must be 0-65535/);
    }
  });

  test("rejects unknown arguments", () => {
    const result = parseDoctorCliArgs(["--what"]);
    expect(result).toEqual({
      kind: "error",
      message: "unknown argument: --what",
    });
  });
});

const FIXTURE: DoctorReport = {
  generation: 1,
  worstStatus: "warn",
  groups: [
    {
      id: "runtime",
      title: "Runtime",
      rows: [
        {
          id: "runtime.node",
          title: "Node.js",
          status: "ok",
          detail: "v20.18.0",
        },
      ],
    },
    {
      id: "docker",
      title: "Docker",
      rows: [
        {
          id: "docker.compose",
          title: "docker compose",
          status: "warn",
          detail: "0 services running",
          hint: "Start with: docker compose up -d",
        },
      ],
    },
  ],
};

describe("formatDoctorReportText", () => {
  test("renders groups, rows, details, and hints in stable order", () => {
    expect(formatDoctorReportText(FIXTURE)).toBe(
      [
        "✓ Runtime",
        "  ✓ Node.js — v20.18.0",
        "⚠ Docker",
        "  ⚠ docker compose — 0 services running",
        "     hint: Start with: docker compose up -d",
        "",
        "Worst status: warn",
      ].join("\n"),
    );
  });

  test("omits hint when status is ok", () => {
    const report: DoctorReport = {
      generation: 1,
      worstStatus: "ok",
      groups: [
        {
          id: "g",
          title: "G",
          rows: [
            {
              id: "g.row",
              title: "row",
              status: "ok",
              hint: "should not appear",
            },
          ],
        },
      ],
    };
    const text = formatDoctorReportText(report);
    expect(text.includes("should not appear")).toBe(false);
  });
});

describe("exitCodeForReport", () => {
  test("returns 0 for ok and warn, 1 for error", () => {
    expect(exitCodeForReport({ ...FIXTURE, worstStatus: "ok" })).toBe(0);
    expect(exitCodeForReport({ ...FIXTURE, worstStatus: "warn" })).toBe(0);
    expect(exitCodeForReport({ ...FIXTURE, worstStatus: "error" })).toBe(1);
  });
});
