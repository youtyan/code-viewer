// tmux ペイン一覧は、ペインを「このリポジトリのもの」に絞るために git へ
// 作業ツリー一覧を訊く。サーバが cwd を git 管理外だと知っているときは、
// 注入した worktreePaths に置き換わって git が起動しないことを見る。
// 以前は管理外だと /_tmux/panes と terminal/activity の巡回のたびに
// `git worktree list` が失敗し、そのログでコンソールが埋まっていた。

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  configureExternalCommands,
  resetExternalCommandsForTest,
} from "../server/command-resolver";
import { handleTmuxRoute } from "../server/tmux/handle";
import { listTmuxPanes } from "../server/tmux/panes";
import { captureIo, restoreIo } from "./_io-fixture";

const tmpRoots: string[] = [];

afterEach(() => {
  restoreIo();
  resetExternalCommandsForTest();
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

/**
 * tmux は空のペイン一覧を返し、git は呼ばれた印を残してから「リポジトリでは
 * ない」で落ちる。印の有無で git が起動したかどうかを見る。
 */
function configureFakeCommands(cwd: string): { gitMarker: string } {
  const bin = tempRoot("code-viewer-tmux-lookup-bin-");
  const gitMarker = join(bin, "git-was-called");
  const gitPath = join(bin, "git");
  writeFileSync(
    gitPath,
    [
      "#!/bin/sh",
      `printf x >> "${gitMarker}"`,
      "printf 'fatal: not a git repository\\n' >&2",
      "exit 128",
      "",
    ].join("\n"),
  );
  chmodSync(gitPath, 0o755);
  const tmuxPath = join(bin, "tmux");
  writeFileSync(tmuxPath, "#!/bin/sh\nexit 0\n");
  chmodSync(tmuxPath, 0o755);
  const configured = configureExternalCommands({
    cwd,
    env: {},
    cliOverrides: [
      { name: "git", path: gitPath },
      { name: "tmux", path: tmuxPath },
    ],
    allowedNames: ["git", "tmux"],
  });
  expect(configured).toEqual({ ok: true });
  return { gitMarker };
}

const noWorktrees = async () => [];

describe("tmux pane list worktree lookup", () => {
  test.each([
    {
      name: "asks git by default and reports the failure once per list",
      options: {},
      gitCalled: true,
      logged: [
        "[code-viewer] git worktree list failed (git exit 128): fatal: not a git repository",
      ],
    },
    {
      name: "uses the injected lookup and leaves git alone",
      options: { worktreePaths: noWorktrees },
      gitCalled: false,
      logged: [],
    },
  ])("$name", async ({ options, gitCalled, logged }) => {
    const cwd = tempRoot("code-viewer-tmux-lookup-cwd-");
    const { gitMarker } = configureFakeCommands(cwd);
    const io = captureIo();

    const panes = await listTmuxPanes(cwd, options);

    expect(panes).toEqual({ available: true, running: true, sessions: [] });
    expect(existsSync(gitMarker)).toBe(gitCalled);
    expect(io.errs).toEqual(logged);
  });

  test("the route hands the injected lookup to the pane list", async () => {
    const cwd = tempRoot("code-viewer-tmux-lookup-route-");
    const { gitMarker } = configureFakeCommands(cwd);
    const io = captureIo();
    const url = new URL("http://127.0.0.1:0/_tmux/panes");

    const res = await handleTmuxRoute(new Request(url), url, cwd, () => true, {
      worktreePaths: noWorktrees,
    });

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({
      available: true,
      running: true,
      sessions: [],
    });
    expect(existsSync(gitMarker)).toBe(false);
    expect(io.errs).toEqual([]);
  });
});
