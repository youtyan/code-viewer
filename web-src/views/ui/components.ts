// 共通の部品 (cv-*) を全部定義する。createRenderer が最初に描く前に呼ぶので、
// 使う側が個別に呼ぶ必要は無い。部品を足したら、ここに 1 行と、web/style.css の
// 「部品の外側の要素」の並びに名前を足す (ui-components.test.ts が見る)。
//
// 1 つの画面の中だけで使う部品 (その画面のディレクトリに置くもの) は、その画面の
// presenter が描く前に自分で定義する。

import { defineCvButton } from "./button";
import { defineCvDiagramViewport } from "./diagram-viewport";
import { defineCvEmptyState } from "./empty-state";
import { defineCvIcon } from "./icon";
import { defineCvMenu } from "./menu";
import { defineCvResizer } from "./resizer";
import { defineCvSegmented } from "./segmented";

export function defineUiComponents(): void {
  defineCvButton();
  defineCvDiagramViewport();
  defineCvEmptyState();
  defineCvIcon();
  defineCvMenu();
  defineCvResizer();
  defineCvSegmented();
}
