// ============================================================
//  ShogiAnalytics — Local Agent
//  WebRTC DataChannel <-> USI エンジン ブリッジ
//
//  起動: node index.js  または  ShogiAgent.exe (ダブルクリック)
//  設定: config.json (exe と同じフォルダ — 初回起動時に自動生成)
// ============================================================
'use strict';

const { spawn }         = require('child_process');
const readline          = require('readline');
const path              = require('path');
const fs                = require('fs');
const os                = require('os');
const https             = require('https');
const http              = require('http');
const { io: sigClient } = require('socket.io-client');
const nodeDataChannel   = require('node-datachannel');

// ── ANSI カラー ──────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
function log(label, msg, color = C.reset) {
  const t = new Date().toLocaleTimeString('ja-JP');
  console.log(`${C.gray}[${t}]${C.reset} ${color}${C.bold}[${label}]${C.reset} ${msg}`);
}
function logOk(l, m)   { log(l, m, C.green);  }
function logWarn(l, m) { log(l, m, C.yellow); }
function logErr(l, m)  { log(l, m, C.red);    }
function logInfo(l, m) { log(l, m, C.cyan);   }

// ============================================================
//  設定ファイル読み込み
// ============================================================
const CONFIG_DIR  = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_ENGINE_PATH = process.platform === 'win32'
  ? 'D:\\将棋エンジン\\YaneuraOu_NNUE_halfkp_512x2_8_64-V900Git_AVX2.exe'
  : process.platform === 'darwin'
    ? '/usr/local/bin/YaneuraOu'  // macOS の一般的な場所（要変更）
    : '/usr/local/bin/YaneuraOu'; // Linux

const DEFAULT_CONFIG = {
  serverUrl:    'http://localhost:3010',
  agentToken:   '',
  enginePath:   DEFAULT_ENGINE_PATH,
  multiPv:      5,
  engineOptions: {},  // エンジン設定の永続保存 { "name": "value" }
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    logInfo('設定', `config.json を生成しました: ${CONFIG_PATH}`);
    logInfo('設定', 'enginePath を設定してから再起動してください。agentToken は自動取得されます。');
    process.exit(0);
  }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch (e) {
    logErr('設定', `config.json の読み込みに失敗: ${e.message}`);
    process.exit(1);
  }
}

const config      = loadConfig();
const SERVER_URL  = config.serverUrl;
const ENGINE_PATH = config.enginePath;
const MULTI_PV    = parseInt(config.multiPv) || 5;
const STUN_SERVERS = ['stun:stun.l.google.com:19302'];

// 起動バナー
console.log('\n' + '═'.repeat(56));
console.log(`  ${C.bold}${C.cyan}ShogiAnalytics Local Agent${C.reset}`);
console.log('─'.repeat(56));
console.log(`  設定ファイル : ${CONFIG_PATH}`);
console.log(`  サーバー     : ${SERVER_URL}`);
console.log(`  エンジン     : ${path.basename(ENGINE_PATH)}`);
console.log(`  トークン     : ${config.agentToken ? '設定済み' : '未設定 (ペアリング待ち)'}`);
console.log('═'.repeat(56) + '\n');

// ============================================================
//  HTTP ヘルパー (fetch polyfill for Node 18+)
// ============================================================
async function apiPost(url, body) {
  const parsed = new URL(url);
  const data   = JSON.stringify(body);
  const opts   = {
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname,
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
  };
  return new Promise((resolve, reject) => {
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ============================================================
//  HTTP GET ヘルパー
// ============================================================
async function apiGet(url) {
  const parsed = new URL(url);
  const opts   = {
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname + parsed.search,
    method:   'GET',
  };
  return new Promise((resolve, reject) => {
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ============================================================
//  エージェントトークン取得 (設定済みまたはペアリングフロー)
// ============================================================
async function getOrPairToken() {
  if (config.agentToken) {
    logOk('Auth', 'config.json からエージェントトークンを使用します');
    return config.agentToken;
  }

  // ペアリングをリクエスト
  logInfo('Auth', 'ペアリングをリクエスト中…');
  const res = await apiPost(`${SERVER_URL}/agent/request-pairing`, {
    hostname:   os.hostname(),
    engineName: path.basename(ENGINE_PATH),
  });
  if (res.status !== 200) {
    logErr('Auth', `ペアリングリクエスト失敗 (${res.status}): ${res.body?.error || res.body}`);
    process.exit(1);
  }
  const { code, pairingUrl, expiresIn } = res.body;

  console.log('\n' + '='.repeat(60));
  logInfo('ペアリング', '以下のURLをブラウザで開いて承認してください:');
  console.log('');
  console.log(`  ${C.bold}${C.cyan}${pairingUrl}${C.reset}`);
  console.log('');
  console.log(`  有効期限: ${Math.round(expiresIn / 60)} 分`);
  console.log('='.repeat(60) + '\n');

  // 承認待ちポーリング
  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    let poll;
    try { poll = await apiGet(`${SERVER_URL}/agent/poll?code=${encodeURIComponent(code)}`); }
    catch (e) { logWarn('Auth', `ポーリングエラー: ${e.message}`); continue; }

    if (poll.status === 200 && poll.body?.approved) {
      const token = poll.body.agentToken;
      logOk('Auth', 'ペアリング承認されました！');
      // config.json に保存
      try {
        const saved = { ...config, agentToken: token };
        delete saved._comment;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(saved, null, 2), 'utf8');
        logOk('Auth', `トークンを config.json に保存しました`);
      } catch (e) {
        logWarn('Auth', `config.json への保存に失敗: ${e.message}`);
      }
      return token;
    }
    if (poll.status === 400) {
      logErr('Auth', 'ペアリングコードの有効期限が切れました。再起動してください。');
      process.exit(1);
    }
    logInfo('Auth', '承認待ち…');
  }
  logErr('Auth', 'タイムアウト: ペアリングが完了しませんでした。再起動してください。');
  process.exit(1);
}

// JWT ペイロードをデコード (署名検証なし — サーバーで検証済み)
function parseJwt(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()); }
  catch { return {}; }
}

// ── DataChannel 送信ヘルパー ─────────────────────────────────
let dataChannel = null;

function emitToClient(event, data) {
  if (dataChannel && dataChannel.isOpen()) {
    try { dataChannel.sendMessage(JSON.stringify({ event, data })); }
    catch (e) { logWarn('DC', `送信エラー (${event}): ${e.message}`); }
  }
}

// ============================================================
//  USI エンジン状態
// ============================================================
let engineProc  = null;
let engineReady = false;
const engineOptions = [];

let isThinking      = false;
let currentSFEN     = null;
let pendingAnalysis = null;
let pendingOptions  = null;

let autoState           = 'idle';
let autoPositions       = [];
let autoCondition       = { type: 'movetime', value: 3000 };
let autoCurrentIdx      = 0;
let autoBestInfo        = {};
let pendingAutoAnalysis = null;

let aiThinkMode    = false;
let pendingAiThink = null;

function sendEngine(cmd) {
  if (!engineProc) return;
  engineProc.stdin.write(cmd + '\n');
}

function fmtNodes(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function parseOptionLine(line) {
  const tokens = line.trim().split(/\s+/);
  const r = { name: '', type: 'string', default: '', value: '', min: undefined, max: undefined, vars: [] };
  let i = 1;
  while (i < tokens.length) {
    const k = tokens[i];
    if (k === 'name') {
      i++;
      const p = [];
      while (i < tokens.length && tokens[i] !== 'type') p.push(tokens[i++]);
      r.name = p.join(' ');
    } else if (k === 'type')    { r.type    = tokens[++i]; i++; }
      else if (k === 'default') { i++; const p = [];
        while (i < tokens.length && !['min', 'max', 'var'].includes(tokens[i])) p.push(tokens[i++]);
        r.default = p.join(' ');
      }
      else if (k === 'min') { r.min = parseInt(tokens[++i]); i++; }
      else if (k === 'max') { r.max = parseInt(tokens[++i]); i++; }
      else if (k === 'var') { r.vars.push(tokens[++i]); i++; }
      else                  { i++; }
  }
  r.value = r.default;
  return r;
}

function parseInfoLine(line) {
  const depth   = parseInt(line.match(/\bdepth (\d+)/)?.[1]   ?? '0');
  const multipv = parseInt(line.match(/\bmultipv (\d+)/)?.[1] ?? '1');
  const nodes   = parseInt(line.match(/\bnodes (\d+)/)?.[1]   ?? '0');
  let score = 0, isMate = false, mateIn = null;
  const cpM = line.match(/\bscore cp (-?\d+)/);
  const mtM = line.match(/\bscore mate (-?\d+)/);
  if (cpM)      { score = parseInt(cpM[1]); }
  else if (mtM) { isMate = true; mateIn = parseInt(mtM[1]); score = mateIn > 0 ? 32000 : -32000; }
  const pvM = line.match(/\bpv (.+)$/);
  return { depth, multipv, score, isMate, mateIn, nodes: fmtNodes(nodes), pvUSI: pvM ? pvM[1].trim() : '' };
}

function buildCPUGoCommand(cpuConfig, remainingTimes) {
  if (!cpuConfig) return 'go movetime 3000';
  const { thinkType, thinkParams = {} } = cpuConfig;
  const btime = Math.max(0, (remainingTimes && remainingTimes[1]) || 0);
  const wtime = Math.max(0, (remainingTimes && remainingTimes[2]) || 0);
  switch (thinkType) {
    case 'nodes':   return `go nodes ${thinkParams.nodes ?? 500000}`;
    case 'depth':   return `go depth ${thinkParams.depth ?? 15}`;
    case 'byoyomi': return `go btime ${btime} wtime ${wtime} byoyomi ${thinkParams.byoyomiMs ?? 5000}`;
    default:        return 'go movetime 3000';
  }
}

function doStartAnalysis(sfen) {
  currentSFEN = sfen; isThinking = true;
  sendEngine(`position sfen ${sfen}`);
  sendEngine('go infinite');
  emitToClient('engine:status', { status: 'thinking' });
}

function requestAnalysis(sfen) {
  if (!engineReady) { pendingAnalysis = sfen; return; }
  if (autoState !== 'idle') return;
  if (isThinking) { pendingAnalysis = sfen; sendEngine('stop'); }
  else             doStartAnalysis(sfen);
}

function saveEngineSettings() {
  try {
    const saved = { ...(config.engineOptions || {}) };
    for (const opt of engineOptions) {
      if (opt.value !== opt.default) saved[opt.name] = opt.value;
    }
    config.engineOptions = saved;
    const toWrite = { ...config };
    delete toWrite._comment;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(toWrite, null, 2), 'utf8');
    logOk('Settings', 'エンジン設定を保存しました');
  } catch (e) {
    logWarn('Settings', `設定保存失敗: ${e.message}`);
  }
}

function applyOptions(options) {
  for (const { name, value } of options) {
    sendEngine(`setoption name ${name} value ${value}`);
    const opt = engineOptions.find((o) => o.name === name);
    if (opt) opt.value = value;
  }
  saveEngineSettings();
  if (currentSFEN) pendingAnalysis = currentSFEN;
  sendEngine('isready');
  emitToClient('engine:status', { status: 'connecting', message: 'オプション反映中…' });
}

function doAiThink(sfen, cpuConfig, remainingTimes) {
  isThinking = true; aiThinkMode = true;
  sendEngine('usinewgame');
  sendEngine(`position sfen ${sfen}`);
  sendEngine(buildCPUGoCommand(cpuConfig, remainingTimes));
  emitToClient('engine:status', { status: 'thinking' });
}

function runNextAutoPosition() {
  // setImmediate 後の遅延実行中に stop/DC切断が入った場合は何もしない
  if (autoState !== 'running') return;
  if (autoCurrentIdx >= autoPositions.length) {
    autoState = 'idle'; isThinking = false;
    emitToClient('auto_analysis:complete', { total: autoPositions.length });
    emitToClient('engine:status', { status: 'ready', message: '棋譜解析完了' });
    return;
  }
  const pos = autoPositions[autoCurrentIdx];
  autoBestInfo = {}; isThinking = true;
  sendEngine('usinewgame');
  sendEngine(`position sfen ${pos.sfen}`);
  const { type, value } = autoCondition;
  if      (type === 'movetime') sendEngine(`go movetime ${value}`);
  else if (type === 'nodes')    sendEngine(`go nodes ${value}`);
  else if (type === 'depth')    sendEngine(`go depth ${value}`);
  else                          sendEngine('go movetime 3000');
  emitToClient('auto_analysis:progress', {
    current: autoCurrentIdx + 1, total: autoPositions.length, moveIndex: pos.moveIndex,
  });
}

function doStartAutoAnalysis(positions, condition) {
  autoState = 'running'; autoPositions = positions;
  autoCondition = condition || { type: 'movetime', value: 3000 };
  autoCurrentIdx = 0;
  emitToClient('auto_analysis:started', { total: positions.length });
  runNextAutoPosition();
}

function startEngine() {
  // DataChannel が再接続しても二重起動しない (exitCode !== null = 既終了)
  if (engineProc && !engineProc.killed && engineProc.exitCode === null) {
    logInfo('Engine', 'エンジンは既に動作中 — 状態をクライアントに通知');
    emitToClient('engine:options', engineOptions);
    // 実際の状態を正確に伝える
    if (!engineReady) {
      emitToClient('engine:status', { status: 'connecting', message: 'エンジン起動中…' });
    } else if (autoState === 'running') {
      emitToClient('engine:status', { status: 'thinking', message: '棋譜解析中…' });
      emitToClient('auto_analysis:progress', {
        current: autoCurrentIdx + 1,
        total: autoPositions.length,
        moveIndex: autoPositions[autoCurrentIdx]?.moveIndex,
      });
    } else if (isThinking) {
      emitToClient('engine:status', { status: 'thinking' });
    } else {
      emitToClient('engine:status', { status: 'ready', message: 'エンジン準備完了' });
    }
    return;
  }
  // 前回の接続で積み残したオプションをクリア
  engineOptions.length = 0;
  engineReady = false;

  if (!fs.existsSync(ENGINE_PATH)) {
    logErr('Engine', `エンジンが見つかりません: ${ENGINE_PATH}`);
    logErr('Engine', 'config.json の enginePath を確認してください。');
    emitToClient('engine:status', { status: 'error', message: `エンジンが見つかりません` });
    return;
  }
  const dir = path.dirname(ENGINE_PATH);
  logInfo('Engine', `起動中: ${path.basename(ENGINE_PATH)}`);
  emitToClient('engine:status', { status: 'connecting', message: 'エンジン起動中…' });
  try {
    engineProc = spawn(ENGINE_PATH, [], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    logErr('Engine', `spawn 失敗: ${err.message}`);
    emitToClient('engine:status', { status: 'error', message: `起動失敗: ${err.message}` });
    return;
  }
  engineProc.stdin.on('error', () => {}); // EPIPE 等を非同期で抑制
  engineProc.on('error',  (err) => { logErr('Engine', err.message); emitToClient('engine:status', { status: 'error', message: err.message }); });
  engineProc.on('exit',   (code) => {
    const wasAutoRunning = autoState === 'running' || autoState === 'stopping';
    const crashedIdx     = autoCurrentIdx;
    // クラッシュした局面の次から再開するために保存
    const resumePositions = (wasAutoRunning && autoCurrentIdx + 1 < autoPositions.length)
      ? autoPositions.slice(autoCurrentIdx + 1) : [];
    const resumeCondition = { ...autoCondition };

    engineReady = false; isThinking = false; autoState = 'idle'; aiThinkMode = false;
    autoPositions = []; pendingAutoAnalysis = null; pendingAnalysis = null;
    pendingAiThink = null; pendingOptions = null;
    engineProc = null; // クラッシュ後に startEngine() で再起動できるようにする

    logWarn('Engine', `終了 (code=${code})`);
    if (wasAutoRunning) emitToClient('auto_analysis:stopped', { stoppedAt: crashedIdx });
    emitToClient('engine:status', { status: 'error', message: `エンジン終了 (code ${code})` });

    // DC が開いていれば自動再起動
    if (dataChannel && dataChannel.isOpen()) {
      logInfo('Engine', '2秒後に自動再起動します…');
      setTimeout(() => {
        if (!(dataChannel && dataChannel.isOpen())) return;
        // クラッシュした局面をスキップして残りを pending にセット
        if (resumePositions.length > 0) {
          pendingAutoAnalysis = { positions: resumePositions, condition: resumeCondition };
          logInfo('Engine', `クラッシュ局面をスキップ — 残り ${resumePositions.length} 局面から再開`);
        }
        startEngine();
      }, 2000);
    }
  });
  engineProc.stderr.on('data', (d) => process.stderr.write(d));
  const rl = readline.createInterface({ input: engineProc.stdout });
  rl.on('line', (line) => {
    if (!line.startsWith('info') && !line.startsWith('bestmove'))
      process.stdout.write(`${C.gray}  ← ${line}${C.reset}\n`);

    if (line.startsWith('option ')) {
      const opt = parseOptionLine(line); if (opt.name) engineOptions.push(opt); return;
    }
    if (line === 'usiok') {
      // 保存済み設定を適用 (なければ config.multiPv をデフォルトに)
      const saved = config.engineOptions || {};
      const multiPvVal = saved['MultiPV'] ?? String(MULTI_PV);
      sendEngine(`setoption name MultiPV value ${multiPvVal}`);
      const mpOpt = engineOptions.find((o) => o.name === 'MultiPV');
      if (mpOpt) mpOpt.value = String(multiPvVal);
      for (const [name, value] of Object.entries(saved)) {
        if (name === 'MultiPV') continue;
        sendEngine(`setoption name ${name} value ${value}`);
        const opt = engineOptions.find((o) => o.name === name);
        if (opt) opt.value = String(value);
      }
      emitToClient('engine:options', engineOptions);
      sendEngine('isready'); return;
    }
    if (line === 'readyok') {
      engineReady = true; logOk('Engine', 'エンジン準備完了');
      emitToClient('engine:status', { status: 'ready', message: 'エンジン準備完了' });
      emitToClient('engine:options', engineOptions);
      if (pendingAutoAnalysis) { const a = pendingAutoAnalysis; pendingAutoAnalysis = null; doStartAutoAnalysis(a.positions, a.condition); }
      else if (pendingAnalysis)  { const s = pendingAnalysis;  pendingAnalysis  = null; doStartAnalysis(s); }
      return;
    }
    if (line.startsWith('info') && line.includes(' pv ') && line.includes('depth')) {
      const data = parseInfoLine(line);
      if (autoState === 'running') {
        autoBestInfo[data.multipv] = data;
        // 進捗は bestmove 受信時のみ送信 (DCメッセージ数を1手1回に削減)
      } else { emitToClient('engine:info', data); }
      return;
    }
    if (line.startsWith('bestmove')) {
      isThinking = false;
      const bestMoveToken = line.split(' ')[1] ?? 'none';
      if (autoState === 'running' || autoState === 'stopping') {
        if (autoState === 'stopping') {
          autoState = 'idle'; autoPositions = [];
          emitToClient('auto_analysis:stopped', { stoppedAt: autoCurrentIdx });
          emitToClient('engine:status', { status: 'ready', message: '自動解析停止' }); return;
        }
        const pos = autoPositions[autoCurrentIdx]; const best = autoBestInfo[1];
        if (best && pos) {
          emitToClient('auto_analysis:progress', {
            current: autoCurrentIdx + 1, total: autoPositions.length,
            moveIndex: pos.moveIndex, depth: best.depth,
          });
          emitToClient('auto_analysis:result', {
            moveIndex: pos.moveIndex,
            evalScore: pos.player === 1 ? best.score : -best.score,
            candidates: Object.values(autoBestInfo).sort((a, b) => a.multipv - b.multipv),
          });
        }
        autoCurrentIdx++; setImmediate(runNextAutoPosition); return;
      }
      if (aiThinkMode) {
        aiThinkMode = false;
        emitToClient('ai:bestmove', { move: bestMoveToken });
        emitToClient('engine:status', { status: 'ready' });
        if (pendingAiThink) { const a = pendingAiThink; pendingAiThink = null; doAiThink(a.sfen, a.cpuConfig, a.remainingTimes); }
        return;
      }
      if (pendingAiThink)        { const a = pendingAiThink;        pendingAiThink        = null; doAiThink(a.sfen, a.cpuConfig, a.remainingTimes); }
      else if (pendingAutoAnalysis) { const a = pendingAutoAnalysis; pendingAutoAnalysis = null; doStartAutoAnalysis(a.positions, a.condition); }
      else if (pendingOptions)   { const o = pendingOptions;        pendingOptions        = null; applyOptions(o); }
      else if (pendingAnalysis)  { const s = pendingAnalysis;       pendingAnalysis       = null; doStartAnalysis(s); }
      else { emitToClient('engine:bestmove', { move: bestMoveToken }); emitToClient('engine:status', { status: 'ready', message: '解析完了' }); }
    }
  });
  sendEngine('usi');
}

function handleClientEvent(event, data) {
  switch (event) {
    case 'analyze':        if (data?.sfen) requestAnalysis(data.sfen); break;
    case 'stop':           pendingAnalysis = null; if (isThinking && autoState === 'idle' && !aiThinkMode) sendEngine('stop'); break;
    case 'set_options':    if (!Array.isArray(data) || !data.length) break; if (isThinking) { pendingOptions = data; sendEngine('stop'); } else applyOptions(data); break;
    case 'start_auto_analysis': {
      const { positions, condition } = data || {};
      if (!Array.isArray(positions) || !positions.length || !engineReady || autoState !== 'idle') break;
      const cond = (condition?.type && condition?.value > 0) ? condition : { type: 'movetime', value: 3000 };
      pendingOptions = null; pendingAnalysis = null;
      if (isThinking) { pendingAutoAnalysis = { positions, condition: cond }; sendEngine('stop'); } else doStartAutoAnalysis(positions, cond);
      break;
    }
    case 'ai_think': {
      const { sfen, cpuConfig, remainingTimes } = data || {};
      if (!engineReady || autoState !== 'idle') break;
      pendingAnalysis = null; pendingOptions = null;
      if (isThinking) { pendingAiThink = { sfen, cpuConfig, remainingTimes }; sendEngine('stop'); } else doAiThink(sfen, cpuConfig, remainingTimes);
      break;
    }
    case 'stop_ai_think':       pendingAiThink = null; if (isThinking && aiThinkMode) { aiThinkMode = false; sendEngine('stop'); } break;
    case 'stop_auto_analysis':  if (autoState === 'running') { autoState = 'stopping'; sendEngine('stop'); } else if (autoState === 'idle') pendingAutoAnalysis = null; break;
    case 'start_analysis':
      if (data?.sfen) {
        if (!engineReady || autoState !== 'idle') {
          pendingAnalysis = data.sfen;
          if (!engineProc || engineProc.exitCode !== null) startEngine();
        } else {
          if (isThinking) { pendingAnalysis = data.sfen; sendEngine('stop'); }
          else doStartAnalysis(data.sfen);
        }
      }
      break;
    case 'stop_and_standby':
      pendingAnalysis = null; pendingAutoAnalysis = null; pendingAiThink = null; pendingOptions = null;
      if (isThinking && autoState === 'idle' && !aiThinkMode) sendEngine('stop');
      autoState = 'idle'; autoPositions = [];
      isThinking = false; aiThinkMode = false;
      emitToClient('engine:status', { status: 'standby', message: 'スタンバイ中' });
      break;
    case 'restart_engine': {
      logInfo('Engine', 'クライアントからの再起動要求');
      pendingAnalysis = null; pendingAutoAnalysis = null; pendingAiThink = null; pendingOptions = null;
      autoState = 'idle'; autoPositions = []; isThinking = false; aiThinkMode = false;
      emitToClient('engine:status', { status: 'connecting', message: 'エンジン再起動中…' });
      if (engineProc && !engineProc.killed && engineProc.exitCode === null) {
        try { engineProc.stdin.write('quit\n'); } catch (_) {}
        setTimeout(() => {
          try { engineProc.kill(); } catch (_) {}
          engineProc = null; engineReady = false;
          startEngine();
        }, 1500);
      } else {
        engineProc = null; engineReady = false;
        startEngine();
      }
      break;
    }
    default: logWarn('DC', `不明なイベント: ${event}`);
  }
}

// ============================================================
//  WebRTC セットアップ (Answerer)
// ============================================================
function setupWebRTC(sigSocket) {
  const pc = new nodeDataChannel.PeerConnection('agent', { iceServers: STUN_SERVERS });

  pc.onLocalDescription((sdp, type) => {
    logInfo('WebRTC', `SDP 生成 (${type})`);
    sigSocket.emit('answer', { sdp, type });
  });
  pc.onLocalCandidate((candidate, mid) => sigSocket.emit('ice-candidate', { candidate, sdpMid: mid }));
  pc.onStateChange((state) => logInfo('WebRTC', `状態: ${state}`));

  pc.onDataChannel((channel) => {
    logInfo('DC', 'DataChannel 受信');
    dataChannel = channel;
    channel.onOpen(() => {
      logOk('DC', 'DataChannel オープン → エンジン起動');
      // 前の接続で止まった自動解析状態をリセット (別デバイス切り替え対応)
      if (autoState === 'running' || autoState === 'stopping') {
        sendEngine('stop');
        autoState = 'idle';
        autoPositions = [];
        logInfo('Engine', '新規接続 — 自動解析状態をリセット');
      }
      startEngine();
    });
    channel.onMessage((msg) => {
      try { const { event, data } = JSON.parse(msg); handleClientEvent(event, data); }
      catch (e) { logWarn('DC', `不正なメッセージ: ${msg}`); }
    });
    channel.onClosed(() => {
      logWarn('DC', 'クローズ');
      dataChannel = null;
      // クライアント切断時はエンジンの進行中処理をすべてリセットする。
      // これにより次の接続 (別デバイス含む) が即座に新規解析を開始できる。
      if (autoState === 'running' || autoState === 'stopping') {
        sendEngine('stop');   // エンジンに停止を指示 (bestmove で isThinking = false になる)
        autoState = 'idle';
        autoPositions = [];
        logInfo('Engine', 'DC切断 — 自動解析をリセット');
      }
      aiThinkMode        = false;
      pendingAutoAnalysis = null;
      pendingAnalysis    = null;
      pendingAiThink     = null;
      pendingOptions     = null;
    });
    channel.onError((err) => logErr('DC', String(err)));
  });

  return pc;
}

// ============================================================
//  エントリポイント: ログイン → シグナリング接続
// ============================================================
async function main() {
  // 1. エージェントトークン取得 (設定済みまたはペアリングフロー)
  const token = await getOrPairToken();
  const { userId, agentId } = parseJwt(token);
  logInfo('Auth', `userId: ${userId?.slice(0, 8)}… agentId: ${agentId?.slice(0, 8)}…`);

  // 2. シグナリング接続 (JWT で認証 — userId はサーバーがJWTから取得)
  logInfo('Sig', `シグナリングに接続中: ${SERVER_URL}`);

  let peerConn = null;

  const sigSocket = sigClient(SERVER_URL, {
    query:             { role: 'agent', token },
    transports:        ['websocket', 'polling'],
    reconnection:      true,
    reconnectionDelay: 3000,
  });

  sigSocket.on('connect', () => {
    logOk('Sig', `接続完了 — フロントエンドの接続待機中`);
    // 旧 PeerConnection をクリーンアップするだけ。新規 PC は offer 受信時に作成する。
    // ここで setupWebRTC() を呼ぶと node-datachannel が自動で offer 型の
    // LocalDescription を生成してしまい、フロントエンドとの接続が壊れる。
    if (peerConn) { try { peerConn.close(); } catch (_) {} peerConn = null; }
    dataChannel = null;
  });

  sigSocket.on('connect_error', (err) => {
    logErr('Sig', `接続エラー: ${err.message}`);
    if (err.message.includes('revoked') || err.message.includes('not found')) {
      logErr('Sig', 'エージェントが無効化されています。config.json の agentToken を削除して再起動してください。');
    } else if (err.message.includes('token') || err.message.includes('invalid')) {
      logErr('Sig', 'トークンが無効です。config.json の agentToken を削除して再起動してください。');
    }
  });

  sigSocket.on('offer', ({ sdp, type }) => {
    logInfo('WebRTC', 'Offer 受信 → 新規 PeerConnection 作成');
    if (peerConn) { try { peerConn.close(); } catch (_) {} }
    peerConn = setupWebRTC(sigSocket);
    peerConn.setRemoteDescription(sdp, type);
    peerConn.setLocalDescription();
  });

  sigSocket.on('ice-candidate', ({ candidate, sdpMid }) => {
    if (candidate && peerConn) {
      try { peerConn.addRemoteCandidate(candidate, sdpMid ?? '0'); }
      catch (e) { logWarn('WebRTC', `addRemoteCandidate: ${e.message}`); }
    }
  });

  sigSocket.on('peer-joined', ({ role }) => logInfo('Sig', `peer joined: role=${role}`));
  sigSocket.on('peer-left',   ({ role }) => { logWarn('Sig', `peer left: role=${role}`); if (role === 'frontend') dataChannel = null; });
  sigSocket.on('disconnect',  (reason)  => logWarn('Sig', `切断: ${reason}`));
}

main().catch((e) => { logErr('Fatal', e.message); process.exit(1); });
