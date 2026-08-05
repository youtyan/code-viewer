import { describe, expect, test } from "vitest";
import { formatErrorDetail, responseErrorMessage } from "../core/error-detail";

describe("formatErrorDetail", () => {
  test("keeps every error in the cause chain", () => {
    const error = Object.assign(new Error("outer failure"), {
      cause: new TypeError("inner failure"),
    });

    expect(formatErrorDetail(error)).toBe(
      "Error: outer failure\nCaused by: TypeError: inner failure",
    );
  });

  test("keeps a non-Error thrown value", () => {
    expect(
      formatErrorDetail({ code: "E_SAMPLE", reason: "sample reason" }),
    ).toBe('{"code":"E_SAMPLE","reason":"sample reason"}');
  });

  test("keeps every additional Error field", () => {
    const error = Object.assign(new Error("request failed"), {
      code: "E_SAMPLE",
      reason: "sample reason",
      details: { field: "sample_field", location: 2 },
    });

    expect(formatErrorDetail(error)).toBe(
      'Error: request failed\nDetails: {"code":"E_SAMPLE","reason":"sample reason","details":{"field":"sample_field","location":2}}',
    );
  });

  test.each([
    { key: "Authorization" },
    { key: "Cookie" },
    { key: "access_token" },
    { key: "password" },
    { key: "clientSecret" },
    { key: "credential" },
    { key: "API key" },
  ])("omits the sensitive $key field completely", ({ key }) => {
    const error = Object.assign(new Error("request failed"), {
      code: "E_SAMPLE",
      [key]: "sample_private_value",
    });

    const detail = formatErrorDetail(error);

    expect(detail).toBe('Error: request failed\nDetails: {"code":"E_SAMPLE"}');
    expect(detail).not.toContain(key);
    expect(detail).not.toContain("sample_private_value");
  });

  test("omits nested sensitive fields while keeping all non-sensitive details", () => {
    const error = Object.assign(new Error("request failed"), {
      code: "E_SAMPLE",
      details: {
        field: "sample_field",
        location: 2,
        token: "sample_private_value",
        nested: {
          reason: "sample reason",
          password: "sample_private_value",
        },
      },
      config: {
        method: "POST",
        headers: { Authorization: "sample_private_value" },
      },
    });

    expect(formatErrorDetail(error)).toBe(
      'Error: request failed\nDetails: {"code":"E_SAMPLE","details":{"field":"sample_field","location":2,"nested":{"reason":"sample reason"}},"config":{"method":"POST"}}',
    );
  });

  test("formats circular and Error-valued fields without failing", () => {
    const context: Record<string, unknown> = { field: "sample_field" };
    context.self = context;
    const related = Object.assign(new Error("related failure"), {
      code: "E_RELATED",
    });
    const error = Object.assign(new Error("request failed"), {
      context,
      related,
    });

    expect(formatErrorDetail(error)).toBe(
      'Error: request failed\nDetails: {"context":{"field":"sample_field","self":"[Circular]"},"related":{"name":"Error","message":"related failure","code":"E_RELATED"}}',
    );
  });

  test("keeps every structured error in a multiple-failure field", () => {
    const error = Object.assign(new Error("combined failure"), {
      errors: [
        Object.assign(new Error("first failure"), { code: "E_FIRST" }),
        Object.assign(new TypeError("second failure"), {
          reason: "sample reason",
        }),
      ],
    });

    expect(formatErrorDetail(error)).toBe(
      'Error: combined failure\nDetails: {"errors":[{"name":"Error","message":"first failure","code":"E_FIRST"},{"name":"TypeError","message":"second failure","reason":"sample reason"}]}',
    );
  });
});

describe("responseErrorMessage", () => {
  test("keeps the operation, HTTP status, status text, and complete body", async () => {
    const response = new Response(
      'line one\n{"errors":[{"code":"E1"},{"code":"E2"}]}',
      {
        status: 503,
        statusText: "Service Unavailable",
      },
    );

    await expect(
      responseErrorMessage(response, "Terminal request failed"),
    ).resolves.toBe(
      'Terminal request failed (HTTP 503 Service Unavailable): line one\n{"errors":[{"code":"E1"},{"code":"E2"}]}',
    );
  });

  test("keeps the status when the response body is empty", async () => {
    const response = new Response("", { status: 500 });

    await expect(
      responseErrorMessage(response, "Terminal request failed"),
    ).resolves.toBe("Terminal request failed (HTTP 500)");
  });

  test("chains a response body read failure", async () => {
    const bodyError = new Error("body stream failed");
    const response = new Response("failure", { status: 502 });
    response.text = () => Promise.reject(bodyError);

    let thrown: unknown;
    try {
      await responseErrorMessage(response, "Terminal request failed");
    } catch (error) {
      thrown = error;
    }

    expect(formatErrorDetail(thrown)).toBe(
      "Error: Terminal request failed (HTTP 502): failed to read response body\nCaused by: Error: body stream failed",
    );
  });
});
