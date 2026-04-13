import { TrendingUp, TrendingDown, Minus, Cpu, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

function DeltaBadge({ delta }) {
  if (delta === 0) return <Minus size={12} className="text-gray-400" />;
  if (delta > 0) return (
    <span className="flex items-center gap-0.5 text-blue-400 text-xs font-bold">
      <TrendingUp size={12} />+{delta}
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-red-400 text-xs font-bold">
      <TrendingDown size={12} />{delta}
    </span>
  );
}

function EvalBar({ ev, maxEval = 1500 }) {
  const pct = Math.min(100, Math.abs(ev) / maxEval * 100);
  const isPos = ev >= 0;
  return (
    <div className="h-1 bg-gray-700 rounded-full overflow-hidden mt-1">
      <div
        className={`h-full rounded-full transition-all ${isPos ? 'bg-blue-500' : 'bg-red-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── ステータスバッジ ─────────────────────────────────────────
function StatusBadge({ status, t }) {
  if (status === 'thinking') return (
    <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
      <Loader2 size={11} className="animate-spin" />{t('candidates.thinking')}
    </span>
  );
  if (status === 'ready') return (
    <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">{t('candidates.ready')}</span>
  );
  if (status === 'error') return (
    <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">{t('candidates.error')}</span>
  );
  if (status === 'standby') return (
    <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">{t('candidates.standby')}</span>
  );
  // connecting
  return (
    <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">
      <Loader2 size={11} className="animate-spin" />{t('candidates.connecting')}
    </span>
  );
}

export default function CandidateMoves({
  candidates = [], engineStatus = 'connecting', maxDepth = 0,
  multiPV = 5, isSaved = false, onMultiPVChange, onPVClick,
  fillHeight = false,
  compact = false,
}) {
  const { t } = useTranslation();
  const hasData = candidates.length > 0;
  const best = candidates[0];
  const matePrefix = t('candidates.matePrefix');

  return (
    <div className={`flex flex-col ${compact ? 'px-1.5 gap-1 pt-1' : 'px-3 gap-2'} ${fillHeight ? 'h-full' : 'pb-6'}`}>
      {/* ヘッダー行1: タイトル + ステータス */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className={`font-bold text-gray-200 flex items-center gap-1 ${compact ? 'text-xs' : 'text-sm'}`}>
          <Cpu size={compact ? 12 : 14} className="text-blue-400" />
          {t('candidates.title')}
        </h2>
        <div className="flex items-center gap-1.5">
          {isSaved && (
            <span className="text-[10px] text-purple-400 bg-purple-400/10 px-1.5 py-0.5 rounded-full border border-purple-700/40">
              {t('candidates.saved')}
            </span>
          )}
          {maxDepth > 0 && (
            <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded-full">
              {t('analysis.depthLabel')} {maxDepth}
            </span>
          )}
          {!isSaved && <StatusBadge status={engineStatus} t={t} />}
        </div>
      </div>
      {/* MultiPV 選択 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {!compact && <span className="text-xs text-gray-500">{t('candidates.multiPVLabel')}</span>}
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 5, 7, 10].map(n => (
            <button
              key={n}
              onClick={() => onMultiPVChange?.(n)}
              className={`rounded font-bold transition-colors
                ${compact ? 'w-6 h-5 text-[10px]' : 'w-7 h-6 text-xs'}
                ${multiPV === n
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* エンジン未接続 */}
      {!hasData && (
        <div className="flex flex-col items-center gap-2 py-6 text-gray-600">
          <Cpu size={compact ? 20 : 28} />
          <p className="text-xs text-center">
            {engineStatus === 'error'
              ? t('candidates.cannotConnect')
              : t('candidates.waiting')}
          </p>
        </div>
      )}

      {/* 候補手リスト */}
      <div className={`flex flex-col overscroll-y-contain ${compact ? 'gap-1' : 'gap-2'} ${fillHeight ? 'flex-1 min-h-0 overflow-y-auto pb-4' : ''}`}>
        {candidates.map((cand, i) => (
          <div
            key={i}
            className={`bg-gray-800 border transition-colors
              ${compact ? 'rounded-lg p-1.5' : 'rounded-xl p-3'}
              ${i === 0
                ? 'border-blue-500/50 shadow-md shadow-blue-500/10'
                : 'border-gray-700 hover:border-gray-500'}`}
          >
            {/* Row 1: rank · move · eval */}
            <div className={`flex items-center justify-between ${compact ? 'mb-1' : 'mb-1.5'}`}>
              <div className={`flex items-center ${compact ? 'gap-1' : 'gap-2'}`}>
                <span className={`font-bold rounded flex items-center justify-center
                  ${compact ? 'text-[10px] w-4 h-4' : 'text-xs w-5 h-5'}
                  ${i === 0 ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                  {i + 1}
                </span>
                <span className={`font-bold text-white tracking-wider ${compact ? 'text-sm' : 'text-base'}`}>{cand.move}</span>
                {compact && (
                  <span className="text-[10px] text-gray-500 font-normal">
                    {t('analysis.depthLabel')}{cand.depth}{cand.nodes ? ` ${t('analysis.nodesLabel')}${cand.nodes}` : ''}
                  </span>
                )}
              </div>
              <div className={`flex items-center ${compact ? 'gap-1' : 'gap-2'}`}>
                {best && i > 0 && <DeltaBadge delta={cand.score - best.score} />}
                {compact ? (
                  <span className={`font-bold text-sm tabular-nums ${cand.isMate ? (cand.mateIn > 0 ? 'text-blue-400' : 'text-red-400') : (cand.score >= 0 ? 'text-blue-400' : 'text-red-400')}`}>
                    {cand.isMate ? `${matePrefix}${cand.mateIn > 0 ? '+' : ''}${cand.mateIn}` : `${cand.score >= 0 ? '+' : ''}${cand.score}`}
                  </span>
                ) : (
                  <span className={`font-bold text-base tabular-nums ${cand.isMate ? (cand.mateIn > 0 ? 'text-blue-400' : 'text-red-400') : (cand.score >= 0 ? 'text-blue-400' : 'text-red-400')}`}>
                    {cand.isMate
                      ? `${matePrefix}${cand.mateIn > 0 ? '+' : ''}${cand.mateIn}`
                      : `${cand.score >= 0 ? '+' : ''}${cand.score}`}
                  </span>
                )}
              </div>
            </div>

            <EvalBar ev={cand.score} />

            {/* Row 2: depth / nodes (compactでは省略) */}
            {!compact && (
              <div className="flex items-center gap-3 mt-2 mb-1.5 text-xs text-gray-500">
                <span>{t('analysis.depthLabel')} <span className="text-gray-300 font-mono">{cand.depth}</span></span>
                <span>{t('analysis.nodesLabel')} <span className="text-gray-300 font-mono">{cand.nodes}</span></span>
              </div>
            )}

            {/* 読み筋 (クリックで PVBoard 表示) */}
            <button
              onClick={() => onPVClick?.(cand)}
              className={`w-full text-left bg-gray-900/60 hover:bg-gray-900 rounded-lg transition-colors group
                ${compact ? 'px-1.5 py-1 mt-1' : 'px-2 py-1.5'}`}
              title={t('candidates.clickToShowPV')}
            >
              {!compact && (
                <p className="text-xs text-gray-400 mb-0.5 flex items-center justify-between">
                  <span>{t('candidates.pvLabel')}</span>
                  <span className="text-blue-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                    {t('candidates.tapToShow')}
                  </span>
                </p>
              )}
              <p className={`text-gray-200 font-mono tracking-wide ${compact ? 'text-[10px] truncate' : 'text-xs leading-relaxed break-all'}`}>
                {cand.pvJP || cand.pvUSI || '—'}
              </p>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
