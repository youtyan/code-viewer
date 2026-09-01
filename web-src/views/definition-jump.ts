// Definition lookup is limited to standalone source code and the main diff in
// v1. Blame, markdown code blocks, worktree diffs, and embedded history diffs
// deliberately fall through without intercepting the user's input.

import {
  buildDefinitionQuery,
  definitionLangOf,
  isJumpableSymbol,
  rankDefinitionMatches,
} from "../core/definition-search";
import { errorWithCause, responseErrorMessage } from "../core/error-detail";
import type { AppRoute } from "../core/routes";
import { buildGrepRequestParams } from "../core/search-palette";
import type { ShikiHighlighter } from "../core/shiki-loader";
import type { DiffCardElement, GrepMatch, GrepResponse } from "../core/types";
import { expandWordAt, WORD_CHAR_RE } from "../core/word-boundary";
import { createCodePreview } from "./code-preview";
import {
  type ContextMenuItem,
  closeContextMenu,
  showContextMenu,
} from "./context-menu";
import {
  type DefinitionJumpLanguage,
  definitionJumpText,
} from "./definition-jump-i18n";

export type DefinitionCellContext = {
  path: string;
  ref: string;
  line: number | null;
  side?: "old" | "new";
};

function positiveLine(raw: string | undefined): number | null {
  const line = Number(raw ?? "");
  return Number.isInteger(line) && line > 0 ? line : null;
}

export function offsetInCell(
  cell: HTMLElement,
  node: Node,
  nodeOffset: number,
): number {
  if (node !== cell && !cell.contains(node)) return -1;
  if (!Number.isInteger(nodeOffset) || nodeOffset < 0) return -1;

  if (node.nodeType !== Node.TEXT_NODE) {
    if (nodeOffset > node.childNodes.length) return -1;
    const range = document.createRange();
    range.setStart(cell, 0);
    range.setEnd(node, nodeOffset);
    return range.toString().length;
  }

  const target = node as Text;
  if (nodeOffset > target.data.length) return -1;
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current === target) return offset + nodeOffset;
    offset += (current as Text).data.length;
  }
  return -1;
}

export function sourceCellContext(
  cell: HTMLElement,
): DefinitionCellContext | null {
  const card = cell.closest<HTMLElement>(".gdp-standalone-source");
  const path = card?.dataset.path;
  const ref = card?.dataset.sourceRef;
  if (!card || !path || !ref) return null;
  const row = cell.closest<HTMLElement>("[data-line]");
  return { path, ref, line: positiveLine(row?.dataset.line) };
}

function splitSide(cell: HTMLElement): "old" | "new" | null {
  const side = cell.closest<HTMLElement>(".d2h-file-side-diff");
  const wrapper = cell.closest<HTMLElement>(".d2h-file-wrapper");
  if (!side || !wrapper) return null;
  const sides = wrapper.querySelectorAll<HTMLElement>(".d2h-file-side-diff");
  if (sides.length < 2) return null;
  if (side === sides[0]) return "old";
  return side === sides[1] ? "new" : null;
}

function unifiedSide(cell: HTMLElement): "old" | "new" | null {
  const content = cell.closest<HTMLElement>("td");
  if (!content) return null;
  if (content.classList.contains("d2h-del")) return "old";
  if (content.classList.contains("d2h-ins")) return "new";
  if (!content.classList.contains("d2h-cntx")) return null;
  const row = content.closest("tr");
  const after = row
    ?.querySelector<HTMLElement>("td.d2h-code-linenumber .line-num2")
    ?.textContent?.trim();
  return after ? "new" : "old";
}

function diffLine(cell: HTMLElement, side: "old" | "new"): number | null {
  const row = cell.closest("tr");
  if (!row) return null;
  const sideNumber = row.querySelector<HTMLElement>(
    "td.d2h-code-side-linenumber",
  );
  if (sideNumber) return positiveLine(sideNumber.textContent?.trim());
  const selector = side === "old" ? ".line-num1" : ".line-num2";
  return positiveLine(
    row
      .querySelector<HTMLElement>(`td.d2h-code-linenumber ${selector}`)
      ?.textContent?.trim(),
  );
}

export function diffCellContext(
  cell: HTMLElement,
  range: { from: string; to: string },
): DefinitionCellContext | null {
  if (!cell.closest("#diff")) return null;
  const card = cell.closest<DiffCardElement>(".gdp-file-shell[data-path]");
  const currentPath = card?.dataset.path;
  if (!card || !currentPath) return null;

  const side = splitSide(cell) ?? unifiedSide(cell);
  if (!side) return null;
  return {
    path: side === "old" ? card._file?.old_path || currentPath : currentPath,
    ref: side === "old" ? range.from || "HEAD" : range.to,
    line: diffLine(cell, side),
    side,
  };
}

export type DefinitionJumpDeps = {
  STATE: {
    route: AppRoute;
    from: string;
    to: string;
    language: DefinitionJumpLanguage;
  };
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  isAbortError(err: unknown): boolean;
  appendScopeParams(params: URLSearchParams): void;
  inferLang(path: string): string | null;
  getSyntaxHighlight(): boolean;
  loadSourceShikiHighlighter(lang: string): Promise<ShikiHighlighter | null>;
  sourceShikiLines(
    textValue: string,
    lang: string,
    highlighter: ShikiHighlighter,
  ): string[] | null;
  openMatch(match: {
    path: string;
    ref: string;
    line: number;
    hl?: string;
  }): void;
  openSearchSheet(query: string): void;
  caretFromPoint?(x: number, y: number): { node: Node; offset: number } | null;
};

type SearchTrigger = {
  symbol: string;
  context: DefinitionCellContext;
  anchor: HTMLElement;
  at: { x: number; y: number };
  focusReturn: HTMLElement | null;
};

type CellSymbol = {
  symbol: string;
  context: DefinitionCellContext;
  start: number;
  end: number;
};

const CODE_CELL_SELECTOR =
  ".gdp-source-line-code, .gdp-source-virtual-line-code, .d2h-code-line-ctn";

function cellFromNode(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  return element?.closest<HTMLElement>(CODE_CELL_SELECTOR) ?? null;
}

function contextForCell(
  cell: HTMLElement,
  state: DefinitionJumpDeps["STATE"],
): DefinitionCellContext | null {
  const route = state.route;
  if (route.screen === "file" && (route.view ?? "blob") === "blob") {
    return sourceCellContext(cell);
  }
  // The route guard excludes worktree's reused #diff host; diffCellContext
  // independently requires the cell to be inside the main #diff element.
  if (route.screen !== "diff") return null;
  return diffCellContext(cell, { from: state.from, to: state.to });
}

function focusReturnFor(cell: HTMLElement): HTMLElement | null {
  for (let current: HTMLElement | null = cell; current; ) {
    if (current.tabIndex >= 0) return current;
    current = current.parentElement;
  }
  return null;
}

function routeSignature(state: DefinitionJumpDeps["STATE"]): string {
  const { route } = state;
  const path = "path" in route ? (route.path ?? "") : "";
  const ref = "ref" in route ? (route.ref ?? "") : "";
  return [route.screen, path, ref, state.from, state.to].join("\0");
}

function defaultCaretFromPoint(
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = caretDocument.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = caretDocument.caretRangeFromPoint?.(x, y);
  return range
    ? { node: range.startContainer, offset: range.startOffset }
    : null;
}

function symbolInCell(
  deps: DefinitionJumpDeps,
  cell: HTMLElement,
  node: Node,
  nodeOffset: number,
): CellSymbol | null {
  const context = contextForCell(cell, deps.STATE);
  if (!context) return null;
  const offset = offsetInCell(cell, node, nodeOffset);
  const expanded = expandWordAt(cell.textContent ?? "", offset);
  const lang = definitionLangOf(deps.inferLang(context.path));
  if (!expanded || !isJumpableSymbol(expanded.word, lang)) return null;
  return { symbol: expanded.word, context, ...expanded };
}

function rangeInCell(
  cell: HTMLElement,
  start: number,
  end: number,
): Range | null {
  if (start < 0 || end <= start) return null;
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const nextOffset = offset + textNode.data.length;
    if (!startNode && start >= offset && start <= nextOffset) {
      startNode = textNode;
      startOffset = start - offset;
    }
    if (end >= offset && end <= nextOffset) {
      endNode = textNode;
      endOffset = end - offset;
      break;
    }
    offset = nextOffset;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function disabledMenuItem(label: string): ContextMenuItem {
  return { label, disabled: true, onSelect: () => undefined };
}

function matchMenuItem(
  match: GrepMatch,
  ref: string,
  symbol: string,
  openMatch: DefinitionJumpDeps["openMatch"],
): ContextMenuItem {
  return {
    label: `${match.path}:${match.line}`,
    title: match.preview.trim(),
    onSelect: () =>
      openMatch({ path: match.path, ref, line: match.line, hl: symbol }),
  };
}

function grepRequest(
  deps: DefinitionJumpDeps,
  options: {
    term: string;
    ref: string;
    regex: boolean;
    wholeWord: boolean;
    max: number;
  },
  signal: AbortSignal,
): Promise<GrepResponse> {
  const params = buildGrepRequestParams({
    term: options.term,
    ref: options.ref,
    regex: options.regex,
    caseSensitive: true,
    wholeWord: options.wholeWord,
    hideTests: false,
    max: options.max,
  });
  deps.appendScopeParams(params);
  return deps.trackLoad<GrepResponse>(
    fetch(`/_grep?${params.toString()}`, { signal }).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          await responseErrorMessage(
            response,
            "definition grep request failed",
          ),
        );
      }
      try {
        return (await response.json()) as GrepResponse;
      } catch (err) {
        throw errorWithCause(
          `definition grep response could not be parsed (HTTP ${response.status})`,
          err,
        );
      }
    }),
  );
}

function triggerForCell(
  deps: DefinitionJumpDeps,
  cell: HTMLElement,
  node: Node,
  nodeOffset: number,
  at: { x: number; y: number },
): SearchTrigger | null {
  const resolved = symbolInCell(deps, cell, node, nodeOffset);
  if (!resolved) return null;
  return {
    symbol: resolved.symbol,
    context: resolved.context,
    anchor: cell.closest<HTMLElement>("tr, [data-line]") ?? cell,
    at,
    focusReturn: focusReturnFor(cell),
  };
}

function openSearchMenu(
  trigger: SearchTrigger,
  items: ContextMenuItem[],
  preview?: {
    deps: DefinitionJumpDeps;
    matches: Array<GrepMatch | null>;
  },
): HTMLElement {
  if (!preview) {
    return showContextMenu(trigger.anchor, items, {
      at: trigger.at,
      focusReturn: trigger.focusReturn,
    });
  }

  const flyout = document.createElement("div");
  flyout.className = "gdp-definition-preview-flyout";
  flyout.hidden = true;
  flyout.setAttribute("aria-hidden", "true");
  document.body.appendChild(flyout);
  const codePreview = createCodePreview(flyout, {
    trackLoad: preview.deps.trackLoad,
    isAbortError: preview.deps.isAbortError,
    getLanguage: () => preview.deps.STATE.language,
    getSyntaxHighlight: preview.deps.getSyntaxHighlight,
    inferLang: preview.deps.inferLang,
    loadSourceShikiHighlighter: preview.deps.loadSourceShikiHighlighter,
    sourceShikiLines: preview.deps.sourceShikiLines,
  });
  let menu: HTMLElement | null = null;
  let pendingPosition = false;
  const positionFlyout = () => {
    if (!menu || flyout.hidden) return;
    pendingPosition = false;
    const menuRect = menu.getBoundingClientRect();
    const flyoutRect = flyout.getBoundingClientRect();
    const right = menuRect.right + 8;
    const left = menuRect.left - flyoutRect.width - 8;
    const fitsRight = right + flyoutRect.width <= window.innerWidth - 8;
    const maxLeft = Math.max(8, window.innerWidth - flyoutRect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - flyoutRect.height - 8);
    flyout.style.left = `${Math.max(8, Math.min(fitsRight ? right : left, maxLeft))}px`;
    flyout.style.top = `${Math.max(8, Math.min(menuRect.top, maxTop))}px`;
  };
  const highlight = (index: number) => {
    const match = preview.matches[index];
    if (!match) {
      codePreview.clear("");
      flyout.hidden = true;
      return;
    }
    flyout.hidden = false;
    codePreview.show({
      target: {
        path: match.path,
        ref: trigger.context.ref,
        line: match.line,
        column: match.column,
      },
      match: { text: trigger.symbol, caseSensitive: true },
    });
    if (menu) positionFlyout();
    else pendingPosition = true;
  };

  menu = showContextMenu(trigger.anchor, items, {
    at: trigger.at,
    focusReturn: trigger.focusReturn,
    onHighlight: highlight,
    onClose: () => {
      codePreview.dispose();
      flyout.remove();
    },
  });
  if (pendingPosition) positionFlyout();
  return menu;
}

function createDefinitionSearchRunner(
  deps: DefinitionJumpDeps,
): (trigger: SearchTrigger) => void {
  let generation = 0;
  let controller: AbortController | null = null;
  let menuTimer: number | null = null;

  function runDefinitionSearch(trigger: SearchTrigger): void {
    const myGeneration = ++generation;
    controller?.abort();
    const abort = new AbortController();
    controller = abort;
    if (menuTimer !== null) window.clearTimeout(menuTimer);
    closeContextMenu();

    const signature = routeSignature(deps.STATE);
    const text = definitionJumpText(deps.STATE.language);
    let ownMenu: HTMLElement | null = null;
    const timer = window.setTimeout(() => {
      if (
        myGeneration !== generation ||
        abort.signal.aborted ||
        routeSignature(deps.STATE) !== signature
      )
        return;
      ownMenu = openSearchMenu(trigger, [
        disabledMenuItem(text.searching(trigger.symbol)),
      ]);
      if (menuTimer === timer) menuTimer = null;
    }, 150);
    menuTimer = timer;

    const clearOwnTimer = () => {
      window.clearTimeout(timer);
      if (menuTimer === timer) menuTimer = null;
    };
    const closeOwnMenu = () => {
      if (ownMenu?.isConnected) closeContextMenu();
      ownMenu = null;
    };
    const canApply = () => {
      if (myGeneration !== generation || abort.signal.aborted) return false;
      if (routeSignature(deps.STATE) !== signature) {
        closeOwnMenu();
        return false;
      }
      return !ownMenu || ownMenu.isConnected;
    };

    void (async () => {
      try {
        const lang = definitionLangOf(deps.inferLang(trigger.context.path));
        const query = buildDefinitionQuery(lang, trigger.symbol);
        let response = await grepRequest(
          deps,
          {
            term: query.pattern,
            ref: trigger.context.ref,
            regex: true,
            wholeWord: false,
            max: 50,
          },
          abort.signal,
        );
        if (!canApply()) return;
        if (response.engine === "fallback") {
          response = await grepRequest(
            deps,
            {
              term: trigger.symbol,
              ref: trigger.context.ref,
              regex: false,
              wholeWord: true,
              max: 200,
            },
            abort.signal,
          );
          if (!canApply()) return;
        }

        const candidates = rankDefinitionMatches(
          response.matches,
          {
            symbol: trigger.symbol,
            currentPath: trigger.context.path,
            currentLine: trigger.context.line,
            lang,
          },
          query.classifiers,
        );
        if (candidates.length === 1) {
          closeOwnMenu();
          const match = candidates[0];
          deps.openMatch({
            path: match.path,
            ref: trigger.context.ref,
            line: match.line,
            hl: trigger.symbol,
          });
          return;
        }
        if (candidates.length > 1) {
          const visibleMatches = candidates.slice(0, 20);
          const visible = visibleMatches.map((match) =>
            matchMenuItem(
              match,
              trigger.context.ref,
              trigger.symbol,
              deps.openMatch,
            ),
          );
          const previewMatches: Array<GrepMatch | null> = [...visibleMatches];
          if (candidates.length > visible.length) {
            visible.push(
              disabledMenuItem(`+${candidates.length - visible.length}`),
            );
            previewMatches.push(null);
          }
          ownMenu = openSearchMenu(trigger, visible, {
            deps,
            matches: previewMatches,
          });
          return;
        }

        const references = await grepRequest(
          deps,
          {
            term: trigger.symbol,
            ref: trigger.context.ref,
            regex: false,
            wholeWord: true,
            max: 100,
          },
          abort.signal,
        );
        if (!canApply()) return;
        if (references.matches.length === 0) {
          ownMenu = openSearchMenu(trigger, [
            disabledMenuItem(text.noDefinition(trigger.symbol)),
          ]);
          return;
        }
        const items: ContextMenuItem[] = [
          disabledMenuItem(
            text.referencesHeader(
              references.matches.length,
              references.truncated,
            ),
          ),
          ...references.matches
            .slice(0, 10)
            .map((match) =>
              matchMenuItem(
                match,
                trigger.context.ref,
                trigger.symbol,
                deps.openMatch,
              ),
            ),
          { kind: "separator" },
          {
            label: text.openSearchPanel,
            onSelect: () => deps.openSearchSheet(trigger.symbol),
          },
        ];
        ownMenu = openSearchMenu(trigger, items, {
          deps,
          matches: [null, ...references.matches.slice(0, 10), null, null],
        });
      } catch (err) {
        if (deps.isAbortError(err) || abort.signal.aborted) {
          if (myGeneration === generation) closeOwnMenu();
          return;
        }
        if (!canApply()) return;
        console.error("Definition search failed", err);
        const message =
          err instanceof Error && err.message ? err.message : text.unknownError;
        ownMenu = openSearchMenu(trigger, [
          disabledMenuItem(text.searchFailed(message)),
        ]);
      } finally {
        clearOwnTimer();
        if (controller === abort) controller = null;
      }
    })();
  }

  return runDefinitionSearch;
}

export function createDefinitionJump(deps: DefinitionJumpDeps): {
  install(content: HTMLElement): void;
  triggerFromKeyboard(): boolean;
} {
  const installed = new WeakSet<HTMLElement>();
  const runDefinitionSearch = createDefinitionSearchRunner(deps);
  let globalHoverListenersInstalled = false;
  let metaPressed = false;
  let controlPressed = false;
  let hoverFrame: number | null = null;
  let hoverTarget: {
    cell: HTMLElement;
    x: number;
    y: number;
  } | null = null;
  let underline: HTMLElement | null = null;

  const modifierPressed = () => metaPressed || controlPressed;
  const cancelHoverFrame = () => {
    if (hoverFrame !== null) window.cancelAnimationFrame(hoverFrame);
    hoverFrame = null;
    hoverTarget = null;
  };
  const hideUnderline = () => {
    if (underline) underline.hidden = true;
  };
  const clearHover = () => {
    cancelHoverFrame();
    hideUnderline();
  };
  const syncModifierClass = () => {
    document.body.classList.toggle("gdp-def-mod", modifierPressed());
    if (!modifierPressed()) clearHover();
  };
  const showUnderline = (rect: DOMRect) => {
    if (
      !Number.isFinite(rect.left) ||
      !Number.isFinite(rect.top) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      hideUnderline();
      return;
    }
    if (!underline) {
      underline = document.createElement("div");
      underline.className = "gdp-def-underline";
      underline.setAttribute("aria-hidden", "true");
    }
    if (!underline.isConnected) document.body.appendChild(underline);
    underline.style.left = `${rect.left}px`;
    underline.style.top = `${rect.top}px`;
    underline.style.width = `${rect.width}px`;
    underline.style.height = `${rect.height}px`;
    underline.hidden = false;
  };
  const scheduleUnderline = (cell: HTMLElement, x: number, y: number) => {
    hoverTarget = { cell, x, y };
    if (hoverFrame !== null) return;
    hoverFrame = window.requestAnimationFrame(() => {
      hoverFrame = null;
      const target = hoverTarget;
      hoverTarget = null;
      if (!modifierPressed() || !target?.cell.isConnected) {
        hideUnderline();
        return;
      }
      const caret = (deps.caretFromPoint ?? defaultCaretFromPoint)(
        target.x,
        target.y,
      );
      if (!caret) {
        hideUnderline();
        return;
      }
      const resolved = symbolInCell(
        deps,
        target.cell,
        caret.node,
        caret.offset,
      );
      const range = resolved
        ? rangeInCell(target.cell, resolved.start, resolved.end)
        : null;
      if (!range) {
        hideUnderline();
        return;
      }
      showUnderline(range.getBoundingClientRect());
    });
  };

  function installGlobalHoverListeners(): void {
    if (globalHoverListenersInstalled) return;
    globalHoverListenersInstalled = true;
    window.addEventListener("keydown", (event) => {
      if (event.key === "Meta") metaPressed = true;
      else if (event.key === "Control") controlPressed = true;
      else return;
      syncModifierClass();
    });
    window.addEventListener("keyup", (event) => {
      if (event.key === "Meta") metaPressed = false;
      else if (event.key === "Control") controlPressed = false;
      else return;
      syncModifierClass();
    });
    window.addEventListener("blur", () => {
      metaPressed = false;
      controlPressed = false;
      syncModifierClass();
    });
    window.addEventListener("scroll", clearHover, true);
  }

  function triggerFromKeyboard(): boolean {
    const selection = window.getSelection();
    if (!selection?.focusNode) return false;
    const focusCell = cellFromNode(selection.focusNode);
    if (!focusCell) return false;
    const rect =
      focusCell
        .closest<HTMLElement>("tr, [data-line]")
        ?.getBoundingClientRect() ?? focusCell.getBoundingClientRect();
    let trigger: SearchTrigger | null = null;
    if (selection.isCollapsed) {
      trigger = triggerForCell(
        deps,
        focusCell,
        selection.focusNode,
        selection.focusOffset,
        { x: rect.left, y: rect.bottom + 4 },
      );
    } else {
      const anchorCell = cellFromNode(selection.anchorNode);
      const symbol = selection.toString().trim();
      const context = contextForCell(focusCell, deps.STATE);
      const lang = context
        ? definitionLangOf(deps.inferLang(context.path))
        : null;
      if (
        anchorCell === focusCell &&
        context &&
        Array.from(symbol).every((char) => WORD_CHAR_RE.test(char)) &&
        isJumpableSymbol(symbol, lang)
      ) {
        trigger = {
          symbol,
          context,
          anchor:
            focusCell.closest<HTMLElement>("tr, [data-line]") ?? focusCell,
          at: { x: rect.left, y: rect.bottom + 4 },
          focusReturn: focusReturnFor(focusCell),
        };
      }
    }
    if (!trigger) return false;
    runDefinitionSearch(trigger);
    return true;
  }

  return {
    install(content) {
      if (installed.has(content)) return;
      installed.add(content);
      installGlobalHoverListeners();
      content.addEventListener("mousemove", (event) => {
        if (!modifierPressed()) return;
        const cell = cellFromNode(event.target as Node | null);
        if (!cell) {
          clearHover();
          return;
        }
        scheduleUnderline(cell, event.clientX, event.clientY);
      });
      content.addEventListener("click", (event) => {
        if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey)
          return;
        const cell = cellFromNode(event.target as Node | null);
        if (!cell) return;
        // macOS turns Control+click into a context-menu gesture in practice;
        // Meta+click remains the reliable browser trigger there.
        const caret = (deps.caretFromPoint ?? defaultCaretFromPoint)(
          event.clientX,
          event.clientY,
        );
        if (!caret) return;
        const trigger = triggerForCell(deps, cell, caret.node, caret.offset, {
          x: event.clientX,
          y: event.clientY,
        });
        if (!trigger) return;
        event.preventDefault();
        runDefinitionSearch(trigger);
      });
    },
    triggerFromKeyboard,
  };
}
