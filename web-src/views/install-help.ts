// 「〜を入れると使えます」を言うだけにしない部品。何が無いかの 1 文、入れる
// コマンド (コピーのボタンつきの等幅の箱。ヘルプの本文と同じ部品)、ヘルプの
// 該当の節へのリンクを並べる。tmux が無いときの全体ボードと、シェルを開けない
// (@lydell/node-pty が無い) ときの画面が使う。コマンドは公式の入れ方に合わせる。

import { html, nothing, type TemplateResult } from "lit/html.js";
import { command } from "./help-blocks";
import type { HelpLanguage } from "./help-page";
import { showFormDialog } from "./ui-dialog";

export type InstallHelp = {
  /** 何が無く、入れると何ができるか。 */
  intro: string;
  /** OS ごとのコマンド (title は「macOS」など)。 */
  commands: readonly { title: string; command: string }[];
  /** ヘルプの節へのリンクの文字と、押したとき。 */
  help: { label: string; open(): void };
};

export function installHelpTemplate(
  spec: InstallHelp,
  lang: HelpLanguage,
): TemplateResult {
  return html`<div class="install-help"><p class="install-help-intro">${spec.intro}</p>${spec.commands.map(
    (item) => command(lang, item.command, item.title),
  )}<button
    type="button"
    class="agents-text-action install-help-link"
    @click=${() => spec.help.open()}
  >${spec.help.label}</button></div>`;
}

/**
 * 入れ方の箱を画面で出す (押せる項目から開く。シェルを開けないとき)。reason は
 * サーバが返した理由の全文 (等幅で下に出す。空なら出さない)。
 */
export function showInstallDialog(options: {
  title: string;
  help: InstallHelp;
  reason: string;
  closeLabel: string;
  lang: HelpLanguage;
}): Promise<null> {
  return showFormDialog({
    title: options.title,
    body: html`<div class="agent-hooks-dialog">${installHelpTemplate(
      options.help,
      options.lang,
    )}${
      options.reason
        ? html`<pre class="agent-hooks-dialog-code terminal-mono">${options.reason}</pre>`
        : nothing
    }</div>`,
    wide: true,
    // 本文の［コピー］で済むので、確定の操作は無い。閉じるだけを出す。
    closeOnly: true,
    focusCancel: true,
    cancelLabel: options.closeLabel,
    submit: () => null,
  });
}

/** tmux の公式の入れ方 (https://github.com/tmux/tmux/wiki/Installing)。 */
export const TMUX_INSTALL_COMMANDS = [
  { title: "macOS (Homebrew)", command: "brew install tmux" },
  { title: "Debian / Ubuntu", command: "sudo apt install tmux" },
] as const;

/**
 * シェルに要る任意の依存 (@lydell/node-pty) を入れ直す。npm は任意の依存を
 * 既定で入れ、`--include=optional` は省く設定があっても入れる
 * (https://docs.npmjs.com/cli/v11/commands/npm-install の --include)。
 */
export const NODE_PTY_INSTALL_COMMANDS = [
  {
    title: "npm",
    command: "npm install -g @youtyan/code-viewer --include=optional",
  },
] as const;
