const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i;
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/i;

export function requestAllowed(req: Request, publicOrigin?: string): boolean {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  if (publicOrigin) {
    return (
      host === new URL(publicOrigin).host &&
      (!origin || origin === publicOrigin)
    );
  }
  if (hasForwardedHeaders(req)) return false;
  return (
    LOCAL_HOST.test(host) &&
    (!origin || origin === "null" || LOCAL_ORIGIN.test(origin))
  );
}

export function sideEffectRequestAllowed(
  req: Request,
  publicOrigin?: string,
): boolean {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const requestedBy = req.headers.get("x-code-viewer-action");
  const local = publicOrigin
    ? host === new URL(publicOrigin).host && origin === publicOrigin
    : !hasForwardedHeaders(req) &&
      LOCAL_HOST.test(host) &&
      origin === `http://${host}`;
  return (
    local && (!fetchSite || fetchSite === "same-origin") && requestedBy === "1"
  );
}

/** A tunnel pointed at the local listener must never inherit local trust. */
function hasForwardedHeaders(req: Request): boolean {
  return [
    "cf-access-jwt-assertion",
    "cf-connecting-ip",
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ].some((name) => req.headers.has(name));
}
