// Data の表の上の「タイムゾーン」の選択窓。押すと浮く窓が開き、上の検索欄で
// 名前 ("tokyo") か時差 ("+9") で絞り込んで選ぶ。よく使うもの (元の時刻のまま・
// この PC・UTC) を先頭に置き、全部のタイムゾーンには今の時差を添える。
// 値は設定 (db-ui.json の prefs.timeZone) に置く: "" = 元の時刻のまま、
// "local" = この PC、ほかは IANA の名前。

import { live } from "lit/directives/live.js";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import {
  formatInZone,
  formatUtcOffset,
  timeZoneMatches,
  timeZoneOffsetMinutes,
  timeZoneShortName,
} from "../../core/database/time-zone";
import { CHECK_16_PATHS, CHEVRON_DOWN_12_PATH } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import { pageLanguage } from "../page-language";
import { iconTemplate } from "../ui/icon";
import { detachedElement } from "../ui/renderer";
import type { DbText } from "./i18n";
import { reportDatastoreFailure } from "./report-failure";

/** この PC のタイムゾーン (IANA の名前)。 */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Intl.supportedValuesOf の無い古いランタイム向けの最小の一覧。
const FALLBACK_TIME_ZONES = [
  "UTC",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
];

function knownTimeZones(): string[] {
  const intl: object = Intl;
  if (
    !("supportedValuesOf" in intl) ||
    typeof intl.supportedValuesOf !== "function"
  )
    return FALLBACK_TIME_ZONES;
  const list: unknown = intl.supportedValuesOf("timeZone");
  if (!Array.isArray(list)) return FALLBACK_TIME_ZONES;
  return list.filter((zone): zone is string => typeof zone === "string");
}

// 窓と表の下端の間の余白と、狭い表でも残す窓の高さ。
const MENU_MARGIN_PX = 8;
const MENU_MIN_HEIGHT_PX = 160;

export type TimeZonePicker = {
  el: HTMLElement;
  /** 日時の列を出し直すタイムゾーン。元の時刻のままなら null。 */
  zone: () => string | null;
  /** 設定の値と言語を、ボタンと窓に映し直す。 */
  sync: () => void;
  /** この表に日時の列があるときだけ出す。 */
  setShown: (shown: boolean) => void;
  /** 見出しに添える短い名前 ("UTC"・"GMT+9")。 */
  shortName: () => string;
};

type Option = {
  value: string;
  /** 一覧に出す名前と時差。 */
  label: string;
  offset: string;
  /** 絞り込みに使う名前 (「この PC」は IANA の名前も足す)。 */
  name: string;
  /** 見出し (よく使うもの・全部) のどちらの組か。 */
  group: 0 | 1;
};

export type TimeZoneOptionProps = {
  value: string;
  name: string;
  offset: string;
  selected: boolean;
  highlighted: boolean;
  hidden: boolean;
  onChoose: () => void;
  onHover: () => void;
};

export type TimeZonePickerProps = {
  /** この表に日時の列があるか。 */
  shown: boolean;
  /** 設定のタイムゾーンをこのブラウザが知らない。 */
  failed: boolean;
  /** 選んだ値の保存に失敗した (理由は title)。 */
  saveFailed: boolean;
  /** ボタンの文字・title・読み上げ名と検索欄の案内。sync の前は null。 */
  label: string | null;
  title: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  open: boolean;
  /** 窓の高さの上限 (px)。表の箱の下端に合わせる。 */
  maxHeight: number | null;
  query: string;
  /** 一覧 (初めて開くまでは空)。絞り込み中は見出しを隠す。 */
  groups: { label: string; hidden: boolean; options: TimeZoneOptionProps[] }[];
  /** 当たるものが無いときの文。一覧を作る前は null。 */
  empty: { text: string; hidden: boolean } | null;
  buttonRef: Ref<HTMLButtonElement>;
  searchRef: Ref<HTMLInputElement>;
  onToggle: () => void;
  onQuery: (query: string) => void;
  onKeydown: (event: KeyboardEvent) => void;
};

export type TimeZonePickerView = (props: TimeZonePickerProps) => unknown;

const attr = (value: string | null) => value ?? nothing;

export const DEFAULT_VIEW: TimeZonePickerView = (p) =>
  html`<span
    class=${p.failed ? "db-grid-tz is-failed" : "db-grid-tz"}
    ?hidden=${!p.shown}
    data-save-failed=${p.saveFailed ? "1" : nothing}
    ><button
      type="button"
      class="db-btn db-btn-sm db-grid-tz-button"
      aria-haspopup="listbox"
      aria-expanded=${p.open ? "true" : "false"}
      aria-label=${attr(p.ariaLabel)}
      title=${attr(p.title)}
      ${ref(p.buttonRef)}
      @click=${p.onToggle}
    ><span class="db-grid-tz-current">${p.label ?? ""}</span><span
        class="db-grid-tz-chevron"
        >${iconTemplate(CHEVRON_DOWN_12_PATH, "octicon-chevron-down")}</span
      ></button
    ><div
      class="db-grid-tz-menu"
      ?hidden=${!p.open}
      style=${p.maxHeight === null ? nothing : `max-height: ${p.maxHeight}px;`}
    ><input
        type="search"
        class="db-grid-tz-search"
        autocomplete="off"
        spellcheck="false"
        placeholder=${attr(p.placeholder)}
        .value=${live(p.query)}
        ${ref(p.searchRef)}
        @input=${(event: Event) =>
          p.onQuery((event.currentTarget as HTMLInputElement).value)}
        @keydown=${p.onKeydown}
      /><div class="db-grid-tz-list" role="listbox">${p.groups.map(
        (group) =>
          html`<div class="db-grid-tz-group" ?hidden=${group.hidden}>${group.label}</div>${group.options.map(
            (o) =>
              html`<button
                type="button"
                class=${[
                  "db-grid-tz-option",
                  o.selected ? "is-selected" : "",
                  o.highlighted ? "is-highlighted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="option"
                data-value=${o.value}
                aria-selected=${o.selected ? "true" : "false"}
                ?hidden=${o.hidden}
                @click=${o.onChoose}
                @mousemove=${o.onHover}
              >${iconTemplate(CHECK_16_PATHS, "db-grid-tz-check")}<span
                  class="db-grid-tz-name"
                  >${o.name}</span
                ><span class="db-grid-tz-offset">${o.offset}</span></button>`,
          )}`,
      )}${
        p.empty
          ? html`<div class="db-grid-tz-empty" ?hidden=${p.empty.hidden}>${p.empty.text}</div>`
          : nothing
      }</div></div
  ></span>`;

export function createTimeZonePicker(
  opts: {
    text: () => DbText;
    get: () => string;
    set: (pref: string | null) => Promise<void>;
    onChange: () => void;
  },
  view: TimeZonePickerView = DEFAULT_VIEW,
): TimeZonePicker {
  const buttonRef = createRef<HTMLButtonElement>();
  const searchRef = createRef<HTMLInputElement>();
  let shown = false;
  let open = false;
  let query = "";
  let maxHeight: number | null = null;
  // sync で映した文言 (sync の前は何も出さない)。
  let synced: {
    label: string;
    ariaLabel: string;
    placeholder: string;
  } | null = null;
  let title: string | null = null;
  let saveFailed = false;
  let emptyText: string | null = null;

  // この画面で選んだ値。保存の応答を待たずに効かせ、保存に失敗しても
  // この画面では選んだまま (失敗は title に出す)。
  let chosen: string | null = null;
  const pref = () => chosen ?? opts.get();
  // 使えると確かめたタイムゾーン。この画面のブラウザが知らない名前は
  // 元の時刻に戻し、理由をボタンの title に出す (黙って戻さない)。
  let active: string | null = null;
  let failure: { zone: string; detail: string } | null = null;
  let resolvedFor: string | null = null;
  let options: Option[] = [];
  let groupLabels: [string, string] = ["", ""];
  let builtFor = "";
  let highlighted = -1;
  let selectedValue: string | null = null;

  const matches = (o: Option) => timeZoneMatches(query, o.name, o.offset);

  function props(): TimeZonePickerProps {
    const searching = query.trim() !== "";
    const optionProps = options.map(
      (o, index): TimeZoneOptionProps => ({
        value: o.value,
        name: o.label,
        offset: o.offset,
        selected: o.value === selectedValue,
        highlighted: index === highlighted,
        hidden: !matches(o),
        onChoose: () => choose(o.value),
        onHover: () => {
          if (highlighted === index) return;
          highlighted = index;
          draw();
        },
      }),
    );
    return {
      shown,
      failed: failure !== null,
      saveFailed,
      label: synced?.label ?? null,
      title,
      ariaLabel: synced?.ariaLabel ?? null,
      placeholder: synced?.placeholder ?? null,
      open,
      maxHeight,
      query,
      groups:
        options.length === 0
          ? []
          : ([0, 1] as const).map((group) => ({
              label: groupLabels[group],
              hidden: searching,
              options: optionProps.filter((_, i) => options[i].group === group),
            })),
      empty:
        emptyText === null
          ? null
          : {
              text: emptyText,
              hidden: options.some(matches),
            },
      buttonRef,
      searchRef,
      onToggle: () => {
        if (open) close(true);
        else openMenu();
      },
      onQuery: (value) => {
        query = value;
        filter();
      },
      onKeydown,
    };
  }

  const box = detachedElement(() => view(props()));
  const el = box.element;
  const draw = () => box.draw();

  function resolve(): void {
    const value = pref();
    const zone = value === "local" ? localTimeZone() : value;
    // 同じ名前を何度も確かめない (失敗の console も 1 つの名前に 1 回)。
    if (zone === resolvedFor) return;
    resolvedFor = zone;
    failure = null;
    active = null;
    if (!zone) return;
    try {
      formatInZone(0, zone);
      active = zone;
    } catch (error) {
      failure = {
        zone,
        detail: reportDatastoreFailure("SQL", "use time zone", error, zone),
      };
    }
  }

  function labelOf(value: string): string {
    const t = opts.text().grid;
    if (value === "") return t.timeZoneRaw;
    if (value === "local") return t.timeZoneLocalShort;
    return value;
  }

  function offsetOf(zone: string, now: number): string {
    try {
      return formatUtcOffset(timeZoneOffsetMinutes(zone, now));
    } catch (error) {
      // この画面のブラウザが知らない名前 (一覧には出ない。保存値だけ)。
      reportDatastoreFailure("SQL", "read time zone offset", error, zone);
      return "";
    }
  }

  function option(
    group: 0 | 1,
    value: string,
    label: string,
    offset: string,
  ): Option {
    // 「この PC」も Asia/Tokyo の名前で引けるようにする。
    const name = value === "local" ? `${label} ${localTimeZone()}` : label;
    return { value, label, offset, name, group };
  }

  // 一覧は初めて開いたとき (と言語・この PC が変わったとき) に作る。
  function build(): void {
    const t = opts.text().grid;
    const local = localTimeZone();
    const key = `${t.timeZoneRaw}|${local}`;
    if (key === builtFor) return;
    builtFor = key;
    const now = Date.now();
    groupLabels = [t.timeZoneCommon, t.timeZoneAll];
    options = [
      option(0, "", t.timeZoneRaw, ""),
      option(0, "local", t.timeZoneLocal(local), offsetOf(local, now)),
      option(0, "UTC", "UTC", "+00:00"),
      ...knownTimeZones()
        .filter((zone) => zone !== "UTC")
        .map((zone) => option(1, zone, zone, offsetOf(zone, now))),
    ];
    emptyText = "";
  }

  function visible(): number[] {
    return options.flatMap((o, i) => (matches(o) ? [i] : []));
  }

  function scrollToHighlighted(): void {
    if (highlighted < 0) return;
    el.querySelector<HTMLElement>(
      ".db-grid-tz-option.is-highlighted",
    )?.scrollIntoView?.({ block: "nearest" });
  }

  function filter(): void {
    const shownIndexes = visible();
    emptyText = opts.text().grid.timeZoneNoMatch;
    highlighted = shownIndexes.length > 0 ? shownIndexes[0] : -1;
    draw();
    scrollToHighlighted();
  }

  function onDocumentPointer(e: Event): void {
    if (!el.contains(e.target as Node)) close(false);
  }

  function openMenu(): void {
    build();
    selectedValue = pref();
    query = "";
    filter();
    const selectedIndex = options.findIndex((o) => o.value === pref());
    if (selectedIndex >= 0) highlighted = selectedIndex;
    // 表の箱 (.db-grid は overflow: hidden) の下端で切れないよう、入る高さまでにする。
    const host = el.closest(".db-grid");
    const button = buttonRef.value;
    if (host && button) {
      const room =
        host.getBoundingClientRect().bottom -
        button.getBoundingClientRect().bottom -
        MENU_MARGIN_PX;
      maxHeight = Math.max(MENU_MIN_HEIGHT_PX, room);
    }
    // 開いたときの一覧は送らない (書き直す前も、送るのが窓を出す前で効いて
    // いなかった。同じ見え方にしておく)。
    open = true;
    draw();
    document.addEventListener("mousedown", onDocumentPointer, true);
    searchRef.value?.focus();
  }

  function close(returnFocus: boolean): void {
    if (!open) return;
    open = false;
    draw();
    document.removeEventListener("mousedown", onDocumentPointer, true);
    if (returnFocus) buttonRef.value?.focus();
  }

  function choose(value: string): void {
    close(true);
    if (value === pref()) return;
    chosen = value;
    saveFailed = false;
    draw();
    void opts.set(value || null).catch((error: unknown) => {
      const detail = reportDatastoreFailure(
        "SQL",
        "remember time zone",
        error,
        value,
      );
      saveFailed = true;
      title = opts.text().grid.timeZoneSaveFailed(detail);
      draw();
    });
    // 保存を待たずに出し直す (保存の失敗はボタンの title に出す)。
    opts.onChange();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (isImeComposing(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target = options[highlighted];
      if (target && matches(target)) choose(target.value);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const shownIndexes = visible();
    if (shownIndexes.length === 0) return;
    const at = shownIndexes.indexOf(highlighted);
    const step = e.key === "ArrowDown" ? 1 : -1;
    highlighted =
      shownIndexes[Math.min(Math.max(at + step, 0), shownIndexes.length - 1)];
    draw();
    scrollToHighlighted();
  }

  function sync(): void {
    const t = opts.text().grid;
    resolve();
    synced = {
      label: labelOf(pref()),
      ariaLabel: t.timeZoneLabel,
      placeholder: t.timeZoneSearch,
    };
    // 開いている窓の文言 (見出し・この PC) も言語に合わせる。
    if (open) {
      build();
      selectedValue = pref();
      filter();
    }
    if (!saveFailed)
      title = failure
        ? t.timeZoneUnknown(failure.zone, failure.detail)
        : `${t.timeZoneTitle}\n${labelOf(pref())}${active && pref() !== "UTC" && pref() !== "" ? ` (${active})` : ""}`;
    draw();
  }

  return {
    el,
    zone: () => active,
    sync,
    setShown(next) {
      shown = next;
      draw();
      if (!next) close(false);
    },
    shortName: () =>
      active ? timeZoneShortName(active, Date.now(), pageLanguage()) : "",
  };
}
