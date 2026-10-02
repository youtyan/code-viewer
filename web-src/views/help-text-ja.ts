// ヘルプの本文 (日本語)。節の並びと名前は help-guides.ts、英語は help-text-en.ts。
// 画面のボタン名は { ui } で、値は各画面の i18n から (w.l)。1 段落は 120 文字・
// 見出しごとの本文は 600 文字まで (help-text-length.test.ts)。

import type { HelpText } from "./help-blocks";
import type { HelpTexts, HelpWriter } from "./help-guides";
import { helpFigure } from "./help-images";
import type { HelpBlock } from "./help-page";

const fig = (name: string, alt: string) => helpFigure("ja", name, alt);
const ui = (label: string) => ({ ui: label });
const code = (text: string) => ({ code: text });
const key = (text: string) => ({ key: text });
const more = (...items: HelpText[]): HelpBlock => ({
  kind: "subsection",
  blocks: [{ kind: "list", items }],
});

// ai-dup-check: allow -- ok:英日の本文は同じ節と部品の並びを別の言語の文で持つ (help-text-en.ts と対)
export function helpTextJa(w: HelpWriter): HelpTexts {
  const { l } = w;
  const settings = ui(l.agents.sidebar.settings);
  const cat = l.settings.categories;
  const hooks = l.agents.hooks;
  const accounts = l.agents.accounts;
  const remote = l.remote;
  const app = l.app;
  return {
    "getting-started": {
      title: "導入手順",
      intro:
        "code-viewer は、リポジトリをブラウザで読み、AI エージェントを動かして見守る道具です。上から順にやれば使い始められます（Node.js 22.14 以上と git が要ります）。",
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
                "ページ全体を読み直さずに切り替わります。タブ・ターミナル・未読の印はそのまま残ります。",
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
                "C はマージで衝突しているファイルです。",
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
              text: "画面の上の 2 つの ref を変えます（初めは HEAD → worktree）。どちらも worktree・HEAD・--staged を選べ、ブランチ・タグ・コミットも並びます。",
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
          title: "プロジェクトのメニューから",
          blocks: [
            {
              kind: "paragraph",
              text: [
                "左のプロジェクトの ＋ か、タブのグループの ▾ から ",
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
                    "確認の画面で、書き込むファイルと、変わる所の差分（足す行は緑・消す行は赤）を見てから ",
                    ui(hooks.run.install),
                    " を押します。",
                  ],
                  figures: [
                    fig(
                      "hooks-dialog",
                      "フックを入れる前の確認の画面。書き込むファイルと、書く前と後の差分が出ています。",
                    ),
                  ],
                },
                {
                  text: [
                    "codex だけは、入れた後に出る ",
                    ui(hooks.openAgent.codex),
                    " で開いたタブの ",
                    code("/hooks"),
                    " で、code-viewer のフックを信頼します。信頼するまで動きません。",
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
                    "作り終えた画面の ",
                    ui(accounts.createdSignIn),
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
                [ui(accounts.usageRefreshAll), " で今の使用量を取得します。"],
              ],
            },
            more(
              "code-viewer のページを開いている間は、5 分おきに自動更新します。",
              "Claude・Codex とも、使用量の取得ではモデルにメッセージを送らず、トークンを消費しません。",
              [
                "claude のカードの ",
                ui(accounts.usageEnable),
                " は任意です。有効にすると、作業中に届く使用量も表示に反映します。",
              ],
              [
                "カードに値が無い・古いときは、",
                ui(accounts.usageCheck),
                " でそのアカウントだけ更新できます。失敗した場合は、エラーの詳細をコピーできます。",
              ],
            ),
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
                "直前に隠れた2つのターミナル画面は接続を保ち、戻ったときに出力を読み直しません。それより前の画面は、開いたときに接続し直します。",
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
                "ターミナルにパスが出た画像は右の棚に並び、押すと画像のタブで開きます。",
                [
                  "棚の画像は出たペインごとにまとまり、カーソルを載せるとそのペインが枠で囲まれ、棚の見出しにパスが出ます。右クリックの ",
                  ui(l.terminal.imageShowInTerminal),
                  " でその行まで戻れます。",
                ],
                "棚は見出しの ⋯ で右・左・下・上へ移せ、端末の側の縁をドラッグして大きさを変えられます。",
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
              "画像を貼り付ける (⌘V / Ctrl+V) とエージェントに渡せます。プロジェクトの .code-viewer/pasted/ に日時の名前で保存し (git には入りません)、そのパスを送信せずに入力します。",
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
              "ターミナルを押すか入力すると、その画面の幅と高さに合わせます。スマホで操作すればスマホ幅、PCに戻って操作すればPC幅になります。",
              "開いたまま操作していない画面はサイズを変えません。同じペインの画面サイズは共有されます。",
              "powerline の記号やファイルのアイコンは、ブラウザの動く機械に Nerd Font があれば出ます。",
              [
                "シェルを開けないときは、",
                ui(l.terminal.newShell),
                " を押すと、入れ直すコマンド（コピーできます）が出ます。",
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
      title: "スマホでの操作",
      intro:
        "接続後にスマホでできる操作を説明します。エージェントへの返事、差分・ファイルの閲覧、プロジェクトの切り替えができます。",
      lead: [w.see("remote-access")],
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
                "タブの列には前面のタブだけが出ます。右端の数字の四角で、開いているタブを全部見られます。",
                "履歴を開くと、コミットの一覧が出ます。1 つのコミットを 2 行で出すので、件名が全部読めます。",
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
                "スマホの画面。下端に画面を切り替える帯があります。",
              ),
            },
            more(
              [
                "差分は 1 列で、長い行は折り返して出します。差分の帯の端の ",
                ui(l.mobile.wrap),
                " を外すと、横に送って読めます。",
              ],
              "ターミナルの上で 2 本の指を広げる・狭めると、文字の大きさが変わります。",
            ),
          ],
        },
        {
          title: "エージェントを開く",
          blocks: [
            {
              kind: "list",
              items: [
                "エージェントや、tmux のペインを映すタブを開くと、そのペインだけが全画面で開きます。tmux のウインドウを分割していても、ほかのペインは出ません。",
                "PC の画面の大きさや分割は変えません。",
                [
                  "長い行や、エージェントが PC のペインの幅で改行した文は、スマホの幅で折り返して出します。",
                  ui(l.terminal.paneView.screen),
                  " は PC のペインの桁で折り返して小さな字で出し、全画面のアプリ (vim など) は端末そのままで出します。",
                ],
                "選択肢が出ていると、番号のボタンが出ます。押すとその番号を送ります。",
                [
                  "下の欄に書いて ",
                  ui(l.terminal.paneView.send),
                  " を押すと、貼り付けて Enter まで送ります。空のまま押すと Enter だけを送ります。",
                ],
                "上端までスクロールすると、前の出力を 3,000 行まで読めます。エージェントの作業中の印の行や入力欄の罫線は、前の出力からは外します。",
                "欄の左の画像のボタンで、写真やスクショを添付できます。ターミナルに貼った画像と同じ場所に保存し、そのパスを欄に入れます。",
                "戻る (左上の ‹ かブラウザの戻る) で、開いた場所 (引き出しや ＋ のメニュー) に戻ります。",
              ],
            },
          ],
        },
      ],
    },
    "remote-access": {
      title: "外出先から接続する",
      intro:
        "外出先からMacのcode-viewerを開くための接続設定です。Macで設定し、最後にスマホで確認します。",
      groups: [
        {
          title: "使うCloudflareのサービス",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  {
                    link: "Cloudflare Tunnel",
                    href: "https://developers.cloudflare.com/tunnel/",
                  },
                  "：公開URLからMacのcode-viewerへ接続します。Freeプランで無料です。",
                ],
                [
                  {
                    link: "Cloudflare Access",
                    href: "https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/",
                  },
                  "：ログインを求め、許可した自分のメールだけが使えます。Freeプランは50ユーザーまで無料です。",
                ],
                [
                  {
                    link: "Cloudflare DNS",
                    href: "https://developers.cloudflare.com/dns/",
                  },
                  "：DNSレコードを管理し、公開URLをTunnelに結び付けます。Freeプランで無料です。",
                ],
              ],
            },
            {
              kind: "paragraph",
              text: "自分1人で使うこの手順では、Cloudflareのサービスは無料プランで使えます。ドメインの取得・更新料金は別途かかり、購入先や種類で変わります。",
            },
            {
              kind: "paragraph",
              text: [
                "料金の確認：",
                {
                  link: "Zero Trustの料金",
                  href: "https://www.cloudflare.com/plans/zero-trust-services/",
                },
                "・",
                {
                  link: "DNSの料金",
                  href: "https://developers.cloudflare.com/dns/faq/",
                },
                "・",
                {
                  link: "ドメインの取得・更新",
                  href: "https://www.cloudflare.com/products/registrar/",
                },
                "（2026年10月1日確認）。",
              ],
            },
            {
              kind: "paragraph",
              text: "Accessは「Zero Trust」、Tunnelはアカウント画面の「ネットワーク」→「Tunnels」で設定します。Macの接続ソフトcloudflaredは、code-viewerが起動・停止します。",
            },
            {
              kind: "paragraph",
              text: "接続経路：スマホ → Access → Tunnel → Mac。キャプチャは説明用の値を入力した実画面です。",
            },
            {
              kind: "paragraph",
              text: "設定済みなら「開始・停止」へ。初回は1〜8を順に進めます。",
            },
          ],
        },
        {
          title: "始める前に用意するもの",
          blocks: [
            {
              kind: "list",
              items: [
                "code-viewerが動くMac、Cloudflareのアカウント、自分のドメイン（DNSはCloudflareで管理）が必要です。",
                "viewer.example.com は説明用です。自分のドメインに置き換えてください。",
                "Macはインターネットにつなぎ、起動したままにします。",
              ],
            },
          ],
        },
        {
          title: "初回設定 — 上から順に進める",
          blocks: [
            {
              kind: "subsection",
              title: "1. スマホで開くURLを決める",
              blocks: [
                {
                  kind: "paragraph",
                  text: "Cloudflareの管理画面をMacのブラウザで開きます。「ドメイン」で自分のドメインが「アクティブ」になっていることを確認してください。",
                },
                {
                  kind: "paragraph",
                  text: "自分のドメインが example.com なら、未使用の viewer.example.com を接続先にできます。viewer の部分は好きな名前に変えられます。",
                },
                {
                  kind: "table",
                  head: ["この手順での呼び方", "入力例"],
                  rows: [
                    ["ドメイン", "example.com"],
                    ["サブドメイン", "viewer"],
                    ["ホスト名", "viewer.example.com"],
                    ["公開URL", "https://viewer.example.com"],
                  ],
                },
                {
                  kind: "paragraph",
                  text: "ドメインがまだない場合は、先に取得してCloudflareへ追加します。ネームサーバーを変更した直後は、接続先が反映されるまで時間がかかる場合があります。",
                },
              ],
            },
            {
              kind: "subsection",
              title: "2. 自分だけがログインできるようにする（Cloudflare）",
              blocks: [
                {
                  kind: "steps",
                  items: [
                    {
                      title: "Zero Trustを開く",
                      text: "Cloudflareで「Zero Trust」を開き、チーム名とFreeプランを選びます。支払い情報を求められても、Freeプランでは請求されません。",
                    },
                    {
                      title: "セルフホストのアプリを追加する",
                      text: "左メニューの「Access コントロール」→「アプリケーション」で「新規アプリケーションを作成」を押します。「セルフホストとプライベートで続行」を選びます。",
                    },
                    {
                      title: "宛先に、手順1のホスト名を入れる",
                      text: "「サブドメイン」に viewer、「ドメイン」に自分のドメインを選び、パスは空欄にします。「カスタム入力に切り替える」なら viewer.example.com を1つの欄に入力できます。",
                      figures: [
                        fig(
                          "remote-access-hostname",
                          "Accessの宛先。カスタム入力で公開ホスト名を指定した例。",
                        ),
                      ],
                    },
                    {
                      title: "自分のメールだけを許可する",
                      text: "「Accessポリシー」で「新しいポリシーを作成」を押します。「含める」を「メール」にし、自分のメールを入力してEnterで確定します。",
                      figures: [
                        fig(
                          "remote-access-policy",
                          "許可ポリシーの「含める」ルール。メールを選び、自分のアドレスをEnterで確定します。",
                        ),
                      ],
                    },
                    {
                      title: "ポリシーを保存してアプリに戻る",
                      text: "「ポリシー名」は code-viewer-owner、「アクション」は「許可」にします。「ポリシーを保存」を押し、アプリにこのポリシーが付いたことを確認します。",
                    },
                    {
                      title: "アプリの名前とログイン方法を確認する",
                      text: "下の「詳細」で「名前」を code-viewer、「セッション期間」を6時間にします。「認証」では、許可したメールで使えるログイン方法を選びます。",
                    },
                    {
                      title: "「作成」を押す",
                      text: "アプリを作成します。一覧に code-viewer が表示され、code-viewer-owner が付いていれば完了です。",
                    },
                  ],
                },
                {
                  kind: "paragraph",
                  text: "「Everyone／全員」や「Bypass／バイパス」は選びません。例の user@example.com は自分のメールに置き換えます。",
                },
              ],
            },
            {
              kind: "subsection",
              title: "3. 設定に使う2つの値をコピーする（Cloudflare）",
              blocks: [
                {
                  kind: "steps",
                  items: [
                    {
                      title: "Team domainを控える",
                      text: "Zero Trustの左下「設定」→「チーム名とドメイン」を開きます。your-team.cloudflareaccess.com のようなドメインを控えます。",
                    },
                    {
                      title: "アプリのAUDをコピーする",
                      text: "「Access コントロール」→「アプリケーション」で code-viewer を開きます。「追加設定」の「アプリケーション オーディエンス（AUD）タグ」で「コピー」を押します。",
                    },
                    {
                      title: "2つの値を手順4で使う",
                      text: "Team domainは https:// を付けずに、AUDは64文字すべてを使います。アプリIDやTunnelのトークンはここでは使いません。",
                    },
                  ],
                },
              ],
            },
            {
              kind: "subsection",
              title: "4. code-viewerの設定に値を入れる（Mac）",
              blocks: [
                {
                  kind: "steps",
                  items: [
                    {
                      title: [settings, " → ", ui(cat.remote.label), " を開く"],
                      text: "code-viewerを --standalone なしで起動し、Macのブラウザで設定を開きます。",
                    },
                    {
                      title: "値を入れて保存する",
                      text: [
                        "下の表のとおりに入れ、ページの下の ",
                        ui(l.settings.save),
                        " を押します。",
                      ],
                    },
                  ],
                },
                {
                  kind: "table",
                  head: ["欄", "入れるもの"],
                  rows: [
                    [
                      ui(remote.originLabel),
                      "スマホで開く https:// から始まるURL。末尾に / を付けない",
                    ],
                    [
                      ui(remote.teamDomainLabel),
                      "手順3で控えた値。https:// は付けない",
                    ],
                    [ui(remote.audienceLabel), "手順3でコピーした64文字のAUD"],
                    [
                      ui(remote.portLabel),
                      "64161 のまま（通常の表示用ポートとは別）",
                    ],
                  ],
                },
                {
                  kind: "paragraph",
                  text: "値はプロジェクトの外に、自分だけが読めるファイルとして保存されます。保存先は節の下に出ます。",
                },
              ],
            },
            {
              kind: "subsection",
              title: "5. Tunnelを作り、トークンを貼る",
              blocks: [
                {
                  kind: "steps",
                  items: [
                    {
                      title: "新しいTunnelを作る（Cloudflare）",
                      text: "アカウント画面の「ネットワーク」→「Tunnels」で「トンネル作成」を押します。種類を選ぶ場合は cloudflared、名前は code-viewer にします。",
                    },
                    {
                      title: [
                        "接続用ソフトを入れる（Mac）：",
                        ui(remote.install),
                      ],
                      text: "cloudflaredが無くHomebrewがあるとき、外部接続の節にこのボタンが出ます。Homebrewが無いときは、Tunnelの画面のmacOSの手順で入れます。",
                    },
                  ],
                },
                {
                  kind: "paragraph",
                  text: [
                    "Tunnel画面の接続コマンド（cloudflared service install …）をコピーし、",
                    ui(remote.tokenLabel),
                    " にそのまま貼って ",
                    ui(l.settings.save),
                    " を押します。",
                  ],
                },
                {
                  kind: "paragraph",
                  text: "トークンだけが自分しか読めないファイルに保存され、画面には二度と出ません。接続コマンドそのものはMacで実行しません。",
                },
                {
                  kind: "paragraph",
                  text: "既存の別Tunnelがある場合も、この名前の新しいTunnelを使います。一時URLを作るQuick Tunnelは、ターミナル出力の通信に対応しないため使いません。",
                },
              ],
            },
            {
              kind: "subsection",
              title: "6. 外部接続を開始する（Mac）",
              blocks: [
                {
                  kind: "paragraph",
                  text: [
                    ui(cat.remote.label),
                    " の ",
                    ui(remote.start),
                    " を押します。code-viewerが待ち受けを開き、cloudflaredを起動します。",
                  ],
                },
                {
                  kind: "paragraph",
                  text: [
                    ui(remote.rowListener),
                    " が ",
                    ui(remote.listenerRunning),
                    "、",
                    ui(remote.rowTunnel),
                    " が ",
                    ui(remote.tunnelConnected(4)),
                    " になり、CloudflareのTunnel画面が「正常／Healthy」になれば接続できています。",
                  ],
                },
              ],
            },
            {
              kind: "subsection",
              title: "7-1. 公開URLのルートを追加する（Cloudflare）",
              blocks: [
                {
                  kind: "paragraph",
                  text: "作ったTunnelを開き、「ルートを追加」→「公開アプリケーション」を選びます。次の値を入力し、まだ保存せずに追加設定へ進みます。",
                },
                {
                  kind: "figure",
                  figure: fig(
                    "remote-tunnel-route",
                    "Tunnelの公開アプリケーション。サブドメインとサービスURLの入力例。ドメインは自分のものを選びます。",
                  ),
                },
                {
                  kind: "table",
                  head: ["入力欄", "入力例"],
                  rows: [
                    ["サブドメイン", "viewer"],
                    ["ドメイン", "example.com"],
                    ["パス", "空欄"],
                    ["サービスURL", "http://127.0.0.1:64161"],
                  ],
                },
                {
                  kind: "paragraph",
                  text: "種類とURLが別々の欄の場合は、種類をHTTP、URLを127.0.0.1:64161にします。このアドレスはスマホで開くURLではなく、Mac上の接続先です。",
                },
              ],
            },
            {
              kind: "subsection",
              title: "7-2. 接続先をAccessで保護する",
              blocks: [
                {
                  kind: "paragraph",
                  text: "「追加アプリケーション設定」で「HTTP」と「Access」を開きます。下の4項目を設定してから「ルートを追加」を押し、一覧にホスト名が出ることを確認します。",
                },
                {
                  kind: "figure",
                  figure: fig(
                    "remote-tunnel-options",
                    "追加アプリケーション設定のAccess欄。Protect with Accessをオンにした例。Team nameとAUDは自分の値に置き換えます。",
                  ),
                },
                {
                  kind: "table",
                  head: ["追加設定", "入力する値"],
                  rows: [
                    [
                      "HTTP → HTTP Host ヘッダー",
                      "viewer.example.com（https:// は付けない）",
                    ],
                    ["Access → Protect with Access", "オン"],
                    [
                      "Access → Team name",
                      "your-team（.cloudflareaccess.com より前だけ）",
                    ],
                    [
                      "Access → Application Audience (AUD) tag",
                      "手順3のAUDを貼り付け、Enterで確定",
                    ],
                  ],
                },
              ],
            },
            {
              kind: "subsection",
              title: "7-3. キャッシュを無効にする",
              blocks: [
                {
                  kind: "paragraph",
                  text: "続いてアカウントの「ドメイン」から自分のドメインを開き、「ルール」でCache Ruleを作ります。この公開ホスト名だけを対象にします。",
                },
                {
                  kind: "table",
                  head: ["キャッシュルール", "設定"],
                  rows: [
                    ["ルール名", "code-viewer-no-cache"],
                    [
                      "一致条件",
                      'カスタム式: (http.host eq "viewer.example.com")',
                    ],
                    ["キャッシュの適格性", "キャッシュをバイパスする"],
                    ["ブラウザTTL", "設定を追加し、キャッシュをバイパスする"],
                  ],
                },
                {
                  kind: "paragraph",
                  text: "「デプロイ」で有効にします。これで、操作画面やファイルの内容がキャッシュに残らない設定になります。",
                },
              ],
            },
            {
              kind: "subsection",
              title: "8. スマホでログインし、操作を確かめる",
              blocks: [
                {
                  kind: "steps",
                  items: [
                    {
                      title: "公開URLを開く",
                      text: "スマホのSafariやChromeで https://viewer.example.com を開きます。Cloudflareのログイン画面が出たら、手順2で許可したメールのアカウントでログインします。",
                    },
                    {
                      title: "Macと同じ内容が見えるか確認する",
                      text: "プロジェクトを選び、ファイルや差分を開きます。エージェントの出力が更新されるかも確認してください。",
                    },
                    {
                      title: "ログイン前には見えないことを確認する",
                      text: "プライベートブラウズでも同じURLを開き、code-viewerの画面ではなくログイン画面が出ることを確認します。別のメールは許可されない設定にします。",
                    },
                  ],
                },
                {
                  kind: "paragraph",
                  text: "スマホへcode-viewerやcloudflaredをインストールする必要はありません。使い方は「スマホでの操作」を参照してください。",
                },
                w.see("phone"),
              ],
            },
          ],
        },
        {
          title: "開始・停止",
          blocks: [
            {
              kind: "paragraph",
              text: [
                "初回設定が済めば、",
                settings,
                " → ",
                ui(cat.remote.label),
                " で ",
                ui(remote.start),
                " と ",
                ui(remote.stop),
                " を押すだけです。Cloudflareの設定を毎回作り直す必要はありません。",
              ],
            },
            {
              kind: "list",
              items: [
                [
                  ui(remote.autoStart),
                  " をオンにすると、code-viewerを起動するたびに開始します。",
                ],
                [
                  ui(remote.stop),
                  " はスマホからの接続だけを止め、Macのcode-viewerはそのまま使えます。code-viewerを止めるとcloudflaredも止まります。",
                ],
                "開始・停止と値の変更は、Macの画面でだけ行えます。スマホから開いた設定では操作できません。",
                "cloudflaredをサービスとして別に動かしているなら、トークンを保存せずに開始します（待ち受けだけを開きます）。",
                "Macがスリープ中・電源オフ・オフラインの間は接続できません。スマホの画面を閉じるだけなら、Mac側のエージェントの作業は続きます。",
              ],
            },
            more([
              "以前の起動方法 ",
              code("code-viewer --remote-access <file>"),
              " も使えます。値はそのファイルから読みますが、トークンは状態フォルダに保存するので、設定で一度貼ってください。",
            ]),
          ],
        },
        {
          title: "つながらないとき",
          blocks: [
            {
              kind: "subsection",
              title: "URLが開かない／Wi-Fiによって結果が違う",
              blocks: [
                {
                  kind: "list",
                  items: [
                    "まずURLの綴りを確認し、スマホのWi-Fiを切って携帯回線で開きます。携帯回線だけで開く場合は、自宅側に古いDNS情報が残っている可能性があります。",
                    "Cloudflareのドメインがアクティブか、Tunnelの公開ルートにホスト名があるかを確認します。変更直後はDNSの反映を待ってから試してください。",
                  ],
                },
              ],
            },
            {
              kind: "subsection",
              title: "ログインできない／401・403が出る",
              blocks: [
                {
                  kind: "list",
                  items: [
                    "ログイン画面で拒否される場合は、許可ポリシーのメールと実際にログインしたメールを照合します。メールの入力後にEnterで確定して保存したかも確認してください。",
                    [
                      "ログイン後も401なら、",
                      ui(cat.remote.label),
                      " の ",
                      ui(remote.teamDomainLabel),
                      "・",
                      ui(remote.audienceLabel),
                      " と、TunnelのTeam name・AUDを確認します。Macでcode-viewerを起動したターミナルのエラー全文も確認してください。",
                    ],
                    [
                      "403なら、",
                      ui(remote.originLabel),
                      " とTunnelのHTTP Host Headerが同じホスト名かを確認します。認証が必要な設定をオフにして解決しようとしないでください。",
                    ],
                  ],
                },
              ],
            },
            {
              kind: "subsection",
              title: "502／Tunnelが非アクティブ／接続先が見つからない",
              blocks: [
                {
                  kind: "list",
                  items: [
                    [
                      "Tunnelが非アクティブなら、",
                      ui(cat.remote.label),
                      " の ",
                      ui(remote.rowTunnel),
                      " の行と、その下のcloudflaredの出力を確認します。別のTunnelのトークンを保存していないかも確認してください。",
                    ],
                    [
                      "Tunnelが正常でも502なら、",
                      ui(remote.rowListener),
                      " が ",
                      ui(remote.listenerRunning),
                      " か確認します。サービスURLのポートと ",
                      ui(remote.portLabel),
                      " をそろえてください。",
                    ],
                    "開始している間に値を保存すると、すぐ新しい値で開き直します。通常の表示用ポートをサービスURLに指定しても、スマホ用の認証付き接続にはなりません。",
                  ],
                },
              ],
            },
            {
              kind: "subsection",
              title: "途中で切れる／入力が送れない",
              blocks: [
                {
                  kind: "list",
                  items: [
                    "ログイン期限が切れた場合は画面を開き直してログインします。スマホのロック解除や回線切替の後も、再接続が終わるまで待ってください。",
                    "失敗した入力は自動で送り直しません。Mac側の出力を確認してから、必要な操作だけをもう一度行ってください。",
                  ],
                },
              ],
            },
            {
              kind: "subsection",
              title: "公式の説明を開く",
              blocks: [
                {
                  kind: "list",
                  items: [
                    [
                      {
                        link: "Cloudflare Access",
                        href: "https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/",
                      },
                    ],
                    [
                      {
                        link: "Cloudflare Tunnel",
                        href: "https://developers.cloudflare.com/tunnel/get-started/",
                      },
                    ],
                    [
                      {
                        link: "HTTP Host Header / Protect with Access",
                        href: "https://developers.cloudflare.com/tunnel/reference/origin-parameters/",
                      },
                    ],
                    [
                      {
                        link: "Cache Rules",
                        href: "https://developers.cloudflare.com/cache/how-to/cache-rules/",
                      },
                    ],
                  ],
                },
              ],
            },
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
                "外部キーのセルを押すと、下に関係する行が出ます。左の一覧は「参照している」と「参照されている」に分かれ、件数も出ます。",
                [
                  "セルをドラッグして範囲を選び、",
                  key("⌘C"),
                  " でコピーすると Excel にそのまま貼れます。",
                  key("Shift"),
                  " も押すと列名つきです。",
                ],
                "NULL は塗りの札、空文字は点線の枠の札で出ます。",
              ],
            },
          ],
        },
        {
          title: "最近の変化を見る",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "テーブルは新しい行から並びます。表の上の ",
                  ui(l.database.grid.newestLabel),
                  " を押すと、元の順に戻ります。",
                ],
                [
                  "行番号の右の ",
                  ui(l.database.grid.recencyHeader),
                  " に、行が足された（＋）・変わった（鉛筆）のが何分前かが出ます。created_at・updated_at などの列から読みます。",
                ],
                "再読み込みすると、前回から新しく出た行・変わった行に色の印が付きます。",
                "表の上のタイムゾーンの欄で、日時の列を別のタイムゾーンで表示できます (tokyo・+9 などで探せます)。書き出しは元の値のままです。",
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
                "code-viewer が動いている間、MCP のサーバとしても使えます。",
                [
                  "起動したときに出るプロジェクトの URL の後ろに ",
                  code("_mcp"),
                  " を付けた ",
                  code("http://127.0.0.1:<port>/p/<key>/_mcp"),
                  " に繋ぎます。",
                ],
                "ファイル・検索・git の履歴・データストア・ターミナルを読む道具が使えます。",
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
                  "注釈を人と共有したいときは、代わりに ",
                  code(".code-viewer/*"),
                  " と ",
                  code("!.code-viewer/annotations.json"),
                  " を ",
                  code(".gitignore"),
                  " に書き、",
                  code("annotations.json"),
                  " をコミットします。",
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
                  "claude や codex を上げてから動きがおかしい",
                  "doctor の Agent CLIs に、手元の版と code-viewer が確かめた版が並びます",
                ],
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
