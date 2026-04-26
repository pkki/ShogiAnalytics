import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Camera, Loader2, AlertCircle, CheckCircle2, Monitor, Trees, RotateCcw } from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
import { createWorker } from 'tesseract.js';

// ── 定数 ────────────────────────────────────────────────────────────
const LABEL_TO_PIECE = ['K','K','G','S','N','L','B','R','P','+S','+N','+L','+B','+R','+P'];
const NUM_LABELS     = LABEL_TO_PIECE.length;
const EMPTY_CLASS    = NUM_LABELS * 2;

// shogi-camera _trim_board.py: BASE_SIZE=64, w=14*64=896, h=15*64=960
const BASE_SIZE   = 64;
const WARP_W      = BASE_SIZE * 14; // 896
const WARP_H      = BASE_SIZE * 15; // 960
const CELL_W      = WARP_W / 9;    // ~99.6
const CELL_H      = WARP_H / 9;    // ~106.7

const KANJI_TO_PIECE = {
  '王':'K','玉':'K','飛':'R','竜':'+R','龍':'+R',
  '角':'B','馬':'+B','金':'G','銀':'S','全':'+S',
  '桂':'N','圭':'+N','香':'L','杏':'+L','歩':'P','と':'+P',
};
const PIECE_DISPLAY = {
  'K':'王','R':'飛','+R':'竜','B':'角','+B':'馬','G':'金',
  'S':'銀','+S':'全','N':'桂','+N':'圭','L':'香','+L':'杏','P':'歩','+P':'と',
};
const HAND_PIECE_TYPES = ['R','B','G','S','N','L','P'];
const MODEL_PATH = '/shogi-model/model.json';

// ── 画像ユーティリティ ───────────────────────────────────────────────
function imageToCanvas(imgEl) {
  const c = document.createElement('canvas');
  c.width = imgEl.naturalWidth || imgEl.width;
  c.height = imgEl.naturalHeight || imgEl.height;
  c.getContext('2d').drawImage(imgEl, 0, 0);
  return c;
}

function toGrayscale(imgData) {
  const g = new Float32Array(imgData.width * imgData.height);
  const d = imgData.data;
  for (let i = 0; i < g.length; i++)
    g[i] = (d[i*4]*0.299 + d[i*4+1]*0.587 + d[i*4+2]*0.114) / 255;
  return g;
}

function sobelEdge(gray, w, h) {
  const e = new Float32Array(w * h);
  for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++) {
    const gx = -gray[(y-1)*w+(x-1)] + gray[(y-1)*w+(x+1)] - 2*gray[y*w+(x-1)] + 2*gray[y*w+(x+1)] - gray[(y+1)*w+(x-1)] + gray[(y+1)*w+(x+1)];
    const gy =  gray[(y-1)*w+(x-1)] + 2*gray[(y-1)*w+x] + gray[(y-1)*w+(x+1)] - gray[(y+1)*w+(x-1)] - 2*gray[(y+1)*w+x] - gray[(y+1)*w+(x+1)];
    e[y*w+x] = Math.sqrt(gx*gx + gy*gy);
  }
  return e;
}

function projectEdge(edge, w, h, axis) {
  if (axis === 'h') {
    const s = new Float32Array(h);
    for (let y = 0; y < h; y++) { let sum=0; for (let x=0; x<w; x++) sum+=edge[y*w+x]; s[y]=sum/w; }
    return s;
  }
  const s = new Float32Array(w);
  for (let x = 0; x < w; x++) { let sum=0; for (let y=0; y<h; y++) sum+=edge[y*w+x]; s[x]=sum/h; }
  return s;
}

function findGridLines(scores, count = 10) {
  const len = scores.length;
  const smooth = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum=0, cnt=0;
    for (let d=-2; d<=2; d++) { const j=i+d; if (j>=0&&j<len){sum+=scores[j];cnt++;} }
    smooth[i] = sum/cnt;
  }
  const avg = smooth.reduce((a,b)=>a+b,0)/len;
  const threshold = avg * 1.2;
  const peaks = [];
  for (let i=2; i<len-2; i++) {
    if (smooth[i]<threshold) continue;
    if (smooth[i]>=smooth[i-1]&&smooth[i]>=smooth[i+1]&&smooth[i]>=smooth[i-2]&&smooth[i]>=smooth[i+2]) {
      if (peaks.length>0&&i-peaks[peaks.length-1]<6) { if(smooth[i]>smooth[peaks[peaks.length-1]]) peaks[peaks.length-1]=i; }
      else peaks.push(i);
    }
  }
  if (peaks.length<count) return null;
  let best=null, bestErr=Infinity;
  for (let si=0; si<=peaks.length-count; si++) for (let ei=si+count-1; ei<peaks.length; ei++) {
    const span=peaks[ei]-peaks[si]; if(span<count*3) continue;
    const step=span/(count-1); const selected=[]; let err=0, ok=true;
    for (let k=0; k<count; k++) {
      const expected=peaks[si]+step*k; let b2=null, bd=Infinity;
      for (const p of peaks) { const d=Math.abs(p-expected); if(d<bd){bd=d;b2=p;} }
      if (bd>step*0.4){ok=false;break;} selected.push(b2); err+=bd;
    }
    if (ok&&err<bestErr){bestErr=err;best=selected;}
  }
  return best;
}

function detectBoardCorners(imgCanvas) {
  const MAX=800; let cw=imgCanvas.width, ch=imgCanvas.height, scale=1;
  if (cw>MAX||ch>MAX) { scale=MAX/Math.max(cw,ch); cw=Math.round(cw*scale); ch=Math.round(ch*scale); }
  const small=document.createElement('canvas'); small.width=cw; small.height=ch;
  small.getContext('2d').drawImage(imgCanvas,0,0,cw,ch);
  const imgData=small.getContext('2d').getImageData(0,0,cw,ch);
  const gray=toGrayscale(imgData); const edge=sobelEdge(gray,cw,ch);
  const hLines=findGridLines(projectEdge(edge,cw,ch,'h'),10);
  const vLines=findGridLines(projectEdge(edge,cw,ch,'v'),10);
  if (!hLines||!vLines) return null;
  return [
    {x:vLines[0]/scale, y:hLines[0]/scale},
    {x:vLines[9]/scale, y:hLines[0]/scale},
    {x:vLines[9]/scale, y:hLines[9]/scale},
    {x:vLines[0]/scale, y:hLines[9]/scale},
  ];
}

function computeHomography(src, dst) {
  const A=[], b=[];
  for (let i=0; i<4; i++) {
    const {x:sx,y:sy}=src[i]; const {x:dx,y:dy}=dst[i];
    A.push([sx,sy,1,0,0,0,-dx*sx,-dx*sy]); b.push(dx);
    A.push([0,0,0,sx,sy,1,-dy*sx,-dy*sy]); b.push(dy);
  }
  const n=8; const aug=A.map((row,i)=>[...row,b[i]]);
  for (let col=0; col<n; col++) {
    let mx=col; for(let r=col+1;r<n;r++) if(Math.abs(aug[r][col])>Math.abs(aug[mx][col])) mx=r;
    [aug[col],aug[mx]]=[aug[mx],aug[col]];
    const piv=aug[col][col]; if(Math.abs(piv)<1e-10) return null;
    for(let r=0;r<n;r++) { if(r===col) continue; const f=aug[r][col]/piv; for(let j=col;j<=n;j++) aug[r][j]-=f*aug[col][j]; }
  }
  return [...aug.map((row,i)=>row[n]/row[i]),1];
}

function applyH(H,x,y) { const w=H[6]*x+H[7]*y+H[8]; return {x:(H[0]*x+H[1]*y+H[2])/w, y:(H[3]*x+H[4]*y+H[5])/w}; }

// shogi-cameraと同じサイズでワープ (896×960)
function warpPerspective(srcCanvas, corners, outW, outH) {
  const dst=document.createElement('canvas'); dst.width=outW; dst.height=outH;
  const dstCtx=dst.getContext('2d'); const srcCtx=srcCanvas.getContext('2d');
  const srcD=srcCtx.getImageData(0,0,srcCanvas.width,srcCanvas.height);
  const dstD=dstCtx.getImageData(0,0,outW,outH);
  const H=computeHomography(
    [{x:0,y:0},{x:outW,y:0},{x:outW,y:outH},{x:0,y:outH}], corners,
  );
  if (!H) return null;
  for (let dy=0; dy<outH; dy++) for (let dx=0; dx<outW; dx++) {
    const {x:sx,y:sy}=applyH(H,dx,dy);
    const ix=Math.round(sx), iy=Math.round(sy);
    if (ix<0||iy<0||ix>=srcCanvas.width||iy>=srcCanvas.height) continue;
    const si=(iy*srcCanvas.width+ix)*4; const di=(dy*outW+dx)*4;
    dstD.data[di]=srcD.data[si]; dstD.data[di+1]=srcD.data[si+1];
    dstD.data[di+2]=srcD.data[si+2]; dstD.data[di+3]=255;
  }
  dstCtx.putImageData(dstD,0,0);
  return dst;
}

// ── TF.js 推論 ──────────────────────────────────────────────────────
function classIndexToPiece(idx) {
  if (idx===EMPTY_CLASS) return null;
  const isGote=idx>=NUM_LABELS; const type=LABEL_TO_PIECE[isGote?idx-NUM_LABELS:idx];
  return {type, player:isGote?2:1, promoted:type.startsWith('+')};
}

// shogi-camera normalize_img: アスペクト比保持でリサイズ、白背景64×64に配置
function cellToTensor(boardCanvas, row, col) {
  const sx = Math.round(col * CELL_W), sy = Math.round(row * CELL_H);
  const sw = Math.round(CELL_W),       sh = Math.round(CELL_H);

  // セルを切り出し
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  tmp.getContext('2d').drawImage(boardCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  // normalize_img: アスペクト保持でBASE_SIZEにリサイズ、白背景に中央配置
  const scale = Math.min(BASE_SIZE / sh, BASE_SIZE / sw);
  const rw = Math.round(sw * scale), rh = Math.round(sh * scale);
  const out = document.createElement('canvas');
  out.width = BASE_SIZE; out.height = BASE_SIZE;
  const ctx = out.getContext('2d');
  // 白背景 (normalize_imgの blank = np.full(..., 255))
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, BASE_SIZE, BASE_SIZE);
  const hstart = Math.round((BASE_SIZE - rh) / 2);
  const wstart = Math.round((BASE_SIZE - rw) / 2);
  ctx.drawImage(tmp, 0, 0, sw, sh, wstart, hstart, rw, rh);

  // グレースケール化してテンソルに
  const imgData = ctx.getImageData(0, 0, BASE_SIZE, BASE_SIZE);
  const float32 = new Float32Array(BASE_SIZE * BASE_SIZE);
  const d = imgData.data;
  for (let i = 0; i < float32.length; i++)
    float32[i] = (d[i*4]*0.299 + d[i*4+1]*0.587 + d[i*4+2]*0.114) / 255;
  return tf.tensor4d(float32, [1, BASE_SIZE, BASE_SIZE, 1]);
}

async function recognizeBoardTfjs(model, boardCanvas, onProgress) {
  const board = Array.from({length:9}, ()=>Array(9).fill(null));
  for (let row=0; row<9; row++) for (let col=0; col<9; col++) {
    const tensor = cellToTensor(boardCanvas, row, col);
    const pred = model.predict(tensor);
    const classIdx = (await pred.argMax(1).data())[0];
    tensor.dispose(); pred.dispose();
    board[row][col] = classIndexToPiece(classIdx);
    if (onProgress) onProgress((row*9+col+1)/81);
  }
  return board;
}

// ── OCR（スクショモード）────────────────────────────────────────────
function rotate180(src) {
  const c=document.createElement('canvas'); c.width=src.width; c.height=src.height;
  const ctx=c.getContext('2d'); ctx.translate(c.width/2,c.height/2); ctx.rotate(Math.PI);
  ctx.drawImage(src,-src.width/2,-src.height/2); return c;
}
function cellBrightness(c) {
  const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let sum=0; for(let i=0;i<d.length;i+=4) sum+=(d[i]+d[i+1]+d[i+2])/3;
  return sum/(d.length/4)/255;
}
function textToPiece(t) { for(const[k,v] of Object.entries(KANJI_TO_PIECE)) if(t.includes(k)) return v; return null; }
function extractCell(board,row,col,size,pad=0.12) {
  const p=Math.round(size*pad), sz=size-p*2;
  const c=document.createElement('canvas'); c.width=sz; c.height=sz;
  c.getContext('2d').drawImage(board,col*size+p,row*size+p,sz,sz,0,0,sz,sz); return c;
}
async function recognizeCell(worker,cell,row) {
  if (cellBrightness(cell)>0.85) return null;
  const r1=await worker.recognize(cell); const p1=textToPiece(r1.data.text.trim());
  const r2=await worker.recognize(rotate180(cell)); const p2=textToPiece(r2.data.text.trim());
  if (p1&&p2) return row<=3?{type:p2,player:2}:{type:p1,player:1};
  if (p1) return {type:p1,player:1}; if (p2) return {type:p2,player:2}; return null;
}
async function recognizeBoardOcr(srcCanvas, corners, isGoteView, onProgress) {
  // スクショ用: 正方形576×576にワープ (cornersはhandleRecognizeから渡された手動調整済みコーナー)
  const SIZE=576, CELL=SIZE/9;
  const eff=isGoteView?[corners[2],corners[3],corners[0],corners[1]]:corners;
  const boardCanvas=warpPerspective(srcCanvas,eff,SIZE,SIZE);
  if (!boardCanvas) throw new Error('透視変換に失敗しました');

  const worker=await createWorker('jpn',1,{logger:m=>{if(m.status==='recognizing text'&&onProgress) onProgress(m.progress);}});
  await worker.setParameters({tessedit_char_whitelist:'王玉飛竜龍角馬金銀全桂圭香杏歩と一二三四五六七八九0123456789'});
  const board=Array.from({length:9},()=>Array(9).fill(null));
  for(let row=0;row<9;row++) for(let col=0;col<9;col++) {
    const cell=extractCell(boardCanvas,row,col,CELL); const piece=await recognizeCell(worker,cell,row);
    if(piece) board[row][col]={type:piece.type,player:piece.player,promoted:piece.type.startsWith('+')};
  }
  const margin=srcCanvas.width*0.12, hs=Math.round(srcCanvas.width*0.18);
  const mk=(sx,sy)=>{if(sx<0||sy<0||hs<=0)return null;const c=document.createElement('canvas');c.width=hs;c.height=hs;c.getContext('2d').drawImage(srcCanvas,sx,sy,hs,hs,0,0,hs,hs);return c;};
  let sh=mk(srcCanvas.width-hs-margin,srcCanvas.height-hs-margin), gh=mk(margin,margin);
  if(isGoteView)[sh,gh]=[gh,sh];
  const NUM_KAN={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  const readHand=async(hc)=>{if(!hc)return {};const r=await worker.recognize(hc);const t=r.data.text;const h={};for(const[k,pt] of Object.entries(KANJI_TO_PIECE)){if(pt.startsWith('+'))continue;const idx=t.indexOf(k);if(idx===-1)continue;const nx=t[idx+1];h[pt]=NUM_KAN[nx]??(nx&&/[0-9]/.test(nx)?parseInt(nx):1);}return h;};
  const senteHand=await readHand(sh), goteHand=await readHand(gh);
  await worker.terminate();
  return {board, hands:{1:senteHand,2:goteHand}, boardCanvas};
}

// ── コーナー描画ユーティリティ ───────────────────────────────────────
function drawCornersOnCanvas(canvas, imgEl, corners, draggingIdx) {
  if (!canvas||!imgEl||!corners) return;
  const containerW = canvas.parentElement?.clientWidth || 500;
  const maxH = 300;
  const scale = Math.min(containerW/imgEl.naturalWidth, maxH/imgEl.naturalHeight);
  const w = Math.round(imgEl.naturalWidth*scale), h = Math.round(imgEl.naturalHeight*scale);
  if (canvas.width!==w||canvas.height!==h) { canvas.width=w; canvas.height=h; }
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl,0,0,w,h);
  const pts = corners.map(c=>({x:c.x*scale, y:c.y*scale}));
  // 四角形
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<4;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.closePath(); ctx.fillStyle='rgba(59,130,246,0.12)'; ctx.fill();
  ctx.strokeStyle='#60a5fa'; ctx.lineWidth=2; ctx.stroke();
  // ハンドル
  pts.forEach((pt,i)=>{
    ctx.beginPath(); ctx.arc(pt.x,pt.y,10,0,2*Math.PI);
    ctx.fillStyle=draggingIdx===i?'#1d4ed8':'rgba(255,255,255,0.9)'; ctx.fill();
    ctx.strokeStyle='#3b82f6'; ctx.lineWidth=2.5; ctx.stroke();
    ctx.fillStyle='#1d4ed8'; ctx.font='bold 10px sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(i+1,pt.x,pt.y);
  });
  return scale;
}

// ── メインコンポーネント ─────────────────────────────────────────────
export default function ImageImportDialog({ onClose, onApply }) {
  const [imgSrc,setImgSrc]     = useState(null);
  const [imgEl,setImgEl]       = useState(null);
  const [mode,setMode]         = useState('screenshot');
  const [isGoteView,setIsGoteView] = useState(false);
  const [currentPlayer,setCurrentPlayer] = useState(1);
  const [corners,setCorners]   = useState(null);
  const [cornerNote,setCornerNote] = useState('');
  const [status,setStatus]     = useState('idle');
  const [statusMsg,setStatusMsg] = useState('');
  const [result,setResult]     = useState(null);
  const [modelReady,setModelReady] = useState(false);
  const [previewCanvas,setPreviewCanvas] = useState(null); // warpedボード

  const imgCanvasRef  = useRef(null);
  const boardCanvasRef = useRef(null);
  const fileRef       = useRef(null);
  const modelRef      = useRef(null);
  const cornersRef    = useRef(null);
  const draggingRef   = useRef(-1);
  const scaleRef      = useRef(1);

  // TF.jsモデルをロード
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try {
        const m=await tf.loadLayersModel(MODEL_PATH);
        if (cancelled) return;
        // サニティチェック: 白入力(=空マス)はclass30になるはず
        const testT=tf.ones([1,64,64,1]);
        const testP=m.predict(testT);
        const testClass=(await testP.argMax(1).data())[0];
        testT.dispose(); testP.dispose();
        console.log(`[shogi-camera] model loaded. white→class${testClass} (expect 30=empty)`);
        if(testClass!==30) console.warn('[shogi-camera] WARNING: weight loading may be incorrect!');
        modelRef.current=m; setModelReady(true);
      } catch(e){console.warn('TF model load failed:',e);}
    })();
    return ()=>{cancelled=true;};
  },[]);

  // 画像読み込み後にコーナー検出
  useEffect(()=>{
    if (!imgEl) { setCorners(null); cornersRef.current=null; return; }
    const srcCanvas=imageToCanvas(imgEl);
    const det=detectBoardCorners(srcCanvas);
    let c;
    if (det) {
      c=det; setCornerNote('格子線を検出しました。ずれている場合は番号をドラッグして調整してください。');
    } else {
      const w=imgEl.naturalWidth, h=imgEl.naturalHeight, p=0.08;
      c=[{x:w*p,y:h*p},{x:w*(1-p),y:h*p},{x:w*(1-p),y:h*(1-p)},{x:w*p,y:h*(1-p)}];
      setCornerNote('格子線を自動検出できませんでした。番号①②③④を将棋盤の四隅（左上・右上・右下・左下）にドラッグして合わせてください。');
    }
    setCorners(c);
    cornersRef.current=c;
    setResult(null); setStatus('idle'); setStatusMsg('');
  },[imgEl]);

  // コーナー変更時に画像キャンバスを再描画
  useEffect(()=>{
    if (!imgCanvasRef.current||!imgEl||!corners) return;
    const s=drawCornersOnCanvas(imgCanvasRef.current,imgEl,corners,draggingRef.current);
    if (s) scaleRef.current=s;
  },[corners,imgEl]);

  // コーナー変更時にワーププレビューを即時更新（プレビュー用は小サイズ）
  useEffect(()=>{
    if (!imgEl||!corners||!boardCanvasRef.current) return;
    // photo モードは896×960が必要だが、プレビューは1/3サイズで十分
    const SIZE  = mode==='photo' ? Math.round(WARP_W/3) : 288;
    const SIZEH = mode==='photo' ? Math.round(WARP_H/3) : 288;
    const bc=warpPerspective(imageToCanvas(imgEl),corners,SIZE,SIZEH);
    if (!bc) return;
    boardCanvasRef.current.width=bc.width; boardCanvasRef.current.height=bc.height;
    boardCanvasRef.current.getContext('2d').drawImage(bc,0,0);
  },[corners,imgEl,mode]);

  // CSS表示座標 → 自然画像座標 (scaleRefに依存しない直接変換)
  const eventToNatural = useCallback((e)=>{
    const canvas = imgCanvasRef.current;
    if (!canvas || !imgEl) return {x:0,y:0};
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    // w-fullによりCSS表示領域が画像全体に対応する → CSS比率 × 自然サイズ = 自然座標
    return {
      x: (cx - rect.left) / rect.width  * imgEl.naturalWidth,
      y: (cy - rect.top)  / rect.height * imgEl.naturalHeight,
    };
  }, [imgEl]);

  const handleMouseDown = useCallback((e)=>{
    if (!cornersRef.current || !imgCanvasRef.current || !imgEl) return;
    e.preventDefault();
    const canvas = imgCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ex = e.touches ? e.touches[0].clientX : e.clientX;
    const ey = e.touches ? e.touches[0].clientY : e.clientY;
    // CSS表示空間でヒット判定 (scaleRef不要)
    const cssx = ex - rect.left, cssy = ey - rect.top;
    let closest = -1, closestD = 28; // 28CSSピクセル
    cornersRef.current.forEach(({x,y},i)=>{
      const cx = x / imgEl.naturalWidth  * rect.width;
      const cy = y / imgEl.naturalHeight * rect.height;
      const d = Math.hypot(cssx - cx, cssy - cy);
      if (d < closestD) { closestD = d; closest = i; }
    });
    draggingRef.current = closest;
  }, [imgEl]);

  // mousemove/mouseup はwindowにアタッチ（canvasの外に出ても追従）
  useEffect(()=>{
    const onMove = (e)=>{
      if (draggingRef.current < 0 || !imgEl) return;
      e.preventDefault();
      const {x,y} = eventToNatural(e);
      const nc = cornersRef.current.map((c,i) => i === draggingRef.current
        ? { x: Math.max(0, Math.min(imgEl.naturalWidth,  x)),
            y: Math.max(0, Math.min(imgEl.naturalHeight, y)) }
        : c);
      cornersRef.current = nc;
      drawCornersOnCanvas(imgCanvasRef.current, imgEl, nc, draggingRef.current);
    };
    const onUp = ()=>{
      if (draggingRef.current >= 0) {
        setCorners([...cornersRef.current]);
        draggingRef.current = -1;
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend',  onUp);
    return ()=>{
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };
  }, [imgEl]);

  const handleFile = useCallback((file)=>{
    if (!file) return;
    const url=URL.createObjectURL(file); setImgSrc(url);
    const img=new Image(); img.onload=()=>setImgEl(img); img.src=url;
  },[]);

  const resetCorners = useCallback(()=>{
    if (!imgEl) return;
    const srcCanvas=imageToCanvas(imgEl); const det=detectBoardCorners(srcCanvas);
    if (det){setCorners(det);cornersRef.current=det;setCornerNote('格子線を再検出しました。');}
    else setCornerNote('再検出できませんでした。手動で調整してください。');
  },[imgEl]);

  const handleRecognize = useCallback(async()=>{
    if (!imgEl||!cornersRef.current) return;
    if (mode==='photo'&&!modelRef.current) return;
    setStatus('detecting'); setStatusMsg('盤面をワープ中...'); setResult(null);
    try {
      const srcCanvas=imageToCanvas(imgEl);
      const effectiveCorners=isGoteView
        ?[cornersRef.current[2],cornersRef.current[3],cornersRef.current[0],cornersRef.current[1]]
        :cornersRef.current;

      let resultData;
      if (mode==='photo') {
        // shogi-cameraと同じ896×960でワープ
        const boardCanvas=warpPerspective(srcCanvas,effectiveCorners,WARP_W,WARP_H);
        if (!boardCanvas) throw new Error('透視変換に失敗しました');
        if (boardCanvasRef.current) {
          boardCanvasRef.current.width=WARP_W; boardCanvasRef.current.height=WARP_H;
          boardCanvasRef.current.getContext('2d').drawImage(boardCanvas,0,0);
        }
        setStatus('recognizing'); setStatusMsg('AIモデルで駒を認識中... 0%');
        const board=await recognizeBoardTfjs(modelRef.current,boardCanvas,
          p=>setStatusMsg(`AIモデルで駒を認識中... ${Math.round(p*100)}%`));
        resultData={board,hands:{1:{},2:{}}};
      } else {
        // OCRモードはrecognizeBoardOcr内でisGoteViewを処理するため元コーナーを渡す
        setStatus('recognizing'); setStatusMsg('OCRで駒を認識中...');
        resultData=await recognizeBoardOcr(srcCanvas,cornersRef.current,isGoteView,
          p=>setStatusMsg(`OCRで駒を認識中... ${Math.round(p*100)}%`));
        if (resultData.boardCanvas&&boardCanvasRef.current) {
          boardCanvasRef.current.width=resultData.boardCanvas.width;
          boardCanvasRef.current.height=resultData.boardCanvas.height;
          boardCanvasRef.current.getContext('2d').drawImage(resultData.boardCanvas,0,0);
        }
      }
      setResult(resultData); setStatus('done');
      setStatusMsg(`認識完了！盤面を確認してから「この局面をセット」を押してください。${mode==='photo'?'（持ち駒は手動設定）':''}`);
    } catch(e) {
      console.error(e); setStatus('error'); setStatusMsg(`エラー: ${e.message}`);
    }
  },[imgEl,mode,isGoteView]);

  const handleApply=useCallback(()=>{
    if (!result) return; onApply({board:result.board,hands:result.hands,currentPlayer});
  },[result,currentPlayer,onApply]);

  const isProcessing=status==='detecting'||status==='recognizing';
  const canRecognize=imgEl&&corners&&!isProcessing&&(mode==='screenshot'||modelReady);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-blue-400" />
            <span className="font-bold text-white">画像から盤面を読み込む</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">

          {/* モード */}
          <div className="grid grid-cols-2 gap-2">
            {[{id:'screenshot',icon:<Monitor size={16}/>,label:'スクリーンショット',sub:'OCR認識',color:'blue'},
              {id:'photo',    icon:<Trees size={16}/>,  label:'実物の将棋盤',     sub:'AIモデル (shogi-camera)',color:'green'}
            ].map(m=>(
              <button key={m.id} onClick={()=>{setMode(m.id);setResult(null);setStatus('idle');setStatusMsg('');}}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors text-left
                  ${mode===m.id?(m.color==='blue'?'border-blue-500 bg-blue-900/30 text-white':'border-green-500 bg-green-900/30 text-white'):'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500'}`}>
                <span className={mode===m.id?(m.color==='blue'?'text-blue-400':'text-green-400'):'text-gray-400'}>{m.icon}</span>
                <div><p className="text-sm font-semibold">{m.label}</p><p className="text-xs text-gray-400">{m.sub}{m.id==='photo'&&!modelReady&&<Loader2 size={10} className="inline ml-1 animate-spin text-yellow-400"/>}</p></div>
              </button>
            ))}
          </div>

          {/* 画像選択 */}
          {!imgSrc
            ? <div className="border-2 border-dashed border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500 transition-colors"
                onClick={()=>fileRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0]);}}>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e=>handleFile(e.target.files[0])}/>
                <Camera size={40} className="mx-auto mb-2 text-gray-500"/>
                <p className="text-sm text-gray-400">クリックまたはドラッグ&ドロップで画像を選択</p>
              </div>
            : <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400">番号①②③④を将棋盤の四隅（左上・右上・右下・左下の順）にドラッグして合わせてください</p>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <button onClick={resetCorners} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300">
                      <RotateCcw size={11}/> 再検出
                    </button>
                    <button onClick={()=>{setImgSrc(null);setImgEl(null);setCorners(null);setResult(null);setStatus('idle');setStatusMsg('');fileRef.current.value='';}}
                      className="text-xs px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300">別画像</button>
                  </div>
                </div>
                <canvas ref={imgCanvasRef} className="w-full rounded-xl cursor-crosshair block"
                  style={{touchAction:'none'}}
                  onMouseDown={handleMouseDown}
                  onTouchStart={handleMouseDown}/>
                {cornerNote&&<p className="text-xs text-gray-400 mt-1">{cornerNote}</p>}
              </div>
          }

          {/* オプション */}
          <div className="flex flex-col sm:flex-row gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none bg-gray-800 rounded-xl px-4 py-3 flex-1">
              <input type="checkbox" checked={isGoteView} onChange={e=>setIsGoteView(e.target.checked)} className="w-4 h-4 accent-purple-500"/>
              <div><p className="text-sm font-medium text-white">後手側から撮影した写真</p><p className="text-xs text-gray-400">盤面が180度回転して処理されます</p></div>
            </label>
            <div className="bg-gray-800 rounded-xl px-4 py-3 flex-1">
              <p className="text-xs text-gray-400 mb-2">この局面の手番</p>
              <div className="flex gap-2">
                {[{v:1,label:'▲ 先手番',active:'bg-blue-600'},{v:2,label:'△ 後手番',active:'bg-red-600'}].map(({v,label,active})=>(
                  <button key={v} onClick={()=>setCurrentPlayer(v)}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-bold transition-colors ${currentPlayer===v?`${active} text-white`:'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button onClick={handleRecognize} disabled={!canRecognize}
            className="w-full py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors">
            {isProcessing?<><Loader2 size={18} className="animate-spin"/>処理中...</>:<><Camera size={18}/>盤面を認識する</>}
          </button>

          {statusMsg&&(
            <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-sm ${status==='error'?'bg-red-900/40 border border-red-700/50 text-red-300':status==='done'?'bg-green-900/40 border border-green-700/50 text-green-300':'bg-blue-900/40 border border-blue-700/50 text-blue-300'}`}>
              {status==='error'&&<AlertCircle size={16} className="shrink-0 mt-0.5"/>}
              {status==='done'&&<CheckCircle2 size={16} className="shrink-0 mt-0.5"/>}
              {isProcessing&&<Loader2 size={16} className="shrink-0 mt-0.5 animate-spin"/>}
              <span>{statusMsg}</span>
            </div>
          )}

          {/* コーナー調整後すぐにワーププレビューを表示（両モード共通） */}
          {imgEl&&(
            <div>
              <p className="text-xs text-gray-400 mb-1">変換後プレビュー（コーナー調整の確認用）</p>
              <canvas ref={boardCanvasRef} className="w-full max-w-xs mx-auto block rounded-lg border border-gray-700"/>
            </div>
          )}

          {result&&<BoardPreview board={result.board} hands={result.hands}/>}
          {result&&mode==='photo'&&<p className="text-xs text-gray-500 text-center">※ AIモードは実物の木製将棋盤専用。持ち駒は手動設定してください。</p>}
        </div>

        <div className="flex gap-2 px-5 py-3 border-t border-gray-700 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors">キャンセル</button>
          {result&&<button onClick={handleApply} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-green-600 hover:bg-green-500 transition-colors">この局面をセット</button>}
        </div>
      </div>
    </div>
  );
}

function BoardPreview({board,hands}) {
  return (
    <div className="bg-gray-800 rounded-xl p-3">
      <p className="text-xs text-gray-400 mb-2 font-semibold">認識結果プレビュー</p>
      <HandRow player={2} hand={hands[2]}/>
      <div className="grid grid-cols-9 gap-px bg-gray-600 border border-gray-600 rounded my-1">
        {board.map((row,ri)=>row.map((cell,ci)=>(
          <div key={`${ri}-${ci}`} className="bg-yellow-900/60 aspect-square flex items-center justify-center text-xs font-bold">
            {cell?<span className={cell.player===2?'rotate-180 inline-block text-red-300':'text-white'}>{PIECE_DISPLAY[cell.type]??cell.type}</span>:null}
          </div>
        )))}
      </div>
      <HandRow player={1} hand={hands[1]}/>
    </div>
  );
}

function HandRow({player,hand}) {
  const pieces=HAND_PIECE_TYPES.filter(t=>hand[t]>0);
  return (
    <div className={`flex items-center gap-1 text-xs py-1 ${player===2?'flex-row-reverse':''}`}>
      <span className="text-gray-400 shrink-0">{player===1?'▲持駒:':'△持駒:'}</span>
      {pieces.length===0?<span className="text-gray-500">なし</span>
        :pieces.map(t=><span key={t} className="bg-gray-700 rounded px-1.5 py-0.5 text-white font-bold">{PIECE_DISPLAY[t]}{hand[t]>1?hand[t]:''}</span>)}
    </div>
  );
}
