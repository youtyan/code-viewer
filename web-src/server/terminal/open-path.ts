import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hasControlCharacter } from "../../core/control-chars";
import { formatErrorDetail } from "../../core/error-detail";
import type { TerminalPathResponse } from "../../core/types";
import {
  json,
  parseBoundedJsonBody,
  textError,
} from "../database/handle-shared";
import { isGitInternalPath } from "../git";
import { openDirectoryInOs } from "../os-opener";

/** Called only by the guarded POST route, after an explicit path click. */
export async function handleTerminalOpenPath(
  req: Request,
  cwd: string,
): Promise<Response> {
  const body = await parseBoundedJsonBody(
    req,
    16_384,
    "path payload too large",
  );
  if (body instanceof Response) return body;
  if (
    !body ||
    typeof body !== "object" ||
    !("path" in body) ||
    typeof body.path !== "string" ||
    !body.path ||
    hasControlCharacter(body.path)
  ) {
    return textError("invalid terminal path", 400);
  }
  try {
    const path = body.path.startsWith("file:")
      ? fileURLToPath(body.path)
      : body.path.startsWith("~/")
        ? resolve(homedir(), body.path.slice(2))
        : body.path;
    if (!isAbsolute(path))
      return textError("expected an absolute terminal path", 400);
    if (isGitInternalPath(path.replace(/\\/g, "/")))
      return textError("forbidden", 403);
    const target = await realpath(path);
    if (isGitInternalPath(target.replace(/\\/g, "/")))
      return textError("forbidden", 403);
    const info = await stat(target);
    if (!info.isFile() && !info.isDirectory())
      return textError("not a file or directory", 400);
    const repoPath = relative(await realpath(cwd), target);
    let result: TerminalPathResponse;
    if (
      repoPath !== ".." &&
      !repoPath.startsWith(`..${sep}`) &&
      !isAbsolute(repoPath)
    ) {
      result = {
        kind: info.isDirectory() ? "directory" : "file",
        path: repoPath.split(sep).join("/"),
      };
    } else {
      // Files outside the repository are revealed in their folder, never executed.
      await openDirectoryInOs(info.isDirectory() ? target : dirname(target));
      result = { kind: "external" };
    }
    return json(result);
  } catch (error) {
    console.error("[code-viewer] terminal path open failed", error);
    const missing =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    return textError(formatErrorDetail(error), missing ? 404 : 500);
  }
}
