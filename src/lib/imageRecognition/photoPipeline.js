import { extractCellUniform } from './perspective.js';
import { warpInWorker } from './workerClient.js';
import { classifyBatch } from './pieceClassifier.js';

const WARP_SIZE = 576;

// ── 共通ユーティリティ ────────────────────────────────────────────────

function _imageDataToCanvas(uint8Data, size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const id = new ImageData(new Uint8ClampedArray(uint8Data), size, size);
  c.getContext('2d').putImageData(id, 0, 0);
  return c;
}

// 格子線・隣接駒のはみ出しを 12% カットして CNN 精度を上げる
function _preprocessCell(cellCanvas) {
  try {
    const w = cellCanvas.width, h = cellCanvas.height;
    const pad = Math.round(Math.min(w, h) * 0.12);
    const inner = document.createElement('canvas');
    inner.width = w - pad * 2; inner.height = h - pad * 2;
    inner.getContext('2d').drawImage(
      cellCanvas, pad, pad, inner.width, inner.height,
      0, 0, inner.width, inner.height,
    );
    return inner;
  } catch {
    return cellCanvas;
  }
}

const TO_BASE_TYPE = { '+R':'R', '+B':'B', '+S':'S', '+N':'N', '+L':'L', '+P':'P' };
const STANDARD_PER_PLAYER = { R: 1, B: 1, G: 2, S: 2, N: 2, L: 2, P: 9 };
const PIECE_JP = { R:'飛', B:'角', G:'金', S:'銀', N:'桂', L:'香', P:'歩' };

// ── メインパイプライン ────────────────────────────────────────────────

export async function runPhotoPipeline({
  srcCanvas,
  corners,
  model,
  isGoteView,
  sourceType = 'photo',
  onProgress,
}) {
  const effectiveCorners = isGoteView
    ? [corners[2], corners[3], corners[0], corners[1]]
    : corners;

  // 盤面を透視補正してワープ
  const warpResult = await warpInWorker(srcCanvas, effectiveCorners, WARP_SIZE);
  if (!warpResult?.ok) throw new Error('透視変換に失敗しました');
  const boardCanvas = _imageDataToCanvas(warpResult.imageData, WARP_SIZE);
  if (onProgress) onProgress(0.1);

  // 81 セルを切り出してバッチ推論
  const cells = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const raw = extractCellUniform(boardCanvas, row, col, WARP_SIZE);
      cells.push(_preprocessCell(raw));
    }
  }
  if (onProgress) onProgress(0.3);

  const pieceList = await classifyBatch(model, cells);
  if (onProgress) onProgress(0.6);

  const board = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (__, c) => pieceList[r * 9 + c])
  );

  // 駒台エリアをスキャンして持ち駒を検出
  let hands = { 1: {}, 2: {} };
  let handCanvases = { sente: null, gote: null };
  try {
    const scanned = await _scanHandRegions(srcCanvas, corners, model, isGoteView, sourceType);
    hands = scanned.hands;
    handCanvases = scanned.canvases;
  } catch (e) {
    console.warn('[hand scan]', e);
  }

  // 何も検出できなかった場合のみ数学推定をフォールバックとして使う
  const totalDetected = Object.values(hands[1]).reduce((s, n) => s + n, 0)
                      + Object.values(hands[2]).reduce((s, n) => s + n, 0);
  if (totalDetected === 0) {
    hands = inferHandsFromBoard(board);
  }

  const warnings = ['持ち駒を確認してください（認識に誤りがある場合は下のエディタで修正できます）'];

  if (onProgress) onProgress(1.0);
  return { board, hands, warnings, boardCanvas, handCanvases };
}

// ── 持ち駒エリアスキャン ─────────────────────────────────────────────

/**
 * 駒台エリアをスキャンする。レイアウトは sourceType により異なる。
 *
 * screenshot (将棋ウォーズ等): 上→後手、下→先手
 * photo (実物写真・TV中継)   : 左→後手、右→先手
 *
 * isGoteView=true の場合は先手・後手が入れ替わる。
 */
async function _scanHandRegions(srcCanvas, corners, model, isGoteView, sourceType) {
  const [TL, TR, BR, BL] = corners;
  const W = srcCanvas.width;
  const H = srcCanvas.height;

  const boardH   = Math.max(BR.y, BL.y) - Math.min(TL.y, TR.y);
  const cellSize = Math.max(40, Math.round(boardH / 9));

  let regions;
  if (sourceType === 'screenshot') {
    // 上下スキャン
    const topY = Math.min(TL.y, TR.y);
    const botY = Math.max(BR.y, BL.y);
    regions = [
      { player: isGoteView ? 2 : 1, x0: 0, y0: Math.ceil(botY),   x1: W, y1: H },        // 下 → 先手
      { player: isGoteView ? 1 : 2, x0: 0, y0: 0, x1: W,          y1: Math.floor(topY) }, // 上 → 後手
    ];
  } else {
    // 左右スキャン（実物写真・TV中継）
    const leftX  = Math.min(TL.x, BL.x);
    const rightX = Math.max(TR.x, BR.x);
    regions = [
      { player: isGoteView ? 2 : 1, x0: Math.ceil(rightX), y0: 0, x1: W, y1: H }, // 右 → 先手
      { player: isGoteView ? 1 : 2, x0: 0, y0: 0, x1: Math.floor(leftX), y1: H }, // 左 → 後手
    ];
  }

  const hands = { 1: {}, 2: {} };
  const canvases = { sente: null, gote: null };

  for (const { player, x0, y0, x1, y1 } of regions) {
    const rW = x1 - x0;
    const rH = y1 - y0;
    if (rH < cellSize * 0.5 || rW < cellSize * 0.5) continue;

    // エリアをクロップ
    const regionCanvas = document.createElement('canvas');
    regionCanvas.width = rW; regionCanvas.height = rH;
    regionCanvas.getContext('2d').drawImage(srcCanvas, x0, y0, rW, rH, 0, 0, rW, rH);

    // スライディングウィンドウ（ストライド = cellSize × 0.5 でオーバーラップ）
    const stride = Math.round(cellSize * 0.5);
    const windowCells = [];
    const positions   = [];

    for (let gy = 0; gy + cellSize <= rH; gy += stride) {
      for (let gx = 0; gx + cellSize <= rW; gx += stride) {
        const cell = document.createElement('canvas');
        cell.width = cellSize; cell.height = cellSize;
        cell.getContext('2d').drawImage(regionCanvas, gx, gy, cellSize, cellSize, 0, 0, cellSize, cellSize);
        windowCells.push(_preprocessCell(cell));
        positions.push({ gx, gy });
      }
    }

    if (windowCells.length === 0) continue;

    const preds = await classifyBatch(model, windowCells);

    // 検出リストを構築（厳しめ閾値で誤検知を抑える）
    const detections = [];
    preds.forEach((piece, i) => {
      if (!piece) return;
      if (piece.emptyProb  > 0.20) return;
      if (piece.confidence < 0.70) return;
      if (piece.top2Margin < 0.30) return;
      const base = TO_BASE_TYPE[piece.type] || piece.type;
      if (base === 'K') return;
      detections.push({ ...positions[i], base, confidence: piece.confidence });
    });

    // 駒種ごとに NMS で重複除去してカウント
    const typeGroups = {};
    for (const d of detections) {
      (typeGroups[d.base] ??= []).push(d);
    }

    const survivors = [];
    const pieceCounts = {};
    for (const [type, group] of Object.entries(typeGroups)) {
      const s = _nms(group, cellSize * 0.7);
      pieceCounts[type] = s.length;
      survivors.push(...s);
    }

    for (const [type, count] of Object.entries(pieceCounts)) {
      if (count > 0) hands[player][type] = count;
    }

    // プレビュー canvas（検出結果をアノテーション）
    const annotated = document.createElement('canvas');
    annotated.width = rW; annotated.height = rH;
    const ctx = annotated.getContext('2d');
    ctx.drawImage(regionCanvas, 0, 0);

    for (const { gx, gy, base } of survivors) {
      ctx.strokeStyle = 'rgba(74,222,128,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(gx + 1, gy + 1, cellSize - 2, cellSize - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(gx, gy + cellSize - 18, cellSize, 18);
      ctx.fillStyle = '#4ade80';
      ctx.font = `bold ${Math.max(10, Math.round(cellSize * 0.28))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(PIECE_JP[base] || base, gx + cellSize / 2, gy + cellSize - 1);
    }

    const key = player === 1 ? 'sente' : 'gote';
    canvases[key] = annotated;
  }

  return { hands, canvases };
}

/**
 * 信頼度降順でソートし、距離 minDist 以内の重複を除去する Non-Maximum Suppression。
 * 生き残った検出ボックスの配列を返す。
 */
function _nms(detections, minDist) {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const suppressed = new Uint8Array(sorted.length);
  const survivors  = [];

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed[i]) continue;
    survivors.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed[j]) continue;
      const dist = Math.hypot(sorted[j].gx - sorted[i].gx, sorted[j].gy - sorted[i].gy);
      if (dist < minDist) suppressed[j] = 1;
    }
  }
  return survivors;
}

// ── 数学推定（フォールバック用） ──────────────────────────────────────

function _checkNonStandard(board) {
  const onBoard = { 1: {}, 2: {} };
  for (const row of board) {
    for (const cell of row) {
      if (!cell) continue;
      const base = TO_BASE_TYPE[cell.type] || cell.type;
      if (base === 'K') continue;
      onBoard[cell.player][base] = (onBoard[cell.player][base] || 0) + 1;
    }
  }
  for (const [piece, std] of Object.entries(STANDARD_PER_PLAYER)) {
    if ((onBoard[1][piece] || 0) + (onBoard[2][piece] || 0) > std * 2) {
      return ['非標準局面を検出しました（詰将棋・駒落ち等）。持ち駒を手動でご確認ください。'];
    }
  }
  return [];
}

/**
 * 盤面から持ち駒を数学的に推定する（フォールバック用）。
 * 打った駒がある局面では不正確になるため、視覚スキャンが優先される。
 */
export function inferHandsFromBoard(board) {
  const onBoard = { 1: {}, 2: {} };

  for (const row of board) {
    for (const cell of row) {
      if (!cell) continue;
      const base = TO_BASE_TYPE[cell.type] || cell.type;
      if (base === 'K') continue;
      onBoard[cell.player][base] = (onBoard[cell.player][base] || 0) + 1;
    }
  }

  const hands = { 1: {}, 2: {} };

  for (const [piece, std] of Object.entries(STANDARD_PER_PLAYER)) {
    const senteMissing = Math.max(0, std - (onBoard[1][piece] || 0));
    if (senteMissing > 0) hands[2][piece] = (hands[2][piece] || 0) + senteMissing;

    const goteMissing = Math.max(0, std - (onBoard[2][piece] || 0));
    if (goteMissing > 0) hands[1][piece] = (hands[1][piece] || 0) + goteMissing;
  }

  return hands;
}
