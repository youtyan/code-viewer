import { describe, expect, test } from "vitest";
import {
  ensureGdscriptHighlightLanguage,
  ensureTerraformHighlightLanguage,
} from "../core/highlight-languages";
import type { HljsApi } from "../core/types";

const LANGUAGE_CASES = [
  {
    language: "terraform",
    ensure: ensureTerraformHighlightLanguage,
    displayName: "Terraform",
    aliases: ["tf", "tfvars", "hcl"],
    keywordSample: "resource",
  },
  {
    language: "gdscript",
    ensure: ensureGdscriptHighlightLanguage,
    displayName: "GDScript",
    aliases: ["gd"],
    keywordSample: "func",
  },
];

describe("highlight language registration", () => {
  test.each(LANGUAGE_CASES)("registers $language with its aliases for diffs", ({
    language,
    ensure,
    displayName,
    aliases,
    keywordSample,
  }) => {
    let grammar: Record<string, unknown> | null = null;
    const api: HljsApi = {
      getLanguage: (requested) => (requested === language ? grammar : null),
      registerLanguage: (requested, languageDefinition) => {
        expect(requested).toBe(language);
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

    ensure(api);

    expect(grammar?.name).toBe(displayName);
    expect(grammar?.aliases).toEqual(aliases);
    expect(
      (grammar?.keywords as Record<string, string>).keyword.includes(
        keywordSample,
      ),
    ).toBe(true);
  });

  test.each(LANGUAGE_CASES)("does not register $language twice", ({
    ensure,
    displayName,
  }) => {
    let calls = 0;
    const api: HljsApi = {
      getLanguage: () => ({ name: displayName }),
      registerLanguage: () => {
        calls++;
      },
    };

    ensure(api);

    expect(calls).toBe(0);
  });
});
