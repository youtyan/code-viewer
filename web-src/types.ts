import type { GdpExpandLogic } from './expand-logic';

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
  type: 'tree' | 'blob' | 'commit';
  children_omitted?: true;
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
  total: number;
  generation?: number;
};

export type DiffCardElement = HTMLElement & {
  _diffData?: FileDiffResponse | null;
  _file?: FileMeta | null;
};

export type RefResponse = {
  branches?: string[];
  tags?: string[];
  commits?: string[];
  current?: string;
};

declare global {
  interface Window {
    Diff2HtmlUI: any;
    hljs: any;
    GdpExpandLogic: typeof GdpExpandLogic;
    _lastMeta?: DiffMeta;
    __gdpScrollSpy?: EventListener;
    __gdpSidebarTouchedAt?: number;
  }

  const Diff2HtmlUI: any;
}
