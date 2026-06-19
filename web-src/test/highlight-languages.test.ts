import { describe, expect, test } from "bun:test";
import { ensureTerraformHighlightLanguage } from "../core/highlight-languages";
import type { HljsApi } from "../core/types";

describe("highlight language registration", () => {
  test("registers Terraform aliases for tf diffs", () => {
    let grammar: Record<string, unknown> | null = null;
    const api: HljsApi = {
      getLanguage: (language) => (language === "terraform" ? grammar : null),
      registerLanguage: (language, languageDefinition) => {
        expect(language).toBe("terraform");
        grammar = languageDefinition({
          COMMENT: (begin: string | RegExp, end: string | RegExp) => ({
            scope: "comment",
            begin,
            end,
          }),
          QUOTE_STRING_MODE: { scope: "string" },
          NUMBER_MODE: { scope: "number" },
        });
      },
    };

    ensureTerraformHighlightLanguage(api);

    expect(grammar?.name).toBe("Terraform");
    expect(grammar?.aliases).toEqual(["tf", "tfvars", "hcl"]);
    expect(
      (grammar?.keywords as Record<string, string>).keyword.includes(
        "resource",
      ),
    ).toBe(true);
  });

  test("does not register Terraform twice", () => {
    let calls = 0;
    const api: HljsApi = {
      getLanguage: () => ({ name: "Terraform" }),
      registerLanguage: () => {
        calls++;
      },
    };

    ensureTerraformHighlightLanguage(api);

    expect(calls).toBe(0);
  });
});
