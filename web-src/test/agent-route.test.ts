// /_agent/* の入口と、その裏にある状態ストア。
//
// tmux を実際に叩くケースは環境依存なので扱わない。ここで見るのは、入口が
// 弾くべきものを弾くことと、申告が当て推量で上書きされないこと。後者を
// 落とすと、待っているセッションが停止扱いになって見落としに直結する。

import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { AgentEvent, AgentState } from "../core/agent-state";
import { MAX_TERMINAL_IMAGE_QUERY } from "../core/terminal-images";
import { MAX_PASTE_IMAGE_BYTES } from "../core/terminal-paste";
import {
  clearAgentStates,
  getAgentState,
  listAgentStates,
  recordAgentState,
  retainAgentStates,
  setAgentTmuxGeneration,
} from "../server/terminal/agent-state";
import { handleAgentRoute } from "../server/terminal/handle";
import {
  resolveTerminalImage,
  resolveTerminalImages,
} from "../server/terminal/images";
import { callRoute, postRoute } from "./_test-helpers";

const DENY_SIDE_EFFECTS = () => false;
const PANE = "%12";
const SHELL = "shell-abc123";

const call = (
  path: string,
  init?: RequestInit,
  sideEffectAllowed?: (req: Request) => boolean,
) => callRoute(handleAgentRoute, path, init, sideEffectAllowed);

const post = (
  path: string,
  body: unknown,
  sideEffectAllowed?: (req: Request) => boolean,
) => postRoute(handleAgentRoute, path, body, sideEffectAllowed);

beforeEach(() => {
  clearAgentStates();
});

describe("agent route dispatch", () => {
  test("passes an unknown path through to the next handler", async () => {
    expect(await call("/_agent/nope")).toBeNull();
  });

  test.each([
    { name: "rejects POST on the state list", path: "/_agent/states" },
    { name: "rejects POST on capture", path: "/_agent/capture" },
  ])("$name", async ({ path }) => {
    const res = await call(path, { method: "POST" });
    expect(res?.status).toBe(405);
  });

  test("rejects GET on the state report", async () => {
    const res = await call("/_agent/state");
    expect(res?.status).toBe(405);
  });

  test("refuses to record a state without side-effect permission", async () => {
    const res = await post(
      "/_agent/state",
      { target: PANE, event: "ask" },
      DENY_SIDE_EFFECTS,
    );
    expect(res?.status).toBe(403);
    expect(getAgentState(PANE)).toBeNull();
  });
});

describe("state report validation", () => {
  test.each([
    { name: "rejects a missing target", body: { event: "ask" } },
    { name: "rejects an empty target", body: { target: "", event: "ask" } },
    {
      name: "rejects a target that is neither pane nor shell",
      body: { target: "pane-12", event: "ask" },
    },
    {
      name: "rejects a shell metacharacter in the target",
      body: { target: "shell-abc;rm", event: "ask" },
    },
    {
      name: "rejects a non-string target",
      body: { target: 12, event: "ask" },
    },
  ])("$name", async ({ body }) => {
    const res = await post("/_agent/state", body);
    expect(res?.status).toBe(400);
  });

  test.each([
    { name: "rejects a missing event", body: { target: PANE } },
    {
      name: "rejects an unknown event",
      body: { target: PANE, event: "blocked" },
    },
    {
      name: "rejects a state name used as an event",
      body: { target: PANE, event: "waiting" },
    },
  ])("$name", async ({ body }) => {
    const res = await post("/_agent/state", body);
    expect(res?.status).toBe(400);
  });
});

describe("state report and readback", () => {
  test.each([
    { name: "prompt becomes working", event: "prompt", expected: "working" },
    { name: "ask becomes waiting", event: "ask", expected: "waiting" },
    { name: "stop becomes done", event: "stop", expected: "done" },
    { name: "exit becomes idle", event: "exit", expected: "idle" },
  ] satisfies {
    name: string;
    event: AgentEvent;
    expected: AgentState;
  }[])("$name", async ({ event, expected }) => {
    const res = await post("/_agent/state", { target: PANE, event });
    expect(res?.status).toBe(200);
    expect(getAgentState(PANE)?.state).toBe(expected);
  });

  test("accepts a browser shell id as the target", async () => {
    const res = await post("/_agent/state", { target: SHELL, event: "ask" });
    expect(res?.status).toBe(200);
    expect(getAgentState(SHELL)?.state).toBe("waiting");
  });

  test("keeps the last instruction when a later event omits it", async () => {
    await post("/_agent/state", {
      target: PANE,
      event: "prompt",
      lastPrompt: "run the failing test",
    });
    await post("/_agent/state", { target: PANE, event: "stop" });
    const record = getAgentState(PANE);
    expect(record?.state).toBe("done");
    expect(record?.lastPrompt).toBe("run the failing test");
  });

  test("lists every reported target", async () => {
    await post("/_agent/state", { target: PANE, event: "ask" });
    await post("/_agent/state", { target: SHELL, event: "prompt" });
    const res = await call("/_agent/states");
    const body = (await res?.json()) as {
      states: { target: string }[];
      errors: unknown[];
    };
    expect(body.states.map((s) => s.target).sort()).toEqual([PANE, SHELL]);
    expect(body.errors).toEqual([]);
  });

  test("reports an unknown target as missing", async () => {
    const res = await call("/_agent/states?target=%25999");
    expect(res?.status).toBe(404);
  });
});

describe("tmux generation state keys", () => {
  test("a hook report attaches to the current generation after reused ids are cleared", () => {
    expect(setAgentTmuxGeneration("4242:1")).toEqual({
      changed: false,
      previous: null,
    });
    recordAgentState({ target: PANE, event: "ask", source: "hook" });
    expect(getAgentState(PANE)?.state).toBe("waiting");

    expect(setAgentTmuxGeneration("5252:2")).toEqual({
      changed: true,
      previous: "4242:1",
    });
    expect(getAgentState(PANE)).toBeNull();
    recordAgentState({ target: PANE, event: "prompt", source: "hook" });
    expect(getAgentState(PANE)?.state).toBe("working");
  });
});

describe("未読を解く", () => {
  // これが無いと、人間が結果を読んでも次の指示まで「あなたの番」に残り続ける。
  test("読んだら未読が解ける", async () => {
    await post("/_agent/state", { target: PANE, event: "stop" });
    expect(getAgentState(PANE)?.state).toBe("done");
    await post("/_agent/state", { target: PANE, event: "read" });
    expect(getAgentState(PANE)?.state).toBe("idle");
  });

  test("入力待ちは読んでも解けない", async () => {
    await post("/_agent/state", { target: PANE, event: "ask" });
    await post("/_agent/state", { target: PANE, event: "read" });
    expect(getAgentState(PANE)?.state).toBe("waiting");
  });
});

describe("申告の到着順", () => {
  // フックは別プロセスから HTTP で届くので、送った順に着くとは限らない。
  test("古い申告は新しい申告を上書きしない", async () => {
    await post("/_agent/state", { target: PANE, event: "stop", at: 2000 });
    await post("/_agent/state", { target: PANE, event: "progress", at: 1000 });
    expect(getAgentState(PANE)?.state).toBe("done");
  });

  test("新しい申告は反映される", async () => {
    await post("/_agent/state", { target: PANE, event: "stop", at: 1000 });
    await post("/_agent/state", { target: PANE, event: "prompt", at: 2000 });
    expect(getAgentState(PANE)?.state).toBe("working");
  });

  test("直前に当て推量が入っていても申告は通る", async () => {
    // 当て推量は観測した瞬間の時刻を持つ。申告のほうが少し前に発生していても
    // 古いとみなして捨てると、待ちや未読が画面に出なくなる。
    recordAgentState({
      target: PANE,
      state: "working",
      source: "activity",
      at: 9000,
    });
    await post("/_agent/state", { target: PANE, event: "stop", at: 1000 });
    expect(getAgentState(PANE)?.state).toBe("done");
    expect(getAgentState(PANE)?.source).toBe("hook");
  });
});

describe("外から状態を直接置けない", () => {
  // 置けてしまうと {event:"stop", state:"working"} のような食い違いが通る。
  test("state を添えても event の意味で記録される", async () => {
    const res = await post("/_agent/state", {
      target: PANE,
      event: "stop",
      state: "working",
    });
    expect(res?.status).toBe(200);
    expect(getAgentState(PANE)?.state).toBe("done");
  });

  test("state だけでは記録できない", async () => {
    const res = await post("/_agent/state", { target: PANE, state: "waiting" });
    expect(res?.status).toBe(400);
    expect(getAgentState(PANE)).toBeNull();
  });
});

describe("一覧の並び", () => {
  test("人間の番のものが先に来る", async () => {
    await post("/_agent/state", { target: PANE, event: "prompt", at: 1000 });
    await post("/_agent/state", { target: SHELL, event: "ask", at: 5000 });
    const res = await call("/_agent/states");
    const body = (await res?.json()) as { states: { target: string }[] };
    // 稼働中のほうが古いが、待っているものを先に出す。
    expect(body.states[0]?.target).toBe(SHELL);
  });
});

describe("消えた対象の掃除", () => {
  test("棚卸しに載っていない対象は落ちる", () => {
    recordAgentState({ target: PANE, event: "ask", source: "hook" });
    recordAgentState({ target: SHELL, event: "prompt", source: "hook" });
    expect(retainAgentStates(new Set([PANE]))).toBe(1);
    expect(getAgentState(SHELL)).toBeNull();
    expect(getAgentState(PANE)?.state).toBe("waiting");
  });
});

describe("hook reports win over guesses", () => {
  // 当て推量は「動いている / 止まっている」しか分からない。申告済みの対象へ
  // 書き込ませると、待ちが停止に化けて人間が気付けなくなる。
  test("a guess does not overwrite a reported waiting state", () => {
    recordAgentState({ target: PANE, event: "ask", source: "hook" });
    recordAgentState({ target: PANE, state: "idle", source: "activity" });
    expect(getAgentState(PANE)?.state).toBe("waiting");
    expect(getAgentState(PANE)?.source).toBe("hook");
  });

  test("a guess fills in a target that never reported", () => {
    recordAgentState({ target: PANE, state: "working", source: "activity" });
    expect(getAgentState(PANE)?.state).toBe("working");
    expect(getAgentState(PANE)?.source).toBe("activity");
  });

  test("明示的な画面ルールは取りこぼされた申告状態を更新する", () => {
    recordAgentState({ target: PANE, event: "prompt", source: "hook" });
    recordAgentState({
      target: PANE,
      state: "waiting",
      source: "screen",
      override: true,
    });
    expect(getAgentState(PANE)?.state).toBe("waiting");
    expect(getAgentState(PANE)?.source).toBe("screen");
  });

  test("画面判定が同じ状態の間は状態変更時刻を動かさない", () => {
    recordAgentState({
      target: PANE,
      state: "working",
      source: "screen",
      at: 1000,
    });
    recordAgentState({
      target: PANE,
      state: "working",
      source: "screen",
      at: 2000,
    });
    expect(getAgentState(PANE)?.updatedAt).toBe(1000);
    recordAgentState({
      target: PANE,
      state: "idle",
      source: "screen",
      at: 3000,
    });
    expect(getAgentState(PANE)?.updatedAt).toBe(3000);
  });

  // 経過時間として出してよいのは、状態が変わった瞬間を見たときだけ。
  // 見始めた時点で既にその状態だったもの (最初の観測) は下限でしかない。
  test.each<{
    name: string;
    steps: {
      state?: AgentState;
      event?: AgentEvent;
      source: "hook" | "screen" | "activity";
    }[];
    changeObserved: boolean;
  }>([
    {
      name: "最初の画面観測は、変わった瞬間を見ていない",
      steps: [{ state: "idle", source: "screen" }],
      changeObserved: false,
    },
    {
      name: "同じ状態を見続けても、見ていないまま",
      steps: [
        { state: "idle", source: "screen" },
        { state: "idle", source: "activity" },
      ],
      changeObserved: false,
    },
    {
      name: "観測中に状態が変わったら、変わった瞬間を見た",
      steps: [
        { state: "idle", source: "screen" },
        { state: "working", source: "screen" },
      ],
      changeObserved: true,
    },
    {
      name: "変わった後に同じ状態を見続けても、見たまま",
      steps: [
        { state: "idle", source: "screen" },
        { state: "working", source: "screen" },
        { state: "working", source: "activity" },
      ],
      changeObserved: true,
    },
    {
      name: "申告は出来事の時刻なので、最初の 1 件でも見たことになる",
      steps: [{ event: "ask", source: "hook" }],
      changeObserved: true,
    },
  ])("changeObserved: $name", ({ steps, changeObserved }) => {
    steps.forEach((step, index) => {
      recordAgentState({ target: PANE, ...step, at: 1000 * (index + 1) });
    });
    expect(getAgentState(PANE)?.changeObserved).toBe(changeObserved);
  });

  test("a later hook report overwrites an earlier one", () => {
    recordAgentState({ target: PANE, event: "ask", source: "hook" });
    recordAgentState({ target: PANE, event: "stop", source: "hook" });
    expect(getAgentState(PANE)?.state).toBe("done");
  });

  test("画面の待機判定は未読の完了状態を消さない", () => {
    recordAgentState({ target: PANE, event: "stop", source: "hook" });
    recordAgentState({
      target: PANE,
      state: "idle",
      source: "screen",
      override: true,
    });

    expect(getAgentState(PANE)?.state).toBe("done");
    expect(getAgentState(PANE)?.source).toBe("hook");
  });

  // 申告が一度入ったきり更新されないと、そのセッションは永久に「あなたの番」
  // へ居座る。画面が動き続けているなら入力待ちではありえないので、そこだけ
  // 当て推量で稼働へ上げられるようにしてある。
  test("動き続けている対象は、申告の待ちを稼働へ上げられる", () => {
    recordAgentState({ target: PANE, event: "ask", source: "hook" });
    recordAgentState({
      target: PANE,
      state: "working",
      source: "activity",
      override: true,
    });
    expect(getAgentState(PANE)?.state).toBe("working");
    expect(getAgentState(PANE)?.source).toBe("activity");
  });

  test.each([
    {
      name: "上げる合図が無ければ据え置き",
      state: "working" as const,
      override: false,
    },
    {
      name: "停止へ落とすのは合図があっても許さない",
      state: "idle" as const,
      override: true,
    },
  ])("$name", ({ state, override }) => {
    // 待ちを停止へ落とすと、長く待たせているものが一覧から消えて見落とす。
    recordAgentState({ target: PANE, event: "ask", source: "hook" });
    recordAgentState({ target: PANE, state, source: "activity", override });
    expect(getAgentState(PANE)?.state).toBe("waiting");
    expect(getAgentState(PANE)?.source).toBe("hook");
  });

  test("ignores a record with neither event nor state", () => {
    expect(recordAgentState({ target: PANE, source: "hook" })).toBeNull();
    expect(listAgentStates()).toHaveLength(0);
  });
});

describe("画像の貼り付け", () => {
  // 1x1 の PNG。中身の妥当性ではなく、入口の検証だけを見る。
  const PNG_1PX =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  test("副作用の許可が無ければ保存しない", async () => {
    const res = await post(
      "/_agent/paste",
      { mime: "image/png", data: PNG_1PX },
      DENY_SIDE_EFFECTS,
    );
    expect(res?.status).toBe(403);
  });

  test("GET は受け付けない", async () => {
    const res = await call("/_agent/paste");
    expect(res?.status).toBe(405);
  });

  test.each([
    { name: "種類が無い", body: { data: PNG_1PX } },
    { name: "SVG は受けない", body: { mime: "image/svg+xml", data: PNG_1PX } },
    { name: "画像でない", body: { mime: "text/plain", data: PNG_1PX } },
    { name: "本文が無い", body: { mime: "image/png" } },
    {
      name: "本文が base64 でない",
      body: { mime: "image/png", data: "not base64!!" },
    },
    {
      name: "data URL が付いたまま",
      body: { mime: "image/png", data: `data:image/png;base64,${PNG_1PX}` },
    },
    { name: "本文が空", body: { mime: "image/png", data: "" } },
  ])("$name ものは弾く", async ({ body }) => {
    const res = await post("/_agent/paste", body);
    expect(res?.status).toBe(400);
  });

  test("保存できないときは 500 の本文に理由を出す", async () => {
    const repo = mkdtempSync(join(tmpdir(), "code-viewer-paste-"));
    // 置き場所の親がファイルなので mkdir が失敗する。
    writeFileSync(join(repo, ".code-viewer"), "not a directory");
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const res = await postRoute(
        handleAgentRoute,
        "/_agent/paste",
        { mime: "image/png", data: PNG_1PX },
        undefined,
        repo,
      );
      expect(res?.status).toBe(500);
      expect(await res?.text()).toMatch(
        /^failed to save image: Error: .*\nDetails: \{.*"syscall":"mkdir".*\}$/s,
      );
    } finally {
      errors.mockRestore();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("capture validation", () => {
  test.each([
    { name: "rejects a missing target", query: "" },
    { name: "rejects an empty target", query: "?target=" },
    { name: "rejects a bare name", query: "?target=pane12" },
    { name: "rejects a shell metacharacter", query: "?target=shell-abc;id" },
    { name: "rejects a path traversal attempt", query: "?target=shell-../etc" },
  ])("$name", async ({ query }) => {
    const res = await call(`/_agent/capture${query}`);
    expect(res?.status).toBe(400);
  });

  test("reports a shell that does not exist as gone", async () => {
    // シェルはこのプロセス内にしか無いので、tmux を触らずに 410 を確かめられる。
    const res = await call(`/_agent/capture?target=${SHELL}`);
    expect(res?.status).toBe(410);
  });
});

describe("出力から拾った画像の解決", () => {
  // 候補は端末に流れた文字列そのもの。置き場は問わないが、配れるのは
  // 「許可した拡張子・通常のファイル・上限バイト数まで・空でない・読める」
  // ものだけ。配れないときは理由を区別して返す。
  let repo = "";
  let outside = "";
  /** repo の 1 つ上にある画像。リポジトリの外も配ることを見るのに使う。 */
  let parentImage = "";
  /** 権限を外した画像。root で走っていると読めてしまうので、そのときは見ない。 */
  let lockedReadable = false;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "code-viewer-terminal-image-"));
    outside = mkdtempSync(join(tmpdir(), "code-viewer-terminal-outside-"));
    parentImage = `${basename(repo)}-parent.png`;
    writeFileSync(join(repo, "..", parentImage), "png");
    mkdirSync(join(repo, "docs"));
    mkdirSync(join(repo, "dir.png"));
    mkdirSync(join(repo, "my shots"));
    mkdirSync(join(repo, ".code-viewer", "pasted"), { recursive: true });
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, "shot.png"), "png");
    writeFileSync(join(repo, "docs", "inner.png"), "png");
    writeFileSync(join(repo, "my shots", "a b.png"), "png");
    writeFileSync(join(repo, ".code-viewer", "pasted", "paste-1.png"), "png");
    writeFileSync(join(repo, ".git", "internal.png"), "png");
    writeFileSync(join(repo, "notes.txt"), "text");
    writeFileSync(join(repo, "diagram.svg"), "<svg/>");
    writeFileSync(join(repo, "empty.png"), "");
    writeFileSync(
      join(repo, "huge.png"),
      Buffer.alloc(MAX_PASTE_IMAGE_BYTES + 1),
    );
    writeFileSync(join(repo, "locked.png"), "png");
    chmodSync(join(repo, "locked.png"), 0o000);
    try {
      accessSync(join(repo, "locked.png"), constants.R_OK);
      lockedReadable = true;
    } catch {
      lockedReadable = false;
    }
    writeFileSync(join(outside, "outside.png"), "png");
    symlinkSync(join(outside, "outside.png"), join(repo, "escape.png"));
    symlinkSync(join(outside, "gone.png"), join(repo, "dangling.png"));
  });

  afterAll(() => {
    chmodSync(join(repo, "locked.png"), 0o644);
    rmSync(join(repo, "..", parentImage), { force: true });
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  /** 実体のパス。mkdtemp は symlink 越し (/tmp → /private/tmp) のことがある。 */
  const real = (...parts: string[]) => realpathSync(join(...parts));
  const ok = (path: string, bytes = 3) => ({
    status: "ok",
    image: { path, bytes, mtimeMs: statSync(path).mtimeMs },
  });

  test.each([
    {
      name: "リポジトリ相対のパス",
      candidate: () => "shot.png",
      expected: () => ok(real(repo, "shot.png")),
    },
    {
      name: "絶対パスでも同じ 1 枚",
      candidate: () => join(repo, "shot.png"),
      expected: () => ok(real(repo, "shot.png")),
    },
    {
      name: "./ 付き",
      candidate: () => "./shot.png",
      expected: () => ok(real(repo, "shot.png")),
    },
    {
      name: "下の階層",
      candidate: () => "docs/inner.png",
      expected: () => ok(real(repo, "docs", "inner.png")),
    },
    {
      name: "空白を含むパス",
      candidate: () => "my shots/a b.png",
      expected: () => ok(real(repo, "my shots", "a b.png")),
    },
    {
      name: "貼り付けの置き場 (gitignore されていても配る)",
      candidate: () => ".code-viewer/pasted/paste-1.png",
      expected: () => ok(real(repo, ".code-viewer", "pasted", "paste-1.png")),
    },
    {
      name: "リポジトリ外の絶対パス (エージェントの作業用ディレクトリ)",
      candidate: () => join(outside, "outside.png"),
      expected: () => ok(real(outside, "outside.png")),
    },
    {
      name: ".. でリポジトリの外へ出るパス",
      candidate: () => `../${parentImage}`,
      expected: () => ok(real(repo, "..", parentImage)),
    },
    {
      name: "symlink は実体のパスで返す",
      candidate: () => "escape.png",
      expected: () => ok(real(outside, "outside.png")),
    },
    {
      name: ".git の中も置き場としては区別しない",
      candidate: () => ".git/internal.png",
      expected: () => ok(real(repo, ".git", "internal.png")),
    },
    {
      name: "実在しない",
      candidate: () => "missing.png",
      expected: () => ({
        status: "rejected",
        reason: "missing",
        path: join(repo, "missing.png"),
      }),
    },
    {
      name: "先の無い symlink は実在しない扱い",
      candidate: () => "dangling.png",
      expected: () => ({
        status: "rejected",
        reason: "missing",
        path: join(repo, "dangling.png"),
      }),
    },
    {
      name: "画像でない",
      candidate: () => "notes.txt",
      expected: () => ({
        status: "rejected",
        reason: "unsupported",
        path: join(repo, "notes.txt"),
      }),
    },
    {
      name: "SVG は配らない",
      candidate: () => "diagram.svg",
      expected: () => ({
        status: "rejected",
        reason: "unsupported",
        path: join(repo, "diagram.svg"),
      }),
    },
    {
      name: "拡張子が無い",
      candidate: () => "Makefile",
      expected: () => ({
        status: "rejected",
        reason: "unsupported",
        path: join(repo, "Makefile"),
      }),
    },
    {
      name: "空のファイル",
      candidate: () => "empty.png",
      expected: () => ({
        status: "rejected",
        reason: "empty",
        path: real(repo, "empty.png"),
        bytes: 0,
      }),
    },
    {
      name: "上限を超えた大きさ",
      candidate: () => "huge.png",
      expected: () => ({
        status: "rejected",
        reason: "too-large",
        path: real(repo, "huge.png"),
        bytes: MAX_PASTE_IMAGE_BYTES + 1,
      }),
    },
    {
      name: "拡張子がそう見えるディレクトリ",
      candidate: () => "dir.png",
      expected: () => ({
        status: "rejected",
        reason: "not-file",
        path: real(repo, "dir.png"),
      }),
    },
    {
      name: "空文字",
      candidate: () => "",
      expected: () => ({ status: "rejected", reason: "invalid", path: "" }),
    },
    {
      name: "NUL 入り",
      candidate: () => `shot${String.fromCharCode(0)}.png`,
      expected: () => ({ status: "rejected", reason: "invalid", path: "" }),
    },
    {
      name: "文字列でない",
      candidate: () => 42,
      expected: () => ({ status: "rejected", reason: "invalid", path: "" }),
    },
  ])("$name", ({ candidate, expected }) => {
    expect(resolveTerminalImage(repo, candidate())).toEqual(expected());
  });

  test("読めないファイルは理由と OS のエラーを返す", () => {
    const result = resolveTerminalImage(repo, "locked.png");
    // root で走っていると権限を外しても読める。そのときは配れることを見る。
    if (lockedReadable) {
      expect(result).toMatchObject({ status: "ok" });
      return;
    }
    expect(result).toEqual({
      status: "rejected",
      reason: "unreadable",
      path: real(repo, "locked.png"),
      detail: expect.stringMatching(/^EACCES: /),
    });
  });

  test("~/ はホームから解く", () => {
    const previous = process.env.HOME;
    process.env.HOME = repo;
    try {
      expect(resolveTerminalImage(outside, "~/shot.png")).toEqual(
        ok(real(repo, "shot.png")),
      );
    } finally {
      process.env.HOME = previous;
    }
  });

  test("相対パスは渡された起点 (ペインの作業場所) から解く", () => {
    // 起点が repo/docs なら inner.png はそこにある。repo から解くと無い。
    expect(resolveTerminalImage(join(repo, "docs"), "inner.png")).toEqual(
      ok(real(repo, "docs", "inner.png")),
    );
    expect(resolveTerminalImage(repo, "inner.png")).toMatchObject({
      status: "rejected",
      reason: "missing",
    });
  });

  test("同じ 1 枚を指す綴りが並んでも 1 つだけ返す", () => {
    // symlink 経由の綴りも実体で突き合わせるので、同じ 1 枚に畳まれる。
    const path = real(repo, "shot.png");
    const { mtimeMs } = statSync(path);
    const { images, rejected } = resolveTerminalImages(repo, [
      "shot.png",
      "./shot.png",
      join(repo, "shot.png"),
    ]);
    expect(rejected).toEqual([]);
    expect(images).toEqual([
      {
        path,
        // 画面で探すのは最初に見つけた綴り。実体のパスとは別に返す。
        candidate: "shot.png",
        name: "shot.png",
        // URL に更新時刻と大きさを入れる (上書きされれば URL が変わる)。
        url: `/_agent/image?path=${encodeURIComponent(path)}&v=${Math.trunc(mtimeMs)}-3`,
        bytes: 3,
        mtimeMs,
      },
    ]);
  });

  test("symlink と実体を両方渡しても 1 枚", () => {
    const { images } = resolveTerminalImages(repo, [
      "escape.png",
      join(outside, "outside.png"),
    ]);
    expect(images.map((image) => image.path)).toEqual([
      real(outside, "outside.png"),
    ]);
  });

  test("配れないものは理由つきで別に返す", () => {
    const { images, rejected } = resolveTerminalImages(repo, [
      "missing.png",
      "shot.png",
      "huge.png",
    ]);
    expect(images.map((image) => image.name)).toEqual(["shot.png"]);
    expect(rejected).toEqual([
      {
        candidate: "missing.png",
        path: join(repo, "missing.png"),
        name: "missing.png",
        reason: "missing",
      },
      {
        candidate: "huge.png",
        path: real(repo, "huge.png"),
        name: "huge.png",
        reason: "too-large",
        bytes: MAX_PASTE_IMAGE_BYTES + 1,
      },
    ]);
  });

  test("上限を超えて渡された分は見ない", () => {
    // 1 回の問い合わせで触るファイル数を抑える。溢れた分は次のフレームで
    // また拾えるので、取りこぼしにはならない。
    const filler = Array.from(
      { length: MAX_TERMINAL_IMAGE_QUERY },
      (_, index) => `missing-${index}.png`,
    );
    const result = resolveTerminalImages(repo, [...filler, "shot.png"]);
    expect(result.images).toEqual([]);
    expect(result.rejected).toHaveLength(MAX_TERMINAL_IMAGE_QUERY);
  });
});

describe("/_agent/images", () => {
  test("POST は受け付けない", async () => {
    const res = await call("/_agent/images", { method: "POST" });
    expect(res?.status).toBe(405);
  });

  test("候補が無ければ空で返す", async () => {
    const res = await call("/_agent/images");
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({
      images: [],
      rejected: [],
      base: { source: "repo", cwd: process.cwd() },
    });
  });

  test("リポジトリの画像を実体のパスと URL で返す", async () => {
    // テストの cwd はこのリポジトリ。追跡されている画像で確かめる。
    const path = realpathSync(join(process.cwd(), "web/favicon.png"));
    const { size, mtimeMs } = statSync(path);
    const res = await call("/_agent/images?path=web%2Ffavicon.png");
    expect(await res?.json()).toEqual({
      images: [
        {
          path,
          candidate: "web/favicon.png",
          name: "favicon.png",
          url: `/_agent/image?path=${encodeURIComponent(path)}&v=${Math.trunc(mtimeMs)}-${size}`,
          bytes: size,
          mtimeMs,
        },
      ],
      rejected: [],
      base: { source: "repo", cwd: process.cwd() },
    });
  });

  test("リポジトリの外にある画像も返す", async () => {
    // エージェントが作る画像は作業用の一時ディレクトリに出ることが多い。
    const outside = mkdtempSync(join(tmpdir(), "code-viewer-image-route-"));
    try {
      writeFileSync(join(outside, "outside.png"), "png");
      const path = realpathSync(join(outside, "outside.png"));
      const res = await call(`/_agent/images?path=${encodeURIComponent(path)}`);
      const body = await res?.json();
      expect(body.images).toEqual([
        expect.objectContaining({ path, candidate: path, name: "outside.png" }),
      ]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test.each([
    { name: "shell の形が違う", query: "?shell=%2512&path=a.png" },
    { name: "shell が空", query: "?shell=&path=a.png" },
  ])("$name ときは 400", async ({ query }) => {
    const res = await call(`/_agent/images${query}`);
    expect(res?.status).toBe(400);
  });

  test("もう無いシェルならリポジトリの根から解く", async () => {
    const res = await call(
      `/_agent/images?shell=${SHELL}&path=web%2Ffavicon.png`,
    );
    const body = await res?.json();
    expect(body.base).toEqual({ source: "repo", cwd: process.cwd() });
    expect(body.images).toHaveLength(1);
  });
});

describe("/_agent/images/history", () => {
  test("POST は受け付けない", async () => {
    const res = await call("/_agent/images/history", { method: "POST" });
    expect(res?.status).toBe(405);
  });

  test.each([
    { name: "shell が無い", query: "" },
    { name: "shell の形が違う", query: "?shell=%2512" },
  ])("$name ときは 400", async ({ query }) => {
    const res = await call(`/_agent/images/history${query}`);
    expect(res?.status).toBe(400);
  });

  test("もう無いシェルは何も拾わない", async () => {
    // シェルはこのプロセス内にしか無いので、tmux を触らずに確かめられる。
    const res = await call(`/_agent/images/history?shell=${SHELL}`);
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({
      images: [],
      rejected: [],
      base: { source: "repo", cwd: process.cwd() },
      pane: null,
      candidates: [],
      lines: 0,
    });
  });
});

describe("/_agent/image", () => {
  test("POST は受け付けない", async () => {
    const res = await call("/_agent/image", { method: "POST" });
    expect(res?.status).toBe(405);
  });

  test("解決できる画像を中身ごと返す", async () => {
    const path = join(process.cwd(), "web/favicon.png");
    const res = await call(`/_agent/image?path=${encodeURIComponent(path)}`);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Content-Type")).toBe("image/png");
    expect(res?.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res?.headers.get("Content-Security-Policy")).toBe("sandbox");
    const body = await res?.arrayBuffer();
    expect(body?.byteLength).toBe(statSync(path).size);
  });

  test.each([
    {
      name: "版の指定が無い",
      version: () => null,
      expected: "no-store",
    },
    {
      name: "版が今の実体と一致する",
      version: (size: number, mtimeMs: number) =>
        `${Math.trunc(mtimeMs)}-${size}`,
      expected: "private, max-age=31536000, immutable",
    },
    {
      name: "版が古い (上書きされた後)",
      version: (size: number, mtimeMs: number) =>
        `${Math.trunc(mtimeMs) - 1000}-${size}`,
      expected: "no-store",
    },
  ])("$name ときの Cache-Control", async ({ version, expected }) => {
    // 棚は描き直すたびに同じ URL を読む。覚えさせてよいのは、URL の版が
    // 今の実体と同じときだけ。
    const path = realpathSync(join(process.cwd(), "web/favicon.png"));
    const { size, mtimeMs } = statSync(path);
    const v = version(size, mtimeMs);
    const res = await call(
      `/_agent/image?path=${encodeURIComponent(path)}${v ? `&v=${v}` : ""}`,
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Cache-Control")).toBe(expected);
  });

  test.each([
    { name: "パスが無い", query: "", reason: "invalid" },
    {
      name: "実在しない",
      query: "?path=%2Ftmp%2Fmissing-image.png",
      reason: "missing",
    },
    {
      name: "画像でないもの",
      query: "?path=package.json",
      reason: "unsupported",
    },
    { name: "SVG", query: "?path=web%2Ffavicon.svg", reason: "unsupported" },
    { name: "ディレクトリ", query: "?path=web", reason: "unsupported" },
  ])("$name ときは 404 で理由を返す", async ({ query, reason }) => {
    // URL は持って回られるので、配る側でももう一度同じ判定を通す。
    const res = await call(`/_agent/image${query}`);
    expect(res?.status).toBe(404);
    expect(await res?.text()).toContain(reason);
  });

  test.each([
    { name: "大きすぎる", file: "huge.png", reason: "too-large" },
    {
      name: "拡張子がそう見えるディレクトリ",
      file: "dir.png",
      reason: "not-file",
    },
    { name: "空のファイル", file: "empty.png", reason: "empty" },
  ])("$name ものは配らない", async ({ file, reason }) => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-image-reject-"));
    try {
      mkdirSync(join(dir, "dir.png"));
      writeFileSync(join(dir, "empty.png"), "");
      writeFileSync(
        join(dir, "huge.png"),
        Buffer.alloc(MAX_PASTE_IMAGE_BYTES + 1),
      );
      const res = await call(
        `/_agent/image?path=${encodeURIComponent(join(dir, file))}`,
      );
      expect(res?.status).toBe(404);
      expect(await res?.text()).toContain(reason);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
