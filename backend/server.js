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
  if (!rooms.has(id)) rooms.set(id, { files: { 'main.cpp': defaultCode() }, strokes: [], problems: loadProblems(id), testCasesByFile: { 'main.cpp': defaultTestCases() }, clients: new Set() });
  return rooms.get(id);
}

function loadProblems(id) {
  const uploadDir = path.join(root, 'uploads');
  if (!fs.existsSync(uploadDir)) return [];
  const legacy = path.join(uploadDir, `${id}.pdf`);
  const items = fs.existsSync(legacy) ? [{ id: 'legacy', name: `${id}.pdf`, url: `/uploads/${id}.pdf` }] : [];
  for (const file of fs.readdirSync(uploadDir)) {
    const prefix = `${id}-`;
    if (file.startsWith(prefix) && file.endsWith('.pdf')) items.push({ id: file.slice(prefix.length, -4), name: file.slice(prefix.length), url: `/uploads/${file}` });
  }
  return items;
}

function isCppFileName(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,56}\.cpp$/.test(value);
}

function defaultCode() {
  return '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    cout << "Hello, VP!" << endl;\n    return 0;\n}\n';
}

function defaultTestCases() {
  return [{ id: 'sample-1', name: '样例 1', input: '', expected: '' }];
}

function isTestCases(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 30 && value.every(item => item && typeof item.id === 'string' && item.id.length <= 100 && typeof item.name === 'string' && typeof item.input === 'string' && typeof item.expected === 'string' && item.name.length <= 80 && item.input.length <= 20000 && item.expected.length <= 20000);
}

app.post('/api/rooms', (_req, res) => {
  const id = randomBytes(3).toString('hex');
  getRoom(id);
  res.json({ id });
});

app.get('/api/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id);
  res.json({ id: req.params.id, files: room.files, strokes: room.strokes, problems: room.problems });
});

app.post('/api/rooms/:id/problem', express.raw({ type: 'application/pdf', limit: '20mb' }), (req, res) => {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(req.params.id)) return res.status(400).json({ error: '无效房间 ID' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: '请选择 PDF 文件' });
  const uploads = path.join(root, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const room = getRoom(req.params.id);
  const name = String(req.query.name || 'problem.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || 'problem.pdf';
  const id = randomBytes(4).toString('hex');
  const fileName = `${req.params.id}-${id}.pdf`;
  fs.writeFileSync(path.join(uploads, fileName), req.body);
  const problem = { id, name, url: `/uploads/${fileName}` };
  room.problems.push(problem);
  for (const client of room.clients) if (client.readyState === 1) client.send(JSON.stringify({ type: 'pdf-updated', problems: room.problems }));
  res.json({ problem, problems: room.problems });
});

app.delete('/api/rooms/:id/problem/:pdfId', (req, res) => {
  const room = getRoom(req.params.id);
  const index = room.problems.findIndex(item => item.id === req.params.pdfId);
  if (index < 0) return res.status(404).json({ error: '题面不存在' });
  const fileName = path.basename(room.problems[index].url);
  fs.rmSync(path.join(root, 'uploads', fileName), { force: true });
  room.problems.splice(index, 1);
  for (const client of room.clients) if (client.readyState === 1) client.send(JSON.stringify({ type: 'pdf-updated', problems: room.problems }));
  res.json({ problems: room.problems });
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

app.post('/api/check', (req, res) => {
  const { language = 'cpp', code } = req.body || {};
  if (language !== 'cpp' || typeof code !== 'string') return res.status(400).json({ error: '当前仅支持 C++' });
  const dir = path.join(require('node:os').tmpdir(), `vp-check-${Date.now()}-${randomBytes(3).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, 'main.cpp');
  fs.writeFileSync(source, code, 'utf8');
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  const compiler = spawn('g++', ['-std=c++17', '-fsyntax-only', source]);
  let diagnostics = '';
  compiler.stderr.on('data', chunk => { diagnostics += chunk; });
  compiler.on('error', error => { cleanup(); res.status(500).json({ error: `无法启动 g++: ${error.message}` }); });
  compiler.on('close', exitCode => { cleanup(); res.json({ ok: exitCode === 0, diagnostics: diagnostics.slice(0, 12000) }); });
});

const wss = new WebSocketServer({ server, path: '/ws' });
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.missedHeartbeats >= 2) { socket.terminate(); continue; }
    socket.missedHeartbeats += 1;
    socket.ping();
  }
}, 20000);
server.on('close', () => clearInterval(heartbeat));
wss.on('connection', (socket, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const id = url.searchParams.get('room');
  if (!id) return socket.close(1008, 'room is required');
  const room = getRoom(id);
  const peerId = randomBytes(4).toString('hex');
  const requestedName = url.searchParams.get('name') || '';
  const name = requestedName.trim().slice(0, 32) || `队员-${peerId.slice(0, 4)}`;
  socket.peerId = peerId;
  socket.displayName = name;
  socket.missedHeartbeats = 0;
  socket.on('pong', () => { socket.missedHeartbeats = 0; });
  room.clients.add(socket);
  const peerInfo = client => ({ peerId: client.peerId, name: client.displayName });
  socket.send(JSON.stringify({ type: 'snapshot', peerId, name, peers: [...room.clients].filter(client => client !== socket).map(peerInfo), files: room.files, strokes: room.strokes, problems: room.problems, testCasesByFile: room.testCasesByFile }));
  for (const client of room.clients) if (client !== socket && client.readyState === 1) client.send(JSON.stringify({ type: 'peer-joined', ...peerInfo(socket) }));
  socket.on('message', raw => {
    try {
      let message = JSON.parse(raw.toString());
      if (message.type === 'code' && isCppFileName(message.fileName) && typeof message.code === 'string' && Object.hasOwn(room.files, message.fileName)) room.files[message.fileName] = message.code;
      if (message.type === 'file-create' && isCppFileName(message.fileName) && !Object.hasOwn(room.files, message.fileName)) {
        room.files[message.fileName] = typeof message.code === 'string' ? message.code : defaultCode();
        room.testCasesByFile[message.fileName] = defaultTestCases();
        message = { type: 'file-created', fileName: message.fileName, code: room.files[message.fileName] };
      }
      if (message.type === 'stroke' && message.stroke) room.strokes.push(message.stroke);
      if (message.type === 'board-update' && message.item?.id) {
        const index = room.strokes.findIndex(item => item.id === message.item.id);
        if (index >= 0) room.strokes[index] = message.item;
      }
      if (message.type === 'clear') room.strokes = [];
      if (message.type === 'test-cases' && isCppFileName(message.fileName) && isTestCases(message.testCases)) {
        room.testCasesByFile[message.fileName] = message.testCases;
      }
      for (const client of room.clients) if (client !== socket && client.readyState === 1) client.send(JSON.stringify(message));
    } catch { /* Ignore malformed messages from a browser. */ }
  });
  socket.on('close', () => {
    room.clients.delete(socket);
    for (const client of room.clients) if (client.readyState === 1) client.send(JSON.stringify({ type: 'peer-left', peerId }));
  });
});

app.get('*', (_req, res) => res.sendFile(path.join(clientRoot, 'index.html')));
server.listen(PORT, () => console.log(`VP server listening at http://localhost:${PORT}`));
