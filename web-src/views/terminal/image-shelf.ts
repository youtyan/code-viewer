// ターミナルの右に置く画像の棚。そのペインの出力に出てきた画像パスを、新しい
// 順にサムネイルで縦に並べる。
//
// 画像を端末の文字の上に重ねると、パスの下の行・作業中の行・入力欄が隠れる。
// 棚は文字とは別の列として場所を取るので、何も隠さない。
//
// 並びの決まり (新しい順・同じ画像は 1 つ・上書きで先頭へ・上限) は
// image-shelf-list.ts。ここは描くことと、押す・畳むの受け口だけを持つ。
//
// - 画像が 1 つも無いときは棚ごと出さない (場所を取らない)
// - 畳むと「画像の印と件数」のボタンだけの細い列になる。畳んだかどうかは
//   ユーザー単位の設定に覚える (呼び出し側が保存する)
// - サムネイルはブラウザに縮小させる (依存を足さない)。loading="lazy" で、
//   URL に更新時刻と大きさが入っているので、描き直しても取り直さない
// - 読めなかった項目は理由を出す。押すと確かめ直す

import { CHEVRON_DOWN_16_PATH, IMAGE_16_PATH, iconSvg } from "../../core/icons";
import { elapsedBucket } from "../../core/terminal-board";
import { showContextMenu } from "../context-menu";
import type { TerminalText } from "./i18n";
import type { ShelfEntry } from "./image-shelf-list";

/** 「何分前」を書き直す間隔。分単位でしか出さないので 30 秒で足りる。 */
const AGE_REFRESH_MS = 30_000;

export type ImageShelfDeps = {
  getText(): TerminalText;
  isCollapsed(): boolean;
  /** 畳む・開く。保存は呼び出し側 (ユーザー単位の設定)。 */
  setCollapsed(collapsed: boolean): void;
  /**
   * 項目を押した。読めたものは画像のタブ (mode = tab) か覆いの拡大表示
   * (overlay)、読めなかったものは確かめ直し。
   */
  onOpen(entry: ShelfEntry, mode: ShelfOpenMode): void;
  /** サムネイルが読めなかった (消された・壊れた)。理由を聞き直してもらう。 */
  onImageError(entry: ShelfEntry): void;
  /** いまの時刻 (テストで差し替える)。 */
  now?(): number;
};

/** 棚の項目の開き方。既定はタブ。Alt / Shift を押しながらか、右クリックで覆い。 */
export type ShelfOpenMode = "tab" | "overlay";

export type ImageShelfHandle = {
  el: HTMLElement;
  render(list: readonly ShelfEntry[]): void;
  /** パスにカーソルが載った画像を強調し、棚の見える位置へ送る。null で外す。 */
  highlight(key: string | null): void;
  /** 画像のタブで開いている画像に印を付ける (右の画像と棚の枠を一致させる)。null で外す。 */
  setOpened(key: string | null): void;
  localize(): void;
  dispose(): void;
};

type ItemParts = {
  li: HTMLLIElement;
  open: HTMLButtonElement;
  frame: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
  /**
   * いま枠に入っているもの。img の URL か、読めなかった印 (null)。まだ何も
   * 入れていなければ undefined。変わったときだけ差し替える。
   */
  url: string | null | undefined;
};

export function createImageShelf(deps: ImageShelfDeps): ImageShelfHandle {
  const now = () => (deps.now ? deps.now() : Date.now());

  const el = document.createElement("aside");
  el.className = "terminal-image-shelf";
  el.hidden = true;

  const head = document.createElement("div");
  head.className = "terminal-image-shelf-head";
  const title = document.createElement("span");
  title.className = "terminal-image-shelf-title";
  const count = document.createElement("span");
  count.className = "terminal-image-shelf-count";
  const collapse = document.createElement("button");
  collapse.type = "button";
  collapse.className = "terminal-image-shelf-toggle";
  collapse.innerHTML = iconSvg(
    "terminal-image-shelf-icon",
    CHEVRON_DOWN_16_PATH,
  );
  collapse.addEventListener("click", () => setCollapsed(true));
  head.append(title, count, collapse);

  const list = document.createElement("ol");
  list.className = "terminal-image-shelf-list";

  // 畳んだときに残るボタン。画像の印と件数。
  const expand = document.createElement("button");
  expand.type = "button";
  expand.className = "terminal-image-shelf-expand";
  const expandCount = document.createElement("span");
  expandCount.className = "terminal-image-shelf-count";
  expand.innerHTML = iconSvg("terminal-image-shelf-icon", IMAGE_16_PATH);
  expand.append(expandCount);
  expand.addEventListener("click", () => setCollapsed(false));

  el.append(head, list, expand);

  let entries: readonly ShelfEntry[] = [];
  const items = new Map<string, ItemParts>();
  /** 読み込めた画像の寸法。鍵は URL (上書きされれば URL が変わる)。 */
  const sizes = new Map<string, { width: number; height: number }>();
  let linkedKey: string | null = null;
  const ageTimer = setInterval(() => {
    if (!el.hidden) refreshMeta();
  }, AGE_REFRESH_MS);

  function setCollapsed(collapsed: boolean): void {
    deps.setCollapsed(collapsed);
    applyCollapsed();
    if (!collapsed) {
      // 開いたときに、強調中の項目があれば見える位置へ。
      if (linkedKey) scrollToKey(linkedKey);
      list.querySelector<HTMLButtonElement>("button")?.focus();
    } else {
      expand.focus();
    }
  }

  function applyCollapsed(): void {
    const collapsed = deps.isCollapsed();
    el.dataset.collapsed = collapsed ? "true" : "false";
    head.hidden = collapsed;
    list.hidden = collapsed;
    expand.hidden = !collapsed;
  }

  /**
   * 項目の下の行。読めたものは「寸法」と「何分前」の 2 つの塊 (棚の幅に
   * 収まらなければ塊ごと折り返す。途中で省略すると肝心の時刻が読めない)。
   * 読めなかったものは理由だけ。
   */
  function metaParts(entry: ShelfEntry): string[] {
    const text = deps.getText();
    if (!entry.image) {
      return [text.imageRejected(entry.reason ?? "unreadable", entry.bytes)];
    }
    const age = text.imageAge(elapsedBucket(now() - entry.image.mtimeMs));
    const size = sizes.get(entry.image.url);
    return size ? [text.imageSize(size.width, size.height), age] : [age];
  }

  function metaText(entry: ShelfEntry): string {
    return metaParts(entry).join(" · ");
  }

  function fillMeta(meta: HTMLElement, entry: ShelfEntry): void {
    const parts = metaParts(entry);
    if (
      meta.childElementCount === parts.length &&
      parts.every((part, index) => meta.children[index]?.textContent === part)
    ) {
      return;
    }
    meta.replaceChildren(
      ...parts.map((part) => {
        const span = document.createElement("span");
        span.textContent = part;
        return span;
      }),
    );
  }

  function buildItem(): ItemParts {
    const li = document.createElement("li");
    li.className = "terminal-image-shelf-item";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "terminal-image-shelf-open";
    const frame = document.createElement("span");
    frame.className = "terminal-image-shelf-frame";
    const name = document.createElement("span");
    name.className = "terminal-image-shelf-name";
    const meta = document.createElement("span");
    meta.className = "terminal-image-shelf-meta";
    open.append(frame, name, meta);
    li.append(open);
    const parts: ItemParts = {
      li,
      open,
      frame,
      name,
      meta,
      url: undefined,
    };
    open.addEventListener("click", (event) => {
      const current = entries.find((item) => item.key === li.dataset.key);
      if (current)
        deps.onOpen(
          current,
          event.altKey || event.shiftKey ? "overlay" : "tab",
        );
    });
    open.addEventListener("contextmenu", (event) => {
      const current = entries.find((item) => item.key === li.dataset.key);
      if (!current?.image) return;
      event.preventDefault();
      const text = deps.getText();
      showContextMenu(
        open,
        [
          {
            label: text.imageOpenInTab,
            onSelect: () => deps.onOpen(current, "tab"),
          },
          {
            label: text.imageOpenInViewer,
            onSelect: () => deps.onOpen(current, "overlay"),
          },
        ],
        { at: { x: event.clientX, y: event.clientY } },
      );
    });
    return parts;
  }

  function fillItem(parts: ItemParts, entry: ShelfEntry): void {
    const text = deps.getText();
    parts.li.dataset.key = entry.key;
    parts.li.dataset.failed = entry.image ? "false" : "true";
    parts.name.textContent = entry.name;
    parts.open.title = entry.detail
      ? `${entry.path}\n${entry.detail}`
      : entry.path;
    parts.open.setAttribute(
      "aria-label",
      entry.image
        ? `${text.openImage}: ${entry.name}`
        : `${entry.name}: ${metaText(entry)} (${text.imageRecheck})`,
    );
    const url = entry.image?.url ?? null;
    if (url !== parts.url) {
      parts.url = url;
      if (url) {
        const picture = document.createElement("img");
        picture.loading = "lazy";
        picture.decoding = "async";
        picture.alt = entry.name;
        picture.addEventListener("load", () => {
          sizes.set(url, {
            width: picture.naturalWidth,
            height: picture.naturalHeight,
          });
          const current = entries.find((item) => item.image?.url === url);
          if (current) fillMeta(parts.meta, current);
        });
        picture.addEventListener("error", () => {
          const current = entries.find((item) => item.image?.url === url);
          if (current) deps.onImageError(current);
        });
        picture.src = url;
        parts.frame.replaceChildren(picture);
      } else {
        parts.frame.innerHTML = iconSvg(
          "terminal-image-shelf-failed-icon",
          IMAGE_16_PATH,
        );
      }
    }
    fillMeta(parts.meta, entry);
  }

  function refreshMeta(): void {
    for (const entry of entries) {
      const parts = items.get(entry.key);
      if (parts) fillMeta(parts.meta, entry);
    }
  }

  function localizeHead(): void {
    const text = deps.getText();
    title.textContent = text.imageShelfTitle;
    count.textContent = String(entries.length);
    expandCount.textContent = String(entries.length);
    collapse.title = text.imageShelfCollapse;
    collapse.setAttribute("aria-label", text.imageShelfCollapse);
    const expandLabel = text.imageShelfExpand(entries.length);
    expand.title = expandLabel;
    expand.setAttribute("aria-label", expandLabel);
    list.setAttribute("aria-label", text.imageShelfTitle);
  }

  function render(next: readonly ShelfEntry[]): void {
    entries = next;
    el.hidden = entries.length === 0;
    applyCollapsed();
    localizeHead();
    const keep = new Set<string>();
    const ordered: HTMLLIElement[] = [];
    for (const entry of entries) {
      keep.add(entry.key);
      let parts = items.get(entry.key);
      if (!parts) {
        parts = buildItem();
        items.set(entry.key, parts);
      }
      fillItem(parts, entry);
      ordered.push(parts.li);
    }
    for (const [key, parts] of items) {
      if (keep.has(key)) continue;
      parts.li.remove();
      items.delete(key);
    }
    // 並びが同じなら DOM を動かさない (動かすと img が読み直しになることがある)。
    const same =
      list.children.length === ordered.length &&
      ordered.every((li, index) => list.children[index] === li);
    if (!same) list.replaceChildren(...ordered);
    if (linkedKey && !keep.has(linkedKey)) highlight(null);
    markOpened();
  }

  let openedKey: string | null = null;
  function markOpened(): void {
    for (const [key, parts] of items) {
      if (key === openedKey) parts.li.dataset.opened = "true";
      else delete parts.li.dataset.opened;
    }
  }

  /**
   * 棚の中だけをスクロールして、その項目を見える位置へ。scrollIntoView は
   * 外側 (ターミナルやページ) まで動かすので使わない。
   */
  function scrollToKey(key: string): void {
    const parts = items.get(key);
    if (!parts || list.hidden) return;
    const box = list.getBoundingClientRect();
    const item = parts.li.getBoundingClientRect();
    const top = item.top - box.top + list.scrollTop;
    const bottom = top + item.height;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight;
  }

  function highlight(key: string | null): void {
    if (linkedKey === key) return;
    if (linkedKey) {
      const previous = items.get(linkedKey);
      if (previous) delete previous.li.dataset.linked;
    }
    linkedKey = key;
    // 畳んでいる間は幅を変えず、ボタンだけで応える。
    if (key) expand.dataset.linked = "true";
    else delete expand.dataset.linked;
    if (!key) return;
    const parts = items.get(key);
    if (!parts) return;
    parts.li.dataset.linked = "true";
    scrollToKey(key);
  }

  return {
    el,
    render,
    highlight,
    setOpened(key) {
      openedKey = key;
      markOpened();
    },
    localize() {
      localizeHead();
      for (const entry of entries) {
        const parts = items.get(entry.key);
        if (parts) fillItem(parts, entry);
      }
    },
    dispose() {
      clearInterval(ageTimer);
    },
  };
}
