import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileByteRangeResponseBody, fileReadableStream, readFileTextRange, runSync } from '../server/runtime';
import { collectLineRangeFromStream } from '../server/range';

const tmpRoot = join(import.meta.dir, '..', '..', '.tmp-tests');

describe('server runtime compatibility helpers', () => {
  test('runSync returns process status and decoded output', () => {
    const result = runSync([process.execPath, '-e', 'process.stdout.write("ok")'], process.cwd());

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('ok');
    expect(result.stderr).toBe('');
  });

  test('file stream can be consumed as a web ReadableStream', async () => {
    mkdirSync(tmpRoot, { recursive: true });
    const path = join(tmpRoot, 'lines.txt');
    writeFileSync(path, 'one\ntwo\nthree\n');

    const range = await collectLineRangeFromStream(fileReadableStream(path), 2, 2);

    expect(range.lines).toEqual(['two']);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('byte range body returns only the requested bytes', async () => {
    mkdirSync(tmpRoot, { recursive: true });
    const path = join(tmpRoot, 'bytes.txt');
    writeFileSync(path, 'abcdef');

    const body = await new Response(fileByteRangeResponseBody(path, 1, 3)).text();
    const text = await readFileTextRange(path, 2, 5);

    expect(body).toBe('bcd');
    expect(text).toBe('cde');
    expect(readFileSync(path, 'utf8')).toBe('abcdef');
    rmSync(tmpRoot, { recursive: true, force: true });
  });
});
