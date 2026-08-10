import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, renameSync } from "node:fs";
import { homedir, release as osRelease } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { errorWithCause } from "../core/error-detail";
import { isWsl } from "./os-platform";
import { type RunResult, runAsync } from "./runtime";

const TRASH_TIMEOUT_MS = 60_000;

export type TrashMoveResult = {
  trashPath?: string;
};

function windowsTrashScript(path: string): string {
  const quotedPath = path.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop';",
    `$path = '${quotedPath}';`,
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class CodeViewerRecycleBin {",
    "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
    "  public struct SHFILEOPSTRUCT {",
    "    public IntPtr hwnd;",
    "    public uint wFunc;",
    "    public string pFrom;",
    "    public string pTo;",
    "    public ushort fFlags;",
    "    [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;",
    "    public IntPtr hNameMappings;",
    "    public string lpszProgressTitle;",
    "  }",
    '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]',
    "  private static extern int SHFileOperationW(ref SHFILEOPSTRUCT lpFileOp);",
    "  public static void MoveToRecycleBin(string path) {",
    "    const uint FO_DELETE = 0x0003;",
    "    const ushort FOF_SILENT = 0x0004;",
    "    const ushort FOF_NOCONFIRMATION = 0x0010;",
    "    const ushort FOF_ALLOWUNDO = 0x0040;",
    "    const ushort FOF_NOERRORUI = 0x0400;",
    "    var op = new SHFILEOPSTRUCT {",
    "      hwnd = IntPtr.Zero,",
    "      wFunc = FO_DELETE,",
    '      pFrom = path + "\\0\\0",',
    "      pTo = null,",
    "      fFlags = (ushort)(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT),",
    "      fAnyOperationsAborted = false,",
    "      hNameMappings = IntPtr.Zero,",
    "      lpszProgressTitle = null",
    "    };",
    "    int result = SHFileOperationW(ref op);",
    '    if (result != 0) throw new InvalidOperationException("SHFileOperationW failed: " + result);',
    '    if (op.fAnyOperationsAborted) throw new OperationCanceledException("SHFileOperationW aborted");',
    "  }",
    "}",
    "'@;",
    "[CodeViewerRecycleBin]::MoveToRecycleBin($path);",
  ].join(" ");
}

function windowsRestoreTrashScript(originalPath: string): string {
  const quotedPath = originalPath.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop';",
    `$original = '${quotedPath}';`,
    "$parent = [System.IO.Path]::GetDirectoryName($original);",
    "$name = [System.IO.Path]::GetFileName($original);",
    "$shell = New-Object -ComObject Shell.Application;",
    "$bin = $shell.Namespace(10);",
    "$restored = $false;",
    "foreach ($item in $bin.Items()) {",
    "  $deletedFrom = $item.ExtendedProperty('System.Recycle.DeletedFrom');",
    "  if ($item.Name -eq $name -and $deletedFrom -eq $parent) {",
    "    $item.InvokeVerb('ESTORE');",
    "    $restored = $true;",
    "    break;",
    "  }",
    "}",
    "if (-not $restored) { throw 'recycle bin item not found'; }",
  ].join(" ");
}

function commandResultError(
  operation: string,
  command: string[],
  cwd: string,
  result: RunResult,
): Error {
  return Object.assign(new Error(`${operation} failed`), {
    command,
    cwd,
    result,
  });
}

async function runRequiredCommand(
  operation: string,
  command: string[],
  cwd: string,
): Promise<void> {
  let result: RunResult;
  try {
    result = await runAsync(command, cwd, { timeout: TRASH_TIMEOUT_MS });
  } catch (cause) {
    throw Object.assign(errorWithCause(`${operation} failed`, cause), {
      command,
      cwd,
    });
  }
  if (result.code !== 0) {
    throw commandResultError(operation, command, cwd, result);
  }
}

function managedTrashRoot(cwd: string): string {
  return join(cwd, ".code-viewer", "trash");
}

function movePathIntoTrashDirectory(
  path: string,
  trashRoot: string,
): TrashMoveResult {
  mkdirSync(trashRoot, { recursive: true });
  const name = basename(path) || "trash-item";
  const trashPath = join(trashRoot, `${name}-${randomUUID()}`);
  if (existsSync(trashPath)) {
    throw Object.assign(new Error("trash destination already exists"), {
      trashPath,
    });
  }
  renameSync(path, trashPath);
  return { trashPath };
}

function trashRootForHandle(
  cwd: string,
  platform: NodeJS.Platform,
  release: string,
): string | null {
  if (platform === "darwin") return join(homedir(), ".Trash");
  if (isWsl(platform, release)) return managedTrashRoot(cwd);
  return null;
}

function unsupportedTrashError(
  operation: "trash" | "restore from trash",
  platform: NodeJS.Platform,
  release: string,
): Error {
  return Object.assign(new Error(`${operation} unsupported`), {
    platform,
    release,
  });
}

export async function movePathToTrash(
  path: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  release: string = osRelease(),
): Promise<TrashMoveResult> {
  lstatSync(path);
  if (platform === "darwin") {
    return movePathIntoTrashDirectory(path, join(homedir(), ".Trash"));
  }
  if (isWsl(platform, release)) {
    return movePathIntoTrashDirectory(path, managedTrashRoot(cwd));
  }
  if (platform === "win32") {
    await runRequiredCommand(
      "move path to Recycle Bin",
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        windowsTrashScript(path),
      ],
      cwd,
    );
    return {};
  }
  throw unsupportedTrashError("trash", platform, release);
}

export async function restorePathFromTrash(
  originalPath: string,
  trashPath: string | undefined,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  release: string = osRelease(),
): Promise<void> {
  if (existsSync(originalPath)) {
    throw new Error("restore target exists");
  }
  if (trashPath) {
    const trashRoot = trashRootForHandle(cwd, platform, release);
    if (!trashRoot || dirname(resolve(trashPath)) !== resolve(trashRoot)) {
      throw new Error("invalid trash handle");
    }
    if (!existsSync(trashPath)) throw new Error("trash item not found");
    mkdirSync(dirname(originalPath), { recursive: true });
    renameSync(trashPath, originalPath);
    return;
  }
  if (platform === "win32") {
    await runRequiredCommand(
      "restore path from Recycle Bin",
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        windowsRestoreTrashScript(originalPath),
      ],
      cwd,
    );
    return;
  }
  throw unsupportedTrashError("restore from trash", platform, release);
}
