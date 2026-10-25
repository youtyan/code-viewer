// 外側のページ (host) の面の並び。#workspace の中に面 (iframe) と境界を平らに置き、
// 場所は面の木 (core/workspace.ts) から決める。やりとりの形は core/workspace-bridge.ts。
// - 面の文書が読み終わるたびに口 (MessageChannel) と、その面のタブの配置を渡す
// - フォーカスのある面の URL をアドレス欄に、最下段の面ごとの項目を最下段に写す
//   (host の app.ts が写した部品に書いても面の値に戻す。吹き出しの title は見ない)
// - 写した部品を押したら、フォーカスのある面の同じ部品を押す
// - 1 つのシェルは窓の 1 か所だけに出す (別の面で開いたら前の面のタブを閉じる)
// - 面の並び・URL・タブの配置は窓ごとに保存する (views/workspace/store.ts)
// - どの面も最小の大きさで並ばない窓では、フォーカスのある面だけを出す

import { attachDragResizer } from "../../core/drag-resizer";
import {
  closePane,
  type DropZone,
  dropZoneAt,
  freshPaneId,
  neighborPane,
  PANE_DIVIDER,
  type PaneId,
  type PaneNode,
  paneIds,
  paneRects,
  panesFit,
  routeUrl,
  type SplitDir,
  type SplitPath,
  setRatio,
  singlePane,
  splitPane,
  stepPane,
  type Workspace,
} from "../../core/workspace";
import {
  HOST_HELLO,
  type HostCommand,
  isMirroredId,
  MIRRORED_IDS,
  type MirroredId,
  type MirroredItem,
  type PaneMessage,
  type PaneProject,
  parsePaneMessage,
  type TabCarry,
  type WorkspaceAction,
} from "../../core/workspace-bridge";
import { PANE_FRAME_ATTRIBUTE } from "../../core/workspace-role";
import { mirroredElement } from "./bridge";
import type { WorkspaceStore } from "./store";

/** #first-workspace が面を先に作るための控え (sessionStorage)。 */
export const WORKSPACE_FRAMES_KEY = "code-viewer:workspace-frames";

export type WorkspaceHost = {
  /** フォーカスのある面に頼む。面にフォーカスを移す (続くキーは面が受ける)。 */
  command(command: HostCommand): void;
  /** そのシェルを出している面があれば、その面へ移って頼む (無ければフォーカスのある面)。 */
  commandWhereTerminal(session: string | null, command: HostCommand): void;
  /** 全部の面に知らせる。フォーカスは動かさない。 */
  notifyAll(command: HostCommand): void;
  /**
   * 全部の面に配り、後から口を渡した面にも最後の値を送る (エージェントの一覧)。
   * 前と同じ値なら送らない。
   */
  share(command: HostCommand): void;
  /** どれかの面で見ているシェル (前面のターミナルのタブ)。 */
  viewedShells(): string[];
  /** フォーカスのある面のプロジェクト。面が知らせるまでは null。 */
  project(): PaneProject | null;
  /** 面の並びの操作 (キー)。 */
  run(action: WorkspaceAction): void;
};

type PaneRuntime = {
  id: PaneId;
  frame: HTMLIFrameElement;
  port: MessagePort | null;
  /** 面の文書が読み終わる (口を渡す) までの頼み。 */
  queued: HostCommand[];
  mirror: Map<MirroredId, MirroredItem>;
  shells: string[];
  terminals: string[];
  project: PaneProject | null;
};

const MIRRORED_SELECTOR = MIRRORED_IDS.map((id) => `#${id}`).join(", ");

export function startWorkspaceHost(deps: {
  store: WorkspaceStore;
  /** 面の URL が分からない面 (前の版の右の面) で開く画面 (プロジェクトのフォルダ表示)。 */
  homeUrl(): string;
  /** フォーカスのある面のプロジェクトが分かった・変わった。 */
  onLocation(project: PaneProject | null): void;
  onViewing(): void;
  onLookChanged(): void;
  onNavCollapsed(collapsed: boolean): void;
  /** 窓が狭くて隠している面の数 (0 なら全部出ている)。 */
  onHidden(count: number): void;
  /** 面がエージェントの一覧の取り直しを頼んだ。 */
  onAgentsRefresh(): void;
}): WorkspaceHost {
  const root = document.getElementById("workspace");
  if (!root) throw new Error("#workspace is missing from index.html");
  const panes = new Map<PaneId, PaneRuntime>();
  /** フォーカスした順 (古い → 新しい)。別の面で開く先を選ぶ。 */
  const focusOrder: PaneId[] = [];
  /** 面に配った最後の値 (種類ごと) と、その JSON (同じ値を送り直さない)。 */
  const shared = new Map<HostCommand["type"], HostCommand>();
  const sharedText = new Map<HostCommand["type"], string>();
  let workspace: Workspace = singlePane("p1", currentUrl());
  let ready = false;
  /** 読み込みに失敗した・新しい版の保存: 書かない。 */
  let writable = false;

  for (const frame of root.querySelectorAll<HTMLIFrameElement>(
    `:scope > iframe[${PANE_FRAME_ATTRIBUTE}]`,
  ))
    adopt(frame);

  function currentUrl(): string {
    return location.pathname + location.search + location.hash;
  }

  function adopt(frame: HTMLIFrameElement): PaneRuntime {
    const id = frame.getAttribute(PANE_FRAME_ATTRIBUTE);
    if (!id) throw new Error("a pane frame without an id");
    const runtime: PaneRuntime = {
      id,
      frame,
      port: null,
      queued: [],
      mirror: new Map(),
      shells: [],
      terminals: [],
      project: null,
    };
    panes.set(id, runtime);
    frame.addEventListener("load", () => checkPane(runtime));
    return runtime;
  }

  function createFrame(id: PaneId, url: string): PaneRuntime {
    const frame = document.createElement("iframe");
    frame.setAttribute(PANE_FRAME_ATTRIBUTE, id);
    frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
    frame.title = "code viewer";
    frame.src = url;
    root?.append(frame);
    return adopt(frame);
  }

  /** 面の文書を読み終えていれば口を渡す (読み終わる前の iframe の文書は about:blank)。 */
  function checkPane(runtime: PaneRuntime): void {
    const loaded = runtime.frame.contentDocument;
    if (!loaded) {
      leaveForSignIn();
      return;
    }
    if (!ready || loaded.readyState !== "complete") return;
    if (loaded.URL === "about:blank") return;
    handshake(runtime);
  }

  function handshake(runtime: PaneRuntime): void {
    const target = runtime.frame.contentWindow;
    if (!target) throw new Error(`pane ${runtime.id} has no window`);
    const channel = new MessageChannel();
    runtime.port?.close();
    runtime.port = channel.port1;
    runtime.port.onmessage = (message) =>
      receive(runtime, parsePaneMessage(message.data));
    runtime.port.onmessageerror = (message) => {
      throw new Error(
        `a message from pane ${runtime.id} could not be read: ${String(message.data)}`,
      );
    };
    target.postMessage(
      {
        type: HOST_HELLO,
        pane: runtime.id,
        layout: workspace.panes[runtime.id]?.layout ?? null,
      },
      location.origin,
      [channel.port2],
    );
    for (const command of runtime.queued.splice(0))
      runtime.port.postMessage(command);
    for (const command of shared.values()) runtime.port.postMessage(command);
    send(runtime, focusState(runtime.id));
  }

  function send(runtime: PaneRuntime, command: HostCommand): void {
    if (runtime.port) runtime.port.postMessage(command);
    else runtime.queued.push(command);
  }

  function focusState(id: PaneId): HostCommand {
    return {
      type: "focus-state",
      focused: id === workspace.focused,
      many: panes.size > 1,
    };
  }

  function focusedRuntime(): PaneRuntime {
    const runtime = panes.get(workspace.focused);
    if (!runtime)
      throw new Error(`the focused pane ${workspace.focused} has no frame`);
    return runtime;
  }

  function receive(runtime: PaneRuntime, message: PaneMessage): void {
    const focused = runtime.id === workspace.focused;
    switch (message.type) {
      case "location": {
        runtime.project = message.project;
        const url = new URL(message.href);
        if (url.origin !== location.origin)
          throw new Error(
            `pane ${runtime.id} reported a URL on another origin: ${message.href}`,
          );
        updateEntry(runtime.id, { url: url.pathname + url.search + url.hash });
        if (focused) showFocusedLocation();
        return;
      }
      case "mirror":
        for (const item of message.items) {
          runtime.mirror.set(item.id, item);
          if (focused) applyMirror(item);
        }
        return;
      case "viewing":
        runtime.shells = message.shells;
        deps.onViewing();
        return;
      case "look-changed":
        deps.onLookChanged();
        return;
      case "nav-collapsed":
        deps.onNavCollapsed(message.collapsed);
        for (const other of panes.values())
          if (other !== runtime) send(other, message);
        return;
      case "tabs":
        updateEntry(runtime.id, { layout: message.layout });
        return;
      case "focus":
        setFocused(runtime.id);
        return;
      case "terminals": {
        // 1 つのシェルは窓の 1 か所だけ: この面で新しく開いたシェルを持っていた
        // ほかの面は、そのタブを閉じる。
        const before = new Set(runtime.terminals);
        runtime.terminals = message.open;
        for (const session of message.open) {
          if (before.has(session)) continue;
          for (const other of panes.values())
            if (other !== runtime && other.terminals.includes(session))
              send(other, { type: "close-terminal", session });
        }
        return;
      }
      case "split":
        split(runtime.id, message.dir, message.url, message.layout);
        return;
      case "open-elsewhere":
        openElsewhere(runtime.id, message);
        return;
      case "emptied":
        closePaneOf(runtime.id);
        return;
      case "workspace-action":
        run(message.action);
        return;
      case "drag-start": {
        const { type: _type, tabId, ...carry } = message;
        startDrag(runtime.id, tabId, carry);
        return;
      }
      case "drag-end":
        endDrag();
        return;
      case "agents-refresh":
        deps.onAgentsRefresh();
        return;
    }
  }

  function updateEntry(
    id: PaneId,
    patch: Partial<Workspace["panes"][PaneId]>,
  ): void {
    const entry = workspace.panes[id];
    if (!entry) return;
    workspace = {
      ...workspace,
      panes: { ...workspace.panes, [id]: { ...entry, ...patch } },
    };
    save();
  }

  function showFocusedLocation(): void {
    const runtime = panes.get(workspace.focused);
    const url = workspace.panes[workspace.focused]?.url;
    if (url && url !== currentUrl())
      history.replaceState(history.state, "", url);
    deps.onLocation(runtime?.project ?? null);
  }

  function setFocused(id: PaneId): void {
    const at = focusOrder.indexOf(id);
    if (at >= 0) focusOrder.splice(at, 1);
    focusOrder.push(id);
    if (id === workspace.focused) return;
    workspace = { ...workspace, focused: id };
    const runtime = panes.get(id);
    if (runtime) for (const item of runtime.mirror.values()) applyMirror(item);
    showFocusedLocation();
    for (const other of panes.values()) send(other, focusState(other.id));
    relayout();
    save();
  }

  function focusPane(id: PaneId): void {
    setFocused(id);
    panes.get(id)?.frame.focus();
  }

  function split(
    from: PaneId,
    dir: SplitDir,
    url: string,
    layout: unknown,
  ): void {
    const id = freshPaneId(workspace);
    workspace = splitPane(workspace, from, dir, id, { url, layout });
    createFrame(id, url);
    for (const other of panes.values()) send(other, focusState(other.id));
    relayout();
    focusPane(id);
    save();
  }

  function closePaneOf(id: PaneId): void {
    if (panes.size < 2) return;
    workspace = closePane(workspace, id);
    const runtime = panes.get(id);
    if (runtime) dropFrame(runtime);
    panes.delete(id);
    const at = focusOrder.indexOf(id);
    if (at >= 0) focusOrder.splice(at, 1);
    const focused = focusedRuntime();
    for (const item of focused.mirror.values()) applyMirror(item);
    showFocusedLocation();
    for (const other of panes.values()) send(other, focusState(other.id));
    relayout();
    focused.frame.focus();
    save();
  }

  function openElsewhere(
    from: PaneId,
    message: Extract<PaneMessage, { type: "open-elsewhere" }>,
  ): void {
    // 最後にフォーカスがあった別の面 (画面・ファイルなら同じプロジェクトの面)。
    // 無ければ分けずに頼んだ面で開く (分けるのは利用者が分割を選んだときだけ)。
    const target =
      [...focusOrder, ...paneIds(workspace.tree)]
        .reverse()
        .find(
          (id) =>
            id !== from &&
            panes.has(id) &&
            (message.project === null ||
              panes.get(id)?.project?.root === message.project),
        ) ?? from;
    const runtime = panes.get(target);
    if (!runtime) throw new Error(`the pane ${target} has no frame`);
    focusPane(runtime.id);
    if (message.terminal !== null)
      send(runtime, { type: "open-terminal", session: message.terminal });
    else if (message.route !== null)
      send(runtime, { type: "route", route: message.route });
  }

  function run(action: WorkspaceAction): void {
    const from = workspace.focused;
    switch (action) {
      case "pane-split-right":
      case "pane-split-down":
        send(focusedRuntime(), {
          type: "split-front",
          dir: action === "pane-split-right" ? "row" : "column",
        });
        return;
      case "pane-close":
        closePaneOf(from);
        return;
      case "main-pane-other":
      case "pane-focus-previous":
        if (panes.size > 1)
          focusPane(
            stepPane(
              workspace.tree,
              from,
              action === "main-pane-other" ? 1 : -1,
            ),
          );
        return;
      case "pane-focus-left":
      case "pane-focus-right":
      case "pane-focus-up":
      case "pane-focus-down": {
        const next = neighborPane(
          workspace.tree,
          from,
          action.slice("pane-focus-".length) as
            | "left"
            | "right"
            | "up"
            | "down",
        );
        if (next) focusPane(next);
        return;
      }
    }
  }

  // ---- 並べる ----

  const dividers = new Map<
    string,
    { el: HTMLElement; detach: () => void; path: SplitPath; span: number }
  >();

  function ratioAt(node: PaneNode, path: SplitPath): number {
    let current = node;
    for (const step of path) {
      if ("pane" in current) throw new Error(`no split at ${path.join("")}`);
      current = current[step];
    }
    if ("pane" in current) throw new Error(`no split at ${path.join("")}`);
    return current.ratio;
  }

  function relayout(): void {
    if (!root) return;
    const area = {
      x: 0,
      y: 0,
      width: root.clientWidth,
      height: root.clientHeight,
    };
    if (area.width === 0 || area.height === 0) return;
    const fits = panesFit(workspace.tree, area);
    const { panes: rects, dividers: lines } = paneRects(workspace.tree, area);
    for (const { id, rect } of rects) {
      const runtime = panes.get(id);
      if (!runtime) continue;
      // 並ばない窓では、フォーカスのある面だけを窓いっぱいに出す。ほかの面は
      // 大きさを保ったまま隠す (捨てると、端末とスクロールの位置を失う)。
      const whole = !fits && id === workspace.focused;
      const box = whole ? area : rect;
      const style = runtime.frame.style;
      style.left = `${box.x}px`;
      style.top = `${box.y}px`;
      style.width = `${box.width}px`;
      style.height = `${box.height}px`;
      style.visibility = fits || whole ? "" : "hidden";
    }
    const wanted = new Set<string>();
    if (fits)
      for (const line of lines) {
        const key = `${line.dir}:${line.path.join("")}`;
        wanted.add(key);
        let divider = dividers.get(key);
        if (!divider) divider = createDivider(key, line.path, line.dir);
        divider.span =
          (line.dir === "row" ? line.span.width : line.span.height) -
          PANE_DIVIDER;
        const style = divider.el.style;
        style.left = `${line.rect.x}px`;
        style.top = `${line.rect.y}px`;
        style.width = `${line.rect.width}px`;
        style.height = `${line.rect.height}px`;
      }
    for (const [key, divider] of dividers)
      if (!wanted.has(key)) {
        divider.detach();
        divider.el.remove();
        dividers.delete(key);
      }
    deps.onHidden(fits ? 0 : panes.size - 1);
  }

  function createDivider(key: string, path: SplitPath, dir: SplitDir) {
    const el = document.createElement("div");
    el.className = "workspace-divider";
    el.dataset.dir = dir;
    el.setAttribute("role", "separator");
    el.setAttribute(
      "aria-orientation",
      dir === "row" ? "vertical" : "horizontal",
    );
    el.tabIndex = 0;
    root?.append(el);
    const divider = {
      el,
      path,
      span: 0,
      detach: attachDragResizer({
        handle: el,
        axis: dir === "row" ? "x" : "y",
        getSize: () => Math.round(divider.span * ratioAt(workspace.tree, path)),
        applySize: (size) => {
          if (divider.span <= 0) return;
          workspace = setRatio(workspace, path, size / divider.span);
          relayout();
        },
        direction: 1,
        // 引いている間は面 (iframe) にポインタを取られない。
        activeClassTarget: root ?? undefined,
        activeClassName: "workspace-resizing",
        onEnd: save,
      }),
    };
    el.addEventListener("dblclick", () => {
      workspace = setRatio(workspace, path, 0.5);
      relayout();
      save();
    });
    dividers.set(key, divider);
    return divider;
  }

  new ResizeObserver(relayout).observe(root);

  // ---- 掴んだタブをほかの面へ落とす ----
  // 掴んだ面の外のほかの面の上にだけ、落とす先の箱を重ねる (掴んだ面の中のタブ列の
  // 並べ替えは、その面が受ける)。端に落とすとその向きに分け、真ん中に落とすとその
  // 面へ移す。持ち物のあるタブ (画面・ファイル・シェル) を真ん中に落とせるのは、同じ
  // プロジェクトの面だけ (面のタブ列はその面のプロジェクトのタブだけを出す)。
  let dragging: { from: PaneId; tabId: string; carry: TabCarry } | null = null;
  const dropTargets: HTMLElement[] = [];

  function startDrag(from: PaneId, tabId: string, carry: TabCarry): void {
    endDrag();
    dragging = { from, tabId, carry };
    for (const runtime of panes.values()) {
      if (runtime.id === from || runtime.frame.style.visibility === "hidden")
        continue;
      const target = document.createElement("div");
      target.className = "workspace-drop-target";
      const mark = document.createElement("div");
      mark.className = "workspace-drop-mark";
      mark.hidden = true;
      target.append(mark);
      for (const side of ["left", "top", "width", "height"] as const)
        target.style[side] = runtime.frame.style[side];
      const zoneOf = (event: DragEvent): DropZone | null => {
        const box = target.getBoundingClientRect();
        const zone = dropZoneAt(
          { x: box.left, y: box.top, width: box.width, height: box.height },
          event.clientX,
          event.clientY,
        );
        return dropAllowed(runtime, zone) ? zone : null;
      };
      target.addEventListener("dragover", (event) => {
        const zone = zoneOf(event);
        mark.hidden = zone === null;
        if (zone === null) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        mark.dataset.zone = zone;
      });
      target.addEventListener("dragleave", () => {
        mark.hidden = true;
      });
      target.addEventListener("drop", (event) => {
        const zone = zoneOf(event);
        if (zone === null) return;
        event.preventDefault();
        dropOn(runtime.id, zone);
      });
      root?.append(target);
      dropTargets.push(target);
    }
  }

  function dropAllowed(target: PaneRuntime, zone: DropZone): boolean {
    if (!dragging) return false;
    const { carry } = dragging;
    if (zone !== "center") return true;
    if (carry.route === null && carry.terminal === null) return false;
    return carry.project === null || target.project?.root === carry.project;
  }

  function dropOn(target: PaneId, zone: DropZone): void {
    if (!dragging) return;
    const { from, tabId, carry } = dragging;
    endDrag();
    if (zone === "center") {
      const runtime = panes.get(target);
      if (!runtime) return;
      focusPane(target);
      if (carry.terminal !== null)
        send(runtime, { type: "open-terminal", session: carry.terminal });
      else if (carry.route !== null)
        send(runtime, { type: "route", route: carry.route });
    } else {
      const id = freshPaneId(workspace);
      workspace = splitPane(
        workspace,
        target,
        zone === "left" || zone === "right" ? "row" : "column",
        id,
        { url: carry.url, layout: carry.layout },
        zone === "left" || zone === "up",
      );
      createFrame(id, carry.url);
      for (const other of panes.values()) send(other, focusState(other.id));
      relayout();
      focusPane(id);
      save();
    }
    // シェルは、開いた面が知らせたときに前の面から閉じる (terminals)。
    const source = panes.get(from);
    if (source && carry.terminal === null)
      send(source, { type: "close-tab", id: tabId });
  }

  function endDrag(): void {
    dragging = null;
    for (const target of dropTargets.splice(0)) target.remove();
  }

  /** 面の木に合わせて iframe を作る・消す・移す。 */
  /**
   * 面の木に合わせて iframe を作る・消す。読み込みの最初に作った面 (#first-workspace)
   * は、開いている画面を正とする: 別の画面へ移し直すと、読み込み途中の面の通信が
   * 切れて失敗を出した。その画面を別の面として保存してあれば、その面として扱う。
   */
  function syncFrames(): void {
    for (const runtime of [...panes.values()]) {
      const shown = shownUrl(runtime.frame);
      const entry = workspace.panes[runtime.id];
      if (!entry || entry.url === shown) continue;
      const owner = Object.keys(workspace.panes).find(
        (id) => !panes.has(id) && workspace.panes[id]?.url === shown,
      );
      if (owner) {
        panes.delete(runtime.id);
        runtime.id = owner;
        runtime.frame.setAttribute(PANE_FRAME_ATTRIBUTE, owner);
        panes.set(owner, runtime);
      } else updateEntry(runtime.id, { url: shown });
    }
    for (const id of paneIds(workspace.tree))
      if (!panes.has(id))
        createFrame(id, workspace.panes[id]?.url ?? deps.homeUrl());
    for (const [id, runtime] of panes)
      if (!(id in workspace.panes)) {
        dropFrame(runtime);
        panes.delete(id);
      }
  }

  /** 面が開いている (読み込み中なら開こうとしている) 画面。 */
  function shownUrl(frame: HTMLIFrameElement): string {
    const loaded = frame.contentDocument?.URL;
    const at = new URL(
      loaded && loaded !== "about:blank" ? loaded : frame.src,
      location.href,
    );
    return at.pathname + at.search + at.hash;
  }

  function dropFrame(runtime: PaneRuntime): void {
    runtime.port?.close();
    runtime.port = null;
    runtime.frame.remove();
  }

  function save(): void {
    if (!ready || !writable) return;
    deps.store.save(workspace);
    window.sessionStorage.setItem(
      WORKSPACE_FRAMES_KEY,
      JSON.stringify({
        tree: workspace.tree,
        focused: workspace.focused,
        urls: Object.fromEntries(
          Object.entries(workspace.panes).map(([id, entry]) => [id, entry.url]),
        ),
      }),
    );
  }

  // ---- 最下段の写し ----

  // host の app.ts が写した部品に書いたら、フォーカスのある面の値に戻す (戻した
  // 書き込みは値が同じなので、もう一度は動かない)。title の付け外しは見ない: 吹き出し
  // (views/title-tooltip.ts) は出している間だけ title を外し、書き戻されたらまた外す。
  for (const id of MIRRORED_IDS) {
    const guard = new MutationObserver((records) => {
      const item = panes.get(workspace.focused)?.mirror.get(id);
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

  // 写した部品を押したら、フォーカスのある面の同じ部品を押す。host の同じ id の
  // 部品の処理は動かさない (捕捉で止める)。新しいタブで開くリンクの押し方はリンクのまま。
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

  function command(next: HostCommand): void {
    // 面の文書にフォーカスを渡す (AI 向けのコピーはフォーカスのある文書でしか
    // クリップボードに書けない。続くキーも面が受ける)。
    const runtime = focusedRuntime();
    runtime.frame.focus();
    send(runtime, next);
  }

  window.addEventListener("pagehide", () => deps.store.flush(true));

  // ---- 読み込み ----

  deps.store
    .load(currentUrl(), deps.homeUrl())
    .then((loaded) => {
      writable = loaded.newer === null;
      if (!writable)
        console.error(
          new Error(
            `the saved tabs were written by a newer version (file version ${loaded.newer}); this window does not save its panes`,
          ),
        );
      workspace = routeUrl(loaded.workspace, currentUrl());
    })
    .catch((error: unknown) => {
      // 保存を読めない窓は面 1 つで開き、書かない (読めない保存を上書きしない)。
      console.error(error);
      workspace = singlePane(panes.keys().next().value ?? "p1", currentUrl());
    })
    .finally(() => {
      ready = true;
      syncFrames();
      focusOrder.push(workspace.focused);
      relayout();
      for (const runtime of panes.values()) checkPane(runtime);
      showFocusedLocation();
      save();
    });

  return {
    command,
    commandWhereTerminal(session, next) {
      const holder = session
        ? [...panes.values()].find((runtime) =>
            runtime.terminals.includes(session),
          )
        : undefined;
      if (holder) setFocused(holder.id);
      command(next);
    },
    notifyAll(next) {
      for (const runtime of panes.values()) send(runtime, next);
    },
    share(next) {
      const text = JSON.stringify(next);
      if (sharedText.get(next.type) === text) return;
      sharedText.set(next.type, text);
      shared.set(next.type, next);
      // 口を渡す前の面には送らない (口を渡したときに最後の値を送る)。
      for (const runtime of panes.values()) runtime.port?.postMessage(next);
    },
    viewedShells: () => [
      ...new Set([...panes.values()].flatMap((runtime) => runtime.shells)),
    ],
    project: () => panes.get(workspace.focused)?.project ?? null,
    run,
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
