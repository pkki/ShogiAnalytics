import { useRef, useEffect, useState, useMemo } from 'react';
import { getPieceChar, isPromoted } from '../state/gameState';

const FILES_NORMAL  = ['９','８','７','６','５','４','３','２','１'];
const FILES_FLIPPED = ['１','２','３','４','５','６','７','８','９'];
const RANKS_NORMAL  = ['一','二','三','四','五','六','七','八','九'];
const RANKS_FLIPPED = ['九','八','七','六','五','四','三','二','一'];
const ORDER_NORMAL  = [0,1,2,3,4,5,6,7,8];
const ORDER_FLIPPED = [8,7,6,5,4,3,2,1,0];

// ─────────────────────────────────────────────
// 1マス
// ─────────────────────────────────────────────
const CELL_BG = {
  selected:     'bg-yellow-300',
  highlight:    'bg-sky-300/70 cursor-pointer',
  lastMoveTo:   'bg-amber-300',
  lastMoveFrom: 'bg-amber-100/50',
  normal:       'bg-board',
};

function Cell({ piece, cellState, onClick, onContextMenu, editMode, flipped, sideLayout }) {
  const promoted = piece && isPromoted(piece.type);
  const shouldRotate = piece
    ? (flipped ? piece.player === 1 : piece.player === 2)
    : false;

  // タッチ時刻を追跡（クリックイベント抑制 & ダブルタップ検出）
  const lastTouchRef   = useRef(0); // 前回 touchEnd の時刻
  const lastTouchMsRef = useRef(0); // 最後に touchEnd が起きた時刻（click 抑制用）

  const handleTouchEnd = (e) => {
    e.preventDefault(); // click イベントを抑制（通常モード・editMode 共通）
    lastTouchMsRef.current = Date.now();

    const now = Date.now();
    if (editMode && onContextMenu && now - lastTouchRef.current < 300) {
      // ダブルタップ → サイクル（editMode のみ）
      onContextMenu();
    } else {
      // シングルタップ → 即座に実行（遅延なし）
      onClick?.();
    }
    lastTouchRef.current = now;
  };

  // タッチデバイスからのクリックイベントを抑制（touchEnd が処理済みのため）
  const handleClick = () => {
    if (Date.now() - lastTouchMsRef.current < 600) return;
    onClick?.();
  };

  return (
    <div
      onClick={handleClick}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(); } : undefined}
      onTouchEnd={handleTouchEnd}
      className={`${CELL_BG[cellState] ?? CELL_BG.normal}
        border border-boardBorder/50 flex items-center justify-center
        select-none active:scale-95 hover:brightness-90
        ${editMode ? 'cursor-crosshair' : ''}`}
      style={{ aspectRatio: '9 / 10', minWidth: 0, overflow: 'hidden', touchAction: 'manipulation' }}
    >
      {piece && (
        <span
          className="font-bold leading-none pointer-events-none"
          style={{
            fontSize: sideLayout
              ? 'min(8cqw, 26px)'
              : 'min(8cqw, 34px)',
            color: promoted ? '#DC2626' : '#1a1a1a',
            transform: shouldRotate ? 'rotate(180deg)' : 'none',
            display: 'block',
          }}
        >
          {getPieceChar(piece.type, piece.player)}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 候補手矢印オーバーレイ（最善手=赤、2〜4位=オレンジ、ラベル付き）
// viewBox "0 0 9 10" / preserveAspectRatio="none"
// ─────────────────────────────────────────────
const ARROW_COLORS = [
  { fill: 'rgba(239,68,68,0.88)',  hlDst: 'rgba(239,68,68,0.28)', hlSrc: 'rgba(239,68,68,0.12)' },
  { fill: 'rgba(239,68,68,0.65)',  hlDst: 'rgba(239,68,68,0.18)', hlSrc: 'rgba(239,68,68,0.08)' },
  { fill: 'rgba(249,115,22,0.75)', hlDst: 'rgba(249,115,22,0.18)', hlSrc: 'rgba(249,115,22,0.08)' },
  { fill: 'rgba(249,115,22,0.65)', hlDst: 'rgba(249,115,22,0.14)', hlSrc: 'rgba(249,115,22,0.06)' },
];

function CandidateArrows({ candidateArrows, flipped, activePlayer, hands }) {
  const svgRef = useRef(null);
  const [dropOrigins, setDropOrigins] = useState({});

  // 打ち駒が必要な駒種一覧
  const dropPieces = useMemo(() => {
    const s = new Set();
    candidateArrows?.forEach(a => { if (!a.from && a.dropPiece) s.add(a.dropPiece); });
    return s;
  }, [candidateArrows]);

  useEffect(() => {
    if (dropPieces.size === 0) { setDropOrigins({}); return; }
    const measure = () => {
      const svg = svgRef.current;
      if (!svg) return;
      const grid = svg.parentElement;
      if (!grid) return;
      const scope = svg.closest('[data-board-area]');
      if (!scope) return;
      const gridRect = grid.getBoundingClientRect();
      if (gridRect.width < 1 || gridRect.height < 1) return;
      const origins = {};
      for (const piece of dropPieces) {
        const tile = scope.querySelector(
          `[data-drop-piece="${piece}"][data-drop-player="${activePlayer}"]`
        );
        if (!tile) continue;
        const r = tile.getBoundingClientRect();
        origins[piece] = {
          fx: (r.left + r.width  / 2 - gridRect.left) / gridRect.width  * 9,
          fy: (r.top  + r.height / 2 - gridRect.top)  / gridRect.height * 10,
        };
      }
      setDropOrigins(origins);
    };
    const raf = requestAnimationFrame(measure);
    const ro  = new ResizeObserver(measure);
    if (svgRef.current?.parentElement) ro.observe(svgRef.current.parentElement);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [dropPieces, activePlayer, flipped, hands]);

  if (!candidateArrows?.length) return null;

  const vr  = (r) => flipped ? 8 - r : r;
  const vc  = (c) => flipped ? 8 - c : c;
  const cx_ = (c) => c + 0.5;
  const cy_ = (r) => (r + 0.5) * (10 / 9);
  const pts = (arr) => arr.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(' ');

  // rank 4 → 1 の順（手前に上位を描画）
  const elements = [];
  [...candidateArrows].reverse().forEach((move, revIdx) => {
    if (!move?.to) return;
    const idx   = candidateArrows.length - 1 - revIdx;
    const color = ARROW_COLORS[idx] ?? ARROW_COLORS[3];
    const isDrop = !move.from && !!move.dropPiece;

    const tr = vr(move.to[0]), tc = vc(move.to[1]);
    const tx = cx_(tc), ty = cy_(tr);

    let fx, fy;
    if (isDrop) {
      const o = dropOrigins[move.dropPiece];
      if (!o) return;
      fx = o.fx; fy = o.fy;
    } else {
      const fr = vr(move.from[0]), fc = vc(move.from[1]);
      fx = cx_(fc); fy = cy_(fr);
    }

    const dx  = tx - fx, dy = ty - fy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return;

    const ux = dx / len, uy = dy / len;
    const px = -uy,      py = ux;
    const pad      = isDrop ? Math.min(0.30, len * 0.10) : Math.min(0.30, len * 0.16);
    const shaftW   = 0.13;
    const headLen  = 0.36;
    const headW    = 0.25;
    const tipInset = 0.04;

    const sx    = fx + ux * pad,      sy    = fy + uy * pad;
    const baseX = tx - ux * headLen,  baseY = ty - uy * headLen;
    const tipX  = tx - ux * tipInset, tipY  = ty - uy * tipInset;
    const s1 = [sx    + px*shaftW, sy    + py*shaftW];
    const s2 = [sx    - px*shaftW, sy    - py*shaftW];
    const b1 = [baseX + px*shaftW, baseY + py*shaftW];
    const b2 = [baseX - px*shaftW, baseY - py*shaftW];
    const h1 = [baseX + px*headW,  baseY + py*headW];
    const h2 = [baseX - px*headW,  baseY - py*headW];

    // ラベル位置（シャフト中点）
    const lx = (sx + baseX) / 2, ly = (sy + baseY) / 2;

    elements.push(
      <g key={`arrow-${idx}`}>
        {/* 移動先ハイライト */}
        <rect x={tc} y={tr * 10/9} width={1} height={10/9} fill={color.hlDst} />
        {/* 移動元ハイライト（通常手のみ） */}
        {!isDrop && (
          <rect x={vc(move.from[1])} y={vr(move.from[0]) * 10/9} width={1} height={10/9} fill={color.hlSrc} />
        )}
        {/* シャフト */}
        <polygon points={pts([s1, s2, b2, b1])} fill={color.fill} />
        {/* 矢印頭 */}
        <polygon points={pts([h1, [tipX, tipY], h2])} fill={color.fill} />
        {/* ラベル */}
        <text x={lx} y={ly}
          textAnchor="middle" dominantBaseline="central"
          fontSize="0.22" fontWeight="bold" fill="white"
          style={{ fontFamily: 'sans-serif', userSelect: 'none' }}>
          {move.label}
        </text>
      </g>
    );
  });

  return (
    <svg ref={svgRef} className="absolute inset-0 w-full h-full pointer-events-none z-10"
      viewBox="0 0 9 10" preserveAspectRatio="none"
      style={{ overflow: 'visible' }}>
      {elements}
    </svg>
  );
}

// ─────────────────────────────────────────────
// BoardCore: 盤面グリッド＋ラベル
// ─────────────────────────────────────────────
export function BoardCore({ board, hands, selectedCell, highlightSet, lastMove, candidateArrows, activePlayer, onCellClick, onEditRightClick, editMode, flipped, sideLayout }) {
  const hlSet  = highlightSet || new Set();
  const FILES  = flipped ? FILES_FLIPPED : FILES_NORMAL;
  const RANKS  = flipped ? RANKS_FLIPPED : RANKS_NORMAL;
  const ORDER  = flipped ? ORDER_FLIPPED : ORDER_NORMAL;

  const getCellState = (ri, ci) => {
    const key = `${ri},${ci}`;
    if (selectedCell?.row === ri && selectedCell?.col === ci) return 'selected';
    if (hlSet.has(key)) return 'highlight';
    if (lastMove?.to === key) return 'lastMoveTo';
    if (lastMove?.from === key) return 'lastMoveFrom';
    return 'normal';
  };

  const cells = [];
  ORDER.forEach(ri => {
    ORDER.forEach(ci => {
      cells.push(
        <Cell
          key={`${ri}-${ci}`}
          piece={board[ri]?.[ci]}
          cellState={getCellState(ri, ci)}
          flipped={flipped}
          sideLayout={sideLayout}
          onClick={() => onCellClick?.(ri, ci)}
          onContextMenu={onEditRightClick ? () => onEditRightClick(ri, ci) : undefined}
          editMode={editMode}
        />
      );
    });
  });

  return (
    <div className="flex flex-col min-w-0 min-h-0">
      {/* 筋ラベル */}
      <div className="grid mb-0.5" style={{ gridTemplateColumns: 'repeat(9, minmax(0, 1fr)) 18px' }}>
        {FILES.map(f => (
          <div key={f} className="text-center text-gray-400"
            style={{ fontSize: 'clamp(9px, 1.8vw, 13px)', minWidth: 0, overflow: 'hidden' }}>{f}</div>
        ))}
        <div />
      </div>

      {/* 盤 + 段ラベル */}
      <div className="flex">
        <div className="relative flex-1 min-w-0" style={{ containerType: 'inline-size' }}>
          <div
            className={`grid rounded border-2 ${editMode ? 'border-blue-500' : 'border-boardBorder'}`}
            style={{ gridTemplateColumns: 'repeat(9, minmax(0, 1fr))', overflow: 'hidden' }}
          >
            {cells}
          </div>
          <CandidateArrows candidateArrows={candidateArrows} flipped={flipped} activePlayer={activePlayer} hands={hands} />
        </div>
        <div className="flex flex-col flex-shrink-0" style={{ width: 18 }}>
          {RANKS.map(r => (
            <div
              key={r}
              className="flex-1 flex items-center justify-center text-gray-400
                border-l border-gray-700/50"
              style={{ fontSize: 'clamp(9px, 1.8vw, 13px)' }}
            >
              {r}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 持駒タイル
// ─────────────────────────────────────────────
function HandTile({ type, count, player, isActive, isMyTurn, onSelect, onRightClick, editMode, size = 44 ,flipped}) {
  const clickable = isMyTurn || editMode;
  const shouldRotate = flipped ? player === 1 : player === 2;
  return (
    <button
      onClick={() => clickable && onSelect({ player, type })}
      onContextMenu={editMode ? (e) => { e.preventDefault(); onRightClick?.({ player, type }); } : undefined}
      title={`${getPieceChar(type, player)}を打つ`}
      data-drop-piece={type}
      data-drop-player={player}
      className="flex flex-col items-center justify-center rounded active:scale-95 select-none"
      style={{
        width: size, height: size, flexShrink: 0,
        ...(isActive
          ? { background: '#FDE047', border: '2px solid #A16207', boxShadow: '0 0 10px rgba(250,204,21,0.7)', transform: 'scale(1.08)' }
          : clickable
            ? { background: 'linear-gradient(170deg, #FFFBEF 0%, #FDF3D0 100%)', border: '1.5px solid #92622A', boxShadow: '0 2px 4px rgba(0,0,0,0.45)' }
            : { background: 'linear-gradient(170deg, #EDE0C0 0%, #DDD0A8 100%)', border: '1.5px solid #7A5218' }
        ),
      }}
    >
      <span className="leading-none" style={{ fontSize: Math.round(size * 0.62), fontWeight: 900, color: '#000000', display: 'block', lineHeight: 1, transform: shouldRotate ? 'rotate(180deg)' : 'none' }}>
        {getPieceChar(type, player)}
      </span>
      {count > 1 && (
        <span className="leading-none font-bold" style={{ fontSize: Math.max(10, Math.round(size * 0.28)), color: '#78350f', marginTop: 1 }}>{count}</span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────
// 持駒行（モバイル・横並び）
// ─────────────────────────────────────────────
function HandRow({ hands, player, activePlayer, dropSelected, onDropSelect, onEditRightClick, editMode, align ,flipped}) {
  const pieces = Object.entries(hands[player] || {});
  const isMyTurn = activePlayer === player;
  return (
    <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      <span className="text-[10px] text-gray-500 shrink-0 leading-none">
        {player === 2 ? '後手持駒' : '先手持駒'}
      </span>
      {pieces.length === 0 ? (
        <span className="text-[10px] text-gray-600">なし</span>
      ) : (
        pieces.map(([type, count]) => (
          <HandTile
            key={type} type={type} count={count} player={player}
            isActive={dropSelected?.player === player && dropSelected?.type === type}
            isMyTurn={isMyTurn}
            onSelect={onDropSelect}
            onRightClick={onEditRightClick}
            editMode={editMode}
            flipped={flipped}
          />
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 持駒列（デスクトップ・縦並び）
// pieceAlign: 'top' = 駒台上部, 'bottom' = 駒台下部
// ─────────────────────────────────────────────
export function HandColumnVertical({ hands, player, activePlayer, dropSelected, onDropSelect, onEditRightClick, onHandAreaClick, editMode, pieceAlign = 'top' ,flipped}) {
  const pieces = Object.entries(hands[player] || {});
  const isMyTurn = activePlayer === player;
  const containerRef = useRef(null);
  const [tileSize, setTileSize] = useState(44);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      const n = pieces.length || 1;
      // 36px = label (~18px) + py-2 padding (8px) + small buffer (10px)
      // 6px = gap-1.5 between tiles
      const computed = Math.floor((h - 36 - (n - 1) * 6) / n);
      setTileSize(Math.max(24, Math.min(44, computed)));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [pieces.length]);

  const label = (
    <span className="text-[9px] leading-tight text-center shrink-0" style={{ color: '#6B4C1A' }}>
      {player === 2 ? '後手' : '先手'}<br />持駒
    </span>
  );

  const tiles = (
    <div className="flex flex-col items-center gap-1.5">
      {pieces.length === 0 ? (
        <span className="text-[9px] text-center leading-tight" style={{ color: '#8B6A3A' }}>な<br />し</span>
      ) : (
        pieces.map(([type, count]) => (
          <HandTile
            key={type} type={type} count={count} player={player}
            isActive={dropSelected?.player === player && dropSelected?.type === type}
            isMyTurn={isMyTurn}
            onSelect={onDropSelect}
            onRightClick={onEditRightClick}
            editMode={editMode}
            size={tileSize}
            flipped={flipped}
          />
        ))
      )}
    </div>
  );

  return (
    <div
      ref={containerRef}
      onClick={editMode ? () => onHandAreaClick?.(player) : undefined}
      className="flex flex-col items-center py-2 px-1 rounded-lg shadow-inner"
      style={{
        minWidth: 52,
        background: editMode
          ? 'linear-gradient(135deg, #4B6BD4 0%, #3A5AC8 40%, #2E47B8 100%)'
          : 'linear-gradient(135deg, #D4A84B 0%, #C8943A 40%, #B8832E 100%)',
        border: editMode ? '1px solid rgba(80,120,200,0.6)' : '1px solid rgba(100,60,15,0.45)',
        boxShadow: 'inset 0 1px 3px rgba(255,220,120,0.4), 0 2px 6px rgba(0,0,0,0.35)',
        cursor: editMode ? 'pointer' : 'default',
      }}
    >
      {label}
      {pieceAlign === 'bottom'
        ? <><div className="flex-1" />{tiles}</>
        : <div className="mt-1.5">{tiles}</div>
      }
    </div>
  );
}

// ─────────────────────────────────────────────
// 持駒行（モバイル・上下配置用）
// align: 'left' = 左寄せ(下手)  'right' = 右寄せ(上手)
// ─────────────────────────────────────────────
export function HandRowHorizontal({ hands, player, activePlayer, dropSelected, onDropSelect, onEditRightClick, onHandAreaClick, editMode, align = 'left' ,flipped}) {
  const pieces = Object.entries(hands[player] || {});
  const isMyTurn = activePlayer === player;

  return (
    <div
      onClick={editMode ? () => onHandAreaClick?.(player) : undefined}
      className={`flex flex-wrap items-center gap-1 px-2 py-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}
      style={{
        minHeight: 52,
        background: editMode
          ? 'linear-gradient(135deg, #4B6BD4 0%, #3A5AC8 40%, #2E47B8 100%)'
          : 'linear-gradient(135deg, #D4A84B 0%, #C8943A 40%, #B8832E 100%)',
        border: editMode ? '1px solid rgba(80,120,200,0.6)' : '1px solid rgba(100,60,15,0.45)',
        boxShadow: 'inset 0 1px 3px rgba(255,220,120,0.4)',
        cursor: editMode ? 'pointer' : 'default',
      }}
    >
      {pieces.length === 0 ? (
        <span className="text-[10px] px-1 select-none" style={{ color: editMode ? '#a0b4e0' : '#8B6A3A' }}>持駒なし</span>
      ) : (
        pieces.map(([type, count]) => (
          <HandTile
            key={type} type={type} count={count} player={player}
            isActive={dropSelected?.player === player && dropSelected?.type === type}
            isMyTurn={isMyTurn}
            onSelect={onDropSelect}
            onRightClick={onEditRightClick}
            editMode={editMode}
            size={40}
            flipped={flipped}
          />
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ShogiBoard メイン（モバイル用）
// ─────────────────────────────────────────────
export default function ShogiBoard({
  board, hands, activePlayer,
  selectedCell, highlightSet, lastMove, candidateArrows,
  onCellClick, onDropSelect, dropSelected, flipped, inCheck,
  editMode, onEditRightClick, onEditHandSelect, onEditHandRightClick, onHandAreaClick,
}) {
  return (
    <div className="flex flex-col gap-2 px-2 select-none">
      {/* 後手エリア（上）*/}
      <div className="flex items-center justify-between gap-2 min-h-[52px] px-1">
        <HandRow hands={hands} player={flipped ? 1 : 2} activePlayer={activePlayer}
          dropSelected={dropSelected}
          onDropSelect={editMode ? onEditHandSelect : onDropSelect}
          onEditRightClick={onEditHandRightClick}
          onHandAreaClick={onHandAreaClick}
          editMode={editMode}
          flipped={flipped}
          align="left" />
        <div className="flex items-center gap-1.5 shrink-0">
          {inCheck && activePlayer === (flipped ? 1 : 2) && (
            <span className="text-[10px] font-bold text-red-400 animate-pulse">王手</span>
          )}
          <span className="text-[10px] text-gray-500">{flipped ? '先手' : '後手'}</span>
          <div className={`w-3 h-3 rounded-full transition-all
            ${activePlayer === (flipped ? 1 : 2) ? 'bg-red-400 shadow-md shadow-red-400/60 scale-110' : 'bg-gray-700'}`} />
        </div>
      </div>

      <BoardCore
        board={board} selectedCell={selectedCell}
        highlightSet={highlightSet} lastMove={lastMove} candidateArrows={candidateArrows}
        onCellClick={onCellClick} flipped={flipped}
        editMode={editMode} onEditRightClick={onEditRightClick}
      />

      {/* 先手エリア（下）*/}
      <div className="flex items-center justify-between gap-2 min-h-[52px] px-1">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={`w-3 h-3 rounded-full transition-all
            ${activePlayer === (flipped ? 2 : 1) ? 'bg-blue-400 shadow-md shadow-blue-400/60 scale-110' : 'bg-gray-700'}`} />
          <span className="text-[10px] text-gray-500">{flipped ? '後手' : '先手'}</span>
          {inCheck && activePlayer === (flipped ? 2 : 1) && (
            <span className="text-[10px] font-bold text-red-400 animate-pulse">王手</span>
          )}
        </div>
        <HandRow hands={hands} player={flipped ? 2 : 1} activePlayer={activePlayer}
          dropSelected={dropSelected}
          onDropSelect={editMode ? onEditHandSelect : onDropSelect}
          onEditRightClick={onEditHandRightClick}
          onHandAreaClick={onHandAreaClick}
          editMode={editMode}
          flipped={flipped}
          align="right" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 局面編集: 駒パレット
// ─────────────────────────────────────────────
const PALETTE_TYPES = [
  { type: 'K', label: '王将' },
  { type: 'R', label: '飛車' },
  { type: 'B', label: '角行' },
  { type: 'G', label: '金将' },
  { type: 'S', label: '銀将' },
  { type: 'N', label: '桂馬' },
  { type: 'L', label: '香車' },
  { type: 'P', label: '歩兵' },
  { type: '+R', label: '竜王' },
  { type: '+B', label: '竜馬' },
];

export function EditPalette({ editHeld, onPick }) {
  return (
    <div className="flex flex-col gap-2">
      {[1, 2].map(player => (
        <div key={player}>
          <div className="text-[10px] text-gray-400 mb-1">{player === 1 ? '先手' : '後手'}の駒</div>
          <div className="flex flex-wrap gap-1">
            {PALETTE_TYPES.map(({ type }) => {
              const isHeld = editHeld?.pieceType === type && editHeld?.player === player;
              const promoted = type.startsWith('+');
              return (
                <button
                  key={`${player}-${type}`}
                  onClick={() => onPick(type, player)}
                  className={`w-8 h-8 rounded text-xs font-bold transition-colors border
                    ${isHeld
                      ? 'bg-yellow-400 border-yellow-500 text-gray-900 scale-110'
                      : 'bg-gray-700 border-gray-600 hover:bg-gray-600 text-gray-100'}`}
                  style={{ color: isHeld ? '#1a1a1a' : promoted ? '#DC2626' : undefined,
                           transform: player === 2 ? 'rotate(180deg)' : 'none' }}
                >
                  {getPieceChar(type, player)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// 駒箱コンポーネント
// ─────────────────────────────────────────────
const BOX_ORDER = ['K', 'R', 'B', 'G', 'S', 'N', 'L', 'P'];

export function PieceBox({ editBox, editHeld, onPick, onMoveAllToBox, onReturnToBox }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-gray-200">駒箱</span>
        <button
          onClick={onMoveAllToBox}
          className="text-[10px] px-2 py-1 rounded bg-amber-900/50 hover:bg-amber-800/70 text-amber-300 hover:text-amber-100 transition-colors border border-amber-800/50 whitespace-nowrap"
        >
          全部移動
        </button>
      </div>
      {editHeld && (
        <button
          onClick={onReturnToBox}
          className="flex items-center justify-center gap-1.5 py-1.5 rounded border text-xs font-bold transition-all active:scale-95"
          style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.5)', color: '#a5b4fc' }}
        >
          <span style={{ fontSize: 14 }}>{getPieceChar(editHeld.pieceType, editHeld.player)}</span>
          <span>→ 駒箱に返す</span>
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        {BOX_ORDER.map(type => {
          const count = (editBox || {})[type] || 0;
          const isHeld = editHeld?.pieceType === type;
          return (
            <button
              key={type}
              onClick={() => count > 0 && onPick(type)}
              disabled={count === 0}
              className={`relative flex flex-col items-center justify-center rounded-lg border-2 transition-all select-none
                ${count === 0
                  ? 'opacity-20 cursor-default border-gray-700 bg-gray-800/40'
                  : isHeld
                    ? 'bg-yellow-400 border-yellow-500 text-gray-900 scale-110 shadow-lg shadow-yellow-400/40'
                    : 'bg-gray-700 border-gray-600 hover:bg-gray-600 hover:border-gray-500 text-gray-100 cursor-pointer active:scale-95'}`}
              style={{ width: 44, height: 44 }}
            >
              <span className="font-bold leading-none" style={{ fontSize: 18, color: isHeld ? '#1a1a1a' : '#f3f4f6' }}>
                {getPieceChar(type, 1)}
              </span>
              {count > 0 && (
                <span className="text-[9px] leading-none mt-0.5 font-semibold">{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PieceBoxHorizontal({ editBox, editHeld, onPick, onMoveAllToBox, onReturnToBox, onFlatHand, onTsumeSetup }) {
  const holding = !!editHeld;

  const btnBase = 'text-[10px] px-2 py-1 rounded shrink-0 whitespace-nowrap transition-all active:scale-95 border font-medium select-none';

  return (
    <div className="flex flex-col"
      style={{ background: 'linear-gradient(180deg, #1a1f2e 0%, #0f1420 100%)', borderTop: '1px solid rgba(75,85,99,0.4)' }}
    >
      {/* 上段: アクションボタン */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-800/60">
        <span className="text-[9px] font-bold text-gray-500 shrink-0 mr-0.5">局面</span>
        <button onClick={(e) => { e.stopPropagation(); onFlatHand?.(); }}
          className={btnBase}
          style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#86efac' }}>
          平手
        </button>
        <button onClick={(e) => { e.stopPropagation(); onTsumeSetup?.(); }}
          className={btnBase}
          style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#d8b4fe' }}>
          詰将棋
        </button>
        <button onClick={(e) => { e.stopPropagation(); onMoveAllToBox(); }}
          className={btnBase}
          style={{ background: 'rgba(180,83,9,0.2)', border: '1px solid rgba(180,83,9,0.45)', color: '#fbbf24' }}>
          全駒箱へ
        </button>
      </div>

      {/* 下段: 駒箱 */}
      <div
        onClick={holding ? onReturnToBox : undefined}
        className="flex items-center gap-2 px-3 py-1.5"
        style={{
          background: holding ? 'rgba(99,102,241,0.12)' : 'transparent',
          borderTop: holding ? '1px solid rgba(99,102,241,0.5)' : '1px solid transparent',
          cursor: holding ? 'copy' : 'default',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <span className="text-[9px] font-bold shrink-0 select-none" style={{ color: holding ? '#a5b4fc' : '#6366f1' }}>
          {holding ? '↓駒箱' : '駒箱'}
        </span>
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {BOX_ORDER.map(type => {
            const count = (editBox || {})[type] || 0;
            const isHeld = editHeld?.pieceType === type;
            return (
              <button
                key={type}
                onClick={(e) => { e.stopPropagation(); count > 0 && onPick(type); }}
                disabled={count === 0}
                className={`relative flex items-center justify-center rounded border-2 transition-all select-none
                  ${count === 0
                    ? 'opacity-20 cursor-default border-gray-700 bg-gray-800/40'
                    : isHeld
                      ? 'bg-yellow-400 border-yellow-500 text-gray-900 scale-110 shadow shadow-yellow-400/40'
                      : 'bg-gray-700 border-gray-600 hover:bg-gray-600 text-gray-100 cursor-pointer active:scale-95'}`}
                style={{ width: 30, height: 30, flexShrink: 0, position: 'relative' }}
              >
                <span className="font-bold leading-none" style={{ fontSize: 13, color: isHeld ? '#1a1a1a' : '#f3f4f6' }}>
                  {getPieceChar(type, 1)}
                </span>
                {count > 1 && (
                  <span className="absolute bottom-0 right-0.5 font-bold leading-none" style={{ fontSize: 7, color: isHeld ? '#1a1a1a' : '#9ca3af' }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}