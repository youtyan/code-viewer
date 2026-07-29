import type { DbKind } from "../../core/database/types";
import {
  showAlertDialog,
  showConfirmDialog,
  showFormDialog,
} from "../ui-dialog";

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

function field(
  labelText: string,
  input: HTMLInputElement | HTMLSelectElement,
  required = false,
  requiredLabel = "Required",
): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "db-connection-field";
  const caption = document.createElement("span");
  caption.textContent = labelText;
  if (required) {
    const mark = document.createElement("span");
    mark.className = "db-connection-required";
    mark.textContent = "*";
    mark.title = requiredLabel;
    mark.setAttribute("aria-hidden", "true");
    caption.append(" ", mark);
    input.required = true;
    input.setAttribute("aria-required", "true");
  }
  input.classList.add("gdp-dialog-input");
  label.append(caption, input);
  return label;
}

function input(type = "text"): HTMLInputElement {
  const element = document.createElement("input");
  element.type = type;
  return element;
}

async function loadConnection(
  deps: ConnectionDialogDeps,
  id: string,
): Promise<PublicConnection | null> {
  const response = await deps.trackLoad(fetch("/_db/connections"));
  if (!response.ok) return null;
  const body = (await response.json()) as { connections?: PublicConnection[] };
  return body.connections?.find((entry) => entry.id === id) ?? null;
}

export async function showDatastoreConnectionDialog(
  deps: ConnectionDialogDeps,
  id?: string,
): Promise<string | null> {
  const labels = text(deps.language);
  const current = id ? await loadConnection(deps, id) : null;
  if (id && !current) throw new Error(labels.requestFailed);

  const form = document.createElement("div");
  form.className = "db-connection-form";
  const name = input();
  name.value = current?.name ?? "";
  const kind = document.createElement("select");
  for (const value of KINDS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    kind.appendChild(option);
  }
  kind.value = current?.kind ?? "postgresql";
  kind.disabled = !!current;
  const host = input();
  host.value = current?.host ?? "127.0.0.1";
  const port = input("number");
  port.value = current?.port ? String(current.port) : "";
  const user = input();
  const username = input();
  const password = input("password");
  password.autocomplete = "new-password";
  const database = input();
  database.value = current?.database ?? "";
  const schema = input();
  schema.value = current?.schema ?? "";
  const provider = document.createElement("select");
  for (const value of S3_PROVIDERS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent =
      value === "r2" ? labels.providerR2 : labels.providerCustom;
    provider.appendChild(option);
  }
  const currentR2AccountId = r2AccountIdFromEndpoint(current?.endpoint);
  provider.value = currentR2AccountId ? "r2" : "custom";
  const accountId = input();
  accountId.value = current?.accountId ?? currentR2AccountId ?? "";
  const databaseId = input();
  databaseId.value = current?.databaseId ?? "";
  const apiToken = input("password");
  apiToken.autocomplete = "new-password";
  const endpoint = input("url");
  endpoint.value = current?.endpoint ?? "http://127.0.0.1:9200";
  const region = input();
  region.value = current?.region ?? "us-east-1";
  const accessKeyId = input();
  const secretAccessKey = input("password");
  secretAccessKey.autocomplete = "new-password";
  const sessionToken = input("password");
  sessionToken.autocomplete = "new-password";
  const tls = input("checkbox");
  tls.checked = current?.tls ?? false;

  const rows = {
    name: field(labels.name, name, true, labels.requiredField),
    kind: field(labels.kind, kind, true, labels.requiredField),
    host: field(labels.host, host, true, labels.requiredField),
    port: field(labels.port, port, true, labels.requiredField),
    user: field(labels.user, user, true, labels.requiredField),
    username: field(labels.username, username),
    password: field(labels.password, password),
    database: field(labels.database, database, true, labels.requiredField),
    schema: field(labels.schema, schema),
    provider: field(labels.provider, provider),
    accountId: field(labels.accountId, accountId, true, labels.requiredField),
    databaseId: field(
      labels.databaseId,
      databaseId,
      true,
      labels.requiredField,
    ),
    apiToken: field(labels.apiToken, apiToken, true, labels.requiredField),
    endpoint: field(labels.endpoint, endpoint, true, labels.requiredField),
    region: field(labels.region, region, true, labels.requiredField),
    accessKeyId: field(
      labels.accessKeyId,
      accessKeyId,
      true,
      labels.requiredField,
    ),
    secretAccessKey: field(labels.secretAccessKey, secretAccessKey),
    sessionToken: field(labels.sessionToken, sessionToken),
    tls: field(labels.tls, tls),
  };
  form.append(...Object.values(rows));

  const isR2 = () => kind.value === "s3" && provider.value === "r2";

  const syncKind = () => {
    const value = kind.value;
    const sql = value === "postgresql" || value === "mysql";
    const redis = value === "redis";
    const http = value === "elasticsearch";
    const aws = value === "s3" || value === "dynamodb";
    const d1 = value === "d1";
    // R2 はアカウント ID からエンドポイントを組み立て、リージョンは "auto" に
    // 固定するので、その 2 行は隠す。
    const r2 = isR2();
    rows.host.hidden = !sql && !redis;
    rows.port.hidden = !sql && !redis;
    rows.user.hidden = !sql;
    rows.username.hidden = !redis && !http;
    rows.password.hidden = aws || d1;
    rows.database.hidden = !sql;
    rows.schema.hidden = value !== "postgresql";
    rows.provider.hidden = value !== "s3";
    rows.accountId.hidden = !d1 && !r2;
    rows.databaseId.hidden = !d1;
    rows.apiToken.hidden = !d1;
    rows.endpoint.hidden = (!http && !aws) || r2;
    rows.region.hidden = !aws || r2;
    rows.accessKeyId.hidden = !aws;
    rows.secretAccessKey.hidden = !aws;
    rows.sessionToken.hidden = !aws;
    rows.tls.hidden = !sql && !redis;
    const defaults: Record<string, number> = {
      postgresql: 5432,
      mysql: 3306,
      redis: 6379,
    };
    if (!current && defaults[value]) port.value = String(defaults[value]);
    if (!current && (http || aws)) {
      endpoint.value =
        value === "elasticsearch"
          ? "http://127.0.0.1:9200"
          : "http://127.0.0.1:4566";
    }
    if (!current && aws) region.value = r2 ? R2_REGION : "us-east-1";
  };
  kind.addEventListener("change", syncKind);
  provider.addEventListener("change", syncKind);
  syncKind();

  const validateConnection = (): string | null => {
    const value = kind.value;
    if (!name.value.trim()) return labels.required;
    if (value === "postgresql" || value === "mysql" || value === "redis") {
      const portValue = Number(port.value);
      if (!host.value.trim()) return labels.required;
      if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
        return labels.invalidPort;
      }
    }
    if (
      (value === "postgresql" || value === "mysql") &&
      (!user.value.trim() || !database.value.trim())
    ) {
      return labels.required;
    }
    // 資格情報はディスクに残らない (プロセス内保持) ので、S3 のアクセスキーと
    // 同じく編集時も API トークンを入れ直してもらう。
    if (
      value === "d1" &&
      (!accountId.value.trim() || !databaseId.value.trim() || !apiToken.value)
    ) {
      return labels.required;
    }
    if (isR2() && !accountId.value.trim()) {
      return labels.required;
    }
    if (
      (value === "elasticsearch" ||
        (value === "s3" && !isR2()) ||
        value === "dynamodb") &&
      !endpoint.value.trim()
    ) {
      return labels.required;
    }
    if (
      (value === "s3" || value === "dynamodb") &&
      ((!isR2() && !region.value.trim()) || !accessKeyId.value.trim())
    ) {
      return labels.required;
    }
    return null;
  };

  const buildPayload = (): Record<string, unknown> => {
    const value = kind.value as Exclude<DbKind, "sqlite">;
    const payload: Record<string, unknown> = {
      ...(current ? { id: current.id } : {}),
      name: name.value.trim(),
      kind: value,
    };
    if (value === "postgresql" || value === "mysql") {
      Object.assign(payload, {
        host: host.value.trim(),
        port: Number(port.value),
        ...(user.value.trim() || !current ? { user: user.value.trim() } : {}),
        database: database.value.trim(),
        schema: schema.value.trim() || undefined,
        tls: tls.checked,
        ...(password.value || !current ? { password: password.value } : {}),
      });
    } else if (value === "redis") {
      Object.assign(payload, {
        host: host.value.trim(),
        port: Number(port.value),
        ...(username.value.trim() || !current
          ? { username: username.value.trim() || undefined }
          : {}),
        tls: tls.checked,
        ...(password.value || !current ? { password: password.value } : {}),
      });
    } else if (value === "elasticsearch") {
      Object.assign(payload, {
        endpoint: endpoint.value.trim(),
        ...(username.value.trim() || !current
          ? { username: username.value.trim() || undefined }
          : {}),
        ...(password.value || !current ? { password: password.value } : {}),
      });
    } else if (value === "d1") {
      Object.assign(payload, {
        accountId: accountId.value.trim(),
        databaseId: databaseId.value.trim(),
        apiToken: apiToken.value,
      });
    } else {
      Object.assign(payload, {
        // R2 は kind "s3" のまま保存し、アカウント ID から組み立てた
        // エンドポイントと固定リージョンを入れる。
        endpoint: isR2()
          ? r2EndpointFor(accountId.value.trim())
          : endpoint.value.trim(),
        region: isR2() ? R2_REGION : region.value.trim(),
        ...(accessKeyId.value.trim() || !current
          ? { accessKeyId: accessKeyId.value.trim() }
          : {}),
        ...(secretAccessKey.value || !current
          ? { secretAccessKey: secretAccessKey.value }
          : {}),
        ...(sessionToken.value ? { sessionToken: sessionToken.value } : {}),
      });
    }
    return payload;
  };

  const testRow = document.createElement("div");
  testRow.className = "db-connection-test-row";
  const testButton = document.createElement("button");
  testButton.type = "button";
  testButton.className = "gdp-btn gdp-btn-sm db-connection-test-button";
  testButton.textContent = labels.test;
  const testStatus = document.createElement("span");
  testStatus.className = "db-connection-test-status";
  testStatus.setAttribute("aria-live", "polite");
  testRow.append(testButton, testStatus);
  form.appendChild(testRow);
  let testGeneration = 0;
  const invalidateTestResult = () => {
    testGeneration++;
    testStatus.textContent = "";
    delete testStatus.dataset.state;
  };
  form.addEventListener("input", invalidateTestResult);
  form.addEventListener("change", invalidateTestResult);
  testButton.addEventListener("click", () => {
    const validationError = validateConnection();
    if (validationError) {
      testStatus.dataset.state = "error";
      testStatus.textContent = validationError;
      return;
    }
    testButton.disabled = true;
    testButton.setAttribute("aria-busy", "true");
    testStatus.dataset.state = "loading";
    testStatus.textContent = labels.testing;
    const generation = ++testGeneration;
    void deps
      .trackLoad(
        fetch("/_db/connections/test", {
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
        if (!response.ok) {
          throw new Error(labels.testFailed);
        }
        testStatus.dataset.state = "success";
        testStatus.textContent = labels.testSucceeded;
      })
      .catch((err) => {
        if (generation !== testGeneration) return;
        testStatus.dataset.state = "error";
        testStatus.textContent =
          err instanceof Error && err.message ? err.message : labels.testFailed;
      })
      .finally(() => {
        testButton.disabled = false;
        testButton.removeAttribute("aria-busy");
      });
  });

  return showFormDialog({
    title: current ? labels.titleEdit : labels.titleAdd,
    body: form,
    focusTarget: name,
    submitLabel: labels.save,
    cancelLabel: labels.cancel,
    validate: validateConnection,
    submit: async () => {
      const payload = buildPayload();
      const response = await deps.trackLoad(
        fetch("/_db/connections", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Code-Viewer-Action": "1",
          },
          body: JSON.stringify(payload),
        }),
      );
      if (!response.ok) {
        throw new Error((await response.text()) || labels.requestFailed);
      }
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
    fetch("/_db/connections", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify({ id }),
    }),
  );
  if (!response.ok)
    throw new Error((await response.text()) || labels.requestFailed);
  // 接続は消えたがキーチェーン項目が残った場合 (ロック中など) は黙って
  // 成功扱いにしない。残った資格情報の存在をユーザーに知らせる。
  const body = (await response.json().catch(() => ({}))) as {
    secretsRemoved?: boolean;
  };
  if (body.secretsRemoved === false) {
    await showAlertDialog({
      title: labels.secretsLeftTitle,
      body: labels.secretsLeftBody,
    });
  }
  return true;
}
