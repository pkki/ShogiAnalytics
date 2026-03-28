import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';

// グラフ表示範囲（詰みスコア ±32000 はこの範囲にクランプして表示）
const DISPLAY_MAX = 4000;
// 完全な詰みと判定するスコアの絶対値
const MATE_SCORE = 32000;

// 手の品質に対応する色・記号
const QUALITY = {
  blunder: { color: '#EF4444', symbol: '×', label: '悪手' },
  dubious:  { color: '#F59E0B', symbol: '?', label: '疑問手' },
  good:     { color: '#34D399', symbol: '!', label: '好手' },
};

// 評価値の表示文字列（±32000 のみ「詰み」表示）
function formatEval(rawEval) {
  if (rawEval == null) return null;
  if (rawEval >= MATE_SCORE)  return '詰み';
  if (rawEval <= -MATE_SCORE) return '詰み';
  return (rawEval >= 0 ? '+' : '') + rawEval;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.evalRaw == null) return null;

  const raw = d.evalRaw;
  const isMate = Math.abs(raw) >= MATE_SCORE;
  const evalLabel = formatEval(raw);
  const q = d.quality ? QUALITY[d.quality] : null;

  return (
    <div className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none">
      <p className="text-gray-300 mb-1">{d.move}手目: {d.label}</p>
      <p className={`font-bold text-sm ${raw >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
        評価値: {evalLabel}
      </p>
      {!isMate && q && (
        <p className="mt-0.5 font-bold" style={{ color: q.color }}>
          {q.symbol} {q.label} ({d.cpl}cp 損)
        </p>
      )}
      <p className="text-gray-500 text-[10px] mt-0.5">クリックで移動</p>
    </div>
  );
}

// 手の品質ドット（recharts dot renderer）
function QualityDot(graphData) {
  return function DotRenderer(props) {
    const { cx, cy, index } = props;
    const d = graphData[index];
    if (!d?.quality || d.evalRaw == null) return <circle key={index} r={0} cx={cx} cy={cy} />;
    const { color, symbol } = QUALITY[d.quality];
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={6} fill={color} fillOpacity={0.85} stroke="#111827" strokeWidth={1.5} />
        <text x={cx} y={cy - 9} textAnchor="middle" fill={color} fontSize={10} fontWeight="bold">
          {symbol}
        </text>
      </g>
    );
  };
}

// 凡例アイテム
function LegendItem({ color, label }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </span>
  );
}

// Y軸ラベルフォーマット（±32000 → 詰み、それ以外は数値）
function formatYTick(v) {
  if (v >= DISPLAY_MAX)  return '+4000';
  if (v <= -DISPLAY_MAX) return '-4000';
  return v > 0 ? `+${v}` : `${v}`;
}

export default function EvaluationGraph({
  currentMove = 0,
  graphData = [],       // [{ move, eval, label, quality, cpl }]
  onNavigate,
  isBranch = false,
  branchPoint = 0,
}) {
  // 表示用データ: eval を [-4000, +4000] にクランプしつつ元の値も保持
  const clampedData = graphData.map(d => ({
    ...d,
    evalDisplay: d.eval != null
      ? Math.max(-DISPLAY_MAX, Math.min(DISPLAY_MAX, d.eval))
      : null,
    evalRaw: d.eval,
  }));

  const hasData    = clampedData.some(d => d.evalDisplay != null);
  const hasQuality = clampedData.some(d => d.quality);

  const handleClick = (d) => {
    if (!d) return;
    const move = d.activeLabel ?? d.activePayload?.[0]?.payload?.move;
    if (move != null) onNavigate?.(Number(move));
  };

  return (
    <div className="px-3 flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <h2 className="text-sm font-bold text-gray-200">形勢グラフ</h2>
        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          {isBranch && (
            <span className="text-purple-400 text-[10px] bg-purple-900/40 px-2 py-0.5 rounded-full border border-purple-700/40">
              分岐中 ({branchPoint}手目〜)
            </span>
          )}
          {hasQuality && (
            <>
              <span className="font-bold" style={{ color: QUALITY.blunder.color }}>× 悪手</span>
              <span className="font-bold" style={{ color: QUALITY.dubious.color }}>? 疑問手</span>
              <span className="font-bold" style={{ color: QUALITY.good.color }}>! 好手</span>
            </>
          )}
          {!hasQuality && (
            <>
              <LegendItem color="#3B82F6" label="先手有利" />
              <LegendItem color="#EF4444" label="後手有利" />
            </>
          )}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl overflow-hidden" style={{ height: 160, cursor: 'pointer' }}>
        {!hasData ? (
          <div className="h-full flex items-center justify-center text-gray-600 text-xs">
            局面を進めると評価値が記録されます
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={clampedData}
              margin={{ top: 14, right: 8, left: -20, bottom: 0 }}
              onClick={handleClick}
            >
              <defs>
                {/*
                  ドメインが -4000〜+4000 の対称固定なので、
                  グラデーションの50%がちょうど評価値0 に対応する。
                  上半分(先手有利)=青、下半分(後手有利)=赤。
                */}
                <linearGradient id="evalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#3B82F6" stopOpacity={0.55} />
                  <stop offset="48%"  stopColor="#3B82F6" stopOpacity={0.08} />
                  <stop offset="52%"  stopColor="#EF4444" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#EF4444" stopOpacity={0.55} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="move"
                tick={{ fill: '#6B7280', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#374151' }}
              />
              <YAxis
                tick={{ fill: '#6B7280', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                // 0 が常に中央に来る対称固定ドメイン
                domain={[-DISPLAY_MAX, DISPLAY_MAX]}
                tickCount={5}
                tickFormatter={formatYTick}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* 0ライン（先後の境界線） */}
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="4 2" />

              {/* 現在手のタテ線 */}
              <ReferenceLine
                x={currentMove}
                stroke={isBranch ? '#A78BFA' : '#FBBF24'}
                strokeWidth={2}
                strokeDasharray="3 3"
                label={{
                  value: isBranch ? `分岐${currentMove - branchPoint}手` : `${currentMove}手`,
                  fill: isBranch ? '#A78BFA' : '#FBBF24',
                  fontSize: 9,
                  position: 'insideTopRight',
                }}
              />
              {/* 分岐点のタテ線 */}
              {isBranch && (
                <ReferenceLine
                  x={branchPoint}
                  stroke="#7C3AED"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
              )}

              <Area
                type="monotone"
                dataKey="evalDisplay"
                stroke="#3B82F6"
                strokeWidth={2}
                fill="url(#evalGrad)"
                connectNulls={false}
                dot={QualityDot(clampedData)}
                activeDot={{ r: 5, fill: '#FBBF24', stroke: '#fff', strokeWidth: 1.5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}