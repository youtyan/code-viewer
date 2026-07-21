export type RepositoryWebTarget = {
  url: string;
  provider: "github" | "web";
};

export type RepositoryWebTargetOptions = {
  ref?: string;
  fallbackRef?: string;
  path?: string;
  kind: "tree" | "blob";
  start?: number;
  end?: number;
};

function encodePath(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function resolvedRef(ref: string | undefined, fallbackRef: string | undefined) {
  if (!ref || ref === "worktree" || ref === "HEAD") {
    return fallbackRef || "HEAD";
  }
  return ref;
}

export function buildRepositoryWebTarget(
  repoWebUrl: string | null | undefined,
  options: RepositoryWebTargetOptions,
): RepositoryWebTarget | null {
  if (!repoWebUrl) return null;
  let remote: URL;
  try {
    remote = new URL(repoWebUrl);
  } catch {
    return null;
  }
  if (remote.protocol !== "http:" && remote.protocol !== "https:") return null;
  remote.search = "";
  remote.hash = "";
  remote.pathname = remote.pathname.replace(/\/+$/, "");
  const base = remote.toString().replace(/\/$/, "");
  if (remote.hostname.toLowerCase() !== "github.com") {
    return { url: base, provider: "web" };
  }

  const ref = encodePath(resolvedRef(options.ref, options.fallbackRef));
  const path = encodePath(options.path || "");
  if (!ref || (options.kind === "blob" && !path)) {
    return { url: base, provider: "github" };
  }
  const pathSuffix = path ? `/${path}` : "";
  const target = `${base}/${options.kind}/${ref}${pathSuffix}`;
  if (
    options.kind !== "blob" ||
    !Number.isFinite(options.start) ||
    !Number.isFinite(options.end)
  ) {
    return { url: target, provider: "github" };
  }
  const start = Math.max(
    1,
    Math.floor(Math.min(options.start as number, options.end as number)),
  );
  const end = Math.max(
    1,
    Math.floor(Math.max(options.start as number, options.end as number)),
  );
  const lineHash = start === end ? `#L${start}` : `#L${start}-L${end}`;
  return { url: `${target}${lineHash}`, provider: "github" };
}
