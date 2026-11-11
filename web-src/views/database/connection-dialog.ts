import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../../core/api-url";
import type { DbKind } from "../../core/database/types";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { detachedElement } from "../ui/renderer";
import {
  showAlertDialog,
  showConfirmDialog,
  showFormDialog,
} from "../ui-dialog";
import { requireOkResponse } from "./report-failure";

type PublicConnection = {
  id: string;
  name: string;
  kind: Exclude<DbKind, "sqlite">;
  host?: string;
  port?: number;
  database?: string;
  schema?: string;
  endpoint?: string;
  region?: string;
  accountId?: string;
  databaseId?: string;
  tls?: boolean;
};

type ConnectionDialogDeps = {
  trackLoad: <T>(promise: Promise<T>) => Promise<T>;
  language: "en" | "ja";
};

const KINDS: Array<Exclude<DbKind, "sqlite">> = [
  "postgresql",
  "mysql",
  "d1",
  "redis",
  "elasticsearch",
  "s3",
  "dynamodb",
];

// S3 互換ストレージのプロバイダ preset。kind は "s3" のまま (MinIO / LocalStack
// と同じ扱い) で、エンドポイントとリージョンの入れ方だけを変える。
const S3_PROVIDERS = ["custom", "r2"] as const;

const R2_ENDPOINT_RE = /^https:\/\/([a-z0-9-]+)\.r2\.cloudflarestorage\.com$/i;
// R2 は署名リージョンとして "auto" を要求する (空文字と us-east-1 も auto に
// エイリアスされる)。
const R2_REGION = "auto";

function r2EndpointFor(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function r2AccountIdFromEndpoint(endpoint: string | undefined): string | null {
  return endpoint ? (R2_ENDPOINT_RE.exec(endpoint)?.[1] ?? null) : null;
}

function text(language: "en" | "ja") {
  return language === "ja"
    ? {
        titleAdd: "データストア接続を追加",
        titleEdit: "データストア接続を編集",
        name: "表示名",
        kind: "種類",
        host: "ホスト",
        port: "ポート",
        user: "ユーザー",
        username: "ユーザー名（任意）",
        password: "パスワード",
        database: "データベース",
        schema: "既定スキーマ（任意）",
        provider: "プロバイダ",
        providerCustom: "S3 互換（AWS / MinIO / LocalStack）",
        providerR2: "Cloudflare R2",
        accountId: "Cloudflare アカウント ID",
        databaseId: "データベース ID",
        apiToken: "API トークン",
        endpoint: "エンドポイント URL",
        region: "リージョン",
        accessKeyId: "アクセスキー ID",
        secretAccessKey: "シークレットアクセスキー",
        sessionToken: "セッショントークン（任意）",
        tls: "TLS を使用",
        save: "保存して接続",
        test: "接続テスト",
        testing: "接続をテスト中…",
        testSucceeded: "接続できました",
        testFailed: "接続できませんでした",
        cancel: "キャンセル",
        requiredField: "必須",
        required: "必須項目を入力してください",
        invalidPort: "ポートは 1〜65535 で入力してください",
        requestFailed: "接続情報を保存できませんでした",
        deleteTitle: "保存済み接続を削除",
        deleteBody:
          "この接続情報を削除します。タブやスナップショットのデータは削除されません。",
        delete: "削除",
        secretsLeftTitle: "資格情報がキーチェーンに残りました",
        secretsLeftBody:
          "接続は削除しましたが、キーチェーンから資格情報を削除できませんでした。キーチェーンがロックされている可能性があります。ロックを解除して「キーチェーンアクセス」から code-viewer の項目を削除してください。",
      }
    : {
        titleAdd: "Add datastore connection",
        titleEdit: "Edit datastore connection",
        name: "Display name",
        kind: "Type",
        host: "Host",
        port: "Port",
        user: "User",
        username: "Username (optional)",
        password: "Password",
        database: "Database",
        schema: "Default schema (optional)",
        provider: "Provider",
        providerCustom: "S3-compatible (AWS / MinIO / LocalStack)",
        providerR2: "Cloudflare R2",
        accountId: "Cloudflare account ID",
        databaseId: "Database ID",
        apiToken: "API token",
        endpoint: "Endpoint URL",
        region: "Region",
        accessKeyId: "Access key ID",
        secretAccessKey: "Secret access key",
        sessionToken: "Session token (optional)",
        tls: "Use TLS",
        save: "Save and connect",
        test: "Test connection",
        testing: "Testing connection…",
        testSucceeded: "Connection successful",
        testFailed: "Connection failed",
        cancel: "Cancel",
        requiredField: "Required",
        required: "Complete the required fields",
        invalidPort: "Port must be between 1 and 65535",
        requestFailed: "Failed to save the connection",
        deleteTitle: "Delete saved connection",
        deleteBody:
          "This removes the saved connection. Tabs and snapshot data are not deleted.",
        delete: "Delete",
        secretsLeftTitle: "Credentials left in the keychain",
        secretsLeftBody:
          "The connection was removed, but its credentials could not be deleted from the keychain — it may be locked. Unlock it and remove the code-viewer item from Keychain Access.",
      };
}

type ConnectionLabels = ReturnType<typeof text>;
type ConnectionKind = Exclude<DbKind, "sqlite">;
type S3Provider = (typeof S3_PROVIDERS)[number];

/** 文字を入れる欄 (並びは画面の上から)。種類とプロバイダは選ぶ欄。 */
const INPUTS = [
  "name",
  "host",
  "port",
  "user",
  "username",
  "password",
  "database",
  "schema",
  "accountId",
  "databaseId",
  "apiToken",
  "endpoint",
  "region",
  "accessKeyId",
  "secretAccessKey",
  "sessionToken",
  "tls",
] as const;
type InputKey = (typeof INPUTS)[number];
type RowKey = InputKey | "kind" | "provider";

const ROWS: readonly RowKey[] = [
  "name",
  "kind",
  "host",
  "port",
  "user",
  "username",
  "password",
  "database",
  "schema",
  "provider",
  "accountId",
  "databaseId",
  "apiToken",
  "endpoint",
  "region",
  "accessKeyId",
  "secretAccessKey",
  "sessionToken",
  "tls",
];

const REQUIRED: ReadonlySet<RowKey> = new Set<RowKey>([
  "name",
  "kind",
  "host",
  "port",
  "user",
  "database",
  "accountId",
  "databaseId",
  "apiToken",
  "endpoint",
  "region",
  "accessKeyId",
]);

const INPUT_TYPE: Partial<Record<InputKey, string>> = {
  port: "number",
  password: "password",
  apiToken: "password",
  endpoint: "url",
  secretAccessKey: "password",
  sessionToken: "password",
  tls: "checkbox",
};

const ROW_LABEL: Record<RowKey, keyof ConnectionLabels> = {
  name: "name",
  kind: "kind",
  host: "host",
  port: "port",
  user: "user",
  username: "username",
  password: "password",
  database: "database",
  schema: "schema",
  provider: "provider",
  accountId: "accountId",
  databaseId: "databaseId",
  apiToken: "apiToken",
  endpoint: "endpoint",
  region: "region",
  accessKeyId: "accessKeyId",
  secretAccessKey: "secretAccessKey",
  sessionToken: "sessionToken",
  tls: "tls",
};

/** 種類ごとに隠す行。R2 はアカウント ID からエンドポイントを組み立て、
 * リージョンは "auto" に固定するので、その 2 行は隠す。 */
function hiddenRows(
  value: ConnectionKind,
  r2: boolean,
): Record<RowKey, boolean> {
  const sql = value === "postgresql" || value === "mysql";
  const redis = value === "redis";
  const http = value === "elasticsearch";
  const aws = value === "s3" || value === "dynamodb";
  const d1 = value === "d1";
  return {
    name: false,
    kind: false,
    host: !sql && !redis,
    port: !sql && !redis,
    user: !sql,
    username: !redis && !http,
    password: aws || d1,
    database: !sql,
    schema: value !== "postgresql",
    provider: value !== "s3",
    accountId: !d1 && !r2,
    databaseId: !d1,
    apiToken: !d1,
    endpoint: (!http && !aws) || r2,
    region: !aws || r2,
    accessKeyId: !aws,
    secretAccessKey: !aws,
    sessionToken: !aws,
    tls: !sql && !redis,
  };
}

/** 新しい接続で種類 (とプロバイダ) を選んだときに入れ直す既定の値。 */
function defaultsFor(
  value: ConnectionKind,
  r2: boolean,
): Partial<Record<"port" | "endpoint" | "region", string>> {
  const ports: Partial<Record<ConnectionKind, number>> = {
    postgresql: 5432,
    mysql: 3306,
    redis: 6379,
  };
  const http = value === "elasticsearch";
  const aws = value === "s3" || value === "dynamodb";
  return {
    ...(ports[value] ? { port: String(ports[value]) } : {}),
    ...(http || aws
      ? {
          endpoint: http ? "http://127.0.0.1:9200" : "http://127.0.0.1:4566",
        }
      : {}),
    ...(aws ? { region: r2 ? R2_REGION : "us-east-1" } : {}),
  };
}

type TestState = "error" | "loading" | "success";

export type ConnectionFormProps = {
  labels: ConnectionLabels;
  kind: ConnectionKind;
  provider: S3Provider;
  /** 保存済みの接続を直すときは種類を変えられない。 */
  kindLocked: boolean;
  hidden: Record<RowKey, boolean>;
  /** 欄の最初の値。欄の中身は欄が持つ (描き直しでは入れ直さない)。 */
  initial: Record<Exclude<InputKey, "tls">, string> & { tls: boolean };
  refs: Record<InputKey, Ref<HTMLInputElement>>;
  test: { state: TestState | null; text: string; busy: boolean };
  onKind: (value: string) => void;
  onProvider: (value: string) => void;
  /** 欄を変えた (前の接続テストの結果を消す)。 */
  onEdited: () => void;
  onTest: () => void;
};

export type ConnectionFormView = (props: ConnectionFormProps) => unknown;

function connectionControl(p: ConnectionFormProps, key: RowKey): unknown {
  const required = REQUIRED.has(key);
  if (key === "kind")
    return html`<select
      class="gdp-dialog-input"
      ?required=${required}
      aria-required=${required ? "true" : nothing}
      ?disabled=${p.kindLocked}
      @change=${(event: Event) =>
        p.onKind((event.currentTarget as HTMLSelectElement).value)}
    >${KINDS.map(
      (value) =>
        html`<option value=${value} ?selected=${value === p.kind}>${value}</option>`,
    )}</select>`;
  if (key === "provider")
    return html`<select
      class="gdp-dialog-input"
      @change=${(event: Event) =>
        p.onProvider((event.currentTarget as HTMLSelectElement).value)}
    >${S3_PROVIDERS.map(
      (value) =>
        html`<option value=${value} ?selected=${value === p.provider}>${
          value === "r2" ? p.labels.providerR2 : p.labels.providerCustom
        }</option>`,
    )}</select>`;
  const type = INPUT_TYPE[key] ?? "text";
  return html`<input
    class="gdp-dialog-input"
    type=${type}
    autocomplete=${type === "password" ? "new-password" : nothing}
    ?required=${required}
    aria-required=${required ? "true" : nothing}
    .value=${key === "tls" ? nothing : p.initial[key]}
    .checked=${key === "tls" ? p.initial.tls : nothing}
    ${ref(p.refs[key])}
  />`;
}

export const DEFAULT_VIEW: ConnectionFormView = (p) =>
  html`<div
    class="db-connection-form"
    @input=${p.onEdited}
    @change=${p.onEdited}
  >${ROWS.map(
    (key) =>
      html`<label class="db-connection-field" ?hidden=${p.hidden[key]}
        ><span>${p.labels[ROW_LABEL[key]]}${
          REQUIRED.has(key)
            ? html` <span
                  class="db-connection-required"
                  title=${p.labels.requiredField}
                  aria-hidden="true"
                  >*</span
                >`
            : nothing
        }</span
        >${connectionControl(p, key)}</label
      >`,
  )}<div class="db-connection-test-row"><button
        type="button"
        class="gdp-btn gdp-btn-sm db-connection-test-button"
        ?disabled=${p.test.busy}
        aria-busy=${p.test.busy ? "true" : nothing}
        @click=${p.onTest}
      >${p.labels.test}</button><span
        class="db-connection-test-status"
        aria-live="polite"
        data-state=${p.test.state ?? nothing}
        >${p.test.text}</span
      ></div
    ></div
  >`;

async function loadConnection(
  deps: ConnectionDialogDeps,
  id: string,
): Promise<PublicConnection | null> {
  const response = await deps.trackLoad(fetch(apiUrl("dbConnections")));
  await requireOkResponse(response, text(deps.language).requestFailed);
  const body = (await response.json()) as { connections?: PublicConnection[] };
  return body.connections?.find((entry) => entry.id === id) ?? null;
}

export async function showDatastoreConnectionDialog(
  deps: ConnectionDialogDeps,
  id?: string,
  view: ConnectionFormView = DEFAULT_VIEW,
): Promise<string | null> {
  const labels = text(deps.language);
  const current = id ? await loadConnection(deps, id) : null;
  if (id && !current) throw new Error(labels.requestFailed);

  let kind: ConnectionKind = current?.kind ?? "postgresql";
  const currentR2AccountId = r2AccountIdFromEndpoint(current?.endpoint);
  let provider: S3Provider = currentR2AccountId ? "r2" : "custom";
  const isR2 = () => kind === "s3" && provider === "r2";
  const initial: ConnectionFormProps["initial"] = {
    name: current?.name ?? "",
    host: current?.host ?? "127.0.0.1",
    port: current?.port ? String(current.port) : "",
    user: "",
    username: "",
    password: "",
    database: current?.database ?? "",
    schema: current?.schema ?? "",
    accountId: current?.accountId ?? currentR2AccountId ?? "",
    databaseId: current?.databaseId ?? "",
    apiToken: "",
    endpoint: current?.endpoint ?? "http://127.0.0.1:9200",
    region: current?.region ?? "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    tls: current?.tls ?? false,
    ...(current ? {} : defaultsFor(kind, isR2())),
  };
  const refs = Object.fromEntries(
    INPUTS.map((key) => [key, createRef<HTMLInputElement>()]),
  ) as Record<InputKey, Ref<HTMLInputElement>>;
  const control = (key: InputKey): HTMLInputElement => {
    const element = refs[key].value;
    if (!element)
      throw new Error(`connection dialog: the ${key} field was not drawn`);
    return element;
  };
  const fieldValue = (key: InputKey) => control(key).value;

  let test: ConnectionFormProps["test"] = {
    state: null,
    text: "",
    busy: false,
  };
  let testGeneration = 0;

  // 種類・プロバイダを選び直したら、新しい接続ではその種類の既定の値を欄へ入れる。
  const kindChanged = () => {
    box.draw();
    if (current) return;
    for (const [key, value] of Object.entries(defaultsFor(kind, isR2())))
      control(key as InputKey).value = value;
  };

  const box = detachedElement(() =>
    view({
      labels,
      kind,
      provider,
      kindLocked: !!current,
      hidden: hiddenRows(kind, isR2()),
      initial,
      refs,
      test,
      onKind: (value) => {
        kind = value as ConnectionKind;
        kindChanged();
      },
      onProvider: (value) => {
        provider = value as S3Provider;
        kindChanged();
      },
      onEdited: () => {
        testGeneration++;
        test = { ...test, state: null, text: "" };
        box.draw();
      },
      onTest: runTest,
    }),
  );

  const validateConnection = (): string | null => {
    const value = kind;
    if (!fieldValue("name").trim()) return labels.required;
    if (value === "postgresql" || value === "mysql" || value === "redis") {
      const portValue = Number(fieldValue("port"));
      if (!fieldValue("host").trim()) return labels.required;
      if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
        return labels.invalidPort;
      }
    }
    if (
      (value === "postgresql" || value === "mysql") &&
      (!fieldValue("user").trim() || !fieldValue("database").trim())
    ) {
      return labels.required;
    }
    // 資格情報はディスクに残らない (プロセス内保持) ので、S3 のアクセスキーと
    // 同じく編集時も API トークンを入れ直してもらう。
    if (
      value === "d1" &&
      (!fieldValue("accountId").trim() ||
        !fieldValue("databaseId").trim() ||
        !fieldValue("apiToken"))
    ) {
      return labels.required;
    }
    if (isR2() && !fieldValue("accountId").trim()) {
      return labels.required;
    }
    if (
      (value === "elasticsearch" ||
        (value === "s3" && !isR2()) ||
        value === "dynamodb") &&
      !fieldValue("endpoint").trim()
    ) {
      return labels.required;
    }
    if (
      (value === "s3" || value === "dynamodb") &&
      ((!isR2() && !fieldValue("region").trim()) ||
        !fieldValue("accessKeyId").trim())
    ) {
      return labels.required;
    }
    return null;
  };

  const buildPayload = (): Record<string, unknown> => {
    const value = kind;
    const payload: Record<string, unknown> = {
      ...(current ? { id: current.id } : {}),
      name: fieldValue("name").trim(),
      kind: value,
    };
    const password = fieldValue("password");
    const username = fieldValue("username").trim();
    if (value === "postgresql" || value === "mysql") {
      const user = fieldValue("user").trim();
      Object.assign(payload, {
        host: fieldValue("host").trim(),
        port: Number(fieldValue("port")),
        ...(user || !current ? { user } : {}),
        database: fieldValue("database").trim(),
        schema: fieldValue("schema").trim() || undefined,
        tls: control("tls").checked,
        ...(password || !current ? { password } : {}),
      });
    } else if (value === "redis") {
      Object.assign(payload, {
        host: fieldValue("host").trim(),
        port: Number(fieldValue("port")),
        ...(username || !current ? { username: username || undefined } : {}),
        tls: control("tls").checked,
        ...(password || !current ? { password } : {}),
      });
    } else if (value === "elasticsearch") {
      Object.assign(payload, {
        endpoint: fieldValue("endpoint").trim(),
        ...(username || !current ? { username: username || undefined } : {}),
        ...(password || !current ? { password } : {}),
      });
    } else if (value === "d1") {
      Object.assign(payload, {
        accountId: fieldValue("accountId").trim(),
        databaseId: fieldValue("databaseId").trim(),
        apiToken: fieldValue("apiToken"),
      });
    } else {
      const accessKeyId = fieldValue("accessKeyId").trim();
      const secretAccessKey = fieldValue("secretAccessKey");
      const sessionToken = fieldValue("sessionToken");
      Object.assign(payload, {
        // R2 は kind "s3" のまま保存し、アカウント ID から組み立てた
        // エンドポイントと固定リージョンを入れる。
        endpoint: isR2()
          ? r2EndpointFor(fieldValue("accountId").trim())
          : fieldValue("endpoint").trim(),
        region: isR2() ? R2_REGION : fieldValue("region").trim(),
        ...(accessKeyId || !current ? { accessKeyId } : {}),
        ...(secretAccessKey || !current ? { secretAccessKey } : {}),
        ...(sessionToken ? { sessionToken } : {}),
      });
    }
    return payload;
  };

  function runTest(): void {
    const validationError = validateConnection();
    if (validationError) {
      test = { ...test, state: "error", text: validationError };
      box.draw();
      return;
    }
    test = { state: "loading", text: labels.testing, busy: true };
    box.draw();
    const generation = ++testGeneration;
    void deps
      .trackLoad(
        fetch(apiUrl("dbConnectionsTest"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Code-Viewer-Action": "1",
          },
          body: JSON.stringify(buildPayload()),
        }),
      )
      .then(async (response) => {
        if (generation !== testGeneration) return;
        await requireOkResponse(response, labels.testFailed);
        test = { ...test, state: "success", text: labels.testSucceeded };
      })
      .catch((err) => {
        if (generation !== testGeneration) return;
        // 入力の中身 (資格情報を含む) は console に出さない。種類だけを添える。
        console.error(
          "[code-viewer] datastore connection test failed",
          kind,
          err,
        );
        test = { ...test, state: "error", text: formatErrorDetail(err) };
      })
      .finally(() => {
        test = { ...test, busy: false };
        box.draw();
      });
  }

  return showFormDialog({
    title: current ? labels.titleEdit : labels.titleAdd,
    body: box.element,
    focusTarget: control("name"),
    submitLabel: labels.save,
    cancelLabel: labels.cancel,
    validate: validateConnection,
    submit: async () => {
      const payload = buildPayload();
      const response = await deps.trackLoad(
        fetch(apiUrl("dbConnections"), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Code-Viewer-Action": "1",
          },
          body: JSON.stringify(payload),
        }),
      );
      await requireOkResponse(response, labels.requestFailed);
      const result = (await response.json()) as {
        connection: PublicConnection;
      };
      return result.connection.id;
    },
  });
}

export async function deleteDatastoreConnectionFromUi(
  deps: ConnectionDialogDeps,
  id: string,
): Promise<boolean> {
  const labels = text(deps.language);
  const confirmed = await showConfirmDialog({
    title: labels.deleteTitle,
    body: labels.deleteBody,
    confirmLabel: labels.delete,
    cancelLabel: labels.cancel,
    danger: true,
  });
  if (!confirmed) return false;
  const response = await deps.trackLoad(
    fetch(apiUrl("dbConnections"), {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify({ id }),
    }),
  );
  await requireOkResponse(response, labels.requestFailed);
  // 接続は消えたがキーチェーン項目が残った場合 (ロック中など) は黙って
  // 成功扱いにしない。残った資格情報の存在をユーザーに知らせる。本文が
  // 読めないときも「消えた」とは言えないので、理由ごと投げる。
  let body: { secretsRemoved?: boolean };
  try {
    body = (await response.json()) as { secretsRemoved?: boolean };
  } catch (error) {
    throw errorWithCause(
      `${labels.requestFailed}: the connection was deleted, but the response did not say whether its keychain credentials were removed`,
      error,
    );
  }
  if (body.secretsRemoved === false) {
    await showAlertDialog({
      title: labels.secretsLeftTitle,
      body: labels.secretsLeftBody,
    });
  }
  return true;
}
