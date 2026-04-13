/**
 * BrowserEngineAdapter.js
 * ブラウザエンジン (Alpha-Beta / YaneuraOu WASM) を
 * socket.io と同じインターフェースで使えるラッパー。
 */
import { isEngineReady, clearEngineCache, getEngineCacheSize } from './WasmEngineStore.js';
import ABWorkerClass    from './BrowserEngine.worker.js?worker';
import WasmWorkerClass  from './YaneuraOu.worker.js?worker';

export const BROWSER_AGENT_ID   = '__browser_engine__';
export const BROWSER_AGENT_INFO = {
  agentId:    BROWSER_AGENT_ID,
  name:       'ブラウザエンジン',
  engineName: 'Built-in (Browser)',
};

// エンジン種別
const ENGINE_TYPES = {
  ALPHA_BETA:    'Alpha-Beta (軽量)',
  SUISHO_PETITE: 'SuishoPetite (NNUE)※iOS非対応',
  SUISHO5:       'Suisho5 (強力NNUE)※iOS非対応',
};
const VARIANT_OF = {
  [ENGINE_TYPES.SUISHO_PETITE]: 'suishopetite',
  [ENGINE_TYPES.SUISHO5]:       'suisho5',
};

function makeBrowserEngineOptions(multiPV, engineType, suisho5Ready, petiteReady, suisho5CacheBytes) {
  const opts = [
    {
      name:    'MultiPV',
      type:    'spin',
      default: 1, min: 1, max: 5,
      value:   multiPV,
    },
    {
      name:    'エンジン',
      type:    'combo',
      vars:    Object.values(ENGINE_TYPES),
      default: ENGINE_TYPES.SUISHO_PETITE,
      value:   engineType,
    },
  ];

  // Suisho5 が未ダウンロードならボタンを追加
  if (engineType === ENGINE_TYPES.SUISHO5 && !suisho5Ready) {
    opts.push({
      name:    'Suisho5 をダウンロード (~100MB)',
      type:    'button',
      default: '',
      value:   '',
    });
  }
  // Suisho5 キャッシュ削除
  if (engineType === ENGINE_TYPES.SUISHO5 && suisho5Ready) {
    const sizeLabel = suisho5CacheBytes > 0
      ? ` (${(suisho5CacheBytes / 1024 / 1024).toFixed(0)}MB)`
      : '';
    opts.push({
      name:    `Suisho5 キャッシュを削除${sizeLabel}`,
      type:    'button',
      default: '',
      value:   '',
    });
  }

  // メタ情報をプロパティとして付与（UIがダウンロード状態を判断するため）
  opts.suisho5Ready = suisho5Ready;

  return opts;
}

export function createBrowserEngineAdapter() {
  // ── 状態 ────────────────────────────────────────────────────
  let abWorker   = null;   // alpha-beta worker
  let wasmWorker = null;   // YaneuraOu WASM worker
  let multiPV    = 1;
  let engineType = ENGINE_TYPES.SUISHO_PETITE;
  let analyzing  = false;
  let aiMode     = false;
  let autoAbort  = false;
  let isAutoAnalyzing = false;  // 自動解析中フラグ（engine:info を抑制するため）
  let suisho5Ready   = false;
  let petiteReady    = false;
  let wasmEngineReady = false;  // WASM worker が readyok を受け取った
  let suisho5CacheBytes = 0;    // Suisho5 キャッシュの合計バイト数

  const listeners = {};
  let lastInfoByMpv = {};

  function fire(event, data) {
    (listeners[event] || []).forEach(cb => cb(data));
  }

  function isWasmMode() {
    return engineType !== ENGINE_TYPES.ALPHA_BETA;
  }

  function fireOptions() {
    fire('engine:options', makeBrowserEngineOptions(multiPV, engineType, suisho5Ready, petiteReady, suisho5CacheBytes));
  }

  // ── Alpha-Beta Worker ─────────────────────────────────────
  function startABWorker() {
    if (abWorker) { abWorker.terminate(); abWorker = null; }
    try {
      abWorker = new ABWorkerClass();
    } catch (e) {
      console.error('[BrowserEngine] ABワーカー作成失敗:', e);
      return;
    }
    abWorker.onmessage = ({ data: d }) => {
      if (d.type === 'info') {
        lastInfoByMpv[d.multipv] = d;
        if (!isAutoAnalyzing) fire('engine:info', d);
      } else if (d.type === 'bestmove') {
        if (aiMode) {
          aiMode = false;
          fire('ai:bestmove', { move: d.move });
          fire('engine:status', { status: 'standby', message: '' });
        } else if (analyzing) {
          // 解析完了 → standby に戻す
          analyzing = false;
          fire('engine:status', { status: 'standby', message: '' });
        }
      } else if (d.type === 'stopped') {
        analyzing = false;
        fire('engine:status', { status: 'standby', message: '' });
      }
    };
    abWorker.onerror = (e) => {
      console.error('[BrowserEngine] ABワーカーエラー:', e);
      fire('engine:status', { status: 'error', message: 'エンジンエラー: ' + e.message });
    };
  }

  // ── YaneuraOu WASM Worker ─────────────────────────────────
  function startWasmWorker(variant) {
    if (wasmWorker) { wasmWorker.terminate(); wasmWorker = null; }
    wasmEngineReady = false;

    try {
      wasmWorker = new WasmWorkerClass();
    } catch (e) {
      console.error('[BrowserEngine] WASMワーカー作成失敗:', e);
      engineType = ENGINE_TYPES.ALPHA_BETA;
      fireOptions();
      fire('engine:status', { status: 'standby', message: '' });
      return;
    }

    wasmWorker.onmessage = ({ data: d }) => {
      if (d.type === 'download:progress') {
        const cfg  = { suishopetite: { label: 'SuishoPetite', mb: 2.4 }, suisho5: { label: 'Suisho5', mb: 104 } };
        const info = cfg[variant] || { label: variant, mb: 0 };
        let msg = '';
        if (d.phase === 'download') {
          const loaded = d.loaded ? `${(d.loaded/1024/1024).toFixed(1)}MB` : '';
          const total  = d.total  ? `/${(d.total/1024/1024).toFixed(0)}MB` : `/${info.mb}MB`;
          msg = `${info.label} ダウンロード中… ${loaded}${total}`;
        } else if (d.phase === 'extract') {
          msg = `${info.label} 解凍中…`;
        } else if (d.phase === 'cache') {
          msg = `${info.label} キャッシュ中…`;
        }
        fire('engine:status', { status: 'connecting', message: msg });
        return;
      }

      if (d.type === 'ready') {
        wasmEngineReady = true;
        if (variant === 'suishopetite') petiteReady = true;
        if (variant === 'suisho5') {
          suisho5Ready = true;
          // キャッシュサイズを取得してoptionsに反映
          getEngineCacheSize('suisho5').then(bytes => { suisho5CacheBytes = bytes; fireOptions(); });
        }
        fireOptions();
        fire('engine:status', { status: 'standby', message: '' });
        return;
      }

      if (d.type === 'info') {
        lastInfoByMpv[d.multipv] = d;
        if (!isAutoAnalyzing) fire('engine:info', d);
        return;
      }

      if (d.type === 'bestmove') {
        if (aiMode) {
          aiMode = false;
          fire('ai:bestmove', { move: d.move });
          fire('engine:status', { status: 'standby', message: '' });
        } else if (analyzing) {
          // 通常解析の go movetime 完了
          analyzing = false;
          fire('engine:status', { status: 'standby', message: '' });
        }
        return;
      }

      if (d.type === 'stopped') {
        fire('engine:status', { status: 'standby', message: '' });
        return;
      }

      if (d.type === 'tsume_progress') {
        fire('tsume:progress', { mateIn: d.mateIn });
        return;
      }

      if (d.type === 'tsume_result') {
        if (d.found) {
          fire('tsume:solution', { moves: d.moves });
        } else {
          fire('tsume:failed', {});
        }
        fire('engine:status', { status: 'standby', message: '' });
        return;
      }

      if (d.type === 'error') {
        // WASMエラー時はAlpha-Betaにフォールバック
        wasmEngineReady = false;
        engineType = ENGINE_TYPES.ALPHA_BETA;
        if (wasmWorker) { wasmWorker.terminate(); wasmWorker = null; }
        fireOptions();
        fire('engine:status', { status: 'error', message: `${d.message} (Alpha-Betaで継続)` });
        setTimeout(() => fire('engine:status', { status: 'standby', message: '' }), 3000);
        return;
      }
    };

    wasmWorker.onerror = (e) => {
      // WASMワーカークラッシュ時もAlpha-Betaにフォールバック
      wasmEngineReady = false;
      engineType = ENGINE_TYPES.ALPHA_BETA;
      if (wasmWorker) { wasmWorker.terminate(); wasmWorker = null; }
      fireOptions();
      fire('engine:status', { status: 'error', message: `WASMエラー: ${e.message} (Alpha-Betaで継続)` });
      setTimeout(() => fire('engine:status', { status: 'standby', message: '' }), 3000);
    };

    wasmWorker.postMessage({ cmd: 'load', variant });
  }

  // ── 自動解析 (Alpha-Beta のみ) ────────────────────────────
  async function runAutoAnalysis(positions, condition) {
    autoAbort = false;
    isAutoAnalyzing = true;
    const timePerPos = condition?.type === 'movetime' ? (condition.value || 3000) : 2000;
    fire('engine:status', { status: 'thinking', message: '自動解析中…' });

    for (let i = 0; i < positions.length; i++) {
      if (autoAbort) break;
      const pos = positions[i];
      lastInfoByMpv = {};

      const worker = isWasmMode() ? wasmWorker : abWorker;
      if (!worker) break;

      await new Promise(resolve => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          worker.removeEventListener('message', onMsg);
          resolve();
        };

        // タイムアウト時もリスナーを確実に削除する
        const timer = setTimeout(finish, timePerPos + 2000);

        const onMsg = ({ data: d }) => {
          if (done) return;
          if (d.type === 'info') {
            lastInfoByMpv[d.multipv] = d;
          } else if (d.type === 'bestmove') {
            // アイドル時の stop に対して YaneuraOu が返す bestmove (none) は無視する
            // （spurious response: 実際の解析結果ではない）
            if (d.move === '(none)') return;
            const best = lastInfoByMpv[1];
            const evalScore = pos.player === 1 ? (best?.score ?? 0) : -(best?.score ?? 0);
            // 候補手スコアも先手視点に正規化（isAbsolute:true と整合させる）
            const candidates = Object.values(lastInfoByMpv)
              .sort((a,b) => a.multipv - b.multipv)
              .map(c => ({
                multipv: c.multipv,
                score:   pos.player === 1 ? c.score : -c.score,
                pvJP:    c.pvJP,
                pvUSI:   c.pvUSI,
                depth:   c.depth,
                nodes:   c.nodes,
                isAbsolute: true,
              }));
            fire('auto_analysis:result', { moveIndex:pos.moveIndex, evalScore, candidates });
            fire('auto_analysis:progress', { current:i+1, total:positions.length, depth:best?.depth??0 });
            finish();
          }
        };
        worker.addEventListener('message', onMsg);

        if (isWasmMode()) {
          worker.postMessage({ cmd:'start_analysis', sfen:pos.sfen, multiPV, timeLimit:timePerPos });
        } else {
          worker.postMessage({ cmd:'start_analysis', sfen:pos.sfen, multiPV, timeLimit:timePerPos, maxDepth:6 });
        }
      });
    }

    isAutoAnalyzing = false;
    if (!autoAbort) {
      fire('auto_analysis:complete', { total: positions.length });
    }
    fire('engine:status', { status: 'standby', message: '' });
  }

  // ── 初期化 ────────────────────────────────────────────────
  function init() {
    startABWorker();
    // WASM エンジンのキャッシュ状態を非同期で確認
    Promise.all([
      isEngineReady('suishopetite'),
      isEngineReady('suisho5'),
      getEngineCacheSize('suisho5'),
    ]).then(([petite, s5, s5bytes]) => {
      petiteReady  = petite;
      suisho5Ready = s5;
      suisho5CacheBytes = s5bytes;
      if (engineType === ENGINE_TYPES.SUISHO_PETITE && petite) {
        // キャッシュ済みなら即起動
        fire('engine:status', { status: 'connecting', message: 'SuishoPetite 読み込み中…' });
        startWasmWorker('suishopetite');
      } else {
        // 未ダウンロード or Alpha-Beta → Alpha-Beta で standby
        if (engineType !== ENGINE_TYPES.ALPHA_BETA) {
          engineType = ENGINE_TYPES.ALPHA_BETA;
        }
        setTimeout(() => {
          fireOptions();
          fire('engine:status', { status: 'standby', message: '' });
        }, 100);
      }
    }).catch(() => {
      engineType = ENGINE_TYPES.ALPHA_BETA;
      setTimeout(() => {
        fireOptions();
        fire('engine:status', { status: 'standby', message: '' });
      }, 100);
    });
  }

  // ── socket.io 互換インターフェース ─────────────────────────
  const adapter = {
    emit(event, data) {
      switch (event) {

        case 'start_analysis':
          if (!data?.sfen) break;
          analyzing = true; aiMode = false;
          lastInfoByMpv = {};
          if (isWasmMode() && wasmEngineReady) {
            wasmWorker?.postMessage({ cmd:'start_analysis', sfen:data.sfen, multiPV, timeLimit:5000 });
          } else {
            if (!abWorker) { console.warn('[BrowserEngine] abWorker null → 再作成'); startABWorker(); }
            if (!abWorker) { console.error('[BrowserEngine] abWorker 再作成失敗'); break; }
            abWorker.postMessage({ cmd:'start_analysis', sfen:data.sfen, multiPV, timeLimit:5000, maxDepth:8 });
          }
          fire('engine:status', { status:'thinking', message:'解析中…' });
          break;

        case 'analyze':
          if (!data?.sfen) break;
          analyzing = true; aiMode = false;
          lastInfoByMpv = {};
          if (isWasmMode() && wasmEngineReady) {
            wasmWorker?.postMessage({ cmd:'analyze', sfen:data.sfen, multiPV, timeLimit:5000 });
          } else {
            if (!abWorker) break;
            abWorker.postMessage({ cmd:'stop' });
            setTimeout(() => {
              if (abWorker) abWorker.postMessage({ cmd:'start_analysis', sfen:data.sfen, multiPV, timeLimit:5000, maxDepth:8 });
            }, 30);
          }
          fire('engine:status', { status:'thinking', message:'解析中…' });
          break;

        case 'stop_and_standby':
          analyzing = false; aiMode = false; autoAbort = true;
          if (isWasmMode()) wasmWorker?.postMessage({ cmd:'stop' });
          else abWorker?.postMessage({ cmd:'stop' });
          fire('engine:status', { status:'standby', message:'' });
          break;

        case 'restart_engine':
          analyzing = false; aiMode = false;
          if (isWasmMode()) wasmWorker?.postMessage({ cmd:'stop' });
          else abWorker?.postMessage({ cmd:'stop' });
          fire('engine:status', { status:'standby', message:'' });
          break;

        case 'stop':
        case 'stop_ai_think':
          aiMode = false;
          if (isWasmMode()) wasmWorker?.postMessage({ cmd:'stop' });
          else abWorker?.postMessage({ cmd:'stop' });
          break;

        case 'stop_auto_analysis':
          autoAbort = true;
          isAutoAnalyzing = false;
          if (isWasmMode()) wasmWorker?.postMessage({ cmd:'stop' });
          else abWorker?.postMessage({ cmd:'stop' });
          fire('auto_analysis:stopped', { stoppedAt:0 });
          fire('engine:status', { status:'standby', message:'' });
          break;

        case 'ai_think': {
          if (!data?.sfen) break;
          aiMode = true; analyzing = false;
          const rem = data.remainingTimes;
          const tl  = rem
            ? Math.min(2000, Math.max(300, (rem[2]||rem[1]||2000) * 0.05))
            : 2000;
          if (isWasmMode() && wasmEngineReady) {
            wasmWorker?.postMessage({ cmd:'ai_think', sfen:data.sfen, timeLimit:tl });
          } else {
            if (!abWorker) { console.warn('[BrowserEngine] ai_think: abWorker null → 再作成'); startABWorker(); }
            if (!abWorker) { console.error('[BrowserEngine] ai_think: abWorker 再作成失敗'); aiMode = false; break; }
            abWorker.postMessage({ cmd:'ai_think', sfen:data.sfen, multiPV:1, timeLimit:tl, maxDepth:6 });
          }
          fire('engine:status', { status:'thinking', message:'AI思考中…' });
          break;
        }

        case 'set_options': {
          if (!Array.isArray(data)) break;
          let changed = false;

          for (const opt of data) {
            // MultiPV
            if (opt.name === 'MultiPV' && opt.value) {
              multiPV = parseInt(opt.value) || 1;
              changed = true;
            }

            // エンジン種別変更
            if (opt.name === 'エンジン' && opt.value && opt.value !== engineType) {
              engineType = opt.value;
              changed = true;
              wasmEngineReady = false;
              analyzing = false; aiMode = false;

              if (engineType === ENGINE_TYPES.ALPHA_BETA) {
                // Alpha-Beta に切り替え
                if (wasmWorker) { wasmWorker.terminate(); wasmWorker = null; }
                fire('engine:status', { status:'standby', message:'' });
              } else {
                // WASM エンジンに切り替え
                const variant = VARIANT_OF[engineType];
                isEngineReady(variant).then(ready => {
                  if (engineType === ENGINE_TYPES.SUISHO5 && !ready) {
                    // Suisho5 はダウンロードが必要 → まだ起動しない
                    fire('engine:status', { status:'standby', message:'Suisho5 は「ダウンロード」ボタンで取得してください' });
                    fireOptions();
                  } else {
                    fire('engine:status', { status:'connecting', message:`${engineType} 読み込み中…` });
                    startWasmWorker(variant);
                  }
                });
              }
            }

            // Suisho5 ダウンロードボタン (EngineSettingsDialog は button クリック時に value:'' を送る)
            if (opt.name === 'Suisho5 をダウンロード (~100MB)') {
              const variant = 'suisho5';
              fire('engine:status', { status:'connecting', message:'Suisho5 ダウンロード開始…' });
              engineType = ENGINE_TYPES.SUISHO5;
              startWasmWorker(variant);
              changed = true;
            }

            // Suisho5 キャッシュ削除ボタン（名前にサイズが付く場合もあるのでstartsWith）
            if (opt.name.startsWith('Suisho5 キャッシュを削除')) {
              clearEngineCache('suisho5').then(() => {
                suisho5Ready = false;
                suisho5CacheBytes = 0;
                engineType   = ENGINE_TYPES.SUISHO_PETITE;
                const pVariant = VARIANT_OF[ENGINE_TYPES.SUISHO_PETITE];
                startWasmWorker(pVariant);
                fireOptions();
              });
              changed = true;
            }
          }

          if (changed) fireOptions();
          break;
        }

        case 'solve_tsume':
          if (!data?.sfen) break;
          if (isWasmMode() && wasmEngineReady) {
            wasmWorker?.postMessage({ cmd: 'solve_tsume', sfen: data.sfen, timeLimit: data.timeLimit || 'infinite' });
            fire('engine:status', { status: 'thinking', message: '詰将棋解析中…' });
          } else {
            // Alpha-Beta エンジンは go mate 非対応 → 失敗扱い
            fire('tsume:failed', {});
          }
          break;

        case 'start_auto_analysis':
          if (data?.positions?.length) runAutoAnalysis(data.positions, data.condition);
          break;

        case '__select_agent':
        case '__take_over':
          setTimeout(() => {
            // 常に現在の options を再送
            fireOptions();
            if (wasmEngineReady || !isWasmMode()) {
              // 起動済みまたは Alpha-Beta → 即 standby
              fire('engine:status', { status:'standby', message:'' });
            }
            // WASM がまだ起動中 (ダウンロード等) なら ready イベントで standby が届く
            // App.jsx が既に standby にセットしているので何もしなくてよい
          }, 50);
          break;

        default:
          break;
      }
    },

    on(event, cb) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },

    disconnect() {
      abWorker?.terminate();   abWorker   = null;
      wasmWorker?.terminate(); wasmWorker = null;
      analyzing = false; aiMode = false;
    },

    get connected() { return abWorker !== null || wasmWorker !== null; },
  };

  init();
  return adapter;
}