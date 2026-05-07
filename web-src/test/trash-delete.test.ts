import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sourceFixture } from "./source-fixture";

const app = sourceFixture(readFileSync("web-src/app.ts", "utf8"));
const server = sourceFixture(readFileSync("web-src/server/preview.ts", "utf8"));
const style = sourceFixture(readFileSync("web/style.css", "utf8"));

describe("move to trash endpoint", () => {
  test("server exposes a guarded localhost-only trash endpoint", () => {
    expect(
      server.includes(
        'if (url.pathname === "/_trash_path") return handleTrashPath(req)',
      ),
    ).toBe(true);
    expect(
      server.includes("async function handleTrashPath(req: Request)"),
    ).toBe(true);
    expect(
      server.includes(
        "if (!sideEffectRequestAllowed(req)) return text('forbidden', 403)",
      ),
    ).toBe(true);
    expect(
      server.includes(
        "if (!safeRepoPath(path)) return text('invalid path', 400)",
      ),
    ).toBe(true);
    expect(
      server.includes(
        'if (isGitInternalPath(path)) return text("forbidden", 403)',
      ),
    ).toBe(true);
    expect(
      server.includes("const originalFullPath = safeWorktreePath(path)"),
    ).toBe(true);
    expect(server.includes("movePathToTrash(worktreePath(path))")).toBe(true);
    expect(
      server.includes(
        'if (url.pathname === "/_restore_trash") return handleRestoreTrash(req)',
      ),
    ).toBe(true);
  });

  test("server moves files to OS trash instead of deleting directly", () => {
    expect(server.includes("function movePathToTrash")).toBe(true);
    expect(server.includes("function moveMacPathIntoTrash")).toBe(true);
    expect(server.includes("renameSync(path, target)")).toBe(true);
    expect(server.includes("process.platform === 'darwin'")).toBe(true);
    expect(server.includes("process.platform === 'win32'")).toBe(true);
    expect(server.includes("SHFileOperationW")).toBe(true);
    expect(server.includes("FOF_ALLOWUNDO")).toBe(true);
    expect(server.includes("function windowsRestoreTrashScript")).toBe(true);
    expect(server.includes("$bin = $shell.Namespace(10);")).toBe(true);
    expect(server.includes("FOF_NOERRORUI")).toBe(true);
    expect(server.includes("FOF_SILENT")).toBe(true);
    expect(server.includes("timeout: 60000")).toBe(true);
    expect(server.includes("rmSync(")).toBe(false);
  });

  test("trash actions register a generic undo action", () => {
    expect(server.includes("function makeUndoId(): string")).toBe(true);
    expect(server.includes("function restoreTrashPath(")).toBe(true);
    expect(
      server.includes("async function handleRestoreTrash(req: Request)"),
    ).toBe(true);
    expect(server.includes("original_path: path")).toBe(true);
    expect(server.includes("trashPath: moved.trashPath")).toBe(true);
    expect(app.includes("const UNDO_STACK: UndoActionResponse[] = []")).toBe(
      true,
    );
    expect(app.includes("async function undoLastAction()")).toBe(true);
    expect(app.includes('fetch("/_restore_trash"')).toBe(true);
    expect(app.includes("JSON.stringify(action.payload)")).toBe(true);
    expect(app.includes('e.key.toLowerCase() === "z"')).toBe(true);
    expect(server.includes("const undoActions: UndoAction[] = []")).toBe(false);
    expect(server.includes('if (url.pathname === "/_undo")')).toBe(false);
  });
});

describe("repository context menu delete action", () => {
  test("repository rows expose a right-click trash action for worktree paths", () => {
    expect(app.includes("function showRepoContextMenu")).toBe(true);
    expect(app.includes("row.addEventListener('contextmenu'")).toBe(true);
    expect(app.includes("Move to Trash")).toBe(true);
    expect(app.includes("fetch('/_trash_path'")).toBe(true);
    expect(app.includes("function confirmMoveToTrash")).toBe(true);
    expect(app.includes("function requestMoveToTrash")).toBe(true);
    expect(app.includes('dialog.setAttribute("aria-labelledby"')).toBe(true);
    expect(app.includes('dialog.setAttribute("aria-describedby"')).toBe(true);
    expect(app.includes('if (event.key !== "Tab") return')).toBe(true);
    expect(app.includes("function canTrashWorktreeRef(ref: string)")).toBe(
      true,
    );
  });

  test("repository file detail and sidebar expose the same trash action", () => {
    expect(app.includes("function createMoveToTrashButton")).toBe(true);
    expect(
      app.includes("className = 'gdp-btn gdp-btn-sm gdp-trash-path'"),
    ).toBe(true);
    expect(app.includes("function handleSidebarContextMenu")).toBe(true);
    expect(app.includes("function sidebarTrashEntryFromEvent")).toBe(true);
    expect(app.includes("row.dataset.childrenOmittedReason")).toBe(true);
    expect(app.includes("markActive(entry.path)")).toBe(true);
    expect(
      app.includes(
        "$('#filelist').addEventListener('contextmenu', handleSidebarContextMenu)",
      ),
    ).toBe(true);
    expect(app.includes("wireSidebarTrashContextMenu")).toBe(false);
    expect(app.includes("setRoute(repoRoute(repoTarget, parent))")).toBe(true);
    expect(app.includes("getBoundingClientRect()")).toBe(true);
    expect(app.includes('closest<HTMLElement>("li, .gdp-repo-row")')).toBe(
      true,
    );
  });

  test("context menu has visible styling", () => {
    expect(style.includes(".gdp-context-menu")).toBe(true);
    expect(style.includes(".gdp-context-menu button")).toBe(true);
    expect(style.includes(".gdp-context-menu .danger")).toBe(true);
    expect(style.includes(".gdp-file-detail-header .gdp-trash-path")).toBe(
      true,
    );
  });
});
