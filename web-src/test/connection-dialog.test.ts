import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { closeOpenDialog, getOpenDialog } from "./_dialog-helpers";

GlobalRegistrator.register();

const { showDatastoreConnectionDialog } = await import(
  "../views/database/connection-dialog"
);
const originalFetch = globalThis.fetch;
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function dialogButtons(): HTMLButtonElement[] {
  return Array.from(
    getOpenDialog().querySelectorAll<HTMLButtonElement>(
      ".gdp-dialog-actions button",
    ),
  );
}

function fieldRow(labelText: string): HTMLLabelElement {
  const label = Array.from(
    getOpenDialog().querySelectorAll<HTMLLabelElement>(".db-connection-field"),
  ).find((candidate) =>
    candidate.firstElementChild?.textContent?.startsWith(labelText),
  );
  if (!label) throw new Error(`field missing: ${labelText}`);
  return label;
}

function fieldControl<T extends Element>(
  labelText: string,
  selector: string,
): T {
  const control = fieldRow(labelText).querySelector<T>(selector);
  if (!control) throw new Error(`control missing: ${labelText}`);
  return control;
}

function inputFor(labelText: string): HTMLInputElement {
  return fieldControl<HTMLInputElement>(labelText, "input");
}

function selectFor(labelText: string): HTMLSelectElement {
  return fieldControl<HTMLSelectElement>(labelText, "select");
}

function requiredVisibleLabels(): string[] {
  return Array.from(
    getOpenDialog().querySelectorAll<HTMLLabelElement>(
      ".db-connection-field:not([hidden])",
    ),
  )
    .filter((label) => {
      const control = label.querySelector<HTMLInputElement | HTMLSelectElement>(
        "input, select",
      );
      return control?.required === true;
    })
    .map((label) =>
      (label.firstElementChild?.textContent ?? "").replace(/\s*\*$/, ""),
    );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  closeOpenDialog();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("datastore connection dialog required fields", () => {
  test.each([
    {
      kind: "postgresql",
      labels: ["Display name", "Type", "Host", "Port", "User", "Database"],
    },
    {
      kind: "mysql",
      labels: ["Display name", "Type", "Host", "Port", "User", "Database"],
    },
    {
      kind: "redis",
      labels: ["Display name", "Type", "Host", "Port"],
    },
    {
      kind: "elasticsearch",
      labels: ["Display name", "Type", "Endpoint URL"],
    },
    {
      kind: "s3",
      labels: [
        "Display name",
        "Type",
        "Endpoint URL",
        "Region",
        "Access key ID",
      ],
    },
    {
      kind: "dynamodb",
      labels: [
        "Display name",
        "Type",
        "Endpoint URL",
        "Region",
        "Access key ID",
      ],
    },
    {
      kind: "d1",
      labels: [
        "Display name",
        "Type",
        "Cloudflare account ID",
        "Database ID",
        "API token",
      ],
    },
  ])("marks the visible $kind requirements", async ({ kind, labels }) => {
    const promise = showDatastoreConnectionDialog({
      language: "en",
      trackLoad: (load) => load,
    });
    await tick();
    const select = getOpenDialog().querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("kind select missing");

    select.value = kind;
    select.dispatchEvent(new Event("change"));

    expect(requiredVisibleLabels()).toEqual(labels);
    for (const control of getOpenDialog().querySelectorAll<HTMLElement>(
      '[aria-required="true"]',
    )) {
      expect(control.getAttribute("aria-required")).toBe("true");
    }
    dialogButtons()[0].click();
    expect(await promise).toBeNull();
  });

  test.each([
    {
      name: "SQL user",
      id: "connection:1111111111111111",
      connection: {
        id: "connection:1111111111111111",
        name: "Example datastore",
        kind: "postgresql",
        host: "db.example.test",
        port: 5432,
        database: "sample_database",
        tls: false,
      },
      field: "User",
      expectedPort: "5432",
    },
    {
      name: "object-store access key",
      id: "connection:2222222222222222",
      connection: {
        id: "connection:2222222222222222",
        name: "Example datastore",
        kind: "s3",
        endpoint: "https://objects.example.test",
        region: "example-region-1",
      },
      field: "Access key ID",
      expectedPort: undefined,
    },
  ])("requires $name again while editing", async ({
    id,
    connection,
    field,
    expectedPort,
  }) => {
    let requests = 0;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      requests++;
      return new Response(JSON.stringify({ connections: [connection] }), {
        status: 200,
      });
    }) as typeof fetch;
    const promise = showDatastoreConnectionDialog(
      { language: "en", trackLoad: (load) => load },
      id,
    );
    await tick();
    const requiredInput = inputFor(field);
    const testButton = getOpenDialog().querySelector<HTMLButtonElement>(
      ".db-connection-test-button",
    );
    const status = getOpenDialog().querySelector<HTMLElement>(
      ".db-connection-test-status",
    );
    if (!testButton || !status) throw new Error("test controls missing");

    expect(requiredInput.required).toBe(true);
    expect(requiredInput.placeholder).toBe("");
    if (expectedPort) expect(inputFor("Port").value).toBe(expectedPort);
    testButton.click();
    expect(status.textContent).toBe("Complete the required fields");
    expect(requests).toBe(1);
    dialogButtons()[0].click();
    expect(await promise).toBeNull();
  });
});

describe("datastore connection test action", () => {
  test.each([
    {
      name: "success",
      response: new Response(JSON.stringify({ ok: true }), { status: 200 }),
      status: "Connection successful",
      state: "success",
    },
    {
      name: "failure",
      response: new Response("Connection failed", { status: 400 }),
      status: "Connection failed",
      state: "error",
    },
  ])("shows stable in-dialog feedback for $name", async (scenario) => {
    let resolveFetch: ((response: Response) => void) | null = null;
    let request: { url: string; method: string; headers: Headers } | null =
      null;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
      };
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as typeof fetch;
    const promise = showDatastoreConnectionDialog({
      language: "en",
      trackLoad: (load) => load,
    });
    await tick();
    inputFor("Display name").value = "Example datastore";
    inputFor("User").value = "sample_user";
    inputFor("Database").value = "sample_database";
    const button = getOpenDialog().querySelector<HTMLButtonElement>(
      ".db-connection-test-button",
    );
    const status = getOpenDialog().querySelector<HTMLElement>(
      ".db-connection-test-status",
    );
    if (!button || !status) throw new Error("connection test controls missing");

    const label = button.textContent;
    button.click();

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe(label);
    expect(status.textContent).toBe("Testing connection…");
    expect(request?.url).toBe("/_db/connections/test");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("X-Code-Viewer-Action")).toBe("1");

    resolveFetch?.(scenario.response);
    await tick();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe(label);
    expect(status.textContent).toBe(scenario.status);
    expect(status.dataset.state).toBe(scenario.state);
    dialogButtons()[0].click();
    expect(await promise).toBeNull();
  });

  test("drops a test result after connection fields change", async () => {
    let resolveFetch: ((response: Response) => void) | null = null;
    globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })) as typeof fetch;
    const promise = showDatastoreConnectionDialog({
      language: "en",
      trackLoad: (load) => load,
    });
    await tick();
    inputFor("Display name").value = "Example datastore";
    inputFor("User").value = "sample_user";
    inputFor("Database").value = "sample_database";
    const button = getOpenDialog().querySelector<HTMLButtonElement>(
      ".db-connection-test-button",
    );
    const status = getOpenDialog().querySelector<HTMLElement>(
      ".db-connection-test-status",
    );
    if (!button || !status) throw new Error("connection test controls missing");
    button.click();

    const host = inputFor("Host");
    host.value = "updated.example.test";
    host.dispatchEvent(new Event("input", { bubbles: true }));
    resolveFetch?.(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await tick();

    expect(status.textContent).toBe("");
    expect(status.dataset.state).toBeUndefined();
    expect(button.disabled).toBe(false);
    dialogButtons()[0].click();
    expect(await promise).toBeNull();
  });

  test("Enter on the focused test button tests without saving", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const promise = showDatastoreConnectionDialog({
      language: "en",
      trackLoad: (load) => load,
    });
    await tick();
    inputFor("Display name").value = "Example datastore";
    inputFor("User").value = "sample_user";
    inputFor("Database").value = "sample_database";
    const button = getOpenDialog().querySelector<HTMLButtonElement>(
      ".db-connection-test-button",
    );
    const status = getOpenDialog().querySelector<HTMLElement>(
      ".db-connection-test-status",
    );
    if (!button || !status) throw new Error("connection test controls missing");

    button.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await tick();

    expect(requestedUrl).toBe("/_db/connections/test");
    expect(status.textContent).toBe("Connection successful");
    expect(getOpenDialog().isConnected).toBe(true);
    dialogButtons()[0].click();
    expect(await promise).toBeNull();
  });
});

// 保存された接続の PUT ペイロードを取り出す。ダイアログの保存ボタンを押した
// 結果として送られる body だけを見るので、フォームの内部表現には依存しない。
async function submitAndCapturePayload(
  fill: () => void,
  id?: string,
  existing?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let saved: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/_db/connections" && init?.method === "PUT") {
      saved = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ connection: { id: id ?? "new" } }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({ connections: existing ? [existing] : [] }),
      { status: 200 },
    );
  }) as typeof fetch;
  const promise = showDatastoreConnectionDialog(
    { language: "en", trackLoad: (load) => load },
    id,
  );
  await tick();
  fill();
  dialogButtons()[1].click();
  await promise;
  if (!saved) throw new Error("connection was not saved");
  return saved;
}

describe("Cloudflare R2 provider preset", () => {
  test("derives the R2 endpoint and auto region from the account id", async () => {
    const payload = await submitAndCapturePayload(() => {
      selectFor("Type").value = "s3";
      selectFor("Type").dispatchEvent(new Event("change"));
      selectFor("Provider").value = "r2";
      selectFor("Provider").dispatchEvent(new Event("change"));
      inputFor("Display name").value = "Example object storage";
      inputFor("Cloudflare account ID").value = "example-account";
      inputFor("Access key ID").value = "example-access-key";
      inputFor("Secret access key").value = "example-secret";
    });

    expect(payload.kind).toBe("s3");
    expect(payload.endpoint).toBe(
      "https://example-account.r2.cloudflarestorage.com",
    );
    expect(payload.region).toBe("auto");
  });

  test("hides the endpoint and region fields the preset fills in", async () => {
    const promise = showDatastoreConnectionDialog({
      language: "en",
      trackLoad: (load) => load,
    });
    await tick();
    selectFor("Type").value = "s3";
    selectFor("Type").dispatchEvent(new Event("change"));

    expect(fieldRow("Provider").hidden).toBe(false);
    expect(fieldRow("Endpoint URL").hidden).toBe(false);
    expect(fieldRow("Cloudflare account ID").hidden).toBe(true);

    selectFor("Provider").value = "r2";
    selectFor("Provider").dispatchEvent(new Event("change"));

    expect(fieldRow("Endpoint URL").hidden).toBe(true);
    expect(fieldRow("Region").hidden).toBe(true);
    expect(fieldRow("Cloudflare account ID").hidden).toBe(false);
    expect(fieldRow("Access key ID").hidden).toBe(false);

    dialogButtons()[0].click();
    expect(await promise).toBeNull();
  });

  test("keeps the provider row out of non-s3 datastores", async () => {
    const promise = showDatastoreConnectionDialog({
      language: "en",
      trackLoad: (load) => load,
    });
    await tick();
    for (const kind of ["postgresql", "dynamodb", "d1"]) {
      selectFor("Type").value = kind;
      selectFor("Type").dispatchEvent(new Event("change"));
      expect(fieldRow("Provider").hidden).toBe(true);
    }

    dialogButtons()[0].click();
    expect(await promise).toBeNull();
  });

  test.each([
    {
      name: "an R2 endpoint reopens on the R2 preset",
      id: "connection:3333333333333333",
      endpoint: "https://example-account.r2.cloudflarestorage.com",
      region: "auto",
      provider: "r2",
      accountIdHidden: false,
      accountIdValue: "example-account",
      endpointHidden: true,
    },
    {
      name: "a MinIO-style endpoint stays on the custom preset",
      id: "connection:4444444444444444",
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      provider: "custom",
      accountIdHidden: true,
      accountIdValue: "",
      endpointHidden: false,
    },
  ])("$name", async (scenario) => {
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) =>
      new Response(
        JSON.stringify({
          connections: [
            {
              id: scenario.id,
              name: "Example object storage",
              kind: "s3",
              endpoint: scenario.endpoint,
              region: scenario.region,
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;
    const promise = showDatastoreConnectionDialog(
      { language: "en", trackLoad: (load) => load },
      scenario.id,
    );
    await tick();

    expect(selectFor("Provider").value).toBe(scenario.provider);
    expect(inputFor("Cloudflare account ID").value).toBe(
      scenario.accountIdValue,
    );
    expect(fieldRow("Cloudflare account ID").hidden).toBe(
      scenario.accountIdHidden,
    );
    expect(fieldRow("Endpoint URL").hidden).toBe(scenario.endpointHidden);
    if (!scenario.endpointHidden) {
      expect(inputFor("Endpoint URL").value).toBe(scenario.endpoint);
    }

    dialogButtons()[0].click();
    expect(await promise).toBeNull();
  });
});

describe("Cloudflare D1 connection", () => {
  test("sends the account, database and token", async () => {
    const payload = await submitAndCapturePayload(() => {
      selectFor("Type").value = "d1";
      selectFor("Type").dispatchEvent(new Event("change"));
      inputFor("Display name").value = "Example D1";
      inputFor("Cloudflare account ID").value = "example-account";
      inputFor("Database ID").value = "example-database";
      inputFor("API token").value = "example-token";
    });

    expect(payload).toEqual({
      name: "Example D1",
      kind: "d1",
      accountId: "example-account",
      databaseId: "example-database",
      apiToken: "example-token",
    });
  });

  test("hides host, port and endpoint fields that do not apply", async () => {
    const promise = showDatastoreConnectionDialog({
      language: "en",
      trackLoad: (load) => load,
    });
    await tick();
    selectFor("Type").value = "d1";
    selectFor("Type").dispatchEvent(new Event("change"));

    for (const label of [
      "Host",
      "Port",
      "Endpoint URL",
      "Region",
      "Password",
    ]) {
      expect(fieldRow(label).hidden).toBe(true);
    }
    for (const label of ["Cloudflare account ID", "Database ID", "API token"]) {
      expect(fieldRow(label).hidden).toBe(false);
    }

    dialogButtons()[0].click();
    expect(await promise).toBeNull();
  });
});
