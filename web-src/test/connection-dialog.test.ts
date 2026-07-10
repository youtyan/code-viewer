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

function inputFor(labelText: string): HTMLInputElement {
  const label = Array.from(
    getOpenDialog().querySelectorAll<HTMLLabelElement>(".db-connection-field"),
  ).find((candidate) =>
    candidate.firstElementChild?.textContent?.startsWith(labelText),
  );
  const input = label?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`input missing: ${labelText}`);
  return input;
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
