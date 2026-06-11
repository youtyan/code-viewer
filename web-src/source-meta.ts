// Source file classification: language tables, previewability, display
// kind, and small formatting helpers. Pure functions extracted from app.ts.

import { isAudio, isImage, isVideo } from "./media-embed";

const SOURCE_SHIKI_LANG_ALIASES: Record<string, string> = {
  makefile: "make",
  objectivec: "c",
  "objective-c": "c",
  "objective-cpp": "cpp",
  starlark: "python",
};

export function normalizeSourceShikiLang(lang: string | null): string | null {
  if (!lang) return null;
  return SOURCE_SHIKI_LANG_ALIASES[lang] || lang;
}

export function isPreviewableSource(path: string): boolean {
  return /\.(md|markdown|mdown|mkdn|mdx|html|htm)$/i.test(path);
}

export function sourcePreviewKind(path: string): "markdown" | "html" | null {
  if (/\.(md|markdown|mdown|mkdn|mdx)$/i.test(path)) return "markdown";
  if (/\.(html|htm)$/i.test(path)) return "html";
  return null;
}

export const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  lua: "lua",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  sql: "sql",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  tf: "terraform",
  tfvars: "terraform",
  hcl: "terraform",
  xml: "xml",
  html: "xml",
  vue: "xml",
  css: "css",
  scss: "scss",
  md: "markdown",
  dockerfile: "dockerfile",
  proto: "protobuf",
  gradle: "gradle",
  properties: "properties",
  patch: "diff",
  diff: "diff",
  nix: "nix",
  cue: "cue",
  rego: "rego",
  bicep: "bicep",
  bazel: "starlark",
  bzl: "starlark",
  cmake: "cmake",
  groovy: "groovy",
  dart: "dart",
  scala: "scala",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  edn: "clojure",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  hs: "haskell",
  lhs: "haskell",
  ml: "ocaml",
  mli: "ocaml",
  jl: "julia",
  r: "r",
  rmd: "r",
  pl: "perl",
  pm: "perl",
  tcl: "tcl",
  vim: "vim",
  f: "fortran",
  f90: "fortran",
  m: "objective-c",
  mm: "objective-cpp",
  tex: "tex",
  bib: "bibtex",
  rst: "rst",
};

const TEXT_SOURCE_EXTENSIONS = new Set([
  ...Object.keys(EXT_TO_LANG),
  "txt",
  "md",
  "markdown",
  "mdown",
  "mkdn",
  "mdx",
  "json",
  "jsonc",
  "csv",
  "tsv",
  "yaml",
  "yml",
  "toml",
  "hcl",
  "tf",
  "tfvars",
  "tfstate",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
  "vue",
  "svelte",
  "astro",
  "rs",
  "go",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "kts",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hpp",
  "cs",
  "swift",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "sql",
  "graphql",
  "graphqls",
  "gql",
  "ini",
  "conf",
  "env",
  "properties",
  "gitignore",
  "dockerignore",
  "editorconfig",
  "lock",
  "log",
  "patch",
  "diff",
  "sum",
  "mk",
  "proto",
  "thrift",
  "prisma",
  "gradle",
  "cmake",
  "nix",
  "cue",
  "rego",
  "bicep",
  "bazel",
  "bzl",
  "dart",
  "scala",
  "clj",
  "cljs",
  "cljc",
  "edn",
  "ex",
  "exs",
  "erl",
  "hrl",
  "hs",
  "lhs",
  "ml",
  "mli",
  "jl",
  "r",
  "rmd",
  "pl",
  "pm",
  "tcl",
  "vim",
  "groovy",
  "f",
  "f90",
  "m",
  "mm",
  "pas",
  "tex",
  "bib",
  "rst",
  "adoc",
  "org",
  "ipynb",
  "ejs",
  "hbs",
  "mustache",
  "liquid",
  "pug",
]);

const TEXT_SOURCE_FILENAMES = new Set([
  "readme",
  "license",
  "copying",
  "authors",
  "contributors",
  "notice",
  "changelog",
  "todo",
  "manifest",
  "version",
  "codeowners",
  "go.mod",
  "build.bazel",
  "workspace.bazel",
  "module.bazel",
  "gemfile",
  "rakefile",
  "procfile",
  "brewfile",
  "gnumakefile",
  "bsdmakefile",
  ".gitattributes",
  ".gitmodules",
  ".npmrc",
  ".nvmrc",
  ".yarnrc",
  ".prettierrc",
  ".eslintrc",
  ".babelrc",
  ".stylelintrc",
]);

export const FILENAME_TO_LANG: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  bsdmakefile: "makefile",
  "go.mod": "go",
  "build.bazel": "starlark",
  "workspace.bazel": "starlark",
  "module.bazel": "starlark",
};

export function sourceFileName(path: string): string {
  return (path.split("/").pop() || path).toLowerCase();
}

export function sourceFileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1) : "";
}

export function isDockerfileName(name: string): boolean {
  return /^dockerfile(?:[.-].+)?$/i.test(name);
}

export function isMakefileName(name: string): boolean {
  return /^makefile(?:[.-].+)?$/i.test(name);
}

export function sourceDisplayKind(
  path: string,
): "image" | "video" | "audio" | "pdf" | "text" | "unsupported" {
  if (isVideo(path)) return "video";
  if (isAudio(path)) return "audio";
  if (isImage(path)) return "image";
  if (/\.pdf$/i.test(path)) return "pdf";
  const name = sourceFileName(path);
  const ext = sourceFileExtension(name);
  if (TEXT_SOURCE_EXTENSIONS.has(ext)) return "text";
  if (TEXT_SOURCE_FILENAMES.has(name)) return "text";
  if (isDockerfileName(name) || isMakefileName(name)) return "text";
  return "unsupported";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return (
    (unit === 0
      ? String(value)
      : value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, "")) +
    " " +
    units[unit]
  );
}

export function formatFileDate(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function humanFileKind(
  path: string,
  mime: string | undefined,
  fallback: string,
): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "PNG image";
  if (ext === "jpg" || ext === "jpeg") return "JPEG image";
  if (ext === "gif") return "GIF image";
  if (ext === "webp") return "WebP image";
  if (ext === "svg") return "SVG image";
  if (ext === "pdf") return "PDF document";
  if (ext === "zip") return "ZIP archive";
  if (ext === "mp4") return "MP4 video";
  if (ext === "webm") return "WebM video";
  if (ext === "mp3") return "MP3 audio";
  if (ext === "wav") return "WAV audio";
  if (ext === "ogg") return "Ogg audio";
  if (ext === "flac") return "FLAC audio";
  if (ext === "m4a") return "M4A audio";
  if (ext === "aac") return "AAC audio";
  if (ext === "opus") return "Opus audio";
  if (ext === "mid" || ext === "midi") return "MIDI file";
  if (mime?.startsWith("image/")) return "Image";
  if (mime?.startsWith("video/")) return "Video";
  if (mime?.startsWith("audio/")) return "Audio";
  if (mime === "application/pdf") return "PDF document";
  if (fallback === "unsupported file") return "Binary file";
  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}
