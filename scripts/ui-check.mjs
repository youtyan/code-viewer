// 画面の確認の道具。使い捨ての headless Chrome を CDP で動かし、手順の JSON を順に
// 実行して、画像と結果 (results.json) を出す。利用者のブラウザには触らない。
// 砂場の起こし方と使い方は .agents/skills/project-rules/references/diagnose.md の
// 「UI を実画面で確認する」。
//
//   node scripts/ui-check.mjs <プロジェクトの URL> <steps.json> <出力のフォルダ>
//
// 手順 (配列の 1 要素ずつ。ms は後の待ち):
//   {"do":"goto","path":"file?path=src%2Fmain.ts","ms":3000}  URL からの相対パス
//   {"do":"settings","patch":{"theme":"dark","colorTheme":"ink"}}  設定を PATCH (全部の窓に効く)
//   {"do":"viewport","w":1440,"h":900}
//   {"do":"click","sel":".main-tab"} / {"do":"click","x":600,"y":120}
//   {"do":"hover","sel":"..."} / {"do":"drag","from":[x,y],"to":[x,y]}
//   {"do":"key","key":"Escape"}  (code・vk・mods を足せる)
//   {"do":"type","text":"ls -la"}  焦点のある所へ文字を入れて Enter ("enter":false で押さない)
//   {"do":"eval","label":"名前","js":"document.title"}  値を results.json に残す
//   {"do":"shot","name":"after-dark"} / {"do":"shot","name":"menu","sel":".gdp-context-menu"}
//   {"do":"wait","ms":500}
//
// 終わりの状態: 失敗した手順・ページの例外・console の error と warning は results.json と
// 標準出力に出し、1 つでもあれば終了コード 1。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPage, startChrome } from "./headless-chrome.mjs";

const [pageUrl, stepsPath, outDir] = process.argv.slice(2);
if (!pageUrl || !stepsPath || !outDir) {
  console.error(
    "usage: node scripts/ui-check.mjs <project url> <steps.json> <out dir>",
  );
  process.exit(2);
}
const base = pageUrl.endsWith("/") ? pageUrl : `${pageUrl}/`;
const steps = JSON.parse(readFileSync(stepsPath, "utf8"));
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// WebGL (端末の描画) を GPU の無い headless でも動かす。
const chrome = await startChrome(["--enable-unsafe-swiftshader"]);
const results = [];
const pageErrors = [];
try {
  const { cdp } = await openPage(chrome.endpoint);
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    pageErrors.push(
      `exception: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
    );
  });
  cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type === "error" || type === "warning")
      pageErrors.push(
        `console.${type}: ${args.map((a) => a.value ?? a.description).join(" ")}`,
      );
  });
  await cdp.send("Runtime.enable");
  const viewport = (width, height) =>
    cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  await viewport(1440, 900);

  const evaluate = async (expression) => {
    const answer = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (answer.exceptionDetails)
      throw new Error(
        `eval threw: ${answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text}`,
      );
    return answer.result.value;
  };
  const boxOf = (selector) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    })()`);
  const pointOf = async (step) => {
    if (!step.sel) return [step.x, step.y];
    const box = await boxOf(step.sel);
    if (!box) throw new Error(`not found: ${step.sel}`);
    return [box[0] + box[2] / 2, box[1] + box[3] / 2];
  };
  const mouse = (type, x, y, extra = {}) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      clickCount: 1,
      ...extra,
    });
  const key = async (type, step) =>
    cdp.send("Input.dispatchKeyEvent", {
      type,
      key: step.key,
      code: step.code ?? step.key,
      modifiers: step.mods ?? 0,
      windowsVirtualKeyCode: step.vk ?? 0,
      ...(type === "keyDown" && step.text ? { text: step.text } : {}),
    });

  const run = {
    async goto(step) {
      await cdp.send("Page.navigate", {
        url: new URL(step.path ?? "", base).href,
      });
      await sleep(step.ms ?? 3000);
    },
    async wait(step) {
      await sleep(step.ms);
    },
    async eval(step) {
      return evaluate(step.js);
    },
    async settings(step) {
      // プロジェクトの URL (/p/<鍵>/) の下の設定。入口の直下ではない。
      return evaluate(`(async () => {
        const prefix = location.pathname.match(/^\\/p\\/[^/]+/)?.[0] ?? "";
        const res = await fetch(prefix + "/_state/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Code-Viewer-Action": "1" },
          body: ${JSON.stringify(JSON.stringify(step.patch))},
        });
        const body = await res.text();
        if (!res.ok) throw new Error("PATCH /_state/settings answered " + res.status + ": " + body);
        return res.status;
      })()`).finally(() => sleep(step.ms ?? 1200));
    },
    async viewport(step) {
      await viewport(step.w, step.h);
      await sleep(step.ms ?? 800);
    },
    async click(step) {
      const [x, y] = await pointOf(step);
      const extra = step.mods ? { modifiers: step.mods } : {};
      await mouse("mouseMoved", x, y, { button: "none" });
      await mouse("mousePressed", x, y, extra);
      await mouse("mouseReleased", x, y, extra);
      await sleep(step.ms ?? 600);
    },
    async hover(step) {
      const [x, y] = await pointOf(step);
      await mouse("mouseMoved", x, y, { button: "none" });
      await sleep(step.ms ?? 600);
    },
    async drag(step) {
      const [fromX, fromY] = step.from;
      const [toX, toY] = step.to;
      await mouse("mouseMoved", fromX, fromY, { button: "none" });
      await mouse("mousePressed", fromX, fromY);
      for (let i = 1; i <= 8; i++)
        await mouse(
          "mouseMoved",
          fromX + ((toX - fromX) * i) / 8,
          fromY + ((toY - fromY) * i) / 8,
          { buttons: 1 },
        );
      await mouse("mouseReleased", toX, toY);
      await sleep(step.ms ?? 600);
    },
    async key(step) {
      await key("keyDown", step);
      await key("keyUp", step);
      await sleep(step.ms ?? 400);
    },
    async type(step) {
      await cdp.send("Input.insertText", { text: step.text });
      if (step.enter !== false) {
        const enter = { key: "Enter", code: "Enter", vk: 13, text: "\r" };
        await key("keyDown", enter);
        await key("keyUp", enter);
      }
      await sleep(step.ms ?? 800);
    },
    async shot(step) {
      let clip;
      if (step.sel) {
        const box = await boxOf(step.sel);
        if (!box) throw new Error(`not found: ${step.sel}`);
        clip = {
          x: Math.max(0, box[0] - 8),
          y: Math.max(0, box[1] - 8),
          width: box[2] + 16,
          height: box[3] + 16,
          scale: 1,
        };
      }
      const image = await cdp.send("Page.captureScreenshot", {
        format: "png",
        ...(clip ? { clip } : {}),
      });
      const file = join(outDir, `${step.name}.png`);
      writeFileSync(file, Buffer.from(image.data, "base64"));
      return file;
    },
  };

  for (const [index, step] of steps.entries()) {
    const label = step.label ?? `${index} ${step.do}`;
    const action = run[step.do];
    if (!action) {
      results.push({ step: label, error: `unknown step: ${step.do}` });
      continue;
    }
    try {
      results.push({ step: label, value: await action(step) });
    } catch (error) {
      results.push({ step: label, error: error.stack ?? String(error) });
    }
  }
} finally {
  await chrome.stop();
}

const failed = results.filter((result) => "error" in result);
writeFileSync(
  join(outDir, "results.json"),
  JSON.stringify({ results, pageErrors }, null, 1),
);
console.log(JSON.stringify({ results, pageErrors }, null, 1));
if (failed.length > 0 || pageErrors.length > 0) {
  console.error(
    `ui-check: ${failed.length} step(s) failed, ${pageErrors.length} page error(s)`,
  );
  process.exit(1);
}
