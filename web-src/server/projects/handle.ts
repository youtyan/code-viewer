// プロジェクトの登録簿・開く・止めるの HTTP 入口。振り分けは terminal/handle.ts
// の /_agent/ の表に載せる (並行するルータは作らない)。
//
// - POST /_agent/projects       足す (パス・このサーバのリポジトリ)・外す・名前・並べ替え
// - POST /_agent/projects/open  登録したプロジェクトのサーバを (無ければ起こして) 返す
// - POST /_agent/projects/stop  code-viewer が起こしたサーバを止める
//
// 登録簿そのものは /_agent/overview の registry に載る (一覧と切替が同じ
// 取り直しで読む)。どれも状態を変えるので同一オリジンからしか通らない。

import { realpathSync } from "node:fs";
import { hasControlCharacter } from "../../core/control-chars";
import { formatErrorDetail } from "../../core/error-detail";
import {
  MAX_PROJECT_NAME_LENGTH,
  type ProjectOpenResponse,
  projectRootIssue,
} from "../../core/projects";
import { json, parseBoundedJsonBody } from "../database/handle-shared";
import { ProjectRegistryError } from "./registry";
import {
  changeProjects,
  openRegisteredProject,
  type ProjectChange,
  stopLaunchedServer,
} from "./service";

/** 本文の上限。パスと名前だけが来る。 */
const MAX_PROJECT_BODY_BYTES = 16 * 1024;

function errorResponse(error: unknown): Response {
  const detail = formatErrorDetail(error);
  if (error instanceof ProjectRegistryError) {
    const status =
      error.code === "invalid"
        ? 400
        : error.code === "not-found"
          ? 404
          : error.code === "conflict"
            ? 409
            : error.code === "unreadable"
              ? 422
              : 500;
    if (status === 500)
      console.error("[code-viewer] project request failed", error);
    return json({ error: detail, code: error.code }, status);
  }
  console.error("[code-viewer] project request failed", error);
  return json({ error: detail, code: "failed" }, 500);
}

function invalid(message: string): Response {
  return json({ error: message, code: "invalid" }, 400);
}

/** 登録の鍵・入力されたパス。絶対パスだけ。 */
function pathField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return projectRootIssue(value) ? null : value;
}

function nameField(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_PROJECT_NAME_LENGTH * 4) {
    return null;
  }
  return hasControlCharacter(value) ? null : value;
}

async function readBody(
  req: Request,
): Promise<Record<string, unknown> | Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_PROJECT_BODY_BYTES,
    "project request too large",
  );
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid("the request body is not a JSON object");
  }
  return body as Record<string, unknown>;
}

function parseChange(
  body: Record<string, unknown>,
  cwd: string,
): ProjectChange | string {
  const { action } = body;
  if (action === "add") {
    // current: このサーバのリポジトリ。path: 入力されたパス・一覧のプロジェクト。
    const path = body.current === true ? cwd : pathField(body.path);
    if (!path) return "path must be an absolute path";
    if (body.name !== undefined && nameField(body.name) === null) {
      return "invalid name";
    }
    return {
      action,
      path,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
    };
  }
  const root = pathField(body.root);
  if (!root) return "root must be an absolute path";
  if (action === "remove") return { action, root };
  if (action === "rename") {
    const name = nameField(body.name);
    if (name === null) return "invalid name";
    return { action, root, name };
  }
  if (action === "move") {
    if (body.direction !== -1 && body.direction !== 1) {
      return "direction must be -1 or 1";
    }
    return { action, root, direction: body.direction };
  }
  return "action must be add, remove, rename or move";
}

export async function handleProjectsPost(
  req: Request,
  cwd: string,
): Promise<Response> {
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const change = parseChange(body, cwd);
  if (typeof change === "string") return invalid(change);
  try {
    return json({ project: await changeProjects(change, cwd) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** forgetServer: 一覧が覚えているそのプロジェクトのサーバの状態を捨てる。 */
export async function handleProjectOpenPost(
  req: Request,
  forgetServer: (root: string) => void,
  open: (root: string) => Promise<ProjectOpenResponse> = (root) =>
    openRegisteredProject(root),
): Promise<Response> {
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const root = pathField(body.root);
  if (!root) return invalid("root must be an absolute path");
  try {
    return json(await open(root));
  } catch (error) {
    return errorResponse(error);
  } finally {
    forgetServer(root);
  }
}

export async function handleProjectStopPost(
  req: Request,
  cwd: string,
  forgetServer: (root: string) => void,
  stop: (root: string) => Promise<{ stopped: boolean }> = (root) =>
    stopLaunchedServer(root, realpathSync(cwd)),
): Promise<Response> {
  const body = await readBody(req);
  if (body instanceof Response) return body;
  const root = pathField(body.root);
  if (!root) return invalid("root must be an absolute path");
  try {
    return json(await stop(root));
  } catch (error) {
    return errorResponse(error);
  } finally {
    forgetServer(root);
  }
}
