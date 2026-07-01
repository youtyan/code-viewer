import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isGitInternalPath } from "../server/git";
import { safeWorktreePath } from "../server/search-service";
import { runGit as git } from "./_git-fixture";
import { sourceFixture } from "./source-fixture";

const app = sourceFixture(
  readFileSync("web-src/app.ts", "utf8") +
    readFileSync("web-src/views/source-view.ts", "utf8") +
    readFileSync("web-src/views/repo-view.ts", "utf8") +
    readFileSync("web-src/views/sidebar.ts", "utf8") +
    readFileSync("web-src/views/search-palette-ui.ts", "utf8") +
    readFileSync("web-src/views/diff-view.ts", "utf8"),
);
const html = readFileSync("web/index.html", "utf8");
const server = sourceFixture(readFileSync("web-src/server/preview.ts", "utf8"));
const style = sourceFixture(readFileSync("web/style.css", "utf8"));

describe("open path in OS action", () => {
  test("server exposes a localhost-only POST endpoint with bounded JSON input", () => {
    expect(
      server.includes(
        'if (url.pathname === "/_open_path") return handleOpenPath(req)',
      ),
    ).toBe(true);
    expect(
      server.includes(
        "if (req.method !== 'POST') return text('method not allowed', 405)",
      ),
    ).toBe(true);
    expect(
      server.includes("function sideEffectRequestAllowed(req: Request)"),
    ).toBe(true);
    expect(
      server.includes(
        "if (!sideEffectRequestAllowed(req)) return text('forbidden', 403)",
      ),
    ).toBe(true);
    expect(server.includes("return text('unsupported media type', 415)")).toBe(
      true,
    );
    expect(
      server.includes(
        'if (length > 1024) return text("payload too large", 413)',
      ),
    ).toBe(true);
    expect(
      server.includes('if (kind !== "directory" && kind !== "file-parent")'),
    ).toBe(true);
    expect(server.includes('return text("invalid kind", 400)')).toBe(true);
    expect(
      server.includes(
        'if (kind === "file-parent" && !path) return text("invalid path", 400)',
      ),
    ).toBe(true);
  });

  test("server validates repo-relative paths before spawning the OS opener", () => {
    expect(
      server.includes(
        "function safeOpenWorktreePath(path: string): string | null",
      ),
    ).toBe(true);
    expect(server.includes("spawnDetached(cmd)")).toBe(true);
  });

  test("server forbids browsing Git internal tree paths", () => {
    // Behaviour-level guard: git.ts exports isGitInternalPath and preview.ts
    // uses it both at /_open_path entry and inside safeWorktreePath. The
    // predicate must return true for `.git/*` paths and false for normal
    // worktree paths. UI/Test Discipline: don't grep for the implementation
    // string — assert the contract on the actual function.
    expect(isGitInternalPath(".git/config")).toBe(true);
    expect(isGitInternalPath("nested/.git/HEAD")).toBe(true);
    expect(isGitInternalPath("src/sample.ts")).toBe(false);
    expect(
      server.includes(
        "if ((target === 'worktree' || target === '') && git.isGitInternalPath(path)) return text('forbidden', 403)",
      ),
    ).toBe(true);
    const repo = mkdtempSync(join(tmpdir(), "code-viewer-open-path-safe-"));
    try {
      git(repo, ["init", "-b", "main"]);
      writeFileSync(join(repo, "sample_file.ts"), "sample\n");
      const env = { cwd: repo, omitDirNames: [], excludeNames: [] };
      expect(safeWorktreePath(env, ".git/config")).toBeNull();
      expect(safeWorktreePath(env, "sample_file.ts")).toBe(
        realpathSync(join(repo, "sample_file.ts")),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("UI adds open actions to directory-oriented surfaces", () => {
    // The directory-row button's label is localized via
    // SidebarDeps.openDirectoryInOsTitle() instead of a hardcoded English
    // string; see the DOM-behavior coverage in
    // sidebar-repo-target.test.ts > "repository directory open-in-OS button
    // localization".
    expect(
      app.includes(
        "createOpenPathButton(dir.path, 'directory', openDirectoryInOsTitle())",
      ),
    ).toBe(true);
    expect(
      app.includes(
        "createOpenPathButton(target.path, 'file-parent', 'open parent folder in OS')",
      ),
    ).toBe(true);
    expect(
      app.includes(
        "createOpenPathButton(file.path, 'file-parent', 'open parent folder in OS')",
      ),
    ).toBe(true);
    expect(app.includes("body: JSON.stringify({ path, kind })")).toBe(true);
    expect(app.includes("button.setAttribute('aria-label', title)")).toBe(true);
    expect(style.includes(".gdp-open-path {\n  color: var(--accent);")).toBe(
      true,
    );
    expect(style.includes(".gdp-open-path:hover")).toBe(true);
    expect(style.includes(".gdp-open-path.opened")).toBe(true);
  });
});

describe("sidebar tree bulk actions", () => {
  test("sidebar exposes expand and collapse all buttons for tree mode", () => {
    expect(html.includes('id="sb-expand-all"')).toBe(true);
    expect(html.includes('id="sb-collapse-all"')).toBe(true);
    expect(html.includes('id="sidebar-toggle"')).toBe(true);
    expect(html.includes('id="viewer-settings"')).toBe(true);
    expect(html.includes('class="sb-actions"')).toBe(true);
    expect(html.includes('class="sb-icon-action sb-tree-action"')).toBe(true);
    expect(
      app.includes("function setAllSidebarDirsCollapsed(collapsed: boolean)"),
    ).toBe(true);
    expect(app.includes("function setSidebarTreeActionIcons()")).toBe(true);
    expect(
      app.includes(
        "const settings = document.querySelector<HTMLButtonElement>('#viewer-settings')",
      ),
    ).toBe(true);
    expect(
      app.includes("const sidebarToggle = ensureSidebarToggleButton()"),
    ).toBe(true);
    expect(
      app.includes(
        "settings.innerHTML = iconSvg('octicon-gear', GEAR_16_PATH)",
      ),
    ).toBe(true);
    expect(
      app.includes("function syncSidebarToggleIcon(button: HTMLButtonElement)"),
    ).toBe(true);
    expect(app.includes("button.innerHTML = iconSvg('octicon-sidebar',")).toBe(
      true,
    );
    expect(app.includes("syncSidebarToggleIcon(sidebarToggle)")).toBe(true);
    expect(
      app.includes(
        "expand.innerHTML = iconSvg('octicon-chevron-down', EXPAND_ALL_16_PATHS)",
      ),
    ).toBe(true);
    expect(
      app.includes(
        "collapse.innerHTML = iconSvg('octicon-chevron-up', COLLAPSE_ALL_16_PATHS)",
      ),
    ).toBe(true);
    expect(
      app.includes(
        "$('#sb-expand-all').addEventListener('click', () => setAllSidebarDirsCollapsed(false))",
      ),
    ).toBe(true);
    expect(
      app.includes(
        "$('#sb-collapse-all').addEventListener('click', () => setAllSidebarDirsCollapsed(true))",
      ),
    ).toBe(true);
    expect(style.includes(".sb-actions")).toBe(true);
    expect(style.includes(".sb-icon-action")).toBe(true);
  });
});

describe("state changing refresh endpoint", () => {
  test("refresh uses the same side-effect request gate as upload and open path", () => {
    expect(
      server.includes(
        'if (url.pathname === "/refresh" && req.method === "POST")',
      ),
    ).toBe(true);
    expect(
      server.includes(
        'if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);\n      triggerUpdate();',
      ),
    ).toBe(true);
  });
});

describe("repository scope omit settings", () => {
  test("server layers built-in, persisted settings, CLI, and browser query omit dirs", () => {
    expect(
      server.includes(
        "let scopeOmitDirNames = git.DEFAULT_WORKTREE_OMIT_DIR_NAMES",
      ),
    ).toBe(true);
    expect(server.includes("arg === '--scope-omit-dir'")).toBe(true);
    expect(server.includes("arg === '--scope-omit-dirs'")).toBe(false);
    expect(server.includes("arg === '--no-tree-omit-dirs'")).toBe(false);
    expect(server.includes("loadProjectConfigScopeOmitDirs")).toBe(false);
    expect(server.includes("loadProjectConfigScopeExcludeNames")).toBe(false);
    expect(server.includes("loadProjectConfigUploadDisabled")).toBe(false);
    expect(server.includes(".code-viewer.json")).toBe(true);
    expect(server.includes("applyPersistedSettings(")).toBe(true);
    expect(server.includes("warnIfLegacyConfigPresent()")).toBe(true);
    expect(server.includes("onSettingsChange: applyPersistedSettings")).toBe(
      true,
    );
    expect(
      server.includes(
        "function scopeOmitDirNamesFromQuery(url: URL): string[]",
      ),
    ).toBe(true);
    expect(
      server.includes(
        'if (url.pathname === "/_settings") return handleSettings()',
      ),
    ).toBe(true);
    expect(server.includes("url.searchParams.has('omit_dirs')")).toBe(true);
    expect(server.includes("omit_dirs_effective: scopeOmitDirNames")).toBe(
      true,
    );
    expect(
      server.includes(
        "omit_dirs_built_in: git.DEFAULT_WORKTREE_OMIT_DIR_NAMES",
      ),
    ).toBe(true);
    expect(
      server.includes("let scopeExcludeNames = DEFAULT_EXCLUDE_NAMES"),
    ).toBe(true);
    expect(server.includes("exclude_names_effective: scopeExcludeNames")).toBe(
      true,
    );
  });

  test("upload toggle flows from persisted settings into the tree response", () => {
    expect(server.includes("let uploadEnabled = true")).toBe(true);
    expect(
      server.includes(
        'upload_enabled: uploadEnabled && (target === "worktree" || target === "")',
      ),
    ).toBe(true);
    expect(server.includes("upload disabled by viewer settings")).toBe(true);
    expect(server.includes("uploadDisabledByConfig")).toBe(false);
  });
});

describe("search palette shortcuts", () => {
  test("Ctrl+K and Ctrl+G open the palette while slash keeps sidebar filter focus", () => {
    expect(app.includes("resolveKeymapAction")).toBe(true);
    expect(app.includes("openSearchPalette('file')")).toBe(true);
    expect(app.includes("openSearchPalette('grep')")).toBe(true);
    expect(app.includes("if (action === 'focus-file-filter')")).toBe(true);
    expect(app.includes("focusFileFilter();")).toBe(true);
    expect(
      app.includes(
        "focusFileFilter();\n      return;\n    }\n    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g')",
      ),
    ).toBe(false);
  });

  test("palette keeps keyboard selection scrolled into view", () => {
    expect(app.includes("row.scrollIntoView({ block: 'nearest' })")).toBe(true);
  });

  test("palette exposes glob and explicit regex modes", () => {
    expect(app.includes("'Glob: * ? []'")).toBe(true);
    expect(app.includes("'Fuzzy path search'")).toBe(true);
    expect(app.includes("grepRegex: false")).toBe(true);
    expect(app.includes("params.set('regex', '1')")).toBe(true);
    expect(app.includes("Invalid regular expression")).toBe(true);
    expect(app.includes("Alt+R toggles regex")).toBe(true);
  });

  test("file line route highlights target source lines", () => {
    expect(app.includes("function lineInSourceTarget")).toBe(true);
    expect(app.includes("tr.classList.toggle('gdp-source-line-target'")).toBe(
      true,
    );
    expect(app.includes("row.classList.toggle('gdp-source-line-target'")).toBe(
      true,
    );
    expect(style.includes(".gdp-source-line-target")).toBe(true);
    expect(style.includes("--line-hit-bg:    #fff8c5;")).toBe(true);
    expect(style.includes("--line-hit-border:var(--accent);")).toBe(true);
    expect(
      style.includes(".gdp-source-line-target .gdp-source-line-code"),
    ).toBe(true);
  });

  test("diff grep selection stores and focuses a diff line route", () => {
    expect(
      app.includes(
        "setRoute({ screen: 'diff', range: currentRange(), path: item.path, line: item.line })",
      ),
    ).toBe(true);
    expect(app.includes("function focusDiffLine")).toBe(true);
    expect(
      app.includes(
        "if (card && card.dataset.path !== STATE.route.path) return false;",
      ),
    ).toBe(true);
    expect(app.includes(".gdp-diff-line-target")).toBe(true);
    expect(style.includes(".gdp-diff-line-target")).toBe(true);
  });

  test("source line numbers update the route line parameter by click and drag", () => {
    expect(app.includes("function beginSourceLineSelection")).toBe(true);
    expect(app.includes("function updateSourceLineSelection")).toBe(true);
    expect(app.includes("num.addEventListener('mousedown'")).toBe(true);
    expect(app.includes("num.addEventListener('mouseenter'")).toBe(true);
  });
});
