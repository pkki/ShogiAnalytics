import { useRef, useEffect, useState } from 'react';
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

function Cell({ piece, cellState, onClick, flipped, sideLayout }) {
  const promoted = piece && isPromoted(piece.type);
  const shouldRotate = piece
    ? (flipped ? piece.player === 1 : piece.player === 2)
    : false;
  return (
    <div
      onClick={onClick}
      className={`${CELL_BG[cellState] ?? CELL_BG.normal}
        border border-boardBorder/50 flex items-center justify-center
        select-none transition-colors active:scale-95 hover:brightness-90`}
      style={{ aspectRatio: '9 / 10' }}
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
// 最善手 赤矢印オーバーレイ（polygon で確実に描画）
// viewBox "0 0 9 10" かつ各セル aspect 9:10 のため
// x/y スケールは等倍 → polygon がそのまま正しい形になる
// ─────────────────────────────────────────────
function BestMoveArrow({ bestMove, flipped, activePlayer, hands }) {
  const svgRef = useRef(null);
  const [dropOrigin, setDropOrigin] = useState(null);

  const isDrop = !!(bestMove?.to && !bestMove.from && bestMove.dropPiece);

  useEffect(() => {
    if (!isDrop) { setDropOrigin(null); return; }

    const measure = () => {
      const svg = svgRef.current;
      if (!svg) return;
      const grid = svg.parentElement;
      if (!grid) return;

      // 同じレイアウト内の駒台タイルをdata属性で検索
      const scope = svg.closest('[data-board-area]');
      if (!scope) return;
      const tile = scope.querySelector(
        `[data-drop-piece="${bestMove.dropPiece}"][data-drop-player="${activePlayer}"]`
      );
      if (!tile) return;

      const gridRect = grid.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      if (gridRect.width < 1 || gridRect.height < 1) return;

      // 駒台タイルの中心をSVG座標(viewBox 0 0 9 10)に変換
      setDropOrigin({
        fx: (tileRect.left + tileRect.width / 2 - gridRect.left) / gridRect.width * 9,
        fy: (tileRect.top + tileRect.height / 2 - gridRect.top) / gridRect.height * 10,
      });
    };

    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    const svg = svgRef.current;
    if (svg?.parentElement) ro.observe(svg.parentElement);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [isDrop, bestMove?.dropPiece, activePlayer, flipped, hands]);

  if (!bestMove?.to) return null;

  const vr = (r) => flipped ? 8 - r : r;
  const vc = (c) => flipped ? 8 - c : c;
  const cx = (c) => c + 0.5;
  const cy = (r) => (r + 0.5) * (10 / 9);

  const tr = vr(bestMove.to[0]), tc = vc(bestMove.to[1]);
  const tx = cx(tc), ty = cy(tr);

  if (isDrop) {
    // 打ち駒: 駒台の実際のDOM位置から矢印を描画
    let arrowContent = null;
    if (dropOrigin) {
      let { fx, fy } = dropOrigin;

      // 駒台は盤面の外にあるので、始点を盤端付近にクリップ
      // これにより矢印が長すぎず、正しい角度で盤面に入る
      if (fx < 0 || fx > 9) {
        const clipX = fx < 0 ? -0.15 : 9.15;
        const t = (clipX - fx) / (tx - fx);
        fy = fy + t * (ty - fy);
        fx = clipX;
      }

      const dx = tx - fx, dy = ty - fy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len >= 0.01) {
        const ux = dx / len, uy = dy / len;
        const px = -uy, py = ux;
        const pad = 0.05, shaftW = 0.14, headLen = 0.38, headW = 0.26, tipInset = 0.04;
        const sx = fx + ux * pad, sy = fy + uy * pad;
        const baseX = tx - ux * headLen, baseY = ty - uy * headLen;
        const tipX = tx - ux * tipInset, tipY = ty - uy * tipInset;
        const s1 = [sx + px*shaftW, sy + py*shaftW];
        const s2 = [sx - px*shaftW, sy - py*shaftW];
        const b1 = [baseX + px*shaftW, baseY + py*shaftW];
        const b2 = [baseX - px*shaftW, baseY - py*shaftW];
        const h1 = [baseX + px*headW, baseY + py*headW];
        const h2 = [baseX - px*headW, baseY - py*headW];
        const pts = (arr) => arr.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(' ');
        arrowContent = (
          <>
            <rect x={tc} y={tr * 10/9} width={1} height={10/9}
              fill="rgba(239,68,68,0.30)" stroke="rgba(239,68,68,0.8)" strokeWidth="0.05" />
            <polygon points={pts([s1, s2, b2, b1])} fill="rgba(239,68,68,0.82)" />
            <polygon points={pts([h1, [tipX, tipY], h2])} fill="rgba(239,68,68,0.82)" />
          </>
        );
      }
    }

    return (
      <svg ref={svgRef} className="absolute inset-0 w-full h-full pointer-events-none z-10"
        viewBox="0 0 9 10" preserveAspectRatio="none"
        style={{ overflow: 'visible' }}>
        {arrowContent}
      </svg>
    );
  }

  const fr = vr(bestMove.from[0]), fc = vc(bestMove.from[1]);
  const fx = cx(fc), fy = cy(fr);
  const dx = tx - fx, dy = ty - fy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return null;

  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;  // 垂直方向

  const pad     = Math.min(0.30, len * 0.16);  // 始点を駒中心から離す
  const shaftW  = 0.14;   // シャフト半幅
  const headLen = 0.38;   // 矢印頭の長さ
  const headW   = 0.26;   // 矢印頭の半幅
  const tipInset = 0.04;  // 先端を目的地中心より少し手前に

  const sx    = fx + ux * pad,         sy    = fy + uy * pad;
  const baseX = tx - ux * headLen,     baseY = ty - uy * headLen;
  const tipX  = tx - ux * tipInset,    tipY  = ty - uy * tipInset;

  // シャフト四角形
  const s1 = [sx    + px * shaftW, sy    + py * shaftW];
  const s2 = [sx    - px * shaftW, sy    - py * shaftW];
  const b1 = [baseX + px * shaftW, baseY + py * shaftW];
  const b2 = [baseX - px * shaftW, baseY - py * shaftW];
  // 矢印頭三角形
  const h1 = [baseX + px * headW,  baseY + py * headW];
  const h2 = [baseX - px * headW,  baseY - py * headW];

  const pts = (arr) => arr.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(' ');

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none z-10"
      viewBox="0 0 9 10" preserveAspectRatio="none">
      {/* 移動元ハイライト */}
      <rect x={fc} y={fr * 10/9} width={1} height={10/9} fill="rgba(239,68,68,0.12)" />
      {/* 移動先ハイライト */}
      <rect x={tc} y={tr * 10/9} width={1} height={10/9} fill="rgba(239,68,68,0.28)" />
      {/* シャフト */}
      <polygon points={pts([s1, s2, b2, b1])} fill="rgba(239,68,68,0.82)" />
      {/* 矢印頭 */}
      <polygon points={pts([h1, [tipX, tipY], h2])} fill="rgba(239,68,68,0.82)" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// BoardCore: 盤面グリッド＋ラベル
// ─────────────────────────────────────────────
export function BoardCore({ board, hands, selectedCell, highlightSet, lastMove, bestMove, activePlayer, onCellClick, flipped, sideLayout }) {
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
        />
      );
    });
  });

  return (
    <div className="flex flex-col min-w-0 min-h-0">
      {/* 筋ラベル */}
      <div className="grid mb-0.5" style={{ gridTemplateColumns: 'repeat(9, 1fr) 18px' }}>
        {FILES.map(f => (
          <div key={f} className="text-center text-gray-400"
            style={{ fontSize: 'clamp(9px, 1.8vw, 13px)' }}>{f}</div>
        ))}
        <div />
      </div>

      {/* 盤 + 段ラベル */}
      <div className="flex">
        <div className="relative flex-1 min-w-0" style={{ containerType: 'inline-size' }}>
          <div
            className="grid border-2 border-boardBorder rounded shadow-xl shadow-black/60"
            style={{ gridTemplateColumns: 'repeat(9, 1fr)' }}
          >
            {cells}
          </div>
          <BestMoveArrow bestMove={bestMove} flipped={flipped} activePlayer={activePlayer} hands={hands} />
        </div>
        <div className="flex flex-col" style={{ width: 18 }}>
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
function HandTile({ type, count, player, isActive, isMyTurn, onSelect, size = 44 }) {
  return (
    <button
      onClick={() => isMyTurn && onSelect({ player, type })}
      title={`${getPieceChar(type, player)}を打つ`}
      data-drop-piece={type}
      data-drop-player={player}
      className={`flex flex-col items-center justify-center rounded-lg transition-all
        border-2 active:scale-95 select-none
        ${isActive
          ? 'bg-yellow-400 border-yellow-500 text-gray-900 shadow-lg shadow-yellow-400/40'
          : isMyTurn
            ? 'bg-gray-700 border-gray-600 hover:bg-gray-600 hover:border-gray-500 text-gray-100'
            : 'bg-gray-800 border-gray-700 text-gray-400 cursor-default'}`}
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      <span className="font-bold leading-none" style={{ fontSize: Math.round(size * 0.41), color: 'inherit', display: 'block' }}>
        {getPieceChar(type, player)}
      </span>
      {count > 1 && (
        <span className="leading-none mt-0.5 font-semibold" style={{ fontSize: Math.max(8, Math.round(size * 0.22)) }}>{count}</span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────
// 持駒行（モバイル・横並び）
// ─────────────────────────────────────────────
function HandRow({ hands, player, activePlayer, dropSelected, onDropSelect, align }) {
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
export function HandColumnVertical({ hands, player, activePlayer, dropSelected, onDropSelect, pieceAlign = 'top' }) {
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
            size={tileSize}
          />
        ))
      )}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center py-2 px-1 rounded-lg shadow-inner"
      style={{
        minWidth: 52,
        background: 'linear-gradient(135deg, #D4A84B 0%, #C8943A 40%, #B8832E 100%)',
        border: '1px solid rgba(100,60,15,0.45)',
        boxShadow: 'inset 0 1px 3px rgba(255,220,120,0.4), 0 2px 6px rgba(0,0,0,0.35)',
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
// ShogiBoard メイン（モバイル用）
// ─────────────────────────────────────────────
export default function ShogiBoard({
  board, hands, activePlayer,
  selectedCell, highlightSet, lastMove, bestMove,
  onCellClick, onDropSelect, dropSelected, flipped, inCheck,
}) {
  return (
    <div className="flex flex-col gap-2 px-2 select-none">
      {/* 後手エリア（上）*/}
      <div className="flex items-center justify-between gap-2 min-h-[52px] px-1">
        <HandRow hands={hands} player={flipped ? 1 : 2} activePlayer={activePlayer}
          dropSelected={dropSelected} onDropSelect={onDropSelect} align="left" />
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
        highlightSet={highlightSet} lastMove={lastMove} bestMove={bestMove}
        onCellClick={onCellClick} flipped={flipped}
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
          dropSelected={dropSelected} onDropSelect={onDropSelect} align="right" />
      </div>
    </div>
  );
}
