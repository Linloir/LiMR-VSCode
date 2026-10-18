#!/usr/bin/env node
'use strict';
// No npm install or model-side source rewriting: submit one answer to the
// extension host that issued this selection ticket, including dirty buffers.
const fs = require('node:fs/promises');
const net = require('node:net');
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node write-question.cjs --context <ticket.json> --input <answer.json>\nanswer.json: {"question":"...","answer":"...","counterparts":[{"selection":0,"text":"exact counterpart"}]}');
    return;
  }
  const option = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error(`Missing ${name}. Use --help.`); return args[i + 1]; };
  const ticket = JSON.parse(await fs.readFile(option('--context'), 'utf8'));
  const input = JSON.parse(await fs.readFile(option('--input'), 'utf8'));
  if (ticket.format !== 'limr-writeback-v1' || typeof ticket.endpoint !== 'string' || typeof ticket.token !== 'string') throw new Error('Invalid LiMR writeback ticket.');
  if (!ticket.allowSourceEdits) throw new Error('This context does not authorize source edits.');
  if (Date.now() > ticket.expires) throw new Error('The context expired. Copy a new context or use the skill fallback.');
  const request = JSON.stringify({ token: ticket.token, input }) + '\n';
  if (Buffer.byteLength(request) > 1024 * 1024) throw new Error('The answer is too large for quick writeback.');
  const reply = await new Promise((resolve, reject) => {
    const socket = net.createConnection(ticket.endpoint);
    let buffer = '';
    socket.setEncoding('utf8'); socket.setTimeout(15000);
    socket.on('connect', () => socket.write(request));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { socket.destroy(); reject(new Error('Invalid writeback response.')); }
      else if (buffer.includes('\n')) {
        socket.end();
        try { resolve(JSON.parse(buffer.slice(0, buffer.indexOf('\n')))); } catch (error) { reject(error); }
      }
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('Writeback timed out. Retrying the same input is safe.')); });
    socket.on('error', reject);
    socket.on('end', () => { if (!buffer.includes('\n')) reject(new Error('The extension closed the connection without a result.')); });
  });
  if (!reply.ok) throw new Error(reply.error || 'Writeback failed.');
  console.log(JSON.stringify(reply));
}
main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message, fallback: 'On timeout or lost connection, retry identical input first. Before manual fallback, read the current buffer and check for the question to avoid duplicates. Follow references/source-annotations.md; do not claim unconfirmed success.' })); process.exitCode = 1; });
