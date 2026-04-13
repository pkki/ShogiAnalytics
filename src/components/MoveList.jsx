import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export default function MoveList({ nodes, moveListIds, branchStart, currentId, onNavigate, termination }) {
  const currentRef = useRef(null);
  const { t } = useTranslation();

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentId]);

  // 時間データが1件でもあるか判定（なければ列を非表示）
  const hasTime = moveListIds.some(id => nodes[id]?.usedTime);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー行 */}
      <div className="flex items-center border-b border-gray-700 shrink-0 px-2 py-1.5 gap-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
        <span className="w-5 shrink-0 text-right">#</span>
        <span className="flex-1">{t('moveList.moves')}</span>
        {hasTime && <span className="w-12 shrink-0 text-right">{t('moveList.timeUsed')}</span>}
      </div>

      {/* 指し手リスト */}
      <div className="flex flex-col gap-0.5 p-1.5 overflow-y-auto overscroll-y-contain flex-1">
        {moveListIds.map((nodeId, idx) => {
          const node = nodes[nodeId];
          if (!node) return null;
          const isCurrent     = nodeId === currentId;
          const isBranchFirst = branchStart >= 0 && idx === branchStart;
          const isBranch      = branchStart >= 0 && idx >= branchStart;

          let displayText = node.label || t('moveList.initialPosition');
          if (node.label && node.moveNumber > 0) {
            const mark = node.moveNumber % 2 !== 0 ? '▲' : '△';

            if (node.moveFrom) {
              const file = 9 - node.moveFrom[1];
              const rank = node.moveFrom[0] + 1;
              displayText = `${mark}${node.label}(${file}${rank})`;
            } else {
              displayText = `${mark}${node.label}`;
            }
          }

          return (
            <button
              key={nodeId}
              ref={isCurrent ? currentRef : null}
              onClick={() => onNavigate(nodeId)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors w-full
                ${isCurrent
                  ? 'bg-yellow-500/20 border border-yellow-500/40 text-yellow-300'
                  : isBranch
                    ? 'hover:bg-purple-900/30 text-purple-300'
                    : 'hover:bg-gray-700/60 text-gray-300'}`}
            >
              {isBranchFirst ? (
                <span className="text-[9px] font-bold text-purple-400 bg-purple-900/60
                  border border-purple-600/40 rounded px-0.5 leading-tight shrink-0 w-5 text-center">
                  ＋
                </span>
              ) : (
                <span className="tabular-nums text-gray-600 text-[10px] w-5 shrink-0 text-right">
                  {node.moveNumber}
                </span>
              )}

              <span className="text-xs font-mono flex-1 truncate">{displayText}</span>

              {hasTime && (
                <span className={`tabular-nums text-[10px] w-12 shrink-0 text-right
                  ${isCurrent ? 'text-yellow-400/70' : 'text-gray-600'}`}>
                  {node.usedTime ?? ''}
                </span>
              )}
            </button>
          );
        })}
        {termination && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs">
            <span className="tabular-nums text-gray-600 text-[10px] w-5 shrink-0 text-right">{termination.moveNumber}</span>
            <span className="font-medium text-red-400 flex-1 font-mono">{termination.label}</span>
            <span className="text-gray-500 text-[10px]">
              {termination.winner === 1 ? t('moveList.senteWins') : t('moveList.goteWins')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
