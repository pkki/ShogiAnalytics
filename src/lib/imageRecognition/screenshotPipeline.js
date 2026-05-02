import { extractCellUniform } from './perspective.js';
import { warpInWorker } from './workerClient.js';
import { readHandPieces } from './handPieceDetector.js';
import { createWorker } from 'tesseract.js';

const KANJI_TO_PIECE = {
  '王':'K','玉':'K','飛':'R','竜':'+R','龍':'+R',
  '角':'B','馬':'+B','金':'G','銀':'S','全':'+S',
  '桂':'N','圭':'+N','香':'L','杏':'+L','歩':'P','と':'+P',
};

function textToPiece(t) {
  for (const [k, v] of Object.entries(KANJI_TO_PIECE)) {
    if (t.includes(k)) return v;
  }
  return null;
}

function rotate180(canvas) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(Math.PI);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}

/**
 * セルが空かどうかを判定。
 * 暗ピクセル（輝度<0.45）の割合が3%未満なら空と判断。
 * 駒の墨汁・印刷インク・将棋ウォーズの赤駒も輝度0.45以下に収まる。
 */
function isCellEmpty(cellCanvas) {
  const { data, width, height } = cellCanvas.getContext('2d')
    .getImageData(0, 0, cellCanvas.width, cellCanvas.height);
  const pad = Math.round(Math.min(width, height) * 0.15);
  let dark = 0, total = 0;
  for (let y = pad; y < height - pad; y++) {
    for (let x = pad; x < width - pad; x++) {
      const i = (y * width + x) * 4;
      const lum = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) / 255;
      if (lum < 0.45) dark++;
      total++;
    }
  }
  return dark / total < 0.03;
}

/**
 * ピクセル分布から {player:1|2|null, rotated:boolean} を推定。
 * 将棋ウォーズ式: 後手=赤文字で回転なし → rotated:false
 * 81dojo式: 後手=物理的に180度回転 → rotated:true
 */
function guessOrientation(cellCanvas) {
  const { data, width, height } = cellCanvas.getContext('2d')
    .getImageData(0, 0, cellCanvas.width, cellCanvas.height);
  const xStart = Math.round(width * 0.15), xEnd = Math.round(width * 0.85);
  const yStart = Math.round(height * 0.15), yEnd = Math.round(height * 0.85);
  const half = Math.floor(height * 0.5);
  let redCount = 0, darkTop = 0, darkBottom = 0, total = 0;
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      // 赤系 = R>150 かつ R>G*1.6 かつ R>B*1.6
      if (r > 150 && r > g * 1.6 && r > b * 1.6) redCount++;
      if (lum < 0.45) { if (y < half) darkTop++; else darkBottom++; }
      total++;
    }
  }
  // 赤文字が3%以上 → 将棋ウォーズ式後手（回転なし）
  if (redCount / total > 0.03) return { player: 2, rotated: false };
  // 重心で判定 → 物理回転式
  if (darkTop   > darkBottom * 1.4) return { player: 1, rotated: false };
  if (darkBottom > darkTop   * 1.4) return { player: 2, rotated: true };
  return { player: null, rotated: false };
}

/**
 * セルを前処理して OCR しやすくする。
 * Otsu法で二値化 → 黒文字/白背景に統一。
 * 赤文字（将棋ウォーズ後手）も黒に変換する。
 */
function preprocessForOcr(cellCanvas) {
  const SIZE = 96;
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const pad = Math.round(cellCanvas.width * 0.10);
  ctx.drawImage(cellCanvas, pad, pad,
    cellCanvas.width - pad*2, cellCanvas.height - pad*2,
    5, 5, SIZE - 10, SIZE - 10);

  const id = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = id.data;
  const n = SIZE * SIZE;

  // グレースケール化（赤文字も輝度で拾う）
  const gray = new Uint8Array(n);
  const hist = new Int32Array(256);
  for (let i = 0; i < n; i++) {
    // 赤文字対応: R チャンネルを強調して暗く見せる
    const r = d[i*4], g = d[i*4+1], b = d[i*4+2];
    const isRed = r > 150 && r > g * 1.5 && r > b * 1.5;
    const lum = isRed
      ? Math.round(r * 0.1 + g * 0.587 + b * 0.114) // 赤を暗く
      : Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    gray[i] = Math.min(255, lum);
    hist[gray[i]]++;
  }

  // Otsu 法で最適しきい値を算出
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxSigma = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const sigma = wB * wF * (mB - mF) ** 2;
    if (sigma > maxSigma) { maxSigma = sigma; threshold = t; }
  }

  // 暗ピクセルが過半数 = 反転画像（白文字/暗背景）→ 反転して正規化
  let below = 0;
  for (let i = 0; i < n; i++) if (gray[i] < threshold) below++;
  const invert = below > n * 0.5;

  for (let i = 0; i < n; i++) {
    let v = gray[i] < threshold ? 0 : 255;
    if (invert) v = 255 - v;
    d[i*4] = v; d[i*4+1] = v; d[i*4+2] = v; d[i*4+3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

/**
 * 1 セルを OCR で認識し {type, player, promoted} または null を返す。
 * guessOrientation で向き/プレイヤーを推定してから OCR → 失敗なら逆向きで再試行。
 */
async function recognizeCell(worker, cellCanvas) {
  if (isCellEmpty(cellCanvas)) return null;

  const prepped = preprocessForOcr(cellCanvas);
  const ori = guessOrientation(cellCanvas);
  const guessed = ori.player ?? 1;

  // 推定された向きで試みる（rotated=true なら 180 度回転して OCR）
  const primary = ori.rotated ? rotate180(prepped) : prepped;
  const r1 = await worker.recognize(primary);
  const p1 = textToPiece(r1.data.text.trim());
  if (p1) return { type: p1, player: guessed, promoted: p1.startsWith('+') };

  // 逆向きで再試行
  const fallback = ori.rotated ? prepped : rotate180(prepped);
  const r2 = await worker.recognize(fallback);
  const p2 = textToPiece(r2.data.text.trim());
  if (p2) {
    const fp = guessed === 2 ? 1 : 2;
    return { type: p2, player: fp, promoted: p2.startsWith('+') };
  }
  return null;
}

// ── canvas ラッパー（workerClient に渡す用） ──────────────────────────
function _canvasToImgEl(canvas) {
  return { naturalWidth: canvas.width, naturalHeight: canvas.height, _canvas: canvas };
}
function _imageDataToCanvas(uint8Data, size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(uint8Data), size, size), 0, 0);
  return c;
}

// ── メインパイプライン（photo / screenshot 共用） ─────────────────────
export async function runScreenshotPipeline({
  srcCanvas,
  corners,
  isGoteView,
  onProgress,
}) {
  const BOARD_SIZE = 576;
  const effectiveCorners = isGoteView
    ? [corners[2], corners[3], corners[0], corners[1]]
    : corners;

  if (onProgress) onProgress(0.05);

  const warpResult = await warpInWorker(_canvasToImgEl(srcCanvas), effectiveCorners, BOARD_SIZE);
  if (!warpResult?.ok) throw new Error(`透視変換に失敗: ${warpResult?.error ?? 'unknown'}`);
  const boardCanvas = _imageDataToCanvas(warpResult.imageData, BOARD_SIZE);

  if (onProgress) onProgress(0.10);

  const worker = await createWorker('jpn', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress)
        onProgress(0.10 + m.progress * 0.80);
    },
    errorHandler: () => {},
  });
  await worker.setParameters({
    tessedit_char_whitelist: '王玉飛竜龍角馬金銀全桂圭香杏歩と一二三四五六七八九0123456789×',
    tessedit_pageseg_mode: '8', // single word (1〜2文字の成駒にも対応)
  });

  const board = Array.from({ length: 9 }, () => Array(9).fill(null));
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const cell = extractCellUniform(boardCanvas, row, col, BOARD_SIZE);
      board[row][col] = await recognizeCell(worker, cell);
    }
    if (onProgress) onProgress(0.10 + (row + 1) / 9 * 0.80);
  }

  const hands = await readHandPieces(worker, srcCanvas, corners, isGoteView)
    .catch(() => ({ 1: {}, 2: {} }));

  if (onProgress) onProgress(1.0);
  await worker.terminate();
  return { board, hands, boardCanvas };
}
