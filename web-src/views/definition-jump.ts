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
import type { DiffCardElement, GrepMatch, GrepResponse } from "../core/types";
import { expandWordAt, WORD_CHAR_RE } from "../core/word-boundary";
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
    paths?: string[];
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
  for (const path of options.paths ?? []) params.append("path", path);
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
  const context = contextForCell(cell, deps.STATE);
  if (!context) return null;
  const offset = offsetInCell(cell, node, nodeOffset);
  const expanded = expandWordAt(cell.textContent ?? "", offset);
  const lang = definitionLangOf(deps.inferLang(context.path));
  if (!expanded || !isJumpableSymbol(expanded.word, lang)) return null;
  return {
    symbol: expanded.word,
    context,
    anchor: cell.closest<HTMLElement>("tr, [data-line]") ?? cell,
    at,
    focusReturn: focusReturnFor(cell),
  };
}

function openSearchMenu(
  trigger: SearchTrigger,
  items: ContextMenuItem[],
): HTMLElement {
  return showContextMenu(trigger.anchor, items, {
    at: trigger.at,
    focusReturn: trigger.focusReturn,
  });
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
            paths: query.globs,
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
              paths: query.globs,
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
          const visible = candidates
            .slice(0, 20)
            .map((match) =>
              matchMenuItem(
                match,
                trigger.context.ref,
                trigger.symbol,
                deps.openMatch,
              ),
            );
          if (candidates.length > visible.length) {
            visible.push(
              disabledMenuItem(`+${candidates.length - visible.length}`),
            );
          }
          ownMenu = openSearchMenu(trigger, visible);
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
        ownMenu = openSearchMenu(trigger, items);
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
