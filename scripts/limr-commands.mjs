import { createHash } from 'node:crypto';

// The public core API has no imperative toolbar/search command yet. This
// host adapter enters core's existing controllers and enables its complete
// reading-text search for ordinary documents too. It does not recreate selection
// contexts, permissions, search, serialization or rendering.
const reviewedVersion = '1.3.10';
const reviewedSHA256 = 'd7a417ca9f9403f07db345c9fb4e5a744d8ecd5f230b3058615b1ce12dec5d39';
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
  if (version !== reviewedVersion) throw new Error(`Review the LiMR command adapter before using version ${version}.`);
  const targets = files.filter(file => file.source.includes('function SelectionToolbar(') && file.source.includes('function DocumentSearch('));
  if (targets.length !== 1) throw new Error('LiMR command adapter expected exactly one toolbar/search module.');
  const { filename, source } = targets[0];
  if (createHash('sha256').update(source).digest('hex') !== reviewedSHA256)
    throw new Error('LiMR 1.3.10 commands differ from the reviewed npm artifact; review the command adapter.');
  let result = source;
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) throw new Error('LiMR command adapter expected exactly one copy of each reviewed source site.');
    result = result.replace(before, after);
  }
  return new Map([[filename, result]]);
}
