// 画像をサーバ (/_agent/paste) に保存してもらい、エージェントへ渡すパスを受け取る。
// ターミナルへの貼り付け (terminal-screen.ts) と、電話の 1 ペイン表示の添付
// (pane-view.ts) が同じ送り方を使う。保存の場所と名前・受け付ける種類はサーバと
// core/terminal-paste.ts が決める。

import { apiUrl } from "../../core/api-url";
import {
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";
import type { PasteImageResponse } from "../../core/terminal-paste";

export type PasteUploadDeps = {
  actionHeaders(): HeadersInit;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  /** 失敗の知らせの頭 (どの操作が失敗したか)。 */
  failedText: string;
};

/** 失敗は理由の文 (画面に出す) と元のエラー (console に出す) の両方を返す。 */
export type PasteUploadResult =
  | { status: "ok"; saved: PasteImageResponse }
  | { status: "failed"; message: string; error: unknown };

/** File を base64 にする。data URL の接頭辞は落として本体だけ返す。 */
export function readFileAsBase64(
  file: File,
): Promise<{ base64: string; url: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const comma = url.indexOf(",");
      if (comma < 0) {
        reject(new Error("unexpected data url"));
        return;
      }
      resolve({ base64: url.slice(comma + 1), url });
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadPastedImage(
  file: File,
  deps: PasteUploadDeps,
): Promise<PasteUploadResult> {
  let read: { base64: string };
  try {
    read = await readFileAsBase64(file);
  } catch (error) {
    return {
      status: "failed",
      message: `${deps.failedText}\n${formatErrorDetail(error)}`,
      error,
    };
  }
  try {
    const res = await deps.trackLoad(
      fetch(apiUrl("agentPaste"), {
        method: "POST",
        headers: {
          ...deps.actionHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mime: file.type, data: read.base64 }),
      }),
    );
    if (!res.ok) {
      // 応答の本文 (エラーの全件・全フィールド) を含む文をそのまま残す。
      const message = await responseErrorMessage(res, deps.failedText);
      return { status: "failed", message, error: message };
    }
    return {
      status: "ok",
      saved: (await res.json()) as PasteImageResponse,
    };
  } catch (error) {
    return {
      status: "failed",
      message: `${deps.failedText}\n${formatErrorDetail(error)}`,
      error,
    };
  }
}
