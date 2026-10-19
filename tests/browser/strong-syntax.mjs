import { expect } from '@playwright/test';
import { createDocument, standard } from '@linloir/limr';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const source = '# Strong compatibility\n\n这是一段**“不可以"**的样例\n\n这也是一段**http:www\\.baidu.com**不可以样例\n\n同样的还有**中文带标点，**或是标点**，后面有**中文等\n\nдо**«текст»**после\n\n前**https://example.com/path**后\n\n前**www&#46;example.com**后\n\n12:30 :unknown[literal] `**code**` and \\*\\*literal\\*\\*\n';
const expected = ['“不可以"', 'http:www.baidu.com', '中文带标点，', '，后面有', '«текст»', 'https://example.com/path', 'www.example.com'];
const mappings = [['“中&amp;文\\!”', '“中&文!”'], ['http:www\\.baidu.com', 'http:www.baidu.com'], ['www&#46;example.com', 'www.example.com']];
const mappedSource = '\uFEFF---\ntitle: Strong source mapping\n---\n\n# Strong source mapping\n\n' + mappings.map(([raw]) => `𠀀前**${raw}**后`).join('\n\n') + '\n';

export async function runStrongSyntaxAcceptance({ page, frame, host, artifacts, fixture }) {
  const evidence = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const article = frame.locator('.limr-reader-content');
  const toolbar = frame.getByRole('toolbar');
  const record = async value => {
    evidence.push(value); console.log(value.check);
    await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2));
  };
  const reset = async text => {
    await frame.locator('body').press('Escape');
    await host('replaceSource', { source: text });
    await expect(frame.locator('.lv-app')).toHaveAttribute('aria-busy', 'false');
    await frame.evaluate(() => document.fonts.ready);
  };
  async function selectText(element, text) {
    await frame.locator('body').press('Escape');
    await expect(toolbar).toBeHidden();
    // Release focus from the previous toolbar action before selecting again.
    // This suite checks DOM-to-source mapping; native link drags can drag URLs.
    await article.locator('h1').click();
    await element.scrollIntoViewIfNeeded();
    const selected = await element.evaluate((element, text) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement.closest('[data-limr-ignore],button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      const nodes = []; let node, plain = '';
      while (node = walker.nextNode()) { nodes.push({ node, start: plain.length, end: plain.length + node.length }); plain += node.data; }
      const start = plain.indexOf(text), end = start + text.length;
      if (start < 0) throw new Error(`Missing selection: ${text}`);
      const first = nodes.find(item => item.end > start), last = nodes.find(item => item.end >= end);
      const range = document.createRange(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return selection.toString();
    }, text);
    expect(selected).toBe(text);
    await expect(toolbar).toBeVisible();
  }
  await host('configure', { values: { language: 'en', theme: 'playground-dark', editingEnabled: false, sidebarMode: 'hidden', tocMode: 'hidden', syncScroll: false, 'plugins.enabled': false } });
  for (const typography of ['standard', 'knuth-plass']) {
    await host('configure', { values: { typography } });
    await reset(source);
    for (const [width, sourceSize] of [['narrow', .76], ['wide', .25]]) {
      await host('layout', { sourceSize });
      await expect(article.locator('strong')).toHaveText(expected);
      await expect(article.locator('strong').nth(5).locator('a')).toHaveAttribute('href', 'https://example.com/path');
      await expect(article.locator('strong').nth(6).locator('a')).toHaveAttribute('href', 'http://www.example.com');
      await expect(article.locator('code')).toHaveText('**code**');
      await expect(article).toContainText('12:30 :unknown[literal]');
      await expect(article).toContainText('**literal**');
      expect(await article.locator('strong').evaluateAll(elements => elements.every(element => Number(getComputedStyle(element).fontWeight) >= 600))).toBe(true);
      if (typography === 'knuth-plass') await expect.poll(() => article.locator('[data-limr-kp]').count()).toBeGreaterThan(0);
      expect((await host('snapshot')).source).toBe(source);
      await page.screenshot({ path: path.join(artifacts, `${typography}-${width}.png`) });
      await record({ check: `${typography} ${width}: punctuation-adjacent strong, decoded URLs and literal colon/code text render without source edits` });
    }
    await host('layout', { sourceSize: .45 });
    await reset(mappedSource);
    for (const [index, [raw, visible]] of mappings.entries()) {
      await expect(article.locator('strong').nth(index)).toHaveText(visible);
      await selectText(article.locator('strong').nth(index), visible);
      await toolbar.getByRole('button', { name: 'Question context', exact: true }).click();
      let context, copied;
      await expect.poll(async () => {
        copied = await host('clipboard');
        context = JSON.parse(copied.match(/```json\r?\n([\s\S]*?)\r?\n```/)?.[1] ?? 'null');
        return context?.selectedText;
      }).toBe(visible);
      const snippet = `**${raw}**`, start = mappedSource.indexOf(snippet);
      expect(context).toMatchObject({ format: 'limr-context-v3', file: fixture, allowSourceEdits: false });
      expect(context.selections).toHaveLength(1);
      expect(context.selections[0]).toMatchObject({ start, end: start + snippet.length, raw: snippet });
      await writeFile(path.join(artifacts, `context-${typography}-${index}.txt`), copied);
      expect((await host('snapshot')).source).toBe(mappedSource);
      await record({ check: `${typography}: AI context keeps exact source coordinates for ${visible}`, selection: context.selections[0] });
      await frame.locator('body').press('Escape');
    }
    await host('configure', { values: { language: 'zh-CN', editingEnabled: true } });
    await selectText(article.locator('strong').nth(1), 'www.baidu.com');
    await toolbar.getByRole('button', { name: '添加高亮', exact: true }).click();
    await expect.poll(async () => (await host('snapshot')).source).toContain('type="highlight"');
    const edited = (await host('snapshot')).source;
    await writeFile(path.join(artifacts, `highlight-${typography}.md`), edited);
    const snapshot = createDocument(edited, { extensions: standard() }).getSnapshot();
    const highlight = snapshot.annotations.find(annotation => annotation.type === 'highlight');
    expect(highlight.id).toMatch(/^[0-9a-f]{6}$/);
    // Core extends a syntax selection at the strong boundary through its
    // closing delimiter, without capturing the unselected "http:" prefix.
    expect(highlight.anchors.map(anchor => edited.slice(anchor.range.start, anchor.range.end))).toEqual(['www\\.baidu.com**']);
    await expect(article.locator('strong')).toHaveText(mappings.map(([, visible]) => visible));
    await expect(frame.getByRole('alert')).toHaveCount(0);
    await host('undo');
    expect((await host('snapshot')).source).toBe(mappedSource);
    await record({ check: `${typography}: highlighting a decoded bold link preserves formatting and exact source, with short IDs and native Undo` });
    await host('configure', { values: { language: 'en', editingEnabled: false } });
  }
  expect(errors).toEqual([]);
  return evidence;
}
