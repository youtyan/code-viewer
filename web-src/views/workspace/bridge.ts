// 面 (pane) の側のやりとり (形は core/workspace-bridge.ts、host の側は host.ts)。
// - host の hello で、この面の id と保存してあったタブの配置を受け取る
// - URL・最下段の面ごとの項目・見ているシェル・タブ・フォーカスを host に知らせる
// - host の頼みを受ける (写した部品の押下はここで面の同じ部品を押す)

import type { PaneId } from "../../core/workspace";
import {
  type ClickModifiers,
  type HostCommand,
  isHostHello,
  MIRRORED_IDS,
  type MirroredId,
  type MirroredItem,
  type PaneMessage,
  type PaneProject,
  parseHostCommand,
} from "../../core/workspace-bridge";

export type PaneBridge = {
  /** URL かプロジェクトが変わったかもしれない (同じなら送らない)。 */
  syncLocation(): void;
  send(message: PaneMessage): void;
  /** host の hello (この面の id と、保存してあったタブの配置)。 */
  hello: Promise<{ pane: PaneId; layout: unknown | null }>;
};

export function startPaneBridge(deps: {
  project(): PaneProject | null;
  /** 写した部品を押す頼み (click) は、ここで面の同じ部品を押す。それ以外。 */
  onCommand(command: Exclude<HostCommand, { type: "click" }>): void;
}): PaneBridge {
  let port: MessagePort | null = null;
  // host の hello (この文書を読み終えた後) までの知らせ。
  const queued: PaneMessage[] = [];
  let greeted: (hello: { pane: PaneId; layout: unknown | null }) => void = () =>
    undefined;
  const hello = new Promise<{ pane: PaneId; layout: unknown | null }>(
    (resolve) => {
      greeted = resolve;
    },
  );
  const send = (message: PaneMessage) => {
    if (port) port.postMessage(message);
    else queued.push(message);
  };
  window.addEventListener("message", (event) => {
    if (!isHostHello(event.data)) return;
    // 親の窓 (同じ origin の host) からのものだけを受ける。断ったものは理由を残す。
    if (event.source !== window.parent || event.origin !== location.origin) {
      console.error(
        new Error(
          `refused a host hello from ${event.origin} that is not this pane's page`,
        ),
      );
      return;
    }
    const [next] = event.ports;
    if (!next) throw new Error("host hello without a message port");
    if (port) throw new Error("a second host hello for the same pane document");
    port = next;
    port.onmessage = (message) => {
      const command = parseHostCommand(message.data);
      if (command.type === "click")
        clickMirrored(command.id, command.modifiers);
      else deps.onCommand(command);
    };
    port.onmessageerror = (message) => {
      throw new Error(
        `a host command could not be read: ${String(message.data)}`,
      );
    };
    for (const message of queued.splice(0)) port.postMessage(message);
    greeted({ pane: event.data.pane, layout: event.data.layout });
  });
  // 押した・フォーカスが入った面が、窓のフォーカスのある面 (サイドバーと最下段の先)。
  for (const type of ["pointerdown", "focusin"] as const)
    document.addEventListener(type, () => send({ type: "focus" }), {
      capture: true,
    });

  let sentLocation = "";
  function syncLocation(): void {
    const project = deps.project();
    const key = JSON.stringify([location.href, project]);
    if (key === sentLocation) return;
    sentLocation = key;
    send({ type: "location", href: location.href, project });
  }
  // 面の URL は app.ts のあちこちの pushState / replaceState で変わり、知らせる
  // イベントが無い。ここで包んで、変わるたびにアドレス欄 (host) へ写す。
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      syncLocation();
    };
  }
  window.addEventListener("popstate", syncLocation);
  window.addEventListener("hashchange", syncLocation);

  const sentItems = new Map<MirroredId, string>();
  let mirrorQueued = false;
  function queueMirror(): void {
    if (mirrorQueued) return;
    mirrorQueued = true;
    queueMicrotask(() => {
      mirrorQueued = false;
      const items: MirroredItem[] = [];
      for (const id of MIRRORED_IDS) {
        const el = mirroredElement(id);
        const item: MirroredItem = {
          id,
          attributes: Array.from(el.attributes, (attribute) => [
            attribute.name,
            attribute.value,
          ]),
          html: el.innerHTML,
        };
        const serialized = JSON.stringify(item);
        if (sentItems.get(id) === serialized) continue;
        sentItems.set(id, serialized);
        items.push(item);
      }
      if (items.length > 0) send({ type: "mirror", items });
    });
  }
  const observer = new MutationObserver(queueMirror);
  for (const id of MIRRORED_IDS)
    observer.observe(mirroredElement(id), {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
  queueMirror();
  syncLocation();

  return { syncLocation, send, hello };
}

function clickMirrored(id: MirroredId, modifiers: ClickModifiers): void {
  mirroredElement(id).dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers }),
  );
}

export function mirroredElement(id: MirroredId): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el;
}
