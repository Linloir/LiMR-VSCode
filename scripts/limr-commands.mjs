import { createHash } from 'node:crypto';

// 1.3.10 needs a bridge into both search and selection action controllers.
// 1.3.11 exposes find() publicly, leaving only the selection-action bridge here.
// Core owns contexts, permissions, searching, serialization and rendering.
const reviewedSHA256 = {
  '1.3.10': 'd7a417ca9f9403f07db345c9fb4e5a744d8ecd5f230b3058615b1ce12dec5d39',
  '1.3.11': '916165bec4042a2c34df52c148c5c97d797874c48f7edf78fbeda97553d67691',
};
const replacements = [
  [
`    windowed && /* @__PURE__ */ jsx12(DocumentSearch, {}),`,
`    /* @__PURE__ */ jsx12(DocumentSearch, {}),`,
  ],
  [
`      if (!runtime.documentViewport || !ownsReaderInteraction(runtime) || !runtime.content?.getBoundingClientRect().height) return;`,
`      if (runtime.configuration.get().provisional || !ownsReaderInteraction(runtime) || !runtime.content?.getBoundingClientRect().height) return;`,
  ],
  [
`    if (open && !runtime.documentViewport) {`,
`    if (open && configuration.provisional) {`,
  ],
  [
`  if (!open || !context) return null;
  const label = (action) => {`,
`  useEffect8(() => {
    const command = (event) => {
      const detail = event.detail;
      if (!detail || detail.handled || !open || !context || busyRef.current || runtime.signal.aborted) return;
      const action = available.find((item) => item.id === detail.actionId);
      if (!action || action.disabled?.(context)) return;
      detail.handled = true;
      void run(action);
    };
    document.addEventListener("limr-vscode:selection-action", command);
    return () => document.removeEventListener("limr-vscode:selection-action", command);
  });
  if (!open || !context) return null;
  const label = (action) => {`,
  ],
  [
`  if (!open) return null;
  return /* @__PURE__ */ jsxs6("div", { className: "limr-document-search",`,
`  useEffect9(() => {
    const command = (event) => {
      if (runtime.configuration.get().provisional || runtime.signal.aborted) return;
      const name = event.detail?.command;
      if (!["find", "findNext", "findPrevious"].includes(name)) return;
      if (!open) previousFocus.current = document.activeElement;
      setOpen(true);
      if (name !== "find") move(name === "findNext" ? 1 : -1);
      requestAnimationFrame(() => {
        input.current?.focus();
        if (name === "find") input.current?.select();
      });
    };
    document.addEventListener("limr-vscode:find", command);
    return () => document.removeEventListener("limr-vscode:find", command);
  });
  if (!open) return null;
  return /* @__PURE__ */ jsxs6("div", { className: "limr-document-search",`,
  ],
];

export function commandCompatibilityModules(files, version) {
  if (!reviewedSHA256[version]) throw new Error(`Review the LiMR command adapter before using version ${version}.`);
  const targets = files.filter(file => file.source.includes('function SelectionToolbar(') && file.source.includes('function DocumentSearch('));
  if (targets.length !== 1) throw new Error('LiMR command adapter expected exactly one toolbar/search module.');
  const { filename, source } = targets[0];
  if (createHash('sha256').update(source).digest('hex') !== reviewedSHA256[version])
    throw new Error(`LiMR ${version} commands differ from the reviewed npm artifact or local candidate; review the command adapter.`);
  let result = source;
  // 1.3.11 exposes find() publicly and makes search an explicit Reader option.
  // Only the selection-action bridge still needs a source adapter.
  for (const [before, after] of version === '1.3.10' ? replacements : [replacements[3]]) {
    if (result.split(before).length !== 2) throw new Error('LiMR command adapter expected exactly one copy of each reviewed source site.');
    result = result.replace(before, after);
  }
  return new Map([[filename, result]]);
}
