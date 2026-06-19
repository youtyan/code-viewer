import type { HljsApi } from "./types";

type HljsMode = Record<string, unknown>;

type TerraformHljs = {
  COMMENT?: (
    begin: string | RegExp,
    end: string | RegExp,
    options?: HljsMode,
  ) => HljsMode;
  QUOTE_STRING_MODE?: HljsMode;
  NUMBER_MODE?: HljsMode;
};

function lineComment(hljs: TerraformHljs, begin: string | RegExp): HljsMode {
  return (
    hljs.COMMENT?.(begin, "$") || {
      scope: "comment",
      begin,
      end: "$",
    }
  );
}

function blockComment(hljs: TerraformHljs): HljsMode {
  return (
    hljs.COMMENT?.("/\\*", "\\*/") || {
      scope: "comment",
      begin: "/\\*",
      end: "\\*/",
    }
  );
}

function terraformLanguageDefinition(hljs: Record<string, unknown>): HljsMode {
  const api = hljs as TerraformHljs;
  return {
    name: "Terraform",
    aliases: ["tf", "tfvars", "hcl"],
    keywords: {
      keyword:
        "resource data variable output locals module provider terraform backend dynamic lifecycle provisioner connection count for_each depends_on source version required_version required_providers",
      literal: "true false null",
      built_in:
        "abspath basename chomp cidrhost cidrnetmask cidrsubnet cidrsubnets compact concat contains csvdecode dirname distinct element file filebase64 fileexists flatten format formatdate index jsondecode jsonencode keys length lookup lower merge nonsensitive regex replace sensitive setproduct sort split substr templatefile tobool tonumber tostring try upper values yamldecode yamlencode zipmap",
    },
    contains: [
      lineComment(api, "#"),
      lineComment(api, "//"),
      blockComment(api),
      api.QUOTE_STRING_MODE || {
        scope: "string",
        begin: '"',
        end: '"',
        contains: [{ begin: "\\$\\{", end: "\\}" }],
      },
      {
        scope: "string",
        begin: "<<-?\\s*([A-Za-z_][\\w-]*)",
        end: "^\\s*\\1\\s*$",
      },
      api.NUMBER_MODE || {
        scope: "number",
        begin: "\\b\\d+(\\.\\d+)?\\b",
      },
      {
        scope: "attr",
        begin: "\\b[A-Za-z_][\\w-]*(?=\\s*=)",
      },
      {
        scope: "function",
        begin: "\\b[A-Za-z_][\\w-]*(?=\\()",
      },
      {
        scope: "variable",
        begin:
          "\\b(?:var|local|module|data|resource|provider)\\.[A-Za-z_][\\w-]*(?:\\.[A-Za-z_][\\w-]*)*",
      },
    ],
  };
}

export function ensureTerraformHighlightLanguage(hljsRef: HljsApi | null) {
  if (!hljsRef?.registerLanguage) return;
  if (hljsRef.getLanguage?.("terraform")) return;
  try {
    hljsRef.registerLanguage("terraform", terraformLanguageDefinition);
  } catch {
    // A broken optional language must not disable the rest of highlighting.
  }
}
