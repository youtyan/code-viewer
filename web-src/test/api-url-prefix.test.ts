// 入口のサーバの下の画面 (`/p/<鍵>/…`) で、要求と画面の URL に前置きが付き、
// 経路を読む側には外れて届くこと (core/api-url.ts)。
import { afterEach, describe, expect, test } from "vitest";
import {
  apiUrl,
  PROJECT_HEADER,
  pageUrl,
  projectApiUrl,
  projectKey,
  projectKeyOfServerUrl,
  projectRequest,
  routePathname,
  withoutProjectPrefix,
} from "../core/api-url";
import { buildRoute } from "../core/routes";

const KEY = "0123456789abcdef";

function atPath(pathname: string): void {
  Object.defineProperty(globalThis, "location", {
    value: { pathname },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "location");
});

describe("the project key in the page URL", () => {
  test.each([
    [`/p/${KEY}/`, KEY],
    [`/p/${KEY}/file`, KEY],
    [`/p/${KEY}`, KEY],
    ["/p/0123456789ABCDEF/", null],
    ["/p/0123456789abcde/", null],
    ["/p/0123456789abcdef0/", null],
    ["/p/sample-app/", null],
    ["/file", null],
    ["/", null],
  ])("%s → %s", (pathname, expected) => {
    expect(projectKey(pathname)).toBe(expected);
  });

  test.each([
    [`/p/${KEY}/file?path=a.ts`, "/file?path=a.ts"],
    [`/p/${KEY}/`, "/"],
    [`/p/${KEY}`, "/"],
    [`/p/${KEY}?results=x`, "/?results=x"],
    ["/history", "/history"],
    ["/p/sample-app/file", "/p/sample-app/file"],
  ])("withoutProjectPrefix(%s) = %s", (url, expected) => {
    expect(withoutProjectPrefix(url)).toBe(expected);
  });
});

describe("URLs built on a page under the entry server", () => {
  test("project requests and page URLs get the prefix; entry requests do not", () => {
    atPath(`/p/${KEY}/history`);
    expect(routePathname()).toBe("/history");
    expect(apiUrl("tree")).toBe(`/p/${KEY}/_tree`);
    expect(apiUrl("events")).toBe(`/p/${KEY}/events`);
    expect(apiUrl("agentOverview")).toBe("/_agent/overview");
    expect(apiUrl("shellKeys")).toBe("/_shell/keys");
    expect(pageUrl("/file?path=a")).toBe(`/p/${KEY}/file?path=a`);
    expect(
      buildRoute({ screen: "history" } as Parameters<typeof buildRoute>[0]),
    ).toMatch(new RegExp(`^/p/${KEY}/history`));
  });

  test("without the prefix (a standalone server) nothing changes", () => {
    atPath("/history");
    expect(routePathname()).toBe("/history");
    expect(apiUrl("tree")).toBe("/_tree");
    expect(pageUrl("/file")).toBe("/file");
  });
});

describe("projectRequest (every fetch)", () => {
  test.each([
    [
      "a URL returned by the server",
      "/file_diff?path=a&mode=full",
      `/p/${KEY}/file_diff?path=a&mode=full`,
      null,
    ],
    ["an already prefixed URL", `/p/${KEY}/_tree`, `/p/${KEY}/_tree`, null],
    [
      "an entry request gets the project header",
      "/_agent/overview",
      "/_agent/overview",
      KEY,
    ],
    [
      "a shell request gets the project header",
      "/_shell/create",
      "/_shell/create",
      KEY,
    ],
    ["a static file is left alone", "/app.js", "/app.js", null],
    [
      "another origin is left alone",
      "//example.invalid/_tree",
      "//example.invalid/_tree",
      null,
    ],
  ])("%s", (_label, input, expectedInput, expectedHeader) => {
    atPath(`/p/${KEY}/`);
    const prepared = projectRequest(input, { headers: { "X-Sample": "1" } });
    expect(prepared.input).toBe(expectedInput);
    const headers = new Headers(prepared.init?.headers);
    expect(headers.get(PROJECT_HEADER)).toBe(expectedHeader);
    expect(headers.get("x-sample")).toBe("1");
  });

  test("on a standalone page nothing is added", () => {
    atPath("/file");
    expect(projectRequest("/file_diff?x=1")).toEqual({
      input: "/file_diff?x=1",
      init: undefined,
    });
  });
});

// 別のプロジェクトのファイルをその場で出すときの読む先 (app.ts の別のプロジェクトの面)。
describe("requests to another project", () => {
  const OTHER = "fedcba9876543210";
  test.each([
    [
      "このページの前置き付き",
      `/p/${KEY}/_file?path=a.ts`,
      `/p/${OTHER}/_file?path=a.ts`,
    ],
    [
      "前置きなし",
      "/file_range?path=a.ts&start=1",
      `/p/${OTHER}/file_range?path=a.ts&start=1`,
    ],
  ])("%s", (_name, url, expected) => {
    expect(projectApiUrl(url, OTHER)).toBe(expected);
  });

  test.each([
    [
      "入口の経路は前置きで送らない",
      "/_agent/images?path=a.png",
      "is not a project route",
    ],
    ["鍵の形でない", "/_file?path=a", "project key must be 16 hex digits"],
  ])("断る: %s", (_name, url, message) => {
    expect(() =>
      projectApiUrl(url, url.startsWith("/_file") ? "nothex" : OTHER),
    ).toThrow(message);
  });

  test("サーバの URL から鍵を読む", () => {
    expect([
      projectKeyOfServerUrl(`http://127.0.0.1:4000/p/${OTHER}/`),
      projectKeyOfServerUrl("http://127.0.0.1:4000/"),
    ]).toEqual([OTHER, null]);
  });

  test("入口の経路に呼んだ側が付けたプロジェクトの鍵は残す (別のプロジェクトの画像)", () => {
    atPath(`/p/${KEY}/file`);
    const sent = projectRequest("/_agent/images?path=a.png", {
      headers: { [PROJECT_HEADER]: OTHER },
    });
    const plain = projectRequest("/_agent/images?path=a.png");
    expect([
      new Headers(sent.init?.headers).get(PROJECT_HEADER),
      new Headers(plain.init?.headers).get(PROJECT_HEADER),
    ]).toEqual([OTHER, KEY]);
  });
});
