// ── フェーズ定義 ──────────────────────────────────────────────────────
export const PHASE_DEFS = [
  { key: 'opening', label: '序盤', colorBg: 'bg-blue-900/30',   colorBorder: 'border-blue-700/50',   colorText: 'text-blue-300',   colorDot: 'bg-blue-400' },
  { key: 'midgame', label: '中盤', colorBg: 'bg-yellow-900/30', colorBorder: 'border-yellow-700/50', colorText: 'text-yellow-300', colorDot: 'bg-yellow-400' },
  { key: 'endgame', label: '終盤', colorBg: 'bg-red-900/30',    colorBorder: 'border-red-700/50',    colorText: 'text-red-300',    colorDot: 'bg-red-400' },
];

export const BLUNDER    = 500;
export const MISTAKE    = 300;
export const INACCURACY = 100;

// ── 駒交換判定 ───────────────────────────────────────────────────────
const NON_PAWN = ['R', 'B', 'G', 'S', 'N', 'L'];
export function hasNonPawnInHand(hands) {
  return NON_PAWN.some(p => (hands?.[1]?.[p] || 0) + (hands?.[2]?.[p] || 0) > 0);
}

// ── フェーズ判定 ─────────────────────────────────────────────────────
// cand: { score, isMate, mateIn }  hands: { 1: {}, 2: {} }
export function detectPhase(moveNum, cand, hands) {
  if (cand.isMate && cand.mateIn !== null && Math.abs(cand.mateIn) <= 15) return 'endgame';
  if (Math.abs(cand.score) >= 2000) return 'endgame';
  if (moveNum < 40 && !hasNonPawnInHand(hands)) return 'opening';
  return 'midgame';
}

// ── 集計 ─────────────────────────────────────────────────────────────
export function aggregate(cpls) {
  const phaseStats = {};
  for (const ph of PHASE_DEFS) {
    const pc = cpls.filter(c => c.phase === ph.key);
    const moveNums = pc.map(c => c.moveNum);
    phaseStats[ph.key] = {
      count:      pc.length,
      blunder:    pc.filter(c => c.cpl >= BLUNDER).length,
      mistake:    pc.filter(c => c.cpl >= MISTAKE    && c.cpl < BLUNDER).length,
      inaccuracy: pc.filter(c => c.cpl >= INACCURACY && c.cpl < MISTAKE).length,
      avgCpl:     pc.length ? Math.round(pc.reduce((s, c) => s + c.cpl, 0) / pc.length) : null,
      minMove:    moveNums.length ? Math.min(...moveNums) : null,
      maxMove:    moveNums.length ? Math.max(...moveNums) : null,
    };
  }
  const allAvg = cpls.length ? Math.round(cpls.reduce((s, c) => s + c.cpl, 0) / cpls.length) : null;
  return {
    phaseStats,
    totalMoves:   cpls.length,
    totalBlunder: cpls.filter(c => c.cpl >= BLUNDER).length,
    totalMistake: cpls.filter(c => c.cpl >= MISTAKE && c.cpl < BLUNDER).length,
    avgCpl:       allAvg,
    accuracy:     allAvg !== null
      ? Math.max(0, Math.min(100, Math.round(100 * Math.exp(-allAvg / 400))))
      : null,
  };
}
