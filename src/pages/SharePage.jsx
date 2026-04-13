import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, List, Download } from 'lucide-react';
import { parseKIF } from '../parsers/kifParser';
import { buildTreeFromMoves, buildPVStates, buildPVStatesUSI, parseUSIMove, createHandicapBoard, createInitialHands, KIF_NAME_TO_HANDICAP } from '../state/gameState';
import { BoardCore, HandColumnVertical, HandRowHorizontal } from '../components/ShogiBoard';
import { EvalBarVertical } from '../components/EvaluationMeter';
import PlayerInfo from '../components/PlayerInfo';
import EvaluationGraph from '../components/EvaluationGraph';
import CandidateMoves from '../components/CandidateMoves';
import MoveList from '../components/MoveList';
import PVBoard from '../components/PVBoard';

const CLOUD_API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';
function toKey(rc) { return rc ? `${rc[0]},${rc[1]}` : null; }

// ── ドラッグリサイズ (App.jsx と同じ実装) ────────────────────────
function startDrag(e, startPx, onUpdate, axis = 'x', inverted = false) {
  e.preventDefault();
  const isTouch = e.type === 'touchstart';
  const getCoord = (ev) => {
    const src = isTouch ? (ev.touches?.[0] ?? ev.changedTouches?.[0]) : ev;
    return axis === 'x' ? src.clientX : src.clientY;
  };
  const start  = getCoord(e);
  const onMove = (ev) => { onUpdate(Math.round(startPx + (inverted ? -(getCoord(ev) - start) : getCoord(ev) - start))); };
  const cleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', cleanup);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', cleanup);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
  };
  if (isTouch) {
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', cleanup);
  } else {
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', cleanup);
  }
}

function DragHandle({ axis, onMouseDown }) {
  return (
    <div onMouseDown={onMouseDown} onTouchStart={onMouseDown}
      className={`flex-shrink-0 group relative z-10 flex items-center justify-center touch-none
        transition-colors hover:bg-blue-500/30 active:bg-blue-500/50
        ${axis === 'x' ? 'cursor-col-resize' : 'cursor-row-resize'}`}
      style={{ ...(axis === 'x' ? { width: 4 } : { height: 8 }), background: '#334155', userSelect: 'none', WebkitUserSelect: 'none' }}>
      <div className={`absolute rounded-full bg-blue-400 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity
        ${axis === 'x' ? 'w-0.5 h-8' : 'h-1 w-10'}`} />
    </div>
  );
}

// ── モバイル指し手ボトムシート ──────────────────────────────────
function MobileMoveListSheet({ open, onClose, nodes, mainLineIds, currentId, onNavigate, termination }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    else      setVisible(false);
  }, [open]);
  if (!open) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-[50]">
      <div className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose} />
      <div className={`absolute inset-x-0 bottom-0 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl
        flex flex-col transition-transform duration-200 ease-out ${visible ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ height: '35dvh' }}>
        <div className="flex justify-center pt-2 pb-1 flex-shrink-0" onClick={onClose}>
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>
        <MoveList nodes={nodes} moveListIds={mainLineIds} branchStart={-1}
          currentId={currentId} onNavigate={onNavigate} termination={termination} />
      </div>
    </div>
  );
}

export default function SharePage() {
  const { token } = useParams();
  const { t } = useTranslation();

  const [status, setStatus]       = useState('loading');
  const [errorMsg, setErrorMsg]   = useState('');
  const [title, setTitle]         = useState('');
  const [rawContent, setRawContent] = useState('');
  const [gameInfo, setGameInfo]   = useState({ sente: t('app.sente'), gote: t('app.gote') });

  // ゲームツリー
  const [nodes, setNodes]             = useState({});
  const [mainLineIds, setMainLineIds] = useState([]);
  const [currentId, setCurrentId]     = useState(null);
  const [termination, setTermination] = useState(null);

  const currentIdRef = useRef(null);
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);

  // パネルサイズ
  const [panelSizes, setPanelSizes] = useState({
    desktopGraphPx:    140,   // デスクトップ: 形勢グラフ高さ（指し手はflex-1で残り全部）
    candidatePx:       210,   // デスクトップ: 候補手エリア高さ
    mobileBoardSizePx: null,  // モバイル: 盤面幅 (null=100%)
    mobileGraphPx:     90,    // モバイル: 形勢グラフ高さ
  });

  // デスクトップ: 盤面カラム高さを計測して横幅の初期値を自動算出
  const boardColumnRef = useRef(null);
  const [boardColumnH, setBoardColumnH] = useState(0);
  const boardPxOverrideRef = useRef(false); // ユーザーがドラッグ調整したら true
  useEffect(() => {
    const el = boardColumnRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setBoardColumnH(entry.contentRect.height));
    obs.observe(el);
    return () => obs.disconnect();
  }, [status]); // status='loaded' 後に div が現れるので status を依存に入れる
  // 使える高さ = カラム高さ - PlayerInfo行 - navエリア - padding/gap
  // (pt-2+pb-1=12, gap-1.5×2=12, PlayerInfo行≈36, nav≈32 → 合計92px)
  const autoBoardPx = useMemo(() => {
    if (boardColumnH <= 0) return 500;
    const availH = boardColumnH - 92;
    return Math.max(200, Math.round(availH * 0.9 + 104));
  }, [boardColumnH]);
  // ユーザーが未調整なら自動値、調整済みなら手動値を使う
  const boardPx = boardPxOverrideRef.current ? (panelSizes.boardPx ?? autoBoardPx) : autoBoardPx;

  const mobileBoardRef = useRef(null);

  // UI
  const [showMoveList, setShowMoveList]       = useState(false);
  const [pvCandidate, setPvCandidate]         = useState(null);
  const [displayMultiPV, setDisplayMultiPV]   = useState(5);

  // ── KIF 読み込み ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res  = await fetch(`${CLOUD_API}/api/share/${token}`);
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || t('share.notFound'));
        if (cancelled) return;

        setTitle(data.title || t('share.sharedKifu'));
        setRawContent(data.content);
        const { moves, gameInfo: gi, initialBoard, initialHands, goteFirst } = parseKIF(data.content);

        // 手合割：XX落ち → 駒落ち初期盤面を生成（盤面図がない場合）
        let resolvedBoard = initialBoard;
        let resolvedHands = initialHands;
        if (!resolvedBoard && gi.handicap) {
          const hType = KIF_NAME_TO_HANDICAP[gi.handicap];
          if (hType) {
            resolvedBoard = createHandicapBoard(hType);
            resolvedHands = createInitialHands();
          }
        }

        if (moves.length === 0 && !resolvedBoard) throw new Error(t('share.failedToAnalyze'));

        const tree = buildTreeFromMoves(
          moves,
          { board: resolvedBoard ?? null, hands: resolvedHands ?? null, goteFirst },
        );

        const terminationMatch = data.content.match(
          /^\s*\d+\s*(投了|中断|詰み|千日手|持将棋|切れ負け|反則勝ち|反則負け|入玉勝ち|不戦勝|不戦敗|不詰)/m
        );
        const terminationLabel = terminationMatch?.[1] ?? null;
        if (terminationLabel) {
          const totalMoves = tree.mainLineIds.length - 1;
          const nextPlayer = totalMoves % 2 === 0 ? 1 : 2;
          let winner = null;
          if (['投了', '切れ負け', '反則負け'].includes(terminationLabel)) {
            winner = nextPlayer === 1 ? 2 : 1;
          } else if (terminationLabel === '反則勝ち') {
            winner = nextPlayer;
          } else if (terminationLabel === '詰み') {
            winner = nextPlayer === 1 ? 2 : 1;
          } else if (terminationLabel === '入玉勝ち') {
            winner = nextPlayer;
          } else if (terminationLabel === '不戦勝') {
            winner = 1;
          } else if (terminationLabel === '不戦敗') {
            winner = 2;
          }
          setTermination({ label: terminationLabel, moveNumber: totalMoves + 1, winner });
        }

        const updatedNodes = { ...tree.nodes };
        moves.forEach((mv, i) => {
          if (!mv.preCandidates?.length) return;
          const nodeId = tree.mainLineIds[i];
          if (!nodeId || !updatedNodes[nodeId]) return;
          const absCands = mv.preCandidates.map(c => ({ ...c, isAbsolute: true }));
          const best     = absCands.find(c => c.multipv === 1) ?? absCands[0];
          updatedNodes[nodeId] = { ...updatedNodes[nodeId], savedCandidates: absCands, evalScore: best?.score ?? null };
        });

        setNodes(updatedNodes);
        setMainLineIds(tree.mainLineIds);
        setCurrentId(tree.rootId);
        setGameInfo({ sente: gi.senteName || t('app.sente'), gote: gi.goteName || t('app.gote') });
        if (tree.parseError != null) {
          setErrorMsg(`${t('share.loadFailed')} (${tree.parseError}${t('app.moveNumber')}).`);
        }
        setStatus('loaded');
      } catch (e) {
        if (!cancelled) { setErrorMsg(e.message); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ── ナビゲーション ────────────────────────────────────────
  const currentIdx = useMemo(() => mainLineIds.indexOf(currentId), [mainLineIds, currentId]);
  const total      = mainLineIds.length - 1;

  const goTo = useCallback((idx) => {
    const id = mainLineIds[Math.max(0, Math.min(total, idx))];
    if (id) setCurrentId(id);
  }, [mainLineIds, total]);

  const navigateTo = useCallback((id) => setCurrentId(id), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft')  goTo(mainLineIds.indexOf(currentIdRef.current) - 1);
      if (e.key === 'ArrowRight') goTo(mainLineIds.indexOf(currentIdRef.current) + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, mainLineIds]);

  // ── 盤面データ ────────────────────────────────────────────
  const currentNode  = nodes[currentId];
  const board        = currentNode?.board;
  const hands        = currentNode?.hands;
  const lastMove     = currentNode ? { from: toKey(currentNode.moveFrom), to: toKey(currentNode.moveTo) } : null;
  const activePlayer = currentNode ? (currentNode.moveNumber % 2 === 0 ? 1 : 2) : 1;
  const evalScore    = currentNode?.evalScore ?? null;

  // ── 候補手 ────────────────────────────────────────────────
  const savedCandidates = currentNode?.savedCandidates ?? [];
  const candidates = useMemo(() =>
    savedCandidates
      .slice(0, displayMultiPV)
      .map(c => ({ ...c, move: c.pvJP?.split(/\s+/)[0] || '?', eval: c.score, pv: c.pvJP || '' })),
  [savedCandidates, displayMultiPV]);

  // ── 候補手矢印 ────────────────────────────────────────────
  const arrowCount = useMemo(() => {
    const v = parseInt(localStorage.getItem('shogi_arrow_count') ?? '4', 10);
    return isNaN(v) ? 4 : Math.max(0, Math.min(4, v));
  }, []);

  const candidateArrows = useMemo(() => {
    if (!savedCandidates.length) return [];
    const LABELS = ['最', '次', '3', '4'];
    const fullWidth  = { '１':1,'２':2,'３':3,'４':4,'５':5,'６':6,'７':7,'８':8,'９':9 };
    const kanjiRow   = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
    const kanjiPiece = { '歩':'P','香':'L','桂':'N','銀':'S','金':'G','角':'B','飛':'R' };

    const sorted = [...savedCandidates]
      .sort((a, b) => (a.multipv ?? 99) - (b.multipv ?? 99))
      .slice(0, arrowCount);

    const result = [];
    sorted.forEach((cand, i) => {
      let arrow = null;
      if (cand.pvUSI) {
        const firstUSI = cand.pvUSI.trim().split(/\s+/)[0];
        const mv = parseUSIMove(firstUSI);
        if (mv) arrow = mv.isDrop ? { from: null, to: mv.to, dropPiece: mv.piece } : { from: mv.from, to: mv.to };
      } else if (cand.pvJP) {
        const firstMove = cand.pvJP.trim().split(/\s+/)[0];
        const dropMatch = firstMove.match(/[▲△]([１-９])([一二三四五六七八九])([歩香桂銀金角飛])打/);
        if (dropMatch) {
          arrow = { from: null, to: [kanjiRow[dropMatch[2]] - 1, 9 - fullWidth[dropMatch[1]]], dropPiece: kanjiPiece[dropMatch[3]] ?? null };
        } else {
          const moveMatch = firstMove.match(/[▲△]([１-９])([一二三四五六七八九])[^\(]*\((\d)(\d)\)/);
          if (moveMatch) {
            arrow = {
              from: [parseInt(moveMatch[4]) - 1, 9 - parseInt(moveMatch[3])],
              to:   [kanjiRow[moveMatch[2]] - 1, 9 - fullWidth[moveMatch[1]]],
            };
          }
        }
      }
      if (arrow) result.push({ ...arrow, rank: i + 1, label: LABELS[i] });
    });
    return result;
  }, [savedCandidates, arrowCount]);

  // ── PV局面列 ──────────────────────────────────────────────
  const pvStates = useMemo(() => {
    if (!pvCandidate || !board || !hands) return null;
    try {
      return pvCandidate.pvUSI
        ? buildPVStatesUSI(pvCandidate.pvUSI, board, hands, activePlayer)
        : buildPVStates(pvCandidate.pv ?? '', board, hands, activePlayer);
    } catch { return null; }
  }, [pvCandidate, board, hands, activePlayer]);

  // ── 形勢グラフデータ ──────────────────────────────────────
  const graphData = useMemo(() => {
    const data = mainLineIds.map((id, i) => {
      const node = nodes[id];
      return { move: i, nodeId: id, eval: node?.evalScore ?? null, label: node?.label ?? '開始局面', quality: null, cpl: 0 };
    });
    for (let i = 1; i < data.length; i++) {
      const curr = data[i]; const prev = data[i - 1];
      if (curr.eval == null || prev.eval == null) continue;
      const mover = i % 2 === 1 ? 1 : 2;
      const cpl = mover === 1 ? Math.max(0, prev.eval - curr.eval) : Math.max(0, curr.eval - prev.eval);
      const imp  = mover === 1 ? Math.max(0, curr.eval - prev.eval) : Math.max(0, prev.eval - curr.eval);
      curr.cpl = cpl;
      if      (cpl >= 500) curr.quality = 'blunder';
      else if (cpl >= 300) curr.quality = 'dubious';
      else if (imp >= 150) curr.quality = 'good';
    }
    return data;
  }, [mainLineIds, nodes]);

  const hasEval = graphData.some(d => d.eval != null);

  // ── ローディング / エラー ─────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-gray-400 text-sm">{t('share.loadingKifu')}</p>
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 border border-red-500/40 rounded-2xl p-8 max-w-md w-full text-center flex flex-col gap-4">
          <p className="text-red-400 font-bold text-lg">{t('share.loadFailed')}</p>
          <p className="text-gray-400 text-sm">{errorMsg}</p>
          <Link to="/" className="text-blue-400 hover:text-blue-300 text-sm">{t('share.backToHome')}</Link>
        </div>
      </div>
    );
  }

  const pageTitle = title ? `${title} | ${t('appName')}` : `${t('share.sharedKifu')} | ${t('appName')}`;
  const pageDesc  = `▲${gameInfo.sente} ${t('share.vs')} △${gameInfo.gote}`;
  const pageUrl   = `https://analytics.pkkis.com/share/${token}`;

  return (
    <div className="bg-gray-900 text-white flex flex-col overflow-hidden" style={{ height: '100svh' }}>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDesc} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDesc} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:type" content="article" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDesc} />
      </Helmet>

      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900/95 backdrop-blur shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/" className="text-gray-400 hover:text-white transition-colors shrink-0 text-sm">{t('share.back')}</Link>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm truncate">{title}</p>
            <p className="text-gray-500 text-xs">▲ {gameInfo.sente} {t('share.vs')} △ {gameInfo.gote}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <button
            onClick={() => {
              const blob = new Blob([rawContent], { type: 'text/plain;charset=utf-8' });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement('a');
              a.href     = url;
              a.download = `${title || t('share.sharedKifu')}.kif`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            title={t('share.saveKifFile')}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs transition-colors">
            <Download size={13} />
            <span className="hidden sm:inline">{t('share.save')}</span>
          </button>
          <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full border border-gray-700">{t('share.readOnly')}</span>
        </div>
      </div>

      {/* ══ モバイル ══ */}
      <main className="lg:hidden flex-1 overflow-hidden flex flex-col">

        {/* 盤面ブロック */}
        {board && hands && (
          <div className="flex-shrink-0 select-none" data-board-area>
            <PlayerInfo compact name={gameInfo.gote} mark="△" time={null} isActive={activePlayer === 2} player={2} inCheck={false} />
            <HandRowHorizontal hands={hands} player={2} activePlayer={activePlayer} dropSelected={null} onDropSelect={null} align="right" />
            <div className="flex justify-center">
              <div ref={mobileBoardRef}
                style={{ width: panelSizes.mobileBoardSizePx != null ? panelSizes.mobileBoardSizePx : '100%', maxWidth: '100%' }}>
                <div className="flex items-stretch">
                  <div className="flex-1 relative min-w-0">
                    <BoardCore board={board} hands={hands} selectedCell={null} highlightSet={new Set()}
                      lastMove={lastMove} candidateArrows={candidateArrows} activePlayer={activePlayer} onCellClick={null} flipped={false} />
                  </div>
                  {hasEval && <EvalBarVertical evalValue={evalScore ?? 0} />}
                </div>
              </div>
            </div>
            <HandRowHorizontal hands={hands} player={1} activePlayer={activePlayer} dropSelected={null} onDropSelect={null} align="left" />
            <PlayerInfo compact name={gameInfo.sente} mark="▲" time={null} isActive={activePlayer === 1} player={1} inCheck={false} />
          </div>
        )}

        {/* ドラッグハンドル（盤面 ↔ 解析） */}
        <DragHandle axis="y" onMouseDown={(e) => {
          const startW = mobileBoardRef.current?.getBoundingClientRect().width
            ?? panelSizes.mobileBoardSizePx
            ?? (window.visualViewport?.width ?? window.innerWidth);
          startDrag(e, startW, (v) => {
            const maxW = window.visualViewport?.width ?? window.innerWidth;
            setPanelSizes(s => ({ ...s, mobileBoardSizePx: Math.max(150, Math.min(maxW, v)) }));
          }, 'y');
        }} />

        {/* 解析ブロック */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">

          {/* 形勢グラフ */}
          {hasEval && (
            <>
              <div className="flex-shrink-0">
                <EvaluationGraph currentMove={currentIdx} graphData={graphData}
                  onNavigate={(idx) => { const id = graphData[idx]?.nodeId; if (id) navigateTo(id); }}
                  height={panelSizes.mobileGraphPx} compact />
              </div>
              {/* ドラッグハンドル（グラフ ↔ 候補手） */}
              <DragHandle axis="y" onMouseDown={(e) => startDrag(
                e, panelSizes.mobileGraphPx,
                (v) => setPanelSizes(s => ({ ...s, mobileGraphPx: Math.max(40, Math.min(300, v)) })),
                'y'
              )} />
            </>
          )}

          {/* 手数スライダー */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1">
            <span className="text-xs text-gray-400 tabular-nums w-12 text-right shrink-0">{currentIdx}手目</span>
            <input type="range" min={0} max={total} value={currentIdx}
              onChange={(e) => goTo(Number(e.target.value))}
              className="flex-1 h-2 rounded-full accent-blue-500 cursor-pointer" />
            <span className="text-xs text-gray-400 tabular-nums w-8 shrink-0">{total}手</span>
          </div>

          {/* ナビバー */}
          <div className="flex-shrink-0 grid grid-cols-5 gap-0.5 px-1 py-0.5 border-t border-gray-700/80 bg-gray-900/90">
            <button onClick={() => setShowMoveList(v => !v)}
              className={`flex items-center justify-center py-1.5 rounded-lg active:scale-95 transition-all
                ${showMoveList ? 'bg-blue-600 text-white' : 'bg-gray-700/80 hover:bg-gray-600 text-gray-200'}`}>
              <List size={18} />
            </button>
            <button onClick={() => goTo(0)} disabled={currentIdx === 0}
              className="flex items-center justify-center py-1.5 rounded-lg bg-gray-700/80 hover:bg-gray-600 active:scale-95 disabled:opacity-40 transition-all text-gray-200">
              <ChevronsLeft size={18} />
            </button>
            <button onClick={() => goTo(currentIdx - 1)} disabled={currentIdx === 0}
              className="flex items-center justify-center py-1.5 rounded-lg bg-gray-700/80 hover:bg-gray-600 active:scale-95 disabled:opacity-40 transition-all text-gray-200">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => goTo(currentIdx + 1)} disabled={currentIdx >= total}
              className="flex items-center justify-center py-1.5 rounded-lg bg-gray-700/80 hover:bg-gray-600 active:scale-95 disabled:opacity-40 transition-all text-gray-200">
              <ChevronRight size={18} />
            </button>
            <button onClick={() => goTo(total)} disabled={currentIdx >= total}
              className="flex items-center justify-center py-1.5 rounded-lg bg-gray-700/80 hover:bg-gray-600 active:scale-95 disabled:opacity-40 transition-all text-gray-200">
              <ChevronsRight size={18} />
            </button>
          </div>

          {/* 候補手 */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <CandidateMoves compact candidates={candidates} engineStatus="standby"
              maxDepth={0} multiPV={displayMultiPV} isSaved={savedCandidates.length > 0}
              onMultiPVChange={setDisplayMultiPV} onPVClick={setPvCandidate} />
          </div>
        </div>
      </main>

      {/* ══ デスクトップ ══ */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* 上段: 盤面 + 右パネル */}
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* 盤面カラム */}
            <div ref={boardColumnRef}
              className="flex flex-col gap-1.5 pt-2 pb-1 px-3 overflow-y-auto overscroll-y-contain flex-shrink-0"
              style={{ width: boardPx, minWidth: 200 }}>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <PlayerInfo name={gameInfo.gote} mark="△" time={null} isActive={activePlayer === 2} player={2} inCheck={false} />
                </div>
                <div className="flex-1 min-w-0">
                  <PlayerInfo name={gameInfo.sente} mark="▲" time={null} isActive={activePlayer === 1} player={1} inCheck={false} />
                </div>
              </div>

              {board && hands && (
                <div className="w-full flex justify-center overflow-hidden min-h-0">
                  <div className="flex gap-1 items-stretch select-none min-w-0" data-board-area
                    style={{ width: autoBoardPx > 0 ? `min(100%, ${autoBoardPx}px)` : '100%' }}>
                    <HandColumnVertical hands={hands} player={2} activePlayer={activePlayer}
                      dropSelected={null} onDropSelect={null} pieceAlign="top" />
                    <div className="flex-1 min-w-0 relative">
                      <BoardCore board={board} hands={hands} selectedCell={null} highlightSet={new Set()}
                        lastMove={lastMove} candidateArrows={candidateArrows} activePlayer={activePlayer}
                        onCellClick={null} flipped={false} sideLayout />
                    </div>
                    <HandColumnVertical hands={hands} player={1} activePlayer={activePlayer}
                      dropSelected={null} onDropSelect={null} pieceAlign="bottom" />
                  </div>
                </div>
              )}

              {/* デスクトップナビ */}
              <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                <button onClick={() => goTo(0)} disabled={currentIdx === 0}
                  className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-30 transition-colors text-gray-200">
                  <ChevronsLeft size={15} />
                </button>
                <button onClick={() => goTo(currentIdx - 1)} disabled={currentIdx === 0}
                  className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-30 transition-colors text-gray-200">
                  <ChevronLeft size={15} />
                </button>
                <input type="range" min={0} max={total} value={currentIdx}
                  onChange={(e) => goTo(Number(e.target.value))}
                  className="flex-1 min-w-0 h-2 rounded-full accent-blue-500 cursor-pointer" />
                <span className="text-xs text-gray-400 tabular-nums">{currentIdx}/{total}</span>
                <button onClick={() => goTo(currentIdx + 1)} disabled={currentIdx >= total}
                  className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-30 transition-colors text-gray-200">
                  <ChevronRight size={15} />
                </button>
                <button onClick={() => goTo(total)} disabled={currentIdx >= total}
                  className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-30 transition-colors text-gray-200">
                  <ChevronsRight size={15} />
                </button>
              </div>
            </div>

            {/* 水平ドラッグハンドル（盤面 | 右パネル） */}
            <DragHandle axis="x" onMouseDown={(e) => startDrag(
              e, boardPx,
              (v) => {
                boardPxOverrideRef.current = true;
                setPanelSizes(s => ({ ...s, boardPx: Math.max(200, v) }));
              },
              'x'
            )} />

            {/* 右パネル: 指し手(flex-1) + グラフ(固定高さ) */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              {/* 指し手リスト: 残りスペース全部 */}
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <MoveList nodes={nodes} moveListIds={mainLineIds} branchStart={-1}
                  currentId={currentId} onNavigate={navigateTo} termination={termination} />
              </div>

              {/* 垂直ドラッグハンドル（指し手 | グラフ）: 上ドラッグ = グラフ拡大 */}
              {hasEval && (
                <DragHandle axis="y" onMouseDown={(e) => startDrag(
                  e, panelSizes.desktopGraphPx,
                  (v) => setPanelSizes(s => ({ ...s, desktopGraphPx: Math.max(60, Math.min(600, v)) })),
                  'y', true
                )} />
              )}

              {/* 形勢グラフ: 固定高さ */}
              {hasEval && (
                <div className="flex-shrink-0 pb-2">
                  <EvaluationGraph currentMove={currentIdx} graphData={graphData}
                    onNavigate={(idx) => { const id = graphData[idx]?.nodeId; if (id) navigateTo(id); }}
                    height={panelSizes.desktopGraphPx} />
                </div>
              )}
            </div>
          </div>

          {/* 垂直ドラッグハンドル（上段 | 候補手） */}
          <DragHandle axis="y" onMouseDown={(e) => startDrag(
            e, panelSizes.candidatePx,
            (v) => setPanelSizes(s => ({ ...s, candidatePx: Math.max(0, v) })),
            'y', true
          )} />

          {/* 下段: 候補手・読み筋 */}
          <div className="flex-shrink-0 overflow-hidden" style={{ height: panelSizes.candidatePx }}>
            <CandidateMoves candidates={candidates} engineStatus="standby"
              maxDepth={0} multiPV={displayMultiPV} isSaved={savedCandidates.length > 0}
              onMultiPVChange={setDisplayMultiPV} onPVClick={setPvCandidate} fillHeight />
          </div>
        </div>
      </div>

      {/* モバイル指し手ボトムシート */}
      <MobileMoveListSheet open={showMoveList} onClose={() => setShowMoveList(false)}
        nodes={nodes} mainLineIds={mainLineIds} currentId={currentId}
        onNavigate={navigateTo} termination={termination} />

      {/* PV局面プレビュー */}
      {pvCandidate && pvStates && (
        <PVBoard candidate={pvCandidate} states={pvStates} onClose={() => setPvCandidate(null)} />
      )}
    </div>
  );
}
