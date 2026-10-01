// Data の表の上の「タイムゾーン」の選択窓。押すと浮く窓が開き、上の検索欄で
// 名前 ("tokyo") か時差 ("+9") で絞り込んで選ぶ。よく使うもの (元の時刻のまま・
// この PC・UTC) を先頭に置き、全部のタイムゾーンには今の時差を添える。
// 値は設定 (db-ui.json の prefs.timeZone) に置く: "" = 元の時刻のまま、
// "local" = この PC、ほかは IANA の名前。

import {
  formatInZone,
  formatUtcOffset,
  timeZoneMatches,
  timeZoneOffsetMinutes,
  timeZoneShortName,
} from "../../core/database/time-zone";
import {
  CHECK_16_PATHS,
  CHEVRON_DOWN_12_PATH,
  iconSvg,
} from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import { pageLanguage } from "../page-language";
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
  el: HTMLButtonElement;
  /** 絞り込みに使う名前と時差。 */
  name: string;
  offset: string;
};

export function createTimeZonePicker(opts: {
  text: () => DbText;
  get: () => string;
  set: (pref: string | null) => Promise<void>;
  onChange: () => void;
}): TimeZonePicker {
  const el = document.createElement("span");
  el.className = "db-grid-tz";
  el.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "db-btn db-btn-sm db-grid-tz-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const current = document.createElement("span");
  current.className = "db-grid-tz-current";
  const chevron = document.createElement("span");
  chevron.className = "db-grid-tz-chevron";
  chevron.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_12_PATH);
  button.append(current, chevron);
  const menu = document.createElement("div");
  menu.className = "db-grid-tz-menu";
  menu.hidden = true;
  const search = document.createElement("input");
  search.type = "search";
  search.className = "db-grid-tz-search";
  search.autocomplete = "off";
  search.spellcheck = false;
  const list = document.createElement("div");
  list.className = "db-grid-tz-list";
  list.setAttribute("role", "listbox");
  const empty = document.createElement("div");
  empty.className = "db-grid-tz-empty";
  empty.hidden = true;
  menu.append(search, list);
  el.append(button, menu);

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
  let builtFor = "";
  let highlighted = -1;

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

  function group(label: string): void {
    const head = document.createElement("div");
    head.className = "db-grid-tz-group";
    head.textContent = label;
    list.appendChild(head);
  }

  function option(value: string, name: string, offset: string): void {
    const o = document.createElement("button");
    o.type = "button";
    o.className = "db-grid-tz-option";
    o.setAttribute("role", "option");
    o.dataset.value = value;
    o.innerHTML = iconSvg("db-grid-tz-check", CHECK_16_PATHS);
    const nameEl = document.createElement("span");
    nameEl.className = "db-grid-tz-name";
    nameEl.textContent = name;
    const offsetEl = document.createElement("span");
    offsetEl.className = "db-grid-tz-offset";
    offsetEl.textContent = offset;
    o.append(nameEl, offsetEl);
    const index = options.length;
    o.addEventListener("click", () => choose(value));
    o.addEventListener("mousemove", () => highlight(index, false));
    list.appendChild(o);
    // 「この PC」も Asia/Tokyo の名前で引けるようにする。
    const zoneName = value === "local" ? `${name} ${localTimeZone()}` : name;
    options.push({ value, el: o, name: zoneName, offset });
  }

  // 一覧は初めて開いたとき (と言語・この PC が変わったとき) に作る。
  function build(): void {
    const t = opts.text().grid;
    const local = localTimeZone();
    const key = `${t.timeZoneRaw}|${local}`;
    if (key === builtFor) return;
    builtFor = key;
    list.textContent = "";
    options = [];
    const now = Date.now();
    group(t.timeZoneCommon);
    option("", t.timeZoneRaw, "");
    option("local", t.timeZoneLocal(local), offsetOf(local, now));
    option("UTC", "UTC", "+00:00");
    group(t.timeZoneAll);
    for (const zone of knownTimeZones())
      if (zone !== "UTC") option(zone, zone, offsetOf(zone, now));
    list.appendChild(empty);
  }

  function visible(): Option[] {
    return options.filter((o) => !o.el.hidden);
  }

  function highlight(index: number, scroll: boolean): void {
    highlighted = index;
    options.forEach((o, i) => {
      o.el.classList.toggle("is-highlighted", i === index);
    });
    if (scroll && index >= 0)
      options[index].el.scrollIntoView?.({ block: "nearest" });
  }

  function filter(): void {
    const query = search.value;
    const searching = query.trim() !== "";
    for (const o of options)
      o.el.hidden = !timeZoneMatches(query, o.name, o.offset);
    // 絞り込み中は見出しを隠し、当たったものだけを並べる。
    for (const head of list.querySelectorAll<HTMLElement>(".db-grid-tz-group"))
      head.hidden = searching;
    const shown = visible();
    empty.hidden = shown.length > 0;
    empty.textContent = opts.text().grid.timeZoneNoMatch;
    highlight(shown.length > 0 ? options.indexOf(shown[0]) : -1, true);
  }

  function markSelected(): void {
    const value = pref();
    for (const o of options) {
      const selected = o.value === value;
      o.el.classList.toggle("is-selected", selected);
      o.el.setAttribute("aria-selected", selected ? "true" : "false");
    }
  }

  function onDocumentPointer(e: Event): void {
    if (!el.contains(e.target as Node)) close(false);
  }

  function open(): void {
    build();
    markSelected();
    search.value = "";
    filter();
    const selectedIndex = options.findIndex((o) => o.value === pref());
    if (selectedIndex >= 0) highlight(selectedIndex, true);
    // 表の箱 (.db-grid は overflow: hidden) の下端で切れないよう、入る高さまでにする。
    const host = el.closest(".db-grid");
    if (host) {
      const room =
        host.getBoundingClientRect().bottom -
        button.getBoundingClientRect().bottom -
        MENU_MARGIN_PX;
      menu.style.maxHeight = `${Math.max(MENU_MIN_HEIGHT_PX, room)}px`;
    }
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", onDocumentPointer, true);
    search.focus();
  }

  function close(returnFocus: boolean): void {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onDocumentPointer, true);
    if (returnFocus) button.focus();
  }

  function choose(value: string): void {
    close(true);
    if (value === pref()) return;
    chosen = value;
    delete el.dataset.saveFailed;
    void opts.set(value || null).catch((error: unknown) => {
      const detail = reportDatastoreFailure(
        "SQL",
        "remember time zone",
        error,
        value,
      );
      el.dataset.saveFailed = "1";
      button.title = opts.text().grid.timeZoneSaveFailed(detail);
    });
    // 保存を待たずに出し直す (保存の失敗はボタンの title に出す)。
    opts.onChange();
  }

  button.addEventListener("click", () => {
    if (menu.hidden) open();
    else close(true);
  });
  search.addEventListener("input", filter);
  search.addEventListener("keydown", (e) => {
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
      if (target && !target.el.hidden) choose(target.value);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const shown = visible();
    if (shown.length === 0) return;
    const at = shown.findIndex((o) => options.indexOf(o) === highlighted);
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next = shown[Math.min(Math.max(at + step, 0), shown.length - 1)];
    highlight(options.indexOf(next), true);
  });

  function sync(): void {
    const t = opts.text().grid;
    resolve();
    current.textContent = labelOf(pref());
    search.placeholder = t.timeZoneSearch;
    button.setAttribute("aria-label", t.timeZoneLabel);
    el.classList.toggle("is-failed", failure !== null);
    // 開いている窓の文言 (見出し・この PC) も言語に合わせる。
    if (!menu.hidden) {
      build();
      markSelected();
      filter();
    }
    if (el.dataset.saveFailed) return;
    button.title = failure
      ? t.timeZoneUnknown(failure.zone, failure.detail)
      : `${t.timeZoneTitle}\n${labelOf(pref())}${active && pref() !== "UTC" && pref() !== "" ? ` (${active})` : ""}`;
  }

  return {
    el,
    zone: () => active,
    sync,
    setShown(shown) {
      el.hidden = !shown;
      if (!shown) close(false);
    },
    shortName: () =>
      active ? timeZoneShortName(active, Date.now(), pageLanguage()) : "",
  };
}
