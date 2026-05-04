import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const appSource = readFileSync('web-src/app.ts', 'utf8');
const style = readFileSync('web/style.css', 'utf8');

describe('sidebar folder icons', () => {
  test('uses GitHub Octicon folder paths instead of emoji folders', () => {
    expect(appSource.includes('M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z')).toBe(true);
    expect(appSource.includes('M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z')).toBe(true);
    expect(appSource.includes('📁')).toBe(false);
    expect(appSource.includes('📂')).toBe(false);
  });

  test('uses GitHub Octicon chevron for folder disclosure', () => {
    expect(appSource.includes('octicon-chevron-down')).toBe(true);
    expect(appSource.includes('M6 8.825c-.2 0-.4-.1-.5-.2l-3.3-3.3c-.3-.3-.3-.8 0-1.1.3-.3.8-.3 1.1 0l2.7 2.7 2.7-2.7c.3-.3.8-.3 1.1 0 .3.3.3.8 0 1.1l-3.2 3.2c-.2.2-.4.3-.6.3Z')).toBe(true);
  });

  test('sizes the sidebar folder icon like a 16px Octicon', () => {
    expect(style.includes('#filelist.tree .tree-dir .dir-icon')).toBe(true);
    expect(style.includes('width: 16px')).toBe(true);
    expect(style.includes('height: 16px')).toBe(true);
    expect(style.includes('color: #54aeff')).toBe(true);
    expect(style.includes('grid-template-columns: 16px 16px minmax(0, 1fr)')).toBe(true);
    expect(style.includes('gap: 8px')).toBe(true);
    expect(style.includes('padding: calc(var(--sidebar-row-y) + 1.5px) 8px calc(var(--sidebar-row-y) + 1.5px) var(--lvl-pad, 12px)')).toBe(true);
  });

  test('marks intentionally omitted directory children in the sidebar', () => {
    expect(appSource.includes('children_omitted?: true')).toBe(true);
    expect(appSource.includes("children_omitted_reason?: RepoTreeEntry['children_omitted_reason']")).toBe(true);
    expect(appSource.includes('f.children_omitted === true')).toBe(true);
    expect(appSource.includes("li.classList.add('children-omitted')")).toBe(true);
    expect(appSource.includes("li.classList.add(dir.children_omitted_reason === 'heavy' ? 'children-omitted-heavy' : 'children-omitted-internal')")).toBe(true);
    expect(appSource.includes("omitted.className = 'dir-omitted ' +")).toBe(true);
    expect(appSource.includes("omitted.textContent = dir.children_omitted_reason === 'heavy' ? 'skipped' : 'private'")).toBe(true);
    expect(appSource.includes("if (dir.children_omitted) {\n          chev.className = 'chev-spacer';")).toBe(true);
    expect(appSource.includes('if (!dir.children_omitted) {\n          chev.addEventListener')).toBe(true);
    expect(appSource.includes("dir.children_omitted_reason === 'internal' || dir.children_omitted_reason === 'truncated'")).toBe(true);
    expect(appSource.includes('children_omitted: entry.children_omitted')).toBe(true);
    expect(appSource.includes('children_omitted_reason: entry.children_omitted_reason')).toBe(true);
    expect(style.includes('#filelist.tree .tree-dir.children-omitted')).toBe(true);
    expect(style.includes('#filelist.tree .tree-dir.children-omitted-heavy')).toBe(true);
    expect(style.includes('#filelist.tree .tree-dir.children-omitted-internal')).toBe(true);
    expect(style.includes('#filelist.tree .tree-dir .dir-omitted')).toBe(true);
    expect(style.includes('#filelist.tree .tree-dir .dir-omitted-heavy')).toBe(true);
    expect(style.includes('#filelist.tree .tree-dir .dir-omitted-internal')).toBe(true);
    expect(style.includes('#filelist.tree .tree-dir .chev-spacer')).toBe(true);
    expect(style.includes('height: 16px;\n  display: inline-block;')).toBe(true);
  });
});
