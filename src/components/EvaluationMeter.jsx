import { useTranslation } from 'react-i18next';
import { CURRENT_EVAL } from '../data/mockData';

// evalをパーセント（先手有利比率）に変換
// 0cp = 50%, +∞ → 100%, -∞ → 0%
function evalToPercent(ev) {
  // シグモイド変換
  return 50 + 50 * (2 / (1 + Math.exp(-ev / 600)) - 1);
}

// 縦型形勢バー（盤面右横・モバイル用）
// 上=後手(赤)、下=先手(青)
export function EvalBarVertical({ evalValue = 0 }) {
  const sentePct = evalToPercent(evalValue);
  const gotePct  = 100 - sentePct;
  return (
    <div className="flex flex-col overflow-hidden rounded-sm flex-shrink-0"
         style={{ width: 12, alignSelf: 'stretch' }}>
      <div className="transition-all duration-500 ease-out"
           style={{ height: `${gotePct}%`, background: 'linear-gradient(to bottom, #b91c1c, #ef4444)' }} />
      <div className="flex-1 transition-all duration-500 ease-out"
           style={{ background: 'linear-gradient(to bottom, #3b82f6, #60a5fa)' }} />
    </div>
  );
}

export default function EvaluationMeter({ evalValue = CURRENT_EVAL }) {
  const { t } = useTranslation();
  const sentePct = evalToPercent(evalValue);
  const gotePct = 100 - sentePct;
  const isAdvSente = evalValue >= 0;

  function formatEval(ev) {
    if (ev >= 32000) return t('meter.mate');
    if (ev <= -32000) return t('meter.mate');
    return ev > 0 ? `+${ev}` : `${ev}`;
  }

  return (
    <div className="flex flex-col gap-0.5 px-3">
      {/* ラベル行 */}
      <div className="flex justify-between items-center text-xs">
        <span className="text-gray-400">{t('meter.gote')}</span>
        <span className={`font-bold text-sm ${isAdvSente ? 'text-blue-400' : 'text-red-400'}`}>
          {formatEval(evalValue)}
        </span>
        <span className="text-gray-400">{t('meter.sente')}</span>
      </div>

      {/* メーターバー */}
      <div className="relative h-5 rounded-full overflow-hidden bg-gray-700 flex shadow-inner">
        {/* 後手（赤）側 */}
        <div
          className="bg-gradient-to-r from-red-700 to-red-500 transition-all duration-500 ease-out"
          style={{ width: `${gotePct}%` }}
        />
        {/* 先手（青）側 */}
        <div
          className="bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500 ease-out flex-1"
        />
        {/* 中央ライン */}
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gray-900/60 -translate-x-1/2" />
        {/* 評価値テキストオーバーレイ */}
        <div className="absolute inset-0 flex items-center justify-between px-2">
          <span className="text-[10px] font-bold text-red-200 tabular-nums">{gotePct.toFixed(0)}%</span>
          <span className="text-[10px] font-bold text-blue-200 tabular-nums">{sentePct.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}
