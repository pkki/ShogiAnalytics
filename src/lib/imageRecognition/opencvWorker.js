// Web Worker — OpenCV の重い処理をメインスレッドから分離する
//
// 重要: Module.onRuntimeInitialized は importScripts より先に設定する必要がある。
// WASM 初期化完了前にメッセージが届く場合に備え、cvReady Promise で待機する。

let cv = null;
let cvReadyResolve;
const cvReady = new Promise(r => { cvReadyResolve = r; });

// ── 1. コールバックを先に登録 ─────────────────────────────────────────
self.Module = {
  onRuntimeInitialized() {
    // @techstark/opencv-js は self.cv に準備済みオブジェクトを置く
    cv = self.cv ?? self.Module;
    cvReadyResolve();
  },
};

// ── 2. スクリプトをロード（WASM base64 embedded → 同期完了のはずだが非同期も考慮）
try {
  importScripts('/opencv/opencv.js');
} catch (e) {
  console.error('[worker] importScripts failed:', e);
}

// base64 埋め込みで既に ready な場合（onRuntimeInitialized が同期呼び出しされた場合）
// → cvReadyResolve は既に呼ばれているので cvReady はすぐ解決する
// 万が一呼ばれていない場合はポーリングで補完
if (!cv) {
  let tries = 0;
  const poll = setInterval(() => {
    tries++;
    const candidate = self.cv ?? self.Module;
    if (candidate?.Mat) {
      cv = candidate;
      clearInterval(poll);
      cvReadyResolve();
    } else if (tries > 150) { // 15 秒タイムアウト
      clearInterval(poll);
      cvReadyResolve(); // cv=null のまま解決 → 後続でエラーになる
    }
  }, 100);
}

// ── ImageData → cv.Mat ───────────────────────────────────────────────
function imageDataToMat(data, width, height) {
  const mat = new cv.Mat(height, width, cv.CV_8UC4);
  mat.data.set(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  return mat;
}

// ── 透視変換 ─────────────────────────────────────────────────────────
function warpImage(data, srcW, srcH, corners, dstSize) {
  const src = imageDataToMat(data, srcW, srcH);
  const dst = new cv.Mat();
  const s = dstSize;
  const [p0, p1, p2, p3] = corners;
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y,
  ]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, s, 0, s, s, 0, s]);
  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  cv.warpPerspective(src, dst, M, new cv.Size(s, s), cv.INTER_LINEAR, cv.BORDER_CONSTANT);
  const out = new Uint8ClampedArray(dst.data);
  src.delete(); dst.delete(); srcPts.delete(); dstPts.delete(); M.delete();
  return out;
}

// ── コーナー検出 ──────────────────────────────────────────────────────
function detectCorners(data, width, height, mode) {
  const src = imageDataToMat(data, width, height);
  const gray = new cv.Mat(), blurred = new cv.Mat(), edges = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
  cv.Canny(blurred, edges, 50, 150);
  let corners = mode === 'screenshot'
    ? detectByContour(edges, width, height)
    : detectByHough(edges, width, height) || detectByContour(edges, width, height);
  src.delete(); gray.delete(); blurred.delete(); edges.delete();
  return corners;
}

function detectByContour(edges, W, H) {
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  const dilated = new cv.Mat(), kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(edges, dilated, kernel);
  cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let best = null, bestArea = 0;
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area < W * H * 0.04) { cnt.delete(); continue; }
    const approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * cv.arcLength(cnt, true), true);
    if (approx.rows === 4) {
      const pts = matToPoints(approx);
      const ar = aspectRatio(pts);
      if (ar > 0.5 && ar < 2.0 && area > bestArea) { bestArea = area; best = sortCorners(pts); }
    }
    approx.delete(); cnt.delete();
  }
  contours.delete(); hierarchy.delete(); dilated.delete(); kernel.delete();
  return best;
}

function detectByHough(edges, W, H) {
  const lines = new cv.Mat();
  cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 60, Math.min(W, H) * 0.08, 15);
  const hLines = [], vLines = [];
  for (let i = 0; i < lines.rows; i++) {
    const [x1, y1, x2, y2] = [lines.data32S[i*4], lines.data32S[i*4+1], lines.data32S[i*4+2], lines.data32S[i*4+3]];
    const a = Math.abs(Math.atan2(y2-y1, x2-x1) * 180 / Math.PI);
    if (a < 20 || a > 160) hLines.push([x1,y1,x2,y2]);
    else if (a > 70 && a < 110) vLines.push([x1,y1,x2,y2]);
  }
  lines.delete();
  if (hLines.length < 2 || vLines.length < 2) return null;
  const hYs = hLines.map(l => (l[1]+l[3])/2).sort((a,b) => a-b);
  const vXs = vLines.map(l => (l[0]+l[2])/2).sort((a,b) => a-b);
  const [top, bottom, left, right] = [hYs[0], hYs.at(-1), vXs[0], vXs.at(-1)];
  if (right-left < W*0.1 || bottom-top < H*0.1) return null;
  return sortCorners([{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}]);
}

function matToPoints(mat) {
  return Array.from({length: mat.rows}, (_, i) => ({ x: mat.data32S[i*2], y: mat.data32S[i*2+1] }));
}
function aspectRatio(pts) {
  const w = Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y);
  const h = Math.hypot(pts[3].x-pts[0].x, pts[3].y-pts[0].y);
  return h > 0 ? w/h : 0;
}
function sortCorners(pts) {
  const cx = pts.reduce((s,p)=>s+p.x,0)/4, cy = pts.reduce((s,p)=>s+p.y,0)/4;
  const q = (xc,yc) => pts.filter(p=>p.x<=xc===xc<=cx && p.y<=yc===yc<=cy);
  const tl=pts.filter(p=>p.x<=cx&&p.y<=cy)[0], tr=pts.filter(p=>p.x>cx&&p.y<=cy)[0];
  const br=pts.filter(p=>p.x>cx&&p.y>cy)[0],  bl=pts.filter(p=>p.x<=cx&&p.y>cy)[0];
  return (tl&&tr&&br&&bl) ? [tl,tr,br,bl] : pts.slice(0,4);
}

// ── メッセージハンドラ（async で cvReady を await） ────────────────────
self.onmessage = async function(e) {
  const { type, id } = e.data;

  await cvReady;

  if (!cv?.Mat) {
    self.postMessage({ id, ok: false, error: 'OpenCV の初期化に失敗しました' });
    return;
  }

  if (type === 'detect') {
    try {
      const { imageData, width, height, mode, scale } = e.data;
      const corners = detectCorners(imageData, width, height, mode);
      const scaled = corners?.map(pt => ({ x: pt.x / scale, y: pt.y / scale })) ?? null;
      self.postMessage({ id, ok: true, corners: scaled });
    } catch (err) {
      console.error('[worker] detect error:', err);
      self.postMessage({ id, ok: false, error: err.message });
    }
  }

  if (type === 'warp') {
    try {
      const { imageData, width, height, corners, dstSize } = e.data;
      const out = warpImage(imageData, width, height, corners, dstSize);
      self.postMessage({ id, ok: true, imageData: out, width: dstSize, height: dstSize }, [out.buffer]);
    } catch (err) {
      console.error('[worker] warp error:', err);
      self.postMessage({ id, ok: false, error: err.message });
    }
  }
};
