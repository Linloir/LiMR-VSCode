const vscode = require('vscode');

async function activate(context) {
  const extension = vscode.extensions.getExtension('linloir.limr-vscode');
  if (!extension) throw new Error('Install LiMR for VS Code 1.0.1 or later.');
  const api = await extension.activate();
  if (api?.apiVersion !== 1 || typeof api.registerPlugin !== 'function') {
    throw new Error('This example requires LiMR reader plugin API v1 (LiMR 1.0.1 or later).');
  }

  let registration;
  function enable() {
    if (registration) return;
    registration = api.registerPlugin(context.extension.id, {
      id: 'research-card',
      module: 'reader.mjs',
      stylesheet: 'reader.css',
    });
  }
  function disable() {
    registration?.dispose();
    registration = undefined;
  }

  context.subscriptions.push(
    new vscode.Disposable(disable),
    vscode.commands.registerCommand('limrExample.enable', enable),
    vscode.commands.registerCommand('limrExample.disable', disable),
  );
  enable();
}

module.exports = { activate };
