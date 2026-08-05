import { createMediaPlayer } from "./media-player";

export function renderHtmlPreviewFrame(
  title: string,
  html: string,
  extraClass = "",
): HTMLElement {
  const preview = document.createElement("div");
  preview.className = ["gdp-html-preview", extraClass]
    .filter(Boolean)
    .join(" ");
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.sandbox.value = "";
  frame.referrerPolicy = "no-referrer";
  frame.srcdoc = html;
  preview.appendChild(frame);
  return preview;
}

export function appendMediaEmbed(
  view: HTMLElement,
  opts: {
    url: string;
    kind: string;
    title: string;
    onImageLoad?: (img: HTMLImageElement) => void;
  },
): void {
  if (opts.kind === "video" || opts.kind === "audio") {
    view.appendChild(createMediaPlayer(opts.url, opts.kind, opts.title));
  } else if (opts.kind === "pdf") {
    const frame = document.createElement("iframe");
    frame.src = opts.url;
    frame.title = opts.title;
    frame.loading = "lazy";
    view.appendChild(frame);
  } else {
    const img = document.createElement("img");
    img.src = opts.url;
    img.alt = "";
    if (opts.onImageLoad) {
      img.addEventListener("load", () => opts.onImageLoad?.(img), {
        once: true,
      });
    }
    view.appendChild(img);
  }
}

export function renderUnsupportedPreview(opts: {
  className?: string;
  message: string;
  extraChildren?: Node[];
}): HTMLElement {
  const view = document.createElement("div");
  view.className = ["gdp-source-viewer unsupported", opts.className || ""]
    .filter(Boolean)
    .join(" ");
  const content = document.createElement("div");
  content.className = "gdp-source-unsupported-content";
  const title = document.createElement("strong");
  title.className = "gdp-source-unsupported-title";
  title.textContent = "Preview unavailable";
  const message = document.createElement("div");
  message.className = "gdp-source-unsupported-message";
  message.textContent = opts.message;
  content.append(title, message, ...(opts.extraChildren || []));
  view.appendChild(content);
  return view;
}
