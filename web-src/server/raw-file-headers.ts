import { extname } from "node:path";
import { sourceDisplayKind } from "../core/source-meta";

export type FileMetadata = {
  size?: number;
  created_at?: string;
  updated_at?: string;
  commit_updated_at?: string;
};

export type RawFileHeaderOptions = {
  size?: number | null;
  range?: { start: number; end: number };
  metadata?: FileMetadata;
  upstreamContentType?: string | null;
  htmlAsHtml?: boolean;
  allowUpstreamMediaContentType?: boolean;
  contentLength?: string | null;
  contentRange?: string | null;
  etag?: string | null;
  lastModified?: string | null;
};

const RAW_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".opus": "audio/ogg",
};

function safeUpstreamMediaContentType(
  value: string | null | undefined,
): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return "";
  const base = trimmed.split(";", 1)[0]?.toLowerCase() || "";
  if (base === "application/pdf") return trimmed;
  if (base === "image/svg+xml") return "";
  if (
    base.startsWith("image/") ||
    base.startsWith("video/") ||
    base.startsWith("audio/")
  ) {
    return trimmed;
  }
  return "";
}

export function inferRawContentType(
  path: string,
  opts: Pick<
    RawFileHeaderOptions,
    "upstreamContentType" | "htmlAsHtml" | "allowUpstreamMediaContentType"
  > = {},
): string {
  const lowerExt = extname(path).toLowerCase();
  if (opts.htmlAsHtml && (lowerExt === ".html" || lowerExt === ".htm")) {
    return "text/html; charset=utf-8";
  }
  const byExt = RAW_MIME_BY_EXT[lowerExt];
  if (byExt) return byExt;
  if (sourceDisplayKind(path) === "text") return "text/plain; charset=utf-8";
  if (opts.allowUpstreamMediaContentType) {
    const safe = safeUpstreamMediaContentType(opts.upstreamContentType);
    if (safe) return safe;
  }
  return "application/octet-stream";
}

export function fileMetadataHeaders(
  metadata: FileMetadata = {},
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (metadata.created_at)
    headers["X-Code-Viewer-Created-At"] = metadata.created_at;
  if (metadata.updated_at)
    headers["X-Code-Viewer-Updated-At"] = metadata.updated_at;
  if (metadata.commit_updated_at)
    headers["X-Code-Viewer-Commit-Updated-At"] = metadata.commit_updated_at;
  return headers;
}

export function rawFileHeaders(
  path: string,
  opts: RawFileHeaderOptions = {},
): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": inferRawContentType(path, opts),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Accept-Ranges": "bytes",
  };
  if (opts.contentLength) {
    headers["Content-Length"] = opts.contentLength;
  } else if (opts.range && opts.size != null) {
    headers["Content-Length"] = String(opts.range.end - opts.range.start + 1);
  } else if (opts.size != null) {
    headers["Content-Length"] = String(opts.size);
  }
  if (opts.contentRange) {
    headers["Content-Range"] = opts.contentRange;
  } else if (opts.range && opts.size != null) {
    headers["Content-Range"] =
      `bytes ${opts.range.start}-${opts.range.end}/${opts.size}`;
  }
  if (opts.etag) headers.ETag = opts.etag;
  if (opts.lastModified) headers["Last-Modified"] = opts.lastModified;
  for (const [key, value] of Object.entries(
    fileMetadataHeaders(opts.metadata),
  )) {
    headers[key] = value;
  }
  return headers;
}
