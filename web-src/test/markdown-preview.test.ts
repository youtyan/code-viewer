import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  markdownSlugify,
  renderMarkdownHtml,
  resolveMarkdownAssetPath,
  resolveMarkdownRelativePath,
} from "../markdown-preview";
import { sourceFixture } from "./source-fixture";

const app = sourceFixture(
  readFileSync(new URL("../app.ts", import.meta.url), "utf8"),
);
const markdown = sourceFixture(
  readFileSync(new URL("../markdown-preview.ts", import.meta.url), "utf8"),
);
const server = sourceFixture(
  readFileSync(new URL("../server/preview.ts", import.meta.url), "utf8"),
);
const style = sourceFixture(
  readFileSync(new URL("../../web/style.css", import.meta.url), "utf8"),
);
const pkg = readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
);

describe("markdown preview", () => {
  test("uses markdown-it with raw HTML disabled and repository-aware overrides", () => {
    expect(markdown.includes("html: false")).toBe(true);
    expect(markdown.includes("linkify: true")).toBe(true);
    expect(markdown.includes("md.use(markdownItAnchor")).toBe(true);
    expect(markdown.includes("md.use(markdownItFootnote)")).toBe(true);
    expect(markdown.includes("data-gdp-md-link")).toBe(true);
    expect(
      markdown.includes(
        "buildRawFileUrl({ path: resolved, ref: target.ref || 'worktree' })",
      ),
    ).toBe(true);
    expect(markdown.includes('target", "_blank"')).toBe(true);
    expect(markdown.includes('rel", "noopener noreferrer"')).toBe(true);
  });

  test("resolves relative markdown links inside the repository", () => {
    expect(
      resolveMarkdownRelativePath("docs/guide/intro.md", "./next.md"),
    ).toBe("docs/guide/next.md");
    expect(
      resolveMarkdownRelativePath(
        "docs/guide/intro.md",
        "../README.markdown#top",
      ),
    ).toBe("docs/README.markdown");
    expect(
      resolveMarkdownRelativePath(
        "docs/guide/intro.md",
        "https://example.com/a.md",
      ),
    ).toBe(null);
    expect(
      resolveMarkdownRelativePath("docs/guide/intro.md", "./image.png"),
    ).toBe(null);
    expect(
      resolveMarkdownRelativePath("docs/guide/intro.md", "../../../README.md"),
    ).toBe(null);
  });

  test("resolves relative markdown image assets through raw file URLs", () => {
    expect(
      resolveMarkdownAssetPath("docs/guide/intro.md", "./img/screen.png"),
    ).toBe("docs/guide/img/screen.png");
    expect(
      resolveMarkdownAssetPath(
        "docs/guide/intro.md",
        "../assets/logo.svg?raw=1",
      ),
    ).toBe("docs/assets/logo.svg");
    expect(
      resolveMarkdownAssetPath("docs/guide/intro.md", "/img/logo.svg"),
    ).toBe("img/logo.svg");
    expect(
      resolveMarkdownAssetPath(
        "docs/guide/intro.md",
        "https://example.com/logo.png",
      ),
    ).toBe(null);
    expect(
      resolveMarkdownAssetPath("docs/guide/intro.md", "../../../etc/passwd"),
    ).toBe(null);
  });

  test("renders task lists as list items that can be enhanced after parsing", () => {
    const html = renderMarkdownHtml(
      "- [x] done\n- [ ] todo\n",
      { path: "README.md", ref: "worktree" },
      null,
    );
    expect(html.includes('<li data-gdp-task="checked">done</li>')).toBe(true);
    expect(html.includes('<li data-gdp-task="unchecked">todo</li>')).toBe(true);
  });

  test("renders skill-style YAML frontmatter as highlighted metadata before the body", () => {
    const seen: string[] = [];
    const highlighter = {
      codeToHtml: (code: string, options: { lang: string }) => {
        seen.push(options.lang);
        return (
          '<pre class="shiki"><code><span class="line" data-lang="' +
          options.lang +
          '">' +
          code +
          "</span></code></pre>"
        );
      },
    };
    const html = renderMarkdownHtml(
      "---\nname: my-original-psd-avatar-creation\ndescription: Use when creating an original 2D talking avatar character\n---\n# Body\n",
      { path: ".agents/skills/avatar/SKILL.md", ref: "worktree" },
      highlighter,
    );
    expect(seen).toEqual(["yaml"]);
    expect(html.includes('data-gdp-frontmatter="yaml"')).toBe(true);
    expect(html.includes("name: my-original-psd-avatar-creation")).toBe(true);
    expect(html.includes('<h1 id="body"')).toBe(true);
    expect(html.includes("<hr>")).toBe(false);
  });

  test("renders highlighted code blocks with Shiki markup", () => {
    const highlighter = {
      codeToHtml: (code: string, options: { lang: string }) =>
        '<pre class="shiki"><code><span class="line" data-lang="' +
        options.lang +
        '">' +
        code +
        "</span></code></pre>",
    };
    const html = renderMarkdownHtml(
      "```ts\nconst value = 1;\n```",
      { path: "README.md", ref: "worktree" },
      highlighter,
    );
    expect(html.includes('<pre class="shiki">')).toBe(true);
    expect(html.includes('data-lang="typescript"')).toBe(true);
  });

  test("normalizes common fenced language aliases before Shiki rendering", () => {
    const seen: string[] = [];
    const highlighter = {
      codeToHtml: (_code: string, options: { lang: string }) => {
        seen.push(options.lang);
        return '<pre class="shiki"><code><span class="line">echo hello</span></code></pre>';
      },
    };
    const html = renderMarkdownHtml(
      "```sh\necho hello\n```",
      { path: "README.md", ref: "worktree" },
      highlighter,
    );
    expect(seen).toEqual(["bash"]);
    expect(html.includes('class="shiki"')).toBe(true);
  });

  test("normalizes TypeScript and JSX-style fenced language aliases", () => {
    const seen: string[] = [];
    const highlighter = {
      codeToHtml: (_code: string, options: { lang: string }) => {
        seen.push(options.lang);
        return '<pre class="shiki"><code><span class="line">return value;</span></code></pre>';
      },
    };
    renderMarkdownHtml(
      "```tsx\nreturn value;\n```",
      { path: "README.md", ref: "worktree" },
      highlighter,
    );
    renderMarkdownHtml(
      "```jsx\nreturn value;\n```",
      { path: "README.md", ref: "worktree" },
      highlighter,
    );
    expect(seen).toEqual(["typescript", "javascript"]);
  });

  test("slugifies Japanese and duplicate-safe heading ids deterministically", () => {
    expect(markdownSlugify("Hello World!")).toBe("hello-world");
    expect(markdownSlugify("日本語 見出し")).toBe("日本語-見出し");
    expect(markdownSlugify("***")).toBe("section");
  });

  test("markdown TOC includes h4 headings and exposes link titles", () => {
    expect(
      markdown.includes(
        'root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id]")',
      ),
    ).toBe(true);
    expect(markdown.includes("link.title = entry.text")).toBe(true);
  });

  test("app wires markdown preview into README and file detail previews", () => {
    expect(
      app.includes(
        "import { renderMarkdownPreview } from './markdown-preview'",
      ),
    ).toBe(true);
    expect(app.includes("onNavigateMarkdown: (path, ref) => {")).toBe(true);
    expect(
      app.includes(
        "setRoute({ screen: 'file', path, ref, view: 'blob', range: currentRange() })",
      ),
    ).toBe(true);
    expect(
      app.includes(
        "createSourceTabs(previewable ? 'preview' : 'code', textValue)",
      ),
    ).toBe(true);
    expect(
      app.includes("async function renderRepo(meta: RepoTreeResponse)"),
    ).toBe(true);
    expect(app.includes("await renderMarkdownPreview")).toBe(true);
    expect(app.includes("syntaxHighlight: STATE.syntaxHighlight")).toBe(true);
  });

  test("mermaid is built as a lazy standalone asset and served by the preview server", () => {
    expect(pkg.includes("web/mermaid.js")).toBe(true);
    expect(pkg.includes("web-src/mermaid-entry.ts")).toBe(true);
    expect(
      server.includes(
        "'/mermaid.js': ['mermaid.js', 'application/javascript; charset=utf-8']",
      ),
    ).toBe(true);
    expect(markdown.includes("import('/' + 'mermaid.js')")).toBe(true);
    expect(markdown.includes("securityLevel: 'strict'")).toBe(true);
    expect(markdown.includes("openMermaidLightbox")).toBe(true);
    expect(markdown.includes("renderMermaidError")).toBe(true);
  });

  test("Shiki is built as a lazy standalone asset for markdown code blocks", () => {
    expect(pkg.includes("web/shiki.js")).toBe(true);
    expect(pkg.includes("web-src/shiki-entry.ts")).toBe(true);
    expect(pkg.includes('"shiki"')).toBe(true);
    expect(
      server.includes(
        "'/shiki.js': ['shiki.js', 'application/javascript; charset=utf-8']",
      ),
    ).toBe(true);
    expect(markdown.includes("import('/' + 'shiki.js')")).toBe(true);
    expect(markdown.includes("'github-light', 'github-dark'")).toBe(true);
  });

  test("markdown preview CSS includes TOC, tables, mermaid, and lightbox styling", () => {
    expect(style.includes(".gdp-markdown-layout")).toBe(true);
    expect(style.includes(".gdp-markdown-toc")).toBe(true);
    expect(style.includes(".gdp-standalone-source .gdp-markdown-toc")).toBe(
      false,
    );
    expect(style.includes(".gdp-standalone-source .gdp-markdown-layout")).toBe(
      false,
    );
    expect(style.includes(".gdp-markdown-layout {\n  display: grid;")).toBe(
      true,
    );
    expect(style.includes('content: "On this page";')).toBe(true);
    expect(style.includes("top: calc(var(--global-header-h) + 16px);")).toBe(
      true,
    );
    expect(
      style.includes(
        "max-height: calc(100vh - var(--global-header-h) - 40px);",
      ),
    ).toBe(true);
    expect(style.includes("scrollbar-gutter: stable;")).toBe(true);
    expect(style.includes("scrollbar-width: thin;")).toBe(true);
    expect(style.includes("-webkit-line-clamp: 2;")).toBe(true);
    expect(style.includes(".gdp-markdown-toc a:focus-visible")).toBe(true);
    expect(style.includes(".gdp-markdown-toc .level-4 > a")).toBe(true);
    expect(
      style.includes(
        ".gdp-markdown-toc a.active {\n  background: var(--accent-subtle);\n  border-left-color: var(--accent);\n  color: var(--fg);",
      ),
    ).toBe(true);
    expect(style.includes(".gdp-markdown-preview table")).toBe(true);
    expect(style.includes(".gdp-markdown-preview .mermaid")).toBe(true);
    expect(style.includes(".mkdp-lightbox")).toBe(true);
    expect(style.includes(".mkdp-mermaid-error")).toBe(true);
  });

  test("preview/code tabs can hide either rendered surface despite display-specific CSS", () => {
    expect(style.includes(".gdp-markdown-layout[hidden]")).toBe(true);
    expect(style.includes(".gdp-source-table[hidden]")).toBe(true);
    expect(style.includes("display: none !important")).toBe(true);
  });

  test("markdown preview applies Shiki light and dark theme variables", () => {
    expect(style.includes(".gdp-markdown-preview pre.shiki")).toBe(true);
    expect(style.includes("var(--shiki-light-bg)")).toBe(true);
    expect(style.includes("var(--shiki-dark-bg)")).toBe(true);
    expect(
      style.includes(
        '[data-theme="dark"] .gdp-markdown-preview pre.shiki span',
      ),
    ).toBe(true);
  });
});
