/**
 * 画像の特徴から「screenshot」か「photo」かを自動推定する。
 * 戻り値: 'screenshot' | 'photo'
 */
export function detectSourceType(imgEl) {
  const w = imgEl.naturalWidth, h = imgEl.naturalHeight;

  // スクショ判定条件
  // 1. スマホ画面比率に近い (縦長 9:16〜9:22 または 横長)
  const ratio = w / h;
  const isPhoneRatio = (ratio > 0.35 && ratio < 0.75) || (ratio > 1.33 && ratio < 2.9);

  // 2. 解像度が整数倍っぽい (スクショは偶数解像度が多い)
  const isEvenRes = w % 2 === 0 && h % 2 === 0;

  // 3. 色の均一性（スクショはベタ塗り面積が多い → 色ヒストグラムのピークが高い）
  const c = document.createElement('canvas');
  c.width = 100; c.height = 100;
  c.getContext('2d').drawImage(imgEl, 0, 0, 100, 100);
  const data = c.getContext('2d').getImageData(0, 0, 100, 100).data;
  const colorCounts = new Map();
  let maxCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    // 32段階量子化
    const key = `${data[i]>>3},${data[i+1]>>3},${data[i+2]>>3}`;
    const cnt = (colorCounts.get(key) || 0) + 1;
    colorCounts.set(key, cnt);
    if (cnt > maxCount) maxCount = cnt;
  }
  // 最頻色が全ピクセルの5%超 → フラットな配色 → スクショ
  const isFlat = maxCount > 10000 * 0.05;

  // 4. グラデーション量（写真は滑らかなグラデーションが多い）
  let gradSum = 0;
  for (let i = 0; i < data.length - 4; i += 4) {
    gradSum += Math.abs(data[i] - data[i+4]) + Math.abs(data[i+1] - data[i+5]);
  }
  const avgGrad = gradSum / (data.length / 4);
  const isSmooth = avgGrad < 8; // 低グラデーション = フラット = スクショ

  const score = (isPhoneRatio ? 1 : 0) + (isEvenRes ? 0.5 : 0) + (isFlat ? 1 : 0) + (isSmooth ? 1 : 0);
  return score >= 2 ? 'screenshot' : 'photo';
}
