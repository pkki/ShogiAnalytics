// OpenCV Worker へのクライアント
// Vite の ?worker インポートでワーカーをバンドルする

import WorkerClass from './opencvWorker.js?worker';

let worker = null;
let pending = new Map();
let nextId = 1;

function getWorker() {
  if (!worker) {
    worker = new WorkerClass();
    worker.onmessage = (e) => {
      const { id } = e.data;
      const resolve = pending.get(id);
      if (resolve) { pending.delete(id); resolve(e.data); }
    };
    worker.onerror = (e) => {
      console.error('OpenCV worker error:', e);
      // 未処理の pending をすべて reject 代わりに ok:false で解決
      for (const [id, resolve] of pending) {
        resolve({ id, ok: false, error: String(e.message) });
      }
      pending.clear();
      worker = null; // 次回再生成
    };
  }
  return worker;
}

/** canvas / img / {_canvas} → { data: Uint8ClampedArray, w, h } */
function extractImageData(src) {
  if (src && src._canvas) {
    const c = src._canvas;
    return { data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  }
  if (src instanceof HTMLCanvasElement) {
    return { data: src.getContext('2d').getImageData(0, 0, src.width, src.height).data, w: src.width, h: src.height };
  }
  // HTMLImageElement
  const c = document.createElement('canvas');
  c.width = src.naturalWidth; c.height = src.naturalHeight;
  c.getContext('2d').drawImage(src, 0, 0);
  return { data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

/**
 * 透視変換をワーカーで実行。
 * 戻り値: { ok, imageData: Uint8ClampedArray, width, height }
 */
export function warpInWorker(src, corners, dstSize) {
  return new Promise((resolve) => {
    const { data, w, h } = extractImageData(src);
    // Uint8ClampedArray をコピーして ArrayBuffer として転送
    const buf = new Uint8Array(data).buffer;
    const id = nextId++;
    pending.set(id, (result) => {
      if (result.ok && result.imageData) {
        // worker から Uint8ClampedArray が届く
        result.imageData = result.imageData instanceof Uint8ClampedArray
          ? result.imageData
          : new Uint8ClampedArray(result.imageData);
      }
      resolve(result);
    });
    getWorker().postMessage(
      { type: 'warp', id, imageData: new Uint8Array(buf), width: w, height: h, corners, dstSize },
      [buf]
    );
  });
}

/**
 * 盤の四隅をワーカーで検出。
 * 戻り値: { ok, corners: [{x,y}×4] | null }
 */
export function detectCornersInWorker(imgEl, mode) {
  return new Promise((resolve) => {
    const MAX = 1200;
    const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
    const scale = Math.min(1, MAX / Math.max(w, h));
    const sw = Math.round(w * scale), sh = Math.round(h * scale);

    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(imgEl, 0, 0, sw, sh);
    const data = c.getContext('2d').getImageData(0, 0, sw, sh).data;
    const buf = new Uint8Array(data).buffer;

    const id = nextId++;
    pending.set(id, resolve);
    getWorker().postMessage(
      { type: 'detect', id, imageData: new Uint8Array(buf), width: sw, height: sh, mode, scale },
      [buf]
    );
  });
}
