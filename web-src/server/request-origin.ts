export type PublicOrigin = {
  origin: string;
  host: string;
};

export type PublicOriginParseResult =
  | { ok: true; value: PublicOrigin }
  | { ok: false; error: string };

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i;
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/i;
const PUBLIC_ORIGIN_ERROR =
  "--public-origin requires an HTTPS origin without a path, query, fragment, or credentials";

export function parsePublicOrigin(value: string): PublicOriginParseResult {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: PUBLIC_ORIGIN_ERROR };
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return { ok: false, error: PUBLIC_ORIGIN_ERROR };
  }
  return {
    ok: true,
    value: {
      origin: parsed.origin,
      host: parsed.host,
    },
  };
}

export function requestAllowed(
  req: Request,
  publicOrigin: PublicOrigin | null,
): boolean {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  if (LOCAL_HOST.test(host)) {
    return !origin || origin === "null" || LOCAL_ORIGIN.test(origin);
  }
  return (
    publicOrigin !== null &&
    host.toLowerCase() === publicOrigin.host.toLowerCase() &&
    (!origin || origin === publicOrigin.origin)
  );
}

export function sideEffectRequestAllowed(
  req: Request,
  publicOrigin: PublicOrigin | null,
): boolean {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const requestedBy = req.headers.get("x-code-viewer-action");
  const local = LOCAL_HOST.test(host) && origin === `http://${host}`;
  const remote =
    publicOrigin !== null &&
    host.toLowerCase() === publicOrigin.host.toLowerCase() &&
    origin === publicOrigin.origin;
  return (
    (local || remote) &&
    (!fetchSite || fetchSite === "same-origin") &&
    requestedBy === "1"
  );
}
