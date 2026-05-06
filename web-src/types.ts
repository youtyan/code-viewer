import type { GdpExpandLogic } from "./expand-logic";

export type FileMeta = {
  order?: number;
  key?: string;
  path: string;
  old_path?: string;
  display_path?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
  media_kind?: string | null;
  size_class?: string;
  force_layout?: string;
  highlight?: boolean;
  load_url: string;
  preview_url?: string | null;
  estimated_height_px?: number;
  untracked?: boolean;
};

export type DiffMeta = {
  files: FileMeta[];
  totals?: {
    files: number;
    additions: number;
    deletions: number;
  };
  range?: string;
  branch?: string;
  project?: string;
  generation?: number;
};

export type RepoTreeEntry = {
  name: string;
  path: string;
  type: "tree" | "blob" | "commit";
  children_omitted?: true;
  children_omitted_reason?: "heavy" | "internal" | "truncated";
};

export type RepoTreeResponse = {
  ref: string;
  path: string;
  project: string;
  branch?: string;
  upload_enabled?: boolean;
  entries: RepoTreeEntry[];
  readme?: {
    path: string;
    text: string;
  } | null;
};

export type SettingsResponse = {
  project: string;
  scope: {
    omit_dirs_effective: string[];
    omit_dirs_built_in: string[];
    max_entries: number;
  };
};

export type FileSearchListResponse = {
  ref: string;
  generation: number;
  files: {
    path: string;
    type: "blob" | "commit";
  }[];
  truncated: boolean;
};

export type GrepMatch = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

export type GrepResponse = {
  ref: string;
  engine: "rg" | "git" | "fallback";
  truncated: boolean;
  matches: GrepMatch[];
};

export type FileDiffResponse = {
  path: string;
  old_path?: string;
  status?: string;
  mode?: string;
  diff: string;
  hunk_count?: number;
  rendered_hunk_count?: number;
  truncated?: boolean;
  binary?: boolean;
  generation?: number;
};

export type FileRangeResponse = {
  path: string;
  ref: string;
  start: number;
  end: number;
  lines: string[];
  /**
   * When complete is true, total is the file's total line count.
   * When complete is false, total is only the highest line number the server
   * had to scan to prove more lines exist.
   */
  total: number;
  complete?: boolean;
  generation?: number;
};

export type DiffCardElement = HTMLElement & {
  _diffData?: FileDiffResponse | null;
  _file?: FileMeta | null;
};

export type RefResponse = {
  branches?: BranchMeta[];
  tags?: TagMeta[];
  commits?: CommitMeta[];
  current?: string;
};

export type BranchMeta = {
  name: string;
  when: string;
};

export type TagMeta = {
  name: string;
  when: string;
};

export type CommitMeta = {
  sha: string;
  subject: string;
  author: string;
  when: string;
};

export type RefCommitResponse = {
  commits?: CommitMeta[];
};

type Diff2HtmlGlobal = {
  new (
    element: HTMLElement,
    diffInput: string,
    configuration?: Record<string, unknown>,
    hljs?: {
      highlightElement?: (element: HTMLElement) => void;
      highlight?: (
        code: string,
        options: { language: string; ignoreIllegals: boolean },
      ) => { value: string };
    } | null,
  ): {
    draw(): void;
    highlightCode(): void;
  };
  hljs?: {
    highlightElement?: (element: HTMLElement) => void;
    highlight?: (
      code: string,
      options: { language: string; ignoreIllegals: boolean },
    ) => { value: string };
  };
};

declare global {
  interface Window {
    Diff2HtmlUI: Diff2HtmlGlobal;
    hljs: unknown;
    GdpExpandLogic: typeof GdpExpandLogic;
    _lastMeta?: DiffMeta;
    __gdpScrollSpy?: EventListener;
    __gdpSidebarTouchedAt?: number;
  }

  const Diff2HtmlUI: Diff2HtmlGlobal;
}
