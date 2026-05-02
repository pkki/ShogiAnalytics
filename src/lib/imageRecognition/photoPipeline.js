import { extractCellUniform } from './perspective.js';
import { warpInWorker } from './workerClient.js';
import { classifyBatch } from './pieceClassifier.js';

const WARP_SIZE = 576; // 正方形でワープ

/**
 * 写真用パイプライン。
 * セル前処理でOpenCVを使い背景ノイズを除いてからバッチCNN推論。
 */
function _imageDataToCanvas(uint8Data, size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const id = new ImageData(new Uint8ClampedArray(uint8Data), size, size);
  c.getContext('2d').putImageData(id, 0, 0);
  return c;
}

export async function runPhotoPipeline({
  srcCanvas,
  corners,
  model,
  isGoteView,
  onProgress,
}) {
  const effectiveCorners = isGoteView
    ? [corners[2], corners[3], corners[0], corners[1]]
    : corners;

  const warpResult = await warpInWorker(srcCanvas, effectiveCorners, WARP_SIZE);
  if (!warpResult?.ok) throw new Error('透視変換に失敗しました');
  const boardCanvas = _imageDataToCanvas(warpResult.imageData, WARP_SIZE);

  if (onProgress) onProgress(0.1);

  // 81 セルを切り出して前処理
  const cells = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const raw = extractCellUniform(boardCanvas, row, col, WARP_SIZE);
      cells.push(_preprocessCell(raw));
    }
  }

  if (onProgress) onProgress(0.3);

  // バッチ推論（81 マス一括）
  const pieceList = await classifyBatch(model, cells);
  if (onProgress) onProgress(0.95);

  const board = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (__, c) => pieceList[r * 9 + c])
  );

  if (onProgress) onProgress(1.0);
  return { board, hands: { 1: {}, 2: {} }, boardCanvas };
}

/**
 * セル前処理: パディングクロップのみ（メインスレッドで安全に動く純 JS 版）。
 * 格子線・隣接駒のはみ出しを 12% カットするだけでも精度が大幅に改善する。
 */
function _preprocessCell(cellCanvas) {
  try {
    const w = cellCanvas.width, h = cellCanvas.height;
    const pad = Math.round(Math.min(w, h) * 0.12);
    const inner = document.createElement('canvas');
    inner.width = w - pad * 2; inner.height = h - pad * 2;
    inner.getContext('2d').drawImage(cellCanvas, pad, pad, inner.width, inner.height, 0, 0, inner.width, inner.height);
    return inner;
  } catch {
    return cellCanvas;
  }
}

