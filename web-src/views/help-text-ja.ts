// ヘルプの本文 (日本語)。節の並びと名前は help-guides.ts、英語は help-text-en.ts。
// 画面のボタン名は { ui } で、値は各画面の i18n から (w.l)。1 段落は 120 文字・
// 1 節の本文は 600 文字まで (help-text-length.test.ts)。

import type { HelpText } from "./help-blocks";
import type { HelpTexts, HelpWriter } from "./help-guides";
import { helpFigure } from "./help-images";
import type { HelpBlock } from "./help-page";

const fig = (name: string, alt: string) => helpFigure("ja", name, alt);
const ui = (label: string) => ({ ui: label });
const code = (text: string) => ({ code: text });
const key = (text: string) => ({ key: text });
const more = (...items: HelpText[]): HelpBlock => ({
  kind: "details",
  blocks: [{ kind: "list", items }],
});

// ai-dup-check: allow -- ok:英日の本文は同じ節と部品の並びを別の言語の文で持つ (help-text-en.ts と対)
export function helpTextJa(w: HelpWriter): HelpTexts {
  const { l } = w;
  const settings = ui(l.agents.sidebar.settings);
  const cat = l.settings.categories;
  const hooks = l.agents.hooks;
  const accounts = l.agents.accounts;
  const app = l.app;
  return {
    "getting-started": {
      title: "導入手順",
      intro:
        "code-viewer は、リポジトリをブラウザで読み、AI エージェントを動かして見守る道具です。上から順にやれば使い始められます（Node.js 20 以上と git が要ります）。",
      lead: [
        {
          kind: "steps",
          items: [
            {
              title: "起動する",
              command: "npx @youtyan/code-viewer --open",
              figures: [
                fig(
                  "overview",
                  "code-viewer の画面。左のサイドバーにプロジェクトとエージェント、上にタブ、本文に開いたプロジェクトの変更が出ています。",
                ),
              ],
              text: "リポジトリのフォルダで打つと、ブラウザで画面が開きます。",
            },
            {
              title: "画面の見方",
              figures: [
                fig(
                  "overview-marked",
                  "画面の各部に番号の印。①サイドバー、②ファイル一覧、③タブ、④本文、⑤最下段。",
                ),
              ],
              text: "①プロジェクトとエージェント、②ファイル一覧、③タブ、④本文、⑤最下段です。",
              link: w.seeText("tabs-layout"),
            },
            {
              title: "（任意）ほかのリポジトリを足す",
              figures: [
                fig(
                  "project-register",
                  `リポジトリのフォルダに入ったところ。下の［${l.agents.projects.addProjectSubmit}］で加わります。`,
                ),
              ],
              text: [
                ui(l.agents.sidebar.projects),
                " の横の ＋ でフォルダを選び、",
                ui(l.agents.projects.addProjectSubmit),
                " を押します。",
              ],
              link: w.seeText("projects"),
            },
            {
              title: "tmux を入れる",
              command: "brew install tmux",
              figures: [
                fig(
                  "sidebar-no-tmux",
                  `tmux が無いときのサイドバー。「${l.agents.sidebar.notInstalled}」と出ています。`,
                ),
              ],
              text: [
                "Linux では ",
                code("sudo apt install tmux"),
                " などで入れます。",
              ],
            },
            {
              title: "アカウントにログインする",
              figures: [
                fig(
                  "accounts-sign-in",
                  `設定のアカウントの行と、その行の［${accounts.loginButton}］。`,
                ),
              ],
              text: [
                settings,
                " → ",
                ui(cat.accounts.label),
                " で行の ",
                ui(accounts.loginButton),
                " を押し、ブラウザで許可します（",
                ui(accounts.login["logged-in"]),
                " なら不要）。",
              ],
              link: w.seeText("add-account"),
            },
            {
              title: "（任意・おすすめ）フックを入れる",
              figures: [
                fig(
                  "hooks-section",
                  `設定の［${hooks.title}］の節。claude の行に［${hooks.action.install}］があります。`,
                ),
              ],
              text: [
                settings,
                " → ",
                ui(cat.agents.label),
                " の ",
                ui(hooks.title),
                " で ",
                ui(hooks.action.install),
                " を押すと、状態が正しく出ます。",
              ],
              link: w.seeText("agent-hooks"),
            },
            {
              title: "エージェントを起動する",
              figures: [
                fig(
                  "agent-launch",
                  `${l.agents.sidebar.newAgent}の画面。${accounts.launchKind}・${accounts.launchAccount}・${accounts.launchProject}を選び、下の［${accounts.launchRun}］で起動します。`,
                ),
              ],
              text: [
                "サイドバーの下の ",
                ui(l.agents.sidebar.newAgent),
                " で種類・アカウント・プロジェクトを選び、",
                ui(accounts.launchRun),
                " を押します。",
              ],
              link: w.seeText("start-agent"),
            },
            {
              title: "（任意）通知を有効にする",
              figures: [
                fig(
                  "notify-enable",
                  `${l.agents.board.allAgents}の画面の［${l.agents.notifyEnable}］。`,
                ),
              ],
              text: [
                ui(l.agents.board.allAgents),
                " の画面で ",
                ui(l.agents.notifyEnable),
                " を押すと、入力待ちを知らせます。",
              ],
              link: w.seeText("notifications"),
            },
            {
              title: "（任意）AI にスキルを入れる",
              command: "npx @youtyan/code-viewer skill install",
              figures: [
                fig(
                  "skill-install",
                  "ターミナルのタブで code-viewer skill install --agent claude,codex を実行したところ。入れたスキルが 1 行ずつ出ます。",
                ),
              ],
              text: "AI に「claude のアカウントを追加して」のように頼めるようになります。",
              link: w.seeText("ask-ai"),
            },
            {
              title: "うまく動かないときは doctor を見る",
              command: "npx @youtyan/code-viewer doctor",
              figures: [
                fig(
                  "doctor-sheet",
                  `${l.doctor.title}を開いたところ。項目ごとに OK・WARN と直し方が出ます。`,
                ),
              ],
              text: [
                "足りないものと直し方が出ます（最下段の ",
                ui(l.doctor.title),
                " でも開けます）。",
              ],
              link: w.seeText("doctor"),
            },
          ],
        },
        more(
          [
            code("npm install -g @youtyan/code-viewer"),
            " で入れておくと、",
            code("npx @youtyan/code-viewer"),
            " の代わりに ",
            code("code-viewer"),
            " と打てます。ほかの節のコマンドは、この形で書いています。",
          ],
          "エージェントの状態は、サイドバー・最下段・タブの題に出ます。",
        ),
      ],
      groups: [],
    },
    projects: {
      title: "プロジェクトを足す・切り替える",
      intro:
        "プロジェクトは、左のサイドバーに並ぶ git のリポジトリです。code-viewer を起動したリポジトリは自動で加わります。",
      groups: [
        {
          title: "足す",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  text: [
                    ui(l.agents.sidebar.projects),
                    " の横の ＋ を押し、リポジトリのフォルダを選んで ",
                    ui(l.agents.projects.addProjectSubmit),
                    " を押します。",
                  ],
                  figures: [
                    fig(
                      "project-add",
                      `${l.agents.projects.addProject}の画面。フォルダが並び、git のリポジトリには git の札が付いています。`,
                    ),
                    fig(
                      "project-register",
                      `リポジトリのフォルダに入ったところ。下の［${l.agents.projects.addProjectSubmit}］で加わります。`,
                    ),
                  ],
                },
              ],
            },
            {
              kind: "list",
              items: [
                [
                  "パレット（",
                  key(app.paletteKey),
                  "）の ",
                  ui(l.agents.projects.addProjectMenu),
                  " からも同じ画面が開きます。",
                ],
                [
                  "別のリポジトリのフォルダで ",
                  code("code-viewer"),
                  " を打っても加わります。",
                ],
              ],
            },
          ],
        },
        {
          title: "切り替える",
          blocks: [
            {
              kind: "list",
              items: [
                "サイドバーのプロジェクト名を押すと、そのプロジェクトに移ります。",
                [
                  "一覧の列の上のプロジェクト名を押す（",
                  key("p"),
                  "）と、名前で探して移れます。",
                ],
                "移っても、タブ・ターミナル・未読の印はそのまま残ります。",
                [
                  ui(l.agents.sidebar.detected),
                  " には、登録していないのにエージェントが動いているプロジェクトが出ます。",
                ],
              ],
            },
          ],
        },
        {
          title: "並べる・色を変える",
          blocks: [
            {
              kind: "list",
              items: [
                "見出しをドラッグすると、並びを変えられます。",
                "見出しの ⋯ から、名前・色を変えたり、登録を外したりできます。登録を外しても、リポジトリには触りません。",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "projects-menu",
                "プロジェクトの見出しの ⋯ のメニュー。",
              ),
            },
            more(
              [
                "エージェントもシェルも無いプロジェクトは ",
                ui(l.agents.sidebar.stopped(0).replace(/\s*\(0\)$/, "")),
                " にまとまり、開くと起動し直します。",
              ],
              [
                "しばらく使っていないプロジェクトは裏で止まります。止めるまでの時間は ",
                code("--idle-stop <秒>"),
                " で変えます。",
              ],
              [
                "1 つのリポジトリだけの code-viewer を別に動かすなら ",
                code("code-viewer --standalone"),
                " です。",
              ],
              [
                "動かしたまま code-viewer を入れ直すと、プロジェクトを起動できなくなります。起動した端末で ",
                key("Ctrl+C"),
                " で止め、打ち直してください。",
              ],
              "テーマ・言語・キーの割り当ては、全部のプロジェクトで共通です。",
            ),
          ],
        },
      ],
    },
    "read-files": {
      title: "ファイルを読む",
      intro:
        "左のファイル一覧からファイルを開き、コード・プレビュー・blame・履歴で読めます。",
      groups: [
        {
          title: "開く",
          blocks: [
            {
              kind: "list",
              items: [
                "ファイル一覧で押すと、名前が斜体の仮のタブで開き、次に開いたファイルに置き換わります。",
                [
                  "残しておきたいタブは、ダブルクリックするか、右クリックの ",
                  ui(l.mainTabs.keepOpen),
                  " を選びます。",
                ],
                [
                  "ファイル名で探すときは、パレット（",
                  key(app.paletteKey),
                  "）を使います。",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "files-open",
                "ファイル一覧からファイルを開いたところ。",
              ),
            },
          ],
        },
        {
          title: "見方を切り替える",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "ファイルの上の ",
                  ui(l.source.tabCode),
                  "・",
                  ui(l.source.tabPreview),
                  "・",
                  ui(l.source.tabBlame),
                  "・",
                  ui(l.source.tabHistory),
                  " で切り替えます。",
                ],
                "Markdown・HTML・画像・PDF・動画・音声は、プレビューで見られます。",
                "CSV と TSV は表で出て、列ごとに絞り込みと並べ替えができます。",
              ],
            },
          ],
        },
        {
          title: "選んだ行を AI に渡す",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "行番号をドラッグして範囲を選び、出てきたボタンで ",
                  code("@パス#1-9"),
                  " をコピーします。",
                ],
                [
                  key("Shift"),
                  " を押しながら押すと、選んだ行のコードも一緒にコピーします。",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "files-line-select",
                "行番号をドラッグして行を選び、コピーのボタンが出ているところ。",
              ),
            },
          ],
        },
        {
          title: "ファイル一覧の印",
          blocks: [
            {
              kind: "list",
              items: [
                "M は変更、A は追加（ステージ済み）、D は削除、R は名前の変更です。",
                "U はまだ git add していないファイル、I は .gitignore で無視しているファイルです。",
              ],
            },
            more(
              "remote が GitHub なら、ファイルや選んだ行を GitHub で開けます。",
              [
                "ファイル一覧の上の欄で絞り込めます。",
                code("/…/"),
                " は正規表現、",
                code("~…"),
                " はあいまい一致、",
                code("*.ts"),
                " は glob です。",
              ],
              "Markdown の中の相対リンクは、GitHub と同じ行き先に開きます。",
              "シンボリックリンクは「→ リンク先」付きで出て、押すとリンク先に移ります。",
              "フォルダの一覧には、最終コミット日時とローカル更新日時が並び、それぞれで並べ替えられます。",
              "大きいファイルは、軽い表示に自動で切り替わります。",
            ),
          ],
        },
      ],
    },
    "read-diffs": {
      title: "差分を読む",
      intro:
        "作業中の変更を、ファイルごとの差分で読めます。何も指定しなければ、HEAD と作業ツリーを比べます。",
      groups: [
        {
          title: "開く",
          blocks: [
            {
              kind: "list",
              items: [
                ["一覧の列の上の ", ui(app.diff), " の絵柄を押します。"],
                "変更ファイルの一覧で押すと、そのファイルの差分に移ります。",
                [
                  "差分のカードの ",
                  ui(l.diff.viewFile),
                  " でファイル全体を出し、",
                  ui(l.diff.viewDiff),
                  " で戻ります。",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "diff-screen",
                "差分の画面。変更ファイルの一覧と、1 つのファイルの差分。",
              ),
            },
          ],
        },
        {
          title: "見やすくする",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  ui(app.split),
                  " で左右に並べ、",
                  ui(app.unified),
                  " で 1 列にします。",
                ],
                [
                  ui(app.ignoreWs),
                  " で空白だけの違いを隠し、",
                  ui(app.hideTests),
                  " でテストのファイルを隠します。",
                ],
              ],
            },
          ],
        },
        {
          title: "比べるものを変える",
          blocks: [
            {
              kind: "paragraph",
              text: "起動するときに、git diff と同じ引数を渡せます。",
            },
            {
              kind: "command",
              command: "code-viewer HEAD~1 HEAD\ncode-viewer --staged",
            },
            {
              kind: "paragraph",
              text: [
                "コミットどうしを比べるなら、",
                ui(app.history),
                " の画面が使えます。",
              ],
            },
            w.see("search"),
          ],
        },
      ],
    },
    search: {
      title: "検索と履歴",
      intro: "ファイル名・コードの中身・コミットの履歴を探せます。",
      groups: [
        {
          title: "探す",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  key("⌘K"),
                  " でファイル名を、",
                  key("⌘G"),
                  " でコードの中身を探します（Windows と Linux は Ctrl）。",
                ],
                [
                  "左のサイドバーの ",
                  ui(l.agents.sidebar.search),
                  " からも同じ窓が開きます。",
                ],
                [
                  "結果を残しておきたいときは ",
                  ui(l.search.pinResults),
                  " を押すと、",
                  ui(l.agents.sidebar.search),
                  " のタブに移ります。",
                ],
                "関数や変数を ⌘/Ctrl+クリックすると、その定義に移ります。",
              ],
            },
            {
              kind: "figure",
              figure: fig("search-palette", "コードの検索の窓で探した結果。"),
            },
          ],
        },
        {
          title: "履歴を見る",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  ui(app.history),
                  " の画面でコミットを選ぶと、その変更が出ます。",
                ],
                [
                  "上の欄で絞り込めます（",
                  code("author:名前"),
                  "・",
                  code("path:フォルダ"),
                  "・",
                  code("since:日付"),
                  " など）。",
                ],
                "2 つ目のコミットを Shift+クリックすると、その間の変更をまとめて出します。",
                [
                  "ファイルの ",
                  ui(l.source.tabHistory),
                  " のタブには、そのファイルを変えたコミットだけが出ます。",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "history-screen",
                "履歴の画面でコミットを 1 つ選んだところ。",
              ),
            },
            more(
              [
                "コードの検索は、正規表現・大文字と小文字の区別・単語単位を切り替えられます。検索語に ",
                code("path:フォルダ"),
                " を入れると範囲を絞れます。",
              ],
              [
                "履歴の絞り込みは、ほかに ",
                code("code:文字列"),
                "（足した・消した行）と ",
                code("merges:no"),
                " / ",
                code("merges:only"),
                " が使えます。",
              ],
              "マージコミットでは、比べる親を選べます。",
              "ソースの行を選ぶと、その行の履歴（git log -L）を開けます。",
            ),
          ],
        },
      ],
    },
    worktrees: {
      title: "作業ツリー",
      intro:
        "エージェントを作業ツリーごとに動かしているとき、全部の作業ツリーの変更を 1 つの画面で見比べられます。",
      groups: [
        {
          title: "見る",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  ui(app.worktree),
                  " の画面の左で作業ツリーを選ぶと、変更ファイルと差分が出ます。",
                ],
                "各行に、基準のブランチから進んだ・遅れたコミットの数と、そのままマージできるかが出ます。",
                "上の帯には、2 つ以上の作業ツリーが同時に変えているファイルが出ます。",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "worktrees-screen",
                "作業ツリーの画面。作業ツリーごとの行と、選んだ作業ツリーの差分。",
              ),
            },
          ],
        },
        {
          title: "作る・消す",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  ui(l.worktree.add),
                  " を押してフォルダ名を入れると、",
                  code(".worktrees/"),
                  " の下に作業ツリーを作ります。",
                ],
                [
                  "行の … から ",
                  ui(l.worktree.remove),
                  " を選ぶと、フォルダを消します。ブランチとコミットは残ります。",
                ],
                [
                  code(".worktrees/"),
                  " を .gitignore に足しておくと、未追跡のファイルとして出ません。",
                ],
              ],
            },
            more(
              "基準のブランチは origin/HEAD の指す先です。無ければ main、次に master を使います。",
              "マージできるかを確かめられなかった行は、「確かめられなかった」と出ます。マージできるという意味ではありません。",
              "行の … からは、その作業ツリーを別のタブの code-viewer で開いたり、マージのコマンドをコピーしたりできます。",
              "コミットしていない変更がある作業ツリーは、チェックを入れないと削除できません。",
            ),
          ],
        },
      ],
    },
    "start-agent": {
      title: "エージェントを起動する",
      intro:
        "エージェントは、tmux のウィンドウで動く claude か codex です。プロジェクトとアカウントを選んで起動します。",
      groups: [
        {
          title: "左のサイドバーから",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  text: [
                    "左のサイドバーの下の ",
                    ui(l.agents.sidebar.newAgent),
                    " を押します。",
                  ],
                  figures: [
                    fig(
                      "agent-new",
                      `左のサイドバーの下端の［${l.agents.sidebar.newAgent}］。`,
                    ),
                  ],
                },
                {
                  text: [
                    ui(accounts.launchKind),
                    "・",
                    ui(accounts.launchAccount),
                    "・",
                    ui(accounts.launchProject),
                    " を選び、",
                    ui(accounts.launchRun),
                    " を押します。",
                  ],
                  figures: [
                    fig(
                      "agent-launch",
                      `${l.agents.sidebar.newAgent}の画面。${accounts.launchKind}・${accounts.launchAccount}・${accounts.launchProject}を選び、下の［${accounts.launchRun}］で起動します。`,
                    ),
                  ],
                },
              ],
            },
          ],
        },
        {
          title: "タブのグループから",
          blocks: [
            {
              kind: "paragraph",
              text: [
                "タブのグループの ▾ から ",
                ui(l.mainTabs.newAgentHere),
                " を選ぶと、そのプロジェクトを選んだ状態で同じ画面が開きます。",
              ],
            },
          ],
        },
        {
          title: "アカウントの選び方",
          blocks: [
            {
              kind: "list",
              items: [
                "起動の画面には、アカウントごとに 5 時間と 1 週間の使用量と、いつの値かが並びます。",
                "ログインしていないアカウントも選べます。そのときは、エージェントがログインを求めます。",
                "前に選んだものが、次の既定になります。",
              ],
            },
            w.see("add-account"),
          ],
        },
        {
          title: "起動するコマンドを変える",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  settings,
                  " → ",
                  ui(cat.accounts.label),
                  " の ",
                  ui(accounts.commandsTitle),
                  " で変え、ページの下の ",
                  ui(l.settings.save),
                  " で保存します。",
                ],
                "起動の画面には、実行するコマンドがそのまま出ます。",
              ],
            },
            more(
              "起動コマンドは、ふだん使っているシェルで動きます。シェルの関数も使えます。",
              [ui(accounts.commandsReset), " で、最初のコマンドに戻せます。"],
            ),
          ],
        },
      ],
    },
    "agent-state": {
      title: "エージェントの様子を見る",
      intro:
        "動いているエージェントは、どの画面でも左のサイドバーに並び、いまの状態が出ます。",
      groups: [
        {
          title: "状態",
          blocks: [
            {
              kind: "table",
              head: ["表示", "意味"],
              rows: [
                [
                  ui(l.agents.state.waiting),
                  "あなたの返事や許可を待っています",
                ],
                [ui(l.agents.state.working), "作業しています"],
                [ui(l.agents.state.done), "作業が終わり、まだ開いていません"],
                [ui(l.agents.state.idle), "何もしていません"],
              ],
            },
            w.see("agent-hooks"),
          ],
        },
        {
          title: "開く・のぞく",
          blocks: [
            {
              kind: "list",
              items: [
                "エージェントを押すと、そのペインがターミナルのタブで開き、そのまま返事を打てます。",
                "エージェントにポインタを少し置くと、画面の最後の数行が出ます。",
                "最下段の右の数は、入力待ちと作業中のエージェントの数です。押すと一覧に移ります。",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "agent-running",
                "起動した後の画面。左のサイドバーの sample-app の下にエージェントが並び、右にそのターミナルのタブが開いています。",
              ),
            },
          ],
        },
        {
          title: l.agents.board.allAgents,
          blocks: [
            {
              kind: "list",
              items: [
                [
                  ui(l.agents.board.allAgents),
                  "（",
                  key("g a"),
                  "）は、このマシンの tmux で動くエージェントを全部並べます。",
                ],
                "各プロジェクトの中は入力待ちが先頭なので、上から順に片付けられます。",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "agents-board",
                `${l.agents.board.allAgents}の画面。`,
              ),
            },
            more(
              "別のプロジェクトのエージェントを開くと、そのプロジェクトに移ってから開きます。",
              "各行の 2 行目には、種類・状態・その状態になってからの時間・作業ツリー・アカウントが出ます。",
              [
                ui(l.agents.allPanes),
                " にすると、エージェントのいないシェルも出ます。",
              ],
              "状態が読めなかったペインは、画面の「問題」に理由と一緒に出ます。",
            ),
          ],
        },
      ],
    },
    notifications: {
      title: "通知を受け取る",
      intro:
        "エージェントが入力待ちになったとき・作業を終えたときに、デスクトップに通知を出せます。",
      groups: [
        {
          title: "有効にする",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  text: [
                    ui(l.agents.board.allAgents),
                    " の画面で ",
                    ui(l.agents.notifyEnable),
                    " を押します。",
                  ],
                  figures: [
                    fig(
                      "notify-enable",
                      `${l.agents.board.allAgents}の画面の［${l.agents.notifyEnable}］。`,
                    ),
                  ],
                },
                "ブラウザが許可を求めるので、許可します。",
              ],
            },
            {
              kind: "paragraph",
              text: "最初に入力待ちが出たときにサイドバーに出る案内からも、同じように有効にできます。",
            },
          ],
        },
        {
          title: "何で通知するか",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  settings,
                  " → ",
                  ui(cat.agents.label),
                  " で、入力待ちと作業の終わりのそれぞれについて、通知するかを選べます。",
                ],
                "いま前面のタブで見ているエージェントは、通知しません。",
              ],
            },
          ],
        },
        {
          title: "通知が出ないとき",
          blocks: [
            {
              kind: "list",
              items: [
                "ブロックしたときは、アドレスバーの左のアイコンからこのサイトの通知を許可し、読み込み直します。",
                "別の機械から http で開いた画面では、ブラウザが通知を出せません（https か localhost が要ります）。",
              ],
            },
          ],
        },
      ],
    },
    "agent-hooks": {
      title: "エージェントの状態を正しく出す（フックを入れる）",
      intro:
        "フックを入れると、claude と codex が自分で「作業中・入力待ち・完了」を code-viewer に知らせます。入れないと、状態は画面の見た目からの推測だけになり、エージェントの表示が変わると外れます。",
      groups: [
        {
          title: "入れ方",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  text: [
                    settings,
                    " → ",
                    ui(cat.agents.label),
                    " を開き、",
                    ui(hooks.title),
                    " の節を見ます。",
                  ],
                  figures: [
                    fig(
                      "hooks-section",
                      `設定の［${hooks.title}］の節。claude が［${hooks.state.none}］、codex が［${hooks.state.installed}］です。`,
                    ),
                  ],
                },
                {
                  text: [
                    "claude か codex の行の ",
                    ui(hooks.action.install),
                    " を押します。",
                  ],
                },
                {
                  text: [
                    "確認の画面で、書き込むファイルと足す中身を見てから ",
                    ui(hooks.run.install),
                    " を押します。",
                  ],
                  figures: [
                    fig(
                      "hooks-dialog",
                      "フックを入れる前の確認の画面。書き込むファイル・足すもの・残るフックの数が出ています。",
                    ),
                  ],
                },
                {
                  text: [
                    "codex だけは、codex の中で ",
                    code("/hooks"),
                    " を開き、code-viewer のフックを信頼します。信頼するまで動きません。",
                  ],
                },
              ],
            },
            {
              kind: "paragraph",
              text: [
                "行が ",
                ui(hooks.state.installed),
                " になれば入っています。",
              ],
            },
          ],
        },
        {
          title: "状態の決め方",
          blocks: [
            {
              kind: "paragraph",
              text: "3 つの手掛かりを、上ほど強いものとして使います。",
            },
            {
              kind: "table",
              head: ["手掛かり", "何を見るか"],
              rows: [
                ["フック", "エージェント自身の知らせ。いちばん確か"],
                [
                  "画面の文言のルール",
                  "入力欄や作業中の表示など、画面に出ている文字",
                ],
                ["画面の動き", "画面が動き続けているか、止まったか"],
              ],
            },
            {
              kind: "paragraph",
              text: [
                ui(l.agents.state.done),
                " は、フックが「終わった」と知らせたものか、作業中から待機に変わってまだ開いていないものです。",
              ],
            },
            more(
              "ファイルにあるほかのフックは消さず、順番も変えません。書く前の中身はバックアップに残します。",
              [
                "行に ",
                ui(hooks.state.broken),
                " と出たら、",
                ui(hooks.action.repair),
                " を押します。",
              ],
              [
                "設定ファイルを dotfiles などから作っているときは、",
                ui(hooks.action["guide-install"]),
                " でフックをコピーし、元のファイルに足します。",
              ],
              [
                "外すときは、同じ行の ",
                ui(hooks.action.uninstall),
                " を押します。",
              ],
              [
                "画面の文言のルールは ",
                settings,
                " → ",
                ui(cat.advanced.label),
                " にあります。フックが無いときや、表示が変わって判定が外れたときに直すもので、普段は触りません。",
              ],
            ),
          ],
        },
      ],
    },
    "add-account": {
      title: "アカウントを追加する",
      intro:
        "アカウントは、claude か codex の設定ディレクトリ 1 つです。仕事用と個人用を分けたいとき、別の契約でログインしたいときに足します。",
      groups: [
        {
          title: "画面で追加する",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  text: [
                    settings,
                    " → ",
                    ui(cat.accounts.label),
                    " を開きます。",
                  ],
                  figures: [
                    fig(
                      "accounts-list",
                      `${l.agents.sidebar.settings} › ${cat.accounts.label}。アカウントごとの行にログインの状態が出て、一覧の下に［${accounts.add}］があります。`,
                    ),
                  ],
                },
                {
                  text: [
                    ui(accounts.add),
                    " を押し、",
                    ui(accounts.addKind),
                    " と ",
                    ui(accounts.addName),
                    " を決めます。",
                  ],
                  figures: [
                    fig(
                      "accounts-add",
                      `追加の画面。${accounts.addKind}に claude、${accounts.addName}に Personal を入れ、［${accounts.addModeCreate}］を選んでいます。`,
                    ),
                  ],
                },
                {
                  text: [
                    ui(accounts.addModeCreate),
                    " か ",
                    ui(accounts.addModeRegister),
                    " を選びます。",
                  ],
                },
                {
                  text: [
                    ui(accounts.addNext),
                    " で作るものを確かめ、",
                    ui(accounts.createRun),
                    " か ",
                    ui(accounts.registerRun),
                    " を押します。",
                  ],
                  figures: [
                    fig(
                      "accounts-review",
                      `作る前の確認。新しい設定ディレクトリと、既定のディレクトリからリンクする設定が並び、下に［${accounts.createRun}］があります。`,
                    ),
                  ],
                },
                {
                  text: [
                    "増えた行の ",
                    ui(accounts.loginButton),
                    " を押し、開いたブラウザで許可します。",
                  ],
                  figures: [
                    fig(
                      "accounts-sign-in",
                      `一覧に増えた行と、その行の［${accounts.loginButton}］。`,
                    ),
                  ],
                },
                {
                  text: [
                    "行が ",
                    ui(accounts.login["logged-in"]),
                    " になれば終わりです。",
                  ],
                  figures: [
                    fig(
                      "accounts-signed-in",
                      `ログインを終えた行。「${accounts.login["logged-in"]}」とメールアドレスが出ています。`,
                    ),
                  ],
                },
              ],
            },
            {
              kind: "note",
              note: "warning",
              paragraphs: [
                "同じサービスの 2 つ目のアカウントは、許可する前にブラウザのログインを切り替えます。切り替えないと、いまログインしているアカウントで許可されます。",
              ],
            },
            w.accountsSettings(),
          ],
        },
        {
          title: "使用量を見る",
          blocks: [
            {
              kind: "list",
              items: [
                "アカウントを足すと、エージェントの一覧の上に、アカウントごとの使用量が出ます。",
                [
                  "claude の使用量は、",
                  ui(accounts.usageTitle),
                  " の ",
                  ui(accounts.statusLineInstall),
                  " を押すと集め始めます。",
                ],
              ],
            },
            more("codex の使用量は、設定しなくても出ます。"),
          ],
        },
        {
          title: "別のアカウントで続ける",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "エージェントの行（サイドバー・",
                  l.agents.board.allAgents,
                  "）かそのタブを右クリックし、",
                  ui(l.agents.handoff),
                  " を選びます。",
                ],
                [
                  "アカウントを選んで ",
                  ui(accounts.handoffRun),
                  " を押すと、そのアカウントのエージェントが同じ tmux のセッションで起動します。",
                ],
                "起動したエージェントは、前のエージェントの会話記録を読んで続きをやり、わからないことは始める前に聞きます。",
              ],
            },
            {
              kind: "note",
              note: "info",
              paragraphs: [
                "この項目はフックを入れると使えます。入れた後、そのエージェントに一度話しかけてください。",
              ],
            },
            w.see("agent-hooks"),
            more(
              "前のエージェントは止まりません。code-viewer は会話記録の中身を読みません。",
              [
                ui(accounts.addModeCreate),
                " のアカウントは、既定の設定ディレクトリの設定・スキル・コマンドなどをリンクで共有します。ログインの情報と履歴は共有しません。",
              ],
              "code-viewer はログインの情報を受け取らず、トークンも読みません。",
              [
                ui(accounts.rename),
                "・",
                ui(accounts.remove),
                " は、足したアカウントにだけ出ます。",
                ui(accounts.remove),
                " は一覧から外すだけで、ディレクトリは消しません。",
              ],
            ),
          ],
        },
      ],
    },
    terminal: {
      title: "ターミナル",
      intro:
        "タブでシェルを開けます。エージェントのペインもタブで開き、そのまま返事を打てます。",
      groups: [
        {
          title: "開く",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "タブ列の ＋ を押し、",
                  ui(l.terminal.newShell),
                  " か、並んでいるセッションを選びます（",
                  key("Ctrl+`"),
                  "）。",
                ],
                "サイドバーでエージェントを押しても、そのペインがターミナルのタブで開きます。",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "terminal-tab",
                "ターミナルのタブと、タブ列の ＋ のメニュー。",
              ),
            },
          ],
        },
        {
          title: "閉じる・止める",
          blocks: [
            {
              kind: "list",
              items: [
                "タブを閉じても、シェルやエージェントは止まりません。＋ から開き直せます。",
                [
                  "止めるときは、タブを右クリックして ",
                  ui(l.mainTabs.stopSession),
                  " を選びます。",
                ],
              ],
            },
          ],
        },
        {
          title: "便利な使い方",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "見るだけにしたいときは、タブの右クリックで ",
                  ui(l.terminal.readOnly),
                  " にします。",
                ],
                "エージェントが書き出した画像は右の棚に並び、押すと画像のタブで開きます。",
                [
                  "棚の画像は出たペインごとにまとまり、カーソルを載せるとそのペインが枠で囲まれ、棚の見出しにパスが出ます。右クリックの ",
                  ui(l.terminal.imageShowInTerminal),
                  " でその行まで戻れます。",
                ],
                "棚は見出しの ⋯ で右・左・下・上へ移せ、端末の側の縁をドラッグして大きさを変えられます。",
                "画像を貼り付ける (⌘V / Ctrl+V) とエージェントに渡せます。プロジェクトの .code-viewer/pasted/pasted-image-<日付>-<時刻>.png に保存され (git には入りません)、そのパスが送信せずに入力され、棚にも出ます。",
                "画面の URL・ファイルのパス・画像のパスは、カーソルを載せると開く・コピーの帯が出て、押すと開きます。tmux のマウスが有効なときも ⌘/Ctrl を押しながらなら開けます。",
                [
                  "ターミナルの中は、画面がライトでもダークで描きます。変えるときは ",
                  settings,
                  " → ",
                  ui(cat.appearance.label),
                  " の ",
                  ui(l.settings.terminalTone),
                  " で選びます。",
                ],
              ],
            },
            more(
              [
                "画面に合わせて明るくして読みにくい色が残るときは、エージェントの側の配色もライト向けに替えてください (claude なら ",
                code("/theme"),
                ")。",
              ],
              "tmux のペインを開くと、tmux のセッション 1 つにつきシェル 1 本で開きます。",
              [
                "同じ tmux のセッションを別の端末でも開くと、小さいほうの端末で右と下が切れます。tmux の ",
                code("window-size smallest"),
                " を設定すると、どちらでも全体が見えます。",
              ],
              "powerline の記号やファイルのアイコンは、ブラウザの動く機械に Nerd Font があれば出ます。",
              [
                "シェルを開けないときは、",
                ui(l.doctor.title),
                " の Terminal の行を見てください。",
              ],
            ),
          ],
        },
      ],
    },
    "tabs-layout": {
      title: "タブと画面の配置",
      intro:
        "開いたファイルと画面はタブに並び、プロジェクトごとのグループにまとまります。左右 2 面に分けて、並べて読めます。",
      groups: [
        {
          title: "タブ",
          blocks: [
            {
              kind: "list",
              items: [
                "1 回押して開いたファイルは斜体の仮のタブで、次のファイルに置き換わります。",
                "中ボタンか ⌘/Ctrl+クリックで開くと、置き換わらないタブで開きます。",
                "タブを右クリックすると、閉じる・ほかを閉じる・パスをコピーなどが選べます。",
              ],
            },
          ],
        },
        {
          title: "グループ",
          blocks: [
            {
              kind: "list",
              items: [
                "グループの頭の色の札を押すと、そのグループを畳めます。",
                [
                  "札の ▾ から、",
                  ui(l.mainTabs.newShellHere),
                  "・",
                  ui(l.mainTabs.newAgentHere),
                  "・",
                  ui(l.mainTabs.closeGroup),
                  " を選べます。",
                ],
                "▾ の差分・履歴などの行は、左の縦の列と同じ画面を、そのプロジェクトのタブとして開きます (別のプロジェクトなら、そのプロジェクトに切り替えてから)。",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "tabs-groups",
                "2 つのプロジェクトのタブのグループと、札の ▾ のメニュー。",
              ),
            },
          ],
        },
        {
          title: "左右に分ける",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "タブ列の右端の分割のボタンか、タブの ",
                  ui(l.mainTabs.splitRight),
                  " で左右 2 面になります。",
                ],
                "右の面に置けるのは、ファイル・ターミナル・画像です。",
                [
                  "タブをドラッグするか ",
                  ui(l.mainTabs.moveToOtherSide),
                  " で、別の面へ移せます。",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "tabs-split",
                "左右 2 面。左にファイル、右にターミナル。",
              ),
            },
          ],
        },
        {
          title: "列を畳む",
          blocks: [
            {
              kind: "list",
              items: [
                "ファイル一覧は、一覧の列の上のボタンで畳めます。",
                "窓が狭いと、一覧の列が細くなり、それでも足りなければ畳まれます。",
              ],
            },
            w.keys(),
            more(
              [
                ui(app.diff),
                "・",
                ui(app.history),
                "・",
                ui(app.worktree),
                " などの画面は、プロジェクトごとに 1 つずつのタブです。",
              ],
              "ファイルはタブではありません。タブを選んでいないときに出るのがフォルダの表示です。",
              "窓を 2 つ開いていても、タブの並びは両方で同じになります。",
            ),
          ],
        },
      ],
    },
    "install-app": {
      title: "アプリとして入れる",
      intro:
        "Chrome でアプリとして入れると、code-viewer が専用の窓で開きます。",
      groups: [
        {
          title: "入れ方",
          blocks: [
            {
              kind: "install",
              button: "code-viewer をインストール",
              steps: [
                "Chrome のアドレスバーの右端のインストールのアイコンを押します。",
                "次からは、Dock かスタートメニューから開きます（先に code-viewer を起動しておきます）。",
              ],
            },
          ],
        },
        {
          title: "窓で変わること",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  key("⌘W"),
                  "（",
                  key("Ctrl+W"),
                  "）で、窓ではなく前面のタブを閉じます。",
                ],
                [
                  key("⌘T"),
                  " などのブラウザのタブのキーも、code-viewer のタブに効きます。",
                ],
              ],
            },
            w.keys(),
          ],
        },
      ],
    },
    phone: {
      title: "SP で使う",
      intro:
        "幅の狭い画面では、エージェントへの返事・差分とファイルを読む・プロジェクトの切り替えの 3 つに絞った形になります。",
      groups: [
        {
          title: "できること",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "下端の帯から、",
                  ui(l.mobile.projects),
                  "・",
                  ui(l.mobile.files),
                  "・",
                  ui(l.mobile.diff),
                  "・",
                  ui(l.mobile.agents),
                  "・",
                  ui(l.mobile.list),
                  " を開きます。",
                ],
                [
                  ui(l.mobile.agents),
                  " には、入力待ちのエージェントの数が出ます。",
                ],
                "ターミナルのタブの下に、Esc・Tab・Ctrl+C など、ソフトキーボードに無いキーが出ます。",
                "長押しすると、右クリックのメニューが出ます。",
                "左右 2 面にはできません。広い窓で開くと、元の 2 面に戻ります。",
                "通知は、https か同じ機械の localhost で開いたときだけ出ます。",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "phone-screen",
                "SP の画面。下端に画面を切り替える帯があります。",
              ),
            },
            more(
              [
                "差分は 1 列が既定で、差分の帯の端の ",
                ui(l.mobile.wrap),
                " で長い行を折り返します。",
              ],
              "ターミナルの上で 2 本の指を広げる・狭めると、文字の大きさが変わります。",
            ),
          ],
        },
      ],
    },
    datastores: {
      title: "データストアを見る",
      intro:
        "リポジトリの SQLite や、docker compose で動かしているデータベースの中身を、ブラウザで見て直せます。",
      groups: [
        {
          title: "見られるもの",
          blocks: [
            {
              kind: "list",
              items: [
                "SQLite・MySQL・PostgreSQL・Redis・Elasticsearch・DynamoDB・S3 互換（MinIO・R2 など）・Cloudflare D1 です。",
                "リポジトリの中の .db ファイルと、compose のファイルに書いたサービスは、自動で見つけます。",
                [
                  "ほかは、データストアの選択の横の ",
                  ui(l.database.nav.addConnection),
                  " で足します。",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig("datastore-grid", "SQLite のテーブルの行の一覧。"),
            },
          ],
        },
        {
          title: "読む・直す",
          blocks: [
            {
              kind: "list",
              items: [
                "テーブルを選ぶと行が並び、上の SQL の欄で問い合わせもできます。",
                [
                  ui(l.database.edit.editMode),
                  " にすると、セルを直して、まとめて書き込めます。",
                ],
                "外部キーのセルを押すと、関係する行をたどれます。",
              ],
            },
          ],
        },
        {
          title: "前後を比べる",
          blocks: [
            {
              kind: "paragraph",
              text: [
                ui(l.database.nav.snapshot),
                " で今の中身を取っておくと、2 つの時点で増えた・変わった・消えた行を比べられます。",
              ],
            },
            more(
              "接続のパスワードなどはリポジトリに書きません。macOS ではキーチェーンに残し、ほかでは起動し直すと入れ直しになります。",
              "Cloudflare D1 と DynamoDB は読むだけです。",
              [
                ui(l.database.nav.er),
                " で ER 図、",
                ui(l.database.nav.search),
                " で全部のテーブルを横断して探せます。",
              ],
            ),
          ],
        },
      ],
    },
    tools: {
      title: "貼り付けたテキストを試す（ツール）",
      intro: [
        ui(app.tools),
        " のタブで、貼り付けた Markdown・Mermaid・JSON・YAML を、その場で表示したり整えたりできます。",
      ],
      groups: [
        {
          title: "使い方",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "タブ列の ＋ のメニューか、パレット（",
                  key(app.paletteKey),
                  "）から ",
                  ui(app.tools),
                  " を開きます。",
                ],
                "Markdown は、ファイルのプレビューと同じ見た目で出ます。",
                "Mermaid の図は、拡大とドラッグで動かして見られます。",
                "JSON と YAML は、どちらを貼っても読み、整えた JSON か YAML で出します。形式の誤りも分かります。",
                "貼ったものは残るので、開き直すと続きから使えます。",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "tools-markdown",
                "ツールのタブで Markdown を表示したところ。",
              ),
            },
          ],
        },
      ],
    },
    annotations: {
      title: "AI にコードを説明させる（注釈）",
      intro:
        "AI エージェントに頼むと、コードの行に説明を付けて、順に案内してくれます。説明は注釈のパネルに並びます。",
      groups: [
        {
          title: "頼み方",
          blocks: [
            {
              kind: "steps",
              items: [
                "code-viewer を起動したままにします。",
                "AI に「annotate を使って、このシステムのいちばん難しいところを案内して」のように頼みます。",
                "注釈のパネルを開き、説明を順に読みます。",
              ],
            },
            {
              kind: "note",
              note: "info",
              paragraphs: [
                "先にスキルを入れておくと、AI が注釈のコマンドの使い方を知っています。",
              ],
            },
            w.see("ask-ai"),
            {
              kind: "figure",
              figure: fig(
                "annotations-panel",
                "注釈のパネルと、コードの下に出た説明。",
              ),
            },
          ],
        },
        {
          title: "パネルでできること",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "行を選んで ",
                  ui(l.annotations.add),
                  " を押すと、自分でも説明を書けます。",
                ],
                "新しい説明が来たときに、その場所へ自動で移るようにできます。",
                "再生のボタンで、説明を読み上げます。",
              ],
            },
            more(
              [
                "注釈はリポジトリの ",
                code(".code-viewer/annotations.json"),
                " に残り、読み込み直しても消えません。",
              ],
              [
                "AI が使うコマンドの全部は、",
                code("code-viewer annotate agent-help"),
                " で出ます。",
              ],
              "各注釈のコピーのボタンで、その注釈を指す文を AI に渡せます。",
            ),
          ],
        },
      ],
    },
    "ask-ai": {
      title: "AI に任せる（スキル）",
      intro:
        "同梱のスキルを入れると、AI エージェントが code-viewer のコマンドを知り、ふつうの言葉で頼めるようになります。",
      groups: [
        {
          title: "入れる",
          blocks: [
            {
              kind: "command",
              title: "このプロジェクトの claude に入れる",
              command: "code-viewer skill install",
            },
            {
              kind: "command",
              title:
                "入れるエージェントを選ぶ（claude・codex・gemini・cursor・agents、または all）",
              command: "code-viewer skill install --agent claude,codex",
            },
            {
              kind: "command",
              title: "ホームディレクトリに入れて、どのプロジェクトでも使う",
              command: "code-viewer skill install --agent all --global",
            },
            {
              kind: "figure",
              figure: fig(
                "skill-install",
                "ターミナルのタブで code-viewer skill install --agent claude,codex を実行したところ。入れたスキルが 1 行ずつ出ます。",
              ),
            },
          ],
        },
        {
          title: "頼めること",
          blocks: [
            {
              kind: "table",
              head: ["スキル", "頼めること"],
              rows: [
                [
                  code("code-viewer-accounts"),
                  "claude・codex のアカウントを追加する・ログインする・名前を変える・外す",
                ],
                [
                  code("code-viewer-annotate"),
                  "コードの行に説明を付けて、順に案内する",
                ],
                [
                  code("code-viewer-journal"),
                  "ワークログのタスクを作る・進める",
                ],
                [
                  code("code-viewer-query"),
                  "データベースを、読むだけの問い合わせで調べる",
                ],
                [
                  code("code-viewer-snapshot"),
                  "データのスナップショットを取り、前後を比べる",
                ],
              ],
            },
            more(
              [
                "アカウントのスキルは ",
                code("code-viewer accounts"),
                " を使います。ログインの許可だけは、あなたがブラウザで行います。",
              ],
              [
                code("code-viewer accounts"),
                " の使い方の全部は、",
                code("code-viewer accounts --help"),
                " で出ます。",
              ],
            ),
          ],
        },
      ],
    },
    "ai-cli-mcp": {
      title: "AI 向けの CLI と MCP",
      intro:
        "AI エージェントは、画面を使わずに、CLI か MCP で code-viewer を使えます。",
      groups: [
        {
          title: "CLI",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  code("code-viewer query"),
                  " で、データベースへの読むだけの問い合わせ・テーブルを横断した検索・スナップショットの比較ができます。",
                ],
                "結果は画面の問い合わせの履歴にも残るので、あとで画面で見直せます。",
                "使い方の全部は、次のコマンドで出ます。",
              ],
            },
            {
              kind: "command",
              command:
                "code-viewer query agent-help\ncode-viewer annotate agent-help\ncode-viewer journal agent-help",
            },
          ],
        },
        {
          title: "MCP",
          blocks: [
            {
              kind: "list",
              items: [
                "code-viewer が動いている間、読むだけの MCP のサーバとして使えます。",
                [
                  "起動したときに出る URL のポートで、",
                  code("http://127.0.0.1:<port>/_mcp"),
                  " に繋ぎます。",
                ],
                "ファイル・検索・git の履歴・データストアを読む道具が使えます。",
              ],
            },
            more(
              "MCP は Streamable HTTP の JSON-RPC 2.0 で、同じ機械からの接続だけを受けます。",
              [
                "使える道具の一覧は、MCP の ",
                code("tools/list"),
                " で出ます。",
              ],
            ),
          ],
        },
      ],
    },
    "project-files": {
      title: "code-viewer が保存するもの",
      intro: [
        "リポジトリごとの状態は、リポジトリの直下の ",
        code(".code-viewer/"),
        " に保存します。",
      ],
      groups: [
        {
          title: ".code-viewer/",
          blocks: [
            {
              kind: "list",
              items: [
                "開いたフォルダ・データストアのタブ・注釈・問い合わせの履歴・スナップショットなどが入ります。",
                [
                  "ふだんは ",
                  code(".gitignore"),
                  " に ",
                  code(".code-viewer/"),
                  " を足します。",
                ],
                [
                  "注釈を人と共有したいときは、",
                  code("annotations.json"),
                  " だけをコミットします。",
                ],
                "フォルダごと消すと、そのリポジトリの状態を全部やり直せます。",
              ],
            },
            {
              kind: "note",
              note: "warning",
              paragraphs: [
                "中のファイルは code-viewer が書き直すので、手で直さないでください。",
              ],
            },
          ],
        },
      ],
    },
    doctor: {
      title: "困ったとき",
      intro: [
        "うまく動かないときは、",
        ui(l.doctor.title),
        " が、足りないものと直し方を出します。",
      ],
      groups: [
        {
          title: "開く",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "最下段の右の ",
                  ui(l.doctor.title),
                  " のアイコンを押すと、右から開きます。",
                ],
                [
                  "端末では ",
                  code("code-viewer doctor"),
                  " で同じ内容が出ます。",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "doctor-sheet",
                `${l.doctor.title}を開いたところ。項目ごとに OK・WARN と直し方が出ます。`,
              ),
            },
          ],
        },
        {
          title: "よくあること",
          blocks: [
            {
              kind: "table",
              head: ["困りごと", "すること"],
              rows: [
                [
                  "エージェントが一覧に出ない",
                  "tmux を入れ、tmux の中でエージェントを動かします",
                ],
                ["状態が違って出る", "フックを入れます"],
                [
                  "SQLite が開けない",
                  [
                    code("rm -rf ~/.npm/_npx"),
                    " の後、",
                    code("npx -y @youtyan/code-viewer@latest"),
                    " で起動し直します",
                  ],
                ],
                [
                  "入れ直した後、プロジェクトが開かない",
                  ["起動した端末で ", key("Ctrl+C"), " で止め、打ち直します"],
                ],
              ],
            },
            w.see("agent-hooks"),
            more(
              [
                code("code-viewer doctor --json"),
                " は、AI や CI 向けに全部の結果を JSON で出します。エラーがあると終了コードが 1 になります。",
              ],
              [
                "git・tmux などが PATH に無いときは、",
                code("--bin tmux=/絶対パス"),
                " のように場所を渡せます。",
              ],
            ),
          ],
        },
      ],
    },
    keybindings: {
      title: "キーボードショートカット",
      intro: [
        "いま割り当てているキーの一覧です。どの画面でも ",
        key("?"),
        " を押すと、よく使うキーを小さな窓で出せます。",
      ],
      lead: [
        {
          kind: "figure",
          figure: fig(
            "quick-help",
            "キーボードショートカットの小窓。キーとその操作が並び、下に設定と全部の一覧へのリンクがあります。",
          ),
        },
      ],
      // キーの一覧は割り当てから組んで help-page.ts が足す。
      groups: [],
    },
  };
}
