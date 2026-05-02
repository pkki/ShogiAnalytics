/**
 * OpenCV.js を使ったバイリニア透視変換。
 * corners: [{x,y},{x,y},{x,y},{x,y}]  左上・右上・右下・左下 (自然画像座標)
 * 戻り値: HTMLCanvasElement
 */
export function warpWithOpenCV(cv, srcCanvas, corners, dstW, dstH) {
  const src = cv.imread(srcCanvas);
  const dst = new cv.Mat();

  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners[0].x, corners[0].y,
    corners[1].x, corners[1].y,
    corners[2].x, corners[2].y,
    corners[3].x, corners[3].y,
  ]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    dstW, 0,
    dstW, dstH,
    0, dstH,
  ]);

  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const dsize = new cv.Size(dstW, dstH);
  cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT);

  const out = document.createElement('canvas');
  out.width = dstW;
  out.height = dstH;
  cv.imshow(out, dst);

  src.delete(); dst.delete(); srcPts.delete(); dstPts.delete(); M.delete();
  return out;
}

/**
 * ワープ済みキャンバスから格子線位置を使って1セルを切り出す。
 * gridLines: {rows: number[], cols: number[]}  各格子線のピクセル座標(10本ずつ)
 */
export function extractCellByGridLines(boardCanvas, row, col, gridLines) {
  const { rows, cols } = gridLines;
  const x0 = Math.round(cols[col]);
  const x1 = Math.round(cols[col + 1]);
  const y0 = Math.round(rows[row]);
  const y1 = Math.round(rows[row + 1]);
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(boardCanvas, x0, y0, w, h, 0, 0, w, h);
  return c;
}

/**
 * 均等分割フォールバック（OpenCV なし時）
 */
export function extractCellUniform(boardCanvas, row, col, boardSize) {
  const cell = boardSize / 9;
  const pad = Math.round(cell * 0.05);
  const x = Math.round(col * cell) + pad;
  const y = Math.round(row * cell) + pad;
  const sz = Math.round(cell) - pad * 2;
  const c = document.createElement('canvas');
  c.width = sz; c.height = sz;
  c.getContext('2d').drawImage(boardCanvas, x, y, sz, sz, 0, 0, sz, sz);
  return c;
}
