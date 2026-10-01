// ターミナルの出力と SP の 1 ペイン表示が使う、SSE の流し 1 本ずつの作り。
// 片付けが呼ばれないと tmux の control mode のクライアントやシェルの購読が残り、
// まとめて閉じられないとサーバが終了できない。

import { afterEach, describe, expect, test, vi } from "vitest";
import { createSseStreamGroup } from "../server/sse-stream";

async function readAll(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer());
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createSseStreamGroup", () => {
  test("知らせを event と data の組で送り、閉じたら本文を終える", async () => {
    const group = createSseStreamGroup();
    const response = group.open((stream) => {
      stream.send("snapshot", '{"cols":80}');
      stream.send("output", '{"data":"x"}');
      stream.close();
      stream.send("output", '{"data":"after close"}');
    });
    expect([
      response.headers.get("Content-Type"),
      await readAll(response),
    ]).toEqual([
      "text/event-stream",
      'event: snapshot\ndata: {"cols":80}\n\nevent: output\ndata: {"data":"x"}\n\n',
    ]);
  });

  test.each([
    {
      name: "こちらから閉じた",
      end: (
        _response: Response,
        group: ReturnType<typeof createSseStreamGroup>,
      ) => group.closeAll(),
    },
    {
      name: "ブラウザが切った",
      end: (response: Response) => {
        void response.body?.cancel();
      },
    },
  ])("$name: 片付けを 1 回だけ呼ぶ", async ({ end }) => {
    const group = createSseStreamGroup();
    const cleanup = vi.fn();
    const response = group.open((stream) => stream.onClose(cleanup));
    end(response, group);
    await Promise.resolve();
    group.closeAll();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test("閉じた後に渡した片付けはその場で呼ぶ", () => {
    const group = createSseStreamGroup();
    const cleanup = vi.fn();
    group.open((stream) => {
      stream.close();
      stream.onClose(cleanup);
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test("何も流れない間も 15 秒ごとに ping を送る", async () => {
    vi.useFakeTimers();
    const group = createSseStreamGroup();
    const response = group.open(() => undefined);
    const reader = response.body?.getReader();
    vi.advanceTimersByTime(15000);
    const chunk = await reader?.read();
    group.closeAll();
    expect(new TextDecoder().decode(chunk?.value)).toBe(": ping\n\n");
  });
});
