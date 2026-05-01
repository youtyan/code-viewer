import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const html = readFileSync('web/index.html', 'utf8');
const appSource = readFileSync('web-src/app.ts', 'utf8');
const style = readFileSync('web/style.css', 'utf8');

describe('mark viewed toolbar button', () => {
  test('uses per-file viewed checkboxes instead of toolbar controls', () => {
    expect(html.includes('id="mark-viewed"')).toBe(false);
    expect(html.includes('id="collapse"')).toBe(false);
    expect(appSource.includes("$('#mark-viewed').addEventListener('click'")).toBe(false);
    expect(appSource.includes("$('#collapse').addEventListener('click'")).toBe(false);
    expect(appSource.includes('gdp-viewed-checkbox')).toBe(false);
    expect(appSource.includes('gdp-viewed-label')).toBe(false);
    expect(appSource.includes('d2h-file-collapse-input')).toBe(true);
    expect(appSource.includes('gdp-file-toggle')).toBe(true);
    expect(appSource.includes('gdp-file-unfold')).toBe(true);
    expect(appSource.includes('octicon-copy')).toBe(true);
  });

  test('persists per-file viewed paths without dimming diff bodies', () => {
    expect(appSource.includes("localStorage.setItem('gdp:viewed-files'")).toBe(true);
    expect(appSource.includes('STATE.viewedFiles.add(path)')).toBe(true);
    expect(appSource.includes('STATE.viewedFiles.delete(path)')).toBe(true);
    expect(appSource.includes('setFileViewed(file.path, checkbox.checked)')).toBe(true);
    expect(style.includes('#filelist li.viewed')).toBe(true);
    expect(style.includes('.gdp-viewed-checkbox')).toBe(false);
    expect(style.includes('.gdp-file-shell.viewed {\n  opacity')).toBe(false);
  });
});
