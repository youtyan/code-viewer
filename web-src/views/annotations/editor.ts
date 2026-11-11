import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html, nothing } from "lit/html.js";
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
import { detachedElement } from "../ui/renderer";
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

/** 注釈を書く画面 (createAnnotationEditor) の中。値は欄が持ち、最初の値だけを渡す。 */
export type AnnotationEditorProps = {
  saving: boolean;
  /** 新しく書くときだけ (どのセッションに足すか)。 */
  session: {
    label: string;
    options: { id: string; title: string; selected: boolean }[];
    newLabel: string;
    onChange(value: string): void;
    name: { label: string; hidden: boolean; defaultValue: string };
  } | null;
  /** 新しく書くとき、データストアでなければ (ファイルと行)。 */
  location: {
    path: {
      label: string;
      placeholder: string;
      required: boolean;
      defaultValue: string;
    };
    start: { label: string; placeholder: string; defaultValue: string };
    end: { label: string; defaultValue: string };
    onLineInput(): void;
  } | null;
  title: { label: string; defaultValue: string };
  tabs: {
    write: string;
    preview: string;
    previewing: boolean;
    onWrite(): void;
    onPreview(): void;
  };
  body: {
    label: string;
    placeholder: string;
    defaultValue: string;
    onInput(): void;
  };
  preview: { label: string; html: string };
  shortcut: string;
  cancel: { label: string; onClick(): void };
  save: string;
  onSubmit(event: Event): void;
  onKeyDown(event: KeyboardEvent): void;
};

export type AnnotationEditorView = (props: AnnotationEditorProps) => unknown;

const labeled = (text: string, control: unknown, hidden = false) =>
  html`<label ?hidden=${hidden}><span>${text}</span>${control}</label>`;

export const DEFAULT_VIEW: AnnotationEditorView = (props) => html`<form
  class="annotation-edit-form"
  novalidate
  @submit=${props.onSubmit}
  @keydown=${props.onKeyDown}
><fieldset class="annotation-edit-fields" ?disabled=${props.saving}>${
  props.session
    ? html`${labeled(
        props.session.label,
        html`<select
          name="session"
          @change=${(event: Event) =>
            props.session?.onChange(
              (event.currentTarget as HTMLSelectElement).value,
            )}
        >${props.session.options.map(
          (option) =>
            html`<option value=${option.id} ?selected=${option.selected}
              >${option.title}</option
            >`,
        )}<option
            value=""
            ?selected=${!props.session.options.some((option) => option.selected)}
          >${props.session.newLabel}</option
        ></select>`,
      )}${labeled(
        props.session.name.label,
        html`<input
          name="sessionName"
          required
          value=${props.session.name.defaultValue}
          ?disabled=${props.session.name.hidden}
        />`,
        props.session.name.hidden,
      )}`
    : nothing
}${
  props.location
    ? html`${labeled(
        props.location.path.label,
        html`<input
          name="path"
          ?required=${props.location.path.required}
          placeholder=${props.location.path.placeholder}
          value=${props.location.path.defaultValue}
        />`,
      )}<div class="annotation-line-fields">${labeled(
        props.location.start.label,
        html`<input
          type="number"
          min="1"
          step="1"
          name="start"
          placeholder=${props.location.start.placeholder}
          value=${props.location.start.defaultValue}
          @input=${props.location.onLineInput}
        />`,
      )}${labeled(
        props.location.end.label,
        html`<input
          type="number"
          min="1"
          step="1"
          name="end"
          value=${props.location.end.defaultValue}
          @input=${props.location.onLineInput}
        />`,
      )}</div>`
    : nothing
}${labeled(
  props.title.label,
  html`<input name="title" value=${props.title.defaultValue} />`,
)}<div class="annotation-editor-content"><div class="annotation-editor-tabs"
      ><button
        type="button"
        aria-pressed=${String(!props.tabs.previewing)}
        @click=${props.tabs.onWrite}
      >${props.tabs.write}</button><button
        type="button"
        aria-pressed=${String(props.tabs.previewing)}
        @click=${props.tabs.onPreview}
      >${props.tabs.preview}</button></div
    ><textarea
      name="body"
      rows="10"
      required
      placeholder=${props.body.placeholder}
      aria-label=${props.body.label}
      ?hidden=${props.tabs.previewing}
      .value=${props.body.defaultValue}
      @input=${props.body.onInput}
    ></textarea><div
      class="annotation-editor-preview markdown-body"
      tabindex="0"
      aria-label=${props.preview.label}
      ?hidden=${!props.tabs.previewing}
    >${unsafeHTML(props.preview.html)}</div></div></fieldset
  ><div class="annotation-edit-buttons"><small>${props.shortcut}</small><button
      type="button"
      class="gdp-btn gdp-btn-sm"
      ?disabled=${props.saving}
      @click=${props.cancel.onClick}
    >${props.cancel.label}</button><button
      type="submit"
      class="gdp-btn gdp-btn-sm annotation-primary"
      ?disabled=${props.saving}
    >${props.save}</button></div></form>`;

/** One form owns its inputs until save succeeds; background refreshes never reconstruct it. */
export function createAnnotationEditor(
  deps: EditorDeps,
  view: AnnotationEditorView = DEFAULT_VIEW,
) {
  const t = () => annotationText(deps.getLanguage());
  const entry = deps.entry;
  const pathDefault =
    deps.route.screen === "file" || deps.route.screen === "diff"
      ? deps.route.path || ""
      : "";
  const line =
    deps.route.screen === "file" || deps.route.screen === "diff"
      ? deps.route.line
      : undefined;
  const startDefault = line
    ? String(typeof line === "number" ? line : line.start)
    : "";
  const endDefault = line
    ? String(typeof line === "number" ? line : line.end)
    : "";
  const pathRequired = !deps.target && !entry;
  let sessionChosen = !!deps.sessionId;
  let previewing = false;
  let previewHtml = "";
  let saving = false;

  const form = detachedElement(() =>
    view({
      saving,
      session: entry
        ? null
        : {
            label: t().session,
            options: deps.sessions.map((session) => ({
              id: session.id,
              title: session.title,
              selected: session.id === deps.sessionId,
            })),
            newLabel: t().newSession,
            onChange: (value) => {
              sessionChosen = !!value;
              form.draw();
            },
            name: {
              label: t().sessionName,
              hidden: sessionChosen,
              defaultValue: t().defaultSession,
            },
          },
      location:
        !entry && !deps.target
          ? {
              path: {
                label: t().path,
                placeholder: t().pathPlaceholder,
                required: pathRequired,
                defaultValue: pathDefault,
              },
              start: {
                label: t().start,
                placeholder: t().wholeFile,
                defaultValue: startDefault,
              },
              end: { label: t().end, defaultValue: endDefault },
              onLineInput: validateLines,
            }
          : null,
      title: {
        label: `${t().title} · ${t().optional}`,
        defaultValue: entry?.title || "",
      },
      tabs: {
        write: t().write,
        preview: t().preview,
        previewing,
        onWrite: () => {
          showPreview(false);
          field<HTMLTextAreaElement>("body")?.focus();
        },
        onPreview: () => showPreview(true),
      },
      body: {
        label: t().body,
        placeholder: t().bodyPlaceholder,
        defaultValue: entry?.body || "",
        onInput: () =>
          field<HTMLTextAreaElement>("body")?.setCustomValidity(""),
      },
      preview: { label: t().preview, html: previewHtml },
      shortcut: t().shortcut,
      cancel: { label: t().cancel, onClick: deps.cancel },
      save: saving ? t().saving : t().save,
      onSubmit: (event) => {
        event.preventDefault();
        void submit();
      },
      onKeyDown: (event) => {
        if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          !event.isComposing
        ) {
          event.preventDefault();
          void submit();
        }
      },
    }),
  );
  const formElement = form.element as HTMLFormElement;

  /** 欄 (描いていない欄は null)。 */
  function field<T extends Element>(name: string): T | null {
    return formElement.querySelector<T & Element>(`[name="${name}"]`);
  }
  const value = (name: string, fallback = "") =>
    field<HTMLInputElement>(name)?.value ?? fallback;

  function validateLines() {
    const start = field<HTMLInputElement>("start");
    const end = field<HTMLInputElement>("end");
    if (!start || !end) return;
    end.setCustomValidity(
      end.value && !start.value
        ? t().lineStart
        : start.value && end.value && end.valueAsNumber < start.valueAsNumber
          ? t().lineOrder
          : "",
    );
  }

  const context = () => ({
    path: entry?.path || value("path", pathDefault),
    ref: entry?.range.to || deps.range.to,
  });

  function showPreview(show: boolean) {
    // The textarea remains mounted so switching tabs preserves selection and undo history.
    previewing = show;
    if (show)
      previewHtml = renderMarkdownHtml(
        value("body") || t().previewEmpty,
        context(),
        deps.getHighlighter(),
      );
    form.draw();
  }

  deps.container.replaceChildren(formElement);
  const initialValues = () =>
    [
      value("session"),
      value("sessionName"),
      value("path", pathDefault),
      value("start"),
      value("end"),
      value("title"),
      value("body"),
    ].join("\u0000");
  const initial = initialValues();

  async function submit() {
    if (saving) return;
    validateLines();
    field<HTMLTextAreaElement>("body")?.setCustomValidity(
      value("body").trim() ? "" : t().bodyRequired,
    );
    if (!formElement.checkValidity()) {
      showPreview(false);
      formElement.reportValidity();
      return;
    }
    saving = true;
    form.draw();
    const start = field<HTMLInputElement>("start");
    const end = field<HTMLInputElement>("end");
    const sessionId = value("session");
    const payload = entry
      ? {
          action: "update",
          id: entry.id,
          title: value("title"),
          body: value("body"),
        }
      : {
          action: "add",
          session_id: sessionId || undefined,
          session_title: sessionId ? undefined : value("sessionName"),
          target: deps.target || undefined,
          path: deps.target ? undefined : value("path", pathDefault).trim(),
          line:
            !deps.target && start?.value
              ? {
                  start: start.valueAsNumber,
                  end: end?.value ? end.valueAsNumber : start.valueAsNumber,
                }
              : undefined,
          range: deps.range,
          title: value("title"),
          body: value("body"),
        };
    try {
      await deps.save(payload);
    } catch (error) {
      deps.reportError(error);
    } finally {
      saving = false;
      form.draw();
    }
  }

  const path = field<HTMLInputElement>("path");
  (pathRequired && path && !path.value
    ? path
    : field<HTMLTextAreaElement>("body")
  )?.focus();
  return {
    localize: () => form.draw(),
    isDirty: () => initialValues() !== initial,
    isSaving: () => saving,
    focus: () => field<HTMLTextAreaElement>("body")?.focus(),
  };
}
