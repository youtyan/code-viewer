import { isImeComposing } from "../core/keyboard";
import {
  buildHelpKeybindingGroups,
  type HelpKeybindingLanguage,
} from "./help-keybindings";
import { renderHelpTable } from "./help-page";

// Keep the header popover compact; the full Help page keeps the complete table.
const QUICK_HELP_GROUP_TITLES_EN = ["Global", "Main Panel"];

export type QuickHelpText = {
  panelTitle: string;
  close: string;
  viewAll: string;
};

export type QuickHelpDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  getLanguage(): HelpKeybindingLanguage;
  getText(): QuickHelpText;
  openFullKeybindings(): void;
};

export function createQuickHelp(deps: QuickHelpDeps) {
  const popover = deps.$<HTMLElement>("#quick-help-popover");
  const trigger = deps.$<HTMLButtonElement>("#quick-help-btn");
  const titleEl = deps.$<HTMLElement>("#quick-help-title");
  const closeBtn = deps.$<HTMLButtonElement>("#quick-help-close");
  const groupsHost = deps.$<HTMLElement>("#quick-help-groups");
  const fullLink = deps.$<HTMLAnchorElement>("#quick-help-full-link");

  function isOpen(): boolean {
    return !popover.hidden;
  }

  function renderContent() {
    groupsHost.innerHTML = "";
    const groups = buildHelpKeybindingGroups(
      deps.getLanguage(),
      undefined,
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
    const text = deps.getText();
    titleEl.textContent = text.panelTitle;
    popover.setAttribute("aria-label", text.panelTitle);
    closeBtn.setAttribute("aria-label", text.close);
    fullLink.textContent = text.viewAll;
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

  trigger.addEventListener("click", toggle);
  closeBtn.addEventListener("click", close);
  fullLink.addEventListener("click", (e) => {
    e.preventDefault();
    close();
    deps.openFullKeybindings();
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
    if (popover.contains(target) || trigger.contains(target)) return;
    close();
  });

  function localize() {
    applyText();
    if (isOpen()) renderContent();
  }

  return { open, close, toggle, isOpen, localize };
}
