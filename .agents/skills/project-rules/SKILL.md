---
name: project-rules
description: Use at the start of any implementation, investigation, or review in the code-viewer repository — before writing UI/CSS, a server route or CLI, a test, or adding a dependency. Entry point that routes to the area reference holding the actual rule; every rule here exists because this repository already had the accident it prevents. Triggers on "code-viewer", "プロジェクトルール", "style.css", "見切れ", "レイアウト", "エンドポイント追加", "ハンドラ", "テストが落ちた", "依存追加", "バンドル", "原因は", "dev サーバ", "project rules", "where does this live". 汎用の再利用スキャンは my-reuse-first、テストの網羅設計は my-writing-tests と併用する。
---

# code-viewer プロジェクトルール

このリポジトリで実装・調査・レビューを始める前の入口。**規範の本体はここには無い。**
下のルーティング表から、いま始める作業に対応する reference を 1 つ読む。

入口を 1 つにしてあるのは、このリポジトリが「規範は書かれていたのに、書かれた場所が
作業する場所から遠かったので守られなかった」という事故を実際に 2 回起こしているため。
規範を分散させないことが、この構成そのものの目的。

## 常に真である不変条件

- **公開リポジトリ。** 他プロジェクト・顧客・社内の固有名詞を、コード・テスト・
  フィクスチャ・コメント・コミットメッセージに書かない。ローカル DB や画面の実データは
  デバッグの証拠であって、フィクスチャの材料ではない
- **デスクトップ専用。** 明示依頼が無い限り、スマートフォン向けレイアウトに実装工数を割かない
- **pnpm。** bun でも npm でもない。バージョンは `package.json` の `packageManager` に固定
- **受け入れ条件は `pnpm run verify` と `npm pack --dry-run`。** PR を出す前・完了を報告する前に必ず通す
- **`web/style.css` と `web/index.html` は手書きソース。** ビルド成果物と同じ `web/` に
  居るが生成物ではない。消したり再生成しようとしたりしない（詳細は orientation）

## ルーティング

| これから何をするか | 読むもの |
|---|---|
| このリポジトリで何かを探す / ビルド・dev サーバの挙動を知る / どこに置くか迷う | `.agents/skills/project-rules/references/orientation.md` |
| サイズ・位置・固定物・スクロール領域を変える。見切れ・はみ出しを直す | `.agents/skills/project-rules/references/ui-layout.md` |
| コントロール・アイコン・文言・状態表示・装飾を足す / 変える | `.agents/skills/project-rules/references/ui-surface.md` |
| ルート・ハンドラ・CLI・外部プロセス連携を足す / 変える。`fetch` を書く | `.agents/skills/project-rules/references/server.md` |
| 依存を足す / 消す / 上げる。バンドル構成を変える | `.agents/skills/project-rules/references/dependencies.md` |
| 「〜が原因だ」と口に出す・書く直前 | `.agents/skills/project-rules/references/diagnose.md` |
| テストを書く / 落ちたテストを直す | `.agents/skills/project-rules/references/testing.md` |
| リリース・npm publish・Trusted Publisher | `.agents/skills/project-npm-publish-procedure/SKILL.md` |

複数に該当するなら複数読む。UI 変更はたいてい ui-layout か ui-surface のどちらか一方で足りる
（寸法を変えるなら layout、変えないなら surface）。

## 表に無い作業をするとき

どの reference にも当てはまらないなら、次の 3 つだけ守る。

1. **既にあるものを探してから書く。** 何が既に共有化されているかは
   `references/orientation.md` の「既にあるもの」表。一般的な再利用の規律は global の
   `my-reuse-first`
2. **`pnpm run verify` と `npm pack --dry-run` を通してから完了と言う**
3. **新しい規範を足したくなったら、`AGENTS.md` の "How To Add A Rule" に従う。**
   置き場所の判断表はそこにある（このファイルに複製しない）

その表の要点だけ再掲すると、**機械で検査できるものを散文で書くのは禁止**。
それがこのリポジトリで実際に事故を起こした経路。

## やってはいけないこと

| 違反 | 結果 |
|---|---|
| reference を読まずに UI / サーバ / テストを書き始める | この表が存在する意味が無くなる。過去に守られなかった規範は、無かったのではなく読む場所から遠かった |
| 規範を `AGENTS.md` にも reference にも二重に書く | どちらが正か分からなくなり、両方が腐る |
| 既存の違反を見つけて、それに合わせて新しいコードを書く | 違反が仕様に昇格する。扱いは ui-layout / server / testing の「既存の違反をどう扱うか」節に従う |
| 「今回は単純だから」で reference の手順を飛ばす | 制御文字の直書きも、CSS 文字列テストも、依存 1 つの追加も、すべて「単純な変更」として行われた |
