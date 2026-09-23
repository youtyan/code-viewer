// ブラウザの通常のタブ (インストールした窓でない) では、⌘W・⌘T・⌘← → などの
// インストールした窓のキーを code-viewer が一切受けず、今までどおりブラウザに渡す
// (resolveKeyOutcome が null)。happy-dom の本物の KeyboardEvent と
// window.matchMedia で、窓のキーの表と PWA の既定の割り当ての全部を確かめる。
// 同じイベントが standalone では受けられることも見て、イベントの組み方が正しい
// ことを担保する。
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  defaultKeyBindings,
  pwaKeyBindings,
  resolveKeyOutcome,
} from "../core/keymap";
import { PWA_WINDOW_KEYS, STANDALONE_MEDIA_QUERY } from "../core/pwa";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

type Press = { key: string; meta: boolean; ctrl: boolean; shift: boolean };

function pressEvent({ key, meta, ctrl, shift }: Press) {
  const eventKey =
    key === "tab"
      ? "Tab"
      : key.startsWith("arrow")
        ? `Arrow${key[5].toUpperCase()}${key.slice(6)}`
        : key;
  return {
    label: `${meta ? "Meta+" : ""}${ctrl ? "Ctrl+" : ""}${shift ? "Shift+" : ""}${eventKey}`,
    event: new KeyboardEvent("keydown", {
      key: eventKey,
      metaKey: meta,
      ctrlKey: ctrl,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  };
}

/** 窓のキーの表と PWA の既定の割り当てを、その OS の押し方の KeyboardEvent にする。 */
function eventsFor(mac: boolean) {
  const presses: Press[] = [];
  for (const item of PWA_WINDOW_KEYS) {
    if (item.modifier === "mac-meta" && !mac) continue;
    presses.push({
      key: item.keys[0],
      meta:
        item.modifier === "mac-meta" || (item.modifier === "primary" && mac),
      ctrl: item.modifier === "ctrl" || (item.modifier === "primary" && !mac),
      shift: !!item.shift,
    });
  }
  for (const binding of pwaKeyBindings(mac))
    presses.push({
      key: binding.key,
      meta: !!binding.meta,
      ctrl: !!binding.ctrl,
      shift: !!binding.shift,
    });
  return presses.map(pressEvent);
}

const TARGETS = [
  { name: "page", editable: false, terminal: false, blocked: false },
  { name: "input", editable: true, terminal: false, blocked: false },
  { name: "terminal", editable: true, terminal: true, blocked: false },
  { name: "blocked", editable: false, terminal: false, blocked: true },
];

test.each([
  true,
  false,
])("a normal browser tab passes every installed-window key to the browser (mac: %s)", (mac) => {
  const standalone = window.matchMedia(STANDALONE_MEDIA_QUERY).matches;
  const bindings = defaultKeyBindings(mac);
  const resolve = (
    event: KeyboardEvent,
    target: (typeof TARGETS)[number],
    inWindow: boolean,
  ) =>
    resolveKeyOutcome(
      event,
      {
        scope: "global",
        editable: target.editable,
        terminal: target.terminal,
        pageKeymapBlocked: target.blocked,
        standalone: inWindow,
        mac,
      },
      bindings,
    );
  const events = eventsFor(mac);
  const outcomes = events.flatMap(({ label, event }) =>
    TARGETS.map((target) => ({
      label,
      target: target.name,
      outcome: resolve(event, target, standalone),
    })),
  );
  // イベントの組み方の担保: 同じ押し方は、インストールした窓の本文では受ける。
  const inStandalone = events.map(({ label, event }) => ({
    label,
    handled: resolve(event, TARGETS[0], true) !== null,
  }));
  expect([
    standalone,
    events
      .map((item) => item.label)
      .filter((label) => /(^|\+)(w|t|ArrowLeft|ArrowRight)$/.test(label))
      .length,
    outcomes.filter((item) => item.outcome !== null),
    inStandalone.filter((item) => !item.handled),
  ]).toEqual([false, 8, [], []]);
});
