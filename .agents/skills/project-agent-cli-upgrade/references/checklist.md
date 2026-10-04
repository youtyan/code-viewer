# 点検表 — code-viewer が claude / codex の振る舞いに頼っている所

`SKILL.md` の手順 3 で上から使う。各行の「場所」は `` `パス#名前` ``、「テスト」は
`` `web-src/test/….test.ts` `` の形で書く（`web-src/test/agent-cli-checklist.test.ts` が実在を
確かめる）。どのテストも手で書いた入力を使っていて、**本物の CLI の形が変わってもテストは
落ちない**。テストは「code-viewer がその形をどう読むか」を固定しているだけ。

確かめ方の段: **A** 机上（資料・`--help`・ファイル名）／ **B** CLI を 1 回動かしてキーと
終了コードだけ見る／ **C** 動いているエージェントで見る。B のコマンドは値（メール・使用率・
会話）を出さない形にしてある。形を崩して値を出さない。

`$S` は code-viewer の状態ディレクトリ（`${XDG_STATE_HOME:-$HOME/.local/state}/code-viewer`）。

---

## H. フック（状態の申告）

| ID | 種類 | 頼っているもの | 場所 | 壊れると | テスト |
|---|---|---|---|---|---|
| H1 | claude | 出来事の名前と matcher: `SessionStart`（`startup\|resume\|clear`。入力の `source` が `compact` なら申告しない）・`UserPromptSubmit`・`PostToolUse`・`Notification`（`notification_type` が `permission_prompt` / `elicitation_dialog`）・`Stop`・`StopFailure`・`SessionEnd`。`SessionEnd` 以外は `async: true`、`timeout` は秒。**既知の差**（2026-10-02 時点で未決）: 公式の matcher には `fork`（v2.1.214 から。`--fork-session`・`/branch`・裏に回した会話）もあるが入れていない。`notification_type` は 12 種類あり、`elicitation_url_dialog`（URL を開く elicitation）・`agent_needs_input`（裏のセッションの入力待ち）は入力待ちに数えていない。`async: true` のフックには claude が `timeout` を効かせない（送る側の `REPORT_TIMEOUT_MS` で終わる） | `web-src/core/agent-hooks.ts#HOOK_SPECS`・`web-src/core/agent-hooks.ts#agentEventForHook` | 黙って画面の推測に落ちる。入力待ち・完了の申告が来ない。知らない欄で claude が設定ファイルを不正と言うこともある | `web-src/test/agent-hooks-core.test.ts` |
| H2 | codex | 出来事: `SessionStart`（同じ matcher）・`UserPromptSubmit`・`PermissionRequest`・`Stop`・`Interrupt`・`SessionEnd`。code-viewer は codex に `async` を付けない（入れた当時は無かった。2026-10-02 の公式では `SessionEnd` 以外で使える）。`Interrupt` と `SessionEnd` の `timeout` は既定 1 秒・上限 3 秒 | `web-src/core/agent-hooks.ts#HOOK_SPECS`・`web-src/core/agent-hooks.ts#agentEventForHook` | 同上。上限が下がると打ち切られ、終了・中断の申告が消える | `web-src/test/agent-hooks-core.test.ts` |
| H3 | 両方 | フックの入力（stdin の JSON 1 つ）の欄: `hook_event_name`・`source`・`notification_type`・`prompt`・`session_id`・`transcript_path`（codex は null あり）・`cwd`（絶対パス） | `web-src/server/terminal/hook-report.ts#reportAgentHook`・`web-src/core/agent-state.ts#conversationFromHookInput` | 欄が消える・名前が変わると黙って空になり、「別のアカウントで続ける」が押せなくなる。型が変わると `$S/agent-hooks/failures.jsonl` に `input` で残る | `web-src/test/agent-handoff.test.ts`・`web-src/test/agent-hook-report.test.ts` |
| H4 | 両方 | 書き込む先と形: claude は `<設定ディレクトリ>/settings.json` の `hooks`、codex は `<CODEX_HOME>/hooks.json` の `hooks`。`hooks.<出来事>` は配列で、各要素の `hooks` も配列。コメントなしの JSON | `web-src/server/terminal/hooks.ts#agentHookFile`・`web-src/server/terminal/hooks.ts#defaultAgentConfigDir`・`web-src/core/agent-hooks.ts#checkHookShape` | 置き場所が変わると設定の行が「未設定」。形が変わると「読めない」で書き込みを断る（見える） | `web-src/test/agent-hooks-server.test.ts` |
| H5 | 両方 | フックの呼ばれ方: `command` をシェルで分けて動かす・エージェントの環境（`TMUX_PANE` / `CODE_VIEWER_SHELL_ID`）を受け継ぐ・終了コード 0 は止めない・stdout を出さない（claude は一部の出来事の stdout を会話に足す）。**要 C**（2026-10-02 時点で未確認）: codex は 0.157.0 から共有の裏のサーバを既定で自動起動し（`codex features list` の `daemon_auto_start`）、0.158.0 でフックの起こし方も変えた（#47610）。フックが受け継ぐ環境がペインのものかを C で見る | `web-src/server/terminal/hooks.ts#hookLauncherScript`・`web-src/server/terminal-cli.ts#runHook` | 環境が渡らないと「tmux の外」として黙って何もしない（失敗の記録も残らない） | `web-src/test/agent-hook-report.test.ts` |
| H6 | codex | 新しいフックは利用者が `/hooks` で信頼するまで動かない。信頼は定義の文字列のハッシュで覚える。hooks の機能は `codex features list` の `hooks` が `stable true` | `web-src/server/terminal/hooks.ts#agentHookCommand` | 信頼の仕組みや機能の名前が変わると、入れたのに黙って動かない（設定の行は「入っている」のまま） | なし |

**確かめ方**

- A（H1・H3・H4・H5）: https://code.claude.com/docs/en/hooks の出来事の一覧・matcher・共通の入力欄・`async`・`timeout`・終了コードの意味と、上の表を突き合わせる
- A（H2・H3・H6）: https://learn.chatgpt.com/docs/hooks （https://developers.openai.com/codex/hooks から転送される）の出来事・`async`・`timeout` の既定と上限・入力欄・信頼の説明と突き合わせる
- B（H4・H6）: キーだけを見る

  ```sh
  jq -c '.hooks | keys' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
  jq -c '.hooks | keys' "${CODEX_HOME:-$HOME/.codex}/hooks.json"
  codex features list | grep -E '^hooks\b'
  ```

- C（H1〜H6）: フックを入れたエージェントに話しかけ、許可の画面を出し、終わらせる。そのたびに
  `code-viewer terminal list --json | jq -c '.states[] | {target, state, source, agent}'` で
  `source` が `hook`、`state` が working → waiting → done と動くこと。codex は `/hooks` で
  code-viewer のフックが信頼済みと出ること。動かないのに `failures.jsonl` が空なら、H5（環境）か
  H6（信頼）を疑う

---

## U. statusLine と使用量

| ID | 種類 | 頼っているもの | 場所 | 壊れると | テスト |
|---|---|---|---|---|---|
| U1 | claude | `settings.json` の `statusLine`（`type: "command"`・`command` は文字列・ほかの欄は残す）。`command` を `sh` で動かし、JSON を stdin に渡す。前の回が終わる前に次が来ると止める。**statusLine のプロセスが `CLAUDE_CONFIG_DIR` を受け継ぐ**（保存先の名前に使う） | `web-src/server/terminal/statusline.ts#statusLineWrapperScript`・`web-src/server/terminal/statusline.ts#checkStatusLineShape` | 変数が渡らないと全アカウントの使用量が既定のアカウントに入る（黙って取り違える）。stdin が来ないと保存が止まり「いつの値か」が古いまま | `web-src/test/agent-statusline.test.ts` |
| U2 | claude | statusLine の JSON の `rate_limits.five_hour` / `seven_day` の `used_percentage`・`resets_at`（秒かミリ秒） | `web-src/server/accounts/usage.ts#parseClaudeStatusline` | 名前が変わると黙って「上限なし」。型が変わると「読めない」と理由が出る | `web-src/test/agent-accounts-server.test.ts`・`web-src/test/agent-statusline.test.ts` |
| U3 | claude | プロジェクトの設定ファイルの読む順（git のルートの `.claude/settings.local.json` → 起動したフォルダの `settings.local.json` → `settings.json`）と、`--settings '<JSON>'` がそれらより強いこと | `web-src/server/accounts/project-statusline.ts#projectSettingsFiles`・`web-src/server/accounts/launch.ts#statusLineSettingsArgs` | statusLine を持つプロジェクトで起こした claude だけ、使用量が黙って記録されない | `web-src/test/project-statusline.test.ts` |
| U4 | claude | `claude --safe-mode --print /usage --output-format stream-json --verbose` の出力: `type: "result"` の行が `is_error: false`・`local_command: "usage"`・`num_turns`・`total_cost_usd`・`duration_api_ms` が 0。`usage_report.rate_limits.limits[]` の `kind`（`session` / `weekly_all`）・`percent`（0〜100）・`resets_at`（ISO か null）。`ANTHROPIC_BASE_URL` を繋がらない所にしても `/usage` は通る | `web-src/server/accounts/usage-check.ts#claudeWindows` | 「使用量を確かめる」が理由つきで失敗する（見える）。`percent` の尺度が変わると黙って誤った値 | `web-src/test/usage-check-server.test.ts` |
| U5 | codex | `codex app-server`（1 行 1 JSON、`jsonrpc` の欄なし）に `initialize` → 答えを待って `initialized` → `account/rateLimits/read`。答えの `result.rateLimits.primary` / `secondary` は null か `{usedPercent, windowDurationMins, resetsAt}`（`resetsAt` は秒）。stdin を閉じたら 8 秒以内に 0 で終わる | `web-src/server/accounts/usage-check.ts#codexWindows`・`web-src/server/accounts/login.ts#runRpc` | 理由つきで失敗（見える）。`resetsAt` がミリ秒になると黙って遠い未来の時刻 | `web-src/test/usage-check-server.test.ts` |
| U6 | codex | セッション記録 `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl` の `payload.type == "token_count"` の行の `payload.rate_limits.primary` / `secondary` の `used_percent`・`window_minutes`・`resets_at`、行の `timestamp`。**公式に約束された形ではない** | `web-src/server/accounts/usage.ts#parseCodexTokenCountLine`・`web-src/server/accounts/usage.ts#recentRolloutFiles` | 「取得できません」と理由が出る。U5 が通っている間は隠れる | `web-src/test/agent-accounts-server.test.ts` |

**確かめ方**

- A（U1・U2）: https://code.claude.com/docs/en/statusline の入力の JSON の欄と、コマンドの動かし方
- A（U3）: https://code.claude.com/docs/en/settings の設定ファイルの場所と優先順位、`claude --help` の `--settings`
- A（U4）: `claude --help` に `--safe-mode`・`--print`・`--output-format`・`--verbose` があること
- A（U6）: 変更履歴に rollout・session・thread の保存の変更が無いか。`codex features list` の
  `background_paginated_rollout_migration` などが既定で有効になったら U6 は形が変わる疑い
  （`codex migrate-rollouts` は**読むだけの既定のまま**動かさない。`--apply` は禁止）
- B（U1・U2）: 最後に保存された statusLine の JSON のキーと、それを書いた claude の版（`version` が
  点検する版でなければ「確かめられない（新しい版の出力が無い）」。新しい版で 1 ターン動かしてから見直す）

  ```sh
  f=$(ls -t "$S"/agent-usage/claude-*.json | head -1)
  jq -c '{version, rate_limits: (.rate_limits | map_values(keys))}' "$f"
  ```

- B（U4）: code-viewer が使う確認専用の場所で、値を出さずに形だけ見る

  ```sh
  cd "$S/usage-check" && ANTHROPIC_BASE_URL=http://127.0.0.1:1 \
    claude --safe-mode --print /usage --output-format stream-json --verbose \
    | jq -c 'if .type == "result" then {is_error, local_command, num_turns, total_cost_usd, duration_api_ms}
             elif .usage_report then [.usage_report.rate_limits.limits[] | {kind, percent: (.percent | type), resets_at: (.resets_at | type)}]
             else empty end'
  ```

- B（U5）:

  ```sh
  (printf '%s\n' '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"code-viewer","version":"0"}}}'; sleep 1
   printf '%s\n' '{"method":"initialized"}' '{"id":2,"method":"account/rateLimits/read"}'; sleep 3) \
    | codex app-server \
    | jq -c 'select(.id == 2) | .result.rateLimits | map_values(if . == null then null elif type == "object" then keys else type end)'
  ```

- B（U6）: **点検する版が書いた**記録（1 行目の `session_meta` の `cli_version`）のうち `token_count` を
  含むものを選び、上限の欄のキーと型だけを見る。見つからなければ「確かめられない（新しい版の出力が無い）」

  ```sh
  v=0.159.3   # 点検する codex の版
  for f in $(ls -t "${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*.jsonl | head -50); do
    [ "$(head -1 "$f" | jq -r '.payload.cli_version // empty')" = "$v" ] && grep -q '"token_count"' "$f" && break
    f=
  done
  [ -n "$f" ] && grep '"token_count"' "$f" | tail -1 \
    | jq -c '{timestamp: (.timestamp | type), rate_limits: (.payload.rate_limits | map_values(if type == "object" then keys else type end))}'
  ```

- C（U1〜U3）: statusLine を包んだアカウントで claude を 1 ターン動かし、`$S/agent-usage/` の
  そのアカウントのファイルの更新時刻が進むこと。`.claude/settings.local.json` に statusLine を
  持つ砂場のリポジトリで code-viewer から起こしても進むこと（U3）

---

## A. アカウントとログイン

| ID | 種類 | 頼っているもの | 場所 | 壊れると | テスト |
|---|---|---|---|---|---|
| A1 | 両方 | アカウントを分ける変数 `CLAUDE_CONFIG_DIR` / `CODEX_HOME`。外すと `~/.claude` / `~/.codex`。**既知の差**: claude の Console のサインイン（API キーなし）は設定ディレクトリの外に保存されるので分かれない（公式の authentication。2026-10-02 時点で画面に注記なし） | `web-src/core/agent-accounts.ts#ACCOUNT_ENV` | 黙って同じ認証を共有し、全部の行が同じメールになる | `web-src/test/agent-accounts-core.test.ts`・`web-src/test/agent-accounts-server.test.ts` |
| A2 | 両方 | 新しいアカウントに共有する設定の名前（claude: `settings.json`・`CLAUDE.md`・`skills` ほか、codex: `config.toml`・`AGENTS.md`・`hooks.json`・`rules` ほか）。CLI がリンクを保ったまま書くこと。**既知の差**（2026-10-02 時点で未決）: claude は claude.ai のアカウントから同期したスキルを `~/.claude/skills/synced/` に置く（公式の skills）。`skills` をリンクで共有すると、同期分もアカウントの間で共有される | `web-src/core/agent-accounts.ts#SHARED_CONFIG_ENTRIES` | 名前が変わると「選べば共有」に落ち、新しいアカウントが黙ってその設定を持たない | `web-src/test/agent-accounts-core.test.ts` |
| A3 | 両方 | 共有しない名前（認証・識別・履歴・セッション・キャッシュ・動作中の状態） | `web-src/core/agent-accounts.ts#BLOCKED_NAMES`・`web-src/core/agent-accounts.ts#BLOCKED_PATTERNS`・`web-src/core/agent-accounts.ts#SUSPECT_NAME` | 新しい認証のファイルが `SUSPECT_NAME` に当たらないと「選べば共有」に出る（既定はオフ） | `web-src/test/agent-accounts-core.test.ts` |
| A4 | 両方 | 共有する設定ファイルの中の認証の欄（claude: `apiKeyHelper`・`env.ANTHROPIC_API_KEY` ほか、codex: `bearer_token` ほか）。**既知の差**: codex の MCP の `http_headers`（Authorization を直に書ける）・`http_headers_helper` は一覧に無い（2026-10-02 時点で未決） | `web-src/core/agent-accounts.ts#AUTH_SETTING_KEYS` | 新しい認証の欄が警告に出ない | `web-src/test/agent-accounts-core.test.ts` |
| A5 | 両方 | サブコマンド: `claude auth login`・`claude auth status --json`・`codex login`・`codex login status` | `web-src/server/accounts/launch.ts#AGENT_SUBCOMMANDS` | ログインの窓に CLI のエラーが出る。状態は「不明」と理由 | `web-src/test/agent-accounts-server.test.ts` |
| A6 | claude | `claude auth status --json` の JSON の `loggedIn`（真偽）・`email`・`authMethod`・`subscriptionType`。前に端末向けの文字列が付いても `{ … }` を読む | `web-src/server/accounts/login.ts#parseClaudeAuthStatus` | `loggedIn` が消えると「不明」。`email` が変わると黙ってメールが出ない | `web-src/test/agent-accounts-server.test.ts` |
| A7 | codex | `codex login status` の文言（stdout と stderr を合わせる）: `not logged in` / `logged in using (ChatGPT\|an API key…)`。メールを訊くのは `ChatGPT` のときだけ | `web-src/server/accounts/login.ts#parseCodexLoginStatus` | 文言が変わると「不明」。方式の言い方が変わるとメールが黙って出ない | `web-src/test/agent-accounts-server.test.ts` |
| A8 | codex | app-server の `account/read`（`refreshToken: false`）の答え `result.account` が `{type: "chatgpt", email, planType}`・`{type: "apiKey"}`・null。未ログインのディレクトリでは app-server を起こさない | `web-src/server/accounts/login.ts#parseCodexAccountRead`・`web-src/server/accounts/login.ts#ACCOUNT_READ_REQUESTS` | メールが出ず、理由が行に出る | `web-src/test/agent-accounts-server.test.ts` |
| A9 | claude | 対話の画面は `<設定ディレクトリ>/.claude.json` の `hasCompletedOnboarding` で初回の案内を飛ばす。`claude auth login` はこの印を付けない（上流は直さないと閉じた: anthropics/claude-code#67149） | `web-src/server/accounts/onboarding.ts#markClaudeOnboarded` | code-viewer で作ったアカウントを開くと初回の案内をやり直させる（ログインが消えたように見える） | `web-src/test/accounts-onboarding.test.ts` |

**確かめ方**

- A（A1〜A4）: https://code.claude.com/docs/en/claude-directory 、https://learn.chatgpt.com/docs/config-file/config-advanced 、
  https://developers.openai.com/codex/rules の置き場所の一覧と、上の名前の一覧（`SHARED_CONFIG_ENTRIES`・
  `BLOCKED_NAMES` のコメントの URL）を突き合わせる
- B（A2・A3）: 既定の設定ディレクトリの直下の名前のうち、どの一覧にも無いものを探す（未知の名前は
  「選べば共有」に出る。認証らしいものが混ざっていないか見る）。auto mode が認証の探索として止めたら、
  利用者に `! ls -A …` で動かしてもらう

  ```sh
  ls -A "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "${CODEX_HOME:-$HOME/.codex}"
  ```

- B（A1・A5・A6）: キーと終了コードだけ

  ```sh
  claude auth status --help | grep -E -- '--json|--text'
  claude auth status --json | jq -c 'keys, (.loggedIn | type)'
  claude auth status --json > /dev/null; echo "exit=$?"
  ```

  `configDirectory` があれば、`CLAUDE_CONFIG_DIR` を付けたときにその値が変わることも見る（A1）
- B（A5・A7）: `codex login status > /dev/null 2>&1; echo "exit=$?"`。文言は
  `codex login status 2>&1 | head -1` を見て、メールらしい文字列が出たら貼らない
- B（A8）:

  ```sh
  (printf '%s\n' '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"code-viewer","version":"0"}}}' \
     '{"method":"initialized"}' '{"id":2,"method":"account/read","params":{"refreshToken":false}}'; sleep 3) \
    | codex app-server | jq -c 'select(.id == 2) | .result.account | if . == null then null else keys end'
  ```

- B（A9）: code-viewer が作ったアカウントの設定ディレクトリで
  `jq 'has("hasCompletedOnboarding")' <設定ディレクトリ>/.claude.json`（値だけ。ほかの欄は出さない）
- C（A9）: そのアカウントで `CLAUDE_CONFIG_DIR=<設定ディレクトリ> claude` を起こし、テーマの選択や
  ログインの方法の選択が出ないこと（利用者に頼む）

---

## L. 起動・引き継ぎ・プロセスの見分け

| ID | 種類 | 頼っているもの | 場所 | 壊れると | テスト |
|---|---|---|---|---|---|
| L1 | 両方 | 起動・ログイン・状態の確認は、設定の起動コマンドを対話シェル（`$SHELL -i -c '<コマンド> "$@"'`）で動かす | `web-src/server/accounts/launch.ts#agentCommandArgv` | — （CLI の変化では壊れない。ラッパーの利用者向けの前提） | `web-src/test/agent-accounts-server.test.ts` |
| L2 | claude | 引き継ぎ: `claude "<指示>" --add-dir <フォルダ>`（指示が先。`--add-dir` は値を複数取り、フォルダが実在しないと断る） | `web-src/core/agent-accounts.ts#handoffArgs`・`web-src/core/agent-accounts.ts#handoffPrompt` | 起動の窓に CLI のエラー（`remain-on-exit` で読める） | `web-src/test/agent-handoff.test.ts` |
| L3 | codex | 引き継ぎ: `codex "<指示>"` だけ（`--add-dir` は書き込みの許可なので使わない）。既定のサンドボックスで作業フォルダの外を読める | `web-src/core/agent-accounts.ts#handoffArgs` | 外を読めなくなった版では、codex が読む前に許可を求めるはず（未確認） | `web-src/test/agent-handoff.test.ts` |
| L4 | 両方 | ペインの前面のコマンド名（tmux の `pane_current_command`）で種類を決める: `claude`、または `x.y.z`（ネイティブの claude は版の名前で動く）→ claude、`codex` → codex。`node` で動く claude はフックの名乗りだけ | `web-src/core/agent-overview.ts#agentKindOf` | 黙って種類が出ない。アカウントが分からない・会話の場所を戻せない | `web-src/test/agent-overview-core.test.ts`・`web-src/test/agent-conversations.test.ts` |
| L5 | 両方 | エージェントのプロセスがペインのシェルの子孫で、名前が `pane_current_command` と同じ。`CLAUDE_CONFIG_DIR` / `CODEX_HOME` を受け継ぐ。**要 C**（2026-10-02 時点で未確認）: codex 0.157.0 からの共有の裏のサーバ（H5）で、作業するプロセスがペインのシェルの子孫でなくなっていないか | `web-src/server/accounts/process-env.ts#findAgentProcess` | 行のアカウントが「不明」と理由 | `web-src/test/agent-accounts-server.test.ts` |
| L6 | 両方 | `transcript_path` が実在するファイルを指す（中身は読まない） | `web-src/server/terminal/agent-conversations.ts#decideConversationRestore` | 再起動の後に会話の場所を戻さず、理由をログに出す | `web-src/test/agent-conversations.test.ts` |
| L7 | claude | 起動に `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` を足すと、設定の `tui`（全画面表示）より優先して通常の表示で動き、会話が tmux の過去の行に残る | `web-src/core/agent-accounts.ts#LAUNCH_ENV` | 全画面表示のまま起動し、スマホの読む画面で過去の出力が読めない（ペインの `alternate_on` が 1） | `web-src/test/agent-accounts-core.test.ts` |

**確かめ方**

- A（L2・L3）: `claude --help` の `--add-dir <directories...>` と位置引数 `[prompt]`、`codex --help` の
  `[PROMPT]`。codex のサンドボックスの説明（https://developers.openai.com/codex/ の sandbox の節）で
  作業フォルダの外の読み取りの扱いが変わっていないか
- C（L4・L5）: 動いている claude と codex のペインが、左のサイドバーの行で種類（claude / codex）と
  アカウントを出していること。出ないときは、利用者に tmux のソケットを訊いてから
  `env -u TMUX -u TMUX_PANE tmux -S <ソケット> list-panes -a -F '#{pane_id} #{pane_current_command}'`
  （メタ情報だけ。画面の中身は読まない）。版の名前に `-beta` などが付くと L4 の `x.y.z` に当たらない
- C（L2・L3・L6）: 砂場（`agents.md` の 6 の最後の段落の偽の実行ファイル）で引き継ぎの引数を確かめる。
  本物での確認は利用者に頼む
- A（L7）: https://code.claude.com/docs/en/env-vars の `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` の行に
  「`tui` の設定より優先」とあること。C: code-viewer から起動した claude のペインの
  `#{alternate_on}` が 0（`list-panes -a -F '#{pane_id} #{alternate_on}'`。画面の中身は読まない）

---

## S. 画面と出力の読み取り

| ID | 種類 | 頼っているもの | 場所 | 壊れると | テスト |
|---|---|---|---|---|---|
| S1 | 両方 | 状態の画面ルール。claude: 作業中の行 `✻ … (`・区切り線に挟まれた `❯` の入力欄・`Do you want to proceed?` と `Yes` / `No`・`Enter to select · ↑/↓ to navigate · Esc to cancel`・`showing detailed transcript`。codex: ペインの題の点字のスピナー・`• Working`・`esc to interrupt)`・`›` の入力欄・`press enter to confirm or esc to cancel`。**要 C**（2026-10-02 時点で未確認）: codex は 0.157.0 から全画面の会話記録が既定（#47178） | `web-src/core/agent-screen.ts#DEFAULT_AGENT_SCREEN_RULES` | 必ず黙って誤る（状態が違う・`source` が `activity` に落ちる） | `web-src/test/agent-screen-core.test.ts`・`web-src/test/agent-activity.test.ts` |
| S2 | 両方 | ペインの題（OSC で付く）の頭の状態の記号（`✳`・点字のスピナー） | `web-src/core/agent-overview.ts#TITLE_STATUS_PREFIX`・`web-src/views/terminal/image-shelf.ts#cleanPaneTitle` | 見た目だけ（作業の名前に記号が残る） | `web-src/test/agent-overview-core.test.ts` |
| S3 | claude | 電話の読む画面: スピナーの行・`⎿ Waiting…`・入力欄の上下の `─` の線（全幅、0 桁目から）・`⏺` / `⎿` の印 | `web-src/core/pane-reflow.ts#withoutTransient` | 見た目だけ（消えるはずの行が残る・折り返しを誤る） | `web-src/test/pane-reflow.test.ts` |
| S4 | 両方 | 選択肢 `1. …` と、数字のキーでそれを選べること | `web-src/core/pane-reflow.ts#findChoices` | 電話のボタンが出ない・押しても違うものを選ぶ | `web-src/test/pane-reflow.test.ts` |
| S5 | claude | 添付の行の折り返し（`› [image] /path/ban (124.9KB)` の次の行に続き） | `web-src/core/terminal-images.ts#joinBrokenPathLines` | 画像の棚がそのパスを拾わない | `web-src/test/terminal-images-core.test.ts` |

**確かめ方**

- A（S1〜S5）: 変更履歴に画面の表示（spinner・prompt・status・permission・transcript）の変更があるか
- C（S1）: 作業中・入力待ち・待機・履歴の表示のそれぞれで、サイドバーの状態の印と
  `code-viewer terminal list --json` の `source` が `screen` で合っていること。フックを入れている
  エージェントでは画面のルールは下支えなので、フックを外した砂場か、`source` が `screen` の
  ペインで見る。外れていたら `.agents/skills/terminal-ai-state-rules/SKILL.md` の手順で直す
- C（S3・S4）: 電話の幅（640px 以下）で claude のペインを読む画面にし、許可の画面で数字の
  ボタンが出て押せること

---

## I. 入力

| ID | 種類 | 頼っているもの | 場所 | 壊れると | テスト |
|---|---|---|---|---|---|
| I1 | 両方 | Shift+Enter は括弧付きの貼り付け（`ESC[200~` LF `ESC[201~`）で送り、エージェントが改行として受ける（送信しない） | `web-src/core/terminal-paste.ts#SHIFT_ENTER_SEQUENCE` | 書きかけの指示が送信される（見える） | `web-src/test/terminal-paste-core.test.ts` |
| I2 | 両方 | 貼った画像は `<リポジトリ>/.code-viewer/pasted/` に保存し、引用符付きの絶対パスを打ち込む。エージェントがそのパスの画像を読める | `web-src/core/terminal-paste.ts#PASTE_IMAGE_DIR`・`web-src/views/terminal/terminal-screen.ts#pasteImage` | 画像が付かずパスが文字のまま残る（見える） | `web-src/test/terminal-paste-save.test.ts` |

**確かめ方**

- C（I1・I2）: code-viewer のターミナルのタブ（tmux の上）で、claude と codex のそれぞれに Shift+Enter で
  改行が入って送信されないこと、画像を貼ってエージェントがそれを読めること（利用者に頼むか、
  利用者が用意したペインで）

---

## D. 配るスキルと MCP

| ID | 種類 | 頼っているもの | 場所 | 壊れると | テスト |
|---|---|---|---|---|---|
| D1 | 両方 | `skill install --agent <種類>` の入れ先: `<base>/.claude/skills/`・`<base>/.codex/skills/`・`<base>/.agents/skills/`（`--global` なら base はホーム） | `web-src/server/skill-cli.ts#AGENT_SKILL_DIRS` | 入れたスキルが黙って読まれない | `web-src/test/skill-cli.test.ts` |
| D2 | 両方 | 配るスキルの frontmatter は `name` と `description` だけ（`skills/*/SKILL.md`） | `web-src/server/skill-cli.ts#AGENT_SKILL_DIRS` | 読まれない・説明が切られる | `web-src/test/skill-cli.test.ts`・`web-src/test/accounts-cli.test.ts` |
| D3 | 両方 | MCP の `initialize` に、要求に関わらず `2025-06-18` を返す。POST だけ・JSON の応答だけ・`Mcp-Session-Id` なし。claude は v2 の MCP クライアントで `2026-07-28` の取り決めを既定で使う（変更履歴。`MCP_PROTOCOL_NEGOTIATION=legacy` で戻せる）ので、古い版を答えるサーバに繋がるかは C で見る | `web-src/server/mcp.ts#MCP_PROTOCOL_VERSION` | その版を受けない CLI が繋がらない（CLI の MCP の一覧にエラー） | `web-src/test/mcp.test.ts` |

**確かめ方**

- A（D1・D2）: claude は https://code.claude.com/docs/en/skills 、codex は https://learn.chatgpt.com/docs/build-skills
  の読む場所と frontmatter の決まり。**2026-10-02 時点で codex の公式の読む場所は `.agents/skills`
  （作業フォルダからリポジトリのルートまで）・`~/.agents/skills`・`/etc/codex/skills` で、
  `--agent codex` の入れ先 `.codex/skills` は載っていない**（利用者に判断を求めた。直すまでこの行は
  「以前からの差」に数える）
- A（D3）: https://code.claude.com/docs/en/mcp と codex の MCP の説明が、Streamable HTTP の
  `2025-06-18` を受けるか。`claude mcp add --help`・`codex mcp add --help` に HTTP の繋ぎ方があるか
- C（D3）: 砂場のサーバの `_mcp` に `curl -X POST` で `initialize` を送り、`protocolVersion` が返ること。
  点検する claude・codex から砂場の `_mcp` を MCP のサーバとして足し（`claude mcp add --transport http …` /
  `codex mcp add …`。足す先は砂場の `HOME` の設定）、`mcp list` で繋がっていること

---

## W. 利用者向けの文書の記述

| ID | 種類 | 頼っているもの | 場所 | 壊れると | テスト |
|---|---|---|---|---|---|
| W1 | 両方 | README・ヘルプ・設定の文言に書いたコマンドと振る舞い（`claude auth status`・`codex login status`・`/hooks` での信頼・`/usage`・`account/rateLimits/read`・`~/.codex/skills/`・「モデルへの送信をしない」） | `web-src/views/help-text-en.ts#helpTextEn`・`web-src/views/help-text-ja.ts#helpTextJa`・`web-src/views/agents/accounts-i18n.ts#ACCOUNTS_EN`・`web-src/views/agents/accounts-i18n.ts#ACCOUNTS_JA` | 文書だけが古くなる | なし |

**確かめ方**

- A（W1）: 上の各群で変わった所が文書に書かれていないか引く

  ```sh
  grep -n -E "claude auth|codex login|/hooks|/usage|rateLimits|\.codex/skills|statusLine" \
    README.md README_ja.md web-src/views/help-text-*.ts web-src/views/agents/*i18n.ts \
    web-src/server/accounts-cli.ts web-src/server/skill-cli.ts skills/*/SKILL.md
  ```
