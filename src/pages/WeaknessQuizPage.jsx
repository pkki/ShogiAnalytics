/**
 * WeaknessQuizPage.jsx
 * クラウド保存棋譜から中盤悪手局面を抜き出し、最善手を当てるクイズ。
 * /weakness-quiz
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ChevronLeft, RotateCcw, FlipVertical2, Zap, ChevronRight, Volume2, VolumeX } from 'lucide-react';
import {
  applyMove,
  getLegalMoveDestinations, getLegalDropDestinations,
  canPromote, isPromoted,
} from '../state/gameState.js';
import { BoardCore, HandRowHorizontal, HandColumnVertical } from '../components/ShogiBoard.jsx';
import TsumeNav from '../components/TsumeNav.jsx';
import AccountMenu from '../components/AccountMenu.jsx';
import { useAccountSettings } from '../hooks/useAccountSettings.jsx';
import { extractQuizPositions, parsePvJPMoves } from '../utils/quizUtils.js';

const CLOUD_API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';

function Spinner() {
  return (
    <svg className="animate-spin w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
}

function PromotionDialog({ onChoose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 border border-gray-600 rounded-2xl p-6 flex flex-col items-center gap-4 shadow-2xl">
        <p className="text-white font-bold text-base">成りますか？</p>
        <div className="flex gap-3">
          <button onClick={() => onChoose(true)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors text-sm">
            成る
          </button>
          <button onClick={() => onChoose(false)}
            className="px-6 py-3 bg-gray-600 hover:bg-gray-500 text-white font-bold rounded-xl transition-colors text-sm">
            成らない
          </button>
        </div>
      </div>
    </div>
  );
}

function cp(b) { return b.map(r => r.map(c => c ? { ...c } : null)); }
function ch(h) { return { 1: { ...h[1] }, 2: { ...h[2] } }; }

export default function WeaknessQuizPage() {
  const navigate = useNavigate();

  const authInfo = useMemo(() => {
    const tok = localStorage.getItem('shogi_jwt');
    if (!tok) return null;
    try {
      const p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { email: p.email, userId: p.userId, token: tok };
    } catch { return null; }
  }, []);
  const { dialog: settingsDialog, onShowSettings } = useAccountSettings(authInfo?.token ?? null);

  // quizState: idle | loading | ready | answered | error
  const [quizState,    setQuizState]    = useState('idle');
  const [errorMsg,     setErrorMsg]     = useState('');
  const [quiz,         setQuiz]         = useState(null);
  const [board,        setBoard]        = useState(null);
  const [hands,        setHands]        = useState(null);
  const [selected,     setSelected]     = useState(null);
  const [highlightSet, setHighlightSet] = useState(() => new Set());
  const [lastMove,     setLastMove]     = useState(null);
  const [showPromo,    setShowPromo]    = useState(null);
  const [result,       setResult]       = useState(null); // null|'best'|'second'|'wrong'
  const [flipped,      setFlipped]      = useState(false);
  const [savedBoard,   setSavedBoard]   = useState(null);
  const [savedHands,   setSavedHands]   = useState(null);
  const [gameCache,    setGameCache]    = useState(null);

  // PV再生・ナビゲーション
  const [pvBoards,          setPvBoards]          = useState([]);
  const [pvStep,            setPvStep]            = useState(0);
  const [pvAnim,            setPvAnim]            = useState(false);
  const [pvTab,             setPvTab]             = useState('best');
  const [showCorrectOverlay,setShowCorrectOverlay] = useState(false);

  // 音声設定（localStorage永続化）
  const [muted,     setMuted]     = useState(() => localStorage.getItem('quiz_muted') === 'true');
  const [voiceChar, setVoiceChar] = useState(() => localStorage.getItem('quiz_voice') || 'kiritan');
  const mutedRef     = useRef(muted);
  const voiceCharRef = useRef(voiceChar);
  useEffect(() => { mutedRef.current = muted;     }, [muted]);
  useEffect(() => { voiceCharRef.current = voiceChar; }, [voiceChar]);

  function playQuizAudio(event) {
    if (mutedRef.current) return;
    // event: 'correct' | 'wrong'
    // ファイル命名: kiritan_correct.wav, kiritan_failed.wav, zunda_correct.wav, zunda_failed.wav
    const voicePrefix = voiceCharRef.current === 'kiritan' ? 'kiritan' : 'zunda';
    const fileSuffix  = event === 'correct' ? 'correct' : 'failed';
    const audio = new Audio(`/audio/${voicePrefix}_${fileSuffix}.wav`);
    audio.play().catch(() => {});
  }

  function toggleMuted() {
    setMuted(m => { const next = !m; localStorage.setItem('quiz_muted', String(next)); return next; });
  }

  function setVoiceCharPersist(v) {
    setVoiceChar(v);
    localStorage.setItem('quiz_voice', v);
  }

  const authToken  = authInfo?.token;
  const attacker   = quiz?.player ?? 1;

  // flipped=false: 先手(1)下, 後手(2)上  /  flipped=true: 後手(2)下, 先手(1)上
  const bottomPlayer = flipped ? 2 : 1;
  const topPlayer    = flipped ? 1 : 2;
  const leftPCPlayer  = topPlayer;
  const rightPCPlayer = bottomPlayer;
  const topMobPlayer  = topPlayer;
  const botMobPlayer  = bottomPlayer;
  const bottomMark = bottomPlayer === 1 ? '▲' : '△';
  const bottomName = quiz ? (bottomPlayer === 1 ? quiz.senteName : quiz.goteName) : '';
  const topMark    = topPlayer    === 1 ? '▲' : '△';
  const topName    = quiz ? (topPlayer    === 1 ? quiz.senteName : quiz.goteName) : '';

  // PV中は pvBoards を表示
  const dispEntry     = pvBoards.length > 0 ? pvBoards[pvStep] : null;
  const displayBoard  = dispEntry ? dispEntry.board    : board;
  const displayHands  = dispEntry ? dispEntry.hands    : hands;
  const displayLM     = dispEntry ? dispEntry.lastMove : lastMove;

  // ── PV盤面配列を計算 ──────────────────────────────────────
  function computePvBoards(pvJP, boardInit, handsInit) {
    const moves = parsePvJPMoves(pvJP, 5);
    const first = { board: cp(boardInit), hands: ch(handsInit), lastMove: null, label: null };
    const entries = [first];
    let b = cp(first.board), h = ch(first.hands);
    for (const mv of moves) {
      try {
        const res = applyMove(b, h, { from: mv.from, to: mv.to, promote: mv.promote, piece: mv.piece }, mv.player);
        b = cp(res.board); h = ch(res.hands);
        entries.push({
          board: b, hands: h,
          lastMove: { from: mv.from ? `${mv.from[0]},${mv.from[1]}` : null, to: `${mv.to[0]},${mv.to[1]}` },
          label: mv.label,
        });
      } catch { break; }
    }
    return entries;
  }

  function resetPv() {
    setPvBoards([]); setPvStep(0); setPvAnim(false); setPvTab('best'); setShowCorrectOverlay(false);
  }

  // ── クイズ読み込み ───────────────────────────────────────────
  async function loadNewQuiz() {
    setQuizState('loading');
    setResult(null); setSelected(null); setHighlightSet(new Set());
    setLastMove(null); setShowPromo(null); setQuiz(null);
    resetPv();

    if (!authToken) { setQuizState('error'); setErrorMsg('ログインが必要です。'); return; }

    try {
      let games = gameCache;
      if (!games) {
        const res  = await fetch(`${CLOUD_API}/api/kif`, { headers: { Authorization: `Bearer ${authToken}` } });
        const data = await res.json();
        if (!data.ok || !data.kifs?.length) {
          setQuizState('error');
          setErrorMsg('保存された棋譜がありません。棋譜を「評価値を含めて保存」してから再試行してください。');
          return;
        }
        games = data.kifs; setGameCache(games);
      }

      const shuffled = [...games].sort(() => Math.random() - 0.5);
      let quizPositions = [];
      const debugLog = [];

      for (const game of shuffled.slice(0, 15)) {
        const res  = await fetch(`${CLOUD_API}/api/kif/${game.id}`, { headers: { Authorization: `Bearer ${authToken}` } });
        const data = await res.json();
        if (!data.ok) { debugLog.push(`${game.title}: fetch失敗`); continue; }
        const kifText  = data.kif.content;
        const hasCands = /\*\*\s*候補/.test(kifText);
        const moveCount = (kifText.match(/^\s*\d+\s/mg) || []).length;
        if (!hasCands)    { debugLog.push(`${game.title}: 評価値なし`); continue; }
        if (moveCount < 15) { debugLog.push(`${game.title}: 手数不足(${moveCount}手)`); continue; }
        try {
          quizPositions = extractQuizPositions(kifText);
          debugLog.push(`${game.title}: ${moveCount}手, 候補局面=${quizPositions.length}`);
        } catch (e) { debugLog.push(`${game.title}: 解析エラー(${e.message})`); continue; }
        if (quizPositions.length > 0) break;
      }
      console.log('[WeaknessQuiz] debug:', debugLog);

      if (quizPositions.length === 0) {
        setQuizState('error');
        setErrorMsg('クイズ問題が見つかりませんでした。\n\n詳細（ブラウザコンソール参照）:\n' + debugLog.join('\n'));
        return;
      }

      const pos = quizPositions.reduce((best, curr) => curr.cpl > best.cpl ? curr : best);
      const b   = cp(pos.boardBeforeMove);
      const h   = ch(pos.handsBeforeMove);
      setQuiz(pos); setBoard(b); setHands(h);
      setSavedBoard(cp(b)); setSavedHands(ch(h));
      setFlipped(pos.player === 2);
      setQuizState('ready');
    } catch (e) {
      setQuizState('error'); setErrorMsg(`クイズの読み込みに失敗しました: ${e.message}`);
    }
  }

  useEffect(() => { loadNewQuiz(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 不正解時: 予測アニメ完了後に不正解音→1秒表示→自動リスタート
  useEffect(() => {
    if (result !== 'wrong' || pvAnim) return;
    playQuizAudio('wrong');
    const t = setTimeout(retryQuiz, 1100);
    return () => clearTimeout(t);
  }, [result, pvAnim]); // eslint-disable-line react-hooks/exhaustive-deps

  // 正解時: pvAnim 完了後に正解音→「○正解」を1.5秒表示してから結果パネルへ
  useEffect(() => {
    if ((result !== 'best' && result !== 'second') || pvAnim) return;
    setShowCorrectOverlay(true);
    playQuizAudio('correct');
    const t = setTimeout(() => setShowCorrectOverlay(false), 1500);
    return () => clearTimeout(t);
  }, [result, pvAnim]); // eslint-disable-line react-hooks/exhaustive-deps

  // PVアニメーション: 700ms間隔で1手ずつ進める
  useEffect(() => {
    if (!pvAnim || pvBoards.length === 0) return;
    if (pvStep >= pvBoards.length - 1) { setPvAnim(false); return; }
    const t = setTimeout(() => setPvStep(s => s + 1), 700);
    return () => clearTimeout(t);
  }, [pvAnim, pvStep, pvBoards.length]);

  // ── やり直し ─────────────────────────────────────────────────
  function retryQuiz() {
    if (!savedBoard || !savedHands || !quiz) return;
    setBoard(cp(savedBoard)); setHands(ch(savedHands));
    setSelected(null); setHighlightSet(new Set());
    setLastMove(null); setResult(null); setShowPromo(null);
    resetPv();
    setQuizState('ready');
  }

  // ── PVタブ切替 ────────────────────────────────────────────────
  function switchPvTab(tab) {
    if (pvAnim || !quiz) return;
    const pvJP = tab === 'best' ? quiz.bestPvJP : quiz.secondBestPvJP;
    if (!pvJP) return;
    const boards = computePvBoards(pvJP, quiz.boardBeforeMove, quiz.handsBeforeMove);
    setPvBoards(boards); setPvTab(tab); setPvStep(0);
  }

  // ── 指し手マッチング ─────────────────────────────────────────
  function matchesCandidate(userMove, candidate) {
    if (!candidate?.to) return false;
    if (userMove.to[0] !== candidate.to[0] || userMove.to[1] !== candidate.to[1]) return false;
    const userIsDrop = !userMove.from;
    if (userIsDrop !== candidate.isDrop) return false;
    if (!userIsDrop && candidate.from) {
      if (userMove.from[0] !== candidate.from[0] || userMove.from[1] !== candidate.from[1]) return false;
    }
    return true;
  }

  // ── 指し手実行 ──────────────────────────────────────────────
  function executeMove(move) {
    setShowPromo(null); setSelected(null); setHighlightSet(new Set());

    const isBest   = matchesCandidate(move, quiz.bestMove);
    const isSecond = !isBest && matchesCandidate(move, quiz.secondBestMove);
    const r = isBest ? 'best' : isSecond ? 'second' : 'wrong';

    const { board: nb, hands: nh } = applyMove(board, hands, move, attacker);
    setBoard(nb); setHands(nh);
    setLastMove({ from: move.from ? `${move.from[0]},${move.from[1]}` : null, to: `${move.to[0]},${move.to[1]}` });
    setResult(r);
    setQuizState('answered');

    if (r === 'wrong') {
      // 悪手後の予測: afterBestPvJP を nb/nh 起点で再生
      const boards = computePvBoards(quiz.afterBestPvJP || '', nb, nh);
      setPvBoards(boards);
      setPvStep(0);
      if (boards.length > 1) setPvAnim(true);
    } else {
      const tab  = r === 'best' ? 'best' : 'second';
      const pvJP = r === 'best' ? quiz.bestPvJP : (quiz.secondBestPvJP || '');
      const boards = computePvBoards(pvJP, quiz.boardBeforeMove, quiz.handsBeforeMove);
      setPvBoards(boards);
      setPvTab(tab);
      const startStep = Math.min(1, boards.length - 1);
      setPvStep(startStep);
      if (boards.length > startStep + 1) setPvAnim(true);
    }
  }

  function handlePromotionChoice(promote) {
    if (!showPromo) return;
    executeMove({ ...showPromo, promote });
  }

  // ── 盤面クリック ─────────────────────────────────────────────
  function handleCellClick(r, c) {
    if (quizState !== 'ready') return;
    const piece   = board[r][c];
    const destKey = `${r},${c}`;
    if (selected) {
      if (highlightSet.has(destKey)) {
        let move;
        if (selected.type === 'board') {
          move = { from: [selected.row, selected.col], to: [r, c], promote: false };
        } else {
          move = { from: null, to: [r, c], piece: selected.piece };
        }
        if (move.from) {
          const mp = board[selected.row][selected.col];
          if (mp && canPromote(mp.type) && !isPromoted(mp.type)) {
            const must = (mp.type === 'P' || mp.type === 'L') && (attacker === 1 ? r === 0 : r === 8)
                      || (mp.type === 'N' && (attacker === 1 ? r <= 1 : r >= 7));
            const inZone = attacker === 1 ? (r <= 2 || selected.row <= 2) : (r >= 6 || selected.row >= 6);
            if (must)   { executeMove({ ...move, promote: true  }); return; }
            if (inZone) { setShowPromo(move); return; }
          }
        }
        executeMove(move); return;
      }
      if (selected.type === 'board' && selected.row === r && selected.col === c) {
        setSelected(null); setHighlightSet(new Set()); return;
      }
    }
    if (piece && piece.player === attacker) {
      setSelected({ type: 'board', row: r, col: c });
      setHighlightSet(new Set(getLegalMoveDestinations(board, hands, r, c).map(([dr,dc]) => `${dr},${dc}`)));
    } else {
      setSelected(null); setHighlightSet(new Set());
    }
  }

  function handleDropSelect({ player, type } = {}) {
    if (quizState !== 'ready') return;
    if (!type || player !== attacker) { setSelected(null); setHighlightSet(new Set()); return; }
    if (selected?.type === 'hand' && selected.piece === type) {
      setSelected(null); setHighlightSet(new Set()); return;
    }
    setSelected({ type: 'hand', player: attacker, piece: type });
    setHighlightSet(new Set(getLegalDropDestinations(board, hands, type, attacker).map(([dr,dc]) => `${dr},${dc}`)));
  }

  function getDropProps(player) {
    if (quizState !== 'ready' || player !== attacker) return { dropSelected: null, onDropSelect: null };
    return {
      dropSelected: selected?.type === 'hand' ? { player: selected.player, type: selected.piece } : null,
      onDropSelect: handleDropSelect,
    };
  }

  const selectedCell = quizState === 'ready' && selected?.type === 'board'
    ? { row: selected.row, col: selected.col } : null;

  // ── ローディング/エラー ──────────────────────────────────────
  if (quizState === 'loading' || quizState === 'idle') {
    return (
      <div className="min-h-screen bg-gray-900 text-white lg:ml-64 pb-16 lg:pb-0">
        <TsumeNav />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <Spinner />
            <p className="text-gray-400 text-sm">クイズを準備中…</p>
          </div>
        </div>
      </div>
    );
  }

  if (quizState === 'error') {
    return (
      <div className="min-h-screen bg-gray-900 text-white lg:ml-64 pb-16 lg:pb-0">
        <TsumeNav />
        <div className="flex items-center justify-center min-h-[60vh] p-4">
          <div className="bg-gray-800 border border-red-500/40 rounded-2xl p-8 max-w-md w-full text-center flex flex-col gap-4">
            <Zap size={32} className="text-red-400 mx-auto" />
            <p className="text-white font-bold">クイズを読み込めませんでした</p>
            <p className="text-gray-400 text-sm whitespace-pre-wrap text-left">{errorMsg}</p>
            <button onClick={loadNewQuiz}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-colors">
              再試行
            </button>
            <button onClick={() => navigate(-1)} className="text-blue-400 text-sm">← 戻る</button>
          </div>
        </div>
      </div>
    );
  }

  const isAnswered = quizState === 'answered';
  const isCorrect  = result === 'best' || result === 'second';

  // ── メイン UI ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 text-white lg:ml-64 pb-16 lg:pb-0">
      <TsumeNav />
      {settingsDialog}
      <Helmet><title>中盤弱点クイズ | 将棋アナリティクス</title></Helmet>

      {/* ヘッダー */}
      <div className="sticky top-0 z-20 bg-gray-900/95 backdrop-blur border-b border-gray-700">
        <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 py-2.5 lg:ml-0">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition-colors p-1 shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm">中盤弱点クイズ</p>
            {quiz && <p className="text-xs text-gray-500">第{quiz.moveNumber}手　{quiz.senteName} vs {quiz.goteName}</p>}
          </div>
          {authInfo ? (
            <AccountMenu email={authInfo.email} userId={authInfo.userId}
              onLogout={() => { localStorage.removeItem('shogi_jwt'); navigate('/login'); }}
              onShowSettings={onShowSettings} />
          ) : (
            <Link to="/login"
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-colors">
              ログイン
            </Link>
          )}
        </div>
      </div>

      {/* コンテンツ */}
      {board && hands && (
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col lg:flex-row gap-4 items-start">

          {/* ── 盤面エリア ── */}
          <div className="w-full max-w-sm mx-auto lg:mx-0 lg:max-w-none lg:flex-1 select-none relative">
            {/* 奥プレイヤー名 */}
            <div className="flex justify-end mb-0.5">
              <span className={`text-[11px] font-medium ${topPlayer === attacker ? 'text-gray-200 font-bold' : 'text-gray-500'}`}>
                {topMark}{topName}
              </span>
            </div>
            {/* モバイル上駒台 */}
            <div className="lg:hidden mb-1">
              <HandRowHorizontal
                hands={displayHands} player={topMobPlayer} activePlayer={attacker}
                align="right" flipped={flipped} {...getDropProps(topMobPlayer)} />
            </div>
            <div className="flex items-stretch gap-1">
              {/* PC左駒台 */}
              <div className="hidden lg:flex self-stretch">
                <HandColumnVertical
                  hands={displayHands} player={leftPCPlayer} activePlayer={attacker}
                  pieceAlign="top" flipped={flipped} {...getDropProps(leftPCPlayer)} />
              </div>
              {/* 盤面 */}
              <div className="flex-1">
                <BoardCore
                  board={displayBoard}
                  selectedCell={selectedCell}
                  highlightSet={quizState === 'ready' ? highlightSet : new Set()}
                  lastMove={displayLM}
                  onCellClick={quizState === 'ready' ? handleCellClick : undefined}
                  activePlayer={attacker}
                  flipped={flipped}
                />
              </div>
              {/* PC右駒台 */}
              <div className="hidden lg:flex self-stretch">
                <HandColumnVertical
                  hands={displayHands} player={rightPCPlayer} activePlayer={attacker}
                  pieceAlign="bottom" flipped={flipped} {...getDropProps(rightPCPlayer)} />
              </div>
            </div>
            {/* モバイル下駒台 */}
            <div className="lg:hidden mt-1">
              <HandRowHorizontal
                hands={displayHands} player={botMobPlayer} activePlayer={attacker}
                align="left" flipped={flipped} {...getDropProps(botMobPlayer)} />
            </div>
            {/* 手前プレイヤー名 */}
            <div className="flex justify-start mt-0.5">
              <span className={`text-[11px] font-medium ${bottomPlayer === attacker ? 'text-gray-200 font-bold' : 'text-gray-500'}`}>
                {bottomMark}{bottomName}
              </span>
            </div>

            {/* 不正解オーバーレイ */}
            {result === 'wrong' && quizState === 'answered' && !pvAnim && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl z-10 pointer-events-none">
                <p className="text-6xl font-black text-red-400 tracking-wide"
                   style={{ textShadow: '0 0 30px rgba(239,68,68,0.9), 0 2px 8px rgba(0,0,0,0.8)' }}>
                  不正解
                </p>
              </div>
            )}

            {/* 正解オーバーレイ */}
            {showCorrectOverlay && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl z-10 pointer-events-none">
                <p className="text-6xl font-black text-green-400 tracking-wide"
                   style={{ textShadow: '0 0 30px rgba(74,222,128,0.9), 0 2px 8px rgba(0,0,0,0.8)' }}>
                  ○正解
                </p>
              </div>
            )}
          </div>

          {/* ── 情報パネル ── */}
          <div className="w-full lg:w-72 flex flex-col gap-3">

            {/* 問題情報 */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] bg-yellow-900/60 text-yellow-300 border border-yellow-700/50 px-2 py-0.5 rounded-full font-medium">
                  中盤
                </span>
                <span className="text-xs text-gray-400">第{quiz?.moveNumber}手</span>
              </div>
              <p className="text-sm font-bold text-white">
                {quiz?.player === 1 ? `▲${quiz.senteName}` : `△${quiz.goteName}`}の最善手は？
              </p>
              {quizState === 'ready' && (
                <p className="text-xs text-gray-400 leading-relaxed">
                  この局面で最善手または次善手を指してください。
                </p>
              )}
            </div>

            {/* 操作ボタン */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFlipped(f => !f)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors
                  ${flipped ? 'bg-purple-600/30 text-purple-300' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
              >
                <FlipVertical2 size={13} /> 反転
              </button>
              {/* ミュートボタン */}
              <button
                onClick={toggleMuted}
                title={muted ? '音声オン' : '音声オフ'}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors
                  ${muted ? 'bg-gray-700/50 text-gray-500' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
              >
                {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                {muted ? 'OFF' : 'ON'}
              </button>
              {/* 音声キャラクター切替 */}
              {!muted && (
                <button
                  onClick={() => setVoiceCharPersist(voiceChar === 'kiritan' ? 'zundamon' : 'kiritan')}
                  title="音声キャラクターを切替"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition-colors"
                >
                  {voiceChar === 'kiritan' ? '🎤きりたん' : '🟢ずんだ'}
                </button>
              )}
              {isAnswered && isCorrect && !pvAnim && !showCorrectOverlay && (
                <button onClick={retryQuiz}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs transition-colors">
                  <RotateCcw size={13} /> やり直し
                </button>
              )}
            </div>

            {/* PV再生中インジケーター（正解時のみ） */}
            {isAnswered && isCorrect && pvAnim && (
              <div className="rounded-xl p-3 bg-gray-800 border border-gray-700 flex items-center gap-2">
                <span className="animate-pulse text-blue-400 text-xs">▶ 読み筋を再生中…</span>
                <span className="text-[10px] text-gray-500 ml-auto">{pvStep}/{pvBoards.length - 1}手</span>
              </div>
            )}

            {/* PVナビゲーション（正解後・オーバーレイ消えた後） */}
            {isAnswered && isCorrect && !pvAnim && !showCorrectOverlay && pvBoards.length > 0 && (
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 flex flex-col gap-2">
                {/* タブ: 最善手/次善手切替 */}
                <div className="flex gap-1">
                  <button onClick={() => switchPvTab('best')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors
                      ${pvTab === 'best' ? 'bg-yellow-600/30 text-yellow-300 border border-yellow-700/40' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                    最善手
                  </button>
                  {quiz.secondBestPvJP && (
                    <button onClick={() => switchPvTab('second')}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors
                        ${pvTab === 'second' ? 'bg-blue-600/30 text-blue-300 border border-blue-700/40' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                      次善手
                    </button>
                  )}
                </div>

                {/* 現在の手 */}
                <div className="text-center py-1">
                  <p className="text-sm font-mono font-bold text-white">
                    {pvBoards[pvStep]?.label ?? '（初期局面）'}
                  </p>
                  <p className="text-[10px] text-gray-500">{pvStep} / {pvBoards.length - 1} 手</p>
                </div>

                {/* ← → */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setPvStep(s => Math.max(0, s - 1))}
                    disabled={pvStep === 0}
                    className="flex-1 flex items-center justify-center py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-sm transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPvStep(s => Math.min(pvBoards.length - 1, s + 1))}
                    disabled={pvStep >= pvBoards.length - 1}
                    className="flex-1 flex items-center justify-center py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-sm transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* 結果パネル（正解後・オーバーレイ消えた後） */}
            {isAnswered && isCorrect && !pvAnim && !showCorrectOverlay && (
              <div className={`rounded-xl p-4 flex flex-col gap-3 border
                ${result === 'best'   ? 'bg-green-900/40 border-green-600/40' :
                  result === 'second' ? 'bg-blue-900/40  border-blue-600/40'  :
                                        'bg-red-900/40   border-red-600/40'}`}>
                <p className={`font-bold text-base
                  ${result === 'best'   ? 'text-green-300' :
                    result === 'second' ? 'text-blue-300'  : 'text-red-300'}`}>
                  {result === 'best'   ? '🎉 正解！最善手です！' :
                   result === 'second' ? '✅ 正解！次善手です！' : '❌ 不正解…'}
                </p>

                {/* 実際の手 + 損失 */}
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-gray-500">実際の手:</span>
                    <span className="font-bold font-mono text-red-300">
                      {quiz.player === 1 ? '▲' : '△'}{quiz.actualMoveLabel}
                    </span>
                    <span className="text-gray-600">→</span>
                    <span className="text-gray-300">
                      評価値 <span className="font-bold">{quiz.actualScore >= 0 ? '+' : ''}{quiz.actualScore}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">損失:</span>
                    <span className="font-bold text-red-400">{quiz.cpl}点</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium
                      ${quiz.cpl >= 500 ? 'bg-red-900/60 text-red-300' :
                        quiz.cpl >= 300 ? 'bg-orange-900/60 text-orange-300' :
                                          'bg-yellow-900/60 text-yellow-300'}`}>
                      {quiz.cpl >= 500 ? '大悪手' : quiz.cpl >= 300 ? '悪手' : '疑問手'}
                    </span>
                  </div>
                </div>

                {/* 最善手・次善手の評価値 */}
                <div className="bg-gray-900/60 rounded-lg px-3 py-2 flex flex-col gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 w-10 shrink-0">最善手</span>
                    <span className="font-bold text-yellow-300 font-mono">
                      {quiz.bestPvJP.trim().split(/\s+/)[0]?.replace(/\(\d+\)$/, '')}
                    </span>
                    <span className="text-gray-600 ml-auto">→</span>
                    <span className={`font-bold tabular-nums ${quiz.bestScore >= 0 ? 'text-blue-300' : 'text-orange-300'}`}>
                      {quiz.bestScore >= 0 ? '+' : ''}{quiz.bestScore}
                    </span>
                  </div>
                  {quiz.secondBestPvJP && quiz.secondScore != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 w-10 shrink-0">次善手</span>
                      <span className="font-mono text-gray-300">
                        {quiz.secondBestPvJP.trim().split(/\s+/)[0]?.replace(/\(\d+\)$/, '')}
                      </span>
                      <span className="text-gray-600 ml-auto">→</span>
                      <span className={`font-bold tabular-nums ${quiz.secondScore >= 0 ? 'text-blue-300' : 'text-orange-300'}`}>
                        {quiz.secondScore >= 0 ? '+' : ''}{quiz.secondScore}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 次の問題ボタン */}
            {isAnswered && isCorrect && !pvAnim && !showCorrectOverlay && (
              <button onClick={loadNewQuiz}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors text-sm">
                次の問題 →
              </button>
            )}

            {/* ヒント */}
            {quizState === 'ready' && (
              <div className="text-xs text-gray-600 text-center mt-1">
                駒を選択して移動先をクリック、または持ち駒を選択して打つ場所をクリック
              </div>
            )}
          </div>
        </div>
      )}

      {showPromo && <PromotionDialog onChoose={handlePromotionChoice} />}
    </div>
  );
}
