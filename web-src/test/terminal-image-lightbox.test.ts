// 端末で見つけた画像を大きく開くモーダル。
//
// 見たいのは 3 つ。開いたら画像が入っていること、閉じ方が全部効くこと、
// 2 枚目を開いても 1 枚しか残らないこと。拡大縮小そのものは
// core/diagram-viewport の持ち物なので、ここでは操作と倍率表示の配線を見る。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { terminalText } from "../views/terminal/i18n";
import { openImageLightbox } from "../views/terminal/image-lightbox";

const IMAGE = {
  url: "/_agent/image?path=%2Ftmp%2Fout.png",
  name: "out.png",
  path: "/tmp/out.png",
};

const OTHER = {
  url: "/_agent/image?path=%2Ftmp%2Fother.png",
  name: "other.png",
  path: "/tmp/other.png",
};

const text = () => terminalText("en");

function overlay(): HTMLElement | null {
  return document.querySelector(".terminal-lightbox");
}

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("画像の拡大表示", () => {
  test("開くと画像とパスが入る", () => {
    openImageLightbox(IMAGE, text());

    const box = overlay();
    expect(box).not.toBeNull();
    expect(box?.querySelector("img")?.getAttribute("src")).toBe(IMAGE.url);
    expect(box?.querySelector("img")?.getAttribute("alt")).toBe("out.png");
    expect(box?.querySelector(".terminal-lightbox-path")?.textContent).toBe(
      "/tmp/out.png",
    );
    // 覆いなので、支援技術にもダイアログとして伝える。
    expect(box?.getAttribute("role")).toBe("dialog");
    expect(box?.getAttribute("aria-modal")).toBe("true");
  });

  test("縮小すると現在倍率を表示し、倍率表示を押すと等倍に戻る", () => {
    openImageLightbox(IMAGE, text());

    const buttons = overlay()?.querySelectorAll<HTMLButtonElement>(
      ".terminal-lightbox-actions button",
    );
    const stage = overlay()?.querySelector<HTMLElement>(
      ".terminal-lightbox-stage",
    );
    if (!buttons || !stage)
      throw new Error("lightbox controls were not mounted");
    const zoomOut = buttons.item(0);
    const zoomReset = buttons.item(1);
    if (!zoomOut || !zoomReset)
      throw new Error("lightbox zoom controls were not mounted");
    expect(buttons).toHaveLength(4);
    expect(zoomReset.textContent).toBe("100%");

    zoomOut.click();
    expect(stage.style.transform).toBe("scale(0.8)");
    expect(zoomReset.textContent).toBe("80%");

    zoomReset.click();
    expect(stage.style.transform).toBe("scale(1)");
    expect(zoomReset.textContent).toBe("100%");
  });

  test("返ってきた関数で閉じられる", () => {
    const close = openImageLightbox(IMAGE, text());
    close();
    expect(overlay()).toBeNull();
  });

  test("Esc で閉じる", () => {
    openImageLightbox(IMAGE, text());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlay()).toBeNull();
  });

  test("背景を押すと閉じる", () => {
    openImageLightbox(IMAGE, text());
    const box = overlay();
    box?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overlay()).toBeNull();
  });

  test("画像の上を押しても閉じない", () => {
    // 拡大したまま動かしたいので、中身の上のドラッグで閉じては困る。
    openImageLightbox(IMAGE, text());
    const picture = overlay()?.querySelector("img");
    picture?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overlay()).not.toBeNull();
  });

  test("続けて開いても 1 枚だけ", () => {
    openImageLightbox(IMAGE, text());
    openImageLightbox(OTHER, text());

    expect(document.querySelectorAll(".terminal-lightbox")).toHaveLength(1);
    expect(overlay()?.querySelector("img")?.getAttribute("src")).toBe(
      OTHER.url,
    );
  });

  test("閉じた後は Esc を拾わない", () => {
    // 受け口が残ると、次に Esc を押したときに別の何か (パネル) の邪魔をする。
    const close = openImageLightbox(IMAGE, text());
    close();
    let reached = false;
    const listener = () => {
      reached = true;
    };
    document.addEventListener("keydown", listener);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.removeEventListener("keydown", listener);
    expect(reached).toBe(true);
  });
});
