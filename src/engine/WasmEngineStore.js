/**
 * WasmEngineStore.js
 * YaneuraOu WASM エンジンファイルのダウンロード・抽出・Cache API 管理
 */
import { unzip } from 'fflate';

const CACHE_NAME    = 'shogi-yaneuraou-v1';
const CACHE_VERSION = 11; // Module.print restored + ccall fallback v11

export const WASM_VARIANTS = {
  suishopetite: {
    label:  'SuishoPetite',
    zipUrl: '/api/engine/download/suishopetite',
    sizeMB: 2.4,
  },
  suisho5: {
    label:  'Suisho5',
    zipUrl: '/api/engine/download/suisho5',
    sizeMB: 104,
  },
};

// Cache API キー: URL 形式でなければならない
function cacheKey(variant, type, name) {
  if (type === 'eval')   return `/wasm-cache/${variant}/eval/${name}`;
  if (type === 'worker') return `/wasm-cache/${variant}/worker/${name}`;
  return `/wasm-cache/${variant}/${type}`;
}

async function openCache() {
  return caches.open(CACHE_NAME);
}

/** キャッシュに JS + WASM が揃っているか確認 */
export async function isEngineReady(variant) {
  try {
    const c = await openCache();
    const [js, wasm] = await Promise.all([
      c.match(cacheKey(variant, 'js')),
      c.match(cacheKey(variant, 'wasm')),
    ]);
    return !!(js && wasm);
  } catch {
    return false;
  }
}

/** キャッシュからファイルを取得 */
export async function getEngineFiles(variant) {
  const c = await openCache();
  const [jsRes, wasmRes] = await Promise.all([
    c.match(cacheKey(variant, 'js')),
    c.match(cacheKey(variant, 'wasm')),
  ]);
  if (!jsRes || !wasmRes) return null;

  const [js, wasm] = await Promise.all([
    jsRes.arrayBuffer().then(b => new Uint8Array(b)),
    wasmRes.arrayBuffer().then(b => new Uint8Array(b)),
  ]);

  // eval / worker ファイル一覧を復元（バージョン不一致なら無効扱い）
  const manifestRes = await c.match(cacheKey(variant, 'manifest'));
  const manifest    = manifestRes ? await manifestRes.json() : { evalFiles: [], workerFiles: [] };
  if ((manifest.cacheVersion ?? 0) < CACHE_VERSION) return null;
  const evalFiles   = {};
  for (const fname of manifest.evalFiles || []) {
    const er = await c.match(cacheKey(variant, 'eval', fname));
    if (er) evalFiles[fname] = new Uint8Array(await er.arrayBuffer());
  }
  const workerFiles = {};
  for (const fname of manifest.workerFiles || []) {
    const wr = await c.match(cacheKey(variant, 'worker', fname));
    if (wr) workerFiles[fname] = new Uint8Array(await wr.arrayBuffer());
  }

  return { js, wasm, evalFiles, workerFiles };
}

/** ZIPをダウンロードして解凍、Cache API に保存 */
export async function downloadAndCacheEngine(variant, onProgress) {
  const cfg = WASM_VARIANTS[variant];
  if (!cfg) throw new Error(`Unknown variant: ${variant}`);

  // ── ダウンロード ────────────────────────────────────────────
  const resp = await fetch(cfg.zipUrl);
  if (!resp.ok) throw new Error(`ダウンロード失敗: HTTP ${resp.status}`);

  const total  = parseInt(resp.headers.get('content-length') || '0', 10);
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({
      phase:    'download',
      progress: total ? loaded / total * 0.8 : 0,
      loaded,
      total,
    });
  }

  // チャンクを連結
  const zipBuf = new Uint8Array(loaded);
  let off = 0;
  for (const ch of chunks) { zipBuf.set(ch, off); off += ch.length; }

  onProgress?.({ phase: 'extract', progress: 0.85 });

  // ── ZIP 解凍 ───────────────────────────────────────────────
  const files = await new Promise((res, rej) =>
    unzip(zipBuf, (err, data) => err ? rej(err) : res(data))
  );

  onProgress?.({ phase: 'cache', progress: 0.92 });

  // ── ファイル分類 ──────────────────────────────────────────
  let jsData = null, wasmData = null;
  const evalFiles   = {};
  const workerFiles = {};

  for (const [path, data] of Object.entries(files)) {
    const base  = path.split('/').pop();
    const lower = base.toLowerCase();
    if (lower.endsWith('.js') && lower.includes('worker')) {
      // pthreads ワーカー JS
      workerFiles[base] = data;
    } else if (!jsData && lower.endsWith('.js')) {
      jsData = data;
    } else if (!wasmData && lower.endsWith('.wasm')) {
      wasmData = data;
    } else if (lower.endsWith('.bin') || lower.endsWith('.nnue') || lower.endsWith('.eval')) {
      evalFiles[base] = data;
    }
  }

  if (!jsData || !wasmData) {
    throw new Error(
      'ZIPからエンジンファイルを見つけられませんでした。\n' +
      `見つかったファイル: ${Object.keys(files).join(', ')}`
    );
  }

  // ── Cache API に保存 ──────────────────────────────────────
  const c = await openCache();
  await c.put(cacheKey(variant, 'js'),   new Response(jsData.buffer,   { headers: { 'Content-Type': 'application/javascript' } }));
  await c.put(cacheKey(variant, 'wasm'), new Response(wasmData.buffer, { headers: { 'Content-Type': 'application/wasm' } }));

  const evalNames   = Object.keys(evalFiles);
  const workerNames = Object.keys(workerFiles);
  for (const [fname, fdata] of Object.entries(evalFiles)) {
    await c.put(cacheKey(variant, 'eval', fname), new Response(fdata.buffer));
  }
  for (const [fname, fdata] of Object.entries(workerFiles)) {
    await c.put(cacheKey(variant, 'worker', fname), new Response(fdata.buffer, { headers: { 'Content-Type': 'application/javascript' } }));
  }
  await c.put(cacheKey(variant, 'manifest'), new Response(JSON.stringify({ cacheVersion: CACHE_VERSION, evalFiles: evalNames, workerFiles: workerNames })));

  onProgress?.({ phase: 'done', progress: 1 });

  return { js: jsData, wasm: wasmData, evalFiles, workerFiles };
}

/** キャッシュの合計サイズ（バイト）を返す */
export async function getEngineCacheSize(variant) {
  try {
    const c = await openCache();
    const mRes = await c.match(cacheKey(variant, 'manifest'));
    const manifest = mRes ? await mRes.json() : { evalFiles: [], workerFiles: [] };
    const keys = [
      cacheKey(variant, 'js'),
      cacheKey(variant, 'wasm'),
      ...(manifest.evalFiles   || []).map(f => cacheKey(variant, 'eval',   f)),
      ...(manifest.workerFiles || []).map(f => cacheKey(variant, 'worker', f)),
    ];
    let total = 0;
    for (const k of keys) {
      const res = await c.match(k);
      if (res) {
        const buf = await res.arrayBuffer();
        total += buf.byteLength;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/** キャッシュを削除 */
export async function clearEngineCache(variant) {
  const c    = await openCache();
  const mRes = await c.match(cacheKey(variant, 'manifest'));
  const manifest = mRes ? await mRes.json() : { evalFiles: [] };
  const keys = [
    cacheKey(variant, 'js'),
    cacheKey(variant, 'wasm'),
    cacheKey(variant, 'manifest'),
    ...(manifest.evalFiles  || []).map(f => cacheKey(variant, 'eval',   f)),
    ...(manifest.workerFiles || []).map(f => cacheKey(variant, 'worker', f)),
  ];
  await Promise.all(keys.map(k => c.delete(k)));
}
