/**
 * OpenCV.js で将棋盤の四隅を検出する。
 * mode: 'screenshot' | 'photo'
 * 戻り値: [{x,y}×4] 左上・右上・右下・左下、または null
 *
 * gridLines も同時に返す: {rows: number[10], cols: number[10]} or null
 */
export function detectBoardCorners(cv, srcCanvas, mode) {
  const src = cv.imread(srcCanvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
  cv.Canny(blurred, edges, 50, 150);

  let corners = null;
  let gridLines = null;

  if (mode === 'screenshot') {
    corners = _detectByContour(cv, edges, src.cols, src.rows);
  } else {
    corners = _detectByHough(cv, edges, blurred, src.cols, src.rows);
    if (!corners) corners = _detectByContour(cv, edges, src.cols, src.rows);
  }

  if (corners) {
    gridLines = _detectGridLines(cv, edges, corners, src.cols, src.rows);
  }

  src.delete(); gray.delete(); blurred.delete(); edges.delete();
  return { corners, gridLines };
}

// ── 輪郭ベース（スクショに強い） ────────────────────────────────────────
function _detectByContour(cv, edges, W, H) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const dilated = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(edges, dilated, kernel);

  cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let best = null;
  let bestArea = 0;
  const minArea = W * H * 0.04;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area < minArea) { cnt.delete(); continue; }

    const peri = cv.arcLength(cnt, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

    if (approx.rows === 4) {
      const pts = _matToPoints(approx);
      const ar = _aspectRatio(pts);
      // 盤は正方形に近い (0.65〜1.35)
      if (ar > 0.65 && ar < 1.35 && area > bestArea) {
        bestArea = area;
        best = _sortCorners(pts);
      }
    }
    approx.delete(); cnt.delete();
  }

  contours.delete(); hierarchy.delete(); dilated.delete(); kernel.delete();
  return best;
}

// ── Hough ベース（写真に強い） ─────────────────────────────────────────
function _detectByHough(cv, edges, _blurred, W, H) {
  const lines = new cv.Mat();
  cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 80, Math.min(W, H) * 0.1, 20);

  const hLines = [], vLines = [];
  for (let i = 0; i < lines.rows; i++) {
    const x1 = lines.data32S[i * 4], y1 = lines.data32S[i * 4 + 1];
    const x2 = lines.data32S[i * 4 + 2], y2 = lines.data32S[i * 4 + 3];
    const angle = Math.abs(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
    if (angle < 20 || angle > 160) hLines.push([x1, y1, x2, y2]);
    else if (angle > 70 && angle < 110) vLines.push([x1, y1, x2, y2]);
  }
  lines.delete();

  if (hLines.length < 2 || vLines.length < 2) return null;

  // 水平線のY座標クラスタ、垂直線のX座標クラスタから最外4本
  const hYs = hLines.map(l => (l[1] + l[3]) / 2).sort((a, b) => a - b);
  const vXs = vLines.map(l => (l[0] + l[2]) / 2).sort((a, b) => a - b);

  const top    = hYs[0];
  const bottom = hYs[hYs.length - 1];
  const left   = vXs[0];
  const right  = vXs[vXs.length - 1];

  if (right - left < W * 0.1 || bottom - top < H * 0.1) return null;

  return _sortCorners([
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ]);
}

// ── 盤内の格子線を検出して row/col 境界を返す ──────────────────────────
function _detectGridLines(cv, edges, corners, W, H) {
  // コーナー内側の領域を ROI として水平/垂直射影
  const x0 = Math.round(Math.min(corners[0].x, corners[3].x));
  const x1 = Math.round(Math.max(corners[1].x, corners[2].x));
  const y0 = Math.round(Math.min(corners[0].y, corners[1].y));
  const y1 = Math.round(Math.max(corners[2].y, corners[3].y));
  if (x1 <= x0 || y1 <= y0) return null;

  const roiRect = new cv.Rect(
    Math.max(0, x0), Math.max(0, y0),
    Math.min(x1 - x0, W - x0), Math.min(y1 - y0, H - y0)
  );
  const roi = edges.roi(roiRect);

  const rows = _findEvenLines(cv, roi, 'h', 10, y0);
  const cols = _findEvenLines(cv, roi, 'v', 10, x0);

  roi.delete();
  if (!rows || !cols) return null;
  return { rows, cols };
}

function _findEvenLines(cv, roi, axis, count, offset) {
  const proj = new cv.Mat();
  const reduce_op = cv.REDUCE_AVG;
  if (axis === 'h') {
    cv.reduce(roi, proj, 1, reduce_op, cv.CV_32F); // H×1
  } else {
    cv.reduce(roi, proj, 0, reduce_op, cv.CV_32F); // 1×W
  }

  const len = axis === 'h' ? proj.rows : proj.cols;
  const vals = [];
  for (let i = 0; i < len; i++) {
    vals.push(proj.data32F[i]);
  }
  proj.delete();

  // ピーク候補
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const thr = avg * 1.1;
  const peaks = [];
  for (let i = 2; i < len - 2; i++) {
    if (vals[i] < thr) continue;
    if (vals[i] >= vals[i-1] && vals[i] >= vals[i+1] &&
        vals[i] >= vals[i-2] && vals[i] >= vals[i+2]) {
      if (peaks.length > 0 && i - peaks[peaks.length - 1] < 5) {
        if (vals[i] > vals[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
      } else {
        peaks.push(i);
      }
    }
  }

  if (peaks.length < count) return null;

  // 最も等間隔な count 本を選択
  let best = null, bestErr = Infinity;
  for (let si = 0; si <= peaks.length - count; si++) {
    for (let ei = si + count - 1; ei < peaks.length; ei++) {
      const span = peaks[ei] - peaks[si];
      if (span < count * 3) continue;
      const step = span / (count - 1);
      const selected = [];
      let err = 0, ok = true;
      for (let k = 0; k < count; k++) {
        const expected = peaks[si] + step * k;
        let closest = null, minD = Infinity;
        for (const p of peaks) { const d = Math.abs(p - expected); if (d < minD) { minD = d; closest = p; } }
        if (minD > step * 0.45) { ok = false; break; }
        selected.push(closest); err += minD;
      }
      if (ok && err < bestErr) { bestErr = err; best = selected; }
    }
  }

  return best ? best.map(p => p + offset) : null;
}

// ── ユーティリティ ─────────────────────────────────────────────────────
function _matToPoints(mat) {
  const pts = [];
  for (let i = 0; i < mat.rows; i++) {
    pts.push({ x: mat.data32S[i * 2], y: mat.data32S[i * 2 + 1] });
  }
  return pts;
}

function _aspectRatio(pts) {
  const w = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const h = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y);
  return h > 0 ? w / h : 0;
}

// 4点を左上・右上・右下・左下に並べる
function _sortCorners(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const tl = pts.filter(p => p.x <= cx && p.y <= cy);
  const tr = pts.filter(p => p.x >  cx && p.y <= cy);
  const br = pts.filter(p => p.x >  cx && p.y >  cy);
  const bl = pts.filter(p => p.x <= cx && p.y >  cy);
  if (!tl[0] || !tr[0] || !br[0] || !bl[0]) return pts.slice(0, 4);
  return [tl[0], tr[0], br[0], bl[0]];
}
