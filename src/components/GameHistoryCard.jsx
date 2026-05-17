import { Star, BarChart2 } from 'lucide-react';
import { getGrade } from '../utils/shogiRating';

const REASON_LABEL = {
  resign: '投了', timeout: '時間切れ', checkmate: '詰み', disconnect: '切断', draw: '引き分け',
};

const AVATAR_COLORS = [
  '#2563eb','#7c3aed','#db2777','#dc2626',
  '#d97706','#16a34a','#0891b2','#475569',
];

function Avatar({ name, size = 36 }) {
  const initial = (name || '?')[0].toUpperCase();
  const bg = AVATAR_COLORS[initial.charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <div className="rounded-full flex items-center justify-center font-black text-white shrink-0"
         style={{ width: size, height: size, background: bg, fontSize: size * 0.44 }}>
      {initial}
    </div>
  );
}

function timeLabel(timeControl, byoyomi) {
  if (timeControl == null) return null;
  if (timeControl === 0) return byoyomi ? `${byoyomi}秒` : '秒読み';
  return `${Math.round(timeControl / 60)}分`;
}

export default function GameHistoryCard({ game, perspectiveId, onReplay, onAnalyze }) {
  const senteName = game.sente_name || game.sente_email?.split('@')[0] || '先手';
  const goteName  = game.gote_name  || game.gote_email?.split('@')[0]  || '後手';
  const senteGrade = getGrade(game.sente_rating_before ?? 1500);
  const goteGrade  = getGrade(game.gote_rating_before  ?? 1500);

  const isDraw   = game.winner === 'draw';
  const senteWon = !isDraw && game.winner === 'sente';
  const goteWon  = !isDraw && game.winner === 'gote';

  const isPerspSente   = game.sente_id === perspectiveId;
  const myRatingBefore = isPerspSente ? game.sente_rating_before : game.gote_rating_before;
  const myRatingAfter  = isPerspSente ? game.sente_rating_after  : game.gote_rating_after;
  const ratingDelta    = myRatingAfter != null && myRatingBefore != null
    ? myRatingAfter - myRatingBefore : null;

  const moveCount = (() => {
    try { return game.moves ? JSON.parse(game.moves).length : 0; } catch { return 0; }
  })();
  const hasMoves = moveCount > 0;

  const date = game.finished_at
    ? new Date(game.finished_at * 1000)
        .toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .replace(',', '')
    : '';

  const tl = timeLabel(game.time_control, game.byoyomi);

  const myWon = !isDraw && (
    (isPerspSente && game.winner === 'sente') || (!isPerspSente && game.winner === 'gote')
  );

  const winClass  = 'text-emerald-400';
  const loseClass = 'text-red-400';
  const drawClass = 'text-gray-500';

  const cardBg     = myWon ? 'bg-emerald-950/50 border-emerald-700/50' : isDraw ? 'bg-gray-900 border-gray-700' : 'bg-gray-800/50 border-gray-700/60';
  const infoBg     = myWon ? 'bg-emerald-900/30 border-emerald-800/30' : isDraw ? 'bg-gray-800/60 border-gray-700/50' : 'bg-gray-800/40 border-gray-700/40';

  return (
    <div className={`border rounded-xl overflow-hidden ${cardBg}`}>

      {/* ── プレイヤー行 ── */}
      <div className="flex items-center px-3 py-3 gap-2">

        {/* 先手（左） */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Avatar name={senteName} size={34} />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-white text-sm truncate leading-tight">{senteName}</div>
            <div className="text-[11px] text-gray-500 leading-tight">{senteGrade}</div>
          </div>
          <span className={`text-sm font-black shrink-0 ${isDraw ? drawClass : senteWon ? winClass : loseClass}`}>
            {isDraw ? '引' : senteWon ? '勝' : '敗'}
          </span>
        </div>

        {/* 中央：棋譜ボタン */}
        <div className="shrink-0 flex flex-col items-center gap-1 px-1">
          {hasMoves ? (
            <button
              onClick={onReplay}
              className="w-11 h-11 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600
                         flex items-center justify-center transition-colors shadow-md"
              title="棋譜を見る"
            >
              <span className="text-white text-[13px] font-black" style={{ fontFamily: 'serif' }}>棋譜</span>
            </button>
          ) : (
            <div className="w-11 h-11 rounded-xl bg-gray-800 border border-gray-700
                            flex items-center justify-center">
              <span className="text-gray-600 text-[11px]">棋譜</span>
            </div>
          )}
        </div>

        {/* 後手（右） */}
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-row-reverse">
          <Avatar name={goteName} size={34} />
          <div className="min-w-0 flex-1 text-right">
            <div className="font-bold text-white text-sm truncate leading-tight">{goteName}</div>
            <div className="text-[11px] text-gray-500 leading-tight">{goteGrade}</div>
          </div>
          <span className={`text-sm font-black shrink-0 ${isDraw ? drawClass : goteWon ? winClass : loseClass}`}>
            {isDraw ? '引' : goteWon ? '勝' : '敗'}
          </span>
        </div>
      </div>

      {/* ── 情報バー ── */}
      <div className={`flex items-center gap-1.5 px-3 py-1.5 border-t flex-wrap ${infoBg}`}>
        <Star size={9} className="fill-yellow-400 text-yellow-400 shrink-0" />
        <span className="px-1.5 py-px rounded text-[9px] font-bold bg-orange-800/60 text-orange-200">ランク</span>
        <span className="px-1.5 py-px rounded text-[9px] font-bold bg-green-900/60 text-green-300">通常</span>
        {tl && <span className="px-1.5 py-px rounded text-[9px] font-bold bg-red-900/60 text-red-300">{tl}</span>}

        {moveCount > 0 && (
          <span className="text-[9px] text-gray-600 ml-0.5">
            {moveCount}手・{REASON_LABEL[game.reason] ?? game.reason}
          </span>
        )}

        {ratingDelta != null && (
          <span className={`text-[9px] font-bold ${ratingDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {ratingDelta >= 0 ? '+' : ''}{ratingDelta}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {hasMoves && (
            <button
              onClick={onAnalyze}
              className="flex items-center gap-0.5 text-[9px] text-blue-400 hover:text-blue-300 transition-colors font-bold"
            >
              <BarChart2 size={9} /> 解析
            </button>
          )}
          <span className="text-[9px] text-gray-600">{date}</span>
        </div>
      </div>

    </div>
  );
}
