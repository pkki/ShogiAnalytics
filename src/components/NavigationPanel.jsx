import { useRef } from 'react';
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight,
  FolderOpen, Clipboard, GitBranch, CornerUpLeft,
  FilePlus, Download, FlipHorizontal2 } from 'lucide-react';

export default function NavigationPanel({
  currentMove,
  totalMoves,
  onMoveChange,
  onOpenTree,
  currentLabel,
  isOnBranch,
  onReturnToMain,
  onBranchPrev,
  onBranchNext,
  hasBranchNext,
  onLoadFile,
  onPasteKif,
  onNewGame,
  onSaveKif,
  onFlip,
  flipped,
}) {
  const safeMove = Math.max(0, currentMove);
  const fileRef  = useRef(null);

  const moveTo = (n) => onMoveChange?.(Math.max(0, Math.min(totalMoves, n)));

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) onLoadFile?.(file);
    e.target.value = '';
  };

  return (
    <div className="px-3 flex flex-col gap-1.5">
      {/* 分岐バナー */}
      {isOnBranch && (
        <div className="flex flex-col gap-1.5 bg-purple-900/40 border border-purple-700/60 rounded-xl px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch size={14} className="text-purple-400 shrink-0" />
              <span className="text-xs text-purple-300 font-semibold">分岐手順を指しています</span>
            </div>
            <button
              onClick={onReturnToMain}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500
                rounded-lg text-white text-xs font-bold transition-colors shrink-0"
            >
              <CornerUpLeft size={12} />
              本譜に戻す
            </button>
          </div>
          <div className="flex items-center gap-1">
            <NavBtn icon={<ChevronsLeft size={16} />}  label="本譜の分岐点へ" onClick={onReturnToMain} />
            <NavBtn icon={<ChevronLeft size={16} />}   label="1手戻る" onClick={onBranchPrev} />
            <NavBtn icon={<ChevronRight size={16} />}  label="1手進む" onClick={onBranchNext} disabled={!hasBranchNext} />
          </div>
        </div>
      )}

      {/* 手数スライダー（本譜のみ有効） */}
      {!isOnBranch && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 tabular-nums w-14 text-right shrink-0">
            {safeMove}手目
          </span>
          <input
            type="range" min={0} max={totalMoves} value={safeMove}
            onChange={(e) => moveTo(Number(e.target.value))}
            className="flex-1 h-2 rounded-full accent-blue-500 cursor-pointer"
          />
          <span className="text-xs text-gray-400 tabular-nums w-8 shrink-0">{totalMoves}手</span>
        </div>
      )}

      {/* ナビゲーションボタン */}
      <div className="flex items-center gap-1.5">
        <div className={`flex-1 px-2 py-2 rounded-lg text-xs text-center font-mono transition-colors
          ${isOnBranch
            ? 'bg-purple-900/40 text-purple-200 border border-purple-700/40'
            : 'bg-gray-700/80 text-gray-200'}`}
        >
          <span className="font-bold tabular-nums">{currentMove}手目</span>
          {currentLabel && (
            <span className="ml-1.5 text-gray-300">{currentLabel}</span>
          )}
        </div>

        {!isOnBranch && (
          <div className="flex items-center gap-1">
            <NavBtn icon={<ChevronsLeft size={16} />}  label="開始"    onClick={() => moveTo(0)} />
            <NavBtn icon={<ChevronLeft size={16} />}   label="1手戻る" onClick={() => moveTo(safeMove - 1)} />
            <NavBtn icon={<ChevronRight size={16} />}  label="1手進む" onClick={() => moveTo(safeMove + 1)} />
            <NavBtn icon={<ChevronsRight size={16} />} label="最終"    onClick={() => moveTo(totalMoves)} />
          </div>
        )}

        <button onClick={onOpenTree} title="手順ツリー"
          className="p-2 rounded-lg bg-gray-700 hover:bg-blue-600 active:scale-95
            transition-all text-gray-200 hover:text-white">
          <GitBranch size={16} />
        </button>

        {/* 盤面反転 */}
        <button onClick={onFlip} title={flipped ? '盤面を元に戻す' : '盤面を反転'}
          className={`p-2 rounded-lg active:scale-95 transition-all
            ${flipped
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white'}`}>
          <FlipHorizontal2 size={16} />
        </button>
      </div>

      {/* 棋譜操作エリア */}
      <input
        ref={fileRef}
        type="file"
        accept=".kif,.kifu,.csa"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 棋譜操作グリッド（md以上のみ表示; モバイルはヘッダーのメニューを使用） */}
      <div className="hidden md:grid lg:hidden grid-cols-2 gap-1.5">
        <KifBtn onClick={onNewGame} icon={<FilePlus size={13} />} label="新規作成" title="新しい棋譜を作成" color="gray" />
        <KifBtn onClick={onSaveKif} icon={<Download size={13} />} label="保存" title="棋譜をKIFファイルとして保存" color="emerald" />
        <KifBtn onClick={() => fileRef.current?.click()} icon={<FolderOpen size={13} />} label="ファイルを開く" color="blue" />
        <KifBtn onClick={onPasteKif} icon={<Clipboard size={13} />} label="貼り付け" title="クリップボードから棋譜を貼り付け (Ctrl+V)" color="purple" />
      </div>
    </div>
  );
}

function NavBtn({ icon, label, onClick, disabled }) {
  return (
    <button onClick={onClick} title={label} disabled={disabled}
      className="p-2 rounded-lg bg-gray-700 hover:bg-blue-600 active:scale-95
        transition-all text-gray-200 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-700">
      {icon}
    </button>
  );
}

const colorMap = {
  gray:    'hover:border-gray-400 hover:bg-gray-700/50',
  emerald: 'hover:border-emerald-500 hover:bg-emerald-500/10',
  blue:    'hover:border-blue-500 hover:bg-blue-500/10',
  purple:  'hover:border-purple-500 hover:bg-purple-500/10',
};

function KifBtn({ onClick, icon, label, title, color = 'gray' }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center gap-1.5 py-2 rounded-lg
        border border-dashed border-gray-600 text-gray-400 hover:text-white
        transition-colors text-xs ${colorMap[color]}`}
    >
      {icon}
      {label}
    </button>
  );
}
