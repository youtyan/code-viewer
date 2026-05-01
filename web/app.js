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
  var GdpExpandLogic = {
    initExpandState,
    remainingGap,
    isFullyExpanded,
    upClickRange,
    downClickRange,
    applyUp,
    applyDown,
    mapNewToOld
  };

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
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));
    const diffCardSelector = (path) => '.gdp-file-shell[data-path="' + (window.CSS && CSS.escape ? CSS.escape(path) : path) + '"]';
    const HIGHLIGHT_SRC = "/vendor/highlight.js/highlight.min.js";
    let highlightLoadPromise = null;
    let highlightConfigured = false;
    const STATE = (() => {
      const igRaw = localStorage.getItem("gdp:ignore-ws");
      return {
        layout: localStorage.getItem("gdp:layout") || "side-by-side",
        theme: localStorage.getItem("gdp:theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
        sbView: localStorage.getItem("gdp:sbview") || "tree",
        sbWidth: parseInt(localStorage.getItem("gdp:sbwidth")) || 308,
        collapsedDirs: new Set(JSON.parse(localStorage.getItem("gdp:collapsed-dirs") || "[]")),
        ignoreWs: igRaw === null ? true : igRaw === "1",
        from: localStorage.getItem("gdp:from") || "HEAD",
        to: localStorage.getItem("gdp:to") || "worktree",
        collapsed: false,
        files: [],
        activeFile: null,
        autoReload: localStorage.getItem("gdp:auto-reload") !== "0",
        hideTests: localStorage.getItem("gdp:hide-tests") === "1",
        syntaxHighlight: localStorage.getItem("gdp:syntax-highlight") !== "0"
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
    function buildTree(files) {
      const root = { name: "", dirs: {}, files: [], path: "", minOrder: Infinity };
      for (const f of files) {
        const parts = f.path.split("/");
        let node = root;
        let acc = "";
        for (let i = 0;i < parts.length - 1; i++) {
          const p = parts[i];
          acc = acc ? acc + "/" + p : p;
          if (!node.dirs[p]) {
            node.dirs[p] = { name: p, dirs: {}, files: [], path: acc, minOrder: Infinity };
          }
          node = node.dirs[p];
          if (typeof f.order === "number" && f.order < node.minOrder)
            node.minOrder = f.order;
        }
        node.files.push(f);
      }
      function compress(node) {
        const ks = Object.keys(node.dirs);
        while (ks.length === 1 && node.files.length === 0 && node !== root) {
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
    function renderTreeNode(node, depth, ul) {
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
          li.style.setProperty("--lvl-pad", 12 + depth * 14 + "px");
          const chev = document.createElement("span");
          chev.className = "chev";
          chev.textContent = "▾";
          li.appendChild(chev);
          const dirIcon = document.createElement("span");
          dirIcon.className = "dir-icon";
          li.appendChild(dirIcon);
          const dn = document.createElement("span");
          dn.className = "dir-name";
          dn.textContent = dir.name;
          dn.title = dir.path;
          li.appendChild(dn);
          const collapsed = STATE.collapsedDirs.has(dir.path);
          if (collapsed)
            li.classList.add("collapsed");
          const updateIcon = () => {
            dirIcon.textContent = li.classList.contains("collapsed") ? "\uD83D\uDCC1" : "\uD83D\uDCC2";
          };
          updateIcon();
          const childUl = document.createElement("ul");
          childUl.className = "tree-children";
          renderTreeNode(dir, depth + 1, childUl);
          li.addEventListener("click", (e) => {
            e.stopPropagation();
            li.classList.toggle("collapsed");
            updateIcon();
            if (li.classList.contains("collapsed"))
              STATE.collapsedDirs.add(dir.path);
            else
              STATE.collapsedDirs.delete(dir.path);
            localStorage.setItem("gdp:collapsed-dirs", JSON.stringify([...STATE.collapsedDirs]));
          });
          ul.appendChild(li);
          ul.appendChild(childUl);
        } else {
          const f = item.file;
          const li = document.createElement("li");
          li.className = "tree-file";
          li.dataset.path = f.path;
          li.style.setProperty("--lvl-pad", 12 + depth * 14 + "px");
          li.appendChild(fileBadge(f.status));
          const name = document.createElement("span");
          name.className = "name";
          name.textContent = f.path.split("/").pop();
          name.title = f.path;
          li.appendChild(name);
          li.addEventListener("click", () => scrollToFile(f.path));
          li.addEventListener("mouseenter", () => prefetchByPath(f.path), { passive: true });
          ul.appendChild(li);
        }
      }
    }
    function renderFlat(files, ul) {
      files.forEach((f, i) => {
        const li = document.createElement("li");
        li.dataset.index = String(i);
        li.dataset.path = f.path;
        li.appendChild(fileBadge(f.status));
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = f.path;
        name.title = f.path;
        li.appendChild(name);
        li.addEventListener("click", () => scrollToFile(f.path));
        li.addEventListener("mouseenter", () => prefetchByPath(f.path), { passive: true });
        ul.appendChild(li);
      });
    }
    function renderSidebar(files) {
      const ul = $("#filelist");
      ul.innerHTML = "";
      ul.classList.toggle("tree", STATE.sbView === "tree");
      STATE.files = files;
      if (STATE.sbView === "tree") {
        const root = buildTree(files);
        renderTreeNode(root, 0, ul);
      } else {
        renderFlat(files, ul);
      }
      $("#totals").textContent = files.length ? files.length + " file" + (files.length === 1 ? "" : "s") : "";
      $$(".sb-view-seg button").forEach((b) => {
        b.classList.toggle("active", b.dataset.view === STATE.sbView);
      });
      if (STATE.activeFile)
        markActive(STATE.activeFile);
      applyFilter();
    }
    function renderMeta(meta) {
      const el = $("#meta");
      if (!meta) {
        el.textContent = "";
        return;
      }
      document.title = (meta.project ? meta.project + " - " : "") + "git diff preview";
      el.innerHTML = "";
      if (meta.range) {
        const r = document.createElement("span");
        r.className = "ref";
        r.textContent = meta.range;
        el.appendChild(r);
      }
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
        if (li.dataset.path)
          li.classList.toggle("active", li.dataset.path === path);
      });
    }
    function applyFilter() {
      const q = ($("#filter").value || "").toLowerCase().trim();
      $$("#filelist li[data-path]").forEach((li) => {
        const match = !q || li.dataset.path.toLowerCase().includes(q);
        li.classList.toggle("hidden", !match);
      });
      $$("#filelist .tree-dir").forEach((dir) => {
        const childUl = dir.nextElementSibling;
        if (!childUl || !childUl.classList.contains("tree-children"))
          return;
        const anyVisible = !!childUl.querySelector(".tree-file:not(.hidden)");
        const fullVisible = !q;
        dir.classList.toggle("hidden", !(fullVisible || anyVisible));
      });
    }
    let SERVER_GENERATION = 0;
    let CLIENT_REQ_SEQ = 0;
    const LOAD_QUEUE = [];
    let ACTIVE_LOADS = 0;
    const MAX_PARALLEL = 2;
    let lazyObserver = null;
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
        empty.classList.remove("hidden");
        target.replaceChildren();
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
      setupScrollSpy();
      if (typeof applyHideTests === "function")
        applyHideTests();
    }
    function createPlaceholder(f) {
      const card = document.createElement("div");
      card.className = "gdp-file-shell pending";
      card.dataset.path = f.path;
      card.dataset.key = f.key || f.path;
      card.dataset.sizeClass = f.size_class || "small";
      card.dataset.status = f.status || "M";
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
        fileListToggle: false
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
            const ln2 = sib.tr.querySelector(".d2h-code-linenumber.d2h-info, .d2h-code-side-linenumber.d2h-info");
            const old = ln2 && ln2.querySelector(".gdp-expand-stack");
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
        const stack = document.createElement("div");
        stack.className = "gdp-expand-stack";
        const mkBtn = (path, title, fn) => {
          const b = document.createElement("button");
          b.className = "gdp-expand-btn";
          b.title = title;
          b.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' + '<path fill="currentColor" d="' + path + '"/></svg>';
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            if (b.disabled)
              return;
            fn();
          });
          return b;
        };
        const upPath = "M8 3.5 3.75 7.75l1.06 1.06L7.25 6.37V13h1.5V6.37l2.44 2.44 1.06-1.06L8 3.5z";
        const downPath = "M8 12.5 12.25 8.25l-1.06-1.06L8.75 9.63V3h-1.5v6.63L4.81 7.19 3.75 8.25 8 12.5z";
        if (isFirst) {
          stack.appendChild(mkBtn(upPath, "Show " + Math.min(STEP, remainingSize) + " more lines", () => fetchAndInsert(Math.max(remainingStart, remainingEnd - STEP + 1), remainingEnd, "after")));
        } else {
          stack.appendChild(mkBtn(upPath, "Show " + Math.min(STEP, remainingSize) + " more lines", () => fetchAndInsert(remainingStart, Math.min(remainingEnd, remainingStart + STEP - 1), "before")));
          stack.appendChild(mkBtn(downPath, "Show " + Math.min(STEP, remainingSize) + " more lines", () => fetchAndInsert(Math.max(remainingStart, remainingEnd - STEP + 1), remainingEnd, "after")));
        }
        return stack;
      };
      const firstSib = item.siblings && item.siblings[0] || { tr: item.tr };
      const ln = firstSib.tr.querySelector(".d2h-code-linenumber.d2h-info, .d2h-code-side-linenumber.d2h-info");
      if (ln && !ln.querySelector(".gdp-expand-stack")) {
        ln.appendChild(buildStack());
      }
      const syncHeight = () => {
        const stack = firstSib.tr.querySelector(".gdp-expand-stack");
        const targetH = stack ? Math.max(20, stack.getBoundingClientRect().height) : 20;
        for (const sib of item.siblings || [{ tr: item.tr }]) {
          sib.tr.style.setProperty("height", targetH + "px", "important");
        }
      };
      requestAnimationFrame(syncHeight);
      setTimeout(syncHeight, 100);
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
    function appendStatSquaresToHeader(card, file) {
      const header = card.querySelector(".d2h-file-header");
      if (!header || header.querySelector(".gdp-stat-squares"))
        return;
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
    $$(".sb-view-seg button").forEach((b) => {
      b.addEventListener("click", () => {
        STATE.sbView = b.dataset.view || "tree";
        localStorage.setItem("gdp:sbview", STATE.sbView);
        if (STATE.files && STATE.files.length)
          renderSidebar(STATE.files);
      });
    });
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
    $("#collapse").addEventListener("click", () => collapseAll());
    function syncFilters(srcEl) {
      const v = srcEl.value;
      ["#filter", "#sb-filter"].forEach((sel) => {
        const el = $(sel);
        if (el && el !== srcEl)
          el.value = v;
      });
      applyFilter();
    }
    $("#filter").addEventListener("input", (e) => syncFilters(e.target));
    const sbFilter = $("#sb-filter");
    if (sbFilter)
      sbFilter.addEventListener("input", (e) => syncFilters(e.target));
    document.addEventListener("keydown", (e) => {
      const targetEl = e.target;
      if (targetEl && (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA"))
        return;
      if (e.key === "/") {
        e.preventDefault();
        $("#filter").focus();
      } else if (e.key === "j" || e.key === "k") {
        const items = $$("#filelist li[data-path]:not(.hidden)");
        if (!items.length)
          return;
        let idx = items.findIndex((li) => li.classList.contains("active"));
        if (idx < 0)
          idx = 0;
        else
          idx = e.key === "j" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
        const target = items[idx];
        if (target) {
          target.click();
          target.scrollIntoView({ block: "nearest" });
        }
        const nextIdx = e.key === "j" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
        const nextItem = items[nextIdx];
        if (nextItem && nextItem !== target && nextItem.dataset.path)
          prefetchByPath(nextItem.dataset.path);
      } else if (e.key === "u")
        setLayout("line-by-line");
      else if (e.key === "s")
        setLayout("side-by-side");
      else if (e.key === "t")
        $("#theme").click();
    });
    applyTheme();
    setLayout(STATE.layout);
    function load(opts) {
      setStatus("refreshing");
      const params = new URLSearchParams;
      if (STATE.ignoreWs)
        params.set("ignore_ws", "1");
      if (STATE.from)
        params.set("from", STATE.from);
      if (STATE.to)
        params.set("to", STATE.to);
      if (opts && opts.nocache)
        params.set("nocache", "1");
      const url = "/diff.json" + (params.toString() ? "?" + params.toString() : "");
      return trackLoad(fetch(url).then((r) => r.json())).then((data) => {
        renderShell(data);
        setStatus("live");
      }).catch(() => setStatus("error"));
    }
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
      load();
    }
    syncRefInputs();
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
      popover.style.left = Math.max(8, r.left) + "px";
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
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          closePopover();
          setRange($("#ref-from").value, $("#ref-to").value);
        } else if (e.key === "Escape") {
          closePopover();
          el.blur();
        }
      });
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
      popTarget.value = val;
      const targetWasFrom = popTarget.id === "ref-from";
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
      if (target.id === "ref-from" || target.id === "ref-to")
        return;
      closePopover();
    });
    $("#ref-apply").addEventListener("click", () => setRange($("#ref-from").value, $("#ref-to").value));
    $("#ref-reset").addEventListener("click", () => setRange("HEAD", "worktree"));
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
    const AUTO_RELOAD_MS = 3000;
    let autoTimer = null;
    function setAutoReload(on) {
      STATE.autoReload = on;
      localStorage.setItem("gdp:auto-reload", on ? "1" : "0");
      const btn = $("#auto-reload");
      if (btn) {
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      }
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
      if (on)
        autoTimer = setInterval(() => {
          if (!document.hidden)
            load({ nocache: true });
        }, AUTO_RELOAD_MS);
    }
    setAutoReload(STATE.autoReload);
    $("#auto-reload").addEventListener("click", () => setAutoReload(!STATE.autoReload));
    window.addEventListener("storage", (e) => {
      if (e.key === "gdp:auto-reload")
        setAutoReload(e.newValue !== "0");
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
      document.querySelectorAll("#filelist .tree-dir").forEach((dir) => {
        const childUl = dir.nextElementSibling;
        if (!childUl)
          return;
        const anyVisible = !!childUl.querySelector(".tree-file:not(.hidden):not(.hidden-by-tests)");
        dir.classList.toggle("hidden-by-tests", STATE.hideTests && !anyVisible);
      });
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
    es.addEventListener("update", () => scheduleSseLoad());
    es.addEventListener("reload", () => location.reload());
    es.addEventListener("error", () => setStatus("error"));
    es.addEventListener("open", () => setStatus("live"));
    let assetVersion = null;
    function pollAssetVersion() {
      fetch("/_asset_version").then((r) => r.ok ? r.json() : null).then((data) => {
        if (!data || !data.version)
          return;
        if (assetVersion == null) {
          assetVersion = data.version;
          return;
        }
        if (data.version !== assetVersion)
          location.reload();
      }).catch(() => {});
    }
    pollAssetVersion();
    setInterval(pollAssetVersion, 1500);
  })();
})();
