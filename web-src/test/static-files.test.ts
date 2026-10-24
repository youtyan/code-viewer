// 画面のファイル (server/static-files.ts) は毎回確かめるが、変わっていなければ
// 取り直さない (面の iframe ごとに app.js を読み直さない)。

import { describe, expect, test } from "vitest";
import { staticFile } from "../server/static-files";

function get(path: string, ifNoneMatch?: string) {
  const response = staticFile(
    path,
    new Request(`http://127.0.0.1${path}`, {
      headers: ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {},
    }),
  );
  if (!response) throw new Error(`no static file for ${path}`);
  return response;
}

describe("staticFile の確かめ", () => {
  const etag = get("/style.css").headers.get("etag") ?? "";

  test("初めては中身と ETag を返し、毎回確かめさせる", () => {
    const response = get("/style.css");
    expect({
      status: response.status,
      cache: response.headers.get("cache-control"),
      etag: /^W\/"[0-9a-z]+-[0-9a-z]+"$/.test(etag),
    }).toEqual({ status: 200, cache: "no-cache", etag: true });
  });

  test.each([
    { name: "同じ ETag は 304", tag: () => etag, status: 304 },
    {
      name: "並びの中にあれば 304",
      tag: () => `W/"other", ${etag}`,
      status: 304,
    },
    { name: "違う ETag は 200", tag: () => 'W/"other"', status: 200 },
  ])("$name", ({ tag, status }) => {
    expect(get("/style.css", tag()).status).toBe(status);
  });

  test("ファイルごとに ETag が違う", () => {
    expect(get("/app.js").headers.get("etag")).not.toBe(etag);
  });
});
