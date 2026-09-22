// ブラウザの通常のタブ (インストールした窓でない) では、⌘W・⌘T などのタブ操作の
// キーを code-viewer が一切受けず、今までどおりブラウザに渡す (resolvePwaKey が
// null)。happy-dom の本物の KeyboardEvent と window.matchMedia で、表の全部の
// キーを確かめる。同じイベントが standalone では受けられることも見て、イベントの組み方が
// 正しいことを担保する。
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  PWA_TAB_KEYS,
  type PwaKeyTarget,
  resolvePwaKey,
  STANDALONE_MEDIA_QUERY,
} from "../core/pwa";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

/** 表の 1 行を、その OS の押し方の KeyboardEvent にする。 */
function eventsFor(
  mac: boolean,
): Array<{ label: string; event: KeyboardEvent }> {
  const out: Array<{ label: string; event: KeyboardEvent }> = [];
  for (const chord of PWA_TAB_KEYS) {
    if (chord.modifier === "mac-meta" && !mac) continue;
    const meta =
      chord.modifier === "mac-meta" || (chord.modifier === "primary" && mac);
    const ctrl =
      chord.modifier === "ctrl" || (chord.modifier === "primary" && !mac);
    const key = chord.keys[0] === "tab" ? "Tab" : chord.keys[0];
    out.push({
      label: `${meta ? "Meta+" : ""}${ctrl ? "Ctrl+" : ""}${chord.shift ? "Shift+" : ""}${key}`,
      event: new KeyboardEvent("keydown", {
        key,
        metaKey: meta,
        ctrlKey: ctrl,
        shiftKey: !!chord.shift,
        bubbles: true,
        cancelable: true,
      }),
    });
  }
  return out;
}

const TARGETS: PwaKeyTarget[] = ["page", "terminal", "blocked"];

test.each([
  true,
  false,
])("a normal browser tab passes every tab key to the browser (mac: %s)", (mac) => {
  const standalone = window.matchMedia(STANDALONE_MEDIA_QUERY).matches;
  const events = eventsFor(mac);
  const outcomes = events.flatMap(({ label, event }) =>
    TARGETS.map((target) => ({
      label,
      target,
      outcome: resolvePwaKey(event, {
        standalone,
        mac,
        target,
        composing: false,
      }),
    })),
  );
  // イベントの組み方の担保: 同じ押し方は、インストールした窓の本文では受ける。
  const inStandalone = events.map(({ label, event }) => ({
    label,
    handled:
      resolvePwaKey(event, {
        standalone: true,
        mac,
        target: "page",
        composing: false,
      }) !== null,
  }));
  expect([
    standalone,
    events
      .map((item) => item.label)
      .filter((label) => /(^|\+)(w|t)$/.test(label)).length,
    outcomes.filter((item) => item.outcome !== null),
    inStandalone.filter((item) => !item.handled),
  ]).toEqual([false, 3, [], []]);
});
