const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const rooms = new Map();
const PORT = Number(process.env.PORT || 8787);
const root = path.resolve(__dirname, '..');
const clientRoot = fs.existsSync(path.join(root, 'dist')) ? path.join(root, 'dist') : path.join(root, 'frontend');

app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use('/uploads', express.static(path.join(root, 'uploads')));
app.use(express.static(clientRoot));

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { code: defaultCode, strokes: [], clients: new Set() });
  return rooms.get(id);
}

function defaultCode() {
  return '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    cout << "Hello, VP!" << endl;\n    return 0;\n}\n';
}

app.post('/api/rooms', (_req, res) => {
  const id = randomBytes(3).toString('hex');
  getRoom(id);
  res.json({ id });
});

app.get('/api/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id);
  res.json({ id: req.params.id, code: room.code, strokes: room.strokes });
});

app.post('/api/run', (req, res) => {
  const { language = 'cpp', code, input = '' } = req.body || {};
  if (language !== 'cpp' || typeof code !== 'string') return res.status(400).json({ error: '当前仅支持 C++' });
  const job = `vp-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const dir = path.join(require('node:os').tmpdir(), job);
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, 'main.cpp');
  const binary = path.join(dir, process.platform === 'win32' ? 'main.exe' : 'main');
  fs.writeFileSync(source, code, 'utf8');
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  const compile = spawn('g++', ['-std=c++17', '-O2', source, '-o', binary]);
  let compileOut = '';
  compile.stderr.on('data', chunk => { compileOut += chunk; });
  compile.on('close', exitCode => {
    if (exitCode !== 0) { cleanup(); return res.json({ ok: false, phase: 'compile', output: compileOut.slice(0, 12000) }); }
    const child = spawn(binary, [], { cwd: dir });
    let output = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, 3000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 50000) child.kill(); });
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdin.end(String(input));
    child.on('close', code => {
      clearTimeout(timer); cleanup();
      res.json({ ok: !killed && code === 0, phase: 'run', output: killed ? `${output}\n[程序超时，已终止]` : output.slice(0, 50000) });
    });
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const id = url.searchParams.get('room');
  if (!id) return socket.close(1008, 'room is required');
  const room = getRoom(id);
  room.clients.add(socket);
  socket.send(JSON.stringify({ type: 'snapshot', code: room.code, strokes: room.strokes }));
  socket.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'code' && typeof message.code === 'string') room.code = message.code;
      if (message.type === 'stroke' && message.stroke) room.strokes.push(message.stroke);
      if (message.type === 'clear') room.strokes = [];
      for (const client of room.clients) if (client !== socket && client.readyState === 1) client.send(JSON.stringify(message));
    } catch { /* Ignore malformed messages from a browser. */ }
  });
  socket.on('close', () => room.clients.delete(socket));
});

app.get('*', (_req, res) => res.sendFile(path.join(clientRoot, 'index.html')));
server.listen(PORT, () => console.log(`VP server listening at http://localhost:${PORT}`));
