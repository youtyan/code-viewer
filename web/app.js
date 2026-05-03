(() => {
  var __defProp = Object.defineProperty;
  var __returnValue = (v) => v;
  function __exportSetter(name, newValue) {
    this[name] = __returnValue.bind(null, newValue);
  }
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: __exportSetter.bind(all, name)
      });
  };
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined")
      return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

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

  // web-src/fuzzy-search.ts
  function basenameStart(path) {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? 0 : slash + 1;
  }
  function isBoundary(path, index) {
    if (index <= 0)
      return true;
    const prev = path[index - 1];
    return prev === "/" || prev === "-" || prev === "_" || prev === "." || prev === " ";
  }
  function toRanges(indices) {
    const ranges = [];
    for (const index of indices) {
      const last = ranges[ranges.length - 1];
      if (last && last.end === index) {
        last.end = index + 1;
      } else {
        ranges.push({ start: index, end: index + 1 });
      }
    }
    return ranges;
  }
  function fuzzyMatchPath(query, path) {
    const q = query.trim().toLowerCase();
    if (!q)
      return { score: 0, ranges: [] };
    const lowerPath = path.toLowerCase();
    const baseStart = basenameStart(path);
    const indices = [];
    let from = 0;
    let score = 0;
    for (const ch of q) {
      const index = lowerPath.indexOf(ch, from);
      if (index < 0)
        return null;
      indices.push(index);
      score += 10;
      if (index >= baseStart)
        score += 8;
      if (isBoundary(path, index))
        score += 6;
      const prev = indices[indices.length - 2];
      if (prev != null && prev + 1 === index)
        score += 12;
      from = index + 1;
    }
    const first = indices[0] || 0;
    score -= Math.min(first, 40);
    if (indices[0] >= baseStart)
      score += 20;
    const basename = lowerPath.slice(baseStart);
    if (basename.startsWith(q))
      score += 30;
    if (basename === q || basename.startsWith(q + "."))
      score += 25;
    if (lowerPath.endsWith(q))
      score += 15;
    return { score, ranges: toRanges(indices) };
  }
  function rankFuzzyPaths(query, items) {
    return items.map((item) => {
      const match = fuzzyMatchPath(query, item.path);
      return match ? { item, score: match.score, ranges: match.ranges } : null;
    }).filter((item) => item !== null).sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path));
  }

  // web-src/search-palette.ts
  var PALETTE_RESULT_LIMIT = 50;
  function limitPaletteResults(items) {
    return items.slice(0, PALETTE_RESULT_LIMIT);
  }
  function movePaletteSelection(index, count, direction) {
    if (count <= 0)
      return -1;
    if (index < 0)
      return direction > 0 ? 0 : count - 1;
    return (index + direction + count) % count;
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
        const lineParam = Number(params.get("line") || "");
        const line = Number.isInteger(lineParam) && lineParam > 0 ? lineParam : undefined;
        if (!path)
          return { screen: "unknown", reason: "missing-path", rawPathname: pathname, rawSearch: search, range };
        return { screen: "file", path, ref, range, view: target ? "blob" : "detail", ...line ? { line } : {} };
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
          return "/file?path=" + encodeURIComponent(route.path) + "&target=" + encodeURIComponent(route.ref || "worktree") + (route.line ? "&line=" + encodeURIComponent(String(route.line)) : "");
        }
        return "/file?path=" + encodeURIComponent(route.path) + "&ref=" + encodeURIComponent(route.ref || "worktree") + "&from=" + encodeURIComponent(route.range.from || "") + "&to=" + encodeURIComponent(route.range.to || "worktree") + (route.line ? "&line=" + encodeURIComponent(String(route.line)) : "");
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

  // node_modules/markdown-it/lib/common/utils.mjs
  var exports_utils = {};
  __export(exports_utils, {
    unescapeMd: () => unescapeMd,
    unescapeAll: () => unescapeAll,
    normalizeReference: () => normalizeReference,
    lib: () => lib,
    isWhiteSpace: () => isWhiteSpace,
    isValidEntityCode: () => isValidEntityCode,
    isString: () => isString,
    isSpace: () => isSpace,
    isPunctChar: () => isPunctChar,
    isMdAsciiPunct: () => isMdAsciiPunct,
    has: () => has,
    fromCodePoint: () => fromCodePoint2,
    escapeRE: () => escapeRE,
    escapeHtml: () => escapeHtml,
    assign: () => assign,
    arrayReplaceAt: () => arrayReplaceAt
  });

  // node_modules/mdurl/index.mjs
  var exports_mdurl = {};
  __export(exports_mdurl, {
    parse: () => parse_default,
    format: () => format,
    encode: () => encode_default,
    decode: () => decode_default
  });

  // node_modules/mdurl/lib/decode.mjs
  var decodeCache = {};
  function getDecodeCache(exclude) {
    let cache = decodeCache[exclude];
    if (cache) {
      return cache;
    }
    cache = decodeCache[exclude] = [];
    for (let i = 0;i < 128; i++) {
      const ch = String.fromCharCode(i);
      cache.push(ch);
    }
    for (let i = 0;i < exclude.length; i++) {
      const ch = exclude.charCodeAt(i);
      cache[ch] = "%" + ("0" + ch.toString(16).toUpperCase()).slice(-2);
    }
    return cache;
  }
  function decode(string, exclude) {
    if (typeof exclude !== "string") {
      exclude = decode.defaultChars;
    }
    const cache = getDecodeCache(exclude);
    return string.replace(/(%[a-f0-9]{2})+/gi, function(seq) {
      let result = "";
      for (let i = 0, l = seq.length;i < l; i += 3) {
        const b1 = parseInt(seq.slice(i + 1, i + 3), 16);
        if (b1 < 128) {
          result += cache[b1];
          continue;
        }
        if ((b1 & 224) === 192 && i + 3 < l) {
          const b2 = parseInt(seq.slice(i + 4, i + 6), 16);
          if ((b2 & 192) === 128) {
            const chr = b1 << 6 & 1984 | b2 & 63;
            if (chr < 128) {
              result += "��";
            } else {
              result += String.fromCharCode(chr);
            }
            i += 3;
            continue;
          }
        }
        if ((b1 & 240) === 224 && i + 6 < l) {
          const b2 = parseInt(seq.slice(i + 4, i + 6), 16);
          const b3 = parseInt(seq.slice(i + 7, i + 9), 16);
          if ((b2 & 192) === 128 && (b3 & 192) === 128) {
            const chr = b1 << 12 & 61440 | b2 << 6 & 4032 | b3 & 63;
            if (chr < 2048 || chr >= 55296 && chr <= 57343) {
              result += "���";
            } else {
              result += String.fromCharCode(chr);
            }
            i += 6;
            continue;
          }
        }
        if ((b1 & 248) === 240 && i + 9 < l) {
          const b2 = parseInt(seq.slice(i + 4, i + 6), 16);
          const b3 = parseInt(seq.slice(i + 7, i + 9), 16);
          const b4 = parseInt(seq.slice(i + 10, i + 12), 16);
          if ((b2 & 192) === 128 && (b3 & 192) === 128 && (b4 & 192) === 128) {
            let chr = b1 << 18 & 1835008 | b2 << 12 & 258048 | b3 << 6 & 4032 | b4 & 63;
            if (chr < 65536 || chr > 1114111) {
              result += "����";
            } else {
              chr -= 65536;
              result += String.fromCharCode(55296 + (chr >> 10), 56320 + (chr & 1023));
            }
            i += 9;
            continue;
          }
        }
        result += "�";
      }
      return result;
    });
  }
  decode.defaultChars = ";/?:@&=+$,#";
  decode.componentChars = "";
  var decode_default = decode;

  // node_modules/mdurl/lib/encode.mjs
  var encodeCache = {};
  function getEncodeCache(exclude) {
    let cache = encodeCache[exclude];
    if (cache) {
      return cache;
    }
    cache = encodeCache[exclude] = [];
    for (let i = 0;i < 128; i++) {
      const ch = String.fromCharCode(i);
      if (/^[0-9a-z]$/i.test(ch)) {
        cache.push(ch);
      } else {
        cache.push("%" + ("0" + i.toString(16).toUpperCase()).slice(-2));
      }
    }
    for (let i = 0;i < exclude.length; i++) {
      cache[exclude.charCodeAt(i)] = exclude[i];
    }
    return cache;
  }
  function encode(string, exclude, keepEscaped) {
    if (typeof exclude !== "string") {
      keepEscaped = exclude;
      exclude = encode.defaultChars;
    }
    if (typeof keepEscaped === "undefined") {
      keepEscaped = true;
    }
    const cache = getEncodeCache(exclude);
    let result = "";
    for (let i = 0, l = string.length;i < l; i++) {
      const code = string.charCodeAt(i);
      if (keepEscaped && code === 37 && i + 2 < l) {
        if (/^[0-9a-f]{2}$/i.test(string.slice(i + 1, i + 3))) {
          result += string.slice(i, i + 3);
          i += 2;
          continue;
        }
      }
      if (code < 128) {
        result += cache[code];
        continue;
      }
      if (code >= 55296 && code <= 57343) {
        if (code >= 55296 && code <= 56319 && i + 1 < l) {
          const nextCode = string.charCodeAt(i + 1);
          if (nextCode >= 56320 && nextCode <= 57343) {
            result += encodeURIComponent(string[i] + string[i + 1]);
            i++;
            continue;
          }
        }
        result += "%EF%BF%BD";
        continue;
      }
      result += encodeURIComponent(string[i]);
    }
    return result;
  }
  encode.defaultChars = ";/?:@&=+$,-_.!~*'()#";
  encode.componentChars = "-_.!~*'()";
  var encode_default = encode;

  // node_modules/mdurl/lib/format.mjs
  function format(url) {
    let result = "";
    result += url.protocol || "";
    result += url.slashes ? "//" : "";
    result += url.auth ? url.auth + "@" : "";
    if (url.hostname && url.hostname.indexOf(":") !== -1) {
      result += "[" + url.hostname + "]";
    } else {
      result += url.hostname || "";
    }
    result += url.port ? ":" + url.port : "";
    result += url.pathname || "";
    result += url.search || "";
    result += url.hash || "";
    return result;
  }

  // node_modules/mdurl/lib/parse.mjs
  function Url() {
    this.protocol = null;
    this.slashes = null;
    this.auth = null;
    this.port = null;
    this.hostname = null;
    this.hash = null;
    this.search = null;
    this.pathname = null;
  }
  var protocolPattern = /^([a-z0-9.+-]+:)/i;
  var portPattern = /:[0-9]*$/;
  var simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/;
  var delims = ["<", ">", '"', "`", " ", "\r", `
`, "\t"];
  var unwise = ["{", "}", "|", "\\", "^", "`"].concat(delims);
  var autoEscape = ["'"].concat(unwise);
  var nonHostChars = ["%", "/", "?", ";", "#"].concat(autoEscape);
  var hostEndingChars = ["/", "?", "#"];
  var hostnameMaxLen = 255;
  var hostnamePartPattern = /^[+a-z0-9A-Z_-]{0,63}$/;
  var hostnamePartStart = /^([+a-z0-9A-Z_-]{0,63})(.*)$/;
  var hostlessProtocol = {
    javascript: true,
    "javascript:": true
  };
  var slashedProtocol = {
    http: true,
    https: true,
    ftp: true,
    gopher: true,
    file: true,
    "http:": true,
    "https:": true,
    "ftp:": true,
    "gopher:": true,
    "file:": true
  };
  function urlParse(url, slashesDenoteHost) {
    if (url && url instanceof Url)
      return url;
    const u = new Url;
    u.parse(url, slashesDenoteHost);
    return u;
  }
  Url.prototype.parse = function(url, slashesDenoteHost) {
    let lowerProto, hec, slashes;
    let rest = url;
    rest = rest.trim();
    if (!slashesDenoteHost && url.split("#").length === 1) {
      const simplePath = simplePathPattern.exec(rest);
      if (simplePath) {
        this.pathname = simplePath[1];
        if (simplePath[2]) {
          this.search = simplePath[2];
        }
        return this;
      }
    }
    let proto = protocolPattern.exec(rest);
    if (proto) {
      proto = proto[0];
      lowerProto = proto.toLowerCase();
      this.protocol = proto;
      rest = rest.substr(proto.length);
    }
    if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
      slashes = rest.substr(0, 2) === "//";
      if (slashes && !(proto && hostlessProtocol[proto])) {
        rest = rest.substr(2);
        this.slashes = true;
      }
    }
    if (!hostlessProtocol[proto] && (slashes || proto && !slashedProtocol[proto])) {
      let hostEnd = -1;
      for (let i = 0;i < hostEndingChars.length; i++) {
        hec = rest.indexOf(hostEndingChars[i]);
        if (hec !== -1 && (hostEnd === -1 || hec < hostEnd)) {
          hostEnd = hec;
        }
      }
      let auth, atSign;
      if (hostEnd === -1) {
        atSign = rest.lastIndexOf("@");
      } else {
        atSign = rest.lastIndexOf("@", hostEnd);
      }
      if (atSign !== -1) {
        auth = rest.slice(0, atSign);
        rest = rest.slice(atSign + 1);
        this.auth = auth;
      }
      hostEnd = -1;
      for (let i = 0;i < nonHostChars.length; i++) {
        hec = rest.indexOf(nonHostChars[i]);
        if (hec !== -1 && (hostEnd === -1 || hec < hostEnd)) {
          hostEnd = hec;
        }
      }
      if (hostEnd === -1) {
        hostEnd = rest.length;
      }
      if (rest[hostEnd - 1] === ":") {
        hostEnd--;
      }
      const host = rest.slice(0, hostEnd);
      rest = rest.slice(hostEnd);
      this.parseHost(host);
      this.hostname = this.hostname || "";
      const ipv6Hostname = this.hostname[0] === "[" && this.hostname[this.hostname.length - 1] === "]";
      if (!ipv6Hostname) {
        const hostparts = this.hostname.split(/\./);
        for (let i = 0, l = hostparts.length;i < l; i++) {
          const part = hostparts[i];
          if (!part) {
            continue;
          }
          if (!part.match(hostnamePartPattern)) {
            let newpart = "";
            for (let j = 0, k = part.length;j < k; j++) {
              if (part.charCodeAt(j) > 127) {
                newpart += "x";
              } else {
                newpart += part[j];
              }
            }
            if (!newpart.match(hostnamePartPattern)) {
              const validParts = hostparts.slice(0, i);
              const notHost = hostparts.slice(i + 1);
              const bit = part.match(hostnamePartStart);
              if (bit) {
                validParts.push(bit[1]);
                notHost.unshift(bit[2]);
              }
              if (notHost.length) {
                rest = notHost.join(".") + rest;
              }
              this.hostname = validParts.join(".");
              break;
            }
          }
        }
      }
      if (this.hostname.length > hostnameMaxLen) {
        this.hostname = "";
      }
      if (ipv6Hostname) {
        this.hostname = this.hostname.substr(1, this.hostname.length - 2);
      }
    }
    const hash = rest.indexOf("#");
    if (hash !== -1) {
      this.hash = rest.substr(hash);
      rest = rest.slice(0, hash);
    }
    const qm = rest.indexOf("?");
    if (qm !== -1) {
      this.search = rest.substr(qm);
      rest = rest.slice(0, qm);
    }
    if (rest) {
      this.pathname = rest;
    }
    if (slashedProtocol[lowerProto] && this.hostname && !this.pathname) {
      this.pathname = "";
    }
    return this;
  };
  Url.prototype.parseHost = function(host) {
    let port = portPattern.exec(host);
    if (port) {
      port = port[0];
      if (port !== ":") {
        this.port = port.substr(1);
      }
      host = host.substr(0, host.length - port.length);
    }
    if (host) {
      this.hostname = host;
    }
  };
  var parse_default = urlParse;

  // node_modules/uc.micro/index.mjs
  var exports_uc = {};
  __export(exports_uc, {
    Z: () => regex_default6,
    S: () => regex_default5,
    P: () => regex_default4,
    Cf: () => regex_default3,
    Cc: () => regex_default2,
    Any: () => regex_default
  });

  // node_modules/uc.micro/properties/Any/regex.mjs
  var regex_default = /[\0-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;

  // node_modules/uc.micro/categories/Cc/regex.mjs
  var regex_default2 = /[\0-\x1F\x7F-\x9F]/;

  // node_modules/uc.micro/categories/Cf/regex.mjs
  var regex_default3 = /[\xAD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]|\uD804[\uDCBD\uDCCD]|\uD80D[\uDC30-\uDC3F]|\uD82F[\uDCA0-\uDCA3]|\uD834[\uDD73-\uDD7A]|\uDB40[\uDC01\uDC20-\uDC7F]/;

  // node_modules/uc.micro/categories/P/regex.mjs
  var regex_default4 = /[!-#%-\*,-\/:;\?@\[-\]_\{\}\xA1\xA7\xAB\xB6\xB7\xBB\xBF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061D-\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C77\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1B7D\u1B7E\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4F\u2E52-\u2E5D\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]|\uD800[\uDD00-\uDD02\uDF9F\uDFD0]|\uD801\uDD6F|\uD802[\uDC57\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD803[\uDEAD\uDF55-\uDF59\uDF86-\uDF89]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDDF\uDE38-\uDE3D\uDEA9]|\uD805[\uDC4B-\uDC4F\uDC5A\uDC5B\uDC5D\uDCC6\uDDC1-\uDDD7\uDE41-\uDE43\uDE60-\uDE6C\uDEB9\uDF3C-\uDF3E]|\uD806[\uDC3B\uDD44-\uDD46\uDDE2\uDE3F-\uDE46\uDE9A-\uDE9C\uDE9E-\uDEA2\uDF00-\uDF09]|\uD807[\uDC41-\uDC45\uDC70\uDC71\uDEF7\uDEF8\uDF43-\uDF4F\uDFFF]|\uD809[\uDC70-\uDC74]|\uD80B[\uDFF1\uDFF2]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3B\uDF44]|\uD81B[\uDE97-\uDE9A\uDFE2]|\uD82F\uDC9F|\uD836[\uDE87-\uDE8B]|\uD83A[\uDD5E\uDD5F]/;

  // node_modules/uc.micro/categories/S/regex.mjs
  var regex_default5 = /[\$\+<->\^`\|~\xA2-\xA6\xA8\xA9\xAC\xAE-\xB1\xB4\xB8\xD7\xF7\u02C2-\u02C5\u02D2-\u02DF\u02E5-\u02EB\u02ED\u02EF-\u02FF\u0375\u0384\u0385\u03F6\u0482\u058D-\u058F\u0606-\u0608\u060B\u060E\u060F\u06DE\u06E9\u06FD\u06FE\u07F6\u07FE\u07FF\u0888\u09F2\u09F3\u09FA\u09FB\u0AF1\u0B70\u0BF3-\u0BFA\u0C7F\u0D4F\u0D79\u0E3F\u0F01-\u0F03\u0F13\u0F15-\u0F17\u0F1A-\u0F1F\u0F34\u0F36\u0F38\u0FBE-\u0FC5\u0FC7-\u0FCC\u0FCE\u0FCF\u0FD5-\u0FD8\u109E\u109F\u1390-\u1399\u166D\u17DB\u1940\u19DE-\u19FF\u1B61-\u1B6A\u1B74-\u1B7C\u1FBD\u1FBF-\u1FC1\u1FCD-\u1FCF\u1FDD-\u1FDF\u1FED-\u1FEF\u1FFD\u1FFE\u2044\u2052\u207A-\u207C\u208A-\u208C\u20A0-\u20C0\u2100\u2101\u2103-\u2106\u2108\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u212E\u213A\u213B\u2140-\u2144\u214A-\u214D\u214F\u218A\u218B\u2190-\u2307\u230C-\u2328\u232B-\u2426\u2440-\u244A\u249C-\u24E9\u2500-\u2767\u2794-\u27C4\u27C7-\u27E5\u27F0-\u2982\u2999-\u29D7\u29DC-\u29FB\u29FE-\u2B73\u2B76-\u2B95\u2B97-\u2BFF\u2CE5-\u2CEA\u2E50\u2E51\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u2FF0-\u2FFF\u3004\u3012\u3013\u3020\u3036\u3037\u303E\u303F\u309B\u309C\u3190\u3191\u3196-\u319F\u31C0-\u31E3\u31EF\u3200-\u321E\u322A-\u3247\u3250\u3260-\u327F\u328A-\u32B0\u32C0-\u33FF\u4DC0-\u4DFF\uA490-\uA4C6\uA700-\uA716\uA720\uA721\uA789\uA78A\uA828-\uA82B\uA836-\uA839\uAA77-\uAA79\uAB5B\uAB6A\uAB6B\uFB29\uFBB2-\uFBC2\uFD40-\uFD4F\uFDCF\uFDFC-\uFDFF\uFE62\uFE64-\uFE66\uFE69\uFF04\uFF0B\uFF1C-\uFF1E\uFF3E\uFF40\uFF5C\uFF5E\uFFE0-\uFFE6\uFFE8-\uFFEE\uFFFC\uFFFD]|\uD800[\uDD37-\uDD3F\uDD79-\uDD89\uDD8C-\uDD8E\uDD90-\uDD9C\uDDA0\uDDD0-\uDDFC]|\uD802[\uDC77\uDC78\uDEC8]|\uD805\uDF3F|\uD807[\uDFD5-\uDFF1]|\uD81A[\uDF3C-\uDF3F\uDF45]|\uD82F\uDC9C|\uD833[\uDF50-\uDFC3]|\uD834[\uDC00-\uDCF5\uDD00-\uDD26\uDD29-\uDD64\uDD6A-\uDD6C\uDD83\uDD84\uDD8C-\uDDA9\uDDAE-\uDDEA\uDE00-\uDE41\uDE45\uDF00-\uDF56]|\uD835[\uDEC1\uDEDB\uDEFB\uDF15\uDF35\uDF4F\uDF6F\uDF89\uDFA9\uDFC3]|\uD836[\uDC00-\uDDFF\uDE37-\uDE3A\uDE6D-\uDE74\uDE76-\uDE83\uDE85\uDE86]|\uD838[\uDD4F\uDEFF]|\uD83B[\uDCAC\uDCB0\uDD2E\uDEF0\uDEF1]|\uD83C[\uDC00-\uDC2B\uDC30-\uDC93\uDCA0-\uDCAE\uDCB1-\uDCBF\uDCC1-\uDCCF\uDCD1-\uDCF5\uDD0D-\uDDAD\uDDE6-\uDE02\uDE10-\uDE3B\uDE40-\uDE48\uDE50\uDE51\uDE60-\uDE65\uDF00-\uDFFF]|\uD83D[\uDC00-\uDED7\uDEDC-\uDEEC\uDEF0-\uDEFC\uDF00-\uDF76\uDF7B-\uDFD9\uDFE0-\uDFEB\uDFF0]|\uD83E[\uDC00-\uDC0B\uDC10-\uDC47\uDC50-\uDC59\uDC60-\uDC87\uDC90-\uDCAD\uDCB0\uDCB1\uDD00-\uDE53\uDE60-\uDE6D\uDE70-\uDE7C\uDE80-\uDE88\uDE90-\uDEBD\uDEBF-\uDEC5\uDECE-\uDEDB\uDEE0-\uDEE8\uDEF0-\uDEF8\uDF00-\uDF92\uDF94-\uDFCA]/;

  // node_modules/uc.micro/categories/Z/regex.mjs
  var regex_default6 = /[ \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;

  // node_modules/entities/lib/esm/generated/decode-data-html.js
  var decode_data_html_default = new Uint16Array("ᵁ<Õıʊҝջאٵ۞ޢߖࠏ੊ઑඡ๭༉༦჊ረዡᐕᒝᓃᓟᔥ\x00\x00\x00\x00\x00\x00ᕫᛍᦍᰒᷝ὾⁠↰⊍⏀⏻⑂⠤⤒ⴈ⹈⿎〖㊺㘹㞬㣾㨨㩱㫠㬮ࠀEMabcfglmnoprstu\\bfms¦³¹ÈÏlig耻Æ䃆P耻&䀦cute耻Á䃁reve;䄂Āiyx}rc耻Â䃂;䐐r;쀀\uD835\uDD04rave耻À䃀pha;䎑acr;䄀d;橓Āgp¡on;䄄f;쀀\uD835\uDD38plyFunction;恡ing耻Å䃅Ācs¾Ãr;쀀\uD835\uDC9Cign;扔ilde耻Ã䃃ml耻Ä䃄ЀaceforsuåûþėĜĢħĪĀcrêòkslash;或Ŷöø;櫧ed;挆y;䐑ƀcrtąċĔause;戵noullis;愬a;䎒r;쀀\uD835\uDD05pf;쀀\uD835\uDD39eve;䋘còēmpeq;扎܀HOacdefhilorsuōőŖƀƞƢƵƷƺǜȕɳɸɾcy;䐧PY耻©䂩ƀcpyŝŢźute;䄆Ā;iŧŨ拒talDifferentialD;慅leys;愭ȀaeioƉƎƔƘron;䄌dil耻Ç䃇rc;䄈nint;戰ot;䄊ĀdnƧƭilla;䂸terDot;䂷òſi;䎧rcleȀDMPTǇǋǑǖot;抙inus;抖lus;投imes;抗oĀcsǢǸkwiseContourIntegral;戲eCurlyĀDQȃȏoubleQuote;思uote;怙ȀlnpuȞȨɇɕonĀ;eȥȦ户;橴ƀgitȯȶȺruent;扡nt;戯ourIntegral;戮ĀfrɌɎ;愂oduct;成nterClockwiseContourIntegral;戳oss;樯cr;쀀\uD835\uDC9EpĀ;Cʄʅ拓ap;才րDJSZacefiosʠʬʰʴʸˋ˗ˡ˦̳ҍĀ;oŹʥtrahd;椑cy;䐂cy;䐅cy;䐏ƀgrsʿ˄ˇger;怡r;憡hv;櫤Āayː˕ron;䄎;䐔lĀ;t˝˞戇a;䎔r;쀀\uD835\uDD07Āaf˫̧Ācm˰̢riticalȀADGT̖̜̀̆cute;䂴oŴ̋̍;䋙bleAcute;䋝rave;䁠ilde;䋜ond;拄ferentialD;慆Ѱ̽\x00\x00\x00͔͂\x00Ѕf;쀀\uD835\uDD3Bƀ;DE͈͉͍䂨ot;惜qual;扐blèCDLRUVͣͲ΂ϏϢϸontourIntegraìȹoɴ͹\x00\x00ͻ»͉nArrow;懓Āeo·ΤftƀARTΐΖΡrrow;懐ightArrow;懔eåˊngĀLRΫτeftĀARγιrrow;柸ightArrow;柺ightArrow;柹ightĀATϘϞrrow;懒ee;抨pɁϩ\x00\x00ϯrrow;懑ownArrow;懕erticalBar;戥ǹABLRTaВЪаўѿͼrrowƀ;BUНОТ憓ar;椓pArrow;懵reve;䌑eft˒к\x00ц\x00ѐightVector;楐eeVector;楞ectorĀ;Bљњ憽ar;楖ightǔѧ\x00ѱeeVector;楟ectorĀ;BѺѻ懁ar;楗eeĀ;A҆҇护rrow;憧ĀctҒҗr;쀀\uD835\uDC9Frok;䄐ࠀNTacdfglmopqstuxҽӀӄӋӞӢӧӮӵԡԯԶՒ՝ՠեG;䅊H耻Ð䃐cute耻É䃉ƀaiyӒӗӜron;䄚rc耻Ê䃊;䐭ot;䄖r;쀀\uD835\uDD08rave耻È䃈ement;戈ĀapӺӾcr;䄒tyɓԆ\x00\x00ԒmallSquare;旻erySmallSquare;斫ĀgpԦԪon;䄘f;쀀\uD835\uDD3Csilon;䎕uĀaiԼՉlĀ;TՂՃ橵ilde;扂librium;懌Āci՗՚r;愰m;橳a;䎗ml耻Ë䃋Āipժկsts;戃onentialE;慇ʀcfiosօֈ֍ֲ׌y;䐤r;쀀\uD835\uDD09lledɓ֗\x00\x00֣mallSquare;旼erySmallSquare;斪Ͱֺ\x00ֿ\x00\x00ׄf;쀀\uD835\uDD3DAll;戀riertrf;愱cò׋؀JTabcdfgorstר׬ׯ׺؀ؒؖ؛؝أ٬ٲcy;䐃耻>䀾mmaĀ;d׷׸䎓;䏜reve;䄞ƀeiy؇،ؐdil;䄢rc;䄜;䐓ot;䄠r;쀀\uD835\uDD0A;拙pf;쀀\uD835\uDD3Eeater̀EFGLSTصلَٖٛ٦qualĀ;Lؾؿ扥ess;招ullEqual;执reater;檢ess;扷lantEqual;橾ilde;扳cr;쀀\uD835\uDCA2;扫ЀAacfiosuڅڋږڛڞڪھۊRDcy;䐪Āctڐڔek;䋇;䁞irc;䄤r;愌lbertSpace;愋ǰگ\x00ڲf;愍izontalLine;攀Āctۃۅòکrok;䄦mpńېۘownHumðįqual;扏܀EJOacdfgmnostuۺ۾܃܇܎ܚܞܡܨ݄ݸދޏޕcy;䐕lig;䄲cy;䐁cute耻Í䃍Āiyܓܘrc耻Î䃎;䐘ot;䄰r;愑rave耻Ì䃌ƀ;apܠܯܿĀcgܴܷr;䄪inaryI;慈lieóϝǴ݉\x00ݢĀ;eݍݎ戬Āgrݓݘral;戫section;拂isibleĀCTݬݲomma;恣imes;恢ƀgptݿރވon;䄮f;쀀\uD835\uDD40a;䎙cr;愐ilde;䄨ǫޚ\x00ޞcy;䐆l耻Ï䃏ʀcfosuެ޷޼߂ߐĀiyޱ޵rc;䄴;䐙r;쀀\uD835\uDD0Dpf;쀀\uD835\uDD41ǣ߇\x00ߌr;쀀\uD835\uDCA5rcy;䐈kcy;䐄΀HJacfosߤߨ߽߬߱ࠂࠈcy;䐥cy;䐌ppa;䎚Āey߶߻dil;䄶;䐚r;쀀\uD835\uDD0Epf;쀀\uD835\uDD42cr;쀀\uD835\uDCA6րJTaceflmostࠥࠩࠬࡐࡣ঳সে্਷ੇcy;䐉耻<䀼ʀcmnpr࠷࠼ࡁࡄࡍute;䄹bda;䎛g;柪lacetrf;愒r;憞ƀaeyࡗ࡜ࡡron;䄽dil;䄻;䐛Āfsࡨ॰tԀACDFRTUVarࡾࢩࢱࣦ࣠ࣼयज़ΐ४Ānrࢃ࢏gleBracket;柨rowƀ;BR࢙࢚࢞憐ar;懤ightArrow;懆eiling;挈oǵࢷ\x00ࣃbleBracket;柦nǔࣈ\x00࣒eeVector;楡ectorĀ;Bࣛࣜ懃ar;楙loor;挊ightĀAV࣯ࣵrrow;憔ector;楎Āerँगeƀ;AVउऊऐ抣rrow;憤ector;楚iangleƀ;BEतथऩ抲ar;槏qual;抴pƀDTVषूौownVector;楑eeVector;楠ectorĀ;Bॖॗ憿ar;楘ectorĀ;B॥०憼ar;楒ightáΜs̀EFGLSTॾঋকঝঢভqualGreater;拚ullEqual;扦reater;扶ess;檡lantEqual;橽ilde;扲r;쀀\uD835\uDD0FĀ;eঽা拘ftarrow;懚idot;䄿ƀnpw৔ਖਛgȀLRlr৞৷ਂਐeftĀAR০৬rrow;柵ightArrow;柷ightArrow;柶eftĀarγਊightáοightáϊf;쀀\uD835\uDD43erĀLRਢਬeftArrow;憙ightArrow;憘ƀchtਾੀੂòࡌ;憰rok;䅁;扪Ѐacefiosuਗ਼੝੠੷੼અઋ઎p;椅y;䐜Ādl੥੯iumSpace;恟lintrf;愳r;쀀\uD835\uDD10nusPlus;戓pf;쀀\uD835\uDD44cò੶;䎜ҀJacefostuણધભીଔଙඑ඗ඞcy;䐊cute;䅃ƀaey઴હાron;䅇dil;䅅;䐝ƀgswે૰଎ativeƀMTV૓૟૨ediumSpace;怋hiĀcn૦૘ë૙eryThiî૙tedĀGL૸ଆreaterGreateòٳessLesóੈLine;䀊r;쀀\uD835\uDD11ȀBnptଢନଷ଺reak;恠BreakingSpace;䂠f;愕ڀ;CDEGHLNPRSTV୕ୖ୪୼஡௫ఄ౞಄ದ೘ൡඅ櫬Āou୛୤ngruent;扢pCap;扭oubleVerticalBar;戦ƀlqxஃஊ஛ement;戉ualĀ;Tஒஓ扠ilde;쀀≂̸ists;戄reater΀;EFGLSTஶஷ஽௉௓௘௥扯qual;扱ullEqual;쀀≧̸reater;쀀≫̸ess;批lantEqual;쀀⩾̸ilde;扵umpń௲௽ownHump;쀀≎̸qual;쀀≏̸eĀfsఊధtTriangleƀ;BEచఛడ拪ar;쀀⧏̸qual;括s̀;EGLSTవశ఼ౄోౘ扮qual;扰reater;扸ess;쀀≪̸lantEqual;쀀⩽̸ilde;扴estedĀGL౨౹reaterGreater;쀀⪢̸essLess;쀀⪡̸recedesƀ;ESಒಓಛ技qual;쀀⪯̸lantEqual;拠ĀeiಫಹverseElement;戌ghtTriangleƀ;BEೋೌ೒拫ar;쀀⧐̸qual;拭ĀquೝഌuareSuĀbp೨೹setĀ;E೰ೳ쀀⊏̸qual;拢ersetĀ;Eഃആ쀀⊐̸qual;拣ƀbcpഓതൎsetĀ;Eഛഞ쀀⊂⃒qual;抈ceedsȀ;ESTലള഻െ抁qual;쀀⪰̸lantEqual;拡ilde;쀀≿̸ersetĀ;E൘൛쀀⊃⃒qual;抉ildeȀ;EFT൮൯൵ൿ扁qual;扄ullEqual;扇ilde;扉erticalBar;戤cr;쀀\uD835\uDCA9ilde耻Ñ䃑;䎝܀Eacdfgmoprstuvලෂ෉෕ෛ෠෧෼ขภยา฿ไlig;䅒cute耻Ó䃓Āiy෎ීrc耻Ô䃔;䐞blac;䅐r;쀀\uD835\uDD12rave耻Ò䃒ƀaei෮ෲ෶cr;䅌ga;䎩cron;䎟pf;쀀\uD835\uDD46enCurlyĀDQฎบoubleQuote;怜uote;怘;橔Āclวฬr;쀀\uD835\uDCAAash耻Ø䃘iŬื฼de耻Õ䃕es;樷ml耻Ö䃖erĀBP๋๠Āar๐๓r;怾acĀek๚๜;揞et;掴arenthesis;揜Ҁacfhilors๿ງຊຏຒດຝະ໼rtialD;戂y;䐟r;쀀\uD835\uDD13i;䎦;䎠usMinus;䂱Āipຢອncareplanåڝf;愙Ȁ;eio຺ູ໠໤檻cedesȀ;EST່້໏໚扺qual;檯lantEqual;扼ilde;找me;怳Ādp໩໮uct;戏ortionĀ;aȥ໹l;戝Āci༁༆r;쀀\uD835\uDCAB;䎨ȀUfos༑༖༛༟OT耻\"䀢r;쀀\uD835\uDD14pf;愚cr;쀀\uD835\uDCAC؀BEacefhiorsu༾གྷཇའཱིྦྷྪྭ႖ႩႴႾarr;椐G耻®䂮ƀcnrཎནབute;䅔g;柫rĀ;tཛྷཝ憠l;椖ƀaeyཧཬཱron;䅘dil;䅖;䐠Ā;vླྀཹ愜erseĀEUྂྙĀlq྇ྎement;戋uilibrium;懋pEquilibrium;楯r»ཹo;䎡ghtЀACDFTUVa࿁࿫࿳ဢဨၛႇϘĀnr࿆࿒gleBracket;柩rowƀ;BL࿜࿝࿡憒ar;懥eftArrow;懄eiling;按oǵ࿹\x00စbleBracket;柧nǔည\x00နeeVector;楝ectorĀ;Bဝသ懂ar;楕loor;挋Āerိ၃eƀ;AVဵံြ抢rrow;憦ector;楛iangleƀ;BEၐၑၕ抳ar;槐qual;抵pƀDTVၣၮၸownVector;楏eeVector;楜ectorĀ;Bႂႃ憾ar;楔ectorĀ;B႑႒懀ar;楓Āpuႛ႞f;愝ndImplies;楰ightarrow;懛ĀchႹႼr;愛;憱leDelayed;槴ڀHOacfhimoqstuფჱჷჽᄙᄞᅑᅖᅡᅧᆵᆻᆿĀCcჩხHcy;䐩y;䐨FTcy;䐬cute;䅚ʀ;aeiyᄈᄉᄎᄓᄗ檼ron;䅠dil;䅞rc;䅜;䐡r;쀀\uD835\uDD16ortȀDLRUᄪᄴᄾᅉownArrow»ОeftArrow»࢚ightArrow»࿝pArrow;憑gma;䎣allCircle;战pf;쀀\uD835\uDD4Aɲᅭ\x00\x00ᅰt;戚areȀ;ISUᅻᅼᆉᆯ斡ntersection;抓uĀbpᆏᆞsetĀ;Eᆗᆘ抏qual;抑ersetĀ;Eᆨᆩ抐qual;抒nion;抔cr;쀀\uD835\uDCAEar;拆ȀbcmpᇈᇛሉላĀ;sᇍᇎ拐etĀ;Eᇍᇕqual;抆ĀchᇠህeedsȀ;ESTᇭᇮᇴᇿ扻qual;檰lantEqual;扽ilde;承Tháྌ;我ƀ;esሒሓሣ拑rsetĀ;Eሜም抃qual;抇et»ሓրHRSacfhiorsሾቄ቉ቕ቞ቱቶኟዂወዑORN耻Þ䃞ADE;愢ĀHc቎ቒcy;䐋y;䐦Ābuቚቜ;䀉;䎤ƀaeyብቪቯron;䅤dil;䅢;䐢r;쀀\uD835\uDD17Āeiቻ኉ǲኀ\x00ኇefore;戴a;䎘Ācn኎ኘkSpace;쀀  Space;怉ldeȀ;EFTካኬኲኼ戼qual;扃ullEqual;扅ilde;扈pf;쀀\uD835\uDD4BipleDot;惛Āctዖዛr;쀀\uD835\uDCAFrok;䅦ૡዷጎጚጦ\x00ጬጱ\x00\x00\x00\x00\x00ጸጽ፷ᎅ\x00᏿ᐄᐊᐐĀcrዻጁute耻Ú䃚rĀ;oጇገ憟cir;楉rǣጓ\x00጖y;䐎ve;䅬Āiyጞጣrc耻Û䃛;䐣blac;䅰r;쀀\uD835\uDD18rave耻Ù䃙acr;䅪Ādiፁ፩erĀBPፈ፝Āarፍፐr;䁟acĀekፗፙ;揟et;掵arenthesis;揝onĀ;P፰፱拃lus;抎Āgp፻፿on;䅲f;쀀\uD835\uDD4CЀADETadps᎕ᎮᎸᏄϨᏒᏗᏳrrowƀ;BDᅐᎠᎤar;椒ownArrow;懅ownArrow;憕quilibrium;楮eeĀ;AᏋᏌ报rrow;憥ownáϳerĀLRᏞᏨeftArrow;憖ightArrow;憗iĀ;lᏹᏺ䏒on;䎥ing;䅮cr;쀀\uD835\uDCB0ilde;䅨ml耻Ü䃜ҀDbcdefosvᐧᐬᐰᐳᐾᒅᒊᒐᒖash;披ar;櫫y;䐒ashĀ;lᐻᐼ抩;櫦Āerᑃᑅ;拁ƀbtyᑌᑐᑺar;怖Ā;iᑏᑕcalȀBLSTᑡᑥᑪᑴar;戣ine;䁼eparator;杘ilde;所ThinSpace;怊r;쀀\uD835\uDD19pf;쀀\uD835\uDD4Dcr;쀀\uD835\uDCB1dash;抪ʀcefosᒧᒬᒱᒶᒼirc;䅴dge;拀r;쀀\uD835\uDD1Apf;쀀\uD835\uDD4Ecr;쀀\uD835\uDCB2Ȁfiosᓋᓐᓒᓘr;쀀\uD835\uDD1B;䎞pf;쀀\uD835\uDD4Fcr;쀀\uD835\uDCB3ҀAIUacfosuᓱᓵᓹᓽᔄᔏᔔᔚᔠcy;䐯cy;䐇cy;䐮cute耻Ý䃝Āiyᔉᔍrc;䅶;䐫r;쀀\uD835\uDD1Cpf;쀀\uD835\uDD50cr;쀀\uD835\uDCB4ml;䅸ЀHacdefosᔵᔹᔿᕋᕏᕝᕠᕤcy;䐖cute;䅹Āayᕄᕉron;䅽;䐗ot;䅻ǲᕔ\x00ᕛoWidtè૙a;䎖r;愨pf;愤cr;쀀\uD835\uDCB5௡ᖃᖊᖐ\x00ᖰᖶᖿ\x00\x00\x00\x00ᗆᗛᗫᙟ᙭\x00ᚕ᚛ᚲᚹ\x00ᚾcute耻á䃡reve;䄃̀;Ediuyᖜᖝᖡᖣᖨᖭ戾;쀀∾̳;房rc耻â䃢te肻´̆;䐰lig耻æ䃦Ā;r²ᖺ;쀀\uD835\uDD1Erave耻à䃠ĀepᗊᗖĀfpᗏᗔsym;愵èᗓha;䎱ĀapᗟcĀclᗤᗧr;䄁g;樿ɤᗰ\x00\x00ᘊʀ;adsvᗺᗻᗿᘁᘇ戧nd;橕;橜lope;橘;橚΀;elmrszᘘᘙᘛᘞᘿᙏᙙ戠;榤e»ᘙsdĀ;aᘥᘦ戡ѡᘰᘲᘴᘶᘸᘺᘼᘾ;榨;榩;榪;榫;榬;榭;榮;榯tĀ;vᙅᙆ戟bĀ;dᙌᙍ抾;榝Āptᙔᙗh;戢»¹arr;捼Āgpᙣᙧon;䄅f;쀀\uD835\uDD52΀;Eaeiop዁ᙻᙽᚂᚄᚇᚊ;橰cir;橯;扊d;手s;䀧roxĀ;e዁ᚒñᚃing耻å䃥ƀctyᚡᚦᚨr;쀀\uD835\uDCB6;䀪mpĀ;e዁ᚯñʈilde耻ã䃣ml耻ä䃤Āciᛂᛈoninôɲnt;樑ࠀNabcdefiklnoprsu᛭ᛱᜰ᜼ᝃᝈ᝸᝽០៦ᠹᡐᜍ᤽᥈ᥰot;櫭Ācrᛶ᜞kȀcepsᜀᜅᜍᜓong;扌psilon;䏶rime;怵imĀ;e᜚᜛戽q;拍Ŷᜢᜦee;抽edĀ;gᜬᜭ挅e»ᜭrkĀ;t፜᜷brk;掶Āoyᜁᝁ;䐱quo;怞ʀcmprtᝓ᝛ᝡᝤᝨausĀ;eĊĉptyv;榰séᜌnoõēƀahwᝯ᝱ᝳ;䎲;愶een;扬r;쀀\uD835\uDD1Fg΀costuvwឍឝឳេ៕៛៞ƀaiuបពរðݠrc;旯p»፱ƀdptឤឨឭot;樀lus;樁imes;樂ɱឹ\x00\x00ើcup;樆ar;昅riangleĀdu៍្own;施p;斳plus;樄eåᑄåᒭarow;植ƀako៭ᠦᠵĀcn៲ᠣkƀlst៺֫᠂ozenge;槫riangleȀ;dlr᠒᠓᠘᠝斴own;斾eft;旂ight;斸k;搣Ʊᠫ\x00ᠳƲᠯ\x00ᠱ;斒;斑4;斓ck;斈ĀeoᠾᡍĀ;qᡃᡆ쀀=⃥uiv;쀀≡⃥t;挐Ȁptwxᡙᡞᡧᡬf;쀀\uD835\uDD53Ā;tᏋᡣom»Ꮜtie;拈؀DHUVbdhmptuvᢅᢖᢪᢻᣗᣛᣬ᣿ᤅᤊᤐᤡȀLRlrᢎᢐᢒᢔ;敗;敔;敖;敓ʀ;DUduᢡᢢᢤᢦᢨ敐;敦;敩;敤;敧ȀLRlrᢳᢵᢷᢹ;敝;敚;敜;教΀;HLRhlrᣊᣋᣍᣏᣑᣓᣕ救;敬;散;敠;敫;敢;敟ox;槉ȀLRlrᣤᣦᣨᣪ;敕;敒;攐;攌ʀ;DUduڽ᣷᣹᣻᣽;敥;敨;攬;攴inus;抟lus;択imes;抠ȀLRlrᤙᤛᤝ᤟;敛;敘;攘;攔΀;HLRhlrᤰᤱᤳᤵᤷ᤻᤹攂;敪;敡;敞;攼;攤;攜Āevģ᥂bar耻¦䂦Ȁceioᥑᥖᥚᥠr;쀀\uD835\uDCB7mi;恏mĀ;e᜚᜜lƀ;bhᥨᥩᥫ䁜;槅sub;柈Ŭᥴ᥾lĀ;e᥹᥺怢t»᥺pƀ;Eeįᦅᦇ;檮Ā;qۜۛೡᦧ\x00᧨ᨑᨕᨲ\x00ᨷᩐ\x00\x00᪴\x00\x00᫁\x00\x00ᬡᬮ᭍᭒\x00᯽\x00ᰌƀcpr᦭ᦲ᧝ute;䄇̀;abcdsᦿᧀᧄ᧊᧕᧙戩nd;橄rcup;橉Āau᧏᧒p;橋p;橇ot;橀;쀀∩︀Āeo᧢᧥t;恁îړȀaeiu᧰᧻ᨁᨅǰ᧵\x00᧸s;橍on;䄍dil耻ç䃧rc;䄉psĀ;sᨌᨍ橌m;橐ot;䄋ƀdmnᨛᨠᨦil肻¸ƭptyv;榲t脀¢;eᨭᨮ䂢räƲr;쀀\uD835\uDD20ƀceiᨽᩀᩍy;䑇ckĀ;mᩇᩈ朓ark»ᩈ;䏇r΀;Ecefms᩟᩠ᩢᩫ᪤᪪᪮旋;槃ƀ;elᩩᩪᩭ䋆q;扗eɡᩴ\x00\x00᪈rrowĀlr᩼᪁eft;憺ight;憻ʀRSacd᪒᪔᪖᪚᪟»ཇ;擈st;抛irc;抚ash;抝nint;樐id;櫯cir;槂ubsĀ;u᪻᪼晣it»᪼ˬ᫇᫔᫺\x00ᬊonĀ;eᫍᫎ䀺Ā;qÇÆɭ᫙\x00\x00᫢aĀ;t᫞᫟䀬;䁀ƀ;fl᫨᫩᫫戁îᅠeĀmx᫱᫶ent»᫩eóɍǧ᫾\x00ᬇĀ;dኻᬂot;橭nôɆƀfryᬐᬔᬗ;쀀\uD835\uDD54oäɔ脀©;sŕᬝr;愗Āaoᬥᬩrr;憵ss;朗Ācuᬲᬷr;쀀\uD835\uDCB8Ābpᬼ᭄Ā;eᭁᭂ櫏;櫑Ā;eᭉᭊ櫐;櫒dot;拯΀delprvw᭠᭬᭷ᮂᮬᯔ᯹arrĀlr᭨᭪;椸;椵ɰ᭲\x00\x00᭵r;拞c;拟arrĀ;p᭿ᮀ憶;椽̀;bcdosᮏᮐᮖᮡᮥᮨ截rcap;橈Āauᮛᮞp;橆p;橊ot;抍r;橅;쀀∪︀Ȁalrv᮵ᮿᯞᯣrrĀ;mᮼᮽ憷;椼yƀevwᯇᯔᯘqɰᯎ\x00\x00ᯒreã᭳uã᭵ee;拎edge;拏en耻¤䂤earrowĀlrᯮ᯳eft»ᮀight»ᮽeäᯝĀciᰁᰇoninôǷnt;戱lcty;挭ঀAHabcdefhijlorstuwz᰸᰻᰿ᱝᱩᱵᲊᲞᲬᲷ᳻᳿ᴍᵻᶑᶫᶻ᷆᷍rò΁ar;楥Ȁglrs᱈ᱍ᱒᱔ger;怠eth;愸òᄳhĀ;vᱚᱛ怐»ऊūᱡᱧarow;椏aã̕Āayᱮᱳron;䄏;䐴ƀ;ao̲ᱼᲄĀgrʿᲁr;懊tseq;橷ƀglmᲑᲔᲘ耻°䂰ta;䎴ptyv;榱ĀirᲣᲨsht;楿;쀀\uD835\uDD21arĀlrᲳᲵ»ࣜ»သʀaegsv᳂͸᳖᳜᳠mƀ;oș᳊᳔ndĀ;ș᳑uit;晦amma;䏝in;拲ƀ;io᳧᳨᳸䃷de脀÷;o᳧ᳰntimes;拇nø᳷cy;䑒cɯᴆ\x00\x00ᴊrn;挞op;挍ʀlptuwᴘᴝᴢᵉᵕlar;䀤f;쀀\uD835\uDD55ʀ;emps̋ᴭᴷᴽᵂqĀ;d͒ᴳot;扑inus;戸lus;戔quare;抡blebarwedgåúnƀadhᄮᵝᵧownarrowóᲃarpoonĀlrᵲᵶefôᲴighôᲶŢᵿᶅkaro÷གɯᶊ\x00\x00ᶎrn;挟op;挌ƀcotᶘᶣᶦĀryᶝᶡ;쀀\uD835\uDCB9;䑕l;槶rok;䄑Ādrᶰᶴot;拱iĀ;fᶺ᠖斿Āah᷀᷃ròЩaòྦangle;榦Āci᷒ᷕy;䑟grarr;柿ऀDacdefglmnopqrstuxḁḉḙḸոḼṉṡṾấắẽỡἪἷὄ὎὚ĀDoḆᴴoôᲉĀcsḎḔute耻é䃩ter;橮ȀaioyḢḧḱḶron;䄛rĀ;cḭḮ扖耻ê䃪lon;払;䑍ot;䄗ĀDrṁṅot;扒;쀀\uD835\uDD22ƀ;rsṐṑṗ檚ave耻è䃨Ā;dṜṝ檖ot;檘Ȁ;ilsṪṫṲṴ檙nters;揧;愓Ā;dṹṺ檕ot;檗ƀapsẅẉẗcr;䄓tyƀ;svẒẓẕ戅et»ẓpĀ1;ẝẤĳạả;怄;怅怃ĀgsẪẬ;䅋p;怂ĀgpẴẸon;䄙f;쀀\uD835\uDD56ƀalsỄỎỒrĀ;sỊị拕l;槣us;橱iƀ;lvỚớở䎵on»ớ;䏵ȀcsuvỪỳἋἣĀioữḱrc»Ḯɩỹ\x00\x00ỻíՈantĀglἂἆtr»ṝess»Ṻƀaeiἒ἖Ἒls;䀽st;扟vĀ;DȵἠD;橸parsl;槥ĀDaἯἳot;打rr;楱ƀcdiἾὁỸr;愯oô͒ĀahὉὋ;䎷耻ð䃰Āmrὓὗl耻ë䃫o;悬ƀcipὡὤὧl;䀡sôծĀeoὬὴctatioîՙnentialåչৡᾒ\x00ᾞ\x00ᾡᾧ\x00\x00ῆῌ\x00ΐ\x00ῦῪ \x00 ⁚llingdotseñṄy;䑄male;晀ƀilrᾭᾳ῁lig;耀ﬃɩᾹ\x00\x00᾽g;耀ﬀig;耀ﬄ;쀀\uD835\uDD23lig;耀ﬁlig;쀀fjƀaltῙ῜ῡt;晭ig;耀ﬂns;斱of;䆒ǰ΅\x00ῳf;쀀\uD835\uDD57ĀakֿῷĀ;vῼ´拔;櫙artint;樍Āao‌⁕Ācs‑⁒α‚‰‸⁅⁈\x00⁐β•‥‧‪‬\x00‮耻½䂽;慓耻¼䂼;慕;慙;慛Ƴ‴\x00‶;慔;慖ʴ‾⁁\x00\x00⁃耻¾䂾;慗;慜5;慘ƶ⁌\x00⁎;慚;慝8;慞l;恄wn;挢cr;쀀\uD835\uDCBBࢀEabcdefgijlnorstv₂₉₟₥₰₴⃰⃵⃺⃿℃ℒℸ̗ℾ⅒↞Ā;lٍ₇;檌ƀcmpₐₕ₝ute;䇵maĀ;dₜ᳚䎳;檆reve;䄟Āiy₪₮rc;䄝;䐳ot;䄡Ȁ;lqsؾق₽⃉ƀ;qsؾٌ⃄lanô٥Ȁ;cdl٥⃒⃥⃕c;檩otĀ;o⃜⃝檀Ā;l⃢⃣檂;檄Ā;e⃪⃭쀀⋛︀s;檔r;쀀\uD835\uDD24Ā;gٳ؛mel;愷cy;䑓Ȁ;Eajٚℌℎℐ;檒;檥;檤ȀEaesℛℝ℩ℴ;扩pĀ;p℣ℤ檊rox»ℤĀ;q℮ℯ檈Ā;q℮ℛim;拧pf;쀀\uD835\uDD58Āci⅃ⅆr;愊mƀ;el٫ⅎ⅐;檎;檐茀>;cdlqr׮ⅠⅪⅮⅳⅹĀciⅥⅧ;檧r;橺ot;拗Par;榕uest;橼ʀadelsↄⅪ←ٖ↛ǰ↉\x00↎proø₞r;楸qĀlqؿ↖lesó₈ií٫Āen↣↭rtneqq;쀀≩︀Å↪ԀAabcefkosy⇄⇇⇱⇵⇺∘∝∯≨≽ròΠȀilmr⇐⇔⇗⇛rsðᒄf»․ilôکĀdr⇠⇤cy;䑊ƀ;cwࣴ⇫⇯ir;楈;憭ar;意irc;䄥ƀalr∁∎∓rtsĀ;u∉∊晥it»∊lip;怦con;抹r;쀀\uD835\uDD25sĀew∣∩arow;椥arow;椦ʀamopr∺∾≃≞≣rr;懿tht;戻kĀlr≉≓eftarrow;憩ightarrow;憪f;쀀\uD835\uDD59bar;怕ƀclt≯≴≸r;쀀\uD835\uDCBDasè⇴rok;䄧Ābp⊂⊇ull;恃hen»ᱛૡ⊣\x00⊪\x00⊸⋅⋎\x00⋕⋳\x00\x00⋸⌢⍧⍢⍿\x00⎆⎪⎴cute耻í䃭ƀ;iyݱ⊰⊵rc耻î䃮;䐸Ācx⊼⊿y;䐵cl耻¡䂡ĀfrΟ⋉;쀀\uD835\uDD26rave耻ì䃬Ȁ;inoܾ⋝⋩⋮Āin⋢⋦nt;樌t;戭fin;槜ta;愩lig;䄳ƀaop⋾⌚⌝ƀcgt⌅⌈⌗r;䄫ƀelpܟ⌏⌓inåގarôܠh;䄱f;抷ed;䆵ʀ;cfotӴ⌬⌱⌽⍁are;愅inĀ;t⌸⌹戞ie;槝doô⌙ʀ;celpݗ⍌⍐⍛⍡al;抺Āgr⍕⍙eróᕣã⍍arhk;樗rod;樼Ȁcgpt⍯⍲⍶⍻y;䑑on;䄯f;쀀\uD835\uDD5Aa;䎹uest耻¿䂿Āci⎊⎏r;쀀\uD835\uDCBEnʀ;EdsvӴ⎛⎝⎡ӳ;拹ot;拵Ā;v⎦⎧拴;拳Ā;iݷ⎮lde;䄩ǫ⎸\x00⎼cy;䑖l耻ï䃯̀cfmosu⏌⏗⏜⏡⏧⏵Āiy⏑⏕rc;䄵;䐹r;쀀\uD835\uDD27ath;䈷pf;쀀\uD835\uDD5Bǣ⏬\x00⏱r;쀀\uD835\uDCBFrcy;䑘kcy;䑔Ѐacfghjos␋␖␢␧␭␱␵␻ppaĀ;v␓␔䎺;䏰Āey␛␠dil;䄷;䐺r;쀀\uD835\uDD28reen;䄸cy;䑅cy;䑜pf;쀀\uD835\uDD5Ccr;쀀\uD835\uDCC0஀ABEHabcdefghjlmnoprstuv⑰⒁⒆⒍⒑┎┽╚▀♎♞♥♹♽⚚⚲⛘❝❨➋⟀⠁⠒ƀart⑷⑺⑼rò৆òΕail;椛arr;椎Ā;gঔ⒋;檋ar;楢ॣ⒥\x00⒪\x00⒱\x00\x00\x00\x00\x00⒵Ⓔ\x00ⓆⓈⓍ\x00⓹ute;䄺mptyv;榴raîࡌbda;䎻gƀ;dlࢎⓁⓃ;榑åࢎ;檅uo耻«䂫rЀ;bfhlpst࢙ⓞⓦⓩ⓫⓮⓱⓵Ā;f࢝ⓣs;椟s;椝ë≒p;憫l;椹im;楳l;憢ƀ;ae⓿─┄檫il;椙Ā;s┉┊檭;쀀⪭︀ƀabr┕┙┝rr;椌rk;杲Āak┢┬cĀek┨┪;䁻;䁛Āes┱┳;榋lĀdu┹┻;榏;榍Ȁaeuy╆╋╖╘ron;䄾Ādi═╔il;䄼ìࢰâ┩;䐻Ȁcqrs╣╦╭╽a;椶uoĀ;rนᝆĀdu╲╷har;楧shar;楋h;憲ʀ;fgqs▋▌উ◳◿扤tʀahlrt▘▤▷◂◨rrowĀ;t࢙□aé⓶arpoonĀdu▯▴own»њp»०eftarrows;懇ightƀahs◍◖◞rrowĀ;sࣴࢧarpoonó྘quigarro÷⇰hreetimes;拋ƀ;qs▋ও◺lanôবʀ;cdgsব☊☍☝☨c;檨otĀ;o☔☕橿Ā;r☚☛檁;檃Ā;e☢☥쀀⋚︀s;檓ʀadegs☳☹☽♉♋pproøⓆot;拖qĀgq♃♅ôউgtò⒌ôছiíলƀilr♕࣡♚sht;楼;쀀\uD835\uDD29Ā;Eজ♣;檑š♩♶rĀdu▲♮Ā;l॥♳;楪lk;斄cy;䑙ʀ;achtੈ⚈⚋⚑⚖rò◁orneòᴈard;楫ri;旺Āio⚟⚤dot;䅀ustĀ;a⚬⚭掰che»⚭ȀEaes⚻⚽⛉⛔;扨pĀ;p⛃⛄檉rox»⛄Ā;q⛎⛏檇Ā;q⛎⚻im;拦Ѐabnoptwz⛩⛴⛷✚✯❁❇❐Ānr⛮⛱g;柬r;懽rëࣁgƀlmr⛿✍✔eftĀar০✇ightá৲apsto;柼ightá৽parrowĀlr✥✩efô⓭ight;憬ƀafl✶✹✽r;榅;쀀\uD835\uDD5Dus;樭imes;樴š❋❏st;戗áፎƀ;ef❗❘᠀旊nge»❘arĀ;l❤❥䀨t;榓ʀachmt❳❶❼➅➇ròࢨorneòᶌarĀ;d྘➃;業;怎ri;抿̀achiqt➘➝ੀ➢➮➻quo;怹r;쀀\uD835\uDCC1mƀ;egল➪➬;檍;檏Ābu┪➳oĀ;rฟ➹;怚rok;䅂萀<;cdhilqrࠫ⟒☹⟜⟠⟥⟪⟰Āci⟗⟙;檦r;橹reå◲mes;拉arr;楶uest;橻ĀPi⟵⟹ar;榖ƀ;ef⠀भ᠛旃rĀdu⠇⠍shar;楊har;楦Āen⠗⠡rtneqq;쀀≨︀Å⠞܀Dacdefhilnopsu⡀⡅⢂⢎⢓⢠⢥⢨⣚⣢⣤ઃ⣳⤂Dot;戺Ȁclpr⡎⡒⡣⡽r耻¯䂯Āet⡗⡙;時Ā;e⡞⡟朠se»⡟Ā;sျ⡨toȀ;dluျ⡳⡷⡻owîҌefôएðᏑker;斮Āoy⢇⢌mma;権;䐼ash;怔asuredangle»ᘦr;쀀\uD835\uDD2Ao;愧ƀcdn⢯⢴⣉ro耻µ䂵Ȁ;acdᑤ⢽⣀⣄sôᚧir;櫰ot肻·Ƶusƀ;bd⣒ᤃ⣓戒Ā;uᴼ⣘;横ţ⣞⣡p;櫛ò−ðઁĀdp⣩⣮els;抧f;쀀\uD835\uDD5EĀct⣸⣽r;쀀\uD835\uDCC2pos»ᖝƀ;lm⤉⤊⤍䎼timap;抸ఀGLRVabcdefghijlmoprstuvw⥂⥓⥾⦉⦘⧚⧩⨕⨚⩘⩝⪃⪕⪤⪨⬄⬇⭄⭿⮮ⰴⱧⱼ⳩Āgt⥇⥋;쀀⋙̸Ā;v⥐௏쀀≫⃒ƀelt⥚⥲⥶ftĀar⥡⥧rrow;懍ightarrow;懎;쀀⋘̸Ā;v⥻ే쀀≪⃒ightarrow;懏ĀDd⦎⦓ash;抯ash;抮ʀbcnpt⦣⦧⦬⦱⧌la»˞ute;䅄g;쀀∠⃒ʀ;Eiop඄⦼⧀⧅⧈;쀀⩰̸d;쀀≋̸s;䅉roø඄urĀ;a⧓⧔普lĀ;s⧓ସǳ⧟\x00⧣p肻 ଷmpĀ;e௹ఀʀaeouy⧴⧾⨃⨐⨓ǰ⧹\x00⧻;橃on;䅈dil;䅆ngĀ;dൾ⨊ot;쀀⩭̸p;橂;䐽ash;怓΀;Aadqsxஒ⨩⨭⨻⩁⩅⩐rr;懗rĀhr⨳⨶k;椤Ā;oᏲᏰot;쀀≐̸uiöୣĀei⩊⩎ar;椨í஘istĀ;s஠டr;쀀\uD835\uDD2BȀEest௅⩦⩹⩼ƀ;qs஼⩭௡ƀ;qs஼௅⩴lanô௢ií௪Ā;rஶ⪁»ஷƀAap⪊⪍⪑rò⥱rr;憮ar;櫲ƀ;svྍ⪜ྌĀ;d⪡⪢拼;拺cy;䑚΀AEadest⪷⪺⪾⫂⫅⫶⫹rò⥦;쀀≦̸rr;憚r;急Ȁ;fqs఻⫎⫣⫯tĀar⫔⫙rro÷⫁ightarro÷⪐ƀ;qs఻⪺⫪lanôౕĀ;sౕ⫴»శiíౝĀ;rవ⫾iĀ;eచథiäඐĀpt⬌⬑f;쀀\uD835\uDD5F膀¬;in⬙⬚⬶䂬nȀ;Edvஉ⬤⬨⬮;쀀⋹̸ot;쀀⋵̸ǡஉ⬳⬵;拷;拶iĀ;vಸ⬼ǡಸ⭁⭃;拾;拽ƀaor⭋⭣⭩rȀ;ast୻⭕⭚⭟lleì୻l;쀀⫽⃥;쀀∂̸lint;樔ƀ;ceಒ⭰⭳uåಥĀ;cಘ⭸Ā;eಒ⭽ñಘȀAait⮈⮋⮝⮧rò⦈rrƀ;cw⮔⮕⮙憛;쀀⤳̸;쀀↝̸ghtarrow»⮕riĀ;eೋೖ΀chimpqu⮽⯍⯙⬄୸⯤⯯Ȁ;cerല⯆ഷ⯉uå൅;쀀\uD835\uDCC3ortɭ⬅\x00\x00⯖ará⭖mĀ;e൮⯟Ā;q൴൳suĀbp⯫⯭å೸åഋƀbcp⯶ⰑⰙȀ;Ees⯿ⰀഢⰄ抄;쀀⫅̸etĀ;eഛⰋqĀ;qണⰀcĀ;eലⰗñസȀ;EesⰢⰣൟⰧ抅;쀀⫆̸etĀ;e൘ⰮqĀ;qൠⰣȀgilrⰽⰿⱅⱇìௗlde耻ñ䃱çృiangleĀlrⱒⱜeftĀ;eచⱚñదightĀ;eೋⱥñ೗Ā;mⱬⱭ䎽ƀ;esⱴⱵⱹ䀣ro;愖p;怇ҀDHadgilrsⲏⲔⲙⲞⲣⲰⲶⳓⳣash;抭arr;椄p;쀀≍⃒ash;抬ĀetⲨⲬ;쀀≥⃒;쀀>⃒nfin;槞ƀAetⲽⳁⳅrr;椂;쀀≤⃒Ā;rⳊⳍ쀀<⃒ie;쀀⊴⃒ĀAtⳘⳜrr;椃rie;쀀⊵⃒im;쀀∼⃒ƀAan⳰⳴ⴂrr;懖rĀhr⳺⳽k;椣Ā;oᏧᏥear;椧ቓ᪕\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00ⴭ\x00ⴸⵈⵠⵥ⵲ⶄᬇ\x00\x00ⶍⶫ\x00ⷈⷎ\x00ⷜ⸙⸫⸾⹃Ācsⴱ᪗ute耻ó䃳ĀiyⴼⵅrĀ;c᪞ⵂ耻ô䃴;䐾ʀabios᪠ⵒⵗǈⵚlac;䅑v;樸old;榼lig;䅓Ācr⵩⵭ir;榿;쀀\uD835\uDD2Cͯ⵹\x00\x00⵼\x00ⶂn;䋛ave耻ò䃲;槁Ābmⶈ෴ar;榵Ȁacitⶕ⶘ⶥⶨrò᪀Āir⶝ⶠr;榾oss;榻nå๒;槀ƀaeiⶱⶵⶹcr;䅍ga;䏉ƀcdnⷀⷅǍron;䎿;榶pf;쀀\uD835\uDD60ƀaelⷔ⷗ǒr;榷rp;榹΀;adiosvⷪⷫⷮ⸈⸍⸐⸖戨rò᪆Ȁ;efmⷷⷸ⸂⸅橝rĀ;oⷾⷿ愴f»ⷿ耻ª䂪耻º䂺gof;抶r;橖lope;橗;橛ƀclo⸟⸡⸧ò⸁ash耻ø䃸l;折iŬⸯ⸴de耻õ䃵esĀ;aǛ⸺s;樶ml耻ö䃶bar;挽ૡ⹞\x00⹽\x00⺀⺝\x00⺢⺹\x00\x00⻋ຜ\x00⼓\x00\x00⼫⾼\x00⿈rȀ;astЃ⹧⹲຅脀¶;l⹭⹮䂶leìЃɩ⹸\x00\x00⹻m;櫳;櫽y;䐿rʀcimpt⺋⺏⺓ᡥ⺗nt;䀥od;䀮il;怰enk;怱r;쀀\uD835\uDD2Dƀimo⺨⺰⺴Ā;v⺭⺮䏆;䏕maô੶ne;明ƀ;tv⺿⻀⻈䏀chfork»´;䏖Āau⻏⻟nĀck⻕⻝kĀ;h⇴⻛;愎ö⇴sҀ;abcdemst⻳⻴ᤈ⻹⻽⼄⼆⼊⼎䀫cir;樣ir;樢Āouᵀ⼂;樥;橲n肻±ຝim;樦wo;樧ƀipu⼙⼠⼥ntint;樕f;쀀\uD835\uDD61nd耻£䂣Ԁ;Eaceinosu່⼿⽁⽄⽇⾁⾉⾒⽾⾶;檳p;檷uå໙Ā;c໎⽌̀;acens່⽙⽟⽦⽨⽾pproø⽃urlyeñ໙ñ໎ƀaes⽯⽶⽺pprox;檹qq;檵im;拨iíໟmeĀ;s⾈ຮ怲ƀEas⽸⾐⽺ð⽵ƀdfp໬⾙⾯ƀals⾠⾥⾪lar;挮ine;挒urf;挓Ā;t໻⾴ï໻rel;抰Āci⿀⿅r;쀀\uD835\uDCC5;䏈ncsp;怈̀fiopsu⿚⋢⿟⿥⿫⿱r;쀀\uD835\uDD2Epf;쀀\uD835\uDD62rime;恗cr;쀀\uD835\uDCC6ƀaeo⿸〉〓tĀei⿾々rnionóڰnt;樖stĀ;e【】䀿ñἙô༔઀ABHabcdefhilmnoprstux぀けさすムㄎㄫㅇㅢㅲㆎ㈆㈕㈤㈩㉘㉮㉲㊐㊰㊷ƀartぇおがròႳòϝail;検aròᱥar;楤΀cdenqrtとふへみわゔヌĀeuねぱ;쀀∽̱te;䅕iãᅮmptyv;榳gȀ;del࿑らるろ;榒;榥å࿑uo耻»䂻rր;abcfhlpstw࿜ガクシスゼゾダッデナp;極Ā;f࿠ゴs;椠;椳s;椞ë≝ð✮l;楅im;楴l;憣;憝Āaiパフil;椚oĀ;nホボ戶aló༞ƀabrョリヮrò៥rk;杳ĀakンヽcĀekヹ・;䁽;䁝Āes㄂㄄;榌lĀduㄊㄌ;榎;榐Ȁaeuyㄗㄜㄧㄩron;䅙Ādiㄡㄥil;䅗ì࿲âヺ;䑀Ȁclqsㄴㄷㄽㅄa;椷dhar;楩uoĀ;rȎȍh;憳ƀacgㅎㅟངlȀ;ipsླྀㅘㅛႜnåႻarôྩt;断ƀilrㅩဣㅮsht;楽;쀀\uD835\uDD2FĀaoㅷㆆrĀduㅽㅿ»ѻĀ;l႑ㆄ;楬Ā;vㆋㆌ䏁;䏱ƀgns㆕ㇹㇼht̀ahlrstㆤㆰ㇂㇘㇤㇮rrowĀ;t࿜ㆭaéトarpoonĀduㆻㆿowîㅾp»႒eftĀah㇊㇐rrowó࿪arpoonóՑightarrows;應quigarro÷ニhreetimes;拌g;䋚ingdotseñἲƀahm㈍㈐㈓rò࿪aòՑ;怏oustĀ;a㈞㈟掱che»㈟mid;櫮Ȁabpt㈲㈽㉀㉒Ānr㈷㈺g;柭r;懾rëဃƀafl㉇㉊㉎r;榆;쀀\uD835\uDD63us;樮imes;樵Āap㉝㉧rĀ;g㉣㉤䀩t;榔olint;樒arò㇣Ȁachq㉻㊀Ⴜ㊅quo;怺r;쀀\uD835\uDCC7Ābu・㊊oĀ;rȔȓƀhir㊗㊛㊠reåㇸmes;拊iȀ;efl㊪ၙᠡ㊫方tri;槎luhar;楨;愞ൡ㋕㋛㋟㌬㌸㍱\x00㍺㎤\x00\x00㏬㏰\x00㐨㑈㑚㒭㒱㓊㓱\x00㘖\x00\x00㘳cute;䅛quï➺Ԁ;Eaceinpsyᇭ㋳㋵㋿㌂㌋㌏㌟㌦㌩;檴ǰ㋺\x00㋼;檸on;䅡uåᇾĀ;dᇳ㌇il;䅟rc;䅝ƀEas㌖㌘㌛;檶p;檺im;择olint;樓iíሄ;䑁otƀ;be㌴ᵇ㌵担;橦΀Aacmstx㍆㍊㍗㍛㍞㍣㍭rr;懘rĀhr㍐㍒ë∨Ā;oਸ਼਴t耻§䂧i;䀻war;椩mĀin㍩ðnuóñt;朶rĀ;o㍶⁕쀀\uD835\uDD30Ȁacoy㎂㎆㎑㎠rp;景Āhy㎋㎏cy;䑉;䑈rtɭ㎙\x00\x00㎜iäᑤaraì⹯耻­䂭Āgm㎨㎴maƀ;fv㎱㎲㎲䏃;䏂Ѐ;deglnprካ㏅㏉㏎㏖㏞㏡㏦ot;橪Ā;q኱ኰĀ;E㏓㏔檞;檠Ā;E㏛㏜檝;檟e;扆lus;樤arr;楲aròᄽȀaeit㏸㐈㐏㐗Āls㏽㐄lsetmé㍪hp;樳parsl;槤Ādlᑣ㐔e;挣Ā;e㐜㐝檪Ā;s㐢㐣檬;쀀⪬︀ƀflp㐮㐳㑂tcy;䑌Ā;b㐸㐹䀯Ā;a㐾㐿槄r;挿f;쀀\uD835\uDD64aĀdr㑍ЂesĀ;u㑔㑕晠it»㑕ƀcsu㑠㑹㒟Āau㑥㑯pĀ;sᆈ㑫;쀀⊓︀pĀ;sᆴ㑵;쀀⊔︀uĀbp㑿㒏ƀ;esᆗᆜ㒆etĀ;eᆗ㒍ñᆝƀ;esᆨᆭ㒖etĀ;eᆨ㒝ñᆮƀ;afᅻ㒦ְrť㒫ֱ»ᅼaròᅈȀcemt㒹㒾㓂㓅r;쀀\uD835\uDCC8tmîñiì㐕aræᆾĀar㓎㓕rĀ;f㓔ឿ昆Āan㓚㓭ightĀep㓣㓪psiloîỠhé⺯s»⡒ʀbcmnp㓻㕞ሉ㖋㖎Ҁ;Edemnprs㔎㔏㔑㔕㔞㔣㔬㔱㔶抂;櫅ot;檽Ā;dᇚ㔚ot;櫃ult;櫁ĀEe㔨㔪;櫋;把lus;檿arr;楹ƀeiu㔽㕒㕕tƀ;en㔎㕅㕋qĀ;qᇚ㔏eqĀ;q㔫㔨m;櫇Ābp㕚㕜;櫕;櫓c̀;acensᇭ㕬㕲㕹㕻㌦pproø㋺urlyeñᇾñᇳƀaes㖂㖈㌛pproø㌚qñ㌗g;晪ڀ123;Edehlmnps㖩㖬㖯ሜ㖲㖴㗀㗉㗕㗚㗟㗨㗭耻¹䂹耻²䂲耻³䂳;櫆Āos㖹㖼t;檾ub;櫘Ā;dሢ㗅ot;櫄sĀou㗏㗒l;柉b;櫗arr;楻ult;櫂ĀEe㗤㗦;櫌;抋lus;櫀ƀeiu㗴㘉㘌tƀ;enሜ㗼㘂qĀ;qሢ㖲eqĀ;q㗧㗤m;櫈Ābp㘑㘓;櫔;櫖ƀAan㘜㘠㘭rr;懙rĀhr㘦㘨ë∮Ā;oਫ਩war;椪lig耻ß䃟௡㙑㙝㙠ዎ㙳㙹\x00㙾㛂\x00\x00\x00\x00\x00㛛㜃\x00㜉㝬\x00\x00\x00㞇ɲ㙖\x00\x00㙛get;挖;䏄rë๟ƀaey㙦㙫㙰ron;䅥dil;䅣;䑂lrec;挕r;쀀\uD835\uDD31Ȁeiko㚆㚝㚵㚼ǲ㚋\x00㚑eĀ4fኄኁaƀ;sv㚘㚙㚛䎸ym;䏑Ācn㚢㚲kĀas㚨㚮pproø዁im»ኬsðኞĀas㚺㚮ð዁rn耻þ䃾Ǭ̟㛆⋧es膀×;bd㛏㛐㛘䃗Ā;aᤏ㛕r;樱;樰ƀeps㛡㛣㜀á⩍Ȁ;bcf҆㛬㛰㛴ot;挶ir;櫱Ā;o㛹㛼쀀\uD835\uDD65rk;櫚á㍢rime;怴ƀaip㜏㜒㝤dåቈ΀adempst㜡㝍㝀㝑㝗㝜㝟ngleʀ;dlqr㜰㜱㜶㝀㝂斵own»ᶻeftĀ;e⠀㜾ñम;扜ightĀ;e㊪㝋ñၚot;旬inus;樺lus;樹b;槍ime;樻ezium;揢ƀcht㝲㝽㞁Āry㝷㝻;쀀\uD835\uDCC9;䑆cy;䑛rok;䅧Āio㞋㞎xô᝷headĀlr㞗㞠eftarro÷ࡏightarrow»ཝऀAHabcdfghlmoprstuw㟐㟓㟗㟤㟰㟼㠎㠜㠣㠴㡑㡝㡫㢩㣌㣒㣪㣶ròϭar;楣Ācr㟜㟢ute耻ú䃺òᅐrǣ㟪\x00㟭y;䑞ve;䅭Āiy㟵㟺rc耻û䃻;䑃ƀabh㠃㠆㠋ròᎭlac;䅱aòᏃĀir㠓㠘sht;楾;쀀\uD835\uDD32rave耻ù䃹š㠧㠱rĀlr㠬㠮»ॗ»ႃlk;斀Āct㠹㡍ɯ㠿\x00\x00㡊rnĀ;e㡅㡆挜r»㡆op;挏ri;旸Āal㡖㡚cr;䅫肻¨͉Āgp㡢㡦on;䅳f;쀀\uD835\uDD66̀adhlsuᅋ㡸㡽፲㢑㢠ownáᎳarpoonĀlr㢈㢌efô㠭ighô㠯iƀ;hl㢙㢚㢜䏅»ᏺon»㢚parrows;懈ƀcit㢰㣄㣈ɯ㢶\x00\x00㣁rnĀ;e㢼㢽挝r»㢽op;挎ng;䅯ri;旹cr;쀀\uD835\uDCCAƀdir㣙㣝㣢ot;拰lde;䅩iĀ;f㜰㣨»᠓Āam㣯㣲rò㢨l耻ü䃼angle;榧ހABDacdeflnoprsz㤜㤟㤩㤭㦵㦸㦽㧟㧤㧨㧳㧹㧽㨁㨠ròϷarĀ;v㤦㤧櫨;櫩asèϡĀnr㤲㤷grt;榜΀eknprst㓣㥆㥋㥒㥝㥤㦖appá␕othinçẖƀhir㓫⻈㥙opô⾵Ā;hᎷ㥢ïㆍĀiu㥩㥭gmá㎳Ābp㥲㦄setneqĀ;q㥽㦀쀀⊊︀;쀀⫋︀setneqĀ;q㦏㦒쀀⊋︀;쀀⫌︀Āhr㦛㦟etá㚜iangleĀlr㦪㦯eft»थight»ၑy;䐲ash»ံƀelr㧄㧒㧗ƀ;beⷪ㧋㧏ar;抻q;扚lip;拮Ābt㧜ᑨaòᑩr;쀀\uD835\uDD33tré㦮suĀbp㧯㧱»ജ»൙pf;쀀\uD835\uDD67roð໻tré㦴Ācu㨆㨋r;쀀\uD835\uDCCBĀbp㨐㨘nĀEe㦀㨖»㥾nĀEe㦒㨞»㦐igzag;榚΀cefoprs㨶㨻㩖㩛㩔㩡㩪irc;䅵Ādi㩀㩑Ābg㩅㩉ar;機eĀ;qᗺ㩏;扙erp;愘r;쀀\uD835\uDD34pf;쀀\uD835\uDD68Ā;eᑹ㩦atèᑹcr;쀀\uD835\uDCCCૣណ㪇\x00㪋\x00㪐㪛\x00\x00㪝㪨㪫㪯\x00\x00㫃㫎\x00㫘ៜ៟tré៑r;쀀\uD835\uDD35ĀAa㪔㪗ròσrò৶;䎾ĀAa㪡㪤ròθrò৫að✓is;拻ƀdptឤ㪵㪾Āfl㪺ឩ;쀀\uD835\uDD69imåឲĀAa㫇㫊ròώròਁĀcq㫒ីr;쀀\uD835\uDCCDĀpt៖㫜ré។Ѐacefiosu㫰㫽㬈㬌㬑㬕㬛㬡cĀuy㫶㫻te耻ý䃽;䑏Āiy㬂㬆rc;䅷;䑋n耻¥䂥r;쀀\uD835\uDD36cy;䑗pf;쀀\uD835\uDD6Acr;쀀\uD835\uDCCEĀcm㬦㬩y;䑎l耻ÿ䃿Ԁacdefhiosw㭂㭈㭔㭘㭤㭩㭭㭴㭺㮀cute;䅺Āay㭍㭒ron;䅾;䐷ot;䅼Āet㭝㭡træᕟa;䎶r;쀀\uD835\uDD37cy;䐶grarr;懝pf;쀀\uD835\uDD6Bcr;쀀\uD835\uDCCFĀjn㮅㮇;怍j;怌".split("").map((c) => c.charCodeAt(0)));

  // node_modules/entities/lib/esm/generated/decode-data-xml.js
  var decode_data_xml_default = new Uint16Array("Ȁaglq\t\x15\x18\x1Bɭ\x0F\x00\x00\x12p;䀦os;䀧t;䀾t;䀼uot;䀢".split("").map((c) => c.charCodeAt(0)));

  // node_modules/entities/lib/esm/decode_codepoint.js
  var _a;
  var decodeMap = new Map([
    [0, 65533],
    [128, 8364],
    [130, 8218],
    [131, 402],
    [132, 8222],
    [133, 8230],
    [134, 8224],
    [135, 8225],
    [136, 710],
    [137, 8240],
    [138, 352],
    [139, 8249],
    [140, 338],
    [142, 381],
    [145, 8216],
    [146, 8217],
    [147, 8220],
    [148, 8221],
    [149, 8226],
    [150, 8211],
    [151, 8212],
    [152, 732],
    [153, 8482],
    [154, 353],
    [155, 8250],
    [156, 339],
    [158, 382],
    [159, 376]
  ]);
  var fromCodePoint = (_a = String.fromCodePoint) !== null && _a !== undefined ? _a : function(codePoint) {
    let output = "";
    if (codePoint > 65535) {
      codePoint -= 65536;
      output += String.fromCharCode(codePoint >>> 10 & 1023 | 55296);
      codePoint = 56320 | codePoint & 1023;
    }
    output += String.fromCharCode(codePoint);
    return output;
  };
  function replaceCodePoint(codePoint) {
    var _a2;
    if (codePoint >= 55296 && codePoint <= 57343 || codePoint > 1114111) {
      return 65533;
    }
    return (_a2 = decodeMap.get(codePoint)) !== null && _a2 !== undefined ? _a2 : codePoint;
  }

  // node_modules/entities/lib/esm/decode.js
  var CharCodes;
  (function(CharCodes2) {
    CharCodes2[CharCodes2["NUM"] = 35] = "NUM";
    CharCodes2[CharCodes2["SEMI"] = 59] = "SEMI";
    CharCodes2[CharCodes2["EQUALS"] = 61] = "EQUALS";
    CharCodes2[CharCodes2["ZERO"] = 48] = "ZERO";
    CharCodes2[CharCodes2["NINE"] = 57] = "NINE";
    CharCodes2[CharCodes2["LOWER_A"] = 97] = "LOWER_A";
    CharCodes2[CharCodes2["LOWER_F"] = 102] = "LOWER_F";
    CharCodes2[CharCodes2["LOWER_X"] = 120] = "LOWER_X";
    CharCodes2[CharCodes2["LOWER_Z"] = 122] = "LOWER_Z";
    CharCodes2[CharCodes2["UPPER_A"] = 65] = "UPPER_A";
    CharCodes2[CharCodes2["UPPER_F"] = 70] = "UPPER_F";
    CharCodes2[CharCodes2["UPPER_Z"] = 90] = "UPPER_Z";
  })(CharCodes || (CharCodes = {}));
  var TO_LOWER_BIT = 32;
  var BinTrieFlags;
  (function(BinTrieFlags2) {
    BinTrieFlags2[BinTrieFlags2["VALUE_LENGTH"] = 49152] = "VALUE_LENGTH";
    BinTrieFlags2[BinTrieFlags2["BRANCH_LENGTH"] = 16256] = "BRANCH_LENGTH";
    BinTrieFlags2[BinTrieFlags2["JUMP_TABLE"] = 127] = "JUMP_TABLE";
  })(BinTrieFlags || (BinTrieFlags = {}));
  function isNumber(code) {
    return code >= CharCodes.ZERO && code <= CharCodes.NINE;
  }
  function isHexadecimalCharacter(code) {
    return code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_F || code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_F;
  }
  function isAsciiAlphaNumeric(code) {
    return code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_Z || code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_Z || isNumber(code);
  }
  function isEntityInAttributeInvalidEnd(code) {
    return code === CharCodes.EQUALS || isAsciiAlphaNumeric(code);
  }
  var EntityDecoderState;
  (function(EntityDecoderState2) {
    EntityDecoderState2[EntityDecoderState2["EntityStart"] = 0] = "EntityStart";
    EntityDecoderState2[EntityDecoderState2["NumericStart"] = 1] = "NumericStart";
    EntityDecoderState2[EntityDecoderState2["NumericDecimal"] = 2] = "NumericDecimal";
    EntityDecoderState2[EntityDecoderState2["NumericHex"] = 3] = "NumericHex";
    EntityDecoderState2[EntityDecoderState2["NamedEntity"] = 4] = "NamedEntity";
  })(EntityDecoderState || (EntityDecoderState = {}));
  var DecodingMode;
  (function(DecodingMode2) {
    DecodingMode2[DecodingMode2["Legacy"] = 0] = "Legacy";
    DecodingMode2[DecodingMode2["Strict"] = 1] = "Strict";
    DecodingMode2[DecodingMode2["Attribute"] = 2] = "Attribute";
  })(DecodingMode || (DecodingMode = {}));

  class EntityDecoder {
    constructor(decodeTree, emitCodePoint, errors) {
      this.decodeTree = decodeTree;
      this.emitCodePoint = emitCodePoint;
      this.errors = errors;
      this.state = EntityDecoderState.EntityStart;
      this.consumed = 1;
      this.result = 0;
      this.treeIndex = 0;
      this.excess = 1;
      this.decodeMode = DecodingMode.Strict;
    }
    startEntity(decodeMode) {
      this.decodeMode = decodeMode;
      this.state = EntityDecoderState.EntityStart;
      this.result = 0;
      this.treeIndex = 0;
      this.excess = 1;
      this.consumed = 1;
    }
    write(str, offset) {
      switch (this.state) {
        case EntityDecoderState.EntityStart: {
          if (str.charCodeAt(offset) === CharCodes.NUM) {
            this.state = EntityDecoderState.NumericStart;
            this.consumed += 1;
            return this.stateNumericStart(str, offset + 1);
          }
          this.state = EntityDecoderState.NamedEntity;
          return this.stateNamedEntity(str, offset);
        }
        case EntityDecoderState.NumericStart: {
          return this.stateNumericStart(str, offset);
        }
        case EntityDecoderState.NumericDecimal: {
          return this.stateNumericDecimal(str, offset);
        }
        case EntityDecoderState.NumericHex: {
          return this.stateNumericHex(str, offset);
        }
        case EntityDecoderState.NamedEntity: {
          return this.stateNamedEntity(str, offset);
        }
      }
    }
    stateNumericStart(str, offset) {
      if (offset >= str.length) {
        return -1;
      }
      if ((str.charCodeAt(offset) | TO_LOWER_BIT) === CharCodes.LOWER_X) {
        this.state = EntityDecoderState.NumericHex;
        this.consumed += 1;
        return this.stateNumericHex(str, offset + 1);
      }
      this.state = EntityDecoderState.NumericDecimal;
      return this.stateNumericDecimal(str, offset);
    }
    addToNumericResult(str, start, end, base) {
      if (start !== end) {
        const digitCount = end - start;
        this.result = this.result * Math.pow(base, digitCount) + parseInt(str.substr(start, digitCount), base);
        this.consumed += digitCount;
      }
    }
    stateNumericHex(str, offset) {
      const startIdx = offset;
      while (offset < str.length) {
        const char = str.charCodeAt(offset);
        if (isNumber(char) || isHexadecimalCharacter(char)) {
          offset += 1;
        } else {
          this.addToNumericResult(str, startIdx, offset, 16);
          return this.emitNumericEntity(char, 3);
        }
      }
      this.addToNumericResult(str, startIdx, offset, 16);
      return -1;
    }
    stateNumericDecimal(str, offset) {
      const startIdx = offset;
      while (offset < str.length) {
        const char = str.charCodeAt(offset);
        if (isNumber(char)) {
          offset += 1;
        } else {
          this.addToNumericResult(str, startIdx, offset, 10);
          return this.emitNumericEntity(char, 2);
        }
      }
      this.addToNumericResult(str, startIdx, offset, 10);
      return -1;
    }
    emitNumericEntity(lastCp, expectedLength) {
      var _a2;
      if (this.consumed <= expectedLength) {
        (_a2 = this.errors) === null || _a2 === undefined || _a2.absenceOfDigitsInNumericCharacterReference(this.consumed);
        return 0;
      }
      if (lastCp === CharCodes.SEMI) {
        this.consumed += 1;
      } else if (this.decodeMode === DecodingMode.Strict) {
        return 0;
      }
      this.emitCodePoint(replaceCodePoint(this.result), this.consumed);
      if (this.errors) {
        if (lastCp !== CharCodes.SEMI) {
          this.errors.missingSemicolonAfterCharacterReference();
        }
        this.errors.validateNumericCharacterReference(this.result);
      }
      return this.consumed;
    }
    stateNamedEntity(str, offset) {
      const { decodeTree } = this;
      let current = decodeTree[this.treeIndex];
      let valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
      for (;offset < str.length; offset++, this.excess++) {
        const char = str.charCodeAt(offset);
        this.treeIndex = determineBranch(decodeTree, current, this.treeIndex + Math.max(1, valueLength), char);
        if (this.treeIndex < 0) {
          return this.result === 0 || this.decodeMode === DecodingMode.Attribute && (valueLength === 0 || isEntityInAttributeInvalidEnd(char)) ? 0 : this.emitNotTerminatedNamedEntity();
        }
        current = decodeTree[this.treeIndex];
        valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
        if (valueLength !== 0) {
          if (char === CharCodes.SEMI) {
            return this.emitNamedEntityData(this.treeIndex, valueLength, this.consumed + this.excess);
          }
          if (this.decodeMode !== DecodingMode.Strict) {
            this.result = this.treeIndex;
            this.consumed += this.excess;
            this.excess = 0;
          }
        }
      }
      return -1;
    }
    emitNotTerminatedNamedEntity() {
      var _a2;
      const { result, decodeTree } = this;
      const valueLength = (decodeTree[result] & BinTrieFlags.VALUE_LENGTH) >> 14;
      this.emitNamedEntityData(result, valueLength, this.consumed);
      (_a2 = this.errors) === null || _a2 === undefined || _a2.missingSemicolonAfterCharacterReference();
      return this.consumed;
    }
    emitNamedEntityData(result, valueLength, consumed) {
      const { decodeTree } = this;
      this.emitCodePoint(valueLength === 1 ? decodeTree[result] & ~BinTrieFlags.VALUE_LENGTH : decodeTree[result + 1], consumed);
      if (valueLength === 3) {
        this.emitCodePoint(decodeTree[result + 2], consumed);
      }
      return consumed;
    }
    end() {
      var _a2;
      switch (this.state) {
        case EntityDecoderState.NamedEntity: {
          return this.result !== 0 && (this.decodeMode !== DecodingMode.Attribute || this.result === this.treeIndex) ? this.emitNotTerminatedNamedEntity() : 0;
        }
        case EntityDecoderState.NumericDecimal: {
          return this.emitNumericEntity(0, 2);
        }
        case EntityDecoderState.NumericHex: {
          return this.emitNumericEntity(0, 3);
        }
        case EntityDecoderState.NumericStart: {
          (_a2 = this.errors) === null || _a2 === undefined || _a2.absenceOfDigitsInNumericCharacterReference(this.consumed);
          return 0;
        }
        case EntityDecoderState.EntityStart: {
          return 0;
        }
      }
    }
  }
  function getDecoder(decodeTree) {
    let ret = "";
    const decoder = new EntityDecoder(decodeTree, (str) => ret += fromCodePoint(str));
    return function decodeWithTrie(str, decodeMode) {
      let lastIndex = 0;
      let offset = 0;
      while ((offset = str.indexOf("&", offset)) >= 0) {
        ret += str.slice(lastIndex, offset);
        decoder.startEntity(decodeMode);
        const len = decoder.write(str, offset + 1);
        if (len < 0) {
          lastIndex = offset + decoder.end();
          break;
        }
        lastIndex = offset + len;
        offset = len === 0 ? lastIndex + 1 : lastIndex;
      }
      const result = ret + str.slice(lastIndex);
      ret = "";
      return result;
    };
  }
  function determineBranch(decodeTree, current, nodeIdx, char) {
    const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
    const jumpOffset = current & BinTrieFlags.JUMP_TABLE;
    if (branchCount === 0) {
      return jumpOffset !== 0 && char === jumpOffset ? nodeIdx : -1;
    }
    if (jumpOffset) {
      const value = char - jumpOffset;
      return value < 0 || value >= branchCount ? -1 : decodeTree[nodeIdx + value] - 1;
    }
    let lo = nodeIdx;
    let hi = lo + branchCount - 1;
    while (lo <= hi) {
      const mid = lo + hi >>> 1;
      const midVal = decodeTree[mid];
      if (midVal < char) {
        lo = mid + 1;
      } else if (midVal > char) {
        hi = mid - 1;
      } else {
        return decodeTree[mid + branchCount];
      }
    }
    return -1;
  }
  var htmlDecoder = getDecoder(decode_data_html_default);
  var xmlDecoder = getDecoder(decode_data_xml_default);
  function decodeHTML(str, mode = DecodingMode.Legacy) {
    return htmlDecoder(str, mode);
  }

  // node_modules/entities/lib/esm/index.js
  var EntityLevel;
  (function(EntityLevel2) {
    EntityLevel2[EntityLevel2["XML"] = 0] = "XML";
    EntityLevel2[EntityLevel2["HTML"] = 1] = "HTML";
  })(EntityLevel || (EntityLevel = {}));
  var EncodingMode;
  (function(EncodingMode2) {
    EncodingMode2[EncodingMode2["UTF8"] = 0] = "UTF8";
    EncodingMode2[EncodingMode2["ASCII"] = 1] = "ASCII";
    EncodingMode2[EncodingMode2["Extensive"] = 2] = "Extensive";
    EncodingMode2[EncodingMode2["Attribute"] = 3] = "Attribute";
    EncodingMode2[EncodingMode2["Text"] = 4] = "Text";
  })(EncodingMode || (EncodingMode = {}));

  // node_modules/markdown-it/lib/common/utils.mjs
  function _class(obj) {
    return Object.prototype.toString.call(obj);
  }
  function isString(obj) {
    return _class(obj) === "[object String]";
  }
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  function has(object, key) {
    return _hasOwnProperty.call(object, key);
  }
  function assign(obj) {
    const sources = Array.prototype.slice.call(arguments, 1);
    sources.forEach(function(source) {
      if (!source) {
        return;
      }
      if (typeof source !== "object") {
        throw new TypeError(source + "must be object");
      }
      Object.keys(source).forEach(function(key) {
        obj[key] = source[key];
      });
    });
    return obj;
  }
  function arrayReplaceAt(src, pos, newElements) {
    return [].concat(src.slice(0, pos), newElements, src.slice(pos + 1));
  }
  function isValidEntityCode(c) {
    if (c >= 55296 && c <= 57343) {
      return false;
    }
    if (c >= 64976 && c <= 65007) {
      return false;
    }
    if ((c & 65535) === 65535 || (c & 65535) === 65534) {
      return false;
    }
    if (c >= 0 && c <= 8) {
      return false;
    }
    if (c === 11) {
      return false;
    }
    if (c >= 14 && c <= 31) {
      return false;
    }
    if (c >= 127 && c <= 159) {
      return false;
    }
    if (c > 1114111) {
      return false;
    }
    return true;
  }
  function fromCodePoint2(c) {
    if (c > 65535) {
      c -= 65536;
      const surrogate1 = 55296 + (c >> 10);
      const surrogate2 = 56320 + (c & 1023);
      return String.fromCharCode(surrogate1, surrogate2);
    }
    return String.fromCharCode(c);
  }
  var UNESCAPE_MD_RE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
  var ENTITY_RE = /&([a-z#][a-z0-9]{1,31});/gi;
  var UNESCAPE_ALL_RE = new RegExp(UNESCAPE_MD_RE.source + "|" + ENTITY_RE.source, "gi");
  var DIGITAL_ENTITY_TEST_RE = /^#((?:x[a-f0-9]{1,8}|[0-9]{1,8}))$/i;
  function replaceEntityPattern(match, name) {
    if (name.charCodeAt(0) === 35 && DIGITAL_ENTITY_TEST_RE.test(name)) {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (isValidEntityCode(code)) {
        return fromCodePoint2(code);
      }
      return match;
    }
    const decoded = decodeHTML(match);
    if (decoded !== match) {
      return decoded;
    }
    return match;
  }
  function unescapeMd(str) {
    if (str.indexOf("\\") < 0) {
      return str;
    }
    return str.replace(UNESCAPE_MD_RE, "$1");
  }
  function unescapeAll(str) {
    if (str.indexOf("\\") < 0 && str.indexOf("&") < 0) {
      return str;
    }
    return str.replace(UNESCAPE_ALL_RE, function(match, escaped, entity) {
      if (escaped) {
        return escaped;
      }
      return replaceEntityPattern(match, entity);
    });
  }
  var HTML_ESCAPE_TEST_RE = /[&<>"]/;
  var HTML_ESCAPE_REPLACE_RE = /[&<>"]/g;
  var HTML_REPLACEMENTS = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  };
  function replaceUnsafeChar(ch) {
    return HTML_REPLACEMENTS[ch];
  }
  function escapeHtml(str) {
    if (HTML_ESCAPE_TEST_RE.test(str)) {
      return str.replace(HTML_ESCAPE_REPLACE_RE, replaceUnsafeChar);
    }
    return str;
  }
  var REGEXP_ESCAPE_RE = /[.?*+^$[\]\\(){}|-]/g;
  function escapeRE(str) {
    return str.replace(REGEXP_ESCAPE_RE, "\\$&");
  }
  function isSpace(code) {
    switch (code) {
      case 9:
      case 32:
        return true;
    }
    return false;
  }
  function isWhiteSpace(code) {
    if (code >= 8192 && code <= 8202) {
      return true;
    }
    switch (code) {
      case 9:
      case 10:
      case 11:
      case 12:
      case 13:
      case 32:
      case 160:
      case 5760:
      case 8239:
      case 8287:
      case 12288:
        return true;
    }
    return false;
  }
  function isPunctChar(ch) {
    return regex_default4.test(ch) || regex_default5.test(ch);
  }
  function isMdAsciiPunct(ch) {
    switch (ch) {
      case 33:
      case 34:
      case 35:
      case 36:
      case 37:
      case 38:
      case 39:
      case 40:
      case 41:
      case 42:
      case 43:
      case 44:
      case 45:
      case 46:
      case 47:
      case 58:
      case 59:
      case 60:
      case 61:
      case 62:
      case 63:
      case 64:
      case 91:
      case 92:
      case 93:
      case 94:
      case 95:
      case 96:
      case 123:
      case 124:
      case 125:
      case 126:
        return true;
      default:
        return false;
    }
  }
  function normalizeReference(str) {
    str = str.trim().replace(/\s+/g, " ");
    if ("ẞ".toLowerCase() === "Ṿ") {
      str = str.replace(/ẞ/g, "ß");
    }
    return str.toLowerCase().toUpperCase();
  }
  var lib = { mdurl: exports_mdurl, ucmicro: exports_uc };

  // node_modules/markdown-it/lib/helpers/index.mjs
  var exports_helpers = {};
  __export(exports_helpers, {
    parseLinkTitle: () => parseLinkTitle,
    parseLinkLabel: () => parseLinkLabel,
    parseLinkDestination: () => parseLinkDestination
  });

  // node_modules/markdown-it/lib/helpers/parse_link_label.mjs
  function parseLinkLabel(state, start, disableNested) {
    let level, found, marker, prevPos;
    const max = state.posMax;
    const oldPos = state.pos;
    state.pos = start + 1;
    level = 1;
    while (state.pos < max) {
      marker = state.src.charCodeAt(state.pos);
      if (marker === 93) {
        level--;
        if (level === 0) {
          found = true;
          break;
        }
      }
      prevPos = state.pos;
      state.md.inline.skipToken(state);
      if (marker === 91) {
        if (prevPos === state.pos - 1) {
          level++;
        } else if (disableNested) {
          state.pos = oldPos;
          return -1;
        }
      }
    }
    let labelEnd = -1;
    if (found) {
      labelEnd = state.pos;
    }
    state.pos = oldPos;
    return labelEnd;
  }

  // node_modules/markdown-it/lib/helpers/parse_link_destination.mjs
  function parseLinkDestination(str, start, max) {
    let code;
    let pos = start;
    const result = {
      ok: false,
      pos: 0,
      str: ""
    };
    if (str.charCodeAt(pos) === 60) {
      pos++;
      while (pos < max) {
        code = str.charCodeAt(pos);
        if (code === 10) {
          return result;
        }
        if (code === 60) {
          return result;
        }
        if (code === 62) {
          result.pos = pos + 1;
          result.str = unescapeAll(str.slice(start + 1, pos));
          result.ok = true;
          return result;
        }
        if (code === 92 && pos + 1 < max) {
          pos += 2;
          continue;
        }
        pos++;
      }
      return result;
    }
    let level = 0;
    while (pos < max) {
      code = str.charCodeAt(pos);
      if (code === 32) {
        break;
      }
      if (code < 32 || code === 127) {
        break;
      }
      if (code === 92 && pos + 1 < max) {
        if (str.charCodeAt(pos + 1) === 32) {
          break;
        }
        pos += 2;
        continue;
      }
      if (code === 40) {
        level++;
        if (level > 32) {
          return result;
        }
      }
      if (code === 41) {
        if (level === 0) {
          break;
        }
        level--;
      }
      pos++;
    }
    if (start === pos) {
      return result;
    }
    if (level !== 0) {
      return result;
    }
    result.str = unescapeAll(str.slice(start, pos));
    result.pos = pos;
    result.ok = true;
    return result;
  }

  // node_modules/markdown-it/lib/helpers/parse_link_title.mjs
  function parseLinkTitle(str, start, max, prev_state) {
    let code;
    let pos = start;
    const state = {
      ok: false,
      can_continue: false,
      pos: 0,
      str: "",
      marker: 0
    };
    if (prev_state) {
      state.str = prev_state.str;
      state.marker = prev_state.marker;
    } else {
      if (pos >= max) {
        return state;
      }
      let marker = str.charCodeAt(pos);
      if (marker !== 34 && marker !== 39 && marker !== 40) {
        return state;
      }
      start++;
      pos++;
      if (marker === 40) {
        marker = 41;
      }
      state.marker = marker;
    }
    while (pos < max) {
      code = str.charCodeAt(pos);
      if (code === state.marker) {
        state.pos = pos + 1;
        state.str += unescapeAll(str.slice(start, pos));
        state.ok = true;
        return state;
      } else if (code === 40 && state.marker === 41) {
        return state;
      } else if (code === 92 && pos + 1 < max) {
        pos++;
      }
      pos++;
    }
    state.can_continue = true;
    state.str += unescapeAll(str.slice(start, pos));
    return state;
  }

  // node_modules/markdown-it/lib/renderer.mjs
  var default_rules = {};
  default_rules.code_inline = function(tokens, idx, options, env, slf) {
    const token = tokens[idx];
    return "<code" + slf.renderAttrs(token) + ">" + escapeHtml(token.content) + "</code>";
  };
  default_rules.code_block = function(tokens, idx, options, env, slf) {
    const token = tokens[idx];
    return "<pre" + slf.renderAttrs(token) + "><code>" + escapeHtml(tokens[idx].content) + `</code></pre>
`;
  };
  default_rules.fence = function(tokens, idx, options, env, slf) {
    const token = tokens[idx];
    const info = token.info ? unescapeAll(token.info).trim() : "";
    let langName = "";
    let langAttrs = "";
    if (info) {
      const arr = info.split(/(\s+)/g);
      langName = arr[0];
      langAttrs = arr.slice(2).join("");
    }
    let highlighted;
    if (options.highlight) {
      highlighted = options.highlight(token.content, langName, langAttrs) || escapeHtml(token.content);
    } else {
      highlighted = escapeHtml(token.content);
    }
    if (highlighted.indexOf("<pre") === 0) {
      return highlighted + `
`;
    }
    if (info) {
      const i = token.attrIndex("class");
      const tmpAttrs = token.attrs ? token.attrs.slice() : [];
      if (i < 0) {
        tmpAttrs.push(["class", options.langPrefix + langName]);
      } else {
        tmpAttrs[i] = tmpAttrs[i].slice();
        tmpAttrs[i][1] += " " + options.langPrefix + langName;
      }
      const tmpToken = {
        attrs: tmpAttrs
      };
      return `<pre><code${slf.renderAttrs(tmpToken)}>${highlighted}</code></pre>
`;
    }
    return `<pre><code${slf.renderAttrs(token)}>${highlighted}</code></pre>
`;
  };
  default_rules.image = function(tokens, idx, options, env, slf) {
    const token = tokens[idx];
    token.attrs[token.attrIndex("alt")][1] = slf.renderInlineAsText(token.children, options, env);
    return slf.renderToken(tokens, idx, options);
  };
  default_rules.hardbreak = function(tokens, idx, options) {
    return options.xhtmlOut ? `<br />
` : `<br>
`;
  };
  default_rules.softbreak = function(tokens, idx, options) {
    return options.breaks ? options.xhtmlOut ? `<br />
` : `<br>
` : `
`;
  };
  default_rules.text = function(tokens, idx) {
    return escapeHtml(tokens[idx].content);
  };
  default_rules.html_block = function(tokens, idx) {
    return tokens[idx].content;
  };
  default_rules.html_inline = function(tokens, idx) {
    return tokens[idx].content;
  };
  function Renderer() {
    this.rules = assign({}, default_rules);
  }
  Renderer.prototype.renderAttrs = function renderAttrs(token) {
    let i, l, result;
    if (!token.attrs) {
      return "";
    }
    result = "";
    for (i = 0, l = token.attrs.length;i < l; i++) {
      result += " " + escapeHtml(token.attrs[i][0]) + '="' + escapeHtml(token.attrs[i][1]) + '"';
    }
    return result;
  };
  Renderer.prototype.renderToken = function renderToken(tokens, idx, options) {
    const token = tokens[idx];
    let result = "";
    if (token.hidden) {
      return "";
    }
    if (token.block && token.nesting !== -1 && idx && tokens[idx - 1].hidden) {
      result += `
`;
    }
    result += (token.nesting === -1 ? "</" : "<") + token.tag;
    result += this.renderAttrs(token);
    if (token.nesting === 0 && options.xhtmlOut) {
      result += " /";
    }
    let needLf = false;
    if (token.block) {
      needLf = true;
      if (token.nesting === 1) {
        if (idx + 1 < tokens.length) {
          const nextToken = tokens[idx + 1];
          if (nextToken.type === "inline" || nextToken.hidden) {
            needLf = false;
          } else if (nextToken.nesting === -1 && nextToken.tag === token.tag) {
            needLf = false;
          }
        }
      }
    }
    result += needLf ? `>
` : ">";
    return result;
  };
  Renderer.prototype.renderInline = function(tokens, options, env) {
    let result = "";
    const rules = this.rules;
    for (let i = 0, len = tokens.length;i < len; i++) {
      const type = tokens[i].type;
      if (typeof rules[type] !== "undefined") {
        result += rules[type](tokens, i, options, env, this);
      } else {
        result += this.renderToken(tokens, i, options);
      }
    }
    return result;
  };
  Renderer.prototype.renderInlineAsText = function(tokens, options, env) {
    let result = "";
    for (let i = 0, len = tokens.length;i < len; i++) {
      switch (tokens[i].type) {
        case "text":
          result += tokens[i].content;
          break;
        case "image":
          result += this.renderInlineAsText(tokens[i].children, options, env);
          break;
        case "html_inline":
        case "html_block":
          result += tokens[i].content;
          break;
        case "softbreak":
        case "hardbreak":
          result += `
`;
          break;
        default:
      }
    }
    return result;
  };
  Renderer.prototype.render = function(tokens, options, env) {
    let result = "";
    const rules = this.rules;
    for (let i = 0, len = tokens.length;i < len; i++) {
      const type = tokens[i].type;
      if (type === "inline") {
        result += this.renderInline(tokens[i].children, options, env);
      } else if (typeof rules[type] !== "undefined") {
        result += rules[type](tokens, i, options, env, this);
      } else {
        result += this.renderToken(tokens, i, options, env);
      }
    }
    return result;
  };
  var renderer_default = Renderer;

  // node_modules/markdown-it/lib/ruler.mjs
  function Ruler() {
    this.__rules__ = [];
    this.__cache__ = null;
  }
  Ruler.prototype.__find__ = function(name) {
    for (let i = 0;i < this.__rules__.length; i++) {
      if (this.__rules__[i].name === name) {
        return i;
      }
    }
    return -1;
  };
  Ruler.prototype.__compile__ = function() {
    const self = this;
    const chains = [""];
    self.__rules__.forEach(function(rule) {
      if (!rule.enabled) {
        return;
      }
      rule.alt.forEach(function(altName) {
        if (chains.indexOf(altName) < 0) {
          chains.push(altName);
        }
      });
    });
    self.__cache__ = {};
    chains.forEach(function(chain) {
      self.__cache__[chain] = [];
      self.__rules__.forEach(function(rule) {
        if (!rule.enabled) {
          return;
        }
        if (chain && rule.alt.indexOf(chain) < 0) {
          return;
        }
        self.__cache__[chain].push(rule.fn);
      });
    });
  };
  Ruler.prototype.at = function(name, fn, options) {
    const index = this.__find__(name);
    const opt = options || {};
    if (index === -1) {
      throw new Error("Parser rule not found: " + name);
    }
    this.__rules__[index].fn = fn;
    this.__rules__[index].alt = opt.alt || [];
    this.__cache__ = null;
  };
  Ruler.prototype.before = function(beforeName, ruleName, fn, options) {
    const index = this.__find__(beforeName);
    const opt = options || {};
    if (index === -1) {
      throw new Error("Parser rule not found: " + beforeName);
    }
    this.__rules__.splice(index, 0, {
      name: ruleName,
      enabled: true,
      fn,
      alt: opt.alt || []
    });
    this.__cache__ = null;
  };
  Ruler.prototype.after = function(afterName, ruleName, fn, options) {
    const index = this.__find__(afterName);
    const opt = options || {};
    if (index === -1) {
      throw new Error("Parser rule not found: " + afterName);
    }
    this.__rules__.splice(index + 1, 0, {
      name: ruleName,
      enabled: true,
      fn,
      alt: opt.alt || []
    });
    this.__cache__ = null;
  };
  Ruler.prototype.push = function(ruleName, fn, options) {
    const opt = options || {};
    this.__rules__.push({
      name: ruleName,
      enabled: true,
      fn,
      alt: opt.alt || []
    });
    this.__cache__ = null;
  };
  Ruler.prototype.enable = function(list, ignoreInvalid) {
    if (!Array.isArray(list)) {
      list = [list];
    }
    const result = [];
    list.forEach(function(name) {
      const idx = this.__find__(name);
      if (idx < 0) {
        if (ignoreInvalid) {
          return;
        }
        throw new Error("Rules manager: invalid rule name " + name);
      }
      this.__rules__[idx].enabled = true;
      result.push(name);
    }, this);
    this.__cache__ = null;
    return result;
  };
  Ruler.prototype.enableOnly = function(list, ignoreInvalid) {
    if (!Array.isArray(list)) {
      list = [list];
    }
    this.__rules__.forEach(function(rule) {
      rule.enabled = false;
    });
    this.enable(list, ignoreInvalid);
  };
  Ruler.prototype.disable = function(list, ignoreInvalid) {
    if (!Array.isArray(list)) {
      list = [list];
    }
    const result = [];
    list.forEach(function(name) {
      const idx = this.__find__(name);
      if (idx < 0) {
        if (ignoreInvalid) {
          return;
        }
        throw new Error("Rules manager: invalid rule name " + name);
      }
      this.__rules__[idx].enabled = false;
      result.push(name);
    }, this);
    this.__cache__ = null;
    return result;
  };
  Ruler.prototype.getRules = function(chainName) {
    if (this.__cache__ === null) {
      this.__compile__();
    }
    return this.__cache__[chainName] || [];
  };
  var ruler_default = Ruler;

  // node_modules/markdown-it/lib/token.mjs
  function Token(type, tag, nesting) {
    this.type = type;
    this.tag = tag;
    this.attrs = null;
    this.map = null;
    this.nesting = nesting;
    this.level = 0;
    this.children = null;
    this.content = "";
    this.markup = "";
    this.info = "";
    this.meta = null;
    this.block = false;
    this.hidden = false;
  }
  Token.prototype.attrIndex = function attrIndex(name) {
    if (!this.attrs) {
      return -1;
    }
    const attrs = this.attrs;
    for (let i = 0, len = attrs.length;i < len; i++) {
      if (attrs[i][0] === name) {
        return i;
      }
    }
    return -1;
  };
  Token.prototype.attrPush = function attrPush(attrData) {
    if (this.attrs) {
      this.attrs.push(attrData);
    } else {
      this.attrs = [attrData];
    }
  };
  Token.prototype.attrSet = function attrSet(name, value) {
    const idx = this.attrIndex(name);
    const attrData = [name, value];
    if (idx < 0) {
      this.attrPush(attrData);
    } else {
      this.attrs[idx] = attrData;
    }
  };
  Token.prototype.attrGet = function attrGet(name) {
    const idx = this.attrIndex(name);
    let value = null;
    if (idx >= 0) {
      value = this.attrs[idx][1];
    }
    return value;
  };
  Token.prototype.attrJoin = function attrJoin(name, value) {
    const idx = this.attrIndex(name);
    if (idx < 0) {
      this.attrPush([name, value]);
    } else {
      this.attrs[idx][1] = this.attrs[idx][1] + " " + value;
    }
  };
  var token_default = Token;

  // node_modules/markdown-it/lib/rules_core/state_core.mjs
  function StateCore(src, md, env) {
    this.src = src;
    this.env = env;
    this.tokens = [];
    this.inlineMode = false;
    this.md = md;
  }
  StateCore.prototype.Token = token_default;
  var state_core_default = StateCore;

  // node_modules/markdown-it/lib/rules_core/normalize.mjs
  var NEWLINES_RE = /\r\n?|\n/g;
  var NULL_RE = /\0/g;
  function normalize(state) {
    let str;
    str = state.src.replace(NEWLINES_RE, `
`);
    str = str.replace(NULL_RE, "�");
    state.src = str;
  }

  // node_modules/markdown-it/lib/rules_core/block.mjs
  function block(state) {
    let token;
    if (state.inlineMode) {
      token = new state.Token("inline", "", 0);
      token.content = state.src;
      token.map = [0, 1];
      token.children = [];
      state.tokens.push(token);
    } else {
      state.md.block.parse(state.src, state.md, state.env, state.tokens);
    }
  }

  // node_modules/markdown-it/lib/rules_core/inline.mjs
  function inline(state) {
    const tokens = state.tokens;
    for (let i = 0, l = tokens.length;i < l; i++) {
      const tok = tokens[i];
      if (tok.type === "inline") {
        state.md.inline.parse(tok.content, state.md, state.env, tok.children);
      }
    }
  }

  // node_modules/markdown-it/lib/rules_core/linkify.mjs
  function isLinkOpen(str) {
    return /^<a[>\s]/i.test(str);
  }
  function isLinkClose(str) {
    return /^<\/a\s*>/i.test(str);
  }
  function linkify(state) {
    const blockTokens = state.tokens;
    if (!state.md.options.linkify) {
      return;
    }
    for (let j = 0, l = blockTokens.length;j < l; j++) {
      if (blockTokens[j].type !== "inline" || !state.md.linkify.pretest(blockTokens[j].content)) {
        continue;
      }
      let tokens = blockTokens[j].children;
      let htmlLinkLevel = 0;
      for (let i = tokens.length - 1;i >= 0; i--) {
        const currentToken = tokens[i];
        if (currentToken.type === "link_close") {
          i--;
          while (tokens[i].level !== currentToken.level && tokens[i].type !== "link_open") {
            i--;
          }
          continue;
        }
        if (currentToken.type === "html_inline") {
          if (isLinkOpen(currentToken.content) && htmlLinkLevel > 0) {
            htmlLinkLevel--;
          }
          if (isLinkClose(currentToken.content)) {
            htmlLinkLevel++;
          }
        }
        if (htmlLinkLevel > 0) {
          continue;
        }
        if (currentToken.type === "text" && state.md.linkify.test(currentToken.content)) {
          const text = currentToken.content;
          let links = state.md.linkify.match(text);
          const nodes = [];
          let level = currentToken.level;
          let lastPos = 0;
          if (links.length > 0 && links[0].index === 0 && i > 0 && tokens[i - 1].type === "text_special") {
            links = links.slice(1);
          }
          for (let ln = 0;ln < links.length; ln++) {
            const url = links[ln].url;
            const fullUrl = state.md.normalizeLink(url);
            if (!state.md.validateLink(fullUrl)) {
              continue;
            }
            let urlText = links[ln].text;
            if (!links[ln].schema) {
              urlText = state.md.normalizeLinkText("http://" + urlText).replace(/^http:\/\//, "");
            } else if (links[ln].schema === "mailto:" && !/^mailto:/i.test(urlText)) {
              urlText = state.md.normalizeLinkText("mailto:" + urlText).replace(/^mailto:/, "");
            } else {
              urlText = state.md.normalizeLinkText(urlText);
            }
            const pos = links[ln].index;
            if (pos > lastPos) {
              const token = new state.Token("text", "", 0);
              token.content = text.slice(lastPos, pos);
              token.level = level;
              nodes.push(token);
            }
            const token_o = new state.Token("link_open", "a", 1);
            token_o.attrs = [["href", fullUrl]];
            token_o.level = level++;
            token_o.markup = "linkify";
            token_o.info = "auto";
            nodes.push(token_o);
            const token_t = new state.Token("text", "", 0);
            token_t.content = urlText;
            token_t.level = level;
            nodes.push(token_t);
            const token_c = new state.Token("link_close", "a", -1);
            token_c.level = --level;
            token_c.markup = "linkify";
            token_c.info = "auto";
            nodes.push(token_c);
            lastPos = links[ln].lastIndex;
          }
          if (lastPos < text.length) {
            const token = new state.Token("text", "", 0);
            token.content = text.slice(lastPos);
            token.level = level;
            nodes.push(token);
          }
          blockTokens[j].children = tokens = arrayReplaceAt(tokens, i, nodes);
        }
      }
    }
  }

  // node_modules/markdown-it/lib/rules_core/replacements.mjs
  var RARE_RE = /\+-|\.\.|\?\?\?\?|!!!!|,,|--/;
  var SCOPED_ABBR_TEST_RE = /\((c|tm|r)\)/i;
  var SCOPED_ABBR_RE = /\((c|tm|r)\)/ig;
  var SCOPED_ABBR = {
    c: "©",
    r: "®",
    tm: "™"
  };
  function replaceFn(match, name) {
    return SCOPED_ABBR[name.toLowerCase()];
  }
  function replace_scoped(inlineTokens) {
    let inside_autolink = 0;
    for (let i = inlineTokens.length - 1;i >= 0; i--) {
      const token = inlineTokens[i];
      if (token.type === "text" && !inside_autolink) {
        token.content = token.content.replace(SCOPED_ABBR_RE, replaceFn);
      }
      if (token.type === "link_open" && token.info === "auto") {
        inside_autolink--;
      }
      if (token.type === "link_close" && token.info === "auto") {
        inside_autolink++;
      }
    }
  }
  function replace_rare(inlineTokens) {
    let inside_autolink = 0;
    for (let i = inlineTokens.length - 1;i >= 0; i--) {
      const token = inlineTokens[i];
      if (token.type === "text" && !inside_autolink) {
        if (RARE_RE.test(token.content)) {
          token.content = token.content.replace(/\+-/g, "±").replace(/\.{2,}/g, "…").replace(/([?!])…/g, "$1..").replace(/([?!]){4,}/g, "$1$1$1").replace(/,{2,}/g, ",").replace(/(^|[^-])---(?=[^-]|$)/mg, "$1—").replace(/(^|\s)--(?=\s|$)/mg, "$1–").replace(/(^|[^-\s])--(?=[^-\s]|$)/mg, "$1–");
        }
      }
      if (token.type === "link_open" && token.info === "auto") {
        inside_autolink--;
      }
      if (token.type === "link_close" && token.info === "auto") {
        inside_autolink++;
      }
    }
  }
  function replace(state) {
    let blkIdx;
    if (!state.md.options.typographer) {
      return;
    }
    for (blkIdx = state.tokens.length - 1;blkIdx >= 0; blkIdx--) {
      if (state.tokens[blkIdx].type !== "inline") {
        continue;
      }
      if (SCOPED_ABBR_TEST_RE.test(state.tokens[blkIdx].content)) {
        replace_scoped(state.tokens[blkIdx].children);
      }
      if (RARE_RE.test(state.tokens[blkIdx].content)) {
        replace_rare(state.tokens[blkIdx].children);
      }
    }
  }

  // node_modules/markdown-it/lib/rules_core/smartquotes.mjs
  var QUOTE_TEST_RE = /['"]/;
  var QUOTE_RE = /['"]/g;
  var APOSTROPHE = "’";
  function replaceAt(str, index, ch) {
    return str.slice(0, index) + ch + str.slice(index + 1);
  }
  function process_inlines(tokens, state) {
    let j;
    const stack = [];
    for (let i = 0;i < tokens.length; i++) {
      const token = tokens[i];
      const thisLevel = tokens[i].level;
      for (j = stack.length - 1;j >= 0; j--) {
        if (stack[j].level <= thisLevel) {
          break;
        }
      }
      stack.length = j + 1;
      if (token.type !== "text") {
        continue;
      }
      let text = token.content;
      let pos = 0;
      let max = text.length;
      OUTER:
        while (pos < max) {
          QUOTE_RE.lastIndex = pos;
          const t = QUOTE_RE.exec(text);
          if (!t) {
            break;
          }
          let canOpen = true;
          let canClose = true;
          pos = t.index + 1;
          const isSingle = t[0] === "'";
          let lastChar = 32;
          if (t.index - 1 >= 0) {
            lastChar = text.charCodeAt(t.index - 1);
          } else {
            for (j = i - 1;j >= 0; j--) {
              if (tokens[j].type === "softbreak" || tokens[j].type === "hardbreak")
                break;
              if (!tokens[j].content)
                continue;
              lastChar = tokens[j].content.charCodeAt(tokens[j].content.length - 1);
              break;
            }
          }
          let nextChar = 32;
          if (pos < max) {
            nextChar = text.charCodeAt(pos);
          } else {
            for (j = i + 1;j < tokens.length; j++) {
              if (tokens[j].type === "softbreak" || tokens[j].type === "hardbreak")
                break;
              if (!tokens[j].content)
                continue;
              nextChar = tokens[j].content.charCodeAt(0);
              break;
            }
          }
          const isLastPunctChar = isMdAsciiPunct(lastChar) || isPunctChar(String.fromCharCode(lastChar));
          const isNextPunctChar = isMdAsciiPunct(nextChar) || isPunctChar(String.fromCharCode(nextChar));
          const isLastWhiteSpace = isWhiteSpace(lastChar);
          const isNextWhiteSpace = isWhiteSpace(nextChar);
          if (isNextWhiteSpace) {
            canOpen = false;
          } else if (isNextPunctChar) {
            if (!(isLastWhiteSpace || isLastPunctChar)) {
              canOpen = false;
            }
          }
          if (isLastWhiteSpace) {
            canClose = false;
          } else if (isLastPunctChar) {
            if (!(isNextWhiteSpace || isNextPunctChar)) {
              canClose = false;
            }
          }
          if (nextChar === 34 && t[0] === '"') {
            if (lastChar >= 48 && lastChar <= 57) {
              canClose = canOpen = false;
            }
          }
          if (canOpen && canClose) {
            canOpen = isLastPunctChar;
            canClose = isNextPunctChar;
          }
          if (!canOpen && !canClose) {
            if (isSingle) {
              token.content = replaceAt(token.content, t.index, APOSTROPHE);
            }
            continue;
          }
          if (canClose) {
            for (j = stack.length - 1;j >= 0; j--) {
              let item = stack[j];
              if (stack[j].level < thisLevel) {
                break;
              }
              if (item.single === isSingle && stack[j].level === thisLevel) {
                item = stack[j];
                let openQuote;
                let closeQuote;
                if (isSingle) {
                  openQuote = state.md.options.quotes[2];
                  closeQuote = state.md.options.quotes[3];
                } else {
                  openQuote = state.md.options.quotes[0];
                  closeQuote = state.md.options.quotes[1];
                }
                token.content = replaceAt(token.content, t.index, closeQuote);
                tokens[item.token].content = replaceAt(tokens[item.token].content, item.pos, openQuote);
                pos += closeQuote.length - 1;
                if (item.token === i) {
                  pos += openQuote.length - 1;
                }
                text = token.content;
                max = text.length;
                stack.length = j;
                continue OUTER;
              }
            }
          }
          if (canOpen) {
            stack.push({
              token: i,
              pos: t.index,
              single: isSingle,
              level: thisLevel
            });
          } else if (canClose && isSingle) {
            token.content = replaceAt(token.content, t.index, APOSTROPHE);
          }
        }
    }
  }
  function smartquotes(state) {
    if (!state.md.options.typographer) {
      return;
    }
    for (let blkIdx = state.tokens.length - 1;blkIdx >= 0; blkIdx--) {
      if (state.tokens[blkIdx].type !== "inline" || !QUOTE_TEST_RE.test(state.tokens[blkIdx].content)) {
        continue;
      }
      process_inlines(state.tokens[blkIdx].children, state);
    }
  }

  // node_modules/markdown-it/lib/rules_core/text_join.mjs
  function text_join(state) {
    let curr, last;
    const blockTokens = state.tokens;
    const l = blockTokens.length;
    for (let j = 0;j < l; j++) {
      if (blockTokens[j].type !== "inline")
        continue;
      const tokens = blockTokens[j].children;
      const max = tokens.length;
      for (curr = 0;curr < max; curr++) {
        if (tokens[curr].type === "text_special") {
          tokens[curr].type = "text";
        }
      }
      for (curr = last = 0;curr < max; curr++) {
        if (tokens[curr].type === "text" && curr + 1 < max && tokens[curr + 1].type === "text") {
          tokens[curr + 1].content = tokens[curr].content + tokens[curr + 1].content;
        } else {
          if (curr !== last) {
            tokens[last] = tokens[curr];
          }
          last++;
        }
      }
      if (curr !== last) {
        tokens.length = last;
      }
    }
  }

  // node_modules/markdown-it/lib/parser_core.mjs
  var _rules = [
    ["normalize", normalize],
    ["block", block],
    ["inline", inline],
    ["linkify", linkify],
    ["replacements", replace],
    ["smartquotes", smartquotes],
    ["text_join", text_join]
  ];
  function Core() {
    this.ruler = new ruler_default;
    for (let i = 0;i < _rules.length; i++) {
      this.ruler.push(_rules[i][0], _rules[i][1]);
    }
  }
  Core.prototype.process = function(state) {
    const rules = this.ruler.getRules("");
    for (let i = 0, l = rules.length;i < l; i++) {
      rules[i](state);
    }
  };
  Core.prototype.State = state_core_default;
  var parser_core_default = Core;

  // node_modules/markdown-it/lib/rules_block/state_block.mjs
  function StateBlock(src, md, env, tokens) {
    this.src = src;
    this.md = md;
    this.env = env;
    this.tokens = tokens;
    this.bMarks = [];
    this.eMarks = [];
    this.tShift = [];
    this.sCount = [];
    this.bsCount = [];
    this.blkIndent = 0;
    this.line = 0;
    this.lineMax = 0;
    this.tight = false;
    this.ddIndent = -1;
    this.listIndent = -1;
    this.parentType = "root";
    this.level = 0;
    const s = this.src;
    for (let start = 0, pos = 0, indent = 0, offset = 0, len = s.length, indent_found = false;pos < len; pos++) {
      const ch = s.charCodeAt(pos);
      if (!indent_found) {
        if (isSpace(ch)) {
          indent++;
          if (ch === 9) {
            offset += 4 - offset % 4;
          } else {
            offset++;
          }
          continue;
        } else {
          indent_found = true;
        }
      }
      if (ch === 10 || pos === len - 1) {
        if (ch !== 10) {
          pos++;
        }
        this.bMarks.push(start);
        this.eMarks.push(pos);
        this.tShift.push(indent);
        this.sCount.push(offset);
        this.bsCount.push(0);
        indent_found = false;
        indent = 0;
        offset = 0;
        start = pos + 1;
      }
    }
    this.bMarks.push(s.length);
    this.eMarks.push(s.length);
    this.tShift.push(0);
    this.sCount.push(0);
    this.bsCount.push(0);
    this.lineMax = this.bMarks.length - 1;
  }
  StateBlock.prototype.push = function(type, tag, nesting) {
    const token = new token_default(type, tag, nesting);
    token.block = true;
    if (nesting < 0)
      this.level--;
    token.level = this.level;
    if (nesting > 0)
      this.level++;
    this.tokens.push(token);
    return token;
  };
  StateBlock.prototype.isEmpty = function isEmpty(line) {
    return this.bMarks[line] + this.tShift[line] >= this.eMarks[line];
  };
  StateBlock.prototype.skipEmptyLines = function skipEmptyLines(from) {
    for (let max = this.lineMax;from < max; from++) {
      if (this.bMarks[from] + this.tShift[from] < this.eMarks[from]) {
        break;
      }
    }
    return from;
  };
  StateBlock.prototype.skipSpaces = function skipSpaces(pos) {
    for (let max = this.src.length;pos < max; pos++) {
      const ch = this.src.charCodeAt(pos);
      if (!isSpace(ch)) {
        break;
      }
    }
    return pos;
  };
  StateBlock.prototype.skipSpacesBack = function skipSpacesBack(pos, min) {
    if (pos <= min) {
      return pos;
    }
    while (pos > min) {
      if (!isSpace(this.src.charCodeAt(--pos))) {
        return pos + 1;
      }
    }
    return pos;
  };
  StateBlock.prototype.skipChars = function skipChars(pos, code) {
    for (let max = this.src.length;pos < max; pos++) {
      if (this.src.charCodeAt(pos) !== code) {
        break;
      }
    }
    return pos;
  };
  StateBlock.prototype.skipCharsBack = function skipCharsBack(pos, code, min) {
    if (pos <= min) {
      return pos;
    }
    while (pos > min) {
      if (code !== this.src.charCodeAt(--pos)) {
        return pos + 1;
      }
    }
    return pos;
  };
  StateBlock.prototype.getLines = function getLines(begin, end, indent, keepLastLF) {
    if (begin >= end) {
      return "";
    }
    const queue = new Array(end - begin);
    for (let i = 0, line = begin;line < end; line++, i++) {
      let lineIndent = 0;
      const lineStart = this.bMarks[line];
      let first = lineStart;
      let last;
      if (line + 1 < end || keepLastLF) {
        last = this.eMarks[line] + 1;
      } else {
        last = this.eMarks[line];
      }
      while (first < last && lineIndent < indent) {
        const ch = this.src.charCodeAt(first);
        if (isSpace(ch)) {
          if (ch === 9) {
            lineIndent += 4 - (lineIndent + this.bsCount[line]) % 4;
          } else {
            lineIndent++;
          }
        } else if (first - lineStart < this.tShift[line]) {
          lineIndent++;
        } else {
          break;
        }
        first++;
      }
      if (lineIndent > indent) {
        queue[i] = new Array(lineIndent - indent + 1).join(" ") + this.src.slice(first, last);
      } else {
        queue[i] = this.src.slice(first, last);
      }
    }
    return queue.join("");
  };
  StateBlock.prototype.Token = token_default;
  var state_block_default = StateBlock;

  // node_modules/markdown-it/lib/rules_block/table.mjs
  var MAX_AUTOCOMPLETED_CELLS = 65536;
  function getLine(state, line) {
    const pos = state.bMarks[line] + state.tShift[line];
    const max = state.eMarks[line];
    return state.src.slice(pos, max);
  }
  function escapedSplit(str) {
    const result = [];
    const max = str.length;
    let pos = 0;
    let ch = str.charCodeAt(pos);
    let isEscaped = false;
    let lastPos = 0;
    let current = "";
    while (pos < max) {
      if (ch === 124) {
        if (!isEscaped) {
          result.push(current + str.substring(lastPos, pos));
          current = "";
          lastPos = pos + 1;
        } else {
          current += str.substring(lastPos, pos - 1);
          lastPos = pos;
        }
      }
      isEscaped = ch === 92;
      pos++;
      ch = str.charCodeAt(pos);
    }
    result.push(current + str.substring(lastPos));
    return result;
  }
  function table(state, startLine, endLine, silent) {
    if (startLine + 2 > endLine) {
      return false;
    }
    let nextLine = startLine + 1;
    if (state.sCount[nextLine] < state.blkIndent) {
      return false;
    }
    if (state.sCount[nextLine] - state.blkIndent >= 4) {
      return false;
    }
    let pos = state.bMarks[nextLine] + state.tShift[nextLine];
    if (pos >= state.eMarks[nextLine]) {
      return false;
    }
    const firstCh = state.src.charCodeAt(pos++);
    if (firstCh !== 124 && firstCh !== 45 && firstCh !== 58) {
      return false;
    }
    if (pos >= state.eMarks[nextLine]) {
      return false;
    }
    const secondCh = state.src.charCodeAt(pos++);
    if (secondCh !== 124 && secondCh !== 45 && secondCh !== 58 && !isSpace(secondCh)) {
      return false;
    }
    if (firstCh === 45 && isSpace(secondCh)) {
      return false;
    }
    while (pos < state.eMarks[nextLine]) {
      const ch = state.src.charCodeAt(pos);
      if (ch !== 124 && ch !== 45 && ch !== 58 && !isSpace(ch)) {
        return false;
      }
      pos++;
    }
    let lineText = getLine(state, startLine + 1);
    let columns = lineText.split("|");
    const aligns = [];
    for (let i = 0;i < columns.length; i++) {
      const t = columns[i].trim();
      if (!t) {
        if (i === 0 || i === columns.length - 1) {
          continue;
        } else {
          return false;
        }
      }
      if (!/^:?-+:?$/.test(t)) {
        return false;
      }
      if (t.charCodeAt(t.length - 1) === 58) {
        aligns.push(t.charCodeAt(0) === 58 ? "center" : "right");
      } else if (t.charCodeAt(0) === 58) {
        aligns.push("left");
      } else {
        aligns.push("");
      }
    }
    lineText = getLine(state, startLine).trim();
    if (lineText.indexOf("|") === -1) {
      return false;
    }
    if (state.sCount[startLine] - state.blkIndent >= 4) {
      return false;
    }
    columns = escapedSplit(lineText);
    if (columns.length && columns[0] === "")
      columns.shift();
    if (columns.length && columns[columns.length - 1] === "")
      columns.pop();
    const columnCount = columns.length;
    if (columnCount === 0 || columnCount !== aligns.length) {
      return false;
    }
    if (silent) {
      return true;
    }
    const oldParentType = state.parentType;
    state.parentType = "table";
    const terminatorRules = state.md.block.ruler.getRules("blockquote");
    const token_to = state.push("table_open", "table", 1);
    const tableLines = [startLine, 0];
    token_to.map = tableLines;
    const token_tho = state.push("thead_open", "thead", 1);
    token_tho.map = [startLine, startLine + 1];
    const token_htro = state.push("tr_open", "tr", 1);
    token_htro.map = [startLine, startLine + 1];
    for (let i = 0;i < columns.length; i++) {
      const token_ho = state.push("th_open", "th", 1);
      if (aligns[i]) {
        token_ho.attrs = [["style", "text-align:" + aligns[i]]];
      }
      const token_il = state.push("inline", "", 0);
      token_il.content = columns[i].trim();
      token_il.children = [];
      state.push("th_close", "th", -1);
    }
    state.push("tr_close", "tr", -1);
    state.push("thead_close", "thead", -1);
    let tbodyLines;
    let autocompletedCells = 0;
    for (nextLine = startLine + 2;nextLine < endLine; nextLine++) {
      if (state.sCount[nextLine] < state.blkIndent) {
        break;
      }
      let terminate = false;
      for (let i = 0, l = terminatorRules.length;i < l; i++) {
        if (terminatorRules[i](state, nextLine, endLine, true)) {
          terminate = true;
          break;
        }
      }
      if (terminate) {
        break;
      }
      lineText = getLine(state, nextLine).trim();
      if (!lineText) {
        break;
      }
      if (state.sCount[nextLine] - state.blkIndent >= 4) {
        break;
      }
      columns = escapedSplit(lineText);
      if (columns.length && columns[0] === "")
        columns.shift();
      if (columns.length && columns[columns.length - 1] === "")
        columns.pop();
      autocompletedCells += columnCount - columns.length;
      if (autocompletedCells > MAX_AUTOCOMPLETED_CELLS) {
        break;
      }
      if (nextLine === startLine + 2) {
        const token_tbo = state.push("tbody_open", "tbody", 1);
        token_tbo.map = tbodyLines = [startLine + 2, 0];
      }
      const token_tro = state.push("tr_open", "tr", 1);
      token_tro.map = [nextLine, nextLine + 1];
      for (let i = 0;i < columnCount; i++) {
        const token_tdo = state.push("td_open", "td", 1);
        if (aligns[i]) {
          token_tdo.attrs = [["style", "text-align:" + aligns[i]]];
        }
        const token_il = state.push("inline", "", 0);
        token_il.content = columns[i] ? columns[i].trim() : "";
        token_il.children = [];
        state.push("td_close", "td", -1);
      }
      state.push("tr_close", "tr", -1);
    }
    if (tbodyLines) {
      state.push("tbody_close", "tbody", -1);
      tbodyLines[1] = nextLine;
    }
    state.push("table_close", "table", -1);
    tableLines[1] = nextLine;
    state.parentType = oldParentType;
    state.line = nextLine;
    return true;
  }

  // node_modules/markdown-it/lib/rules_block/code.mjs
  function code(state, startLine, endLine) {
    if (state.sCount[startLine] - state.blkIndent < 4) {
      return false;
    }
    let nextLine = startLine + 1;
    let last = nextLine;
    while (nextLine < endLine) {
      if (state.isEmpty(nextLine)) {
        nextLine++;
        continue;
      }
      if (state.sCount[nextLine] - state.blkIndent >= 4) {
        nextLine++;
        last = nextLine;
        continue;
      }
      break;
    }
    state.line = last;
    const token = state.push("code_block", "code", 0);
    token.content = state.getLines(startLine, last, 4 + state.blkIndent, false) + `
`;
    token.map = [startLine, state.line];
    return true;
  }

  // node_modules/markdown-it/lib/rules_block/fence.mjs
  function fence(state, startLine, endLine, silent) {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) {
      return false;
    }
    if (pos + 3 > max) {
      return false;
    }
    const marker = state.src.charCodeAt(pos);
    if (marker !== 126 && marker !== 96) {
      return false;
    }
    let mem = pos;
    pos = state.skipChars(pos, marker);
    let len = pos - mem;
    if (len < 3) {
      return false;
    }
    const markup = state.src.slice(mem, pos);
    const params = state.src.slice(pos, max);
    if (marker === 96) {
      if (params.indexOf(String.fromCharCode(marker)) >= 0) {
        return false;
      }
    }
    if (silent) {
      return true;
    }
    let nextLine = startLine;
    let haveEndMarker = false;
    for (;; ) {
      nextLine++;
      if (nextLine >= endLine) {
        break;
      }
      pos = mem = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];
      if (pos < max && state.sCount[nextLine] < state.blkIndent) {
        break;
      }
      if (state.src.charCodeAt(pos) !== marker) {
        continue;
      }
      if (state.sCount[nextLine] - state.blkIndent >= 4) {
        continue;
      }
      pos = state.skipChars(pos, marker);
      if (pos - mem < len) {
        continue;
      }
      pos = state.skipSpaces(pos);
      if (pos < max) {
        continue;
      }
      haveEndMarker = true;
      break;
    }
    len = state.sCount[startLine];
    state.line = nextLine + (haveEndMarker ? 1 : 0);
    const token = state.push("fence", "code", 0);
    token.info = params;
    token.content = state.getLines(startLine + 1, nextLine, len, true);
    token.markup = markup;
    token.map = [startLine, state.line];
    return true;
  }

  // node_modules/markdown-it/lib/rules_block/blockquote.mjs
  function blockquote(state, startLine, endLine, silent) {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];
    const oldLineMax = state.lineMax;
    if (state.sCount[startLine] - state.blkIndent >= 4) {
      return false;
    }
    if (state.src.charCodeAt(pos) !== 62) {
      return false;
    }
    if (silent) {
      return true;
    }
    const oldBMarks = [];
    const oldBSCount = [];
    const oldSCount = [];
    const oldTShift = [];
    const terminatorRules = state.md.block.ruler.getRules("blockquote");
    const oldParentType = state.parentType;
    state.parentType = "blockquote";
    let lastLineEmpty = false;
    let nextLine;
    for (nextLine = startLine;nextLine < endLine; nextLine++) {
      const isOutdented = state.sCount[nextLine] < state.blkIndent;
      pos = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];
      if (pos >= max) {
        break;
      }
      if (state.src.charCodeAt(pos++) === 62 && !isOutdented) {
        let initial = state.sCount[nextLine] + 1;
        let spaceAfterMarker;
        let adjustTab;
        if (state.src.charCodeAt(pos) === 32) {
          pos++;
          initial++;
          adjustTab = false;
          spaceAfterMarker = true;
        } else if (state.src.charCodeAt(pos) === 9) {
          spaceAfterMarker = true;
          if ((state.bsCount[nextLine] + initial) % 4 === 3) {
            pos++;
            initial++;
            adjustTab = false;
          } else {
            adjustTab = true;
          }
        } else {
          spaceAfterMarker = false;
        }
        let offset = initial;
        oldBMarks.push(state.bMarks[nextLine]);
        state.bMarks[nextLine] = pos;
        while (pos < max) {
          const ch = state.src.charCodeAt(pos);
          if (isSpace(ch)) {
            if (ch === 9) {
              offset += 4 - (offset + state.bsCount[nextLine] + (adjustTab ? 1 : 0)) % 4;
            } else {
              offset++;
            }
          } else {
            break;
          }
          pos++;
        }
        lastLineEmpty = pos >= max;
        oldBSCount.push(state.bsCount[nextLine]);
        state.bsCount[nextLine] = state.sCount[nextLine] + 1 + (spaceAfterMarker ? 1 : 0);
        oldSCount.push(state.sCount[nextLine]);
        state.sCount[nextLine] = offset - initial;
        oldTShift.push(state.tShift[nextLine]);
        state.tShift[nextLine] = pos - state.bMarks[nextLine];
        continue;
      }
      if (lastLineEmpty) {
        break;
      }
      let terminate = false;
      for (let i = 0, l = terminatorRules.length;i < l; i++) {
        if (terminatorRules[i](state, nextLine, endLine, true)) {
          terminate = true;
          break;
        }
      }
      if (terminate) {
        state.lineMax = nextLine;
        if (state.blkIndent !== 0) {
          oldBMarks.push(state.bMarks[nextLine]);
          oldBSCount.push(state.bsCount[nextLine]);
          oldTShift.push(state.tShift[nextLine]);
          oldSCount.push(state.sCount[nextLine]);
          state.sCount[nextLine] -= state.blkIndent;
        }
        break;
      }
      oldBMarks.push(state.bMarks[nextLine]);
      oldBSCount.push(state.bsCount[nextLine]);
      oldTShift.push(state.tShift[nextLine]);
      oldSCount.push(state.sCount[nextLine]);
      state.sCount[nextLine] = -1;
    }
    const oldIndent = state.blkIndent;
    state.blkIndent = 0;
    const token_o = state.push("blockquote_open", "blockquote", 1);
    token_o.markup = ">";
    const lines = [startLine, 0];
    token_o.map = lines;
    state.md.block.tokenize(state, startLine, nextLine);
    const token_c = state.push("blockquote_close", "blockquote", -1);
    token_c.markup = ">";
    state.lineMax = oldLineMax;
    state.parentType = oldParentType;
    lines[1] = state.line;
    for (let i = 0;i < oldTShift.length; i++) {
      state.bMarks[i + startLine] = oldBMarks[i];
      state.tShift[i + startLine] = oldTShift[i];
      state.sCount[i + startLine] = oldSCount[i];
      state.bsCount[i + startLine] = oldBSCount[i];
    }
    state.blkIndent = oldIndent;
    return true;
  }

  // node_modules/markdown-it/lib/rules_block/hr.mjs
  function hr(state, startLine, endLine, silent) {
    const max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) {
      return false;
    }
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    const marker = state.src.charCodeAt(pos++);
    if (marker !== 42 && marker !== 45 && marker !== 95) {
      return false;
    }
    let cnt = 1;
    while (pos < max) {
      const ch = state.src.charCodeAt(pos++);
      if (ch !== marker && !isSpace(ch)) {
        return false;
      }
      if (ch === marker) {
        cnt++;
      }
    }
    if (cnt < 3) {
      return false;
    }
    if (silent) {
      return true;
    }
    state.line = startLine + 1;
    const token = state.push("hr", "hr", 0);
    token.map = [startLine, state.line];
    token.markup = Array(cnt + 1).join(String.fromCharCode(marker));
    return true;
  }

  // node_modules/markdown-it/lib/rules_block/list.mjs
  function skipBulletListMarker(state, startLine) {
    const max = state.eMarks[startLine];
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    const marker = state.src.charCodeAt(pos++);
    if (marker !== 42 && marker !== 45 && marker !== 43) {
      return -1;
    }
    if (pos < max) {
      const ch = state.src.charCodeAt(pos);
      if (!isSpace(ch)) {
        return -1;
      }
    }
    return pos;
  }
  function skipOrderedListMarker(state, startLine) {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    let pos = start;
    if (pos + 1 >= max) {
      return -1;
    }
    let ch = state.src.charCodeAt(pos++);
    if (ch < 48 || ch > 57) {
      return -1;
    }
    for (;; ) {
      if (pos >= max) {
        return -1;
      }
      ch = state.src.charCodeAt(pos++);
      if (ch >= 48 && ch <= 57) {
        if (pos - start >= 10) {
          return -1;
        }
        continue;
      }
      if (ch === 41 || ch === 46) {
        break;
      }
      return -1;
    }
    if (pos < max) {
      ch = state.src.charCodeAt(pos);
      if (!isSpace(ch)) {
        return -1;
      }
    }
    return pos;
  }
  function markTightParagraphs(state, idx) {
    const level = state.level + 2;
    for (let i = idx + 2, l = state.tokens.length - 2;i < l; i++) {
      if (state.tokens[i].level === level && state.tokens[i].type === "paragraph_open") {
        state.tokens[i + 2].hidden = true;
        state.tokens[i].hidden = true;
        i += 2;
      }
    }
  }
  function list(state, startLine, endLine, silent) {
    let max, pos, start, token;
    let nextLine = startLine;
    let tight = true;
    if (state.sCount[nextLine] - state.blkIndent >= 4) {
      return false;
    }
    if (state.listIndent >= 0 && state.sCount[nextLine] - state.listIndent >= 4 && state.sCount[nextLine] < state.blkIndent) {
      return false;
    }
    let isTerminatingParagraph = false;
    if (silent && state.parentType === "paragraph") {
      if (state.sCount[nextLine] >= state.blkIndent) {
        isTerminatingParagraph = true;
      }
    }
    let isOrdered;
    let markerValue;
    let posAfterMarker;
    if ((posAfterMarker = skipOrderedListMarker(state, nextLine)) >= 0) {
      isOrdered = true;
      start = state.bMarks[nextLine] + state.tShift[nextLine];
      markerValue = Number(state.src.slice(start, posAfterMarker - 1));
      if (isTerminatingParagraph && markerValue !== 1)
        return false;
    } else if ((posAfterMarker = skipBulletListMarker(state, nextLine)) >= 0) {
      isOrdered = false;
    } else {
      return false;
    }
    if (isTerminatingParagraph) {
      if (state.skipSpaces(posAfterMarker) >= state.eMarks[nextLine])
        return false;
    }
    if (silent) {
      return true;
    }
    const markerCharCode = state.src.charCodeAt(posAfterMarker - 1);
    const listTokIdx = state.tokens.length;
    if (isOrdered) {
      token = state.push("ordered_list_open", "ol", 1);
      if (markerValue !== 1) {
        token.attrs = [["start", markerValue]];
      }
    } else {
      token = state.push("bullet_list_open", "ul", 1);
    }
    const listLines = [nextLine, 0];
    token.map = listLines;
    token.markup = String.fromCharCode(markerCharCode);
    let prevEmptyEnd = false;
    const terminatorRules = state.md.block.ruler.getRules("list");
    const oldParentType = state.parentType;
    state.parentType = "list";
    while (nextLine < endLine) {
      pos = posAfterMarker;
      max = state.eMarks[nextLine];
      const initial = state.sCount[nextLine] + posAfterMarker - (state.bMarks[nextLine] + state.tShift[nextLine]);
      let offset = initial;
      while (pos < max) {
        const ch = state.src.charCodeAt(pos);
        if (ch === 9) {
          offset += 4 - (offset + state.bsCount[nextLine]) % 4;
        } else if (ch === 32) {
          offset++;
        } else {
          break;
        }
        pos++;
      }
      const contentStart = pos;
      let indentAfterMarker;
      if (contentStart >= max) {
        indentAfterMarker = 1;
      } else {
        indentAfterMarker = offset - initial;
      }
      if (indentAfterMarker > 4) {
        indentAfterMarker = 1;
      }
      const indent = initial + indentAfterMarker;
      token = state.push("list_item_open", "li", 1);
      token.markup = String.fromCharCode(markerCharCode);
      const itemLines = [nextLine, 0];
      token.map = itemLines;
      if (isOrdered) {
        token.info = state.src.slice(start, posAfterMarker - 1);
      }
      const oldTight = state.tight;
      const oldTShift = state.tShift[nextLine];
      const oldSCount = state.sCount[nextLine];
      const oldListIndent = state.listIndent;
      state.listIndent = state.blkIndent;
      state.blkIndent = indent;
      state.tight = true;
      state.tShift[nextLine] = contentStart - state.bMarks[nextLine];
      state.sCount[nextLine] = offset;
      if (contentStart >= max && state.isEmpty(nextLine + 1)) {
        state.line = Math.min(state.line + 2, endLine);
      } else {
        state.md.block.tokenize(state, nextLine, endLine, true);
      }
      if (!state.tight || prevEmptyEnd) {
        tight = false;
      }
      prevEmptyEnd = state.line - nextLine > 1 && state.isEmpty(state.line - 1);
      state.blkIndent = state.listIndent;
      state.listIndent = oldListIndent;
      state.tShift[nextLine] = oldTShift;
      state.sCount[nextLine] = oldSCount;
      state.tight = oldTight;
      token = state.push("list_item_close", "li", -1);
      token.markup = String.fromCharCode(markerCharCode);
      nextLine = state.line;
      itemLines[1] = nextLine;
      if (nextLine >= endLine) {
        break;
      }
      if (state.sCount[nextLine] < state.blkIndent) {
        break;
      }
      if (state.sCount[nextLine] - state.blkIndent >= 4) {
        break;
      }
      let terminate = false;
      for (let i = 0, l = terminatorRules.length;i < l; i++) {
        if (terminatorRules[i](state, nextLine, endLine, true)) {
          terminate = true;
          break;
        }
      }
      if (terminate) {
        break;
      }
      if (isOrdered) {
        posAfterMarker = skipOrderedListMarker(state, nextLine);
        if (posAfterMarker < 0) {
          break;
        }
        start = state.bMarks[nextLine] + state.tShift[nextLine];
      } else {
        posAfterMarker = skipBulletListMarker(state, nextLine);
        if (posAfterMarker < 0) {
          break;
        }
      }
      if (markerCharCode !== state.src.charCodeAt(posAfterMarker - 1)) {
        break;
      }
    }
    if (isOrdered) {
      token = state.push("ordered_list_close", "ol", -1);
    } else {
      token = state.push("bullet_list_close", "ul", -1);
    }
    token.markup = String.fromCharCode(markerCharCode);
    listLines[1] = nextLine;
    state.line = nextLine;
    state.parentType = oldParentType;
    if (tight) {
      markTightParagraphs(state, listTokIdx);
    }
    return true;
  }

  // node_modules/markdown-it/lib/rules_block/reference.mjs
  function reference(state, startLine, _endLine, silent) {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];
    let nextLine = startLine + 1;
    if (state.sCount[startLine] - state.blkIndent >= 4) {
      return false;
    }
    if (state.src.charCodeAt(pos) !== 91) {
      return false;
    }
    function getNextLine(nextLine2) {
      const endLine = state.lineMax;
      if (nextLine2 >= endLine || state.isEmpty(nextLine2)) {
        return null;
      }
      let isContinuation = false;
      if (state.sCount[nextLine2] - state.blkIndent > 3) {
        isContinuation = true;
      }
      if (state.sCount[nextLine2] < 0) {
        isContinuation = true;
      }
      if (!isContinuation) {
        const terminatorRules = state.md.block.ruler.getRules("reference");
        const oldParentType = state.parentType;
        state.parentType = "reference";
        let terminate = false;
        for (let i = 0, l = terminatorRules.length;i < l; i++) {
          if (terminatorRules[i](state, nextLine2, endLine, true)) {
            terminate = true;
            break;
          }
        }
        state.parentType = oldParentType;
        if (terminate) {
          return null;
        }
      }
      const pos2 = state.bMarks[nextLine2] + state.tShift[nextLine2];
      const max2 = state.eMarks[nextLine2];
      return state.src.slice(pos2, max2 + 1);
    }
    let str = state.src.slice(pos, max + 1);
    max = str.length;
    let labelEnd = -1;
    for (pos = 1;pos < max; pos++) {
      const ch = str.charCodeAt(pos);
      if (ch === 91) {
        return false;
      } else if (ch === 93) {
        labelEnd = pos;
        break;
      } else if (ch === 10) {
        const lineContent = getNextLine(nextLine);
        if (lineContent !== null) {
          str += lineContent;
          max = str.length;
          nextLine++;
        }
      } else if (ch === 92) {
        pos++;
        if (pos < max && str.charCodeAt(pos) === 10) {
          const lineContent = getNextLine(nextLine);
          if (lineContent !== null) {
            str += lineContent;
            max = str.length;
            nextLine++;
          }
        }
      }
    }
    if (labelEnd < 0 || str.charCodeAt(labelEnd + 1) !== 58) {
      return false;
    }
    for (pos = labelEnd + 2;pos < max; pos++) {
      const ch = str.charCodeAt(pos);
      if (ch === 10) {
        const lineContent = getNextLine(nextLine);
        if (lineContent !== null) {
          str += lineContent;
          max = str.length;
          nextLine++;
        }
      } else if (isSpace(ch)) {} else {
        break;
      }
    }
    const destRes = state.md.helpers.parseLinkDestination(str, pos, max);
    if (!destRes.ok) {
      return false;
    }
    const href = state.md.normalizeLink(destRes.str);
    if (!state.md.validateLink(href)) {
      return false;
    }
    pos = destRes.pos;
    const destEndPos = pos;
    const destEndLineNo = nextLine;
    const start = pos;
    for (;pos < max; pos++) {
      const ch = str.charCodeAt(pos);
      if (ch === 10) {
        const lineContent = getNextLine(nextLine);
        if (lineContent !== null) {
          str += lineContent;
          max = str.length;
          nextLine++;
        }
      } else if (isSpace(ch)) {} else {
        break;
      }
    }
    let titleRes = state.md.helpers.parseLinkTitle(str, pos, max);
    while (titleRes.can_continue) {
      const lineContent = getNextLine(nextLine);
      if (lineContent === null)
        break;
      str += lineContent;
      pos = max;
      max = str.length;
      nextLine++;
      titleRes = state.md.helpers.parseLinkTitle(str, pos, max, titleRes);
    }
    let title;
    if (pos < max && start !== pos && titleRes.ok) {
      title = titleRes.str;
      pos = titleRes.pos;
    } else {
      title = "";
      pos = destEndPos;
      nextLine = destEndLineNo;
    }
    while (pos < max) {
      const ch = str.charCodeAt(pos);
      if (!isSpace(ch)) {
        break;
      }
      pos++;
    }
    if (pos < max && str.charCodeAt(pos) !== 10) {
      if (title) {
        title = "";
        pos = destEndPos;
        nextLine = destEndLineNo;
        while (pos < max) {
          const ch = str.charCodeAt(pos);
          if (!isSpace(ch)) {
            break;
          }
          pos++;
        }
      }
    }
    if (pos < max && str.charCodeAt(pos) !== 10) {
      return false;
    }
    const label = normalizeReference(str.slice(1, labelEnd));
    if (!label) {
      return false;
    }
    if (silent) {
      return true;
    }
    if (typeof state.env.references === "undefined") {
      state.env.references = {};
    }
    if (typeof state.env.references[label] === "undefined") {
      state.env.references[label] = { title, href };
    }
    state.line = nextLine;
    return true;
  }

  // node_modules/markdown-it/lib/common/html_blocks.mjs
  var html_blocks_default = [
    "address",
    "article",
    "aside",
    "base",
    "basefont",
    "blockquote",
    "body",
    "caption",
    "center",
    "col",
    "colgroup",
    "dd",
    "details",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "iframe",
    "legend",
    "li",
    "link",
    "main",
    "menu",
    "menuitem",
    "nav",
    "noframes",
    "ol",
    "optgroup",
    "option",
    "p",
    "param",
    "search",
    "section",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "title",
    "tr",
    "track",
    "ul"
  ];

  // node_modules/markdown-it/lib/common/html_re.mjs
  var attr_name = "[a-zA-Z_:][a-zA-Z0-9:._-]*";
  var unquoted = "[^\"'=<>`\\x00-\\x20]+";
  var single_quoted = "'[^']*'";
  var double_quoted = '"[^"]*"';
  var attr_value = "(?:" + unquoted + "|" + single_quoted + "|" + double_quoted + ")";
  var attribute = "(?:\\s+" + attr_name + "(?:\\s*=\\s*" + attr_value + ")?)";
  var open_tag = "<[A-Za-z][A-Za-z0-9\\-]*" + attribute + "*\\s*\\/?>";
  var close_tag = "<\\/[A-Za-z][A-Za-z0-9\\-]*\\s*>";
  var comment = "<!---?>|<!--(?:[^-]|-[^-]|--[^>])*-->";
  var processing = "<[?][\\s\\S]*?[?]>";
  var declaration = "<![A-Za-z][^>]*>";
  var cdata = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";
  var HTML_TAG_RE = new RegExp("^(?:" + open_tag + "|" + close_tag + "|" + comment + "|" + processing + "|" + declaration + "|" + cdata + ")");
  var HTML_OPEN_CLOSE_TAG_RE = new RegExp("^(?:" + open_tag + "|" + close_tag + ")");

  // node_modules/markdown-it/lib/rules_block/html_block.mjs
  var HTML_SEQUENCES = [
    [/^<(script|pre|style|textarea)(?=(\s|>|$))/i, /<\/(script|pre|style|textarea)>/i, true],
    [/^<!--/, /-->/, true],
    [/^<\?/, /\?>/, true],
    [/^<![A-Z]/, />/, true],
    [/^<!\[CDATA\[/, /\]\]>/, true],
    [new RegExp("^</?(" + html_blocks_default.join("|") + ")(?=(\\s|/?>|$))", "i"), /^$/, true],
    [new RegExp(HTML_OPEN_CLOSE_TAG_RE.source + "\\s*$"), /^$/, false]
  ];
  function html_block(state, startLine, endLine, silent) {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) {
      return false;
    }
    if (!state.md.options.html) {
      return false;
    }
    if (state.src.charCodeAt(pos) !== 60) {
      return false;
    }
    let lineText = state.src.slice(pos, max);
    let i = 0;
    for (;i < HTML_SEQUENCES.length; i++) {
      if (HTML_SEQUENCES[i][0].test(lineText)) {
        break;
      }
    }
    if (i === HTML_SEQUENCES.length) {
      return false;
    }
    if (silent) {
      return HTML_SEQUENCES[i][2];
    }
    let nextLine = startLine + 1;
    if (!HTML_SEQUENCES[i][1].test(lineText)) {
      for (;nextLine < endLine; nextLine++) {
        if (state.sCount[nextLine] < state.blkIndent) {
          break;
        }
        pos = state.bMarks[nextLine] + state.tShift[nextLine];
        max = state.eMarks[nextLine];
        lineText = state.src.slice(pos, max);
        if (HTML_SEQUENCES[i][1].test(lineText)) {
          if (lineText.length !== 0) {
            nextLine++;
          }
          break;
        }
      }
    }
    state.line = nextLine;
    const token = state.push("html_block", "", 0);
    token.map = [startLine, nextLine];
    token.content = state.getLines(startLine, nextLine, state.blkIndent, true);
    return true;
  }

  // node_modules/markdown-it/lib/rules_block/heading.mjs
  function heading(state, startLine, endLine, silent) {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) {
      return false;
    }
    let ch = state.src.charCodeAt(pos);
    if (ch !== 35 || pos >= max) {
      return false;
    }
    let level = 1;
    ch = state.src.charCodeAt(++pos);
    while (ch === 35 && pos < max && level <= 6) {
      level++;
      ch = state.src.charCodeAt(++pos);
    }
    if (level > 6 || pos < max && !isSpace(ch)) {
      return false;
    }
    if (silent) {
      return true;
    }
    max = state.skipSpacesBack(max, pos);
    const tmp = state.skipCharsBack(max, 35, pos);
    if (tmp > pos && isSpace(state.src.charCodeAt(tmp - 1))) {
      max = tmp;
    }
    state.line = startLine + 1;
    const token_o = state.push("heading_open", "h" + String(level), 1);
    token_o.markup = "########".slice(0, level);
    token_o.map = [startLine, state.line];
    const token_i = state.push("inline", "", 0);
    token_i.content = state.src.slice(pos, max).trim();
    token_i.map = [startLine, state.line];
    token_i.children = [];
    const token_c = state.push("heading_close", "h" + String(level), -1);
    token_c.markup = "########".slice(0, level);
    return true;
  }

  // node_modules/markdown-it/lib/rules_block/lheading.mjs
  function lheading(state, startLine, endLine) {
    const terminatorRules = state.md.block.ruler.getRules("paragraph");
    if (state.sCount[startLine] - state.blkIndent >= 4) {
      return false;
    }
    const oldParentType = state.parentType;
    state.parentType = "paragraph";
    let level = 0;
    let marker;
    let nextLine = startLine + 1;
    for (;nextLine < endLine && !state.isEmpty(nextLine); nextLine++) {
      if (state.sCount[nextLine] - state.blkIndent > 3) {
        continue;
      }
      if (state.sCount[nextLine] >= state.blkIndent) {
        let pos = state.bMarks[nextLine] + state.tShift[nextLine];
        const max = state.eMarks[nextLine];
        if (pos < max) {
          marker = state.src.charCodeAt(pos);
          if (marker === 45 || marker === 61) {
            pos = state.skipChars(pos, marker);
            pos = state.skipSpaces(pos);
            if (pos >= max) {
              level = marker === 61 ? 1 : 2;
              break;
            }
          }
        }
      }
      if (state.sCount[nextLine] < 0) {
        continue;
      }
      let terminate = false;
      for (let i = 0, l = terminatorRules.length;i < l; i++) {
        if (terminatorRules[i](state, nextLine, endLine, true)) {
          terminate = true;
          break;
        }
      }
      if (terminate) {
        break;
      }
    }
    if (!level) {
      return false;
    }
    const content = state.getLines(startLine, nextLine, state.blkIndent, false).trim();
    state.line = nextLine + 1;
    const token_o = state.push("heading_open", "h" + String(level), 1);
    token_o.markup = String.fromCharCode(marker);
    token_o.map = [startLine, state.line];
    const token_i = state.push("inline", "", 0);
    token_i.content = content;
    token_i.map = [startLine, state.line - 1];
    token_i.children = [];
    const token_c = state.push("heading_close", "h" + String(level), -1);
    token_c.markup = String.fromCharCode(marker);
    state.parentType = oldParentType;
    return true;
  }

  // node_modules/markdown-it/lib/rules_block/paragraph.mjs
  function paragraph(state, startLine, endLine) {
    const terminatorRules = state.md.block.ruler.getRules("paragraph");
    const oldParentType = state.parentType;
    let nextLine = startLine + 1;
    state.parentType = "paragraph";
    for (;nextLine < endLine && !state.isEmpty(nextLine); nextLine++) {
      if (state.sCount[nextLine] - state.blkIndent > 3) {
        continue;
      }
      if (state.sCount[nextLine] < 0) {
        continue;
      }
      let terminate = false;
      for (let i = 0, l = terminatorRules.length;i < l; i++) {
        if (terminatorRules[i](state, nextLine, endLine, true)) {
          terminate = true;
          break;
        }
      }
      if (terminate) {
        break;
      }
    }
    const content = state.getLines(startLine, nextLine, state.blkIndent, false).trim();
    state.line = nextLine;
    const token_o = state.push("paragraph_open", "p", 1);
    token_o.map = [startLine, state.line];
    const token_i = state.push("inline", "", 0);
    token_i.content = content;
    token_i.map = [startLine, state.line];
    token_i.children = [];
    state.push("paragraph_close", "p", -1);
    state.parentType = oldParentType;
    return true;
  }

  // node_modules/markdown-it/lib/parser_block.mjs
  var _rules2 = [
    ["table", table, ["paragraph", "reference"]],
    ["code", code],
    ["fence", fence, ["paragraph", "reference", "blockquote", "list"]],
    ["blockquote", blockquote, ["paragraph", "reference", "blockquote", "list"]],
    ["hr", hr, ["paragraph", "reference", "blockquote", "list"]],
    ["list", list, ["paragraph", "reference", "blockquote"]],
    ["reference", reference],
    ["html_block", html_block, ["paragraph", "reference", "blockquote"]],
    ["heading", heading, ["paragraph", "reference", "blockquote"]],
    ["lheading", lheading],
    ["paragraph", paragraph]
  ];
  function ParserBlock() {
    this.ruler = new ruler_default;
    for (let i = 0;i < _rules2.length; i++) {
      this.ruler.push(_rules2[i][0], _rules2[i][1], { alt: (_rules2[i][2] || []).slice() });
    }
  }
  ParserBlock.prototype.tokenize = function(state, startLine, endLine) {
    const rules = this.ruler.getRules("");
    const len = rules.length;
    const maxNesting = state.md.options.maxNesting;
    let line = startLine;
    let hasEmptyLines = false;
    while (line < endLine) {
      state.line = line = state.skipEmptyLines(line);
      if (line >= endLine) {
        break;
      }
      if (state.sCount[line] < state.blkIndent) {
        break;
      }
      if (state.level >= maxNesting) {
        state.line = endLine;
        break;
      }
      const prevLine = state.line;
      let ok = false;
      for (let i = 0;i < len; i++) {
        ok = rules[i](state, line, endLine, false);
        if (ok) {
          if (prevLine >= state.line) {
            throw new Error("block rule didn't increment state.line");
          }
          break;
        }
      }
      if (!ok)
        throw new Error("none of the block rules matched");
      state.tight = !hasEmptyLines;
      if (state.isEmpty(state.line - 1)) {
        hasEmptyLines = true;
      }
      line = state.line;
      if (line < endLine && state.isEmpty(line)) {
        hasEmptyLines = true;
        line++;
        state.line = line;
      }
    }
  };
  ParserBlock.prototype.parse = function(src, md, env, outTokens) {
    if (!src) {
      return;
    }
    const state = new this.State(src, md, env, outTokens);
    this.tokenize(state, state.line, state.lineMax);
  };
  ParserBlock.prototype.State = state_block_default;
  var parser_block_default = ParserBlock;

  // node_modules/markdown-it/lib/rules_inline/state_inline.mjs
  function StateInline(src, md, env, outTokens) {
    this.src = src;
    this.env = env;
    this.md = md;
    this.tokens = outTokens;
    this.tokens_meta = Array(outTokens.length);
    this.pos = 0;
    this.posMax = this.src.length;
    this.level = 0;
    this.pending = "";
    this.pendingLevel = 0;
    this.cache = {};
    this.delimiters = [];
    this._prev_delimiters = [];
    this.backticks = {};
    this.backticksScanned = false;
    this.linkLevel = 0;
  }
  StateInline.prototype.pushPending = function() {
    const token = new token_default("text", "", 0);
    token.content = this.pending;
    token.level = this.pendingLevel;
    this.tokens.push(token);
    this.pending = "";
    return token;
  };
  StateInline.prototype.push = function(type, tag, nesting) {
    if (this.pending) {
      this.pushPending();
    }
    const token = new token_default(type, tag, nesting);
    let token_meta = null;
    if (nesting < 0) {
      this.level--;
      this.delimiters = this._prev_delimiters.pop();
    }
    token.level = this.level;
    if (nesting > 0) {
      this.level++;
      this._prev_delimiters.push(this.delimiters);
      this.delimiters = [];
      token_meta = { delimiters: this.delimiters };
    }
    this.pendingLevel = this.level;
    this.tokens.push(token);
    this.tokens_meta.push(token_meta);
    return token;
  };
  StateInline.prototype.scanDelims = function(start, canSplitWord) {
    const max = this.posMax;
    const marker = this.src.charCodeAt(start);
    const lastChar = start > 0 ? this.src.charCodeAt(start - 1) : 32;
    let pos = start;
    while (pos < max && this.src.charCodeAt(pos) === marker) {
      pos++;
    }
    const count = pos - start;
    const nextChar = pos < max ? this.src.charCodeAt(pos) : 32;
    const isLastPunctChar = isMdAsciiPunct(lastChar) || isPunctChar(String.fromCharCode(lastChar));
    const isNextPunctChar = isMdAsciiPunct(nextChar) || isPunctChar(String.fromCharCode(nextChar));
    const isLastWhiteSpace = isWhiteSpace(lastChar);
    const isNextWhiteSpace = isWhiteSpace(nextChar);
    const left_flanking = !isNextWhiteSpace && (!isNextPunctChar || isLastWhiteSpace || isLastPunctChar);
    const right_flanking = !isLastWhiteSpace && (!isLastPunctChar || isNextWhiteSpace || isNextPunctChar);
    const can_open = left_flanking && (canSplitWord || !right_flanking || isLastPunctChar);
    const can_close = right_flanking && (canSplitWord || !left_flanking || isNextPunctChar);
    return { can_open, can_close, length: count };
  };
  StateInline.prototype.Token = token_default;
  var state_inline_default = StateInline;

  // node_modules/markdown-it/lib/rules_inline/text.mjs
  function isTerminatorChar(ch) {
    switch (ch) {
      case 10:
      case 33:
      case 35:
      case 36:
      case 37:
      case 38:
      case 42:
      case 43:
      case 45:
      case 58:
      case 60:
      case 61:
      case 62:
      case 64:
      case 91:
      case 92:
      case 93:
      case 94:
      case 95:
      case 96:
      case 123:
      case 125:
      case 126:
        return true;
      default:
        return false;
    }
  }
  function text(state, silent) {
    let pos = state.pos;
    while (pos < state.posMax && !isTerminatorChar(state.src.charCodeAt(pos))) {
      pos++;
    }
    if (pos === state.pos) {
      return false;
    }
    if (!silent) {
      state.pending += state.src.slice(state.pos, pos);
    }
    state.pos = pos;
    return true;
  }

  // node_modules/markdown-it/lib/rules_inline/linkify.mjs
  var SCHEME_RE = /(?:^|[^a-z0-9.+-])([a-z][a-z0-9.+-]*)$/i;
  function linkify2(state, silent) {
    if (!state.md.options.linkify)
      return false;
    if (state.linkLevel > 0)
      return false;
    const pos = state.pos;
    const max = state.posMax;
    if (pos + 3 > max)
      return false;
    if (state.src.charCodeAt(pos) !== 58)
      return false;
    if (state.src.charCodeAt(pos + 1) !== 47)
      return false;
    if (state.src.charCodeAt(pos + 2) !== 47)
      return false;
    const match = state.pending.match(SCHEME_RE);
    if (!match)
      return false;
    const proto = match[1];
    const link = state.md.linkify.matchAtStart(state.src.slice(pos - proto.length));
    if (!link)
      return false;
    let url = link.url;
    if (url.length <= proto.length)
      return false;
    let urlEnd = url.length;
    while (urlEnd > 0 && url.charCodeAt(urlEnd - 1) === 42) {
      urlEnd--;
    }
    if (urlEnd !== url.length) {
      url = url.slice(0, urlEnd);
    }
    const fullUrl = state.md.normalizeLink(url);
    if (!state.md.validateLink(fullUrl))
      return false;
    if (!silent) {
      state.pending = state.pending.slice(0, -proto.length);
      const token_o = state.push("link_open", "a", 1);
      token_o.attrs = [["href", fullUrl]];
      token_o.markup = "linkify";
      token_o.info = "auto";
      const token_t = state.push("text", "", 0);
      token_t.content = state.md.normalizeLinkText(url);
      const token_c = state.push("link_close", "a", -1);
      token_c.markup = "linkify";
      token_c.info = "auto";
    }
    state.pos += url.length - proto.length;
    return true;
  }

  // node_modules/markdown-it/lib/rules_inline/newline.mjs
  function newline(state, silent) {
    let pos = state.pos;
    if (state.src.charCodeAt(pos) !== 10) {
      return false;
    }
    const pmax = state.pending.length - 1;
    const max = state.posMax;
    if (!silent) {
      if (pmax >= 0 && state.pending.charCodeAt(pmax) === 32) {
        if (pmax >= 1 && state.pending.charCodeAt(pmax - 1) === 32) {
          let ws = pmax - 1;
          while (ws >= 1 && state.pending.charCodeAt(ws - 1) === 32)
            ws--;
          state.pending = state.pending.slice(0, ws);
          state.push("hardbreak", "br", 0);
        } else {
          state.pending = state.pending.slice(0, -1);
          state.push("softbreak", "br", 0);
        }
      } else {
        state.push("softbreak", "br", 0);
      }
    }
    pos++;
    while (pos < max && isSpace(state.src.charCodeAt(pos))) {
      pos++;
    }
    state.pos = pos;
    return true;
  }

  // node_modules/markdown-it/lib/rules_inline/escape.mjs
  var ESCAPED = [];
  for (let i = 0;i < 256; i++) {
    ESCAPED.push(0);
  }
  "\\!\"#$%&'()*+,./:;<=>?@[]^_`{|}~-".split("").forEach(function(ch) {
    ESCAPED[ch.charCodeAt(0)] = 1;
  });
  function escape(state, silent) {
    let pos = state.pos;
    const max = state.posMax;
    if (state.src.charCodeAt(pos) !== 92)
      return false;
    pos++;
    if (pos >= max)
      return false;
    let ch1 = state.src.charCodeAt(pos);
    if (ch1 === 10) {
      if (!silent) {
        state.push("hardbreak", "br", 0);
      }
      pos++;
      while (pos < max) {
        ch1 = state.src.charCodeAt(pos);
        if (!isSpace(ch1))
          break;
        pos++;
      }
      state.pos = pos;
      return true;
    }
    let escapedStr = state.src[pos];
    if (ch1 >= 55296 && ch1 <= 56319 && pos + 1 < max) {
      const ch2 = state.src.charCodeAt(pos + 1);
      if (ch2 >= 56320 && ch2 <= 57343) {
        escapedStr += state.src[pos + 1];
        pos++;
      }
    }
    const origStr = "\\" + escapedStr;
    if (!silent) {
      const token = state.push("text_special", "", 0);
      if (ch1 < 256 && ESCAPED[ch1] !== 0) {
        token.content = escapedStr;
      } else {
        token.content = origStr;
      }
      token.markup = origStr;
      token.info = "escape";
    }
    state.pos = pos + 1;
    return true;
  }

  // node_modules/markdown-it/lib/rules_inline/backticks.mjs
  function backtick(state, silent) {
    let pos = state.pos;
    const ch = state.src.charCodeAt(pos);
    if (ch !== 96) {
      return false;
    }
    const start = pos;
    pos++;
    const max = state.posMax;
    while (pos < max && state.src.charCodeAt(pos) === 96) {
      pos++;
    }
    const marker = state.src.slice(start, pos);
    const openerLength = marker.length;
    if (state.backticksScanned && (state.backticks[openerLength] || 0) <= start) {
      if (!silent)
        state.pending += marker;
      state.pos += openerLength;
      return true;
    }
    let matchEnd = pos;
    let matchStart;
    while ((matchStart = state.src.indexOf("`", matchEnd)) !== -1) {
      matchEnd = matchStart + 1;
      while (matchEnd < max && state.src.charCodeAt(matchEnd) === 96) {
        matchEnd++;
      }
      const closerLength = matchEnd - matchStart;
      if (closerLength === openerLength) {
        if (!silent) {
          const token = state.push("code_inline", "code", 0);
          token.markup = marker;
          token.content = state.src.slice(pos, matchStart).replace(/\n/g, " ").replace(/^ (.+) $/, "$1");
        }
        state.pos = matchEnd;
        return true;
      }
      state.backticks[closerLength] = matchStart;
    }
    state.backticksScanned = true;
    if (!silent)
      state.pending += marker;
    state.pos += openerLength;
    return true;
  }

  // node_modules/markdown-it/lib/rules_inline/strikethrough.mjs
  function strikethrough_tokenize(state, silent) {
    const start = state.pos;
    const marker = state.src.charCodeAt(start);
    if (silent) {
      return false;
    }
    if (marker !== 126) {
      return false;
    }
    const scanned = state.scanDelims(state.pos, true);
    let len = scanned.length;
    const ch = String.fromCharCode(marker);
    if (len < 2) {
      return false;
    }
    let token;
    if (len % 2) {
      token = state.push("text", "", 0);
      token.content = ch;
      len--;
    }
    for (let i = 0;i < len; i += 2) {
      token = state.push("text", "", 0);
      token.content = ch + ch;
      state.delimiters.push({
        marker,
        length: 0,
        token: state.tokens.length - 1,
        end: -1,
        open: scanned.can_open,
        close: scanned.can_close
      });
    }
    state.pos += scanned.length;
    return true;
  }
  function postProcess(state, delimiters) {
    let token;
    const loneMarkers = [];
    const max = delimiters.length;
    for (let i = 0;i < max; i++) {
      const startDelim = delimiters[i];
      if (startDelim.marker !== 126) {
        continue;
      }
      if (startDelim.end === -1) {
        continue;
      }
      const endDelim = delimiters[startDelim.end];
      token = state.tokens[startDelim.token];
      token.type = "s_open";
      token.tag = "s";
      token.nesting = 1;
      token.markup = "~~";
      token.content = "";
      token = state.tokens[endDelim.token];
      token.type = "s_close";
      token.tag = "s";
      token.nesting = -1;
      token.markup = "~~";
      token.content = "";
      if (state.tokens[endDelim.token - 1].type === "text" && state.tokens[endDelim.token - 1].content === "~") {
        loneMarkers.push(endDelim.token - 1);
      }
    }
    while (loneMarkers.length) {
      const i = loneMarkers.pop();
      let j = i + 1;
      while (j < state.tokens.length && state.tokens[j].type === "s_close") {
        j++;
      }
      j--;
      if (i !== j) {
        token = state.tokens[j];
        state.tokens[j] = state.tokens[i];
        state.tokens[i] = token;
      }
    }
  }
  function strikethrough_postProcess(state) {
    const tokens_meta = state.tokens_meta;
    const max = state.tokens_meta.length;
    postProcess(state, state.delimiters);
    for (let curr = 0;curr < max; curr++) {
      if (tokens_meta[curr] && tokens_meta[curr].delimiters) {
        postProcess(state, tokens_meta[curr].delimiters);
      }
    }
  }
  var strikethrough_default = {
    tokenize: strikethrough_tokenize,
    postProcess: strikethrough_postProcess
  };

  // node_modules/markdown-it/lib/rules_inline/emphasis.mjs
  function emphasis_tokenize(state, silent) {
    const start = state.pos;
    const marker = state.src.charCodeAt(start);
    if (silent) {
      return false;
    }
    if (marker !== 95 && marker !== 42) {
      return false;
    }
    const scanned = state.scanDelims(state.pos, marker === 42);
    for (let i = 0;i < scanned.length; i++) {
      const token = state.push("text", "", 0);
      token.content = String.fromCharCode(marker);
      state.delimiters.push({
        marker,
        length: scanned.length,
        token: state.tokens.length - 1,
        end: -1,
        open: scanned.can_open,
        close: scanned.can_close
      });
    }
    state.pos += scanned.length;
    return true;
  }
  function postProcess2(state, delimiters) {
    const max = delimiters.length;
    for (let i = max - 1;i >= 0; i--) {
      const startDelim = delimiters[i];
      if (startDelim.marker !== 95 && startDelim.marker !== 42) {
        continue;
      }
      if (startDelim.end === -1) {
        continue;
      }
      const endDelim = delimiters[startDelim.end];
      const isStrong = i > 0 && delimiters[i - 1].end === startDelim.end + 1 && delimiters[i - 1].marker === startDelim.marker && delimiters[i - 1].token === startDelim.token - 1 && delimiters[startDelim.end + 1].token === endDelim.token + 1;
      const ch = String.fromCharCode(startDelim.marker);
      const token_o = state.tokens[startDelim.token];
      token_o.type = isStrong ? "strong_open" : "em_open";
      token_o.tag = isStrong ? "strong" : "em";
      token_o.nesting = 1;
      token_o.markup = isStrong ? ch + ch : ch;
      token_o.content = "";
      const token_c = state.tokens[endDelim.token];
      token_c.type = isStrong ? "strong_close" : "em_close";
      token_c.tag = isStrong ? "strong" : "em";
      token_c.nesting = -1;
      token_c.markup = isStrong ? ch + ch : ch;
      token_c.content = "";
      if (isStrong) {
        state.tokens[delimiters[i - 1].token].content = "";
        state.tokens[delimiters[startDelim.end + 1].token].content = "";
        i--;
      }
    }
  }
  function emphasis_post_process(state) {
    const tokens_meta = state.tokens_meta;
    const max = state.tokens_meta.length;
    postProcess2(state, state.delimiters);
    for (let curr = 0;curr < max; curr++) {
      if (tokens_meta[curr] && tokens_meta[curr].delimiters) {
        postProcess2(state, tokens_meta[curr].delimiters);
      }
    }
  }
  var emphasis_default = {
    tokenize: emphasis_tokenize,
    postProcess: emphasis_post_process
  };

  // node_modules/markdown-it/lib/rules_inline/link.mjs
  function link(state, silent) {
    let code2, label, res, ref;
    let href = "";
    let title = "";
    let start = state.pos;
    let parseReference = true;
    if (state.src.charCodeAt(state.pos) !== 91) {
      return false;
    }
    const oldPos = state.pos;
    const max = state.posMax;
    const labelStart = state.pos + 1;
    const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos, true);
    if (labelEnd < 0) {
      return false;
    }
    let pos = labelEnd + 1;
    if (pos < max && state.src.charCodeAt(pos) === 40) {
      parseReference = false;
      pos++;
      for (;pos < max; pos++) {
        code2 = state.src.charCodeAt(pos);
        if (!isSpace(code2) && code2 !== 10) {
          break;
        }
      }
      if (pos >= max) {
        return false;
      }
      start = pos;
      res = state.md.helpers.parseLinkDestination(state.src, pos, state.posMax);
      if (res.ok) {
        href = state.md.normalizeLink(res.str);
        if (state.md.validateLink(href)) {
          pos = res.pos;
        } else {
          href = "";
        }
        start = pos;
        for (;pos < max; pos++) {
          code2 = state.src.charCodeAt(pos);
          if (!isSpace(code2) && code2 !== 10) {
            break;
          }
        }
        res = state.md.helpers.parseLinkTitle(state.src, pos, state.posMax);
        if (pos < max && start !== pos && res.ok) {
          title = res.str;
          pos = res.pos;
          for (;pos < max; pos++) {
            code2 = state.src.charCodeAt(pos);
            if (!isSpace(code2) && code2 !== 10) {
              break;
            }
          }
        }
      }
      if (pos >= max || state.src.charCodeAt(pos) !== 41) {
        parseReference = true;
      }
      pos++;
    }
    if (parseReference) {
      if (typeof state.env.references === "undefined") {
        return false;
      }
      if (pos < max && state.src.charCodeAt(pos) === 91) {
        start = pos + 1;
        pos = state.md.helpers.parseLinkLabel(state, pos);
        if (pos >= 0) {
          label = state.src.slice(start, pos++);
        } else {
          pos = labelEnd + 1;
        }
      } else {
        pos = labelEnd + 1;
      }
      if (!label) {
        label = state.src.slice(labelStart, labelEnd);
      }
      ref = state.env.references[normalizeReference(label)];
      if (!ref) {
        state.pos = oldPos;
        return false;
      }
      href = ref.href;
      title = ref.title;
    }
    if (!silent) {
      state.pos = labelStart;
      state.posMax = labelEnd;
      const token_o = state.push("link_open", "a", 1);
      const attrs = [["href", href]];
      token_o.attrs = attrs;
      if (title) {
        attrs.push(["title", title]);
      }
      state.linkLevel++;
      state.md.inline.tokenize(state);
      state.linkLevel--;
      state.push("link_close", "a", -1);
    }
    state.pos = pos;
    state.posMax = max;
    return true;
  }

  // node_modules/markdown-it/lib/rules_inline/image.mjs
  function image(state, silent) {
    let code2, content, label, pos, ref, res, title, start;
    let href = "";
    const oldPos = state.pos;
    const max = state.posMax;
    if (state.src.charCodeAt(state.pos) !== 33) {
      return false;
    }
    if (state.src.charCodeAt(state.pos + 1) !== 91) {
      return false;
    }
    const labelStart = state.pos + 2;
    const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos + 1, false);
    if (labelEnd < 0) {
      return false;
    }
    pos = labelEnd + 1;
    if (pos < max && state.src.charCodeAt(pos) === 40) {
      pos++;
      for (;pos < max; pos++) {
        code2 = state.src.charCodeAt(pos);
        if (!isSpace(code2) && code2 !== 10) {
          break;
        }
      }
      if (pos >= max) {
        return false;
      }
      start = pos;
      res = state.md.helpers.parseLinkDestination(state.src, pos, state.posMax);
      if (res.ok) {
        href = state.md.normalizeLink(res.str);
        if (state.md.validateLink(href)) {
          pos = res.pos;
        } else {
          href = "";
        }
      }
      start = pos;
      for (;pos < max; pos++) {
        code2 = state.src.charCodeAt(pos);
        if (!isSpace(code2) && code2 !== 10) {
          break;
        }
      }
      res = state.md.helpers.parseLinkTitle(state.src, pos, state.posMax);
      if (pos < max && start !== pos && res.ok) {
        title = res.str;
        pos = res.pos;
        for (;pos < max; pos++) {
          code2 = state.src.charCodeAt(pos);
          if (!isSpace(code2) && code2 !== 10) {
            break;
          }
        }
      } else {
        title = "";
      }
      if (pos >= max || state.src.charCodeAt(pos) !== 41) {
        state.pos = oldPos;
        return false;
      }
      pos++;
    } else {
      if (typeof state.env.references === "undefined") {
        return false;
      }
      if (pos < max && state.src.charCodeAt(pos) === 91) {
        start = pos + 1;
        pos = state.md.helpers.parseLinkLabel(state, pos);
        if (pos >= 0) {
          label = state.src.slice(start, pos++);
        } else {
          pos = labelEnd + 1;
        }
      } else {
        pos = labelEnd + 1;
      }
      if (!label) {
        label = state.src.slice(labelStart, labelEnd);
      }
      ref = state.env.references[normalizeReference(label)];
      if (!ref) {
        state.pos = oldPos;
        return false;
      }
      href = ref.href;
      title = ref.title;
    }
    if (!silent) {
      content = state.src.slice(labelStart, labelEnd);
      const tokens = [];
      state.md.inline.parse(content, state.md, state.env, tokens);
      const token = state.push("image", "img", 0);
      const attrs = [["src", href], ["alt", ""]];
      token.attrs = attrs;
      token.children = tokens;
      token.content = content;
      if (title) {
        attrs.push(["title", title]);
      }
    }
    state.pos = pos;
    state.posMax = max;
    return true;
  }

  // node_modules/markdown-it/lib/rules_inline/autolink.mjs
  var EMAIL_RE = /^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;
  var AUTOLINK_RE = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):([^<>\x00-\x20]*)$/;
  function autolink(state, silent) {
    let pos = state.pos;
    if (state.src.charCodeAt(pos) !== 60) {
      return false;
    }
    const start = state.pos;
    const max = state.posMax;
    for (;; ) {
      if (++pos >= max)
        return false;
      const ch = state.src.charCodeAt(pos);
      if (ch === 60)
        return false;
      if (ch === 62)
        break;
    }
    const url = state.src.slice(start + 1, pos);
    if (AUTOLINK_RE.test(url)) {
      const fullUrl = state.md.normalizeLink(url);
      if (!state.md.validateLink(fullUrl)) {
        return false;
      }
      if (!silent) {
        const token_o = state.push("link_open", "a", 1);
        token_o.attrs = [["href", fullUrl]];
        token_o.markup = "autolink";
        token_o.info = "auto";
        const token_t = state.push("text", "", 0);
        token_t.content = state.md.normalizeLinkText(url);
        const token_c = state.push("link_close", "a", -1);
        token_c.markup = "autolink";
        token_c.info = "auto";
      }
      state.pos += url.length + 2;
      return true;
    }
    if (EMAIL_RE.test(url)) {
      const fullUrl = state.md.normalizeLink("mailto:" + url);
      if (!state.md.validateLink(fullUrl)) {
        return false;
      }
      if (!silent) {
        const token_o = state.push("link_open", "a", 1);
        token_o.attrs = [["href", fullUrl]];
        token_o.markup = "autolink";
        token_o.info = "auto";
        const token_t = state.push("text", "", 0);
        token_t.content = state.md.normalizeLinkText(url);
        const token_c = state.push("link_close", "a", -1);
        token_c.markup = "autolink";
        token_c.info = "auto";
      }
      state.pos += url.length + 2;
      return true;
    }
    return false;
  }

  // node_modules/markdown-it/lib/rules_inline/html_inline.mjs
  function isLinkOpen2(str) {
    return /^<a[>\s]/i.test(str);
  }
  function isLinkClose2(str) {
    return /^<\/a\s*>/i.test(str);
  }
  function isLetter(ch) {
    const lc = ch | 32;
    return lc >= 97 && lc <= 122;
  }
  function html_inline(state, silent) {
    if (!state.md.options.html) {
      return false;
    }
    const max = state.posMax;
    const pos = state.pos;
    if (state.src.charCodeAt(pos) !== 60 || pos + 2 >= max) {
      return false;
    }
    const ch = state.src.charCodeAt(pos + 1);
    if (ch !== 33 && ch !== 63 && ch !== 47 && !isLetter(ch)) {
      return false;
    }
    const match = state.src.slice(pos).match(HTML_TAG_RE);
    if (!match) {
      return false;
    }
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = match[0];
      if (isLinkOpen2(token.content))
        state.linkLevel++;
      if (isLinkClose2(token.content))
        state.linkLevel--;
    }
    state.pos += match[0].length;
    return true;
  }

  // node_modules/markdown-it/lib/rules_inline/entity.mjs
  var DIGITAL_RE = /^&#((?:x[a-f0-9]{1,6}|[0-9]{1,7}));/i;
  var NAMED_RE = /^&([a-z][a-z0-9]{1,31});/i;
  function entity(state, silent) {
    const pos = state.pos;
    const max = state.posMax;
    if (state.src.charCodeAt(pos) !== 38)
      return false;
    if (pos + 1 >= max)
      return false;
    const ch = state.src.charCodeAt(pos + 1);
    if (ch === 35) {
      const match = state.src.slice(pos).match(DIGITAL_RE);
      if (match) {
        if (!silent) {
          const code2 = match[1][0].toLowerCase() === "x" ? parseInt(match[1].slice(1), 16) : parseInt(match[1], 10);
          const token = state.push("text_special", "", 0);
          token.content = isValidEntityCode(code2) ? fromCodePoint2(code2) : fromCodePoint2(65533);
          token.markup = match[0];
          token.info = "entity";
        }
        state.pos += match[0].length;
        return true;
      }
    } else {
      const match = state.src.slice(pos).match(NAMED_RE);
      if (match) {
        const decoded = decodeHTML(match[0]);
        if (decoded !== match[0]) {
          if (!silent) {
            const token = state.push("text_special", "", 0);
            token.content = decoded;
            token.markup = match[0];
            token.info = "entity";
          }
          state.pos += match[0].length;
          return true;
        }
      }
    }
    return false;
  }

  // node_modules/markdown-it/lib/rules_inline/balance_pairs.mjs
  function processDelimiters(delimiters) {
    const openersBottom = {};
    const max = delimiters.length;
    if (!max)
      return;
    let headerIdx = 0;
    let lastTokenIdx = -2;
    const jumps = [];
    for (let closerIdx = 0;closerIdx < max; closerIdx++) {
      const closer = delimiters[closerIdx];
      jumps.push(0);
      if (delimiters[headerIdx].marker !== closer.marker || lastTokenIdx !== closer.token - 1) {
        headerIdx = closerIdx;
      }
      lastTokenIdx = closer.token;
      closer.length = closer.length || 0;
      if (!closer.close)
        continue;
      if (!openersBottom.hasOwnProperty(closer.marker)) {
        openersBottom[closer.marker] = [-1, -1, -1, -1, -1, -1];
      }
      const minOpenerIdx = openersBottom[closer.marker][(closer.open ? 3 : 0) + closer.length % 3];
      let openerIdx = headerIdx - jumps[headerIdx] - 1;
      let newMinOpenerIdx = openerIdx;
      for (;openerIdx > minOpenerIdx; openerIdx -= jumps[openerIdx] + 1) {
        const opener = delimiters[openerIdx];
        if (opener.marker !== closer.marker)
          continue;
        if (opener.open && opener.end < 0) {
          let isOddMatch = false;
          if (opener.close || closer.open) {
            if ((opener.length + closer.length) % 3 === 0) {
              if (opener.length % 3 !== 0 || closer.length % 3 !== 0) {
                isOddMatch = true;
              }
            }
          }
          if (!isOddMatch) {
            const lastJump = openerIdx > 0 && !delimiters[openerIdx - 1].open ? jumps[openerIdx - 1] + 1 : 0;
            jumps[closerIdx] = closerIdx - openerIdx + lastJump;
            jumps[openerIdx] = lastJump;
            closer.open = false;
            opener.end = closerIdx;
            opener.close = false;
            newMinOpenerIdx = -1;
            lastTokenIdx = -2;
            break;
          }
        }
      }
      if (newMinOpenerIdx !== -1) {
        openersBottom[closer.marker][(closer.open ? 3 : 0) + (closer.length || 0) % 3] = newMinOpenerIdx;
      }
    }
  }
  function link_pairs(state) {
    const tokens_meta = state.tokens_meta;
    const max = state.tokens_meta.length;
    processDelimiters(state.delimiters);
    for (let curr = 0;curr < max; curr++) {
      if (tokens_meta[curr] && tokens_meta[curr].delimiters) {
        processDelimiters(tokens_meta[curr].delimiters);
      }
    }
  }

  // node_modules/markdown-it/lib/rules_inline/fragments_join.mjs
  function fragments_join(state) {
    let curr, last;
    let level = 0;
    const tokens = state.tokens;
    const max = state.tokens.length;
    for (curr = last = 0;curr < max; curr++) {
      if (tokens[curr].nesting < 0)
        level--;
      tokens[curr].level = level;
      if (tokens[curr].nesting > 0)
        level++;
      if (tokens[curr].type === "text" && curr + 1 < max && tokens[curr + 1].type === "text") {
        tokens[curr + 1].content = tokens[curr].content + tokens[curr + 1].content;
      } else {
        if (curr !== last) {
          tokens[last] = tokens[curr];
        }
        last++;
      }
    }
    if (curr !== last) {
      tokens.length = last;
    }
  }

  // node_modules/markdown-it/lib/parser_inline.mjs
  var _rules3 = [
    ["text", text],
    ["linkify", linkify2],
    ["newline", newline],
    ["escape", escape],
    ["backticks", backtick],
    ["strikethrough", strikethrough_default.tokenize],
    ["emphasis", emphasis_default.tokenize],
    ["link", link],
    ["image", image],
    ["autolink", autolink],
    ["html_inline", html_inline],
    ["entity", entity]
  ];
  var _rules22 = [
    ["balance_pairs", link_pairs],
    ["strikethrough", strikethrough_default.postProcess],
    ["emphasis", emphasis_default.postProcess],
    ["fragments_join", fragments_join]
  ];
  function ParserInline() {
    this.ruler = new ruler_default;
    for (let i = 0;i < _rules3.length; i++) {
      this.ruler.push(_rules3[i][0], _rules3[i][1]);
    }
    this.ruler2 = new ruler_default;
    for (let i = 0;i < _rules22.length; i++) {
      this.ruler2.push(_rules22[i][0], _rules22[i][1]);
    }
  }
  ParserInline.prototype.skipToken = function(state) {
    const pos = state.pos;
    const rules = this.ruler.getRules("");
    const len = rules.length;
    const maxNesting = state.md.options.maxNesting;
    const cache = state.cache;
    if (typeof cache[pos] !== "undefined") {
      state.pos = cache[pos];
      return;
    }
    let ok = false;
    if (state.level < maxNesting) {
      for (let i = 0;i < len; i++) {
        state.level++;
        ok = rules[i](state, true);
        state.level--;
        if (ok) {
          if (pos >= state.pos) {
            throw new Error("inline rule didn't increment state.pos");
          }
          break;
        }
      }
    } else {
      state.pos = state.posMax;
    }
    if (!ok) {
      state.pos++;
    }
    cache[pos] = state.pos;
  };
  ParserInline.prototype.tokenize = function(state) {
    const rules = this.ruler.getRules("");
    const len = rules.length;
    const end = state.posMax;
    const maxNesting = state.md.options.maxNesting;
    while (state.pos < end) {
      const prevPos = state.pos;
      let ok = false;
      if (state.level < maxNesting) {
        for (let i = 0;i < len; i++) {
          ok = rules[i](state, false);
          if (ok) {
            if (prevPos >= state.pos) {
              throw new Error("inline rule didn't increment state.pos");
            }
            break;
          }
        }
      }
      if (ok) {
        if (state.pos >= end) {
          break;
        }
        continue;
      }
      state.pending += state.src[state.pos++];
    }
    if (state.pending) {
      state.pushPending();
    }
  };
  ParserInline.prototype.parse = function(str, md, env, outTokens) {
    const state = new this.State(str, md, env, outTokens);
    this.tokenize(state);
    const rules = this.ruler2.getRules("");
    const len = rules.length;
    for (let i = 0;i < len; i++) {
      rules[i](state);
    }
  };
  ParserInline.prototype.State = state_inline_default;
  var parser_inline_default = ParserInline;

  // node_modules/linkify-it/lib/re.mjs
  function re_default(opts) {
    const re = {};
    opts = opts || {};
    re.src_Any = regex_default.source;
    re.src_Cc = regex_default2.source;
    re.src_Z = regex_default6.source;
    re.src_P = regex_default4.source;
    re.src_ZPCc = [re.src_Z, re.src_P, re.src_Cc].join("|");
    re.src_ZCc = [re.src_Z, re.src_Cc].join("|");
    const text_separators = "[><｜]";
    re.src_pseudo_letter = "(?:(?!" + text_separators + "|" + re.src_ZPCc + ")" + re.src_Any + ")";
    re.src_ip4 = "(?:(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)";
    re.src_auth = "(?:(?:(?!" + re.src_ZCc + "|[@/\\[\\]()]).)+@)?";
    re.src_port = "(?::(?:6(?:[0-4]\\d{3}|5(?:[0-4]\\d{2}|5(?:[0-2]\\d|3[0-5])))|[1-5]?\\d{1,4}))?";
    re.src_host_terminator = "(?=$|" + text_separators + "|" + re.src_ZPCc + ")" + "(?!" + (opts["---"] ? "-(?!--)|" : "-|") + "_|:\\d|\\.-|\\.(?!$|" + re.src_ZPCc + "))";
    re.src_path = "(?:" + "[/?#]" + "(?:" + "(?!" + re.src_ZCc + "|" + text_separators + `|[()[\\]{}.,"'?!\\-;]).|` + "\\[(?:(?!" + re.src_ZCc + "|\\]).)*\\]|" + "\\((?:(?!" + re.src_ZCc + "|[)]).)*\\)|" + "\\{(?:(?!" + re.src_ZCc + "|[}]).)*\\}|" + "\\\"(?:(?!" + re.src_ZCc + '|["]).)+\\"|' + "\\'(?:(?!" + re.src_ZCc + "|[']).)+\\'|" + "\\'(?=" + re.src_pseudo_letter + "|[-])|" + "\\.{2,}[a-zA-Z0-9%/&]|" + "\\.(?!" + re.src_ZCc + "|[.]|$)|" + (opts["---"] ? "\\-(?!--(?:[^-]|$))(?:-*)|" : "\\-+|") + ",(?!" + re.src_ZCc + "|$)|" + ";(?!" + re.src_ZCc + "|$)|" + "\\!+(?!" + re.src_ZCc + "|[!]|$)|" + "\\?(?!" + re.src_ZCc + "|[?]|$)" + ")+" + "|\\/" + ")?";
    re.src_email_name = "[\\-;:&=\\+\\$,\\.a-zA-Z0-9_][\\-;:&=\\+\\$,\\\"\\.a-zA-Z0-9_]*";
    re.src_xn = "xn--[a-z0-9\\-]{1,59}";
    re.src_domain_root = "(?:" + re.src_xn + "|" + re.src_pseudo_letter + "{1,63}" + ")";
    re.src_domain = "(?:" + re.src_xn + "|" + "(?:" + re.src_pseudo_letter + ")" + "|" + "(?:" + re.src_pseudo_letter + "(?:-|" + re.src_pseudo_letter + "){0,61}" + re.src_pseudo_letter + ")" + ")";
    re.src_host = "(?:" + "(?:(?:(?:" + re.src_domain + ")\\.)*" + re.src_domain + ")" + ")";
    re.tpl_host_fuzzy = "(?:" + re.src_ip4 + "|" + "(?:(?:(?:" + re.src_domain + ")\\.)+(?:%TLDS%))" + ")";
    re.tpl_host_no_ip_fuzzy = "(?:(?:(?:" + re.src_domain + ")\\.)+(?:%TLDS%))";
    re.src_host_strict = re.src_host + re.src_host_terminator;
    re.tpl_host_fuzzy_strict = re.tpl_host_fuzzy + re.src_host_terminator;
    re.src_host_port_strict = re.src_host + re.src_port + re.src_host_terminator;
    re.tpl_host_port_fuzzy_strict = re.tpl_host_fuzzy + re.src_port + re.src_host_terminator;
    re.tpl_host_port_no_ip_fuzzy_strict = re.tpl_host_no_ip_fuzzy + re.src_port + re.src_host_terminator;
    re.tpl_host_fuzzy_test = "localhost|www\\.|\\.\\d{1,3}\\.|(?:\\.(?:%TLDS%)(?:" + re.src_ZPCc + "|>|$))";
    re.tpl_email_fuzzy = "(^|" + text_separators + '|"|\\(|' + re.src_ZCc + ")" + "(" + re.src_email_name + "@" + re.tpl_host_fuzzy_strict + ")";
    re.tpl_link_fuzzy = "(^|(?![.:/\\-_@])(?:[$+<=>^`|｜]|" + re.src_ZPCc + "))" + "((?![$+<=>^`|｜])" + re.tpl_host_port_fuzzy_strict + re.src_path + ")";
    re.tpl_link_no_ip_fuzzy = "(^|(?![.:/\\-_@])(?:[$+<=>^`|｜]|" + re.src_ZPCc + "))" + "((?![$+<=>^`|｜])" + re.tpl_host_port_no_ip_fuzzy_strict + re.src_path + ")";
    return re;
  }

  // node_modules/linkify-it/index.mjs
  function assign2(obj) {
    const sources = Array.prototype.slice.call(arguments, 1);
    sources.forEach(function(source) {
      if (!source) {
        return;
      }
      Object.keys(source).forEach(function(key) {
        obj[key] = source[key];
      });
    });
    return obj;
  }
  function _class2(obj) {
    return Object.prototype.toString.call(obj);
  }
  function isString2(obj) {
    return _class2(obj) === "[object String]";
  }
  function isObject(obj) {
    return _class2(obj) === "[object Object]";
  }
  function isRegExp(obj) {
    return _class2(obj) === "[object RegExp]";
  }
  function isFunction(obj) {
    return _class2(obj) === "[object Function]";
  }
  function escapeRE2(str) {
    return str.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");
  }
  var defaultOptions = {
    fuzzyLink: true,
    fuzzyEmail: true,
    fuzzyIP: false
  };
  function isOptionsObj(obj) {
    return Object.keys(obj || {}).reduce(function(acc, k) {
      return acc || defaultOptions.hasOwnProperty(k);
    }, false);
  }
  var defaultSchemas = {
    "http:": {
      validate: function(text2, pos, self) {
        const tail = text2.slice(pos);
        if (!self.re.http) {
          self.re.http = new RegExp("^\\/\\/" + self.re.src_auth + self.re.src_host_port_strict + self.re.src_path, "i");
        }
        if (self.re.http.test(tail)) {
          return tail.match(self.re.http)[0].length;
        }
        return 0;
      }
    },
    "https:": "http:",
    "ftp:": "http:",
    "//": {
      validate: function(text2, pos, self) {
        const tail = text2.slice(pos);
        if (!self.re.no_http) {
          self.re.no_http = new RegExp("^" + self.re.src_auth + "(?:localhost|(?:(?:" + self.re.src_domain + ")\\.)+" + self.re.src_domain_root + ")" + self.re.src_port + self.re.src_host_terminator + self.re.src_path, "i");
        }
        if (self.re.no_http.test(tail)) {
          if (pos >= 3 && text2[pos - 3] === ":") {
            return 0;
          }
          if (pos >= 3 && text2[pos - 3] === "/") {
            return 0;
          }
          return tail.match(self.re.no_http)[0].length;
        }
        return 0;
      }
    },
    "mailto:": {
      validate: function(text2, pos, self) {
        const tail = text2.slice(pos);
        if (!self.re.mailto) {
          self.re.mailto = new RegExp("^" + self.re.src_email_name + "@" + self.re.src_host_strict, "i");
        }
        if (self.re.mailto.test(tail)) {
          return tail.match(self.re.mailto)[0].length;
        }
        return 0;
      }
    }
  };
  var tlds_2ch_src_re = "a[cdefgilmnoqrstuwxz]|b[abdefghijmnorstvwyz]|c[acdfghiklmnoruvwxyz]|d[ejkmoz]|e[cegrstu]|f[ijkmor]|g[abdefghilmnpqrstuwy]|h[kmnrtu]|i[delmnoqrst]|j[emop]|k[eghimnprwyz]|l[abcikrstuvy]|m[acdeghklmnopqrstuvwxyz]|n[acefgilopruz]|om|p[aefghklmnrstwy]|qa|r[eosuw]|s[abcdeghijklmnortuvxyz]|t[cdfghjklmnortvwz]|u[agksyz]|v[aceginu]|w[fs]|y[et]|z[amw]";
  var tlds_default = "biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф".split("|");
  function resetScanCache(self) {
    self.__index__ = -1;
    self.__text_cache__ = "";
  }
  function createValidator(re) {
    return function(text2, pos) {
      const tail = text2.slice(pos);
      if (re.test(tail)) {
        return tail.match(re)[0].length;
      }
      return 0;
    };
  }
  function createNormalizer() {
    return function(match, self) {
      self.normalize(match);
    };
  }
  function compile(self) {
    const re = self.re = re_default(self.__opts__);
    const tlds = self.__tlds__.slice();
    self.onCompile();
    if (!self.__tlds_replaced__) {
      tlds.push(tlds_2ch_src_re);
    }
    tlds.push(re.src_xn);
    re.src_tlds = tlds.join("|");
    function untpl(tpl) {
      return tpl.replace("%TLDS%", re.src_tlds);
    }
    re.email_fuzzy = RegExp(untpl(re.tpl_email_fuzzy), "i");
    re.link_fuzzy = RegExp(untpl(re.tpl_link_fuzzy), "i");
    re.link_no_ip_fuzzy = RegExp(untpl(re.tpl_link_no_ip_fuzzy), "i");
    re.host_fuzzy_test = RegExp(untpl(re.tpl_host_fuzzy_test), "i");
    const aliases = [];
    self.__compiled__ = {};
    function schemaError(name, val) {
      throw new Error('(LinkifyIt) Invalid schema "' + name + '": ' + val);
    }
    Object.keys(self.__schemas__).forEach(function(name) {
      const val = self.__schemas__[name];
      if (val === null) {
        return;
      }
      const compiled = { validate: null, link: null };
      self.__compiled__[name] = compiled;
      if (isObject(val)) {
        if (isRegExp(val.validate)) {
          compiled.validate = createValidator(val.validate);
        } else if (isFunction(val.validate)) {
          compiled.validate = val.validate;
        } else {
          schemaError(name, val);
        }
        if (isFunction(val.normalize)) {
          compiled.normalize = val.normalize;
        } else if (!val.normalize) {
          compiled.normalize = createNormalizer();
        } else {
          schemaError(name, val);
        }
        return;
      }
      if (isString2(val)) {
        aliases.push(name);
        return;
      }
      schemaError(name, val);
    });
    aliases.forEach(function(alias) {
      if (!self.__compiled__[self.__schemas__[alias]]) {
        return;
      }
      self.__compiled__[alias].validate = self.__compiled__[self.__schemas__[alias]].validate;
      self.__compiled__[alias].normalize = self.__compiled__[self.__schemas__[alias]].normalize;
    });
    self.__compiled__[""] = { validate: null, normalize: createNormalizer() };
    const slist = Object.keys(self.__compiled__).filter(function(name) {
      return name.length > 0 && self.__compiled__[name];
    }).map(escapeRE2).join("|");
    self.re.schema_test = RegExp("(^|(?!_)(?:[><｜]|" + re.src_ZPCc + "))(" + slist + ")", "i");
    self.re.schema_search = RegExp("(^|(?!_)(?:[><｜]|" + re.src_ZPCc + "))(" + slist + ")", "ig");
    self.re.schema_at_start = RegExp("^" + self.re.schema_search.source, "i");
    self.re.pretest = RegExp("(" + self.re.schema_test.source + ")|(" + self.re.host_fuzzy_test.source + ")|@", "i");
    resetScanCache(self);
  }
  function Match(self, shift) {
    const start = self.__index__;
    const end = self.__last_index__;
    const text2 = self.__text_cache__.slice(start, end);
    this.schema = self.__schema__.toLowerCase();
    this.index = start + shift;
    this.lastIndex = end + shift;
    this.raw = text2;
    this.text = text2;
    this.url = text2;
  }
  function createMatch(self, shift) {
    const match = new Match(self, shift);
    self.__compiled__[match.schema].normalize(match, self);
    return match;
  }
  function LinkifyIt(schemas, options) {
    if (!(this instanceof LinkifyIt)) {
      return new LinkifyIt(schemas, options);
    }
    if (!options) {
      if (isOptionsObj(schemas)) {
        options = schemas;
        schemas = {};
      }
    }
    this.__opts__ = assign2({}, defaultOptions, options);
    this.__index__ = -1;
    this.__last_index__ = -1;
    this.__schema__ = "";
    this.__text_cache__ = "";
    this.__schemas__ = assign2({}, defaultSchemas, schemas);
    this.__compiled__ = {};
    this.__tlds__ = tlds_default;
    this.__tlds_replaced__ = false;
    this.re = {};
    compile(this);
  }
  LinkifyIt.prototype.add = function add(schema, definition) {
    this.__schemas__[schema] = definition;
    compile(this);
    return this;
  };
  LinkifyIt.prototype.set = function set(options) {
    this.__opts__ = assign2(this.__opts__, options);
    return this;
  };
  LinkifyIt.prototype.test = function test(text2) {
    this.__text_cache__ = text2;
    this.__index__ = -1;
    if (!text2.length) {
      return false;
    }
    let m, ml, me, len, shift, next, re, tld_pos, at_pos;
    if (this.re.schema_test.test(text2)) {
      re = this.re.schema_search;
      re.lastIndex = 0;
      while ((m = re.exec(text2)) !== null) {
        len = this.testSchemaAt(text2, m[2], re.lastIndex);
        if (len) {
          this.__schema__ = m[2];
          this.__index__ = m.index + m[1].length;
          this.__last_index__ = m.index + m[0].length + len;
          break;
        }
      }
    }
    if (this.__opts__.fuzzyLink && this.__compiled__["http:"]) {
      tld_pos = text2.search(this.re.host_fuzzy_test);
      if (tld_pos >= 0) {
        if (this.__index__ < 0 || tld_pos < this.__index__) {
          if ((ml = text2.match(this.__opts__.fuzzyIP ? this.re.link_fuzzy : this.re.link_no_ip_fuzzy)) !== null) {
            shift = ml.index + ml[1].length;
            if (this.__index__ < 0 || shift < this.__index__) {
              this.__schema__ = "";
              this.__index__ = shift;
              this.__last_index__ = ml.index + ml[0].length;
            }
          }
        }
      }
    }
    if (this.__opts__.fuzzyEmail && this.__compiled__["mailto:"]) {
      at_pos = text2.indexOf("@");
      if (at_pos >= 0) {
        if ((me = text2.match(this.re.email_fuzzy)) !== null) {
          shift = me.index + me[1].length;
          next = me.index + me[0].length;
          if (this.__index__ < 0 || shift < this.__index__ || shift === this.__index__ && next > this.__last_index__) {
            this.__schema__ = "mailto:";
            this.__index__ = shift;
            this.__last_index__ = next;
          }
        }
      }
    }
    return this.__index__ >= 0;
  };
  LinkifyIt.prototype.pretest = function pretest(text2) {
    return this.re.pretest.test(text2);
  };
  LinkifyIt.prototype.testSchemaAt = function testSchemaAt(text2, schema, pos) {
    if (!this.__compiled__[schema.toLowerCase()]) {
      return 0;
    }
    return this.__compiled__[schema.toLowerCase()].validate(text2, pos, this);
  };
  LinkifyIt.prototype.match = function match(text2) {
    const result = [];
    let shift = 0;
    if (this.__index__ >= 0 && this.__text_cache__ === text2) {
      result.push(createMatch(this, shift));
      shift = this.__last_index__;
    }
    let tail = shift ? text2.slice(shift) : text2;
    while (this.test(tail)) {
      result.push(createMatch(this, shift));
      tail = tail.slice(this.__last_index__);
      shift += this.__last_index__;
    }
    if (result.length) {
      return result;
    }
    return null;
  };
  LinkifyIt.prototype.matchAtStart = function matchAtStart(text2) {
    this.__text_cache__ = text2;
    this.__index__ = -1;
    if (!text2.length)
      return null;
    const m = this.re.schema_at_start.exec(text2);
    if (!m)
      return null;
    const len = this.testSchemaAt(text2, m[2], m[0].length);
    if (!len)
      return null;
    this.__schema__ = m[2];
    this.__index__ = m.index + m[1].length;
    this.__last_index__ = m.index + m[0].length + len;
    return createMatch(this, 0);
  };
  LinkifyIt.prototype.tlds = function tlds(list2, keepOld) {
    list2 = Array.isArray(list2) ? list2 : [list2];
    if (!keepOld) {
      this.__tlds__ = list2.slice();
      this.__tlds_replaced__ = true;
      compile(this);
      return this;
    }
    this.__tlds__ = this.__tlds__.concat(list2).sort().filter(function(el, idx, arr) {
      return el !== arr[idx - 1];
    }).reverse();
    compile(this);
    return this;
  };
  LinkifyIt.prototype.normalize = function normalize2(match2) {
    if (!match2.schema) {
      match2.url = "http://" + match2.url;
    }
    if (match2.schema === "mailto:" && !/^mailto:/i.test(match2.url)) {
      match2.url = "mailto:" + match2.url;
    }
  };
  LinkifyIt.prototype.onCompile = function onCompile() {};
  var linkify_it_default = LinkifyIt;

  // node_modules/punycode.js/punycode.es6.js
  var maxInt = 2147483647;
  var base = 36;
  var tMin = 1;
  var tMax = 26;
  var skew = 38;
  var damp = 700;
  var initialBias = 72;
  var initialN = 128;
  var delimiter = "-";
  var regexPunycode = /^xn--/;
  var regexNonASCII = /[^\0-\x7F]/;
  var regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g;
  var errors = {
    overflow: "Overflow: input needs wider integers to process",
    "not-basic": "Illegal input >= 0x80 (not a basic code point)",
    "invalid-input": "Invalid input"
  };
  var baseMinusTMin = base - tMin;
  var floor = Math.floor;
  var stringFromCharCode = String.fromCharCode;
  function error(type) {
    throw new RangeError(errors[type]);
  }
  function map(array, callback) {
    const result = [];
    let length = array.length;
    while (length--) {
      result[length] = callback(array[length]);
    }
    return result;
  }
  function mapDomain(domain, callback) {
    const parts = domain.split("@");
    let result = "";
    if (parts.length > 1) {
      result = parts[0] + "@";
      domain = parts[1];
    }
    domain = domain.replace(regexSeparators, ".");
    const labels = domain.split(".");
    const encoded = map(labels, callback).join(".");
    return result + encoded;
  }
  function ucs2decode(string) {
    const output = [];
    let counter = 0;
    const length = string.length;
    while (counter < length) {
      const value = string.charCodeAt(counter++);
      if (value >= 55296 && value <= 56319 && counter < length) {
        const extra = string.charCodeAt(counter++);
        if ((extra & 64512) == 56320) {
          output.push(((value & 1023) << 10) + (extra & 1023) + 65536);
        } else {
          output.push(value);
          counter--;
        }
      } else {
        output.push(value);
      }
    }
    return output;
  }
  var ucs2encode = (codePoints) => String.fromCodePoint(...codePoints);
  var basicToDigit = function(codePoint) {
    if (codePoint >= 48 && codePoint < 58) {
      return 26 + (codePoint - 48);
    }
    if (codePoint >= 65 && codePoint < 91) {
      return codePoint - 65;
    }
    if (codePoint >= 97 && codePoint < 123) {
      return codePoint - 97;
    }
    return base;
  };
  var digitToBasic = function(digit, flag) {
    return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
  };
  var adapt = function(delta, numPoints, firstTime) {
    let k = 0;
    delta = firstTime ? floor(delta / damp) : delta >> 1;
    delta += floor(delta / numPoints);
    for (;delta > baseMinusTMin * tMax >> 1; k += base) {
      delta = floor(delta / baseMinusTMin);
    }
    return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
  };
  var decode2 = function(input) {
    const output = [];
    const inputLength = input.length;
    let i = 0;
    let n = initialN;
    let bias = initialBias;
    let basic = input.lastIndexOf(delimiter);
    if (basic < 0) {
      basic = 0;
    }
    for (let j = 0;j < basic; ++j) {
      if (input.charCodeAt(j) >= 128) {
        error("not-basic");
      }
      output.push(input.charCodeAt(j));
    }
    for (let index = basic > 0 ? basic + 1 : 0;index < inputLength; ) {
      const oldi = i;
      for (let w = 1, k = base;; k += base) {
        if (index >= inputLength) {
          error("invalid-input");
        }
        const digit = basicToDigit(input.charCodeAt(index++));
        if (digit >= base) {
          error("invalid-input");
        }
        if (digit > floor((maxInt - i) / w)) {
          error("overflow");
        }
        i += digit * w;
        const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
        if (digit < t) {
          break;
        }
        const baseMinusT = base - t;
        if (w > floor(maxInt / baseMinusT)) {
          error("overflow");
        }
        w *= baseMinusT;
      }
      const out = output.length + 1;
      bias = adapt(i - oldi, out, oldi == 0);
      if (floor(i / out) > maxInt - n) {
        error("overflow");
      }
      n += floor(i / out);
      i %= out;
      output.splice(i++, 0, n);
    }
    return String.fromCodePoint(...output);
  };
  var encode2 = function(input) {
    const output = [];
    input = ucs2decode(input);
    const inputLength = input.length;
    let n = initialN;
    let delta = 0;
    let bias = initialBias;
    for (const currentValue of input) {
      if (currentValue < 128) {
        output.push(stringFromCharCode(currentValue));
      }
    }
    const basicLength = output.length;
    let handledCPCount = basicLength;
    if (basicLength) {
      output.push(delimiter);
    }
    while (handledCPCount < inputLength) {
      let m = maxInt;
      for (const currentValue of input) {
        if (currentValue >= n && currentValue < m) {
          m = currentValue;
        }
      }
      const handledCPCountPlusOne = handledCPCount + 1;
      if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
        error("overflow");
      }
      delta += (m - n) * handledCPCountPlusOne;
      n = m;
      for (const currentValue of input) {
        if (currentValue < n && ++delta > maxInt) {
          error("overflow");
        }
        if (currentValue === n) {
          let q = delta;
          for (let k = base;; k += base) {
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
            if (q < t) {
              break;
            }
            const qMinusT = q - t;
            const baseMinusT = base - t;
            output.push(stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0)));
            q = floor(qMinusT / baseMinusT);
          }
          output.push(stringFromCharCode(digitToBasic(q, 0)));
          bias = adapt(delta, handledCPCountPlusOne, handledCPCount === basicLength);
          delta = 0;
          ++handledCPCount;
        }
      }
      ++delta;
      ++n;
    }
    return output.join("");
  };
  var toUnicode = function(input) {
    return mapDomain(input, function(string) {
      return regexPunycode.test(string) ? decode2(string.slice(4).toLowerCase()) : string;
    });
  };
  var toASCII = function(input) {
    return mapDomain(input, function(string) {
      return regexNonASCII.test(string) ? "xn--" + encode2(string) : string;
    });
  };
  var punycode = {
    version: "2.3.1",
    ucs2: {
      decode: ucs2decode,
      encode: ucs2encode
    },
    decode: decode2,
    encode: encode2,
    toASCII,
    toUnicode
  };
  var punycode_es6_default = punycode;

  // node_modules/markdown-it/lib/presets/default.mjs
  var default_default = {
    options: {
      html: false,
      xhtmlOut: false,
      breaks: false,
      langPrefix: "language-",
      linkify: false,
      typographer: false,
      quotes: "“”‘’",
      highlight: null,
      maxNesting: 100
    },
    components: {
      core: {},
      block: {},
      inline: {}
    }
  };

  // node_modules/markdown-it/lib/presets/zero.mjs
  var zero_default = {
    options: {
      html: false,
      xhtmlOut: false,
      breaks: false,
      langPrefix: "language-",
      linkify: false,
      typographer: false,
      quotes: "“”‘’",
      highlight: null,
      maxNesting: 20
    },
    components: {
      core: {
        rules: [
          "normalize",
          "block",
          "inline",
          "text_join"
        ]
      },
      block: {
        rules: [
          "paragraph"
        ]
      },
      inline: {
        rules: [
          "text"
        ],
        rules2: [
          "balance_pairs",
          "fragments_join"
        ]
      }
    }
  };

  // node_modules/markdown-it/lib/presets/commonmark.mjs
  var commonmark_default = {
    options: {
      html: true,
      xhtmlOut: true,
      breaks: false,
      langPrefix: "language-",
      linkify: false,
      typographer: false,
      quotes: "“”‘’",
      highlight: null,
      maxNesting: 20
    },
    components: {
      core: {
        rules: [
          "normalize",
          "block",
          "inline",
          "text_join"
        ]
      },
      block: {
        rules: [
          "blockquote",
          "code",
          "fence",
          "heading",
          "hr",
          "html_block",
          "lheading",
          "list",
          "reference",
          "paragraph"
        ]
      },
      inline: {
        rules: [
          "autolink",
          "backticks",
          "emphasis",
          "entity",
          "escape",
          "html_inline",
          "image",
          "link",
          "newline",
          "text"
        ],
        rules2: [
          "balance_pairs",
          "emphasis",
          "fragments_join"
        ]
      }
    }
  };

  // node_modules/markdown-it/lib/index.mjs
  var config = {
    default: default_default,
    zero: zero_default,
    commonmark: commonmark_default
  };
  var BAD_PROTO_RE = /^(vbscript|javascript|file|data):/;
  var GOOD_DATA_RE = /^data:image\/(gif|png|jpeg|webp);/;
  function validateLink(url) {
    const str = url.trim().toLowerCase();
    return BAD_PROTO_RE.test(str) ? GOOD_DATA_RE.test(str) : true;
  }
  var RECODE_HOSTNAME_FOR = ["http:", "https:", "mailto:"];
  function normalizeLink(url) {
    const parsed = parse_default(url, true);
    if (parsed.hostname) {
      if (!parsed.protocol || RECODE_HOSTNAME_FOR.indexOf(parsed.protocol) >= 0) {
        try {
          parsed.hostname = punycode_es6_default.toASCII(parsed.hostname);
        } catch (er) {}
      }
    }
    return encode_default(format(parsed));
  }
  function normalizeLinkText(url) {
    const parsed = parse_default(url, true);
    if (parsed.hostname) {
      if (!parsed.protocol || RECODE_HOSTNAME_FOR.indexOf(parsed.protocol) >= 0) {
        try {
          parsed.hostname = punycode_es6_default.toUnicode(parsed.hostname);
        } catch (er) {}
      }
    }
    return decode_default(format(parsed), decode_default.defaultChars + "%");
  }
  function MarkdownIt(presetName, options) {
    if (!(this instanceof MarkdownIt)) {
      return new MarkdownIt(presetName, options);
    }
    if (!options) {
      if (!isString(presetName)) {
        options = presetName || {};
        presetName = "default";
      }
    }
    this.inline = new parser_inline_default;
    this.block = new parser_block_default;
    this.core = new parser_core_default;
    this.renderer = new renderer_default;
    this.linkify = new linkify_it_default;
    this.validateLink = validateLink;
    this.normalizeLink = normalizeLink;
    this.normalizeLinkText = normalizeLinkText;
    this.utils = exports_utils;
    this.helpers = assign({}, exports_helpers);
    this.options = {};
    this.configure(presetName);
    if (options) {
      this.set(options);
    }
  }
  MarkdownIt.prototype.set = function(options) {
    assign(this.options, options);
    return this;
  };
  MarkdownIt.prototype.configure = function(presets) {
    const self = this;
    if (isString(presets)) {
      const presetName = presets;
      presets = config[presetName];
      if (!presets) {
        throw new Error('Wrong `markdown-it` preset "' + presetName + '", check name');
      }
    }
    if (!presets) {
      throw new Error("Wrong `markdown-it` preset, can't be empty");
    }
    if (presets.options) {
      self.set(presets.options);
    }
    if (presets.components) {
      Object.keys(presets.components).forEach(function(name) {
        if (presets.components[name].rules) {
          self[name].ruler.enableOnly(presets.components[name].rules);
        }
        if (presets.components[name].rules2) {
          self[name].ruler2.enableOnly(presets.components[name].rules2);
        }
      });
    }
    return this;
  };
  MarkdownIt.prototype.enable = function(list2, ignoreInvalid) {
    let result = [];
    if (!Array.isArray(list2)) {
      list2 = [list2];
    }
    ["core", "block", "inline"].forEach(function(chain) {
      result = result.concat(this[chain].ruler.enable(list2, true));
    }, this);
    result = result.concat(this.inline.ruler2.enable(list2, true));
    const missed = list2.filter(function(name) {
      return result.indexOf(name) < 0;
    });
    if (missed.length && !ignoreInvalid) {
      throw new Error("MarkdownIt. Failed to enable unknown rule(s): " + missed);
    }
    return this;
  };
  MarkdownIt.prototype.disable = function(list2, ignoreInvalid) {
    let result = [];
    if (!Array.isArray(list2)) {
      list2 = [list2];
    }
    ["core", "block", "inline"].forEach(function(chain) {
      result = result.concat(this[chain].ruler.disable(list2, true));
    }, this);
    result = result.concat(this.inline.ruler2.disable(list2, true));
    const missed = list2.filter(function(name) {
      return result.indexOf(name) < 0;
    });
    if (missed.length && !ignoreInvalid) {
      throw new Error("MarkdownIt. Failed to disable unknown rule(s): " + missed);
    }
    return this;
  };
  MarkdownIt.prototype.use = function(plugin) {
    const args = [this].concat(Array.prototype.slice.call(arguments, 1));
    plugin.apply(plugin, args);
    return this;
  };
  MarkdownIt.prototype.parse = function(src, env) {
    if (typeof src !== "string") {
      throw new Error("Input data should be a String");
    }
    const state = new this.core.State(src, this, env);
    this.core.process(state);
    return state.tokens;
  };
  MarkdownIt.prototype.render = function(src, env) {
    env = env || {};
    return this.renderer.render(this.parse(src, env), this.options, env);
  };
  MarkdownIt.prototype.parseInline = function(src, env) {
    const state = new this.core.State(src, this, env);
    state.inlineMode = true;
    this.core.process(state);
    return state.tokens;
  };
  MarkdownIt.prototype.renderInline = function(src, env) {
    env = env || {};
    return this.renderer.render(this.parseInline(src, env), this.options, env);
  };
  var lib_default = MarkdownIt;
  // node_modules/markdown-it-anchor/dist/markdownItAnchor.mjs
  var e = false;
  var n = { false: "push", true: "unshift", after: "push", before: "unshift" };
  var t = { isPermalinkSymbol: true };
  function r(r2, a, i, l) {
    var o;
    if (!e) {
      var c = "Using deprecated markdown-it-anchor permalink option, see https://github.com/valeriangalliat/markdown-it-anchor#permalinks";
      typeof process == "object" && process && process.emitWarning ? process.emitWarning(c) : console.warn(c), e = true;
    }
    var s = [Object.assign(new i.Token("link_open", "a", 1), { attrs: [].concat(a.permalinkClass ? [["class", a.permalinkClass]] : [], [["href", a.permalinkHref(r2, i)]], Object.entries(a.permalinkAttrs(r2, i))) }), Object.assign(new i.Token("html_block", "", 0), { content: a.permalinkSymbol, meta: t }), new i.Token("link_close", "a", -1)];
    a.permalinkSpace && i.tokens[l + 1].children[n[a.permalinkBefore]](Object.assign(new i.Token("text", "", 0), { content: " " })), (o = i.tokens[l + 1].children)[n[a.permalinkBefore]].apply(o, s);
  }
  function a(e2) {
    return "#" + e2;
  }
  function i(e2) {
    return {};
  }
  var l = { class: "header-anchor", symbol: "#", renderHref: a, renderAttrs: i };
  function o(e2) {
    function n2(t2) {
      return t2 = Object.assign({}, n2.defaults, t2), function(n3, r2, a2, i2) {
        return e2(n3, t2, r2, a2, i2);
      };
    }
    return n2.defaults = Object.assign({}, l), n2.renderPermalinkImpl = e2, n2;
  }
  function c(e2) {
    var n2 = [], t2 = e2.filter(function(e3) {
      if (e3[0] !== "class")
        return true;
      n2.push(e3[1]);
    });
    return n2.length > 0 && t2.unshift(["class", n2.join(" ")]), t2;
  }
  var s = o(function(e2, r2, a2, i2, l2) {
    var o2, s2 = [Object.assign(new i2.Token("link_open", "a", 1), { attrs: c([].concat(r2.class ? [["class", r2.class]] : [], [["href", r2.renderHref(e2, i2)]], r2.ariaHidden ? [["aria-hidden", "true"]] : [], Object.entries(r2.renderAttrs(e2, i2)))) }), Object.assign(new i2.Token("html_inline", "", 0), { content: r2.symbol, meta: t }), new i2.Token("link_close", "a", -1)];
    if (r2.space) {
      var u = typeof r2.space == "string" ? r2.space : " ";
      i2.tokens[l2 + 1].children[n[r2.placement]](Object.assign(new i2.Token(typeof r2.space == "string" ? "html_inline" : "text", "", 0), { content: u }));
    }
    (o2 = i2.tokens[l2 + 1].children)[n[r2.placement]].apply(o2, s2);
  });
  Object.assign(s.defaults, { space: true, placement: "after", ariaHidden: false });
  var u = o(s.renderPermalinkImpl);
  u.defaults = Object.assign({}, s.defaults, { ariaHidden: true });
  var d = o(function(e2, n2, t2, r2, a2) {
    var i2 = [Object.assign(new r2.Token("link_open", "a", 1), { attrs: c([].concat(n2.class ? [["class", n2.class]] : [], [["href", n2.renderHref(e2, r2)]], Object.entries(n2.renderAttrs(e2, r2)))) })].concat(n2.safariReaderFix ? [new r2.Token("span_open", "span", 1)] : [], r2.tokens[a2 + 1].children, n2.safariReaderFix ? [new r2.Token("span_close", "span", -1)] : [], [new r2.Token("link_close", "a", -1)]);
    r2.tokens[a2 + 1] = Object.assign(new r2.Token("inline", "", 0), { children: i2 });
  });
  Object.assign(d.defaults, { safariReaderFix: false });
  var f = o(function(e2, r2, a2, i2, l2) {
    var o2;
    if (!["visually-hidden", "aria-label", "aria-describedby", "aria-labelledby"].includes(r2.style))
      throw new Error("`permalink.linkAfterHeader` called with unknown style option `" + r2.style + "`");
    if (!["aria-describedby", "aria-labelledby"].includes(r2.style) && !r2.assistiveText)
      throw new Error("`permalink.linkAfterHeader` called without the `assistiveText` option in `" + r2.style + "` style");
    if (r2.style === "visually-hidden" && !r2.visuallyHiddenClass)
      throw new Error("`permalink.linkAfterHeader` called without the `visuallyHiddenClass` option in `visually-hidden` style");
    var s2 = i2.tokens[l2 + 1].children.filter(function(e3) {
      return e3.type === "text" || e3.type === "code_inline";
    }).reduce(function(e3, n2) {
      return e3 + n2.content;
    }, ""), u2 = [], d2 = [];
    if (r2.class && d2.push(["class", r2.class]), d2.push(["href", r2.renderHref(e2, i2)]), d2.push.apply(d2, Object.entries(r2.renderAttrs(e2, i2))), r2.style === "visually-hidden") {
      if (u2.push(Object.assign(new i2.Token("span_open", "span", 1), { attrs: [["class", r2.visuallyHiddenClass]] }), Object.assign(new i2.Token("text", "", 0), { content: r2.assistiveText(s2) }), new i2.Token("span_close", "span", -1)), r2.space) {
        var f2 = typeof r2.space == "string" ? r2.space : " ";
        u2[n[r2.placement]](Object.assign(new i2.Token(typeof r2.space == "string" ? "html_inline" : "text", "", 0), { content: f2 }));
      }
      u2[n[r2.placement]](Object.assign(new i2.Token("span_open", "span", 1), { attrs: [["aria-hidden", "true"]] }), Object.assign(new i2.Token("html_inline", "", 0), { content: r2.symbol, meta: t }), new i2.Token("span_close", "span", -1));
    } else
      u2.push(Object.assign(new i2.Token("html_inline", "", 0), { content: r2.symbol, meta: t }));
    r2.style === "aria-label" ? d2.push(["aria-label", r2.assistiveText(s2)]) : ["aria-describedby", "aria-labelledby"].includes(r2.style) && d2.push([r2.style, e2]);
    var p = [Object.assign(new i2.Token("link_open", "a", 1), { attrs: c(d2) })].concat(u2, [new i2.Token("link_close", "a", -1)]);
    (o2 = i2.tokens).splice.apply(o2, [l2 + 3, 0].concat(p)), r2.wrapper && (i2.tokens.splice(l2, 0, Object.assign(new i2.Token("html_block", "", 0), { content: r2.wrapper[0] + `
` })), i2.tokens.splice(l2 + 3 + p.length + 1, 0, Object.assign(new i2.Token("html_block", "", 0), { content: r2.wrapper[1] + `
` })));
  });
  function p(e2, n2, t2, r2) {
    var a2 = e2, i2 = r2;
    if (t2 && Object.prototype.hasOwnProperty.call(n2, a2))
      throw new Error("User defined `id` attribute `" + e2 + "` is not unique. Please fix it in your Markdown to continue.");
    for (;Object.prototype.hasOwnProperty.call(n2, a2); )
      a2 = e2 + "-" + i2, i2 += 1;
    return n2[a2] = true, a2;
  }
  function b(e2, n2) {
    n2 = Object.assign({}, b.defaults, n2), e2.core.ruler.push("anchor", function(e3) {
      for (var t2, a2 = {}, i2 = e3.tokens, l2 = Array.isArray(n2.level) ? (t2 = n2.level, function(e4) {
        return t2.includes(e4);
      }) : function(e4) {
        return function(n3) {
          return n3 >= e4;
        };
      }(n2.level), o2 = 0;o2 < i2.length; o2++) {
        var c2 = i2[o2];
        if (c2.type === "heading_open" && l2(Number(c2.tag.substr(1)))) {
          var s2 = n2.getTokensText(i2[o2 + 1].children), u2 = c2.attrGet("id");
          u2 = u2 == null ? p(u2 = n2.slugifyWithState ? n2.slugifyWithState(s2, e3) : n2.slugify(s2), a2, false, n2.uniqueSlugStartIndex) : p(u2, a2, true, n2.uniqueSlugStartIndex), c2.attrSet("id", u2), n2.tabIndex !== false && c2.attrSet("tabindex", "" + n2.tabIndex), typeof n2.permalink == "function" ? n2.permalink(u2, n2, e3, o2) : (n2.permalink || n2.renderPermalink && n2.renderPermalink !== r) && n2.renderPermalink(u2, n2, e3, o2), o2 = i2.indexOf(c2), n2.callback && n2.callback(c2, { slug: u2, title: s2 });
        }
      }
    });
  }
  Object.assign(f.defaults, { style: "visually-hidden", space: true, placement: "after", wrapper: null }), b.permalink = { __proto__: null, legacy: r, renderHref: a, renderAttrs: i, makePermalink: o, linkInsideHeader: s, ariaHidden: u, headerLink: d, linkAfterHeader: f }, b.defaults = { level: 1, slugify: function(e2) {
    return encodeURIComponent(String(e2).trim().toLowerCase().replace(/\s+/g, "-"));
  }, uniqueSlugStartIndex: 1, tabIndex: "-1", getTokensText: function(e2) {
    return e2.filter(function(e3) {
      return ["text", "code_inline"].includes(e3.type);
    }).map(function(e3) {
      return e3.content;
    }).join("");
  }, permalink: false, renderPermalink: r, permalinkClass: u.defaults.class, permalinkSpace: u.defaults.space, permalinkSymbol: "¶", permalinkBefore: u.defaults.placement === "before", permalinkHref: u.defaults.renderHref, permalinkAttrs: u.defaults.renderAttrs }, b.default = b;

  // node_modules/markdown-it-footnote/index.mjs
  function render_footnote_anchor_name(tokens, idx, options, env) {
    const n2 = Number(tokens[idx].meta.id + 1).toString();
    let prefix = "";
    if (typeof env.docId === "string")
      prefix = `-${env.docId}-`;
    return prefix + n2;
  }
  function render_footnote_caption(tokens, idx) {
    let n2 = Number(tokens[idx].meta.id + 1).toString();
    if (tokens[idx].meta.subId > 0)
      n2 += `:${tokens[idx].meta.subId}`;
    return `[${n2}]`;
  }
  function render_footnote_ref(tokens, idx, options, env, slf) {
    const id = slf.rules.footnote_anchor_name(tokens, idx, options, env, slf);
    const caption = slf.rules.footnote_caption(tokens, idx, options, env, slf);
    let refid = id;
    if (tokens[idx].meta.subId > 0)
      refid += `:${tokens[idx].meta.subId}`;
    return `<sup class="footnote-ref"><a href="#fn${id}" id="fnref${refid}">${caption}</a></sup>`;
  }
  function render_footnote_block_open(tokens, idx, options) {
    return (options.xhtmlOut ? `<hr class="footnotes-sep" />
` : `<hr class="footnotes-sep">
`) + `<section class="footnotes">
` + `<ol class="footnotes-list">
`;
  }
  function render_footnote_block_close() {
    return `</ol>
</section>
`;
  }
  function render_footnote_open(tokens, idx, options, env, slf) {
    let id = slf.rules.footnote_anchor_name(tokens, idx, options, env, slf);
    if (tokens[idx].meta.subId > 0)
      id += `:${tokens[idx].meta.subId}`;
    return `<li id="fn${id}" class="footnote-item">`;
  }
  function render_footnote_close() {
    return `</li>
`;
  }
  function render_footnote_anchor(tokens, idx, options, env, slf) {
    let id = slf.rules.footnote_anchor_name(tokens, idx, options, env, slf);
    if (tokens[idx].meta.subId > 0)
      id += `:${tokens[idx].meta.subId}`;
    return ` <a href="#fnref${id}" class="footnote-backref">↩︎</a>`;
  }
  function footnote_plugin(md) {
    const parseLinkLabel2 = md.helpers.parseLinkLabel;
    const isSpace2 = md.utils.isSpace;
    md.renderer.rules.footnote_ref = render_footnote_ref;
    md.renderer.rules.footnote_block_open = render_footnote_block_open;
    md.renderer.rules.footnote_block_close = render_footnote_block_close;
    md.renderer.rules.footnote_open = render_footnote_open;
    md.renderer.rules.footnote_close = render_footnote_close;
    md.renderer.rules.footnote_anchor = render_footnote_anchor;
    md.renderer.rules.footnote_caption = render_footnote_caption;
    md.renderer.rules.footnote_anchor_name = render_footnote_anchor_name;
    function footnote_def(state, startLine, endLine, silent) {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      if (start + 4 > max)
        return false;
      if (state.src.charCodeAt(start) !== 91)
        return false;
      if (state.src.charCodeAt(start + 1) !== 94)
        return false;
      let pos;
      for (pos = start + 2;pos < max; pos++) {
        if (state.src.charCodeAt(pos) === 32)
          return false;
        if (state.src.charCodeAt(pos) === 93) {
          break;
        }
      }
      if (pos === start + 2)
        return false;
      if (pos + 1 >= max || state.src.charCodeAt(++pos) !== 58)
        return false;
      if (silent)
        return true;
      pos++;
      if (!state.env.footnotes)
        state.env.footnotes = {};
      if (!state.env.footnotes.refs)
        state.env.footnotes.refs = {};
      const label = state.src.slice(start + 2, pos - 2);
      state.env.footnotes.refs[`:${label}`] = -1;
      const token_fref_o = new state.Token("footnote_reference_open", "", 1);
      token_fref_o.meta = { label };
      token_fref_o.level = state.level++;
      state.tokens.push(token_fref_o);
      const oldBMark = state.bMarks[startLine];
      const oldTShift = state.tShift[startLine];
      const oldSCount = state.sCount[startLine];
      const oldParentType = state.parentType;
      const posAfterColon = pos;
      const initial = state.sCount[startLine] + pos - (state.bMarks[startLine] + state.tShift[startLine]);
      let offset = initial;
      while (pos < max) {
        const ch = state.src.charCodeAt(pos);
        if (isSpace2(ch)) {
          if (ch === 9) {
            offset += 4 - offset % 4;
          } else {
            offset++;
          }
        } else {
          break;
        }
        pos++;
      }
      state.tShift[startLine] = pos - posAfterColon;
      state.sCount[startLine] = offset - initial;
      state.bMarks[startLine] = posAfterColon;
      state.blkIndent += 4;
      state.parentType = "footnote";
      if (state.sCount[startLine] < state.blkIndent) {
        state.sCount[startLine] += state.blkIndent;
      }
      state.md.block.tokenize(state, startLine, endLine, true);
      state.parentType = oldParentType;
      state.blkIndent -= 4;
      state.tShift[startLine] = oldTShift;
      state.sCount[startLine] = oldSCount;
      state.bMarks[startLine] = oldBMark;
      const token_fref_c = new state.Token("footnote_reference_close", "", -1);
      token_fref_c.level = --state.level;
      state.tokens.push(token_fref_c);
      return true;
    }
    function footnote_inline(state, silent) {
      const max = state.posMax;
      const start = state.pos;
      if (start + 2 >= max)
        return false;
      if (state.src.charCodeAt(start) !== 94)
        return false;
      if (state.src.charCodeAt(start + 1) !== 91)
        return false;
      const labelStart = start + 2;
      const labelEnd = parseLinkLabel2(state, start + 1);
      if (labelEnd < 0)
        return false;
      if (!silent) {
        if (!state.env.footnotes)
          state.env.footnotes = {};
        if (!state.env.footnotes.list)
          state.env.footnotes.list = [];
        const footnoteId = state.env.footnotes.list.length;
        const tokens = [];
        state.md.inline.parse(state.src.slice(labelStart, labelEnd), state.md, state.env, tokens);
        const token = state.push("footnote_ref", "", 0);
        token.meta = { id: footnoteId };
        state.env.footnotes.list[footnoteId] = {
          content: state.src.slice(labelStart, labelEnd),
          tokens
        };
      }
      state.pos = labelEnd + 1;
      state.posMax = max;
      return true;
    }
    function footnote_ref(state, silent) {
      const max = state.posMax;
      const start = state.pos;
      if (start + 3 > max)
        return false;
      if (!state.env.footnotes || !state.env.footnotes.refs)
        return false;
      if (state.src.charCodeAt(start) !== 91)
        return false;
      if (state.src.charCodeAt(start + 1) !== 94)
        return false;
      let pos;
      for (pos = start + 2;pos < max; pos++) {
        if (state.src.charCodeAt(pos) === 32)
          return false;
        if (state.src.charCodeAt(pos) === 10)
          return false;
        if (state.src.charCodeAt(pos) === 93) {
          break;
        }
      }
      if (pos === start + 2)
        return false;
      if (pos >= max)
        return false;
      pos++;
      const label = state.src.slice(start + 2, pos - 1);
      if (typeof state.env.footnotes.refs[`:${label}`] === "undefined")
        return false;
      if (!silent) {
        if (!state.env.footnotes.list)
          state.env.footnotes.list = [];
        let footnoteId;
        if (state.env.footnotes.refs[`:${label}`] < 0) {
          footnoteId = state.env.footnotes.list.length;
          state.env.footnotes.list[footnoteId] = { label, count: 0 };
          state.env.footnotes.refs[`:${label}`] = footnoteId;
        } else {
          footnoteId = state.env.footnotes.refs[`:${label}`];
        }
        const footnoteSubId = state.env.footnotes.list[footnoteId].count;
        state.env.footnotes.list[footnoteId].count++;
        const token = state.push("footnote_ref", "", 0);
        token.meta = { id: footnoteId, subId: footnoteSubId, label };
      }
      state.pos = pos;
      state.posMax = max;
      return true;
    }
    function footnote_tail(state) {
      let tokens;
      let current;
      let currentLabel;
      let insideRef = false;
      const refTokens = {};
      if (!state.env.footnotes) {
        return;
      }
      state.tokens = state.tokens.filter(function(tok) {
        if (tok.type === "footnote_reference_open") {
          insideRef = true;
          current = [];
          currentLabel = tok.meta.label;
          return false;
        }
        if (tok.type === "footnote_reference_close") {
          insideRef = false;
          refTokens[":" + currentLabel] = current;
          return false;
        }
        if (insideRef) {
          current.push(tok);
        }
        return !insideRef;
      });
      if (!state.env.footnotes.list) {
        return;
      }
      const list2 = state.env.footnotes.list;
      state.tokens.push(new state.Token("footnote_block_open", "", 1));
      for (let i2 = 0, l2 = list2.length;i2 < l2; i2++) {
        const token_fo = new state.Token("footnote_open", "", 1);
        token_fo.meta = { id: i2, label: list2[i2].label };
        state.tokens.push(token_fo);
        if (list2[i2].tokens) {
          tokens = [];
          const token_po = new state.Token("paragraph_open", "p", 1);
          token_po.block = true;
          tokens.push(token_po);
          const token_i = new state.Token("inline", "", 0);
          token_i.children = list2[i2].tokens;
          token_i.content = list2[i2].content;
          tokens.push(token_i);
          const token_pc = new state.Token("paragraph_close", "p", -1);
          token_pc.block = true;
          tokens.push(token_pc);
        } else if (list2[i2].label) {
          tokens = refTokens[`:${list2[i2].label}`];
        }
        if (tokens)
          state.tokens = state.tokens.concat(tokens);
        let lastParagraph;
        if (state.tokens[state.tokens.length - 1].type === "paragraph_close") {
          lastParagraph = state.tokens.pop();
        } else {
          lastParagraph = null;
        }
        const t2 = list2[i2].count > 0 ? list2[i2].count : 1;
        for (let j = 0;j < t2; j++) {
          const token_a = new state.Token("footnote_anchor", "", 0);
          token_a.meta = { id: i2, subId: j, label: list2[i2].label };
          state.tokens.push(token_a);
        }
        if (lastParagraph) {
          state.tokens.push(lastParagraph);
        }
        state.tokens.push(new state.Token("footnote_close", "", -1));
      }
      state.tokens.push(new state.Token("footnote_block_close", "", -1));
    }
    md.block.ruler.before("reference", "footnote_def", footnote_def, { alt: ["paragraph", "reference"] });
    md.inline.ruler.after("image", "footnote_inline", footnote_inline);
    md.inline.ruler.after("footnote_inline", "footnote_ref", footnote_ref);
    md.core.ruler.after("inline", "footnote_tail", footnote_tail);
  }

  // web-src/markdown-preview.ts
  var mermaidPromise = null;
  var mermaidInitialized = false;
  var shikiPromise = null;
  var MARKDOWN_FENCE_LANG_ALIASES = {
    sh: "bash",
    zsh: "bash",
    shell: "bash",
    shellscript: "bash",
    console: "bash",
    "shell-session": "bash",
    yml: "yaml",
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    text: "plaintext",
    txt: "plaintext"
  };
  var MARKDOWN_SHIKI_LANGS = Array.from(new Set([
    "astro",
    "bash",
    "c",
    "cpp",
    "csharp",
    "css",
    "dockerfile",
    "go",
    "graphql",
    "html",
    "java",
    "javascript",
    "json",
    "jsonc",
    "jsx",
    "kotlin",
    "lua",
    "markdown",
    "php",
    "plaintext",
    "python",
    "ruby",
    "rust",
    "scss",
    "shell",
    "sql",
    "svelte",
    "swift",
    "toml",
    "tsx",
    "typescript",
    "vue",
    "xml",
    "yaml"
  ]));
  function markdownSlugify(text2) {
    return text2.trim().toLowerCase().replace(/[\s　]+/g, "-").replace(/[^\p{L}\p{N}\-_]/gu, "").slice(0, 80) || "section";
  }
  function resolveMarkdownRelativePath(currentPath, href) {
    if (!href || href.startsWith("#"))
      return null;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href))
      return null;
    const cleanHref = href.replace(/[?#].*$/, "");
    if (!/\.(md|markdown|mdown|mkd|mkdn|mdx)$/i.test(cleanHref))
      return null;
    return resolveRepoRelative(currentPath, decodeURIComponent(cleanHref));
  }
  function resolveMarkdownAssetPath(currentPath, src) {
    if (!src || src.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src))
      return null;
    const cleanSrc = src.split(/[?#]/, 1)[0];
    return resolveRepoRelative(currentPath, cleanSrc);
  }
  function resolveRepoRelative(currentPath, requestedPath) {
    const base2 = currentPath.split("/").slice(0, -1);
    const parts = [...requestedPath.startsWith("/") ? [] : base2, ...requestedPath.split("/")].filter((part) => part && part !== ".");
    const resolved = [];
    for (const part of parts) {
      if (part === "..") {
        if (!resolved.length)
          return null;
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }
    return resolved.join("/");
  }
  function createMarkdownIt(target, highlighter, signal) {
    const md = new lib_default({
      html: false,
      linkify: true,
      typographer: true,
      highlight(code2, lang) {
        const rawLanguage = (lang || "").trim().toLowerCase();
        const language = MARKDOWN_FENCE_LANG_ALIASES[rawLanguage] || rawLanguage;
        if (!signal?.aborted && highlighter && language && MARKDOWN_SHIKI_LANGS.includes(language)) {
          try {
            return highlighter.codeToHtml(code2, {
              lang: language,
              themes: { light: "github-light", dark: "github-dark" },
              defaultColor: false
            });
          } catch {}
        }
        return "<pre><code>" + md.utils.escapeHtml(code2) + "</code></pre>";
      }
    });
    md.use(b, {
      level: [1, 2, 3, 4, 5, 6],
      slugify: markdownSlugify,
      permalink: b.permalink.linkInsideHeader({
        class: "anchor",
        symbol: "#",
        placement: "after",
        ariaHidden: true
      })
    });
    md.use(footnote_plugin);
    md.core.ruler.after("inline", "gdp_task_lists", (state) => {
      for (let i2 = 0;i2 < state.tokens.length; i2++) {
        const token = state.tokens[i2];
        if (token.type !== "inline" || !token.children?.length)
          continue;
        const first = token.children[0];
        if (first.type !== "text")
          continue;
        const match2 = first.content.match(/^\[([ xX])\]\s+/);
        if (!match2)
          continue;
        first.content = first.content.slice(match2[0].length);
        for (let j = i2 - 1;j >= 0; j--) {
          if (state.tokens[j].type === "list_item_open") {
            state.tokens[j].attrSet("data-gdp-task", match2[1].trim() ? "checked" : "unchecked");
            break;
          }
        }
      }
    });
    const fence2 = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const info = token.info.trim().split(/\s+/)[0].toLowerCase();
      if (info === "mermaid") {
        return '<div class="mermaid" data-gdp-mermaid-source="' + md.utils.escapeHtml(token.content) + '">' + md.utils.escapeHtml(token.content) + "</div>";
      }
      return fence2 ? fence2(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    };
    const image2 = md.renderer.rules.image || defaultRenderToken;
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const src = token.attrGet("src") || "";
      const resolved = resolveMarkdownAssetPath(target.path, src);
      if (resolved)
        token.attrSet("src", buildRawFileUrl({ path: resolved, ref: target.ref || "worktree" }));
      token.attrSet("loading", "lazy");
      return image2(tokens, idx, options, env, self);
    };
    const linkOpen = md.renderer.rules.link_open || defaultRenderToken;
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const href = token.attrGet("href") || "";
      const mdPath = resolveMarkdownRelativePath(target.path, href);
      if (mdPath) {
        token.attrSet("href", "#");
        token.attrSet("data-gdp-md-link", mdPath);
        token.attrSet("data-gdp-md-ref", target.ref || "worktree");
      } else if (/^(?:https?:)?\/\//i.test(href)) {
        token.attrSet("target", "_blank");
        token.attrSet("rel", "noopener noreferrer");
      }
      return linkOpen(tokens, idx, options, env, self);
    };
    return md;
  }
  function defaultRenderToken(tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  }
  async function renderMarkdownPreview(textValue, target, options) {
    const highlighter = options.syntaxHighlight && !options.signal?.aborted ? await loadMarkdownHighlighter() : null;
    const markdown = document.createElement("div");
    markdown.className = "gdp-markdown-preview markdown-body";
    if (options.signal?.aborted)
      return markdown;
    markdown.innerHTML = renderMarkdownHtml(textValue, target, highlighter, options.signal);
    if (options.signal?.aborted)
      return markdown;
    enhanceTaskLists(markdown);
    const tocEntries = buildMarkdownToc(markdown);
    if (tocEntries.length) {
      const layout = document.createElement("div");
      layout.className = "gdp-markdown-layout";
      layout.appendChild(createMarkdownToc(tocEntries));
      layout.appendChild(markdown);
      wireMarkdownInteractions(layout, target, options);
      return layout;
    }
    wireMarkdownInteractions(markdown, target, options);
    return markdown;
  }
  function renderMarkdownHtml(textValue, target, highlighter, signal) {
    return createMarkdownIt(target, highlighter, signal).render(textValue);
  }
  async function loadMarkdownHighlighter() {
    if (!shikiPromise) {
      shikiPromise = import("/shiki.js").then((mod) => {
        const typed = mod;
        return typed.createHighlighter({
          themes: ["github-light", "github-dark"],
          langs: MARKDOWN_SHIKI_LANGS
        });
      }).catch(() => null);
    }
    return shikiPromise;
  }
  function enhanceTaskLists(root) {
    root.querySelectorAll("[data-gdp-task]").forEach((inline2) => {
      const li = inline2.closest("li");
      if (!li)
        return;
      li.classList.add("task-list-item");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.disabled = true;
      input.checked = inline2.dataset.gdpTask === "checked";
      li.prepend(input);
      inline2.removeAttribute("data-gdp-task");
    });
  }
  function buildMarkdownToc(root) {
    const entries = Array.from(root.querySelectorAll("h1[id], h2[id], h3[id]")).map((heading2) => ({
      id: heading2.id,
      level: Number(heading2.tagName.slice(1)),
      text: (heading2.textContent || "").replace(/#$/, "").trim()
    })).filter((entry) => entry.id && entry.text);
    return entries;
  }
  function createMarkdownToc(entries) {
    const nav = document.createElement("nav");
    nav.className = "gdp-markdown-toc table-of-contents";
    nav.setAttribute("aria-label", "Markdown contents");
    const list2 = document.createElement("ul");
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "level-" + entry.level;
      const link2 = document.createElement("a");
      link2.href = "#" + encodeURIComponent(entry.id);
      link2.dataset.target = entry.id;
      link2.textContent = entry.text;
      item.appendChild(link2);
      list2.appendChild(item);
    });
    nav.appendChild(list2);
    return nav;
  }
  function wireMarkdownInteractions(root, target, options) {
    root.addEventListener("click", (e2) => {
      const link2 = e2.target?.closest("a[data-gdp-md-link]");
      if (!link2)
        return;
      const path = link2.dataset.gdpMdLink;
      const ref = link2.dataset.gdpMdRef || target.ref;
      if (!path)
        return;
      e2.preventDefault();
      options.onNavigateMarkdown?.(path, ref);
    });
    setupMarkdownScrollSpy(root);
    setupMermaidLightbox(root);
    renderMermaidDiagrams(root);
  }
  function setupMarkdownScrollSpy(root) {
    const toc = root.querySelector(".gdp-markdown-toc");
    if (!toc)
      return;
    const entries = Array.from(toc.querySelectorAll("a[data-target]")).map((link2) => ({ link: link2, target: root.querySelector("#" + CSS.escape(link2.dataset.target || "")) })).filter((entry) => !!entry.target);
    if (!entries.length)
      return;
    toc.addEventListener("click", (e2) => {
      const link2 = e2.target?.closest("a[data-target]");
      if (!link2)
        return;
      const section = root.querySelector("#" + CSS.escape(link2.dataset.target || ""));
      if (!section)
        return;
      e2.preventDefault();
      section.scrollIntoView({ block: "start", behavior: "smooth" });
      history.replaceState(history.state, "", "#" + encodeURIComponent(section.id));
    });
    const controller = new AbortController;
    const scrollRoot = document.scrollingElement || document.documentElement;
    let raf = 0;
    const cleanup = () => {
      controller.abort();
      if (raf)
        cancelAnimationFrame(raf);
    };
    const update = () => {
      raf = 0;
      if (!root.isConnected) {
        cleanup();
        return;
      }
      let active = entries[0];
      for (const entry of entries) {
        if (entry.target.getBoundingClientRect().top <= 96)
          active = entry;
        else
          break;
      }
      if (window.innerHeight + scrollRoot.scrollTop >= scrollRoot.scrollHeight - 4) {
        active = entries[entries.length - 1];
      }
      entries.forEach((entry) => entry.link.classList.toggle("active", entry === active));
      keepTocLinkVisible(toc, active.link);
    };
    const schedule = () => {
      if (!raf)
        raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true, signal: controller.signal });
    window.addEventListener("resize", schedule, { signal: controller.signal });
    setTimeout(() => {
      if (!root.isConnected)
        return;
      update();
    }, 0);
  }
  function keepTocLinkVisible(toc, link2) {
    if (toc.scrollHeight <= toc.clientHeight)
      return;
    const top = link2.offsetTop;
    const bottom = top + link2.offsetHeight;
    if (top < toc.scrollTop)
      toc.scrollTop = Math.max(0, top - 8);
    else if (bottom > toc.scrollTop + toc.clientHeight)
      toc.scrollTop = bottom - toc.clientHeight + 8;
  }
  function setupMermaidLightbox(root) {
    root.addEventListener("click", (e2) => {
      const mermaid = e2.target?.closest(".markdown-body .mermaid");
      if (!mermaid || e2.target?.closest("a"))
        return;
      const svg = mermaid.querySelector("svg");
      if (!svg)
        return;
      e2.preventDefault();
      openMermaidLightbox(svg);
    });
  }
  async function renderMermaidDiagrams(root) {
    const nodes = Array.from(root.querySelectorAll(".markdown-body .mermaid"));
    if (!nodes.length)
      return;
    const mermaid = await loadMermaid();
    if (!mermaid)
      return;
    try {
      await mermaid.run({ nodes, suppressErrors: true });
    } catch {}
    for (const node of nodes) {
      if (node.querySelector("svg") && !isMermaidErrorSvg(node.querySelector("svg")))
        continue;
      await renderMermaidError(node, mermaid);
    }
  }
  async function loadMermaid() {
    if (!mermaidPromise) {
      mermaidPromise = import("/mermaid.js").then((mod) => {
        const typed = mod;
        const mermaid = typed.default;
        if (!mermaidInitialized) {
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
          mermaidInitialized = true;
        }
        return mermaid;
      }).catch(() => null);
    }
    return mermaidPromise;
  }
  function isMermaidErrorSvg(svg) {
    return !!svg && /Syntax error/i.test(svg.textContent || "");
  }
  async function renderMermaidError(node, mermaid) {
    const src = node.dataset.gdpMermaidSource || node.textContent || "";
    let detail = "";
    if (src && mermaid.parse) {
      try {
        await mermaid.parse(src);
        detail = "Mermaid could not render this diagram.";
      } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
      }
    }
    const wrap = document.createElement("div");
    wrap.className = "mkdp-mermaid-error";
    const title = document.createElement("div");
    title.className = "mkdp-mermaid-error-title";
    title.textContent = "Mermaid syntax error";
    const pre = document.createElement("pre");
    pre.className = "mkdp-mermaid-error-detail";
    pre.textContent = detail || "No detail available.";
    wrap.append(title, pre);
    if (src) {
      const details = document.createElement("details");
      details.className = "mkdp-mermaid-error-srcwrap";
      const summary = document.createElement("summary");
      summary.textContent = "source";
      const source = document.createElement("pre");
      source.className = "mkdp-mermaid-error-source";
      source.textContent = src;
      details.append(summary, source);
      wrap.appendChild(details);
    }
    node.replaceChildren(wrap);
  }
  function openMermaidLightbox(originalSvg) {
    if (document.querySelector(".mkdp-lightbox"))
      return;
    const overlay = document.createElement("div");
    overlay.className = "mkdp-lightbox";
    const stage = document.createElement("div");
    stage.className = "mkdp-lightbox-stage";
    const svg = originalSvg.cloneNode(true);
    svg.removeAttribute("style");
    stage.appendChild(svg);
    overlay.appendChild(stage);
    const toolbar = document.createElement("div");
    toolbar.className = "mkdp-lightbox-toolbar";
    overlay.appendChild(toolbar);
    const hint = document.createElement("div");
    hint.className = "mkdp-lightbox-hint";
    hint.textContent = "drag to pan · wheel to zoom · double-click to fit · ESC to close";
    overlay.appendChild(hint);
    document.body.appendChild(overlay);
    const bbox = safeSvgBox(svg);
    let scale = 1;
    let tx = 0;
    let ty = 0;
    const apply = () => {
      svg.style.transform = "translate(" + tx + "px, " + ty + "px) scale(" + scale + ")";
    };
    const fit = () => {
      const vw = Math.max(1, window.innerWidth - 128);
      const vh = Math.max(1, window.innerHeight - 128);
      scale = Math.min(vw / bbox.width, vh / bbox.height, 4);
      tx = -scale * bbox.width / 2;
      ty = -scale * bbox.height / 2;
      apply();
    };
    const zoomAt = (mx, my, factor) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const px = (mx - cx - tx) / scale;
      const py = (my - cy - ty) / scale;
      const next = Math.max(0.05, Math.min(40, scale * factor));
      tx = mx - cx - next * px;
      ty = my - cy - next * py;
      scale = next;
      apply();
    };
    const zoomCentered = (factor) => zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor);
    const button = (label, title, fn) => {
      const b2 = document.createElement("button");
      b2.type = "button";
      b2.textContent = label;
      b2.title = title;
      b2.addEventListener("click", (e2) => {
        e2.stopPropagation();
        fn();
      });
      toolbar.appendChild(b2);
    };
    const close = () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("resize", fit);
      overlay.remove();
    };
    button("+", "zoom in", () => zoomCentered(1.25));
    button("-", "zoom out", () => zoomCentered(0.8));
    button("fit", "fit", fit);
    button("x", "close", close);
    overlay.addEventListener("wheel", (e2) => {
      e2.preventDefault();
      zoomAt(e2.clientX, e2.clientY, e2.deltaY < 0 ? 1.12 : 0.8928571428571428);
    }, { passive: false });
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    overlay.addEventListener("mousedown", (e2) => {
      if (e2.target.closest(".mkdp-lightbox-toolbar"))
        return;
      dragging = true;
      lastX = e2.clientX;
      lastY = e2.clientY;
      overlay.classList.add("dragging");
    });
    const onMove = (e2) => {
      if (!dragging)
        return;
      tx += e2.clientX - lastX;
      ty += e2.clientY - lastY;
      lastX = e2.clientX;
      lastY = e2.clientY;
      apply();
    };
    const onUp = () => {
      dragging = false;
      overlay.classList.remove("dragging");
    };
    const onKey = (e2) => {
      if (e2.key === "Escape")
        close();
      else if (e2.key === "0")
        fit();
      else if (e2.key === "+" || e2.key === "=")
        zoomCentered(1.25);
      else if (e2.key === "-")
        zoomCentered(0.8);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", fit);
    overlay.addEventListener("dblclick", (e2) => {
      if (!e2.target.closest(".mkdp-lightbox-toolbar"))
        fit();
    });
    overlay.addEventListener("click", (e2) => {
      if (e2.target === overlay || e2.target === stage)
        close();
    });
    fit();
  }
  function safeSvgBox(svg) {
    try {
      const box = svg.getBBox();
      if (box.width > 0 && box.height > 0) {
        svg.setAttribute("viewBox", box.x + " " + box.y + " " + box.width + " " + box.height);
        svg.setAttribute("width", String(box.width));
        svg.setAttribute("height", String(box.height));
        return { width: box.width, height: box.height };
      }
    } catch {}
    const rect = svg.getBoundingClientRect();
    return { width: rect.width || 800, height: rect.height || 600 };
  }

  // web-src/ws-highlight.ts
  function isWhitespaceOnlyInlineHighlight(text2) {
    return !!text2 && !/\S/.test(text2);
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
    const VIRTUAL_SOURCE_LINE_THRESHOLD = 3000;
    const VIRTUAL_SOURCE_SIZE_THRESHOLD = 1024 * 1024;
    const VIRTUAL_SOURCE_ROW_HEIGHT = 20;
    const VIRTUAL_SOURCE_HIGHLIGHT_MAX_LINE_LENGTH = 2000;
    let highlightLoadPromise = null;
    let sourceShikiLoadPromise = null;
    let highlightConfigured = false;
    let PROJECT_NAME = "";
    let REPO_SIDEBAR_REF = null;
    let REPO_SIDEBAR_LOAD_REF = null;
    let REPO_SIDEBAR_LOAD = null;
    function invalidateRepoSidebar() {
      REPO_SIDEBAR_REF = null;
      REPO_SIDEBAR_LOAD_REF = null;
      REPO_SIDEBAR_LOAD = null;
    }
    function isRepoSidebarReusable(ref) {
      return REPO_SIDEBAR_REF === (ref || "worktree") && isRepositorySidebarMode();
    }
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
    function setStatus(s2) {
      const el = $("#status");
      el.classList.remove("live", "refreshing", "error");
      if (s2)
        el.classList.add(s2);
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
    const SOURCE_SHIKI_LANGS = Array.from(new Set([
      "bash",
      "bibtex",
      "c",
      "clojure",
      "cmake",
      "cpp",
      "csharp",
      "css",
      "dart",
      "diff",
      "dockerfile",
      "elixir",
      "erlang",
      "fortran",
      "go",
      "gradle",
      "graphql",
      "haskell",
      "html",
      "java",
      "javascript",
      "json",
      "julia",
      "kotlin",
      "lua",
      "make",
      "markdown",
      "nix",
      "ocaml",
      "perl",
      "php",
      "properties",
      "protobuf",
      "python",
      "r",
      "rst",
      "ruby",
      "rust",
      "scala",
      "scss",
      "sql",
      "swift",
      "terraform",
      "tex",
      "toml",
      "typescript",
      "vim",
      "vue",
      "xml",
      "yaml"
    ]));
    const SOURCE_SHIKI_LANG_ALIASES = {
      makefile: "make",
      objectivec: "c",
      "objective-c": "c",
      "objective-cpp": "cpp",
      starlark: "python"
    };
    function normalizeSourceShikiLang(lang) {
      if (!lang)
        return null;
      return SOURCE_SHIKI_LANG_ALIASES[lang] || lang;
    }
    function loadSourceShikiHighlighter() {
      if (!sourceShikiLoadPromise) {
        sourceShikiLoadPromise = import("/shiki.js").then((mod) => {
          const typed = mod;
          const langs = typed.bundledLanguages ? SOURCE_SHIKI_LANGS.filter((lang) => !!typed.bundledLanguages?.[lang]) : SOURCE_SHIKI_LANGS;
          return typed.createHighlighter({
            themes: ["github-light", "github-dark"],
            langs
          });
        }).catch(() => null);
      }
      return sourceShikiLoadPromise;
    }
    function sourceShikiLines(textValue, lang, highlighter) {
      try {
        const html = highlighter.codeToHtml(textValue || " ", {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false
        });
        const template = document.createElement("template");
        template.innerHTML = html;
        const renderedLines = Array.from(template.content.querySelectorAll(".line"));
        if (!renderedLines.length)
          return null;
        return renderedLines.map((line) => line.innerHTML || " ");
      } catch {
        return null;
      }
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
      $$("#topbar .seg button").forEach((b2) => {
        b2.classList.toggle("active", b2.dataset.layout === layout);
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
      $$(diffCardSelector(path)).forEach((card) => {
        applyViewedToCard(card, viewed, true);
      });
    }
    function syncViewedCardDisplay(card, viewed) {
      card.classList.toggle("viewed", viewed);
      card.querySelectorAll(".d2h-file-collapse-input").forEach((checkbox) => {
        checkbox.checked = viewed;
      });
    }
    function applyViewedToCard(card, viewed, collapseLoaded = false) {
      syncViewedCardDisplay(card, viewed);
      if (collapseLoaded && card.classList.contains("loaded")) {
        setFileCollapsed(card, viewed);
      }
    }
    function setFolderIcon(el, collapsed) {
      const path = collapsed ? FOLDER_ICON_PATHS.closed : FOLDER_ICON_PATHS.open;
      el.innerHTML = '<svg class="octicon octicon-file-directory-' + (collapsed ? "fill" : "open-fill") + '" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path fill="currentColor" d="' + path + '"></path></svg>';
    }
    function setChevronIcon(el) {
      el.innerHTML = '<svg class="octicon octicon-chevron-down" viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true"><path fill="currentColor" d="' + CHEVRON_DOWN_12_PATH + '"></path></svg>';
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
      for (const f2 of files) {
        const parts = f2.path.split("/");
        let node = root;
        let acc = "";
        const dirPartCount = f2.type === "tree" ? parts.length : parts.length - 1;
        for (let i2 = 0;i2 < dirPartCount; i2++) {
          const p2 = parts[i2];
          acc = acc ? acc + "/" + p2 : p2;
          if (!node.dirs[p2]) {
            node.dirs[p2] = { name: p2, dirs: {}, files: [], path: acc, minOrder: Infinity };
          }
          node = node.dirs[p2];
          if (typeof f2.order === "number" && f2.order < node.minOrder)
            node.minOrder = f2.order;
        }
        if (f2.type === "tree") {
          node.explicit = true;
          if (f2.children_omitted === true)
            node.children_omitted = true;
          continue;
        }
        node.files.push(f2);
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
        const d2 = node.dirs[k];
        items.push({ kind: "dir", sortKey: d2.minOrder, dir: d2 });
      }
      for (const f2 of node.files) {
        items.push({ kind: "file", sortKey: f2.order != null ? f2.order : Infinity, file: f2 });
      }
      items.sort((a2, b2) => a2.sortKey - b2.sortKey);
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
          const toggleDir = (e2) => {
            e2.stopPropagation();
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
            li.addEventListener("click", (e2) => {
              e2.stopPropagation();
              onFileClick({ path: dir.path, display_path: dir.path, type: "tree", children_omitted: dir.children_omitted });
            });
          } else {
            li.addEventListener("click", toggleDir);
          }
          ul.appendChild(li);
          ul.appendChild(childUl);
        } else {
          const f2 = item.file;
          const li = document.createElement("li");
          li.className = "tree-file";
          li.dataset.path = f2.path;
          li.classList.toggle("viewed", !onFileClick && STATE.viewedFiles.has(f2.path));
          li.style.setProperty("--lvl-pad", 12 + depth * 14 + "px");
          const spacer = document.createElement("span");
          spacer.className = "chev-spacer";
          li.appendChild(spacer);
          if (f2.status) {
            li.appendChild(fileBadge(f2.status));
          } else {
            const icon = document.createElement("span");
            icon.className = "d2h-icon-wrapper";
            icon.innerHTML = fileEntryIcon();
            li.appendChild(icon);
          }
          const name = document.createElement("span");
          name.className = "name";
          name.textContent = f2.path.split("/").pop();
          name.title = f2.path;
          li.appendChild(name);
          li.addEventListener("click", () => {
            if (onFileClick)
              onFileClick(f2);
            else
              scrollToFile(f2.path);
          });
          if (!onFileClick)
            li.addEventListener("mouseenter", () => prefetchByPath(f2.path), { passive: true });
          ul.appendChild(li);
        }
      }
    }
    function renderFlat(files, ul, onFileClick) {
      files.forEach((f2, i2) => {
        const li = document.createElement("li");
        li.dataset.index = String(i2);
        li.dataset.path = f2.path;
        li.classList.toggle("viewed", !onFileClick && STATE.viewedFiles.has(f2.path));
        if (f2.status) {
          li.appendChild(fileBadge(f2.status));
        } else {
          const icon = document.createElement("span");
          icon.className = "d2h-icon-wrapper";
          icon.innerHTML = fileEntryIcon();
          li.appendChild(icon);
        }
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = f2.path;
        name.title = f2.path;
        li.appendChild(name);
        li.addEventListener("click", () => {
          if (onFileClick)
            onFileClick(f2);
          else
            scrollToFile(f2.path);
        });
        if (!onFileClick)
          li.addEventListener("mouseenter", () => prefetchByPath(f2.path), { passive: true });
        ul.appendChild(li);
      });
    }
    function renderSidebar(files, onFileClick) {
      const ul = $("#filelist");
      ul.innerHTML = "";
      ul.classList.toggle("tree", STATE.sbView === "tree");
      STATE.files = files;
      if (!onFileClick)
        REPO_SIDEBAR_REF = null;
      if (STATE.sbView === "tree") {
        const root = buildTree(files);
        renderTreeNode(root, 0, ul, onFileClick);
      } else {
        renderFlat(files, ul, onFileClick);
      }
      $("#totals").textContent = files.length ? files.length + " file" + (files.length === 1 ? "" : "s") : "";
      $$(".sb-view-seg button").forEach((b2) => {
        b2.classList.toggle("active", b2.dataset.view === STATE.sbView);
      });
      $$(".sb-tree-action").forEach((b2) => {
        b2.disabled = STATE.sbView !== "tree" || !STATE.files.length;
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
      document.title = (meta.project ? meta.project + " - " : "") + "code viewer";
      el.innerHTML = "";
      if (meta.branch) {
        const b2 = document.createElement("span");
        b2.className = "ref";
        b2.textContent = "⎇ " + meta.branch;
        el.appendChild(b2);
      }
      if (meta.totals) {
        const t2 = document.createElement("span");
        t2.className = "num";
        t2.innerHTML = '<span class="add">+' + meta.totals.additions + "</span> " + '<span class="del">−' + meta.totals.deletions + "</span> <span>" + meta.totals.files + " files</span>";
        el.appendChild(t2);
      }
      const u2 = document.createElement("span");
      u2.className = "updated-at";
      u2.title = "last updated";
      u2.textContent = "updated " + new Date().toLocaleTimeString([], { hour12: false });
      el.appendChild(u2);
    }
    let SUPPRESS_SPY_UNTIL = 0;
    function prefetchByPath(path) {
      const card = document.querySelector(diffCardSelector(path));
      if (!card || !card.classList.contains("pending"))
        return;
      const f2 = STATE.files.find((x) => x.path === path);
      if (!f2)
        return;
      enqueueLoad(f2, card, 5);
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
        const f2 = STATE.files.find((x) => x.path === path);
        if (f2)
          enqueueLoad(f2, card, 10);
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
        li.classList.toggle("viewed", !isRepositorySidebarMode() && STATE.viewedFiles.has(path));
      });
      if (isRepositorySidebarMode())
        return;
      $$(".gdp-file-shell[data-path]").forEach((card) => {
        const path = card.dataset.path || "";
        const viewed = STATE.viewedFiles.has(path);
        syncViewedCardDisplay(card, viewed);
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
        const match2 = matches(li.dataset.path || "");
        li.classList.toggle("hidden", !match2);
      });
      if (!isRepositorySidebarMode()) {
        document.querySelectorAll(".gdp-file-shell").forEach((card) => {
          const match2 = matches(card.dataset.path || "");
          card.classList.toggle("hidden-by-filter", !match2);
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
    let ACTIVE_SOURCE_LOAD = null;
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
      }, (e2) => {
        done();
        throw e2;
      });
    }
    function escapeHtml2(s2) {
      return String(s2 == null ? "" : s2).replace(/[&<>"']/g, (c2) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c2]);
    }
    function sourceTargetsEqual(a2, b2) {
      return !!a2 && !!b2 && a2.path === b2.path && a2.ref === b2.ref;
    }
    function isAbortError(err) {
      return err instanceof DOMException ? err.name === "AbortError" : !!err && typeof err === "object" && ("name" in err) && err.name === "AbortError";
    }
    function finishSourceLoad(req) {
      if (ACTIVE_SOURCE_LOAD?.req === req)
        ACTIVE_SOURCE_LOAD = null;
    }
    function cancelActiveSourceLoad(reason) {
      const active = ACTIVE_SOURCE_LOAD;
      if (!active)
        return false;
      ACTIVE_SOURCE_LOAD = null;
      SOURCE_REQ_SEQ++;
      active.controller.abort();
      if (reason !== "navigation" && sourceTargetsEqual(sourceTargetFromRoute(), active.target)) {
        renderSourceCancelled(active.card, active.target);
      }
      return true;
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
    function setRoute(route, replace2 = false) {
      const nextRoute = route.screen === "unknown" ? { screen: "diff", range: route.range } : route;
      STATE.route = nextRoute;
      STATE.from = nextRoute.range.from;
      STATE.to = nextRoute.range.to;
      if (nextRoute.screen === "repo" || nextRoute.screen === "file" && nextRoute.view === "blob") {
        STATE.repoRef = nextRoute.ref || "worktree";
      }
      const url = buildRoute(nextRoute);
      const state = nextRoute.screen === "file" ? { screen: "file", path: nextRoute.path, ref: nextRoute.ref, view: nextRoute.view || "detail" } : { view: nextRoute.screen };
      if (replace2)
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
      document.querySelectorAll(".app-menu-item").forEach((link2) => {
        const fileRouteOwner = STATE.route.screen === "file" && STATE.route.view === "blob" ? "repo" : "diff";
        const active = link2.dataset.route === STATE.route.screen || STATE.route.screen === "file" && link2.dataset.route === fileRouteOwner;
        link2.classList.toggle("active", active);
        link2.setAttribute("aria-current", active ? "page" : "false");
        if (link2.dataset.route === "repo") {
          link2.href = buildRoute({ screen: "repo", ref: STATE.repoRef || "worktree", path: "", range: currentRange() });
        }
        if (link2.dataset.route === "diff") {
          link2.href = buildRoute({ screen: "diff", range: currentRange() });
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
      document.querySelectorAll(".gdp-file-shell").forEach((c2) => {
        if (c2.dataset.key)
          oldByKey.set(c2.dataset.key, c2);
      });
      const ordered = [];
      newFiles.forEach((f2) => {
        const key = f2.key || f2.path;
        const old = oldByKey.get(key);
        if (old) {
          oldByKey.delete(key);
          const sizeChanged = old.dataset.sizeClass !== (f2.size_class || "small");
          const statusChanged = old.dataset.status !== (f2.status || "M");
          if (sizeChanged || statusChanged) {
            old.classList.remove("loaded", "error");
            old.classList.add("pending");
            old.replaceChildren();
            const tmp = createPlaceholder(f2);
            while (tmp.firstChild)
              old.appendChild(tmp.firstChild);
            old.dataset.sizeClass = f2.size_class || "small";
            old.dataset.status = f2.status || "M";
            delete old.dataset.manualRendered;
            delete old.dataset.manualLoad;
            delete old.dataset.manualMode;
            old.style.minHeight = (f2.estimated_height_px || 80) + "px";
            old._diffData = null;
            old._file = null;
          } else {
            const stats = old.querySelector(".gdp-shell-header .stats");
            if (stats) {
              stats.innerHTML = '<span class="a">+' + (f2.additions || 0) + "</span>" + '<span class="d">−' + (f2.deletions || 0) + "</span>";
            }
            old._file = f2;
          }
          ordered.push(old);
        } else {
          ordered.push(createPlaceholder(f2));
        }
      });
      oldByKey.forEach((c2) => c2.remove());
      target.replaceChildren(...ordered);
      for (let i2 = LOAD_QUEUE.length - 1;i2 >= 0; i2--) {
        if (!LOAD_QUEUE[i2].card.isConnected)
          LOAD_QUEUE.splice(i2, 1);
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
      button.addEventListener("click", (e2) => {
        e2.stopPropagation();
        openPathInOs(path, kind, button);
      });
      return button;
    }
    async function uploadFiles(path, files) {
      const list2 = Array.from(files);
      if (!list2.length)
        return;
      const label = path || PROJECT_NAME || "repository root";
      if (!window.confirm("Upload " + list2.length + " file" + (list2.length === 1 ? "" : "s") + " into " + label + "?"))
        return;
      const form = new FormData;
      form.set("dir", path);
      list2.forEach((file) => form.append("files", file, file.name));
      const res = await fetch("/_upload_files", {
        method: "POST",
        headers: { "X-Code-Viewer-Action": "1" },
        body: form
      });
      if (!res.ok)
        throw new Error(await res.text());
      invalidateRepoSidebar();
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
      input.addEventListener("click", (e2) => {
        e2.stopPropagation();
        openPopover(input);
      });
      input.addEventListener("mousedown", (e2) => {
        if (popover.hidden) {
          e2.preventDefault();
          input.focus();
        }
      });
      input.addEventListener("keydown", (e2) => {
        if (e2.key === "Enter") {
          e2.preventDefault();
          closePopover();
        } else if (e2.key === "Escape") {
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
    async function renderRepo(meta) {
      PROJECT_NAME = meta.project || PROJECT_NAME;
      setPageMode();
      removeStandaloneSource();
      $("#empty").classList.add("hidden");
      $("#diff").replaceChildren();
      if (!isRepoSidebarReusable(meta.ref))
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
      const list2 = document.createElement("div");
      list2.className = "gdp-source-viewer gdp-repo-file-list";
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
        list2.appendChild(row);
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
        list2.appendChild(row);
      });
      if (!meta.entries.length) {
        const empty = document.createElement("div");
        empty.className = "gdp-repo-empty";
        empty.textContent = "No files in this directory.";
        list2.appendChild(empty);
      }
      listWrapper.appendChild(list2);
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
        try {
          wrapper.appendChild(await renderMarkdownPreview(meta.readme.text, { path: meta.readme.path, ref: meta.ref }, {
            syntaxHighlight: STATE.syntaxHighlight,
            onNavigateMarkdown: (path, ref) => {
              setRoute({ screen: "file", path, ref, view: "blob", range: currentRange() });
              renderStandaloneSource({ path, ref });
            }
          }));
        } catch {
          const fallback = document.createElement("pre");
          fallback.className = "gdp-markdown-fallback";
          fallback.textContent = meta.readme.text;
          wrapper.appendChild(fallback);
        }
        readme.appendChild(wrapper);
        shell.appendChild(readme);
      }
      target.appendChild(shell);
    }
    function renderRepoBlobSidebar(currentPath, ref) {
      syncRepoTargetInput(ref);
      const normalizedRef = ref || "worktree";
      if (isRepoSidebarReusable(normalizedRef)) {
        activateRepoSidebarPath(currentPath);
        return Promise.resolve();
      }
      if (REPO_SIDEBAR_LOAD && REPO_SIDEBAR_LOAD_REF === normalizedRef) {
        return REPO_SIDEBAR_LOAD.then(() => {
          activateRepoSidebarPath(currentPath);
        });
      }
      const params = new URLSearchParams;
      params.set("ref", normalizedRef);
      params.set("recursive", "1");
      REPO_SIDEBAR_LOAD_REF = normalizedRef;
      const load2 = trackLoad(fetch("/_tree?" + params.toString()).then((r2) => {
        if (!r2.ok)
          throw new Error("failed to load repository tree");
        return r2.json();
      })).then((meta) => {
        const activeRepoRef = repoFileTargetFromRoute() || (STATE.route.screen === "repo" ? STATE.route.ref : "");
        if ((activeRepoRef || "worktree") !== normalizedRef)
          return;
        const files = meta.entries.map((entry, index) => ({
          order: index + 1,
          path: entry.path,
          display_path: entry.path,
          type: entry.type,
          children_omitted: entry.children_omitted
        }));
        renderSidebar(files, (file) => {
          if (file.type === "tree") {
            setRoute(repoRoute(normalizedRef, file.path));
            loadRepo();
            return;
          }
          setRoute({ screen: "file", path: file.path, ref: normalizedRef, view: "blob", range: currentRange() });
          renderStandaloneSource({ path: file.path, ref: normalizedRef });
        });
        REPO_SIDEBAR_REF = normalizedRef;
        activateRepoSidebarPath(currentPath);
      }).catch(() => {
        REPO_SIDEBAR_REF = null;
        renderSidebar([], undefined);
        $("#totals").textContent = "Cannot load tree";
      }).finally(() => {
        if (REPO_SIDEBAR_LOAD === load2) {
          REPO_SIDEBAR_LOAD_REF = null;
          REPO_SIDEBAR_LOAD = null;
        }
      });
      REPO_SIDEBAR_LOAD = load2;
      return load2;
    }
    function activateRepoSidebarPath(currentPath) {
      markActive(currentPath);
      applyFilter();
    }
    function createPlaceholder(f2) {
      const card = document.createElement("div");
      card.className = "gdp-file-shell pending";
      card.dataset.path = f2.path;
      card.dataset.key = f2.key || f2.path;
      card.dataset.sizeClass = f2.size_class || "small";
      card.dataset.status = f2.status || "M";
      card.classList.toggle("viewed", STATE.viewedFiles.has(f2.path));
      if (f2.estimated_height_px) {
        card.style.minHeight = f2.estimated_height_px + "px";
      }
      const head = document.createElement("div");
      head.className = "gdp-shell-header";
      head.innerHTML = '<span class="status-pill ' + escapeHtml2(f2.status || "M") + '">' + escapeHtml2(f2.status || "M") + '</span><span class="path">' + escapeHtml2(f2.display_path || f2.path) + '</span><span class="stats"><span class="a">+' + (f2.additions || 0) + "</span>" + '<span class="d">−' + (f2.deletions || 0) + '</span></span><span class="size-tag ' + escapeHtml2(f2.size_class || "") + '">' + escapeHtml2(f2.size_class || "") + "</span>" + '<span class="loading-indicator" hidden>loading…</span>';
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
          const f2 = STATE.files.find((x) => x.path === card.dataset.path);
          if (!f2)
            return;
          enqueueLoad(f2, card, 0);
        });
      }, { rootMargin: "1200px 0px 1600px 0px" });
      document.querySelectorAll(".gdp-file-shell.pending").forEach((c2) => lazyObserver.observe(c2));
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
        const f2 = STATE.files.find((x) => x.path === card.dataset.path);
        if (f2)
          enqueueLoad(f2, card, 0);
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
      LOAD_QUEUE.sort((a2, b2) => b2.priority - a2.priority);
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
      const openFileBtn = document.createElement("button");
      openFileBtn.className = "gdp-show-full";
      openFileBtn.textContent = "Open as file";
      openFileBtn.title = "Open this file in the virtualized source viewer";
      openFileBtn.addEventListener("click", () => {
        const target = fileSourceTarget(file);
        setRoute({ screen: "file", path: target.path, ref: target.ref, range: currentRange() });
        applySourceRouteToShell();
      });
      const fullBtn = document.createElement("button");
      fullBtn.className = "gdp-show-full secondary";
      fullBtn.textContent = "Load full diff";
      fullBtn.title = "Render the full diff with Diff2Html. This can be slow for large files.";
      fullBtn.addEventListener("click", () => {
        body.innerHTML = "";
        card.dataset.manualLoad = "1";
        card.dataset.manualMode = "full";
        card.classList.remove("manual-load");
        loadFile(file, card, file.load_url);
      });
      wrap.appendChild(note);
      if (file.status === "A")
        wrap.appendChild(openFileBtn);
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
      return trackLoad(fetch(url).then((r2) => r2.json())).then(async (data) => {
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
    function parseHunkHeader(text2) {
      const m = (text2 || "").match(/@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
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
      const base2 = perTable.find((arr) => arr.some((x) => x.hunk)) || perTable[0] || [];
      const usedTrs = new WeakSet;
      base2.forEach((baseItem) => {
        const top = baseItem.tr.getBoundingClientRect().top;
        const group = perTable.map((arr, tableIndex) => {
          let best = null, bestD = Infinity;
          for (const item of arr) {
            if (usedTrs.has(item.tr))
              continue;
            const d2 = Math.abs(item.tr.getBoundingClientRect().top - top);
            if (d2 < bestD) {
              best = item;
              bestD = d2;
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
      for (let i2 = 1;i2 < infoRows.length; i2++) {
        const prev = infoRows[i2 - 1].hunk;
        infoRows[i2].prevHunkEndNew = nextNewLine(prev);
        infoRows[i2].prevHunkEndOld = nextOldLine(prev);
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
          sib.tr.querySelectorAll(".gdp-expand-btn").forEach((b2) => {
            b2.disabled = busy;
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
        trackLoad(fetch(url).then((r2) => r2.json())).then((data) => {
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
        button.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="' + EXPAND_ICON_PATHS[spec.direction] + '"/></svg>';
        button.addEventListener("click", (e2) => {
          e2.stopPropagation();
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
        trackLoad(fetch(url).then((r2) => r2.json())).then((data) => {
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
      for (let i2 = 0;i2 < lines.length; i2++) {
        const tr = document.createElement("tr");
        tr.className = "gdp-inserted-ctx";
        if (dir)
          tr.dataset.gdpDir = dir;
        let lnHtml;
        if (isSplit) {
          const num = sideIndex === 0 ? oldStart + i2 : newStart + i2;
          lnHtml = '<td class="d2h-code-side-linenumber d2h-cntx">' + num + "</td>";
        } else {
          lnHtml = '<td class="d2h-code-linenumber d2h-cntx"><div class="line-num1">' + (oldStart + i2) + '</div><div class="line-num2">' + (newStart + i2) + "</div></td>";
        }
        tr.innerHTML = lnHtml + '<td class="d2h-cntx"><div class="' + (isSplit ? "d2h-code-side-line" : "d2h-code-line") + '"><span class="d2h-code-line-prefix">&nbsp;</span><span class="d2h-code-line-ctn">' + escapeHtmlText(lines[i2]) + "</span></div></td>";
        frag.appendChild(tr);
      }
      tbody.insertBefore(frag, anchor);
    }
    function escapeHtmlText(s2) {
      return String(s2 == null ? "" : s2).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    function renderSourceLoading(card, target, onCancel) {
      const body = card.querySelector(".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer");
      const view = document.createElement("div");
      view.className = "gdp-source-viewer loading";
      const content = document.createElement("div");
      content.className = "gdp-source-loading-content";
      const title = document.createElement("strong");
      title.className = "gdp-source-loading-title";
      title.textContent = "Loading file";
      const message = document.createElement("div");
      message.className = "gdp-source-loading-message";
      message.textContent = target.path + " at " + target.ref;
      content.append(title, message);
      if (onCancel) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gdp-btn gdp-btn-sm gdp-source-cancel";
        button.textContent = "Cancel";
        button.title = "Cancel loading (Esc)";
        button.addEventListener("click", (e2) => {
          e2.stopPropagation();
          onCancel();
        });
        content.appendChild(button);
      }
      view.appendChild(content);
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
    function renderSourceCancelled(card, target) {
      const body = card.querySelector(".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer");
      const view = document.createElement("div");
      view.className = "gdp-source-viewer cancelled";
      const content = document.createElement("div");
      content.className = "gdp-source-loading-content";
      const title = document.createElement("strong");
      title.className = "gdp-source-loading-title";
      title.textContent = "Loading cancelled";
      const message = document.createElement("div");
      message.className = "gdp-source-loading-message";
      message.textContent = target.path + " at " + target.ref;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "gdp-btn gdp-btn-sm";
      retry.textContent = "Reopen";
      retry.addEventListener("click", () => renderStandaloneSource(sourceTargetFromRoute() || target));
      content.append(title, message, retry);
      view.appendChild(content);
      if (body)
        body.replaceWith(view);
      else
        card.appendChild(view);
    }
    function renderSourceUnsupported(card, target) {
      const body = card.querySelector(".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer");
      const view = document.createElement("div");
      view.className = "gdp-source-viewer unsupported";
      const content = document.createElement("div");
      content.className = "gdp-source-unsupported-content";
      const title = document.createElement("strong");
      title.className = "gdp-source-unsupported-title";
      title.textContent = "Preview unavailable";
      const message = document.createElement("div");
      message.className = "gdp-source-unsupported-message";
      message.textContent = "This file type cannot be previewed safely in the browser.";
      const info = createSourceFileInfo(target, "unsupported file");
      const link2 = document.createElement("a");
      link2.className = "gdp-btn gdp-btn-sm gdp-source-download";
      link2.href = buildRawFileUrl(target);
      link2.textContent = "Download raw";
      link2.target = "_blank";
      link2.rel = "noreferrer";
      content.append(title, message, info, link2);
      view.appendChild(content);
      if (body)
        body.replaceWith(view);
      else
        card.appendChild(view);
    }
    function isPreviewableSource(path) {
      return /\.(md|markdown|mdown|mkdn|mdx)$/i.test(path);
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
      tf: "terraform",
      tfvars: "terraform",
      hcl: "terraform",
      xml: "xml",
      html: "xml",
      vue: "xml",
      css: "css",
      scss: "scss",
      md: "markdown",
      dockerfile: "dockerfile",
      proto: "protobuf",
      gradle: "gradle",
      properties: "properties",
      patch: "diff",
      diff: "diff",
      nix: "nix",
      cue: "cue",
      rego: "rego",
      bicep: "bicep",
      bazel: "starlark",
      bzl: "starlark",
      cmake: "cmake",
      groovy: "groovy",
      dart: "dart",
      scala: "scala",
      clj: "clojure",
      cljs: "clojure",
      cljc: "clojure",
      edn: "clojure",
      ex: "elixir",
      exs: "elixir",
      erl: "erlang",
      hrl: "erlang",
      hs: "haskell",
      lhs: "haskell",
      ml: "ocaml",
      mli: "ocaml",
      jl: "julia",
      r: "r",
      rmd: "r",
      pl: "perl",
      pm: "perl",
      tcl: "tcl",
      vim: "vim",
      f: "fortran",
      f90: "fortran",
      m: "objective-c",
      mm: "objective-cpp",
      tex: "tex",
      bib: "bibtex",
      rst: "rst"
    };
    const TEXT_SOURCE_EXTENSIONS = new Set([
      ...Object.keys(EXT_TO_LANG),
      "txt",
      "md",
      "markdown",
      "mdown",
      "mkdn",
      "mdx",
      "json",
      "jsonc",
      "csv",
      "tsv",
      "yaml",
      "yml",
      "toml",
      "hcl",
      "tf",
      "tfvars",
      "tfstate",
      "xml",
      "html",
      "htm",
      "css",
      "scss",
      "sass",
      "less",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "ts",
      "tsx",
      "mts",
      "cts",
      "vue",
      "svelte",
      "astro",
      "rs",
      "go",
      "py",
      "rb",
      "php",
      "java",
      "kt",
      "kts",
      "c",
      "cc",
      "cpp",
      "cxx",
      "h",
      "hpp",
      "cs",
      "swift",
      "sh",
      "bash",
      "zsh",
      "fish",
      "ps1",
      "sql",
      "graphql",
      "graphqls",
      "gql",
      "ini",
      "conf",
      "env",
      "properties",
      "gitignore",
      "dockerignore",
      "editorconfig",
      "lock",
      "log",
      "patch",
      "diff",
      "sum",
      "mk",
      "proto",
      "thrift",
      "prisma",
      "gradle",
      "cmake",
      "nix",
      "cue",
      "rego",
      "bicep",
      "bazel",
      "bzl",
      "dart",
      "scala",
      "clj",
      "cljs",
      "cljc",
      "edn",
      "ex",
      "exs",
      "erl",
      "hrl",
      "hs",
      "lhs",
      "ml",
      "mli",
      "jl",
      "r",
      "rmd",
      "pl",
      "pm",
      "tcl",
      "vim",
      "groovy",
      "f",
      "f90",
      "m",
      "mm",
      "pas",
      "tex",
      "bib",
      "rst",
      "adoc",
      "org",
      "ipynb",
      "ejs",
      "hbs",
      "mustache",
      "liquid",
      "pug"
    ]);
    const TEXT_SOURCE_FILENAMES = new Set([
      "readme",
      "license",
      "copying",
      "authors",
      "contributors",
      "notice",
      "changelog",
      "todo",
      "manifest",
      "version",
      "codeowners",
      "go.mod",
      "build.bazel",
      "workspace.bazel",
      "module.bazel",
      "gemfile",
      "rakefile",
      "procfile",
      "brewfile",
      "gnumakefile",
      "bsdmakefile",
      ".gitattributes",
      ".gitmodules",
      ".npmrc",
      ".nvmrc",
      ".yarnrc",
      ".prettierrc",
      ".eslintrc",
      ".babelrc",
      ".stylelintrc"
    ]);
    const FILENAME_TO_LANG = {
      dockerfile: "dockerfile",
      makefile: "makefile",
      gnumakefile: "makefile",
      bsdmakefile: "makefile",
      "go.mod": "go",
      "build.bazel": "starlark",
      "workspace.bazel": "starlark",
      "module.bazel": "starlark"
    };
    function sourceFileName(path) {
      return (path.split("/").pop() || path).toLowerCase();
    }
    function sourceFileExtension(name) {
      const index = name.lastIndexOf(".");
      return index >= 0 ? name.slice(index + 1) : "";
    }
    function isDockerfileName(name) {
      return /^dockerfile(?:[.-].+)?$/i.test(name);
    }
    function isMakefileName(name) {
      return /^makefile(?:[.-].+)?$/i.test(name);
    }
    function sourceDisplayKind(path) {
      if (isVideo(path))
        return "video";
      if (isImage(path))
        return "image";
      if (/\.pdf$/i.test(path))
        return "pdf";
      const name = sourceFileName(path);
      const ext = sourceFileExtension(name);
      if (TEXT_SOURCE_EXTENSIONS.has(ext))
        return "text";
      if (TEXT_SOURCE_FILENAMES.has(name))
        return "text";
      if (isDockerfileName(name) || isMakefileName(name))
        return "text";
      return "unsupported";
    }
    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0)
        return "";
      const units = ["B", "KB", "MB", "GB"];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
      }
      return (unit === 0 ? String(value) : value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, "")) + " " + units[unit];
    }
    function humanFileKind(path, mime, fallback) {
      const ext = (path.split(".").pop() || "").toLowerCase();
      if (ext === "png")
        return "PNG image";
      if (ext === "jpg" || ext === "jpeg")
        return "JPEG image";
      if (ext === "gif")
        return "GIF image";
      if (ext === "webp")
        return "WebP image";
      if (ext === "svg")
        return "SVG image";
      if (ext === "pdf")
        return "PDF document";
      if (ext === "zip")
        return "ZIP archive";
      if (ext === "mp4")
        return "MP4 video";
      if (ext === "webm")
        return "WebM video";
      if (mime?.startsWith("image/"))
        return "Image";
      if (mime?.startsWith("video/"))
        return "Video";
      if (mime === "application/pdf")
        return "PDF document";
      if (fallback === "unsupported file")
        return "Binary file";
      return fallback.charAt(0).toUpperCase() + fallback.slice(1);
    }
    async function loadRawFileInfo(target) {
      try {
        const res = await fetch(buildRawFileUrl(target), { method: "HEAD" });
        if (!res.ok)
          return {};
        const rawSize = res.headers.get("content-length");
        const size = rawSize == null ? NaN : Number(rawSize);
        return {
          size: rawSize != null && Number.isFinite(size) ? size : undefined,
          type: res.headers.get("content-type") || undefined
        };
      } catch {
        return {};
      }
    }
    function createSourceFileInfo(target, kind) {
      const info = document.createElement("div");
      info.className = "gdp-source-file-info";
      const type = document.createElement("span");
      type.className = "kind";
      type.textContent = humanFileKind(target.path, undefined, kind);
      info.appendChild(type);
      loadRawFileInfo(target).then((meta) => {
        type.textContent = humanFileKind(target.path, meta.type, kind);
        if (meta.size != null) {
          const size = document.createElement("span");
          size.textContent = formatBytes(meta.size);
          info.appendChild(size);
        }
      });
      return info;
    }
    function createSourceTabs(active) {
      const tabs = document.createElement("div");
      tabs.className = "gdp-source-tabs";
      const codeButton = document.createElement("button");
      codeButton.type = "button";
      codeButton.textContent = "Code";
      codeButton.classList.toggle("active", active === "code");
      tabs.appendChild(codeButton);
      let previewButton = null;
      if (active === "preview") {
        previewButton = document.createElement("button");
        previewButton.type = "button";
        previewButton.className = "active";
        previewButton.textContent = "Preview";
        tabs.prepend(previewButton);
      }
      return { tabs, codeButton, previewButton };
    }
    async function renderSourceText(card, target, textValue, signal) {
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
      const lang = inferLang(target.path);
      const usesVirtualSource = shouldVirtualizeSource(textValue, lines) && !isVirtualSourceDisabled();
      const hljsRef = STATE.syntaxHighlight && usesVirtualSource ? await loadSyntaxHighlighter() : null;
      const sourceShikiRef = STATE.syntaxHighlight && !usesVirtualSource ? await loadSourceShikiHighlighter() : null;
      if (signal?.aborted)
        return false;
      const previewable = isPreviewableSource(target.path);
      const tabsHost = card.querySelector(".gdp-file-detail-tabs");
      if (usesVirtualSource) {
        const virtualCode = renderVirtualSource(target, textValue, lines, hljsRef, lang);
        if (previewable) {
          const { tabs: tabs2, codeButton: codeButton2, previewButton: previewButton2 } = createSourceTabs("preview");
          if (tabsHost) {
            tabsHost.hidden = false;
            tabsHost.replaceChildren(tabs2);
          }
          const preview = await renderMarkdownPreview(textValue, target, {
            syntaxHighlight: STATE.syntaxHighlight,
            signal,
            onNavigateMarkdown: (path, ref) => {
              setRoute({ screen: "file", path, ref, view: "blob", range: currentRange() });
              renderStandaloneSource({ path, ref });
            }
          });
          if (signal?.aborted)
            return false;
          virtualCode.hidden = true;
          previewButton2?.addEventListener("click", () => {
            previewButton2.classList.add("active");
            codeButton2.classList.remove("active");
            preview.hidden = false;
            virtualCode.hidden = true;
          });
          codeButton2.addEventListener("click", () => {
            codeButton2.classList.add("active");
            previewButton2.classList.remove("active");
            preview.hidden = true;
            virtualCode.hidden = false;
          });
          if (header)
            view.appendChild(header);
          view.classList.add("virtual");
          view.append(preview, virtualCode);
          if (body)
            body.replaceWith(view);
          else
            card.appendChild(view);
          return true;
        }
        if (header)
          view.appendChild(header);
        view.classList.add("virtual");
        view.appendChild(virtualCode);
        if (signal?.aborted)
          return false;
        if (body)
          body.replaceWith(view);
        else
          card.appendChild(view);
        return true;
      }
      const table2 = document.createElement("table");
      table2.className = "gdp-source-table";
      const tbody = document.createElement("tbody");
      const sourceShikiLang = normalizeSourceShikiLang(lang);
      const shikiLines = sourceShikiRef && sourceShikiLang ? sourceShikiLines(textValue, sourceShikiLang, sourceShikiRef) : null;
      for (let index = 0;index < lines.length; index++) {
        if (signal?.aborted)
          return false;
        const line = lines[index];
        const tr = document.createElement("tr");
        const num = document.createElement("td");
        num.className = "gdp-source-line-number";
        num.textContent = String(index + 1);
        const code2 = document.createElement("td");
        code2.className = "gdp-source-line-code";
        if (shikiLines && shikiLines[index] != null) {
          code2.innerHTML = shikiLines[index] || " ";
          code2.classList.add("shiki");
        } else {
          code2.textContent = line || " ";
        }
        tr.appendChild(num);
        tr.appendChild(code2);
        tbody.appendChild(tr);
        if (index > 0 && index % 500 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (signal?.aborted)
            return false;
        }
      }
      table2.appendChild(tbody);
      const { tabs, codeButton, previewButton } = createSourceTabs(previewable ? "preview" : "code");
      if (tabsHost) {
        tabsHost.hidden = false;
        tabsHost.replaceChildren(tabs);
      }
      if (previewable) {
        const preview = await renderMarkdownPreview(textValue, target, {
          syntaxHighlight: STATE.syntaxHighlight,
          signal,
          onNavigateMarkdown: (path, ref) => {
            setRoute({ screen: "file", path, ref, view: "blob", range: currentRange() });
            renderStandaloneSource({ path, ref });
          }
        });
        if (signal?.aborted)
          return false;
        table2.hidden = true;
        previewButton?.addEventListener("click", () => {
          previewButton.classList.add("active");
          codeButton.classList.remove("active");
          preview.hidden = false;
          table2.hidden = true;
        });
        codeButton.addEventListener("click", () => {
          codeButton.classList.add("active");
          previewButton.classList.remove("active");
          preview.hidden = true;
          table2.hidden = false;
        });
        if (header)
          view.appendChild(header);
        view.appendChild(preview);
        view.appendChild(table2);
        if (signal?.aborted)
          return false;
        if (body)
          body.replaceWith(view);
        else
          card.appendChild(view);
        return true;
      }
      if (header)
        view.appendChild(header);
      view.appendChild(table2);
      if (signal?.aborted)
        return false;
      if (body)
        body.replaceWith(view);
      else
        card.appendChild(view);
      return true;
    }
    function shouldVirtualizeSource(textValue, lines) {
      return textValue.length >= VIRTUAL_SOURCE_SIZE_THRESHOLD || lines.length >= VIRTUAL_SOURCE_LINE_THRESHOLD;
    }
    function isVirtualSourceDisabled() {
      return new URLSearchParams(window.location.search).get("virtual") === "off";
    }
    function buildCurrentFileRouteWithVirtualMode(target, virtualMode) {
      const route = {
        screen: "file",
        path: target.path,
        ref: target.ref,
        view: STATE.route.screen === "file" ? STATE.route.view : "blob",
        range: currentRange()
      };
      const url = new URL(buildRoute(route), window.location.origin);
      if (virtualMode === "off")
        url.searchParams.set("virtual", "off");
      else
        url.searchParams.delete("virtual");
      return url.pathname + url.search;
    }
    function renderVirtualSource(target, textValue, lines, hljsRef, lang) {
      const wrap = document.createElement("div");
      wrap.className = "gdp-source-virtual";
      const info = document.createElement("div");
      info.className = "gdp-source-virtual-info";
      const badge = document.createElement("span");
      badge.className = "gdp-source-virtual-badge";
      badge.textContent = "Virtual mode";
      const summary = document.createElement("span");
      summary.className = "gdp-source-virtual-summary";
      summary.textContent = lines.length.toLocaleString() + " lines, " + formatBytes(textValue.length) + ". Only visible rows are rendered. Highlighting is per-line.";
      const actions = document.createElement("span");
      actions.className = "gdp-source-virtual-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "gdp-source-virtual-action";
      copy.textContent = "Copy all";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(textValue);
          copy.textContent = "Copied";
          setTimeout(() => {
            copy.textContent = "Copy all";
          }, 1200);
        } catch {
          copy.textContent = "Copy failed";
          setTimeout(() => {
            copy.textContent = "Copy all";
          }, 1600);
        }
      });
      const full = document.createElement("a");
      full.className = "gdp-source-virtual-action";
      full.href = buildCurrentFileRouteWithVirtualMode(target, "off");
      full.textContent = "Open full view";
      full.title = "Render every line without virtualization. This can be slow for large files.";
      full.addEventListener("click", (e2) => {
        e2.preventDefault();
        history.pushState(null, "", full.href);
        renderStandaloneSource(target);
      });
      actions.append(copy, full);
      info.append(badge, summary, actions);
      const scroller = document.createElement("div");
      scroller.className = "gdp-source-virtual-scroller";
      const spacer = document.createElement("div");
      spacer.className = "gdp-source-virtual-spacer";
      spacer.style.height = Math.max(1, lines.length * VIRTUAL_SOURCE_ROW_HEIGHT) + "px";
      const windowEl = document.createElement("div");
      windowEl.className = "gdp-source-virtual-window";
      spacer.appendChild(windowEl);
      scroller.appendChild(spacer);
      wrap.append(info, scroller);
      let raf = 0;
      let renderedStart = -1;
      let renderedEnd = -1;
      const render = () => {
        raf = 0;
        const viewportHeight = scroller.clientHeight || window.innerHeight;
        const overscan = 20;
        const start = Math.max(0, Math.floor(scroller.scrollTop / VIRTUAL_SOURCE_ROW_HEIGHT) - overscan);
        const end = Math.min(lines.length, Math.ceil((scroller.scrollTop + viewportHeight) / VIRTUAL_SOURCE_ROW_HEIGHT) + overscan);
        if (start === renderedStart && end === renderedEnd)
          return;
        renderedStart = start;
        renderedEnd = end;
        windowEl.replaceChildren();
        windowEl.style.transform = "translateY(" + start * VIRTUAL_SOURCE_ROW_HEIGHT + "px)";
        const fragment = document.createDocumentFragment();
        for (let index = start;index < end; index++) {
          const row = document.createElement("div");
          row.className = "gdp-source-virtual-row";
          const num = document.createElement("span");
          num.className = "gdp-source-virtual-line-number";
          num.textContent = String(index + 1);
          const code2 = document.createElement("span");
          code2.className = "gdp-source-virtual-line-code";
          const line = lines[index] ?? "";
          if (hljsRef && hljsRef.highlight && lang && line.length <= VIRTUAL_SOURCE_HIGHLIGHT_MAX_LINE_LENGTH && (!hljsRef.getLanguage || hljsRef.getLanguage(lang))) {
            try {
              code2.innerHTML = hljsRef.highlight(line, { language: lang, ignoreIllegals: true }).value;
              code2.classList.add("hljs");
            } catch {
              code2.textContent = line;
            }
          } else {
            code2.textContent = line;
          }
          row.append(num, code2);
          fragment.appendChild(row);
        }
        windowEl.appendChild(fragment);
      };
      const schedule = () => {
        if (!raf)
          raf = requestAnimationFrame(render);
      };
      scroller.addEventListener("scroll", schedule, { passive: true });
      let resizeObserver = null;
      resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
        if (!scroller.isConnected) {
          resizeObserver?.disconnect();
          resizeObserver = null;
          return;
        }
        schedule();
      }) : null;
      resizeObserver?.observe(scroller);
      render();
      schedule();
      return wrap;
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
      const info = createSourceFileInfo(target, mediaKind);
      view.appendChild(info);
      if (mediaKind === "video") {
        const video = document.createElement("video");
        video.src = url;
        video.controls = true;
        video.preload = "metadata";
        view.appendChild(video);
      } else if (mediaKind === "pdf") {
        const frame = document.createElement("iframe");
        frame.src = url;
        frame.title = target.path;
        frame.loading = "lazy";
        view.appendChild(frame);
      } else {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.addEventListener("load", () => {
          const resolution = document.createElement("span");
          resolution.textContent = img.naturalWidth + " x " + img.naturalHeight;
          info.appendChild(resolution);
        }, { once: true });
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
      const link2 = document.createElement("a");
      link2.href = buildRawFileUrl(target);
      link2.textContent = "Open raw file";
      link2.target = "_blank";
      link2.rel = "noreferrer";
      if (!isStandalone) {
        const meta = document.createElement("div");
        meta.className = "gdp-source-meta";
        meta.textContent = target.path + " @ " + target.ref;
        view.appendChild(meta);
      }
      view.appendChild(link2);
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
      cancelActiveSourceLoad("navigation");
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
      copy.addEventListener("click", async (e2) => {
        e2.stopPropagation();
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
      const controller = new AbortController;
      ACTIVE_SOURCE_LOAD = { controller, req, target, card };
      renderSourceLoading(card, target, () => cancelActiveSourceLoad("user"));
      try {
        const displayKind = sourceDisplayKind(target.path);
        if (displayKind === "unsupported") {
          if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target))
            return;
          finishSourceLoad(req);
          renderSourceUnsupported(card, target);
          return;
        }
        if (displayKind === "image" || displayKind === "video" || displayKind === "pdf") {
          if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target))
            return;
          finishSourceLoad(req);
          renderSourceMedia(card, target, displayKind);
          return;
        }
        if (displayKind === "text") {
          const response = await trackLoad(fetch(buildRawFileUrl(target), { signal: controller.signal }));
          if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target))
            return;
          if (!response.ok) {
            finishSourceLoad(req);
            renderSourceError(card, target, "Cannot load " + target.path + " at " + target.ref);
            return;
          }
          const textValue = await response.text();
          if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target))
            return;
          const rendered = await renderSourceText(card, target, textValue, controller.signal);
          if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target))
            return;
          if (!rendered)
            return;
          scrollStandaloneSourceLine(card, STATE.route.screen === "file" ? STATE.route.line : undefined);
          finishSourceLoad(req);
        }
      } catch (err) {
        if (req !== SOURCE_REQ_SEQ || !sourceTargetsEqual(sourceTargetFromRoute(), target))
          return;
        finishSourceLoad(req);
        if (isAbortError(err)) {
          renderSourceCancelled(card, target);
          return;
        }
        renderSourceError(card, target, "Cannot load " + target.path + " at " + target.ref);
      }
    }
    function scrollStandaloneSourceLine(card, line) {
      if (!line || line < 1)
        return;
      const virtualScroller = card.querySelector(".gdp-source-virtual-scroller");
      if (virtualScroller) {
        virtualScroller.scrollTop = Math.max(0, (line - 1) * VIRTUAL_SOURCE_ROW_HEIGHT);
        return;
      }
      const rows = card.querySelectorAll(".gdp-source-table tr");
      const row = rows[line - 1];
      if (row)
        row.scrollIntoView({ block: "center" });
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
        for (let i2 = 0;i2 < 200; i2++) {
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
        toggle.addEventListener("click", (e2) => {
          e2.stopPropagation();
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
        copy.addEventListener("click", async (e2) => {
          e2.stopPropagation();
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
        unfold.addEventListener("click", (e2) => {
          e2.stopPropagation();
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
      for (let i2 = 0;i2 < SEG; i2++) {
        const box = document.createElement("span");
        if (i2 < aSeg)
          box.className = "sq add";
        else if (i2 < aSeg + dSeg)
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
        viewFile.addEventListener("click", (e2) => {
          e2.stopPropagation();
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
      applyViewedToCard(card, STATE.viewedFiles.has(file.path), true);
      if (data.truncated && data.mode === "preview") {
        addExpandHunksUI(file, data, card);
      }
      scheduleIdleHighlight(card, file);
    }
    function buildPreviewUrl(file, hunks) {
      const u2 = new URL(file.load_url, window.location.origin);
      u2.searchParams.set("mode", "preview");
      u2.searchParams.set("max_hunks", String(hunks));
      return u2.pathname + u2.search;
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
        trackLoad(fetch(url).then((r2) => r2.json())).then((next) => {
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
    function inferLang(path) {
      const name = sourceFileName(path);
      const fileLang = FILENAME_TO_LANG[name];
      if (fileLang)
        return fileLang;
      if (isDockerfileName(name))
        return "dockerfile";
      if (isMakefileName(name))
        return "makefile";
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
      spans.forEach((s2) => {
        s2.dataset.gdpHl = "1";
        const text2 = s2.textContent || "";
        if (text2.length === 0)
          return;
        try {
          s2.innerHTML = hljsRef.highlight(text2, { language: lang, ignoreIllegals: true }).value;
          if (!s2.classList.contains("hljs"))
            s2.classList.add("hljs");
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
        let i2 = 0;
        while (i2 < spans.length && deadline.timeRemaining() > 4) {
          const s2 = spans[i2++];
          s2.dataset.gdpHl = "1";
          const text2 = s2.textContent || "";
          if (text2.length === 0)
            continue;
          try {
            s2.innerHTML = hljsRef.highlight(text2, { language: lang, ignoreIllegals: true }).value;
            if (!s2.classList.contains("hljs"))
              s2.classList.add("hljs");
          } catch (_) {}
        }
        if (i2 < spans.length)
          requestIdleCallback(work, { timeout: 1500 });
      };
      requestIdleCallback(work, { timeout: 2000 });
    }
    function syncSideScrollCard(card) {
      card.querySelectorAll(".d2h-files-diff").forEach((group) => {
        const sides = group.querySelectorAll(".d2h-code-wrapper");
        if (sides.length !== 2)
          return;
        const [a2, b2] = sides;
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
        a2.addEventListener("scroll", () => mirror(a2, b2), { passive: true });
        b2.addEventListener("scroll", () => mirror(b2, a2), { passive: true });
      });
    }
    const MEDIA_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|mp4|webm|mov)(\?.*)?$/i;
    const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i;
    const VIDEO_RE = /\.(mp4|webm|mov)$/i;
    function isMedia(p2) {
      return MEDIA_RE.test(p2);
    }
    function isImage(p2) {
      return IMAGE_RE.test(p2);
    }
    function isVideo(p2) {
      return VIDEO_RE.test(p2);
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
      container.innerHTML = '<div class="media-side"><div class="media-label del">Before</div>' + leftHTML + '</div><div class="media-side"><div class="media-label add">After</div>' + rightHTML + "</div>";
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
            const r2 = w.getBoundingClientRect();
            if (r2.top <= scanY && r2.bottom > scanY) {
              const text2 = w.dataset.path || "";
              let best = null, bestLen = 0;
              STATE.files.forEach((f2) => {
                if ((text2 === f2.path || text2.endsWith(f2.path)) && f2.path.length > bestLen) {
                  best = f2.path;
                  bestLen = f2.path.length;
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
    $$(".sb-view-seg button").forEach((b2) => {
      b2.addEventListener("click", () => {
        STATE.sbView = b2.dataset.view || "tree";
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
      handle.addEventListener("mousedown", (e2) => {
        dragging = true;
        startX = e2.clientX;
        startW = STATE.sbWidth;
        currentW = startW;
        document.body.classList.add("gdp-resizing");
        preview.style.display = "block";
        preview.style.left = startW + "px";
        e2.preventDefault();
      });
      window.addEventListener("mousemove", (e2) => {
        if (!dragging)
          return;
        currentW = clamp(startW + (e2.clientX - startX));
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
    $$("#topbar .seg button").forEach((b2) => {
      b2.addEventListener("click", () => setLayout(b2.dataset.layout || "side-by-side"));
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
    function toggleActiveSidebarDirectoryCollapsed() {
      const active = document.querySelector("#filelist .tree-dir.active[data-dirpath]");
      if (!active)
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
    function jumpToActiveOrFirstFilteredItem() {
      const items = visibleSidebarItems();
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
      sbFilter.addEventListener("keydown", (e2) => {
        if (e2.key === "Enter") {
          e2.preventDefault();
          jumpToActiveOrFirstFilteredItem();
        } else if (e2.key === "ArrowDown" || e2.key === "ArrowUp") {
          e2.preventDefault();
          moveActiveSidebarItem(e2.key === "ArrowDown" ? 1 : -1);
        } else if (e2.key === "Escape") {
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
    let PALETTE = null;
    const REPO_FILE_CACHE = new Map;
    function paletteSource() {
      if (STATE.route.screen === "diff")
        return "diff";
      if (STATE.route.screen === "file" && STATE.route.view !== "blob")
        return "diff";
      return "repo";
    }
    function paletteRef(source) {
      if (source === "diff")
        return STATE.to && STATE.to !== "worktree" ? STATE.to : "worktree";
      if (STATE.route.screen === "repo")
        return STATE.route.ref || "worktree";
      if (STATE.route.screen === "file")
        return STATE.route.ref || "worktree";
      return STATE.repoRef || "worktree";
    }
    function closeSearchPalette() {
      if (!PALETTE)
        return;
      PALETTE.controller?.abort();
      if (PALETTE.debounce)
        window.clearTimeout(PALETTE.debounce);
      PALETTE.root.remove();
      PALETTE = null;
    }
    function createPalette(mode) {
      closeSearchPalette();
      const root = document.createElement("div");
      root.className = "gdp-palette-backdrop";
      const dialog = document.createElement("div");
      dialog.className = "gdp-palette";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      const label = document.createElement("div");
      label.className = "gdp-palette-label";
      label.textContent = mode === "file" ? "Files" : "Grep";
      const input = document.createElement("input");
      input.className = "gdp-palette-input";
      input.type = "search";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.placeholder = mode === "file" ? "Search files" : "Search text";
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-controls", "gdp-palette-list");
      const status = document.createElement("div");
      status.className = "gdp-palette-status";
      const list2 = document.createElement("div");
      list2.id = "gdp-palette-list";
      list2.className = "gdp-palette-list";
      list2.setAttribute("role", "listbox");
      dialog.append(label, input, status, list2);
      root.appendChild(dialog);
      document.body.appendChild(root);
      const state = {
        root,
        input,
        list: list2,
        status,
        mode,
        selected: -1,
        items: [],
        composing: false,
        diffSnapshot: [...STATE.files]
      };
      PALETTE = state;
      root.addEventListener("mousedown", (e2) => {
        if (e2.target === root)
          closeSearchPalette();
      });
      input.addEventListener("compositionstart", () => {
        state.composing = true;
      });
      input.addEventListener("compositionend", () => {
        state.composing = false;
      });
      input.addEventListener("input", () => updatePaletteResults(state));
      input.addEventListener("keydown", (e2) => handlePaletteKeydown(e2, state));
      input.focus();
      updatePaletteResults(state);
      return state;
    }
    function appendHighlightedPath(parent, path, ranges) {
      let cursor = 0;
      for (const range of ranges) {
        if (range.start > cursor)
          parent.appendChild(document.createTextNode(path.slice(cursor, range.start)));
        const mark = document.createElement("mark");
        mark.textContent = path.slice(range.start, range.end);
        parent.appendChild(mark);
        cursor = range.end;
      }
      if (cursor < path.length)
        parent.appendChild(document.createTextNode(path.slice(cursor)));
    }
    function renderPalette(state) {
      state.list.innerHTML = "";
      state.items.forEach((item, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.id = "gdp-palette-item-" + index;
        row.className = "gdp-palette-row";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", index === state.selected ? "true" : "false");
        const title = document.createElement("span");
        title.className = "gdp-palette-row-title";
        const detail = document.createElement("span");
        detail.className = "gdp-palette-row-detail";
        if (item.kind === "file") {
          title.textContent = item.path.split("/").pop() || item.path;
          appendHighlightedPath(detail, item.displayPath, item.ranges);
          if (item.old_path && item.displayPath !== item.old_path) {
            detail.appendChild(document.createTextNode("  " + item.old_path));
          }
        } else {
          title.textContent = item.path + ":" + item.line;
          detail.textContent = item.preview;
        }
        row.append(title, detail);
        row.addEventListener("mouseenter", () => {
          state.selected = index;
          syncPaletteSelection(state);
        });
        row.addEventListener("mousedown", (e2) => {
          e2.preventDefault();
          state.selected = index;
          selectPaletteItem(state);
        });
        state.list.appendChild(row);
      });
      syncPaletteSelection(state);
    }
    function syncPaletteSelection(state) {
      state.input.setAttribute("aria-activedescendant", state.selected >= 0 ? "gdp-palette-item-" + state.selected : "");
      state.list.querySelectorAll(".gdp-palette-row").forEach((row, index) => {
        row.setAttribute("aria-selected", index === state.selected ? "true" : "false");
      });
    }
    async function repoPaletteFiles(ref) {
      const cached = REPO_FILE_CACHE.get(ref);
      if (cached && cached.generation === SERVER_GENERATION)
        return cached;
      const params = new URLSearchParams;
      params.set("ref", ref);
      const res = await trackLoad(fetch("/_files?" + params.toString()).then((r2) => {
        if (!r2.ok)
          throw new Error("failed to load files");
        return r2.json();
      }));
      REPO_FILE_CACHE.set(ref, res);
      return res;
    }
    function diffFilePaletteItems(state, query) {
      const candidates = state.diffSnapshot.map((file) => {
        const current = fuzzyMatchPath(query, file.path);
        const old = file.old_path ? fuzzyMatchPath(query, file.old_path) : null;
        const best = old && (!current || old.score > current.score) ? { match: old, displayPath: file.old_path || file.path } : current ? { match: current, displayPath: file.path } : null;
        return best ? { file, ...best } : null;
      }).filter((item) => item !== null).sort((a2, b2) => b2.match.score - a2.match.score || a2.file.path.localeCompare(b2.file.path));
      return limitPaletteResults(candidates).map((candidate) => ({
        kind: "file",
        path: candidate.file.path,
        old_path: candidate.file.old_path,
        displayPath: candidate.displayPath,
        ref: paletteRef("diff"),
        targetPath: fileSourceTarget(candidate.file).path,
        targetRef: fileSourceTarget(candidate.file).ref,
        source: "diff",
        ranges: candidate.match.ranges
      }));
    }
    async function updateFilePalette(state, query) {
      const source = paletteSource();
      if (!query.trim()) {
        const base2 = source === "diff" ? state.diffSnapshot.map((file) => {
          const target = fileSourceTarget(file);
          return { kind: "file", path: file.path, old_path: file.old_path, displayPath: file.path, ref: paletteRef(source), targetPath: target.path, targetRef: target.ref, source, ranges: [] };
        }) : [];
        state.items = limitPaletteResults(base2);
        state.selected = state.items.length ? 0 : -1;
        state.status.textContent = source === "diff" ? state.diffSnapshot.length + " diff files" : "Type to search repository files";
        renderPalette(state);
        return;
      }
      if (source === "diff") {
        state.items = diffFilePaletteItems(state, query);
      } else {
        state.status.textContent = "Loading files...";
        const ref = paletteRef(source);
        const response = await repoPaletteFiles(ref);
        if (PALETTE !== state || state.input.value !== query)
          return;
        state.items = limitPaletteResults(rankFuzzyPaths(query, response.files)).map((match2) => ({
          kind: "file",
          path: match2.item.path,
          displayPath: match2.item.path,
          ref,
          source,
          ranges: match2.ranges
        }));
      }
      state.selected = state.items.length ? 0 : -1;
      state.status.textContent = state.items.length ? state.items.length + " results" : "No results";
      renderPalette(state);
    }
    function updateGrepPalette(state, query) {
      state.controller?.abort();
      if (state.debounce)
        window.clearTimeout(state.debounce);
      if (!query.trim()) {
        state.items = [];
        state.selected = -1;
        state.status.textContent = "Type to grep";
        renderPalette(state);
        return;
      }
      state.status.textContent = "Searching...";
      state.debounce = window.setTimeout(() => {
        const source = paletteSource();
        const ref = paletteRef(source);
        const params = new URLSearchParams;
        params.set("ref", ref);
        params.set("q", query);
        params.set("max", "200");
        if (source === "diff") {
          for (const file of state.diffSnapshot)
            params.append("path", file.path);
        }
        const controller = new AbortController;
        state.controller = controller;
        trackLoad(fetch("/_grep?" + params.toString(), { signal: controller.signal }).then((r2) => {
          if (!r2.ok)
            throw new Error("grep failed");
          return r2.json();
        })).then((response) => {
          if (PALETTE !== state || controller.signal.aborted)
            return;
          state.items = limitPaletteResults(response.matches.map((match2) => ({
            kind: "grep",
            path: match2.path,
            line: match2.line,
            column: match2.column,
            preview: match2.preview,
            ref,
            source
          })));
          state.selected = state.items.length ? 0 : -1;
          state.status.textContent = response.engine + (response.truncated ? " truncated" : "") + " - " + state.items.length + " results";
          renderPalette(state);
        }).catch((err) => {
          if (isAbortError(err))
            return;
          state.status.textContent = "Search failed";
        });
      }, 80);
    }
    function updatePaletteResults(state) {
      const query = state.input.value;
      if (state.mode === "file") {
        updateFilePalette(state, query).catch(() => {
          state.status.textContent = "Search failed";
        });
      } else {
        updateGrepPalette(state, query);
      }
    }
    function selectPaletteItem(state) {
      const item = state.items[state.selected];
      if (!item)
        return;
      closeSearchPalette();
      if (item.kind === "file") {
        if (item.source === "diff") {
          if (STATE.route.screen === "file") {
            setRoute({ screen: "file", path: item.targetPath || item.path, ref: item.targetRef || item.ref, range: currentRange() });
            applySourceRouteToShell();
          } else {
            scrollToFile(item.path);
          }
        } else {
          setRoute({ screen: "file", path: item.path, ref: item.ref, view: "blob", range: currentRange() });
          renderStandaloneSource({ path: item.path, ref: item.ref });
        }
        return;
      }
      if (item.source === "diff") {
        scrollToFile(item.path);
      } else {
        setRoute({ screen: "file", path: item.path, ref: item.ref, view: "blob", line: item.line, range: currentRange() });
        renderStandaloneSource({ path: item.path, ref: item.ref });
      }
    }
    function handlePaletteKeydown(e2, state) {
      if (e2.key === "Escape") {
        e2.preventDefault();
        closeSearchPalette();
        return;
      }
      if (e2.key === "Enter") {
        if (state.composing)
          return;
        e2.preventDefault();
        selectPaletteItem(state);
        return;
      }
      const direction = e2.key === "ArrowDown" || e2.ctrlKey && e2.key.toLowerCase() === "n" ? 1 : e2.key === "ArrowUp" || e2.ctrlKey && e2.key.toLowerCase() === "p" ? -1 : 0;
      if (direction) {
        e2.preventDefault();
        state.selected = movePaletteSelection(state.selected, state.items.length, direction);
        syncPaletteSelection(state);
      }
    }
    function openSearchPalette(mode) {
      createPalette(mode);
    }
    document.addEventListener("keydown", (e2) => {
      if ((e2.metaKey || e2.ctrlKey) && e2.key.toLowerCase() === "k") {
        e2.preventDefault();
        if (PALETTE?.mode === "file")
          return;
        openSearchPalette("file");
        return;
      }
      if ((e2.metaKey || e2.ctrlKey) && e2.key.toLowerCase() === "g") {
        e2.preventDefault();
        if (PALETTE?.mode === "grep")
          return;
        openSearchPalette("grep");
        return;
      }
      const targetEl = e2.target;
      if (targetEl && (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA"))
        return;
      if (e2.key === "Escape" && !document.querySelector(".mkdp-lightbox")) {
        if (cancelActiveSourceLoad("esc")) {
          e2.preventDefault();
          return;
        }
      }
      if (e2.key === "/") {
        e2.preventDefault();
        focusFileFilter();
      } else if (e2.key === "Enter") {
        if (isRepositorySidebarMode()) {
          e2.preventDefault();
          openActiveSidebarItem();
        }
      } else if (e2.key === "j" || e2.key === "k") {
        e2.preventDefault();
        const repoSidebar = isRepositorySidebarMode();
        const items = repoSidebar ? visibleSidebarItems() : $$("#filelist li[data-path]:not(.hidden):not(.hidden-by-tests)");
        if (!items.length)
          return;
        let idx = items.findIndex((li) => li.classList.contains("active"));
        if (idx < 0)
          idx = 0;
        else
          idx = e2.key === "j" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
        const target = items[idx];
        const path = target?.dataset.path || target?.dataset.dirpath;
        if (!repoSidebar && target) {
          target.click();
          target.scrollIntoView({ block: "nearest" });
        } else if (path) {
          markActive(path);
          target.scrollIntoView({ block: "nearest" });
        }
        const nextIdx = e2.key === "j" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
        const nextItem = items[nextIdx];
        if (nextItem && nextItem !== target && nextItem.dataset.path)
          prefetchByPath(nextItem.dataset.path);
      } else if (e2.key === "l") {
        if (isRepositorySidebarMode()) {
          e2.preventDefault();
          toggleActiveSidebarDirectoryCollapsed();
        }
      } else if (e2.key === "h") {
        if (isRepositorySidebarMode()) {
          e2.preventDefault();
          setActiveSidebarDirectoryCollapsed(true);
        }
      } else if (e2.key === "u")
        setLayout("line-by-line");
      else if (e2.key === "s")
        setLayout("side-by-side");
      else if (e2.key === "t")
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
      return trackLoad(fetch("/_tree?" + params.toString()).then((r2) => {
        if (!r2.ok)
          throw new Error("failed to load repository tree");
        return r2.json();
      })).then(async (data) => {
        await renderRepo(data);
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
      return trackLoad(fetch(url).then((r2) => r2.json())).then((data) => {
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
      return fetch("/_refs").then((r2) => r2.json()).then((refs) => {
        Object.assign(REFS, refs);
      }).catch(() => {});
    }
    fetchRefs();
    let popTab = "commits";
    function buildPopBody(query) {
      const q = (query || "").toLowerCase().trim();
      const m = (s2) => !q || String(s2).toLowerCase().includes(q);
      const html = [];
      if (popTab === "commits") {
        const commits = (REFS.commits || []).filter((c2) => m(c2));
        if (!commits.length) {
          html.push('<div class="rp-empty">no commits</div>');
        }
        for (const c2 of commits) {
          const [sha, subject, author, when] = c2.split("\t");
          if (!sha)
            continue;
          html.push('<div class="rp-item-commit" data-val="' + escapeAttr(sha) + '"><div class="row1"><span class="sha">' + escapeHtml2(sha) + '</span><span class="subject" title="' + escapeAttr(subject || "") + '">' + escapeHtml2(subject || "") + '</span></div><div class="row2"><span class="author">' + escapeHtml2(author || "") + '</span><span class="when">' + escapeHtml2(when || "") + "</span></div></div>");
        }
      } else if (popTab === "branches") {
        const branches = (REFS.branches || []).filter(m);
        if (!branches.length) {
          html.push('<div class="rp-empty">no branches</div>');
        }
        for (const b2 of branches) {
          const cur = b2 === REFS.current;
          html.push('<div class="rp-item-ref" data-val="' + escapeAttr(b2) + '"><span class="name">' + escapeHtml2(b2) + "</span>" + (cur ? '<span class="badge cur">current</span>' : '<span class="badge">branch</span>') + "</div>");
        }
      } else if (popTab === "tags") {
        const tags = (REFS.tags || []).filter(m);
        if (!tags.length) {
          html.push('<div class="rp-empty">no tags</div>');
        }
        for (const t2 of tags) {
          html.push('<div class="rp-item-ref" data-val="' + escapeAttr(t2) + '"><span class="name">' + escapeHtml2(t2) + '</span><span class="badge">tag</span></div>');
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
      let match2 = null;
      items.forEach((it) => {
        if (it.dataset.val === cur)
          match2 = it;
      });
      if (match2) {
        match2.classList.add("current");
        const ph = popBody;
        const r2 = match2.getBoundingClientRect();
        const pr = ph.getBoundingClientRect();
        if (r2.top < pr.top || r2.bottom > pr.bottom) {
          ph.scrollTop = match2.offsetTop - ph.clientHeight / 2;
        }
      }
    }
    function escapeAttr(s2) {
      return escapeHtml2(s2).replace(/"/g, "&quot;");
    }
    function openPopover(input) {
      popTarget = input;
      popSearch.value = "";
      buildPopBody("");
      const cur = (input.value || "").trim();
      popover.querySelectorAll(".rp-chip").forEach((c2) => {
        c2.classList.toggle("current", c2.dataset.val === cur);
      });
      popover.hidden = false;
      const r2 = input.getBoundingClientRect();
      const popWidth = Math.min(560, Math.floor(window.innerWidth * 0.9));
      popover.style.left = Math.max(8, Math.min(r2.left, window.innerWidth - popWidth - 8)) + "px";
      popover.style.top = r2.bottom + 4 + "px";
      setTimeout(() => popSearch.focus(), 0);
    }
    function closePopover() {
      popover.hidden = true;
      popTarget = null;
    }
    ["#ref-from", "#ref-to"].forEach((sel) => {
      const el = $(sel);
      el.addEventListener("focus", () => openPopover(el));
      el.addEventListener("mousedown", (e2) => {
        if (popover.hidden) {
          e2.preventDefault();
          el.focus();
        }
      });
      el.addEventListener("click", (e2) => {
        e2.stopPropagation();
        openPopover(el);
      });
      el.addEventListener("keydown", (e2) => {
        if (e2.key === "Enter") {
          e2.preventDefault();
          closePopover();
        } else if (e2.key === "Escape") {
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
    document.addEventListener("focusin", (e2) => {
      const el = e2.target;
      if (el instanceof HTMLInputElement && (el.id === "repo-ref" || el.id === "repo-target"))
        openPopover(el);
    });
    popSearch.addEventListener("input", () => buildPopBody(popSearch.value));
    popSearch.addEventListener("keydown", (e2) => {
      if (e2.key === "Escape") {
        closePopover();
      }
      if (e2.key === "Enter") {
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
    popBody.addEventListener("click", (e2) => {
      const item = e2.target.closest(".rp-item-commit, .rp-item-ref");
      if (!item)
        return;
      handlePicked(item.dataset.val);
    });
    popover.querySelectorAll(".rp-tab").forEach((t2) => {
      t2.addEventListener("click", () => {
        popTab = t2.dataset.tab || "commits";
        popover.querySelectorAll(".rp-tab").forEach((b2) => b2.classList.toggle("active", b2 === t2));
        buildPopBody(popSearch.value);
      });
    });
    popover.querySelectorAll(".rp-chip").forEach((c2) => {
      c2.addEventListener("click", () => handlePicked(c2.dataset.val));
    });
    document.addEventListener("mousedown", (e2) => {
      if (popover.hidden)
        return;
      const target = e2.target;
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
        cancelActiveSourceLoad("navigation");
        setPageMode();
        removeStandaloneSource();
        loadRepo();
        return;
      }
      if (STATE.route.screen !== "file") {
        cancelActiveSourceLoad("navigation");
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
    window.addEventListener("storage", (e2) => {
      if (e2.key === "gdp:syntax-highlight")
        setSyntaxHighlight(e2.newValue !== "0");
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
        invalidateRepoSidebar();
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
