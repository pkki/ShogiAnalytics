import { useEffect, useRef } from 'react';

export default function MoveList({ nodes, moveListIds, branchStart, currentId, onNavigate }) {
  const currentRef = useRef(null);

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
        <span className="flex-1">指し手</span>
        {hasTime && <span className="w-12 shrink-0 text-right">消費</span>}
      </div>

      {/* 指し手リスト */}
      <div className="flex flex-col gap-0.5 p-1.5 overflow-y-auto overscroll-y-contain flex-1">
        {moveListIds.map((nodeId, idx) => {
          const node = nodes[nodeId];
          if (!node) return null;
          const isCurrent     = nodeId === currentId;
          const isBranchFirst = branchStart >= 0 && idx === branchStart;
          const isBranch      = branchStart >= 0 && idx >= branchStart;

          // ▼▼▼ 追加: 手番マークと移動元の座標を生成するロジック ▼▼▼
          // ▼▼▼ 追加: 手番マークと移動元の座標を生成するロジック ▼▼▼
          let displayText = node.label || '開始局面';
          if (node.label && node.moveNumber > 0) {
            const mark = node.moveNumber % 2 !== 0 ? '▲' : '△';
            
            // 盤上の移動（moveFromが存在する）場合
            if (node.moveFrom) {
              // PVBoardの仕様に合わせて [行, 列] から筋と段を計算します
              // 列は 0=9筋 〜 8=1筋 / 行は 0=一段 〜 8=九段
              const file = 9 - node.moveFrom[1]; 
              const rank = node.moveFrom[0] + 1; 
              displayText = `${mark}${node.label}(${file}${rank})`;
            } else {
              // 持ち駒を打った場合（moveFromが無い場合）
              displayText = `${mark}${node.label}`;
            }
          }
          // ▲▲▲
          // ▲▲▲

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
              
              {/* ▼▼▼ 変更: node.label の代わりに作成した displayText を表示する ▼▼▼ */}
              <span className="text-xs font-mono flex-1 truncate">{displayText}</span>
              {/* ▲▲▲ */}

              {hasTime && (
                <span className={`tabular-nums text-[10px] w-12 shrink-0 text-right
                  ${isCurrent ? 'text-yellow-400/70' : 'text-gray-600'}`}>
                  {node.usedTime ?? ''}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
