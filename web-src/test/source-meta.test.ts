import { describe, expect, test } from "vitest";
import {
  EXT_TO_LANG,
  FILENAME_TO_LANG,
  isDotenvName,
  isLikelyTextBytes,
  isPreviewableSource,
  sourceDisplayKind,
  sourceInternalPathKind,
  sourcePreviewKind,
} from "../core/source-meta";

describe("source metadata", () => {
  test.each([
    {
      name: "CSV extension",
      path: "data/sample.csv",
      previewable: true,
      kind: "csv",
    },
    {
      name: "uppercase CSV extension",
      path: "data/sample.CSV",
      previewable: true,
      kind: "csv",
    },
    {
      name: "TSV extension",
      path: "data/sample.tsv",
      previewable: true,
      kind: "tsv",
    },
    {
      name: "uppercase TSV extension",
      path: "data/sample.TSV",
      previewable: true,
      kind: "tsv",
    },
    {
      name: "plain TypeScript source",
      path: "src/example.ts",
      previewable: false,
      kind: null,
    },
  ])("classifies $name for preview", ({ path, previewable, kind }) => {
    expect(isPreviewableSource(path)).toBe(previewable);
    expect(sourcePreviewKind(path)).toBe(kind);
  });

  test("treats dotenv examples and variants as text sources", () => {
    expect(sourceDisplayKind("apps/mastra/.env.example")).toBe("text");
    expect(sourceDisplayKind(".env.local")).toBe("text");
    expect(sourceDisplayKind("apps/api/service.env.sample")).toBe("text");
    expect(isDotenvName("environment.example")).toBe(false);
  });

  test("treats rule and prompt-like files as text sources", () => {
    expect(sourceDisplayKind(".ai/codex-rules/default.rules")).toBe("text");
    expect(sourceDisplayKind("agents/default.prompt")).toBe("text");
    expect(sourceDisplayKind("docs/setup.instructions")).toBe("text");
  });

  test("detects text-like bytes without accepting binary data", () => {
    const encoder = new TextEncoder();
    expect(isLikelyTextBytes(encoder.encode("name: value\nnext: ok\n"))).toBe(
      true,
    );
    expect(isLikelyTextBytes(new Uint8Array([0x7b, 0x00, 0x7d]))).toBe(false);
    expect(isLikelyTextBytes(new Uint8Array([0xff, 0xfe, 0x00, 0x00]))).toBe(
      false,
    );
  });

  test("maps template-language extensions to their shiki highlighter", () => {
    expect(EXT_TO_LANG.erb).toBe("erb");
    expect(EXT_TO_LANG.rhtml).toBe("erb");
    expect(EXT_TO_LANG.ejs).toBe("html");
    expect(EXT_TO_LANG.vue).toBe("vue");
    expect(EXT_TO_LANG.svelte).toBe("svelte");
    expect(EXT_TO_LANG.astro).toBe("astro");
    expect(EXT_TO_LANG.hbs).toBe("handlebars");
    expect(EXT_TO_LANG.mustache).toBe("handlebars");
    expect(EXT_TO_LANG.liquid).toBe("liquid");
    expect(EXT_TO_LANG.pug).toBe("pug");
    expect(EXT_TO_LANG.twig).toBe("twig");
    expect(EXT_TO_LANG.haml).toBe("haml");
  });

  test("maps config, style, and general-purpose extensions to their shiki highlighter", () => {
    expect(EXT_TO_LANG.sass).toBe("sass");
    expect(EXT_TO_LANG.less).toBe("less");
    expect(EXT_TO_LANG.graphql).toBe("graphql");
    expect(EXT_TO_LANG.graphqls).toBe("graphql");
    expect(EXT_TO_LANG.gql).toBe("graphql");
    expect(EXT_TO_LANG.ps1).toBe("powershell");
    expect(EXT_TO_LANG.psm1).toBe("powershell");
    expect(EXT_TO_LANG.psd1).toBe("powershell");
    expect(EXT_TO_LANG.ini).toBe("ini");
    expect(EXT_TO_LANG.conf).toBe("ini");
    expect(EXT_TO_LANG.env).toBe("dotenv");
    expect(EXT_TO_LANG.prisma).toBe("prisma");
    expect(EXT_TO_LANG.pas).toBe("pascal");
    expect(EXT_TO_LANG.adoc).toBe("asciidoc");
    expect(EXT_TO_LANG.asciidoc).toBe("asciidoc");
    expect(EXT_TO_LANG.jsonc).toBe("jsonc");
    expect(EXT_TO_LANG.gd).toBe("gdscript");
  });

  test("maps secondary TypeScript, Kotlin, and C++ extensions to their shiki highlighter", () => {
    expect(EXT_TO_LANG.mts).toBe("typescript");
    expect(EXT_TO_LANG.cts).toBe("typescript");
    expect(EXT_TO_LANG.kts).toBe("kotlin");
    expect(EXT_TO_LANG.cxx).toBe("cpp");
    expect(EXT_TO_LANG.hxx).toBe("cpp");
  });

  test("maps Ruby DSL filenames (Gemfile, Rakefile, etc.) to the ruby highlighter", () => {
    expect(FILENAME_TO_LANG.gemfile).toBe("ruby");
    expect(FILENAME_TO_LANG.rakefile).toBe("ruby");
    expect(FILENAME_TO_LANG.brewfile).toBe("ruby");
    expect(FILENAME_TO_LANG.guardfile).toBe("ruby");
    expect(FILENAME_TO_LANG.capfile).toBe("ruby");
    expect(FILENAME_TO_LANG.vagrantfile).toBe("ruby");
    expect(FILENAME_TO_LANG.podfile).toBe("ruby");
    expect(FILENAME_TO_LANG.fastfile).toBe("ruby");
    expect(FILENAME_TO_LANG.berksfile).toBe("ruby");
  });

  test("treats ERB templates as text sources by extension alone", () => {
    expect(sourceDisplayKind("app/views/users/show.html.erb")).toBe("text");
    expect(sourceDisplayKind("mailer.text.erb")).toBe("text");
  });

  test("detects internal metadata paths before source rendering", () => {
    expect(sourceInternalPathKind(".code-viewer/settings.json")).toBe(
      "code-viewer",
    );
    expect(sourceInternalPathKind("packages/app/.code-viewer/state.json")).toBe(
      "code-viewer",
    );
    expect(sourceInternalPathKind(".git/config")).toBe("git");
    expect(sourceInternalPathKind("src/code-viewer/readme.md")).toBe(null);
  });
});
