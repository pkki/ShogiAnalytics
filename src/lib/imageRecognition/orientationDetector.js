/**
 * 駒の向き（先手=1 / 後手=2）をピクセルから判定する。
 *
 * strategy: 'color' | 'gravity'
 *   - color:   R チャンネルが突出していれば後手（将棋ウォーズ等の赤駒）
 *   - gravity: 文字輝度重心が下寄りなら先手、上寄りなら後手
 *              （上下反転表示型アプリ用）
 */
export function detectPlayerByColor(cellCanvas) {
  const { data, width, height } = cellCanvas.getContext('2d')
    .getImageData(0, 0, cellCanvas.width, cellCanvas.height);
  // 中央60%の領域だけ見る
  const px = Math.round(width * 0.2), py = Math.round(height * 0.2);
  const pw = Math.round(width * 0.6), ph = Math.round(height * 0.6);
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  for (let y = py; y < py + ph; y++) {
    for (let x = px; x < px + pw; x++) {
      const i = (y * width + x) * 4;
      rSum += data[i]; gSum += data[i+1]; bSum += data[i+2]; n++;
    }
  }
  if (n === 0) return null;
  const r = rSum / n, g = gSum / n, b = bSum / n;
  // R チャンネルが G/B より 20 以上突出 → 後手（赤系）
  if (r > g + 20 && r > b + 20) return 2;
  return null; // 不明（呼び出し元で別手段を使う）
}

/**
 * 輝度重心で判定。
 * 下半分の暗ピクセル密度 > 上半分 → 文字が下向き → 先手
 */
export function detectPlayerByGravity(cellCanvas) {
  const { data, width, height } = cellCanvas.getContext('2d')
    .getImageData(0, 0, cellCanvas.width, cellCanvas.height);
  const half = Math.floor(height / 2);
  let darkTop = 0, darkBottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
      if (lum < 100) {
        if (y < half) darkTop++; else darkBottom++;
      }
    }
  }
  // 文字が上半分に集中 → 後手（上下反転駒）
  if (darkTop > darkBottom * 1.5) return 2;
  if (darkBottom > darkTop * 1.5) return 1;
  return null;
}

/**
 * 複合判定。color → gravity の順で試す。
 * どちらも不明なら defaultPlayer を返す。
 */
export function detectPlayer(cellCanvas, defaultPlayer = 1) {
  return detectPlayerByColor(cellCanvas)
    ?? detectPlayerByGravity(cellCanvas)
    ?? defaultPlayer;
}

/**
 * 盤全体のサンプルから「color判定が有効か / gravity判定が有効か」を自動選択する。
 * boardCanvas: ワープ済み正方形キャンバス
 * 戻り値: 'color' | 'gravity' | 'row'
 */
export function autoSelectStrategy(boardCanvas) {
  const w = boardCanvas.width, h = boardCanvas.height;
  const cell = Math.floor(w / 9);
  const ctx = boardCanvas.getContext('2d');
  let redCount = 0, total = 0;

  // 数セルをサンプル
  const samples = [[0,0],[0,4],[0,8],[4,0],[4,4],[4,8],[8,0],[8,4],[8,8]];
  for (const [row, col] of samples) {
    const x = col * cell, y = row * cell;
    const id = ctx.getImageData(x + cell*0.2, y + cell*0.2, cell*0.6, cell*0.6);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > d[i+1] + 20 && d[i] > d[i+2] + 20) redCount++;
      total++;
    }
  }
  // 5% 以上のピクセルが赤系なら color 判定が有効
  return (redCount / total > 0.05) ? 'color' : 'gravity';
}
