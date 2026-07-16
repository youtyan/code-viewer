import { describe, expect, test } from "bun:test";
import {
  buildRawFileUrl,
  buildRoute,
  parseDoctorOverlay,
  parseLineTarget,
  parseRoute,
  withDoctorOverlay,
} from "../core/routes";

describe("routes", () => {
  const defaultRange = { from: "HEAD", to: "worktree" };

  test.each([
    { name: "accepts a positive line", input: "12", expected: 12 },
    {
      name: "accepts an ascending range",
      input: "5-9",
      expected: { start: 5, end: 9 },
    },
    {
      name: "normalizes a reversed range",
      input: "9-5",
      expected: { start: 5, end: 9 },
    },
    { name: "rejects zero", input: "0", expected: undefined },
    { name: "rejects a decimal", input: "1.5", expected: undefined },
    { name: "rejects an empty value", input: "", expected: undefined },
  ])("parseLineTarget $name", ({ input, expected }) => {
    expect(parseLineTarget(input)).toEqual(expected);
  });

  test("builds canonical diff and file detail URLs", () => {
    const range = { from: "HEAD", to: "worktree" };
    expect(
      buildRoute({ screen: "repo", ref: "worktree", path: "", range }),
    ).toBe("/");
    expect(
      buildRoute({
        screen: "repo",
        ref: "main",
        path: "web-src/server",
        range,
      }),
    ).toBe("/?ref=main&path=web-src%2Fserver");
    expect(buildRoute({ screen: "diff", range })).toBe(
      "/todif?from=HEAD&to=worktree",
    );
    expect(
      buildRoute({ screen: "diff", range, path: "web-src/app.ts", line: 3655 }),
    ).toBe("/todif?from=HEAD&to=worktree&path=web-src%2Fapp.ts&line=3655");
    expect(
      buildRoute({
        screen: "file",
        path: "src/a b.ts",
        ref: "feat/foo",
        range,
      }),
    ).toBe("/file?path=src%2Fa%20b.ts&ref=feat%2Ffoo&from=HEAD&to=worktree");
    expect(
      buildRoute({
        screen: "file",
        path: "README.md",
        ref: "main",
        view: "blob",
        range,
      }),
    ).toBe("/file?path=README.md&target=main&view=blob");
    expect(
      buildRoute({
        screen: "file",
        path: "README.md",
        ref: "main",
        view: "blob",
        preview: true,
        range,
      }),
    ).toBe("/file?path=README.md&target=main&view=blob&preview=1");
    expect(
      buildRoute({
        screen: "file",
        path: "README.md",
        ref: "main",
        view: "blob",
        line: 12,
        range,
      }),
    ).toBe("/file?path=README.md&target=main&view=blob&line=12");
    expect(
      buildRoute({
        screen: "file",
        path: "README.md",
        ref: "main",
        view: "blob",
        line: { start: 12, end: 15 },
        range,
      }),
    ).toBe("/file?path=README.md&target=main&view=blob&line=12-15");
    expect(
      buildRoute({
        screen: "file",
        path: "README.md",
        ref: "main",
        view: "blob",
        virtual: "off",
        range,
      }),
    ).toBe("/file?path=README.md&target=main&view=blob&virtual=off");
    expect(
      buildRoute({ screen: "help", lang: "en", section: "overview", range }),
    ).toBe("/help");
    expect(
      buildRoute({ screen: "help", lang: "ja", section: "overview", range }),
    ).toBe("/help?lang=ja");
    expect(
      buildRoute({
        screen: "help",
        lang: "ja",
        section: "annotations",
        range,
      }),
    ).toBe("/help?lang=ja&section=annotations");
    expect(
      buildRoute({
        screen: "journal",
        tab: "tasks",
        date: "2026-07-02",
        label: "ai-ready",
        task: "t-1",
        range,
      }),
    ).toBe("/journal?tab=tasks&date=2026-07-02&label=ai-ready&task=t-1");
  });

  test("round-trips journal route params", () => {
    const route = parseRoute(
      "/journal",
      "?tab=tasks&date=2026-07-02&label=ai-ready&task=t-1",
      defaultRange,
    );
    expect(route).toEqual({
      screen: "journal",
      tab: "tasks",
      date: "2026-07-02",
      label: "ai-ready",
      task: "t-1",
      range: defaultRange,
    });
    expect(buildRoute(route)).toBe(
      "/journal?tab=tasks&date=2026-07-02&label=ai-ready&task=t-1",
    );
  });

  test("round-trips database schema route params", () => {
    const range = { from: "HEAD", to: "worktree" };
    const route = parseRoute(
      "/database",
      "?db=docker%3Apg%3Aapp&schema=tenant_a&table=users&tab=schema",
      defaultRange,
    );
    expect(route).toEqual({
      screen: "database",
      db: "docker:pg:app",
      schema: "tenant_a",
      table: "users",
      tab: "schema",
      range: defaultRange,
    });
    expect(buildRoute({ ...route, range })).toBe(
      "/database?db=docker%3Apg%3Aapp&schema=tenant_a&table=users&tab=schema",
    );
  });

  test("parses repository routes with worktree default ref", () => {
    expect(parseRoute("/", "", defaultRange)).toEqual({
      screen: "repo",
      ref: "worktree",
      path: "",
      range: defaultRange,
    });
    expect(parseRoute("/", "?ref=main&path=src", defaultRange)).toEqual({
      screen: "repo",
      ref: "main",
      path: "src",
      range: defaultRange,
    });
    expect(parseRoute("/", "?target=main&path=src", defaultRange)).toEqual({
      screen: "repo",
      ref: "main",
      path: "src",
      range: defaultRange,
    });
  });

  test("parses file routes with branch refs containing slashes", () => {
    expect(
      parseRoute(
        "/file",
        "?path=src%2Fa.ts&ref=feat%2Ffoo&from=main&to=feat%2Ffoo",
        defaultRange,
      ),
    ).toEqual({
      screen: "file",
      path: "src/a.ts",
      ref: "feat/foo",
      range: { from: "main", to: "feat/foo" },
      view: "detail",
    });
    expect(
      parseRoute("/file", "?path=README.md&target=worktree", defaultRange),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "blob",
      range: defaultRange,
    });
    expect(
      parseRoute(
        "/file",
        "?path=README.md&target=worktree&view=blob&preview=1",
        defaultRange,
      ),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "blob",
      preview: true,
      range: defaultRange,
    });
    expect(
      parseRoute(
        "/file",
        "?path=README.md&target=worktree&preview=1",
        defaultRange,
      ),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "blob",
      preview: true,
      range: defaultRange,
    });
    expect(
      parseRoute(
        "/file",
        "?path=README.md&target=worktree&view=blob",
        defaultRange,
      ),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "blob",
      range: defaultRange,
    });
    expect(
      parseRoute("/file", "?path=README.md&target=main&line=12", defaultRange),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "main",
      view: "blob",
      line: 12,
      range: defaultRange,
    });
    expect(
      parseRoute(
        "/file",
        "?path=README.md&target=main&line=12-15",
        defaultRange,
      ),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "main",
      view: "blob",
      line: { start: 12, end: 15 },
      range: defaultRange,
    });
    expect(
      parseRoute(
        "/file",
        "?path=README.md&target=main&line=15-12",
        defaultRange,
      ),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "main",
      view: "blob",
      line: { start: 12, end: 15 },
      range: defaultRange,
    });
    expect(
      parseRoute(
        "/file",
        "?path=README.md&target=main&virtual=off",
        defaultRange,
      ),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "main",
      view: "blob",
      virtual: "off",
      range: defaultRange,
    });
  });

  test("reads legacy compact range URLs but writes canonical from and to params", () => {
    expect(
      parseRoute("/todif", "?range=HEAD~1..worktree", defaultRange),
    ).toEqual({ screen: "diff", range: { from: "HEAD~1", to: "worktree" } });
    expect(
      buildRoute(parseRoute("/todif", "?range=HEAD~1..worktree", defaultRange)),
    ).toBe("/todif?from=HEAD~1&to=worktree");
  });

  test("returns explicit unknown routes instead of silently falling back", () => {
    expect(parseRoute("/file", "?ref=worktree", defaultRange)).toEqual({
      screen: "unknown",
      reason: "missing-path",
      rawPathname: "/file",
      rawSearch: "?ref=worktree",
      range: defaultRange,
    });
    expect(
      parseRoute("/blame", "?from=main&to=worktree", defaultRange),
    ).toEqual({
      screen: "unknown",
      reason: "unknown-pathname",
      rawPathname: "/blame",
      rawSearch: "?from=main&to=worktree",
      range: { from: "main", to: "worktree" },
    });
  });

  test("treats /doctor as repo screen with overlay open", () => {
    expect(parseRoute("/doctor", "", defaultRange)).toEqual({
      screen: "repo",
      ref: "worktree",
      path: "",
      range: defaultRange,
    });
    expect(parseDoctorOverlay("/doctor", "")).toBe(true);
    expect(parseDoctorOverlay("/file", "?doctor=open")).toBe(true);
    expect(parseDoctorOverlay("/", "")).toBe(false);
    expect(parseDoctorOverlay("/file", "?doctor=closed")).toBe(false);
  });

  test("withDoctorOverlay adds or removes the doctor query param", () => {
    expect(withDoctorOverlay("/", true)).toBe("/?doctor=open");
    expect(withDoctorOverlay("/file?path=a.ts", true)).toBe(
      "/file?path=a.ts&doctor=open",
    );
    expect(withDoctorOverlay("/file?path=a.ts&doctor=open", false)).toBe(
      "/file?path=a.ts",
    );
    expect(withDoctorOverlay("/?doctor=open", false)).toBe("/");
  });

  test("parses help routes with language and section defaults", () => {
    expect(parseRoute("/help", "", defaultRange)).toEqual({
      screen: "help",
      lang: "en",
      section: "overview",
      range: defaultRange,
    });
    expect(
      parseRoute("/help", "?lang=ja&section=annotations", defaultRange),
    ).toEqual({
      screen: "help",
      lang: "ja",
      section: "annotations",
      range: defaultRange,
    });
  });

  test("builds deterministic URLs for round trips and todiff aliases", () => {
    expect(
      buildRoute(
        parseRoute("/todiff", "?from=main&to=feat%2Ffoo", defaultRange),
      ),
    ).toBe("/todif?from=main&to=feat%2Ffoo");
    expect(
      parseRoute(
        "/todif",
        "?from=HEAD&to=worktree&path=web-src%2Fapp.ts&line=3655",
        defaultRange,
      ),
    ).toEqual({
      screen: "diff",
      range: { from: "HEAD", to: "worktree" },
      path: "web-src/app.ts",
      line: 3655,
    });
    const route = {
      screen: "file" as const,
      path: "src/a?b&c=1.ts",
      ref: "feat/foo",
      range: { from: "HEAD^", to: "worktree" },
    };
    expect(
      buildRoute(
        parseRoute(
          "/file",
          buildRoute(route).slice("/file".length),
          defaultRange,
        ),
      ),
    ).toBe(buildRoute(route));
  });

  test("parses and builds history routes", () => {
    const fallback = { from: "HEAD", to: "worktree" };
    expect(parseRoute("/history", "", fallback)).toEqual({
      screen: "history",
      ref: "HEAD",
      range: fallback,
    });
    expect(
      parseRoute("/history", "?ref=main&commit=abc1234", fallback),
    ).toEqual({
      screen: "history",
      ref: "main",
      commit: "abc1234",
      range: fallback,
    });
    expect(parseRoute("/history", "?commit=worktree", fallback)).toEqual({
      screen: "history",
      ref: "HEAD",
      commit: "worktree",
      range: fallback,
    });
    expect(
      buildRoute({ screen: "history", ref: "HEAD", range: fallback }),
    ).toBe("/history");
    expect(
      buildRoute({
        screen: "history",
        ref: "feature/x",
        commit: "abc1234",
        range: fallback,
      }),
    ).toBe("/history?ref=feature%2Fx&commit=abc1234");
    expect(
      buildRoute({
        screen: "history",
        ref: "HEAD",
        commit: "worktree",
        range: fallback,
      }),
    ).toBe("/history?commit=worktree");
  });

  test("parses and builds file blame routes", () => {
    const fallback = { from: "HEAD", to: "worktree" };
    expect(
      parseRoute(
        "/file",
        "?path=README.md&target=worktree&view=blame",
        fallback,
      ),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "blame",
      range: fallback,
    });
    expect(
      parseRoute("/file", "?path=README.md&target=main&view=blame", fallback),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "main",
      view: "blame",
      range: fallback,
    });
    expect(
      parseRoute(
        "/file",
        "?path=README.md&target=main&view=blame&line=12-15",
        fallback,
      ),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "main",
      view: "blame",
      line: { start: 12, end: 15 },
      range: fallback,
    });
    expect(
      buildRoute({
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "blame",
        range: fallback,
      }),
    ).toBe("/file?path=README.md&target=worktree&view=blame");
    expect(
      buildRoute({
        screen: "file",
        path: "README.md",
        ref: "main",
        view: "blame",
        range: fallback,
      }),
    ).toBe("/file?path=README.md&target=main&view=blame");
  });

  test("parses and builds file history routes", () => {
    const fallback = { from: "HEAD", to: "worktree" };
    expect(
      parseRoute(
        "/file",
        "?path=README.md&target=worktree&view=history",
        fallback,
      ),
    ).toEqual({
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "history",
      range: fallback,
    });
    expect(
      buildRoute({
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "history",
        range: fallback,
      }),
    ).toBe("/file?path=README.md&target=worktree&view=history");
    expect(
      buildRoute({
        screen: "file",
        path: "web-src/app.ts",
        ref: "main",
        view: "history",
        line: 42,
        range: fallback,
      }),
    ).toBe("/file?path=web-src%2Fapp.ts&target=main&view=history&line=42");
  });

  test("builds raw file API URLs from path and ref only", () => {
    expect(buildRawFileUrl({ path: "src/a.ts", ref: "worktree" })).toBe(
      "/_file?path=src%2Fa.ts&ref=worktree",
    );
  });
});
