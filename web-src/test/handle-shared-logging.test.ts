import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abortError } from "../server/database/adapters/abort";
import {
  extractErrorReason,
  handleError,
  logResponseWithReason,
  MAX_LOGGED_ERROR_BODY,
} from "../server/database/handle-shared";

type ConsoleMethod = "log" | "warn" | "error";
type CapturedLine = { kind: ConsoleMethod; line: string };

let captured: CapturedLine[] = [];
let originalLog: typeof console.log;
let originalWarn: typeof console.warn;
let originalError: typeof console.error;

beforeAll(() => {
  originalLog = console.log;
  originalWarn = console.warn;
  originalError = console.error;
  console.log = (...args: unknown[]) => {
    captured.push({ kind: "log", line: args.join(" ") });
  };
  console.warn = (...args: unknown[]) => {
    captured.push({ kind: "warn", line: args.join(" ") });
  };
  console.error = (...args: unknown[]) => {
    captured.push({ kind: "error", line: args.join(" ") });
  };
});

afterAll(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

function reset() {
  captured = [];
}

function makeReq(method = "GET"): Request {
  return new Request("http://example.test/_db/foo?x=1", { method });
}

function makeUrl(): URL {
  return new URL("http://example.test/_db/foo?x=1");
}

async function drainLogs(): Promise<void> {
  // logResponseWithReason は内部キューに enqueue するだけ。queue tail を読むのは
  // 公開していないので microtask を数回回して flush を待つ。
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("extractErrorReason", () => {
  test("status<400 は常に空文字を返す", async () => {
    const res = new Response("ok", { status: 200 });
    expect(await extractErrorReason(res)).toBe("");
  });

  test("content-type が text/plain の 4xx は body をそのまま返す", async () => {
    const res = new Response("invalid schema parameter", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
    expect(await extractErrorReason(res)).toBe("invalid schema parameter");
  });

  test("content-type が application/json の 4xx も body を返す", async () => {
    const res = new Response('{"error":"bad"}', {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    expect(await extractErrorReason(res)).toBe('{"error":"bad"}');
  });

  test("content-type が image/png 等の 4xx は読まずに空文字", async () => {
    const res = new Response("binary-blob", {
      status: 400,
      headers: { "Content-Type": "image/png" },
    });
    expect(await extractErrorReason(res)).toBe("");
  });

  test("MAX_LOGGED_ERROR_BODY を超える body は ... で切り詰める", async () => {
    const long = "x".repeat(MAX_LOGGED_ERROR_BODY + 50);
    const res = new Response(long, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
    const reason = await extractErrorReason(res);
    expect(reason).toHaveLength(MAX_LOGGED_ERROR_BODY + 3);
    expect(reason.endsWith("...")).toBe(true);
  });

  test("複数空白・改行を 1 つの空白に正規化する", async () => {
    const res = new Response("first  line\n\nsecond\tthird", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
    expect(await extractErrorReason(res)).toBe("first line second third");
  });

  test("clone してから読むので元 Response の body はまだ読める", async () => {
    const original = new Response("invalid schema parameter", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
    await extractErrorReason(original);
    expect(await original.text()).toBe("invalid schema parameter");
  });
});

describe("logResponseWithReason", () => {
  test("2xx は console.log に head 1 行だけ出力", async () => {
    reset();
    const res = new Response("ok", { status: 200 });
    logResponseWithReason("[code-viewer]", makeReq(), makeUrl(), res, 0);
    await drainLogs();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.kind).toBe("log");
    expect(captured[0]?.line ?? "").toMatch("GET /_db/foo 200 ");
  });

  test("4xx は console.warn に reason 付きで出力", async () => {
    reset();
    const res = new Response("invalid schema parameter", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
    logResponseWithReason("[code-viewer]", makeReq(), makeUrl(), res, 0);
    await drainLogs();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.kind).toBe("warn");
    expect(captured[0]?.line ?? "").toMatch(" 400 ");
    expect(captured[0]?.line ?? "").toMatch(":: invalid schema parameter");
  });

  test("4xx だが body 抽出できない時は head のみで console.warn", async () => {
    reset();
    const res = new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      status: 415,
      headers: { "Content-Type": "image/png" },
    });
    logResponseWithReason("[code-viewer]", makeReq(), makeUrl(), res, 0);
    await drainLogs();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.kind).toBe("warn");
    expect(captured[0]?.line ?? "").toMatch(" 415 ");
    expect((captured[0]?.line ?? "").includes("::")).toBe(false);
  });

  test("opts.qsLen で url.search を頭から切り出して表示", async () => {
    reset();
    const url = new URL("http://example.test/_db/foo?aaaaaaaaaaaaaaaa=1");
    const res = new Response("ok", { status: 200 });
    logResponseWithReason("[code-viewer]", makeReq(), url, res, 0, {
      qsLen: 5,
    });
    await drainLogs();
    expect((captured[0]?.line ?? "").includes("?aaaa")).toBe(true);
    expect((captured[0]?.line ?? "").includes("aaaaaaaaaaaaaaaa=1")).toBe(
      false,
    );
  });

  test("2xx と 4xx が混在しても投入順に出力される (FIFO キュー)", async () => {
    reset();
    const r1 = new Response("invalid 1", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
    const r2 = new Response("ok", { status: 200 });
    const r3 = new Response("invalid 3", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
    logResponseWithReason("[T]", makeReq(), makeUrl(), r1, 0);
    logResponseWithReason("[T]", makeReq(), makeUrl(), r2, 0);
    logResponseWithReason("[T]", makeReq(), makeUrl(), r3, 0);
    await drainLogs();
    expect(captured).toHaveLength(3);
    expect((captured[0]?.line ?? "").includes("invalid 1")).toBe(true);
    expect((captured[1]?.line ?? "").includes(" 200 ")).toBe(true);
    expect((captured[2]?.line ?? "").includes("invalid 3")).toBe(true);
  });

  test("元 Response がログ後すぐ consume されても reason 抽出は成功する (同期 clone 契約)", async () => {
    reset();
    const res = new Response("invalid schema parameter", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
    logResponseWithReason("[T]", makeReq(), makeUrl(), res, 0);
    // 呼出直後に元 Response を consume する (Bun.serve がストリーム送信開始する状況を模す)
    await res.text();
    await drainLogs();
    expect(
      (captured[0]?.line ?? "").includes(":: invalid schema parameter"),
    ).toBe(true);
  });
});

describe("handleError abort handling", () => {
  test("AbortError-named errors return 503 silently (no console.error)", async () => {
    reset();
    const err = new Error("operation aborted");
    err.name = "AbortError";
    const res = handleError("database", "read schema", err);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("read schema aborted");
    // クライアント起因のキャンセルは warn 級のログを出さない。
    expect(captured.filter((c) => c.kind === "error")).toHaveLength(0);
  });

  test("abortError() helper output is also classified as abort", async () => {
    reset();
    const res = handleError(
      "database",
      "execute query",
      abortError("query aborted"),
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("execute query aborted");
    expect(captured.filter((c) => c.kind === "error")).toHaveLength(0);
  });

  test("aborted signal classifies even a plain Error as abort", async () => {
    reset();
    const controller = new AbortController();
    controller.abort();
    const res = handleError(
      "database",
      "read table",
      new Error("some random failure"),
      controller.signal,
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("read table aborted");
    expect(captured.filter((c) => c.kind === "error")).toHaveLength(0);
  });

  test("plain Error with no abort markers logs to console.error and returns 500", async () => {
    reset();
    const res = handleError("database", "read schema", new Error("boom"));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("failed to read schema: boom");
    const errs = captured.filter((c) => c.kind === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0]?.line ?? "").toBe("[code-viewer] database error: boom");
  });

  test("Postgres-style 'transaction is aborted' message must NOT be classified as cancellation", async () => {
    // database-review-guards.test.ts で isAbortLikeError レベルの境界は守られている
    // が、handleError 経由でも誤検知しないことを再確認する (5xx に落ちる本物の
    // DB エラーを 503 + silent で隠してしまうと運用上重大)。
    reset();
    const err = new Error("current transaction is aborted, commands ignored");
    const res = handleError("database", "execute query", err);
    expect(res.status).toBe(500);
    expect(captured.filter((c) => c.kind === "error")).toHaveLength(1);
  });

  test("non-aborted signal + AbortError-named err still classified as abort (name wins)", async () => {
    reset();
    const controller = new AbortController(); // not aborted
    const err = new Error("operation aborted");
    err.name = "AbortError";
    const res = handleError("database", "read schema", err, controller.signal);
    expect(res.status).toBe(503);
    expect(captured.filter((c) => c.kind === "error")).toHaveLength(0);
  });
});
