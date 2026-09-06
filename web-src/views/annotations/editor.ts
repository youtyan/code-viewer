import {
  renderMarkdownHtml,
  type ShikiHighlighter,
} from "../../core/markdown-preview";
import type { AppRoute, DiffRange } from "../../core/routes";
import type {
  AnnotationEntry,
  AnnotationSession,
  AnnotationTarget,
} from "../../core/types";
import { annotationText } from "./i18n";

type EditorDeps = {
  container: HTMLElement;
  entry?: AnnotationEntry;
  target: Extract<AnnotationTarget, { kind: "database" }> | null;
  route: AppRoute;
  range: DiffRange;
  sessions: AnnotationSession[];
  sessionId: string | null;
  getLanguage(): "en" | "ja";
  getHighlighter(): ShikiHighlighter | null;
  save(payload: Record<string, unknown>): Promise<void>;
  cancel(): void;
  reportError(error: unknown): void;
};

/** One form owns its inputs until save succeeds; background refreshes never reconstruct it. */
export function createAnnotationEditor(deps: EditorDeps) {
  const t = () => annotationText(deps.getLanguage());
  const form = document.createElement("form");
  form.className = "annotation-edit-form";
  form.noValidate = true;
  const fields = document.createElement("fieldset");
  fields.className = "annotation-edit-fields";
  const labels: Array<() => void> = [];
  function label(control: HTMLElement, text: () => string) {
    const wrapper = document.createElement("label");
    const name = document.createElement("span");
    labels.push(() => {
      name.textContent = text();
    });
    wrapper.append(name, control);
    return wrapper;
  }
  const entry = deps.entry;
  const sessionSelect = document.createElement("select");
  sessionSelect.name = "session";
  for (const session of deps.sessions) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = session.title;
    sessionSelect.append(option);
  }
  const newSessionOption = document.createElement("option");
  newSessionOption.value = "";
  sessionSelect.add(newSessionOption);
  sessionSelect.value = deps.sessionId || "";
  const sessionName = document.createElement("input");
  sessionName.name = "sessionName";
  sessionName.required = true;
  sessionName.value = t().defaultSession;
  const sessionNameLabel = label(sessionName, () => t().sessionName);
  function syncSessionName() {
    sessionNameLabel.hidden = !!sessionSelect.value;
    sessionName.disabled = !!sessionSelect.value;
  }
  sessionSelect.addEventListener("change", syncSessionName);
  syncSessionName();
  if (!entry)
    fields.append(
      label(sessionSelect, () => t().session),
      sessionNameLabel,
    );

  const path = document.createElement("input");
  path.name = "path";
  path.required = !deps.target && !entry;
  path.value =
    deps.route.screen === "file" || deps.route.screen === "diff"
      ? deps.route.path || ""
      : "";
  const start = document.createElement("input");
  const end = document.createElement("input");
  for (const input of [start, end]) {
    input.type = "number";
    input.min = "1";
    input.step = "1";
  }
  start.name = "start";
  end.name = "end";
  const line =
    deps.route.screen === "file" || deps.route.screen === "diff"
      ? deps.route.line
      : undefined;
  if (line) {
    start.value = String(typeof line === "number" ? line : line.start);
    end.value = String(typeof line === "number" ? line : line.end);
  }
  function validateLines() {
    end.setCustomValidity(
      end.value && !start.value
        ? t().lineStart
        : start.value && end.value && end.valueAsNumber < start.valueAsNumber
          ? t().lineOrder
          : "",
    );
  }
  start.addEventListener("input", validateLines);
  end.addEventListener("input", validateLines);
  const lineFields = document.createElement("div");
  lineFields.className = "annotation-line-fields";
  lineFields.append(
    label(start, () => t().start),
    label(end, () => t().end),
  );
  if (!entry && !deps.target)
    fields.append(
      label(path, () => t().path),
      lineFields,
    );

  const title = document.createElement("input");
  title.name = "title";
  title.value = entry?.title || "";
  fields.append(label(title, () => `${t().title} · ${t().optional}`));
  const tabs = document.createElement("div");
  tabs.className = "annotation-editor-tabs";
  const write = document.createElement("button");
  const preview = document.createElement("button");
  for (const button of [write, preview]) button.type = "button";
  const body = document.createElement("textarea");
  body.name = "body";
  body.rows = 10;
  body.required = true;
  body.value = entry?.body || "";
  body.addEventListener("input", () => {
    body.setCustomValidity("");
  });
  const rendered = document.createElement("div");
  rendered.className = "annotation-editor-preview markdown-body";
  rendered.hidden = true;
  rendered.tabIndex = 0;
  const context = () => ({
    path: entry?.path || path.value,
    ref: entry?.range.to || deps.range.to,
  });
  function showPreview(show: boolean) {
    // The textarea remains mounted so switching tabs preserves selection and undo history.
    body.hidden = show;
    rendered.hidden = !show;
    write.setAttribute("aria-pressed", String(!show));
    preview.setAttribute("aria-pressed", String(show));
    if (show) {
      rendered.innerHTML = renderMarkdownHtml(
        body.value || t().previewEmpty,
        context(),
        deps.getHighlighter(),
      );
    }
  }
  write.addEventListener("click", () => {
    showPreview(false);
    body.focus();
  });
  preview.addEventListener("click", () => showPreview(true));
  tabs.append(write, preview);
  const content = document.createElement("div");
  content.className = "annotation-editor-content";
  content.append(tabs, body, rendered);
  fields.append(content);
  const buttons = document.createElement("div");
  buttons.className = "annotation-edit-buttons";
  const shortcut = document.createElement("small");
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "gdp-btn gdp-btn-sm annotation-primary";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "gdp-btn gdp-btn-sm";
  cancel.addEventListener("click", deps.cancel);
  buttons.append(shortcut, cancel, save);
  form.append(fields, buttons);
  deps.container.replaceChildren(form);
  const initialValues = () =>
    [
      sessionSelect.value,
      sessionName.value,
      path.value,
      start.value,
      end.value,
      title.value,
      body.value,
    ].join("\u0000");
  const initial = initialValues();
  let saving = false;
  function localize() {
    for (const update of labels) update();
    newSessionOption.textContent = t().newSession;
    path.placeholder = t().pathPlaceholder;
    start.placeholder = t().wholeFile;
    body.placeholder = t().bodyPlaceholder;
    body.setAttribute("aria-label", t().body);
    rendered.setAttribute("aria-label", t().preview);
    write.textContent = t().write;
    preview.textContent = t().preview;
    save.textContent = saving ? t().saving : t().save;
    cancel.textContent = t().cancel;
    shortcut.textContent = t().shortcut;
  }
  async function submit() {
    if (saving) return;
    validateLines();
    body.setCustomValidity(body.value.trim() ? "" : t().bodyRequired);
    if (!form.checkValidity()) {
      showPreview(false);
      form.reportValidity();
      return;
    }
    saving = true;
    fields.disabled = true;
    save.disabled = true;
    cancel.disabled = true;
    localize();
    const payload = entry
      ? { action: "update", id: entry.id, title: title.value, body: body.value }
      : {
          action: "add",
          session_id: sessionSelect.value || undefined,
          session_title: sessionSelect.value ? undefined : sessionName.value,
          target: deps.target || undefined,
          path: deps.target ? undefined : path.value.trim(),
          line:
            !deps.target && start.value
              ? {
                  start: start.valueAsNumber,
                  end: end.value ? end.valueAsNumber : start.valueAsNumber,
                }
              : undefined,
          range: deps.range,
          title: title.value,
          body: body.value,
        };
    try {
      await deps.save(payload);
    } catch (error) {
      deps.reportError(error);
    } finally {
      saving = false;
      fields.disabled = false;
      save.disabled = false;
      cancel.disabled = false;
      localize();
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });
  form.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  });
  localize();
  showPreview(false);
  (path.required && !path.value ? path : body).focus();
  return {
    localize,
    isDirty: () => initialValues() !== initial,
    isSaving: () => saving,
    focus: () => body.focus(),
  };
}
