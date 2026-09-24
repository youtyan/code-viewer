import { isImeComposing } from "../core/keyboard";
import type { KeyBinding } from "../core/keymap";
import {
  buildHelpKeybindingGroups,
  type HelpKeybindingLanguage,
} from "./help-keybindings";
import { renderHelpTable } from "./help-page";
import { quickHelpText } from "./quick-help-i18n";

// キーボードショートカットの小窓 (? で開く)。よく使う分類だけを出し、全部の
// キーはヘルプの「キーボードショートカット」に任せる。
const QUICK_HELP_GROUP_TITLES_EN = ["Global", "Main Panel"];

/** 押すと小窓を開閉するボタンに付ける印 (外を押したら閉じる、から外す)。 */
const TRIGGER_SELECTOR = "[data-quick-help-trigger]";

export type QuickHelpDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  getLanguage(): HelpKeybindingLanguage;
  /** 利用者の割り当てを重ねた、いま効くバインド (設定のショートカット) */
  getKeyBindings(): KeyBinding[];
  openFullKeybindings(): void;
  openSettings(): void;
};

export function createQuickHelp(deps: QuickHelpDeps) {
  const popover = deps.$<HTMLElement>("#quick-help-popover");
  const titleEl = deps.$<HTMLElement>("#quick-help-title");
  const closeBtn = deps.$<HTMLButtonElement>("#quick-help-close");
  const groupsHost = deps.$<HTMLElement>("#quick-help-groups");
  const fullLink = deps.$<HTMLAnchorElement>("#quick-help-full-link");
  const settingsLink = deps.$<HTMLAnchorElement>("#quick-help-settings-link");

  function isOpen(): boolean {
    return !popover.hidden;
  }

  function renderContent() {
    groupsHost.innerHTML = "";
    const groups = buildHelpKeybindingGroups(
      deps.getLanguage(),
      deps.getKeyBindings(),
      QUICK_HELP_GROUP_TITLES_EN,
    );
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "gdp-help-group";
      const title = document.createElement("h3");
      title.textContent = group.title;
      section.append(title, renderHelpTable(group.rows));
      groupsHost.appendChild(section);
    }
  }

  function applyText() {
    const text = quickHelpText(deps.getLanguage());
    titleEl.textContent = text.panelTitle;
    popover.setAttribute("aria-label", text.panelTitle);
    closeBtn.setAttribute("aria-label", text.close);
    fullLink.textContent = text.viewAll;
    settingsLink.textContent = text.settings;
  }

  function open() {
    applyText();
    renderContent();
    popover.hidden = false;
    closeBtn.focus();
  }

  function close() {
    if (!isOpen()) return;
    popover.hidden = true;
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  closeBtn.addEventListener("click", close);
  fullLink.addEventListener("click", (e) => {
    e.preventDefault();
    close();
    deps.openFullKeybindings();
  });
  settingsLink.addEventListener("click", (e) => {
    e.preventDefault();
    close();
    deps.openSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (isImeComposing(e)) return;
    if (e.key !== "Escape") return;
    if (!isOpen()) return;
    close();
  });
  document.addEventListener("mousedown", (e) => {
    if (!isOpen()) return;
    const target = e.target as Element;
    if (popover.contains(target) || target.closest(TRIGGER_SELECTOR)) return;
    close();
  });

  function localize() {
    applyText();
    if (isOpen()) renderContent();
  }

  return { open, close, toggle, isOpen, localize };
}
