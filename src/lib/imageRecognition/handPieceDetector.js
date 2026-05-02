/**
 * 手駒領域を検出してOCRで読み取る。
 * boardCorners: [{x,y}×4] 盤の四隅（自然画像座標）
 * strategy: 'color' | 'gravity' | 'row'
 */

export const HAND_PIECE_TYPES = ['R','B','G','S','N','L','P'];

const KANJI_TO_PIECE = {
  '王':'K','玉':'K','飛':'R','竜':'+R','龍':'+R',
  '角':'B','馬':'+B','金':'G','銀':'S','全':'+S',
  '桂':'N','圭':'+N','香':'L','杏':'+L','歩':'P','と':'+P',
};

const NUM_KAN = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };

/**
 * 盤の上下に手駒領域を切り出して Tesseract で読む。
 * worker: 初期化済み Tesseract worker
 * isGoteView: 後手視点かどうか
 * 戻り値: {1: {P:3,...}, 2: {...}}
 */
export async function readHandPieces(worker, srcCanvas, boardCorners, isGoteView) {
  const W = srcCanvas.width, H = srcCanvas.height;

  // 盤の上端・下端 Y 座標
  const boardTop    = Math.min(boardCorners[0].y, boardCorners[1].y);
  const boardBottom = Math.max(boardCorners[2].y, boardCorners[3].y);
  const boardLeft   = Math.min(boardCorners[0].x, boardCorners[3].x);
  const boardRight  = Math.max(boardCorners[1].x, boardCorners[2].x);
  const boardW      = boardRight - boardLeft;

  // 手駒領域: 盤の上/下に張り付いている帯状エリア
  const margin = boardW * 0.05;
  const handH  = Math.max(30, Math.round((boardTop - margin) * 0.7));

  const topRegion    = _cutRegion(srcCanvas, boardLeft - margin, Math.max(0, boardTop - handH - margin), boardW + margin * 2, handH);
  const bottomRegion = _cutRegion(srcCanvas, boardLeft - margin, Math.min(H - 1, boardBottom + margin), boardW + margin * 2, handH);

  const [goteHand, senteHand] = await Promise.all([
    _parseHandRegion(worker, topRegion),
    _parseHandRegion(worker, bottomRegion),
  ]);

  if (isGoteView) {
    return { 1: goteHand, 2: senteHand };
  }
  return { 1: senteHand, 2: goteHand };
}

function _cutRegion(srcCanvas, x, y, w, h) {
  const cx = Math.max(0, Math.round(x));
  const cy = Math.max(0, Math.round(y));
  const cw = Math.min(srcCanvas.width - cx, Math.round(w));
  const ch = Math.min(srcCanvas.height - cy, Math.round(h));
  if (cw <= 0 || ch <= 0) return null;
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  c.getContext('2d').drawImage(srcCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
  return c;
}

async function _parseHandRegion(worker, regionCanvas) {
  const hand = {};
  if (!regionCanvas) return hand;

  const result = await worker.recognize(regionCanvas);
  const text = result.data.text;

  // パターン: (駒漢字)(枚数) or (駒漢字)×(枚数) or 駒漢字のみ
  const piecePattern = /([王玉飛竜龍角馬金銀全桂圭香杏歩と])[×x×]?([一二三四五六七八九0-9]?)/g;
  let m;
  while ((m = piecePattern.exec(text)) !== null) {
    const kanji = m[1];
    const piece = KANJI_TO_PIECE[kanji];
    if (!piece || piece.startsWith('+')) continue; // 手駒に成駒なし
    const numStr = m[2];
    const count = NUM_KAN[numStr] ?? (numStr ? parseInt(numStr, 10) : 1);
    if (!isNaN(count) && count > 0) {
      hand[piece] = (hand[piece] || 0) + count;
    }
  }

  return hand;
}
