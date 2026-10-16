import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const header = `---
name: limr-reading-guide
description: >
  阅读、标注与整理 Markdown。
  Keep document information clear while preserving the original source.
version: 1.0.0
tags: [Markdown, annotations, 中文]
settings:
  enabled: true
  languages: [zh-CN, en]
---`;
const source = `${header}

# Reader guide

Body text stays editable after the metadata card.

- [ ] Preserve the original metadata

:::definition{title="Reading notes"}
This existing LiMR definition shares the metadata card’s visual style.
:::
`;

export async function runFrontmatterAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const card = () => frame.locator('.lv-frontmatter');
  const screenshot = name => page.screenshot({ path: path.join(artifacts, `frontmatter-${name}.png`) });
  const save = async item => { evidence.push(item); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); };
  await host('configure', { values: { language: 'zh-CN', editingEnabled: false, tocMode: 'hidden', sidebarMode: 'content', syncScroll: false, 'plugins.enabled': false, maxWidth: 760, theme: 'playground-dark' } });
  await host('replaceSource', { source });
  await host('layout', { sourceSize: .28 });
  await expect(card()).toHaveCount(1);
  await expect(card().locator('.lv-frontmatter-name')).toHaveText('limr-reading-guide');
  await expect(card().locator('.lv-frontmatter-description')).toContainText('阅读、标注与整理 Markdown。 Keep document information');
  await expect(card().getByText('enabled', { exact: true })).toBeVisible();
  await expect(card().getByText('true', { exact: true })).toBeVisible();
  await expect(card().locator('.lv-frontmatter-tags').first().locator('li')).toHaveCount(3);
  await expect(frame.getByRole('heading', { name: 'Reader guide', exact: true })).toBeVisible();
  await expect(card().locator('.lv-frontmatter-source')).not.toBeVisible();
  const mapped = await card().evaluate(element => {
    const block = element.closest('[data-source-start]');
    return { start: Number(block.dataset.sourceStart), end: Number(block.dataset.sourceEnd), border: getComputedStyle(element).borderInlineStartWidth };
  });
  expect(mapped).toEqual({ start: 0, end: header.length, border: '3px' });
  await screenshot('dark');
  await save({ check: 'Built-in frontmatter displays skill-style metadata, multiline descriptions, tags and nested fields with LiMR card styling; source offsets remain exact and no workspace plugin is needed', mapped });

  const summary = card().getByText('查看原始元信息', { exact: true });
  await summary.click();
  await expect(card().locator('.lv-frontmatter-source')).toBeVisible();
  expect(await card().locator('.lv-frontmatter-source').textContent()).toBe(header);
  await card().locator('summary').focus();
  await expect(card().locator('summary')).toHaveCSS('outline-style', 'none');
  await expect(card().locator('summary .limr-underline')).toHaveCSS('background-size', '100% 1px');
  await screenshot('original');
  await card().locator('summary').press('Enter');
  await expect(card().locator('.lv-frontmatter-source')).not.toBeVisible();
  expect((await host('snapshot')).source).toBe(source);
  await save({ check: 'Original YAML is available through an accessible disclosure, supports keyboard toggling and an underline focus cue, and never edits Markdown' });

  await host('configure', { values: { theme: 'playground-light' } });
  await screenshot('light');
  await host('layout', { sourceSize: .73 });
  await summary.click();
  await expect(card().locator('.lv-frontmatter-source')).toBeVisible();
  const narrow = await card().evaluate(element => {
    const root = document.querySelector('.lv-scroll');
    return { cardWidth: element.getBoundingClientRect().width, viewport: root.clientWidth, content: root.scrollWidth };
  });
  expect(narrow.content).toBeLessThanOrEqual(narrow.viewport + 1);
  await screenshot('narrow');
  await save({ check: 'Light and dark card styles stay readable; narrow readers wrap metadata and raw YAML without horizontal overflow', narrow });

  await host('layout', { sourceSize: .35 });
  await host('configure', { values: { editingEnabled: true, theme: 'playground-dark' } });
  await summary.click();
  await frame.locator('.limr-reader-content input[type="checkbox"]').first().check();
  await expect.poll(async () => (await host('snapshot')).source).toContain('- [x] Preserve the original metadata');
  expect((await host('snapshot')).source.slice(0, header.length)).toBe(header);
  await save({ check: 'A real checkbox edit after frontmatter uses original source offsets and leaves the header byte-for-byte unchanged' });

  const bomSource = '\uFEFF' + source.replaceAll('\n', '\r\n');
  // WorkspaceEdit normalizes inserted line endings to the editor's existing
  // EOL. Compare against the actual document; unit coverage also checks CRLF.
  const bomDocument = await host('replaceSource', { source: bomSource });
  expect(bomDocument.source.startsWith('\uFEFF---')).toBe(true);
  await expect(card().locator('.lv-frontmatter-name')).toHaveText('limr-reading-guide');
  await expect(frame.getByRole('heading', { name: 'Reader guide', exact: true })).toHaveAttribute('data-source-start', String(bomDocument.source.indexOf('# Reader guide')));
  expect((await host('snapshot')).source).toBe(bomDocument.source);
  await save({ check: 'BOM headers render while preserving actual VS Code document offsets; CRLF is separately covered by parser tests', sourceOffset: bomDocument.source.indexOf('# Reader guide'), nativeEditNormalizedCRLF: !bomDocument.source.includes('\r\n') });

  const malformed = '---\nname: broken\ndescription: [unfinished\n---\n\n# Body after invalid metadata\n';
  await host('replaceSource', { source: malformed });
  await expect(card().locator('.lv-frontmatter-source')).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Body after invalid metadata', exact: true })).toBeVisible();
  expect((await host('snapshot')).source).toBe(malformed);
  await screenshot('invalid');
  await host('replaceSource', { source: '---\nA normal paragraph\n\n---\n\n# Ordinary document\n' });
  await expect(card()).toHaveCount(0);
  await expect(frame.getByRole('heading', { name: 'Ordinary document', exact: true })).toBeVisible();
  await save({ check: 'Invalid YAML remains visible as original text; ordinary horizontal rules and surrounding prose stay normal Markdown' });

  const realSkill = await readFile(new URL('../../skills/limr-annotations/SKILL.md', import.meta.url), 'utf8');
  await host('replaceSource', { source: realSkill });
  await host('configure', { values: { language: 'en', editingEnabled: false } });
  await expect(card().locator('.lv-frontmatter-name')).toHaveText('limr-annotations');
  await expect(card().getByText('Document information', { exact: true })).toBeVisible();
  await expect(card().getByText('View original metadata', { exact: true })).toBeVisible();
  await screenshot('installed-skill');
  await save({ check: 'The bundled real SKILL.md displays its name and description as a readable card, with localized English controls' });
  expect(errors).toEqual([]);
  return evidence;
}
