import { describe, expect, test } from "vitest";
import {
  type PublicOrigin,
  parsePublicOrigin,
  requestAllowed,
  sideEffectRequestAllowed,
} from "../server/request-origin";

const PUBLIC: PublicOrigin = {
  origin: "https://terminal.example",
  host: "terminal.example",
};

function request(
  host: string,
  origin?: string,
  extraHeaders: HeadersInit = {},
): Request {
  return new Request("http://127.0.0.1:4173/", {
    method: "POST",
    headers: {
      Host: host,
      ...(origin === undefined ? {} : { Origin: origin }),
      ...extraHeaders,
    },
  });
}

describe("parsePublicOrigin", () => {
  test.each([
    {
      name: "accepts an HTTPS origin",
      value: "https://terminal.example",
      expected: PUBLIC,
    },
    {
      name: "normalizes a trailing slash",
      value: "https://terminal.example/",
      expected: PUBLIC,
    },
    {
      name: "keeps an explicit HTTPS port",
      value: "https://terminal.example:8443",
      expected: {
        origin: "https://terminal.example:8443",
        host: "terminal.example:8443",
      },
    },
  ])("$name", ({ value, expected }) => {
    expect(parsePublicOrigin(value)).toEqual({ ok: true, value: expected });
  });

  test.each([
    { name: "rejects plain HTTP", value: "http://terminal.example" },
    { name: "rejects a path", value: "https://terminal.example/viewer" },
    { name: "rejects a query", value: "https://terminal.example/?mode=1" },
    { name: "rejects a fragment", value: "https://terminal.example/#term" },
    { name: "rejects credentials", value: "https://user@terminal.example" },
    { name: "rejects an invalid URL", value: "not a URL" },
  ])("$name", ({ value }) => {
    expect(parsePublicOrigin(value)).toEqual({
      ok: false,
      error:
        "--public-origin requires an HTTPS origin without a path, query, fragment, or credentials",
    });
  });
});

describe("requestAllowed", () => {
  test.each([
    {
      name: "keeps localhost navigation allowed",
      host: "127.0.0.1:4173",
      origin: undefined,
      publicOrigin: null,
      expected: true,
    },
    {
      name: "allows the configured public navigation",
      host: "terminal.example",
      origin: undefined,
      publicOrigin: PUBLIC,
      expected: true,
    },
    {
      name: "allows the configured public same-origin request",
      host: "terminal.example",
      origin: "https://terminal.example",
      publicOrigin: PUBLIC,
      expected: true,
    },
    {
      name: "rejects an unconfigured public host",
      host: "terminal.example",
      origin: undefined,
      publicOrigin: null,
      expected: false,
    },
    {
      name: "rejects a different public host",
      host: "other.example",
      origin: "https://terminal.example",
      publicOrigin: PUBLIC,
      expected: false,
    },
    {
      name: "rejects a different public origin",
      host: "terminal.example",
      origin: "https://other.example",
      publicOrigin: PUBLIC,
      expected: false,
    },
    {
      name: "rejects a null origin on the public host",
      host: "terminal.example",
      origin: "null",
      publicOrigin: PUBLIC,
      expected: false,
    },
  ])("$name", ({ host, origin, publicOrigin, expected }) => {
    expect(requestAllowed(request(host, origin), publicOrigin)).toBe(expected);
  });
});

describe("sideEffectRequestAllowed", () => {
  test.each([
    {
      name: "allows a complete localhost action request",
      host: "localhost:4173",
      origin: "http://localhost:4173",
      publicOrigin: null,
      fetchSite: "same-origin",
      requestedBy: "1",
      expected: true,
    },
    {
      name: "allows a complete public action request",
      host: "terminal.example",
      origin: "https://terminal.example",
      publicOrigin: PUBLIC,
      fetchSite: "same-origin",
      requestedBy: "1",
      expected: true,
    },
    {
      name: "rejects a public action without the action marker",
      host: "terminal.example",
      origin: "https://terminal.example",
      publicOrigin: PUBLIC,
      fetchSite: "same-origin",
      requestedBy: undefined,
      expected: false,
    },
    {
      name: "rejects a cross-site public action",
      host: "terminal.example",
      origin: "https://terminal.example",
      publicOrigin: PUBLIC,
      fetchSite: "cross-site",
      requestedBy: "1",
      expected: false,
    },
    {
      name: "rejects a public action from another origin",
      host: "terminal.example",
      origin: "https://other.example",
      publicOrigin: PUBLIC,
      fetchSite: "same-origin",
      requestedBy: "1",
      expected: false,
    },
  ])("$name", ({
    host,
    origin,
    publicOrigin,
    fetchSite,
    requestedBy,
    expected,
  }) => {
    expect(
      sideEffectRequestAllowed(
        request(host, origin, {
          ...(fetchSite ? { "Sec-Fetch-Site": fetchSite } : {}),
          ...(requestedBy ? { "X-Code-Viewer-Action": requestedBy } : {}),
        }),
        publicOrigin,
      ),
    ).toBe(expected);
  });
});
