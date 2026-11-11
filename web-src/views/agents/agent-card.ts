// エージェントの行の中身 (左のサイドバーと全体ボードで同じもの)。2 行組のカード:
//
//   ◆ Review plan  [Needs input]          •     ← 状態の印・名前 (太め)・札・未読の点
//     claude · 3m · feature-login                ← 補足 (小さく薄い字)
//
// 名前は作業の要約。無ければ種類 (claude / codex)。補足は種類 (名前が要約の
// とき)・状態の語・経過時間・作業ツリー。札は「いま見るべきもの」だけ: 見ていない
// 間に入力待ちになった・終わった (未読)。札があるときは状態の語を補足に繰り返さ
// ない。補足の後ろに呼び出し側の項目 (全体ボードのアカウント・tmux の場所) を
// 足せる。押したとき・キー・未読を読んだ扱いは呼び出し側 (行の作り方は場所ごとに
// 違う) が持つ。

import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { ref } from "lit/directives/ref.js";
import { html, nothing, render, type TemplateResult } from "lit/html.js";
import {
  type AgentPane,
  type AgentTransition,
  paneTaskSummary,
} from "../../core/agent-overview";
import type { AgentsText } from "./i18n";
import { markPreviewRow } from "./pane-preview";
import { paneText } from "./pane-text";

/** 状態の印 (形で区別する)。 */
export function agentStateMarkTemplate(
  state: AgentPane["state"],
): TemplateResult {
  return html`<i class=${`terminal-mark terminal-mark-${state}`} aria-hidden="true"></i>`;
}

/**
 * 経過時間。変わった瞬間を見たものだけ時間を出す。それ以外は「–」にして、
 * 分かっている下限だけを title に書く。
 */
export function agentAge(
  pane: AgentPane,
  text: AgentsText,
): { text: string; title: string } {
  if (pane.updatedAt > 0) {
    return { text: text.elapsed(Date.now() - pane.updatedAt), title: "" };
  }
  const watched = pane.watchedSince > 0 ? Date.now() - pane.watchedSince : 0;
  return {
    text: text.elapsedUnknown,
    title:
      watched >= 60_000
        ? text.elapsedAtLeast(text.elapsed(watched))
        : text.elapsedJustWatched,
  };
}

export type AgentCardParts = {
  /** 1 行目の名前 (読み上げの名前に使う)。 */
  name: string;
  /** 経過時間の下限の説明 (時刻を断定しないとき)。無ければ空。 */
  ageTitle: string;
};

/** 補足の後ろに足す項目 (全体ボードのアカウント・tmux の場所)。空の文字は出さない。 */
export type AgentCardExtra = {
  cls: string;
  text: string;
  title?: string;
  /** 文字の後ろに添えるもの (アカウントのタグの札)。 */
  after?: unknown;
};

/**
 * カードの中身 (状態の印・1 行目・補足・未読の点) のテンプレート。行の要素
 * (button など) と、その class (agent-card を含む)・属性・イベントは呼び出し側。
 */
export function agentCardTemplate(
  pane: AgentPane,
  text: AgentsText,
  unread: AgentTransition | undefined,
  extra: readonly AgentCardExtra[] = [],
): { template: TemplateResult } & AgentCardParts {
  const shown = paneText(pane, text);
  const hasTask = paneTaskSummary(pane) !== null;
  const name = hasTask ? shown.summary : shown.kind;
  const age = agentAge(pane, text);
  const items: AgentCardExtra[] = [];
  if (hasTask) items.push({ cls: "agent-card-kind", text: shown.kind });
  // 入力待ちの理由が分かれば (許可・質問・エラーで停止)、「入力待ち」の代わりに出す。
  const attention =
    pane.state === "waiting" && pane.attention ? pane.attention : null;
  const attentionTitle = attention ? text.attentionTitle(attention) : undefined;
  if (!unread)
    items.push({
      cls: attention
        ? `agent-card-state agent-card-attention-${attention.kind}`
        : "agent-card-state",
      text: attention
        ? [text.attention[attention.kind], attention.reason]
            .filter(Boolean)
            .join(" · ")
        : text.state[pane.state],
      title: attentionTitle,
    });
  items.push({ cls: "agent-card-age", text: age.text, title: age.title });
  if (pane.worktree)
    items.push({
      cls: "agent-card-worktree",
      text: pane.worktree,
      title: text.worktreeTitle(pane.worktree),
    });
  items.push(...extra.filter((item) => item.text));
  const template = html`${agentStateMarkTemplate(pane.state)}<span class="agent-card-head"
      ><span class="agent-card-name">${name}</span>${
        unread
          ? html`<span
              class=${`agent-card-badge agent-card-badge-${unread}`}
              title=${ifDefined(unread === "waiting" ? attentionTitle : undefined)}
            >${
              unread === "waiting" && attention
                ? text.attention[attention.kind]
                : text.cardBadge[unread]
            }</span>`
          : nothing
      }</span
    ><span class="agent-card-meta">${items.map(
      (item, index) =>
        html`${index > 0 ? " · " : nothing}<span
            class=${item.cls}
            title=${ifDefined(item.title || undefined)}
          >${item.text}${item.after ?? nothing}</span>`,
    )}</span><span class="agent-card-unread" aria-hidden="true"></span>`;
  return { template, name, ageTitle: age.title };
}

/** エージェントの行 (左のサイドバー・全体ボード)。押し方・キーは使う側。 */
export type AgentRowTemplateOptions = {
  /** 行の場所ごとのクラス (nav-agent・agents-row)。状態ごとのクラスはその後ろに -state。 */
  base: "nav-agent" | "agents-row";
  id: string;
  state: AgentPane["state"];
  active: boolean;
  unread: boolean;
  title: string;
  ariaLabel?: string;
  /** 覗き窓の名前 (pane-preview.ts)。 */
  previewName: string;
  card: TemplateResult;
  /** 子エージェントの段。1 以上なら親の下に字下げする (style.css の data-agent-depth)。 */
  depth?: number;
  onOpen(event: MouseEvent): void;
  onMenu(event: MouseEvent): void;
};

export function agentRowTemplate(
  options: AgentRowTemplateOptions,
): TemplateResult {
  const cls = [
    `${options.base} ${options.base}-${options.state}`,
    options.active ? "active" : "",
    options.unread ? "unread" : "",
    "agent-card",
  ]
    .filter(Boolean)
    .join(" ");
  // 描き直しの前後で同じ行を指す鍵。左のサイドバーは data-nav-item、全体
  // ボードは data-agent-nav (どちらも描き直し後にフォーカスを戻すのに使う)。
  const key = `pane:${options.id}`;
  // ターミナルは 1 か所にしか置けず、仮にもならないので、中ボタン・⌘/Ctrl・Alt
  // も 1 回押すと同じ (開くか前面に出す)。
  return html`<button
    type="button"
    class=${cls}
    data-nav-item=${options.base === "nav-agent" ? key : nothing}
    data-agent-nav=${options.base === "agents-row" ? key : nothing}
    role="treeitem"
    tabindex=${live("-1")}
    aria-current=${options.active ? "true" : nothing}
    title=${options.title}
    aria-label=${ifDefined(options.ariaLabel)}
    data-agent-depth=${options.depth ? String(options.depth) : nothing}
    style=${options.depth ? `--agent-depth: ${options.depth}` : nothing}
    ${ref((el) => {
      if (el instanceof HTMLElement)
        markPreviewRow(el, options.id, options.previewName);
    })}
    @click=${options.onOpen}
    @auxclick=${options.onOpen}
    @contextmenu=${options.onMenu}
  >${options.card}</button>`;
}

/**
 * まだ宣言的に描いていない画面のための形: row の中身をカードにする。row の
 * class・属性・イベントは呼び出し側。宣言的に描く画面は agentCardTemplate を使う。
 */
export function fillAgentCard(
  row: HTMLElement,
  pane: AgentPane,
  text: AgentsText,
  unread: AgentTransition | undefined,
  extra: readonly HTMLElement[] = [],
): AgentCardParts {
  const card = agentCardTemplate(
    pane,
    text,
    unread,
    extra.map((item) => ({
      cls: item.className,
      text: item.textContent ?? "",
      title: item.title,
    })),
  );
  row.classList.add("agent-card");
  render(card.template, row);
  return { name: card.name, ageTitle: card.ageTitle };
}
