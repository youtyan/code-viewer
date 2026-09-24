// ヘルプの「やり方」の節: アカウントを追加する・エージェントを起動する・
// プロジェクトを追加する・AI に任せる。ボタンや画面の名前は、その画面の i18n の
// 値から組み立てる (文字を写さない。画面の文言を変えれば案内も変わる)。

import { agentsText } from "./agents/i18n";
import type { HelpBlock, HelpLanguage, HelpSectionContent } from "./help-page";
import { mainTabsText } from "./main-tabs/i18n";

export const GUIDE_SECTIONS = [
  "add-account",
  "start-agent",
  "add-project",
  "ask-ai",
] as const;
export type GuideSection = (typeof GUIDE_SECTIONS)[number];

/** 案内の名前 (左の列と見出し)。設定のページのリンクもこれを使う。 */
export const GUIDE_NAMES: Record<HelpLanguage, Record<GuideSection, string>> = {
  en: {
    "add-account": "Add an account",
    "start-agent": "Start an agent",
    "add-project": "Add a project",
    "ask-ai": "Let AI do it",
  },
  ja: {
    "add-account": "アカウントを追加する",
    "start-agent": "エージェントを起動する",
    "add-project": "プロジェクトを追加する",
    "ask-ai": "AI に任せる",
  },
};

/** 案内に出す、画面の名前とボタンの文言 (guideLabels が各画面の i18n から集める)。 */
export type GuideLabels = {
  /** 左下の入口とページの名前。 */
  settings: string;
  /** 設定の分類「アカウント」。 */
  accounts: string;
  /** 設定のアカウントの節: 追加の画面とボタン。 */
  add: string;
  addKind: string;
  addName: string;
  addModeCreate: string;
  addModeRegister: string;
  addNext: string;
  createRun: string;
  registerRun: string;
  login: string;
  signedIn: string;
  /** 左下の「新しいエージェント」と、その画面。 */
  newAgent: string;
  launchKind: string;
  launchAccount: string;
  launchProject: string;
  launchRun: string;
  /** タブのグループの ▾ の項目。 */
  groupNewAgent: string;
  /** 左のサイドバーの見出しと、その横の ＋ の名前。 */
  projects: string;
  addProject: string;
  addProjectSubmit: string;
  /** パレット (⌘K) の項目。 */
  addProjectMenu: string;
  /** パレットを開くキー (いまの割り当て)。 */
  paletteKey: string;
};

/**
 * 案内に出す名前を、それぞれの画面の i18n から集める。設定の分類の名前と
 * パレットのキー (利用者の割り当て) は app が持つので受け取る。
 */
export function guideLabels(
  lang: HelpLanguage,
  fromApp: { accounts: string; paletteKey: string },
): GuideLabels {
  const agents = agentsText(lang);
  const accounts = agents.accounts;
  return {
    settings: agents.sidebar.settings,
    accounts: fromApp.accounts,
    add: accounts.add,
    addKind: accounts.addKind,
    addName: accounts.addName,
    addModeCreate: accounts.addModeCreate,
    addModeRegister: accounts.addModeRegister,
    addNext: accounts.addNext,
    createRun: accounts.createRun,
    registerRun: accounts.registerRun,
    login: accounts.loginButton,
    signedIn: accounts.login["logged-in"],
    newAgent: agents.sidebar.newAgent,
    launchKind: accounts.launchKind,
    launchAccount: accounts.launchAccount,
    launchProject: accounts.launchProject,
    launchRun: accounts.launchRun,
    groupNewAgent: mainTabsText(lang).newAgentHere,
    projects: agents.sidebar.projects,
    addProject: agents.projects.addProject,
    addProjectSubmit: agents.projects.addProjectSubmit,
    addProjectMenu: agents.projects.addProjectMenu,
    paletteKey: fromApp.paletteKey,
  };
}

/** 案内の中のリンクが開く先 (app が配線する)。 */
export type GuideActions = {
  openAccountsSettings(): void;
};

type GuideSectionContent = HelpSectionContent;

export function guideContent(
  lang: HelpLanguage,
  l: GuideLabels,
  actions: GuideActions,
): Record<GuideSection, GuideSectionContent> {
  const accountsLink = (text: {
    before: string;
    after: string;
  }): HelpBlock => ({
    kind: "link",
    before: text.before,
    label: `${l.settings} › ${l.accounts}`,
    after: text.after,
    href: "/settings",
    open: actions.openAccountsSettings,
  });
  if (lang === "ja")
    return {
      "add-account": {
        nav: GUIDE_NAMES.ja["add-account"],
        title: GUIDE_NAMES.ja["add-account"],
        intro:
          "アカウントは claude か codex の設定ディレクトリ 1 つです。既定のもの (~/.claude・~/.codex) はいつも並んでいます。別の契約でログインしたいとき、仕事用と個人用を分けたいときに足します。",
        groups: [
          {
            title: "画面で追加する",
            blocks: [
              {
                kind: "steps",
                items: [
                  `${l.settings} → ${l.accounts} を開きます。`,
                  `［${l.add}］を押し、${l.addKind}と${l.addName}を決めて、［${l.addModeCreate}］(code-viewer が新しい設定ディレクトリを作り、既定のディレクトリの設定を共有します) か［${l.addModeRegister}］(持っているディレクトリをそのまま登録します) を選びます。`,
                  `［${l.addNext}］で作るもの・リンクするものを確かめ、［${l.createRun}］か［${l.registerRun}］を押します。`,
                  `増えた行の［${l.login}］を押します。tmux の新しいウィンドウに公式のログイン (claude auth login・codex login) が開くので、ブラウザで許可します。code-viewer は認証情報を受け取りません。`,
                  `終わると、その行が「${l.signedIn}」になり、ログインしたメールアドレスが出ます。`,
                ],
              },
              {
                kind: "paragraph",
                text: "同じサービスで 2 つ目のアカウントを作るときは、許可する前に、ブラウザでログインしているアカウントを切り替えてください (別のブラウザのプロファイルで開いてもかまいません)。切り替えないと、すでにログインしているアカウントで許可されます。",
              },
              accountsLink({ before: "", after: " を開く" }),
            ],
          },
        ],
      },
      "start-agent": {
        nav: GUIDE_NAMES.ja["start-agent"],
        title: GUIDE_NAMES.ja["start-agent"],
        intro:
          "エージェントは tmux のウィンドウで動く claude か codex です。プロジェクトとアカウントを選んで起動します。tmux が要ります。",
        groups: [
          {
            title: "左のサイドバーから",
            blocks: [
              {
                kind: "steps",
                items: [
                  `左のサイドバーの下端の［${l.newAgent}］を押します。`,
                  `${l.launchKind}・${l.launchAccount}・${l.launchProject}を選び、［${l.launchRun}］を押します。`,
                ],
              },
            ],
          },
          {
            title: "タブのグループから",
            blocks: [
              {
                kind: "paragraph",
                text: `プロジェクトのタブのグループの ▾ を開き、「${l.groupNewAgent}」を選びます。そのプロジェクトを選んだ状態で同じ画面が開きます。`,
              },
            ],
          },
          {
            title: "アカウントの選び方",
            blocks: [
              {
                kind: "paragraph",
                text: `${l.launchAccount}には、その種類のアカウント (${l.settings} → ${l.accounts} に並んでいるもの) が出ます。ログインしていないアカウントも選べ、そのときはエージェントがログインを求めます。前に選んだものが次の既定になります。`,
              },
            ],
          },
        ],
      },
      "add-project": {
        nav: GUIDE_NAMES.ja["add-project"],
        title: GUIDE_NAMES.ja["add-project"],
        intro: `プロジェクトは左のサイドバーの「${l.projects}」に並ぶ git のリポジトリです。code-viewer を起動したリポジトリは自動で加わります。`,
        groups: [
          {
            title: "足し方",
            blocks: [
              {
                kind: "steps",
                items: [
                  `左のサイドバーの「${l.projects}」の横の ＋ (${l.addProject}) を押し、リポジトリのフォルダまでたどって［${l.addProjectSubmit}］を押します。`,
                  `${l.paletteKey} で開くパレットの「${l.addProjectMenu}」からも同じ画面を開けます。`,
                  "別のリポジトリの中で code-viewer を実行しても加わります。",
                ],
              },
            ],
          },
        ],
      },
      "ask-ai": {
        nav: GUIDE_NAMES.ja["ask-ai"],
        title: GUIDE_NAMES.ja["ask-ai"],
        intro:
          "同梱のスキルを入れると、AI エージェントが code-viewer のコマンドを知り、ふつうの言葉で頼めるようになります (「claude のアカウントをもう 1 つ追加して」など)。",
        groups: [
          {
            title: "スキルを入れる",
            blocks: [
              {
                kind: "command",
                title: "このプロジェクトの claude に入れる",
                command: "code-viewer skill install",
              },
              {
                kind: "command",
                title:
                  "入れるエージェントを選ぶ (claude・codex・gemini・cursor・agents、または all)",
                command: "code-viewer skill install --agent claude,codex",
              },
              {
                kind: "command",
                title: "ホームディレクトリに入れ、どのプロジェクトでも使う",
                command: "code-viewer skill install --agent all --global",
              },
            ],
          },
          {
            title: "頼めること",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "code-viewer-accounts",
                    "claude・codex のアカウントを追加する・ログインする・名前を変える・外す",
                  ],
                  [
                    "code-viewer-annotate",
                    "コードの行に説明を付けて、順に読んで見せる",
                  ],
                  ["code-viewer-journal", "Work Log のタスクを作る・進める"],
                  [
                    "code-viewer-query",
                    "データベースを読むだけのクエリで調べる",
                  ],
                  [
                    "code-viewer-snapshot",
                    "データのスナップショットを取り、前後を比べる",
                  ],
                ],
              },
            ],
          },
          {
            title: "アカウントのコマンド (code-viewer accounts)",
            blocks: [
              {
                kind: "table",
                rows: [
                  ["list", "アカウントとログインの状態の一覧"],
                  [
                    "plan",
                    "create で作る設定ディレクトリとリンクするものを見る",
                  ],
                  ["create", "新しい設定ディレクトリを作って登録する"],
                  ["register", "すでにある設定ディレクトリを登録する"],
                  ["login", "tmux の新しいウィンドウで公式のログインを開く"],
                  ["wait", "ログインが終わるまで待つ"],
                  ["rename", "表示名を変える"],
                  ["remove", "一覧から外す (設定ディレクトリは消さない)"],
                ],
              },
            ],
          },
        ],
      },
    };
  return {
    "add-account": {
      nav: GUIDE_NAMES.en["add-account"],
      title: GUIDE_NAMES.en["add-account"],
      intro:
        "An account is one claude or codex settings directory. The default ones (~/.claude, ~/.codex) are always listed; add more to sign in to another plan or to keep work and personal use apart.",
      groups: [
        {
          title: "Add one in the app",
          blocks: [
            {
              kind: "steps",
              items: [
                `Open ${l.settings} → ${l.accounts}.`,
                `Select ${l.add}, choose the ${l.addKind} and a ${l.addName}, then pick ${l.addModeCreate} (code-viewer makes a new settings directory that shares your settings from the default one) or ${l.addModeRegister} (registers a directory you already have, as it is).`,
                `Select ${l.addNext}, check what will be made and linked, then select ${l.createRun} or ${l.registerRun}.`,
                `On the new row, select ${l.login}. The official sign-in (claude auth login / codex login) opens in a new tmux window; approve it in your browser. code-viewer never receives the credentials.`,
                `When it is done, the row shows ${l.signedIn} and the email it signed in with.`,
              ],
            },
            {
              kind: "paragraph",
              text: "For a second account of the same service, switch the account your browser is signed in to before you approve (or open the sign-in in another browser profile). Otherwise the approval goes to the account that is already signed in.",
            },
            accountsLink({ before: "Open ", after: "" }),
          ],
        },
      ],
    },
    "start-agent": {
      nav: GUIDE_NAMES.en["start-agent"],
      title: GUIDE_NAMES.en["start-agent"],
      intro:
        "An agent is claude or codex running in a tmux window, started for a project with the account you choose. tmux must be installed.",
      groups: [
        {
          title: "From the left sidebar",
          blocks: [
            {
              kind: "steps",
              items: [
                `Select ${l.newAgent} at the bottom of the left sidebar.`,
                `Choose the ${l.launchKind}, the ${l.launchAccount} and the ${l.launchProject}, then select ${l.launchRun}.`,
              ],
            },
          ],
        },
        {
          title: "From a tab group",
          blocks: [
            {
              kind: "paragraph",
              text: `Open ▾ on a project's tab group and select ${l.groupNewAgent}. The same dialog opens with that project chosen.`,
            },
          ],
        },
        {
          title: "Choosing the account",
          blocks: [
            {
              kind: "paragraph",
              text: `${l.launchAccount} lists the accounts of that agent (the ones in ${l.settings} → ${l.accounts}). An account that is not signed in can be chosen too; the agent then asks you to sign in. The last choice becomes the default next time.`,
            },
          ],
        },
      ],
    },
    "add-project": {
      nav: GUIDE_NAMES.en["add-project"],
      title: GUIDE_NAMES.en["add-project"],
      intro: `A project is a git repository listed under ${l.projects} in the left sidebar. The repository you start code-viewer in is added by itself.`,
      groups: [
        {
          title: "Ways to add one",
          blocks: [
            {
              kind: "steps",
              items: [
                `Select the + next to ${l.projects} in the left sidebar (${l.addProject}), go to the repository's folder and select ${l.addProjectSubmit}.`,
                `${l.addProjectMenu} in the palette (${l.paletteKey}) opens the same dialog.`,
                "Running code-viewer inside another repository adds it too.",
              ],
            },
          ],
        },
      ],
    },
    "ask-ai": {
      nav: GUIDE_NAMES.en["ask-ai"],
      title: GUIDE_NAMES.en["ask-ai"],
      intro:
        "With the bundled skills installed, your AI agent knows the code-viewer commands, so you can ask in plain words — for example, “add another claude account”.",
      groups: [
        {
          title: "Install the skills",
          blocks: [
            {
              kind: "command",
              title: "Into this project, for claude",
              command: "code-viewer skill install",
            },
            {
              kind: "command",
              title:
                "Choose the agents (claude, codex, gemini, cursor, agents, or all)",
              command: "code-viewer skill install --agent claude,codex",
            },
            {
              kind: "command",
              title: "Into your home directory, for every project",
              command: "code-viewer skill install --agent all --global",
            },
          ],
        },
        {
          title: "What you can ask",
          blocks: [
            {
              kind: "table",
              rows: [
                [
                  "code-viewer-accounts",
                  "Add, sign in, rename or remove a claude / codex account",
                ],
                [
                  "code-viewer-annotate",
                  "Walk you through code with explanations on its lines",
                ],
                [
                  "code-viewer-journal",
                  "Create and work through Work Log tasks",
                ],
                [
                  "code-viewer-query",
                  "Look into a database with read-only queries",
                ],
                [
                  "code-viewer-snapshot",
                  "Take snapshots of data and compare before and after",
                ],
              ],
            },
          ],
        },
        {
          title: "Account commands (code-viewer accounts)",
          blocks: [
            {
              kind: "table",
              rows: [
                ["list", "Every account and its sign-in state"],
                [
                  "plan",
                  "What create would make: the settings directory and the links",
                ],
                ["create", "Make a new settings directory and register it"],
                ["register", "Register a settings directory you already have"],
                ["login", "Open the official sign-in in a new tmux window"],
                ["wait", "Wait until the sign-in is done"],
                ["rename", "Change the display name"],
                [
                  "remove",
                  "Take it off the list (the settings directory is kept)",
                ],
              ],
            },
          ],
        },
      ],
    },
  };
}
