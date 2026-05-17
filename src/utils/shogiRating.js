// 将棋倶楽部24準拠のレーティング・段級換算
// R1500=初段、50Rごとに1級(三十級〜一級)、150Rごとに1段(初段〜九段)

const KYU_NAMES = [
  '', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '二十一', '二十二', '二十三', '二十四', '二十五', '二十六', '二十七', '二十八', '二十九', '三十',
];

export function getGrade(rating) {
  const r = Math.max(0, Math.floor(rating));
  if (r >= 2700) return '九段';
  if (r >= 2550) return '八段';
  if (r >= 2400) return '七段';
  if (r >= 2250) return '六段';
  if (r >= 2100) return '五段';
  if (r >= 1950) return '四段';
  if (r >= 1800) return '三段';
  if (r >= 1650) return '二段';
  if (r >= 1500) return '初段';
  const kyu = Math.min(30, Math.ceil((1500 - r) / 50));
  return `${KYU_NAMES[kyu]}級`;
}

// Eloレーティング変動計算
// gamesCount が少ないほど K 係数が大きく変動しやすい
export function calcRatingChange(myRating, oppRating, win, gamesCount) {
  const K = gamesCount < 50 ? 32 : gamesCount < 200 ? 16 : 8;
  const E = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  return Math.round(K * ((win ? 1 : 0) - E));
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
