// 共通の ui-dialog 操作ヘルパ。各 explorer/grid テストから再利用する
// (ui-dialog の DOM 操作 = "Cancel / OK ボタンを押す" の duplication 回避)。

export function getOpenDialog(): HTMLElement {
  const backdrop = document.querySelector<HTMLElement>(".gdp-dialog-backdrop");
  if (!backdrop) throw new Error("no dialog open");
  return backdrop;
}

export function clickDialogConfirm(): void {
  const backdrop = getOpenDialog();
  const buttons = backdrop.querySelectorAll<HTMLButtonElement>(
    ".gdp-dialog-actions button",
  );
  buttons[buttons.length - 1].click();
}

export function clickDialogCancel(): void {
  const backdrop = getOpenDialog();
  const buttons = backdrop.querySelectorAll<HTMLButtonElement>(
    ".gdp-dialog-actions button",
  );
  buttons[0].click();
}

// テスト後の cleanup で残ったダイアログを除去する (失敗テストで漏れないように)。
export function closeOpenDialog(): void {
  document.querySelector<HTMLElement>(".gdp-dialog-backdrop")?.remove();
}
