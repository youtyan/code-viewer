import {
  iconSvg,
  MARK_GITHUB_16_PATH,
  OPEN_EXTERNAL_16_PATH,
} from "../core/icons";
import type { RepositoryWebTarget } from "../core/repository-web-url";

export function createRepositoryWebLink(
  target: RepositoryWebTarget,
  label: string,
): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "gdp-btn gdp-btn-sm gdp-repo-web-link";
  link.href = target.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.title = label;
  link.setAttribute("aria-label", label);
  link.innerHTML = `${iconSvg(
    target.provider === "github"
      ? "octicon-mark-github"
      : "octicon-link-external",
    target.provider === "github" ? MARK_GITHUB_16_PATH : OPEN_EXTERNAL_16_PATH,
  )}<span>${label}</span>`;
  return link;
}
