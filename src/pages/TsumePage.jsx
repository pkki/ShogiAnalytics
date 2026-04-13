import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  RotateCcw, Lightbulb, ChevronLeft, Trophy, Heart, Bookmark,
  FlipVertical2, SkipBack, SkipForward, ChevronRight,
  Trash2, Play, Square,
} from 'lucide-react';
import {
  applyMove,
  getLegalMoveDestinations, getLegalDropDestinations,
  canPromote, isPromoted,
} from '../state/gameState.js';
import { BoardCore, HandRowHorizontal, HandColumnVertical } from '../components/ShogiBoard.jsx';
import TsumeNav from '../components/TsumeNav.jsx';

const CLOUD_API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';

// ── ヘルパー ───────────────────────────────────────────────────
function movesMatch(a, b) {
  if (!a || !b) return false;
  const fromA = a.from ? a.from[0] * 9 + a.from[1] : -1;
  const fromB = b.from ? b.from[0] * 9 + b.from[1] : -1;
  return fromA === fromB
    && a.to[0] * 9 + a.to[1] === b.to[0] * 9 + b.to[1]
    && Boolean(a.promote) === Boolean(b.promote)
    && (a.piece || '') === (b.piece || '');
}
function moveToLastMove(move) {
  if (!move) return null;
  return {
    from: move.from ? `${move.from[0]},${move.from[1]}` : null,
    to:   `${move.to[0]},${move.to[1]}`,
  };
}

// 解答ツリーの深さ (= 手数) を計算
function depthOf(solution) {
  if (!solution || solution.length === 0) return 0;
  let max = 0;
  for (const node of solution) {
    let d = 1;
    if (node.defenses?.length > 0) {
      let maxDef = 0;
      for (const def of node.defenses) {
        maxDef = Math.max(maxDef, 1 + depthOf(def.reply));
      }
      d += maxDef;
    }
    max = Math.max(max, d);
  }
  return max;
}

// 解答の主要手順を線形に展開（守り方は最長応手を選択）
function extractMainLine(solution, attacker, defender) {
  const moves = [];
  let current = solution;
  while (current && current.length > 0) {
    const node = current[0];
    moves.push({ move: node.move, playerNum: attacker });
    if (!node.defenses || node.defenses.length === 0) break;
    // 守り方は最も長く抵抗できる手を選ぶ
    let bestDef   = node.defenses[0];
    let bestDepth = depthOf(bestDef.reply);
    for (let i = 1; i < node.defenses.length; i++) {
      const d = depthOf(node.defenses[i].reply);
      if (d > bestDepth) { bestDepth = d; bestDef = node.defenses[i]; }
    }
    moves.push({ move: bestDef.defMove, playerNum: defender });
    current = bestDef.reply;
  }
  return moves;
}

// 各手順後の盤面状態を事前計算
function computeAnswerStates(initBoard, initHands, moves) {
  const states = [{ board: initBoard, hands: initHands, lastMove: null }];
  let board = initBoard;
  let hands = initHands;
  for (const { move, playerNum } of moves) {
    try {
      const { board: nb, hands: nh } = applyMove(board, hands, move, playerNum);
      board = nb; hands = nh;
      states.push({ board: nb, hands: nh, lastMove: moveToLastMove(move) });
    } catch { break; }
  }
  return states;
}

// ── ミニ盤面プレビュー ─────────────────────────────────────────
const PIECE_CHAR = { P:'歩',L:'香',N:'桂',S:'銀',G:'金',B:'角',R:'飛',K:'玉',
  '+P':'と','+L':'杏','+N':'圭','+S':'全','+B':'馬','+R':'竜' };

function MiniBoardPreview({ board }) {
  if (!board) return (
    <div className="w-full aspect-square bg-amber-100/10 rounded flex items-center justify-center">
      <span className="text-gray-600 text-xs">なし</span>
    </div>
  );
  const cells = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      cells.push(
        <div key={`${r}-${c}`}
          className="border border-amber-900/30 flex items-center justify-center overflow-hidden"
          style={{ background: '#e8c96a', minWidth: 0, minHeight: 0 }}>
          {piece && (
            <span style={{
              fontSize: '8cqw', fontWeight: 900,
              color: piece.type.startsWith('+') ? '#c00' : '#000',
              transform: piece.player === 2 ? 'rotate(180deg)' : 'none',
              lineHeight: 1,
              display: 'block',
            }}>
              {PIECE_CHAR[piece.type] || piece.type}
            </span>
          )}
        </div>
      );
    }
  }
  return (
    <div style={{ containerType: 'inline-size', width: '100%' }}>
      <div className="w-full rounded overflow-hidden border border-amber-900/30"
        style={{ aspectRatio: '1/1', display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gridTemplateRows: 'repeat(9,1fr)' }}>
        {cells}
      </div>
    </div>
  );
}

// ── 最近の詰将棋カード ─────────────────────────────────────────
function RecentCard({ item }) {
  const board = (() => {
    try { return item.board_json ? JSON.parse(item.board_json) : null; } catch { return null; }
  })();
  return (
    <Link
      to={`/tsume/${item.token}`}
      className="block bg-gray-800 border border-gray-700 hover:border-gray-500
                 rounded-xl overflow-hidden transition-all group"
    >
      <div className="p-2 bg-amber-950/20">
        <MiniBoardPreview board={board} />
      </div>
      <div className="px-2 pb-2 pt-1">
        <p className="text-xs text-white group-hover:text-blue-300 transition-colors leading-snug line-clamp-2">
          {item.title}
        </p>
        {item.author_name && (
          <p className="text-[10px] text-gray-500 mt-0.5 truncate">{item.author_name} 作</p>
        )}
        <div className="flex items-center justify-between mt-1">
          {item.num_moves > 0 && (
            <span className="text-[10px] bg-gray-700 text-gray-400 rounded-full px-1.5 py-0.5">
              {item.num_moves}手
            </span>
          )}
          <span className="text-[10px] text-red-400 flex items-center gap-0.5 ml-auto">
            <Heart size={9} /> {item.likes}
          </span>
        </div>
      </div>
    </Link>
  );
}

// ── カテゴリサイドバー (PC用) ──────────────────────────────────
const CATEGORIES = [
  { label: '1〜5手', moves: '1-5' },
  { label: '7〜11手', moves: '7-11' },
  { label: '13手〜', moves: '13+' },
];

function CategorySidebar() {
  return (
    <aside className="w-full flex flex-col gap-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">詰将棋一覧</p>
      {CATEGORIES.map(cat => (
        <Link
          key={cat.moves}
          to={`/tsume/category/${cat.moves}`}
          className="flex items-center justify-between px-4 py-3 bg-gray-800
                     hover:bg-gray-700 border border-gray-700 hover:border-gray-500
                     rounded-xl transition-colors group"
        >
          <span className="text-sm font-bold text-gray-200 group-hover:text-blue-300">
            {cat.label}詰め
          </span>
          <ChevronRight size={16} className="text-gray-500 group-hover:text-blue-400 shrink-0" />
        </Link>
      ))}
      <Link
        to="/tsume/category/all"
        className="flex items-center justify-between px-4 py-3 bg-gray-800/50
                   hover:bg-gray-700 border border-gray-700/60 hover:border-gray-500
                   rounded-xl transition-colors group"
      >
        <span className="text-sm text-gray-400 group-hover:text-blue-300">すべて見る</span>
        <ChevronRight size={16} className="text-gray-500 group-hover:text-blue-400 shrink-0" />
      </Link>
    </aside>
  );
}

// ── モバイル用カテゴリリンク ───────────────────────────────────
function MobileCategoryLinks() {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      <div className="px-3 py-2.5 border-b border-gray-700">
        <span className="text-sm font-bold text-white">詰将棋カテゴリ</span>
      </div>
      <div className="flex flex-col divide-y divide-gray-700/60">
        {CATEGORIES.map(cat => (
          <Link
            key={cat.moves}
            to={`/tsume/category/${cat.moves}`}
            className="flex items-center justify-between px-4 py-3
                       hover:bg-gray-700/60 transition-colors group"
          >
            <span className="text-sm text-gray-300 group-hover:text-blue-300 font-medium">
              {cat.label}詰め
            </span>
            <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-400" />
          </Link>
        ))}
        <Link
          to="/tsume/category/all"
          className="flex items-center justify-between px-4 py-3
                     hover:bg-gray-700/60 transition-colors group"
        >
          <span className="text-sm text-gray-300 group-hover:text-blue-300 font-medium">すべての詰将棋</span>
          <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-400" />
        </Link>
      </div>
    </div>
  );
}

// ── メインコンポーネント ───────────────────────────────────────
export default function TsumePage() {
  const { token } = useParams();
  const navigate  = useNavigate();

  // ── ロード状態 ─────────────────────────────────────────────
  const [loadStatus,  setLoadStatus]  = useState('loading');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [puzzleTitle, setPuzzleTitle] = useState('');
  const puzzleRef = useRef(null);

  // ── 作者・いいね・ブックマーク ──────────────────────────────
  const [author,       setAuthor]       = useState(null);
  const [description,  setDescription]  = useState('');
  const [likes,        setLikes]        = useState(0);
  const [bookmarks,    setBookmarks]    = useState(0);
  const [myLike,       setMyLike]       = useState(false);
  const [myBookmark,   setMyBookmark]   = useState(false);
  const [likeBusy,     setLikeBusy]     = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);

  // 最近の詰将棋
  const [recents, setRecents] = useState([]);

  // ログイン中ユーザー
  const myToken  = localStorage.getItem('shogi_jwt');
  const myUserId = (() => {
    try { return myToken ? JSON.parse(atob(myToken.split('.')[1])).userId : null; } catch { return null; }
  })();

  // ── ゲーム状態 ─────────────────────────────────────────────
  const [board,            setBoard]            = useState(null);
  const [hands,            setHands]            = useState(null);
  const [currentPlayer,    setCurrentPlayer]    = useState(1);
  const [currentSolutions, setCurrentSolutions] = useState(null);
  const [moveCount,        setMoveCount]        = useState(0);

  // ── UI 状態 ────────────────────────────────────────────────
  const [selected,     setSelected]     = useState(null);
  const [highlightSet, setHighlightSet] = useState(() => new Set());
  const [lastMove,     setLastMove]     = useState(null);
  const [status,       setStatus]       = useState('solving');
  const [message,      setMessage]      = useState('');
  const [showPromo,    setShowPromo]    = useState(null);
  const [flipped,      setFlipped]      = useState(false);

  // ── 解答表示 ──────────────────────────────────────────────
  const [showAnswer,   setShowAnswer]   = useState(false);
  const [answerStep,   setAnswerStep]   = useState(0);
  const [answerStates, setAnswerStates] = useState(null);
  const [autoPlay,     setAutoPlay]     = useState(false);
  const autoPlayRef = useRef(null);

  // ── データ読み込み ──────────────────────────────────────────
  useEffect(() => {
    setLoadStatus('loading');
    setBoard(null); setHands(null); setStatus('solving');
    setMoveCount(0); setSelected(null); setHighlightSet(new Set());
    setLastMove(null); setMessage(''); setShowPromo(null);
    setShowAnswer(false); setAnswerStep(0); setAnswerStates(null);
    setAutoPlay(false);
    puzzleRef.current = null;

    const headers = myToken ? { Authorization: `Bearer ${myToken}` } : {};
    fetch(`${CLOUD_API}/api/tsume/${token}`, { headers })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) throw new Error(data.error || '読み込みエラー');
        puzzleRef.current = data.puzzle;
        setPuzzleTitle(data.title || `${data.puzzle.numMoves}手詰め`);
        setBoard(data.puzzle.board);
        setHands(data.puzzle.hands);
        setCurrentPlayer(data.puzzle.attacker);
        setCurrentSolutions(data.puzzle.solution);
        setAuthor(data.author || null);
        setDescription(data.description || '');
        setLikes(data.likes ?? 0);
        setBookmarks(data.bookmarks ?? 0);
        setMyLike(!!data.myLike);
        setMyBookmark(!!data.myBookmark);
        setLoadStatus('ok');
      })
      .catch(e => { setErrorMsg(e.message); setLoadStatus('error'); });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // 最近の詰将棋
  useEffect(() => {
    fetch(`${CLOUD_API}/api/tsume/list?sort=recent&limit=12`)
      .then(r => r.json())
      .then(d => { if (d.ok) setRecents(d.items.filter(i => i.token !== token)); })
      .catch(() => {});
  }, [token]);

  // 自動再生
  useEffect(() => {
    if (!autoPlay || !answerStates) return;
    autoPlayRef.current = setInterval(() => {
      setAnswerStep(s => {
        if (s >= answerStates.length - 1) { setAutoPlay(false); return s; }
        return s + 1;
      });
    }, 900);
    return () => clearInterval(autoPlayRef.current);
  }, [autoPlay, answerStates]);

  const puzzle   = puzzleRef.current;
  const attacker = puzzle?.attacker ?? 1;
  const defender = attacker === 1 ? 2 : 1;
  const numMoves = puzzle?.numMoves ?? 0;
  const isMyPuzzle = myUserId && author?.userId === myUserId;

  // ── いいね ─────────────────────────────────────────────────
  async function handleLike() {
    if (!myToken || likeBusy) return;
    setLikeBusy(true);
    try {
      const res  = await fetch(`${CLOUD_API}/api/tsume/${token}/like`, {
        method: 'POST', headers: { Authorization: `Bearer ${myToken}` },
      });
      const data = await res.json();
      if (data.ok) { setMyLike(data.liked); setLikes(data.count); }
    } catch {} finally { setLikeBusy(false); }
  }

  // ── ブックマーク ────────────────────────────────────────────
  async function handleBookmark() {
    if (!myToken || bookmarkBusy) return;
    setBookmarkBusy(true);
    try {
      const res  = await fetch(`${CLOUD_API}/api/tsume/${token}/bookmark`, {
        method: 'POST', headers: { Authorization: `Bearer ${myToken}` },
      });
      const data = await res.json();
      if (data.ok) { setMyBookmark(data.bookmarked); setBookmarks(data.count); }
    } catch {} finally { setBookmarkBusy(false); }
  }

  // ── 削除 ───────────────────────────────────────────────────
  async function handleDelete() {
    if (!window.confirm('この詰将棋を削除しますか？この操作は取り消せません。')) return;
    try {
      const res = await fetch(`${CLOUD_API}/api/tsume/${token}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${myToken}` },
      });
      const data = await res.json();
      if (data.ok) navigate(-1);
      else alert('削除失敗: ' + data.error);
    } catch (e) {
      alert('削除失敗: ' + e.message);
    }
  }

  // ── リセット ───────────────────────────────────────────────
  function resetPuzzle() {
    if (!puzzle) return;
    setBoard(puzzle.board);
    setHands(puzzle.hands);
    setCurrentPlayer(puzzle.attacker);
    setCurrentSolutions(puzzle.solution);
    setMoveCount(0);
    setSelected(null);
    setHighlightSet(new Set());
    setLastMove(null);
    setStatus('solving');
    setMessage('');
    setShowPromo(null);
    setShowAnswer(false);
    setAnswerStep(0);
    setAutoPlay(false);
  }

  // ── 解答表示 ──────────────────────────────────────────────
  function openAnswer() {
    if (!puzzle) return;
    const mainLine = extractMainLine(puzzle.solution, attacker, defender);
    const states   = computeAnswerStates(puzzle.board, puzzle.hands, mainLine);
    setAnswerStates(states);
    setAnswerStep(0);
    setShowAnswer(true);
    setAutoPlay(false);
  }

  function closeAnswer() {
    setShowAnswer(false);
    setAutoPlay(false);
    clearInterval(autoPlayRef.current);
  }

  // ── 指し手確定 ─────────────────────────────────────────────
  function executeAttackerMove(move) {
    setShowPromo(null);
    setSelected(null);
    setHighlightSet(new Set());

    const matched = currentSolutions?.find(s =>
      movesMatch(s.move, move) ||
      movesMatch(s.move, { ...move, promote: !move.promote })
    );
    if (!matched) {
      setMessage('❌ その手は最善手ではありません(詰む可能性はあり)。もう一度考えてみよう！');
      return;
    }
    const effectiveMove = matched.move;
    const { board: nb, hands: nh } = applyMove(board, hands, effectiveMove, attacker);
    setBoard(nb); setHands(nh);
    setLastMove(moveToLastMove(effectiveMove));
    setMoveCount(c => c + 1);
    setMessage('');
    if (matched.defenses.length === 0) { setStatus('solved'); setCurrentSolutions([]); return; }
    setCurrentPlayer(defender);
    setTimeout(() => {
      // 守り方は最長抵抗手を選択
      let defResponse = matched.defenses[0];
      let maxDepth    = depthOf(defResponse.reply);
      for (let i = 1; i < matched.defenses.length; i++) {
        const d = depthOf(matched.defenses[i].reply);
        if (d > maxDepth) { maxDepth = d; defResponse = matched.defenses[i]; }
      }
      const { board: nb2, hands: nh2 } = applyMove(nb, nh, defResponse.defMove, defender);
      setBoard(nb2); setHands(nh2);
      setLastMove(moveToLastMove(defResponse.defMove));
      setMoveCount(c => c + 1);
      if (!defResponse.reply || defResponse.reply.length === 0) {
        setStatus('solved'); setCurrentSolutions([]);
      } else {
        setCurrentSolutions(defResponse.reply);
        setCurrentPlayer(attacker);
      }
    }, 600);
  }

  function handlePromotionChoice(promote) {
    if (!showPromo) return;
    executeAttackerMove({ ...showPromo, promote });
  }

  // ── 盤面クリック ───────────────────────────────────────────
  function handleCellClick(r, c) {
    if (showAnswer || status !== 'solving' || currentPlayer !== attacker) return;
    const piece   = board[r][c];
    const destKey = `${r},${c}`;
    if (selected) {
      if (highlightSet.has(destKey)) {
        let move;
        if (selected.type === 'board') {
          move = { from: [selected.row, selected.col], to: [r, c], promote: false };
        } else {
          move = { from: null, to: [r, c], promote: false, piece: selected.piece };
        }
        if (move.from) {
          const mp = board[selected.row][selected.col];
          if (mp && canPromote(mp.type) && !isPromoted(mp.type)) {
            const must = (mp.type === 'P' || mp.type === 'L') && (attacker === 1 ? r === 0 : r === 8)
                      || mp.type === 'N' && (attacker === 1 ? r <= 1 : r >= 7);
            const inZone = attacker === 1 ? (r <= 2 || selected.row <= 2) : (r >= 6 || selected.row >= 6);
            if (must) { executeAttackerMove({ ...move, promote: true }); return; }
            if (inZone) { setShowPromo(move); return; }
          }
        }
        executeAttackerMove(move);
        return;
      }
      if (selected.type === 'board' && selected.row === r && selected.col === c) {
        setSelected(null); setHighlightSet(new Set()); return;
      }
    }
    if (piece && piece.player === attacker) {
      const dests = getLegalMoveDestinations(board, hands, r, c);
      setSelected({ type: 'board', row: r, col: c });
      setHighlightSet(new Set(dests.map(([dr, dc]) => `${dr},${dc}`)));
      setMessage('');
    } else {
      setSelected(null); setHighlightSet(new Set());
    }
  }

  // ── 持ち駒クリック ──────────────────────────────────────────
  function handleDropSelect({ player, type } = {}) {
    if (showAnswer || status !== 'solving' || currentPlayer !== attacker) return;
    if (!type || player !== attacker) { setSelected(null); setHighlightSet(new Set()); return; }
    if (selected?.type === 'hand' && selected.piece === type) {
      setSelected(null); setHighlightSet(new Set()); return;
    }
    const dests = getLegalDropDestinations(board, hands, type, attacker);
    setSelected({ type: 'hand', player: attacker, piece: type });
    setHighlightSet(new Set(dests.map(([dr, dc]) => `${dr},${dc}`)));
    setMessage('');
  }

  // ── ヒント ──────────────────────────────────────────────────
  function handleHint() {
    if (!currentSolutions?.length) return;
    const hint = currentSolutions[0].move;
    if (hint.from) {
      setSelected({ type: 'board', row: hint.from[0], col: hint.from[1] });
      setHighlightSet(new Set([`${hint.to[0]},${hint.to[1]}`]));
    } else {
      setSelected({ type: 'hand', player: attacker, piece: hint.piece });
      setHighlightSet(new Set([`${hint.to[0]},${hint.to[1]}`]));
    }
    setMessage('💡 ヒント: ハイライトされた場所に注目！');
  }

  // ── 表示用盤面/持ち駒 ─────────────────────────────────────
  const displayBoard    = showAnswer && answerStates ? answerStates[answerStep].board    : board;
  const displayHands    = showAnswer && answerStates ? answerStates[answerStep].hands    : hands;
  const displayLastMove = showAnswer && answerStates ? answerStates[answerStep].lastMove : lastMove;
  const answerTotal     = answerStates ? answerStates.length - 1 : 0;

  const selectedCell = (!showAnswer && selected?.type === 'board') ? { row: selected.row, col: selected.col } : null;
  const dropSelected = (!showAnswer && selected?.type === 'hand')  ? { player: selected.player, type: selected.piece } : null;
  const isAttackerTurn = currentPlayer === attacker && status === 'solving';

  // 反転時に駒台の配置を入れ替える
  // flipped=false: PC左=defender, PC右=attacker, モバイル上=defender, モバイル下=attacker
  // flipped=true:  PC左=attacker, PC右=defender, モバイル上=attacker, モバイル下=defender
  const leftPCPlayer  = flipped ? attacker : defender;
  const rightPCPlayer = flipped ? defender : attacker;
  const topMobPlayer  = flipped ? attacker : defender;
  const botMobPlayer  = flipped ? defender : attacker;

  function getDropProps(player) {
    if (showAnswer || player !== attacker) return { dropSelected: null, onDropSelect: null };
    return { dropSelected, onDropSelect: handleDropSelect };
  }

  // ── ローディング / エラー ──────────────────────────────────
  if (loadStatus === 'loading') return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center lg:ml-64">
      <TsumeNav />
      <svg className="animate-spin w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
      </svg>
    </div>
  );
  if (loadStatus === 'error') return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4 lg:ml-64">
      <TsumeNav />
      <div className="bg-gray-800 border border-red-500/40 rounded-2xl p-8 max-w-md w-full text-center flex flex-col gap-4">
        <p className="text-red-400 font-bold">詰将棋を読み込めませんでした</p>
        <p className="text-gray-400 text-sm">{errorMsg}</p>
        <button onClick={() => navigate(-1)} className="text-blue-400 text-sm">← 戻る</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white lg:ml-64 pb-16 lg:pb-0">
      <TsumeNav />
      <Helmet>
        <title>{puzzleTitle} | 将棋アナリティクス</title>
        <meta name="description" content={description
          ? `${description.slice(0, 120)}`
          : `${numMoves}手詰めの詰将棋です。${author?.displayName ? `${author.displayName}作。` : ''}実際に解いて将棋の読みを鍛えよう！`} />
        <meta name="keywords" content={`詰将棋,${numMoves}手詰め,将棋,将棋パズル,詰将棋オンライン,将棋アナリティクス`} />
        <link rel="canonical" href={`https://analytics.pkkis.com/tsume/${token}`} />
        <meta property="og:type" content="article" />
        <meta property="og:site_name" content="将棋アナリティクス" />
        <meta property="og:title" content={`${puzzleTitle} | 将棋アナリティクス`} />
        <meta property="og:description" content={description
          ? `${description.slice(0, 120)}`
          : `${numMoves}手詰めの詰将棋。${author?.displayName ? `${author.displayName}作。` : ''}実際に解いてみよう！`} />
        <meta property="og:url" content={`https://analytics.pkkis.com/tsume/${token}`} />
        <meta property="og:image" content="https://analytics.pkkis.com/icons/icon-512x512.png" />
        <meta property="og:locale" content="ja_JP" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${puzzleTitle} | 将棋アナリティクス`} />
        <meta name="twitter:description" content={description
          ? `${description.slice(0, 120)}`
          : `${numMoves}手詰めの詰将棋。${author?.displayName ? `${author.displayName}作。` : ''}実際に解いてみよう！`} />
        <meta name="twitter:image" content="https://analytics.pkkis.com/icons/icon-512x512.png" />
        <script type="application/ld+json">{JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Game',
          name: puzzleTitle,
          description: description || `${numMoves}手詰めの詰将棋`,
          url: `https://analytics.pkkis.com/tsume/${token}`,
          inLanguage: 'ja',
          ...(author?.displayName ? { author: { '@type': 'Person', name: author.displayName } } : {}),
        })}</script>
      </Helmet>

      {/* ── ナビゲーションヘッダー ── */}
      <div className="sticky top-0 z-20 bg-gray-900/95 backdrop-blur border-b border-gray-700">
        <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 py-2.5">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-400 hover:text-white transition-colors shrink-0 p-1"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm truncate">{puzzleTitle}</p>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500 text-xs">{numMoves}手詰め</span>
              {author?.userId && author?.displayName && (
                <>
                  <span className="text-gray-600 text-xs">·</span>
                  <Link
                    to={`/profile/${author.userId}`}
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                  >
                    {author.displayName} 作
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── メインコンテンツ ── */}
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="flex gap-5 items-start">

          {/* 左スペーサー: サイドバーと同幅にして盤面を中央寄せ */}
          <div className="hidden lg:block w-36 shrink-0" />

          {/* ── 中央: パズル本体 ── */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">

            {/* ステータスバー */}
            <div className={`rounded-xl px-4 py-2 text-center text-sm font-medium transition-all
              ${showAnswer                        ? 'bg-blue-900/40 text-blue-300' :
                status === 'solved'               ? 'bg-green-900/50 text-green-300' :
                message.startsWith('❌')          ? 'bg-red-900/40 text-red-300' :
                message.startsWith('💡')          ? 'bg-amber-900/30 text-amber-300' :
                currentPlayer === defender        ? 'bg-gray-800/80 text-gray-400' :
                                                    'bg-gray-800/80 text-gray-300'}`}>
              {showAnswer
                ? answerStep === 0
                  ? '解答手順（初期局面）'
                  : `第${answerStep}手${answerStep % 2 === 1 ? '（攻め方）' : '（玉方）'}`
                : status === 'solved'
                ? '🎉 正解！詰みました！'
                : currentPlayer === defender && status === 'solving'
                ? '玉方が応手中…'
                : message || (isAttackerTurn ? `攻め方の手番（残り約${numMoves - moveCount}手）` : '　')}
            </div>

            {/* 操作ボタン行 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="bg-gray-800 border border-gray-700 rounded-full px-2.5 py-1 text-xs text-gray-500">
                {moveCount} / {numMoves} 手
              </span>
              <div className="flex-1" />
              {!showAnswer && (
                <>
                  <button
                    onClick={handleHint}
                    disabled={status !== 'solving' || !currentSolutions?.length}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20
                      hover:bg-amber-600/30 text-amber-400 text-xs transition-colors disabled:opacity-40"
                  >
                    <Lightbulb size={13} /> ヒント
                  </button>
                  <button
                    onClick={resetPuzzle}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700
                      hover:bg-gray-600 text-gray-200 text-xs transition-colors"
                  >
                    <RotateCcw size={13} /> やり直し
                  </button>
                </>
              )}
              <button
                onClick={() => setFlipped(f => !f)}
                title="盤面を反転"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors
                  ${flipped ? 'bg-purple-600/30 text-purple-300' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
              >
                <FlipVertical2 size={13} /> 反転
              </button>
              {isMyPuzzle && !showAnswer && (
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/30
                    hover:bg-red-900/50 text-red-400 text-xs transition-colors"
                >
                  <Trash2 size={13} /> 削除
                </button>
              )}
            </div>

            {/* 盤面エリア */}
            {displayBoard && displayHands && (
              <div className="select-none">
                {/* モバイル: 上の駒台 */}
                <div className="lg:hidden mb-1">
                  <HandRowHorizontal
                    hands={displayHands} player={topMobPlayer} activePlayer={currentPlayer}
                    align="right" flipped={flipped}
                    {...getDropProps(topMobPlayer)}
                  />
                </div>

                {/* 盤面 + PC左右駒台 */}
                <div className="flex items-stretch gap-1">
                  {/* PC: 左駒台 */}
                  <div className="hidden lg:flex self-stretch">
                    <HandColumnVertical
                      hands={displayHands} player={leftPCPlayer} activePlayer={currentPlayer}
                      pieceAlign="top" flipped={flipped}
                      {...getDropProps(leftPCPlayer)}
                    />
                  </div>

                  {/* 将棋盤 */}
                  <div className="flex-1">
                    <BoardCore
                      board={displayBoard}
                      selectedCell={selectedCell}
                      highlightSet={showAnswer ? new Set() : highlightSet}
                      lastMove={displayLastMove}
                      onCellClick={showAnswer ? undefined : handleCellClick}
                      activePlayer={currentPlayer}
                      flipped={flipped}
                    />
                  </div>

                  {/* PC: 右駒台 */}
                  <div className="hidden lg:flex self-stretch">
                    <HandColumnVertical
                      hands={displayHands} player={rightPCPlayer} activePlayer={currentPlayer}
                      pieceAlign="bottom" flipped={flipped}
                      {...getDropProps(rightPCPlayer)}
                    />
                  </div>
                </div>

                {/* モバイル: 下の駒台 */}
                <div className="lg:hidden mt-1">
                  <HandRowHorizontal
                    hands={displayHands} player={botMobPlayer} activePlayer={currentPlayer}
                    align="left" flipped={flipped}
                    {...getDropProps(botMobPlayer)}
                  />
                </div>
              </div>
            )}

            {/* ── 解答ナビゲーション ── */}
            {showAnswer && answerStates && (
              <div className="bg-gray-800 border border-blue-500/30 rounded-xl px-4 py-3 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-blue-300 font-bold">解答手順</span>
                  <span className="text-xs text-gray-400">{answerStep} / {answerTotal} 手</span>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => { setAnswerStep(0); setAutoPlay(false); }}
                    disabled={answerStep === 0}
                    className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-30"
                    title="最初へ"
                  >
                    <SkipBack size={16} />
                  </button>
                  <button
                    onClick={() => { setAnswerStep(s => Math.max(0, s - 1)); setAutoPlay(false); }}
                    disabled={answerStep === 0}
                    className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-30"
                    title="前へ"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setAutoPlay(a => !a)}
                    className={`p-2 rounded-lg transition-colors ${autoPlay ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                    title={autoPlay ? '停止' : '自動再生'}
                  >
                    {autoPlay ? <Square size={16} /> : <Play size={16} />}
                  </button>
                  <button
                    onClick={() => { setAnswerStep(s => Math.min(answerTotal, s + 1)); setAutoPlay(false); }}
                    disabled={answerStep === answerTotal}
                    className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-30"
                    title="次へ"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    onClick={() => { setAnswerStep(answerTotal); setAutoPlay(false); }}
                    disabled={answerStep === answerTotal}
                    className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-30"
                    title="最後へ"
                  >
                    <SkipForward size={16} />
                  </button>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: answerTotal > 0 ? `${(answerStep / answerTotal) * 100}%` : '0%' }}
                  />
                </div>
                <button
                  onClick={closeAnswer}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors text-center"
                >
                  解答を閉じる
                </button>
              </div>
            )}

            {/* 解答を見るボタン */}
            {!showAnswer && puzzle?.solution && (
              <button
                onClick={openAnswer}
                className="w-full py-2 rounded-xl border border-gray-600 hover:border-gray-400
                  text-gray-400 hover:text-gray-200 text-sm transition-colors"
              >
                答えを見る
              </button>
            )}

            {/* ── 説明・いいね・ブックマーク ── */}
            <div className="flex flex-col gap-3 pt-1">
              {/* 説明 */}
              {description && (
                <div className="bg-gray-800/60 border border-gray-700 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">作者のコメント</p>
                  <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{description}</p>
                </div>
              )}

              {/* いいね・ブックマーク */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleLike}
                  disabled={!myToken || likeBusy}
                  title={myToken ? (myLike ? 'いいねを取り消す' : 'いいね') : 'ログインが必要です'}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all
                    ${myLike
                      ? 'border-red-500/50 bg-red-500/15 text-red-400 hover:bg-red-500/25'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-red-500/40 hover:text-red-400'}
                    disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <Heart size={16} fill={myLike ? 'currentColor' : 'none'} />
                  <span>{likes}</span>
                </button>
                <button
                  onClick={handleBookmark}
                  disabled={!myToken || bookmarkBusy}
                  title={myToken ? (myBookmark ? 'ブックマーク解除' : 'ブックマーク') : 'ログインが必要です'}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all
                    ${myBookmark
                      ? 'border-blue-500/50 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-blue-500/40 hover:text-blue-400'}
                    disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <Bookmark size={16} fill={myBookmark ? 'currentColor' : 'none'} />
                  <span>{bookmarks}</span>
                </button>
                {!myToken && (
                  <p className="text-xs text-gray-600 ml-1">
                    <Link to="/login" className="text-blue-500 hover:text-blue-400">ログイン</Link>
                    して評価できます
                  </p>
                )}
              </div>
            </div>

            {/* ログイン促進（削除: 上に統合） */}
          </div>

          {/* ── 右: カテゴリサイドバー (PC専用, 左スペーサーと同幅) ── */}
          <div className="hidden lg:block w-36 shrink-0">
            <CategorySidebar />
          </div>
        </div>

        {/* ── モバイル専用: カテゴリリンク ── */}
        <div className="lg:hidden mt-6">
          <MobileCategoryLinks />
        </div>
      </div>

      {/* ── 最近の詰将棋: 将棋盤レイアウトと独立して完全中央寄せ ── */}
      {recents.length > 0 && (
        <div className="max-w-4xl mx-auto px-4 mt-6 pb-8">
          <h2 className="text-base font-bold text-white mb-3 border-l-4 border-blue-500 pl-3">
            最近投稿された詰将棋
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {recents.slice(0, 8).map(item => (
              <RecentCard key={item.token} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* ── 詰み達成オーバーレイ ── */}
      {status === 'solved' && !showAnswer && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={resetPuzzle}>
          <div className="bg-gray-900 border border-green-500/50 rounded-2xl shadow-2xl p-8
            flex flex-col items-center gap-4 max-w-sm w-full"
            onClick={e => e.stopPropagation()}>
            <Trophy size={48} className="text-yellow-400" />
            <div className="text-center">
              <p className="text-2xl font-bold text-white">正解！</p>
              <p className="text-green-400 mt-1">{numMoves}手詰めを解きました！</p>
            </div>
            <button onClick={resetPuzzle}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors">
              もう一度挑戦
            </button>
            <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-300 text-sm">
              ← 戻る
            </button>
          </div>
        </div>
      )}

      {/* ── 成り確認ダイアログ ── */}
      {showPromo && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => handlePromotionChoice(false)}>
          <div className="bg-gray-800 border border-gray-600 rounded-2xl p-5 flex flex-col gap-3 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <p className="text-white text-center font-bold">成りますか？</p>
            <div className="flex gap-3">
              <button onClick={() => handlePromotionChoice(true)}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors">
                成る
              </button>
              <button onClick={() => handlePromotionChoice(false)}
                className="px-6 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white transition-colors">
                成らない
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}