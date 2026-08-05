import MarkdownIt from "markdown-it";
import type Renderer from "markdown-it/lib/renderer.mjs";
import type Token from "markdown-it/lib/token.mjs";
import markdownItAnchor from "markdown-it-anchor";
import markdownItFootnote from "markdown-it-footnote";
import { CHECK_16_PATHS, COPY_16_PATHS, iconSvg } from "./icons";
import { isImeComposing } from "./keyboard";
import { buildRawFileUrl, type SourceFileTarget } from "./routes";

/** Markdown 内リンクのクリックで開くリポジトリ内の行き先。GitHub の
 * markdown と同じく、md 以外のファイルとディレクトリも遷移先になる。 */
export type MarkdownNavigationTarget = {
  /** repo-relative path。空文字はリポジトリルート。 */
  path: string;
  ref: string;
  /** リンク末尾の #fragment (無ければ空文字)。 */
  hash: string;
  /** href が末尾スラッシュでディレクトリを明示していた。 */
  directory: boolean;
};

export type MarkdownPreviewOptions = {
  syntaxHighlight: boolean;
  signal?: AbortSignal;
  onNavigateMarkdown?: (target: MarkdownNavigationTarget) => void;
  resolveAssetUrl?: (path: string, rawSrc: string) => string | null;
};

import { loadMermaid, type MermaidApi } from "./mermaid-loader";
import { loadShikiHighlighter, type ShikiHighlighter } from "./shiki-loader";

// 後方互換のため re-export (外部 import が無いことは grep 確認済みだが、
// 公開済み export 型を黙って削除すると下流の型推論を壊しうる)。
export type { ShikiHighlighter };

const MARKDOWN_FENCE_LANG_ALIASES: Record<string, string> = {
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  shellscript: "bash",
  console: "bash",
  "shell-session": "bash",
  tf: "terraform",
  tfvars: "terraform",
  hcl: "terraform",
  gd: "gdscript",
  godot: "gdscript",
  yml: "yaml",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  text: "plaintext",
  txt: "plaintext",
};
const MARKDOWN_SHIKI_LANGS = Array.from(
  new Set([
    "astro",
    "bash",
    "c",
    "cpp",
    "csharp",
    "css",
    "dockerfile",
    "gdscript",
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
    "terraform",
    "toml",
    "tsx",
    "typescript",
    "vue",
    "xml",
    "yaml",
  ]),
);

const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
type AlertType = Lowercase<(typeof ALERT_TYPES)[number]>;
const ALERT_LABELS: Record<AlertType, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

// ai-dup-check: allow -- fn(string)→string と signature が偶然一致するだけ
// (makeId / s3ObjectName / blameShortSha 等)。本体は Markdown 見出しの
// kebab-case slug 生成で完全に別ドメイン。
export function markdownSlugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[\s　]+/g, "-")
      .replace(/[^\p{L}\p{N}\-_]/gu, "")
      .slice(0, 80) || "section"
  );
}

// GitHub 上で辿れる相対リンクは md 同士だけではない。ディレクトリ
// (`./sub/`)・md 以外のファイル (`./api.json`)・アンカー付き
// (`./guide.md#section`) も同じように辿れるので、md 拡張子で絞らずに
// リポジトリ内の行き先として解決する。ここで null を返したリンクは素の
// <a href> のまま残り、クリックすると SPA を抜けて 404 になる。
//
// ai-dup-check: allow -- ok:fn(string, string)→object|null と signature が
// 偶然一致するだけ (validateDbPath 等)。本体は Markdown 内の相対 href を
// repo-relative な行き先に解決する処理で別ドメイン。
export function resolveMarkdownLinkTarget(
  currentPath: string,
  href: string,
): Omit<MarkdownNavigationTarget, "ref"> | null {
  if (!href || href.startsWith("#")) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;
  const hashAt = href.indexOf("#");
  const hash = hashAt < 0 ? "" : href.slice(hashAt + 1);
  const cleanHref = (hashAt < 0 ? href : href.slice(0, hashAt)).replace(
    /\?.*$/,
    "",
  );
  if (!cleanHref) return null;
  const path = resolveRepoRelative(
    currentPath,
    decodeUriComponentSafe(cleanHref),
  );
  if (path == null) return null;
  return {
    path,
    hash: decodeUriComponentSafe(hash),
    directory: cleanHref.endsWith("/"),
  };
}

// ai-dup-check: allow -- fn(string, string)→null|string が偶然一致するだけ。
// 本体は Markdown 内の image/asset src を repo-relative ファイルパスに
// 解決する別ドメイン処理。
export function resolveMarkdownAssetPath(
  currentPath: string,
  src: string,
): string | null {
  if (!src || src.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src))
    return null;
  const cleanSrc = src.split(/[?#]/, 1)[0];
  return resolveRepoRelative(currentPath, cleanSrc);
}

/** Markdown 内の href/fragment は手書きなので、壊れた %xx で
 * decodeURIComponent が投げてもリンク解決ごと落とさない。 */
function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveRepoRelative(
  currentPath: string,
  requestedPath: string,
): string | null {
  const base = currentPath.split("/").slice(0, -1);
  const parts = [
    ...(requestedPath.startsWith("/") ? [] : base),
    ...requestedPath.split("/"),
  ].filter((part) => part && part !== ".");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (!resolved.length) return null;
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

function findNextInlineToken(tokens: Token[], start: number): number | null {
  for (let i = start + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "inline") return i;
    if (token.type === "blockquote_close") break;
  }
  return null;
}

function createMarkdownIt(
  target: SourceFileTarget,
  highlighter: ShikiHighlighter | null,
  signal?: AbortSignal,
  resolveAssetUrl?: (path: string, rawSrc: string) => string | null,
): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    highlight(code, lang) {
      const rawLanguage = (lang || "").trim().toLowerCase();
      const language = MARKDOWN_FENCE_LANG_ALIASES[rawLanguage] || rawLanguage;
      if (
        !signal?.aborted &&
        highlighter &&
        language &&
        MARKDOWN_SHIKI_LANGS.includes(language)
      ) {
        try {
          return highlighter.codeToHtml(code, {
            lang: language,
            themes: { light: "github-light", dark: "github-dark" },
            defaultColor: false,
          });
        } catch {
          // Fall through to escaped code.
        }
      }
      return `<pre><code>${md.utils.escapeHtml(code)}</code></pre>`;
    },
  });
  md.use(markdownItAnchor, {
    level: [1, 2, 3, 4, 5, 6],
    slugify: markdownSlugify,
    permalink: markdownItAnchor.permalink.linkInsideHeader({
      class: "anchor",
      symbol: "#",
      placement: "after",
      ariaHidden: true,
    }),
  });
  md.use(markdownItFootnote);
  md.core.ruler.after("inline", "gdp_task_lists", (state) => {
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type !== "inline" || !token.children?.length) continue;
      const first = token.children[0];
      if (first.type !== "text") continue;
      const match = first.content.match(/^\[([ xX])\]\s+/);
      if (!match) continue;
      first.content = first.content.slice(match[0].length);
      for (let j = i - 1; j >= 0; j--) {
        if (state.tokens[j].type === "list_item_open") {
          state.tokens[j].attrSet(
            "data-gdp-task",
            match[1].trim() ? "checked" : "unchecked",
          );
          break;
        }
      }
    }
  });
  md.core.ruler.after("inline", "gdp_line_breaks", (state) => {
    const brRe = /<br\s*\/?>/gi;
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children) continue;
      const children: Token[] = [];
      for (const child of token.children) {
        if (child.type !== "text") {
          children.push(child);
          continue;
        }
        const content = child.content;
        let lastIndex = 0;
        brRe.lastIndex = 0;
        for (
          let match = brRe.exec(content);
          match !== null;
          match = brRe.exec(content)
        ) {
          if (match.index > lastIndex) {
            const text = new state.Token("text", "", 0);
            text.content = content.slice(lastIndex, match.index);
            children.push(text);
          }
          const br = new state.Token("html_inline", "", 0);
          br.content = "<br>";
          children.push(br);
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < content.length) {
          const text = new state.Token("text", "", 0);
          text.content = content.slice(lastIndex);
          children.push(text);
        }
      }
      token.children = children;
    }
  });
  md.core.ruler.after("inline", "gdp_alerts", (state) => {
    const markerRe = new RegExp(`^\\[!(${ALERT_TYPES.join("|")})\\]\\s*`, "i");
    let i = 0;
    while (i < state.tokens.length) {
      const open = state.tokens[i];
      if (open.type !== "blockquote_open") {
        i++;
        continue;
      }
      const inlineIdx = findNextInlineToken(state.tokens, i);
      if (inlineIdx == null) {
        i++;
        continue;
      }
      const inline = state.tokens[inlineIdx];
      if (!inline.children?.length) {
        i++;
        continue;
      }
      const first = inline.children[0];
      if (first.type !== "text") {
        i++;
        continue;
      }
      const match = first.content.match(markerRe);
      if (!match) {
        i++;
        continue;
      }
      const type = match[1].toLowerCase() as AlertType;
      open.attrSet("class", `markdown-alert markdown-alert-${type}`);
      const rest = first.content.slice(match[0].length);
      if (rest) {
        first.content = rest;
      } else {
        inline.children.shift();
        if (inline.children[0]?.type === "softbreak") {
          inline.children.shift();
        }
        if (!inline.children.length) {
          const paraOpen = inlineIdx - 1;
          let paraClose = inlineIdx + 1;
          while (
            paraClose < state.tokens.length &&
            state.tokens[paraClose].type !== "blockquote_close" &&
            state.tokens[paraClose].type !== "paragraph_close"
          ) {
            paraClose++;
          }
          if (
            state.tokens[paraOpen]?.type === "paragraph_open" &&
            state.tokens[paraClose]?.type === "paragraph_close"
          ) {
            state.tokens.splice(paraOpen, paraClose - paraOpen + 1);
            i = paraOpen;
          }
        }
      }
      const title = new state.Token("html_block", "", 0);
      title.content = `<p class="markdown-alert-title">${ALERT_LABELS[type]}</p>\n`;
      title.block = true;
      state.tokens.splice(i + 1, 0, title);
      i += 2;
    }
  });

  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (info === "mermaid") {
      return (
        '<div class="mermaid" data-gdp-mermaid-source="' +
        md.utils.escapeHtml(token.content) +
        '">' +
        md.utils.escapeHtml(token.content) +
        "</div>"
      );
    }
    return fence
      ? fence(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };

  const image = md.renderer.rules.image || defaultRenderToken;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src") || "";
    const resolved = resolveMarkdownAssetPath(target.path, src);
    if (resolved) {
      const assetUrl = resolveAssetUrl
        ? resolveAssetUrl(resolved, src)
        : buildRawFileUrl({ path: resolved, ref: target.ref || "worktree" });
      if (assetUrl) token.attrSet("src", assetUrl);
    }
    token.attrSet("loading", "lazy");
    return image(tokens, idx, options, env, self);
  };

  const linkOpen = md.renderer.rules.link_open || defaultRenderToken;
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet("href") || "";
    const link = resolveMarkdownLinkTarget(target.path, href);
    if (link) {
      token.attrSet("href", "#");
      // path はリポジトリルートを指すとき空文字になる。属性の有無で拾える
      // よう、値ではなく data-gdp-md-link の存在で判定すること。
      token.attrSet("data-gdp-md-link", link.path);
      token.attrSet("data-gdp-md-ref", target.ref || "worktree");
      if (link.hash) token.attrSet("data-gdp-md-hash", link.hash);
      if (link.directory) token.attrSet("data-gdp-md-dir", "1");
    } else if (/^(?:https?:)?\/\//i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
    }
    return linkOpen(tokens, idx, options, env, self);
  };

  return md;
}

function defaultRenderToken(
  tokens: Token[],
  idx: number,
  options: Parameters<Renderer["renderToken"]>[2],
  _env: unknown,
  self: Renderer,
): string {
  return self.renderToken(tokens, idx, options);
}

export async function renderMarkdownPreview(
  textValue: string,
  target: SourceFileTarget,
  options: MarkdownPreviewOptions,
): Promise<HTMLElement> {
  const highlighter =
    options.syntaxHighlight && !options.signal?.aborted
      ? await loadMarkdownHighlighter()
      : null;
  const markdown = document.createElement("div");
  markdown.className = "gdp-markdown-preview markdown-body";
  if (options.signal?.aborted) return markdown;
  markdown.innerHTML = renderMarkdownHtml(
    textValue,
    target,
    highlighter,
    options.signal,
    options.resolveAssetUrl,
  );
  if (options.signal?.aborted) return markdown;
  enhanceTaskLists(markdown);
  enhanceCodeBlocks(markdown);
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

export function renderMarkdownHtml(
  textValue: string,
  target: SourceFileTarget,
  highlighter: ShikiHighlighter | null,
  signal?: AbortSignal,
  resolveAssetUrl?: (path: string, rawSrc: string) => string | null,
): string {
  const md = createMarkdownIt(target, highlighter, signal, resolveAssetUrl);
  const frontmatter = splitYamlFrontmatter(textValue);
  if (!frontmatter) return md.render(textValue);
  return (
    '<div class="gdp-markdown-frontmatter" data-gdp-frontmatter="yaml">' +
    md.render(`\`\`\`yaml\n${frontmatter.yaml}\n\`\`\`\n`) +
    "</div>" +
    md.render(frontmatter.body)
  );
}

function splitYamlFrontmatter(
  textValue: string,
): { yaml: string; body: string } | null {
  if (!textValue.startsWith("---\n") && !textValue.startsWith("---\r\n"))
    return null;
  const newline = textValue.startsWith("---\r\n") ? "\r\n" : "\n";
  const start = 3 + newline.length;
  const closing = textValue.indexOf(`${newline}---${newline}`, start);
  if (closing < 0) return null;
  return {
    yaml: textValue.slice(start, closing),
    body: textValue.slice(closing + newline.length + 3 + newline.length),
  };
}

export function loadMarkdownHighlighter(): Promise<ShikiHighlighter | null> {
  return loadShikiHighlighter({
    themes: ["github-light", "github-dark"],
    langs: MARKDOWN_SHIKI_LANGS,
  });
}

function enhanceTaskLists(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-gdp-task]").forEach((inline) => {
    const li = inline.closest("li");
    if (!li) return;
    li.classList.add("task-list-item");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.disabled = true;
    input.checked = inline.dataset.gdpTask === "checked";
    li.prepend(input);
    inline.removeAttribute("data-gdp-task");
  });
}

function enhanceCodeBlocks(root: HTMLElement) {
  root.querySelectorAll<HTMLPreElement>("pre").forEach((pre) => {
    const code = pre.querySelector<HTMLElement>("code");
    const text = code?.textContent ?? pre.textContent ?? "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mkdp-code-copy";
    button.setAttribute("aria-label", "Copy code");
    button.title = "Copy code";
    button.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        button.innerHTML = iconSvg("octicon-check", CHECK_16_PATHS);
        window.setTimeout(() => {
          button.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
        }, 1500);
      } catch {
        // Clipboard access can fail in insecure contexts; leave the button
        // untouched rather than spamming the console.
      }
    });
    pre.appendChild(button);
  });
}

function buildMarkdownToc(root: HTMLElement) {
  const entries = Array.from(
    root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id]"),
  )
    .map((heading) => ({
      id: heading.id,
      level: Number(heading.tagName.slice(1)),
      text: (heading.textContent || "").replace(/#$/, "").trim(),
    }))
    .filter((entry) => entry.id && entry.text);
  return entries;
}

function createMarkdownToc(
  entries: ReturnType<typeof buildMarkdownToc>,
): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "gdp-markdown-toc table-of-contents";
  nav.setAttribute("aria-label", "Markdown contents");
  const list = document.createElement("ul");
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.className = `level-${entry.level}`;
    const link = document.createElement("a");
    link.href = `#${encodeURIComponent(entry.id)}`;
    link.dataset.target = entry.id;
    link.textContent = entry.text;
    link.title = entry.text;
    item.appendChild(link);
    list.appendChild(item);
  });
  nav.appendChild(list);
  return nav;
}

function wireMarkdownInteractions(
  root: HTMLElement,
  target: SourceFileTarget,
  options: MarkdownPreviewOptions,
) {
  root.addEventListener("click", (e) => {
    const link = (e.target as Element | null)?.closest<HTMLAnchorElement>(
      "a[data-gdp-md-link]",
    );
    if (!link) return;
    // ルート宛リンクは path が空文字になるので !path で弾かない。
    const path = link.dataset.gdpMdLink;
    if (path == null) return;
    e.preventDefault();
    options.onNavigateMarkdown?.({
      path,
      ref: link.dataset.gdpMdRef || target.ref,
      hash: link.dataset.gdpMdHash || "",
      directory: link.dataset.gdpMdDir === "1",
    });
  });
  setupMarkdownScrollSpy(root);
  setupMermaidLightbox(root);
  renderMermaidDiagrams(root);
}

function setupMarkdownScrollSpy(root: HTMLElement) {
  const toc = root.querySelector<HTMLElement>(".gdp-markdown-toc");
  if (!toc) return;
  const entries = Array.from(
    toc.querySelectorAll<HTMLAnchorElement>("a[data-target]"),
  )
    .map((link) => ({
      link,
      target: root.querySelector<HTMLElement>(
        `#${CSS.escape(link.dataset.target || "")}`,
      ),
    }))
    .filter(
      (entry): entry is { link: HTMLAnchorElement; target: HTMLElement } =>
        !!entry.target,
    );
  if (!entries.length) return;

  toc.addEventListener("click", (e) => {
    const link = (e.target as Element | null)?.closest<HTMLAnchorElement>(
      "a[data-target]",
    );
    if (!link) return;
    const section = root.querySelector<HTMLElement>(
      `#${CSS.escape(link.dataset.target || "")}`,
    );
    if (!section) return;
    e.preventDefault();
    history.replaceState(
      history.state,
      "",
      `#${encodeURIComponent(section.id)}`,
    );
    scrollMarkdownSectionIntoView(section, "smooth");
  });

  const controller = new AbortController();
  const scrollRoot = document.scrollingElement || document.documentElement;
  let raf = 0;
  const cleanup = () => {
    controller.abort();
    if (raf) cancelAnimationFrame(raf);
  };
  const update = () => {
    raf = 0;
    if (!root.isConnected) {
      cleanup();
      return;
    }
    let active = entries[0];
    const activeThreshold = markdownAnchorOffset() + 40;
    for (const entry of entries) {
      if (entry.target.getBoundingClientRect().top <= activeThreshold)
        active = entry;
      else break;
    }
    // 末尾まで来たら最後の見出しを選ぶ。プレビューが独自のスクロール領域に
    // 置かれている場合、ページ側は動かないので、そちらを基準にする。
    const container = scrollableAncestor(root);
    const atBottom = container
      ? container.scrollTop + container.clientHeight >=
        container.scrollHeight - 4
      : window.innerHeight + scrollRoot.scrollTop >=
        scrollRoot.scrollHeight - 4;
    if (atBottom) {
      active = entries[entries.length - 1];
    }
    entries.forEach((entry) => {
      entry.link.classList.toggle("active", entry === active);
    });
    keepTocLinkVisible(toc, active.link);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  // scroll はバブルしないので、内側のスクロール領域 (tools ドロワーの出力
  // ペインなど) に置かれた場合も拾えるよう capture で受ける。
  document.addEventListener("scroll", schedule, {
    passive: true,
    capture: true,
    signal: controller.signal,
  });
  window.addEventListener("resize", schedule, { signal: controller.signal });
  setTimeout(() => {
    if (!root.isConnected) return;
    scrollInitialMarkdownHash(root);
    update();
  }, 0);
}

function scrollInitialMarkdownHash(root: HTMLElement) {
  if (!location.hash) return;
  const id = decodeHashFragment(location.hash);
  const section = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  if (!section) return;
  scrollMarkdownSectionIntoView(section, "auto");
}

function decodeHashFragment(hash: string): string {
  return decodeUriComponentSafe(hash.startsWith("#") ? hash.slice(1) : hash);
}

/** プレビューが独自のスクロール領域 (tools ドロワーの出力ペインなど) に
 * 置かれている場合の、実際に動かすべきコンテナ。無ければ null (= window)。 */
function scrollableAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight
    )
      return node;
  }
  return null;
}

function scrollMarkdownSectionIntoView(
  section: HTMLElement,
  behavior: ScrollBehavior,
) {
  const container = scrollableAncestor(section);
  if (container) {
    const top =
      section.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      12;
    container.scrollTo({ top: Math.max(0, top), behavior });
    return;
  }
  const top =
    section.getBoundingClientRect().top +
    window.scrollY -
    markdownAnchorOffset() -
    12;
  window.scrollTo({ top: Math.max(0, top), behavior });
}

function markdownAnchorOffset(): number {
  const bottoms = Array.from(
    document.querySelectorAll<HTMLElement>(
      "#global-header, .gdp-file-detail-sticky",
    ),
  )
    .map((element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return 0;
      const rect = element.getBoundingClientRect();
      if (rect.height <= 0) return 0;
      return rect.bottom > 0 ? rect.bottom : 0;
    })
    .filter((bottom) => Number.isFinite(bottom));
  return Math.max(0, ...bottoms);
}

function keepTocLinkVisible(toc: HTMLElement, link: HTMLElement) {
  if (toc.scrollHeight <= toc.clientHeight) return;
  const top = link.offsetTop;
  const bottom = top + link.offsetHeight;
  if (top < toc.scrollTop) toc.scrollTop = Math.max(0, top - 8);
  else if (bottom > toc.scrollTop + toc.clientHeight)
    toc.scrollTop = bottom - toc.clientHeight + 8;
}

function setupMermaidLightbox(root: HTMLElement) {
  root.addEventListener("click", (e) => {
    const mermaid = (e.target as Element | null)?.closest<HTMLElement>(
      ".markdown-body .mermaid",
    );
    if (!mermaid || (e.target as Element | null)?.closest("a")) return;
    const svg = mermaid.querySelector<SVGSVGElement>("svg");
    if (!svg) return;
    e.preventDefault();
    openMermaidLightbox(svg);
  });
}

async function renderMermaidDiagrams(root: HTMLElement) {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(".markdown-body .mermaid"),
  );
  if (!nodes.length) return;
  const mermaid = await loadMermaid();
  if (!mermaid) return;
  try {
    await mermaid.run({ nodes, suppressErrors: true });
  } catch {
    // Error details are rendered per node below.
  }
  for (const node of nodes) {
    if (
      node.querySelector("svg") &&
      !isMermaidErrorSvg(node.querySelector("svg"))
    )
      continue;
    await renderMermaidError(node, mermaid);
  }
}

function isMermaidErrorSvg(svg: SVGSVGElement | null): boolean {
  return !!svg && /Syntax error/i.test(svg.textContent || "");
}

async function renderMermaidError(node: HTMLElement, mermaid: MermaidApi) {
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

function openMermaidLightbox(originalSvg: SVGSVGElement) {
  if (document.querySelector(".mkdp-lightbox")) return;
  const overlay = document.createElement("div");
  overlay.className = "mkdp-lightbox";
  const stage = document.createElement("div");
  stage.className = "mkdp-lightbox-stage";
  const svg = originalSvg.cloneNode(true) as SVGSVGElement;
  svg.removeAttribute("style");
  stage.appendChild(svg);
  overlay.appendChild(stage);
  const toolbar = document.createElement("div");
  toolbar.className = "mkdp-lightbox-toolbar";
  overlay.appendChild(toolbar);
  const hint = document.createElement("div");
  hint.className = "mkdp-lightbox-hint";
  hint.textContent =
    "drag to pan · wheel to zoom · double-click to fit · ESC to close";
  overlay.appendChild(hint);
  document.body.appendChild(overlay);

  const bbox = safeSvgBox(svg);
  let scale = 1;
  let tx = 0;
  let ty = 0;
  const apply = () => {
    svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };
  const fitImage = () => {
    const vw = Math.max(1, window.innerWidth - 128);
    const vh = Math.max(1, window.innerHeight - 128);
    scale = Math.min(vw / bbox.width, vh / bbox.height, 4);
    tx = (-scale * bbox.width) / 2;
    ty = (-scale * bbox.height) / 2;
    apply();
  };
  const zoomAt = (mx: number, my: number, factor: number) => {
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
  const zoomCentered = (factor: number) =>
    zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor);
  const button = (label: string, title: string, fn: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
    toolbar.appendChild(b);
  };
  const close = () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("resize", fitImage);
    overlay.remove();
  };
  button("+", "zoom in", () => zoomCentered(1.25));
  button("-", "zoom out", () => zoomCentered(1 / 1.25));
  button("fit", "fit", fitImage);
  button("x", "close", close);

  overlay.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    },
    { passive: false },
  );

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  overlay.addEventListener("mousedown", (e) => {
    if ((e.target as Element).closest(".mkdp-lightbox-toolbar")) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    overlay.classList.add("dragging");
  });
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  };
  const onUp = () => {
    dragging = false;
    overlay.classList.remove("dragging");
  };
  const onKey = (e: KeyboardEvent) => {
    if (isImeComposing(e)) return;
    if (e.key === "Escape") close();
    else if (e.key === "0") fitImage();
    else if (e.key === "+" || e.key === "=") zoomCentered(1.25);
    else if (e.key === "-") zoomCentered(1 / 1.25);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", fitImage);
  overlay.addEventListener("dblclick", (e) => {
    if (!(e.target as Element).closest(".mkdp-lightbox-toolbar")) fitImage();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target === stage) close();
  });
  fitImage();
}

function safeSvgBox(svg: SVGSVGElement): { width: number; height: number } {
  try {
    const box = svg.getBBox();
    if (box.width > 0 && box.height > 0) {
      svg.setAttribute(
        "viewBox",
        `${box.x} ${box.y} ${box.width} ${box.height}`,
      );
      svg.setAttribute("width", String(box.width));
      svg.setAttribute("height", String(box.height));
      return { width: box.width, height: box.height };
    }
  } catch {
    // Use layout fallback below.
  }
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 800, height: rect.height || 600 };
}
