import { useEffect, useRef } from 'react';
import { X, GitBranch } from 'lucide-react';
import { getPathFromRoot } from '../state/gameState';

// ノードのリストを幅優先でフラット化して、列ごとに表示
// mainLine: [id, id, ...]  branches: 分岐のある列インデックスと子ノードをまとめる

function buildDisplayRows(nodes, rootId, mainLineIds, currentId) {
  // メインラインのインデックスマップ
  const mainIdxMap = {};
  mainLineIds.forEach((id, i) => { mainIdxMap[id] = i; });

  // メインラインから外れた分岐を収集
  const branches = []; // { mainLineIdx, branchChain: [node,...] }

  function collectBranches(nodeId, depth) {
    const node = nodes[nodeId];
    if (!node) return;
    node.children.forEach((childId) => {
      if (!mainIdxMap.hasOwnProperty(childId)) {
        // 分岐
        const chain = [];
        let cur = childId;
        while (cur) {
          const n = nodes[cur];
          if (!n) break;
          chain.push(n);
          cur = n.children[0] ?? null; // 分岐の最初の子だけ追従
        }
        branches.push({ mainLineIdx: mainIdxMap[nodeId] ?? depth, chain });
      }
      if (mainIdxMap.hasOwnProperty(childId)) {
        collectBranches(childId, depth + 1);
      } else {
        // 分岐内でさらに分岐している場合（簡略化：最初の子のみ追従）
      }
    });
  }

  collectBranches(rootId, 0);
  return branches;
}

// --------------------------------------------------------
// 1手のボタン
// --------------------------------------------------------
function MoveButton({ node, isCurrent, isOnPath, isMainLine, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    if (isCurrent && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [isCurrent]);

  return (
    <button
      ref={ref}
      onClick={() => onClick(node.id)}
      className={`shrink-0 flex flex-col items-center px-2 py-1 rounded-lg text-xs transition-all
        ${isCurrent
          ? 'bg-yellow-400 text-gray-900 font-bold shadow-md scale-105'
          : isOnPath
            ? isMainLine
              ? 'bg-blue-600/70 text-white font-semibold'
              : 'bg-purple-600/70 text-white font-semibold'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
    >
      <span className="text-[10px] text-current/60 tabular-nums leading-tight">{node.moveNumber}</span>
      <span className="leading-tight whitespace-nowrap">{node.label || '—'}</span>
    </button>
  );
}

// --------------------------------------------------------
// メインパネル
// --------------------------------------------------------
export default function MoveTreePanel({ nodes, rootId, mainLineIds, currentId, onNavigate, onClose }) {
  const scrollRef = useRef(null);

  // 現在のパスを取得
  const pathSet = new Set(getPathFromRoot(nodes, currentId));

  const branches = buildDisplayRows(nodes, rootId, mainLineIds, currentId);

  // メインライン上のどのノードから分岐しているかのマップ
  // { mainLineIdx → [branch, ...] }
  const branchByIdx = {};
  branches.forEach((b) => {
    if (!branchByIdx[b.mainLineIdx]) branchByIdx[b.mainLineIdx] = [];
    branchByIdx[b.mainLineIdx].push(b.chain);
  });

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col justify-end" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-t-2xl border-t border-gray-700 max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <GitBranch size={16} className="text-blue-400" />
            <span className="font-bold text-white text-sm">手順ツリー</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-yellow-400 inline-block" />現在地
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-blue-600 inline-block" />本譜
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-purple-600 inline-block" />分岐
            </span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* ツリー本体 */}
        <div className="overflow-y-auto flex-1 p-3 space-y-3">
          {/* メインライン */}
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-semibold uppercase tracking-wider">本譜</p>
            <div ref={scrollRef} className="flex gap-1.5 overflow-x-auto pb-1 items-center">
              {mainLineIds.map((id) => {
                const node = nodes[id];
                if (!node) return null;
                return (
                  <MoveButton
                    key={id}
                    node={node}
                    isCurrent={id === currentId}
                    isOnPath={pathSet.has(id)}
                    isMainLine
                    onClick={onNavigate}
                  />
                );
              })}
            </div>
          </div>

          {/* 分岐 */}
          {branches.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5 font-semibold uppercase tracking-wider">
                分岐手順 ({branches.length}件)
              </p>
              <div className="space-y-2">
                {branches.map((b, bi) => {
                  const parentNode = nodes[mainLineIds[b.mainLineIdx]];
                  return (
                    <div key={bi} className="bg-gray-800 rounded-xl p-2.5">
                      {/* 分岐元 */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-[10px] text-gray-500">
                          {b.mainLineIdx}手目「{parentNode?.label ?? '—'}」からの分岐
                        </span>
                        <span className="text-xs text-purple-400 font-bold bg-purple-900/40 px-1.5 py-0.5 rounded">
                          変化
                        </span>
                      </div>
                      {/* 分岐の手順 */}
                      <div className="flex gap-1.5 overflow-x-auto pb-1 items-center">
                        {/* 分岐元のノードも表示 */}
                        {parentNode && (
                          <>
                            <MoveButton
                              node={parentNode}
                              isCurrent={parentNode.id === currentId}
                              isOnPath={pathSet.has(parentNode.id)}
                              isMainLine
                              onClick={onNavigate}
                            />
                            <span className="text-gray-600 shrink-0">→</span>
                          </>
                        )}
                        {b.chain.map((node) => (
                          <MoveButton
                            key={node.id}
                            node={node}
                            isCurrent={node.id === currentId}
                            isOnPath={pathSet.has(node.id)}
                            isMainLine={false}
                            onClick={onNavigate}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {branches.length === 0 && (
            <div className="text-center py-4 text-gray-600 text-sm">
              <GitBranch size={24} className="mx-auto mb-2 opacity-40" />
              分岐はまだありません。<br />
              本譜の途中で別の手を指すと分岐が生まれます。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
