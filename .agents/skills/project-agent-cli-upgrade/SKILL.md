---
name: project-agent-cli-upgrade
description: Use when the installed Claude Code (claude) or Codex (codex) CLI version differs from the version this project recorded as checked, or before recording a new checked version. Compares installed vs recorded versions, walks the checklist of every place code-viewer relies on CLI behavior (hooks, statusLine, screen rules, sign-in, usage, launch, skill install, MCP), fixes or reports what broke, then updates CHECKED_AGENT_CLI_VERSIONS. Triggers on "Claude Codeのバージョンが上がった", "Codexのバージョンが変わった", "CLIの版の点検", "準拠バージョンの更新", "agent CLI upgrade check", "claude version changed", "codex version changed".
---

# Claude Code / Codex の版が変わったときの点検

code-viewer は claude と codex の外から見える振る舞い（フックの出来事と欄・statusLine の JSON・
画面の文言・ログインと使用量のコマンドの出力・設定ファイルの場所）に頼っている。
どれも版が上がると**黙って外れる**（状態が「待機」のまま・使用量が「取得できません」・
フックが呼ばれない）。このスキルは、版が変わったときに頼っている所を 1 つずつ確かめ、
通した版を記録に残す手順。

このスキルは project-local。画面の判定ルールそのものの直し方は
`.agents/skills/terminal-ai-state-rules/SKILL.md`、この領域の決まりと事故は
`.agents/skills/project-rules/references/agents.md`。ここには複製しない。

## 記録の置き場所（1 か所だけ）

| もの | 場所 |
|---|---|
| 確かめた版と日付 | `web-src/core/agent-cli-versions.ts` の `CHECKED_AGENT_CLI_VERSIONS` |
| 手元の版との比較 | `code-viewer doctor` の **Agent CLIs** の群（`web-src/server/doctor.ts` の `checkAgentClis`）。画面では最下段の doctor |
| 頼っている所の一覧と確かめ方 | `.agents/skills/project-agent-cli-upgrade/references/checklist.md` |

版を README・ヘルプ・この SKILL.md に書き写さない。写すと片方だけ古くなる。

## 手順

### 1. 何が変わったかを決める

```sh
claude --version   # 例: 2.1.286 (Claude Code)
codex --version    # 例: codex-cli 0.159.3
grep -n "version" web-src/core/agent-cli-versions.ts
```

起動コマンドをラッパーにしている利用者もいるので、code-viewer が実際に起こす版は
`code-viewer doctor` の Agent CLIs の行で見る（設定の起動コマンドを対話シェルで動かす）。
`code-viewer` が PATH に無ければ、リポジトリで `pnpm run build` の後に `node dist/code-viewer.js doctor`。
ビルドできないときは、doctor と同じ形で手で訊く（起動コマンドは `<状態>/accounts.json` の
`.launchCommands`、無ければ `claude` / `codex`）:
`"$SHELL" -i -c '<起動コマンド> "$@"' "$SHELL" --version`

| 状況 | 点検する範囲 | 手順 2 で読む資料 |
|---|---|---|
| 手元の版が記録と違う | 違う種類（claude / codex）の全行 | 記録の版から手元の版までの変更履歴 |
| 記録と同じ版で、記録がまだ点検を通っていない（初めて置いた・利用者に確かめ直しを頼まれた） | その種類の全行 | 変更履歴の範囲ではなく、各行の公式ドキュメントの**今の**記述（過去の版で入った変化も拾うため） |
| 記録と同じ版で、点検を通している | なし（このスキルは要らない） | — |

### 2. 変わった点を一次資料から集める

推測で「変わっていないはず」と決めない。読むのは次の 3 つだけ（第三者の記事・別の AI の
回答だけで判断しない）。

| 資料 | claude | codex |
|---|---|---|
| 変更履歴 | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md | https://github.com/openai/codex/releases |
| 公式ドキュメント | 点検表の各行に書いた URL | 点検表の各行に書いた URL |
| CLI 自身 | `claude --help`・`claude <サブコマンド> --help` | `codex --help`・`codex features list` |

**要約を通さずに読む。** 変更履歴は数百 KB あり、WebFetch のような要約する道具では途中で切れたり
項目が抜けたりする（実際に抜けた）。原文を手元に落とし、版の見出しで切り出してから grep する。

```sh
W="$TMPDIR/cli-upgrade"; mkdir -p "$W"
# claude: 見出しは "## 2.1.286" の形。新しい版の見出しから、記録の版の見出しの手前まで
curl -fsSL https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md -o "$W/claude.md"
awk '/^## 2\.1\.300$/{p=1} /^## 2\.1\.286$/{exit} p' "$W/claude.md" > "$W/claude-range.md"
# codex: リリースごとの本文（タグは rust-v<版>。試験版が毎日出るので除いて並べる）
gh release list -R openai/codex --exclude-pre-releases --limit 30
gh release view rust-v0.160.0 -R openai/codex > "$W/codex-0.160.0.md"
# 公式ドキュメントは .md の原文がある（例: https://code.claude.com/docs/en/hooks.md）
curl -fsSL https://code.claude.com/docs/en/hooks.md -o "$W/hooks.md"
```

切り出した範囲に見出しの無い版（飛んだ版）があれば、それも報告に書く。本文が空のリリースは
`gh api repos/openai/codex/compare/<前のタグ>...<そのタグ> -q '.commits[].commit.message'` の
1 行目で補い、補ったことを書く。

読み方は 2 段:

1. **既定の変化を先に全部読む。** codex のリリースの冒頭の要約（highlights）は全部読む。claude の
   変更履歴は `default`・`by default`・`now`・`no longer`・`removed`・`deprecated` で引く。既定が
   変わったもの（例: codex 0.157.0 の裏のサーバの自動起動と全画面の会話記録）は、下の語に当たらなくても
   code-viewer の前提を変える
2. **下の語で引く**（`session`・`settings` だけのような広い語は数百件に当たるので使わない）

当たった項目のうち code-viewer に関わるものは 1 件ずつ表の行に割り当て、関わらないものは種類ごとに
1 行でまとめて報告に書く。どの行にも当たらないが code-viewer の振る舞いに関わりそうなものは、
点検表に新しい行が要るかを考える（手順 5）。

| 引く語（大小を区別しない） | 主に当たる行 |
|---|---|
| `hook`・`SessionStart`・`SessionEnd`・`Notification`・`PermissionRequest`・`UserPromptSubmit`・`Stop`・`Interrupt`・`daemon`・`background server` | H 群・L5 |
| `statusline`・`status line`・`rate_limits`・`/usage`・`rateLimits`・`token_count`・`rollout`・`settings.local.json`・`--settings` | U 群 |
| `auth`・`login`・`sign in`・`CLAUDE_CONFIG_DIR`・`CODEX_HOME`・`.claude.json`・`onboarding`・`credentials`・`app-server`・`account/` | A 群 |
| `--add-dir`・`prompt` の位置引数・`transcript`・`sandbox` | L 群 |
| `spinner`・`permission`・`dialog`・`input box`・`prompt box`・`status`・`transcript`・`fullscreen`・`alt screen`・`title` | S 群 |
| `Shift+Enter`・`paste`・`bracketed`・`image` | I 群 |
| `skills`・`SKILL.md`・`MCP`・`protocol` | D 群 |

### 3. 点検表を上から確かめる

`references/checklist.md` を開き、点検する種類の行を**全部**確かめる。各行の「確かめ方」は
深さで 3 段に分けてある。

| 段 | 何をするか | 利用者の環境への影響 |
|---|---|---|
| A 机上 | 公式ドキュメント・`--help`・ファイルの名前を読み比べる | なし |
| B 単体 | CLI を 1 回だけ動かし、出力の**キーの名前と終了コード**だけを見る | 読むだけ。値（メール・使用率・会話）は表示しない |
| C 実画面 | 動いているエージェントで状態・フック・使用量の変化を見る | 利用者のペインを読む。`agents.md` の 10 の砂場か、利用者が用意したペイン |

- A と B は全行やる。C は、A・B で変わった疑いが出た行と、変更履歴に当たる項目があった行を必ずやる
- B で見る出力は、**点検する版が書いたもの**に限る。保存された JSON・記録のファイルは古い版が書いたものが
  混ざるので、点検表の B のコマンドが出す版（statusLine の JSON の `version`、codex の記録の
  `session_meta` の `cli_version`）が点検する版と同じかを見る。違えば「確かめられない（新しい版の出力が無い）」
- 公式の URL は転送されることがある（developers.openai.com → learn.chatgpt.com など）。転送先を読み、
  長くて途中で切れる文書は、確かめたい節の名前を挙げて逐語で訊き直す
- 両方の種類にまたがる行（「種類」が「両方」）は、claude と codex で結果を分けて書く
  （例: `H5: claude 通った / codex 確かめられない（公式に記述なし）`）
- B のコマンドが auto mode などの許可の判定で止められたら、形を変えて回り込まない。利用者に
  `! <コマンド>` で動かしてもらうか、「確かめられない（許可されなかった）」にする。点検表のコマンドに
  自分で処理を足して止められたなら、足す前の点検表のコマンドで見られた範囲だけを書く
- C を砂場でやるときは `agents.md` の 10。**本物の CLI を砂場の tmux で裸の名前で起こさない**
- C を利用者のペインでやるときは、先にどのペインかを利用者に確かめる。状態の出どころは
  `code-viewer terminal list --json` の各ペインの `source`（`hook` / `screen` / `activity`）で見る
- 1 行ずつ、次のどれか 1 つを残す。いくつも当てはまるときは**表の上のもの**を付け、ほかは根拠に書く。
  確かめられない行を「通った」に数えない

  | 結果 | 付ける条件 |
  |---|---|
  | 壊れた | 点検する版で、code-viewer が誤る・止まることを資料か出力で確かめた |
  | 要 C | 変更履歴に当たったか、A・B で疑いが出たが、C をまだしていない。ただし、当たった変更の振る舞いそのものを B で見て合っていたなら C は要らない（根拠にそう書く） |
  | 以前からの差 | 資料と code-viewer が食い違うが、記録の版より前の版で入った変化（点検表の「既知の差」）。直すかは利用者の判断 |
  | 確かめられない | 資料に記述が無い・許可されなかった・新しい版の出力が無い・その行に今回の範囲の段が無い（C だけの行を A・B だけで点検したとき）。理由を添える |
  | 通った | その行の、今回の範囲の段が 1 つ以上あり、全部合っていた |

### 4. 壊れていたら直す

| 壊れた所 | 直し方の入口 |
|---|---|
| 画面の判定（S 群） | `.agents/skills/terminal-ai-state-rules/SKILL.md`（実画面の証拠・正例と反例） |
| フックの出来事・欄（H 群） | `agents.md` の 4「出来事を足す・変えるとき」 |
| アカウント・ログイン・使用量（A・U 群） | `agents.md` の 5 |
| 起動・引き継ぎ（L 群） | `agents.md` の 6 |
| それ以外 | 点検表の「場所」の関数と、その行の「テスト」 |

- 直したら、その行の「テスト」に**新しい版の形の入力**の行を足す。古い版の形の行は消さない
  （古い版を使い続ける利用者がいる）
- 原因を言う前に `.agents/skills/project-rules/references/diagnose.md`
- 直せない・仕様の判断が要る（入れ先を変える、機能を外す等）なら、直さずに利用者へ報告する

### 5. 点検表を今の実装に合わせる

- 新しく頼るようになった振る舞いを見つけたら、点検表に行を足す（ID・頼っているもの・場所・
  壊れると・確かめ方・テスト）
- 場所は `` `web-src/…/file.ts#名前` ``、テストは `` `web-src/test/….test.ts` `` の形で書く。
  `web-src/test/agent-cli-checklist.test.ts` が、書いたファイルと名前が実在するかを確かめる
  （名前を変えたのに点検表を直さないと落ちる）

### 6. 記録を書き換える

A・B を全行、C を手順 3 の範囲で確かめ、壊れた行を直した（または利用者に報告して判断を
もらった）ときだけ、`CHECKED_AGENT_CLI_VERSIONS` の `version` と `checkedOn` を書き換える。
点検しなかった種類の行は変えない。「確かめられない」行が残るなら、その一覧を利用者に見せ、
それでも記録してよいかの判断をもらってから書く（黙って書かない）。

```sh
pnpm exec vitest run web-src/test/agent-cli-checklist.test.ts web-src/test/doctor.test.ts
pnpm run verify
npm pack --dry-run
```

コミットのメッセージ（または PR の本文）に、手順 3 の結果（壊れた行・確かめられなかった行）を
残す。記録のファイルには結果を書かない（版と日付だけ）。

## 報告の形

```text
点検した版: claude 2.1.286 → 2.1.300 / codex 変更なし
変更履歴で当たった項目: <項目> → <点検表の ID>
通った: <ID の一覧>
壊れて直した: <ID>: <何が変わったか> → <直した場所・足したテスト>
壊れて直していない: <ID>: <理由・利用者に判断を求めること>
要 C: <ID>: <当たった変更履歴の項目か、疑いの中身>
以前からの差: <ID>: <資料のどの記述と食い違うか>（点検表の「既知の差」に書いたか）
確かめられない: <ID>: <理由（例: 許可の画面を出せるペインが無い）>
記録: CHECKED_AGENT_CLI_VERSIONS を更新した / しなかった（理由）
検証: pnpm run verify / npm pack --dry-run の結果
```

## やってはいけないこと

| 違反 | 結果 |
|---|---|
| 確かめていない版を `CHECKED_AGENT_CLI_VERSIONS` に書く | 記録が「どの版で動くか」を言えなくなる。doctor が利用者に誤った安心を出す |
| 「確かめられない」行を「通った」と報告する | 次に壊れたとき、どこまで確かめたか誰にも分からない |
| CLI の出力の値（メール・使用率・会話・トークン）をログ・テスト・報告・コミットに貼る | 公開リポジトリに個人の情報が残る。見るのはキーの名前と終了コードだけ |
| 認証ファイル（`auth.json`・`.credentials.json`・キーチェーン）を開く | 秘密に触る。誰としてかは CLI に訊く |
| 利用者の状態を変える操作を点検のために行う（login / logout・`codex migrate-rollouts --apply`・フックの信頼の付け外し・設定ファイルの書き換え） | 取り消しにくい。必要なら利用者に頼む |
| 本物の claude / codex を砂場の tmux で裸の名前で起こす | PATH 上の本物が利用者のアカウントで動く（`agents.md` の 9） |
| 壊れた行のテストの期待値だけを新しい形に貼り替え、古い形の行を消す | 古い版の利用者で壊れる。テストは両方の形を持つ |
| 変更履歴を読まずに「出力が同じだったので通った」とする | 出力に出ない変化（フックの呼ばれ方・設定の読み順）を見逃す |
| 「今回は小さな版上げだから」で A・B を飛ばす | claude はほぼ毎日上がり、小さな版上げで欄の名前やフラグが変わってきた |
