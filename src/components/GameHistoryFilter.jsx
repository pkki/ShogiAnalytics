/**
 * GameHistoryFilter — 対局履歴フィルターバー
 */
export function filterGames(games, perspectiveId, resultFilter, reasonFilter, timeFilter) {
  return games.filter(g => {
    if (resultFilter !== 'all') {
      const isSente = g.sente_id === perspectiveId;
      const outcome = g.winner === 'draw' ? 'draw'
        : (g.winner === 'sente') === isSente ? 'win' : 'loss';
      if (outcome !== resultFilter) return false;
    }
    if (reasonFilter !== 'all' && g.reason !== reasonFilter) return false;
    if (timeFilter !== 'all' && String(g.time_control) !== timeFilter) return false;
    return true;
  });
}

const RESULT_OPTIONS = [
  { key: 'all',  label: '全て' },
  { key: 'win',  label: '勝ち' },
  { key: 'loss', label: '負け' },
  { key: 'draw', label: '引き分け' },
];

const REASON_OPTIONS = [
  { key: 'all',        label: '全て' },
  { key: 'resign',     label: '投了' },
  { key: 'checkmate',  label: '詰み' },
  { key: 'timeout',    label: '時間切れ' },
  { key: 'disconnect', label: '切断' },
];

const TIME_OPTIONS = [
  { key: 'all', label: '全て' },
  { key: '0',   label: '秒読み' },
  { key: '60',  label: '1分' },
  { key: '180', label: '3分' },
  { key: '300', label: '5分' },
  { key: '600', label: '10分' },
];

function PillRow({ label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-gray-500 shrink-0 w-8">{label}</span>
      {options.map(({ key, label: lbl }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-2.5 py-1 rounded-full text-xs transition-colors
            ${value === key
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}
        >
          {lbl}
        </button>
      ))}
    </div>
  );
}

export default function GameHistoryFilter({
  resultFilter, setResultFilter,
  reasonFilter, setReasonFilter,
  timeFilter,   setTimeFilter,
  total, filtered,
}) {
  const isFiltered = resultFilter !== 'all' || reasonFilter !== 'all' || timeFilter !== 'all';
  return (
    <div className="flex flex-col gap-2 mb-3">
      <PillRow label="結果" options={RESULT_OPTIONS} value={resultFilter} onChange={setResultFilter} />
      <PillRow label="終局" options={REASON_OPTIONS} value={reasonFilter} onChange={setReasonFilter} />
      <PillRow label="時間" options={TIME_OPTIONS}   value={timeFilter}   onChange={setTimeFilter} />
      {isFiltered && (
        <div className="flex items-center gap-3">
          <p className="text-[11px] text-gray-500">{total} 件中 {filtered} 件表示</p>
          <button
            onClick={() => { setResultFilter('all'); setReasonFilter('all'); setTimeFilter('all'); }}
            className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            フィルターをリセット
          </button>
        </div>
      )}
    </div>
  );
}
