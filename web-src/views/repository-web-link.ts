import { html, type TemplateResult } from "lit/html.js";
import { MARK_GITHUB_16_PATH, OPEN_EXTERNAL_16_PATH } from "../core/icons";
import type { RepositoryWebTarget } from "../core/repository-web-url";
import { iconTemplate } from "./ui/icon";
import { templateElement } from "./ui/renderer";

/** リポジトリの Web の画面 (GitHub など) を開くリンク。 */
export function repositoryWebLinkTemplate(
  target: RepositoryWebTarget,
  label: string,
): TemplateResult {
  const github = target.provider === "github";
  return html`<a
    class="gdp-btn gdp-btn-sm gdp-repo-web-link"
    href=${target.url}
    target="_blank"
    rel="noopener"
    title=${label}
    aria-label=${label}
  >${iconTemplate(
    github ? MARK_GITHUB_16_PATH : OPEN_EXTERNAL_16_PATH,
    github ? "octicon-mark-github" : "octicon-link-external",
  )}<span>${label}</span></a>`;
}

/** まだ命令的に組む呼び手へ渡す形。 */
export function createRepositoryWebLink(
  target: RepositoryWebTarget,
  label: string,
): HTMLAnchorElement {
  return templateElement<HTMLAnchorElement>(
    repositoryWebLinkTemplate(target, label),
  );
}
