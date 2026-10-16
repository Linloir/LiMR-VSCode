import { expect } from '@playwright/test';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const source = `# Native source highlighting

Ordinary **bold prose** and a [normal link](https://example.com).
Inline control: \`<callout title="inline code">\`.

<callout title="Native callout">
Body remains ordinary prose.
</callout>

:::definition{title="Directive title"}
Definition body remains ordinary prose.
:::

Range ::%%limr%%{<#native-range}selected body::%%limr%%{>#native-range} end.
Highlight ==marked body== and math $x + y$.

:::limr-annotation{#native-note ranges="native-range" type="margin-note"}
Native annotation body.
:::

\`\`\`typescript
// <callout title="fenced code"> ==literal== $raw$
const answer = 42;
\`\`\`

<!-- <callout title="comment control"> ==comment== -->
`;

const tokenSamples = [
  { label: 'punctuation', line: ':::definition{title="Directive title"}', text: ':::' },
  { label: 'tag', line: ':::definition{title="Directive title"}', text: 'definition' },
  { label: 'attribute', line: ':::definition{title="Directive title"}', text: 'title' },
  { label: 'value', line: ':::definition{title="Directive title"}', text: '"Directive title"' },
  { label: 'annotation', line: 'Range ::%%limr%%', text: '::%%limr%%{<#native-range}' },
  { label: 'highlight', line: 'Highlight ==marked body==', text: '==' },
  { label: 'math', line: 'Highlight ==marked body==', text: '$', occurrence: 1 },
];
const htmlSamples = [
  { label: 'punctuation', line: '<callout title="Native callout">', text: '<' },
  { label: 'tag', line: '<callout title="Native callout">', text: 'callout' },
  { label: 'attribute', line: '<callout title="Native callout">', text: 'title' },
  { label: 'value', line: '<callout title="Native callout">', text: '"Native callout"' },
];
const controls = [
  { label: 'plain', line: 'Ordinary **bold prose**', text: 'Ordinary' },
  { label: 'bold', line: 'Ordinary **bold prose**', text: 'bold prose' },
  { label: 'link', line: 'Ordinary **bold prose**', text: 'normal link' },
  { label: 'inline-code', line: 'Inline control:', text: '<callout title="inline code">' },
  { label: 'body', line: 'Body remains ordinary prose.', text: 'Body remains ordinary prose.' },
  { label: 'selected-body', line: 'Range ::%%limr%%', text: 'selected body' },
  { label: 'highlight-body', line: 'Highlight ==marked body==', text: 'marked body' },
  { label: 'math-body', line: 'Highlight ==marked body==', text: 'x + y' },
  { label: 'definition-body', line: 'Native annotation body.', text: 'Native annotation body.' },
  { label: 'fenced-code', line: '// <callout title="fenced code">', text: '<callout title="fenced code"> ==literal== $raw$' },
  { label: 'typescript', line: 'const answer = 42;', text: 'const answer = 42;' },
  { label: 'comment', line: '<!-- <callout title="comment control">', text: '<callout title="comment control"> ==comment==' },
];
const palette = {
  punctuation: '#E17C31', tag: '#CA47A8', attribute: '#36B3A4', value: '#A9A13C',
  annotation: '#C56B79', highlight: '#C29F47', math: '#6898D1',
};
const rgb = hex => `rgb(${[1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16)).join(', ')})`;

// Monaco splits lines across TextMate tokens and decoration spans. Measure each
// character's actual inherited CSS instead of depending on private span names.
async function colors(page, samples, group = 0) {
  return page.evaluate(({ samples, group }) => {
    const groups = [...document.querySelectorAll('.editor-group-container')]
      .filter(element => element.getBoundingClientRect().width > 0)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const lines = [...(groups[group]?.querySelectorAll('.monaco-editor .view-lines .view-line') ?? [])];
    const normalize = text => text.replaceAll('\u00a0', ' ');
    return Object.fromEntries(samples.map(sample => {
      const line = lines.find(element => normalize(element.textContent).includes(sample.line));
      if (!line) return [sample.label, null];
      const text = normalize(line.textContent);
      let offset = -1;
      for (let occurrence = 0; occurrence < (sample.occurrence ?? 1); occurrence++) offset = text.indexOf(sample.text, offset + 1);
      if (offset < 0) return [sample.label, null];
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT), characters = [];
      let node;
      while ((node = walker.nextNode())) {
        const style = getComputedStyle(node.parentElement);
        for (let index = 0; index < node.textContent.length; index++) characters.push({ color: style.color, background: style.backgroundColor, fontStyle: style.fontStyle, weight: style.fontWeight, decoration: style.textDecorationLine });
      }
      return [sample.label, characters.slice(offset, offset + sample.text.length)];
    }));
  }, { samples, group });
}

export async function runSyntaxHighlightingAcceptance({ page, host, artifacts, ready }) {
  const evidence = [], errors = [];
  let darkBaseline;
  page.on('pageerror', error => errors.push(error.message));
  const save = async item => { evidence.push(item); await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(evidence, null, 2)); };
  const screenshot = name => page.screenshot({ path: path.join(artifacts, `syntax-${name}.png`) });
  const snapshot = () => colors(page, tokenSamples);
  const assertPalette = async (group = 0) => {
    await expect.poll(async () => {
      const actual = await colors(page, tokenSamples, group);
      return Object.fromEntries(Object.entries(actual).map(([key, characters]) => [key, characters?.length ? [...new Set(characters.map(char => char.color))] : null]));
    }).toEqual(Object.fromEntries(Object.entries(palette).map(([key, hex]) => [key, [rgb(hex)]])));
  };
  expect(ready.sourceOnly).toBe(true);
  expect(ready.automaticallyActivated).toBe(true);
  const initial = await host('snapshot');
  expect(initial.groups.flatMap(group => group.tabs).some(tab => tab.custom === 'limr.reader')).toBe(false);
  expect(await host('readConfiguration', { keys: ['syntaxHighlighting.enabled'] })).toEqual({ 'syntaxHighlighting.enabled': true });
  await host('configureEditor', { values: { wordWrap: 'off', 'minimap.enabled': false, 'stickyScroll.enabled': false, lineHeight: 23 } });
  await host('replaceSource', { source });
  await expect.poll(async () => Object.values(await snapshot()).every(Boolean)).toBe(true);
  await save({ check: 'Opening only a Markdown source activates LiMR and enables source highlighting by default; no reader is open', automaticallyActivated: ready.automaticallyActivated });

  for (const [mode, themeName] of [['dark', 'Default Dark Modern'], ['light', 'Default Light Modern']]) {
    await host('configureWorkbench', { values: { colorTheme: themeName, colorCustomizations: {} } });
    await host('configure', { values: { 'syntaxHighlighting.enabled': false } });
    await expect(page.locator('.monaco-workbench')).toHaveClass(mode === 'dark' ? /\bvs-dark\b/ : /\bvs\b/);
    const offTokens = await snapshot(), offControls = await colors(page, controls);
    if (mode === 'dark') darkBaseline = offTokens;
    expect(Object.values(offTokens).every(Boolean)).toBe(true);
    expect(Object.values(offControls).every(Boolean)).toBe(true);
    await host('configure', { values: { 'syntaxHighlighting.enabled': true } });
    await expect.poll(async () => {
      const on = await snapshot();
      return Object.fromEntries(['annotation', 'highlight', 'math'].map(role => [role, JSON.stringify(on[role]) !== JSON.stringify(offTokens[role])]));
    }).toEqual({ annotation: true, highlight: true, math: true }).catch(async error => {
      await writeFile(path.join(artifacts, 'color-debug.json'), JSON.stringify({ mode, off: offTokens, on: await snapshot() }, null, 2));
      throw error;
    });
    const onTokens = await snapshot();
    expect(await colors(page, controls)).toEqual(offControls);
    await screenshot(mode);
    const disabledAt = Date.now();
    await host('configure', { values: { 'syntaxHighlighting.enabled': false } });
    await expect.poll(snapshot).toEqual(offTokens);
    expect(await colors(page, controls)).toEqual(offControls);
    await save({ check: `${mode} theme: paired markers, highlight delimiters and math delimiters have visible colors; disabling restores the native grammar; ordinary Markdown, body text, inline/fenced code and comments are unchanged`, disableObservedMs: Date.now() - disabledAt, off: offTokens, on: onTokens });
  }

  await host('configureWorkbench', { values: { colorTheme: 'Default Dark Modern', colorCustomizations: Object.fromEntries(Object.entries(palette).map(([role, hex]) => [`limr.syntax.${role}`, hex])) } });
  await host('configure', { values: { 'syntaxHighlighting.enabled': true } });
  await assertPalette();
  await screenshot('custom-colors');
  await save({ check: 'All seven contributed syntax colors reach actual native editor glyphs, including attributes/values and annotation boundaries', palette });

  // LiMR 1.2.2's MDX parser falls back to raw HTML in a document containing an
  // HTML comment. Verify JSX in a separate valid document, and keep the literal
  // comment controls above to check that we respect that parser's boundaries.
  await host('replaceSource', { source: source.replace(/<!--[^\n]*-->\n/, '') });
  await expect.poll(async () => {
    const actual = await colors(page, htmlSamples);
    return Object.fromEntries(Object.entries(actual).map(([key, characters]) => [key, characters?.length ? [...new Set(characters.map(char => char.color))] : null]));
  }).toEqual(Object.fromEntries(htmlSamples.map(({ label }) => [label, [rgb(palette[label])]])));
  await save({ check: 'Valid JSX component names, punctuation, attributes and values also receive the four configured native editor colors' });
  await host('replaceSource', { source });
  await assertPalette();

  const scratch = await host('openUntitledSource', { source });
  expect(scratch.scratch.language).toBe('markdown');
  expect(scratch.scratch.source).toBe(source);
  await assertPalette(0);
  await assertPalette(1);
  await host('configure', { values: { 'syntaxHighlighting.enabled': false } });
  await expect.poll(async () => Promise.all([colors(page, tokenSamples, 0), colors(page, tokenSamples, 1)])).toEqual([darkBaseline, darkBaseline]);
  await host('configure', { values: { 'syntaxHighlighting.enabled': true } });
  await assertPalette(0);
  await assertPalette(1);
  await screenshot('two-editors');
  await save({ check: 'Both a file and an untitled Markdown editor receive decorations, clear them when disabled and restore them when enabled', scratch: scratch.scratch.uri });

  await host('activateSource');
  const changed = source.replace('Directive title', 'Edited directive');
  await host('replaceSource', { source: changed });
  await expect.poll(async () => {
    const value = await colors(page, [{ label: 'edited-value', line: ':::definition{title="Edited directive"}', text: '"Edited directive"' }]);
    return [...new Set(value['edited-value']?.map(character => character.color))];
  }).toEqual([rgb(palette.value)]);
  expect((await host('snapshot')).source).toBe(changed);
  await host('replaceSource', { source });
  await assertPalette();
  expect((await host('snapshot')).source).toBe(source);
  expect((await host('snapshot')).groups.flatMap(group => group.tabs).some(tab => tab.custom === 'limr.reader')).toBe(false);
  await save({ check: 'Live source edits update decorations without rewriting Markdown; theme/configuration changes also preserve source exactly and never require a reader tab' });
  expect(errors).toEqual([]);
  await rm(path.join(artifacts, 'color-debug.json'), { force: true });
  return evidence;
}
