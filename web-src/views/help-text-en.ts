// The help text in English. The order and names of the sections live in
// help-guides.ts, the Japanese text in help-text-ja.ts. Button names are { ui }
// with the value taken from each screen's i18n (w.l). A paragraph is at most
// 240 characters and a section's body at most 1200 (help-text-length.test.ts).

import type { HelpText } from "./help-blocks";
import type { HelpTexts, HelpWriter } from "./help-guides";
import { helpFigure } from "./help-images";
import type { HelpBlock } from "./help-page";

const fig = (name: string, alt: string) => helpFigure("en", name, alt);
const ui = (label: string) => ({ ui: label });
const code = (text: string) => ({ code: text });
const key = (text: string) => ({ key: text });
const more = (...items: HelpText[]): HelpBlock => ({
  kind: "details",
  blocks: [{ kind: "list", items }],
});

// ai-dup-check: allow -- ok:英日の本文は同じ節と部品の並びを別の言語の文で持つ (help-text-ja.ts と対)
export function helpTextEn(w: HelpWriter): HelpTexts {
  const { l } = w;
  const settings = ui(l.agents.sidebar.settings);
  const cat = l.settings.categories;
  const hooks = l.agents.hooks;
  const accounts = l.agents.accounts;
  const app = l.app;
  return {
    "getting-started": {
      title: "Getting started",
      intro:
        "code-viewer lets you read a repository in the browser and run and watch AI coding agents. Follow these steps from the top (you need Node.js 20 or newer and git).",
      lead: [
        {
          kind: "steps",
          items: [
            {
              title: "Start it",
              command: "npx @youtyan/code-viewer --open",
              figures: [
                fig(
                  "overview",
                  "The code-viewer window: projects and their agents in the left sidebar, tabs along the top, and the changes of the open project in the main area.",
                ),
              ],
              text: "Run it in your repository's folder, and the page opens in your browser.",
            },
            {
              title: "Find your way around",
              figures: [
                fig(
                  "overview-marked",
                  "Numbered marks on the screen: ① sidebar, ② file list, ③ tabs, ④ main area, ⑤ bottom bar.",
                ),
              ],
              text: "① projects and agents, ② the file list, ③ tabs, ④ the main area, ⑤ the bottom bar.",
              link: w.seeText("tabs-layout"),
            },
            {
              title: "(Optional) Add another repository",
              figures: [
                fig(
                  "project-register",
                  `Inside a repository's folder. ${l.agents.projects.addProjectSubmit} at the bottom adds it.`,
                ),
              ],
              text: [
                "Select the + next to ",
                ui(l.agents.sidebar.projects),
                ", pick the folder and select ",
                ui(l.agents.projects.addProjectSubmit),
                ".",
              ],
              link: w.seeText("projects"),
            },
            {
              title: "Install tmux",
              command: "brew install tmux",
              figures: [
                fig(
                  "sidebar-no-tmux",
                  `The sidebar when tmux is missing: “${l.agents.sidebar.notInstalled}”.`,
                ),
              ],
              text: [
                "On Linux, use your package manager, for example ",
                code("sudo apt install tmux"),
                ".",
              ],
            },
            {
              title: "Sign in to your account",
              figures: [
                fig(
                  "accounts-sign-in",
                  `An account row in Settings and its ${accounts.loginButton} button.`,
                ),
              ],
              text: [
                "In ",
                settings,
                " → ",
                ui(cat.accounts.label),
                ", select ",
                ui(accounts.loginButton),
                " on the row and approve it in your browser (skip rows that say ",
                ui(accounts.login["logged-in"]),
                ").",
              ],
              link: w.seeText("add-account"),
            },
            {
              title: "(Optional, recommended) Set up hooks",
              figures: [
                fig(
                  "hooks-section",
                  `The ${hooks.title} section in Settings, with ${hooks.action.install} on the claude row.`,
                ),
              ],
              text: [
                "In ",
                settings,
                " → ",
                ui(cat.agents.label),
                " → ",
                ui(hooks.title),
                ", select ",
                ui(hooks.action.install),
                " so agent states show reliably.",
              ],
              link: w.seeText("agent-hooks"),
            },
            {
              title: "Start an agent",
              figures: [
                fig(
                  "agent-launch",
                  `The ${l.agents.sidebar.newAgent} dialog: choose the ${accounts.launchKind}, the ${accounts.launchAccount} and the ${accounts.launchProject}, then ${accounts.launchRun} at the bottom starts it.`,
                ),
              ],
              text: [
                "Select ",
                ui(l.agents.sidebar.newAgent),
                " at the bottom of the sidebar, choose the agent, account and project, then select ",
                ui(accounts.launchRun),
                ".",
              ],
              link: w.seeText("start-agent"),
            },
            {
              title: "(Optional) Turn on notifications",
              figures: [
                fig(
                  "notify-enable",
                  `${l.agents.notifyEnable} on the ${l.agents.board.allAgents} screen.`,
                ),
              ],
              text: [
                "On the ",
                ui(l.agents.board.allAgents),
                " screen, select ",
                ui(l.agents.notifyEnable),
                " to hear when an agent needs input.",
              ],
              link: w.seeText("notifications"),
            },
            {
              title: "(Optional) Give your AI the skills",
              command: "npx @youtyan/code-viewer skill install",
              figures: [
                fig(
                  "skill-install",
                  "code-viewer skill install --agent claude,codex run in a terminal tab. Each installed skill is listed on its own line.",
                ),
              ],
              text: "Then you can ask your AI things like “add another claude account”.",
              link: w.seeText("ask-ai"),
            },
            {
              title: "If something does not work, run doctor",
              command: "npx @youtyan/code-viewer doctor",
              figures: [
                fig(
                  "doctor-sheet",
                  `The ${l.doctor.title} sheet: each check shows OK or WARN and how to fix it.`,
                ),
              ],
              text: [
                "It lists what is missing and how to fix it (",
                ui(l.doctor.title),
                " in the bottom bar opens the same report).",
              ],
              link: w.seeText("doctor"),
            },
          ],
        },
        more(
          [
            "Install it with ",
            code("npm install -g @youtyan/code-viewer"),
            " to type ",
            code("code-viewer"),
            " instead of ",
            code("npx @youtyan/code-viewer"),
            ". The other sections write commands that way.",
          ],
          "Agent states show in the sidebar, the bottom bar and the tab title.",
        ),
      ],
      groups: [],
    },
    projects: {
      title: "Add and switch projects",
      intro:
        "A project is a git repository listed in the left sidebar. The repository you start code-viewer in is added by itself.",
      groups: [
        {
          title: "Add one",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  text: [
                    "Select the + next to ",
                    ui(l.agents.sidebar.projects),
                    ", go to the repository's folder and select ",
                    ui(l.agents.projects.addProjectSubmit),
                    ".",
                  ],
                  figures: [
                    fig(
                      "project-add",
                      `The ${l.agents.projects.addProject} dialog: folders are listed, and git repositories carry a git badge.`,
                    ),
                    fig(
                      "project-register",
                      `Inside a repository's folder. ${l.agents.projects.addProjectSubmit} at the bottom adds it.`,
                    ),
                  ],
                },
              ],
            },
            {
              kind: "list",
              items: [
                [
                  ui(l.agents.projects.addProjectMenu),
                  " in the palette (",
                  key(app.paletteKey),
                  ") opens the same dialog.",
                ],
                [
                  "Running ",
                  code("code-viewer"),
                  " in another repository's folder adds it too.",
                ],
              ],
            },
          ],
        },
        {
          title: "Switch",
          blocks: [
            {
              kind: "list",
              items: [
                "Select a project's name in the sidebar to switch to it.",
                [
                  "Select the project name at the top of the list column (or press ",
                  key("p"),
                  ") to find a project by name.",
                ],
                "Your tabs, terminals and unread marks stay when you switch.",
                [
                  ui(l.agents.sidebar.detected),
                  " lists projects you have not registered where agents are running.",
                ],
              ],
            },
          ],
        },
        {
          title: "Reorder and recolor",
          blocks: [
            {
              kind: "list",
              items: [
                "Drag a project heading to change the order.",
                "⋯ on a heading renames it, changes its color or removes it from the list. Removing never touches the repository.",
              ],
            },
            {
              kind: "figure",
              figure: fig("projects-menu", "The ⋯ menu of a project heading."),
            },
            more(
              [
                "Projects with no agent and no shell are grouped under ",
                ui(l.agents.sidebar.stopped(0).replace(/\s*\(0\)$/, "")),
                ", and start again when you open them.",
              ],
              [
                "A project nobody has used for a while is stopped in the background. ",
                code("--idle-stop <seconds>"),
                " changes how long it waits.",
              ],
              [
                code("code-viewer --standalone"),
                " runs a separate code-viewer for one repository only.",
              ],
              [
                "If you reinstall code-viewer while it is running, it can no longer start projects. Press ",
                key("Ctrl+C"),
                " in the terminal where you started it, then run it again.",
              ],
              "Theme, language and key bindings are shared by all projects.",
            ),
          ],
        },
      ],
    },
    "read-files": {
      title: "Read files",
      intro:
        "Open a file from the file list on the left and read it as code, a preview, blame or history.",
      groups: [
        {
          title: "Open",
          blocks: [
            {
              kind: "list",
              items: [
                "A file opened with one click gets a temporary tab with an italic name, and the next file replaces it.",
                [
                  "To keep a tab, double-click it or choose ",
                  ui(l.mainTabs.keepOpen),
                  " from its right-click menu.",
                ],
                [
                  "To find a file by name, use the palette (",
                  key(app.paletteKey),
                  ").",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig("files-open", "A file opened from the file list."),
            },
          ],
        },
        {
          title: "Change the view",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "Switch with ",
                  ui(l.source.tabCode),
                  ", ",
                  ui(l.source.tabPreview),
                  ", ",
                  ui(l.source.tabBlame),
                  " and ",
                  ui(l.source.tabHistory),
                  " above the file.",
                ],
                "Markdown, HTML, images, PDF, video and audio have a preview.",
                "CSV and TSV show as a table you can filter and sort by column.",
              ],
            },
          ],
        },
        {
          title: "Hand lines to your AI",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "Drag over line numbers to select lines, then use the button that appears to copy ",
                  code("@path#1-9"),
                  ".",
                ],
                [
                  "Hold ",
                  key("Shift"),
                  " while you select that button to copy the code of those lines too.",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "files-line-select",
                "Lines selected by dragging over their numbers, with the copy button showing.",
              ),
            },
          ],
        },
        {
          title: "Marks in the file list",
          blocks: [
            {
              kind: "list",
              items: [
                "M is modified, A is added (staged), D is deleted and R is renamed.",
                "U is a file you have never run git add on, and I is a file your .gitignore ignores.",
              ],
            },
            more(
              "When the remote is on GitHub, you can open a file or the selected lines there.",
              [
                "Filter the file list with the box above it: ",
                code("/…/"),
                " is a regular expression, ",
                code("~…"),
                " a fuzzy match and ",
                code("*.ts"),
                " a glob.",
              ],
              "Relative links in Markdown lead where they do on GitHub.",
              "A symbolic link shows “→ target” and opens its target.",
              "Folder listings show the last commit date and the local modified date, and each can be sorted.",
              "Large files switch to a lighter view by themselves.",
            ),
          ],
        },
      ],
    },
    "read-diffs": {
      title: "Read diffs",
      intro:
        "Read your changes as a diff, file by file. By default, code-viewer compares HEAD with the working tree.",
      groups: [
        {
          title: "Open",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "Select the ",
                  ui(app.diff),
                  " icon at the top of the list column.",
                ],
                "Select a file in the changed-files list to jump to its diff.",
                [
                  ui(l.diff.viewFile),
                  " on a diff card shows the whole file, and ",
                  ui(l.diff.viewDiff),
                  " goes back.",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "diff-screen",
                "The Diff screen: the changed files and the diff of one file.",
              ),
            },
          ],
        },
        {
          title: "Make it easier to read",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  ui(app.split),
                  " puts the two sides next to each other, and ",
                  ui(app.unified),
                  " shows one column.",
                ],
                [
                  ui(app.ignoreWs),
                  " hides whitespace-only changes, and ",
                  ui(app.hideTests),
                  " hides test files.",
                ],
              ],
            },
          ],
        },
        {
          title: "Compare something else",
          blocks: [
            {
              kind: "paragraph",
              text: "Pass the same arguments as git diff when you start code-viewer.",
            },
            {
              kind: "command",
              command: "code-viewer HEAD~1 HEAD\ncode-viewer --staged",
            },
            {
              kind: "paragraph",
              text: [
                "To compare commits, use the ",
                ui(app.history),
                " screen.",
              ],
            },
            w.see("search"),
          ],
        },
      ],
    },
    search: {
      title: "Search and history",
      intro:
        "Find files by name, search the code, and look through the commit history.",
      groups: [
        {
          title: "Search",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  key("⌘K"),
                  " finds files by name and ",
                  key("⌘G"),
                  " searches the code (Ctrl on Windows and Linux).",
                ],
                [
                  ui(l.agents.sidebar.search),
                  " in the left sidebar opens the same window.",
                ],
                [
                  "Select ",
                  ui(l.search.pinResults),
                  " to keep the results in the ",
                  ui(l.agents.sidebar.search),
                  " tab.",
                ],
                "⌘/Ctrl+click a function or variable to jump to its definition.",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "search-palette",
                "The code search window with its results.",
              ),
            },
          ],
        },
        {
          title: "Look through history",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "On the ",
                  ui(app.history),
                  " screen, select a commit to see its changes.",
                ],
                [
                  "Narrow the list with the box above it (",
                  code("author:name"),
                  ", ",
                  code("path:folder"),
                  ", ",
                  code("since:date"),
                  " and more).",
                ],
                "Shift+click a second commit to see all the changes between the two.",
                [
                  "A file's ",
                  ui(l.source.tabHistory),
                  " tab lists only the commits that changed that file.",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "history-screen",
                "The History screen with one commit selected.",
              ),
            },
            more(
              [
                "Code search can switch on regular expressions, match case and whole words. Put ",
                code("path:folder"),
                " in the query to narrow where it looks.",
              ],
              [
                "The history filter also takes ",
                code("code:text"),
                " (lines added or removed) and ",
                code("merges:no"),
                " / ",
                code("merges:only"),
                ".",
              ],
              "For a merge commit, you can pick which parent to compare against.",
              "Select source lines to open their history (git log -L).",
            ),
          ],
        },
      ],
    },
    worktrees: {
      title: "Worktrees",
      intro:
        "When your agents each work in their own worktree, this screen shows the changes of every worktree side by side.",
      groups: [
        {
          title: "See them",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "On the ",
                  ui(app.worktree),
                  " screen, pick a worktree on the left to see its changed files and diff.",
                ],
                "Each row shows how many commits it is ahead of and behind the base branch, and whether it still merges cleanly.",
                "The band at the top names files that two or more worktrees are changing at the same time.",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "worktrees-screen",
                "The Worktrees screen: a row per worktree and the diff of the chosen one.",
              ),
            },
          ],
        },
        {
          title: "Create and delete",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "Select ",
                  ui(l.worktree.add),
                  " and type a folder name to make a worktree under ",
                  code(".worktrees/"),
                  ".",
                ],
                [
                  ui(l.worktree.remove),
                  " in a row's … menu deletes its folder. The branch and its commits stay.",
                ],
                [
                  "Add ",
                  code(".worktrees/"),
                  " to .gitignore so it does not show up as untracked files.",
                ],
              ],
            },
            more(
              "The base branch is where origin/HEAD points, or main, then master.",
              "A row whose merge check could not run says so. That does not mean it merges cleanly.",
              "A row's … menu can also open the worktree in another code-viewer tab or copy the merge command.",
              "A worktree with uncommitted changes can only be deleted after you tick a checkbox.",
            ),
          ],
        },
      ],
    },
    "start-agent": {
      title: "Start an agent",
      intro:
        "An agent is claude or codex running in a tmux window. You start it for a project, with the account you choose.",
      groups: [
        {
          title: "From the left sidebar",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  text: [
                    "Select ",
                    ui(l.agents.sidebar.newAgent),
                    " at the bottom of the left sidebar.",
                  ],
                  figures: [
                    fig(
                      "agent-new",
                      `${l.agents.sidebar.newAgent} at the bottom of the left sidebar.`,
                    ),
                  ],
                },
                {
                  text: [
                    "Choose the ",
                    ui(accounts.launchKind),
                    ", the ",
                    ui(accounts.launchAccount),
                    " and the ",
                    ui(accounts.launchProject),
                    ", then select ",
                    ui(accounts.launchRun),
                    ".",
                  ],
                  figures: [
                    fig(
                      "agent-launch",
                      `The ${l.agents.sidebar.newAgent} dialog: choose the ${accounts.launchKind}, the ${accounts.launchAccount} and the ${accounts.launchProject}, then ${accounts.launchRun} at the bottom starts it.`,
                    ),
                  ],
                },
              ],
            },
          ],
        },
        {
          title: "From a tab group",
          blocks: [
            {
              kind: "paragraph",
              text: [
                "Choose ",
                ui(l.mainTabs.newAgentHere),
                " from a tab group's ▾ to open the same dialog with that project chosen.",
              ],
            },
          ],
        },
        {
          title: "Choosing the account",
          blocks: [
            {
              kind: "list",
              items: [
                "The dialog lists each account with its 5-hour and weekly usage and how old the values are.",
                "You can choose an account that is not signed in. The agent then asks you to sign in.",
                "Your last choice becomes the default next time.",
              ],
            },
            w.see("add-account"),
          ],
        },
        {
          title: "Change the launch command",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "Edit it under ",
                  ui(accounts.commandsTitle),
                  " in ",
                  settings,
                  " → ",
                  ui(cat.accounts.label),
                  ", then select ",
                  ui(l.settings.save),
                  " at the bottom of the page.",
                ],
                "The launch dialog shows the exact command it will run.",
              ],
            },
            more(
              "The launch command runs in your usual shell, so shell functions work.",
              [
                ui(accounts.commandsReset),
                " brings back the original commands.",
              ],
            ),
          ],
        },
      ],
    },
    "agent-state": {
      title: "Watch your agents",
      intro:
        "Running agents are listed in the left sidebar on every screen, with their current state.",
      groups: [
        {
          title: "States",
          blocks: [
            {
              kind: "table",
              head: ["State", "Meaning"],
              rows: [
                [
                  ui(l.agents.state.waiting),
                  "Waiting for your answer or your permission",
                ],
                [ui(l.agents.state.working), "Working"],
                [
                  ui(l.agents.state.done),
                  "Done, and you have not opened it yet",
                ],
                [ui(l.agents.state.idle), "Doing nothing"],
              ],
            },
            w.see("agent-hooks"),
          ],
        },
        {
          title: "Open and peek",
          blocks: [
            {
              kind: "list",
              items: [
                "Select an agent to open its pane in a terminal tab, where you can type your answer.",
                "Rest the pointer on an agent to see the last lines of its screen.",
                "The numbers at the right of the bottom bar count agents that need input and agents that are working. Select them to open the list.",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "agent-running",
                "After starting an agent: it is listed under sample-app in the left sidebar, and its terminal tab is open on the right.",
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
                  " (",
                  key("g a"),
                  ") lists every agent running in tmux on this machine.",
                ],
                "Inside each project, agents that need input come first, so you can work down from the top.",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "agents-board",
                `The ${l.agents.board.allAgents} screen.`,
              ),
            },
            more(
              "Opening an agent of another project switches to that project first.",
              "The second line of each row shows the agent, its state, how long it has been in it, the worktree and the account.",
              [ui(l.agents.allPanes), " also lists shells with no agent."],
              "Panes whose state could not be read are listed under problems, with the reason.",
            ),
          ],
        },
      ],
    },
    notifications: {
      title: "Get notified",
      intro:
        "code-viewer can show a desktop notification when an agent needs input or finishes its work.",
      groups: [
        {
          title: "Turn them on",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  text: [
                    "On the ",
                    ui(l.agents.board.allAgents),
                    " screen, select ",
                    ui(l.agents.notifyEnable),
                    ".",
                  ],
                  figures: [
                    fig(
                      "notify-enable",
                      `${l.agents.notifyEnable} on the ${l.agents.board.allAgents} screen.`,
                    ),
                  ],
                },
                "Allow notifications when your browser asks.",
              ],
            },
            {
              kind: "paragraph",
              text: "The note the sidebar shows the first time an agent needs input turns them on the same way.",
            },
          ],
        },
        {
          title: "Choose what notifies you",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "In ",
                  settings,
                  " → ",
                  ui(cat.agents.label),
                  ", choose whether to be notified when an agent needs input and when it finishes.",
                ],
                "An agent you are looking at in the front tab does not notify you.",
              ],
            },
          ],
        },
        {
          title: "If nothing shows up",
          blocks: [
            {
              kind: "list",
              items: [
                "If you blocked them, allow notifications for this site from the icon at the left of the address bar, then reload.",
                "Browsers cannot show notifications on a page opened over plain http from another machine (use https or localhost).",
              ],
            },
          ],
        },
      ],
    },
    "agent-hooks": {
      title: "Show agent state reliably (install hooks)",
      intro:
        "With hooks, claude and codex tell code-viewer themselves when they are working, need input or are done. Without them, the state is only a guess from what the screen shows, and it goes wrong when an agent changes how its screen looks.",
      groups: [
        {
          title: "Set them up",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  text: [
                    "Open ",
                    settings,
                    " → ",
                    ui(cat.agents.label),
                    " and find the ",
                    ui(hooks.title),
                    " section.",
                  ],
                  figures: [
                    fig(
                      "hooks-section",
                      `The ${hooks.title} section in Settings: claude is ${hooks.state.none}, codex is ${hooks.state.installed}.`,
                    ),
                  ],
                },
                {
                  text: [
                    "Select ",
                    ui(hooks.action.install),
                    " on the claude or codex row.",
                  ],
                },
                {
                  text: [
                    "Check the file it will write and what it adds, then select ",
                    ui(hooks.run.install),
                    ".",
                  ],
                  figures: [
                    fig(
                      "hooks-dialog",
                      "The confirmation before writing the hooks: the file, what is added and how many other hooks stay.",
                    ),
                  ],
                },
                {
                  text: [
                    "For codex only, open ",
                    code("/hooks"),
                    " in codex and trust the code-viewer hooks. They do not run until you do.",
                  ],
                },
              ],
            },
            {
              kind: "paragraph",
              text: [
                "When the row says ",
                ui(hooks.state.installed),
                ", the hooks are in place.",
              ],
            },
          ],
        },
        {
          title: "How the state is decided",
          blocks: [
            {
              kind: "paragraph",
              text: "code-viewer uses three signals, and a signal higher in the list wins.",
            },
            {
              kind: "table",
              head: ["Signal", "What it looks at"],
              rows: [
                ["Hooks", "The agent's own report, the most reliable"],
                [
                  "Screen rules",
                  "Text on the screen, such as the input box or the working line",
                ],
                [
                  "Screen motion",
                  "Whether the screen keeps changing or has stopped",
                ],
              ],
            },
            {
              kind: "paragraph",
              text: [
                ui(l.agents.state.done),
                " means a hook reported the agent finished, or it went from working to idle and you have not opened it yet.",
              ],
            },
            more(
              "Other hooks in the file are kept, in the same order. The previous content is backed up before writing.",
              [
                "If a row says ",
                ui(hooks.state.broken),
                ", select ",
                ui(hooks.action.repair),
                ".",
              ],
              [
                "If your settings file is generated (from dotfiles, for example), use ",
                ui(hooks.action["guide-install"]),
                " to copy the hooks and add them to the source.",
              ],
              [
                "To take them out, select ",
                ui(hooks.action.uninstall),
                " on the same row.",
              ],
              [
                "The screen rules are in ",
                settings,
                " → ",
                ui(cat.advanced.label),
                ". They are for when you have no hooks, or when an agent's screen changed and the guess went wrong; you normally leave them alone.",
              ],
            ),
          ],
        },
      ],
    },
    "add-account": {
      title: "Add an account",
      intro:
        "An account is one claude or codex settings directory. Add one to keep work and personal use apart, or to sign in to another plan.",
      groups: [
        {
          title: "Add one in the app",
          blocks: [
            {
              kind: "steps",
              items: [
                {
                  text: ["Open ", settings, " → ", ui(cat.accounts.label), "."],
                  figures: [
                    fig(
                      "accounts-list",
                      `${l.agents.sidebar.settings} › ${cat.accounts.label}: each account is a row with its sign-in state, and ${accounts.add} is below the list.`,
                    ),
                  ],
                },
                {
                  text: [
                    "Select ",
                    ui(accounts.add),
                    ", then choose the ",
                    ui(accounts.addKind),
                    " and a ",
                    ui(accounts.addName),
                    ".",
                  ],
                  figures: [
                    fig(
                      "accounts-add",
                      `The add dialog with claude as the ${accounts.addKind}, Personal as the ${accounts.addName} and ${accounts.addModeCreate} chosen.`,
                    ),
                  ],
                },
                {
                  text: [
                    "Pick ",
                    ui(accounts.addModeCreate),
                    " or ",
                    ui(accounts.addModeRegister),
                    ".",
                  ],
                },
                {
                  text: [
                    "Select ",
                    ui(accounts.addNext),
                    ", check what will be made, then select ",
                    ui(accounts.createRun),
                    " or ",
                    ui(accounts.registerRun),
                    ".",
                  ],
                  figures: [
                    fig(
                      "accounts-review",
                      `The review before creating: the new settings directory and the settings linked from the default one, with ${accounts.createRun} below.`,
                    ),
                  ],
                },
                {
                  text: [
                    "On the new row, select ",
                    ui(accounts.loginButton),
                    " and approve it in the browser that opens.",
                  ],
                  figures: [
                    fig(
                      "accounts-sign-in",
                      `The new row in the list and its ${accounts.loginButton} button.`,
                    ),
                  ],
                },
                {
                  text: [
                    "When the row says ",
                    ui(accounts.login["logged-in"]),
                    ", you are done.",
                  ],
                  figures: [
                    fig(
                      "accounts-signed-in",
                      `The row after signing in: it shows ${accounts.login["logged-in"]} and the email address.`,
                    ),
                  ],
                },
              ],
            },
            {
              kind: "note",
              note: "warning",
              paragraphs: [
                "For a second account of the same service, switch the account your browser is signed in to before you approve. Otherwise the approval goes to the account already signed in.",
              ],
            },
            w.accountsSettings(),
          ],
        },
        {
          title: "See usage",
          blocks: [
            {
              kind: "list",
              items: [
                "Once you add an account, usage per account shows above the agent list.",
                [
                  "For claude, select ",
                  ui(accounts.statusLineInstall),
                  " under ",
                  ui(accounts.usageTitle),
                  " to start collecting it.",
                ],
              ],
            },
            more("codex usage shows without any setup.", [
              "When a claude card has no value or an old one, ",
              ui(accounts.usageCheck),
              " starts claude in the background and sends one short message to get the current value (it uses a little usage).",
            ]),
          ],
        },
        {
          title: "Continue with another account",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "Right-click an agent (in the sidebar or on ",
                  l.agents.board.allAgents,
                  ") or its tab, and choose ",
                  ui(l.agents.handoff),
                  ".",
                ],
                [
                  "Pick an account and select ",
                  ui(accounts.handoffRun),
                  ". An agent with that account starts in a new window of the same tmux session.",
                ],
                "It reads the previous agent's conversation log, continues the work, and asks before it starts if anything is unclear.",
              ],
            },
            {
              kind: "note",
              note: "info",
              paragraphs: [
                "This needs the agent hooks. After installing them, send the agent one message.",
              ],
            },
            w.see("agent-hooks"),
            more(
              "The previous agent keeps running. code-viewer does not read the conversation log.",
              [
                ui(accounts.addModeCreate),
                " shares your settings, skills, commands and more from the default directory through links. Sign-in details and history are never shared.",
              ],
              "code-viewer never receives your sign-in details and does not read tokens.",
              [
                ui(accounts.rename),
                " and ",
                ui(accounts.remove),
                " appear only on accounts you added. ",
                ui(accounts.remove),
                " only takes it off the list; the directory stays.",
              ],
            ),
          ],
        },
      ],
    },
    terminal: {
      title: "Terminal",
      intro:
        "Open a shell in a tab. An agent's pane opens in a tab too, so you can answer it right there.",
      groups: [
        {
          title: "Open",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "Select the + in the tab row, then ",
                  ui(l.terminal.newShell),
                  " or one of the listed sessions (",
                  key("Ctrl+`"),
                  ").",
                ],
                "Selecting an agent in the sidebar also opens its pane in a terminal tab.",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "terminal-tab",
                "A terminal tab and the + menu of the tab row.",
              ),
            },
          ],
        },
        {
          title: "Close or stop",
          blocks: [
            {
              kind: "list",
              items: [
                "Closing a tab does not stop the shell or the agent. Reopen it from the +.",
                [
                  "To stop one, right-click its tab and choose ",
                  ui(l.mainTabs.stopSession),
                  ".",
                ],
              ],
            },
          ],
        },
        {
          title: "Handy",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "To only watch, turn on ",
                  ui(l.terminal.readOnly),
                  " from the tab's right-click menu.",
                ],
                "Images the agent writes are listed on the shelf at the right; select one to open it in an image tab.",
                [
                  "The shelf groups images by the pane they came from; hover one to outline that pane and show its path in the shelf header. Choose ",
                  ui(l.terminal.imageShowInTerminal),
                  " from the right-click menu to scroll back to the line.",
                ],
                "Move the shelf to the right, left, bottom, or top with the ⋯ on its header, and drag its inner edge to resize it.",
                "Hover a URL, file path, or image path on the screen for Open and Copy buttons, or click it to open. When tmux handles the mouse, hold ⌘/Ctrl while clicking.",
                [
                  "The terminal is drawn dark even when the page is light. To change this, pick ",
                  ui(l.settings.terminalTone),
                  " in ",
                  settings,
                  " → ",
                  ui(cat.appearance.label),
                  ".",
                ],
              ],
            },
            more(
              "Paste an image (⌘V / Ctrl+V) to hand it to the agent. It is saved in the project under .code-viewer/pasted/ with the date and time as its name (git ignores it), and its path is typed without sending.",
              [
                "If some colors are still hard to read after matching a light page, switch the agent's own colors to a light theme too (",
                code("/theme"),
                " in claude).",
              ],
              "tmux panes open as one shell per tmux session.",
              [
                "If the same tmux session is also open in another terminal, the smaller one loses its right and bottom edges. Setting tmux's ",
                code("window-size smallest"),
                " shows the whole window in both.",
              ],
              "Powerline symbols and file icons show when a Nerd Font is installed on the machine running the browser.",
              [
                "If shells do not open, check the Terminal row of the ",
                ui(l.doctor.title),
                ".",
              ],
            ),
          ],
        },
      ],
    },
    "tabs-layout": {
      title: "Tabs and layout",
      intro:
        "Open files and screens sit in tabs, grouped by project. Split the area in two to read things side by side.",
      groups: [
        {
          title: "Tabs",
          blocks: [
            {
              kind: "list",
              items: [
                "A file opened with one click gets a temporary tab with an italic name, and the next file replaces it.",
                "Middle-click or ⌘/Ctrl+click to open a file in a tab that stays.",
                "Right-click a tab to close it, close the others, copy its path and more.",
              ],
            },
          ],
        },
        {
          title: "Groups",
          blocks: [
            {
              kind: "list",
              items: [
                "Select the colored label at the head of a group to collapse it.",
                [
                  "The label's ▾ offers ",
                  ui(l.mainTabs.newShellHere),
                  ", ",
                  ui(l.mainTabs.newAgentHere),
                  " and ",
                  ui(l.mainTabs.closeGroup),
                  ".",
                ],
                "The Diff, History and other rows in ▾ open the same screens as the vertical strip on the left, as a tab of that project (switching to that project first if it is another one).",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "tabs-groups",
                "Tab groups of two projects and the ▾ menu of a label.",
              ),
            },
          ],
        },
        {
          title: "Split in two",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "The split button at the right end of the tab row, or ",
                  ui(l.mainTabs.splitRight),
                  " on a tab, shows two sides.",
                ],
                "The right side holds files, terminals and images.",
                [
                  "Drag a tab, or use ",
                  ui(l.mainTabs.moveToOtherSide),
                  ", to move it across.",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "tabs-split",
                "Two sides: a file on the left and a terminal on the right.",
              ),
            },
          ],
        },
        {
          title: "Fold columns",
          blocks: [
            {
              kind: "list",
              items: [
                "Fold the file list with the button at the top of the list column.",
                "In a narrow window, the list columns get narrower first, and fold when that is not enough.",
              ],
            },
            w.keys(),
            more(
              [
                "Screens such as ",
                ui(app.diff),
                ", ",
                ui(app.history),
                " and ",
                ui(app.worktree),
                " have one tab each per project.",
              ],
              "Files is not a tab: the folder view is what shows when no tab is selected.",
              "With two windows open, both keep the same tabs.",
            ),
          ],
        },
      ],
    },
    "install-app": {
      title: "Install as an app",
      intro:
        "Installed as an app from Chrome, code-viewer opens in a window of its own.",
      groups: [
        {
          title: "Install",
          blocks: [
            {
              kind: "install",
              button: "Install code-viewer",
              steps: [
                "Select the install icon at the right end of Chrome's address bar.",
                "From then on, open it from the Dock or the Start menu (start code-viewer first).",
              ],
            },
          ],
        },
        {
          title: "What changes in the window",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  key("⌘W"),
                  " (",
                  key("Ctrl+W"),
                  ") closes the front tab, not the window.",
                ],
                [
                  key("⌘T"),
                  " and the other browser tab keys work on code-viewer's tabs.",
                ],
              ],
            },
            w.keys(),
          ],
        },
      ],
    },
    phone: {
      title: "On a phone",
      intro:
        "On a narrow screen, code-viewer keeps to three tasks: answering agents, reading diffs and files, and switching projects.",
      groups: [
        {
          title: "What you can do",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "The bar at the bottom opens ",
                  ui(l.mobile.projects),
                  ", ",
                  ui(l.mobile.files),
                  ", ",
                  ui(l.mobile.diff),
                  ", ",
                  ui(l.mobile.agents),
                  " and ",
                  ui(l.mobile.list),
                  ".",
                ],
                [ui(l.mobile.agents), " shows how many agents need input."],
                "A terminal tab shows keys the on-screen keyboard lacks, such as Esc, Tab and Ctrl+C.",
                "Touch and hold for the right-click menu.",
                "There is no split view. A saved split comes back on a wide window.",
                "Notifications work only on https, or on localhost on the same machine.",
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "phone-screen",
                "code-viewer on a phone, with the bar that switches screens at the bottom.",
              ),
            },
            more(
              [
                "Diffs show as one column, and ",
                ui(l.mobile.wrap),
                " at the end of the Diff bar wraps long lines.",
              ],
              "Pinch on a terminal to change its text size.",
            ),
          ],
        },
      ],
    },
    datastores: {
      title: "Browse datastores",
      intro:
        "See and edit what is in your repository's SQLite files and the databases you run with docker compose, in the browser.",
      groups: [
        {
          title: "What it can open",
          blocks: [
            {
              kind: "list",
              items: [
                "SQLite, MySQL, PostgreSQL, Redis, Elasticsearch, DynamoDB, S3-compatible stores (MinIO, R2 and others) and Cloudflare D1.",
                ".db files in the repository and services in your compose file are found by themselves.",
                [
                  "Add others with ",
                  ui(l.database.nav.addConnection),
                  " next to the datastore picker.",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig("datastore-grid", "The rows of a SQLite table."),
            },
          ],
        },
        {
          title: "Read and edit",
          blocks: [
            {
              kind: "list",
              items: [
                "Pick a table to see its rows, and run queries in the SQL box above them.",
                [
                  "Turn on ",
                  ui(l.database.edit.editMode),
                  " to change cells and write them all at once.",
                ],
                "Select a foreign-key cell to follow it to the related rows.",
              ],
            },
          ],
        },
        {
          title: "Compare before and after",
          blocks: [
            {
              kind: "paragraph",
              text: [
                "Take a ",
                ui(l.database.nav.snapshot),
                " now, and later compare two points in time: rows added, changed and removed.",
              ],
            },
            more(
              "Passwords and other secrets are never written into the repository. On macOS they are kept in the Keychain; elsewhere you enter them again after a restart.",
              "Cloudflare D1 and DynamoDB are read-only.",
              [
                ui(l.database.nav.er),
                " draws an ER diagram, and ",
                ui(l.database.nav.search),
                " looks through every table.",
              ],
            ),
          ],
        },
      ],
    },
    tools: {
      title: "Try out pasted text (Tools)",
      intro: [
        "The ",
        ui(app.tools),
        " tab shows or tidies Markdown, Mermaid, JSON and YAML you paste into it.",
      ],
      groups: [
        {
          title: "How to use it",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "Open ",
                  ui(app.tools),
                  " from the + menu of the tab row or from the palette (",
                  key(app.paletteKey),
                  ").",
                ],
                "Markdown looks the same as a file preview.",
                "Mermaid diagrams can be zoomed and dragged.",
                "JSON and YAML: paste either one, and get tidy JSON or YAML back. Format errors show too.",
                "What you paste is kept, so you can pick up where you left off.",
              ],
            },
            {
              kind: "figure",
              figure: fig("tools-markdown", "Markdown shown in the Tools tab."),
            },
          ],
        },
      ],
    },
    annotations: {
      title: "Have AI explain code (annotations)",
      intro:
        "Ask your AI agent, and it walks you through the code with notes on the lines. The notes are listed in the annotations panel.",
      groups: [
        {
          title: "How to ask",
          blocks: [
            {
              kind: "steps",
              items: [
                "Keep code-viewer running.",
                "Ask your AI something like “Use annotate to walk me through the hardest part of this system.”",
                "Open the annotations panel and read the notes in order.",
              ],
            },
            {
              kind: "note",
              note: "info",
              paragraphs: [
                "Install the skills first, and your AI already knows the annotation commands.",
              ],
            },
            w.see("ask-ai"),
            {
              kind: "figure",
              figure: fig(
                "annotations-panel",
                "The annotations panel and a note shown under the code.",
              ),
            },
          ],
        },
        {
          title: "What the panel does",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "Select lines and ",
                  ui(l.annotations.add),
                  " to write a note yourself.",
                ],
                "It can jump to each new note's place as it arrives.",
                "The play button reads the notes aloud.",
              ],
            },
            more(
              [
                "Notes are kept in the repository's ",
                code(".code-viewer/annotations.json"),
                ", so a reload keeps them.",
              ],
              [
                code("code-viewer annotate agent-help"),
                " prints every command the AI uses.",
              ],
              "The copy button on a note gives you text pointing at it to hand back to your AI.",
            ),
          ],
        },
      ],
    },
    "ask-ai": {
      title: "Let AI do it (skills)",
      intro:
        "With the bundled skills installed, your AI agent knows the code-viewer commands, so you can ask in plain words.",
      groups: [
        {
          title: "Install",
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
            {
              kind: "figure",
              figure: fig(
                "skill-install",
                "code-viewer skill install --agent claude,codex run in a terminal tab. Each installed skill is listed on its own line.",
              ),
            },
          ],
        },
        {
          title: "What you can ask",
          blocks: [
            {
              kind: "table",
              head: ["Skill", "What you can ask"],
              rows: [
                [
                  code("code-viewer-accounts"),
                  "Add, sign in, rename or remove a claude or codex account",
                ],
                [
                  code("code-viewer-annotate"),
                  "Walk you through code with notes on its lines",
                ],
                [
                  code("code-viewer-journal"),
                  "Create and work through Work log tasks",
                ],
                [
                  code("code-viewer-query"),
                  "Look into a database with read-only queries",
                ],
                [
                  code("code-viewer-snapshot"),
                  "Take snapshots of data and compare before and after",
                ],
              ],
            },
            more(
              [
                "The accounts skill uses ",
                code("code-viewer accounts"),
                ". You still approve each sign-in yourself in the browser.",
              ],
              [
                code("code-viewer accounts --help"),
                " prints everything ",
                code("code-viewer accounts"),
                " can do.",
              ],
            ),
          ],
        },
      ],
    },
    "ai-cli-mcp": {
      title: "CLI and MCP for AI",
      intro:
        "AI agents can use code-viewer without the browser, through the CLI or MCP.",
      groups: [
        {
          title: "CLI",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  code("code-viewer query"),
                  " runs read-only queries, searches across tables and compares snapshots.",
                ],
                "Results also land in the query history, so you can look at them again in the browser.",
                "These commands print everything each CLI can do.",
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
                "While code-viewer is running, it is also a read-only MCP server.",
                [
                  "Connect to ",
                  code("http://127.0.0.1:<port>/_mcp"),
                  ", with the port from the URL it printed at start.",
                ],
                "Its tools read files, search, look at git history and read datastores.",
              ],
            },
            more(
              "The endpoint speaks JSON-RPC 2.0 over Streamable HTTP and accepts connections from the same machine only.",
              ["MCP's ", code("tools/list"), " lists every tool."],
            ),
          ],
        },
      ],
    },
    "project-files": {
      title: "What code-viewer saves",
      intro: [
        "State for each repository is saved in ",
        code(".code-viewer/"),
        " at the root of the repository.",
      ],
      groups: [
        {
          title: ".code-viewer/",
          blocks: [
            {
              kind: "list",
              items: [
                "It holds opened folders, datastore tabs, annotations, query history, snapshots and similar state.",
                [
                  "Usually, add ",
                  code(".code-viewer/"),
                  " to ",
                  code(".gitignore"),
                  ".",
                ],
                [
                  "To share annotations with others, commit only ",
                  code("annotations.json"),
                  ".",
                ],
                "Delete the whole folder to reset everything for that repository.",
              ],
            },
            {
              kind: "note",
              note: "warning",
              paragraphs: [
                "code-viewer rewrites these files itself, so do not edit them by hand.",
              ],
            },
          ],
        },
      ],
    },
    doctor: {
      title: "Troubleshooting",
      intro: [
        "When something does not work, the ",
        ui(l.doctor.title),
        " lists what is missing and how to fix it.",
      ],
      groups: [
        {
          title: "Open it",
          blocks: [
            {
              kind: "list",
              items: [
                [
                  "Select the ",
                  ui(l.doctor.title),
                  " icon at the right of the bottom bar; it slides in from the right.",
                ],
                [
                  "In a terminal, ",
                  code("code-viewer doctor"),
                  " prints the same report.",
                ],
              ],
            },
            {
              kind: "figure",
              figure: fig(
                "doctor-sheet",
                `The ${l.doctor.title} sheet: each check shows OK or WARN and how to fix it.`,
              ),
            },
          ],
        },
        {
          title: "Common problems",
          blocks: [
            {
              kind: "table",
              head: ["Problem", "What to do"],
              rows: [
                [
                  "Agents are not listed",
                  "Install tmux and run your agents inside it",
                ],
                ["The state looks wrong", "Set up hooks"],
                [
                  "SQLite does not open",
                  [
                    "Run ",
                    code("rm -rf ~/.npm/_npx"),
                    ", then start with ",
                    code("npx -y @youtyan/code-viewer@latest"),
                  ],
                ],
                [
                  "Projects do not open after reinstalling",
                  [
                    "Press ",
                    key("Ctrl+C"),
                    " where you started code-viewer, then run it again",
                  ],
                ],
              ],
            },
            w.see("agent-hooks"),
            more(
              [
                code("code-viewer doctor --json"),
                " prints the whole report as JSON for AI agents and CI. It exits with 1 when there is an error.",
              ],
              [
                "When git, tmux or another tool is not on PATH, pass its location, for example ",
                code("--bin tmux=/absolute/path"),
                ".",
              ],
            ),
          ],
        },
      ],
    },
    keybindings: {
      title: "Keyboard shortcuts",
      intro: [
        "These are the keys as you have them set. Press ",
        key("?"),
        " on any screen to see the common ones in a small window.",
      ],
      lead: [
        {
          kind: "figure",
          figure: fig(
            "quick-help",
            "The Keyboard shortcuts window: each key next to what it does, with links to Settings and to this full list at the bottom.",
          ),
        },
      ],
      // help-page.ts adds the key list, built from the current bindings.
      groups: [],
    },
  };
}
