import { TrendingUp, TrendingDown, Minus, Cpu, Loader2 } from 'lucide-react';

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

function EvalDisplay({ score, isMate, mateIn }) {
  if (isMate) {
    const sign = mateIn > 0 ? '+' : '';
    return (
      <span className={`font-bold text-base tabular-nums ${mateIn > 0 ? 'text-blue-400' : 'text-red-400'}`}>
        詰{sign}{mateIn}
      </span>
    );
  }
  return (
    <span className={`font-bold text-base tabular-nums ${score >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
      {score >= 0 ? '+' : ''}{score}
    </span>
  );
}

// ── ステータスバッジ ─────────────────────────────────────────
function StatusBadge({ status }) {
  if (status === 'thinking') return (
    <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
      <Loader2 size={11} className="animate-spin" />思考中
    </span>
  );
  if (status === 'ready') return (
    <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">解析完了</span>
  );
  if (status === 'error') return (
    <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">エンジンエラー</span>
  );
  if (status === 'standby') return (
    <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">スタンバイ</span>
  );
  // connecting
  return (
    <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">
      <Loader2 size={11} className="animate-spin" />接続中
    </span>
  );
}

export default function CandidateMoves({
  candidates = [], engineStatus = 'connecting', maxDepth = 0,
  multiPV = 5, isSaved = false, onMultiPVChange, onPVClick,
  fillHeight = false,
}) {
  const hasData = candidates.length > 0;
  const best = candidates[0];

  return (
    <div className={`px-3 flex flex-col gap-2 ${fillHeight ? 'h-full' : 'pb-6'}`}>
      {/* ヘッダー行1: タイトル + ステータス */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-200 flex items-center gap-1.5">
          <Cpu size={14} className="text-blue-400" />
          候補手 / 読み筋
        </h2>
        <div className="flex items-center gap-2">
          {isSaved && (
            <span className="text-xs text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded-full border border-purple-700/40">
              保存済み
            </span>
          )}
          {maxDepth > 0 && (
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
              深さ {maxDepth}
            </span>
          )}
          {!isSaved && <StatusBadge status={engineStatus} />}
        </div>
      </div>
      {/* ヘッダー行2: MultiPV 選択 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">候補手数 (MultiPV)</span>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 5, 7, 10].map(n => (
            <button
              key={n}
              onClick={() => onMultiPVChange?.(n)}
              className={`w-7 h-6 rounded text-xs font-bold transition-colors
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
        <div className="flex flex-col items-center gap-2 py-8 text-gray-600">
          <Cpu size={28} />
          <p className="text-xs text-center">
            {engineStatus === 'error'
              ? 'エンジンに接続できません。\nserver/index.js を起動してください。'
              : 'エンジンの解析結果を待っています…'}
          </p>
        </div>
      )}

      {/* 候補手リスト */}
      <div className={`flex flex-col gap-2 overscroll-y-contain ${fillHeight ? 'flex-1 min-h-0 overflow-y-auto pb-4' : ''}`}>
        {candidates.map((cand, i) => (
          <div
            key={i}
            className={`bg-gray-800 rounded-xl p-3 border transition-colors
              ${i === 0
                ? 'border-blue-500/50 shadow-md shadow-blue-500/10'
                : 'border-gray-700 hover:border-gray-500'}`}
          >
            {/* Row 1: rank · move · eval */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold w-5 h-5 rounded flex items-center justify-center
                  ${i === 0 ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                  {i + 1}
                </span>
                <span className="font-bold text-white text-base tracking-wider">{cand.move}</span>
              </div>
              <div className="flex items-center gap-2">
                {best && i > 0 && <DeltaBadge delta={cand.score - best.score} />}
                <EvalDisplay score={cand.score} isMate={cand.isMate} mateIn={cand.mateIn} />
              </div>
            </div>

            <EvalBar ev={cand.score} />

            {/* Row 2: depth / nodes */}
            <div className="flex items-center gap-3 mt-2 mb-1.5 text-xs text-gray-500">
              <span>深さ <span className="text-gray-300 font-mono">{cand.depth}</span></span>
              <span>ノード数 <span className="text-gray-300 font-mono">{cand.nodes}</span></span>
            </div>

            {/* 読み筋 (クリックで PVBoard 表示) */}
            <button
              onClick={() => onPVClick?.(cand)}
              className="w-full text-left bg-gray-900/60 hover:bg-gray-900 rounded-lg px-2 py-1.5
                transition-colors group"
              title="クリックで読み筋を表示"
            >
              <p className="text-xs text-gray-400 mb-0.5 flex items-center justify-between">
                <span>読み筋</span>
                <span className="text-blue-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                  タップで表示 →
                </span>
              </p>
              <p className="text-xs text-gray-200 font-mono leading-relaxed tracking-wide break-all">
                {cand.pvJP || cand.pvUSI || '—'}
              </p>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
