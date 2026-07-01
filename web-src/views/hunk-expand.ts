// Hunk expand subsystem (GitHub-style ↕ controls at hunk separators).
//
// Extracted from app.ts: parses @@ headers, attaches per-gap expand stacks
// (20-line steps via /file_range) plus one-shot full-gap expansion used by
// "expand all context", and trailing expansion below the last hunk.

import { GdpExpandLogic } from "../core/expand-logic";
import type {
  DiffCardElement,
  FileMeta,
  FileRangeResponse,
} from "../core/types";

type HunkInfo = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
};
type HunkSibling = {
  tr: HTMLTableRowElement;
  info?: Element | null;
  hunk?: HunkInfo | null;
  sideIndex?: number;
};
type HunkRow = {
  tr: HTMLTableRowElement;
  info: Element | null;
  hunk: HunkInfo;
  siblings: HunkSibling[];
  prevHunkEndNew: number;
  prevHunkEndOld: number;
  topExpandedStart?: number;
  bottomExpandedEnd?: number;
};
export type ExpandStackElement = HTMLElement & {
  _gdpExpandFully?: () => Promise<void>;
};

export type HunkExpandDeps = {
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  getServerGeneration(): number;
  /** "to" ref of the current diff range ("worktree" when unset). */
  getToRef(): string;
  highlightInsertedSpans(card: Element, file: FileMeta): void;
};

export function createHunkExpand(deps: HunkExpandDeps) {
  // ---------- Hunk expand (mimics GitHub's ↕ at hunk separators) ----------
  // Parse "@@ -OLD,COUNT +NEW,COUNT @@" out of a row's text.
  // The text may be wrapped in leading/trailing whitespace from diff2html,
  // and there's also no requirement that @@ start at column 0.
  function parseHunkHeader(text: string | null): HunkInfo | null {
    const m = (text || "").match(
      /@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/,
    );
    if (!m) return null;
    return {
      oldStart: +m[1],
      oldCount: m[2] ? +m[2] : 1,
      newStart: +m[3],
      newCount: m[4] ? +m[4] : 1,
    };
  }

  // After the row's content lines, what's the next-new-line number?
  function nextNewLine(hunk: HunkInfo): number {
    return hunk.newStart + hunk.newCount;
  }
  function nextOldLine(hunk: HunkInfo): number {
    return hunk.oldStart + hunk.oldCount;
  }

  function setupHunkExpand(card: DiffCardElement, file: FileMeta) {
    if (file.binary) return;
    if (file.media_kind) return;
    // Collect hunk-info rows. In line-by-line there's one table per file,
    // each .d2h-info row carries the @@ text. In side-by-side there are TWO
    // sibling tables (left = old, right = new); each row is duplicated. We
    // group them by their position so a single click expands BOTH sides.
    const infoRows: HunkRow[] = [];
    const tables = card.querySelectorAll("table.d2h-diff-table");
    if (tables.length === 0) return;

    // Per-table: collect every info row in DOM order. In split view both
    // tables emit a row at the same DOM index for each hunk; only one side
    // tends to carry the parseable @@ text but both rows must be hidden /
    // updated together. Hold the raw row + info td and try parsing later.
    const perTable: HunkSibling[][] = [];
    tables.forEach((tbl) => {
      const arr: HunkSibling[] = [];
      tbl.querySelectorAll("tr").forEach((tr) => {
        const info = tr.querySelector(
          "td.d2h-info:not(.d2h-code-linenumber):not(.d2h-code-side-linenumber)",
        );
        if (!info) return;
        const txt = (info.textContent || "").trim();
        arr.push({
          tr: tr as HTMLTableRowElement,
          info,
          hunk: parseHunkHeader(txt),
        });
      });
      perTable.push(arr);
    });

    // Pair hunk rows across left/right tables by their visible top position
    // rather than array index. Index pairing breaks when one side has an
    // extra placeholder row or when parse counts differ.
    const base =
      perTable.find((arr) => arr.some((x) => x.hunk)) || perTable[0] || [];
    // Track rows already paired so we don't re-pair the same physical row
    // twice when row-height drift makes another base "see" the same
    // candidate as its closest neighbour.
    const usedTrs = new WeakSet();
    base.forEach((baseItem) => {
      const top = baseItem.tr.getBoundingClientRect().top;
      const group = perTable
        .map((arr, tableIndex) => {
          let best: HunkSibling | null = null,
            bestD = Infinity;
          for (const item of arr) {
            if (usedTrs.has(item.tr)) continue;
            const d = Math.abs(item.tr.getBoundingClientRect().top - top);
            if (d < bestD) {
              best = item;
              bestD = d;
            }
          }
          if (!best || bestD >= 12) return null;
          usedTrs.add(best.tr);
          // Carry the original table index so insertContextRows can pick the
          // right side's line-num (left=old, right=new). Filter+filter() would
          // otherwise renumber and corrupt that mapping.
          return Object.assign({ sideIndex: tableIndex }, best);
        })
        .filter(Boolean);
      if (!group.length) return;
      const parsed = group.find((g) => g.hunk) || group[0];
      if (!parsed.hunk) return;
      group.forEach((g) => {
        g.tr.classList.add("gdp-hunk-row");
      });
      infoRows.push({
        tr: parsed.tr,
        info: parsed.info,
        hunk: parsed.hunk,
        siblings: group,
        prevHunkEndNew: 0,
        prevHunkEndOld: 0,
      });
    });
    // Compute prev hunk's end so we know how big the gap above is
    for (let i = 1; i < infoRows.length; i++) {
      const prev = infoRows[i - 1].hunk;
      infoRows[i].prevHunkEndNew = nextNewLine(prev);
      infoRows[i].prevHunkEndOld = nextOldLine(prev);
    }

    const ref = deps.getToRef();
    const refPath = encodeURIComponent(file.path);

    for (const item of infoRows) {
      attachExpandControls(item, file, ref, refPath);
    }
    const trailingIndex = GdpExpandLogic.trailingExpandTargetIndex(
      infoRows.length,
    );
    if (trailingIndex != null) {
      probeAndAttachTrailingExpandControls(
        infoRows[trailingIndex],
        file,
        ref,
        refPath,
      );
    }
  }

  // Build the GitHub-style ↑ / ↓ stack inside the line-number column of a
  // hunk header row. For split view, the controls are mirrored on each
  // side panel's hunk row, but a single click triggers an insert on both.
  function attachExpandControls(
    item: HunkRow,
    file: FileMeta,
    ref: string,
    refPath: string,
  ) {
    const { hunk, prevHunkEndNew, prevHunkEndOld } = item;
    const fullGapStart = Math.max(1, prevHunkEndNew);
    const fullGapEnd = hunk.newStart - 1;
    if (fullGapStart > fullGapEnd) {
      // Hide @@ when there are no preceding lines to expand (file starts
      // at line 1 / brand new file).
      for (const sib of item.siblings || [{ tr: item.tr }]) {
        sib.tr.style.display = "none";
      }
      return;
    }
    // Per-gap state: how far each side has been expanded so far.
    // top side fills the high end (just before this hunk), bottom side
    // fills the low end (just after the previous hunk).
    // top:    inclusive lowest line filled from the top (initially first
    //         line of THIS hunk; ↑ clicks shrink it).
    // bottom: inclusive highest line filled from the bottom (initially the
    //         last line of the PREVIOUS hunk = prevHunkEndNew - 1; ↓ clicks
    //         grow it). Off-by-one here used to leak line `prevHunkEndNew`
    //         out of the gap and into the "fully expanded" path, hiding the
    //         @@ row before the first gap line was ever fetched.
    const L = GdpExpandLogic;
    if (item.topExpandedStart == null || item.bottomExpandedEnd == null) {
      const init = L.initExpandState(prevHunkEndNew, hunk.newStart);
      item.topExpandedStart = init.topExpandedStart;
      item.bottomExpandedEnd = init.bottomExpandedEnd;
    }
    const gap = L.remainingGap(
      {
        topExpandedStart: item.topExpandedStart,
        bottomExpandedEnd: item.bottomExpandedEnd,
      },
      prevHunkEndNew,
    );
    if (!gap) {
      for (const sib of item.siblings || [{ tr: item.tr }]) {
        sib.tr.style.display = "none";
      }
      return;
    }
    const remainingStart = gap.start;
    const remainingEnd = gap.end;

    const setBusy = (busy: boolean) => {
      for (const sib of item.siblings || [{ tr: item.tr }]) {
        sib.tr
          .querySelectorAll<HTMLButtonElement>(".gdp-expand-btn")
          .forEach((b) => {
            b.disabled = busy;
          });
      }
    };

    const fetchAndInsert = (
      start: number,
      end: number,
      dir: "before" | "after",
    ): Promise<void> => {
      if (start < 1) start = 1;
      if (end < start) return Promise.resolve();
      setBusy(true);
      const url =
        "/file_range?path=" +
        refPath +
        "&ref=" +
        encodeURIComponent(ref) +
        "&start=" +
        start +
        "&end=" +
        end;
      return deps
        .trackLoad<{ lines?: string[] }>(fetch(url).then((r) => r.json()))
        .then((data) => {
          if (!data?.lines) {
            setBusy(false);
            return;
          }
          const oldStartForGap = prevHunkEndOld + (start - prevHunkEndNew);
          const card = item.tr.closest(".d2h-file-wrapper");
          const sibs = item.siblings || [{ tr: item.tr, sideIndex: 0 }];
          sibs.forEach((sib) => {
            insertContextRows(
              sib.tr,
              data.lines,
              start,
              oldStartForGap,
              dir,
              sib.sideIndex || 0,
            );
          });
          if (card) deps.highlightInsertedSpans(card, file);
          // dir='after'  → filled HIGH end (rows go below @@) → topExpandedStart shrinks
          // dir='before' → filled LOW end (rows go above @@) → bottomExpandedEnd grows
          if (dir === "after") item.topExpandedStart = start;
          else item.bottomExpandedEnd = end;
          // Replace expand stacks with refreshed ones (or hide).
          for (const sib of item.siblings || [{ tr: item.tr }]) {
            const ln = sib.tr.querySelector(
              ".d2h-code-linenumber.d2h-info, .d2h-code-side-linenumber.d2h-info",
            );
            const old = ln?.querySelector(".gdp-expand-stack");
            if (old) old.remove();
          }
          attachExpandControls(item, file, ref, refPath);
        })
        .catch(() => {
          setBusy(false);
        });
    };

    const STEP = 20;
    const remainingSize = remainingEnd - remainingStart + 1;
    const isFirst = prevHunkEndNew === 0;
    const buildStack = () => {
      // GitHub semantics: ↑ button shows more lines ABOVE @@ in the file
      // (closer to the previous hunk = lower line numbers). ↓ shows more
      // lines BELOW @@ (closer to this hunk = higher line numbers).
      // ↑ : pull lines just after the previous hunk (low end of gap).
      //     Only meaningful when there IS a previous hunk; otherwise it's
      //     equivalent to ↓ and we hide it to match github.com which only
      //     shows ↑ at the FIRST hunk and ↓ at the LAST hunk respectively.
      const buttons: ExpandButtonSpec[] = [];
      if (isFirst) {
        // First hunk: only one button. Behaviour matches a mid-hunk's ↓
        // (pull high end of gap, insert below @@) but the icon shows ↑
        // because conceptually the lines we expand into are ABOVE this
        // hunk in the file. Repeated clicks walk further up the file.
        buttons.push({
          direction: "up",
          title: `Show ${Math.min(STEP, remainingSize)} more lines`,
          onClick: () =>
            fetchAndInsert(
              Math.max(remainingStart, remainingEnd - STEP + 1),
              remainingEnd,
              "after",
            ),
        });
      } else {
        // Mid hunks: ↑ pulls low end (toward prev hunk, above @@),
        //            ↓ pulls high end (toward this hunk, below @@).
        buttons.push({
          direction: "up",
          title: `Show ${Math.min(STEP, remainingSize)} more lines`,
          onClick: () =>
            fetchAndInsert(
              remainingStart,
              Math.min(remainingEnd, remainingStart + STEP - 1),
              "before",
            ),
        });
        buttons.push({
          direction: "down",
          title: `Show ${Math.min(STEP, remainingSize)} more lines`,
          onClick: () =>
            fetchAndInsert(
              Math.max(remainingStart, remainingEnd - STEP + 1),
              remainingEnd,
              "after",
            ),
        });
      }
      return createExpandStack(buttons);
    };

    // One-shot full-gap expansion for "expand all context": fetches the
    // whole remaining gap in a single request instead of 20-line clicks.
    // Sibling stacks (split view) share the guard so the gap loads once.
    let expandFullyStarted = false;
    const expandFully = (): Promise<void> => {
      if (expandFullyStarted) return Promise.resolve();
      expandFullyStarted = true;
      return fetchAndInsert(remainingStart, remainingEnd, "after");
    };

    const siblings = item.siblings || [{ tr: item.tr }];
    siblings.forEach((sib) => {
      const ln = sib.tr.querySelector(
        ".d2h-code-linenumber.d2h-info, .d2h-code-side-linenumber.d2h-info",
      );
      if (ln && !ln.querySelector(".gdp-expand-stack")) {
        const stack = buildStack() as ExpandStackElement;
        stack._gdpExpandFully = expandFully;
        ln.appendChild(stack);
      }
    });
    const firstSib = siblings[0];
    if (firstSib) {
      syncExpandRowHeights(
        siblings.map((sib) => sib.tr),
        firstSib.tr,
      );
    }
  }

  type ExpandButtonSpec = {
    direction: "up" | "down";
    title: string;
    onClick: () => void;
  };

  const EXPAND_ICON_PATHS = {
    up: "M8 3.5 3.75 7.75l1.06 1.06L7.25 6.37V13h1.5V6.37l2.44 2.44 1.06-1.06L8 3.5z",
    down: "M8 12.5 12.25 8.25l-1.06-1.06L8.75 9.63V3h-1.5v6.63L4.81 7.19 3.75 8.25 8 12.5z",
  };

  function createExpandStack(buttons: ExpandButtonSpec[]) {
    const stack = document.createElement("div");
    stack.className = "gdp-expand-stack";
    buttons.forEach((spec) => {
      const button = document.createElement("button");
      button.className = "gdp-expand-btn";
      button.title = spec.title;
      button.setAttribute("aria-label", spec.title);
      button.innerHTML =
        '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
        '<path fill="currentColor" d="' +
        EXPAND_ICON_PATHS[spec.direction] +
        '"/></svg>';
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        if (button.disabled) return;
        spec.onClick();
      });
      stack.appendChild(button);
    });
    return stack;
  }

  function syncExpandRowHeights(
    rows: HTMLTableRowElement[],
    stackRow: HTMLTableRowElement,
  ) {
    const syncHeight = () => {
      const stack = stackRow.querySelector(".gdp-expand-stack");
      const targetH = stack
        ? Math.max(20, stack.getBoundingClientRect().height)
        : 20;
      rows.forEach((row) => {
        row.style.setProperty("height", `${targetH}px`, "important");
      });
    };
    requestAnimationFrame(syncHeight);
    setTimeout(syncHeight, 100);
  }

  function attachTrailingExpandControls(
    item: HunkRow,
    file: FileMeta,
    ref: string,
    refPath: string,
  ) {
    const hasTrailingRow = (item.siblings || []).some(
      (sib) =>
        !!sib.tr.parentElement?.querySelector(".gdp-trailing-expand-row"),
    );
    if (hasTrailingRow) return;
    const STEP = 20;
    let nextNewStart = nextNewLine(item.hunk);
    let nextOldStart = nextOldLine(item.hunk);
    const rows = (item.siblings || [{ tr: item.tr, sideIndex: 0 }])
      .map((sib) => {
        const tbody = sib.tr.parentElement;
        if (!tbody) return null;
        const isSplit = !!sib.tr.querySelector("td.d2h-code-side-linenumber");
        const tr = document.createElement("tr");
        tr.className = "gdp-hunk-row gdp-trailing-expand-row";
        const ln = document.createElement("td");
        ln.className = isSplit
          ? "d2h-code-side-linenumber d2h-info"
          : "d2h-code-linenumber d2h-info";
        const info = document.createElement("td");
        info.className = "d2h-info";
        const spacer = document.createElement("div");
        spacer.className = isSplit ? "d2h-code-side-line" : "d2h-code-line";
        info.appendChild(spacer);
        tr.appendChild(ln);
        tr.appendChild(info);
        tbody.appendChild(tr);
        return { tr, ln, sideIndex: sib.sideIndex || 0 };
      })
      .filter(Boolean);
    if (!rows.length) return;

    const setBusy = (busy: boolean) => {
      rows.forEach((row) => {
        row.ln
          .querySelectorAll<HTMLButtonElement>(".gdp-expand-btn")
          .forEach((btn) => {
            btn.disabled = busy;
          });
      });
    };
    const fetchAndInsert = (step = STEP): Promise<void> => {
      const range = GdpExpandLogic.trailingClickRange(nextNewStart, step);
      const myGen = deps.getServerGeneration();
      setBusy(true);
      const url =
        "/file_range?path=" +
        refPath +
        "&ref=" +
        encodeURIComponent(ref) +
        "&start=" +
        range.start +
        "&end=" +
        range.end;
      return deps
        .trackLoad<FileRangeResponse>(fetch(url).then((r) => r.json()))
        .then((data) => {
          if (
            myGen !== deps.getServerGeneration() ||
            (data.generation && data.generation !== deps.getServerGeneration())
          ) {
            setBusy(false);
            return;
          }
          if (!item.tr.isConnected) return;
          const lines = data?.lines || [];
          if (!lines.length) {
            rows.forEach((row) => {
              row.tr.remove();
            });
            return;
          }
          const card = item.tr.closest(".d2h-file-wrapper");
          rows.forEach((row) => {
            insertContextRows(
              row.tr,
              lines,
              range.start,
              nextOldStart,
              "before",
              row.sideIndex,
            );
          });
          const next = GdpExpandLogic.applyTrailingResult(
            { newStart: nextNewStart, oldStart: nextOldStart },
            lines.length,
            step,
          );
          nextNewStart = next.newStart;
          nextOldStart = next.oldStart;
          if (card) deps.highlightInsertedSpans(card, file);
          if (next.eof) {
            rows.forEach((row) => {
              row.tr.remove();
            });
            return;
          }
          setBusy(false);
        })
        .catch(() => {
          setBusy(false);
        });
    };
    // One-shot expansion to EOF for "expand all context": a single large
    // range request instead of repeated 20-line clicks.
    let expandFullyStarted = false;
    const expandFully = (): Promise<void> => {
      if (expandFullyStarted) return Promise.resolve();
      expandFullyStarted = true;
      return fetchAndInsert(100000);
    };
    rows.forEach((row) => {
      const stack = createExpandStack([
        {
          direction: "down",
          title: "Show more lines",
          onClick: () => void fetchAndInsert(),
        },
      ]) as ExpandStackElement;
      stack._gdpExpandFully = expandFully;
      row.ln.appendChild(stack);
    });
    syncExpandRowHeights(
      rows.map((row) => row.tr),
      rows[0].tr,
    );
  }

  function probeAndAttachTrailingExpandControls(
    item: HunkRow,
    file: FileMeta,
    ref: string,
    refPath: string,
  ) {
    const start = nextNewLine(item.hunk);
    const myGen = deps.getServerGeneration();
    const url =
      "/file_range?path=" +
      refPath +
      "&ref=" +
      encodeURIComponent(ref) +
      "&start=" +
      start +
      "&end=" +
      start;
    deps
      .trackLoad<FileRangeResponse>(fetch(url).then((r) => r.json()))
      .then((data) => {
        if (myGen !== deps.getServerGeneration()) return;
        if (data.generation && data.generation !== deps.getServerGeneration())
          return;
        if (!item.tr.isConnected) return;
        const hasTrailingRow = (item.siblings || []).some(
          (sib) =>
            !!sib.tr.parentElement?.querySelector(".gdp-trailing-expand-row"),
        );
        if (hasTrailingRow) return;
        if (
          !GdpExpandLogic.shouldAttachTrailingExpand(data?.lines?.length || 0)
        )
          return;
        attachTrailingExpandControls(item, file, ref, refPath);
      })
      .catch(() => undefined);
  }

  // Insert context rows around the `@@` info row.
  //   dir='before' (↑, low line nums after prev hunk): insert ABOVE @@.
  //   dir='after'  (↓, high line nums before this hunk): insert BELOW @@.
  // Detects unified vs split by the existing line-num td. For split,
  // sideIndex chooses old (0) vs new (1) numbering.
  function insertContextRows(
    targetTr: HTMLTableRowElement,
    lines: string[],
    newStart: number,
    oldStart: number,
    dir: "before" | "after",
    sideIndex: number,
  ) {
    const tbody = targetTr.parentElement;
    if (!tbody) return;
    const anchor = dir === "after" ? targetTr.nextElementSibling : targetTr;
    const isSplit = !!targetTr.querySelector("td.d2h-code-side-linenumber");
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lines.length; i++) {
      const tr = document.createElement("tr");
      tr.className = "gdp-inserted-ctx";
      if (dir) tr.dataset.gdpDir = dir;
      let lnHtml: string;
      if (isSplit) {
        const num = sideIndex === 0 ? oldStart + i : newStart + i;
        lnHtml = `<td class="d2h-code-side-linenumber d2h-cntx">${num}</td>`;
      } else {
        lnHtml =
          '<td class="d2h-code-linenumber d2h-cntx">' +
          '<div class="line-num1">' +
          (oldStart + i) +
          "</div>" +
          '<div class="line-num2">' +
          (newStart + i) +
          "</div>" +
          "</td>";
      }
      tr.innerHTML =
        lnHtml +
        '<td class="d2h-cntx">' +
        '<div class="' +
        (isSplit ? "d2h-code-side-line" : "d2h-code-line") +
        '">' +
        // diff2html's own context rows render the prefix/content spans with a
        // newline+indent between them, which collapses to one visible space.
        // Match that whitespace exactly so inserted rows align with native ones.
        '<span class="d2h-code-line-prefix">&nbsp;</span> ' +
        '<span class="d2h-code-line-ctn">' +
        escapeHtmlText(lines[i]) +
        "</span>" +
        "</div>" +
        "</td>";
      frag.appendChild(tr);
    }
    tbody.insertBefore(frag, anchor);
  }

  function escapeHtmlText(s: unknown): string {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  return { setupHunkExpand };
}
