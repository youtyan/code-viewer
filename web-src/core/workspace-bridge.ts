// 外側のページ (host) と面 (pane) のやりとりの形。DOM に触らない。
//
// host は面 (iframe) の文書が読み終わるたびに MessageChannel を開き、片方の口を
// HOST_HELLO に載せて面へ送る (面の app.js は読み終わる前に受け口を置いている。面から
// 送ると、host の app.js より先に面が動いたときに受け手がいない)。面は送り元 (親の
// 窓) と origin を確かめてから口を受け取り、その後は口の上だけでやりとりする (窓の
// message は hello にしか使わない)。
//
// 左のサイドバーと最下段は host が持ち、本文は面が持つ。サイドバーで押したものは
// command でフォーカスのある面に頼み、面の状態 (URL・最下段の面ごとの項目・見ている
// シェル・タブの配置) は面が host に知らせる。面の並び (分ける・閉じる・フォーカス) と
// 保存は host が持つ (core/workspace.ts)。

import type { AgentOverviewResponse } from "./agent-overview";
import type { KeymapAction } from "./keymap";
import type { SerializedLayout } from "./main-tabs";
import type { AppRoute } from "./routes";
import type { PaneId, SplitDir } from "./workspace";

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

/** host が面の並びとして受ける操作 (キーと、面の中のメニュー)。 */
export const WORKSPACE_ACTIONS = [
  "pane-split-right",
  "pane-split-down",
  "pane-close",
  // 次の面へ (1 枚の画面では、左右 2 面のもう一方へ)。
  "main-pane-other",
  "pane-focus-previous",
  "pane-focus-left",
  "pane-focus-right",
  "pane-focus-up",
  "pane-focus-down",
] as const satisfies readonly KeymapAction[];

export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

export function isWorkspaceAction(
  action: KeymapAction,
): action is WorkspaceAction {
  return (WORKSPACE_ACTIONS as readonly string[]).includes(action);
}

/** 写した部品 1 つ (属性と中身)。 */
export type MirroredItem = {
  id: MirroredId;
  attributes: [string, string][];
  html: string;
};

export type PaneProject = { root: string; name: string };

/**
 * 別の面へ持っていくタブ。route か terminal のどちらか、project は route の持ち物
 * (同じプロジェクトの面にだけ開く)。開ける面が無ければ url と layout で新しい面を作る
 * (layout はそのタブ 1 枚)。
 */
export type TabCarry = {
  route: AppRoute | null;
  terminal: string | null;
  project: string | null;
  url: string;
  layout: SerializedLayout;
};

export type PaneMessage =
  | { type: "location"; href: string; project: PaneProject | null }
  | { type: "mirror"; items: MirroredItem[] }
  /** 面で見ているシェル (前面のターミナルのタブ)。 */
  | { type: "viewing"; shells: string[] }
  /** 全プロジェクト共通の見た目の設定 (明暗・テーマ・言語・密度) が変わった。 */
  | { type: "look-changed" }
  /** 面の頭の「サイドバーを出す」で開いた。 */
  | { type: "nav-collapsed"; collapsed: boolean }
  /** 面のタブの配置が変わった (保存は host が窓ごとにする)。 */
  | { type: "tabs"; layout: SerializedLayout }
  /** 利用者が面に触れた (押した・フォーカスが入った)。 */
  | { type: "focus" }
  /** 面に開いているシェルのタブ (1 つのシェルは窓の 1 か所だけに出す)。 */
  | { type: "terminals"; open: string[] }
  /**
   * そのタブで面を分ける。url は新しい面が開く画面、layout は新しい面のタブ
   * (そのタブ 1 枚)。シェル・画像は面の側で閉じる (移す)。
   */
  | { type: "split"; dir: SplitDir; url: string; layout: SerializedLayout }
  /** 別の面で開く (Alt＋クリック・反対の面へ)。開ける面が無ければ送った面で開く。 */
  | ({ type: "open-elsewhere" } & TabCarry)
  /** タブを掴んだ (外側のページがほかの面の上に落とす先を出す)。 */
  | ({ type: "drag-start"; tabId: string } & TabCarry)
  /** 掴むのをやめた (落とした後も来る)。 */
  | { type: "drag-end" }
  /** エージェントの一覧を取り直してほしい (面は自分では取り直さない)。 */
  | { type: "agents-refresh" }
  /** 利用者が面の最後のタブを閉じた (面が 2 つ以上なら host が面を閉じる)。 */
  | { type: "emptied" }
  /** 面の並びの操作 (キー)。 */
  | { type: "workspace-action"; action: WorkspaceAction };

export type ClickModifiers = {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

export type HostCommand =
  | { type: "switch-project"; root: string; confirmRegister: boolean }
  | { type: "navigate-project"; url: string; replace: boolean }
  | { type: "open-agent-pane"; pane: string }
  | { type: "route"; route: AppRoute }
  | { type: "settings-at"; heading: string }
  /** 左のサイドバーのプロジェクトの ▾。面の左端の、その行の高さに開く。 */
  | { type: "project-menu"; root: string; y: number }
  | { type: "keymap"; action: KeymapAction; repeated: boolean }
  | { type: "click"; id: MirroredId; modifiers: ClickModifiers }
  /** 左のサイドバーを畳んだ・開いた (面は頭の「サイドバーを出す」を出し入れする)。 */
  | { type: "nav-collapsed"; collapsed: boolean }
  /** そのシェルのタブを閉じる (別の面で開いた。閉じた履歴には積まない)。 */
  | { type: "close-terminal"; session: string }
  /** そのシェルのタブを開いて前面に出す。 */
  | { type: "open-terminal"; session: string }
  /** そのタブを閉じる (別の面へ落として移した)。 */
  | { type: "close-tab"; id: string }
  /** 外側のページが取ったエージェントの一覧 (面はこれを使う)。 */
  | {
      type: "agents";
      overview: AgentOverviewResponse | null;
      error: string;
    }
  /** 面を分ける (キー)。面は前面のタブで split を送り返す。 */
  | { type: "split-front"; dir: SplitDir }
  /** 面が 2 つ以上あるか・この面にフォーカスがあるか (フォーカスの印)。 */
  | { type: "focus-state"; focused: boolean; many: boolean };

/** host の hello: その面の id と、保存してあったタブの配置 (無ければ null)。 */
export type HostHello = {
  type: typeof HOST_HELLO;
  pane: PaneId;
  layout: unknown | null;
};

/** 窓の message が host の hello か (別の用途の message は通す)。 */
export function isHostHello(data: unknown): data is HostHello {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === HOST_HELLO &&
    "pane" in data &&
    typeof data.pane === "string" &&
    "layout" in data
  );
}

const PANE_MESSAGE_TYPES: readonly PaneMessage["type"][] = [
  "location",
  "mirror",
  "viewing",
  "look-changed",
  "nav-collapsed",
  "tabs",
  "focus",
  "terminals",
  "split",
  "open-elsewhere",
  "emptied",
  "workspace-action",
  "drag-start",
  "drag-end",
  "agents-refresh",
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
  "close-terminal",
  "open-terminal",
  "close-tab",
  "agents",
  "split-front",
  "focus-state",
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
