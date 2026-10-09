const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { WebSocket } = require('ws');

test('room-wide editing rights, mode switching, and disconnect recovery', { timeout: 20000 }, async t => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => server.kill());
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Server did not start')), 5000);
    server.on('error', reject);
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    server.stdout.on('data', data => {
      output += data;
      const match = output.match(/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  const connect = async (name, room = 'lock-test') => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}&name=${name}`);
    t.after(() => ws.terminate());
    const queue = [];
    let wake;
    ws.on('message', raw => { queue.push(JSON.parse(raw)); wake?.(); });
    const wait = async (type, predicate = () => true) => {
      const deadline = Date.now() + 3000;
      while (true) {
        const index = queue.findIndex(item => item.type === type && predicate(item));
        if (index !== -1) return queue.splice(0, index + 1).at(-1);
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${name}: ${type}`);
        await new Promise(resolve => { const timer = setTimeout(resolve, Math.max(1, deadline - Date.now())); wake = () => { clearTimeout(timer); resolve(); }; });
        wake = null;
      }
    };
    const snapshot = await wait('snapshot');
    return { ws, wait, snapshot, send: message => ws.send(JSON.stringify(message)) };
  };
  const a = await connect('Alice');
  const b = await connect('Bob');
  assert.equal(a.snapshot.editMode, 'collaborative');
  a.send({ type: 'file-create', fileName: 'B.cpp', code: 'original' });
  await a.wait('file-created'); await b.wait('file-created');
  b.send({ type: 'code', fileName: 'B.cpp', code: 'collaborative' });
  assert.equal((await a.wait('code')).code, 'collaborative');

  a.send({ type: 'edit-mode', editMode: 'single' });
  await a.wait('edit-state'); await b.wait('edit-state');
  // Two contenders race for one room-wide owner. Exactly one must win.
  a.send({ type: 'edit-acquire' }); b.send({ type: 'edit-acquire' });
  const state = await a.wait('edit-state', value => Boolean(value.editor));
  const owner = state.editor.peerId === a.snapshot.peerId ? a : b;
  const viewer = owner === a ? b : a;
  await viewer.wait('edit-rejected');
  const c = await connect('Carol');
  assert.deepEqual(c.snapshot.editor, state.editor);
  assert.equal(c.snapshot.editMode, 'single');
  for (const message of [
    { type: 'code', fileName: 'main.cpp', code: 'forbidden' },
    { type: 'code', fileName: 'B.cpp', code: 'forbidden' },
    { type: 'file-create', fileName: 'C.cpp' },
    { type: 'file-delete', fileName: 'B.cpp' },
    { type: 'test-cases', fileName: 'B.cpp', testCases: [{ id: 'x', name: 'x', input: 'x', expected: '' }] },
  ]) {
    viewer.send(message);
    const rejected = await viewer.wait('edit-rejected');
    assert.equal(rejected.files['B.cpp'], 'collaborative');
    assert.notEqual(rejected.files['main.cpp'], 'forbidden');
    assert.equal(rejected.files['C.cpp'], undefined);
    assert.equal(rejected.testCasesByFile['B.cpp'][0].input, '');
  }
  owner.send({ type: 'code', fileName: 'B.cpp', code: 'owner edit' });
  assert.equal((await c.wait('code')).code, 'owner edit');
  viewer.send({ type: 'chat', text: 'still chatting' });
  const chat = await c.wait('chat');
  assert.equal(chat.text, 'still chatting');
  assert.equal(chat.name, viewer.snapshot.name);
  assert.deepEqual(await viewer.wait('chat'), chat);
  assert.deepEqual(await owner.wait('chat'), chat);
  owner.send({ type: 'edit-release' });
  await c.wait('edit-state', value => !value.editor);
  c.send({ type: 'edit-acquire' });
  await c.wait('edit-state', value => value.editor?.peerId === c.snapshot.peerId);
  await owner.wait('edit-state', value => value.editor?.peerId === c.snapshot.peerId);
  c.ws.close();
  await owner.wait('edit-state', value => !value.editor);
  await owner.wait('peer-left', value => value.peerId === c.snapshot.peerId);
  owner.send({ type: 'edit-acquire' });
  await owner.wait('edit-state', value => value.editor?.peerId === owner.snapshot.peerId);
  viewer.send({ type: 'edit-release' });
  const d = await connect('Dave');
  assert.equal(d.snapshot.editor.peerId, owner.snapshot.peerId);
  assert.deepEqual(d.snapshot.messages, [chat]);
  viewer.send({ type: 'edit-mode', editMode: 'collaborative' });
  const unlocked = await d.wait('edit-state');
  assert.equal(unlocked.editor, null);
  assert.equal(unlocked.editMode, 'collaborative');
  viewer.send({ type: 'file-delete', fileName: 'B.cpp' });
  assert.equal((await viewer.wait('file-deleted')).files['B.cpp'], undefined);
  viewer.send({ type: 'code', fileName: 'B.cpp', code: 'resurrect' });
  assert.equal((await viewer.wait('edit-rejected')).files['B.cpp'], undefined);
  viewer.send({ type: 'file-delete', fileName: 'main.cpp' });
  assert.ok((await viewer.wait('edit-rejected')).files['main.cpp']);

  // History is bounded, comes from the server, and remains isolated per room.
  viewer.send({ type: 'chat', text: '   ' });
  viewer.send({ type: 'chat', text: 123 });
  for (let index = 0; index < 105; index++) viewer.send({ type: 'chat', text: `message-${index}`, name: 'spoofed' });
  await owner.wait('chat', value => value.text === 'message-104');
  viewer.send({ type: 'chat', text: 'x'.repeat(1100) });
  const capped = await owner.wait('chat', value => value.text.startsWith('xxx'));
  assert.equal(capped.text.length, 1000);
  const rejoined = await connect('History');
  assert.equal(rejoined.snapshot.messages.length, 100);
  assert.equal(rejoined.snapshot.messages[0].text, 'message-6');
  assert.equal(rejoined.snapshot.messages.at(-1).id, capped.id);
  assert.ok(rejoined.snapshot.messages.every(message => message.name === viewer.snapshot.name));
  const isolated = await connect('OtherRoom', 'other-room');
  assert.deepEqual(isolated.snapshot.messages, []);
});
