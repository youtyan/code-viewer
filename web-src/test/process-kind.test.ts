// インタプリタ (node など) のペインの中のプログラムを ps で当てる部品
// (server/terminal/process-kind.ts)。ps は偽物で、呼んだ回数を数える。

import { describe, expect, test } from "vitest";
import type { ProcessRow } from "../server/accounts/process-env";
import {
  createProcessKindProber,
  type ProcessKindDeps,
  parseProcessArgs,
} from "../server/terminal/process-kind";

/** シェル 100 の下に node 101、シェル 200 の下に zsh だけ。 */
const ROWS: ProcessRow[] = [
  { pid: 100, ppid: 1, comm: "-zsh" },
  { pid: 101, ppid: 100, comm: "node" },
  { pid: 200, ppid: 1, comm: "-zsh" },
];

function fake(args: Record<number, string>) {
  const calls = { list: 0, args: [] as number[][] };
  const deps: ProcessKindDeps = {
    async listProcesses() {
      calls.list += 1;
      return ROWS;
    },
    async readArgs(pids) {
      calls.args.push(pids);
      return new Map(
        pids.flatMap((pid) =>
          args[pid] === undefined ? [] : [[pid, args[pid]] as const],
        ),
      );
    },
  };
  return { deps, calls };
}

describe("process kind prober", () => {
  test("reads only interpreter panes, and only again when the pane or command changes", async () => {
    const { deps, calls } = fake({
      101: "node /opt/sample/lib/node_modules/@anthropic-ai/claude-code/cli.js",
    });
    const prober = createProcessKindProber(deps);
    const targets = [
      { id: "%1", pid: 100, command: "node" },
      { id: "%2", pid: 200, command: "zsh" },
      { id: "%3", pid: 300, command: "claude" },
    ];
    const first = await prober.probe(targets);
    expect([...first.kinds]).toEqual([["%1", "claude"]]);
    expect(first.errors).toEqual([]);
    expect(calls.args).toEqual([[101]]);

    // 同じペイン・同じコマンドなら覚えた値で答え、ps を呼ばない。
    const again = await prober.probe(targets);
    expect([...again.kinds]).toEqual([["%1", "claude"]]);
    expect(calls).toEqual({ list: 1, args: [[101]] });

    // コマンドがシェルに戻ったら忘れ、また node になったら調べ直す。
    await prober.probe([{ id: "%1", pid: 100, command: "zsh" }]);
    await prober.probe([{ id: "%1", pid: 100, command: "node" }]);
    expect(calls.list).toBe(2);
  });

  test("a script that is not an agent is remembered as no kind", async () => {
    const { deps, calls } = fake({ 101: "node /work/sample/server.js" });
    const prober = createProcessKindProber(deps);
    const target = [{ id: "%1", pid: 100, command: "node" }];
    expect([...(await prober.probe(target)).kinds]).toEqual([["%1", null]]);
    await prober.probe(target);
    expect(calls.list).toBe(1);
  });

  test("a failed ps is reported with the pane and asked again next time", async () => {
    let fail = true;
    const prober = createProcessKindProber({
      async listProcesses() {
        if (fail)
          throw new Error("ps -A exited with 1\nstderr: sample failure");
        return ROWS;
      },
      async readArgs() {
        return new Map([[101, "node /opt/sample/bin/codex"]]);
      },
    });
    const target = [{ id: "%1", pid: 100, command: "node" }];
    const failed = await prober.probe(target);
    expect(failed.kinds.size).toBe(0);
    expect(failed.errors).toHaveLength(1);
    expect(failed.errors[0]?.target).toBe("%1");
    expect(String(failed.errors[0]?.error)).toContain(
      "could not read the processes of %1",
    );
    fail = false;
    expect([...(await prober.probe(target)).kinds]).toEqual([["%1", "codex"]]);
  });

  test("no matching process, or one that ended, is an error and not remembered", async () => {
    const { deps } = fake({});
    const prober = createProcessKindProber(deps);
    const result = await prober.probe([
      { id: "%1", pid: 100, command: "node" },
      { id: "%2", pid: 200, command: "bun" },
    ]);
    expect(result.kinds.size).toBe(0);
    expect(result.errors.map((item) => String(item.error))).toEqual([
      "Error: no process named bun under the pane's shell (pid 200)",
      "Error: the node process 101 ended before its arguments were read",
    ]);
  });

  test("parses ps -o pid=,args= lines", () => {
    expect([
      ...parseProcessArgs("  101 node /opt/sample/bin/claude\n 7 \n"),
    ]).toEqual([
      [101, "node /opt/sample/bin/claude"],
      [7, ""],
    ]);
  });
});
