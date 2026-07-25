import type { HljsApi } from "./types";

type HljsMode = Record<string, unknown>;

type HljsModeHelpers = {
  COMMENT?: (
    begin: string | RegExp,
    end: string | RegExp,
    options?: HljsMode,
  ) => HljsMode;
  QUOTE_STRING_MODE?: HljsMode;
  NUMBER_MODE?: HljsMode;
};

function lineComment(hljs: HljsModeHelpers, begin: string | RegExp): HljsMode {
  return (
    hljs.COMMENT?.(begin, "$") || {
      scope: "comment",
      begin,
      end: "$",
    }
  );
}

function blockComment(hljs: HljsModeHelpers): HljsMode {
  return (
    hljs.COMMENT?.("/\\*", "\\*/") || {
      scope: "comment",
      begin: "/\\*",
      end: "\\*/",
    }
  );
}

function terraformLanguageDefinition(hljs: Record<string, unknown>): HljsMode {
  const api = hljs as HljsModeHelpers;
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

// GDScript (Godot). highlight.js のフルバンドルに文法が含まれないため、
// terraform と同様にここで手書き定義を登録する (キーワードは Godot 4 系)。
function gdscriptLanguageDefinition(hljs: Record<string, unknown>): HljsMode {
  const api = hljs as HljsModeHelpers;
  return {
    name: "GDScript",
    aliases: ["gd"],
    keywords: {
      keyword:
        "and as assert await break breakpoint class class_name const continue elif else enum extends for func if in is match not or pass return self signal static super var void when while yield",
      literal: "true false null PI TAU INF NAN",
      built_in:
        "print printerr printraw print_rich print_debug push_error push_warning preload load range len abs absf absi sign floor ceil round clamp clampf clampi lerp lerpf min max pow sqrt randf randi randf_range randi_range randomize str int float bool typeof type_exists is_instance_valid Vector2 Vector2i Vector3 Vector3i Vector4 Vector4i Rect2 Rect2i Transform2D Transform3D Basis Quaternion Plane AABB Color NodePath StringName Callable Signal Array Dictionary PackedByteArray PackedInt32Array PackedInt64Array PackedFloat32Array PackedFloat64Array PackedStringArray PackedVector2Array PackedVector3Array PackedColorArray",
    },
    contains: [
      lineComment(api, "#"),
      // """...""" は "..." と同じ位置で始まるため QUOTE_STRING_MODE より先に置く。
      {
        scope: "string",
        begin: '"""',
        end: '"""',
      },
      api.QUOTE_STRING_MODE || { scope: "string", begin: '"', end: '"' },
      { scope: "string", begin: "'", end: "'" },
      // @export / @onready などのアノテーション。
      { scope: "meta", begin: "@[A-Za-z_]\\w*" },
      // $Node/Path と %UniqueName の参照リテラル。
      { scope: "symbol", begin: "[$%][A-Za-z_/][\\w/]*" },
      api.NUMBER_MODE || { scope: "number", begin: "\\b\\d+(\\.\\d+)?\\b" },
      { scope: "function", begin: "\\b[A-Za-z_]\\w*(?=\\()" },
    ],
  };
}

function ensureHighlightLanguage(
  hljsRef: HljsApi | null,
  name: string,
  definition: (hljs: Record<string, unknown>) => HljsMode,
) {
  if (!hljsRef?.registerLanguage) return;
  if (hljsRef.getLanguage?.(name)) return;
  try {
    hljsRef.registerLanguage(name, definition);
  } catch {
    // A broken optional language must not disable the rest of highlighting.
  }
}

export function ensureTerraformHighlightLanguage(hljsRef: HljsApi | null) {
  ensureHighlightLanguage(hljsRef, "terraform", terraformLanguageDefinition);
}

export function ensureGdscriptHighlightLanguage(hljsRef: HljsApi | null) {
  ensureHighlightLanguage(hljsRef, "gdscript", gdscriptLanguageDefinition);
}
