import React, { createElement, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Editor from '@monaco-editor/react';
import './styles.css';

const initialCode = '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    cout << "Hello, VP!" << endl;\n    return 0;\n}\n';
const defaultTestCases = [{ id: 'sample-1', name: '样例 1', input: '', expected: '' }];

function Whiteboard({ socket, strokes, setStrokes }) {
  const canvas = useRef(null); const drawing = useRef(false); const last = useRef(null);
  const [tool, setTool] = useState('brush'); const [brushSize, setBrushSize] = useState(4); const [inkColor, setInkColor] = useState('#e4a953'); const [boardTheme, setBoardTheme] = useState('dark');
  const colors = ['#e4a953', '#f06c6c', '#6cb6f0', '#89d185', '#c586c0', '#ffffff', '#202020'];
  useEffect(() => {
    const c = canvas.current, ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    strokes.forEach(item => {
      if (item.kind !== 'line') return;
      ctx.globalCompositeOperation = item.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.lineWidth = item.size || 4; ctx.strokeStyle = item.color || inkColor; ctx.beginPath(); ctx.moveTo(item.x1, item.y1); ctx.lineTo(item.x2, item.y2); ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
  }, [strokes, boardTheme, inkColor]);
  const point = event => { const rect = canvas.current.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.current.width / rect.width, y: (event.clientY - rect.top) * canvas.current.height / rect.height }; };
  const publish = item => { setStrokes(value => [...value, item]); socket?.send(JSON.stringify({ type: 'stroke', stroke: item })); };
  const move = event => { if (!drawing.current) return; const next = point(event); const size = tool === 'eraser' ? Math.min(80, Math.max(12, brushSize)) : Math.min(16, Math.max(2, brushSize)); publish({ kind: 'line', tool, color: inkColor, size, x1: last.current.x, y1: last.current.y, x2: next.x, y2: next.y }); last.current = next; };
  const start = event => { drawing.current = true; last.current = point(event); };
  const drag = event => move(event);
  const finish = () => { drawing.current = false; };
  const sizeMin = tool === 'eraser' ? 12 : 2; const sizeMax = tool === 'eraser' ? 80 : 16;
  return <div className={boardTheme === 'light' ? 'board-wrap light' : 'board-wrap'}><div className="board-toolbar"><button className={tool === 'brush' ? 'board-tool active' : 'board-tool'} onClick={() => setTool('brush')}>画笔</button><button className={tool === 'eraser' ? 'board-tool active' : 'board-tool'} onClick={() => setTool('eraser')}>橡皮擦</button><div className="color-palette">{colors.map(color => <button key={color} className={inkColor === color ? 'color-swatch selected' : 'color-swatch'} style={{ backgroundColor: color }} title={color} onClick={() => setInkColor(color)} />)}</div><label>{tool === 'eraser' ? '橡皮大小' : '笔刷粗细'} <input type="range" min={sizeMin} max={sizeMax} value={Math.min(sizeMax, Math.max(sizeMin, brushSize))} onChange={event => setBrushSize(Number(event.target.value))} /><span>{Math.min(sizeMax, Math.max(sizeMin, brushSize))}px</span></label><button className="board-tool" onClick={() => setBoardTheme(value => value === 'dark' ? 'light' : 'dark')}>{boardTheme === 'dark' ? '白色画板' : '深色画板'}</button><button className="board-clear" onClick={() => { setStrokes([]); socket?.send(JSON.stringify({ type: 'clear' })); }}>清空</button></div><canvas ref={canvas} width="1600" height="1000" onPointerDown={start} onPointerMove={drag} onPointerUp={finish} onPointerLeave={finish} /></div>;
}

function ChatPanel({ messages, onSend, connected, text, setText }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);
  const submit = event => {
    event.preventDefault();
    const value = text.trim();
    if (!value || !connected || !onSend(value)) return;
    setText('');
  };
  return <section className="chat-view"><div className="view-toolbar"><span>聊天室</span><span>{messages.length ? `${messages.length} 条消息` : '开始交流吧'}</span></div><div className="chat-messages">{messages.length === 0 && <div className="chat-empty">暂时没有消息</div>}{messages.map(message => <article key={message.id} className="chat-message"><div><strong>{message.name}</strong><time>{new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.text}</p></article>)}<div ref={bottomRef} /></div><form className="chat-input" onSubmit={submit}><textarea value={text} maxLength="1000" onChange={event => setText(event.target.value)} aria-label="聊天消息" placeholder={connected ? '输入消息，Enter 发送，Shift + Enter 换行' : '连接恢复后可发送，草稿会保留'} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" disabled={!connected || !text.trim()}>发送</button></form></section>;
}

function CodePanel({ activeFile, files, fontSize, output, readOnly, editControls, canEdit, running, syntaxChecking, testCases, activeTest, onChange: onLocalChange, onCreate, onDeleteFile, onExportCurrent, onExportAll, onRun, onRunAll, onCheck, onSelect, onToggleReadOnly, onZoom, onAddTest, onDeleteTest, onUpdateTest, onSelectTest }) {
  const test = testCases[activeTest] || testCases[0];
  const editorRef = useRef(null); const monacoRef = useRef(null); const applyingRemote = useRef(false); const checkTimer = useRef(null); const resizeState = useRef(null); const [editorReady, setEditorReady] = useState(false);
  const handleEditorChange = (value, changeEvent) => {
    if (applyingRemote.current) return;
    onLocalChange(value, changeEvent);
  };
  const onChange = handleEditorChange;
  useEffect(() => {
    if (editorReady) return undefined;
    const timer = setInterval(() => {
      if (editorRef.current && monacoRef.current) {
        setEditorReady(true);
        clearInterval(timer);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [editorReady]);
  const [inputHeight, setInputHeight] = useState(180); const [expectedHeight, setExpectedHeight] = useState(180); const [outputHeight, setOutputHeight] = useState(150);
  const beginResize = (kind, event) => { event.preventDefault(); const initial = kind === 'input' ? inputHeight : kind === 'expected' ? expectedHeight : outputHeight; resizeState.current = { kind, startY: event.clientY, initial }; event.currentTarget.setPointerCapture?.(event.pointerId); };
  const updateResize = event => { const state = resizeState.current; if (!state) return; const delta = event.clientY - state.startY; if (state.kind === 'input') setInputHeight(Math.max(110, state.initial + delta)); else if (state.kind === 'expected') setExpectedHeight(Math.max(110, state.initial + delta)); else setOutputHeight(Math.max(80, state.initial - delta)); };
  const endResize = () => { resizeState.current = null; };
  useEffect(() => {
    clearTimeout(checkTimer.current);
    if (readOnly) return undefined;
    checkTimer.current = setTimeout(async () => {
      if (!editorRef.current || !monacoRef.current) return;
      try {
        const response = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'cpp', code: files[activeFile] || '' }) });
        const data = await response.json();
        const markers = (data.diagnostics || '').split('\n').map(line => {
          const match = line.match(/main\.cpp:(\d+):(\d+):\s*(error|warning):\s*(.*)$/);
          if (!match) return null;
          return { startLineNumber: Number(match[1]), startColumn: Number(match[2]), endLineNumber: Number(match[1]), endColumn: Number(match[2]) + 1, message: match[4], severity: match[3] === 'error' ? monacoRef.current.MarkerSeverity.Error : monacoRef.current.MarkerSeverity.Warning };
        }).filter(Boolean);
        monacoRef.current.editor.setModelMarkers(editorRef.current.getModel(), 'vp-syntax', markers);
      } catch { /* The editor remains usable when the checker is temporarily unavailable. */ }
    }, 650);
    return () => clearTimeout(checkTimer.current);
  }, [activeFile, files, files[activeFile], editorReady, readOnly]);
  const applyRemoteCode = (model, monaco, nextCode) => {
    const currentCode = model.getValue();
    if (currentCode === nextCode) return;
    let start = 0;
    while (start < currentCode.length && start < nextCode.length && currentCode[start] === nextCode[start]) start += 1;
    let currentEnd = currentCode.length;
    let nextEnd = nextCode.length;
    while (currentEnd > start && nextEnd > start && currentCode[currentEnd - 1] === nextCode[nextEnd - 1]) {
      currentEnd -= 1;
      nextEnd -= 1;
    }
    const startPosition = model.getPositionAt(start);
    const endPosition = model.getPositionAt(currentEnd);
    applyingRemote.current = true;
    model.pushEditOperations([], [{ range: new monaco.Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column), text: nextCode.slice(start, nextEnd) }], () => null);
    applyingRemote.current = false;
  };
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !activeFile) return;
    const uri = monaco.Uri.parse(`inmemory://vp-tool/${encodeURIComponent(activeFile)}`);
    let model = monaco.editor.getModel(uri);
    if (!model) model = monaco.editor.createModel(files[activeFile] || '', 'cpp', uri);
    if (editor.getModel() !== model) editor.setModel(model);
    const nextCode = files[activeFile] || '';
    applyRemoteCode(model, monaco, nextCode);
  }, [activeFile, files, files[activeFile], editorReady]);
  return <section className="code-view"><aside className="explorer"><div className="explorer-title">EXPLORER</div><div className="folder-row"><span>⌄</span><span>ROOM FILES</span><button className="new-file" title="新建文件" onClick={onCreate} disabled={readOnly}>+</button><button className="delete-file" title="删除当前代码文件" onClick={() => onDeleteFile()} disabled={readOnly || Object.keys(files).length <= 1}>−</button></div><div className="file-list">{Object.keys(files).sort().map(fileName => <button key={fileName} className={fileName === activeFile ? 'file-item active' : 'file-item'} onClick={() => onSelect(fileName)}>◫ <span>{fileName}</span></button>)}</div></aside><div className="editor-area">{editControls}<div className="editor-tabs"><div className="editor-tab active">◫ {activeFile}</div><div className="editor-tools"><span className={readOnly ? 'view-state' : 'edit-state'}>{readOnly ? '查看模式' : '编辑模式'}</span><button className="tool-button" title="缩小代码字号" onClick={() => onZoom(-1)}>A-</button><button className="tool-button" title="放大代码字号" onClick={() => onZoom(1)}>A+</button><button className="tool-button" title="导出当前代码文件" onClick={onExportCurrent}>导出</button><button className="tool-button" title="导出全部代码文件" onClick={onExportAll}>全部导出</button><button className="tool-button" disabled={!canEdit} onClick={onToggleReadOnly}>{readOnly ? '编辑' : '只读'}</button></div></div><div className="editor"><Editor height="100%" defaultLanguage="cpp" theme="vs-dark" onChange={onChange} onMount={(editor, monaco) => { editorRef.current = editor; monacoRef.current = monaco; }} options={{ fontSize, minimap: { enabled: false }, padding: { top: 18 }, automaticLayout: true, scrollBeyondLastLine: false, mouseWheelZoom: true, readOnly }} /></div><div className="run-panel"><div className="test-header"><span>TEST CASES</span><button className="case-action" onClick={onAddTest} disabled={readOnly}>+ 新用例</button><button className="case-action" onClick={onCheck} disabled={readOnly || syntaxChecking}>{syntaxChecking ? '检查中...' : '语法检查'}</button><button className="case-action primary" onClick={onRunAll} disabled={running || readOnly}>全部运行</button></div><div className="test-layout"><aside className="case-list">{testCases.map((item, index) => <button key={item.id} className={index === activeTest ? 'case-item active' : 'case-item'} onClick={() => onSelectTest(index)}><span>{item.name}</span><small>{item.expected ? '有预期输出' : '无预期输出'}</small></button>)}</aside><div className="case-editor"><div className="case-name-row"><input value={test.name} onChange={event => onUpdateTest(activeTest, 'name', event.target.value)} disabled={readOnly} /><button className="case-delete" onClick={() => onDeleteTest(activeTest)} disabled={readOnly || testCases.length === 1}>删除</button><button className="run" onClick={() => onRun(test)} disabled={running || readOnly}>{running ? '运行中...' : '运行此用例'}</button></div><label>输入</label><textarea style={{ height: `${inputHeight}px` }} value={test.input} onChange={event => onUpdateTest(activeTest, 'input', event.target.value)} disabled={readOnly} placeholder="每行一个输入值" /><div className="panel-resize-bar" onPointerDown={event => beginResize('input', event)} onPointerMove={updateResize} onPointerUp={endResize} title="拖动调整输入区域高度" /><label>预期输出（可选）</label><textarea style={{ height: `${expectedHeight}px` }} value={test.expected} onChange={event => onUpdateTest(activeTest, 'expected', event.target.value)} disabled={readOnly} placeholder="留空则只显示程序输出" /><div className="panel-resize-bar" onPointerDown={event => beginResize('expected', event)} onPointerMove={updateResize} onPointerUp={endResize} title="拖动调整预期输出高度" /></div></div><div className="panel-resize-bar output-resize" onPointerDown={event => beginResize('output', event)} onPointerMove={updateResize} onPointerUp={endResize} title="拖动调整编译消息高度" /><div className="output" style={{ height: `${outputHeight}px` }}><div className="output-title">OUTPUT <span>{readOnly ? 'VIEW ONLY' : 'LOCAL EXECUTION'}</span></div><pre>{output}</pre></div></div></div></section>;
}

function App() {
  const room = location.pathname.split('/room/')[1] || 'demo';
  const [files, setFiles] = useState({ 'main.cpp': initialCode }); const [activeFile, setActiveFile] = useState('main.cpp'); const [activeView, setActiveView] = useState('code'); const [fontSize, setFontSize] = useState(16); const [readOnly, setReadOnly] = useState(false); const [strokes, setStrokes] = useState([]); const [output, setOutput] = useState('等待运行...'); const [running, setRunning] = useState(false); const [syntaxChecking, setSyntaxChecking] = useState(false); const [online, setOnline] = useState(false);
  const [testCasesByFile, setTestCasesByFile] = useState({ 'main.cpp': defaultTestCases }); const [activeTest, setActiveTest] = useState(0);
  const [editMode, setEditMode] = useState('collaborative'); const [roomEditor, setRoomEditor] = useState(null); const [peerId, setPeerId] = useState('');
  const [displayName, setDisplayName] = useState(''); const [joined, setJoined] = useState(false); const [roomReady, setRoomReady] = useState(false); const [peers, setPeers] = useState([]); const [messages, setMessages] = useState([]); const [pdfs, setPdfs] = useState([]); const [activePdf, setActivePdf] = useState(''); const [uploading, setUploading] = useState(false);
  const canEdit = online && roomReady && (editMode === 'collaborative' || roomEditor?.peerId === peerId);
  const effectiveReadOnly = readOnly || !canEdit;
  const [chatDraft, setChatDraft] = useState('');
  const pendingFile = useRef(null);
  const socket = useRef(null); const suppress = useRef(false); const peersRef = useRef([]);
  useEffect(() => {
    const preventBrowserSave = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', preventBrowserSave, true);
    return () => window.removeEventListener('keydown', preventBrowserSave, true);
  }, []);
  const send = message => { if (socket.current?.readyState !== WebSocket.OPEN) return false; try { socket.current.send(JSON.stringify(message)); return true; } catch { return false; } };
  useEffect(() => { if (!joined) return undefined; let reconnectTimer; let closed = false; let retry = 0; const connect = () => { fetch(`/api/rooms/${encodeURIComponent(room)}`).then(response => response.json()).then(data => { const list = data.problems || []; setPdfs(list); setActivePdf(current => list.some(item => item.id === current) ? current : list[0]?.id || ''); }).catch(() => {}); const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(displayName)}`); socket.current = ws; ws.onopen = () => { retry = 0; setOnline(true); }; ws.onclose = () => { if (socket.current === ws) socket.current = null; setOnline(false); setRoomReady(false); if (!closed) { const delay = Math.min(1000 * (2 ** retry), 10000); retry += 1; reconnectTimer = setTimeout(connect, delay); } }; ws.onmessage = event => { const message = JSON.parse(event.data);
    if (message.type === 'snapshot') { ws.peerId = message.peerId; setPeerId(message.peerId); setEditMode(message.editMode || 'collaborative'); setRoomEditor(message.editor || null); peersRef.current = message.peers || []; setPeers(peersRef.current); setMessages(message.messages || []); const list = message.problems || []; setPdfs(list); setActivePdf(current => list.some(item => item.id === current) ? current : list[0]?.id || ''); suppress.current = true; const nextFiles = message.files || { 'main.cpp': initialCode }; setFiles(nextFiles); setTestCasesByFile(message.testCasesByFile || { 'main.cpp': defaultTestCases }); setActiveFile(current => Object.hasOwn(nextFiles, current) ? current : Object.keys(nextFiles)[0]); setStrokes(message.strokes || []); setRoomReady(true); setTimeout(() => suppress.current = false, 0); }
    if (message.type === 'edit-state' || message.type === 'edit-rejected') { setEditMode(message.editMode); setRoomEditor(message.editor); }
    if (message.type === 'edit-rejected') { pendingFile.current = null; setFiles(message.files); setTestCasesByFile(message.testCasesByFile); setActiveFile(current => Object.hasOwn(message.files, current) ? current : Object.keys(message.files)[0]); setOutput(message.reason); }
    if (message.type === 'peer-joined') { peersRef.current = [...peersRef.current.filter(item => item.peerId !== message.peerId), { peerId: message.peerId, name: message.name }]; setPeers(peersRef.current); }
    if (message.type === 'peer-left') { peersRef.current = peersRef.current.filter(item => item.peerId !== message.peerId); setPeers(peersRef.current); }
    if (message.type === 'pdf-updated') { const list = message.problems || []; setPdfs(list); setActivePdf(current => list.some(item => item.id === current) ? current : list[0]?.id || ''); }
    if (message.type === 'test-cases' && message.fileName) setTestCasesByFile(current => ({ ...current, [message.fileName]: message.testCases }));
    if (message.type === 'file-created') { if (pendingFile.current === message.fileName) { setActiveFile(message.fileName); pendingFile.current = null; } setFiles(current => ({ ...current, [message.fileName]: message.code })); setTestCasesByFile(current => ({ ...current, [message.fileName]: current[message.fileName] || defaultTestCases })); }
    if (message.type === 'file-deleted') { setFiles(message.files); setTestCasesByFile(current => { const next = { ...current }; delete next[message.fileName]; return next; }); setActiveFile(current => Object.hasOwn(message.files, current) ? current : Object.keys(message.files)[0]); }
    if (message.type === 'code' && message.fileName) setFiles(current => Object.hasOwn(current, message.fileName) ? { ...current, [message.fileName]: message.code } : current);
    if (message.type === 'chat') setMessages(current => [...current, message].slice(-100));
    if (message.type === 'stroke') setStrokes(value => [...value, message.stroke]); if (message.type === 'board-update' && message.item?.id) setStrokes(value => value.map(item => item.id === message.item.id ? message.item : item)); if (message.type === 'clear') setStrokes([]);
  }; }; connect(); return () => { closed = true; clearTimeout(reconnectTimer); socket.current?.close(); }; }, [room, joined, displayName]);
  const joinRoom = event => { event.preventDefault(); const name = displayName.trim().slice(0, 32); if (!name) return; setDisplayName(name); setJoined(true); };
  const createFile = () => { if (effectiveReadOnly) return; const raw = window.prompt('新建 C++ 文件名，例如 B.cpp'); if (!raw) return; const fileName = raw.trim().endsWith('.cpp') ? raw.trim() : `${raw.trim()}.cpp`; if (!/^[a-zA-Z0-9_-]{1,56}\.cpp$/.test(fileName)) return setOutput('文件名只能包含字母、数字、下划线和连字符'); if (Object.hasOwn(files, fileName)) return setActiveFile(fileName); const code = defaultTemplate(fileName); pendingFile.current = fileName; send({ type: 'file-create', fileName, code }); };
  const deleteFile = () => { if (effectiveReadOnly) return; if (Object.keys(files).length <= 1) return setOutput('至少需要保留一个代码文件'); if (!window.confirm(`删除 ${activeFile}？该文件和它的测试用例会从房间中移除。`)) return; const nextFile = Object.keys(files).find(fileName => fileName !== activeFile); setFiles(current => { const next = { ...current }; delete next[activeFile]; return next; }); setTestCasesByFile(current => { const next = { ...current }; delete next[activeFile]; return next; }); setActiveFile(nextFile); send({ type: 'file-delete', fileName: activeFile }); };
  const sendChat = text => online && roomReady && send({ type: 'chat', text });
  const updateCode = (value, changeEvent) => { if (changeEvent?.isFlush || effectiveReadOnly) return; const code = value || ''; setFiles(current => ({ ...current, [activeFile]: code })); if (!suppress.current) send({ type: 'code', fileName: activeFile, code }); };
  const download = (name, content) => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); link.download = name; link.click(); URL.revokeObjectURL(link.href); };
  const exportCurrent = () => download(activeFile, files[activeFile] || '');
  const exportAll = () => Object.entries(files).forEach(([name, code]) => download(name, code));
  const uploadPdf = async event => { const file = event.target.files?.[0]; if (!file) return; if (file.type !== 'application/pdf') { setOutput('请选择 PDF 文件'); return; } setUploading(true); try { const response = await fetch(`/api/rooms/${encodeURIComponent(room)}/problem?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setPdfs(data.problems); setActivePdf(data.problem.id); setActiveView('problem'); } catch (error) { setOutput(`上传失败: ${error.message}`); } finally { setUploading(false); event.target.value = ''; } };
  const deletePdf = async () => { if (!activePdf) return; const target = pdfs.find(item => item.id === activePdf); if (!target || !window.confirm(`删除题面 ${target.name}？`)) return; try { const response = await fetch(`/api/rooms/${encodeURIComponent(room)}/problem/${encodeURIComponent(activePdf)}`, { method: 'DELETE' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setPdfs(data.problems); setActivePdf(data.problems[0]?.id || ''); } catch (error) { setOutput(`删除失败: ${error.message}`); } };
  const testCases = testCasesByFile[activeFile] || defaultTestCases;
  useEffect(() => { setActiveTest(0); }, [activeFile]);
  const saveTestCases = nextCases => { if (effectiveReadOnly) return; setTestCasesByFile(current => ({ ...current, [activeFile]: nextCases })); send({ type: 'test-cases', fileName: activeFile, testCases: nextCases }); };
  const updateTest = (index, key, nextValue) => saveTestCases(testCases.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: nextValue } : item));
  const addTest = () => { const nextCases = [...testCases, { id: `case-${Date.now()}-${Math.random()}`, name: `样例 ${testCases.length + 1}`, input: '', expected: '' }]; saveTestCases(nextCases); setActiveTest(nextCases.length - 1); };
  const deleteTest = index => { if (testCases.length === 1) return; const nextCases = testCases.filter((_, itemIndex) => itemIndex !== index); saveTestCases(nextCases); setActiveTest(current => Math.max(0, Math.min(current, nextCases.length - 1))); };
  const runOne = async test => { const response = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'cpp', code: files[activeFile] || '', input: test.input }) }); const data = await response.json(); return { ...test, actual: data.output || data.error || '无输出', ok: data.ok && (!test.expected.trim() || data.output.trim() === test.expected.trim()) }; };
  const run = async test => { if (effectiveReadOnly) return; setRunning(true); setOutput(`正在运行 ${test.name}...`); try { const result = await runOne(test); setOutput(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}\n\n输入:\n${result.input || '(空)'}\n\n输出:\n${result.actual}${result.expected ? `\n\n预期:\n${result.expected}` : ''}`); } catch (error) { setOutput(`请求失败: ${error.message}`); } finally { setRunning(false); } };
  const runAll = async () => { if (effectiveReadOnly) return; setRunning(true); setOutput('正在运行全部测试用例...'); try { const results = []; for (const test of testCases) results.push(await runOne(test)); setOutput(results.map(result => `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}\n${result.actual}`).join('\n\n')); } catch (error) { setOutput(`请求失败: ${error.message}`); } finally { setRunning(false); } };
  const checkSyntax = async () => { if (effectiveReadOnly) return; setSyntaxChecking(true); setOutput('正在进行语法检查...'); try { const response = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'cpp', code: files[activeFile] || '' }) }); const data = await response.json(); setOutput(data.ok ? '语法检查通过。' : `语法检查失败:\n${data.diagnostics || data.error || '未知错误'}`); } catch (error) { setOutput(`检查失败: ${error.message}`); } finally { setSyntaxChecking(false); } };
  const renderView = () => {
    if (activeView === 'problem') { const currentPdf = pdfs.find(item => item.id === activePdf); return <section className="document-view"><div className="view-toolbar"><span>PROBLEM / {room}</span><div className="pdf-actions"><select value={activePdf} onChange={event => setActivePdf(event.target.value)}><option value="">选择题面</option>{pdfs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{currentPdf && <button className="pdf-delete" onClick={deletePdf}>删除当前题面</button>}<label className="pdf-upload">{uploading ? '上传中...' : '上传 PDF'}<input type="file" accept="application/pdf" onChange={uploadPdf} disabled={uploading} /></label></div></div><div className="document-body">{currentPdf ? <iframe className="pdf-frame" title={currentPdf.name} src={`${currentPdf.url}?v=${encodeURIComponent(currentPdf.id)}`} /> : <div className="pdf-placeholder"><strong>尚未上传题面</strong><small>可以上传多个 PDF，并从右上角选择查看。</small></div>}</div></section>; }
    if (activeView === 'board') return <section className="board-view"><div className="view-toolbar"><span>ALGORITHM BOARD</span><span>共享画板</span></div><Whiteboard socket={socket.current} strokes={strokes} setStrokes={setStrokes} /></section>;
    if (activeView === 'chat') return <ChatPanel messages={messages} onSend={sendChat} connected={online && roomReady} text={chatDraft} setText={setChatDraft} />;
    if (!roomReady) return <section className="sync-placeholder">正在同步房间内容...</section>;
    return <CodePanel activeFile={activeFile} files={files} fontSize={fontSize} output={output} readOnly={effectiveReadOnly} canEdit={canEdit} editControls={<div className="edit-mode-bar"><label>训练模式 <select aria-label="训练模式" value={editMode} disabled={!online || !roomReady} onChange={event => send({ type: 'edit-mode', editMode: event.target.value })}><option value="collaborative">多人编辑</option><option value="single">单机比赛</option></select></label><span role="status">{editMode === 'single' ? (roomEditor ? `当前编辑：${roomEditor.name}${roomEditor.peerId === peerId ? '（你）' : ''}` : '暂无编辑者，请领取编辑权') : '队员可同时编辑代码'}</span>{editMode === 'single' && <button disabled={!online || !roomReady || Boolean(roomEditor && roomEditor.peerId !== peerId)} onClick={() => { setReadOnly(false); send({ type: roomEditor?.peerId === peerId ? 'edit-release' : 'edit-acquire' }); }}>{roomEditor?.peerId === peerId ? '释放编辑权' : '领取编辑权'}</button>}</div>} running={running} syntaxChecking={syntaxChecking} testCases={testCases} activeTest={activeTest} onChange={updateCode} onCreate={createFile} onDeleteFile={deleteFile} onExportCurrent={exportCurrent} onExportAll={exportAll} onRun={run} onRunAll={runAll} onCheck={checkSyntax} onSelect={setActiveFile} onToggleReadOnly={() => setReadOnly(value => !value)} onZoom={delta => setFontSize(value => Math.max(12, Math.min(24, value + delta)))} onAddTest={addTest} onDeleteTest={deleteTest} onUpdateTest={updateTest} onSelectTest={setActiveTest} />;
  };
  if (!joined) return <main className="join-screen"><form className="join-card" onSubmit={joinRoom}><div className="mark">VP</div><h1>加入 VP 房间</h1><p>房间：{room}</p><label>用户名<input autoFocus value={displayName} maxLength="32" onChange={event => setDisplayName(event.target.value)} placeholder="例如：Alice" /></label><button type="submit">加入房间</button></form></main>;
  return <main><header><div className="brand"><span className="mark">VP</span><strong>vp-tool</strong><span className="window-title">Remote Training Room</span></div><div className="room-meta"><span className={online ? 'status online' : 'status'}></span>{online ? '已连接' : '重连中'}<span className="room-id">ROOM / {room}</span><span className="online-users" title={peers.map(peer => peer.name).join('、')}>{peers.length + 1} 人在线</span><button className="share" onClick={() => navigator.clipboard?.writeText(location.href)}>复制房间链接</button></div></header><div className="app-shell"><nav className="activity-bar" aria-label="工作区"><button className={activeView === 'code' ? 'activity active' : 'activity'} title="代码" onClick={() => setActiveView('code')}>⌘</button><button className={activeView === 'problem' ? 'activity active' : 'activity'} title="题面" onClick={() => setActiveView('problem')}>▤</button><button className={activeView === 'board' ? 'activity active' : 'activity'} title="画板" onClick={() => setActiveView('board')}>✎</button><button className={activeView === 'chat' ? 'activity active' : 'activity'} title="聊天室" aria-label="聊天室" onClick={() => setActiveView('chat')}>☵</button></nav><section className="workspace">{renderView()}</section></div><footer className="status-bar"><span>UTF-8</span><span>C++</span><span>{peers.length + 1} 位队员在线：{[displayName, ...peers.map(peer => peer.name)].join('、')}</span></footer></main>;
}

function defaultTemplate(fileName) {
  return `// ${fileName}\n#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}\n`;
}

createRoot(document.getElementById('root')).render(createElement(App));
