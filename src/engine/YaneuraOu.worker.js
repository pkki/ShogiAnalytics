/**
 * YaneuraOu.worker.js
 * YaneuraOu WASM エンジンを USI プロトコルで制御するワーカー
 *
 * 受信コマンド (postMessage):
 *   { cmd:'load', variant:'suishopetite'|'suisho5' }
 *   { cmd:'start_analysis', sfen, multiPV, timeLimit }
 *   { cmd:'analyze', sfen, multiPV, timeLimit }
 *   { cmd:'stop' }
 *   { cmd:'ai_think', sfen, timeLimit }
 *
 * 送信メッセージ:
 *   { type:'download:progress', phase, progress, loaded, total }
 *   { type:'ready' }
 *   { type:'info', multipv, depth, score, pvJP, pvUSI, nodes, isMate, mateIn }
 *   { type:'bestmove', move }
 *   { type:'stopped' }
 *   { type:'error', message }
 */
import { getEngineFiles, downloadAndCacheEngine } from './WasmEngineStore.js';

// ── USI 座標テーブル ────────────────────────────────────────────
const FILES_JP  = ['１','２','３','４','５','６','７','８','９'];
const RANKS_JP  = ['一','二','三','四','五','六','七','八','九'];
const PIECE_JP  = {
  P:'歩',L:'香',N:'桂',S:'銀',G:'金',B:'角',R:'飛',K:'玉',
  '+P':'と','+L':'成香','+N':'成桂','+S':'成銀','+B':'馬','+R':'竜',
};
const USI_FILE  = {'1':8,'2':7,'3':6,'4':5,'5':4,'6':3,'7':2,'8':1,'9':0};
const USI_RANK  = {'a':0,'b':1,'c':2,'d':3,'e':4,'f':5,'g':6,'h':7,'i':8};
const USI_TO_PT = {p:'P',l:'L',n:'N',s:'S',g:'G',b:'B',r:'R',k:'K'};

function parseSFEN(sfen) {
  const parts  = sfen.split(' ');
  const player = parts[1] === 'b' ? 1 : 2;
  const board  = Array.from({length:9}, () => Array(9).fill(null));
  let r=0,c=0,prom=false;
  for (const ch of parts[0]) {
    if (ch==='/'){r++;c=0;prom=false;}
    else if(ch==='+'){prom=true;}
    else if(/\d/.test(ch)){c+=+ch;prom=false;}
    else{
      const tp=prom?'+'+USI_TO_PT[ch.toLowerCase()]:USI_TO_PT[ch.toLowerCase()];
      board[r][c]={type:tp,player:ch===ch.toUpperCase()?1:2};
      c++;prom=false;
    }
  }
  return {board,player};
}

function usiToJP(usiMv, board, player) {
  if (!usiMv) return '';
  const mark = player===1?'▲':'△';
  if (usiMv[1]==='*') {
    const pt=usiMv[0].toUpperCase(), r=USI_RANK[usiMv[3]], c=USI_FILE[usiMv[2]];
    return `${mark}${FILES_JP[c]}${RANKS_JP[r]}${PIECE_JP[pt]}打`;
  }
  const fr=USI_RANK[usiMv[1]], fc=USI_FILE[usiMv[0]];
  const tr=USI_RANK[usiMv[3]], tc=USI_FILE[usiMv[2]];
  const prom=usiMv[4]==='+';
  const piece=board?.[fr]?.[fc];
  const name=PIECE_JP[piece?.type]??'?';
  return `${mark}${FILES_JP[tc]}${RANKS_JP[tr]}${name}${prom?'成':''}(${9-fc}${fr+1})`;
}

// ── エンジン制御 ───────────────────────────────────────────────
let innerWorker   = null;
let engineInst    = null;  // instance from YaneuraOu_K_P(Module) — commands sent here
let usiReady      = false;
let currentSfen   = null;
let currentPlayer = 1;
let pendingCmds   = [];
let analysisActive = false;
let isSolvingTsume = false;
let lastTsumePV    = [];   // go mate → bestmove 応答時の PV 復元用

// コマンドをエンジンに送る (instance.postMessage or innerWorker.postMessage)
function sendToEngine(cmd) {
  const trimmed = cmd.trim();
  if (!trimmed) return;
  // instance.postMessage は innerWorker 内部で bridge される
  // (エピローグが self.onmessage を上書きして instance.postMessage に転送)
  if (innerWorker) innerWorker.postMessage(trimmed);
}

function handleUSILine(line) {
  line = line.trim();
  if (!line) return;
  if (line.startsWith('[diag:')) { console.log('[YaneuraOu][DIAG]', line); return; }
  console.log('[YaneuraOu] engine→', line.slice(0, 120));

  if (line.startsWith('[preamble_start]')) return;
  if (line.startsWith('[runtime_ready]')) { console.log('[YaneuraOu] WASM初期化完了'); return; }
  if (line.startsWith('[factory_ready]')) { console.log('[YaneuraOu] factory完了'); return; }
  if (line.startsWith('[factory_error]')) { self.postMessage({ type:'error', message: line }); return; }
  if (line.startsWith('[factory_throw]')) { self.postMessage({ type:'error', message: line }); return; }
  if (line.startsWith('[no_factory]'))    { self.postMessage({ type:'error', message: 'factory未検出' }); return; }
  // [quit] code=0 は main() が戻っただけ — noExitRuntime=true なので engine は生きている
  if (line.startsWith('[quit]'))  { console.log('[YaneuraOu] main()終了 (engine継続)'); return; }
  if (line.startsWith('[abort]')) { self.postMessage({ type:'error', message: 'エンジンAbort: ' + line }); return; }
  if (line.startsWith('[stderr]')) return;
  if (line.startsWith('#')) return;

  if (line === 'usiok') {
    sendToEngine('setoption name USI_Hash value 256');
    sendToEngine('setoption name Threads value 1');
    sendToEngine('isready');
    return;
  }

  if (line === 'readyok') {
    usiReady = true;
    self.postMessage({ type: 'ready' });
    for (const c of pendingCmds) sendToEngine(c);
    pendingCmds = [];
    return;
  }

  if (line.startsWith('info ')) { parseInfoLine(line); return; }

  if (line.startsWith('bestmove ')) {
    const move = line.split(' ')[1] || '(none)';
    analysisActive = false;
    if (isSolvingTsume) {
      // go mate に対してエンジンが checkmate ではなく bestmove を返した場合。
      // parseInfoLine で保存しておいた pv 手順で tsume_result を代替する。
      isSolvingTsume = false;
      const pvMoves = lastTsumePV.length > 0
        ? lastTsumePV
        : (move && move !== '(none)' && move !== 'resign') ? [move] : [];
      lastTsumePV = [];
      if (pvMoves.length > 0) {
        self.postMessage({ type: 'tsume_result', found: true, moves: pvMoves });
      } else {
        self.postMessage({ type: 'tsume_result', found: false });
      }
    } else {
      self.postMessage({ type: 'bestmove', move });
    }
    return;
  }

  if (line.startsWith('checkmate ')) {
    isSolvingTsume = false;
    const rest = line.slice(10).trim();
    if (rest === 'nomate' || rest === 'timeout') {
      self.postMessage({ type: 'tsume_result', found: false });
    } else {
      const moves = rest.split(' ').filter(Boolean);
      self.postMessage({ type: 'tsume_result', found: true, moves });
    }
    return;
  }
}

function parseInfoLine(line) {
  const tokens = line.split(' ');
  const get = (k) => { const i=tokens.indexOf(k); return i!==-1?tokens[i+1]:null; };

  const depthStr = get('depth');
  if (!depthStr) return;
  const depth   = parseInt(depthStr);
  const multipv = parseInt(get('multipv') || '1');
  const nodes   = parseInt(get('nodes')   || '0');

  let score=0, isMate=false, mateIn=null;
  const si = tokens.indexOf('score');
  if (si !== -1) {
    if (tokens[si+1] === 'cp') {
      score = parseInt(tokens[si+2] || '0');
    } else if (tokens[si+1] === 'mate') {
      const m = parseInt(tokens[si+2] || '0');
      isMate  = true;
      mateIn  = Math.abs(m);
      score   = m > 0 ? 9999000 : -9999000;
    }
  }

  const pvIdx = tokens.indexOf('pv');
  const pvUSI = pvIdx !== -1 ? tokens.slice(pvIdx + 1).join(' ') : '';
  const firstUSI = pvIdx !== -1 ? tokens[pvIdx + 1] : '';
  const { board } = currentSfen ? parseSFEN(currentSfen) : { board: null };
  const pvJP  = firstUSI ? usiToJP(firstUSI, board, currentPlayer) : '';

  if (depth > 0) {
    if (isSolvingTsume) {
      if (isMate && mateIn != null) {
        // 全 PV 手順を保存（エンジンが checkmate ではなく bestmove を返した場合の復元用）
        if (pvIdx !== -1) lastTsumePV = tokens.slice(pvIdx + 1).filter(Boolean);
        self.postMessage({ type: 'tsume_progress', mateIn });
      }
    } else {
      self.postMessage({ type:'info', multipv, depth, score, pvJP, pvUSI, nodes, isMate, mateIn });
    }
  }
}

// ── WASM ロード ────────────────────────────────────────────────
function toDataUrl(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:application/javascript;base64,' + btoa(bin);
}

async function loadEngine(variant) {
  if (innerWorker) { innerWorker.terminate(); innerWorker=null; engineInst=null; usiReady=false; pendingCmds=[]; }

  console.log(`[YaneuraOu] loadEngine(${variant}) 開始`);

  let files = await getEngineFiles(variant);
  console.log(`[YaneuraOu] キャッシュ確認: ${files ? 'ヒット' : 'ミス'}`);
  if (!files) {
    self.postMessage({ type:'download:progress', phase:'start', progress:0 });
    files = await downloadAndCacheEngine(variant, (prog) => {
      self.postMessage({ type:'download:progress', ...prog });
    });
    console.log(`[YaneuraOu] ダウンロード完了`);
  }

  const { js, wasm, evalFiles, workerFiles } = files;
  console.log(`[YaneuraOu] js=${js?.length}B, wasm=${wasm?.length}B, evalFiles=${Object.keys(evalFiles||{})}, workerFiles=${Object.keys(workerFiles||{})}`);

  // ── Blob URL 生成 ──────────────────────────────────────────
  const wasmUrl = URL.createObjectURL(new Blob([wasm], { type:'application/wasm' }));
  const evalUrls = {};
  for (const [fname, fdata] of Object.entries(evalFiles || {})) {
    evalUrls[fname] = URL.createObjectURL(new Blob([fdata]));
  }

  // pthreads worker JS に SAB パッチを注入
  const workerUrls = {};
  const sabPatch = `
(function(){
  var _oc = URL.createObjectURL.bind(URL);
  var _noop = null;
  function noopUrl(){ if(!_noop) _noop=_oc(new Blob([''],{type:'application/javascript'})); return _noop; }
  URL.createObjectURL = function(obj){
    if(obj==null) return noopUrl();
    try{ return _oc(obj); }catch(_){}
    if(obj!=null && ArrayBuffer.isView(obj)){
      try{
        var dst=new ArrayBuffer(obj.byteLength);
        new Uint8Array(dst).set(new Uint8Array(obj.buffer,obj.byteOffset||0,obj.byteLength));
        return _oc(new Blob([dst]));
      }catch(_){}
    }
    try{ if(typeof obj.slice==='function') return _oc(new Blob([obj.slice(0)])); }catch(_){}
    return noopUrl();
  };
})();`;
  for (const [fname, fdata] of Object.entries(workerFiles || {})) {
    const patched = sabPatch + '\n' + new TextDecoder().decode(fdata);
    workerUrls[fname] = URL.createObjectURL(new Blob([patched], { type:'application/javascript' }));
  }

  // ── engine JS の準備 ──────────────────────────────────────
  let jsText = new TextDecoder().decode(js);

  const factoryMatch = jsText.match(/var\s+(\w+)\s*=\s*\(\s*\(\s*\)\s*=>/);
  const factoryName  = factoryMatch?.[1] ?? null;
  console.log('[YaneuraOu] factory名:', factoryName);

  jsText = jsText.replace(/"[^"]*\.wasm"/g, JSON.stringify(wasmUrl));
  jsText = jsText.replace(/'[^']*\.wasm'/g, JSON.stringify(wasmUrl));

  const evalUrlsJson   = JSON.stringify(evalUrls);
  const workerUrlsJson = JSON.stringify(workerUrls);

  // ── 共通プリアンブル (メイン・pthreads 両コンテキストで使う) ──
  // pthreads worker がこの JS を importScripts した時は ENVIRONMENT_IS_PTHREAD=true になる
  const commonPreamble = `
var _IS_PTHREAD=(typeof ENVIRONMENT_IS_PTHREAD!=='undefined'&&!!ENVIRONMENT_IS_PTHREAD);
var _wasmUrl=${JSON.stringify(wasmUrl)};
var _evalUrls=${evalUrlsJson};
var _workerUrls=${workerUrlsJson};
${sabPatch}
if(!_IS_PTHREAD){
  URL.revokeObjectURL=function(){};
  (function(){
    var _OW=self.Worker;
    self.Worker=function(url,opts){
      var base=(typeof url==='string')?url.split('/').pop().split('?')[0]:'';
      if(_workerUrls[base]) return new _OW(_workerUrls[base],opts);
      if(typeof url==='string'&&!url.startsWith('blob:')&&!url.startsWith('http')&&!url.startsWith('/'))
        return new _OW(self.location.origin+'/'+url,opts);
      return new _OW(url,opts);
    };
  })();
}
`;

  // ── エピローグ: factory 呼び出し + I/O ブリッジ ──────────────
  // pthreads context では SKIP (pthreads worker.js 側が factory を呼ぶ)
  // メイン context: instance.postMessage でコマンド送信、addMessageListener で出力受信
  const epilogue = factoryName ? `
;(function(){
  if(_IS_PTHREAD) return;
  var _fn=(typeof ${factoryName}==='function')?${factoryName}:null;
  if(!_fn){ self.postMessage('[no_factory]'); return; }
  _fn(self.Module).then(function(inst){
    // ── 出力チャネル ──────────────────────────────────────────────
    // factory が Module.print を上書きする場合があるため必ず再インストール
    self.Module.print    = function(line){ self.postMessage(line); };
    self.Module.printErr = function(line){ self.postMessage('[stderr] '+line); };

    // usumerican API: addMessageListener が存在する場合は追加で登録
    if(typeof inst.addMessageListener==='function'){
      self.postMessage('[diag:addMsgListener] 登録');
      inst.addMessageListener(function(line){
        // 最初の数行だけ診断ログ (出力チャネルが生きているか確認)
        if(typeof line==='string' && line.length<200)
          self.postMessage('[diag:listener] '+line.slice(0,100));
        self.postMessage(line);
      });
    } else {
      self.postMessage('[diag:addMsgListener] なし (stdout のみ)');
    }

    // ── 入力チャネル ──────────────────────────────────────────────
    // ── 入力チャネル選択 ──────────────────────────────────────────
    // usumerican API: inst.postMessage + inst.addMessageListener が両方ある場合は
    // inst.postMessage が USI 入力路 (ccall は pthreads 競合で r=1 になることがある)
    // 通常 pthreads ビルド: ccall('usi_command') を使う
    var _useInstPost = (typeof inst.postMessage==='function' &&
                        typeof inst.addMessageListener==='function');
    self.postMessage('[diag:input_path] useInstPost='+_useInstPost
      +' ccall='+typeof inst.ccall
      +' _usi_command='+typeof inst._usi_command);
    var _q=[], _interval=1, _flushN=0;
    function _flush(){
      var cmd=_q[0];
      if(!cmd) return;
      var r=1;
      _flushN++;
      if(_useInstPost){
        try{ inst.postMessage(cmd); r=0; }catch(e){
          self.postMessage('[diag:instPost_err] '+e.message);
        }
      } else {
        try{ r=inst.ccall('usi_command','number',['string'],[cmd]); }catch(e){
          self.postMessage('[diag:ccall_err] '+e.message);
        }
        if(_flushN<=5) self.postMessage('[diag:ccall_r] n='+_flushN+' r='+r+' cmd='+cmd);
      }
      if(r===0){
        _q.shift();
        _interval=1;
        if(_q.length) setTimeout(_flush,0);
      } else {
        _interval=Math.min(_interval*2,500);
        setTimeout(_flush,_interval);
      }
    }
    // pthreads の self.onmessage (スレッド間 IPC) を上書きせずラップする。
    // 上書きすると pthreads のスレッド同期が壊れてエンジンが応答しなくなる。
    var _prevOnMsg=typeof self.onmessage==='function'?self.onmessage:null;
    self.onmessage=function(e){
      var cmd=typeof e.data==='string'?e.data.trim():null;
      if(cmd){ _q.push(cmd); if(_q.length===1) setTimeout(_flush,0); }
      else if(_prevOnMsg) _prevOnMsg.call(self,e);
    };
    self.postMessage('[factory_ready]');
  }).catch(function(e){
    self.postMessage('[factory_error] '+(e&&e.message||String(e)));
  });
})();
` : `if(!_IS_PTHREAD) self.postMessage('[factory_not_detected]');`;

// ── 2パス生成 ───────────────────────────────────────────────

  // Pass 1: pthreads 専用スクリプト
  // ★ ENVIRONMENT_IS_PTHREAD=true を「明示的に上書き」し、
  //   epilogue/mainModuleSetup を含めないことで pthreadsコンテキストの誤動作を防ぐ
  const pthreadsPreamble = `
var ENVIRONMENT_IS_PTHREAD = true; // pthreadsコンテキストを明示 (検出ミスを防ぐ上書き)
var _IS_PTHREAD = true;
var _wasmUrl=${JSON.stringify(wasmUrl)};
var _evalUrls=${evalUrlsJson};
var _workerUrls=${workerUrlsJson};
${sabPatch}
`;
  const patchedJsForPthreads = pthreadsPreamble + '\n' + jsText;
  // ★ data: URL → Blob URL に変更 (ネストworkerでのimportScripts制限を回避)
  const pthreadsBlobUrl = URL.createObjectURL(
    new Blob([patchedJsForPthreads], { type: 'application/javascript' })
  );

  // Pass 2: 実際のメイン worker 用 JS (mainScriptUrlOrBlob に pass1 の Blob URL を埋め込む)
  const mainModuleSetup = `
if(!_IS_PTHREAD){
  self.postMessage('[preamble_start]');
  (function(){
    var _orig=(typeof Module!=='undefined'&&Module)||{};
    self.Module=Object.assign({},_orig,{
      mainScriptUrlOrBlob:${JSON.stringify(pthreadsBlobUrl)}, // ★ Blob URL に変更
      locateFile:function(p,prefix){
        if(p.endsWith('.wasm')) return _wasmUrl;
        for(var k in _evalUrls){ if(p===k||p.endsWith('/'+k)) return _evalUrls[k]; }
        return (prefix||'')+p;
      },
      print:   function(line){ self.postMessage(line); },
      printErr:function(line){ self.postMessage('[stderr] '+line); },
      onRuntimeInitialized:function(){ self.postMessage('[runtime_ready]'); },
      onAbort:function(r){ self.postMessage('[abort] '+JSON.stringify(r)); },
      quit:function(code,e){ self.postMessage('[quit] code='+code+' '+(e?e.message:'')); },
      noExitRuntime:true,
    });
  })();
}
`;

  const patchedJs = commonPreamble + mainModuleSetup + '\n' + jsText + '\n' + epilogue;
  const jsBlobUrl = URL.createObjectURL(new Blob([patchedJs], { type:'application/javascript' }));

  console.log(`[YaneuraOu] サブワーカー起動 (blob URL: ${jsBlobUrl.slice(0,40)}...)`);

  try {
    innerWorker = new Worker(jsBlobUrl);
  } catch (e) {
    URL.revokeObjectURL(jsBlobUrl);
    throw new Error(`サブワーカー作成失敗: ${e.message}`);
  }
  // jsBlobUrl は revoke しない — pthreads が参照する可能性があるため長命保持

  innerWorker.onmessage = (e) => {
    const raw = e.data;
    if (typeof raw === 'string') {
      handleUSILine(raw);
    } else if (raw && typeof raw === 'object') {
      if (typeof raw.data === 'string') raw.data.split('\n').forEach(l => l && handleUSILine(l));
      else if (typeof raw.text === 'string') raw.text.split('\n').forEach(l => l && handleUSILine(l));
    }
  };
  innerWorker.onerror = (e) => {
    console.error('[YaneuraOu] サブワーカー内部エラー:', e);
    self.postMessage({ type:'error', message: `エンジン内部エラー: ${e.message || e}` });
  };

  console.log(`[YaneuraOu] サブワーカー起動完了`);

  // usi を送る (factory_ready 後に instance.postMessage に転送される)
  setTimeout(() => {
    console.log('[YaneuraOu] usi 送信');
    sendToEngine('usi');
  }, 500);
}

// ── メッセージ受信 ─────────────────────────────────────────────
self.onmessage = async ({ data }) => {
  const { cmd } = data;

  if (cmd === 'load') {
    try {
      await loadEngine(data.variant || 'suishopetite');
    } catch (e) {
      console.error('[YaneuraOu] loadEngine エラー:', e);
      self.postMessage({ type:'error', message: String(e.message || e) });
    }
    return;
  }

  if (!innerWorker || !usiReady) return;

  if (cmd === 'start_analysis' || cmd === 'analyze') {
    if (!data.sfen) return;
    currentSfen    = data.sfen;
    currentPlayer  = parseSFEN(data.sfen).player;
    const mpv = data.multiPV || 1;
    const tl  = data.timeLimit || 3000;
    // 思考中のときだけ stop を送る（アイドル時に stop を送ると bestmove (none) が
    // 返ってきてリスナーが誤解析結果を受け取るバグを防ぐ）
    if (analysisActive) sendToEngine('stop');
    analysisActive = true;
    sendToEngine(`setoption name MultiPV value ${mpv}`);
    sendToEngine(`position sfen ${data.sfen}`);
    sendToEngine(`go movetime ${tl}`);
    return;
  }

  if (cmd === 'stop') {
    sendToEngine('stop');
    analysisActive = false;
    self.postMessage({ type:'stopped' });
    return;
  }

  if (cmd === 'ai_think') {
    if (!data.sfen) return;
    currentSfen    = data.sfen;
    currentPlayer  = parseSFEN(data.sfen).player;
    const tl = data.timeLimit || 2000;
    sendToEngine('stop');
    sendToEngine('setoption name MultiPV value 1');
    sendToEngine(`position sfen ${data.sfen}`);
    sendToEngine(`go movetime ${tl}`);
    return;
  }

  if (cmd === 'solve_tsume') {
    if (!data.sfen) return;
    isSolvingTsume = true;
    lastTsumePV   = [];   // 前回の残骸をクリア
    currentSfen   = data.sfen;
    currentPlayer = parseSFEN(data.sfen).player;
    const tl = data.timeLimit || 'infinite';
    sendToEngine('stop');
    sendToEngine('setoption name MultiPV value 1');
    sendToEngine(`position sfen ${data.sfen}`);
    sendToEngine(`go mate ${tl}`);
    return;
  }
};