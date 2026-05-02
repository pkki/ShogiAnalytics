import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Upload, RotateCcw, Save, Download, Trash2, ChevronRight, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { detectCornersInWorker, warpInWorker } from '../lib/imageRecognition/workerClient.js';
import { detectSourceType }   from '../lib/imageRecognition/sourceDetector.js';
import { saveSample, getSampleCounts, clearAllSamples, exportZip } from '../lib/trainingStore.js';

// ── 定数 ─────────────────────────────────────────────────────────────
const ADMIN_PASS = import.meta.env.VITE_ADMIN_PASSWORD || 'shogiml';
const WARP_SIZE  = 576;
const CELL_SIZE  = WARP_SIZE / 9; // 64px

// クラス定義（pieceClassifier.js / train.py と完全一致）
const PIECE_ORDER = ['K','G','S','N','L','B','R','P','+S','+N','+L','+B','+R','+P'];
const ALL_CLASSES = [
  ...PIECE_ORDER.map(t => `sente_${t}`),
  ...PIECE_ORDER.map(t => `gote_${t}`),
  'empty',
];
const PIECE_JP = { K:'王',G:'金',S:'銀',N:'桂',L:'香',B:'角',R:'飛',P:'歩','+S':'全','+N':'圭','+L':'杏','+B':'馬','+R':'竜','+P':'と' };

// 平手初期配置 [row][col] → label | null
const INITIAL_BOARD = (() => {
  const b = Array.from({ length: 9 }, () => Array(9).fill(null));
  const bk = ['L','N','S','G','K','G','S','N','L'];
  bk.forEach((p, c) => { b[0][c] = `gote_${p}`; b[8][c] = `sente_${p}`; });
  [1,7].forEach(c => b[2][c] = `gote_P`);
  [0,1,2,3,4,5,6].forEach(c => { if(c!==1&&c!==7) b[2][c] = `gote_P`; });
  for (let c = 0; c < 9; c++) { b[2][c] = `gote_P`; b[6][c] = `sente_P`; }
  b[1][1] = 'gote_R';  b[1][7] = 'gote_B';
  b[7][1] = 'sente_B'; b[7][7] = 'sente_R';
  return b;
})();

// ── ユーティリティ ────────────────────────────────────────────────────
function drawCorners(canvas, imgEl, corners, dragIdx) {
  if (!canvas || !imgEl || !corners) return;
  const cw = canvas.parentElement?.clientWidth || 600;
  const scale = Math.min(cw / imgEl.naturalWidth, 360 / imgEl.naturalHeight);
  const w = Math.round(imgEl.naturalWidth  * scale);
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
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = dragIdx === i ? '#15803d' : 'rgba(255,255,255,0.9)'; ctx.fill();
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#15803d'; ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(i + 1, pt.x, pt.y);
  });
}

function cellToDataUrl(boardImageData, row, col, size = WARP_SIZE) {
  const cell = size / 9;
  const pad  = Math.round(cell * 0.12);
  const x0   = Math.round(col * cell) + pad;
  const y0   = Math.round(row * cell) + pad;
  const sw   = Math.round(cell) - pad * 2;
  const sh   = Math.round(cell) - pad * 2;
  const c    = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx  = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 64, 64);
  // グレースケール変換
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  tmp.getContext('2d').putImageData(
    new ImageData(
      new Uint8ClampedArray(boardImageData.data.buffer, (y0 * size + x0) * 4, sw * sh * 4),
      sw, sh
    ), 0, 0
  );
  // グレー変換して 64×64 へ
  const raw = tmp.getContext('2d').getImageData(0, 0, sw, sh);
  const gray = document.createElement('canvas');
  gray.width = sw; gray.height = sh;
  const gctx = gray.getContext('2d');
  const gd   = gctx.createImageData(sw, sh);
  for (let i = 0; i < raw.data.length; i += 4) {
    const v = raw.data[i] * 0.299 + raw.data[i+1] * 0.587 + raw.data[i+2] * 0.114;
    gd.data[i] = gd.data[i+1] = gd.data[i+2] = v; gd.data[i+3] = 255;
  }
  gctx.putImageData(gd, 0, 0);
  ctx.drawImage(gray, 0, 0, 64, 64);
  return c.toDataURL('image/png');
}

// ── パスワードゲート ───────────────────────────────────────────────────
function PasswordGate({ onOk }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(false);
  const submit = () => {
    if (pw === ADMIN_PASS) { onOk(); }
    else { setErr(true); setTimeout(() => setErr(false), 1500); }
  };
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-80 flex flex-col gap-4">
        <h1 className="text-white font-bold text-xl text-center">管理者ログイン</h1>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="パスワード" autoFocus
          className="bg-gray-800 border border-gray-600 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-green-500" />
        {err && <p className="text-red-400 text-xs text-center">パスワードが違います</p>}
        <button onClick={submit}
          className="py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold transition-colors">
          ログイン
        </button>
      </div>
    </div>
  );
}

// ── メインUI ─────────────────────────────────────────────────────────
export default function AdminTrainingPage() {
  const [authed, setAuthed] = useState(false);
  if (!authed) return <PasswordGate onOk={() => setAuthed(true)} />;
  return <TrainingUI />;
}

function TrainingUI() {
  const [step, setStep]                 = useState('upload'); // upload | label | stats
  const [imgEl, setImgEl]               = useState(null);
  const [corners, setCorners]           = useState(null);
  const [cornerNote, setCornerNote]     = useState('');
  const [isRedetecting, setIsRedetecting] = useState(false);
  const [cells, setCells]               = useState(null);  // string[81] dataUrls
  const [labels, setLabels]             = useState(null);  // string[81] | null
  const [editingIdx, setEditingIdx]     = useState(null);
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState('');
  const [counts, setCounts]             = useState({});
  const [exporting, setExporting]       = useState(false);
  const [sourceName, setSourceName]     = useState('');

  const canvasRef    = useRef(null);
  const cornersRef   = useRef(null);
  const dragRef      = useRef(-1);
  const fileRef      = useRef(null);

  // 統計を読み込む
  const refreshCounts = useCallback(() => {
    getSampleCounts().then(setCounts);
  }, []);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  // 画像選択
  const handleFile = useCallback(file => {
    if (!file) return;
    setSourceName(file.name);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      setCells(null); setLabels(null); setEditingIdx(null);
      setStep('upload');
      const w = img.naturalWidth, h = img.naturalHeight, p = 0.08;
      const fb = [
        { x: w*p, y: h*p }, { x: w*(1-p), y: h*p },
        { x: w*(1-p), y: h*(1-p) }, { x: w*p, y: h*(1-p) },
      ];
      setCorners(fb); cornersRef.current = fb;
      setCornerNote('盤面を検出中...');
      const srcType = detectSourceType(img);
      detectCornersInWorker(img, srcType).then(({ ok, corners: c }) => {
        if (ok && c) {
          setCorners(c); cornersRef.current = c;
          setCornerNote('自動検出しました。ずれていればドラッグで調整してください。');
        } else {
          setCornerNote('①②③④を将棋盤の四隅にドラッグして合わせてください。');
        }
      }).catch(() => setCornerNote('①②③④を将棋盤の四隅にドラッグして合わせてください。'));
    };
    img.src = url;
  }, []);

  // キャンバス再描画
  useEffect(() => {
    if (!canvasRef.current || !imgEl || !corners) return;
    drawCorners(canvasRef.current, imgEl, corners, dragRef.current);
  }, [corners, imgEl]);

  // ドラッグ
  const handleMouseDown = useCallback(e => {
    if (!cornersRef.current || !canvasRef.current || !imgEl) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const ex = e.touches ? e.touches[0].clientX : e.clientX;
    const ey = e.touches ? e.touches[0].clientY : e.clientY;
    const cx = ex - rect.left, cy = ey - rect.top;
    let best = -1, bestD = 28;
    cornersRef.current.forEach(({ x, y }, i) => {
      const px = x / imgEl.naturalWidth  * rect.width;
      const py = y / imgEl.naturalHeight * rect.height;
      const d  = Math.hypot(cx - px, cy - py);
      if (d < bestD) { bestD = d; best = i; }
    });
    dragRef.current = best;
  }, [imgEl]);

  useEffect(() => {
    const onMove = e => {
      if (dragRef.current < 0 || !imgEl || !canvasRef.current) return;
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const ex = e.touches ? e.touches[0].clientX : e.clientX;
      const ey = e.touches ? e.touches[0].clientY : e.clientY;
      const x = (ex - rect.left) / rect.width  * imgEl.naturalWidth;
      const y = (ey - rect.top)  / rect.height * imgEl.naturalHeight;
      const nc = cornersRef.current.map((c, i) => i === dragRef.current
        ? { x: Math.max(0, Math.min(imgEl.naturalWidth, x)), y: Math.max(0, Math.min(imgEl.naturalHeight, y)) }
        : c);
      cornersRef.current = nc;
      drawCorners(canvasRef.current, imgEl, nc, dragRef.current);
    };
    const onUp = () => {
      if (dragRef.current >= 0) { setCorners([...cornersRef.current]); dragRef.current = -1; }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend',  onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };
  }, [imgEl]);

  // 再検出
  const redetect = useCallback(async () => {
    if (!imgEl || isRedetecting) return;
    setIsRedetecting(true);
    setCornerNote('再検出中...');
    try {
      const srcType = detectSourceType(imgEl);
      const { ok, corners: c } = await detectCornersInWorker(imgEl, srcType);
      if (ok && c) {
        setCorners(c); cornersRef.current = c;
        setCornerNote('再検出しました。');
      } else {
        setCornerNote('再検出できませんでした。手動で調整してください。');
      }
    } catch {
      setCornerNote('再検出できませんでした。手動で調整してください。');
    } finally {
      setIsRedetecting(false);
    }
  }, [imgEl, isRedetecting]);

  // セル抽出
  const extractCells = useCallback(async () => {
    if (!imgEl || !cornersRef.current) return;
    setCornerNote('セルを抽出中...');
    try {
      const c = document.createElement('canvas');
      c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight;
      c.getContext('2d').drawImage(imgEl, 0, 0);
      const warp = await warpInWorker(c, cornersRef.current, WARP_SIZE);
      if (!warp?.ok) throw new Error('透視変換失敗');

      // ImageData をフラットな Uint8ClampedArray から作る
      const boardImageData = {
        data: warp.imageData,
        width: WARP_SIZE,
        height: WARP_SIZE,
      };

      // 81セルを正しく切り出す
      const dataUrls = [];
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          dataUrls.push(extractCellDataUrl(warp.imageData, WARP_SIZE, row, col));
        }
      }
      setCells(dataUrls);
      setLabels(Array(81).fill(null));
      setStep('label');
      setCornerNote('');
    } catch (e) {
      setCornerNote(`エラー: ${e.message}`);
    }
  }, [imgEl]);

  // ラベル操作
  const setLabel = useCallback((idx, label) => {
    setLabels(prev => { const n = [...prev]; n[idx] = label; return n; });
    setEditingIdx(null);
  }, []);

  const autoLabelInitial = useCallback(() => {
    setLabels(INITIAL_BOARD.flat());
  }, []);

  // 保存
  const handleSave = useCallback(async () => {
    if (!cells || !labels) return;
    const labeled = labels.map((l, i) => ({ label: l, dataUrl: cells[i] })).filter(x => x.label);
    if (!labeled.length) { setSaveMsg('ラベルがありません'); return; }
    setSaving(true);
    try {
      await Promise.all(labeled.map(({ label, dataUrl }) =>
        saveSample({ label, imageDataUrl: dataUrl, source: sourceName })
      ));
      setSaveMsg(`✓ ${labeled.length} 枚を保存しました`);
      refreshCounts();
    } catch (e) {
      setSaveMsg(`エラー: ${e.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  }, [cells, labels, sourceName, refreshCounts]);

  // エクスポート
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await exportZip();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `shogi_training_${Date.now()}.zip`;
      a.click();
    } catch (e) {
      alert(`エクスポートエラー: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }, []);

  const handleClear = useCallback(async () => {
    if (!confirm('全データを削除しますか？')) return;
    await clearAllSamples();
    setCounts({});
  }, []);

  const totalSamples = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ヘッダー */}
      <div className="bg-gray-900 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Camera size={20} className="text-green-400" />
          <span className="font-bold text-lg">管理者 — 学習データ収集</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">蓄積: <span className="text-white font-bold">{totalSamples}</span> 枚</span>
          <button onClick={handleExport} disabled={!totalSamples || exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-sm font-semibold transition-colors">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            ZIPエクスポート
          </button>
          <button onClick={handleClear} disabled={!totalSamples}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 disabled:opacity-40 text-sm transition-colors">
            <Trash2 size={14} /> 全削除
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 flex gap-6">
        {/* 左: 画像 + コーナー */}
        <div className="w-96 shrink-0 flex flex-col gap-4">
          {/* アップロード */}
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 flex flex-col gap-3">
            <p className="text-sm font-semibold text-gray-300">① 写真をアップロード</p>
            <div className="border-2 border-dashed border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-green-500 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => handleFile(e.target.files[0])} />
              <Upload size={28} className="mx-auto mb-1 text-gray-500" />
              <p className="text-xs text-gray-400">クリックまたはドラッグ&ドロップ</p>
            </div>

            {imgEl && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400 flex-1 mr-2">{cornerNote}</p>
                  <button onClick={redetect} disabled={isRedetecting}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 shrink-0">
                    {isRedetecting ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />} 再検出
                  </button>
                </div>
                <canvas ref={canvasRef} className="w-full rounded-xl cursor-crosshair block"
                  style={{ touchAction: 'none' }}
                  onMouseDown={handleMouseDown}
                  onTouchStart={handleMouseDown} />
                <button onClick={extractCells}
                  className="w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-500 font-bold text-sm flex items-center justify-center gap-2 transition-colors">
                  <ChevronRight size={16} /> セルを切り出す
                </button>
              </>
            )}
          </div>

          {/* クラス統計 */}
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4">
            <p className="text-sm font-semibold text-gray-300 mb-2">蓄積データ数</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs max-h-60 overflow-y-auto">
              {ALL_CLASSES.map(cls => (
                <div key={cls} className="flex justify-between text-gray-400">
                  <span>{cls}</span>
                  <span className={counts[cls] ? 'text-green-400 font-bold' : 'text-gray-600'}>
                    {counts[cls] || 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右: ラベリング */}
        <div className="flex-1 flex flex-col gap-4">
          {step === 'upload' && !cells && (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
              写真をアップロードしてセルを切り出してください
            </div>
          )}

          {step === 'label' && cells && (
            <>
              <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-300">② 各マスの駒を選択</p>
                  <div className="flex gap-2">
                    <button onClick={autoLabelInitial}
                      className="text-xs px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 font-semibold transition-colors">
                      平手初期配置を自動入力
                    </button>
                    <button onClick={() => setLabels(Array(81).fill('empty'))}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors">
                      全マス空に
                    </button>
                  </div>
                </div>

                {/* 9×9 グリッド */}
                <div className="grid grid-cols-9 gap-0.5 bg-amber-900/30 border border-amber-700/40 rounded-lg p-1">
                  {cells.map((dataUrl, idx) => {
                    const row = Math.floor(idx / 9), col = idx % 9;
                    const label = labels?.[idx];
                    const isEditing = editingIdx === idx;
                    return (
                      <div key={idx} className="relative aspect-square">
                        <button
                          className={`w-full h-full rounded-sm overflow-hidden border transition-all ${
                            isEditing ? 'border-blue-400 ring-1 ring-blue-400 z-10' :
                            label ? 'border-green-600/50' : 'border-gray-600/30 hover:border-gray-400'}`}
                          onClick={() => setEditingIdx(isEditing ? null : idx)}>
                          <img src={dataUrl} alt="" className="w-full h-full object-cover" style={{ imageRendering: 'pixelated' }} />
                          {label && (
                            <div className="absolute inset-0 flex items-end justify-center pb-0.5 pointer-events-none">
                              <span className={`text-[8px] font-bold px-0.5 rounded leading-none ${
                                label === 'empty' ? 'text-gray-500' :
                                label.startsWith('sente') ? 'text-blue-300 bg-blue-900/60' : 'text-red-300 bg-red-900/60'
                              }`}>
                                {label === 'empty' ? '空' : PIECE_JP[label.replace(/^(sente|gote)_/, '')] ?? '?'}
                              </span>
                            </div>
                          )}
                        </button>
                        {isEditing && (
                          <LabelPicker
                            onSelect={lbl => setLabel(idx, lbl)}
                            onClose={() => setEditingIdx(null)}
                            current={label}
                            row={row} col={col}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 保存 */}
                <div className="flex items-center gap-3">
                  <button onClick={handleSave} disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 font-bold transition-colors">
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    ラベル済みを保存
                  </button>
                  <span className="text-sm">
                    <span className="text-green-400 font-bold">{labels?.filter(Boolean).length ?? 0}</span>
                    <span className="text-gray-400"> / 81 ラベル済み</span>
                  </span>
                  {saveMsg && (
                    <span className={`text-sm flex items-center gap-1 ${saveMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                      {saveMsg.startsWith('✓') ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      {saveMsg}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── セルからグレースケール64×64 DataURL を生成 ──────────────────────
function extractCellDataUrl(imageData, boardSize, row, col) {
  const cell = boardSize / 9;
  const pad  = Math.round(cell * 0.12);
  const x0   = Math.round(col * cell) + pad;
  const y0   = Math.round(row * cell) + pad;
  const sw   = Math.round(cell) - pad * 2;
  const sh   = sw;

  const c   = document.createElement('canvas');
  c.width   = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 64, 64);

  // ピクセルをグレースケール変換しながら tmp canvas へ
  const grayArr = new Uint8ClampedArray(sw * sh * 4);
  for (let dy = 0; dy < sh; dy++) {
    for (let dx = 0; dx < sw; dx++) {
      const si = ((y0 + dy) * boardSize + (x0 + dx)) * 4;
      const v  = imageData[si] * 0.299 + imageData[si+1] * 0.587 + imageData[si+2] * 0.114;
      const di = (dy * sw + dx) * 4;
      grayArr[di] = grayArr[di+1] = grayArr[di+2] = v; grayArr[di+3] = 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  tmp.getContext('2d').putImageData(new ImageData(grayArr, sw, sh), 0, 0);
  ctx.drawImage(tmp, 0, 0, 64, 64);
  return c.toDataURL('image/png');
}

// ── ラベルピッカー ────────────────────────────────────────────────────
function LabelPicker({ onSelect, onClose, current, row, col }) {
  const above = row >= 6; // グリッド下半分はピッカーを上に出す
  return (
    <div
      className={`absolute ${above ? 'bottom-full mb-1' : 'top-full mt-1'} left-1/2 -translate-x-1/2 z-30
        bg-gray-900 border border-gray-600 rounded-xl shadow-2xl p-2 min-w-[200px]`}
      onClick={e => e.stopPropagation()}>
      <div className="flex flex-col gap-1">
        {/* 先手 */}
        <p className="text-[10px] text-blue-400 font-bold px-1">先手</p>
        <div className="grid grid-cols-7 gap-0.5">
          {PIECE_ORDER.map(t => (
            <button key={`s_${t}`}
              onClick={() => onSelect(`sente_${t}`)}
              className={`text-[10px] py-0.5 px-1 rounded font-bold transition-colors ${
                current === `sente_${t}` ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'
              } ${t.startsWith('+') ? 'text-red-300' : ''}`}>
              {PIECE_JP[t]}
            </button>
          ))}
        </div>
        {/* 後手 */}
        <p className="text-[10px] text-red-400 font-bold px-1 mt-1">後手</p>
        <div className="grid grid-cols-7 gap-0.5">
          {PIECE_ORDER.map(t => (
            <button key={`g_${t}`}
              onClick={() => onSelect(`gote_${t}`)}
              className={`text-[10px] py-0.5 px-1 rounded font-bold transition-colors ${
                current === `gote_${t}` ? 'bg-red-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'
              } ${t.startsWith('+') ? 'text-red-300' : ''}`}>
              {PIECE_JP[t]}
            </button>
          ))}
        </div>
        {/* 空 */}
        <button onClick={() => onSelect('empty')}
          className={`mt-1 w-full text-[10px] py-1 rounded transition-colors ${
            current === 'empty' ? 'bg-gray-500 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-400'
          }`}>
          空マス
        </button>
        <button onClick={onClose}
          className="w-full text-[10px] py-0.5 rounded bg-gray-800 text-gray-500 hover:bg-gray-700">
          閉じる
        </button>
      </div>
    </div>
  );
}
