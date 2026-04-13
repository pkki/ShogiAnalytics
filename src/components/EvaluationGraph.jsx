import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { useTranslation } from 'react-i18next';

// グラフ表示範囲（詰みスコア ±32000 はこの範囲にクランプして表示）
const DISPLAY_MAX = 4000;
// 完全な詰みと判定するスコアの絶対値
const MATE_SCORE = 32000;

// 評価値の表示文字列（±32000 のみ「詰み」表示）
function formatEval(rawEval, mateLabel) {
  if (rawEval == null) return null;
  if (rawEval >= MATE_SCORE)  return mateLabel;
  if (rawEval <= -MATE_SCORE) return mateLabel;
  return (rawEval >= 0 ? '+' : '') + rawEval;
}

function CustomTooltip({ active, payload, t }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (d.evalRaw == null) return null;

  const raw = d.evalRaw;
  const isMate = Math.abs(raw) >= MATE_SCORE;
  const evalLabel = formatEval(raw, t('graph.mate'));
  const QUALITY = {
    blunder: { color: '#EF4444', symbol: '×', label: t('graph.blunder') },
    dubious:  { color: '#F59E0B', symbol: '?', label: t('graph.dubious') },
    good:     { color: '#34D399', symbol: '!', label: t('graph.good') },
  };
  const q = d.quality ? QUALITY[d.quality] : null;

  return (
    <div className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none">
      <p className="text-gray-300 mb-1">{d.move}{t('app.moveNumber')}: {d.label}</p>
      <p className={`font-bold text-sm ${raw >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
        {t('graph.evalLabel')}: {evalLabel}
      </p>
      {!isMate && q && (
        <p className="mt-0.5 font-bold" style={{ color: q.color }}>
          {q.symbol} {q.label} ({d.cpl}cp 損)
        </p>
      )}
      <p className="text-gray-500 text-[10px] mt-0.5">{t('graph.clickToJump')}</p>
    </div>
  );
}

// 手の品質ドット（recharts dot renderer）
// compact=true(スマホ): 先手(奇数手)=▲上向き三角、後手(偶数手)=▼下向き三角
// compact=false(PC): 丸 + 記号テキスト
function QualityDot(graphData, qualitySymbols, compact = false) {
  return function DotRenderer(props) {
    const { cx, cy, index } = props;
    const d = graphData[index];
    if (!d?.quality || d.evalRaw == null) return <circle key={index} r={0} cx={cx} cy={cy} />;
    const { color, symbol } = qualitySymbols[d.quality];

    if (compact) {
      const s = 5;
      // 奇数手=先手=▲上向き、偶数手=後手=▼下向き
      const isSente = d.move % 2 === 1;
      const points = isSente
        ? `${cx},${cy - s} ${cx - s},${cy + s} ${cx + s},${cy + s}`   // ▲
        : `${cx},${cy + s} ${cx - s},${cy - s} ${cx + s},${cy - s}`;  // ▼
      return (
        <g key={index}>
          <polygon points={points} fill={color} fillOpacity={0.92} stroke="#111827" strokeWidth={1} />
        </g>
      );
    }

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
  height = 90,
  fillContainer = false,
  compact = false,
}) {
  const { t } = useTranslation();

  const QUALITY = {
    blunder: { color: '#EF4444', symbol: '×', label: t('graph.blunder') },
    dubious:  { color: '#F59E0B', symbol: '?', label: t('graph.dubious') },
    good:     { color: '#34D399', symbol: '!', label: t('graph.good') },
  };

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

  const branchLabel = t('graph.onBranch', { n: branchPoint });
  const branchMoveLabel = t('graph.branchMoveLabel', { n: currentMove - branchPoint });
  const moveLabel = t('graph.moveLabel', { n: currentMove });

  return (
    <div className={`px-3 flex flex-col gap-1${fillContainer ? ' h-full' : ''}`}>
      <div className="flex items-center justify-between flex-wrap gap-1">
        <h2 className="text-xs font-bold text-gray-300">{t('graph.title')}</h2>
        <div className="flex items-center gap-2 text-[10px] text-gray-500 flex-wrap">
          {isBranch && (
            <span className="text-purple-400 text-[10px] bg-purple-900/40 px-2 py-0.5 rounded-full border border-purple-700/40">
              {branchLabel}
            </span>
          )}
          {hasQuality && (
            <>
              <span className="font-bold" style={{ color: QUALITY.blunder.color }}>× {t('graph.blunder')}</span>
              <span className="font-bold" style={{ color: QUALITY.dubious.color }}>? {t('graph.dubious')}</span>
              <span className="font-bold" style={{ color: QUALITY.good.color }}>! {t('graph.good')}</span>
            </>
          )}
          {!hasQuality && (
            <>
              <LegendItem color="#3B82F6" label={t('graph.senteAdv')} />
              <LegendItem color="#EF4444" label={t('graph.goteAdv')} />
            </>
          )}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl overflow-hidden" style={fillContainer ? { flex: 1, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' } : { height, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
        {!hasData ? (
          <div className="h-full flex items-center justify-center text-gray-600 text-xs">
            {t('graph.noDataHint')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={clampedData}
              margin={{ top: 14, right: 8, left: -20, bottom: 0 }}
              onClick={handleClick}
            >
              <defs>
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
                domain={[-DISPLAY_MAX, DISPLAY_MAX]}
                tickCount={5}
                tickFormatter={formatYTick}
              />
              <Tooltip content={<CustomTooltip t={t} />} />

              {/* 0ライン（先後の境界線） */}
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="4 2" />

              {/* 現在手のタテ線 */}
              <ReferenceLine
                x={currentMove}
                stroke={isBranch ? '#A78BFA' : '#FBBF24'}
                strokeWidth={2}
                strokeDasharray="3 3"
                label={{
                  value: isBranch ? branchMoveLabel : moveLabel,
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
                dot={QualityDot(clampedData, QUALITY, compact)}
                activeDot={{ r: 5, fill: '#FBBF24', stroke: '#fff', strokeWidth: 1.5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
