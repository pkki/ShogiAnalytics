export function getGrade(rating) {
  const r = Math.max(0, Math.floor(rating ?? 1500));
  if (r >= 3000) return '八段';
  if (r >= 2800) return '七段';
  if (r >= 2600) return '六段';
  if (r >= 2400) return '五段';
  if (r >= 2200) return '四段';
  if (r >= 2000) return '三段';
  if (r >= 1800) return '二段';
  if (r >= 1600) return '初段';
  if (r >= 1500) return '１級';
  if (r >= 1400) return '２級';
  if (r >= 1300) return '３級';
  if (r >= 1200) return '４級';
  if (r >= 1100) return '５級';
  if (r >= 1000) return '６級';
  if (r >= 900)  return '７級';
  if (r >= 800)  return '８級';
  if (r >= 700)  return '９級';
  if (r >= 600)  return '10級';
  if (r >= 500)  return '11級';
  if (r >= 400)  return '12級';
  if (r >= 300)  return '13級';
  if (r >= 200)  return '14級';
  return '15級';
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
