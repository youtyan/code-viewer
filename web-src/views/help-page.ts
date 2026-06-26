// Help page (keybindings reference), extracted from app.ts.

import type { AppRoute } from "../core/routes";

export type HelpPageDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  getRoute(): AppRoute;
  setRoute(route: AppRoute, replace?: boolean): void;
  setPageMode(): void;
  cancelActiveSourceLoad(reason: "user" | "navigation" | "esc"): boolean;
  removeStandaloneSource(): void;
  clearLoadQueue(): void;
  currentRange(): { from: string; to: string };
  syncHeaderMenu(): void;
  getLanguage(): HelpLanguage;
  setLanguage(language: HelpLanguage): void;
};

export type HelpLanguage = "en" | "ja";

export type HelpSection =
  | "overview"
  | "annotations"
  | "database"
  | "skills"
  | "keybindings";

type HelpBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "command"; title: string; command: string }
  | { kind: "table"; rows: Array<[string, string]> };

type HelpContent = {
  languageLabel: string;
  title: string;
  sections: Record<
    HelpSection,
    {
      nav: string;
      title: string;
      intro: string;
      groups: Array<{ title: string; blocks: HelpBlock[] }>;
    }
  >;
};

const HELP_LANGUAGES: HelpLanguage[] = ["en", "ja"];

const HELP_SECTIONS: HelpSection[] = [
  "overview",
  "annotations",
  "database",
  "skills",
  "keybindings",
];

const HELP_CONTENT: Record<HelpLanguage, HelpContent> = {
  en: {
    languageLabel: "Language",
    title: "Help",
    sections: {
      overview: {
        nav: "Getting Started",
        title: "Getting Started",
        intro:
          "code-viewer is a local browser UI for reading a repository, reviewing diffs, and letting AI agents attach explanations to exact code lines.",
        groups: [
          {
            title: "Start the viewer",
            blocks: [
              {
                kind: "paragraph",
                text: "Run the command from inside a Git repository. The server prints a localhost URL; open it in your browser.",
              },
              {
                kind: "command",
                title: "Run without installing",
                command: "npx @youtyan/code-viewer",
              },
              {
                kind: "command",
                title: "Open another repository",
                command: "code-viewer --cwd /path/to/repo --open",
              },
              {
                kind: "command",
                title: "Bind to a specific port or override scope",
                command:
                  "code-viewer --port 64160 --scope-omit-dir node_modules --scope-omit-dir dist",
              },
              {
                kind: "command",
                title: "Print the installed version",
                command: "code-viewer --version",
              },
            ],
          },
          {
            title: "Read a diff",
            blocks: [
              {
                kind: "paragraph",
                text: "Arguments after the options are passed to Git diff. With no arguments, code-viewer compares HEAD with the working tree.",
              },
              {
                kind: "command",
                title: "Compare two refs",
                command: "code-viewer HEAD~1 HEAD",
              },
              {
                kind: "command",
                title: "Inspect staged changes",
                command: "code-viewer --staged",
              },
            ],
          },
          {
            title: "Browse files",
            blocks: [
              {
                kind: "paragraph",
                text: "Use the sidebar or file palette to open source files, Markdown previews, images, PDFs, and other browser-safe media. Large text files automatically switch to virtual mode.",
              },
            ],
          },
        ],
      },
      annotations: {
        nav: "AI Annotations",
        title: "AI Code Annotations",
        intro:
          "Annotations let an AI coding agent guide you through code in the browser. Each annotation points to a file and line range, open tabs jump there live, and the full walkthrough is saved to .code-viewer/annotations.json so it survives reloads.",
        groups: [
          {
            title: "What you ask the AI to do",
            blocks: [
              {
                kind: "paragraph",
                text: 'Ask the agent to explain code with code-viewer annotations. For example: "Use annotate to walk me through the hardest part of this system."',
              },
              {
                kind: "steps",
                items: [
                  "Start code-viewer for the repository and keep it running.",
                  "Ask the AI agent for an annotated walkthrough.",
                  "Open the annotation panel in the browser, toggle the follow checkbox if you want tabs to auto-jump, and press play to have the current note read aloud.",
                ],
              },
            ],
          },
          {
            title: "Commands the agent uses",
            blocks: [
              {
                kind: "command",
                title: "Start a walkthrough session",
                command:
                  'code-viewer annotate start --title "How the cache invalidation works"',
              },
              {
                kind: "command",
                title: "Add an explanation to a line range",
                command:
                  'code-viewer annotate add --file src/cache.ts --line 120-145 --title "Entry point" --body "Writes land here first."',
              },
              {
                kind: "command",
                title: "Insert or move a step",
                command:
                  'code-viewer annotate add --after a-123 --file src/cache.ts --line 150 --body "This belongs here."\ncode-viewer annotate move a-999 --before a-123',
              },
              {
                kind: "command",
                title: "Edit, rename, delete, or clear",
                command:
                  'code-viewer annotate edit a-123 --body "Updated explanation."\ncode-viewer annotate rename sess-abc --title "Renamed walkthrough"\ncode-viewer annotate delete a-999\ncode-viewer annotate clear',
              },
              {
                kind: "command",
                title: "Annotate a database view",
                command: `code-viewer annotate add-db --db app.db --table orders --tab data \\
  --grid-search failed --filter status=failed --sort created_at:desc \\
  --body "This restores the filtered failure rows."
code-viewer annotate add-db --db app.db --tab query \\
  --sql "select * from orders where status = 'failed'" --run-query \\
  --body "This reopens the result being discussed."`,
              },
              {
                kind: "command",
                title: "Inspect posted annotations",
                command: "code-viewer annotate list",
              },
            ],
          },
          {
            title: "Browser panel features",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "Follow checkbox",
                    "When on, every new annotation makes the active tab jump to its location. Turn it off to read at your own pace.",
                  ],
                  [
                    "Audio playback",
                    "Play / pause / previous / next / mute / rate controls speak the current annotation through the browser TTS engine. Rate and mute are saved per project.",
                  ],
                  [
                    "Copy as AI prompt",
                    "Each annotation has a copy button that produces a paste-ready prompt block referencing the annotation URL, so you can hand it back to the originating agent.",
                  ],
                  [
                    "Persistent state",
                    "Open/closed, follow, mute, and rate are stored under .code-viewer/settings.json; annotations themselves live in .code-viewer/annotations.json.",
                  ],
                ],
              },
            ],
          },
          {
            title: "Writing useful annotations",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "One idea per annotation",
                    "Prefer several focused notes over one long explanation.",
                  ],
                  [
                    "Always pass --line",
                    "Use the smallest range that covers the idea. The body is rendered under the last line.",
                  ],
                  [
                    "Use sessions",
                    "Start a new session for each walkthrough topic so the history stays readable.",
                  ],
                  [
                    "Fix in place",
                    "Use annotate edit when a note is wrong so the walkthrough order and IDs remain stable.",
                  ],
                  [
                    "Place notes deliberately",
                    "Use --before, --after, --position, or annotate move when the reading order changes.",
                  ],
                ],
              },
            ],
          },
        ],
      },
      database: {
        nav: "Datastores",
        title: "Datastore Viewer",
        intro:
          "Browse SQLite files, Docker-hosted databases, Redis, Elasticsearch, and S3-compatible object stores from one local viewer.",
        groups: [
          {
            title: "Supported datastores",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "SQLite",
                    "Automatically discovered from .db, .sqlite, .sqlite3, and .s3db files in the repository.",
                  ],
                  [
                    "MySQL / MariaDB",
                    "Detected from docker-compose.yml / compose.yml (or .yaml). Multiple databases per server are listed.",
                  ],
                  [
                    "PostgreSQL",
                    "Detected from compose files. Multiple databases per server, plus a schema selector for switching schemas without reopening.",
                  ],
                  [
                    "Redis",
                    "Detected from compose files. Read-only browse over DB 0-15, SCAN keys, dedicated string/hash/list panes, JSON view for set/zset/stream, and participates in snapshots and diffs.",
                  ],
                  [
                    "Elasticsearch",
                    "Detected from compose files. List indices, view mappings, paginate with search_after, run lucene q= or DSL queries on an allowlist, and take snapshots/diffs.",
                  ],
                  [
                    "S3 / MinIO / LocalStack",
                    "Detected from compose files. Folder-tree browse, prefix/filename search, updated-time sort, and previews for images, video, audio, PDF, Markdown, HTML, and text. LocalStack falls back to `docker exec curl` when no host port is published; MinIO requires a published host port.",
                  ],
                ],
              },
            ],
          },
          {
            title: "UI layout",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "Multi-DB tabs",
                    "Open multiple databases side by side. Drag to reorder, + adds an empty tab, middle-click or × closes one (the last tab is reset to empty). Layout persists in .code-viewer/tabs.json.",
                  ],
                  [
                    "Sidebar",
                    "DB selector, PostgreSQL schema selector, table tree (expand to see columns), filter, Rails FK inference toggle, and icon toolbar for Query / ER / Search / Snapshot tabs.",
                  ],
                  [
                    "Data tab",
                    "Paginated grid with sort, filter, cell copy, and CSV/JSON export (capped at 100k rows; export respects the current filter and sort).",
                  ],
                  [
                    "Detail footer & related panel",
                    "Click any cell to open a resizable detail footer. Foreign-key cells open a related-rows panel with multi-step drill-down breadcrumbs, supporting both outgoing (FK → PK) and incoming (PK ← FK) navigation.",
                  ],
                  [
                    "Schema tab",
                    "Column definitions, indexes, foreign keys, triggers, and DDL.",
                  ],
                  [
                    "Query editor",
                    "SQL syntax highlighting, Tab indent, auto-resize, Ctrl+Enter to run. Allowlist depends on the engine (SQLite: SELECT/PRAGMA/EXPLAIN/WITH; PostgreSQL and MySQL also accept SHOW/DESCRIBE).",
                  ],
                  [
                    "ER Diagram",
                    "Mermaid-based entity-relationship diagram with zoom and pan.",
                  ],
                  [
                    "Search tab",
                    "Full-text search across all tables and text columns of a database.",
                  ],
                  [
                    "Snapshot tab",
                    "Capture point-in-time snapshots of selected tables/indices/key spaces and diff any two to see inserts, updates, and deletes with full before/after values.",
                  ],
                  [
                    "Query History",
                    "Master-detail panel with history list and result preview. Each entry records whether it came from the browser or the CLI, and updates live over SSE.",
                  ],
                  [
                    "Datastore explorers",
                    "Redis / Elasticsearch / S3 keep the same Multi-DB tab UI but swap the table tree for a key-space / index-tree / folder-tree explorer.",
                  ],
                ],
              },
            ],
          },
          {
            title: "CLI query (for AI agents)",
            blocks: [
              {
                kind: "paragraph",
                text: "AI agents can execute read-only queries and manage per-DB query history from the CLI. Results are saved into the same history visible in the browser. Search, snapshot, and diff operations live in the browser UI (Search tab / Snapshot tab) rather than the CLI.",
              },
              {
                kind: "command",
                title: "Run a query",
                command:
                  'code-viewer query exec --db data.db --sql "SELECT * FROM users LIMIT 10" --title "Sample data"',
              },
              {
                kind: "command",
                title: "Run without saving history",
                command:
                  'code-viewer query exec --db app.db --sql "SELECT count(*) FROM orders" --max-rows 1 --no-save',
              },
              {
                kind: "command",
                title: "List or clear query history",
                command:
                  "code-viewer query list --db app.db --json\ncode-viewer query clear --db app.db",
              },
              {
                kind: "command",
                title: "Agent reference",
                command: "code-viewer query agent-help",
              },
            ],
          },
        ],
      },
      skills: {
        nav: "Agent Skill",
        title: "Agent Skill Setup",
        intro:
          "The package includes a code-viewer annotate skill so AI agents know when and how to create browser walkthroughs.",
        groups: [
          {
            title: "Install the skill",
            blocks: [
              {
                kind: "command",
                title: "Install for Claude Code in the current project",
                command: "npx -y @youtyan/code-viewer skill install",
              },
              {
                kind: "command",
                title: "Install for other agents",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent codex,gemini,cursor",
              },
              {
                kind: "command",
                title: "Install for every supported agent",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent all\n# all = claude (.claude/), codex (.codex/), gemini (.gemini/), cursor (.cursor/), agents (.agents/)",
              },
              {
                kind: "command",
                title: "Install globally for a user (not per project)",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent all --global",
              },
            ],
          },
          {
            title: "What the skill teaches",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "When to annotate",
                    "Code reviews, onboarding walkthroughs, and explanations of changes.",
                  ],
                  [
                    "How to target code",
                    "Use --file and --line, and include --from / --to when explaining a diff range.",
                  ],
                  [
                    "How to keep history clean",
                    "Use one session per topic, edit wrong notes in place, and avoid unrelated cleanup.",
                  ],
                ],
              },
            ],
          },
          {
            title: "Agent reference",
            blocks: [
              {
                kind: "paragraph",
                text: "Agents can print the full built-in guide from the CLI when they need exact command details.",
              },
              {
                kind: "command",
                title: "Show the agent guide",
                command: "code-viewer annotate agent-help",
              },
            ],
          },
        ],
      },
      keybindings: {
        nav: "Keybindings",
        title: "Keyboard Shortcuts",
        intro:
          "Use these shortcuts to move between panels and navigate files without leaving the keyboard.",
        groups: [
          {
            title: "Global",
            blocks: [
              {
                kind: "table",
                rows: [
                  ["Ctrl+K", "Open file palette"],
                  ["Ctrl+G", "Open grep palette"],
                  ["/", "Focus file filter"],
                  ["t", "Toggle theme"],
                  ["[ / ]", "Previous / next annotation"],
                ],
              },
            ],
          },
          {
            title: "Panels",
            blocks: [
              {
                kind: "table",
                rows: [
                  ["Ctrl+H", "Focus sidebar"],
                  ["Ctrl+L", "Focus main panel"],
                ],
              },
            ],
          },
          {
            title: "Sidebar",
            blocks: [
              {
                kind: "table",
                rows: [
                  ["j / k", "Move selection down / up"],
                  ["Ctrl+D / Ctrl+U", "Move selection by half a page"],
                  ["gg / Shift+G", "Move to top / bottom"],
                  ["Enter", "Open selected item"],
                  ["h / l", "Collapse / expand directory"],
                ],
              },
            ],
          },
          {
            title: "Main Panel",
            blocks: [
              {
                kind: "table",
                rows: [
                  ["j / k", "Move code cursor down / up"],
                  ["Ctrl+D / Ctrl+U", "Move code cursor by half a page"],
                  ["gg / Shift+G", "Move code cursor to top / bottom"],
                  ["gp / gc", "Switch to Preview / Code tab"],
                ],
              },
            ],
          },
        ],
      },
    },
  },
  ja: {
    languageLabel: "言語",
    title: "ヘルプ",
    sections: {
      overview: {
        nav: "はじめに",
        title: "はじめに",
        intro:
          "code-viewer は、ローカルのリポジトリをブラウザで読み、diff を確認し、AI エージェントにコード行へ説明を付けさせるためのツールです。",
        groups: [
          {
            title: "ビューアを起動する",
            blocks: [
              {
                kind: "paragraph",
                text: "Git リポジトリの中でコマンドを実行します。サーバが localhost の URL を表示するので、それをブラウザで開きます。",
              },
              {
                kind: "command",
                title: "インストールせずに起動",
                command: "npx @youtyan/code-viewer",
              },
              {
                kind: "command",
                title: "別のリポジトリを開く",
                command: "code-viewer --cwd /path/to/repo --open",
              },
              {
                kind: "command",
                title: "ポート指定とスコープ除外を上書きする",
                command:
                  "code-viewer --port 64160 --scope-omit-dir node_modules --scope-omit-dir dist",
              },
              {
                kind: "command",
                title: "インストールされたバージョンを表示",
                command: "code-viewer --version",
              },
            ],
          },
          {
            title: "diff を読む",
            blocks: [
              {
                kind: "paragraph",
                text: "オプションの後ろに置いた引数は Git diff に渡されます。引数なしなら HEAD と作業ツリーを比較します。",
              },
              {
                kind: "command",
                title: "2つの ref を比較",
                command: "code-viewer HEAD~1 HEAD",
              },
              {
                kind: "command",
                title: "ステージ済み変更を見る",
                command: "code-viewer --staged",
              },
            ],
          },
          {
            title: "ファイルを読む",
            blocks: [
              {
                kind: "paragraph",
                text: "サイドバーやファイルパレットから、ソース、Markdown プレビュー、画像、PDF などを開けます。大きいテキストファイルは自動で軽量な仮想表示に切り替わります。",
              },
            ],
          },
        ],
      },
      annotations: {
        nav: "AI注釈",
        title: "AI コード注釈",
        intro:
          "注釈機能を使うと、AI コーディングエージェントがブラウザ上の特定ファイル・特定行へ説明を付けられます。開いているタブは注釈先へライブで移動し、ウォークスルー全体は .code-viewer/annotations.json に保存されてリロード後も残ります。",
        groups: [
          {
            title: "AI に頼む言い方",
            blocks: [
              {
                kind: "paragraph",
                text: "AI エージェントには、code-viewer の annotate 機能を使って説明して、と頼みます。例: 「このシステムで一番むずかしい処理を annotate でウォークスルーして」",
              },
              {
                kind: "steps",
                items: [
                  "対象リポジトリで code-viewer を起動したままにします。",
                  "AI エージェントに注釈付きの解説を依頼します。",
                  "ブラウザの注釈パネルを開き、自動追従させたいときは follow チェックボックスをオン、再生ボタンで読み上げも使えます。",
                ],
              },
            ],
          },
          {
            title: "AI が使うコマンド",
            blocks: [
              {
                kind: "command",
                title: "ウォークスルー用セッションを作る",
                command:
                  'code-viewer annotate start --title "キャッシュ無効化の流れ"',
              },
              {
                kind: "command",
                title: "行範囲へ説明を追加する",
                command:
                  'code-viewer annotate add --file src/cache.ts --line 120-145 --title "入口" --body "書き込みはここから入ります。"',
              },
              {
                kind: "command",
                title: "説明を途中に差し込む・移動する",
                command:
                  'code-viewer annotate add --after a-123 --file src/cache.ts --line 150 --body "ここに入る補足です。"\ncode-viewer annotate move a-999 --before a-123',
              },
              {
                kind: "command",
                title: "edit / rename / delete / clear",
                command:
                  'code-viewer annotate edit a-123 --body "説明文を修正しました。"\ncode-viewer annotate rename sess-abc --title "ウォークスルー名を変更"\ncode-viewer annotate delete a-999\ncode-viewer annotate clear',
              },
              {
                kind: "command",
                title: "データベース画面へ注釈を追加する",
                command: `code-viewer annotate add-db --db app.db --table orders --tab data \\
  --grid-search failed --filter status=failed --sort created_at:desc \\
  --body "失敗注文で絞り込んだ調査画面を復元します。"
code-viewer annotate add-db --db app.db --tab query \\
  --sql "select * from orders where status = 'failed'" --run-query \\
  --body "説明対象のクエリ結果を開き直します。"`,
              },
              {
                kind: "command",
                title: "投稿済み注釈を確認する",
                command: "code-viewer annotate list",
              },
            ],
          },
          {
            title: "ブラウザパネルの機能",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "follow チェックボックス",
                    "オンにすると新しい注釈が追加されるたびにアクティブタブが注釈先へ自動で移動します。落ち着いて読みたいときはオフに。",
                  ],
                  [
                    "音声再生",
                    "再生 / 一時停止 / 前後 / ミュート / 速度を持つプレイヤーが、現在の注釈をブラウザ TTS で読み上げます。速度とミュートはプロジェクト単位で保存されます。",
                  ],
                  [
                    "AI 用プロンプトとしてコピー",
                    "各注釈のコピーボタンが、注釈 URL を含む貼り付け可能なプロンプトを生成します。元のエージェントへそのまま戻せます。",
                  ],
                  [
                    "永続化",
                    "パネルの開閉・follow・ミュート・速度は .code-viewer/settings.json に、注釈自体は .code-viewer/annotations.json に保存されます。",
                  ],
                ],
              },
            ],
          },
          {
            title: "読みやすい注釈にするコツ",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "1注釈1テーマ",
                    "巨大な説明を1つ置くより、短い注釈を順番に並べます。",
                  ],
                  [
                    "必ず --line を付ける",
                    "説明に必要な最小行範囲を指定します。本文は範囲の最後の行の下に表示されます。",
                  ],
                  [
                    "セッションを分ける",
                    "1つの解説テーマごとにセッションを作ると履歴が読みやすくなります。",
                  ],
                  [
                    "間違いは edit で直す",
                    "削除して追加し直すより、注釈IDと順番を保ったまま修正します。",
                  ],
                  [
                    "順番は明示的に直す",
                    "--before、--after、--position、annotate move で読み順を整えます。",
                  ],
                ],
              },
            ],
          },
        ],
      },
      database: {
        nav: "データストア",
        title: "データストアビューア",
        intro:
          "SQLite ファイル、Docker 上のデータベース、Redis、Elasticsearch、S3 互換オブジェクトストアをローカルビューアで閲覧できます。",
        groups: [
          {
            title: "対応データストア",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "SQLite",
                    "リポジトリ内の .db, .sqlite, .sqlite3, .s3db ファイルを自動検出します。",
                  ],
                  [
                    "MySQL / MariaDB",
                    "docker-compose.yml / compose.yml (.yaml 含む) のサービスから検出。同一サーバー上の複数データベースを一覧表示します。",
                  ],
                  [
                    "PostgreSQL",
                    "compose ファイルから検出。同一サーバー上の複数データベースに対応し、スキーマ切替セレクターで再オープンせずスキーマを切り替えられます。",
                  ],
                  [
                    "Redis",
                    "compose ファイルから検出。DB 0-15 を read-only で SCAN し、string/hash/list は専用ペイン、set/zset/stream は JSON ビュー。スナップショット/差分にも参加します。",
                  ],
                  [
                    "Elasticsearch",
                    "compose ファイルから検出。インデックス一覧、マッピング、search_after ページング、lucene q= と許可リスト経由の DSL、スナップショット/差分に対応します。",
                  ],
                  [
                    "S3 / MinIO / LocalStack",
                    "compose ファイルから検出。フォルダツリー型ブラウザ、prefix/ファイル名検索、更新日時順表示、画像/動画/音声/PDF/Markdown/HTML/テキストのプレビューに対応。LocalStack はホストポート未公開時 `docker exec curl` にフォールバックしますが、MinIO はホストポート公開が必須です。",
                  ],
                ],
              },
            ],
          },
          {
            title: "UI構成",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "マルチ DB タブ",
                    "複数のデータベースを横並びで開きます。ドラッグで並び替え、+ で空タブ追加、× / 中クリックで閉じる（最後の1枚は空タブにリセット）。並びは .code-viewer/tabs.json に保存されます。",
                  ],
                  [
                    "サイドバー",
                    "DB 選択、PostgreSQL スキーマセレクター、テーブルツリー（展開でカラム表示）、フィルター、Rails 命名規約による仮想 FK 推測トグル、Query / ER / Search / Snapshot アイコンツールバー。",
                  ],
                  [
                    "Data タブ",
                    "ページネーション付きグリッド。ソート、フィルター、セルコピー、CSV/JSON エクスポート（最大10万行、現在のフィルター/ソートを反映）。",
                  ],
                  [
                    "詳細フッタ・関連パネル",
                    "セルをクリックするとリサイズ可能な詳細フッタが開きます。外部キー値からは関連行パネルが開き、ブレッドクラム付きで多段ドリルダウン可能。outgoing (FK→PK) と incoming (PK←FK) の両方向に対応。",
                  ],
                  [
                    "Schema タブ",
                    "カラム定義、インデックス、外部キー、トリガー、DDL。",
                  ],
                  [
                    "クエリエディター",
                    "SQL シンタックスハイライト、Tab インデント、自動リサイズ、Ctrl+Enter で実行。許可文は DB 種別により異なります（SQLite: SELECT/PRAGMA/EXPLAIN/WITH。PostgreSQL と MySQL は SHOW/DESCRIBE も可）。",
                  ],
                  [
                    "ER 図",
                    "Mermaid ベースのエンティティ関係図。ズーム・パン対応。",
                  ],
                  [
                    "Search タブ",
                    "全テーブル・全テキスト列を横断する全文検索。",
                  ],
                  [
                    "Snapshot タブ",
                    "選んだテーブル / インデックス / キー空間の状態を保存し、任意の 2 つの差分（insert / update / delete + before/after）を表示します。",
                  ],
                  [
                    "クエリ履歴",
                    "マスター/ディテール表示。各エントリは browser / CLI どちらから来たかを記録し、SSE でライブ更新されます。",
                  ],
                  [
                    "データストア専用エクスプローラ",
                    "Redis / Elasticsearch / S3 はマルチ DB タブ UI を共有しつつ、テーブルツリーをキー空間ツリー / インデックスツリー / フォルダツリーに差し替えます。",
                  ],
                ],
              },
            ],
          },
          {
            title: "CLI クエリ（AIエージェント用）",
            blocks: [
              {
                kind: "paragraph",
                text: "AI エージェントは CLI から read-only クエリの実行と per-DB クエリ履歴の管理ができます。結果はブラウザでも見える同じ履歴に保存されます。Search / Snapshot / Diff は CLI ではなくブラウザ UI の Search タブ / Snapshot タブから操作します。",
              },
              {
                kind: "command",
                title: "クエリを実行",
                command:
                  'code-viewer query exec --db data.db --sql "SELECT * FROM users LIMIT 10" --title "サンプルデータ"',
              },
              {
                kind: "command",
                title: "履歴を残さずに実行",
                command:
                  'code-viewer query exec --db app.db --sql "SELECT count(*) FROM orders" --max-rows 1 --no-save',
              },
              {
                kind: "command",
                title: "履歴の一覧/削除",
                command:
                  "code-viewer query list --db app.db --json\ncode-viewer query clear --db app.db",
              },
              {
                kind: "command",
                title: "エージェント向けリファレンス",
                command: "code-viewer query agent-help",
              },
            ],
          },
        ],
      },
      skills: {
        nav: "スキル登録",
        title: "Agent Skill の登録",
        intro:
          "このパッケージには、AI エージェントが code-viewer の annotate 機能を正しく使うためのスキルが同梱されています。",
        groups: [
          {
            title: "スキルをインストールする",
            blocks: [
              {
                kind: "command",
                title: "現在のプロジェクトへ Claude Code 用に登録",
                command: "npx -y @youtyan/code-viewer skill install",
              },
              {
                kind: "command",
                title: "別のエージェント向けに登録",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent codex,gemini,cursor",
              },
              {
                kind: "command",
                title: "対応エージェントすべてに登録",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent all\n# all = claude (.claude/), codex (.codex/), gemini (.gemini/), cursor (.cursor/), agents (.agents/)",
              },
              {
                kind: "command",
                title: "ユーザー全体（プロジェクト外）へ登録",
                command:
                  "npx -y @youtyan/code-viewer skill install --agent all --global",
              },
            ],
          },
          {
            title: "スキルが教えること",
            blocks: [
              {
                kind: "table",
                rows: [
                  [
                    "いつ注釈するか",
                    "コードレビュー、オンボーディング、変更内容の解説で使うこと。",
                  ],
                  [
                    "どこへ注釈するか",
                    "--file と --line を使い、diff 範囲を説明するときは --from / --to も渡すこと。",
                  ],
                  [
                    "履歴をきれいに保つ方法",
                    "1テーマ1セッション、間違いは edit で修正、無関係な削除をしないこと。",
                  ],
                ],
              },
            ],
          },
          {
            title: "AI 向けリファレンス",
            blocks: [
              {
                kind: "paragraph",
                text: "AI エージェントは、詳細な手順が必要なときに CLI から組み込みガイドを表示できます。",
              },
              {
                kind: "command",
                title: "AI 向けガイドを表示",
                command: "code-viewer annotate agent-help",
              },
            ],
          },
        ],
      },
      keybindings: {
        nav: "キーバインド",
        title: "キーバインド",
        intro:
          "キーボードだけでパネル移動、ファイル選択、スクロールを行うためのショートカットです。",
        groups: [
          {
            title: "グローバル",
            blocks: [
              {
                kind: "table",
                rows: [
                  ["Ctrl+K", "ファイルパレットを開く"],
                  ["Ctrl+G", "grep パレットを開く"],
                  ["/", "ファイルフィルターへフォーカス"],
                  ["t", "テーマ切り替え"],
                  ["[ / ]", "前 / 次の注釈へ移動"],
                ],
              },
            ],
          },
          {
            title: "パネル",
            blocks: [
              {
                kind: "table",
                rows: [
                  ["Ctrl+H", "サイドバーへフォーカス"],
                  ["Ctrl+L", "メインパネルへフォーカス"],
                ],
              },
            ],
          },
          {
            title: "サイドバー",
            blocks: [
              {
                kind: "table",
                rows: [
                  ["j / k", "選択を下 / 上へ移動"],
                  ["Ctrl+D / Ctrl+U", "半ページ分選択を移動"],
                  ["gg / Shift+G", "先頭 / 末尾へ移動"],
                  ["Enter", "選択項目を開く"],
                  ["h / l", "ディレクトリを閉じる / 開く"],
                ],
              },
            ],
          },
          {
            title: "メインパネル",
            blocks: [
              {
                kind: "table",
                rows: [
                  ["j / k", "コードカーソルを下 / 上へ移動"],
                  ["Ctrl+D / Ctrl+U", "コードカーソルを半ページ分移動"],
                  ["gg / Shift+G", "コードカーソルを先頭 / 末尾へ移動"],
                  ["gp / gc", "Preview / Code タブへ切り替え"],
                ],
              },
            ],
          },
        ],
      },
    },
  },
};

export function helpLanguageFromRoute(route: AppRoute): HelpLanguage {
  return route.screen === "help" &&
    HELP_LANGUAGES.includes(route.lang as HelpLanguage)
    ? (route.lang as HelpLanguage)
    : "en";
}

export function helpSectionFromRoute(route: AppRoute): HelpSection {
  return route.screen === "help" &&
    HELP_SECTIONS.includes(route.section as HelpSection)
    ? (route.section as HelpSection)
    : "overview";
}

function renderHelpCommand(block: Extract<HelpBlock, { kind: "command" }>) {
  const wrap = document.createElement("div");
  wrap.className = "gdp-help-command";
  const title = document.createElement("div");
  title.className = "gdp-help-command-title";
  title.textContent = block.title;
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = block.command;
  pre.appendChild(code);
  wrap.append(title, pre);
  return wrap;
}

function renderHelpTable(rows: Array<[string, string]>) {
  const table = document.createElement("table");
  rows.forEach(([keys, description]) => {
    const tr = document.createElement("tr");
    const keyCell = document.createElement("th");
    keyCell.scope = "row";
    keys.split(" / ").forEach((key, index) => {
      if (index > 0) keyCell.append(" / ");
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      keyCell.appendChild(kbd);
    });
    const desc = document.createElement("td");
    desc.textContent = description;
    tr.append(keyCell, desc);
    table.appendChild(tr);
  });
  return table;
}

function renderHelpBlock(block: HelpBlock): HTMLElement {
  if (block.kind === "paragraph") {
    const p = document.createElement("p");
    p.textContent = block.text;
    return p;
  }
  if (block.kind === "steps") {
    const ol = document.createElement("ol");
    ol.className = "gdp-help-steps";
    block.items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      ol.appendChild(li);
    });
    return ol;
  }
  if (block.kind === "command") return renderHelpCommand(block);
  return renderHelpTable(block.rows);
}

export function createHelpPage(deps: HelpPageDeps) {
  function renderHelpPage() {
    deps.cancelActiveSourceLoad("navigation");
    deps.removeStandaloneSource();
    deps.clearLoadQueue();
    const target = deps.$("#diff");
    const empty = deps.$("#empty");
    empty.classList.add("hidden");
    deps.$("#meta").textContent = "";
    deps.$("#totals").textContent = "";
    deps.$("#filelist").textContent = "";

    const lang =
      deps.getRoute().screen === "help" &&
      new URLSearchParams(window.location.search).has("lang")
        ? helpLanguageFromRoute(deps.getRoute())
        : deps.getLanguage();
    const section = helpSectionFromRoute(deps.getRoute());
    const content = HELP_CONTENT[lang];
    const sectionContent = content.sections[section];

    const shell = document.createElement("section");
    shell.className = "gdp-help-shell";
    const header = document.createElement("header");
    header.className = "gdp-help-header";
    const title = document.createElement("h1");
    title.textContent = content.title;
    const langSelect = document.createElement("select");
    langSelect.className = "gdp-help-language";
    langSelect.setAttribute("aria-label", content.languageLabel);
    HELP_LANGUAGES.forEach((optionLang) => {
      const option = document.createElement("option");
      option.value = optionLang;
      option.textContent = optionLang.toUpperCase();
      option.selected = optionLang === lang;
      langSelect.appendChild(option);
    });
    langSelect.addEventListener("change", () => {
      const nextLang = langSelect.value as HelpLanguage;
      deps.setLanguage(nextLang);
    });
    header.append(title, langSelect);

    const layout = document.createElement("div");
    layout.className = "gdp-help-layout";
    const helpNav = document.createElement("nav");
    helpNav.className = "gdp-help-nav";
    HELP_SECTIONS.forEach((helpSection) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = helpSection === section ? "active" : "";
      button.textContent = content.sections[helpSection].nav;
      button.addEventListener("click", () => {
        deps.setRoute({
          screen: "help",
          lang,
          section: helpSection,
          range: deps.currentRange(),
        });
        renderHelpPage();
        deps.syncHeaderMenu();
      });
      helpNav.appendChild(button);
    });

    const article = document.createElement("article");
    article.className = "gdp-help-content";
    const h2 = document.createElement("h2");
    h2.textContent = sectionContent.title;
    const intro = document.createElement("p");
    intro.textContent = sectionContent.intro;
    article.append(h2, intro);
    sectionContent.groups.forEach((group) => {
      const groupSection = document.createElement("section");
      groupSection.className = "gdp-help-group";
      const groupTitle = document.createElement("h3");
      groupTitle.textContent = group.title;
      groupSection.append(groupTitle);
      group.blocks.forEach((block) => {
        groupSection.appendChild(renderHelpBlock(block));
      });
      article.appendChild(groupSection);
    });

    layout.append(helpNav, article);
    shell.append(header, layout);
    target.replaceChildren(shell);
  }

  return { renderHelpPage };
}
