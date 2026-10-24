// この窓の役割。DOM に触らない。
//
// 面を自由に分ける作り (左右・上下) では、一番上のページ (host) が左のサイドバーと
// 最下段と面 (iframe) を持ち、面の中 (pane) で今までのアプリが本文を描く。
// - host: 一番上のページで、SP の幅でない
// - pane: host が置いた面 (iframe[data-cv-pane]) の中
// - single: SP の幅と、ほかのページの中に開かれたとき。今までどおりの 1 枚
//
// 決めるのは index.html の head の早いスクリプト (#first-look) で、html[data-workspace]
// に書く (CSS より先に付け、骨格が一瞬違う形で描かれない)。同じ決まりをここに
// 純関数で置き、web-src/test/first-screen.test.ts が突き合わせる。

import { PHONE_LANDSCAPE_MAX_HEIGHT, PHONE_MAX_WIDTH } from "./mobile-layout";

export type WorkspaceRole = "host" | "pane" | "single";

/** host が面の iframe に付ける印 (値は面の id)。 */
export const PANE_FRAME_ATTRIBUTE = "data-cv-pane";

export function decideWorkspaceRole(facts: {
  /** host が置いた面の中か (frameElement に PANE_FRAME_ATTRIBUTE がある)。 */
  paneFrame: boolean;
  /** 一番上のページか (window.top === window)。 */
  topLevel: boolean;
  /** SP の幅か (PHONE_MEDIA_QUERY)。 */
  phone: boolean;
}): WorkspaceRole {
  if (facts.paneFrame) return "pane";
  if (facts.topLevel && !facts.phone) return "host";
  return "single";
}

/**
 * 面の中で使う @media の条件。面 (iframe) の中の @media は窓ではなく面の幅で決まる
 * ので、そのままでは狭い面が SP の画面になる。SP の条件 (幅 PHONE_MAX_WIDTH 以下・
 * 高さ PHONE_LANDSCAPE_MAX_HEIGHT 以下) を含む選択肢を外し、残らなければ "not all"。
 * デスクトップの区切り (幅 700px など) は残す (面の幅で詰めるほうが正しい)。
 */
export function embeddedMediaText(media: string): string {
  const kept = media
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !isPhoneAlternative(part));
  return kept.length === 0 ? "not all" : kept.join(", ");
}

function isPhoneAlternative(part: string): boolean {
  const limits = (feature: string) =>
    [...part.matchAll(new RegExp(`${feature}\\s*:\\s*(\\d+)px`, "g"))].map(
      (match) => Number(match[1]),
    );
  return (
    limits("max-width").some((width) => width <= PHONE_MAX_WIDTH) ||
    limits("max-height").some((height) => height <= PHONE_LANDSCAPE_MAX_HEIGHT)
  );
}
