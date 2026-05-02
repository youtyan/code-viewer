(() => {
  // web-src/expand-logic.ts
  function initExpandState(prevHunkEndNew, hunkNewStart) {
    return {
      topExpandedStart: hunkNewStart,
      bottomExpandedEnd: prevHunkEndNew - 1
    };
  }
  function remainingGap(state, prevHunkEndNew) {
    const remainingStart = Math.max(1, prevHunkEndNew, state.bottomExpandedEnd + 1);
    const remainingEnd = state.topExpandedStart - 1;
    if (remainingStart > remainingEnd)
      return null;
    return { start: remainingStart, end: remainingEnd };
  }
  function isFullyExpanded(state, prevHunkEndNew) {
    return remainingGap(state, prevHunkEndNew) == null;
  }
  function upClickRange(state, prevHunkEndNew, step) {
    const gap = remainingGap(state, prevHunkEndNew);
    return gap ? { start: gap.start, end: Math.min(gap.end, gap.start + step - 1) } : null;
  }
  function downClickRange(state, prevHunkEndNew, step) {
    const gap = remainingGap(state, prevHunkEndNew);
    return gap ? { start: Math.max(gap.start, gap.end - step + 1), end: gap.end } : null;
  }
  function applyUp(state, range) {
    return Object.assign({}, state, { bottomExpandedEnd: range.end });
  }
  function applyDown(state, range) {
    return Object.assign({}, state, { topExpandedStart: range.start });
  }
  function mapNewToOld(newLine, prevHunkEndNew, prevHunkEndOld) {
    return prevHunkEndOld + (newLine - prevHunkEndNew);
  }
  function trailingClickRange(hunkEndNew, step) {
    return { start: hunkEndNew, end: hunkEndNew + step - 1 };
  }
  function applyTrailingResult(state, receivedCount, step) {
    return {
      newStart: state.newStart + receivedCount,
      oldStart: state.oldStart + receivedCount,
      eof: receivedCount === 0 || receivedCount < step
    };
  }
  var GdpExpandLogic = {
    initExpandState,
    remainingGap,
    isFullyExpanded,
    upClickRange,
    downClickRange,
    applyUp,
    applyDown,
    mapNewToOld,
    trailingClickRange,
    applyTrailingResult
  };

  // web-src/file-navigation.ts
  function nextVisibleFileIndex(currentIndex, itemCount, direction) {
    if (itemCount <= 0)
      return -1;
    if (currentIndex < 0)
      return direction > 0 ? 0 : itemCount - 1;
    return Math.max(0, Math.min(itemCount - 1, currentIndex + direction));
  }

  // web-src/file-path-copy.ts
  function filePathClipboardText(path) {
    return path || "";
  }

  // web-src/file-filter.ts
  function normalizeFileFilterQuery(value) {
    return (value || "").toLowerCase().trim();
  }
  function parseSlashRegex(query) {
    if (!query.startsWith("/") || query.length < 2)
      return null;
    const lastSlash = query.lastIndexOf("/");
    if (lastSlash <= 0)
      return null;
    return {
      source: query.slice(1, lastSlash),
      flags: query.slice(lastSlash + 1)
    };
  }
  function compileFileFilter(value) {
    const raw = (value || "").trim();
    if (!raw)
      return { kind: "empty", match: () => true };
    const slashRegex = parseSlashRegex(raw);
    if (slashRegex) {
      try {
        const regex = new RegExp(slashRegex.source, slashRegex.flags);
        return { kind: "regex", match: (path) => regex.test(path) };
      } catch (error) {
        return {
          kind: "invalid",
          match: () => false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
    const q = normalizeFileFilterQuery(raw.startsWith("/") ? raw.slice(1) : raw);
    return {
      kind: "substring",
      match: (path) => path.toLowerCase().includes(q)
    };
  }

  // web-src/catch-up.ts
  function shouldCatchUpDiff(route) {
    return route.screen !== "repo" && !(route.screen === "file" && route.view === "blob");
  }
  function createCatchUpGate(now, minIntervalMs) {
    let lastForceAt = 0;
    return function shouldRun() {
      const current = now();
      if (current - lastForceAt < minIntervalMs)
        return false;
      lastForceAt = current;
      return true;
    };
  }

  // web-src/routes.ts
  function assertNever(value) {
    throw new Error("unhandled route: " + JSON.stringify(value));
  }
  function parseLegacyRange(value, fallback) {
    const raw = value || "";
    const sep = raw.indexOf("..");
    if (sep < 0)
      return fallback;
    return {
      from: raw.slice(0, sep) || fallback.from,
      to: raw.slice(sep + 2) || fallback.to
    };
  }
  function parseRoute(pathname, search, fallbackRange) {
    const params = new URLSearchParams(search);
    const legacyRange = parseLegacyRange(params.get("range"), fallbackRange);
    const range = {
      from: params.get("from") || legacyRange.from,
      to: params.get("to") || legacyRange.to
    };
    switch (pathname) {
      case "/":
      case "/index.html":
        return {
          screen: "repo",
          ref: params.get("ref") || params.get("target") || "worktree",
          path: params.get("path") || "",
          range
        };
      case "/todif":
      case "/todiff":
        return { screen: "diff", range };
      case "/file": {
        const path = params.get("path") || "";
        const target = params.get("target") || "";
        const ref = target || params.get("ref") || "worktree";
        if (!path)
          return { screen: "unknown", reason: "missing-path", rawPathname: pathname, rawSearch: search, range };
        return { screen: "file", path, ref, range, view: target ? "blob" : "detail" };
      }
      default:
        return { screen: "unknown", reason: "unknown-pathname", rawPathname: pathname, rawSearch: search, range };
    }
  }
  function buildRoute(route) {
    switch (route.screen) {
      case "repo": {
        const params = new URLSearchParams;
        if (route.ref && route.ref !== "worktree")
          params.set("ref", route.ref);
        if (route.path)
          params.set("path", route.path);
        const qs = params.toString();
        return "/" + (qs ? "?" + qs : "");
      }
      case "file":
        if (route.view === "blob") {
          return "/file?path=" + encodeURIComponent(route.path) + "&target=" + encodeURIComponent(route.ref || "worktree");
        }
        return "/file?path=" + encodeURIComponent(route.path) + "&ref=" + encodeURIComponent(route.ref || "worktree") + "&from=" + encodeURIComponent(route.range.from || "") + "&to=" + encodeURIComponent(route.range.to || "worktree");
      case "diff":
        return "/todif?from=" + encodeURIComponent(route.range.from || "") + "&to=" + encodeURIComponent(route.range.to || "worktree");
      case "unknown":
        return "/todif?from=" + encodeURIComponent(route.range.from || "") + "&to=" + encodeURIComponent(route.range.to || "worktree");
      default:
        return assertNever(route);
    }
  }
  function buildRawFileUrl(target) {
    return "/_file?path=" + encodeURIComponent(target.path) + "&ref=" + encodeURIComponent(target.ref || "worktree");
  }

  // web-src/ws-highlight.ts
  function isWhitespaceOnlyInlineHighlight(text) {
    return !!text && !/\S/.test(text);
  }
  function suppressWhitespaceOnlyInlineHighlights(root) {
    root.querySelectorAll("ins, del").forEach((el) => {
      if (!isWhitespaceOnlyInlineHighlight(el.textContent))
        return;
      const parent = el.parentNode;
      if (!parent)
        return;
      parent.replaceChild(document.createTextNode(el.textContent || ""), el);
    });
  }

  // web-src/app.ts
  window.GdpExpandLogic = GdpExpandLogic;
  (() => {
    const FOLDER_ICON_PATHS = {
      closed: "M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z",
      open: "M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z"
    };
    const CHEVRON_DOWN_12_PATH = "M6 8.825c-.2 0-.4-.1-.5-.2l-3.3-3.3c-.3-.3-.3-.8 0-1.1.3-.3.8-.3 1.1 0l2.7 2.7 2.7-2.7c.3-.3.8-.3 1.1 0 .3.3.3.8 0 1.1l-3.2 3.2c-.2.2-.4.3-.6.3Z";
    const CHEVRON_DOWN_16_PATH = "M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z";
    const COPY_16_PATHS = [
      "M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z",
      "M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"
    ];
    const FILE_16_PATH = "M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8 4.25V1.5Zm5.75.062V4.25c0 .138.112.25.25.25h2.688Z";
    const OPEN_EXTERNAL_16_PATH = "M3.75 2A1.75 1.75 0 0 0 2 3.75v8.5C2 13.216 2.784 14 3.75 14h8.5A1.75 1.75 0 0 0 14 12.25v-3.5a.75.75 0 0 0-1.5 0v3.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25h3.5a.75.75 0 0 0 0-1.5h-3.5Zm6.5 0a.75.75 0 0 0 0 1.5h1.19L7.72 7.22a.749.749 0 1 0 1.06 1.06l3.72-3.72v1.19a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 13.25 2h-3Z";
    const UNFOLD_16_PATH = "m8.177.677 2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25a.75.75 0 0 1-1.5 0V4H5.104a.25.25 0 0 1-.177-.427L7.823.677a.25.25 0 0 1 .354 0ZM7.25 10.75a.75.75 0 0 1 1.5 0V12h2.146a.25.25 0 0 1 .177.427l-2.896 2.896a.25.25 0 0 1-.354 0l-2.896-2.896A.25.25 0 0 1 5.104 12H7.25v-1.25Zm-5-2a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z";
    const FOLD_16_PATH = "M10.896 2H8.75V.75a.75.75 0 0 0-1.5 0V2H5.104a.25.25 0 0 0-.177.427l2.896 2.896a.25.25 0 0 0 .354 0l2.896-2.896A.25.25 0 0 0 10.896 2ZM8.75 15.25a.75.75 0 0 1-1.5 0V14H5.104a.25.25 0 0 1-.177-.427l2.896-2.896a.25.25 0 0 1 .354 0l2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25Zm-6.5-6.5a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z";
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));
    const diffCardSelector = (path) => '.gdp-file-shell[data-path="' + (window.CSS && CSS.escape ? CSS.escape(path) : path) + '"]';
    const HIGHLIGHT_SRC = "/vendor/highlight.js/highlight.min.js";
    const DEFAULT_RANGE = { from: "HEAD", to: "worktree" };
    let highlightLoadPromise = null;
    let highlightConfigured = false;
    let PROJECT_NAME = "";
    const STATE = (() => {
      const igRaw = localStorage.getItem("gdp:ignore-ws");
      const fallbackRange = {
        from: localStorage.getItem("gdp:from") || DEFAULT_RANGE.from,
        to: localStorage.getItem("gdp:to") || DEFAULT_RANGE.to
      };
      const parsedRoute = parseRoute(window.location.pathname, window.location.search, fallbackRange);
      const route = parsedRoute.screen === "unknown" ? { screen: "diff", range: parsedRoute.range } : parsedRoute;
      return {
        layout: localStorage.getItem("gdp:layout") || "side-by-side",
        theme: localStorage.getItem("gdp:theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
        sbView: localStorage.getItem("gdp:sbview") || "tree",
        sbWidth: parseInt(localStorage.getItem("gdp:sbwidth")) || 308,
        collapsedDirs: new Set(JSON.parse(localStorage.getItem("gdp:collapsed-dirs") || "[]")),
        ignoreWs: igRaw === null ? true : igRaw === "1",
        from: route.range.from,
        to: route.range.to,
        collapsed: false,
        files: [],
        activeFile: null,
        hideTests: localStorage.getItem("gdp:hide-tests") === "1",
        syntaxHighlight: localStorage.getItem("gdp:syntax-highlight") !== "0",
        viewedFiles: new Set(JSON.parse(localStorage.getItem("gdp:viewed-files") || "[]")),
        route,
        repoRef: route.screen === "repo" ? route.ref : "worktree"
      };
    })();
    function setStatus(s) {
      const el = $("#status");
      el.classList.remove("live", "refreshing", "error");
      if (s)
        el.classList.add(s);
    }
    function applyTheme() {
      document.documentElement.dataset.theme = STATE.theme;
      $("#hljs-light").disabled = STATE.theme === "dark";
      $("#hljs-dark").disabled = STATE.theme !== "dark";
    }
    function getHljs() {
      const hljsRef = window.hljs || window.Diff2HtmlUI && window.Diff2HtmlUI.hljs;
      if (!hljsRef)
        return null;
      if (!highlightConfigured && typeof hljsRef.configure === "function") {
        hljsRef.configure({ ignoreUnescapedHTML: true });
        highlightConfigured = true;
      }
      return hljsRef;
    }
    function setHighlightButton(state) {
      const btn = $("#syntax-highlight");
      if (!btn)
        return;
      btn.classList.toggle("active", STATE.syntaxHighlight);
      btn.classList.toggle("loading", state === "loading");
      btn.textContent = state === "loading" ? "loading..." : STATE.syntaxHighlight ? "syntax on" : "syntax off";
      btn.setAttribute("aria-pressed", STATE.syntaxHighlight ? "true" : "false");
      btn.title = STATE.syntaxHighlight ? "syntax highlighting on" : state === "loading" ? "loading syntax highlighter" : state === "error" ? "failed to load syntax highlighter" : "syntax highlighting off";
    }
    function loadSyntaxHighlighter() {
      const existing = getHljs();
      if (existing) {
        setHighlightButton("loaded");
        return Promise.resolve(existing);
      }
      if (highlightLoadPromise)
        return highlightLoadPromise;
      setHighlightButton("loading");
      highlightLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = HIGHLIGHT_SRC;
        script.async = true;
        script.onload = () => {
          const hljsRef = getHljs();
          if (hljsRef) {
            setHighlightButton("loaded");
            resolve(hljsRef);
          } else {
            setHighlightButton("error");
            reject(new Error("highlight.js did not expose window.hljs"));
          }
        };
        script.onerror = () => {
          setHighlightButton("error");
          reject(new Error("failed to load highlight.js"));
        };
        document.head.appendChild(script);
      }).catch(() => {
        highlightLoadPromise = null;
        return null;
      });
      return highlightLoadPromise;
    }
    function rerenderLoadedDiffs() {
      document.querySelectorAll(".gdp-file-shell.loaded").forEach((card) => {
        const data = card._diffData;
        const file = card._file;
        if (!data || !file)
          return;
        mountDiff(card, file, data);
        if (data.truncated && data.mode === "preview") {
          addExpandHunksUI(file, data, card);
        }
        scheduleIdleHighlight(card, file);
      });
    }
    function setLayout(layout) {
      STATE.layout = layout;
      localStorage.setItem("gdp:layout", layout);
      $$("#topbar .seg button").forEach((b) => {
        b.classList.toggle("active", b.dataset.layout === layout);
      });
      document.querySelectorAll(".gdp-file-shell.loaded").forEach((card) => {
        const data = card._diffData;
        const file = card._file;
        if (!data || !file)
          return;
        mountDiff(card, file, data);
        if (data.truncated && data.mode === "preview") {
          addExpandHunksUI(file, data, card);
        }
        scheduleIdleHighlight(card, file);
      });
    }
    function fileBadge(status) {
      const ch = (status || "M")[0].toUpperCase();
      const span = document.createElement("span");
      span.className = "badge " + ch;
      span.textContent = ch;
      span.title = { M: "modified", A: "added", D: "deleted", R: "renamed" }[ch] || ch;
      return span;
    }
    function persistViewedFiles() {
      localStorage.setItem("gdp:viewed-files", JSON.stringify([...STATE.viewedFiles]));
    }
    function setFileViewed(path, viewed) {
      if (viewed)
        STATE.viewedFiles.add(path);
      else
        STATE.viewedFiles.delete(path);
      persistViewedFiles();
      applyViewedState();
    }
    function setFolderIcon(el, collapsed) {
      const path = collapsed ? FOLDER_ICON_PATHS.closed : FOLDER_ICON_PATHS.open;
      el.innerHTML = '<svg class="octicon octicon-file-directory-' + (collapsed ? "fill" : "open-fill") + '" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">' + '<path fill="currentColor" d="' + path + '"></path></svg>';
    }
    function setChevronIcon(el) {
      el.innerHTML = '<svg class="octicon octicon-chevron-down" viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">' + '<path fill="currentColor" d="' + CHEVRON_DOWN_12_PATH + '"></path></svg>';
    }
    function iconSvg(className, paths) {
      const pathList = Array.isArray(paths) ? paths : [paths];
      return '<svg class="octicon ' + className + '" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">' + pathList.map((path) => '<path fill="currentColor" d="' + path + '"></path>').join("") + "</svg>";
    }
    function setUnfoldButtonState(button, expanded) {
      if (!button)
        return;
      button.setAttribute("aria-pressed", expanded ? "true" : "false");
      button.title = expanded ? "Collapse expanded lines" : "Expand all lines";
      button.innerHTML = expanded ? iconSvg("octicon-fold", FOLD_16_PATH) : iconSvg("octicon-unfold", UNFOLD_16_PATH);
    }
    function setSidebarTreeActionIcons() {
      const expand = document.querySelector("#sb-expand-all");
      const collapse = document.querySelector("#sb-collapse-all");
      if (expand)
        expand.innerHTML = iconSvg("octicon-unfold", UNFOLD_16_PATH);
      if (collapse)
        collapse.innerHTML = iconSvg("octicon-fold", FOLD_16_PATH);
    }
    function buildTree(files) {
      const root = { name: "", dirs: {}, files: [], path: "", minOrder: Infinity, explicit: true };
      for (const f of files) {
        const parts = f.path.split("/");
        let node = root;
        let acc = "";
        const dirPartCount = f.type === "tree" ? parts.length : parts.length - 1;
        for (let i = 0;i < dirPartCount; i++) {
          const p = parts[i];
          acc = acc ? acc + "/" + p : p;
          if (!node.dirs[p]) {
            node.dirs[p] = { name: p, dirs: {}, files: [], path: acc, minOrder: Infinity };
          }
          node = node.dirs[p];
          if (typeof f.order === "number" && f.order < node.minOrder)
            node.minOrder = f.order;
        }
        if (f.type === "tree") {
          node.explicit = true;
          if (f.children_omitted === true)
            node.children_omitted = true;
          continue;
        }
        node.files.push(f);
      }
      function compress(node) {
        const ks = Object.keys(node.dirs);
        while (ks.length === 1 && node.files.length === 0 && !node.explicit && node !== root) {
          const only = node.dirs[ks[0]];
          node.name = node.name ? node.name + "/" + only.name : only.name;
          node.dirs = only.dirs;
          node.files = only.files;
          node.path = only.path;
          node.minOrder = Math.min(node.minOrder, only.minOrder);
          ks.length = 0;
          Object.keys(node.dirs).forEach((k) => ks.push(k));
        }
        Object.values(node.dirs).forEach(compress);
      }
      Object.values(root.dirs).forEach(compress);
      return root;
    }
    function renderTreeNode(node, depth, ul, onFileClick) {
      const items = [];
      for (const k of Object.keys(node.dirs)) {
        const d = node.dirs[k];
        items.push({ kind: "dir", sortKey: d.minOrder, dir: d });
      }
      for (const f of node.files) {
        items.push({ kind: "file", sortKey: f.order != null ? f.order : Infinity, file: f });
      }
      items.sort((a, b) => a.sortKey - b.sortKey);
      for (const item of items) {
        if (item.kind === "dir") {
          const dir = item.dir;
          const li = document.createElement("li");
          li.className = "tree-dir";
          li.dataset.dirpath = dir.path;
          if (dir.explicit)
            li.dataset.explicit = "true";
          if (dir.children_omitted) {
            li.classList.add("children-omitted");
            li.title = "Directory contents are intentionally not listed";
          }
          li.style.setProperty("--lvl-pad", 12 + depth * 14 + "px");
          const chev = document.createElement("span");
          chev.className = "chev";
          setChevronIcon(chev);
          li.appendChild(chev);
          const dirIcon = document.createElement("span");
          dirIcon.className = "dir-icon";
          li.appendChild(dirIcon);
          const label = document.createElement("span");
          label.className = "dir-label";
          const dn = document.createElement("span");
          dn.className = "dir-name";
          dn.textContent = dir.name;
          dn.title = dir.path;
          label.appendChild(dn);
          if (dir.children_omitted) {
            const omitted = document.createElement("span");
            omitted.className = "dir-omitted";
            omitted.textContent = "skipped";
            omitted.title = "Directory contents are intentionally not listed";
            label.appendChild(omitted);
          }
          li.appendChild(label);
          li.appendChild(createOpenPathButton(dir.path, "directory", "open this folder in OS"));
          const collapsed = STATE.collapsedDirs.has(dir.path);
          if (collapsed)
            li.classList.add("collapsed");
          const updateIcon = () => {
            setFolderIcon(dirIcon, li.classList.contains("collapsed"));
          };
          updateIcon();
          const childUl = document.createElement("ul");
          childUl.className = "tree-children";
          renderTreeNode(dir, depth + 1, childUl, onFileClick);
          const toggleDir = (e) => {
            e.stopPropagation();
            li.classList.toggle("collapsed");
            updateIcon();
            if (li.classList.contains("collapsed"))
              STATE.collapsedDirs.add(dir.path);
            else
              STATE.collapsedDirs.delete(dir.path);
            localStorage.setItem("gdp:collapsed-dirs", JSON.stringify([...STATE.collapsedDirs]));
          };
          chev.addEventListener("click", toggleDir);
          dirIcon.addEventListener("click", toggleDir);
          if (onFileClick) {
            li.addEventListener("click", (e) => {
              e.stopPropagation();
              onFileClick({ path: dir.path, display_path: dir.path, type: "tree", children_omitted: dir.children_omitted });
            });
          } else {
            li.addEventListener("click", toggleDir);
          }
          ul.appendChild(li);
          ul.appendChild(childUl);
        } else {
          const f = item.file;
          const li = document.createElement("li");
          li.className = "tree-file";
          li.dataset.path = f.path;
          li.classList.toggle("viewed", STATE.viewedFiles.has(f.path));
          li.style.setProperty("--lvl-pad", 12 + depth * 14 + "px");
          const spacer = document.createElement("span");
          spacer.className = "chev-spacer";
          li.appendChild(spacer);
          if (f.status) {
            li.appendChild(fileBadge(f.status));
          } else {
            const icon = document.createElement("span");
            icon.className = "d2h-icon-wrapper";
            icon.innerHTML = fileEntryIcon();
            li.appendChild(icon);
          }
          const name = document.createElement("span");
          name.className = "name";
          name.textContent = f.path.split("/").pop();
          name.title = f.path;
          li.appendChild(name);
          li.addEventListener("click", () => {
            if (onFileClick)
              onFileClick(f);
            else
              scrollToFile(f.path);
          });
          if (!onFileClick)
            li.addEventListener("mouseenter", () => prefetchByPath(f.path), { passive: true });
          ul.appendChild(li);
        }
      }
    }
    function renderFlat(files, ul, onFileClick) {
      files.forEach((f, i) => {
        const li = document.createElement("li");
        li.dataset.index = String(i);
        li.dataset.path = f.path;
        li.classList.toggle("viewed", STATE.viewedFiles.has(f.path));
        if (f.status) {
          li.appendChild(fileBadge(f.status));
        } else {
          const icon = document.createElement("span");
          icon.className = "d2h-icon-wrapper";
          icon.innerHTML = fileEntryIcon();
          li.appendChild(icon);
        }
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = f.path;
        name.title = f.path;
        li.appendChild(name);
        li.addEventListener("click", () => {
          if (onFileClick)
            onFileClick(f);
          else
            scrollToFile(f.path);
        });
        if (!onFileClick)
          li.addEventListener("mouseenter", () => prefetchByPath(f.path), { passive: true });
        ul.appendChild(li);
      });
    }
    function renderSidebar(files, onFileClick) {
      const ul = $("#filelist");
      ul.innerHTML = "";
      ul.classList.toggle("tree", STATE.sbView === "tree");
      STATE.files = files;
      if (STATE.sbView === "tree") {
        const root = buildTree(files);
        renderTreeNode(root, 0, ul, onFileClick);
      } else {
        renderFlat(files, ul, onFileClick);
      }
      $("#totals").textContent = files.length ? files.length + " file" + (files.length === 1 ? "" : "s") : "";
      $$(".sb-view-seg button").forEach((b) => {
        b.classList.toggle("active", b.dataset.view === STATE.sbView);
      });
      $$(".sb-tree-action").forEach((b) => {
        b.disabled = STATE.sbView !== "tree" || !STATE.files.length;
      });
      if (STATE.activeFile)
        markActive(STATE.activeFile);
      applyFilter();
    }
    function setAllSidebarDirsCollapsed(collapsed) {
      if (!collapsed)
        STATE.collapsedDirs.clear();
      $$("#filelist .tree-dir[data-dirpath]").forEach((li) => {
        const path = li.dataset.dirpath || "";
        if (!path)
          return;
        li.classList.toggle("collapsed", collapsed);
        const dirIcon = li.querySelector(".dir-icon");
        if (dirIcon)
          setFolderIcon(dirIcon, collapsed);
        if (collapsed)
          STATE.collapsedDirs.add(path);
      });
      localStorage.setItem("gdp:collapsed-dirs", JSON.stringify([...STATE.collapsedDirs]));
    }
    function syncRepoTargetInput(ref) {
      const input = document.querySelector("#repo-target");
      const wrap = document.querySelector("#repo-target-wrap");
      if (!input || !wrap)
        return;
      input.value = ref || "worktree";
      wrap.hidden = !(STATE.route.screen === "file" && STATE.route.view === "blob");
    }
    function renderMeta(meta) {
      const el = $("#meta");
      if (!meta) {
        el.textContent = "";
        return;
      }
      PROJECT_NAME = meta.project || PROJECT_NAME;
      document.title = (meta.project ? meta.project + " - " : "") + "git diff preview";
      el.innerHTML = "";
      if (meta.branch) {
        const b = document.createElement("span");
        b.className = "ref";
        b.textContent = "⎇ " + meta.branch;
        el.appendChild(b);
      }
      if (meta.totals) {
        const t = document.createElement("span");
        t.className = "num";
        t.innerHTML = '<span class="add">+' + meta.totals.additions + "</span> " + '<span class="del">−' + meta.totals.deletions + "</span> " + "<span>" + meta.totals.files + " files</span>";
        el.appendChild(t);
      }
      const u = document.createElement("span");
      u.className = "updated-at";
      u.title = "last updated";
      u.textContent = "updated " + new Date().toLocaleTimeString([], { hour12: false });
      el.appendChild(u);
    }
    let SUPPRESS_SPY_UNTIL = 0;
    function prefetchByPath(path) {
      const card = document.querySelector(diffCardSelector(path));
      if (!card || !card.classList.contains("pending"))
        return;
      const f = STATE.files.find((x) => x.path === path);
      if (!f)
        return;
      enqueueLoad(f, card, 5);
    }
    function scrollToFile(path) {
      const card = document.querySelector(diffCardSelector(path));
      if (!card)
        return;
      markActive(path);
      SUPPRESS_SPY_UNTIL = performance.now() + 1500;
      const onEnd = () => {
        SUPPRESS_SPY_UNTIL = 0;
        window.removeEventListener("scrollend", onEnd);
      };
      window.addEventListener("scrollend", onEnd, { once: true });
      if (card.classList.contains("pending")) {
        const f = STATE.files.find((x) => x.path === path);
        if (f)
          enqueueLoad(f, card, 10);
      }
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function markActive(path) {
      STATE.activeFile = path;
      $$("#filelist li").forEach((li) => {
        const itemPath = li.dataset.path || li.dataset.dirpath;
        if (itemPath)
          li.classList.toggle("active", itemPath === path);
      });
    }
    function applyViewedState() {
      $$("#filelist li[data-path]").forEach((li) => {
        const path = li.dataset.path || "";
        li.classList.toggle("viewed", STATE.viewedFiles.has(path));
      });
      $$(".gdp-file-shell[data-path]").forEach((card) => {
        const path = card.dataset.path || "";
        const viewed = STATE.viewedFiles.has(path);
        card.classList.toggle("viewed", viewed);
        card.querySelectorAll(".d2h-file-collapse-input").forEach((checkbox) => {
          checkbox.checked = viewed;
        });
      });
    }
    function applyFilter() {
      const input = $("#sb-filter");
      const filter = compileFileFilter(input.value);
      const invalid = filter.kind === "invalid";
      input.toggleAttribute("aria-invalid", invalid);
      input.title = invalid ? filter.error || "invalid regular expression" : "";
      const matches = invalid ? () => true : filter.match;
      $$("#filelist li[data-path]").forEach((li) => {
        const match = matches(li.dataset.path || "");
        li.classList.toggle("hidden", !match);
      });
      if (!isRepositorySidebarMode()) {
        document.querySelectorAll(".gdp-file-shell").forEach((card) => {
          const match = matches(card.dataset.path || "");
          card.classList.toggle("hidden-by-filter", !match);
        });
      }
      updateTreeDirVisibility(matches, filter.kind !== "empty" && !invalid);
      if (typeof applyViewedState === "function")
        applyViewedState();
    }
    function updateTreeDirVisibility(dirMatches, filterActive = false) {
      $$("#filelist .tree-dir").forEach((dir) => {
        const childUl = dir.nextElementSibling;
        if (!childUl || !childUl.classList.contains("tree-children"))
          return;
        const anyVisible = !!childUl.querySelector(".tree-file:not(.hidden):not(.hidden-by-tests)");
        const explicitVisible = dir.dataset.explicit === "true" && !filterActive;
        const selfMatches = filterActive && !!dirMatches && dirMatches(dir.dataset.dirpath || "");
        dir.classList.toggle("hidden", !anyVisible && !explicitVisible && !selfMatches);
      });
    }
    let SERVER_GENERATION = 0;
    let CLIENT_REQ_SEQ = 0;
    const LOAD_QUEUE = [];
    let ACTIVE_LOADS = 0;
    const MAX_PARALLEL = 2;
    let lazyObserver = null;
    let SOURCE_REQ_SEQ = 0;
    let IN_FLIGHT = 0;
    function updateLoadBar() {
      const el = $("#load-bar");
      if (el)
        el.classList.toggle("active", IN_FLIGHT > 0);
    }
    function trackLoad(promise) {
      IN_FLIGHT++;
      updateLoadBar();
      const done = () => {
        IN_FLIGHT = Math.max(0, IN_FLIGHT - 1);
        updateLoadBar();
      };
      return Promise.resolve(promise).then((v) => {
        done();
        return v;
      }, (e) => {
        done();
        throw e;
      });
    }
    function escapeHtml(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }
    function sourceTargetsEqual(a, b) {
      return !!a && !!b && a.path === b.path && a.ref === b.ref;
    }
    function fileSourceTarget(file) {
      if ((file.status || "").startsWith("D")) {
        return { path: file.old_path || file.path, ref: STATE.from || "HEAD" };
      }
      const ref = STATE.to && STATE.to !== "worktree" ? STATE.to : "worktree";
      return { path: file.path, ref };
    }
    function currentRange() {
      return { from: STATE.from || DEFAULT_RANGE.from, to: STATE.to || DEFAULT_RANGE.to };
    }
    function sourceTargetFromRoute() {
      return STATE.route.screen === "file" ? { path: STATE.route.path, ref: STATE.route.ref } : null;
    }
    function repoFileTargetFromRoute() {
      return STATE.route.screen === "file" && STATE.route.view === "blob" ? STATE.route.ref : null;
    }
    function setRoute(route, replace = false) {
      const nextRoute = route.screen === "unknown" ? { screen: "diff", range: route.range } : route;
      STATE.route = nextRoute;
      STATE.from = nextRoute.range.from;
      STATE.to = nextRoute.range.to;
      if (nextRoute.screen === "repo" || nextRoute.screen === "file" && nextRoute.view === "blob") {
        STATE.repoRef = nextRoute.ref || "worktree";
      }
      const url = buildRoute(nextRoute);
      const state = nextRoute.screen === "file" ? { screen: "file", path: nextRoute.path, ref: nextRoute.ref, view: nextRoute.view || "detail" } : { view: nextRoute.screen };
      if (replace)
        history.replaceState(state, "", url);
      else
        history.pushState(state, "", url);
      syncHeaderMenu();
    }
    function setPageMode() {
      document.body.classList.toggle("gdp-file-detail-page", STATE.route.screen === "file");
      document.body.classList.toggle("gdp-repo-blob-page", STATE.route.screen === "file" && STATE.route.view === "blob");
      document.body.classList.toggle("gdp-repo-page", STATE.route.screen === "repo");
      syncRepoTargetInput(repoFileTargetFromRoute() || "worktree");
    }
    function syncHeaderMenu() {
      document.querySelectorAll(".app-menu-item").forEach((link) => {
        const fileRouteOwner = STATE.route.screen === "file" && STATE.route.view === "blob" ? "repo" : "diff";
        const active = link.dataset.route === STATE.route.screen || STATE.route.screen === "file" && link.dataset.route === fileRouteOwner;
        link.classList.toggle("active", active);
        link.setAttribute("aria-current", active ? "page" : "false");
        if (link.dataset.route === "repo") {
          link.href = buildRoute({ screen: "repo", ref: STATE.repoRef || "worktree", path: "", range: currentRange() });
        }
        if (link.dataset.route === "diff") {
          link.href = buildRoute({ screen: "diff", range: currentRange() });
        }
      });
    }
    function removeStandaloneSource() {
      document.querySelectorAll(".gdp-standalone-source").forEach((el) => el.remove());
      document.querySelectorAll(".gdp-repo-blob-layout").forEach((el) => el.remove());
    }
    function renderShell(meta) {
      const newFiles = meta.files || [];
      STATE.files = newFiles;
      SERVER_GENERATION = meta.generation || 0;
      window._lastMeta = meta;
      renderMeta(meta);
      renderSidebar(newFiles);
      const target = $("#diff");
      const empty = $("#empty");
      if (!newFiles.length) {
        if (STATE.route.screen === "file") {
          empty.classList.add("hidden");
          applySourceRouteToShell();
        } else {
          empty.classList.remove("hidden");
          target.replaceChildren();
        }
        LOAD_QUEUE.length = 0;
        return;
      }
      empty.classList.add("hidden");
      const oldByKey = new Map;
      document.querySelectorAll(".gdp-file-shell").forEach((c) => {
        if (c.dataset.key)
          oldByKey.set(c.dataset.key, c);
      });
      const ordered = [];
      newFiles.forEach((f) => {
        const key = f.key || f.path;
        const old = oldByKey.get(key);
        if (old) {
          oldByKey.delete(key);
          const sizeChanged = old.dataset.sizeClass !== (f.size_class || "small");
          const statusChanged = old.dataset.status !== (f.status || "M");
          if (sizeChanged || statusChanged) {
            old.classList.remove("loaded", "error");
            old.classList.add("pending");
            old.replaceChildren();
            const tmp = createPlaceholder(f);
            while (tmp.firstChild)
              old.appendChild(tmp.firstChild);
            old.dataset.sizeClass = f.size_class || "small";
            old.dataset.status = f.status || "M";
            delete old.dataset.manualRendered;
            delete old.dataset.manualLoad;
            delete old.dataset.manualMode;
            old.style.minHeight = (f.estimated_height_px || 80) + "px";
            old._diffData = null;
            old._file = null;
          } else {
            const stats = old.querySelector(".gdp-shell-header .stats");
            if (stats) {
              stats.innerHTML = '<span class="a">+' + (f.additions || 0) + "</span>" + '<span class="d">−' + (f.deletions || 0) + "</span>";
            }
            old._file = f;
          }
          ordered.push(old);
        } else {
          ordered.push(createPlaceholder(f));
        }
      });
      oldByKey.forEach((c) => c.remove());
      target.replaceChildren(...ordered);
      for (let i = LOAD_QUEUE.length - 1;i >= 0; i--) {
        if (!LOAD_QUEUE[i].card.isConnected)
          LOAD_QUEUE.splice(i, 1);
      }
      setupLazyObserver();
      enqueueInitialLoads();
      applySourceRouteToShell();
      setupScrollSpy();
      if (typeof applyHideTests === "function")
        applyHideTests();
      applyFilter();
      applyViewedState();
    }
    function fileEntryIcon() {
      return iconSvg("octicon-file", FILE_16_PATH);
    }
    async function openPathInOs(path, kind, button) {
      const oldTitle = button?.title;
      if (button) {
        button.disabled = true;
        button.classList.remove("failed");
      }
      try {
        const res = await fetch("/_open_path", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Code-Viewer-Action": "1" },
          body: JSON.stringify({ path, kind })
        });
        if (!res.ok)
          throw new Error(await res.text());
        button?.classList.add("opened");
        setTimeout(() => {
          button?.classList.remove("opened");
        }, 1200);
      } catch {
        if (button) {
          button.classList.add("failed");
          button.title = "failed to open in OS";
          setTimeout(() => {
            button.classList.remove("failed");
            button.title = oldTitle || "open in OS";
          }, 1600);
        }
      } finally {
        if (button)
          button.disabled = false;
      }
    }
    function createOpenPathButton(path, kind, title = "open folder in OS") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gdp-file-header-icon gdp-open-path";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.innerHTML = iconSvg("octicon-link-external", OPEN_EXTERNAL_16_PATH);
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        openPathInOs(path, kind, button);
      });
      return button;
    }
    async function uploadFiles(path, files) {
      const list = Array.from(files);
      if (!list.length)
        return;
      const label = path || PROJECT_NAME || "repository root";
      if (!window.confirm("Upload " + list.length + " file" + (list.length === 1 ? "" : "s") + " into " + label + "?"))
        return;
      const form = new FormData;
      form.set("dir", path);
      list.forEach((file) => form.append("files", file, file.name));
      const res = await fetch("/_upload_files", {
        method: "POST",
        headers: { "X-Code-Viewer-Action": "1" },
        body: form
      });
      if (!res.ok)
        throw new Error(await res.text());
      await loadRepo();
    }
    function createRepoUploadPanel(path) {
      const dropPanel = document.createElement("div");
      dropPanel.className = "gdp-upload-panel";
      const copy = document.createElement("div");
      copy.className = "gdp-upload-copy";
      copy.textContent = "Drop files into " + (path || PROJECT_NAME || "repository");
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.hidden = true;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gdp-btn gdp-btn-sm";
      button.textContent = "Upload files";
      button.addEventListener("click", () => input.click());
      const fail = () => {
        dropPanel.classList.add("failed");
        setTimeout(() => dropPanel.classList.remove("failed"), 1600);
      };
      input.addEventListener("change", async () => {
        try {
          if (input.files && input.files.length)
            await uploadFiles(path, input.files);
        } catch {
          fail();
        } finally {
          input.value = "";
        }
      });
      dropPanel.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropPanel.classList.add("dragging");
      });
      dropPanel.addEventListener("dragleave", () => dropPanel.classList.remove("dragging"));
      dropPanel.addEventListener("drop", async (event) => {
        event.preventDefault();
        dropPanel.classList.remove("dragging");
        try {
          const files = event.dataTransfer?.files;
          if (files && files.length)
            await uploadFiles(path, files);
        } catch {
          fail();
        }
      });
      dropPanel.append(copy, button, input);
      return dropPanel;
    }
    function repoRoute(ref, path) {
      return { screen: "repo", ref: ref || "worktree", path, range: currentRange() };
    }
    function wireRepoTargetPicker(input, onPick) {
      input.addEventListener("focus", () => openPopover(input));
      input.addEventListener("click", (e) => {
        e.stopPropagation();
        openPopover(input);
      });
      input.addEventListener("mousedown", (e) => {
        if (popover.hidden) {
          e.preventDefault();
          input.focus();
        }
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          closePopover();
        } else if (e.key === "Escape") {
          closePopover();
          input.blur();
        }
      });
      input.addEventListener("change", () => onPick(input.value || "worktree"));
    }
    function createRepoBreadcrumb(target, path) {
      const nav = document.createElement("nav");
      nav.className = "gdp-file-breadcrumb gdp-repo-breadcrumb";
      const root = document.createElement("button");
      root.type = "button";
      root.className = path ? "gdp-file-breadcrumb-part" : "gdp-file-breadcrumb-current";
      root.textContent = PROJECT_NAME || "repository";
      root.addEventListener("click", () => {
        setRoute(repoRoute(target, ""));
        loadRepo();
      });
      nav.appendChild(root);
      const parts = path ? path.split("/") : [];
      parts.forEach((part, index) => {
        const sep = document.createElement("span");
        sep.className = "gdp-file-breadcrumb-sep";
        sep.textContent = "/";
        nav.appendChild(sep);
        const currentPath = parts.slice(0, index + 1).join("/");
        const button = document.createElement("button");
        button.type = "button";
        button.className = index === parts.length - 1 ? "gdp-file-breadcrumb-current" : "gdp-file-breadcrumb-part";
        button.textContent = part;
        button.disabled = index === parts.length - 1;
        button.addEventListener("click", () => {
          setRoute(repoRoute(target, currentPath));
          loadRepo();
        });
        nav.appendChild(button);
      });
      return nav;
    }
    function renderRepo(meta) {
      PROJECT_NAME = meta.project || PROJECT_NAME;
      setPageMode();
      removeStandaloneSource();
      $("#empty").classList.add("hidden");
      $("#diff").replaceChildren();
      $("#filelist").replaceChildren();
      $("#totals").textContent = "";
      STATE.files = [];
      LOAD_QUEUE.length = 0;
      renderRepoBlobSidebar(meta.path || "", meta.ref);
      const target = $("#diff");
      const shell = document.createElement("section");
      shell.className = "gdp-repo-shell";
      const targetPicker = document.createElement("input");
      targetPicker.className = "ref-input gdp-repo-target";
      targetPicker.id = "repo-ref";
      targetPicker.readOnly = true;
      targetPicker.autocomplete = "off";
      targetPicker.value = meta.ref || "worktree";
      targetPicker.placeholder = "ref...";
      targetPicker.title = "repository ref";
      wireRepoTargetPicker(targetPicker, (ref) => {
        setRoute(repoRoute(ref, ""));
        loadRepo();
      });
      const toolbar = document.createElement("div");
      toolbar.className = "gdp-file-detail-header gdp-repo-toolbar";
      toolbar.append(createRepoBreadcrumb(meta.ref, meta.path || ""), createOpenPathButton(meta.path || "", "directory", "open this folder in OS"), targetPicker);
      shell.appendChild(toolbar);
      const listCard = document.createElement("section");
      listCard.className = "gdp-file-shell loaded gdp-repo-list-shell";
      const listWrapper = document.createElement("div");
      listWrapper.className = "d2h-file-wrapper";
      const listHeader = document.createElement("div");
      listHeader.className = "d2h-file-header";
      const listName = document.createElement("div");
      listName.className = "d2h-file-name-wrapper";
      const listIcon = document.createElement("span");
      listIcon.className = "dir-icon";
      setFolderIcon(listIcon, false);
      const listTitle = document.createElement("span");
      listTitle.className = "d2h-file-name";
      listTitle.textContent = meta.path || meta.project || "Files";
      listName.append(listIcon, listTitle);
      listHeader.appendChild(listName);
      listHeader.appendChild(createOpenPathButton(meta.path || "", "directory", "open this folder in OS"));
      listWrapper.appendChild(listHeader);
      if (meta.upload_enabled && (meta.ref === "worktree" || meta.ref === "")) {
        listWrapper.appendChild(createRepoUploadPanel(meta.path || ""));
      }
      const list = document.createElement("div");
      list.className = "gdp-source-viewer gdp-repo-file-list";
      if (meta.path) {
        const parent = meta.path.split("/").slice(0, -1).join("/");
        const row = document.createElement("button");
        row.type = "button";
        row.className = "gdp-repo-row parent";
        const parentIcon = document.createElement("span");
        parentIcon.className = "dir-icon";
        setFolderIcon(parentIcon, false);
        const parentName = document.createElement("span");
        parentName.className = "name";
        parentName.textContent = "..";
        const parentKind = document.createElement("span");
        parentKind.className = "kind";
        parentKind.textContent = "parent";
        row.append(parentIcon, parentName, parentKind);
        row.addEventListener("click", () => {
          setRoute(repoRoute(meta.ref, parent));
          loadRepo();
        });
        list.appendChild(row);
      }
      meta.entries.forEach((entry) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "gdp-repo-row " + entry.type;
        const icon = document.createElement("span");
        icon.className = entry.type === "tree" ? "dir-icon" : "d2h-icon-wrapper";
        if (entry.type === "tree")
          setFolderIcon(icon, true);
        else
          icon.innerHTML = fileEntryIcon();
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = entry.name;
        const kind = document.createElement("span");
        kind.className = "kind";
        kind.textContent = entry.type === "tree" ? "directory" : entry.type === "commit" ? "submodule" : "file";
        row.append(icon, name, kind);
        row.addEventListener("click", () => {
          if (entry.type === "tree") {
            setRoute(repoRoute(meta.ref, entry.path));
            loadRepo();
          } else if (entry.type === "blob") {
            setRoute({ screen: "file", path: entry.path, ref: meta.ref, view: "blob", range: currentRange() });
            renderStandaloneSource({ path: entry.path, ref: meta.ref });
          }
        });
        list.appendChild(row);
      });
      if (!meta.entries.length) {
        const empty = document.createElement("div");
        empty.className = "gdp-repo-empty";
        empty.textContent = "No files in this directory.";
        list.appendChild(empty);
      }
      listWrapper.appendChild(list);
      listCard.appendChild(listWrapper);
      shell.appendChild(listCard);
      if (meta.readme && meta.readme.text) {
        const readme = document.createElement("section");
        readme.className = "gdp-file-shell loaded gdp-repo-readme";
        const wrapper = document.createElement("div");
        wrapper.className = "d2h-file-wrapper";
        const readmeHeader = document.createElement("div");
        readmeHeader.className = "d2h-file-header";
        const nameWrapper = document.createElement("div");
        nameWrapper.className = "d2h-file-name-wrapper";
        const icon = document.createElement("span");
        icon.className = "d2h-icon-wrapper";
        icon.innerHTML = iconSvg("octicon-file", FILE_16_PATH);
        const name = document.createElement("span");
        name.className = "d2h-file-name";
        name.textContent = meta.readme.path;
        nameWrapper.append(icon, name);
        readmeHeader.appendChild(nameWrapper);
        wrapper.appendChild(readmeHeader);
        wrapper.appendChild(renderMarkdownPreview(meta.readme.text, { path: meta.readme.path, ref: meta.ref }, getHljs()));
        readme.appendChild(wrapper);
        shell.appendChild(readme);
      }
      target.appendChild(shell);
    }
    function renderRepoBlobSidebar(currentPath, ref) {
      syncRepoTargetInput(ref);
      const params = new URLSearchParams;
      params.set("ref", ref || "worktree");
      params.set("recursive", "1");
      return trackLoad(fetch("/_tree?" + params.toString()).then((r) => {
        if (!r.ok)
          throw new Error("failed to load repository tree");
        return r.json();
      })).then((meta) => {
        const files = meta.entries.map((entry, index) => ({
          order: index + 1,
          path: entry.path,
          display_path: entry.path,
          type: entry.type,
          children_omitted: entry.children_omitted
        }));
        renderSidebar(files, (file) => {
          if (file.type === "tree") {
            setRoute(repoRoute(ref, file.path));
            loadRepo();
            return;
          }
          setRoute({ screen: "file", path: file.path, ref, view: "blob", range: currentRange() });
          renderStandaloneSource({ path: file.path, ref });
        });
        markActive(currentPath);
        applyFilter();
      }).catch(() => {
        renderSidebar([], undefined);
        $("#totals").textContent = "Cannot load tree";
      });
    }
    function createPlaceholder(f) {
      const card = document.createElement("div");
      card.className = "gdp-file-shell pending";
      card.dataset.path = f.path;
      card.dataset.key = f.key || f.path;
      card.dataset.sizeClass = f.size_class || "small";
      card.dataset.status = f.status || "M";
      card.classList.toggle("viewed", STATE.viewedFiles.has(f.path));
      if (f.estimated_height_px) {
        card.style.minHeight = f.estimated_height_px + "px";
      }
      const head = document.createElement("div");
      head.className = "gdp-shell-header";
      head.innerHTML = '<span class="status-pill ' + escapeHtml(f.status || "M") + '">' + escapeHtml(f.status || "M") + "</span>" + '<span class="path">' + escapeHtml(f.display_path || f.path) + "</span>" + '<span class="stats">' + '<span class="a">+' + (f.additions || 0) + "</span>" + '<span class="d">−' + (f.deletions || 0) + "</span>" + "</span>" + '<span class="size-tag ' + escapeHtml(f.size_class || "") + '">' + escapeHtml(f.size_class || "") + "</span>" + '<span class="loading-indicator" hidden>loading…</span>';
      card.appendChild(head);
      const body = document.createElement("div");
      body.className = "gdp-shell-body";
      card.appendChild(body);
      return card;
    }
    function setupLazyObserver() {
      if (lazyObserver)
        lazyObserver.disconnect();
      lazyObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting)
            return;
          const card = entry.target;
          if (card.classList.contains("loaded") || card.classList.contains("loading"))
            return;
          const f = STATE.files.find((x) => x.path === card.dataset.path);
          if (!f)
            return;
          enqueueLoad(f, card, 0);
        });
      }, { rootMargin: "1200px 0px 1600px 0px" });
      document.querySelectorAll(".gdp-file-shell.pending").forEach((c) => lazyObserver.observe(c));
    }
    window.addEventListener("scroll", () => enqueueInitialLoads(), { passive: true });
    window.addEventListener("resize", () => enqueueInitialLoads(), { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden)
        enqueueInitialLoads();
    });
    function enqueueInitialLoads() {
      const viewportBottom = window.innerHeight + 1600;
      document.querySelectorAll(".gdp-file-shell.pending").forEach((card) => {
        const rect = card.getBoundingClientRect();
        if (rect.top > viewportBottom)
          return;
        const f = STATE.files.find((x) => x.path === card.dataset.path);
        if (f)
          enqueueLoad(f, card, 0);
      });
    }
    function enqueueLoad(file, card, priority) {
      if (manualLoadReason(file) && card.dataset.manualLoad !== "1") {
        renderManualLoadPlaceholder(card, file);
        return;
      }
      if (LOAD_QUEUE.find((item) => item.card === card))
        return;
      LOAD_QUEUE.push({ file, card, priority: priority || 0 });
      LOAD_QUEUE.sort((a, b) => b.priority - a.priority);
      pumpQueue();
    }
    function pumpQueue() {
      while (ACTIVE_LOADS < MAX_PARALLEL && LOAD_QUEUE.length) {
        const item = LOAD_QUEUE.shift();
        if (item.card.classList.contains("loaded") || item.card.classList.contains("loading"))
          continue;
        ACTIVE_LOADS++;
        loadFile(item.file, item.card).finally(() => {
          ACTIVE_LOADS--;
          pumpQueue();
        });
      }
    }
    function manualLoadReason(file) {
      const path = file.path || "";
      if (file.size_class === "huge")
        return "huge diff";
      if (/\.(min|bundle)\.(js|mjs|css)$/i.test(path))
        return "minified or bundled file";
      if (/\.map$/i.test(path))
        return "source map";
      if (/(^|\/)(vendor|node_modules|dist|build|out)\//i.test(path))
        return "generated or vendored path";
      return null;
    }
    function renderManualLoadPlaceholder(card, file) {
      if (card.dataset.manualRendered === "1")
        return;
      card.dataset.manualRendered = "1";
      card.classList.remove("loading");
      card.classList.add("pending", "manual-load");
      if (lazyObserver)
        lazyObserver.unobserve(card);
      const indicator = card.querySelector(".loading-indicator");
      if (indicator)
        indicator.hidden = true;
      const body = card.querySelector(".gdp-shell-body");
      body.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "gdp-manual-load";
      const note = document.createElement("div");
      note.className = "gdp-manual-note";
      note.textContent = manualLoadReason(file) + " - click to load diff";
      const previewBtn = document.createElement("button");
      previewBtn.className = "gdp-show-full";
      previewBtn.textContent = "Load preview";
      previewBtn.addEventListener("click", () => {
        body.innerHTML = "";
        card.dataset.manualLoad = "1";
        card.dataset.manualMode = "preview";
        card.classList.remove("manual-load");
        loadFile(file, card, buildPreviewUrl(file, 3));
      });
      const fullBtn = document.createElement("button");
      fullBtn.className = "gdp-show-full secondary";
      fullBtn.textContent = "Load full";
      fullBtn.addEventListener("click", () => {
        body.innerHTML = "";
        card.dataset.manualLoad = "1";
        card.dataset.manualMode = "full";
        card.classList.remove("manual-load");
        loadFile(file, card, file.load_url);
      });
      wrap.appendChild(note);
      wrap.appendChild(previewBtn);
      wrap.appendChild(fullBtn);
      body.appendChild(wrap);
    }
    function nextIdle(timeout = 500) {
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done)
            return;
          done = true;
          resolve();
        };
        const ric = window.requestIdleCallback;
        if (typeof ric === "function") {
          ric(finish, { timeout });
        } else {
          requestAnimationFrame(finish);
          setTimeout(finish, 50);
        }
      });
    }
    function loadFile(file, card, urlOverride) {
      card.classList.remove("pending");
      card.classList.add("loading");
      if (lazyObserver)
        lazyObserver.unobserve(card);
      const indicator = card.querySelector(".loading-indicator");
      if (indicator)
        indicator.hidden = false;
      const url = urlOverride || (card.dataset.manualMode === "full" ? file.load_url : file.preview_url || file.load_url);
      const myGen = SERVER_GENERATION;
      const myReq = ++CLIENT_REQ_SEQ;
      card.dataset.reqId = String(myReq);
      const retryStale = () => {
        if (String(myReq) !== card.dataset.reqId)
          return;
        card.classList.remove("loading");
        card.classList.add("pending");
        if (indicator)
          indicator.hidden = true;
        const fresh = STATE.files.find((x) => x.path === card.dataset.path);
        if (fresh && card.isConnected)
          enqueueLoad(fresh, card, 0);
      };
      return trackLoad(fetch(url).then((r) => r.json())).then(async (data) => {
        if (String(myReq) !== card.dataset.reqId)
          return;
        if (myGen !== SERVER_GENERATION) {
          retryStale();
          return;
        }
        if (data.generation && data.generation !== SERVER_GENERATION) {
          retryStale();
          return;
        }
        await nextIdle();
        if (String(myReq) !== card.dataset.reqId)
          return;
        renderFile(file, data, card);
      }).catch(() => {
        if (String(myReq) !== card.dataset.reqId)
          return;
        card.classList.remove("loading");
        card.classList.add("error");
        const body = card.querySelector(".gdp-shell-body");
        body.innerHTML = '<div class="gdp-error">failed to load — <button class="retry">retry</button></div>';
        const btn = body.querySelector(".retry");
        if (btn)
          btn.addEventListener("click", () => {
            card.classList.remove("error");
            card.classList.add("pending");
            body.innerHTML = "";
            enqueueLoad(file, card, 1);
          });
      });
    }
    function mountDiff(card, file, data) {
      const head = card.querySelector(".gdp-shell-header");
      if (head)
        head.style.display = "none";
      const body = card.querySelector(".gdp-shell-body");
      body.innerHTML = "";
      if (!data.diff || !data.diff.trim()) {
        body.innerHTML = '<div class="gdp-info">No content</div>';
        return;
      }
      const layout = file.force_layout || STATE.layout;
      const hljsRef = getHljs();
      const ui = new Diff2HtmlUI(body, data.diff, {
        drawFileList: false,
        matching: "lines",
        outputFormat: layout,
        synchronisedScroll: true,
        highlight: !!(STATE.syntaxHighlight && file.highlight && hljsRef),
        fileListToggle: false,
        fileContentToggle: false
      }, hljsRef);
      ui.draw();
      if (STATE.ignoreWs)
        suppressWhitespaceOnlyInlineHighlights(body);
      if (STATE.syntaxHighlight && file.highlight && hljsRef && typeof ui.highlightCode === "function")
        ui.highlightCode();
      enhanceMediaCard(file, card);
      syncSideScrollCard(card);
      appendStatSquaresToHeader(card, file);
      setupHunkExpand(card, file);
    }
    function parseHunkHeader(text) {
      const m = (text || "").match(/@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!m)
        return null;
      return {
        oldStart: +m[1],
        oldCount: m[2] ? +m[2] : 1,
        newStart: +m[3],
        newCount: m[4] ? +m[4] : 1
      };
    }
    function nextNewLine(hunk) {
      return hunk.newStart + hunk.newCount;
    }
    function nextOldLine(hunk) {
      return hunk.oldStart + hunk.oldCount;
    }
    function setupHunkExpand(card, file) {
      if (file.binary)
        return;
      if (file.media_kind)
        return;
      const infoRows = [];
      const tables = card.querySelectorAll("table.d2h-diff-table");
      if (tables.length === 0)
        return;
      const perTable = [];
      tables.forEach((tbl) => {
        const arr = [];
        tbl.querySelectorAll("tr").forEach((tr) => {
          const info = tr.querySelector("td.d2h-info:not(.d2h-code-linenumber):not(.d2h-code-side-linenumber)");
          if (!info)
            return;
          const txt = (info.textContent || "").trim();
          arr.push({ tr, info, hunk: parseHunkHeader(txt) });
        });
        perTable.push(arr);
      });
      const base = perTable.find((arr) => arr.some((x) => x.hunk)) || perTable[0] || [];
      const usedTrs = new WeakSet;
      base.forEach((baseItem) => {
        const top = baseItem.tr.getBoundingClientRect().top;
        const group = perTable.map((arr, tableIndex) => {
          let best = null, bestD = Infinity;
          for (const item of arr) {
            if (usedTrs.has(item.tr))
              continue;
            const d = Math.abs(item.tr.getBoundingClientRect().top - top);
            if (d < bestD) {
              best = item;
              bestD = d;
            }
          }
          if (!best || bestD >= 12)
            return null;
          usedTrs.add(best.tr);
          return Object.assign({ sideIndex: tableIndex }, best);
        }).filter(Boolean);
        if (!group.length)
          return;
        const parsed = group.find((g) => g.hunk) || group[0];
        if (!parsed.hunk)
          return;
        group.forEach((g) => g.tr.classList.add("gdp-hunk-row"));
        infoRows.push({
          tr: parsed.tr,
          info: parsed.info,
          hunk: parsed.hunk,
          siblings: group,
          prevHunkEndNew: 0,
          prevHunkEndOld: 0
        });
      });
      for (let i = 1;i < infoRows.length; i++) {
        const prev = infoRows[i - 1].hunk;
        infoRows[i].prevHunkEndNew = nextNewLine(prev);
        infoRows[i].prevHunkEndOld = nextOldLine(prev);
      }
      const ref = STATE.to && STATE.to !== "worktree" ? STATE.to : "worktree";
      const refPath = encodeURIComponent(file.path);
      for (const item of infoRows) {
        attachExpandControls(item, file, ref, refPath);
      }
    }
    function attachExpandControls(item, file, ref, refPath) {
      const { hunk, prevHunkEndNew, prevHunkEndOld } = item;
      const fullGapStart = Math.max(1, prevHunkEndNew);
      const fullGapEnd = hunk.newStart - 1;
      if (fullGapStart > fullGapEnd) {
        for (const sib of item.siblings || [{ tr: item.tr }]) {
          sib.tr.style.display = "none";
        }
        return;
      }
      const L = window.GdpExpandLogic;
      if (item.topExpandedStart == null || item.bottomExpandedEnd == null) {
        const init = L.initExpandState(prevHunkEndNew, hunk.newStart);
        item.topExpandedStart = init.topExpandedStart;
        item.bottomExpandedEnd = init.bottomExpandedEnd;
      }
      const gap = L.remainingGap({
        topExpandedStart: item.topExpandedStart,
        bottomExpandedEnd: item.bottomExpandedEnd
      }, prevHunkEndNew);
      if (!gap) {
        for (const sib of item.siblings || [{ tr: item.tr }]) {
          sib.tr.style.display = "none";
        }
        return;
      }
      const remainingStart = gap.start;
      const remainingEnd = gap.end;
      const setBusy = (busy) => {
        for (const sib of item.siblings || [{ tr: item.tr }]) {
          sib.tr.querySelectorAll(".gdp-expand-btn").forEach((b) => {
            b.disabled = busy;
          });
        }
      };
      const fetchAndInsert = (start, end, dir) => {
        if (start < 1)
          start = 1;
        if (end < start)
          return;
        setBusy(true);
        const url = "/file_range?path=" + refPath + "&ref=" + encodeURIComponent(ref) + "&start=" + start + "&end=" + end;
        trackLoad(fetch(url).then((r) => r.json())).then((data) => {
          if (!data || !data.lines) {
            setBusy(false);
            return;
          }
          const oldStartForGap = prevHunkEndOld + (start - prevHunkEndNew);
          const card = item.tr.closest(".d2h-file-wrapper");
          const sibs = item.siblings || [{ tr: item.tr, sideIndex: 0 }];
          sibs.forEach((sib) => {
            insertContextRows(sib.tr, data.lines, start, oldStartForGap, dir, sib.sideIndex || 0);
          });
          if (card)
            highlightInsertedSpans(card, file);
          if (dir === "after")
            item.topExpandedStart = start;
          else
            item.bottomExpandedEnd = end;
          for (const sib of item.siblings || [{ tr: item.tr }]) {
            const ln = sib.tr.querySelector(".d2h-code-linenumber.d2h-info, .d2h-code-side-linenumber.d2h-info");
            const old = ln && ln.querySelector(".gdp-expand-stack");
            if (old)
              old.remove();
          }
          attachExpandControls(item, file, ref, refPath);
        }).catch(() => {
          setBusy(false);
        });
      };
      const STEP = 20;
      const remainingSize = remainingEnd - remainingStart + 1;
      const isFirst = prevHunkEndNew === 0;
      const buildStack = () => {
        const buttons = [];
        if (isFirst) {
          buttons.push({
            direction: "up",
            title: "Show " + Math.min(STEP, remainingSize) + " more lines",
            onClick: () => fetchAndInsert(Math.max(remainingStart, remainingEnd - STEP + 1), remainingEnd, "after")
          });
        } else {
          buttons.push({
            direction: "up",
            title: "Show " + Math.min(STEP, remainingSize) + " more lines",
            onClick: () => fetchAndInsert(remainingStart, Math.min(remainingEnd, remainingStart + STEP - 1), "before")
          });
          buttons.push({
            direction: "down",
            title: "Show " + Math.min(STEP, remainingSize) + " more lines",
            onClick: () => fetchAndInsert(Math.max(remainingStart, remainingEnd - STEP + 1), remainingEnd, "after")
          });
        }
        return createExpandStack(buttons);
      };
      const siblings = item.siblings || [{ tr: item.tr }];
      siblings.forEach((sib) => {
        const ln = sib.tr.querySelector(".d2h-code-linenumber.d2h-info, .d2h-code-side-linenumber.d2h-info");
        if (ln && !ln.querySelector(".gdp-expand-stack")) {
          ln.appendChild(buildStack());
        }
      });
      const firstSib = siblings[0];
      if (firstSib) {
        syncExpandRowHeights(siblings.map((sib) => sib.tr), firstSib.tr);
      }
    }
    const EXPAND_ICON_PATHS = {
      up: "M8 3.5 3.75 7.75l1.06 1.06L7.25 6.37V13h1.5V6.37l2.44 2.44 1.06-1.06L8 3.5z",
      down: "M8 12.5 12.25 8.25l-1.06-1.06L8.75 9.63V3h-1.5v6.63L4.81 7.19 3.75 8.25 8 12.5z"
    };
    function createExpandStack(buttons) {
      const stack = document.createElement("div");
      stack.className = "gdp-expand-stack";
      buttons.forEach((spec) => {
        const button = document.createElement("button");
        button.className = "gdp-expand-btn";
        button.title = spec.title;
        button.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' + '<path fill="currentColor" d="' + EXPAND_ICON_PATHS[spec.direction] + '"/></svg>';
        button.addEventListener("click", (e) => {
          e.stopPropagation();
          if (button.disabled)
            return;
          spec.onClick();
        });
        stack.appendChild(button);
      });
      return stack;
    }
    function syncExpandRowHeights(rows, stackRow) {
      const syncHeight = () => {
        const stack = stackRow.querySelector(".gdp-expand-stack");
        const targetH = stack ? Math.max(20, stack.getBoundingClientRect().height) : 20;
        rows.forEach((row) => row.style.setProperty("height", targetH + "px", "important"));
      };
      requestAnimationFrame(syncHeight);
      setTimeout(syncHeight, 100);
    }
    function attachTrailingExpandControls(item, file, ref, refPath) {
      const STEP = 20;
      let nextNewStart = nextNewLine(item.hunk);
      let nextOldStart = nextOldLine(item.hunk);
      const rows = (item.siblings || [{ tr: item.tr, sideIndex: 0 }]).map((sib) => {
        const tbody = sib.tr.parentElement;
        if (!tbody)
          return null;
        const isSplit = !!sib.tr.querySelector("td.d2h-code-side-linenumber");
        const tr = document.createElement("tr");
        tr.className = "gdp-hunk-row gdp-trailing-expand-row";
        const ln = document.createElement("td");
        ln.className = isSplit ? "d2h-code-side-linenumber d2h-info" : "d2h-code-linenumber d2h-info";
        const info = document.createElement("td");
        info.className = "d2h-info";
        const spacer = document.createElement("div");
        spacer.className = isSplit ? "d2h-code-side-line" : "d2h-code-line";
        info.appendChild(spacer);
        tr.appendChild(ln);
        tr.appendChild(info);
        tbody.appendChild(tr);
        return { tr, ln, sideIndex: sib.sideIndex || 0 };
      }).filter(Boolean);
      if (!rows.length)
        return;
      const setBusy = (busy) => {
        rows.forEach((row) => row.ln.querySelectorAll(".gdp-expand-btn").forEach((btn) => {
          btn.disabled = busy;
        }));
      };
      const fetchAndInsert = () => {
        const range = window.GdpExpandLogic.trailingClickRange(nextNewStart, STEP);
        setBusy(true);
        const url = "/file_range?path=" + refPath + "&ref=" + encodeURIComponent(ref) + "&start=" + range.start + "&end=" + range.end;
        trackLoad(fetch(url).then((r) => r.json())).then((data) => {
          const lines = data && data.lines || [];
          if (!lines.length) {
            rows.forEach((row) => row.tr.remove());
            return;
          }
          const card = item.tr.closest(".d2h-file-wrapper");
          rows.forEach((row) => insertContextRows(row.tr, lines, range.start, nextOldStart, "before", row.sideIndex));
          const next = window.GdpExpandLogic.applyTrailingResult({ newStart: nextNewStart, oldStart: nextOldStart }, lines.length, STEP);
          nextNewStart = next.newStart;
          nextOldStart = next.oldStart;
          if (card)
            highlightInsertedSpans(card, file);
          if (next.eof) {
            rows.forEach((row) => row.tr.remove());
            return;
          }
          setBusy(false);
        }).catch(() => {
          setBusy(false);
        });
      };
      rows.forEach((row) => {
        row.ln.appendChild(createExpandStack([{ direction: "down", title: "Show more lines", onClick: fetchAndInsert }]));
      });
      syncExpandRowHeights(rows.map((row) => row.tr), rows[0].tr);
    }
    function insertContextRows(targetTr, lines, newStart, oldStart, dir, sideIndex) {
      const tbody = targetTr.parentElement;
      if (!tbody)
        return;
      const anchor = dir === "after" ? targetTr.nextElementSibling : targetTr;
      const isSplit = !!targetTr.querySelector("td.d2h-code-side-linenumber");
      const frag = document.createDocumentFragment();
      for (let i = 0;i < lines.length; i++) {
        const tr = document.createElement("tr");
        tr.className = "gdp-inserted-ctx";
        if (dir)
          tr.dataset.gdpDir = dir;
        let lnHtml;
        if (isSplit) {
          const num = sideIndex === 0 ? oldStart + i : newStart + i;
          lnHtml = '<td class="d2h-code-side-linenumber d2h-cntx">' + num + "</td>";
        } else {
          lnHtml = '<td class="d2h-code-linenumber d2h-cntx">' + '<div class="line-num1">' + (oldStart + i) + "</div>" + '<div class="line-num2">' + (newStart + i) + "</div>" + "</td>";
        }
        tr.innerHTML = lnHtml + '<td class="d2h-cntx">' + '<div class="' + (isSplit ? "d2h-code-side-line" : "d2h-code-line") + '">' + '<span class="d2h-code-line-prefix">&nbsp;</span>' + '<span class="d2h-code-line-ctn">' + escapeHtmlText(lines[i]) + "</span>" + "</div>" + "</td>";
        frag.appendChild(tr);
      }
      tbody.insertBefore(frag, anchor);
    }
    function escapeHtmlText(s) {
      return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function setFileCollapsed(card, collapsed) {
      card.classList.toggle("gdp-file-collapsed", collapsed);
      card.querySelectorAll(".d2h-files-diff, .d2h-file-diff, .gdp-source-viewer, .gdp-media").forEach((body) => {
        body.classList.toggle("d2h-d-none", collapsed);
      });
      const button = card.querySelector(".gdp-file-toggle");
      if (button) {
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
        button.title = collapsed ? "Expand file" : "Collapse file";
      }
      const unfold = card.querySelector(".gdp-file-unfold");
      if (unfold)
        unfold.disabled = collapsed;
      const viewFile = card.querySelector(".gdp-view-file");
      if (viewFile)
        viewFile.disabled = collapsed;
    }
    function setViewFileButtonState(button, sourceMode) {
      if (!button)
        return;
      button.classList.add("gdp-btn", "gdp-btn-sm");
      button.textContent = sourceMode ? "View Diff" : "View File";
      button.setAttribute("aria-pressed", sourceMode ? "true" : "false");
      button.title = sourceMode ? "View diff" : "View file";
    }
    function renderSourceLoading(card, target) {
      const body = card.querySelector(".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer");
      const view = document.createElement("div");
      view.className = "gdp-source-viewer loading";
      view.textContent = "Loading " + target.path + " at " + target.ref + "...";
      if (body)
        body.replaceWith(view);
      else
        card.appendChild(view);
    }
    function renderSourceError(card, target, message) {
      const body = card.querySelector(".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer");
      const view = document.createElement("div");
      view.className = "gdp-source-viewer error";
      view.textContent = message || "Cannot load " + target.path + " at " + target.ref;
      if (body)
        body.replaceWith(view);
      else
        card.appendChild(view);
    }
    function isPreviewableSource(path) {
      return /\.(md|markdown|mdown|mkdn|mdx)$/i.test(path);
    }
    function appendInlineMarkdown(parent, text) {
      const parts = text.split(/(`[^`]+`)/g);
      parts.forEach((part) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
          const code = document.createElement("code");
          code.textContent = part.slice(1, -1);
          parent.appendChild(code);
        } else {
          parent.appendChild(document.createTextNode(part));
        }
      });
    }
    function appendMarkdownParagraph(markdown, lines) {
      if (!lines.length)
        return;
      const p = document.createElement("p");
      appendInlineMarkdown(p, lines.join(" ").trim());
      markdown.appendChild(p);
    }
    function renderMarkdownPreview(textValue, target, hljsRef) {
      const markdown = document.createElement("div");
      markdown.className = "gdp-markdown-preview markdown-body";
      const lines = textValue.replace(/\r\n/g, `
`).replace(/\r/g, `
`).split(`
`);
      let paragraph = [];
      let list = null;
      const flushParagraph = () => {
        appendMarkdownParagraph(markdown, paragraph);
        paragraph = [];
      };
      const flushList = () => {
        list = null;
      };
      for (let i = 0;i < lines.length; i++) {
        const line = lines[i];
        const fence = line.match(/^```(\S*)\s*$/);
        if (fence) {
          flushParagraph();
          flushList();
          const codeLines = [];
          i++;
          while (i < lines.length && !/^```\s*$/.test(lines[i])) {
            codeLines.push(lines[i]);
            i++;
          }
          const pre = document.createElement("pre");
          const code = document.createElement("code");
          const lang = fence[1] || inferLang(target.path) || "";
          const raw = codeLines.join(`
`);
          if (hljsRef && hljsRef.highlight && lang && (!hljsRef.getLanguage || hljsRef.getLanguage(lang))) {
            try {
              code.innerHTML = hljsRef.highlight(raw, { language: lang, ignoreIllegals: true }).value;
              code.classList.add("hljs");
            } catch {
              code.textContent = raw;
            }
          } else {
            code.textContent = raw;
          }
          pre.appendChild(code);
          markdown.appendChild(pre);
          continue;
        }
        if (!line.trim()) {
          flushParagraph();
          flushList();
          continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          flushParagraph();
          flushList();
          const level = String(Math.min(heading[1].length, 6));
          const h = document.createElement("h" + level);
          appendInlineMarkdown(h, heading[2]);
          markdown.appendChild(h);
          continue;
        }
        if (/^\s*---+\s*$/.test(line)) {
          flushParagraph();
          flushList();
          markdown.appendChild(document.createElement("hr"));
          continue;
        }
        const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
        const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
        if (bullet || ordered) {
          flushParagraph();
          const tag = ordered ? "ol" : "ul";
          if (!list || list.tagName.toLowerCase() !== tag) {
            list = document.createElement(tag);
            markdown.appendChild(list);
          }
          const li = document.createElement("li");
          appendInlineMarkdown(li, (bullet || ordered)[1]);
          list.appendChild(li);
          continue;
        }
        const quote = line.match(/^\s*>\s?(.*)$/);
        if (quote) {
          flushParagraph();
          flushList();
          const blockquote = document.createElement("blockquote");
          appendInlineMarkdown(blockquote, quote[1]);
          markdown.appendChild(blockquote);
          continue;
        }
        flushList();
        paragraph.push(line);
      }
      flushParagraph();
      return markdown;
    }
    async function renderSourceText(card, target, textValue) {
      const lines = textValue.length ? textValue.replace(/\r\n/g, `
`).replace(/\r/g, `
`).split(`
`) : [""];
      const body = card.querySelector(".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer");
      const isStandalone = card.classList.contains("gdp-standalone-source");
      const view = document.createElement("div");
      view.className = "gdp-source-viewer";
      const header = isStandalone ? null : document.createElement("div");
      if (header) {
        header.className = "gdp-source-meta";
        header.textContent = target.path + " @ " + target.ref;
      }
      const table = document.createElement("table");
      table.className = "gdp-source-table";
      const tbody = document.createElement("tbody");
      const hljsRef = await loadSyntaxHighlighter();
      const lang = inferLang(target.path);
      lines.forEach((line, index) => {
        const tr = document.createElement("tr");
        const num = document.createElement("td");
        num.className = "gdp-source-line-number";
        num.textContent = String(index + 1);
        const code = document.createElement("td");
        code.className = "gdp-source-line-code";
        if (hljsRef && hljsRef.highlight && lang && (!hljsRef.getLanguage || hljsRef.getLanguage(lang))) {
          try {
            code.innerHTML = hljsRef.highlight(line || " ", { language: lang, ignoreIllegals: true }).value;
            code.classList.add("hljs");
          } catch {
            code.textContent = line || " ";
          }
        } else {
          code.textContent = line || " ";
        }
        tr.appendChild(num);
        tr.appendChild(code);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      if (isPreviewableSource(target.path)) {
        const tabsHost = card.querySelector(".gdp-file-detail-tabs");
        const tabs = document.createElement("div");
        tabs.className = "gdp-source-tabs";
        const previewButton = document.createElement("button");
        previewButton.type = "button";
        previewButton.className = "active";
        previewButton.textContent = "Preview";
        const codeButton = document.createElement("button");
        codeButton.type = "button";
        codeButton.textContent = "Code";
        const preview = renderMarkdownPreview(textValue, target, hljsRef);
        table.hidden = true;
        previewButton.addEventListener("click", () => {
          previewButton.classList.add("active");
          codeButton.classList.remove("active");
          preview.hidden = false;
          table.hidden = true;
        });
        codeButton.addEventListener("click", () => {
          codeButton.classList.add("active");
          previewButton.classList.remove("active");
          preview.hidden = true;
          table.hidden = false;
        });
        tabs.appendChild(previewButton);
        tabs.appendChild(codeButton);
        if (header)
          view.appendChild(header);
        if (tabsHost) {
          tabsHost.hidden = false;
          tabsHost.replaceChildren(tabs);
        }
        view.appendChild(preview);
        view.appendChild(table);
        if (body)
          body.replaceWith(view);
        else
          card.appendChild(view);
        return;
      }
      if (header)
        view.appendChild(header);
      view.appendChild(table);
      if (body)
        body.replaceWith(view);
      else
        card.appendChild(view);
    }
    function renderSourceMedia(card, target, mediaKind) {
      const body = card.querySelector(".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer");
      const isStandalone = card.classList.contains("gdp-standalone-source");
      const view = document.createElement("div");
      view.className = "gdp-source-viewer media";
      if (!isStandalone) {
        const meta = document.createElement("div");
        meta.className = "gdp-source-meta";
        meta.textContent = target.path + " @ " + target.ref;
        view.appendChild(meta);
      }
      const url = buildRawFileUrl(target);
      if (mediaKind === "video") {
        const video = document.createElement("video");
        video.src = url;
        video.controls = true;
        video.preload = "metadata";
        view.appendChild(video);
      } else {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        view.appendChild(img);
      }
      if (body)
        body.replaceWith(view);
      else
        card.appendChild(view);
    }
    function renderSourceBinary(card, target) {
      const body = card.querySelector(".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer");
      const isStandalone = card.classList.contains("gdp-standalone-source");
      const view = document.createElement("div");
      view.className = "gdp-source-viewer binary";
      const link = document.createElement("a");
      link.href = buildRawFileUrl(target);
      link.textContent = "Open raw file";
      link.target = "_blank";
      link.rel = "noreferrer";
      if (!isStandalone) {
        const meta = document.createElement("div");
        meta.className = "gdp-source-meta";
        meta.textContent = target.path + " @ " + target.ref;
        view.appendChild(meta);
      }
      view.appendChild(link);
      if (body)
        body.replaceWith(view);
      else
        card.appendChild(view);
    }
    function createFileBreadcrumb(path, ref) {
      const nav = document.createElement("nav");
      nav.className = "gdp-file-breadcrumb";
      nav.setAttribute("aria-label", "File path");
      const parts = path.split("/").filter(Boolean);
      const allParts = PROJECT_NAME ? [PROJECT_NAME, ...parts] : parts;
      allParts.forEach((part, index) => {
        if (index > 0) {
          const sep = document.createElement("span");
          sep.className = "gdp-file-breadcrumb-sep";
          sep.textContent = "/";
          nav.appendChild(sep);
        }
        const isCurrent = index === allParts.length - 1;
        const crumb = document.createElement(isCurrent ? "span" : "button");
        crumb.className = index === allParts.length - 1 ? "gdp-file-breadcrumb-current" : "gdp-file-breadcrumb-part";
        crumb.textContent = part;
        if (!isCurrent && crumb instanceof HTMLButtonElement) {
          crumb.type = "button";
          crumb.addEventListener("click", () => {
            const projectOffset = PROJECT_NAME ? 1 : 0;
            const currentPath = parts.slice(0, Math.max(0, index - projectOffset + 1)).join("/");
            setRoute(repoRoute(ref || "worktree", currentPath));
            loadRepo();
          });
        }
        nav.appendChild(crumb);
      });
      if (!allParts.length) {
        const crumb = document.createElement("span");
        crumb.className = "gdp-file-breadcrumb-current";
        crumb.textContent = path;
        nav.appendChild(crumb);
      }
      return nav;
    }
    async function renderStandaloneSource(target) {
      const req = ++SOURCE_REQ_SEQ;
      const root = $("#diff");
      const repoTarget = repoFileTargetFromRoute();
      setPageMode();
      removeStandaloneSource();
      document.querySelectorAll(".gdp-repo-blob-layout").forEach((el) => el.remove());
      const card = document.createElement("article");
      card.className = "gdp-file-shell loaded gdp-standalone-source gdp-source-mode";
      card.dataset.path = target.path;
      const wrapper = document.createElement("div");
      wrapper.className = "gdp-file-detail-wrapper";
      const sticky = document.createElement("div");
      sticky.className = "gdp-file-detail-sticky";
      const header = document.createElement("div");
      header.className = "gdp-file-detail-header";
      const name = document.createElement("div");
      name.className = "gdp-file-detail-path";
      name.appendChild(createFileBreadcrumb(target.path, target.ref));
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "gdp-file-header-icon gdp-copy-path";
      copy.title = "copy file path";
      copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
      copy.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(target.path);
          copy.classList.add("copied");
          setTimeout(() => {
            copy.classList.remove("copied");
          }, 1200);
        } catch {
          copy.classList.add("failed");
          setTimeout(() => {
            copy.classList.remove("failed");
          }, 1200);
        }
      });
      name.appendChild(copy);
      name.appendChild(createOpenPathButton(target.path, "file-parent", "open parent folder in OS"));
      header.appendChild(name);
      if (!repoTarget) {
        const back = document.createElement("button");
        back.type = "button";
        back.className = "gdp-view-file gdp-btn gdp-btn-sm";
        setViewFileButtonState(back, true);
        back.addEventListener("click", () => {
          setRoute({ screen: "diff", range: currentRange() });
          setPageMode();
          removeStandaloneSource();
        });
        header.appendChild(back);
      }
      sticky.appendChild(header);
      const tabsHost = document.createElement("div");
      tabsHost.className = "gdp-file-detail-tabs";
      tabsHost.hidden = true;
      sticky.appendChild(tabsHost);
      wrapper.appendChild(sticky);
      const detailBody = document.createElement("div");
      detailBody.className = "gdp-file-detail-body";
      wrapper.appendChild(detailBody);
      card.appendChild(wrapper);
      if (repoTarget) {
        const layout = document.createElement("div");
        layout.className = "gdp-repo-blob-layout";
        renderRepoBlobSidebar(target.path, repoTarget);
        layout.appendChild(card);
        root.replaceChildren(layout);
      } else {
        root.prepend(card);
      }
      renderSourceLoading(card, target);
      try {
        const mediaKind = isVideo(target.path) ? "video" : isMedia(target.path) ? "image" : null;
        if (mediaKind === "image" || mediaKind === "video") {
          if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target))
            return;
          renderSourceMedia(card, target, mediaKind);
          return;
        }
        const response = await trackLoad(fetch(buildRawFileUrl(target)));
        if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target))
          return;
        if (!response.ok) {
          renderSourceError(card, target, "Cannot load " + target.path + " at " + target.ref);
          return;
        }
        const textValue = await response.text();
        if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target))
          return;
        await renderSourceText(card, target, textValue);
      } catch {
        if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target))
          return;
        renderSourceError(card, target, "Cannot load " + target.path + " at " + target.ref);
      }
    }
    function applySourceRouteToShell() {
      const target = sourceTargetFromRoute();
      setPageMode();
      if (!target) {
        removeStandaloneSource();
        document.querySelectorAll(".gdp-view-file").forEach((button) => {
          setViewFileButtonState(button, false);
        });
        return;
      }
      renderStandaloneSource(target);
    }
    async function expandAllFileContext(card, file) {
      if (card.classList.contains("gdp-context-expanded")) {
        const data = card._diffData;
        if (!data)
          return;
        card.classList.remove("gdp-context-expanded");
        mountDiff(card, file, data);
        if (data.truncated && data.mode === "preview")
          addExpandHunksUI(file, data, card);
        scheduleIdleHighlight(card, file);
        setUnfoldButtonState(card.querySelector(".gdp-file-unfold"), false);
        return;
      }
      if (card._diffData && (card._diffData.truncated || card._diffData.mode === "preview")) {
        await loadFile(file, card, file.load_url);
        card.classList.add("gdp-context-expanded");
        setUnfoldButtonState(card.querySelector(".gdp-file-unfold"), true);
        return;
      }
      const button = card.querySelector(".gdp-file-unfold");
      if (button)
        button.disabled = true;
      try {
        for (let i = 0;i < 200; i++) {
          const next = card.querySelector(".gdp-expand-btn:not(:disabled)");
          if (!next)
            break;
          next.click();
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        card.classList.add("gdp-context-expanded");
        setUnfoldButtonState(button || null, true);
      } finally {
        if (button)
          button.disabled = false;
      }
    }
    function appendStatSquaresToHeader(card, file) {
      const header = card.querySelector(".d2h-file-header");
      if (!header)
        return;
      if (!header.querySelector(".gdp-file-toggle")) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "gdp-file-header-icon gdp-file-toggle";
        toggle.title = "Collapse file";
        toggle.setAttribute("aria-expanded", "true");
        toggle.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
        toggle.addEventListener("click", (e) => {
          e.stopPropagation();
          setFileCollapsed(card, !card.classList.contains("gdp-file-collapsed"));
        });
        header.insertBefore(toggle, header.firstChild);
      }
      header.querySelectorAll(".d2h-file-collapse-input").forEach((checkbox) => {
        checkbox.checked = STATE.viewedFiles.has(file.path);
        if (checkbox.dataset.gdpBound !== "1") {
          checkbox.dataset.gdpBound = "1";
          checkbox.addEventListener("change", () => setFileViewed(file.path, checkbox.checked));
        }
      });
      if (!header.querySelector(".gdp-copy-path")) {
        const nameWrapper = header.querySelector(".d2h-file-name-wrapper");
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "gdp-file-header-icon gdp-copy-path";
        copy.title = "copy file path";
        copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
        copy.addEventListener("click", async (e) => {
          e.stopPropagation();
          const path = filePathClipboardText(file.path);
          if (!path)
            return;
          try {
            await navigator.clipboard.writeText(path);
            copy.classList.add("copied");
            setTimeout(() => {
              copy.classList.remove("copied");
            }, 1200);
          } catch {
            copy.classList.add("failed");
            setTimeout(() => {
              copy.classList.remove("failed");
            }, 1200);
          }
        });
        const statusTag = nameWrapper ? nameWrapper.querySelector(".d2h-tag") : null;
        if (statusTag)
          statusTag.insertAdjacentElement("afterend", copy);
        else if (nameWrapper)
          nameWrapper.insertAdjacentElement("beforeend", copy);
        else
          header.insertBefore(copy, header.firstChild);
      }
      if (!header.querySelector(".gdp-file-unfold")) {
        const unfold = document.createElement("button");
        unfold.type = "button";
        unfold.className = "gdp-file-header-icon gdp-file-unfold";
        setUnfoldButtonState(unfold, card.classList.contains("gdp-context-expanded"));
        unfold.addEventListener("click", (e) => {
          e.stopPropagation();
          expandAllFileContext(card, file);
        });
        const copy = header.querySelector(".gdp-copy-path");
        if (copy)
          copy.insertAdjacentElement("afterend", unfold);
        else
          header.appendChild(unfold);
      }
      if (!header.querySelector(".gdp-open-path")) {
        const unfold = header.querySelector(".gdp-file-unfold");
        const openPath = createOpenPathButton(file.path, "file-parent", "open parent folder in OS");
        if (unfold)
          unfold.insertAdjacentElement("afterend", openPath);
        else
          header.appendChild(openPath);
      }
      if (!header.querySelector(".gdp-stat-text")) {
        const stats = document.createElement("span");
        stats.className = "gdp-stat-text";
        stats.innerHTML = '<span class="a">+' + (file.additions || 0) + "</span>" + '<span class="d">−' + (file.deletions || 0) + "</span>";
        header.appendChild(stats);
      }
      const total = (file.additions || 0) + (file.deletions || 0);
      const SEG = 5;
      let aSeg, dSeg;
      if (total === 0) {
        aSeg = 0;
        dSeg = 0;
      } else {
        aSeg = Math.round(file.additions / total * SEG);
        dSeg = Math.max(0, SEG - aSeg);
        if (file.additions > 0 && aSeg === 0)
          aSeg = 1;
        if (file.deletions > 0 && dSeg === 0)
          dSeg = 1;
        const over = aSeg + dSeg - SEG;
        if (over > 0)
          dSeg -= over;
      }
      const wrap = document.createElement("span");
      wrap.className = "gdp-stat-squares";
      for (let i = 0;i < SEG; i++) {
        const box = document.createElement("span");
        if (i < aSeg)
          box.className = "sq add";
        else if (i < aSeg + dSeg)
          box.className = "sq del";
        else
          box.className = "sq nu";
        wrap.appendChild(box);
      }
      header.appendChild(wrap);
      if (!header.querySelector(".gdp-view-file")) {
        const viewFile = document.createElement("button");
        viewFile.type = "button";
        viewFile.className = "gdp-view-file gdp-btn gdp-btn-sm";
        setViewFileButtonState(viewFile, false);
        viewFile.addEventListener("click", (e) => {
          e.stopPropagation();
          const target = fileSourceTarget(file);
          setRoute({ screen: "file", path: target.path, ref: target.ref, range: currentRange() });
          applySourceRouteToShell();
        });
        header.appendChild(viewFile);
      } else {
        setViewFileButtonState(header.querySelector(".gdp-view-file"), false);
      }
    }
    function renderFile(file, data, card) {
      card._diffData = data;
      card._file = file;
      card.classList.remove("loading", "pending");
      card.classList.add("loaded");
      card.style.minHeight = "";
      mountDiff(card, file, data);
      card.style.containIntrinsicSize = Math.max(card.offsetHeight, file.estimated_height_px || 200) + "px";
      if (data.truncated && data.mode === "preview") {
        addExpandHunksUI(file, data, card);
      }
      scheduleIdleHighlight(card, file);
    }
    function buildPreviewUrl(file, hunks) {
      const u = new URL(file.load_url, window.location.origin);
      u.searchParams.set("mode", "preview");
      u.searchParams.set("max_hunks", String(hunks));
      return u.pathname + u.search;
    }
    function addExpandHunksUI(file, data, card) {
      const total = data.hunk_count || 0;
      const rendered = data.rendered_hunk_count || 0;
      const remaining = total - rendered;
      if (remaining <= 0)
        return;
      const old = card.querySelector(".gdp-show-full-wrap");
      if (old)
        old.remove();
      const wrap = document.createElement("div");
      wrap.className = "gdp-show-full-wrap";
      const step = Math.min(10, remaining);
      const moreBtn = document.createElement("button");
      moreBtn.className = "gdp-show-full";
      moreBtn.textContent = "Show next " + step + " hunk" + (step === 1 ? "" : "s");
      moreBtn.addEventListener("click", () => loadMore(rendered + step, false));
      const allBtn = document.createElement("button");
      allBtn.className = "gdp-show-full secondary";
      allBtn.textContent = "Show all (" + remaining + " remaining)";
      allBtn.addEventListener("click", () => loadMore(total, true));
      const note = document.createElement("span");
      note.className = "gdp-hunk-note";
      note.textContent = rendered + " / " + total + " hunks shown";
      wrap.appendChild(note);
      wrap.appendChild(moreBtn);
      wrap.appendChild(allBtn);
      card.appendChild(wrap);
      function loadMore(count, full) {
        moreBtn.disabled = allBtn.disabled = true;
        moreBtn.textContent = "Loading…";
        const myGen = SERVER_GENERATION;
        const url = full ? file.load_url : buildPreviewUrl(file, count);
        trackLoad(fetch(url).then((r) => r.json())).then((next) => {
          if (myGen !== SERVER_GENERATION) {
            moreBtn.textContent = "Data changed — reload";
            moreBtn.disabled = allBtn.disabled = false;
            return;
          }
          wrap.remove();
          card._diffData = next;
          mountDiff(card, file, next);
          if (next.truncated || next.mode === "preview" && next.hunk_count > next.rendered_hunk_count) {
            addExpandHunksUI(file, next, card);
          }
        }).catch(() => {
          moreBtn.disabled = allBtn.disabled = false;
          moreBtn.textContent = "Failed — retry";
        });
      }
    }
    const EXT_TO_LANG = {
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      ts: "typescript",
      tsx: "typescript",
      jsx: "javascript",
      py: "python",
      rb: "ruby",
      go: "go",
      rs: "rust",
      java: "java",
      kt: "kotlin",
      swift: "swift",
      c: "c",
      h: "c",
      cc: "cpp",
      cpp: "cpp",
      hpp: "cpp",
      cs: "csharp",
      php: "php",
      lua: "lua",
      sh: "bash",
      bash: "bash",
      zsh: "bash",
      fish: "bash",
      sql: "sql",
      json: "json",
      yaml: "yaml",
      yml: "yaml",
      toml: "toml",
      xml: "xml",
      html: "xml",
      vue: "xml",
      css: "css",
      scss: "scss",
      md: "markdown",
      dockerfile: "dockerfile"
    };
    function inferLang(path) {
      const m = path.match(/\.([^.]+)$/);
      if (!m)
        return null;
      return EXT_TO_LANG[m[1].toLowerCase()] || null;
    }
    function highlightInsertedSpans(card, file) {
      if (file.size_class === "huge")
        return;
      if (!STATE.syntaxHighlight)
        return;
      const hljsRef = getHljs();
      if (!hljsRef || !hljsRef.highlight)
        return;
      const lang = inferLang(file.path);
      if (!lang || !hljsRef.getLanguage || !hljsRef.getLanguage(lang))
        return;
      const spans = card.querySelectorAll("tr.gdp-inserted-ctx .d2h-code-line-ctn:not([data-gdp-hl])");
      spans.forEach((s) => {
        s.dataset.gdpHl = "1";
        const text = s.textContent || "";
        if (text.length === 0)
          return;
        try {
          s.innerHTML = hljsRef.highlight(text, { language: lang, ignoreIllegals: true }).value;
          if (!s.classList.contains("hljs"))
            s.classList.add("hljs");
        } catch (_) {}
      });
    }
    function scheduleIdleHighlight(card, file) {
      if (file.highlight)
        return;
      if (file.size_class === "huge")
        return;
      if (!STATE.syntaxHighlight)
        return;
      if (!("requestIdleCallback" in window))
        return;
      const hljsRef = getHljs();
      if (!hljsRef || !hljsRef.highlight)
        return;
      const lang = inferLang(file.path);
      if (!lang || !hljsRef.getLanguage || !hljsRef.getLanguage(lang))
        return;
      const work = (deadline) => {
        const spans = card.querySelectorAll(".d2h-code-line-ctn:not([data-gdp-hl])");
        let i = 0;
        while (i < spans.length && deadline.timeRemaining() > 4) {
          const s = spans[i++];
          s.dataset.gdpHl = "1";
          const text = s.textContent || "";
          if (text.length === 0)
            continue;
          try {
            s.innerHTML = hljsRef.highlight(text, { language: lang, ignoreIllegals: true }).value;
            if (!s.classList.contains("hljs"))
              s.classList.add("hljs");
          } catch (_) {}
        }
        if (i < spans.length)
          requestIdleCallback(work, { timeout: 1500 });
      };
      requestIdleCallback(work, { timeout: 2000 });
    }
    function syncSideScrollCard(card) {
      card.querySelectorAll(".d2h-files-diff").forEach((group) => {
        const sides = group.querySelectorAll(".d2h-code-wrapper");
        if (sides.length !== 2)
          return;
        const [a, b] = sides;
        let syncing = false;
        const mirror = (src, dst) => {
          if (syncing)
            return;
          syncing = true;
          dst.scrollLeft = src.scrollLeft;
          requestAnimationFrame(() => {
            syncing = false;
          });
        };
        a.addEventListener("scroll", () => mirror(a, b), { passive: true });
        b.addEventListener("scroll", () => mirror(b, a), { passive: true });
      });
    }
    const MEDIA_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|mp4|webm|mov)(\?.*)?$/i;
    const VIDEO_RE = /\.(mp4|webm|mov)$/i;
    function isMedia(p) {
      return MEDIA_RE.test(p);
    }
    function isVideo(p) {
      return VIDEO_RE.test(p);
    }
    function fileURL(path, ref) {
      return "/_file?path=" + encodeURIComponent(path) + "&ref=" + ref;
    }
    function mediaTag(path, ref) {
      const url = fileURL(path, ref);
      if (isVideo(path)) {
        return '<video src="' + url + '" controls preload="metadata"></video>';
      }
      return '<img src="' + url + '" alt="" loading="lazy">';
    }
    function enhanceMediaCard(file, card) {
      const path = file.path;
      if (!file.media_kind && !isMedia(path))
        return;
      const wrapper = card.querySelector(".d2h-file-wrapper");
      if (!wrapper)
        return;
      const body = wrapper.querySelector(".d2h-files-diff") || wrapper.querySelector(".d2h-file-diff");
      if (!body)
        return;
      const container = document.createElement("div");
      container.className = "gdp-media";
      let leftHTML, rightHTML;
      if (file.status === "A") {
        leftHTML = '<div class="media-empty">Not in HEAD</div>';
        rightHTML = mediaTag(path, "worktree");
      } else if (file.status === "D") {
        leftHTML = mediaTag(path, "HEAD");
        rightHTML = '<div class="media-empty">Deleted</div>';
      } else {
        leftHTML = mediaTag(path, "HEAD");
        rightHTML = mediaTag(path, "worktree");
      }
      container.innerHTML = '<div class="media-side"><div class="media-label del">Before</div>' + leftHTML + "</div>" + '<div class="media-side"><div class="media-label add">After</div>' + rightHTML + "</div>";
      body.replaceWith(container);
    }
    function setupScrollSpy() {
      const handler = () => {
        if (handler._raf)
          return;
        if (performance.now() < SUPPRESS_SPY_UNTIL)
          return;
        handler._raf = requestAnimationFrame(() => {
          handler._raf = null;
          if (performance.now() < SUPPRESS_SPY_UNTIL)
            return;
          const topbarH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 56;
          const scanY = topbarH + 24;
          const cards = document.querySelectorAll(".gdp-file-shell");
          for (const w of cards) {
            const r = w.getBoundingClientRect();
            if (r.top <= scanY && r.bottom > scanY) {
              const text = w.dataset.path || "";
              let best = null, bestLen = 0;
              STATE.files.forEach((f) => {
                if ((text === f.path || text.endsWith(f.path)) && f.path.length > bestLen) {
                  best = f.path;
                  bestLen = f.path.length;
                }
              });
              if (best) {
                markActive(best);
                const recentlyTouched = performance.now() - (window.__gdpSidebarTouchedAt || 0) < 1500;
                if (!recentlyTouched) {
                  const li = document.querySelector('#filelist li[data-path="' + CSS.escape(best) + '"]');
                  if (li) {
                    const sb = document.querySelector("#sidebar");
                    if (!sb)
                      return;
                    const lr = li.getBoundingClientRect();
                    const sr = sb.getBoundingClientRect();
                    if (lr.top < sr.top + 40 || lr.bottom > sr.bottom - 40) {
                      li.scrollIntoView({ block: "nearest" });
                    }
                  }
                }
              }
              return;
            }
          }
        });
      };
      if (window.__gdpScrollSpy)
        window.removeEventListener("scroll", window.__gdpScrollSpy);
      window.__gdpScrollSpy = handler;
      window.addEventListener("scroll", handler, { passive: true });
      handler(new Event("scroll"));
    }
    function collapseAll(force) {
      STATE.collapsed = typeof force === "boolean" ? force : !STATE.collapsed;
      document.querySelectorAll(".gdp-file-shell.loaded .d2h-file-wrapper").forEach((w) => {
        const body = w.querySelector(".d2h-files-diff, .d2h-file-diff");
        if (body)
          body.style.display = STATE.collapsed ? "none" : "";
      });
    }
    setSidebarTreeActionIcons();
    $$(".sb-view-seg button").forEach((b) => {
      b.addEventListener("click", () => {
        STATE.sbView = b.dataset.view || "tree";
        localStorage.setItem("gdp:sbview", STATE.sbView);
        if (STATE.files && STATE.files.length)
          renderSidebar(STATE.files);
      });
    });
    $("#sb-expand-all").addEventListener("click", () => setAllSidebarDirsCollapsed(false));
    $("#sb-collapse-all").addEventListener("click", () => setAllSidebarDirsCollapsed(true));
    function applySidebarWidth(w) {
      const cw = Math.max(180, Math.min(900, w));
      document.documentElement.style.setProperty("--sidebar-w", cw + "px");
      STATE.sbWidth = cw;
      localStorage.setItem("gdp:sbwidth", String(cw));
    }
    applySidebarWidth(STATE.sbWidth);
    (function trackSidebarInteraction() {
      const sb = document.getElementById("sidebar");
      if (!sb)
        return;
      const mark = () => {
        window.__gdpSidebarTouchedAt = performance.now();
      };
      sb.addEventListener("wheel", mark, { passive: true });
      sb.addEventListener("mousedown", mark);
      sb.addEventListener("touchstart", mark, { passive: true });
      sb.addEventListener("scroll", mark, { passive: true });
    })();
    (function setupResizer() {
      const handle = $("#sidebar-resizer");
      if (!handle)
        return;
      const preview = document.createElement("div");
      preview.id = "sidebar-resize-preview";
      document.body.appendChild(preview);
      const MIN = 180, MAX = 900;
      const clamp = (w) => Math.max(MIN, Math.min(MAX, w));
      let dragging = false, startX = 0, startW = 0, currentW = 0;
      handle.addEventListener("mousedown", (e) => {
        dragging = true;
        startX = e.clientX;
        startW = STATE.sbWidth;
        currentW = startW;
        document.body.classList.add("gdp-resizing");
        preview.style.display = "block";
        preview.style.left = startW + "px";
        e.preventDefault();
      });
      window.addEventListener("mousemove", (e) => {
        if (!dragging)
          return;
        currentW = clamp(startW + (e.clientX - startX));
        preview.style.left = currentW + "px";
      });
      window.addEventListener("mouseup", () => {
        if (!dragging)
          return;
        dragging = false;
        preview.style.display = "none";
        document.body.classList.remove("gdp-resizing");
        applySidebarWidth(currentW);
      });
      handle.addEventListener("dblclick", () => applySidebarWidth(308));
    })();
    $$("#topbar .seg button").forEach((b) => {
      b.addEventListener("click", () => setLayout(b.dataset.layout || "side-by-side"));
    });
    $("#theme").addEventListener("click", () => {
      STATE.theme = STATE.theme === "dark" ? "light" : "dark";
      localStorage.setItem("gdp:theme", STATE.theme);
      applyTheme();
    });
    function isSidebarRowVisible(row) {
      if (row.classList.contains("hidden") || row.classList.contains("hidden-by-tests"))
        return false;
      let parent = row.parentElement;
      while (parent && parent.id !== "filelist") {
        if (parent.classList.contains("tree-children")) {
          const dir = parent.previousElementSibling;
          if (dir?.classList.contains("collapsed") || dir?.classList.contains("hidden"))
            return false;
        }
        parent = parent.parentElement;
      }
      return true;
    }
    function visibleSidebarItems() {
      return $$("#filelist li[data-path], #filelist .tree-dir[data-dirpath]").filter(isSidebarRowVisible);
    }
    function isRepositorySidebarMode() {
      return document.body.classList.contains("gdp-repo-page") || document.body.classList.contains("gdp-repo-blob-page");
    }
    function moveActiveSidebarItem(direction) {
      const items = visibleSidebarItems();
      if (!items.length)
        return;
      const current = items.findIndex((li) => li.classList.contains("active"));
      const idx = nextVisibleFileIndex(current, items.length, direction);
      const target = items[idx];
      if (!target)
        return;
      const path = target.dataset.path || target.dataset.dirpath;
      if (path)
        markActive(path);
      target.scrollIntoView({ block: "nearest" });
      if (target.dataset.path)
        prefetchByPath(target.dataset.path);
    }
    function setActiveSidebarDirectoryCollapsed(collapsed) {
      const active = document.querySelector("#filelist .tree-dir.active[data-dirpath]");
      if (!active)
        return;
      if (active.classList.contains("collapsed") === collapsed)
        return;
      const control = active.querySelector(".chev");
      if (control)
        control.click();
    }
    function openActiveSidebarItem() {
      const active = document.querySelector("#filelist li.active[data-path], #filelist .tree-dir.active[data-dirpath]");
      if (active && isSidebarRowVisible(active))
        active.click();
    }
    function jumpToActiveOrFirstFilteredFile() {
      const items = visibleSidebarItems().filter((item) => !!item.dataset.path);
      const active = items.find((li) => li.classList.contains("active"));
      const target = active || items[0];
      if (target) {
        target.click();
        $("#sb-filter").blur();
      }
    }
    const sbFilter = $("#sb-filter");
    if (sbFilter) {
      sbFilter.addEventListener("input", () => applyFilter());
      sbFilter.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          jumpToActiveOrFirstFilteredFile();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          moveActiveSidebarItem(e.key === "ArrowDown" ? 1 : -1);
        } else if (e.key === "Escape") {
          if (sbFilter.value) {
            sbFilter.value = "";
            applyFilter();
          } else {
            sbFilter.blur();
          }
        }
      });
    }
    function focusFileFilter() {
      const input = $("#sb-filter");
      input.focus();
      input.select();
    }
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        focusFileFilter();
        return;
      }
      const targetEl = e.target;
      if (targetEl && (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA"))
        return;
      if (e.key === "/") {
        e.preventDefault();
        focusFileFilter();
      } else if (e.key === "Enter") {
        if (isRepositorySidebarMode()) {
          e.preventDefault();
          openActiveSidebarItem();
        }
      } else if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const repoSidebar = isRepositorySidebarMode();
        const items = repoSidebar ? visibleSidebarItems() : $$("#filelist li[data-path]:not(.hidden):not(.hidden-by-tests)");
        if (!items.length)
          return;
        let idx = items.findIndex((li) => li.classList.contains("active"));
        if (idx < 0)
          idx = 0;
        else
          idx = e.key === "j" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
        const target = items[idx];
        const path = target?.dataset.path || target?.dataset.dirpath;
        if (!repoSidebar && target) {
          target.click();
          target.scrollIntoView({ block: "nearest" });
        } else if (path) {
          markActive(path);
          target.scrollIntoView({ block: "nearest" });
        }
        const nextIdx = e.key === "j" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
        const nextItem = items[nextIdx];
        if (nextItem && nextItem !== target && nextItem.dataset.path)
          prefetchByPath(nextItem.dataset.path);
      } else if (e.key === "l") {
        if (isRepositorySidebarMode()) {
          e.preventDefault();
          setActiveSidebarDirectoryCollapsed(false);
        }
      } else if (e.key === "h") {
        if (isRepositorySidebarMode()) {
          e.preventDefault();
          setActiveSidebarDirectoryCollapsed(true);
        }
      } else if (e.key === "u")
        setLayout("line-by-line");
      else if (e.key === "s")
        setLayout("side-by-side");
      else if (e.key === "t")
        $("#theme").click();
    });
    applyTheme();
    setLayout(STATE.layout);
    setPageMode();
    if (window.location.pathname === "/") {
      setRoute(STATE.route, true);
    }
    function loadRepo() {
      if (STATE.route.screen !== "repo")
        return Promise.resolve();
      setStatus("refreshing");
      const params = new URLSearchParams;
      params.set("ref", STATE.route.ref || "worktree");
      if (STATE.route.path)
        params.set("path", STATE.route.path);
      return trackLoad(fetch("/_tree?" + params.toString()).then((r) => {
        if (!r.ok)
          throw new Error("failed to load repository tree");
        return r.json();
      })).then((data) => {
        renderRepo(data);
        setStatus("live");
        syncHeaderMenu();
      }).catch(() => setStatus("error"));
    }
    function load(options = {}) {
      if (STATE.route.screen === "repo")
        return loadRepo();
      setStatus("refreshing");
      const params = new URLSearchParams;
      if (STATE.ignoreWs)
        params.set("ignore_ws", "1");
      if (STATE.from)
        params.set("from", STATE.from);
      if (STATE.to)
        params.set("to", STATE.to);
      if (options.force)
        params.set("nocache", "1");
      const url = "/diff.json" + (params.toString() ? "?" + params.toString() : "");
      return trackLoad(fetch(url).then((r) => r.json())).then((data) => {
        renderShell(data);
        setStatus("live");
      }).catch(() => setStatus("error"));
    }
    if (STATE.route.screen === "repo")
      loadRepo();
    else if (STATE.route.screen === "file" && STATE.route.view === "blob") {
      setStatus("live");
      applySourceRouteToShell();
    } else
      load();
    function syncRefInputs() {
      const fi = $("#ref-from"), ti = $("#ref-to");
      if (fi)
        fi.value = STATE.from;
      if (ti)
        ti.value = STATE.to;
    }
    function setRange(from, to) {
      STATE.from = from || "";
      STATE.to = to || "";
      localStorage.setItem("gdp:from", STATE.from);
      localStorage.setItem("gdp:to", STATE.to);
      syncRefInputs();
      const range = currentRange();
      if (STATE.route.screen === "file") {
        setRoute({ screen: "file", path: STATE.route.path, ref: STATE.route.ref, range }, true);
      } else {
        setRoute({ screen: "diff", range }, true);
      }
      load();
    }
    syncRefInputs();
    syncHeaderMenu();
    const REFS = { branches: [], tags: [], commits: [], current: "" };
    const popover = $("#ref-popover");
    const popBody = popover.querySelector(".rp-body");
    const popSearch = popover.querySelector(".rp-search");
    let popTarget = null;
    function fetchRefs() {
      return fetch("/_refs").then((r) => r.json()).then((refs) => {
        Object.assign(REFS, refs);
      }).catch(() => {});
    }
    fetchRefs();
    let popTab = "commits";
    function buildPopBody(query) {
      const q = (query || "").toLowerCase().trim();
      const m = (s) => !q || String(s).toLowerCase().includes(q);
      const html = [];
      if (popTab === "commits") {
        const commits = (REFS.commits || []).filter((c) => m(c));
        if (!commits.length) {
          html.push('<div class="rp-empty">no commits</div>');
        }
        for (const c of commits) {
          const [sha, subject, author, when] = c.split("\t");
          if (!sha)
            continue;
          html.push('<div class="rp-item-commit" data-val="' + escapeAttr(sha) + '">' + '<div class="row1">' + '<span class="sha">' + escapeHtml(sha) + "</span>" + '<span class="subject" title="' + escapeAttr(subject || "") + '">' + escapeHtml(subject || "") + "</span>" + "</div>" + '<div class="row2">' + '<span class="author">' + escapeHtml(author || "") + "</span>" + '<span class="when">' + escapeHtml(when || "") + "</span>" + "</div>" + "</div>");
        }
      } else if (popTab === "branches") {
        const branches = (REFS.branches || []).filter(m);
        if (!branches.length) {
          html.push('<div class="rp-empty">no branches</div>');
        }
        for (const b of branches) {
          const cur = b === REFS.current;
          html.push('<div class="rp-item-ref" data-val="' + escapeAttr(b) + '">' + '<span class="name">' + escapeHtml(b) + "</span>" + (cur ? '<span class="badge cur">current</span>' : '<span class="badge">branch</span>') + "</div>");
        }
      } else if (popTab === "tags") {
        const tags = (REFS.tags || []).filter(m);
        if (!tags.length) {
          html.push('<div class="rp-empty">no tags</div>');
        }
        for (const t of tags) {
          html.push('<div class="rp-item-ref" data-val="' + escapeAttr(t) + '">' + '<span class="name">' + escapeHtml(t) + "</span>" + '<span class="badge">tag</span>' + "</div>");
        }
      }
      popBody.innerHTML = html.join("");
      highlightCurrentInPopover();
    }
    function highlightCurrentInPopover() {
      if (!popTarget)
        return;
      const cur = (popTarget.value || "").trim();
      if (!cur)
        return;
      const items = popBody.querySelectorAll("[data-val]");
      let match = null;
      items.forEach((it) => {
        if (it.dataset.val === cur)
          match = it;
      });
      if (match) {
        match.classList.add("current");
        const ph = popBody;
        const r = match.getBoundingClientRect();
        const pr = ph.getBoundingClientRect();
        if (r.top < pr.top || r.bottom > pr.bottom) {
          ph.scrollTop = match.offsetTop - ph.clientHeight / 2;
        }
      }
    }
    function escapeAttr(s) {
      return escapeHtml(s).replace(/"/g, "&quot;");
    }
    function openPopover(input) {
      popTarget = input;
      popSearch.value = "";
      buildPopBody("");
      const cur = (input.value || "").trim();
      popover.querySelectorAll(".rp-chip").forEach((c) => {
        c.classList.toggle("current", c.dataset.val === cur);
      });
      popover.hidden = false;
      const r = input.getBoundingClientRect();
      const popWidth = Math.min(560, Math.floor(window.innerWidth * 0.9));
      popover.style.left = Math.max(8, Math.min(r.left, window.innerWidth - popWidth - 8)) + "px";
      popover.style.top = r.bottom + 4 + "px";
      setTimeout(() => popSearch.focus(), 0);
    }
    function closePopover() {
      popover.hidden = true;
      popTarget = null;
    }
    ["#ref-from", "#ref-to"].forEach((sel) => {
      const el = $(sel);
      el.addEventListener("focus", () => openPopover(el));
      el.addEventListener("mousedown", (e) => {
        if (popover.hidden) {
          e.preventDefault();
          el.focus();
        }
      });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        openPopover(el);
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          closePopover();
        } else if (e.key === "Escape") {
          closePopover();
          el.blur();
        }
      });
    });
    wireRepoTargetPicker($("#repo-target"), (ref) => {
      if (STATE.route.screen !== "file")
        return;
      setRoute({ screen: "file", path: STATE.route.path, ref, view: "blob", range: currentRange() });
      renderStandaloneSource({ path: STATE.route.path, ref });
    });
    document.addEventListener("focusin", (e) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && (el.id === "repo-ref" || el.id === "repo-target"))
        openPopover(el);
    });
    popSearch.addEventListener("input", () => buildPopBody(popSearch.value));
    popSearch.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closePopover();
      }
      if (e.key === "Enter") {
        const first = popBody.querySelector(".rp-item");
        if (first)
          first.click();
      }
    });
    function handlePicked(val) {
      if (!popTarget || !val)
        return;
      const pickedTarget = popTarget;
      pickedTarget.value = val;
      if (pickedTarget.id === "repo-ref") {
        closePopover();
        pickedTarget.dispatchEvent(new Event("change"));
        return;
      }
      if (pickedTarget.id === "repo-target") {
        closePopover();
        pickedTarget.dispatchEvent(new Event("change"));
        return;
      }
      const targetWasFrom = pickedTarget.id === "ref-from";
      const otherEmpty = !$("#ref-to").value;
      closePopover();
      setRange($("#ref-from").value, $("#ref-to").value);
      if (targetWasFrom && otherEmpty) {
        const ti = $("#ref-to");
        setTimeout(() => ti.focus(), 0);
      }
    }
    popBody.addEventListener("click", (e) => {
      const item = e.target.closest(".rp-item-commit, .rp-item-ref");
      if (!item)
        return;
      handlePicked(item.dataset.val);
    });
    popover.querySelectorAll(".rp-tab").forEach((t) => {
      t.addEventListener("click", () => {
        popTab = t.dataset.tab || "commits";
        popover.querySelectorAll(".rp-tab").forEach((b) => b.classList.toggle("active", b === t));
        buildPopBody(popSearch.value);
      });
    });
    popover.querySelectorAll(".rp-chip").forEach((c) => {
      c.addEventListener("click", () => handlePicked(c.dataset.val));
    });
    document.addEventListener("mousedown", (e) => {
      if (popover.hidden)
        return;
      const target = e.target;
      if (popover.contains(target))
        return;
      if (target.id === "ref-from" || target.id === "ref-to" || target.id === "repo-ref" || target.id === "repo-target")
        return;
      closePopover();
    });
    $("#ref-reset").addEventListener("click", () => setRange("HEAD", "worktree"));
    window.addEventListener("popstate", () => {
      const parsedRoute = parseRoute(window.location.pathname, window.location.search, currentRange());
      STATE.route = parsedRoute.screen === "unknown" ? { screen: "diff", range: parsedRoute.range } : parsedRoute;
      STATE.from = STATE.route.range.from;
      STATE.to = STATE.route.range.to;
      if (STATE.route.screen === "repo")
        STATE.repoRef = STATE.route.ref || "worktree";
      syncRefInputs();
      syncHeaderMenu();
      if (STATE.route.screen === "repo") {
        SOURCE_REQ_SEQ++;
        setPageMode();
        removeStandaloneSource();
        loadRepo();
        return;
      }
      if (STATE.route.screen !== "file") {
        SOURCE_REQ_SEQ++;
        setPageMode();
        removeStandaloneSource();
        load();
        return;
      }
      applySourceRouteToShell();
    });
    function applyIgnoreWs() {
      const btn = $("#ignore-ws");
      if (btn)
        btn.classList.toggle("active", STATE.ignoreWs);
    }
    applyIgnoreWs();
    $("#ignore-ws").addEventListener("click", () => {
      STATE.ignoreWs = !STATE.ignoreWs;
      localStorage.setItem("gdp:ignore-ws", STATE.ignoreWs ? "1" : "0");
      applyIgnoreWs();
      load();
    });
    function setSyntaxHighlight(on) {
      STATE.syntaxHighlight = on;
      localStorage.setItem("gdp:syntax-highlight", on ? "1" : "0");
      setHighlightButton(on && getHljs() ? "loaded" : "idle");
      if (on) {
        loadSyntaxHighlighter().then((hljsRef) => {
          if (!hljsRef)
            return;
          rerenderLoadedDiffs();
        });
      } else {
        rerenderLoadedDiffs();
      }
    }
    setHighlightButton(STATE.syntaxHighlight && getHljs() ? "loaded" : "idle");
    $("#syntax-highlight").addEventListener("click", () => {
      setSyntaxHighlight(!STATE.syntaxHighlight);
    });
    if (STATE.syntaxHighlight)
      setSyntaxHighlight(true);
    $("#reload-prom").addEventListener("click", () => {
      const btn = $("#reload-prom");
      btn.classList.add("spinning");
      load().finally(() => {
        setTimeout(() => btn.classList.remove("spinning"), 200);
      });
    });
    window.addEventListener("storage", (e) => {
      if (e.key === "gdp:syntax-highlight")
        setSyntaxHighlight(e.newValue !== "0");
    });
    const TEST_RE = /(^|[/_.])(test|spec|__tests__)([/_.]|$)/i;
    function applyHideTests() {
      const btn = $("#hide-tests");
      if (btn)
        btn.classList.toggle("active", STATE.hideTests);
      document.querySelectorAll(".gdp-file-shell").forEach((card) => {
        const isTest = TEST_RE.test(card.dataset.path || "");
        card.classList.toggle("hidden-by-tests", STATE.hideTests && isTest);
      });
      document.querySelectorAll("#filelist li[data-path]").forEach((li) => {
        const isTest = TEST_RE.test(li.dataset.path || "");
        li.classList.toggle("hidden-by-tests", STATE.hideTests && isTest);
      });
      updateTreeDirVisibility();
      if (typeof applyViewedState === "function")
        applyViewedState();
    }
    applyHideTests();
    $("#hide-tests").addEventListener("click", () => {
      STATE.hideTests = !STATE.hideTests;
      localStorage.setItem("gdp:hide-tests", STATE.hideTests ? "1" : "0");
      applyHideTests();
    });
    let sseTimer = null;
    function scheduleSseLoad() {
      if (sseTimer)
        clearTimeout(sseTimer);
      sseTimer = setTimeout(() => {
        sseTimer = null;
        const savedScroll = window.scrollY;
        const savedActive = STATE.activeFile;
        load().then(() => {
          if (savedActive) {
            const card = document.querySelector(diffCardSelector(savedActive));
            if (card) {
              card.scrollIntoView({ block: "start" });
              return;
            }
          }
          window.scrollTo(0, savedScroll);
        });
      }, 350);
    }
    const es = new EventSource("/events");
    const catchUpGate = createCatchUpGate(() => Date.now(), 1000);
    let openedOnce = false;
    es.addEventListener("update", () => scheduleSseLoad());
    es.addEventListener("reload", () => location.reload());
    es.addEventListener("error", () => setStatus("error"));
    es.addEventListener("open", () => {
      setStatus("live");
      if (!openedOnce) {
        openedOnce = true;
        return;
      }
      catchUpDiff();
    });
    function catchUpDiff() {
      if (!shouldCatchUpDiff(STATE.route))
        return;
      if (!catchUpGate())
        return;
      load({ force: true });
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden)
        catchUpDiff();
    });
    window.addEventListener("focus", catchUpDiff);
  })();
})();
