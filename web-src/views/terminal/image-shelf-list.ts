// 画像の棚に並べる一覧の持ち方。DOM を持たない純ロジックで、描くのは
// image-shelf.ts。
//
// 決まり:
//
// - 並びは新しい順。見つけた順番 (seq) の大きいものが先頭
// - 同じ画像 (実体のパス) は 1 つにまとめる。綴りが違っても同じ 1 枚
// - 同じパスでも更新時刻か大きさが変われば、新しい画像として先頭へ上げる
//   (エージェントは同じ名前で上書きすることがある)
// - 読めなかったもの (大きすぎる・読めない・通常のファイルでない) も理由つきで
//   並べる。黙って消さない
// - 「無い」(missing) は、棚に既にある画像が消えたときだけ出す。拾う候補は
//   拾い過ぎる前提 (文の中のファイル名や、割れた行を組み直した断片) なので、
//   知らない候補の「無い」まで並べると棚が誤検出で埋まる
// - 上限 (MAX_SHELF_IMAGES) を超えたら古いものから落とす

import {
  MAX_SHELF_IMAGES,
  type TerminalImageRef,
  type TerminalImageRejection,
  type TerminalImageRejectReason,
} from "../../core/terminal-images";

export type ShelfEntry = {
  /** 同じ 1 枚かを決める鍵。実体のパス (読めなかったものは解いた先のパス)。 */
  key: string;
  name: string;
  path: string;
  /** 画面に出ていた綴り。リンクの位置を探すのと、読めなくなったときの突き合わせに使う。 */
  candidates: string[];
  /** 見つけた順番。大きいほど新しい。 */
  seq: number;
  /** 配れる画像。読めなかったものは null。 */
  image: TerminalImageRef | null;
  reason: TerminalImageRejectReason | null;
  /** 大きすぎるとき、その大きさ。 */
  bytes: number | null;
  detail: string | null;
};

export type ShelfUpdate = {
  images: TerminalImageRef[];
  rejected: TerminalImageRejection[];
};

export type ShelfSeq = {
  /** 初めて並べる i 番目 (order の順) に付ける順番。 */
  added(index: number): number;
  /** 上書きされた (更新時刻が変わった) ものに付ける順番。先頭に上がる値。 */
  changed(): number;
};

type ShelfItem =
  | { kind: "image"; candidate: string; image: TerminalImageRef }
  | { kind: "rejected"; candidate: string; rejection: TerminalImageRejection };

function sameVersion(a: TerminalImageRef, b: TerminalImageRef): boolean {
  return a.mtimeMs === b.mtimeMs && a.bytes === b.bytes;
}

function withCandidate(list: string[], candidate: string): string[] {
  return list.includes(candidate) ? list : [...list, candidate];
}

/**
 * 問い合わせの結果を一覧へ入れる。元の配列は変えず、新しい配列を返す。
 *
 * @param order 候補を番号付けする順 (問い合わせた順)。読めたものと読めな
 *   かったものは別の配列で返ってくるので、この順で 1 列に並べ直してから
 *   番号を振る (並べ直さないと、読めなかったものが常に後で番号を振られる)。
 *   渡さなければ images、rejected の順
 */
export function mergeShelf(
  list: readonly ShelfEntry[],
  update: ShelfUpdate,
  seq: ShelfSeq,
  order: readonly string[] = [],
): ShelfEntry[] {
  const entries = new Map<string, ShelfEntry>();
  for (const entry of list) entries.set(entry.key, entry);
  const findByCandidate = (candidate: string, path: string) =>
    entries.get(path) ??
    [...entries.values()].find((entry) => entry.candidates.includes(candidate));

  const rank = (candidate: string) => {
    const at = order.indexOf(candidate);
    return at < 0 ? order.length : at;
  };
  const items: ShelfItem[] = [
    ...update.images.map(
      (image): ShelfItem => ({
        kind: "image",
        candidate: image.candidate,
        image,
      }),
    ),
    ...update.rejected.map(
      (rejection): ShelfItem => ({
        kind: "rejected",
        candidate: rejection.candidate,
        rejection,
      }),
    ),
  ];
  // sort は安定なので、順の分からない候補は元の並びのまま後ろに付く。
  items.sort((a, b) => rank(a.candidate) - rank(b.candidate));

  let index = 0;
  for (const item of items) {
    if (item.kind === "image") {
      const { image } = item;
      const existing = entries.get(image.path);
      if (!existing) {
        entries.set(image.path, {
          key: image.path,
          name: image.name,
          path: image.path,
          candidates: [image.candidate],
          seq: seq.added(index),
          image,
          reason: null,
          bytes: null,
          detail: null,
        });
        index += 1;
        continue;
      }
      const candidates = withCandidate(existing.candidates, image.candidate);
      if (existing.image && sameVersion(existing.image, image)) {
        entries.set(image.path, { ...existing, candidates });
        continue;
      }
      // 上書きされた / 読めなかったものが読めるようになった。新しい画像として
      // 先頭へ。
      entries.set(image.path, {
        ...existing,
        candidates,
        seq: seq.changed(),
        image,
        reason: null,
        bytes: null,
        detail: null,
      });
      continue;
    }

    const { rejection } = item;
    const existing = findByCandidate(rejection.candidate, rejection.path);
    if (existing) {
      entries.set(existing.key, {
        ...existing,
        candidates: withCandidate(existing.candidates, rejection.candidate),
        image: null,
        reason: rejection.reason,
        bytes: rejection.bytes ?? null,
        detail: rejection.detail ?? null,
      });
      continue;
    }
    // 知らない候補の「無い」は拾い過ぎの結果なので並べない。invalid と
    // unsupported は拾う側の正規表現で既に外れているので、来ても並べない。
    if (
      rejection.reason === "missing" ||
      rejection.reason === "invalid" ||
      rejection.reason === "unsupported" ||
      !rejection.path
    ) {
      continue;
    }
    entries.set(rejection.path, {
      key: rejection.path,
      name: rejection.name,
      path: rejection.path,
      candidates: [rejection.candidate],
      seq: seq.added(index),
      image: null,
      reason: rejection.reason,
      bytes: rejection.bytes ?? null,
      detail: rejection.detail ?? null,
    });
    index += 1;
  }

  return [...entries.values()]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, MAX_SHELF_IMAGES);
}

/** 拡大表示で前へ／次へ回す並び。読めたものだけ、棚と同じ順。 */
export function shelfGallery(list: readonly ShelfEntry[]): TerminalImageRef[] {
  const images: TerminalImageRef[] = [];
  for (const entry of list) if (entry.image) images.push(entry.image);
  return images;
}

/** 画面に出ている綴りから棚の項目を引く。 */
export function shelfEntryByCandidate(
  list: readonly ShelfEntry[],
  candidate: string,
): ShelfEntry | null {
  return list.find((entry) => entry.candidates.includes(candidate)) ?? null;
}
