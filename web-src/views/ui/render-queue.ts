// 描き直しの順番待ち。presenter と部品 (cv-*) は DOM を直接書き換えず、描き直しを
// ここに頼む。頼まれた分は次の描画の機会 (requestAnimationFrame) に 1 回で描く。
// 同じ回の中で増えた分 (presenter が描いた結果、子の部品が頼んだもの) も、その回の
// 中で描き切る。
//
// 決まりは .agents/skills/project-rules/references/ui-components.md。

type RenderJob = () => void;

/** 1 回の描画で、描き直しの頼みが落ち着くまで回す上限。超えたら、描くたびに
 * 描き直しを頼み返す部品がある (無限に描き続ける) ので、止めて表に出す。 */
const MAX_PASSES = 100;

const pending = new Set<RenderJob>();
let frame: { cancel(): void } | null = null;

/** 描いている途中で投げた例外を、全部まとめて持つ。1 つの部品が投げても
 * 残りの描き直しは続け、最後にこれを投げる。 */
export class RenderQueueError extends Error {
  readonly errors: unknown[];
  constructor(errors: unknown[]) {
    super(
      `rendering failed in ${errors.length} job(s): ${errors
        .map((error) =>
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
        )
        .join(" | ")}`,
    );
    this.name = "RenderQueueError";
    this.errors = errors;
  }
}

function requestFrame(run: () => void): { cancel(): void } {
  // 隠れているタブでは requestAnimationFrame が止まる。止まっている間に頼まれた
  // 描き直しが表に戻るまで溜まり続けないよう、隠れている間は次のタスクで描く。
  if (
    typeof requestAnimationFrame === "function" &&
    document.visibilityState !== "hidden"
  ) {
    const id = requestAnimationFrame(run);
    return { cancel: () => cancelAnimationFrame(id) };
  }
  const id = setTimeout(run, 0);
  return { cancel: () => clearTimeout(id) };
}

/** 次の描画の機会に job を 1 回走らせる。同じ job を何度頼んでも 1 回。 */
export function scheduleRender(job: RenderJob): void {
  pending.add(job);
  if (!frame) frame = requestFrame(flushRenders);
}

/** 頼まれている job を取り下げる (片付けた presenter・部品の分)。 */
export function cancelRender(job: RenderJob): void {
  pending.delete(job);
}

/** 頼まれている描き直しを、いまここで全部描く。描いた直後の DOM を読む所
 * (フォーカス・寸法を測る・テスト) で使う。 */
export function flushRenders(): void {
  frame?.cancel();
  frame = null;
  const errors: unknown[] = [];
  let passes = 0;
  while (pending.size > 0) {
    passes += 1;
    if (passes > MAX_PASSES) {
      pending.clear();
      errors.push(
        new Error(
          `render queue did not settle after ${MAX_PASSES} passes (a component keeps requesting renders)`,
        ),
      );
      break;
    }
    const jobs = [...pending];
    pending.clear();
    for (const job of jobs) {
      try {
        job();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new RenderQueueError(errors);
}
