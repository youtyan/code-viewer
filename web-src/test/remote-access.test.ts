import { needsRemoteLogin } from "../views/remote-access";
import { generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import {
  createRemoteAccess,
  parseRemoteAccessConfig,
} from "../server/entry/remote-access";
import { proxyToBackend } from "../server/entry/proxy";
import {
  requestAllowed,
  sideEffectRequestAllowed,
} from "../server/request-origin";

const config = {
  port: 64161,
  origin: "https://viewer.example.com",
  teamDomain: "example.cloudflareaccess.com",
  audience: "a".repeat(64),
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const claims: JWTPayload = {
  iss: "https://example.cloudflareaccess.com",
  aud: config.audience,
  sub: "sample-user",
  exp: 2_000_000_000,
};
async function token(payload: JWTPayload = claims) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .sign(keys.privateKey);
}
function request(jwt: string, path = "/", init: RequestInit = {}) {
  return new Request(`http://viewer.example.com${path}`, {
    ...init,
    headers: {
      host: "viewer.example.com",
      "cf-access-jwt-assertion": jwt,
      ...init.headers,
    },
  });
}

test.each([
  ["missing config", null],
  ["zero port", { ...config, port: 0 }],
  ["port over range", { ...config, port: 65536 }],
  ["HTTP origin", { ...config, origin: "http://viewer.example.com" }],
  [
    "origin with path",
    { ...config, origin: "https://viewer.example.com/path" },
  ],
  [
    "origin with credentials",
    { ...config, origin: "https://user@viewer.example.com" },
  ],
  ["foreign key host", { ...config, teamDomain: "keys.example.com" }],
  ["missing AUD", { ...config, audience: "" }],
  ["unknown field", { ...config, enabled: true }],
])("rejects %s configuration", (_name, value) => {
  expect(() => parseRemoteAccessConfig(value)).toThrow();
});

test.each([
  1, 64161, 65535,
])("accepts port %s and the fixed Access issuer", (port) => {
  expect(parseRemoteAccessConfig({ ...config, port })).toEqual({
    ...config,
    port,
  });
});

test.each([
  ["different audience", { ...claims, aud: "b".repeat(64) }],
  [
    "different issuer",
    { ...claims, iss: "https://other.cloudflareaccess.com" },
  ],
  ["expired", { ...claims, exp: 1 }],
  ["missing expiry", { ...claims, exp: undefined }],
  ["missing subject", { ...claims, sub: undefined }],
])("rejects signed tokens with %s before dispatch", async (_name, payload) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const next = vi.fn();
  const response = await createRemoteAccess(config, async () => keys.publicKey)(
    request(await token(payload)),
    next,
  );
  expect(response.status).toBe(401);
  expect(next).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
});

test("rejects a signature from another key", async () => {
  const other = await generateKeyPair("RS256");
  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .sign(other.privateKey);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const next = vi.fn();
  expect(
    (
      await createRemoteAccess(config, async () => keys.publicKey)(
        request(jwt),
        next,
      )
    ).status,
  ).toBe(401);
  expect(next).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
});

test.each([
  {
    name: "missing JWT",
    path: "/",
    headers: { "cf-access-jwt-assertion": "" },
    method: "GET",
    status: 401,
  },
  {
    name: "forged localhost",
    path: "/",
    headers: { host: "127.0.0.1:64161" },
    method: "GET",
    status: 403,
  },
  {
    name: "entry identity",
    path: "/_entry",
    headers: {},
    method: "GET",
    status: 403,
  },
  {
    name: "project adoption",
    path: "/p/0123456789abcdef/_entry/adopt",
    headers: {},
    method: "GET",
    status: 403,
  },
  {
    name: "cross-site read",
    path: "/",
    headers: { origin: "https://other.example.com" },
    method: "GET",
    status: 403,
  },
  {
    name: "action without marker",
    path: "/refresh",
    headers: { origin: config.origin },
    method: "POST",
    status: 403,
  },
  {
    name: "action without origin",
    path: "/refresh",
    headers: { "x-code-viewer-action": "1" },
    method: "POST",
    status: 403,
  },
  {
    name: "cross-site metadata",
    path: "/refresh",
    headers: {
      origin: config.origin,
      "x-code-viewer-action": "1",
      "sec-fetch-site": "cross-site",
    },
    method: "POST",
    status: 403,
  },
])("refuses $name on the remote listener", async ({
  path,
  headers,
  method,
  status,
}) => {
  const next = vi.fn();
  const response = await createRemoteAccess(config, async () => keys.publicKey)(
    request(await token(), path, { method, headers: headers as HeadersInit }),
    next,
  );
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(next).not.toHaveBeenCalled();
});

test.each([
  "cf-access-jwt-assertion",
  "cf-connecting-ip",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "forwarded",
])("local listener rejects %s instead of assuming local trust", (header) => {
  const req = new Request("http://localhost:64160/", {
    headers: {
      host: "localhost:64160",
      origin: "http://localhost:64160",
      "x-code-viewer-action": "1",
      [header]: "sample",
    },
  });
  expect(requestAllowed(req)).toBe(false);
  expect(sideEffectRequestAllowed(req)).toBe(false);
});

test.each([
  "GET",
  "POST",
])("authenticates and streams %s to a local project without Access credentials", async (method) => {
  const handler = createRemoteAccess(config, async () => keys.publicKey);
  const req = request(await token(), "/p/0123456789abcdef/refresh", {
    method,
    headers: {
      origin: config.origin,
      "x-code-viewer-action": "1",
      cookie: "CF_Authorization=sample",
      "cf-connecting-ip": "192.0.2.1",
      "x-forwarded-proto": "https",
    },
    ...(method === "POST" ? { body: "sample body" } : {}),
  });
  const response = await handler(req, async (authenticated) => {
    expect(authenticated.url).toBe(
      "https://viewer.example.com/p/0123456789abcdef/refresh",
    );
    const result = await proxyToBackend(
      authenticated,
      "http://127.0.0.1:4173/",
      "/refresh",
      "",
      {
        publicOrigin: config.origin,
        fetch: async (input, init) => {
          const backend = new Request(input, init);
          backend.headers.set("host", "127.0.0.1:4173");
          expect(requestAllowed(backend)).toBe(true);
          expect(sideEffectRequestAllowed(backend)).toBe(true);
          expect(backend.headers.get("cookie")).toBeNull();
          expect(backend.headers.get("cf-access-jwt-assertion")).toBeNull();
          expect(backend.headers.get("x-forwarded-proto")).toBeNull();
          return new Response(await backend.text());
        },
      },
    );
    if (result.status !== "ok") throw result.error;
    return result.response;
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toBe(method === "POST" ? "sample body" : "");
});

test("expires SSE subscriptions without keeping their source alive", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2033-05-18T03:33:19Z"));
  const cancel = vi.fn();
  const source = new ReadableStream<Uint8Array>({ cancel });
  const response = await createRemoteAccess(config, async () => keys.publicKey)(
    request(await token()),
    async () =>
      new Response(source, {
        headers: { "content-type": "text/event-stream" },
      }),
  );
  const read = response.body?.getReader().read();
  const failed = expect(read).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(1000);
  await failed;
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  [
    "edge expiry on remote origin",
    401,
    "https://viewer.example.com/_settings",
    true,
  ],
  ["unrelated server authentication", 401, "https://other.example.com/", false],
  [
    "ordinary forbidden response",
    403,
    "https://viewer.example.com/_settings",
    false,
  ],
])("login notice: %s", (_name, status, url, expected) => {
  const response = new Response("", { status });
  Object.defineProperty(response, "url", { value: url });
  expect(needsRemoteLogin(response, "https://viewer.example.com")).toBe(
    expected,
  );
});
