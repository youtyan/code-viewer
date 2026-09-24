// ターミナルの画面の横 (既定は右。左・下・上も選べる) に置く画像の棚。そのペインの
// 出力に出てきた画像パスを、新しい順にサムネイルで並べる。
//
// 画像を端末の文字の上に重ねると、パスの下の行・作業中の行・入力欄が隠れる。
// 棚は文字とは別の列として場所を取るので、何も隠さない。
//
// 並びの決まり (新しい順・同じ画像は 1 つ・上書きで先頭へ・上限) は
// image-shelf-list.ts。ここは描くことと、押す・畳むの受け口だけを持つ。
//
// - 画像が 1 つも無いときは棚ごと出さない (場所を取らない)
// - 置き場所 (右・左・下・上) と、右・左の幅・下・上の高さはユーザー単位の設定
//   (呼び出し側が保存する)。見出しの ⋯ で場所を移し、内側の縁をドラッグして
//   大きさを変える。大きさは core/panel-sizes.ts の範囲で、:root の CSS 変数
//   (--terminal-shelf-w / --terminal-shelf-h) に書く (左右の面の棚で同じ値)
// - 畳むと「画像の印と件数」のボタンだけの細い帯になる。畳んだかどうかは
//   ユーザー単位の設定に覚える。端末が狭すぎる (左右なら残りの幅、上下なら残り
//   の高さが足りない) ときは設定を変えずに畳み、帯を押せば開く
// - サムネイルはブラウザに縮小させる (依存を足さない)。loading="lazy" で、
//   URL に更新時刻と大きさが入っているので、描き直しても取り直さない
// - 読めなかった項目は理由を出す。押すと確かめ直す
// - 項目にカーソルかフォーカスが載ったら、端末の中のそのパスを示してもらう
//   (onLocate)
// - 棚の中は出た所ごとにまとめる (tmux のペイン、tmux でなければシェル)。
//   まとまりの頭に 1 行の見出し (「ペイン 2 · 題名」)、その下に画像。まとまりの
//   並びは、そのペインの新しい画像の順
// - 各画像は サムネイル・名前・何分前 (読めなかったものは理由) の 2 行まで。
//   詳しいこと (パス · 寸法。読めなかったものは理由) は、カーソルかフォーカスが
//   載っている間だけ、棚の見出しの行 (「画像 11」) をその表示に切り替えて出す。
//   浮く札は作らない (どこに出しても端末の文字か隣の画像を隠した)

import { attachDragResizer } from "../../core/drag-resizer";
import {
  CHEVRON_DOWN_16_PATH,
  IMAGE_16_PATH,
  iconSvg,
  KEBAB_16_PATH,
} from "../../core/icons";
import {
  clampPanelSize,
  TERMINAL_IMAGE_SHELF_HEIGHT,
  TERMINAL_IMAGE_SHELF_WIDTH,
} from "../../core/panel-sizes";
import { elapsedBucket } from "../../core/terminal-board";
import {
  TERMINAL_IMAGE_SHELF_PLACEMENTS,
  type TerminalImageShelfPlacement,
} from "../../core/terminal-images";
import { showContextMenu } from "../context-menu";
import type { TerminalText } from "./i18n";
import type { ShelfEntry, ShelfOrigin } from "./image-shelf-list";

/** 「何分前」を書き直す間隔。分単位でしか出さないので 30 秒で足りる。 */
const AGE_REFRESH_MS = 30_000;

/**
 * これより端末に残る場所が狭くなるなら、棚を細い帯に畳む。右・左では幅、
 * 下・上では高さ (px)。
 */
export const SHELF_AUTO_COLLAPSE_ROOM = { width: 480, height: 240 } as const;

/** 棚の置き場所と大きさ (ユーザー単位の設定)。 */
export type ImageShelfLayout = {
  placement: TerminalImageShelfPlacement;
  /** 右・左に置いたときの幅。 */
  width: number;
  /** 下・上に置いたときの高さ。 */
  height: number;
};

export const DEFAULT_IMAGE_SHELF_LAYOUT: ImageShelfLayout = {
  placement: "right",
  width: TERMINAL_IMAGE_SHELF_WIDTH.default,
  height: TERMINAL_IMAGE_SHELF_HEIGHT.default,
};

/** 縦に並べる (右・左) か。 */
function isSide(placement: TerminalImageShelfPlacement): boolean {
  return placement === "right" || placement === "left";
}

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
  /**
   * 項目にカーソルかフォーカスが載った (null で外れた)。端末の画面の中で
   * そのパスが出ている所を示してもらう。
   */
  onLocate(entry: ShelfEntry | null): void;
  /** 右クリックの「ターミナルで見る」。そのパスが出た行まで端末を動かして示す。 */
  onReveal(entry: ShelfEntry): void;
  /** 置き場所と大きさ。無ければ右・既定の大きさ。 */
  getLayout?(): ImageShelfLayout;
  /**
   * そのペインのエージェントの名前 (サイドバーと同じ「種類 · 作業」)。
   * エージェントでなければ null。
   */
  paneName?(paneId: string): string | null;
  /**
   * 置き場所か大きさを変えた (見出しのメニュー・縁のドラッグの終わり)。保存と、
   * ほかの棚への当て直し (applyLayout) は呼び出し側。
   */
  setLayout?(patch: Partial<ImageShelfLayout>): void;
  /** いまの時刻 (テストで差し替える)。 */
  now?(): number;
};

/** 棚の項目の開き方。既定はタブ。Alt / Shift を押しながらか、右クリックで覆い。 */
/** tab は画像のタブ (仮)、kept-tab は固定のタブ、overlay は大きく開く覆い。 */
export type ShelfOpenMode = "tab" | "kept-tab" | "overlay";

export type ImageShelfHandle = {
  el: HTMLElement;
  render(list: readonly ShelfEntry[]): void;
  /** パスにカーソルが載った画像を強調し、棚の見える位置へ送る。null で外す。 */
  highlight(key: string | null): void;
  /** 画像のタブで開いている画像に印を付ける (右の画像と棚の枠を一致させる)。null で外す。 */
  setOpened(key: string | null): void;
  localize(): void;
  /** 置き場所と大きさを設定から当て直す (別の棚・別の窓で変えたとき)。 */
  applyLayout(): void;
  /** 棚と端末を合わせた箱の大きさ。狭すぎれば棚を畳む。 */
  setRoom(room: { width: number; height: number }): void;
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

/** 出た所 1 つぶんのまとまり。 */
type GroupParts = {
  li: HTMLLIElement;
  head: HTMLElement;
  items: HTMLOListElement;
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
  collapse.className =
    "terminal-image-shelf-toggle terminal-image-shelf-collapse";
  collapse.innerHTML = iconSvg(
    "terminal-image-shelf-icon",
    CHEVRON_DOWN_16_PATH,
  );
  collapse.addEventListener("click", () => setCollapsed(true));
  // 置き場所を移す小さなメニュー。
  const move = document.createElement("button");
  move.type = "button";
  move.className = "terminal-image-shelf-toggle terminal-image-shelf-move";
  move.innerHTML = iconSvg("terminal-image-shelf-icon", KEBAB_16_PATH);
  move.addEventListener("click", () => {
    const text = deps.getText();
    const current = layout().placement;
    showContextMenu(
      move,
      TERMINAL_IMAGE_SHELF_PLACEMENTS.map((placement) => ({
        label: text.imageShelfPlacementNames[placement],
        checked: placement === current,
        onSelect: () => {
          if (placement !== current) deps.setLayout?.({ placement });
        },
      })),
    );
  });
  // カーソルかフォーカスが載っている項目の詳しいこと。載っている間だけ、題と
  // 件数の代わりに同じ行に出す (行の高さは変えない)。パスは真ん中 (ディレクトリ)
  // を省略し、ファイル名は残す。
  const detail = document.createElement("span");
  detail.className = "terminal-image-shelf-detail";
  detail.hidden = true;
  const detailDir = document.createElement("span");
  detailDir.className = "terminal-image-shelf-detail-dir";
  const detailName = document.createElement("span");
  detailName.className = "terminal-image-shelf-detail-name";
  const detailFacts = document.createElement("span");
  detailFacts.className = "terminal-image-shelf-detail-facts";
  detail.append(detailDir, detailName, detailFacts);
  head.append(title, count, detail, move, collapse);

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

  // 内側の縁 (端末の側) の掴み。ドラッグと矢印キーで大きさを変える。
  const resizer = document.createElement("div");
  resizer.className = "terminal-image-shelf-resizer";
  resizer.setAttribute("role", "separator");
  resizer.tabIndex = 0;

  el.append(head, list, expand, resizer);

  let entries: readonly ShelfEntry[] = [];
  const items = new Map<string, ItemParts>();
  const groups = new Map<string, GroupParts>();
  /** 読み込めた画像の寸法。鍵は URL (上書きされれば URL が変わる)。 */
  const sizes = new Map<string, { width: number; height: number }>();
  let linkedKey: string | null = null;
  /** カーソルが載っている項目と、フォーカスのある項目。 */
  let pointedKey: string | null = null;
  let focusedKey: string | null = null;
  /** onLocate で最後に知らせた項目。 */
  let locatedKey: string | null = null;
  /** 端末が狭すぎて畳んでいるか。畳んでいる間に帯を押したら opened。 */
  let narrow = false;
  let openedWhileNarrow = false;
  let room: { width: number; height: number } | null = null;
  /** 当てている置き場所と、掴みを外す関数 (置き場所が変わったら付け直す)。 */
  let placed: TerminalImageShelfPlacement | null = null;
  let detachResizer: (() => void) | null = null;
  /** 当てている大きさ (ドラッグの始まりの値)。 */
  let size = { width: 0, height: 0 };

  function layout(): ImageShelfLayout {
    return deps.getLayout?.() ?? DEFAULT_IMAGE_SHELF_LAYOUT;
  }

  /** 大きさを :root の CSS 変数に書く (左右の面の棚が同じ値を読む)。 */
  function applySize(next: { width: number; height: number }): void {
    size = {
      width: clampPanelSize(TERMINAL_IMAGE_SHELF_WIDTH, next.width),
      height: clampPanelSize(TERMINAL_IMAGE_SHELF_HEIGHT, next.height),
    };
    const root = document.documentElement.style;
    root.setProperty("--terminal-shelf-w", `${size.width}px`);
    root.setProperty("--terminal-shelf-h", `${size.height}px`);
  }

  function applyLayout(): void {
    const current = layout();
    applySize(current);
    el.dataset.placement = current.placement;
    if (placed !== current.placement) {
      placed = current.placement;
      detachResizer?.();
      const side = isSide(current.placement);
      resizer.setAttribute(
        "aria-orientation",
        side ? "vertical" : "horizontal",
      );
      detachResizer = attachDragResizer({
        handle: resizer,
        axis: side ? "x" : "y",
        // 端末の側の縁を掴む。右・下に置いた棚は縁を右・下へ動かすと小さくなる。
        direction:
          current.placement === "right" || current.placement === "bottom"
            ? -1
            : 1,
        getSize: () => (side ? size.width : size.height),
        applySize: (value) =>
          applySize(
            side ? { ...size, width: value } : { ...size, height: value },
          ),
        onEnd: () =>
          deps.setLayout?.(
            side ? { width: size.width } : { height: size.height },
          ),
        activeClassTarget: el,
        activeClassName: "is-resizing",
      });
    }
    fitRoom();
  }

  /** 端末に残る場所が足りなければ畳む (設定は変えない)。 */
  function fitRoom(): void {
    if (!room || !placed) return;
    const next = isSide(placed)
      ? room.width - size.width < SHELF_AUTO_COLLAPSE_ROOM.width
      : room.height - size.height < SHELF_AUTO_COLLAPSE_ROOM.height;
    if (!next) openedWhileNarrow = false;
    if (next === narrow) return;
    narrow = next;
    applyCollapsed();
  }

  function isCollapsedNow(): boolean {
    return deps.isCollapsed() || (narrow && !openedWhileNarrow);
  }

  /** カーソルを優先し、変わったときだけ知らせる。 */
  function locate(): void {
    const key = pointedKey ?? focusedKey;
    if (key === locatedKey) return;
    locatedKey = key;
    const entry = entries.find((item) => item.key === key) ?? null;
    showDetail(entry);
    deps.onLocate(entry);
  }
  const ageTimer = setInterval(() => {
    if (!el.hidden) refreshMeta();
  }, AGE_REFRESH_MS);

  function setCollapsed(collapsed: boolean): void {
    if (collapsed) {
      openedWhileNarrow = false;
      if (!deps.isCollapsed()) deps.setCollapsed(true);
    } else {
      if (narrow) openedWhileNarrow = true;
      if (deps.isCollapsed()) deps.setCollapsed(false);
    }
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
    const collapsed = isCollapsedNow();
    el.dataset.collapsed = collapsed ? "true" : "false";
    head.hidden = collapsed;
    list.hidden = collapsed;
    resizer.hidden = collapsed;
    expand.hidden = !collapsed;
  }

  /**
   * 項目の 2 行目。読めたものは「何分前」、読めなかったものは理由 (1 行に
   * 入らなければ省略し、全文は見出しの行に出す)。寸法は見出しの行に出す。
   */
  function metaParts(entry: ShelfEntry): string[] {
    const text = deps.getText();
    if (!entry.image) {
      return [text.imageRejected(entry.reason ?? "unreadable", entry.bytes)];
    }
    return [text.imageAge(elapsedBucket(now() - entry.image.mtimeMs))];
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
    // 1 回押すは画像のタブ (仮)、中ボタン・⌘/Ctrl は固定のタブ、Alt / Shift は
    // 覆い (ui-surface.md の「タブの決まり」)。
    const openBy = (event: MouseEvent) => {
      if (event.button > 1) return;
      const current = entries.find((item) => item.key === li.dataset.key);
      if (!current) return;
      event.preventDefault();
      deps.onOpen(
        current,
        event.altKey || event.shiftKey
          ? "overlay"
          : event.button === 1 || event.metaKey || event.ctrlKey
            ? "kept-tab"
            : "tab",
      );
    };
    open.addEventListener("click", openBy);
    open.addEventListener("auxclick", openBy);
    open.addEventListener("pointerenter", () => {
      pointedKey = li.dataset.key ?? null;
      locate();
    });
    open.addEventListener("pointerleave", () => {
      pointedKey = null;
      locate();
    });
    open.addEventListener("focus", () => {
      focusedKey = li.dataset.key ?? null;
      locate();
    });
    open.addEventListener("blur", () => {
      focusedKey = null;
      locate();
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
            // 右クリックで選んだ「タブで開く」は、あえて開くので固定。
            onSelect: () => deps.onOpen(current, "kept-tab"),
          },
          {
            label: text.imageOpenInViewer,
            onSelect: () => deps.onOpen(current, "overlay"),
          },
          {
            label: text.imageShowInTerminal,
            onSelect: () => deps.onReveal(current),
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
          if (current && locatedKey === current.key) showDetail(current);
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

  /**
   * 出た所の名前 (まとまりの見出し)。ペインは「ペイン 番号 · 名前」で、名前は
   * エージェントならサイドバーと同じ名前、無ければペインの題名 (頭の状態の記号は
   * 落とす)、それも無ければ前面のコマンドとフォルダの名前。
   */
  function originLabel(origin: ShelfOrigin | undefined): string {
    const text = deps.getText();
    if (origin?.pane) {
      const pane = origin.pane;
      const name =
        deps.paneName?.(pane.id) ||
        cleanPaneTitle(pane.title) ||
        [pane.command, pane.folder].filter(Boolean).join(" · ");
      return text.imageOriginPane(pane.index, name);
    }
    return origin?.shell || text.imageOriginUnknown;
  }

  /**
   * 見出しの行を、その項目の詳しいこと (パス · 寸法。読めなかったものは理由) に
   * 切り替える。null で題と件数に戻す。全文はその行の title。
   */
  function showDetail(entry: ShelfEntry | null): void {
    title.hidden = entry !== null;
    count.hidden = entry !== null;
    detail.hidden = entry === null;
    if (!entry) {
      head.removeAttribute("title");
      return;
    }
    const text = deps.getText();
    if (!entry.image) {
      const reason = text.imageRejected(
        entry.reason ?? "unreadable",
        entry.bytes,
      );
      detailDir.textContent = "";
      detailName.textContent = reason;
      detailFacts.textContent = "";
      head.title = [reason, entry.path, entry.detail]
        .filter(Boolean)
        .join("\n");
      return;
    }
    const slash = entry.path.lastIndexOf("/");
    detailDir.textContent = entry.path.slice(0, slash + 1);
    detailName.textContent = entry.path.slice(slash + 1);
    const size = sizes.get(entry.image.url);
    const facts = size ? text.imageSize(size.width, size.height) : "";
    detailFacts.textContent = facts ? ` · ${facts}` : "";
    head.title = [entry.path, facts].filter(Boolean).join(" · ");
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
    move.title = text.imageShelfMove;
    move.setAttribute("aria-label", text.imageShelfMove);
    resizer.setAttribute("aria-label", text.imageShelfResize);
    const expandLabel = text.imageShelfExpand(entries.length);
    expand.title = expandLabel;
    expand.setAttribute("aria-label", expandLabel);
    list.setAttribute("aria-label", text.imageShelfTitle);
  }

  function buildGroup(): GroupParts {
    const li = document.createElement("li");
    li.className = "terminal-image-shelf-group";
    const head = document.createElement("div");
    head.className = "terminal-image-shelf-group-head";
    const groupItems = document.createElement("ol");
    groupItems.className = "terminal-image-shelf-group-items";
    li.append(head, groupItems);
    return { li, head, items: groupItems };
  }

  /** 並びが同じなら DOM を動かさない (動かすと img が読み直しになることがある)。 */
  function placeChildren(parent: HTMLElement, ordered: HTMLElement[]): void {
    const same =
      parent.children.length === ordered.length &&
      ordered.every((child, index) => parent.children[index] === child);
    if (!same) parent.replaceChildren(...ordered);
  }

  function render(next: readonly ShelfEntry[]): void {
    entries = next;
    el.hidden = entries.length === 0;
    applyCollapsed();
    localizeHead();
    const keep = new Set<string>();
    // 出た所ごとに、新しい画像の順でまとめる (entries は新しい順)。
    const grouped = new Map<string, { label: string; lis: HTMLLIElement[] }>();
    for (const entry of entries) {
      keep.add(entry.key);
      let parts = items.get(entry.key);
      if (!parts) {
        parts = buildItem();
        items.set(entry.key, parts);
      }
      fillItem(parts, entry);
      const origin = entry.origins[0];
      const place = origin
        ? origin.pane
          ? `pane:${origin.pane.id}`
          : `shell:${origin.shell}`
        : "none";
      const group = grouped.get(place) ?? {
        label: originLabel(origin),
        lis: [],
      };
      group.lis.push(parts.li);
      grouped.set(place, group);
    }
    for (const [key, parts] of items) {
      if (keep.has(key)) continue;
      parts.li.remove();
      items.delete(key);
    }
    const orderedGroups: HTMLLIElement[] = [];
    for (const [place, group] of grouped) {
      let parts = groups.get(place);
      if (!parts) {
        parts = buildGroup();
        groups.set(place, parts);
      }
      parts.head.textContent = group.label;
      parts.head.title = group.label;
      placeChildren(parts.items, group.lis);
      orderedGroups.push(parts.li);
    }
    for (const [place, parts] of groups) {
      if (grouped.has(place)) continue;
      parts.li.remove();
      groups.delete(place);
    }
    placeChildren(list, orderedGroups);
    if (linkedKey && !keep.has(linkedKey)) highlight(null);
    // 消えた項目の出入りは届かないので、ここで外す。
    if (pointedKey && !keep.has(pointedKey)) pointedKey = null;
    if (focusedKey && !keep.has(focusedKey)) focusedKey = null;
    locate();
    // 載っている項目の中身が変わった (読めなくなった・上書きされた)。
    if (locatedKey) {
      showDetail(entries.find((item) => item.key === locatedKey) ?? null);
    }
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

  applyLayout();

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
    applyLayout,
    setRoom(next) {
      room = next;
      fitRoom();
    },
    dispose() {
      clearInterval(ageTimer);
      detachResizer?.();
      detachResizer = null;
    },
  };
}

/**
 * ペインの題名の頭の状態の記号を落とす。エージェントは題名の頭に状態を出す
 * (✳・スピナーの点字など)。見出しにそれが残ると、刻々と変わる記号が並ぶ。
 */
export function cleanPaneTitle(title: string): string {
  return title.replace(/^[\p{So}\p{Sk}\p{Co}·•*\s]+/u, "").trim();
}
