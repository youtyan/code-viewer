// ヘルプのページの画面のキャプチャ (web/help-images/<名前>.<言語>.webp) を撮り直す。
// 画像を置く場所と名前は web-src/views/help-images.ts・help-text-en.ts・help-text-ja.ts。
//
//   node scripts/help-captures.mjs [--out <dir>] [--only overview,quick-help] [--lang ja]
//   node scripts/help-captures.mjs --setup-only   (砂場とサーバだけ起こして待つ)
//
// 砂場: 実データを 1 つも写さないため、HOME・状態ディレクトリ・登録簿・tmux を
// SANDBOX の下へ逃がし (.agents/skills/project-rules/references/agents.md の 10)、
// 中立な名前のリポジトリ (sample-app など) と、user@example.com などを返す偽の
// claude・codex を置いて、別のポートでサーバを起こす。サーバの PATH は砂場の
// bin/ (git・tmux・rg への リンク) と OS の既定の場所だけにする (環境ドクターに
// 利用者の道具や場所を写さない)。言語ごとに砂場を作り直す (前の言語で足した
// アカウントやエージェントが写らないように。サンプルの文も言語ごとに変える)。
// 撮影: 使い捨てのプロファイルで headless Chrome を起こし、CDP (Node の組み込みの
// WebSocket) で直接動かす。利用者のブラウザには触らない。撮り終えたら Chrome と
// サーバを止める。砂場の tmux は止めない (ログインのウィンドウは Enter で、シェルは
// Ctrl+D で閉じ、偽のエージェントは 10 分で自分で終わるので、tmux もそのうち
// 終わる)。
//
// 要るもの: Node 22 以上・Chrome か Chromium (場所は CHROME_PATH、無ければ macOS と
// Linux の既定の場所を探す)・web/app.js と dist/code-viewer.js (pnpm run build。
// ターミナルで code-viewer skill install・annotate を動かす)・tmux・git・rg・cwebp。

import { execFileSync, spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_OUT_DIR = join(REPO, "web", "help-images");
/** 画面に写るパスを短く・毎回同じにするため、固定の場所を使う。 */
const SANDBOX = "/tmp/cvdemo";
const SANDBOX_MARK = ".help-captures-sandbox";
/**
 * 画面の大きさ (CSS px)。1.5 倍の画素で撮る (ヘルプの本文の幅で縮めても文字が
 * くっきりし、全部の画像が全部の上限に収まる大きさ)。
 */
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1.5 };
/** SP の画面の大きさ (CSS px)。 */
const PHONE = { width: 390, height: 844 };
/** 切り抜く幅 (CSS px)。どの画像もこの幅 × 1.5 の画素にそろえる。 */
const FRAME_WIDTH = 800;
const FRAME_PAD = 24;
const LANGUAGES = ["en", "ja"];
/** 1 枚と全部の上限。help-page.test.ts も同じ値で見る。 */
const MAX_IMAGE_BYTES = 150 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
/**
 * 1 枚の目安。可逆で収まらなければ、収まるいちばん高い質の非可逆にする
 * (全部の画像が全部の上限に収まるように)。
 */
const TARGET_IMAGE_BYTES = 28 * 1024;
/** 非可逆の質の下限 (これより下は文字がにじむ)。 */
const MIN_QUALITY = 50;
/** 押す場所の印・番号の印 (画像に焼き込む)。 */
const MARK_COLOR = "#f2545b";
const MARK_CLASS = "help-capture-mark";
const MARK_LAYER = "help-capture-numbers";
const MARK_CSS = `.${MARK_CLASS} { outline: 3px solid ${MARK_COLOR} !important; outline-offset: 2px !important; }`;
/** 砂場のファイルの時刻 (画面の「更新日時」を毎回同じにする)。 */
const FIXED_TIME = new Date("2026-01-12T10:00:00Z");
/** 偽のエージェントが自分で終わるまで (撮り終えるまで残す)。 */
const FAKE_AGENT_LIFETIME_MS = 10 * 60 * 1000;

function parseArgs(argv) {
  const out = {
    outDir: DEFAULT_OUT_DIR,
    setupOnly: false,
    only: null,
    languages: LANGUAGES,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out.outDir = argv[++i];
    else if (arg === "--setup-only") out.setupOnly = true;
    else if (arg === "--only") out.only = new Set(argv[++i].split(","));
    else if (arg === "--lang") out.languages = argv[++i].split(",");
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${error.status}):\n${error.stdout ?? ""}${error.stderr ?? ""}`,
      { cause: error },
    );
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * PATH から実行ファイルを探す。先頭が "#!" のもの (PATH を差し替える包み) は
 * 飛ばし、本物のバイナリを返す (砂場の PATH には包みの前提の場所が無い)。
 */
function realCommand(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const path = join(dir, name);
    try {
      accessSync(path, constants.X_OK);
    } catch {
      continue;
    }
    if (!statSync(path).isFile()) continue;
    const head = Buffer.alloc(2);
    const fd = openSync(path, "r");
    try {
      readSync(fd, head, 0, 2, 0);
    } finally {
      closeSync(fd);
    }
    if (head.toString("latin1") !== "#!") return realpathSync(path);
  }
  throw new Error(`${name} (a binary, not a wrapper script) is not on PATH`);
}

// ---------------------------------------------------------------- 砂場の中身

/** 言語ごとのサンプルの文 (日本語の画像に英語の文を写さない)。 */
const SAMPLE_TEXT = {
  en: {
    readme: "A small app for trying out code-viewer.",
    libReadme: "Shared helpers for the sample app.",
    docsReadme: "Notes about the sample app.",
    commits: [
      "Start the sample app",
      "Add the settings",
      "Say goodbye as well",
      "Add the sample data",
    ],
    greetComment: "// Builds what the app says to people.",
    trimComment: "// Ignore spaces around the name.",
    featureCommit: "Greet in the morning",
    agentScreen: "(the agent's own screen appears here)",
    working: {
      prompt: "Add a farewell message",
      note: "Editing src/greeting.ts",
    },
    waiting: {
      prompt: "Run the tests",
      note: "Waiting for approval to run the tests",
    },
    tasks: [
      ["Write the release notes", "open", "2026-01-20"],
      ["Check the settings page", "done", "2026-01-15"],
      ["Try the new greeting", "open", "2026-01-22"],
      ["Update the sample data", "open", "2026-01-25"],
      ["Review the farewell text", "done", "2026-01-14"],
    ],
    markdown:
      "# Release notes\n\n## Changes\n\n| Area | Change |\n| --- | --- |\n| Greeting | Ignores spaces around the name |\n| Settings | Adds a timeout |\n\n- Starts faster\n- Clearer error messages\n",
    annotations: {
      title: "How a greeting is built",
      items: [
        {
          line: "2",
          title: "Entry point",
          body: "Every greeting starts here. `main.ts` calls it with the name.",
        },
        {
          line: "3-4",
          title: "Spaces are ignored",
          body: 'The name is trimmed first, so `" Ann "` and `"Ann"` get the same greeting. An empty name falls back to a plain hello.',
        },
        {
          line: "7-9",
          title: "The farewell",
          body: "Uses the same wording rules as the greeting.",
        },
      ],
    },
  },
  ja: {
    readme: "code-viewer を試すための小さなアプリです。",
    libReadme: "サンプルアプリの共通の部品です。",
    docsReadme: "サンプルアプリの覚え書きです。",
    commits: [
      "サンプルアプリを始める",
      "設定を足す",
      "別れのあいさつも言う",
      "サンプルのデータを足す",
    ],
    greetComment: "// 人に言うあいさつを作る。",
    trimComment: "// 名前の前後の空白は無視する。",
    featureCommit: "朝のあいさつを足す",
    agentScreen: "(ここにエージェント自身の画面が出ます)",
    working: {
      prompt: "別れのあいさつを足して",
      note: "src/greeting.ts を直しています",
    },
    waiting: {
      prompt: "テストを動かして",
      note: "テストを動かす許可を待っています",
    },
    tasks: [
      ["リリースノートを書く", "open", "2026-01-20"],
      ["設定の画面を確かめる", "done", "2026-01-15"],
      ["新しいあいさつを試す", "open", "2026-01-22"],
      ["サンプルのデータを直す", "open", "2026-01-25"],
      ["別れのあいさつの文を見直す", "done", "2026-01-14"],
    ],
    markdown:
      "# リリースノート\n\n## 変わったこと\n\n| 場所 | 変更 |\n| --- | --- |\n| あいさつ | 名前の前後の空白を無視する |\n| 設定 | 待ち時間を足す |\n\n- 起動が速くなった\n- エラーの文が分かりやすくなった\n",
    annotations: {
      title: "あいさつの作られ方",
      items: [
        {
          line: "2",
          title: "入口",
          body: "あいさつはすべてここから始まります。`main.ts` が名前を渡して呼びます。",
        },
        {
          line: "3-4",
          title: "空白は無視する",
          body: '先に名前の前後の空白を落とすので、`" Ann "` と `"Ann"` は同じあいさつになります。名前が空なら、名前なしのあいさつです。',
        },
        {
          line: "7-9",
          title: "別れのあいさつ",
          body: "あいさつと同じ決まりで文を作ります。",
        },
      ],
    },
  },
};

function greetingSource(sample, { trim, farewell }) {
  const lines = [sample.greetComment];
  lines.push("export function greeting(name: string): string {");
  if (trim) {
    lines.push(`  ${sample.trimComment}`);
    lines.push("  const trimmed = name.trim();");
    lines.push('  return trimmed ? "Hello, " + trimmed + "!" : "Hello!";');
  } else {
    lines.push('  return "Hello, " + name + "!";');
  }
  lines.push("}");
  if (farewell) {
    lines.push("");
    lines.push("export function farewell(name: string): string {");
    lines.push('  return "Goodbye, " + name.trim() + ".";');
    lines.push("}");
  }
  return `${lines.join("\n")}\n`;
}

/** サンプルの SQLite (データストアの画面)。リポジトリの .db は自動で見つかる。 */
function sampleDatabase(sample) {
  const Database = createRequire(join(REPO, "package.json"))("better-sqlite3");
  const dir = mkdtempSync(join(tmpdir(), "help-captures-db-"));
  const path = join(dir, "sample.db");
  try {
    const db = new Database(path);
    db.exec(
      "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, due TEXT NOT NULL)",
    );
    const insert = db.prepare(
      "INSERT INTO tasks (title, status, due) VALUES (?, ?, ?)",
    );
    for (const row of sample.tasks) insert.run(...row);
    db.close();
    return readFileSync(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FAKE_AGENT = `// claude・codex の代わり。呼ばれた名前 (実行ファイルの basename) で振る舞いを変える。
import { basename } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const kind = basename(process.execPath);
const args = process.argv.slice(2);
const dir = process.env.CLAUDE_CONFIG_DIR || process.env.CODEX_HOME || "";
const signedIn = !dir || existsSync(dir + "/.sample-signed-in");
// 既定のアカウントは user@、ほかは設定ディレクトリの名前から (claude-personal → personal@)。
const email = (dir ? basename(dir).replace(/^\\.?(claude|codex)-/, "") : "user") + "@example.com";
if (kind === "claude" && args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify(signedIn
    ? { loggedIn: true, email, authMethod: "claude.ai", subscriptionType: "max" }
    : { loggedIn: false }));
  process.exit(signedIn ? 0 : 1);
}
if (kind === "codex" && args[0] === "login" && args[1] === "status") {
  console.log(signedIn ? "Logged in using ChatGPT" : "Not logged in");
  process.exit(signedIn ? 0 : 1);
}
if (kind === "codex" && args[0] === "app-server") {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === 2)
      console.log(JSON.stringify({ id: 2, result: { account: { type: "chatgpt", email, planType: "plus" } } }));
    else if (message.id !== undefined) console.log(JSON.stringify({ id: message.id, result: {} }));
  });
} else if (args[0] === "auth" || args[0] === "login") {
  if (dir) writeFileSync(dir + "/.sample-signed-in", "");
  console.log("Signed in.");
} else {
  process.stdout.write("\\x1b]2;sample-app\\x07");
  console.log(process.env.HELP_CAPTURE_AGENT_SCREEN);
  // 撮り終えたら終わる (ウィンドウが閉じ、砂場の tmux も終わる)。
  setTimeout(() => process.exit(0), ${FAKE_AGENT_LIFETIME_MS});
}
`;

function writeFile(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode ? { mode } : undefined);
}

function touchTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) touchTree(path);
    utimesSync(path, FIXED_TIME, FIXED_TIME);
  }
}

function gitEnv(root) {
  const env = {
    ...process.env,
    HOME: join(root, "home"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  delete env.XDG_CONFIG_HOME;
  return env;
}

function commitAll(git, dir, message, index) {
  const date = `2026-01-${String(10 + index).padStart(2, "0")}T10:00:00Z`;
  run(git.path, ["-C", dir, "add", "-A"], { env: git.env });
  run(git.path, ["-C", dir, "commit", "-q", "-m", message], {
    env: { ...git.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

function makeRepo(git, root, uncommitted, commits) {
  mkdirSync(root, { recursive: true });
  run(git.path, ["-C", root, "init", "-q", "-b", "main"], { env: git.env });
  // サーバがリポジトリに作る .code-viewer/ と、作業ツリーの置き場を変更の一覧に出さない。
  writeFile(
    join(root, ".git", "info", "exclude"),
    ".code-viewer/\n.worktrees/\n",
  );
  commits.forEach((commit, index) => {
    for (const [name, content] of Object.entries(commit.files))
      writeFile(join(root, name), content);
    commitAll(git, root, commit.message, index);
  });
  for (const [name, content] of Object.entries(uncommitted))
    writeFile(join(root, name), content);
  touchTree(root);
}

function prepareSandbox(lang) {
  if (existsSync(SANDBOX)) {
    if (!existsSync(join(SANDBOX, SANDBOX_MARK)))
      throw new Error(
        `${SANDBOX} exists and was not made by this script; move it away first`,
      );
    rmSync(SANDBOX, { recursive: true, force: true });
  }
  for (const dir of ["home", "registry", "bin", "bin-no-tmux", "libexec"])
    mkdirSync(join(SANDBOX, dir), { recursive: true });
  writeFile(join(SANDBOX, SANDBOX_MARK), "");
  const root = realpathSync(SANDBOX);
  const home = join(root, "home");
  const sample = SAMPLE_TEXT[lang];
  // 対話シェル (claude・codex の起動と状態の確認もこれを通る) は /etc の zshrc を
  // 読まない: 利用者名・マシン名をプロンプトに出し、補完の初期化で遅く、
  // /etc/zshenv が決め直した PATH の後で bin/ を先頭に戻せないため。
  writeFile(
    join(home, ".zshenv"),
    `unsetopt GLOBAL_RCS\npath=(${join(root, "bin")} $path)\n`,
  );
  writeFile(
    join(home, ".zshrc"),
    "PROMPT='%1~ %# '\nRPROMPT=''\nPROMPT_EOL_MARK=''\n",
  );
  // tmux の最下行はマシン名と時刻を出すので消す。
  writeFile(join(home, ".tmux.conf"), "set -g status off\n");
  writeFile(
    join(home, ".gitconfig"),
    "[user]\n\tname = Sample User\n\temail = user@example.com\n",
  );
  // 既定のアカウントの設定ディレクトリ (無いと「未ログイン」になる) と、
  // 「新しく作る」でリンクされる設定。
  writeFile(join(home, ".claude", "settings.json"), "{}\n");
  writeFile(join(home, ".claude", "CLAUDE.md"), "# Notes for the agent\n");
  mkdirSync(join(home, ".codex"), { recursive: true });
  mkdirSync(join(home, ".claude-work"), { recursive: true });
  // 偽の claude・codex は node の写し (ペインの前面のコマンド名が種類を決める)。
  // PATH の先頭の bin/ から呼ばれる。起動コマンドは既定 (claude・codex) のまま。
  writeFile(join(root, "libexec", "fake-agent.mjs"), FAKE_AGENT);
  const tools = {
    git: realCommand("git"),
    tmux: realCommand("tmux"),
    rg: realCommand("rg"),
    // tsx とサーバの子は PATH の node を呼ぶ。
    node: process.execPath,
  };
  for (const bin of ["bin", "bin-no-tmux"]) {
    for (const kind of ["claude", "codex"])
      writeFile(
        join(root, bin, kind),
        `#!/bin/sh\nexec ${root}/libexec/${kind} ${root}/libexec/fake-agent.mjs "$@"\n`,
        0o755,
      );
    writeFile(
      join(root, bin, "code-viewer"),
      `#!/bin/sh\nexec "${process.execPath}" "${join(REPO, "dist", "code-viewer.js")}" "$@"\n`,
      0o755,
    );
    for (const [name, path] of Object.entries(tools))
      if (bin === "bin" || name !== "tmux")
        symlinkSync(path, join(root, bin, name));
  }
  for (const kind of ["claude", "codex"])
    copyFileSync(process.execPath, join(root, "libexec", kind));
  const git = { path: tools.git, env: gitEnv(root) };
  // リポジトリと状態ディレクトリは HOME の下に置く (画面が ~/ で短く出す)。
  const work = join(home, "work");
  const app = join(work, "sample-app");
  makeRepo(
    git,
    app,
    {
      "src/greeting.ts": greetingSource(sample, { trim: true, farewell: true }),
      "src/config.ts":
        "export const config = {\n  port: 8080,\n  retries: 3,\n  timeoutMs: 5000,\n};\n",
    },
    [
      {
        message: sample.commits[0],
        files: {
          "README.md": `# sample-app\n\n${sample.readme}\n`,
          "package.json":
            '{\n  "name": "sample-app",\n  "version": "1.0.0",\n  "type": "module"\n}\n',
          "src/main.ts":
            'import { farewell, greeting } from "./greeting";\n\nconsole.log(greeting("world"));\nconsole.log(farewell("world"));\n',
          "src/greeting.ts": greetingSource(sample, {
            trim: false,
            farewell: false,
          }),
        },
      },
      {
        message: sample.commits[1],
        files: {
          "src/config.ts":
            "export const config = {\n  port: 8080,\n  retries: 2,\n};\n",
        },
      },
      {
        message: sample.commits[2],
        files: {
          "src/greeting.ts": greetingSource(sample, {
            trim: false,
            farewell: true,
          }),
        },
      },
      {
        message: sample.commits[3],
        files: { "sample.db": sampleDatabase(sample) },
      },
    ],
  );
  // 作業ツリー 2 つ。1 つは本体と同じ src/greeting.ts を変えている (上の帯に出る)。
  // サンプルのデータの前のコミットから作る (写しの sample.db もデータストアに出るため)。
  const greetingTree = join(app, ".worktrees", "greeting");
  run(
    git.path,
    [
      "-C",
      app,
      "worktree",
      "add",
      "-q",
      "-b",
      "greeting",
      greetingTree,
      "HEAD~1",
    ],
    {
      env: git.env,
    },
  );
  writeFile(
    join(greetingTree, "src", "greeting.ts"),
    `${greetingSource(sample, { trim: false, farewell: true })}\nexport function morning(name: string): string {\n  return "Good morning, " + name + "!";\n}\n`,
  );
  commitAll(git, greetingTree, sample.featureCommit, 4);
  const docsTree = join(app, ".worktrees", "docs");
  run(
    git.path,
    ["-C", app, "worktree", "add", "-q", "-b", "docs", docsTree, "HEAD~1"],
    {
      env: git.env,
    },
  );
  writeFile(
    join(docsTree, "README.md"),
    `# sample-app\n\n${sample.readme}\n\n${sample.docsReadme}\n`,
  );
  touchTree(join(app, ".worktrees"));
  makeRepo(git, join(work, "sample-lib"), {}, [
    {
      message: sample.commits[0],
      files: {
        "README.md": `# sample-lib\n\n${sample.libReadme}\n`,
        "src/index.ts": "export const version = 1;\n",
      },
    },
  ]);
  makeRepo(git, join(work, "sample-docs"), {}, [
    {
      message: sample.commits[0],
      files: { "README.md": `# sample-docs\n\n${sample.docsReadme}\n` },
    },
  ]);
  return root;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** 砂場のサーバ・CLI の環境。bin は "bin" か、tmux の無い "bin-no-tmux"。 */
function sandboxEnv(root, tmuxDir, lang, bin = "bin") {
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (
      name.startsWith("XDG_") ||
      name.startsWith("TMUX") ||
      name.startsWith("CLAUDE") ||
      name.startsWith("CODEX") ||
      name.startsWith("LC_") ||
      name.startsWith("npm_") ||
      name === "FORCE_COLOR"
    )
      delete env[name];
  return {
    ...env,
    HOME: join(root, "home"),
    SHELL: "/bin/zsh",
    LANG: "en_US.UTF-8",
    PATH: [join(root, bin), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(
      delimiter,
    ),
    CODE_VIEWER_TEST_STATE_DIR: join(
      root,
      "home",
      ".local",
      "state",
      "code-viewer",
    ),
    CODE_VIEWER_TEST_SERVER_REGISTRY_DIR: join(root, "registry"),
    TMUX_TMPDIR: tmuxDir,
    HELP_CAPTURE_AGENT_SCREEN: SAMPLE_TEXT[lang].agentScreen,
  };
}

async function startServer(root, lang, bin = "bin") {
  const port = await freePort();
  // unix ソケットのパス長の上限があるので、tmux の置き場は短いパスにする。
  const tmuxDir = mkdtempSync("/tmp/cvdt.");
  const cwd = join(root, "home", "work", "sample-app");
  const env = sandboxEnv(root, tmuxDir, lang, bin);
  const child = spawn(
    join(REPO, "node_modules", ".bin", "tsx"),
    [
      join(REPO, "web-src", "server", "cli.ts"),
      "--cwd",
      cwd,
      "--port",
      String(port),
      "--idle-stop",
      "0",
    ],
    { cwd, env, stdio: ["ignore", "inherit", "inherit"] },
  );
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  let lastError = null;
  for (;;) {
    if (child.exitCode !== null)
      throw new Error(`the server exited with ${child.exitCode}`);
    try {
      const res = await fetch(`${origin}/`);
      if (res.ok) return { child, origin, tmuxDir, env, projectUrl: res.url };
      lastError = new Error(`GET / answered ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline)
      throw new Error(`the server did not answer on ${origin}`, {
        cause: lastError,
      });
    await sleep(300);
  }
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  const exited = new Promise((resolve) => server.child.once("exit", resolve));
  server.child.kill("SIGTERM");
  await exited;
}

async function api(url, method, body) {
  const origin = new URL(url).origin;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "X-Code-Viewer-Action": "1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${url} answered ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/** 砂場の code-viewer の CLI を sample-app で動かす (annotate など)。 */
function sandboxCli(root, server, args, input) {
  return run(join(root, "bin", "code-viewer"), args, {
    cwd: join(root, "home", "work", "sample-app"),
    env: server.env,
    input,
  });
}

async function seedServer(root, server, lang) {
  const project = server.projectUrl.replace(/\/$/, "");
  await api(`${project}/_state/settings`, "PATCH", { language: lang });
  await api(`${server.origin}/_agent/accounts`, "POST", {
    op: "register",
    agent: "claude",
    name: "Work",
    configDir: join(root, "home", ".claude-work"),
  });
  await api(`${server.origin}/_agent/projects`, "POST", {
    action: "add",
    path: join(root, "home", "work", "sample-lib"),
  });
  // エージェント連携の節で codex だけ「設定済み」にする (claude は画面で入れる例)。
  const plan = await api(
    `${server.origin}/_agent/hooks/plan?agent=codex&action=install`,
    "GET",
  );
  await api(`${server.origin}/_agent/hooks/apply`, "POST", {
    agent: plan.agent,
    action: plan.action,
    baseHash: plan.baseHash,
    realPath: plan.realPath,
    fileIdentity: plan.fileIdentity,
  });
  // 本物の claude・codex を起こしていないことを、偽物だけが返すメールアドレスで
  // 確かめる (本物は HOME の外 (キーチェーン) の認証を読むので、利用者の
  // メールアドレスを返しうる)。
  const { accounts } = await api(
    `${server.origin}/_agent/accounts?login=refresh`,
    "GET",
  );
  const who = accounts.map((account) => [account.id, account.login?.who]);
  const stand = new Map(who);
  if (
    stand.get("claude:default") !== "user@example.com" ||
    stand.get("codex:default") !== "user@example.com" ||
    who.some(([, email]) => email && !email.endsWith("@example.com"))
  )
    throw new Error(
      `the sandbox accounts do not answer with the stand-in claude/codex: ${JSON.stringify(
        accounts.map((account) => ({
          id: account.id,
          state: account.login?.state,
          detail: account.login?.detail,
        })),
      )}`,
    );
  return accounts;
}

// ---------------------------------------------------------------- ブラウザ

/** CHROME_PATH が無いときに探す場所 (macOS と Linux の既定)。 */
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function chromePath() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv))
      throw new Error(`CHROME_PATH points to a missing file: ${fromEnv}`);
    return fromEnv;
  }
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found)
    throw new Error(
      `no Chrome found: set CHROME_PATH (looked at ${CHROME_CANDIDATES.join(", ")})`,
    );
  return found;
}

/** 使い捨てのプロファイルで headless Chrome を起こし、CDP の口が開くまで待つ。 */
async function startChrome() {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "help-captures-chrome-"));
  const child = spawn(
    chromePath(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--lang=en-US",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  let lastError = null;
  for (;;) {
    if (child.exitCode !== null)
      throw new Error(`Chrome exited with ${child.exitCode}:\n${stderr}`);
    try {
      const res = await fetch(`${endpoint}/json/version`);
      if (res.ok) break;
      lastError = new Error(`GET /json/version answered ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline)
      throw new Error(`Chrome did not open its CDP port:\n${stderr}`, {
        cause: lastError,
      });
    await sleep(200);
  }
  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
    rmSync(profile, { recursive: true, force: true });
  };
  return { child, endpoint, stop };
}

/** CDP の 1 本の接続 (Node の組み込みの WebSocket)。 */
class Cdp {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener(
        "error",
        (event) =>
          reject(new Error(`could not connect to ${url}`, { cause: event })),
        { once: true },
      );
    });
    return new Cdp(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error)
        waiting.reject(
          new Error(
            `${waiting.method} failed: ${JSON.stringify(message.error)}`,
          ),
        );
      else waiting.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const waiting of this.pending.values())
        waiting.reject(
          new Error(`the CDP connection closed during ${waiting.method}`),
        );
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

/** 新しいページを開いてつなぐ。 */
async function openPage(endpoint) {
  const res = await fetch(`${endpoint}/json/new?about:blank`, {
    method: "PUT",
  });
  if (!res.ok)
    throw new Error(
      `PUT /json/new answered ${res.status}: ${await res.text()}`,
    );
  const target = await res.json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  // headless でも焦点のある窓として振る舞わせる (xterm の入力欄・:focus)。
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  return { cdp, targetId: target.id };
}

async function closePage(endpoint, page) {
  page.cdp.close();
  const res = await fetch(`${endpoint}/json/close/${page.targetId}`);
  if (!res.ok)
    throw new Error(
      `GET /json/close answered ${res.status}: ${await res.text()}`,
    );
}

/** ページで動かす関数の共通部分。 */
const PRELUDE = `
const visible = (el) => !!el && el.getClientRects().length > 0;
const must = (el, what) => { if (!el) throw new Error("not found: " + what); return el; };
// root が無い (小窓がまだ開いていない) ときは見つからないものとして null。
const byText = (root, selector, text) =>
  !root ? null : ([...root.querySelectorAll(selector)].filter(visible).find((el) => el.textContent.trim() === text) ?? null);
const dialog = () => document.querySelector(".gdp-dialog");
const menu = () => [...document.querySelectorAll(".gdp-context-menu")].find(visible) ?? null;
const rectOf = (target) => {
  const r = target instanceof Element ? target.getBoundingClientRect() : target;
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};
const union = (...targets) => {
  const rects = targets.map(rectOf);
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
};
const mark = (el) => {
  if (!document.getElementById("help-capture-style")) {
    const style = document.createElement("style");
    style.id = "help-capture-style";
    style.textContent = ${JSON.stringify(MARK_CSS)};
    document.head.append(style);
  }
  el.classList.add(${JSON.stringify(MARK_CLASS)});
  return el;
};
// 番号の印: 範囲ごとに赤い枠と、左上に番号の丸 (本文の ①〜⑤ と同じ番号)。
// 細い範囲 (タブ列・最下段) は丸を枠の中の縦の真ん中に、side ("left" か "right") の端に置く。
const markNumbers = (items) => {
  const layer = document.createElement("div");
  layer.className = ${JSON.stringify(MARK_LAYER)};
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  for (const [target, label, side = "left"] of items) {
    const r = rectOf(target);
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;box-sizing:border-box;border:3px solid ${MARK_COLOR};border-radius:6px;" +
      "left:" + (r.x + 2) + "px;top:" + (r.y + 2) + "px;width:" + (r.width - 4) + "px;height:" + (r.height - 4) + "px";
    const badge = document.createElement("div");
    badge.textContent = label;
    const thin = r.height < 48;
    const size = thin ? Math.min(28, r.height - 8) : 28;
    const top = thin ? (r.height - 4 - 6 - size) / 2 : 6;
    const edge = (side === "right" ? "right:" : "left:") + (thin ? 40 : 6) + "px;";
    badge.style.cssText = "position:absolute;border-radius:50%;background:${MARK_COLOR};color:#fff;text-align:center;" +
      "box-shadow:0 1px 4px rgba(0,0,0,.45);font:700 " + Math.round(size * 0.62) + "px/" + size + "px system-ui,-apple-system,sans-serif;" +
      "width:" + size + "px;height:" + size + "px;top:" + top + "px;" + edge;
    box.append(badge);
    layer.append(box);
  }
  document.body.append(layer);
};
const accountRow = (name) =>
  [...document.querySelectorAll(".agent-accounts-row")].find((row) => row.textContent.includes(name)) ?? null;
const setField = (field, value) => {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  field.focus();
  Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
};
`;

/** body は関数の中身。戻り値を JSON で返す。ページで投げられたものはそのまま出す。 */
async function page(cdp, body) {
  const expression = `(async () => { ${PRELUDE}\nreturn JSON.stringify(await (async () => { ${body} })() ?? null); })()`;
  const answer = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (answer.exceptionDetails)
    throw new Error(
      `the page threw: ${answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text}\n--- evaluated ---\n${body}`,
    );
  return JSON.parse(answer.result.value);
}

async function screenshot(cdp, path, clip) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    ...(clip ? { clip } : {}),
  });
  writeFileSync(path, Buffer.from(data, "base64"));
}

async function waitFor(cdp, what, body, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await page(cdp, body);
    if (value) return value;
    if (Date.now() > deadline) {
      const picture = join(tmpdir(), `help-captures-timeout-${Date.now()}.png`);
      await screenshot(cdp, picture);
      throw new Error(
        `timed out waiting for ${what} on ${await page(cdp, "return location.href;")} (last value ${JSON.stringify(value)}; the screen is in ${picture})`,
      );
    }
    await sleep(250);
  }
}

async function setViewport(cdp, width, height = VIEWPORT.height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...VIEWPORT,
    width,
    height,
    mobile: false,
  });
  // 大きさが変わると、開いたメニューや小窓は閉じる。変わり終えてから次へ進む。
  await waitFor(
    cdp,
    `the viewport to be ${width}x${height}`,
    `return innerWidth === ${width} && innerHeight === ${height};`,
  );
  await sleep(300);
}

/** 焦点のある要素に文字を入れる (IME の確定と同じ入り方。xterm も受け取る)。 */
async function typeText(cdp, text) {
  await cdp.send("Input.insertText", { text });
}

const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  "Control+d": {
    key: "d",
    code: "KeyD",
    windowsVirtualKeyCode: 68,
    modifiers: 2,
  },
};

async function pressKey(cdp, name) {
  const key = KEYS[name];
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
}

/** ページの中のキーの出来事 (アプリのキーの割り当てを通す)。 */
async function pageKey(cdp, init) {
  await page(
    cdp,
    `
    document.activeElement?.blur();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { ...${JSON.stringify(init)}, bubbles: true }));
  `,
  );
}

/** マウスで from から to へドラッグする (CSS px)。 */
async function drag(cdp, from, to) {
  const move = (type, point, buttons) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x: point.x,
      y: point.y,
      button: "left",
      buttons,
      clickCount: 1,
    });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: from.x,
    y: from.y,
  });
  await move("mousePressed", from, 1);
  for (let step = 1; step <= 6; step++)
    await move(
      "mouseMoved",
      {
        x: from.x + ((to.x - from.x) * step) / 6,
        y: from.y + ((to.y - from.y) * step) / 6,
      },
      1,
    );
  await move("mouseReleased", to, 0);
}

/**
 * PNG を WebP にする。文字の画面は可逆のほうがくっきりするので、可逆が目安に
 * 収まればそれを使い、収まらなければ非可逆にする。
 */
function encodeWebp(png, out) {
  run("cwebp", ["-quiet", "-lossless", "-z", "6", png, "-o", out]);
  if (statSync(out).size <= TARGET_IMAGE_BYTES) return "lossless";
  // 非可逆は、目安に収まるいちばん高い質を二分探索で探す。
  const lossy = (quality) => {
    run("cwebp", [
      "-quiet",
      "-q",
      String(quality),
      "-m",
      "4",
      "-sharp_yuv",
      png,
      "-o",
      out,
    ]);
    return statSync(out).size;
  };
  let low = MIN_QUALITY;
  let high = 95;
  let best = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lossy(mid) <= TARGET_IMAGE_BYTES) {
      best = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  // 最低の質でも目安を超えるなら、最低の質のまま (1 枚の上限は呼び出し元が見る)。
  const quality = best ?? MIN_QUALITY;
  lossy(quality);
  return `q${quality}`;
}

function writeCapture(ctx, name, png) {
  const out = join(ctx.outDir, `${name}.${ctx.lang}.webp`);
  const encoding = encodeWebp(png, out);
  const bytes = statSync(out).size;
  if (bytes > MAX_IMAGE_BYTES)
    throw new Error(`${out} is ${bytes} bytes, over ${MAX_IMAGE_BYTES}`);
  return { out, bytes, encoding };
}

const wanted = (ctx, name) => !ctx.only || ctx.only.has(name);

/**
 * 1 枚撮る。frame はページで動かす関数の中身で、写す範囲の要素か
 * { x, y, width, height } (CSS px) を返す。"window" なら画面全体を縮めて使う。
 * options.mark は押す場所の要素を返す式 (赤い枠を焼き込む)、options.numbers は
 * [要素か範囲, 番号] の並びを返す式 (番号の印を焼き込む)。
 */
async function shot(ctx, name, frame, options = {}) {
  if (!wanted(ctx, name)) return;
  const { cdp } = ctx;
  // 入力欄などの焦点の枠を写さない。
  if (!options.keepFocus) await page(cdp, "document.activeElement?.blur();");
  // ポインタを右の端の真ん中 (最下段のボタンに掛からない所) へ退け、前の操作のホバーの枠やツールチップを写さない。
  const corner = await page(
    cdp,
    "return { x: innerWidth - 2, y: Math.round(innerHeight / 2) };",
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...corner });
  await sleep(600);
  // 印は撮る直前に付ける (画面が描き直すと、先に付けた印は消える)。
  if (options.mark)
    await page(cdp, `mark(must(${options.mark}, "the mark of ${name}"));`);
  if (options.numbers) await page(cdp, `markNumbers(${options.numbers});`);
  const view = await page(cdp, "return { w: innerWidth, h: innerHeight };");
  let clip;
  if (frame === "window") {
    clip = {
      x: 0,
      y: 0,
      width: view.w,
      height: view.h,
      scale: FRAME_WIDTH / view.w,
    };
  } else {
    const box = await page(cdp, `return rectOf((() => { ${frame} })());`);
    if (!(box.width > 0 && box.height > 0))
      throw new Error(`${name}: the frame is empty ${JSON.stringify(box)}`);
    const center = box.x + box.width / 2;
    const x = Math.round(
      Math.min(Math.max(center - FRAME_WIDTH / 2, 0), view.w - FRAME_WIDTH),
    );
    const y = Math.round(Math.max(box.y - FRAME_PAD, 0));
    const bottom = Math.round(Math.min(box.y + box.height + FRAME_PAD, view.h));
    clip = { x, y, width: FRAME_WIDTH, height: bottom - y, scale: 1 };
  }
  const png = join(ctx.tmp, `${name}.${ctx.lang}.png`);
  await screenshot(cdp, png, clip);
  await page(
    cdp,
    `document.querySelectorAll(".${MARK_CLASS}").forEach((el) => el.classList.remove("${MARK_CLASS}"));
     document.querySelectorAll(".${MARK_LAYER}").forEach((el) => el.remove());`,
  );
  const { out, bytes, encoding } = writeCapture(ctx, name, png);
  console.log(
    `${out}: ${bytes} bytes (${encoding}), clip ${JSON.stringify(clip)}`,
  );
}

/**
 * SP の画面を撮る。狭い画面をそのまま撮り、FRAME_WIDTH の幅の地の中央に
 * 置いた 1 枚にする (どの画像も同じ幅にそろえるため)。
 */
async function phoneShot(ctx, name) {
  if (!wanted(ctx, name)) return;
  const { cdp } = ctx;
  await page(cdp, "document.activeElement?.blur();");
  await sleep(600);
  const background = await page(
    cdp,
    "return getComputedStyle(document.body).backgroundColor;",
  );
  const phonePng = join(ctx.tmp, `${name}.${ctx.lang}.phone.png`);
  await screenshot(cdp, phonePng);
  const canvas = await openPage(ctx.endpoint);
  try {
    await setViewport(canvas.cdp, FRAME_WIDTH, PHONE.height + 2 * FRAME_PAD);
    const data = readFileSync(phonePng).toString("base64");
    const html = `<!doctype html><html><body style="margin:0;background:${background};display:flex;justify-content:center;align-items:center;height:100vh"><img src="data:image/png;base64,${data}" style="width:${PHONE.width}px;height:${PHONE.height}px;border-radius:12px;box-shadow:0 0 0 1px rgba(128,128,128,.45)"></body></html>`;
    await canvas.cdp.send("Page.navigate", {
      url: `data:text/html;base64,${Buffer.from(html).toString("base64")}`,
    });
    await waitFor(
      canvas.cdp,
      "the phone picture",
      `return document.querySelector("img")?.complete === true;`,
    );
    const png = join(ctx.tmp, `${name}.${ctx.lang}.png`);
    await screenshot(canvas.cdp, png);
    const { out, bytes, encoding } = writeCapture(ctx, name, png);
    console.log(`${out}: ${bytes} bytes (${encoding}), phone composite`);
  } finally {
    await closePage(ctx.endpoint, canvas);
  }
}

/** 左のサイドバーとファイルの一覧を、開く (true) か畳む (false)。 */
async function setPageColumns(cdp, open) {
  await page(
    cdp,
    `
    const want = ${open};
    if (visible(document.querySelector("#app-nav .nav-search")) !== want)
      must(document.querySelector(want ? "#nav-expand" : "#nav-collapse"), "the sidebar toggle").click();
    if (visible(document.querySelector("#file-list")) !== want)
      must(document.querySelector("#sidebar-toggle"), "the file list toggle").click();
  `,
  );
  await waitFor(
    cdp,
    "the columns",
    `return visible(document.querySelector("#app-nav .nav-search")) === ${open} &&
      visible(document.querySelector("#file-list")) === ${open};`,
  );
}

async function clickMainTab(cdp, kind, label) {
  await page(
    cdp,
    `
    const tab = [...document.querySelectorAll('.main-tab[data-kind="${kind}"]')]
      .find((el) => el.textContent.includes(${JSON.stringify(label)}));
    must(tab, "the ${kind} tab " + ${JSON.stringify(label)}).click();
  `,
  );
}

// ---------------------------------------------------------------- 撮る画面

async function captureLanguage(options, chrome, lang, text) {
  const root = prepareSandbox(lang);
  let server = await startServer(root, lang);
  console.log(
    `[${lang}] sandbox ${root}, server ${server.origin} (pid ${server.child.pid}), tmux ${server.tmuxDir}`,
  );
  const stop = () => {
    if (server.child.exitCode === null) server.child.kill("SIGTERM");
  };
  process.on("exit", stop);
  try {
    const accounts = await seedServer(root, server, lang);
    const standIns = await launchStandIns(root, server, accounts);
    if (options.setupOnly) {
      console.log(`setup only: ${server.projectUrl} — Ctrl+C stops the server`);
      await new Promise((resolve) => server.child.on("exit", resolve));
      return;
    }
    const tab = await openPage(chrome.endpoint);
    const ctx = {
      cdp: tab.cdp,
      endpoint: chrome.endpoint,
      lang,
      only: options.only,
      outDir: options.outDir,
      tmp: mkdtempSync(join(tmpdir(), "help-captures-")),
      root,
      server,
      standIns,
      text,
      sample: SAMPLE_TEXT[lang],
    };
    try {
      await setViewport(ctx.cdp, VIEWPORT.width);
      await ctx.cdp.send("Page.navigate", { url: server.projectUrl });
      await captureScreens(ctx);
      // tmux が無いときのサイドバー: tmux を PATH から外したサーバで起こし直す。
      if (wanted(ctx, "sidebar-no-tmux")) {
        await stopServer(server);
        server = await startServer(root, lang, "bin-no-tmux");
        ctx.server = server;
        await captureNoTmux(ctx);
      }
    } finally {
      await closePage(chrome.endpoint, tab);
      // 撮ったままの PNG は要らない。
      rmSync(ctx.tmp, { recursive: true, force: true });
    }
  } finally {
    stop();
    process.off("exit", stop);
  }
}

async function captureScreens(ctx) {
  const { cdp, server, text, sample } = ctx;
  const inPage = (body) => page(cdp, body);
  const wait = (what, body, timeoutMs) => waitFor(cdp, what, body, timeoutMs);
  const a = text.accounts;
  const terminalRows = `document.querySelector(".main-pane-host.is-shown .xterm-rows")?.textContent`;
  const terminalInput = ".main-pane-host.is-shown .xterm-helper-textarea";
  const focusTerminal = () =>
    inPage(
      `must(document.querySelector("${terminalInput}"), "terminal input").focus();`,
    );
  const viewLink = (path) =>
    `must(document.querySelector('#panel-head a.view-strip-item[href$="${path}"]'), "the ${path} link")`;
  const setColumns = (open) => setPageColumns(cdp, open);
  // 行を選んだときの「AI 用の参照をコピー」の帯を閉じる。
  const closeLinePill = async () => {
    await inPage(`
      const pill = document.querySelector("#line-ref-pill");
      if (visible(pill)) must(document.querySelector("#line-ref-pill-close"), "the pill close button").click();
    `);
    await wait(
      "the line reference to close",
      `return !visible(document.querySelector("#line-ref-pill"));`,
    );
  };
  const closeMenus = async () => {
    await pressKey(cdp, "Escape");
    await wait("the menu to close", "return !menu();");
  };
  await wait(
    "the app",
    `return visible(document.querySelector("#nav-launch"));`,
  );
  // headless でも前面の見える画面として描かれていること (背面扱いだと xterm も
  // 差分の読み込みも進まない)。
  if (await inPage("return document.hidden;"))
    throw new Error("the headless page reports document.hidden");

  // --- アカウントを追加する: ヘルプの案内のリンクから 設定 › アカウント を開く。
  await cdp.send("Page.navigate", {
    url: `${server.projectUrl}help?section=add-account`,
  });
  const accountsLink = `[...document.querySelectorAll('#content a[href$="/settings"]')].find((link) => visible(link) && link.textContent.includes(${JSON.stringify(text.accountsCategory)}))`;
  await wait("the help link to the accounts", `return !!${accountsLink};`);
  await inPage(`${accountsLink}.click();`);
  await wait(
    "the accounts to be checked",
    `return accountRow("Work") &&
      (document.querySelector(".agent-accounts-section").textContent.match(/user@example\\.com/g) ?? []).length === 2;`,
  );
  const addButton = `must(byText(document, "button", ${JSON.stringify(a.add)}), "add account button")`;
  await shot(
    ctx,
    "accounts-list",
    `return union(document.querySelector(".agent-accounts-table"), ${addButton});`,
    { mark: addButton },
  );
  await inPage(`${addButton}.click();`);
  await wait(
    "the add dialog",
    `return visible(dialog()?.querySelector("input"));`,
  );
  await inPage(
    `setField(must([...dialog().querySelectorAll("input")].find(visible), "name field"), "Personal");`,
  );
  const review = `must(byText(dialog(), "button", ${JSON.stringify(a.addNext)}), "review")`;
  await shot(ctx, "accounts-add", `return dialog();`, { mark: review });
  await inPage(`${review}.click();`);
  const create = `byText(dialog(), "button", ${JSON.stringify(a.createRun)})`;
  await wait("the review", `return ${create};`);
  await shot(ctx, "accounts-review", `return dialog();`, { mark: create });
  await inPage(`${create}.click();`);
  await wait("the new row", `return !dialog() && accountRow("Personal");`);
  const signIn = `must(byText(accountRow("Personal"), "button", ${JSON.stringify(a.loginButton)}), "sign in")`;
  // 一覧の表と、その下の［アカウントを追加］まで (途中で切らない)。
  const accountRows = `return union(document.querySelector(".agent-accounts-table"), ${addButton});`;
  await shot(ctx, "accounts-sign-in", accountRows, { mark: signIn });
  await inPage(`${signIn}.click();`);
  // ログインのウィンドウがターミナルのタブで前に出るので、設定のタブへ戻る。
  await wait(
    "the sign-in tab",
    `return document.querySelectorAll('.main-tab[data-kind="terminal"]').length === 1;`,
  );
  await clickMainTab(cdp, "page", text.settings);
  await wait(
    "the signed-in row",
    `return accountRow("Personal")?.textContent.includes("personal@example.com");`,
    30_000,
  );
  await shot(ctx, "accounts-signed-in", accountRows, {
    mark: `accountRow("Personal")`,
  });
  // ログインのウィンドウは Enter を待って残るので、Enter で閉じる (砂場の tmux に
  // 残さない)。閉じた後は設定のタブに戻す。
  await inPage(
    `document.querySelector('.main-tab[data-kind="terminal"]').click();`,
  );
  await wait(
    "the sign-in window to wait for Enter",
    `return ${terminalRows}?.includes("sign-in command exited with 0");`,
  );
  await focusTerminal();
  await pressKey(cdp, "Enter");
  await wait(
    "the sign-in window to close",
    `return !${terminalRows}?.includes("sign-in command exited with 0");`,
  );
  await clickMainTab(cdp, "page", text.settings);

  // --- フック: 設定 › エージェント の エージェント連携 の節と、入れる前の確認。
  await inPage(
    `must(byText(document, "button, a", ${JSON.stringify(text.agentsCategory)}), "the agents category").click();`,
  );
  const hookRow = (agent) =>
    `[...document.querySelectorAll(".agent-hooks-row")].find((row) => row.querySelector(".agent-hooks-name")?.textContent.trim() === "${agent}")`;
  await wait(
    "the hooks rows",
    `return ${hookRow("codex")}?.querySelector(".agent-hooks-state-installed") && ${hookRow("claude")}?.querySelector(".agent-hooks-state-none");`,
  );
  const hookInstall = `must(${hookRow("claude")}.querySelector(".agent-hooks-action"), "the claude set-up button")`;
  await inPage(
    `document.querySelector(".agent-hooks-section").scrollIntoView({ block: "center" });`,
  );
  await shot(
    ctx,
    "hooks-section",
    `return document.querySelector(".agent-hooks-section");`,
    { mark: hookInstall },
  );
  await inPage(`${hookInstall}.click();`);
  const hookRun = `byText(dialog(), "button", ${JSON.stringify(text.hooks.run.install)})`;
  await wait("the hooks dialog", `return ${hookRun};`);
  await shot(ctx, "hooks-dialog", `return dialog();`, { mark: hookRun });
  await inPage(`dialog().querySelector(".gdp-dialog-cancel").click();`);
  await wait("the hooks dialog to close", "return !dialog();");

  // --- エージェントを起動する
  await shot(
    ctx,
    "agent-new",
    `
    const button = document.querySelector("#nav-launch").getBoundingClientRect();
    return { x: 0, y: button.y - 240, width: ${FRAME_WIDTH}, height: innerHeight - (button.y - 240) - ${FRAME_PAD} };
  `,
    { mark: `document.querySelector("#nav-launch")` },
  );
  await inPage(`document.querySelector("#nav-launch").click();`);
  const launch = `byText(dialog() ?? document, "button", ${JSON.stringify(a.launchRun)})`;
  await wait("the launch dialog", `return ${launch};`);
  await shot(ctx, "agent-launch", `return dialog();`, { mark: launch });
  await inPage(`${launch}.click();`);
  await wait(
    "the opened agent marked in the sidebar and its screen",
    `return document.querySelector('#app-nav .agent-card[aria-current="true"]') &&
      ${terminalRows}?.includes(${JSON.stringify(sample.agentScreen)});`,
    30_000,
  );
  await shot(
    ctx,
    "agent-running",
    `return { x: 0, y: 0, width: ${FRAME_WIDTH}, height: 280 };`,
    {
      mark: `document.querySelector('#app-nav .agent-card[aria-current="true"]')`,
    },
  );

  // --- エージェントの様子: 3 つをフックの申告で別々の状態にする。
  await reportStates(ctx);
  await inPage(`document.querySelector("#agent-status").click();`);
  await wait(
    "the agents board with three states",
    `const board = document.querySelector("#content");
     return board.querySelectorAll(".agent-card").length >= 3;`,
    30_000,
  );
  const notifyButton = `must(document.querySelector(".agents-notify-enable"), "the notify button")`;
  await shot(
    ctx,
    "notify-enable",
    `const head = ${notifyButton}.closest("header, .agents-head, .agents-header") ?? ${notifyButton}.parentElement;
     return union(head, ${notifyButton});`,
    { mark: notifyButton },
  );
  // 列とアカウントの欄を畳んで、エージェントの行を見せる。
  await setColumns(false);
  await inPage(
    `must(document.querySelector(".agents-accounts-toggle"), "the accounts toggle").click();`,
  );
  await sleep(500);
  await shot(ctx, "agents-board", "window");
  await setColumns(true);

  // --- プロジェクトの見出しの ⋯ のメニュー
  await inPage(
    `must(document.querySelector("#app-nav .nav-project-menu"), "the project menu button").click();`,
  );
  await wait("the project menu", "return !!menu();");
  await shot(
    ctx,
    "projects-menu",
    `return union({ x: 0, y: 0, width: 280, height: 1 }, menu());`,
  );
  await closeMenus();

  // --- プロジェクトを追加する
  const docsRow = `[...document.querySelectorAll(".project-directory-row")].find((row) => row.textContent.startsWith("sample-docs"))`;
  await inPage(`document.querySelector("#nav-add-project").click();`);
  await wait("the folder list", `return !!${docsRow};`);
  await shot(ctx, "project-add", `return dialog();`, { mark: docsRow });
  await inPage(`${docsRow}.click();`);
  await wait(
    "the sample-docs folder",
    `return dialog().querySelector("input").value.endsWith("/sample-docs");`,
  );
  await shot(ctx, "project-register", `return dialog();`, {
    mark: `byText(dialog(), "button", ${JSON.stringify(text.addProjectSubmit)})`,
  });
  await inPage(`dialog().querySelector(".gdp-dialog-cancel").click();`);

  // --- 導入手順: 変更の画面 (画面の見方の番号の印も同じ画面に)。設定と
  // エージェントの画面のタブは閉じておく。
  await inPage(`
    for (const close of document.querySelectorAll('.main-tab[data-kind="page"] .main-tab-close')) close.click();
  `);
  await inPage(`${viewLink("/todif?from=HEAD&to=worktree")}.click();`);
  await wait(
    "the diff",
    `return document.querySelectorAll(".gdp-file-shell.loaded .d2h-file-wrapper").length >= 2;`,
    30_000,
  );
  await shot(ctx, "overview", "window");
  await shot(ctx, "overview-marked", "window", {
    numbers: `(() => {
      const tabs = document.querySelector("#main-tabs").getBoundingClientRect();
      const foot = document.querySelector("#statusbar").getBoundingClientRect();
      return [
        [document.querySelector("#app-nav"), "1"],
        [union(document.querySelector("#panel-head"), document.querySelector("#file-list")), "2"],
        [document.querySelector("#main-tabs"), "3", "right"],
        [{ x: tabs.x, y: tabs.bottom, width: innerWidth - tabs.x, height: foot.top - tabs.bottom }, "4"],
        [document.querySelector("#statusbar"), "5"],
      ];
    })()`,
  });

  // --- 差分を読む: 列を畳んで本文を広げ、左右に並べる。
  await setColumns(false);
  await inPage(
    `must(document.querySelector('#topbar .seg button[data-layout="side-by-side"]'), "the split button").click();`,
  );
  await wait(
    "the split diff",
    `return document.querySelector(".d2h-file-side-diff") !== null;`,
  );
  await shot(ctx, "diff-screen", "window");

  // --- キーの小窓 (どの画面でも ? で開く。キーは本文 (入力欄の外) に送る)。
  await pageKey(cdp, { key: "?", shiftKey: true });
  await wait(
    "the keyboard shortcuts window",
    `return !document.querySelector("#quick-help-popover").hidden;`,
  );
  await shot(
    ctx,
    "quick-help",
    `return document.querySelector("#quick-help-popover");`,
  );
  await inPage(`document.querySelector("#quick-help-close").click();`);

  // --- ファイルを読む: 一覧から開く (仮のタブ)、行番号をドラッグして選ぶ。
  await setColumns(true);
  const srcDir = `[...document.querySelectorAll("#file-list li.tree-dir")].find((li) => li.querySelector(".dir-name")?.textContent.trim() === "src")`;
  await wait("the src folder", `return !!${srcDir};`);
  await inPage(`
    const dir = ${srcDir};
    if (dir.classList.contains("collapsed")) dir.querySelector(".chev").click();
  `);
  const greetingFile = `[...document.querySelectorAll("#file-list li.tree-file a.name")].find((link) => link.textContent.trim().endsWith("greeting.ts"))`;
  await wait("greeting.ts in the file list", `return !!${greetingFile};`);
  await inPage(`${greetingFile}.click();`);
  await wait(
    "the source of greeting.ts",
    `return document.querySelectorAll("td.gdp-source-line-number").length >= 9;`,
  );
  await shot(ctx, "files-open", "window");
  const lines = await inPage(`
    const cells = [...document.querySelectorAll("td.gdp-source-line-number")];
    const point = (cell) => { const r = cell.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    return { from: point(cells[2]), to: point(cells[4]) };
  `);
  await drag(cdp, lines.from, lines.to);
  await wait(
    "the line reference button",
    `return visible(document.querySelector("#line-ref-pill"));`,
  );
  await shot(ctx, "files-line-select", "window");
  await closeLinePill();

  // --- 検索: コードの検索の窓 (⌘G)。
  await pageKey(cdp, { key: "g", code: "KeyG", metaKey: true });
  await wait(
    "the code search",
    `return document.activeElement?.classList.contains("gdp-palette-input");`,
  );
  await typeText(cdp, "greeting");
  await wait(
    "the search results",
    `return document.querySelectorAll(".gdp-palette-item, [role=option]").length >= 3;`,
  );
  await shot(ctx, "search-palette", "window", { keepFocus: true });
  await pressKey(cdp, "Escape");

  // ここから本文の広い画面は、列を畳んで撮る。
  await setColumns(false);

  // --- 履歴: コミットを 1 つ選ぶ。
  await inPage(`${viewLink("/history")}.click();`);
  await wait(
    "the commits",
    `return document.querySelectorAll("li.history-item").length >= 4;`,
  );
  await inPage(`
    const item = [...document.querySelectorAll("li.history-item")].find((li) => li.textContent.includes(${JSON.stringify(sample.commits[2])}));
    must(item, "the commit").click();
  `);
  await wait(
    "the commit's change",
    `return document.querySelector(".gdp-file-shell.loaded .d2h-file-wrapper") !== null;`,
    30_000,
  );
  await shot(ctx, "history-screen", "window");

  // --- 作業ツリー: 本体と同じファイルを変えている作業ツリーを選ぶ。
  await inPage(`${viewLink("/worktree")}.click();`);
  const greetingTree = `[...document.querySelectorAll("#worktree-panel li.history-item")].find((li) => li.querySelector(".worktree-row-branch")?.textContent.trim() === "greeting")`;
  await wait("the worktrees", `return !!${greetingTree};`, 30_000);
  await inPage(`${greetingTree}.click();`);
  await wait(
    "the worktree's change",
    `return document.querySelector(".gdp-file-shell.loaded .d2h-file-wrapper") !== null;`,
    30_000,
  );
  await shot(ctx, "worktrees-screen", "window");

  // --- データストア: sample.db のテーブル。下の問い合わせの履歴の枠は閉じる。
  await inPage(`${viewLink("/database")}.click();`);
  const tasksTable = `[...document.querySelectorAll(".db-table-item")].find((el) => el.querySelector(".db-table-name")?.textContent.trim() === "tasks")`;
  await wait("the tasks table", `return !!${tasksTable};`, 30_000);
  await inPage(`
    const table = ${tasksTable};
    if (!table.classList.contains("active")) table.click();
    const dock = document.querySelector(".db-history-dock-close");
    if (visible(dock)) dock.click();
  `);
  await wait(
    "the rows",
    `return document.querySelector("#content").textContent.includes(${JSON.stringify(sample.tasks.at(-1)[0])});`,
    30_000,
  );
  await shot(ctx, "datastore-grid", "window");

  // --- ツール: 貼り付けた Markdown。
  await inPage(
    `must([...document.querySelectorAll(".main-tabs-new")].find(visible), "the new tab button").click();`,
  );
  await wait("the new tab menu", "return !!menu();");
  await inPage(
    `must(byText(menu(), "button, [role=menuitem]", ${JSON.stringify(text.tools)}), "the tools item").click();`,
  );
  await wait(
    "the tools",
    `return visible(document.querySelector(".tools-textarea"));`,
  );
  await inPage(
    `setField(document.querySelector(".tools-textarea"), ${JSON.stringify(sample.markdown)});`,
  );
  await wait(
    "the markdown preview",
    `return [...document.querySelectorAll("#content table")].some(visible);`,
  );
  await shot(ctx, "tools-markdown", "window");

  // --- 注釈: CLI で 3 つ足す (画面は最後の注釈の場所へ移る)。1 列の差分で、
  // パネルの 2 つ目を選ぶ。
  const notes = sample.annotations;
  sandboxCli(ctx.root, server, ["annotate", "start", "--title", notes.title]);
  for (const item of notes.items)
    sandboxCli(ctx.root, server, [
      "annotate",
      "add",
      "--file",
      "src/greeting.ts",
      "--line",
      item.line,
      "--title",
      item.title,
      "--body",
      item.body,
    ]);
  const inlineNote = (title) =>
    `[...document.querySelectorAll(".gdp-annotation-inline-title")].find((el) => visible(el) && el.textContent.trim() === ${JSON.stringify(title)})`;
  await wait(
    "the last annotation in the code",
    `return !!${inlineNote(notes.items.at(-1).title)};`,
    30_000,
  );
  await inPage(`
    if (!visible(document.querySelector("#annotation-panel"))) document.querySelector("#annotations-toggle").click();
  `);
  // コードの下の 2 つ目の説明の「パネルで読む」で、パネルにも同じ注釈を出す。
  await inPage(`
    const card = ${inlineNote(notes.items[1].title)}.closest(".gdp-annotation-inline");
    must(byText(card, "button", ${JSON.stringify(text.annotations.readInPanel)}), "read in panel").click();
  `);
  await wait(
    "the chosen annotation in the panel",
    `return document.querySelector("#annotation-panel").innerText.includes(${JSON.stringify(notes.items[1].body.slice(0, 10))});`,
  );
  // 説明が読めるように 1 列の差分にする。
  await inPage(`
    const unified = document.querySelector('#topbar .seg button[data-layout="line-by-line"]');
    if (visible(unified)) unified.click();
  `);
  await closeLinePill();
  await shot(ctx, "annotations-panel", "window");
  await inPage(`document.querySelector("#annotation-panel-close").click();`);

  const greetingTab = `[...document.querySelectorAll(".main-tab")].find((tab) => tab.textContent.includes("greeting.ts"))`;
  // --- タブのグループ: 画面のタブを閉じ (エージェントのタブと greeting.ts だけ
  // 残す)、sample-lib でもファイルを開いて、2 つ目のグループを作る。
  await setColumns(true);
  await inPage(`
    for (const tab of [...document.querySelectorAll(".main-tab")]) {
      if (tab.dataset.kind === "terminal" || tab.textContent.includes("greeting.ts")) continue;
      must(tab.querySelector(".main-tab-close"), "the close button of " + tab.textContent).click();
    }
  `);
  await openInOtherProject(ctx);
  const libGroupMenu = `[...document.querySelectorAll(".main-tab-group-toggle")].find((toggle) => (toggle.getAttribute("aria-label") ?? toggle.title).startsWith("sample-lib"))?.closest(".main-tab-group")?.querySelector(".main-tab-group-menu")`;
  await wait("the sample-lib group", `return !!${libGroupMenu};`);
  await inPage(`${libGroupMenu}.click();`);
  await wait("the group menu", "return !!menu();");
  await shot(
    ctx,
    "tabs-groups",
    `return union(document.querySelector("#main-tabs"), menu());`,
  );
  await closeMenus();

  // --- ターミナル: 新しいシェルのタブと、＋ のメニュー。sample-app のタブを
  // 選んでから開く (sample-app のシェルになる)。
  await inPage(`must(${greetingTab}, "the greeting.ts tab").click();`);
  await wait(
    "sample-app in front",
    `return document.querySelector("#panel-head .brand")?.textContent.includes("sample-app");`,
  );
  const newShell = `byText(menu(), "button, [role=menuitem]", ${JSON.stringify(text.newShell)})`;
  // ＋ のメニューは大きさの変化や描き直しで閉じることがあるので、開いていなければ
  // 開き直し、項目を見つけたその場で押す。
  const openNewShell = () =>
    wait(
      "the new shell item",
      `const item = ${newShell};
       if (item) { item.click(); return true; }
       if (!menu()) [...document.querySelectorAll(".main-tabs-new")].find(visible)?.click();
       return false;`,
    );
  await openNewShell();
  await wait(
    "the shell prompt",
    `return ${terminalRows}?.includes("sample-app %");`,
  );
  await inPage(
    `must([...document.querySelectorAll(".main-tabs-new")].find(visible), "the new tab button").click();`,
  );
  await wait("the new tab menu", "return !!menu();");
  await shot(
    ctx,
    "terminal-tab",
    `const tabs = document.querySelector("#main-tabs").getBoundingClientRect();
     return union(menu(), { x: tabs.x, y: tabs.y, width: tabs.width, height: 420 });`,
  );
  await closeMenus();

  // --- 左右 2 面: 左にファイル、右にターミナル。前面のタブが右へ移るので、
  // シェルのタブを前にして分ける。
  await inPage(`must(${greetingTab}, "the greeting.ts tab").click();`);
  await inPage(`
    // 最後に開いたターミナルのタブ (エージェントのタブより後)。
    const shell = [...document.querySelectorAll('.main-tab[data-kind="terminal"]')].at(-1);
    must(shell, "the shell tab").click();
  `);
  await inPage(
    `must([...document.querySelectorAll(".main-tabs-split")].find(visible), "the split button").click();`,
  );
  await wait(
    "the file on the left and the shell on the right",
    `const panes = [...document.querySelectorAll(".main-tabs-pane")];
     return panes.length === 2 &&
       panes[0].querySelector(".main-tab-active")?.textContent.includes("greeting.ts") &&
       panes[1].querySelector('.main-tab-active[data-kind="terminal"]') !== null;`,
  );
  await closeLinePill();
  await sleep(1000);
  await shot(ctx, "tabs-split", "window");
  // 1 面に戻す (右の面の同じ場所のボタン)。
  await inPage(
    `must([...document.querySelectorAll(".main-tabs-split")].filter(visible).at(-1), "the unsplit button").click();`,
  );
  await wait(
    "one pane",
    `return document.querySelectorAll(".main-tabs-pane").length === 1;`,
  );

  // --- SP の画面: 幅の狭い窓で変更の画面。
  await setViewport(cdp, PHONE.width, PHONE.height);
  await cdp.send("Page.navigate", {
    url: `${server.projectUrl}todif?from=HEAD&to=worktree`,
  });
  await wait(
    "the phone diff",
    `return document.querySelectorAll(".gdp-file-shell.loaded .d2h-file-wrapper").length >= 1;`,
    30_000,
  );
  await sleep(1000);
  await phoneShot(ctx, "phone-screen");

  // --- 環境ドクター: 最下段のアイコンから開く。
  await setViewport(cdp, VIEWPORT.width);
  await cdp.send("Page.navigate", { url: server.projectUrl });
  await wait(
    "the app",
    `return visible(document.querySelector("#doctor-btn"));`,
  );
  await setColumns(true);
  await inPage(`document.querySelector("#doctor-btn").click();`);
  await wait(
    "the doctor results",
    `return /\\bWARN\\b/.test(document.querySelector("#doctor-sheet").innerText);`,
    60_000,
  );
  // 先頭の群はこの作業フォルダの場所を出すので、git の群から見せる。
  await inPage(`
    const group = [...document.querySelectorAll("#doctor-sheet *")].find((el) => el.children.length === 0 && el.textContent.trim().toUpperCase() === "GIT");
    must(group, "the git group").scrollIntoView({ block: "start" });
  `);
  await shot(ctx, "doctor-sheet", "window", {
    mark: `document.querySelector("#doctor-btn")`,
  });
  await inPage(
    `document.querySelector("#doctor-sheet .doctor-close").click();`,
  );

  // --- AI に任せる (最後に撮る。リポジトリにスキルが増え、変更の画面が変わるため):
  // 新しいシェルで code-viewer skill install。長い行を折り返すため、
  // 列を畳み、画面を切り抜く幅にする。
  await setColumns(false);
  await setViewport(cdp, FRAME_WIDTH);
  await openNewShell();
  await wait(
    "the shell prompt",
    `return ${terminalRows}?.includes("sample-app %");`,
  );
  await focusTerminal();
  const command = "code-viewer skill install --agent claude,codex";
  await typeText(cdp, command);
  await wait(
    "the typed command",
    `return ${terminalRows}?.includes(${JSON.stringify(command)});`,
  );
  await pressKey(cdp, "Enter");
  await wait(
    "the install output",
    `return ${terminalRows}?.includes("Re-run the same command");`,
  );
  await shot(
    ctx,
    "skill-install",
    `
    const rows = [...document.querySelectorAll(".main-pane-host.is-shown .xterm-rows > div")].filter((row) => row.textContent.trim());
    const tabs = document.querySelector("#main-tabs").getBoundingClientRect();
    const last = rows.at(-1).getBoundingClientRect();
    return { x: 0, y: tabs.y, width: ${FRAME_WIDTH}, height: last.bottom - tabs.y };
  `,
  );
  // 砂場の tmux に残らないように、シェルを閉じる。
  await focusTerminal();
  await pressKey(cdp, "Control+d");
  // 列を開いた状態で終える (保存され、tmux の無いサーバで開き直したときに出る)。
  await setViewport(cdp, VIEWPORT.width);
  await setColumns(true);
}

/**
 * 起動の画面を通さずに、codex (既定) と claude (Work) を起こす。ブラウザを開く
 * 前に起こし、アカウントが分かるまで待つ (起動の途中でペインを読むと、
 * 終わったプロセスを読んでアカウントが「?」のまま残るため)。
 */
async function launchStandIns(root, server, accounts) {
  const project = join(root, "home", "work", "sample-app");
  const work = accounts.find(
    (account) => account.agent === "claude" && account.id !== "claude:default",
  );
  if (!work) throw new Error("the Work account is missing");
  const panes = {};
  for (const [name, accountId] of [
    ["codex", "codex:default"],
    ["work", work.id],
  ]) {
    const pane = await api(`${server.origin}/_agent/launch`, "POST", {
      accountId,
      project,
      session: "sample-app",
    });
    panes[name] = pane.paneId;
  }
  await sleep(3000);
  const deadline = Date.now() + 30_000;
  for (;;) {
    const overview = await api(`${server.origin}/_agent/overview`, "GET");
    const agents = overview.panes.filter((pane) =>
      Object.values(panes).includes(pane.id),
    );
    if (
      agents.length === 2 &&
      agents.every((pane) => pane.account && pane.account.kind !== "unknown")
    )
      return panes;
    if (Date.now() > deadline)
      throw new Error(
        `the stand-in agents' accounts are not known: ${JSON.stringify(agents.map((pane) => ({ id: pane.id, account: pane.account })))}`,
      );
    await sleep(500);
  }
}

/** 3 つのエージェントを、フックの申告で入力待ち・作業中・待機にする。 */
async function reportStates(ctx) {
  const { server, sample, standIns } = ctx;
  const overview = await api(`${server.origin}/_agent/overview`, "GET");
  const first = overview.panes.find(
    (pane) =>
      pane.kind === "claude" && !Object.values(standIns).includes(pane.id),
  );
  if (!first)
    throw new Error(
      `the launched claude is not in the overview: ${JSON.stringify(overview.panes)}`,
    );
  const report = (target, event, agent, extra = {}) =>
    api(`${server.origin}/_agent/state`, "POST", {
      target,
      event,
      agent,
      ...extra,
    });
  await report(first.id, "prompt", "claude", {
    lastPrompt: sample.working.prompt,
    note: sample.working.note,
  });
  await report(standIns.codex, "ask", "codex", {
    lastPrompt: sample.waiting.prompt,
    note: sample.waiting.note,
  });
  await report(standIns.work, "ready", "claude");
}

/** sample-lib でファイルを開き、sample-app に戻る (タブのグループが 2 つになる)。 */
async function openInOtherProject(ctx) {
  const { cdp } = ctx;
  const project = (name) =>
    `[...document.querySelectorAll("#app-nav .nav-project-name")].find((el) => visible(el) && el.textContent.trim() === "${name}")`;
  const appPath = new URL(ctx.server.projectUrl).pathname;
  await page(
    cdp,
    `if (!${project("sample-lib")}) must(document.querySelector("#app-nav .nav-stopped-toggle"), "the not running section").click();`,
  );
  await waitFor(
    cdp,
    "sample-lib in the sidebar",
    `return !!${project("sample-lib")};`,
  );
  // 押すとページごと移るので、評価を返してから押す。
  await page(cdp, `setTimeout(() => ${project("sample-lib")}.click());`);
  const readme = `[...document.querySelectorAll("#file-list li.tree-file a.name")].find((link) => link.textContent.trim().endsWith("README.md"))`;
  await waitFor(
    cdp,
    "the sample-lib files",
    `return document.querySelector("#panel-head .brand")?.textContent.includes("sample-lib") && !!${readme};`,
    60_000,
  );
  await page(cdp, `${readme}.click();`);
  await waitFor(
    cdp,
    "the sample-lib README",
    `return [...document.querySelectorAll('.main-tab[data-kind="file"]')].some((tab) => tab.textContent.includes("README.md"));`,
  );
  await page(cdp, `setTimeout(() => ${project("sample-app")}.click());`);
  await waitFor(
    cdp,
    "sample-app again",
    `return location.pathname.startsWith(${JSON.stringify(appPath)}) &&
      document.querySelector("#panel-head .brand")?.textContent.includes("sample-app");`,
    60_000,
  );
  await sleep(1500);
}

/** tmux の無いサーバのサイドバー。 */
async function captureNoTmux(ctx) {
  const { cdp, server, text } = ctx;
  await setViewport(cdp, VIEWPORT.width);
  await cdp.send("Page.navigate", { url: server.projectUrl });
  await waitFor(
    cdp,
    "the app",
    `return [...document.querySelectorAll("#nav-launch, #nav-expand")].some(visible);`,
  );
  const note = `[...document.querySelectorAll("#app-nav .nav-note-muted")].find((el) => el.textContent.includes(${JSON.stringify(text.notInstalled)}))`;
  // 保存した列の状態が遅れて届いて畳み直すことがあるので、畳まれていれば開き直す。
  await waitFor(
    cdp,
    "the tmux note",
    `const expand = document.querySelector("#nav-expand");
     if (visible(expand)) expand.click();
     return visible(${note});`,
    30_000,
  );
  await shot(
    ctx,
    "sidebar-no-tmux",
    `return union({ x: 0, y: 0, width: 280, height: 1 }, ${note});`,
    { mark: note },
  );
}

// ---------------------------------------------------------------- 入口

async function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const file of ["web/app.js", "dist/code-viewer.js"])
    if (!existsSync(join(REPO, file)))
      throw new Error(`${file} is missing: run pnpm run build first`);
  const load = (path) => tsImport(path, import.meta.url);
  const { agentsText } = await load("../web-src/views/agents/i18n.ts");
  const { terminalText } = await load("../web-src/views/terminal/i18n.ts");
  const { VIEWER_SETTINGS_TEXT } = await load(
    "../web-src/views/viewer-settings-i18n.ts",
  );
  const { toolsText } = await load("../web-src/views/tools/i18n.ts");
  const { annotationText } = await load("../web-src/views/annotations/i18n.ts");
  mkdirSync(options.outDir, { recursive: true });
  // 止められたときも exit を通して、起こしたサーバを止める。
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));
  const chrome = options.setupOnly ? null : await startChrome();
  const killChrome = () => {
    if (chrome && chrome.child.exitCode === null) chrome.child.kill("SIGTERM");
  };
  process.on("exit", killChrome);
  try {
    for (const lang of options.setupOnly ? ["en"] : options.languages) {
      const agents = agentsText(lang);
      await captureLanguage(options, chrome, lang, {
        accounts: agents.accounts,
        hooks: agents.hooks,
        settings: agents.sidebar.settings,
        notInstalled: agents.sidebar.notInstalled,
        addProjectSubmit: agents.projects.addProjectSubmit,
        accountsCategory: VIEWER_SETTINGS_TEXT[lang].categories.accounts.label,
        agentsCategory: VIEWER_SETTINGS_TEXT[lang].categories.agents.label,
        newShell: terminalText(lang).newShell,
        tools: toolsText(lang).title,
        annotations: annotationText(lang),
      });
    }
  } finally {
    await chrome?.stop();
  }
  const files = readdirSync(options.outDir).filter((file) =>
    file.endsWith(".webp"),
  );
  const total = files.reduce(
    (sum, file) => sum + statSync(join(options.outDir, file)).size,
    0,
  );
  console.log(`${files.length} images, ${total} bytes in ${options.outDir}`);
  if (total > MAX_TOTAL_BYTES)
    throw new Error(
      `the images in ${options.outDir} are ${total} bytes, over ${MAX_TOTAL_BYTES}`,
    );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
