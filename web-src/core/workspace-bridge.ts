// 外側のページ (host) と面 (pane) のやりとりの形。DOM に触らない。
//
// host は面 (iframe) の文書が読み終わるたびに MessageChannel を開き、片方の口を
// HOST_HELLO に載せて面へ送る (面の app.js は読み終わる前に受け口を置いている。面から
// 送ると、host の app.js より先に面が動いたときに受け手がいない)。面は送り元 (親の
// 窓) と origin を確かめてから口を受け取り、その後は口の上だけでやりとりする (窓の
// message は hello にしか使わない)。
//
// 左のサイドバーと最下段は host が持ち、本文は面が持つ。サイドバーで押したものは
// command で面に頼み、面の状態 (URL・最下段の面ごとの項目・見ているシェル) は面が
// host に知らせる。

import type { KeymapAction } from "./keymap";
import type { AppRoute } from "./routes";

export const HOST_HELLO = "code-viewer:host-hello";

/**
 * 最下段の項目のうち、面ごとに値が違うもの (接続状態・注釈・AI 向けのコピー・
 * 自動更新・通信の中止・リポジトリの Web ページ・診断) と、左のサイドバーで面の
 * 画面を指すリンク。面が中身を host に写し、host で押したものは面の同じ id の
 * 部品を押す。
 */
export const MIRRORED_IDS = [
  "status",
  "annotations-toggle",
  "copy-ai-context",
  "copy-ai-context-feedback",
  "auto-update",
  "cancel-requests",
  "repo-web-link",
  "doctor-btn",
  "search-btn",
  "nav-board-link",
  "nav-settings",
  "nav-help",
] as const;

export type MirroredId = (typeof MIRRORED_IDS)[number];

export function isMirroredId(id: string): id is MirroredId {
  return (MIRRORED_IDS as readonly string[]).includes(id);
}

/** 写した部品 1 つ (属性と中身)。 */
export type MirroredItem = {
  id: MirroredId;
  attributes: [string, string][];
  html: string;
};

export type PaneProject = { root: string; name: string };

export type PaneMessage =
  | { type: "location"; href: string; project: PaneProject | null }
  | { type: "mirror"; items: MirroredItem[] }
  /** 面で見ているシェル (前面のターミナルのタブ)。 */
  | { type: "viewing"; shells: string[] }
  /** 全プロジェクト共通の見た目の設定 (明暗・テーマ・言語・密度) が変わった。 */
  | { type: "look-changed" }
  /** 面の頭の「サイドバーを出す」で開いた。 */
  | { type: "nav-collapsed"; collapsed: boolean };

export type ClickModifiers = {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

export type HostCommand =
  | { type: "switch-project"; root: string; confirmRegister: boolean }
  | { type: "navigate-project"; url: string; replace: boolean }
  | { type: "open-agent-pane"; pane: string; opposite: boolean }
  | { type: "route"; route: AppRoute }
  | { type: "settings-at"; heading: string }
  /** 左のサイドバーのプロジェクトの ▾。面の左端の、その行の高さに開く。 */
  | { type: "project-menu"; root: string; y: number }
  | { type: "keymap"; action: KeymapAction; repeated: boolean }
  | { type: "click"; id: MirroredId; modifiers: ClickModifiers }
  /** 左のサイドバーを畳んだ・開いた (面は頭の「サイドバーを出す」を出し入れする)。 */
  | { type: "nav-collapsed"; collapsed: boolean };

/** 窓の message が host の hello か (別の用途の message は通す)。 */
export function isHostHello(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === HOST_HELLO
  );
}

const PANE_MESSAGE_TYPES: readonly PaneMessage["type"][] = [
  "location",
  "mirror",
  "viewing",
  "look-changed",
  "nav-collapsed",
];

const HOST_COMMAND_TYPES: readonly HostCommand["type"][] = [
  "switch-project",
  "navigate-project",
  "open-agent-pane",
  "route",
  "settings-at",
  "project-menu",
  "keymap",
  "click",
  "nav-collapsed",
];

/**
 * 口に届いた面の知らせ。送るのは同じ app.js なので、形が違うのは版の食い違い
 * (読み直す前の古い面) か不具合。黙って捨てずに投げる。
 */
export function parsePaneMessage(data: unknown): PaneMessage {
  return parseTyped(data, PANE_MESSAGE_TYPES, "pane message") as PaneMessage;
}

/** 口に届いた host の頼み。形の扱いは parsePaneMessage と同じ。 */
export function parseHostCommand(data: unknown): HostCommand {
  return parseTyped(data, HOST_COMMAND_TYPES, "host command") as HostCommand;
}

function parseTyped(
  data: unknown,
  types: readonly string[],
  what: string,
): object {
  if (
    typeof data !== "object" ||
    data === null ||
    !("type" in data) ||
    typeof data.type !== "string"
  )
    throw new Error(`${what} without a type: ${JSON.stringify(data)}`);
  if (!types.includes(data.type))
    throw new Error(`unknown ${what} ${JSON.stringify(data.type)}`);
  return data;
}
