import { describe, expect, test } from "vitest";
import { formatErrorDetail } from "../core/error-detail";
import {
  type UploadFileSystem,
  writeUploadedFiles,
} from "../server/file-upload";

function upload(name: string) {
  return {
    target: `/work/${name}`,
    file: {
      async arrayBuffer() {
        return new TextEncoder().encode(name).buffer;
      },
    },
  };
}

describe("writeUploadedFiles", () => {
  test("writes every upload and closes each descriptor", async () => {
    const opened: string[] = [];
    const written: Array<{ fd: number; text: string }> = [];
    const closed: number[] = [];
    const removed: string[] = [];
    const fileSystem: UploadFileSystem = {
      open(path) {
        opened.push(path);
        return opened.length;
      },
      write(fd, bytes) {
        written.push({ fd, text: new TextDecoder().decode(bytes) });
      },
      close(fd) {
        closed.push(fd);
      },
      remove(path) {
        removed.push(path);
      },
    };

    await writeUploadedFiles(
      [upload("first.txt"), upload("second.txt")],
      fileSystem,
    );

    expect(opened).toEqual(["/work/first.txt", "/work/second.txt"]);
    expect(written).toEqual([
      { fd: 1, text: "first.txt" },
      { fd: 2, text: "second.txt" },
    ]);
    expect(closed).toEqual([1, 2]);
    expect(removed).toEqual([]);
  });

  test("removes the partially written file and retains write, close, and cleanup failures", async () => {
    const writeError = Object.assign(new Error("write failed"), {
      code: "ENOSPC",
      cause: new Error("storage full"),
    });
    const closeError = new Error("close failed");
    const cleanupError = new Error("remove failed");
    const fileSystem: UploadFileSystem = {
      open() {
        return 7;
      },
      write() {
        throw writeError;
      },
      close() {
        throw closeError;
      },
      remove() {
        throw cleanupError;
      },
    };

    const result = writeUploadedFiles([upload("partial.txt")], fileSystem);
    await expect(result).rejects.toMatchObject({ code: "ENOSPC" });

    try {
      await result;
      throw new Error("expected writeUploadedFiles to reject");
    } catch (error) {
      expect(formatErrorDetail(error)).toBe(
        'Error: failed to write uploaded files and clean up partial files\nDetails: {"errors":[{"name":"Error","message":"failed to write and close /work/partial.txt","errors":[{"name":"Error","message":"write failed","code":"ENOSPC","cause":{"name":"Error","message":"storage full"}},{"name":"Error","message":"close failed"}],"code":"ENOSPC"},{"name":"Error","message":"failed to remove partial upload /work/partial.txt","cause":{"name":"Error","message":"remove failed"}}],"code":"ENOSPC"}',
      );
    }
  });

  test("retains an exclusive-create conflict code after successful cleanup", async () => {
    const removed: string[] = [];
    const fileSystem: UploadFileSystem = {
      open(path) {
        if (path.endsWith("second.txt")) {
          throw Object.assign(new Error("already exists"), { code: "EEXIST" });
        }
        return 3;
      },
      write: () => undefined,
      close: () => undefined,
      remove(path) {
        removed.push(path);
      },
    };

    await expect(
      writeUploadedFiles(
        [upload("first.txt"), upload("second.txt")],
        fileSystem,
      ),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(removed).toEqual(["/work/first.txt"]);
  });

  test("does not create a file when reading the upload body fails", async () => {
    const bodyError = new Error("body read failed");
    const opened: string[] = [];
    const removed: string[] = [];
    const fileSystem: UploadFileSystem = {
      open(path) {
        opened.push(path);
        return 4;
      },
      write: () => undefined,
      close: () => undefined,
      remove(path) {
        removed.push(path);
      },
    };

    const result = writeUploadedFiles(
      [
        {
          target: "/work/unreadable.txt",
          file: {
            async arrayBuffer() {
              throw bodyError;
            },
          },
        },
      ],
      fileSystem,
    );

    await expect(result).rejects.toMatchObject({
      message: "failed to write uploaded files",
      cause: bodyError,
    });
    expect(opened).toEqual([]);
    expect(removed).toEqual([]);
  });
});
