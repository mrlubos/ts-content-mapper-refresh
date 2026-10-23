// A content mapper with no dependencies. Each line of a `.data` file,
// `name: type`, becomes a member of `export interface Data`.
let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

const handlers = {
  closeProject: () => null,
  initialize: () => ({ diagnosticSource: 'toy-mapper', positionEncoding: 'utf-16' }),
  openProject: () => ({}),
  transform: ({ content }) => {
    const members = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `  ${line};`);
    return { extension: '.ts', text: `export interface Data {\n${members.join('\n')}\n}\n` };
  },
};

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, headerEnd).toString())[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const { id, method, params } = JSON.parse(buffer.subarray(start, start + length).toString('utf8'));
    buffer = buffer.subarray(start + length);
    if (id === undefined) continue;
    const handler = handlers[method];
    if (handler) send({ id, result: handler(params) ?? null });
    else send({ error: { code: -32601, message: `Unknown method ${method}` }, id });
  }
});
