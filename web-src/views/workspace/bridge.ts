// 外側のページ (host) と面 (pane) のやりとり (形は core/workspace-bridge.ts)。host は
// 左のサイドバーと最下段を描き、本文は #workspace の中の面 (iframe) が描く。
// - 面は URL・最下段の面ごとの項目・見ているシェルを host に知らせ、host の頼みを受ける
// - host は面の URL をアドレス欄に写す (replaceState。履歴は面の中に積まれる)
// - 最下段の面ごとの項目は、host では面の部品の写しにする。host の app.ts が同じ
//   部品に書いても面の値に戻す (host の通信や状態で面の表示を上書きしない)
// - 写した部品 (サイドバーの面の画面へのリンクも) を host で押したら、面の同じ部品を押す

import {
  type ClickModifiers,
  HOST_HELLO,
  type HostCommand,
  isHostHello,
  isMirroredId,
  MIRRORED_IDS,
  type MirroredId,
  type MirroredItem,
  type PaneMessage,
  type PaneProject,
  parseHostCommand,
  parsePaneMessage,
} from "../../core/workspace-bridge";
import { PANE_FRAME_ATTRIBUTE } from "../../core/workspace-role";

export type PaneBridge = {
  /** URL かプロジェクトが変わったかもしれない (同じなら送らない)。 */
  syncLocation(): void;
  send(message: PaneMessage): void;
};

export function startPaneBridge(deps: {
  project(): PaneProject | null;
  /** 写した部品を押す頼み (click) は、ここで面の同じ部品を押す。それ以外。 */
  onCommand(command: Exclude<HostCommand, { type: "click" }>): void;
}): PaneBridge {
  let port: MessagePort | null = null;
  // host の hello (この文書を読み終えた後) までの知らせ。
  const queued: PaneMessage[] = [];
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

  return { syncLocation, send };
}

function clickMirrored(id: MirroredId, modifiers: ClickModifiers): void {
  mirroredElement(id).dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers }),
  );
}

export type WorkspaceHost = {
  /** 面に頼む。面にフォーカスを移す (続くキーは面が受ける)。 */
  command(command: HostCommand): void;
  /** 面に知らせる。フォーカスは動かさない。 */
  notify(command: HostCommand): void;
  /** 面で見ているシェル (前面のターミナルのタブ)。 */
  viewedShells(): string[];
  /** 面のプロジェクト。面が知らせるまでは null。 */
  project(): PaneProject | null;
};

const MIRRORED_SELECTOR = MIRRORED_IDS.map((id) => `#${id}`).join(", ");

export function startWorkspaceHost(deps: {
  onLocation(project: PaneProject | null): void;
  onViewing(): void;
  onLookChanged(): void;
  onNavCollapsed(collapsed: boolean): void;
}): WorkspaceHost {
  const frame = document.querySelector<HTMLIFrameElement>(
    `#workspace > iframe[${PANE_FRAME_ATTRIBUTE}]`,
  );
  if (!frame)
    throw new Error(
      "#workspace has no pane frame (index.html #first-workspace)",
    );
  let port: MessagePort | null = null;
  // 面の文書が読み終わる (口を渡す) までの頼み。
  const queued: HostCommand[] = [];
  let project: PaneProject | null = null;
  let viewedShells: string[] = [];
  const mirror = new Map<MirroredId, MirroredItem>();

  // 面の文書が読み終わるたびに口を渡す (面が読み直したら前の口は捨てる。前の文書は
  // もう居ない)。読み終わる前の iframe の文書は about:blank。
  function handshake(): void {
    const target = frame.contentWindow;
    if (!target) throw new Error("the pane frame has no window");
    const channel = new MessageChannel();
    port?.close();
    port = channel.port1;
    port.onmessage = (message) => receive(parsePaneMessage(message.data));
    port.onmessageerror = (message) => {
      throw new Error(
        `a pane message could not be read: ${String(message.data)}`,
      );
    };
    target.postMessage({ type: HOST_HELLO }, location.origin, [channel.port2]);
    for (const command of queued.splice(0)) port.postMessage(command);
  }
  function checkPane(): void {
    const loaded = frame.contentDocument;
    if (!loaded) {
      leaveForSignIn();
      return;
    }
    if (loaded.readyState === "complete" && loaded.URL !== "about:blank")
      handshake();
  }
  frame.addEventListener("load", checkPane);
  checkPane();

  function receive(message: PaneMessage): void {
    switch (message.type) {
      case "location":
        if (message.href !== location.href)
          history.replaceState(history.state, "", message.href);
        project = message.project;
        deps.onLocation(project);
        return;
      case "mirror":
        for (const item of message.items) {
          mirror.set(item.id, item);
          applyMirror(item);
        }
        return;
      case "viewing":
        viewedShells = message.shells;
        deps.onViewing();
        return;
      case "look-changed":
        deps.onLookChanged();
        return;
      case "nav-collapsed":
        deps.onNavCollapsed(message.collapsed);
        return;
    }
  }

  // host の app.ts が写した部品に書いたら、面の値に戻す (戻した書き込みは値が同じ
  // なので、もう一度は動かない)。
  // title の付け外しは見ない: 吹き出し (views/title-tooltip.ts) は出している間だけ
  // title を外し、書き戻されたらまた外す。戻すと両方が書き続けて窓が止まった。
  for (const id of MIRRORED_IDS) {
    const guard = new MutationObserver((records) => {
      const item = mirror.get(id);
      if (
        item &&
        records.some(
          (record) =>
            record.type !== "attributes" || record.attributeName !== "title",
        )
      )
        applyMirror(item);
    });
    guard.observe(mirroredElement(id), {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // 写した部品を押したら、面の同じ部品を押す。host の同じ id の部品の処理は
  // 動かさない (捕捉で止める)。新しいタブで開くリンクの押し方はリンクのまま。
  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(MIRRORED_SELECTOR)
          : null;
      const id = target?.id;
      if (!target || id === undefined || !isMirroredId(id)) return;
      if (
        target instanceof HTMLAnchorElement &&
        (target.target === "_blank" ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      command({
        type: "click",
        id,
        modifiers: {
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        },
      });
    },
    true,
  );

  function notify(next: HostCommand): void {
    if (port) port.postMessage(next);
    else queued.push(next);
  }

  function command(next: HostCommand): void {
    // 面の文書にフォーカスを渡す (AI 向けのコピーはフォーカスのある文書でしか
    // クリップボードに書けない。続くキーも面が受ける)。
    frame.focus();
    notify(next);
  }

  return {
    command,
    notify,
    viewedShells: () => viewedShells,
    project: () => project,
  };
}

const SIGN_IN_RELOAD_KEY = "code-viewer:pane-sign-in-reload";

/**
 * 面がこの origin を離れた (外部接続のサインインが切れ、Cloudflare Access のログインへ
 * 移された。ログインは枠の中に出せない)。窓ごと読み直して、サインインを一番上の
 * ページで出す。読み直した直後にまた離れたら、繰り返さずに理由を残す。
 */
function leaveForSignIn(): void {
  const last = sessionStorage.getItem(SIGN_IN_RELOAD_KEY);
  if (last !== null && Date.now() - Number(last) < 30_000) {
    console.error(
      new Error(
        "the pane left this origin again right after reloading for sign-in; not reloading again",
      ),
    );
    return;
  }
  sessionStorage.setItem(SIGN_IN_RELOAD_KEY, String(Date.now()));
  location.reload();
}

function applyMirror(item: MirroredItem): void {
  const el = mirroredElement(item.id);
  const wanted = new Map(item.attributes);
  for (const name of el.getAttributeNames())
    if (!wanted.has(name)) el.removeAttribute(name);
  for (const [name, value] of wanted)
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  if (el.innerHTML !== item.html) el.innerHTML = item.html;
}

function mirroredElement(id: MirroredId): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el;
}
