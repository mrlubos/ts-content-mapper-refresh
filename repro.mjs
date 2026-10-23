// Drives `tsc --lsp` the way VS Code does, with pull diagnostics and
// `workspace/diagnostic/refresh` support, and counts the refresh requests the
// server sends after each of three changes:
//
//   1. `dep.ts` changes on disk, and the client sends didChangeWatchedFiles.
//   2. `shape.data`, a content-mapped file, changes on disk the same way.
//   3. `shape.data` is open in the editor and edited there (didChange).
//
// An editor re-pulls diagnostics only when the server asks, so case 2 leaves
// the error on `data.age` in place until the server restarts, although a pull
// made by hand returns the right answer.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = import.meta.dirname;
const uri = (file) => pathToFileURL(resolve(root, file)).href;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const server = spawn(resolve(root, 'node_modules/.bin/tsc'), ['--lsp', '--stdio'], { cwd: root });
server.stderr.on('data', () => {});

let nextId = 1;
let refreshes = 0;
const pending = new Map();

function write(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
  server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  server.stdin.write(body);
}
function request(method, params) {
  const id = nextId++;
  write({ id, method, params });
  return new Promise((done) => pending.set(id, done));
}
function notify(method, params) {
  write({ method, params });
}

let buffer = Buffer.alloc(0);
server.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, headerEnd).toString())[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const message = JSON.parse(buffer.subarray(start, start + length).toString('utf8'));
    buffer = buffer.subarray(start + length);
    if (message.method === 'workspace/diagnostic/refresh') refreshes++;
    if (message.method && message.id !== undefined) write({ id: message.id, result: null });
    else if (message.id !== undefined) pending.get(message.id)?.(message);
  }
});

await request('initialize', {
  capabilities: {
    textDocument: { diagnostic: {} },
    workspace: {
      diagnostics: { refreshSupport: true },
      didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
    },
  },
  initializationOptions: { runExternalCode: true },
  processId: process.pid,
  rootUri: pathToFileURL(root).href,
  workspaceFolders: [{ name: 'repro', uri: pathToFileURL(root).href }],
});
notify('initialized', {});
notify('textDocument/didOpen', {
  textDocument: { languageId: 'typescript', text: readFileSync(resolve(root, 'index.ts'), 'utf8'), uri: uri('index.ts'), version: 1 },
});

async function errors() {
  const { result } = await request('textDocument/diagnostic', { textDocument: { uri: uri('index.ts') } });
  return (result?.items ?? []).map((item) => item.message);
}
console.log('errors at start:', await errors());

const originals = { data: readFileSync(resolve(root, 'shape.data'), 'utf8'), dep: readFileSync(resolve(root, 'dep.ts'), 'utf8') };

async function onDisk(file, text) {
  const before = refreshes;
  writeFileSync(resolve(root, file), text);
  notify('workspace/didChangeWatchedFiles', { changes: [{ type: 2, uri: uri(file) }] });
  await wait(3000);
  return refreshes - before;
}

try {
  console.log('1. dep.ts changed on disk, refresh requests:', await onDisk('dep.ts', 'export interface Dep {\n  age: number;\n  name: string;\n}\n'));
  console.log('2. shape.data changed on disk, refresh requests:', await onDisk('shape.data', 'name: string\nage: number\n'));
  console.log('   errors when pulled by hand:', await errors());

  writeFileSync(resolve(root, 'shape.data'), originals.data);
  notify('workspace/didChangeWatchedFiles', { changes: [{ type: 2, uri: uri('shape.data') }] });
  await wait(1500);
  notify('textDocument/didOpen', { textDocument: { languageId: 'plaintext', text: originals.data, uri: uri('shape.data'), version: 1 } });
  await wait(1500);
  const before = refreshes;
  notify('textDocument/didChange', { contentChanges: [{ text: 'name: string\nage: number\n' }], textDocument: { uri: uri('shape.data'), version: 2 } });
  await wait(3000);
  console.log('3. shape.data edited while open, refresh requests:', refreshes - before);
} finally {
  writeFileSync(resolve(root, 'shape.data'), originals.data);
  writeFileSync(resolve(root, 'dep.ts'), originals.dep);
  await request('shutdown');
  notify('exit');
}
