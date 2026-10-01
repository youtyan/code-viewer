import { readFileSync } from "node:fs";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { errorWithCause } from "../../core/error-detail";
import { createLinkedAbortController } from "../abort";
import { requestAllowed, sideEffectRequestAllowed } from "../request-origin";

export type RemoteAccessConfig = {
  port: number;
  origin: string;
  teamDomain: string;
  audience: string;
};

export function readRemoteAccessConfig(path: string): RemoteAccessConfig {
  try {
    return parseRemoteAccessConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw errorWithCause(`could not read remote access config ${path}`, error);
  }
}

export function parseRemoteAccessConfig(value: unknown): RemoteAccessConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("remote access config must be a JSON object");
  }
  const fields = value as Record<string, unknown>;
  const unknown = Object.keys(fields).filter(
    (key) => !["port", "origin", "teamDomain", "audience"].includes(key),
  );
  if (unknown.length)
    throw new Error(`unknown remote access fields: ${unknown.join(", ")}`);
  const { port, origin, teamDomain, audience } = fields;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("remote access port must be an integer from 1 to 65535");
  }
  if (typeof origin !== "string")
    throw new Error("remote access origin is required");
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    !url.hostname.includes(".") ||
    url.hostname === "127.0.0.1"
  ) {
    throw new Error(
      "remote access origin must be a public HTTPS origin without a path, credentials or trailing slash",
    );
  }
  if (
    typeof teamDomain !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(teamDomain)
  ) {
    throw new Error(
      "teamDomain must be <team>.cloudflareaccess.com (without https://)",
    );
  }
  if (typeof audience !== "string" || !/^[a-f0-9]{64}$/.test(audience)) {
    throw new Error(
      "audience must be the Access application's 64-character hexadecimal AUD tag",
    );
  }
  return { port, origin, teamDomain, audience };
}

function remoteError(status: number, code: string, error: string): Response {
  return Response.json(
    { code, error },
    {
      status,
      headers: { "Cache-Control": "no-store", "X-Code-Viewer-Remote": "1" },
    },
  );
}

/** Only the dedicated listener invokes this boundary, never a forwarded header. */
export function createRemoteAccess(
  config: RemoteAccessConfig,
  getKey?: JWTVerifyGetKey,
) {
  const issuer = `https://${config.teamDomain}`;
  const keys =
    getKey ?? createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
  return async (
    request: Request,
    next: (request: Request) => Promise<Response>,
  ): Promise<Response> => {
    if (!requestAllowed(request, config.origin)) {
      return remoteError(
        403,
        "remote-origin",
        "Host or Origin does not match the configured public origin",
      );
    }
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token)
      return remoteError(
        401,
        "remote-auth",
        "Cloudflare Access login is required",
      );
    let expires: number;
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: config.audience,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "sub"],
      });
      if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp))
        throw new Error("Access token has no finite expiry");
      expires = payload.exp * 1000;
    } catch (error) {
      // Do not log the raw credential. Preserve the verifier's error and stack.
      console.error(
        "[code-viewer] remote Access JWT verification failed:",
        error,
      );
      return remoteError(
        401,
        "remote-auth",
        "Cloudflare Access verification failed; sign in again. Details are in the server log.",
      );
    }
    const url = new URL(request.url);
    if (
      url.pathname === "/_entry" ||
      url.pathname === "/_entry/open" ||
      /(?:^|\/)_entry(?:\/(?:adopt|open))?$/.test(url.pathname)
    ) {
      return remoteError(
        403,
        "remote-local-only",
        "This route is available only on the local listener",
      );
    }
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      !sideEffectRequestAllowed(request, config.origin)
    ) {
      return remoteError(
        403,
        "remote-action",
        "A same-origin request with X-Code-Viewer-Action: 1 is required",
      );
    }
    // Use the configured HTTPS origin, not any forwarding headers or absolute request target.
    const authenticated = new Request(
      `${config.origin}${url.pathname}${url.search}`,
      request,
    );
    const response = await next(authenticated);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Code-Viewer-Remote", "1");
    const body =
      response.body &&
      response.headers.get("content-type")?.startsWith("text/event-stream")
        ? expiringStream(response.body, request.signal, expires)
        : response.body;
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/** Closing a subscription cancels its source; the tmux job is owned separately. */
function expiringStream(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  expires: number,
): ReadableStream<Uint8Array> {
  const lease = createLinkedAbortController(
    signal,
    Math.max(0, Math.min(expires - Date.now(), 2_147_483_647)),
  );
  const reader = source
    .pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), {
      signal: lease.signal,
    })
    .getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          lease.cleanup();
          controller.close();
        } else controller.enqueue(chunk.value);
      } catch (error) {
        lease.cleanup();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        lease.cleanup();
      }
    },
  });
}
