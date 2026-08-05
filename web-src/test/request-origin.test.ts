import { describe, expect, test } from "vitest";
import {
  requestAllowed,
  sideEffectRequestAllowed,
} from "../server/request-origin";

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

describe("requestAllowed", () => {
  test.each([
    {
      name: "allows loopback navigation without an Origin header",
      host: "127.0.0.1:4173",
      origin: undefined,
      expected: true,
    },
    {
      name: "allows a localhost same-origin request",
      host: "localhost:4173",
      origin: "http://localhost:4173",
      expected: true,
    },
    {
      name: "allows an IPv6 loopback same-origin request",
      host: "[::1]:4173",
      origin: "http://[::1]:4173",
      expected: true,
    },
    {
      name: "allows a null Origin on a loopback host",
      host: "localhost:4173",
      origin: "null",
      expected: true,
    },
    {
      name: "rejects a non-loopback host",
      host: "example.invalid",
      origin: undefined,
      expected: false,
    },
    {
      name: "rejects a non-loopback Origin",
      host: "localhost:4173",
      origin: "https://example.invalid",
      expected: false,
    },
    {
      name: "rejects HTTPS on a loopback Origin",
      host: "localhost:4173",
      origin: "https://localhost:4173",
      expected: false,
    },
  ])("$name", ({ host, origin, expected }) => {
    expect(requestAllowed(request(host, origin))).toBe(expected);
  });
});

describe("sideEffectRequestAllowed", () => {
  test.each([
    {
      name: "allows a complete localhost action request",
      host: "localhost:4173",
      origin: "http://localhost:4173",
      fetchSite: "same-origin",
      requestedBy: "1",
      expected: true,
    },
    {
      name: "allows a complete IPv4 loopback action request",
      host: "127.0.0.1:4173",
      origin: "http://127.0.0.1:4173",
      fetchSite: "same-origin",
      requestedBy: "1",
      expected: true,
    },
    {
      name: "rejects a non-loopback action request",
      host: "example.invalid",
      origin: "https://example.invalid",
      fetchSite: "same-origin",
      requestedBy: "1",
      expected: false,
    },
    {
      name: "rejects an action without the action marker",
      host: "localhost:4173",
      origin: "http://localhost:4173",
      fetchSite: "same-origin",
      requestedBy: undefined,
      expected: false,
    },
    {
      name: "rejects an action with the wrong action marker",
      host: "localhost:4173",
      origin: "http://localhost:4173",
      fetchSite: "same-origin",
      requestedBy: "0",
      expected: false,
    },
    {
      name: "rejects a cross-site loopback action",
      host: "localhost:4173",
      origin: "http://localhost:4173",
      fetchSite: "cross-site",
      requestedBy: "1",
      expected: false,
    },
    {
      name: "rejects a loopback action from another Origin",
      host: "localhost:4173",
      origin: "http://127.0.0.1:4173",
      fetchSite: "same-origin",
      requestedBy: "1",
      expected: false,
    },
  ])("$name", ({ host, origin, fetchSite, requestedBy, expected }) => {
    expect(
      sideEffectRequestAllowed(
        request(host, origin, {
          ...(fetchSite ? { "Sec-Fetch-Site": fetchSite } : {}),
          ...(requestedBy ? { "X-Code-Viewer-Action": requestedBy } : {}),
        }),
      ),
    ).toBe(expected);
  });
});
