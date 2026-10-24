// 生きた知らせ (/_live) とその中のチャンネルが使う、SSE の流し 1 本ずつの作り。
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

  // 中身が改行を含むと (プロジェクトの通知を載せ替えたとき)、行ごとの data に
  // しないと枠が崩れ、続く行が知らせの外に出る。
  test("改行を含む中身は行ごとの data にし、送れていない量を数える", async () => {
    const group = createSseStreamGroup();
    let backlog = -1;
    const response = group.open((stream) => {
      stream.send("m", "c1 update a\nb\r\nc");
      backlog = stream.backlog();
      stream.close();
    });
    expect([backlog, await readAll(response)]).toEqual([
      44,
      "event: m\ndata: c1 update a\ndata: b\ndata: c\n\n",
    ]);
  });

  // 切れた後の繋ぎ直しを EventSource の既定 (約 3 秒) より早める。
  test("retryMs を渡すと、開いた直後に retry を送る", async () => {
    const group = createSseStreamGroup({ retryMs: 500 });
    const response = group.open((stream) => stream.close());
    expect(await readAll(response)).toBe("retry: 500\n\n");
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
