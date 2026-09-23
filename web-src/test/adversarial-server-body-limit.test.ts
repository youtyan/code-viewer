// 本文の上限 (readBoundedJsonBody) は、content-length が無いとき (chunked)
// req.text() で全部を溜めてから大きさを比べていた。入口の取り次ぎ
// (entry/proxy.ts) は content-length を落として本文を流すので、入口の下では
// 裏へ届く要求は全部この「無い」側になる。上限を越えた所で読むのをやめ、
// 413 にすること。

import { describe, expect, test } from "vitest";
import {
  parseBoundedJsonBody,
  parsePostJsonBody,
} from "../server/database/handle-shared";

const CHUNK_BYTES = 64 * 1024;
const TOTAL_BYTES = 8 * 1024 * 1024;

/** 読まれた分だけ数える本文。全部で TOTAL_BYTES。 */
function countedBody(): { req: Request; pulled: () => number } {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= TOTAL_BYTES) {
        controller.close();
        return;
      }
      pulled += CHUNK_BYTES;
      controller.enqueue(new Uint8Array(CHUNK_BYTES).fill(0x20));
    },
  });
  const req = new Request("http://127.0.0.1:1/_agent/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  return { req, pulled: () => pulled };
}

describe("request body limits without content-length", () => {
  test.each([
    {
      name: "parseBoundedJsonBody (16 KiB, /_agent/state・/_agent/unread と同じ上限)",
      limit: 16 * 1024,
      parse: (req: Request) =>
        parseBoundedJsonBody(req, 16 * 1024, "agent state request too large"),
    },
    {
      name: "parsePostJsonBody (1 MiB)",
      limit: 1_048_576,
      parse: (req: Request) => parsePostJsonBody(req),
    },
  ])("$name: 上限を少し越えた所で読むのをやめて 413", async ({
    limit,
    parse,
  }) => {
    const { req, pulled } = countedBody();
    const result = await parse(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
    // 上限 + ストリームの先読み 2 塊までなら「上限つき」と言える。
    expect(pulled()).toBeLessThanOrEqual(limit + 2 * CHUNK_BYTES);
  });
});
