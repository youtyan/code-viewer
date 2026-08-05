// フックを入れていないセッションの当て推量。
//
// tmux も間隔も動かさず、1 ペインぶんの判定だけを見る。ここが狂うと、画面が
// 動いていないだけのセッションが延々「稼働」に見えるか、逆に動いているのに
// 停止扱いになる。

import { describe, expect, test } from "vitest";
import {
  ACTIVITY_IDLE_AFTER_MS,
  nextActivityState,
  OVERRIDE_CHANGE_STREAK,
  rotateForSweep,
} from "../server/terminal/activity";

const AT = 1_000_000;

describe("nextActivityState", () => {
  test("初めて見たペインは稼働として始める", () => {
    const result = nextActivityState(undefined, "h1", AT);
    expect(result.state).toBe("working");
    expect(result.seen).toEqual({ hash: "h1", changedAt: AT, changeStreak: 0 });
  });

  test("画面が変われば稼働に戻り、変化時刻を更新する", () => {
    const previous = { hash: "h1", changedAt: AT, changeStreak: 0 };
    const result = nextActivityState(previous, "h2", AT + 60_000);
    expect(result.state).toBe("working");
    expect(result.seen.changedAt).toBe(AT + 60_000);
  });

  test.each([
    {
      name: "境界の直前はまだ稼働",
      elapsed: ACTIVITY_IDLE_AFTER_MS - 1,
      expected: "working",
    },
    {
      name: "境界ちょうどで停止",
      elapsed: ACTIVITY_IDLE_AFTER_MS,
      expected: "idle",
    },
    {
      name: "境界を超えたら停止",
      elapsed: ACTIVITY_IDLE_AFTER_MS + 1,
      expected: "idle",
    },
  ])("$name", ({ elapsed, expected }) => {
    const previous = { hash: "h1", changedAt: AT, changeStreak: 0 };
    const result = nextActivityState(previous, "h1", AT + elapsed);
    expect(result.state).toBe(expected);
    // 変わっていないので、変化時刻は据え置き。
    expect(result.seen.changedAt).toBe(AT);
  });

  test("待ちにも未読にも倒さない", () => {
    // 画面からは「止まった理由」が決められない。嘘の「あなたの番」を出す
    // くらいなら何も言わない、という約束をここで固定する。
    const still = { hash: "h1", changedAt: AT, changeStreak: 0 };
    const states = [
      nextActivityState(undefined, "h1", AT).state,
      nextActivityState(still, "h1", AT + 999_999).state,
      nextActivityState(still, "h2", AT + 1).state,
    ];
    expect(states).not.toContain("waiting");
    expect(states).not.toContain("done");
  });
});

describe("申告を上書きしてよいかの判定", () => {
  // 一度入った申告が二度と更新されないセッションは、放っておくと永久に
  // 「あなたの番」に居座る。画面が動き続けていれば入力待ちではありえないので、
  // そこだけ当て推量で稼働へ上げられるようにしてある。
  test("初めて見た時点では上書きしない", () => {
    expect(nextActivityState(undefined, "h1", AT).override).toBe(false);
  });

  test("1 回変わっただけでは上書きしない", () => {
    const previous = { hash: "h0", changedAt: AT, changeStreak: 0 };
    expect(nextActivityState(previous, "h1", AT + 1).override).toBe(false);
  });

  test.each([
    { name: "境界の直前は上書きしない", streak: OVERRIDE_CHANGE_STREAK - 2 },
  ])("$name", ({ streak }) => {
    const previous = { hash: "h0", changedAt: AT, changeStreak: streak };
    expect(nextActivityState(previous, "h1", AT + 1).override).toBe(false);
  });

  test("境界に達したら上書きしてよい", () => {
    const previous = {
      hash: "h0",
      changedAt: AT,
      changeStreak: OVERRIDE_CHANGE_STREAK - 1,
    };
    const result = nextActivityState(previous, "h1", AT + 1);
    expect(result.override).toBe(true);
    expect(result.state).toBe("working");
  });

  test("止まった瞬間に連続回数は 0 に戻る", () => {
    // 一度動いたからといって、その後ずっと上書きできてはいけない。
    const previous = {
      hash: "h1",
      changedAt: AT,
      changeStreak: OVERRIDE_CHANGE_STREAK + 3,
    };
    const result = nextActivityState(previous, "h1", AT + 1);
    expect(result.seen.changeStreak).toBe(0);
    expect(result.override).toBe(false);
  });
});

describe("rotateForSweep", () => {
  // 上限を超える本数があるとき、先頭だけを見続けると後ろのペインが永久に
  // 観測されない。続きから順に回して全部に行き渡らせる。
  const items = ["a", "b", "c", "d", "e"];

  test.each([
    { name: "先頭から取る", offset: 0, limit: 2, batch: ["a", "b"], next: 2 },
    { name: "続きから取る", offset: 2, limit: 2, batch: ["c", "d"], next: 4 },
    { name: "端で折り返す", offset: 4, limit: 2, batch: ["e", "a"], next: 1 },
    {
      name: "上限が本数以上なら全部",
      offset: 0,
      limit: 9,
      batch: ["a", "b", "c", "d", "e"],
      next: 0,
    },
  ])("$name", ({ offset, limit, batch, next }) => {
    const result = rotateForSweep(items, offset, limit);
    expect(result.batch).toEqual(batch);
    expect(result.nextOffset).toBe(next);
  });

  test("何周かで全部に行き渡る", () => {
    const seen = new Set<string>();
    let offset = 0;
    for (let round = 0; round < 3; round += 1) {
      const result = rotateForSweep(items, offset, 2);
      for (const item of result.batch) seen.add(item);
      offset = result.nextOffset;
    }
    expect([...seen].sort()).toEqual(items);
  });

  test("空でも壊れない", () => {
    expect(rotateForSweep([], 3, 2)).toEqual({ batch: [], nextOffset: 0 });
  });
});
