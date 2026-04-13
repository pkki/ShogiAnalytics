import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getPieceChar } from '../state/gameState';

const FILES = ['９','８','７','６','５','４','３','２','１'];
const RANKS = ['一','二','三','四','五','六','七','八','九'];

// ─── PV専用の小さいセル（フォントサイズをコンテナ幅に追従させる）───
function PVCell({ piece, isFrom, isTo }) {
  const bg = isTo ? 'bg-amber-300' : isFrom ? 'bg-amber-100/50' : 'bg-board';
  return (
    <div
      className={`${bg} border border-boardBorder/50 flex items-center justify-center select-none`}
      style={{ aspectRatio: '9 / 10' }}
    >
      {piece && (
        <span
          className="font-bold leading-none pointer-events-none w-full text-center"
          style={{
            fontSize: 'min(7.5cqw, 34px)',
            color: '#1a1a1a',
            transform: piece.player === 2 ? 'rotate(180deg)' : 'none',
            display: 'block',
          }}
        >
          {getPieceChar(piece.type, piece.player)}
        </span>
      )}
    </div>
  );
}

// ─── PV用ボード (container query でフォントサイズ追従) ───
function PVBoardGrid({ board, fromKey, toKey }) {
  const cells = [];
  board.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      const key = `${ri},${ci}`;
      cells.push(
        <PVCell key={key} piece={cell} isFrom={fromKey === key} isTo={toKey === key} />
      );
    });
  });

  return (
    <div className="flex flex-col" style={{ containerType: 'inline-size' }}>
      {/* 筋ラベル */}
      <div className="grid mb-0.5" style={{ gridTemplateColumns: 'repeat(9, minmax(0, 1fr)) 16px' }}>
        {FILES.map(f => (
          <div key={f} className="text-center text-gray-400" style={{ fontSize: 11 }}>{f}</div>
        ))}
        <div />
      </div>
      {/* 盤面 */}
      <div className="flex">
        <div className="flex-1 min-w-0">
          <div
            className="grid border-2 border-boardBorder rounded shadow-lg shadow-black/50"
            style={{ gridTemplateColumns: 'repeat(9, minmax(0, 1fr))', overflow: 'hidden' }}
          >
            {cells}
          </div>
        </div>
        <div className="flex flex-col" style={{ width: 16 }}>
          {RANKS.map(r => (
            <div
              key={r}
              className="flex-1 flex items-center justify-center text-gray-400 border-l border-gray-700/50"
              style={{ fontSize: 10 }}
            >
              {r}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NavBtn({ icon, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-30
        text-gray-200 transition-colors active:scale-95"
    >
      {icon}
    </button>
  );
}

export default function PVBoard({ candidate, states, onClose }) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const state = states[idx];
  const total = states.length - 1;
  const fromKey = state.moveFrom != null ? `${state.moveFrom[0]},${state.moveFrom[1]}` : null;
  const toKey   = state.moveTo   != null ? `${state.moveTo[0]},${state.moveTo[1]}`   : null;

  return (
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl
          w-full max-w-lg flex flex-col gap-3 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{t('pvboard.title')}</p>
            <p className="text-base font-bold text-white">
              {candidate.move}
              <span className={`ml-2 tabular-nums ${candidate.eval >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                {candidate.eval >= 0 ? '+' : ''}{candidate.eval}
              </span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{candidate.pv}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* ステップラベル */}
        <div className="text-center text-sm text-gray-300 bg-gray-800 rounded-lg py-2 px-3 font-mono">
          {idx === 0 ? t('pvboard.currentPos') : t('pvboard.moveStep', { n: idx, label: state.label })}
        </div>

        {/* 盤面 */}
        <PVBoardGrid board={state.board} fromKey={fromKey} toKey={toKey} />

        {/* ナビゲーション */}
        <div className="flex items-center gap-2 justify-center pt-1">
          <NavBtn icon={<ChevronsLeft size={16} />} onClick={() => setIdx(0)} disabled={idx === 0} />
          <NavBtn icon={<ChevronLeft size={16} />} onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0} />
          <span className="text-sm text-gray-300 tabular-nums mx-3 min-w-[56px] text-center">
            {idx} / {total}
          </span>
          <NavBtn icon={<ChevronRight size={16} />} onClick={() => setIdx(Math.min(total, idx + 1))} disabled={idx === total} />
          <NavBtn icon={<ChevronsRight size={16} />} onClick={() => setIdx(total)} disabled={idx === total} />
        </div>
      </div>
    </div>
  );
}
