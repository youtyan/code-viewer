const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i;
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/i;

export function requestAllowed(req: Request): boolean {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  return (
    LOCAL_HOST.test(host) &&
    (!origin || origin === "null" || LOCAL_ORIGIN.test(origin))
  );
}

export function sideEffectRequestAllowed(req: Request): boolean {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const requestedBy = req.headers.get("x-code-viewer-action");
  const local = LOCAL_HOST.test(host) && origin === `http://${host}`;
  return (
    local && (!fetchSite || fetchSite === "same-origin") && requestedBy === "1"
  );
}
