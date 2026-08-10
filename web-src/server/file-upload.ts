import {
  closeSync,
  constants,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { errorWithCause, errorWithCauses } from "../core/error-detail";

export type PendingUpload = {
  target: string;
  file: { arrayBuffer(): Promise<ArrayBuffer> };
};

export type UploadFileSystem = {
  open(path: string): number;
  write(fd: number, bytes: Uint8Array): void;
  close(fd: number): void;
  remove(path: string): void;
};

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function withErrorCode(error: Error, code: string | undefined): Error {
  return code === undefined ? error : Object.assign(error, { code });
}

function writeAndClose(
  upload: PendingUpload,
  fd: number,
  bytes: Uint8Array,
  fileSystem: UploadFileSystem,
): void {
  let writeError: unknown;
  try {
    fileSystem.write(fd, bytes);
  } catch (error) {
    writeError = error;
  }

  try {
    fileSystem.close(fd);
  } catch (closeError) {
    if (writeError !== undefined) {
      throw withErrorCode(
        errorWithCauses(`failed to write and close ${upload.target}`, [
          writeError,
          closeError,
        ]),
        errorCode(writeError),
      );
    }
    throw errorWithCause(`failed to close ${upload.target}`, closeError);
  }

  if (writeError !== undefined) throw writeError;
}

const NODE_FILE_SYSTEM: UploadFileSystem = {
  open: (path) =>
    openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW || 0),
      0o644,
    ),
  write: (fd, bytes) => writeFileSync(fd, bytes),
  close: (fd) => closeSync(fd),
  remove: (path) => unlinkSync(path),
};

export async function writeUploadedFiles(
  uploads: readonly PendingUpload[],
  fileSystem: UploadFileSystem = NODE_FILE_SYSTEM,
): Promise<void> {
  const created: string[] = [];
  try {
    for (const upload of uploads) {
      const bytes = new Uint8Array(await upload.file.arrayBuffer());
      const fd = fileSystem.open(upload.target);
      created.push(upload.target);
      writeAndClose(upload, fd, bytes, fileSystem);
    }
  } catch (error) {
    const cleanupErrors: Error[] = [];
    for (const path of created) {
      try {
        fileSystem.remove(path);
      } catch (cleanupError) {
        cleanupErrors.push(
          errorWithCause(
            `failed to remove partial upload ${path}`,
            cleanupError,
          ),
        );
      }
    }

    const code = errorCode(error);
    if (cleanupErrors.length > 0) {
      throw withErrorCode(
        errorWithCauses(
          "failed to write uploaded files and clean up partial files",
          [error, ...cleanupErrors],
        ),
        code,
      );
    }
    throw withErrorCode(
      errorWithCause("failed to write uploaded files", error),
      code,
    );
  }
}
