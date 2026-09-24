// 棚の画像の出どころ: 画像パスが tmux のどのペインのどの行に出たか。
//
// シェルが映しているのは tmux のウインドウ全体なので、ブラウザに届く出力の
// 流れからは、どのペインに出た文字か分からない。そこで、そのウインドウの
// ペインを 1 つずつ capture-pane で読み、候補の出ている行を探す。ペインの
// 並び (位置と大きさ) も一緒に返し、ブラウザはそれで端末の上にペインの枠を
// 描く。
//
// 読むだけで、利用者の tmux には何も書かない (「ターミナルで見る」の遡りは
// handle.ts の handleImagesRevealPost が別に行う)。

import { formatErrorDetail } from "../../core/error-detail";
import {
  findImagePathLinks,
  stripAnsi,
  type TerminalImageSighting,
  type TerminalPaneBox,
  type TerminalPaneLayout,
} from "../../core/terminal-images";
import type { TmuxClient, TmuxPaneId } from "../../core/tmux";
import { captureTmuxPane } from "../tmux/capture";
import { TMUX_FIELD_SEP as FIELD_SEP, runTmux } from "../tmux/command";

/**
 * 出力から拾った候補を探すとき、画面より前を何行まで見るか。問い合わせが
 * 届くまでに流れた分を拾うため (全画面を描き直すアプリは画面だけで足りる)。
 */
export const SIGHTING_HISTORY_LINES = 200;

const LAYOUT_FIELDS = [
  "#{pane_id}",
  "#{pane_index}",
  "#{pane_left}",
  "#{pane_top}",
  "#{pane_width}",
  "#{pane_height}",
  "#{pane_current_command}",
  "#{pane_current_path}",
  // 題名を付けていないペインに tmux が入れる既定の題名 (ホスト名)。題名と
  // 一致したら題名を空にする。
  "#{host}",
  "#{host_short}",
  // タイトルは自由文字列なので必ず最後に置く。
  "#{pane_title}",
];

const LAYOUT_FORMAT = LAYOUT_FIELDS.join(FIELD_SEP);

/** ペインの並びと、相対パスを解く起点 (ペインの作業場所)。 */
export type PaneLayoutRead = {
  layout: TerminalPaneLayout;
  paths: Map<TmuxPaneId, string>;
};

export type PaneLayoutResult =
  | { status: "ok"; read: PaneLayoutRead }
  /** 引く間にペインが閉じられた・tmux が止まった。 */
  | { status: "gone" }
  | { status: "error"; error: Error };

function nonNegativeInt(raw: string | undefined): number | null {
  if (!raw || !/^[0-9]+$/.test(raw)) return null;
  return Number(raw);
}

/** 題名がホスト名 (tmux の既定の題名) なら空。ホスト名を画面に出さない。 */
function paneTitle(title: string, hosts: Array<string | undefined>): string {
  const trimmed = title.trim();
  return hosts.some((host) => host && host === trimmed) ? "" : title;
}

/**
 * `list-panes -F` の出力を並びにする。位置と大きさのどれかが読めない行は
 * 捨てる (枠をずれた所に描かない)。
 */
export function parsePaneLayout(
  stdout: string,
  status: Pick<TerminalPaneLayout, "statusLines" | "statusAt">,
): PaneLayoutRead {
  const panes: TerminalPaneBox[] = [];
  const paths = new Map<TmuxPaneId, string>();
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const fields = line.split(FIELD_SEP);
    if (fields.length < LAYOUT_FIELDS.length) continue;
    const [
      id,
      index,
      left,
      top,
      width,
      height,
      command,
      path,
      host,
      hostShort,
    ] = fields;
    const paneIndex = nonNegativeInt(index);
    const paneLeft = nonNegativeInt(left);
    const paneTop = nonNegativeInt(top);
    const paneWidth = nonNegativeInt(width);
    const paneHeight = nonNegativeInt(height);
    if (
      !id ||
      paneIndex === null ||
      paneLeft === null ||
      paneTop === null ||
      paneWidth === null ||
      paneHeight === null
    )
      continue;
    panes.push({
      id,
      index: paneIndex,
      title: paneTitle(fields.slice(LAYOUT_FIELDS.length - 1).join(FIELD_SEP), [
        host,
        hostShort,
      ]),
      command: command ?? "",
      folder: path ? (path.split("/").filter(Boolean).pop() ?? path) : "",
      left: paneLeft,
      top: paneTop,
      width: paneWidth,
      height: paneHeight,
    });
    if (path) paths.set(id, path);
  }
  return { layout: { panes, ...status }, paths };
}

/** その端末 (tmux のクライアント) が映しているウインドウのペインの並び。 */
export async function readPaneLayout(
  cwd: string,
  client: TmuxClient,
): Promise<PaneLayoutResult> {
  const result = await runTmux(
    ["list-panes", "-t", client.pane, "-F", LAYOUT_FORMAT],
    cwd,
  );
  if (result.status === "error") return result;
  if (result.status !== "ok") return { status: "gone" };
  return {
    status: "ok",
    read: parsePaneLayout(result.stdout, {
      statusLines: client.window?.statusLines ?? 0,
      statusAt: client.window?.statusAt ?? "bottom",
    }),
  };
}

/** ペイン 1 つを読んだもの。rows は上から順の行 (ANSI を落とし、行末の空白も落とす)。 */
export type PaneText = {
  pane: TmuxPaneId;
  width: number;
  rows: string[];
  /** カーソルの行 (rows の添字)。ここに近いほど新しい出力とみなす。 */
  cursorRow: number;
  /** 今の画面の先頭の行 (rows の添字)。これより上は履歴。 */
  screenTop: number;
};

/** capture-pane の結果を、探せる形にする。 */
export function paneText(screen: {
  pane: TmuxPaneId;
  content: string;
  width: number;
  cursorY: number;
  historyLines: number;
}): PaneText {
  return {
    pane: screen.pane,
    width: screen.width,
    rows: stripAnsi(screen.content)
      .split("\n")
      .map((row) => row.replace(/\s+$/, "")),
    cursorRow: screen.historyLines + screen.cursorY,
    screenTop: screen.historyLines,
  };
}

/**
 * 候補がどのペインのどの行に出ているかを探す。同じペインに何度も出ていれば
 * 一番下の 1 つ。並びは候補ごとに新しい順: 今の画面に見えている行が先 (画面を
 * 消した後の履歴に残った古い行より新しい)、同じなら カーソルの行に近い順。
 *
 * 探し方は画面の文字の上のリンクと同じ (findImagePathLinks)。ペインの幅で
 * 折り返された・CLI が割ったパスも見つかり、そのときの行は 2 行を繋ぐ。
 */
export function findSightings(
  panes: readonly PaneText[],
  candidates: readonly string[],
): TerminalImageSighting[] {
  const known = new Set(candidates);
  const found: Array<
    TerminalImageSighting & { hidden: number; distance: number }
  > = [];
  for (const text of panes) {
    const last = new Map<string, { startRow: number; endRow: number }>();
    for (const link of findImagePathLinks(text.rows, text.width, (value) =>
      known.has(value),
    )) {
      const seen = last.get(link.candidate);
      if (!seen || link.start.row >= seen.startRow) {
        last.set(link.candidate, {
          startRow: link.start.row,
          endRow: link.end.row,
        });
      }
    }
    for (const [candidate, at] of last) {
      const line = text.rows
        .slice(at.startRow, at.endRow + 1)
        .map((row, index) => (index === 0 ? row : row.trimStart()))
        .join(at.endRow > at.startRow ? " " : "");
      found.push({
        candidate,
        pane: text.pane,
        line: line.trim(),
        hidden: at.endRow < text.screenTop ? 1 : 0,
        distance: Math.abs(text.cursorRow - at.endRow),
      });
    }
  }
  const order = new Map(candidates.map((value, index) => [value, index]));
  return found
    .sort(
      (a, b) =>
        (order.get(a.candidate) ?? 0) - (order.get(b.candidate) ?? 0) ||
        a.hidden - b.hidden ||
        a.distance - b.distance,
    )
    .map(({ hidden: _hidden, distance: _distance, ...sighting }) => sighting);
}

export type ImageOrigins = {
  layout: TerminalPaneLayout | null;
  sightings: TerminalImageSighting[];
  /** ペインの作業場所。相対パスは、それが出たペインから解く。 */
  paths: Map<TmuxPaneId, string>;
  /** ペインの並び・中身を読めなかった理由。読めた分だけで答える。 */
  error?: string;
};

/**
 * そのクライアントのウインドウの全ペインを読み、候補の出どころを返す。
 * 途中で閉じられたペインは飛ばす。tmux の失敗は理由を error に残し、ログにも
 * 出す (読めたペインの分は返す)。
 */
export async function readImageOrigins(
  cwd: string,
  client: TmuxClient,
  candidates: readonly string[],
  historyLines = SIGHTING_HISTORY_LINES,
): Promise<ImageOrigins> {
  const listed = await readPaneLayout(cwd, client);
  if (listed.status === "gone") {
    return { layout: null, sightings: [], paths: new Map() };
  }
  if (listed.status === "error") {
    console.error(
      `[code-viewer] terminal image origins: list-panes failed (client ${client.tty})`,
      listed.error,
    );
    return {
      layout: null,
      sightings: [],
      paths: new Map(),
      error: formatErrorDetail(listed.error),
    };
  }
  const { layout, paths } = listed.read;
  if (candidates.length === 0) return { layout, sightings: [], paths };
  const errors: string[] = [];
  const texts: PaneText[] = [];
  const captures = await Promise.all(
    layout.panes.map((pane) => captureTmuxPane(pane.id, cwd, historyLines)),
  );
  captures.forEach((capture, index) => {
    const pane = layout.panes[index];
    if (capture.status === "ok") {
      texts.push(paneText(capture.screen));
    } else if (capture.status === "error") {
      console.error(
        `[code-viewer] terminal image origins: capture failed (pane ${pane?.id})`,
        capture.error,
      );
      errors.push(`${pane?.id}: ${formatErrorDetail(capture.error)}`);
    }
  });
  return {
    layout,
    sightings: findSightings(texts, candidates),
    paths,
    ...(errors.length > 0 ? { error: errors.join("\n") } : {}),
  };
}
