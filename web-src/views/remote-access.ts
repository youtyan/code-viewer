import { showConfirmDialog } from "./ui-dialog";

const TEXT = {
  ja: {
    title: "もう一度ログインしてください",
    body: "外部接続の認証を確認できませんでした。画面を開き直してログインしてください。送信に失敗した操作は自動で再送しません。Macで実行中の作業は続きます。",
    confirmLabel: "ログインし直す",
    cancelLabel: "閉じる",
  },
  en: {
    title: "Sign in again",
    body: "Remote authentication could not be verified. Reopen this page to sign in. Failed actions are not sent again automatically. Work running on your computer continues.",
    confirmLabel: "Sign in again",
    cancelLabel: "Close",
  },
};

export function needsRemoteLogin(response: Response, origin?: string): boolean {
  if (
    response.status === 401 &&
    (response.headers.get("x-code-viewer-remote") === "1" ||
      (origin?.startsWith("https:") &&
        response.url &&
        new URL(response.url).origin === origin))
  )
    return true;
  if (
    !response.redirected ||
    !response.headers.get("content-type")?.includes("text/html")
  )
    return false;
  const url = new URL(response.url);
  return (
    url.hostname.endsWith(".cloudflareaccess.com") ||
    url.pathname.startsWith("/cdn-cgi/access/")
  );
}

export function createRemoteAccessNotice(
  language: () => "en" | "ja",
  reportError: (operation: string, error: unknown) => void,
) {
  let shown = false;
  return (response: Response): void => {
    if (shown || !needsRemoteLogin(response, window.location.origin)) return;
    shown = true;
    void showConfirmDialog(TEXT[language()])
      .then((confirmed) => {
        if (confirmed) window.location.reload();
      })
      .catch((error: unknown) => reportError("remote login notice", error));
  };
}
