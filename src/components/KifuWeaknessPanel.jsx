import { useMemo, useState } from 'react';
import { PHASE_DEFS, BLUNDER, MISTAKE, INACCURACY, detectPhase, aggregate } from '../utils/weaknessUtils';

// ── ツリーノードから CPL を計算 ───────────────────────────────────────
function computeCpls(nodes, mainLineIds) {
  const result = [];
  for (let i = 1; i < mainLineIds.length; i++) {
    const node   = nodes[mainLineIds[i]];
    const parent = nodes[mainLineIds[i - 1]];
    if (!node || !parent) continue;
    if (node.evalScore === null || parent.evalScore === null) continue;

    const player  = node.player;   // 1=先手 2=後手
    const moveNum = node.moveNumber;

    const cpl = player === 1
      ? Math.max(0, parent.evalScore - node.evalScore)
      : Math.max(0, node.evalScore  - parent.evalScore);

    // フェーズ: 手を指す直前の局面（parent）で判定
    const cand = parent.savedCandidates?.[0]
      ?? { score: parent.evalScore, isMate: false, mateIn: null };
    const phase = detectPhase(moveNum, cand, parent.hands);

    result.push({ moveNum, player, cpl, phase });
  }
  return result;
}

// ── 精度メーター ─────────────────────────────────────────────────────
function AccuracyMeter({ value }) {
  if (value === null) return null;
  const color = value >= 80 ? '#22c55e' : value >= 60 ? '#eab308' : value >= 40 ? '#f97316' : '#ef4444';
  const r = 26, cx = 34, cy = 34, sw = 7;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <svg width="68" height="68" viewBox="0 0 68 68">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#374151" strokeWidth={sw} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ / 4} strokeLinecap="round" />
        <text x={cx} y={cy + 5} textAnchor="middle" fill={color} fontSize="14" fontWeight="bold">{value}</text>
      </svg>
      <span className="text-xs text-gray-400">精度</span>
    </div>
  );
}

// ── フェーズ行 ───────────────────────────────────────────────────────
function PhaseRow({ def, stats }) {
  const hasData = stats?.count > 0;
  const rangeSub = hasData && stats.minMove !== null
    ? (stats.minMove === stats.maxMove ? `${stats.minMove}手` : `${stats.minMove}〜${stats.maxMove}手`)
    : null;
  const maxVal = Math.max((stats?.blunder ?? 0) + (stats?.mistake ?? 0) + (stats?.inaccuracy ?? 0), 1);

  return (
    <div className={`rounded-lg px-3 py-2 border ${def.colorBg} ${def.colorBorder}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full shrink-0 ${def.colorDot}`} />
          <span className={`font-bold text-xs ${def.colorText}`}>{def.label}</span>
          {rangeSub && <span className="text-xs text-gray-500">{rangeSub}</span>}
        </div>
        {hasData && stats.avgCpl !== null && (
          <span className={`text-xs font-bold ${stats.avgCpl >= BLUNDER ? 'text-red-400' : stats.avgCpl >= MISTAKE ? 'text-orange-400' : 'text-gray-300'}`}>
            avg {stats.avgCpl}cp
          </span>
        )}
      </div>
      {!hasData ? (
        <p className="text-xs text-gray-600">データなし</p>
      ) : (
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            {[
              { label: '悪手',  count: stats.blunder,    color: 'bg-red-500' },
              { label: '疑問手', count: stats.mistake,   color: 'bg-orange-500' },
              { label: '緩手',  count: stats.inaccuracy, color: 'bg-yellow-500' },
            ].map(({ label, count, color }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 w-8 shrink-0">{label}</span>
                <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                  <div className={`${color} h-1.5 rounded-full`} style={{ width: `${(count / maxVal) * 100}%` }} />
                </div>
                <span className="text-xs font-bold text-white w-3 text-right">{count}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center justify-center bg-gray-700/40 rounded px-2 shrink-0">
            <span className="text-base font-bold text-white leading-none">{stats.blunder + stats.mistake}</span>
            <span className="text-xs text-gray-400">ミス</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 弱点アドバイス ───────────────────────────────────────────────────
function WeaknessTip({ phaseStats }) {
  const worst = PHASE_DEFS.reduce((best, ph) => {
    const s = phaseStats[ph.key];
    if (!s || s.count === 0 || s.avgCpl === null) return best;
    return (!best || s.avgCpl > best.avgCpl) ? { ...ph, ...s } : best;
  }, null);
  if (!worst) return null;
  const tips = {
    opening: '序盤の定跡・駒組みを見直しましょう。',
    midgame: '中盤の大局観を磨きましょう。棋譜並べが効果的です。',
    endgame: '終盤の寄せが課題です。詰将棋練習が有効です。',
  };
  return (
    <div className="bg-purple-900/20 border border-purple-700/40 rounded-lg px-3 py-2">
      <p className="text-xs font-bold text-purple-300">
        弱点: <span className="text-white">{worst.label}</span>
        <span className="font-normal text-gray-400 ml-1">（avg {worst.avgCpl}cp）</span>
      </p>
      <p className="text-xs text-gray-400 mt-0.5">{tips[worst.key]}</p>
    </div>
  );
}

// ── メインコンポーネント ─────────────────────────────────────────────
export default function KifuWeaknessPanel({ nodes, mainLineIds }) {
  const [tab, setTab] = useState(1); // 1=先手 2=後手

  const allCpls = useMemo(() => computeCpls(nodes, mainLineIds), [nodes, mainLineIds]);

  const senteCpls = useMemo(() => allCpls.filter(c => c.player === 1), [allCpls]);
  const goteCpls  = useMemo(() => allCpls.filter(c => c.player === 2), [allCpls]);

  const senteResult = useMemo(() => aggregate(senteCpls), [senteCpls]);
  const goteResult  = useMemo(() => aggregate(goteCpls),  [goteCpls]);

  const result = tab === 1 ? senteResult : goteResult;
  const hasData = result.totalMoves > 0;

  return (
    <div className="border-t border-gray-700 px-3 py-3 flex flex-col gap-2.5">
      {/* セクションタイトル */}
      <p className="text-xs font-bold text-gray-300">弱点分析</p>

      {/* タブ */}
      <div className="flex gap-1.5 bg-gray-800 rounded-lg p-1">
        {[
          { v: 1, label: '▲ 先手', accuracy: senteResult.accuracy },
          { v: 2, label: '△ 後手', accuracy: goteResult.accuracy },
        ].map(({ v, label, accuracy }) => (
          <button key={v} onClick={() => setTab(v)}
            className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-1.5
              ${tab === v ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
            {label}
            {accuracy !== null && (
              <span className={`text-xs font-bold ${accuracy >= 70 ? 'text-green-400' : accuracy >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                {accuracy}
              </span>
            )}
          </button>
        ))}
      </div>

      {!hasData ? (
        <p className="text-xs text-gray-500 text-center py-3">
          評価値データがありません
        </p>
      ) : (
        <>
          {/* サマリー */}
          <div className="flex items-center gap-3">
            <AccuracyMeter value={result.accuracy} />
            <div className="flex-1 grid grid-cols-2 gap-1.5">
              {[
                { label: '分析手数', value: result.totalMoves, color: 'text-white' },
                { label: '平均損失', value: result.avgCpl != null ? `${result.avgCpl}cp` : '—', color: 'text-white' },
                { label: '悪手',     value: result.totalBlunder, color: 'text-red-400' },
                { label: '疑問手',   value: result.totalMistake, color: 'text-orange-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-700/50 rounded px-2 py-1">
                  <p className="text-xs text-gray-400 leading-none mb-0.5">{label}</p>
                  <p className={`text-sm font-bold leading-none ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* フェーズ別 */}
          <div className="flex flex-col gap-1.5">
            {PHASE_DEFS.map(def => (
              <PhaseRow key={def.key} def={def} stats={result.phaseStats[def.key]} />
            ))}
          </div>

          {/* アドバイス */}
          <WeaknessTip phaseStats={result.phaseStats} />
        </>
      )}
    </div>
  );
}
