import { describe, expect, test } from "bun:test";
import { isDotenvName, sourceDisplayKind } from "../core/source-meta";

describe("source metadata", () => {
  test("treats dotenv examples and variants as text sources", () => {
    expect(sourceDisplayKind("apps/mastra/.env.example")).toBe("text");
    expect(sourceDisplayKind(".env.local")).toBe("text");
    expect(sourceDisplayKind("apps/api/service.env.sample")).toBe("text");
    expect(isDotenvName("environment.example")).toBe(false);
  });
});
