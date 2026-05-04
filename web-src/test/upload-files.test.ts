import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const app = readFileSync('web-src/app.ts', 'utf8');
const server = readFileSync('web-src/server/preview.ts', 'utf8');
const style = readFileSync('web/style.css', 'utf8');

describe('upload files endpoint security', () => {
  test('upload is explicitly opt-in and uses a side-effect request gate', () => {
    expect(server.includes('let allowUpload = false')).toBe(true);
    expect(server.includes('function loadProjectConfigUploadEnabled(): boolean')).toBe(true);
    expect(server.includes("'.code-viewer.json'")).toBe(true);
    expect(server.includes("config?.upload?.enabled === true")).toBe(true);
    expect(server.includes("arg === '--allow-upload'")).toBe(true);
    expect(server.includes("if (url.pathname === '/_upload_files') return handleUploadFiles(req)")).toBe(true);
    expect(server.includes("if (!allowUpload) return text('upload disabled', 403)")).toBe(true);
    expect(server.includes("if (!sideEffectRequestAllowed(req)) return text('forbidden', 403)")).toBe(true);
  });

  test('upload accepts only bounded multipart form data', () => {
    expect(server.includes("return text('method not allowed', 405)")).toBe(true);
    expect(server.includes('multipart\\/form-data')).toBe(true);
    expect(server.includes('MAX_UPLOAD_BODY_BYTES')).toBe(true);
    expect(server.includes("return text('content length required', 411)")).toBe(true);
    expect(server.includes("return text('invalid content length', 400)")).toBe(true);
    expect(server.includes('MAX_UPLOAD_FILE_BYTES')).toBe(true);
    expect(server.includes('MAX_UPLOAD_TOTAL_BYTES')).toBe(true);
    expect(server.includes('MAX_UPLOAD_FILES')).toBe(true);
  });

  test('upload validates directory and file names before writing', () => {
    expect(server.includes('function safeUploadFileName(name: string): string | null')).toBe(true);
    expect(server.includes('function isForbiddenUploadName(name: string): boolean')).toBe(true);
    expect(server.includes("'.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'")).toBe(true);
    expect(server.includes("'.webp', '.svg', '.pdf'")).toBe(false);
    expect(server.includes("lower === 'dockerfile'")).toBe(true);
    expect(server.includes("lower.endsWith('.config.js')")).toBe(true);
    expect(server.includes('/^(tsconfig|jsconfig|bunfig|vercel|netlify|wrangler|next|vite|webpack|rollup|esbuild|astro|svelte|tailwind|postcss|babel|prettier|eslint)\\./')).toBe(true);
    expect(server.includes('constants.O_NOFOLLOW')).toBe(true);
    expect(server.includes("return text('file exists', 409)")).toBe(true);
    expect(server.includes("sendSse('update')")).toBe(true);
  });
});

describe('folder upload UI', () => {
  test('repository folder view exposes a drop zone and upload button', () => {
    expect(app.includes('function createRepoUploadPanel(path: string): HTMLElement')).toBe(true);
    expect(app.includes("dropPanel.className = 'gdp-upload-panel'")).toBe(true);
    expect(app.includes("input.type = 'file'")).toBe(true);
    expect(app.includes('input.multiple = true')).toBe(true);
    expect(app.includes('await uploadFiles(path, files)')).toBe(true);
    expect(app.includes("if (meta.upload_enabled && (meta.ref === 'worktree' || meta.ref === ''))")).toBe(true);
    expect(style.includes('.gdp-upload-panel')).toBe(true);
    expect(style.includes('.gdp-upload-panel.dragging')).toBe(true);
  });
});
