import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// These are actual standard() syntaxes, copied in structure from the published
// callout/translations/question renderers and the sibling Playground examples.
export const blockMotionSource = `# LiMR block motion

> [!tip]+ Motion callout
> The first paragraph gives this callout a measurable open height.
>
> A second paragraph makes its collapse and return easy to inspect.
>
> A third paragraph remains readable after the arrow has settled.

<translations default="origin">
<origin>

Original passage for the translation motion check.

The original second paragraph is retained while the translation opens.

</origin>
<translation>

译文第一段用于观察内容展开时的自然高度变化。

译文第二段保留足够的阅读空间，并验证最终内容可见。

译文第三段用于区分原文与译文的最终高度。

</translation>
</translations>

<question title="Motion practice">
<question-content>Which answer identifies the first option?</question-content>
<question-sel-grp answer="[0]">
<question-sel>The first option is correct.</question-sel>
<question-sel>The second option is incorrect.</question-sel>
</question-sel-grp>
<question-hint>

The correct option appears before the other option.

This second hint paragraph makes its disclosure height measurable.

</question-hint>
<question-answer>

The first option is the expected answer.

This explanatory paragraph remains readable after the result animates.

The final explanation paragraph verifies the expanded panel boundary.

</question-answer>
</question>
`;

/** Run inside the existing real VS Code webview; no animation is paused, sought,
 * replaced, or slowed down. The caller restores its fixture/settings afterward. */
export async function runBlockMotion({ page, frame, host, artifacts }) {
  const evidence = [];
  expect(await frame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'Block motion suite requires the normal-motion path').toBe(false);
  await host('configure', { values: { sidebarMode: 'hidden', tocMode: 'hidden', syncScroll: false } });
  await host('replaceSource', { source: blockMotionSource });
  await expect(frame.getByRole('heading', { name: 'LiMR block motion', exact: true })).toBeVisible();
  await frame.evaluate(() => document.fonts.ready);

  const callout = frame.locator('.limr-callout');
  const translation = frame.locator('.limr-translations');
  const quiz = frame.locator('.limr-question');
  // A missing parser/renderer is an explicit capability failure, never a fake
  // DOM fixture or a silent success: all three modules are in standard() 1.1.1.
  await expect(callout).toHaveCount(1);
  await expect(translation).toHaveCount(1);
  await expect(quiz).toHaveCount(1);

  async function settle(root) {
    await expect.poll(() => root.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect.getTiming().iterations !== Infinity).length)).toBe(0);
  }

  async function capture(rootSelector, trigger, name, targets) {
    const root = frame.locator(rootSelector);
    await trigger.scrollIntoViewIfNeeded();
    await settle(root);
    // Register before the real Playwright click so an IPC round trip cannot
    // miss a short transition. Sampling starts in capture phase, before React.
    await trigger.evaluate((button, { rootSelector, targets }) => {
      const root = document.querySelector(rootSelector);
      const measure = () => Object.fromEntries(Object.entries(targets).map(([name, selector]) => {
        const element = selector === ':scope' ? root : root.querySelector(selector);
        if (!element) return [name, null];
        const css = getComputedStyle(element), rect = element.getBoundingClientRect();
        const matrix = new DOMMatrixReadOnly(css.transform === 'none' ? undefined : css.transform);
        return [name, {
          height: rect.height, width: rect.width, opacity: Number(css.opacity), transform: css.transform,
          angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI, scale: matrix.a,
          grid: css.gridTemplateRows, paddingTop: parseFloat(css.paddingTop),
          transitionProperty: css.transitionProperty, transitionDuration: css.transitionDuration,
          inert: element.hasAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden'),
        }];
      }));
      window.__limrBlockMotion = new Promise(resolve => {
        button.addEventListener('click', () => {
          const samples = [], started = performance.now();
          const sample = () => {
            samples.push({ time: performance.now() - started, values: measure(), animations: root.getAnimations({ subtree: true }).map(animation => ({
              name: animation instanceof CSSTransition ? animation.transitionProperty : animation instanceof CSSAnimation ? animation.animationName : 'Web Animation',
              target: String(animation.effect.target?.getAttribute?.('class') ?? ''),
              state: animation.playState, currentTime: animation.currentTime, duration: animation.effect.getTiming().duration,
            })) });
            if (performance.now() - started < 850) requestAnimationFrame(sample);
            else resolve({ samples, final: measure() });
          };
          sample();
        }, { once: true, capture: true });
      });
    }, { rootSelector, targets });
    await trigger.click();
    // A natural screenshot may land at any in-flight frame. Numerical rAF
    // samples, rather than this screenshot's timing, prove the interpolation.
    const naturalScreenshot = page.screenshot({ path: path.join(artifacts, `${name}-natural.png`), animations: 'allow' });
    const result = await frame.evaluate(() => window.__limrBlockMotion);
    await naturalScreenshot;
    await settle(root);
    await page.screenshot({ path: path.join(artifacts, `${name}-end.png`), animations: 'allow' });
    const advancing = result.samples.some((sample, index) => index > 0 && sample.animations.some(animation => {
      const previous = result.samples[index - 1].animations.find(item => item.name === animation.name && item.target === animation.target);
      return animation.state === 'running' && typeof animation.currentTime === 'number' && typeof previous?.currentTime === 'number' && animation.currentTime > previous.currentTime;
    }));
    const item = { check: name, natural: true, advancing, ...result };
    // Persist even a failed assertion's samples for diagnosis in the same host.
    await writeFile(path.join(artifacts, `${name}.json`), JSON.stringify(item, null, 2));
    expect(advancing, `${name}: real animations advance without changing their clocks`).toBe(true);
    evidence.push(item);
    console.log(`Animation checked: ${name}`);
    return item;
  }

  function interpolates(result, target, property, tolerance = .05) {
    const values = result.samples.map(sample => sample.values[target]?.[property]).filter(value => typeof value === 'number');
    const start = values[0], end = result.final[target]?.[property];
    expect(Math.abs(end - start), `${result.check}: ${target}.${property} changes`).toBeGreaterThan(tolerance * 2);
    const min = Math.min(start, end), max = Math.max(start, end);
    expect(values.filter(value => value > min + tolerance && value < max - tolerance).length, `${result.check}: ${target}.${property} has multiple natural intermediate frames`).toBeGreaterThan(1);
  }

  const calloutTargets = { panel: ':scope > .limr-collapse', arrow: '.limr-callout-toggle > svg', content: '.limr-block-content' };
  let motion = await capture('.limr-callout', callout.locator('.limr-callout-toggle'), 'block-callout-collapse', calloutTargets);
  interpolates(motion, 'panel', 'height'); interpolates(motion, 'arrow', 'angle');
  expect(motion.final.panel.height).toBeLessThan(.5);
  expect(motion.final.panel.inert).toBe(true);
  await expect(callout.locator('.limr-callout-toggle')).toHaveAttribute('aria-expanded', 'false');

  motion = await capture('.limr-callout', callout.locator('.limr-callout-toggle'), 'block-callout-expand', calloutTargets);
  interpolates(motion, 'panel', 'height'); interpolates(motion, 'arrow', 'angle');
  expect(motion.final.panel.height).toBeGreaterThan(40);
  expect(motion.final.panel.inert).toBe(false);
  await expect(callout.locator('.limr-callout-toggle')).toHaveAttribute('aria-expanded', 'true');

  const translationTargets = {
    translated: '.limr-translation-panel:has([data-language="translation"])',
    original: '.limr-translation-panel:has([data-language="origin"])',
    translatedContent: '[data-language="translation"]', originalContent: '[data-language="origin"]',
  };
  motion = await capture('.limr-translations', translation.locator('[data-translation-switch]'), 'block-translation-expand', translationTargets);
  interpolates(motion, 'translated', 'height'); interpolates(motion, 'original', 'height');
  // 1.1.1's translation-text transition shorthand replaces the generic
  // Collapse opacity/transform transitions with padding-block-start only.
  // Verify its real height animation and correct visibility endpoint.
  expect(motion.final.translatedContent.transitionProperty).toContain('padding-block-start');
  expect(motion.final.translatedContent.transitionProperty).not.toContain('opacity');
  expect(motion.final.translatedContent.opacity).toBe(1);
  await expect(translation).toHaveAttribute('data-mode', 'translation');
  expect(motion.final.translated.inert).toBe(false); expect(motion.final.original.inert).toBe(true);

  motion = await capture('.limr-translations', translation.locator('[data-translation-switch]'), 'block-translation-parallel', translationTargets);
  interpolates(motion, 'original', 'height'); interpolates(motion, 'originalContent', 'paddingTop');
  await expect(translation).toHaveAttribute('data-mode', 'both');
  expect(motion.final.translated.inert).toBe(false); expect(motion.final.original.inert).toBe(false);

  motion = await capture('.limr-translations', translation.locator('[data-translation-switch]'), 'block-translation-return', translationTargets);
  interpolates(motion, 'translated', 'height');
  await expect(translation).toHaveAttribute('data-mode', 'origin');
  expect(motion.final.translated.height).toBeLessThan(.5); expect(motion.final.original.height).toBeGreaterThan(30);

  motion = await capture('.limr-question', quiz.locator('.limr-question-options label').first(), 'block-quiz-choice', { diamond: '.limr-question-options label:first-of-type .limr-diamond-fill' });
  interpolates(motion, 'diamond', 'scale', .005);
  await expect(quiz.locator('input[type="radio"]').first()).toBeChecked();
  const quizTargets = {
    resultPanel: '.limr-question-actions > .limr-collapse', result: '.limr-question-result',
    answerPanel: '.limr-disclosure:last-of-type > .limr-collapse',
    answerArrow: '.limr-disclosure:last-of-type > summary > svg',
    buttonLabel: '.limr-question-actions > button > .limr-button-label',
  };
  motion = await capture('.limr-question', quiz.locator('.limr-question-actions > button'), 'block-quiz-submit', quizTargets);
  interpolates(motion, 'resultPanel', 'height'); interpolates(motion, 'answerPanel', 'height'); interpolates(motion, 'answerArrow', 'angle');
  await expect(quiz.getByRole('status')).toHaveText('回答正确');
  await expect(quiz.locator('.limr-question-actions > button')).toHaveAttribute('data-checked');
  expect(motion.final.result.opacity).toBe(1);

  const answer = quiz.locator('.limr-disclosure').last();
  motion = await capture('.limr-question', answer.locator('summary'), 'block-quiz-answer-collapse', quizTargets);
  interpolates(motion, 'answerPanel', 'height'); interpolates(motion, 'answerArrow', 'angle');
  await expect(answer.locator('summary')).toHaveAttribute('aria-expanded', 'false');
  expect(motion.final.answerPanel.height).toBeLessThan(.5);

  motion = await capture('.limr-question', answer.locator('summary'), 'block-quiz-answer-expand', quizTargets);
  interpolates(motion, 'answerPanel', 'height'); interpolates(motion, 'answerArrow', 'angle');
  await expect(answer.locator('summary')).toHaveAttribute('aria-expanded', 'true');
  expect(motion.final.answerPanel.inert).toBe(false);

  motion = await capture('.limr-question', quiz.locator('.limr-disclosure').first().locator('summary'), 'block-quiz-hint-expand', {
    hintPanel: '.limr-disclosure:first-of-type > .limr-collapse', hintArrow: '.limr-disclosure:first-of-type > summary > svg',
  });
  interpolates(motion, 'hintPanel', 'height'); interpolates(motion, 'hintArrow', 'angle');
  expect(motion.final.hintPanel.inert).toBe(false);

  motion = await capture('.limr-question', quiz.locator('.limr-question-actions > button'), 'block-quiz-retry', quizTargets);
  interpolates(motion, 'resultPanel', 'height'); interpolates(motion, 'answerPanel', 'height');
  await expect(quiz.getByRole('status')).toHaveCount(0);
  await expect(quiz.locator('input[type="radio"]').first()).not.toBeChecked();
  expect(motion.final.answerPanel.inert).toBe(true);
  // These reading interactions update local presentation, never Markdown.
  expect((await host('snapshot')).source).toBe(blockMotionSource);
  return evidence;
}
