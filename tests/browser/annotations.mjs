import { expect } from '@playwright/test';
import { createDocument, standard } from '@linloir/limr';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const plain = '# Annotation actions\n\nBefore **selected words** after.\n\nAn independent paragraph.\n';
const kinds = [['margin-note', '旁注'], ['question', '提问'], ['inline-note', '内联笔记'], ['footnote', '脚注']];
const grouped = `# Annotation actions

Before ::%%limr%%{<#selected}**selected words**::%%limr%%{>#selected} after.

An independent footnote[^native] and <ref id="paper">citation</ref>.

[^native]: Keep this ordinary Markdown footnote.

<citation id="paper" title="A paper" author="Example" year="2026" />

:::limr-annotation{#paint ranges="selected" type="highlight" color="#6B9BD2" style="underline" hidden="false"}
:::

${kinds.map(([type]) => `:::limr-annotation{#${type} ranges="selected" type="${type}" custom="retain"}\nThe ${type} body stays intact.\n:::`).join('\n\n')}
`;
const model = source => createDocument(source, { extensions: standard() }).getSnapshot();
const sourceAnnotations = source => model(source).annotations.filter(item => item.source);

export async function runAnnotationAcceptance({ page, frame, host, artifacts }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await host('configure', { values: { language: 'zh-CN', theme: 'one-dark-pro', editingEnabled: false, sidebarMode: 'hidden', tocMode: 'hidden', syncScroll: false, 'plugins.enabled': false } });
  const toolbar = frame.getByRole('toolbar');
  const paragraph = () => frame.locator('.limr-reader-content > article > p').first();
  const save = async value => { evidence.push(value); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); console.log(value.check); };
  const screenshot = name => page.screenshot({ path: path.join(artifacts, `${name}.png`) });
  async function dismiss() {
    await frame.locator('body').press('Escape');
    if (await toolbar.count()) await frame.locator('body').press('Escape');
  }
  async function reset(source) {
    await dismiss();
    await host('replaceSource', { source });
    await expect(frame.locator('.lv-app')).toHaveAttribute('aria-busy', 'false');
    await frame.getByTestId('reader-scroll').evaluate(element => element.scrollTop = 0);
    await frame.evaluate(() => document.fonts.ready);
  }
  async function selectWords() {
    await paragraph().locator('strong').evaluate(element => {
      const range = document.createRange(), selection = getSelection();
      range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await expect(toolbar).toBeVisible();
  }
  await reset(grouped);
  await paragraph().getByRole('button', { name: '旁注', exact: true }).click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button')).toHaveCount(2);
  await expect(toolbar.getByRole('button', { name: '复制', exact: true })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '提问上下文', exact: true })).toBeVisible();
  await host('configure', { values: { editingEnabled: true } });
  await expect(toolbar.getByRole('button', { name: '隐藏高亮', exact: true })).toBeVisible();
  await expect(toolbar.locator('[data-action-id="delete-annotations"]')).toBeVisible();
  expect((await host('snapshot')).source).toBe(grouped);
  await save({ check: 'The current read-only setting reproduces Copy/Question-context only; enabling editing immediately exposes Hide and Delete without changing the document' });

  await reset(plain);
  await selectWords();
  await toolbar.getByRole('button', { name: '添加高亮', exact: true }).click();
  await expect.poll(async () => sourceAnnotations((await host('snapshot')).source).map(item => item.type)).toEqual(['highlight']);
  await paragraph().locator('strong').click();
  await expect(toolbar.getByRole('button', { name: '隐藏高亮', exact: true })).toHaveCount(0);
  await expect(toolbar.locator('[data-action-id="delete-annotations"]')).toBeVisible();
  await host('undo'); expect((await host('snapshot')).source).toBe(plain);
  await save({ check: 'Selecting text creates a source-backed highlight and native Undo restores the original text' });

  for (const legacy of ['==**selected words**==[^legacy]', '==**selected words**=[^legacy]']) {
    await reset(`# Annotation actions\n\nBefore ${legacy} after.\n\n[^legacy]: Keep this native footnote.\n`);
    await paragraph().getByRole('button', { name: /脚注/ }).click();
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator('[data-action-id="delete-annotations"]')).toHaveCount(0);
    await expect(toolbar.locator('.limr-toolbar-readonly-hint')).toHaveCount(0);
    await expect(frame.locator('.lv-note-actions button.lv-delete')).toHaveCount(0);
    await host('configure', { values: { editingEnabled: false } });
    await expect(toolbar.locator('[data-action-id="delete-annotations"]')).toHaveCount(0);
    await host('configure', { values: { editingEnabled: true } });
  }
  await save({ check: 'Legacy highlight-footnote markers and native footnotes never expose deletion; a lone source highlight has Delete without Hide' });

  await reset(plain); await selectWords();
  await toolbar.getByRole('button', { name: '提问上下文', exact: true }).click();
  const copied = await host('clipboard');
  const context = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(copied)[1]);
  expect(context.format).toBe('limr-context-v3'); expect(context.allowSourceEdits).toBe(true);
  const inputFile = path.join(artifacts, 'question-answer.json');
  await writeFile(inputFile, JSON.stringify({ question: 'Why select these words?', answer: 'This answer is shown first, then recorded with **both** question and answer.' }));
  const invoke = () => run(process.execPath, [context.writeback.script, '--context', context.writeback.context, '--input', inputFile]);
  const result = JSON.parse((await invoke()).stdout);
  expect(result.ok).toBe(true); expect(result.saved).toBe(false);
  const written = await host('snapshot');
  expect(written.source).toContain('Why select these words?'); expect(written.source).toContain('This answer is shown first');
  expect(model(written.source).annotations.filter(item => item.type === 'question')).toHaveLength(1);
  expect(JSON.parse((await invoke()).stdout).annotationId).toBe(result.annotationId);
  expect((await host('snapshot')).version).toBe(written.version);
  await host('undo'); expect((await host('snapshot')).source).toBe(plain);
  await dismiss(); await selectWords();
  await toolbar.getByRole('button', { name: '提问上下文', exact: true }).click();
  const stale = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(await host('clipboard'))[1]);
  const changed = await host('editSource', { start: 0, text: 'New editor input.\n\n' });
  let failure;
  try { await run(process.execPath, [stale.writeback.script, '--context', stale.writeback.context, '--input', inputFile]); }
  catch (error) { failure = error; }
  expect(failure?.stderr).toContain('Markdown changed');
  expect((await host('snapshot')).source).toBe(changed.source);
  await save({ check: 'Compact context invokes the real bundled script against an unsaved buffer; complete Q/A, highlighting, idempotent retry, native undo and stale-version refusal pass', contextCharacters: copied.length });

  for (const [type, label] of kinds.slice(0, 2)) {
    await reset(plain);
    await selectWords();
    await toolbar.getByRole('button', { name: `添加${label}`, exact: true }).click();
    const editor = frame.getByRole('textbox', { name: `${label}内容`, exact: true });
    await expect(editor).toBeEnabled();
    await editor.fill(`Saved ${type} answer.`);
    await frame.locator('.limr-annotation-overlay').getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => sourceAnnotations((await host('snapshot')).source).find(item => item.type === type)?.data.body).toBe(`Saved ${type} answer.`);
    const snapshot = model((await host('snapshot')).source);
    expect(snapshot.annotations.map(item => item.type).sort()).toEqual(['highlight', type].sort());
    expect(snapshot.annotationRanges.size).toBe(1);
    expect(snapshot.annotations[0].anchors.map(anchor => anchor.range)).toEqual(snapshot.annotations[1].anchors.map(anchor => anchor.range));
  }
  await save({ check: 'Creating and saving a margin note or question also creates a highlight on the same single named range' });

  for (const label of ['highlight', ...kinds.map(([, label]) => label)]) {
    await reset(grouped);
    const activate = () => label === 'highlight' ? paragraph().locator('strong').click()
      : paragraph().getByRole('button', { name: label, exact: true }).click();
    await activate();
    await toolbar.getByRole('button', { name: '隐藏高亮', exact: true }).click();
    await expect.poll(async () => sourceAnnotations((await host('snapshot')).source).find(item => item.type === 'highlight').data.hidden).toBe(true);
    const hidden = (await host('snapshot')).source;
    expect(sourceAnnotations(hidden).filter(item => item.type !== 'highlight').map(item => [item.id, item.data]))
      .toEqual(sourceAnnotations(grouped).filter(item => item.type !== 'highlight').map(item => [item.id, item.data]));
    // Hidden paint has no hit target after dismissal; its annotation markers
    // remain available. A text-origin toolbar can toggle back while still open.
    if (label !== 'highlight') { await dismiss(); await activate(); }
    await toolbar.getByRole('button', { name: '显示高亮', exact: true }).click();
    await expect.poll(async () => sourceAnnotations((await host('snapshot')).source).find(item => item.type === 'highlight').data.hidden).toBe(false);
    await dismiss(); await activate();
    if (label !== 'highlight') {
      const overlay = frame.locator('.limr-annotation-overlay');
      const type = kinds.find(item => item[1] === label)[0];
      await expect(overlay.locator('.lv-note-content')).toContainText(`The ${type} body stays intact.`);
      await expect.poll(() => overlay.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
    }
    await screenshot(`annotation-${label === 'highlight' ? label : kinds.find(item => item[1] === label)[0]}`);
    const beforeDelete = await host('snapshot');
    await toolbar.locator('[data-action-id="delete-annotations"]').getByRole('button', { name: '删除', exact: true }).click();
    await expect.poll(async () => sourceAnnotations((await host('snapshot')).source).length).toBe(0);
    const deleted = await host('snapshot');
    expect(deleted.version).toBe(beforeDelete.version + 1);
    expect(deleted.source).not.toContain('::%%limr%%');
    expect(deleted.source).toContain('Before **selected words** after.');
    expect(deleted.source.slice(deleted.source.indexOf('An independent')).trim()).toBe(grouped.slice(grouped.indexOf('An independent'), grouped.indexOf(':::limr-annotation')).trim());
    await host('undo'); expect((await host('snapshot')).source).toBe(beforeDelete.source);
    await host('redo'); expect((await host('snapshot')).source).toBe(deleted.source);
    await save({ check: `${label}: Hide/Show persist, Delete removes all five source annotations in one edit, Undo/Redo work, and native footnotes/ref citations stay unchanged` });
  }

  const reference = await readFile(new URL('../../skills/limr-annotations/references/source-annotations.md', import.meta.url), 'utf8');
  const bilingual = [...reference.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map(match => match[1]).find(source => source.includes('<translations'));
  await reset(`# Annotation actions\n\n${bilingual}\n`);
  for (const [mode, quote] of [['original', 'avoids repeated network requests'], ['translated', '避免重复的网络请求']]) {
    await host('configure', { values: { translationMode: mode } });
    await expect(frame.locator('.limr-reader-content')).toContainText(quote);
    await frame.locator('.limr-reader-content').getByRole('button', { name: '提问', exact: true }).click();
    const overlay = frame.locator('.limr-annotation-overlay');
    await expect(overlay).toContainText('为什么缓存可以减少网络请求？');
    await expect(overlay).toContainText('缓存保存先前请求的结果');
    await expect(toolbar.getByRole('button', { name: '隐藏高亮', exact: true })).toBeVisible();
    await screenshot(`annotation-${mode}`);
    await dismiss();
  }
  await save({ check: 'The skill bilingual example parses once and opens the same saved question and answer from either original-only or translated-only display' });

  await host('layout', { sourceSize: .18 });
  await host('configure', { values: { sidebarMode: 'always' } });
  await reset(grouped);
  const card = frame.locator('.limr-sidebar-card').filter({ has: frame.locator('.lv-note-preview') }).first();
  for (const adaptive of [true, false]) {
    await host('configure', { values: { sidebarAutoCollapse: adaptive } });
    await expect(card).not.toHaveAttribute('data-expanded');
    await card.locator('.lv-note-summary').click();
    await expect(card).toHaveAttribute('data-expanded', 'true');
    await expect(card.locator('.lv-note-content p')).toBeVisible();
    await screenshot(`sidebar-expanded-by-body-${adaptive}`);
    await card.locator('.lv-note-content p').click();
    await expect(card).toHaveAttribute('data-expanded', 'true');
    await card.locator('.limr-sidebar-card-heading').click();
    await expect(card).not.toHaveAttribute('data-expanded');
    const type = await card.getAttribute('data-type');
    const label = kinds.find(item => item[0] === type)[1];
    await card.locator('.lv-note-preview').getByRole('button', { name: `编辑${label}`, exact: true }).click();
    const editor = card.getByRole('textbox', { name: `${label}内容`, exact: true });
    await expect(editor).toBeVisible();
    await editor.press('Escape');
    await card.locator('.limr-sidebar-card-heading').click();
    await expect(card).not.toHaveAttribute('data-expanded');
    await screenshot(`sidebar-preview-click-${adaptive}`);
  }
  expect((await host('snapshot')).source).toBe(grouped);
  await save({ check: 'Collapsed sidebar summaries expand on click in both sidebar layouts; expanded content stays open, headings collapse, and Edit opens the editor without changing source' });
  expect(errors).toEqual([]);
  return evidence;
}
