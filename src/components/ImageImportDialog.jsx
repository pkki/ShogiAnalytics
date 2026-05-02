import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Camera, Loader2, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';

import { detectCornersInWorker }  from '../lib/imageRecognition/workerClient.js';
import { detectSourceType }     from '../lib/imageRecognition/sourceDetector.js';
import { loadModel }             from '../lib/imageRecognition/pieceClassifier.js';
import { runPhotoPipeline }      from '../lib/imageRecognition/photoPipeline.js';

const PIECE_DISPLAY = {
  'K':'王','R':'飛','+R':'竜','B':'角','+B':'馬','G':'金',
  'S':'銀','+S':'全','N':'桂','+N':'圭','L':'香','+L':'杏','P':'歩','+P':'と',
};
const HAND_PIECE_TYPES = ['R','B','G','S','N','L','P'];
const ALL_PIECE_TYPES  = ['K','R','+R','B','+B','G','S','+S','N','+N','L','+L','P','+P'];

// ── ユーティリティ ─────────────────────────────────────────────────────
function imageToCanvas(imgEl) {
  const c = document.createElement('canvas');
  c.width  = imgEl.naturalWidth;
  c.height = imgEl.naturalHeight;
  c.getContext('2d').drawImage(imgEl, 0, 0);
  return c;
}

/**
 * 純 JS の逆写像透視変換（preview 用・小サイズ限定）。
 * OpenCV 不要。dst は正方形 size×size。
 */
function warpJS(imgEl, corners, size) {
  const [p0, p1, p2, p3] = corners; // TL TR BR BL
  const dst = document.createElement('canvas');
  dst.width = size; dst.height = size;
  const ctx = dst.getContext('2d');

  function solve(A, b) {
    const n = b.length;
    const M = A.map((r, i) => [...r, b[i]]);
    for (let col = 0; col < n; col++) {
      let max = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[max][col])) max = r;
      [M[col], M[max]] = [M[max], M[col]];
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = M[i][n];
      for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
      x[i] /= M[i][i];
    }
    return x;
  }

  const s = size;
  const dstPts = [[0,0],[s,0],[s,s],[0,s]];
  const srcPts = [[p0.x,p0.y],[p1.x,p1.y],[p2.x,p2.y],[p3.x,p3.y]];

  const rows = [];
  const rhs  = [];
  for (let i = 0; i < 4; i++) {
    const [dx,dy] = dstPts[i];
    const [sx,sy] = srcPts[i];
    rows.push([dx,dy,1,0,0,0,-dx*sx,-dy*sx]); rhs.push(sx);
    rows.push([0,0,0,dx,dy,1,-dx*sy,-dy*sy]); rhs.push(sy);
  }
  let h;
  try { h = solve(rows, rhs); } catch { ctx.drawImage(imgEl,0,0,size,size); return dst; }

  const srcCanvas = imageToCanvas(imgEl);
  const srcCtx = srcCanvas.getContext('2d');
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const dstData = ctx.createImageData(size, size);
  const sw = srcCanvas.width, sh = srcCanvas.height;

  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const w  = h[6]*dx + h[7]*dy + 1;
      const sx = Math.round((h[0]*dx + h[1]*dy + h[2]) / w);
      const sy = Math.round((h[3]*dx + h[4]*dy + h[5]) / w);
      if (sx < 0 || sx >= sw || sy < 0 || sy >= sh) continue;
      const si = (sy * sw + sx) * 4;
      const di = (dy * size + dx) * 4;
      dstData.data[di]   = srcData.data[si];
      dstData.data[di+1] = srcData.data[si+1];
      dstData.data[di+2] = srcData.data[si+2];
      dstData.data[di+3] = 255;
    }
  }
  ctx.putImageData(dstData, 0, 0);
  return dst;
}

function drawCornersOnCanvas(canvas, imgEl, corners, draggingIdx) {
  if (!canvas || !imgEl || !corners) return;
  const containerW = canvas.parentElement?.clientWidth || 500;
  const scale = Math.min(containerW / imgEl.naturalWidth, 300 / imgEl.naturalHeight);
  const w = Math.round(imgEl.naturalWidth * scale);
  const h = Math.round(imgEl.naturalHeight * scale);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, w, h);
  const pts = corners.map(c => ({ x: c.x * scale, y: c.y * scale }));
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(34,197,94,0.12)'; ctx.fill();
  ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2; ctx.stroke();
  pts.forEach((pt, i) => {
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 10, 0, 2 * Math.PI);
    ctx.fillStyle = draggingIdx === i ? '#15803d' : 'rgba(255,255,255,0.9)'; ctx.fill();
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#15803d'; ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(i + 1, pt.x, pt.y);
  });
}

// ── メインコンポーネント ──────────────────────────────────────────────
export default function ImageImportDialog({ onClose, onApply }) {
  const [imgSrc, setImgSrc]           = useState(null);
  const [imgEl, setImgEl]             = useState(null);
  const [isGoteView, setIsGoteView]   = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [corners, setCorners]         = useState(null);
  const [cornerNote, setCornerNote]   = useState('');
  const [status, setStatus]           = useState('idle');
  const [statusMsg, setStatusMsg]     = useState('');
  const [result, setResult]           = useState(null);
  const [editedBoard, setEditedBoard] = useState(null);
  const [modelReady, setModelReady]   = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [isRedetecting, setIsRedetecting] = useState(false);
  const sourceTypeRef = useRef('photo'); // detectSourceType の結果をキャッシュ

  const imgCanvasRef   = useRef(null);
  const boardCanvasRef = useRef(null);
  const fileRef        = useRef(null);
  const modelRef       = useRef(null);
  const cornersRef     = useRef(null);
  const draggingRef    = useRef(-1);
  const gridLinesRef   = useRef(null);

  useEffect(() => {
    loadModel().then(m => { modelRef.current = m; setModelReady(true); }).catch(e => console.warn('Model load failed:', e));
  }, []);

  // 画像読み込み後にコーナー自動検出
  useEffect(() => {
    if (!imgEl) { setCorners(null); cornersRef.current = null; gridLinesRef.current = null; return; }
    setResult(null); setEditedBoard(null); setStatus('idle'); setStatusMsg('');

    const w = imgEl.naturalWidth, h = imgEl.naturalHeight, p = 0.08;
    const fallback = [
      { x: w * p, y: h * p }, { x: w * (1 - p), y: h * p },
      { x: w * (1 - p), y: h * (1 - p) }, { x: w * p, y: h * (1 - p) },
    ];
    setCorners(fallback); cornersRef.current = fallback; gridLinesRef.current = null;
    setCornerNote('盤面を検出中...');

    const srcType = detectSourceType(imgEl);
    sourceTypeRef.current = srcType;

    let cancelled = false;
    detectCornersInWorker(imgEl, srcType).then(({ ok, corners: c }) => {
      if (cancelled) return;
      if (ok && c) {
        setCorners(c); cornersRef.current = c; gridLinesRef.current = null;
        setCornerNote('盤面を自動検出しました。ずれている場合は番号をドラッグして調整してください。');
      } else {
        setCornerNote('自動検出できませんでした。①②③④を将棋盤の四隅にドラッグして合わせてください。');
      }
    }).catch(() => {
      if (!cancelled) setCornerNote('自動検出できませんでした。①②③④を将棋盤の四隅にドラッグして合わせてください。');
    });

    return () => { cancelled = true; };
  }, [imgEl]);

  // コーナー変更時にキャンバス再描画
  useEffect(() => {
    if (!imgCanvasRef.current || !imgEl || !corners) return;
    drawCornersOnCanvas(imgCanvasRef.current, imgEl, corners, draggingRef.current);
  }, [corners, imgEl]);

  // コーナー変更時にワーププレビュー更新
  useEffect(() => {
    if (!imgEl || !corners || !boardCanvasRef.current) return;
    const eff = isGoteView
      ? [corners[2], corners[3], corners[0], corners[1]]
      : corners;
    const bc = warpJS(imgEl, eff, 144);
    boardCanvasRef.current.width  = bc.width;
    boardCanvasRef.current.height = bc.height;
    boardCanvasRef.current.getContext('2d').drawImage(bc, 0, 0);
  }, [corners, imgEl, isGoteView]);

  // マウス/タッチドラッグ
  const eventToNatural = useCallback((e) => {
    const canvas = imgCanvasRef.current;
    if (!canvas || !imgEl) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (cx - rect.left) / rect.width  * imgEl.naturalWidth,
      y: (cy - rect.top)  / rect.height * imgEl.naturalHeight,
    };
  }, [imgEl]);

  const handleMouseDown = useCallback((e) => {
    if (!cornersRef.current || !imgCanvasRef.current || !imgEl) return;
    e.preventDefault();
    const canvas = imgCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ex = e.touches ? e.touches[0].clientX : e.clientX;
    const ey = e.touches ? e.touches[0].clientY : e.clientY;
    const cssx = ex - rect.left, cssy = ey - rect.top;
    let closest = -1, closestD = 28;
    cornersRef.current.forEach(({ x, y }, i) => {
      const cx2 = x / imgEl.naturalWidth  * rect.width;
      const cy2 = y / imgEl.naturalHeight * rect.height;
      const d = Math.hypot(cssx - cx2, cssy - cy2);
      if (d < closestD) { closestD = d; closest = i; }
    });
    draggingRef.current = closest;
  }, [imgEl]);

  useEffect(() => {
    const onMove = (e) => {
      if (draggingRef.current < 0 || !imgEl) return;
      e.preventDefault();
      const { x, y } = eventToNatural(e);
      const nc = cornersRef.current.map((c, i) => i === draggingRef.current
        ? { x: Math.max(0, Math.min(imgEl.naturalWidth, x)), y: Math.max(0, Math.min(imgEl.naturalHeight, y)) }
        : c);
      cornersRef.current = nc;
      drawCornersOnCanvas(imgCanvasRef.current, imgEl, nc, draggingRef.current);
    };
    const onUp = () => {
      if (draggingRef.current >= 0) { setCorners([...cornersRef.current]); draggingRef.current = -1; }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [imgEl, eventToNatural]);

  const handleFile = useCallback((file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = url;
  }, []);

  const resetCorners = useCallback(async () => {
    if (!imgEl || isRedetecting) return;
    setIsRedetecting(true);
    setCornerNote('再検出中...');
    try {
      const { ok, corners: c } = await detectCornersInWorker(imgEl, sourceTypeRef.current);
      if (ok && c) {
        setCorners(c); cornersRef.current = c; gridLinesRef.current = null;
        setCornerNote('盤面を再検出しました。ずれている場合はドラッグして調整してください。');
      } else {
        setCornerNote('再検出できませんでした。手動で調整してください。');
      }
    } catch {
      setCornerNote('再検出できませんでした。手動で調整してください。');
    } finally {
      setIsRedetecting(false);
    }
  }, [imgEl, isRedetecting]);

  const handleRecognize = useCallback(async () => {
    if (!imgEl || !cornersRef.current) return;
    if (!modelRef.current) { setStatus('error'); setStatusMsg('AIモデルがまだ読み込まれていません。しばらくお待ちください。'); return; }
    setStatus('detecting'); setStatusMsg('盤面を認識中...'); setResult(null); setEditedBoard(null);
    try {
      const srcCanvas = imageToCanvas(imgEl);
      const params = {
        srcCanvas,
        corners: cornersRef.current,
        isGoteView,
        model: modelRef.current,
        onProgress: p => setStatusMsg(`認識中... ${Math.round(p * 100)}%`),
      };
      setStatus('recognizing');
      const resultData = await runPhotoPipeline(params);

      if (resultData.boardCanvas && boardCanvasRef.current) {
        boardCanvasRef.current.width  = resultData.boardCanvas.width;
        boardCanvasRef.current.height = resultData.boardCanvas.height;
        boardCanvasRef.current.getContext('2d').drawImage(resultData.boardCanvas, 0, 0);
      }
      setResult(resultData);
      setEditedBoard(resultData.board.map(row => [...row]));
      setStatus('done');
      setStatusMsg('認識完了！マスをクリックして駒を修正できます。確認後「この局面をセット」を押してください。');
    } catch (e) {
      console.error(e); setStatus('error'); setStatusMsg(`エラー: ${e.message}`);
    }
  }, [imgEl, isGoteView]);

  const handleApply = useCallback(() => {
    if (!result || !editedBoard) return;
    onApply({ board: editedBoard, hands: result.hands, currentPlayer });
  }, [result, editedBoard, currentPlayer, onApply]);

  const handleCellClick = useCallback((row, col) => {
    setEditingCell(prev => (prev?.row === row && prev?.col === col) ? null : { row, col });
  }, []);

  const handleSetPiece = useCallback((row, col, type, player) => {
    setEditedBoard(prev => {
      const next = prev.map(r => [...r]);
      next[row][col] = type ? { type, player, promoted: type.startsWith('+') } : null;
      return next;
    });
    setEditingCell(null);
  }, []);

  const isProcessing = status === 'detecting' || status === 'recognizing';
  const canRecognize = imgEl && corners && !isProcessing && modelReady;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-green-400" />
            <span className="font-bold text-white">実物の将棋盤を読み込む</span>
            <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full border border-green-700/50">AI認識</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">

          {/* 画像選択 / コーナー調整 */}
          {!imgSrc
            ? (
              <div className="border-2 border-dashed border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-green-500 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => handleFile(e.target.files[0])} />
                <Camera size={40} className="mx-auto mb-2 text-gray-500" />
                <p className="text-sm text-gray-400">クリックまたはドラッグ&ドロップで写真を選択</p>
                <p className="text-xs text-gray-500 mt-1">実物の将棋盤の写真に対応（CNNモデルで駒を認識します）</p>
                {!modelReady && (
                  <p className="text-xs text-yellow-400 mt-2 flex items-center justify-center gap-1">
                    <Loader2 size={12} className="animate-spin" />AIモデルを読み込み中...
                  </p>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400">{cornerNote}</p>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <button onClick={resetCorners} disabled={isRedetecting}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300">
                      {isRedetecting ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                      再検出
                    </button>
                    <button
                      onClick={() => { setImgSrc(null); setImgEl(null); setCorners(null); setResult(null); setEditedBoard(null); setStatus('idle'); setStatusMsg(''); if (fileRef.current) fileRef.current.value = ''; }}
                      className="text-xs px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300">
                      別画像
                    </button>
                  </div>
                </div>
                <canvas ref={imgCanvasRef} className="w-full rounded-xl cursor-crosshair block"
                  style={{ touchAction: 'none' }}
                  onMouseDown={handleMouseDown}
                  onTouchStart={handleMouseDown} />
              </div>
            )
          }

          {/* オプション */}
          <div className="flex flex-col sm:flex-row gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none bg-gray-800 rounded-xl px-4 py-3 flex-1">
              <input type="checkbox" checked={isGoteView} onChange={e => setIsGoteView(e.target.checked)} className="w-4 h-4 accent-purple-500" />
              <div>
                <p className="text-sm font-medium text-white">後手側から撮影した写真</p>
                <p className="text-xs text-gray-400">盤面を180度回転して処理します</p>
              </div>
            </label>
            <div className="bg-gray-800 rounded-xl px-4 py-3 flex-1">
              <p className="text-xs text-gray-400 mb-2">この局面の手番</p>
              <div className="flex gap-2">
                {[{ v: 1, label: '▲ 先手番', active: 'bg-blue-600' }, { v: 2, label: '△ 後手番', active: 'bg-red-600' }].map(({ v, label, active }) => (
                  <button key={v} onClick={() => setCurrentPlayer(v)}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-bold transition-colors ${currentPlayer === v ? `${active} text-white` : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 認識ボタン */}
          <button onClick={handleRecognize} disabled={!canRecognize}
            className="w-full py-3 rounded-xl font-bold text-white bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors">
            {isProcessing
              ? <><Loader2 size={18} className="animate-spin" />処理中...</>
              : !modelReady
                ? <><Loader2 size={18} className="animate-spin" />AIモデル読み込み中...</>
                : <><Camera size={18} />盤面を認識する</>}
          </button>

          {/* ステータス */}
          {statusMsg && (
            <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-sm
              ${status === 'error' ? 'bg-red-900/40 border border-red-700/50 text-red-300'
                : status === 'done' ? 'bg-green-900/40 border border-green-700/50 text-green-300'
                : 'bg-blue-900/40 border border-blue-700/50 text-blue-300'}`}>
              {status === 'error'  && <AlertCircle  size={16} className="shrink-0 mt-0.5" />}
              {status === 'done'   && <CheckCircle2 size={16} className="shrink-0 mt-0.5" />}
              {isProcessing        && <Loader2      size={16} className="shrink-0 mt-0.5 animate-spin" />}
              <span>{statusMsg}</span>
            </div>
          )}

          {/* ワーププレビュー */}
          {imgEl && (
            <div>
              <p className="text-xs text-gray-400 mb-1">変換後プレビュー</p>
              <canvas ref={boardCanvasRef} className="w-full max-w-xs mx-auto block rounded-lg border border-gray-700" />
            </div>
          )}

          {/* 認識結果プレビュー（クリックで駒修正） */}
          {editedBoard && result && (
            <BoardEditor
              board={editedBoard}
              hands={result.hands}
              editingCell={editingCell}
              onCellClick={handleCellClick}
              onSetPiece={handleSetPiece}
            />
          )}
        </div>

        <div className="flex gap-2 px-5 py-3 border-t border-gray-700 shrink-0">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors">
            キャンセル
          </button>
          {editedBoard && (
            <button onClick={handleApply}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-green-600 hover:bg-green-500 transition-colors">
              この局面をセット
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 認識結果エディタ ──────────────────────────────────────────────────
function BoardEditor({ board, hands, editingCell, onCellClick, onSetPiece }) {
  return (
    <div className="bg-gray-800 rounded-xl p-3">
      <p className="text-xs text-gray-400 mb-2 font-semibold">
        認識結果 — マスをクリックして駒を修正できます
      </p>
      <HandRow player={2} hand={hands[2]} />
      <div className="grid grid-cols-9 gap-px bg-gray-600 border border-gray-600 rounded my-1 relative">
        {board.map((row, ri) => row.map((cell, ci) => {
          const isEditing = editingCell?.row === ri && editingCell?.col === ci;
          return (
            <div key={`${ri}-${ci}`}
              className={`bg-yellow-900/60 aspect-square flex items-center justify-center text-xs font-bold cursor-pointer relative
                ${isEditing ? 'ring-2 ring-blue-400 z-10' : 'hover:bg-yellow-700/60'}`}
              onClick={() => onCellClick(ri, ci)}>
              {cell
                ? <span className={[
                    cell.player === 2 ? 'rotate-180 inline-block' : '',
                    cell.promoted ? 'text-red-400' : 'text-white',
                  ].join(' ')}>
                    {PIECE_DISPLAY[cell.type] ?? cell.type}
                  </span>
                : null}
              {isEditing && (
                <PiecePicker row={ri} col={ci} currentCell={cell} onSetPiece={onSetPiece} />
              )}
            </div>
          );
        }))}
      </div>
      <HandRow player={1} hand={hands[1]} />
    </div>
  );
}

function PiecePicker({ row, col, currentCell, onSetPiece }) {
  return (
    <div className="absolute top-full left-0 z-20 bg-gray-900 border border-gray-600 rounded-lg shadow-xl p-1 min-w-max"
      onClick={e => e.stopPropagation()}>
      <div className="grid grid-cols-4 gap-0.5 mb-1">
        {ALL_PIECE_TYPES.map(type => (
          <div key={`sente-${type}`} className="flex flex-col gap-0.5">
            {[1, 2].map(player => (
              <button key={player} onClick={() => onSetPiece(row, col, type, player)}
                className={`text-xs px-1 py-0.5 rounded transition-colors font-bold
                  ${currentCell?.type === type && currentCell?.player === player
                    ? 'bg-blue-600 text-white'
                    : type.startsWith('+')
                      ? 'bg-gray-700 text-red-400 hover:bg-gray-600'
                      : 'bg-gray-700 text-white hover:bg-gray-600'}`}>
                {player === 2
                  ? <span className="rotate-180 inline-block">{PIECE_DISPLAY[type] ?? type}</span>
                  : PIECE_DISPLAY[type] ?? type}
              </button>
            ))}
          </div>
        ))}
      </div>
      <button onClick={() => onSetPiece(row, col, null, 0)}
        className="w-full text-xs py-0.5 rounded bg-gray-700 text-gray-400 hover:bg-gray-600">
        空にする
      </button>
    </div>
  );
}

function HandRow({ player, hand }) {
  const pieces = HAND_PIECE_TYPES.filter(t => hand?.[t] > 0);
  return (
    <div className={`flex items-center gap-1 text-xs py-1 ${player === 2 ? 'flex-row-reverse' : ''}`}>
      <span className="text-gray-400 shrink-0">{player === 1 ? '▲持駒:' : '△持駒:'}</span>
      {pieces.length === 0
        ? <span className="text-gray-500">なし</span>
        : pieces.map(t => (
            <span key={t} className="bg-gray-700 rounded px-1.5 py-0.5 text-white font-bold">
              {PIECE_DISPLAY[t]}{hand[t] > 1 ? hand[t] : ''}
            </span>
          ))}
    </div>
  );
}
