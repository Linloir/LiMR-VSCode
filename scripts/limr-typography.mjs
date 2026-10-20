import { createHash } from 'node:crypto';

// The reviewed LiMR releases observe typography against the page viewport. Their rootMargin
// cannot extend through the VS Code reader's overflow:auto scroll container.
// Keep the configured scroll root's preparation margin, while preserving core's
// batched reads/writes and 6ms RAF budget. Mounting or scrolling must not run
// synchronous per-paragraph typesetting ahead of that shared scheduler.
const reviewedSHA256 = {
  '1.3.11': '43d1c275d4c6e5c1860c71b97380427e65fa24132d1a88a10a33de80a0014e0e',
  '1.3.12': '43d1c275d4c6e5c1860c71b97380427e65fa24132d1a88a10a33de80a0014e0e',
  '1.3.13': '43d1c275d4c6e5c1860c71b97380427e65fa24132d1a88a10a33de80a0014e0e',
  '1.3.14': '9cda9fc219e7277abc96a65b76c1c18c673d3675de376eb99737920aa57c648c',
  '1.3.15': '9cda9fc219e7277abc96a65b76c1c18c673d3675de376eb99737920aa57c648c',
};
const replacements = [
  [
`var intersection;
var listening = false;`,
`var intersections = new Map();
var listening = false;
function observeIntersection(job) {
  const configured = job.runtime.configuration.get().scrollRoot;
  const root = configured?.contains(job.element) ? configured : null;
  let group = intersections.get(root);
  if (!group) {
    const observer = new IntersectionObserver(intersectionChanged, { root, rootMargin: "600px" });
    group = { observer, jobs: new Set() };
    intersections.set(root, group);
  }
  group.jobs.add(job);
  job.intersection = group.observer;
  group.observer.observe(job.element);
}
function unobserveIntersection(job) {
  const observer = job.intersection;
  if (!observer) return;
  job.intersection = void 0;
  observer.unobserve(job.element);
  const group = intersections.get(observer.root);
  if (group?.observer === observer) {
    group.jobs.delete(job);
    if (!group.jobs.size) {
      observer.disconnect();
      intersections.delete(observer.root);
    }
  }
}
function intersectionChanged(entries, observer) {
  for (const entry of entries) {
    const job = jobs.get(entry.target);
    // An observer notification can outlive an unmount or a scroll-root change.
    if (!job || job.disposed || job.intersection !== observer) continue;
    job.visible = entry.isIntersecting;
    if (!job.visible) queueTypographyLayout(job.runtime, job.element, false);
    if (job.visible && (job.dirty || !job.undo)) enqueue(job);
    else if (!job.visible && job.dirty && job.undo) defer(job);
  }
}`
  ],
  [
`  intersection = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const job = jobs.get(entry.target);
      if (!job) continue;
      job.visible = entry.isIntersecting;
      if (!job.visible) queueTypographyLayout(job.runtime, job.element, false);
      if (job.visible && (job.dirty || !job.undo)) enqueue(job);
      else if (!job.visible && job.dirty && job.undo) defer(job);
    }
  }, { rootMargin: "600px" });
`,
``
  ],
  [
`    intersection.observe(element);`,
`    observeIntersection(job);`
  ],
  [
`  return () => {
    for (const job of owned) {
      job.disposed = true;`,
`  let scrollRoot = runtime.configuration.get().scrollRoot;
  const unsubscribe = owned.length ? runtime.configuration.subscribe(() => {
    const next = runtime.configuration.get().scrollRoot;
    if (next === scrollRoot) return;
    scrollRoot = next;
    for (const job of owned) {
      if (job.disposed) continue;
      unobserveIntersection(job);
      job.visible = false;
      queueTypographyLayout(job.runtime, job.element, false);
      observeIntersection(job);
    }
  }) : () => {};
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unsubscribe();
    for (const job of owned) {
      job.disposed = true;`
  ],
  [
`      intersection.unobserve(job.element);`,
`      unobserveIntersection(job);`
  ],
  [
`      intersection?.disconnect();`,
`      for (const group of intersections.values()) group.observer.disconnect();
      intersections.clear();`
  ]
];

export function typographyCompatibilityModules(files, version) {
  if (!reviewedSHA256[version]) throw new Error(`Review the LiMR typography adapter before using version ${version}.`);
  const targets = files.filter(file => file.source.includes('// src/react/knuth-plass-layout.ts'));
  if (targets.length !== 1) throw new Error('LiMR typography adapter expected exactly one typography module.');
  const { filename, source } = targets[0];
  if (createHash('sha256').update(source).digest('hex') !== reviewedSHA256[version]) {
    throw new Error(`LiMR ${version} typography differs from the reviewed npm artifact; review the typography adapter.`);
  }
  let result = source;
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) throw new Error('LiMR typography adapter expected exactly one copy of each reviewed source site.');
    result = result.replace(before, after);
  }
  return new Map([[filename, result]]);
}
