// ページに重ねた箱の中で回したホイールが、後ろのページへ渡らないか。
//
// 見たいのは 2 つ。
//
// 1. 渡さない
//
// パネルやドロワーはページの上に重ねて出している。中で回したホイールを外へ
// 渡すと、後ろで見ていた画面が一緒に動く。中身が枠に収まっていて 1px も動け
// ないときが一番危ない。CSS の overscroll-behavior はそういう箱を素通りする
// ので、ここで止まっていないと誰も止めない。
//
// 2. 中身のスクロールは邪魔しない
//
// 止めすぎると今度は中身が動かせなくなる。動ける向きは必ず通す。
//
// happy-dom はレイアウトを持たず scrollHeight などが常に 0 なので、寸法は
// 差し替えて渡す。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { blockScrollChaining } from "../core/scroll-chaining";

/** 中身 1000px を 300px の枠に入れた箱。動ける余地は 700px。 */
const CONTENT = 1000;
const BOX = 300;
const ROOM = CONTENT - BOX;

type Metrics = {
  scrollTop?: number;
  scrollLeft?: number;
  /** 縦に溢れているか。既定は溢れている (中身 1000px / 枠 300px)。 */
  overflowsY?: boolean;
  overflowsX?: boolean;
};

let root: HTMLElement;
let box: HTMLElement;
let leaf: HTMLElement;
let detach: (() => void) | null = null;

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  detach?.();
  detach = null;
  document.body.innerHTML = "";
});

/**
 * root > box > leaf を組む。ホイールは一番内側の leaf で受ける (本物でも
 * 端末の行や一覧の項目が受ける)。
 */
function build(overflow: string, metrics: Metrics = {}): void {
  root = document.createElement("div");
  box = document.createElement("div");
  leaf = document.createElement("div");
  box.style.cssText = overflow;
  root.append(box);
  box.append(leaf);
  document.body.append(root);
  size(box, metrics);
  // leaf は中身そのものなので、どの向きにも動かない。
  size(leaf, { overflowsY: false, overflowsX: false });
  detach = blockScrollChaining(root);
}

function size(el: HTMLElement, metrics: Metrics): void {
  const define = (key: string, value: number) => {
    Object.defineProperty(el, key, { configurable: true, value });
  };
  define("clientHeight", BOX);
  define("clientWidth", BOX);
  define("scrollHeight", metrics.overflowsY === false ? BOX : CONTENT);
  define("scrollWidth", metrics.overflowsX === false ? BOX : CONTENT);
  define("scrollTop", metrics.scrollTop ?? 0);
  define("scrollLeft", metrics.scrollLeft ?? 0);
}

/** leaf でホイールを回す。止められたら true。 */
function wheel(deltaX: number, deltaY: number): boolean {
  const event = new WheelEvent("wheel", {
    deltaX,
    deltaY,
    bubbles: true,
    cancelable: true,
  });
  leaf.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("縦に動ける箱", () => {
  test.each([
    {
      name: "上端で上へ回すと止める",
      scrollTop: 0,
      deltaY: -120,
      blocked: true,
    },
    { name: "上端で下へ回すと通す", scrollTop: 0, deltaY: 120, blocked: false },
    {
      name: "途中なら上へ回しても通す",
      scrollTop: 350,
      deltaY: -120,
      blocked: false,
    },
    {
      name: "途中なら下へ回しても通す",
      scrollTop: 350,
      deltaY: 120,
      blocked: false,
    },
    {
      name: "下端で下へ回すと止める",
      scrollTop: ROOM,
      deltaY: 120,
      blocked: true,
    },
    {
      name: "下端で上へ回すと通す",
      scrollTop: ROOM,
      deltaY: -120,
      blocked: false,
    },
    // 端に着いたときの小数を捨てるため 1px の余裕を見ている。その境目。
    {
      name: "境界: 残り 1px は下端とみなして止める",
      scrollTop: ROOM - 1,
      deltaY: 120,
      blocked: true,
    },
    {
      name: "境界: 残り 2px なら下へ通す",
      scrollTop: ROOM - 2,
      deltaY: 120,
      blocked: false,
    },
    {
      name: "境界: 1px しか下りていなければ上端とみなして止める",
      scrollTop: 1,
      deltaY: -120,
      blocked: true,
    },
    {
      name: "境界: 2px 下りていれば上へ通す",
      scrollTop: 2,
      deltaY: -120,
      blocked: false,
    },
  ])("$name", ({ scrollTop, deltaY, blocked }) => {
    build("overflow-y: auto;", { scrollTop });

    expect(wheel(0, deltaY)).toBe(blocked);
  });
});

describe("横に動ける箱", () => {
  test.each([
    {
      name: "左端で左へ回すと止める",
      scrollLeft: 0,
      deltaX: -120,
      blocked: true,
    },
    {
      name: "左端で右へ回すと通す",
      scrollLeft: 0,
      deltaX: 120,
      blocked: false,
    },
    {
      name: "右端で右へ回すと止める",
      scrollLeft: ROOM,
      deltaX: 120,
      blocked: true,
    },
    {
      name: "右端で左へ回すと通す",
      scrollLeft: ROOM,
      deltaX: -120,
      blocked: false,
    },
  ])("$name", ({ scrollLeft, deltaX, blocked }) => {
    build("overflow-x: auto;", { scrollLeft });

    expect(wheel(deltaX, 0)).toBe(blocked);
  });
});

describe("溢れていても動かない箱", () => {
  // 中身が溢れているだけの箱をスクロール先と見なすと、実際には動かないのに
  // ホイールを通してしまい、後ろのページが動く。xterm が字の大きさを測る
  // ために置く .xterm-helpers がこれに当たる (高さ 0 の枠に 1 画面分)。
  test.each([
    { name: "auto なら動けるので通す", overflow: "auto", blocked: false },
    { name: "scroll なら動けるので通す", overflow: "scroll", blocked: false },
    {
      name: "visible は動かないので止める",
      overflow: "visible",
      blocked: true,
    },
    { name: "hidden は動かないので止める", overflow: "hidden", blocked: true },
  ])("$name", ({ overflow, blocked }) => {
    build(`overflow-y: ${overflow};`, { scrollTop: 350 });

    expect(wheel(0, -120)).toBe(blocked);
  });
});

describe("そのほか", () => {
  test("中身が枠に収まっていれば、どちらへ回しても止める", () => {
    // tmux ペインが枠より短いときの端末がこれ。一番よくある形。
    build("overflow-y: auto;", { overflowsY: false, overflowsX: false });

    expect(wheel(0, 120)).toBe(true);
    expect(wheel(0, -120)).toBe(true);
  });

  test("中身が自分で捌いた分には手を出さない", () => {
    // xterm は alt buffer のアプリ (vim, less) へホイールを ↑/↓ として送り、
    // そこで既定の動作を止める。二重に触ると、その判断を上書きしてしまう。
    build("overflow-y: auto;", { overflowsY: false });
    let touched = false;
    leaf.addEventListener("wheel", (event) => {
      event.preventDefault();
      Object.defineProperty(event, "preventDefault", {
        configurable: true,
        value: () => {
          touched = true;
        },
      });
    });

    wheel(0, 120);

    expect(touched).toBe(false);
  });

  test("外側が動けなくても、内側が動けるなら通す", () => {
    // 左の一覧のように、動ける箱が枠の内側に入れ子で来ることがある。
    build("overflow-y: auto;", { overflowsY: false });
    leaf.style.cssText = "overflow-y: auto;";
    size(leaf, { scrollTop: 350 });

    expect(wheel(0, 120)).toBe(false);
  });

  test("外すと止めなくなる", () => {
    build("overflow-y: auto;", { overflowsY: false });
    detach?.();
    detach = null;

    expect(wheel(0, 120)).toBe(false);
  });
});
