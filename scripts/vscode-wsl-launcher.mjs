#!/usr/bin/env node
// Optional adapter for the acceptance runner: real Windows VS Code/Cursor UI with a
// WSL extension host. Only the runner's disposable profile is opened.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp } from 'node:fs/promises';
import path from 'node:path';

const executable = process.env.LIMR_TEST_WINDOWS_CODE;
const remoteExtension = process.env.LIMR_TEST_WSL_EXTENSION;
const distribution = process.env.WSL_DISTRO_NAME;
if (!executable || !remoteExtension || !distribution) throw new Error('Set LIMR_TEST_WINDOWS_CODE and LIMR_TEST_WSL_EXTENSION, and run this adapter inside WSL.');
const windowsPath = value => {
  const match = /^\/mnt\/([a-z])\/(.*)$/i.exec(value);
  if (!match) throw new Error('Set LIMR_TEST_TEMP_ROOT to a Windows-mounted temporary directory for remote acceptance.');
  return `${match[1].toUpperCase()}:\\${match[2].replaceAll('/', '\\')}`;
};
const remotePath = value => `vscode-remote://wsl+${distribution}/${value.replace(/^\//, '')}`;
const input = process.argv.slice(2);
const valueOf = option => input.find(argument => argument.startsWith(`--${option}=`))?.slice(option.length + 3);
const port = Number(valueOf('remote-debugging-port'));
// WSL forwards a Linux localhost listener to Windows; equal ports would make
// the Windows side connect back to this proxy instead of Chromium.
const desktopPort = port === 19385 ? 19386 : 19385;
const userData = valueOf('user-data-dir');
const extensionDirectory = valueOf('extensions-dir');
await cp(remoteExtension, path.join(extensionDirectory, path.basename(remoteExtension)), { recursive: true });
const extensionEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('LIMR_TEST_')));
const args = input.flatMap(argument => {
  if (argument.startsWith('--remote-debugging-port=')) return [`--remote-debugging-port=${desktopPort}`];
  for (const option of ['user-data-dir', 'extensions-dir']) if (argument.startsWith(`--${option}=`)) return [`--${option}=${windowsPath(argument.slice(option.length + 3))}`];
  for (const option of ['extensionDevelopmentPath', 'extensionTestsPath']) if (argument.startsWith(`--${option}=`)) return [`--${option}=${remotePath(argument.slice(option.length + 3))}`];
  if (!argument.startsWith('--')) return [`--folder-uri=${remotePath(argument)}`];
  return [argument];
});
if (path.basename(executable).toLowerCase() === 'cursor.exe') args.push('--skip-onboarding', '--suppress-popups-on-startup');
args.push(`--remote=wsl+${distribution}`, `--extensionEnvironment=${JSON.stringify(extensionEnvironment)}`);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VSCODE_IPC_HOOK_CLI;
const desktop = spawn(executable, args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
desktop.stdout.pipe(process.stdout); desktop.stderr.pipe(process.stderr);

// Windows CDP binds its own loopback. Each local TCP connection gets a stdio
// tunnel through Windows Node, so no firewall rule or network listener changes
// are needed on the user's Windows host.
const connections = new Set();
const proxy = createServer(socket => {
  const script = `const n=require('node:net');const s=n.connect(${desktopPort},'127.0.0.1');s.on('error',()=>process.exit(1));process.stdin.pipe(s);s.pipe(process.stdout);s.on('close',()=>process.exit());`;
  const tunnel = spawn(executable, ['-e', script], { env: { ...environment, ELECTRON_RUN_AS_NODE: '1', WSLENV: `${environment.WSLENV ?? ''}:ELECTRON_RUN_AS_NODE/w` }, stdio: ['pipe', 'pipe', 'ignore'] });
  connections.add(tunnel);
  socket.pipe(tunnel.stdin); tunnel.stdout.pipe(socket);
  socket.on('error', () => tunnel.kill());
  socket.on('close', () => tunnel.kill());
  tunnel.stdin.on('error', () => socket.destroy());
  tunnel.on('exit', () => { connections.delete(tunnel); socket.destroy(); });
});
proxy.listen(port, '127.0.0.1');
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  proxy.close(); for (const tunnel of connections) tunnel.kill();
  desktop.kill();
  // WSL process signals do not always terminate Windows GUI descendants.
  // Match this unique disposable profile, never the user's current window.
  const match = windowsPath(userData).replaceAll("'", "''");
  const processName = path.basename(executable).replaceAll("'", "''");
  const cleanup = spawn('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "Name = '${processName}'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${match}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
  cleanup.on('exit', () => process.exit(desktop.exitCode ?? 0));
  setTimeout(() => process.exit(desktop.exitCode ?? 0), 5000).unref();
}
desktop.on('exit', close);
process.on('SIGTERM', close);
process.on('SIGINT', close);
