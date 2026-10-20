import { createHash } from 'node:crypto';

// Search uses public find() and DocumentSearch. Only selection actions need a
// source adapter until core exposes a corresponding native command API.
// Core owns contexts, permissions, searching, serialization and rendering.
const reviewedSHA256 = {
  '1.3.11': '916165bec4042a2c34df52c148c5c97d797874c48f7edf78fbeda97553d67691',
  '1.3.12': 'ed2beab715617b7c9b213f4875f9172addba9abc11f8896d1b94295fb03ba94f',
};
const replacements = [
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
];

export function commandCompatibilityModules(files, version) {
  if (!reviewedSHA256[version]) throw new Error(`Review the LiMR command adapter before using version ${version}.`);
  const targets = files.filter(file => file.source.includes('function SelectionToolbar('));
  if (targets.length !== 1) throw new Error('LiMR command adapter expected exactly one selection toolbar module.');
  const { filename, source } = targets[0];
  if (createHash('sha256').update(source).digest('hex') !== reviewedSHA256[version])
    throw new Error(`LiMR ${version} commands differ from the reviewed npm artifact; review the command adapter.`);
  let result = source;
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) throw new Error('LiMR command adapter expected exactly one copy of each reviewed source site.');
    result = result.replace(before, after);
  }
  return new Map([[filename, result]]);
}
