// ============================================================
//  オンライン対局ページ — クイックマッチ + 待ち受け一覧 + 対局 + レーティング
// ============================================================
import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { BoardCore, HandRowHorizontal } from '../components/ShogiBoard';
import {
  createInitialBoard, createInitialHands, applyMove,
  getLegalMoveDestinations, getLegalDropDestinations,
  isInCheck, isCheckmate, canPromote, isPromoted,
  PIECE_KANJI,
} from '../state/gameState';
import { getGrade, formatTime } from '../utils/shogiRating';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import GameHistoryCard from '../components/GameHistoryCard.jsx';
import GameHistoryFilter, { filterGames } from '../components/GameHistoryFilter.jsx';
import AccountMenu from '../components/AccountMenu';
import TsumeNav from '../components/TsumeNav';

const API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';

// ─── クイックマッチプリセット (将棋ウォーズ風) ──────────────
const QUICK_MATCH = [
  { key: 'q10s', label: '10秒',  desc: '秒読みのみ', timeControl: 0,   byoyomi: 1, byoyomiSeconds: 10 },
  { key: 'q3m',  label: '3分',   desc: '',           timeControl: 180, byoyomi: 0, byoyomiSeconds: 0  },
  { key: 'q10m', label: '10分',  desc: '',           timeControl: 600, byoyomi: 0, byoyomiSeconds: 0  },
];

// ─── 将棋盤 reducer ──────────────────────────────────────────
const INIT_GAME_STATE = {
  board: createInitialBoard(),
  hands: createInitialHands(),
  currentPlayer: 1,
  lastMove: null,
};

function gameReducer(state, action) {
  switch (action.type) {
    case 'APPLY_MOVE': {
      const { move, player } = action;
      const result = applyMove(state.board, state.hands, move, player);
      const next   = player === 1 ? 2 : 1;
      return {
        board: result.board, hands: result.hands, currentPlayer: next,
        lastMove: {
          from: move.from ? `${move.from[0]},${move.from[1]}` : null,
          to:   `${move.to[0]},${move.to[1]}`,
        },
      };
    }
    case 'RESET':
      return {
        board: createInitialBoard(),
        hands: createInitialHands(),
        currentPlayer: 1,
        lastMove: null,
      };
    default:
      return state;
  }
}

// ─── Web Audio ビープ ────────────────────────────────────────
let _audioCtx = null;
function beep(freq = 880, dur = 0.08, vol = 0.25) {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = _audioCtx.createOscillator();
    const g   = _audioCtx.createGain();
    osc.connect(g); g.connect(_audioCtx.destination);
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, _audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + dur);
    osc.start(); osc.stop(_audioCtx.currentTime + dur);
  } catch {}
}

// ─── JWTパース ───────────────────────────────────────────────
function parseJwt(t) {
  try { return JSON.parse(atob(t.split('.')[1])); } catch { return null; }
}

function mustPromote(pieceType, toRow, player) {
  const b = pieceType.startsWith('+') ? pieceType.slice(1) : pieceType;
  if (player === 1) { if (b==='P'||b==='L') return toRow===0; if (b==='N') return toRow<=1; }
  else              { if (b==='P'||b==='L') return toRow===8; if (b==='N') return toRow>=7; }
  return false;
}

function makeClockInit(timeControl, byoyomiSeconds, byoyomi) {
  const hasByo   = (byoyomi ?? 0) > 0;
  const startByo = hasByo && (timeControl === 0);
  return { main: timeControl, byo: byoyomiSeconds ?? 30, inByo: startByo };
}

const REASON_LABEL = { resign:'投了', timeout:'時間切れ', checkmate:'詰み', disconnect:'切断' };

// ─── リプレイ用定数・ユーティリティ ─────────────────────────
const _PIECE_CHAR = {
  P:'歩', L:'香', N:'桂', S:'銀', G:'金', B:'角', R:'飛', K:'玉',
  '+P':'と', '+L':'杏', '+N':'圭', '+S':'全', '+B':'馬', '+R':'竜',
};
const _HAND_ORDER = ['R','B','G','S','N','L','P'];
const _FILES = ['９','８','７','６','５','４','３','２','１'];
const _RANKS = ['一','二','三','四','五','六','七','八','九'];
const _INIT_BOARD = [
  [{type:'L',player:2},{type:'N',player:2},{type:'S',player:2},{type:'G',player:2},{type:'K',player:2},{type:'G',player:2},{type:'S',player:2},{type:'N',player:2},{type:'L',player:2}],
  [null,{type:'R',player:2},null,null,null,null,null,{type:'B',player:2},null],
  Array(9).fill(null).map(()=>({type:'P',player:2})),
  Array(9).fill(null),Array(9).fill(null),Array(9).fill(null),
  Array(9).fill(null).map(()=>({type:'P',player:1})),
  [null,{type:'B',player:1},null,null,null,null,null,{type:'R',player:1},null],
  [{type:'L',player:1},{type:'N',player:1},{type:'S',player:1},{type:'G',player:1},{type:'K',player:1},{type:'G',player:1},{type:'S',player:1},{type:'N',player:1},{type:'L',player:1}],
];
function _applyMove(board, hands, move, player) {
  const nb = board.map(r => r.map(c => c ? { ...c } : null));
  const nh = { 1: { ...hands[1] }, 2: { ...hands[2] } };
  const [toR, toC] = move.to;
  if (move.from) {
    const [fr, fc] = move.from;
    const piece = nb[fr][fc];
    if (!piece) return { board: nb, hands: nh };
    const target = nb[toR][toC];
    if (target) { const b = target.type.startsWith('+') ? target.type.slice(1) : target.type; nh[player][b] = (nh[player][b] || 0) + 1; }
    nb[fr][fc] = null;
    nb[toR][toC] = { type: move.promote ? '+' + (piece.type.startsWith('+') ? piece.type.slice(1) : piece.type) : piece.type, player };
  } else if (move.piece) {
    nh[player][move.piece] = Math.max(0, (nh[player][move.piece] || 0) - 1);
    nb[toR][toC] = { type: move.piece, player };
  }
  return { board: nb, hands: nh };
}
function _computeStates(moves) {
  const states = [{ board: _INIT_BOARD.map(r => r.map(c => c ? { ...c } : null)), hands: { 1: {}, 2: {} } }];
  for (let i = 0; i < moves.length; i++) {
    states.push(_applyMove(states[i].board, states[i].hands, moves[i], i % 2 === 0 ? 1 : 2));
  }
  return states;
}
function _movesToParsedMoves(moves) {
  let board = _INIT_BOARD.map(r => r.map(c => c ? { ...c } : null));
  let hands = { 1: {}, 2: {} };
  return moves.map((move, i) => {
    const player = i % 2 === 0 ? 1 : 2;
    const [toR, toC] = move.to;
    let label;
    if (move.piece) {
      label = `${_FILES[toC]}${_RANKS[toR]}${_PIECE_CHAR[move.piece] || move.piece}打`;
    } else if (move.from) {
      const [fr, fc] = move.from;
      const piece = board[fr][fc];
      const ch = piece ? (_PIECE_CHAR[piece.type] || piece.type) : '?';
      label = `${_FILES[toC]}${_RANKS[toR]}${ch}${move.promote ? '成' : ''}`;
    } else {
      label = `${_FILES[toC]}${_RANKS[toR]}?`;
    }
    const result = _applyMove(board, hands, move, player);
    board = result.board; hands = result.hands;
    return { moveNumber: i + 1, label, from: move.from || null, to: move.to, promote: move.promote || false, dropPiece: move.piece || null };
  });
}

// ─── HandRow (リプレイ用) ─────────────────────────────────────
function _HandRow({ hands, player, name, flip }) {
  const h = hands[player] || {};
  const pieces = _HAND_ORDER.filter(t => (h[t] || 0) > 0);
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 bg-gray-800/60 min-h-[36px] ${flip ? 'flex-row-reverse' : ''}`}>
      <span className="text-[10px] text-gray-500 shrink-0">{name}</span>
      <span className="text-[10px] text-gray-600 shrink-0">持</span>
      {pieces.length === 0
        ? <span className="text-[10px] text-gray-600">なし</span>
        : pieces.map(t => (
            <span key={t} className="inline-flex items-center gap-0.5">
              <span style={{ fontWeight:900, fontSize:13, color:'#111', background:'#e8c96a', borderRadius:3, padding:'1px 3px', display:'inline-block', transform: flip ? 'rotate(180deg)' : 'none', lineHeight:1.2 }}>
                {_PIECE_CHAR[t] || t}
              </span>
              {h[t] > 1 && <span className="text-[10px] text-gray-400">{h[t]}</span>}
            </span>
          ))
      }
    </div>
  );
}

// ─── ReplayViewer ─────────────────────────────────────────────
function ReplayViewer({ game, onClose, onAnalyze }) {
  const moves = useMemo(() => { try { return game.moves ? JSON.parse(game.moves) : []; } catch { return []; } }, [game.moves]);
  const states = useMemo(() => _computeStates(moves), [moves]);
  const [idx, setIdx] = useState(0);
  const { board, hands } = states[idx];
  const senteName = game.sente_name || game.sente_email?.split('@')[0] || '先手';
  const goteName  = game.gote_name  || game.gote_email?.split('@')[0]  || '後手';
  const date = game.finished_at ? new Date(game.finished_at * 1000).toLocaleDateString('ja-JP') : '';
  const btnBase = 'p-1.5 rounded text-gray-400 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed';
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft')  setIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx(i => Math.min(states.length - 1, i + 1));
      if (e.key === 'Escape')     onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [states.length, onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2" onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm max-h-[95vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 shrink-0">
          <div className="text-sm leading-tight">
            <span className="font-bold text-white">{goteName}</span>
            <span className="text-gray-500 mx-1.5 text-xs">後手</span>
            <span className="text-gray-600 mx-1">vs</span>
            <span className="text-gray-500 mx-1.5 text-xs">先手</span>
            <span className="font-bold text-white">{senteName}</span>
            {date && <span className="text-gray-600 text-xs ml-2">{date}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white ml-2 shrink-0 transition-colors"><X size={18} /></button>
        </div>
        <_HandRow hands={hands} player={2} name={goteName} flip />
        <div style={{ containerType:'inline-size' }} className="px-2 shrink-0">
          <div style={{ display:'grid', gridTemplateColumns:'repeat(9,1fr)', gridTemplateRows:'repeat(9,1fr)', aspectRatio:'9/10', border:'2px solid #92400e' }}>
            {board.flatMap((row, r) => row.map((piece, c) => (
              <div key={`${r}-${c}`} style={{ background:'#e8c96a', borderRight:'1px solid #92400e30', borderBottom:'1px solid #92400e30' }} className="flex items-center justify-center overflow-hidden">
                {piece && (
                  <span style={{ fontSize:'9cqw', fontWeight:900, color: piece.type.startsWith('+') ? '#c00' : '#111', transform: piece.player === 2 ? 'rotate(180deg)' : 'none', lineHeight:1, display:'block' }}>
                    {_PIECE_CHAR[piece.type] || piece.type}
                  </span>
                )}
              </div>
            )))}
          </div>
        </div>
        <_HandRow hands={hands} player={1} name={senteName} flip={false} />
        <div className="flex items-center justify-center gap-1 px-3 py-2 border-t border-gray-700 shrink-0">
          <button onClick={() => setIdx(0)} disabled={idx === 0} className={btnBase}><ChevronsLeft size={16} /></button>
          <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0} className={btnBase}><ChevronLeft size={16} /></button>
          <span className="text-xs text-gray-400 w-20 text-center tabular-nums">{idx === 0 ? '初期局面' : `${idx} / ${moves.length}手`}</span>
          <button onClick={() => setIdx(i => Math.min(states.length - 1, i + 1))} disabled={idx === states.length - 1} className={btnBase}><ChevronRight size={16} /></button>
          <button onClick={() => setIdx(states.length - 1)} disabled={idx === states.length - 1} className={btnBase}><ChevronsRight size={16} /></button>
          <button onClick={onAnalyze} className="ml-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white font-bold transition-colors shrink-0">解析する</button>
        </div>
      </div>
    </div>
  );
}

const TIME_OPTIONS = [
  { label:'1分',  val:60  },
  { label:'3分',  val:180 },
  { label:'5分',  val:300 },
  { label:'10分', val:600 },
];
const BYO_OPTIONS = [
  { label:'なし',  val:0  },
  { label:'10秒', val:10 },
  { label:'30秒', val:30 },
  { label:'60秒', val:60 },
];

// ============================================================
export default function OnlineLobbyPage() {
  const navigate = useNavigate();

  function navigateToAnalysis(g) {
    try {
      const moves = g.moves ? JSON.parse(g.moves) : [];
      const parsedMoves = _movesToParsedMoves(moves);
      const senteName = g.sente_name || g.sente_email?.split('@')[0] || '先手';
      const goteName  = g.gote_name  || g.gote_email?.split('@')[0]  || '後手';
      sessionStorage.setItem('shogi_online_replay', JSON.stringify({ parsedMoves, senteName, goteName }));
      navigate('/app');
    } catch (e) { console.error(e); }
  }

  const jwt    = localStorage.getItem('shogi_jwt') || '';
  const me     = useMemo(() => parseJwt(jwt), [jwt]);
  const userId = me?.userId ?? '';
  const userEmail = me?.email ?? '';

  // ─── サーバーデータ ────────────────────────────────────────
  const [myRating,       setMyRating]       = useState(1500);
  const [myGames,        setMyGames]        = useState(0);
  const [isAdmin,        setIsAdmin]        = useState(false);
  const [waitList,       setWaitList]       = useState([]);
  const [leaderboard,    setLeaderboard]    = useState([]);
  const [history,        setHistory]        = useState([]);
  const [histResultFilter, setHistResultFilter] = useState('all');
  const [histReasonFilter, setHistReasonFilter] = useState('all');
  const [histTimeFilter,   setHistTimeFilter]   = useState('all');
  const [activeGamesList, setActiveGamesList] = useState([]);
  const [replayGame,     setReplayGame]     = useState(null);

  // ─── 友達 ────────────────────────────────────────────────
  const [friends,          setFriends]          = useState([]);
  const [pendingReceived,  setPendingReceived]  = useState([]);
  const [pendingSent,      setPendingSent]      = useState([]);
  const [friendSearch,     setFriendSearch]     = useState('');
  const [friendResults,    setFriendResults]    = useState([]);
  const [friendSearching,  setFriendSearching]  = useState(false);
  const [friendsLoading,   setFriendsLoading]   = useState(false);
  const [incomingInvite,   setIncomingInvite]   = useState(null);  // { inviteId, fromId, fromName, fromRating, config }
  const [invitePending,    setInvitePending]    = useState(false); // 送信後・相手の返事待ち
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteTarget,     setInviteTarget]     = useState(null);  // { userId, displayName, rating }
  const [inviteConfig,     setInviteConfig]     = useState({ timeControl: 600, byoyomi: 0, byoyomiSeconds: 30, rated: false });

  // ─── ロビー UI 状態 ────────────────────────────────────────
  const [lobbyTab,       setLobbyTab]       = useState('quick');  // 'quick'|'wait'|'watch'|'rank'|'history'|'friends'
  const [showWaitModal,  setShowWaitModal]  = useState(false);
  const [waitSettings,   setWaitSettings]   = useState({ timeControl: 600, byoyomi: 0, byoyomiSeconds: 30 });
  const [inWaitList,     setInWaitList]     = useState(false);
  const [quickMatchKey,  setQuickMatchKey]  = useState(null);  // null | 'q10s'|'q3m'|'q10m'

  // ─── 対局状態 ─────────────────────────────────────────────
  const [view,          setView]          = useState('lobby');  // 'lobby'|'game'|'spectating'
  const [game,          setGame]          = useState(null);
  const [spectateGame,  setSpectateGame]  = useState(null);
  const [spectateOver,  setSpectateOver]  = useState(null);
  const [myColor,       setMyColor]       = useState(null);
  const [gameOver,      setGameOver]      = useState(null);
  const [oppReconnecting, setOppReconnecting] = useState(null);
  const [selectedCell,  setSelectedCell]  = useState(null);
  const [dropSelected,  setDropSelected]  = useState(null);
  const [highlightSet,  setHighlightSet]  = useState(new Set());
  const [showResign,    setShowResign]    = useState(false);
  const [illegalWarn,   setIllegalWarn]   = useState(false);
  // pendingMove: { from, to, pieceBase } — 成り選択待ち
  const [pendingMove,   setPendingMove]   = useState(null);

  // ─── 将棋盤状態 (reducer) ─────────────────────────────────
  const [gs, dispatch] = useReducer(gameReducer, INIT_GAME_STATE);
  const [gsSpec, dispatchSpec] = useReducer(gameReducer, INIT_GAME_STATE);

  // ─── タイマー ─────────────────────────────────────────────
  const clockRef = useRef({ sente:{main:600,byo:30,inByo:false}, gote:{main:600,byo:30,inByo:false} });
  const [clockDisp, setClockDisp] = useState(clockRef.current);
  const clockSpecRef  = useRef({ sente:{main:600,byo:30,inByo:false}, gote:{main:600,byo:30,inByo:false} });
  const [clockSpecDisp, setClockSpecDisp] = useState(clockSpecRef.current);
  const timerRef    = useRef(null);

  // ─── refs (socket callback内で最新状態参照用) ────────────
  const myColorRef        = useRef(null);
  const gameRef           = useRef(null);
  const socketRef         = useRef(null);
  const gsRef             = useRef(gs);
  const moveAudioRef      = useRef(null);
  useEffect(() => {
    moveAudioRef.current = new Audio('/attack.mp3');
    moveAudioRef.current.preload = 'auto';
    moveAudioRef.current.volume = 0.3;
  }, []);
  const spectateMoveRef   = useRef(0);  // 観戦中の手数カウント
  useEffect(() => { gsRef.current = gs; }, [gs]);
  const gsSpecRef = useRef(gsSpec);
  useEffect(() => { gsSpecRef.current = gsSpec; }, [gsSpec]);

  // ─── 盤面エリア実寸計測 (ResizeObserver) ─────────────────
  const boardAreaRef = useRef(null);
  const [boardPx, setBoardPx] = useState(0);
  useEffect(() => {
    const el = boardAreaRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      // 盤面グリッドは 9:10 (幅:高さ) なので、幅基準と高さ基準で小さい方を採用
      setBoardPx(Math.min(width, height * 9 / 10));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [view]);

  // ─── ログインチェック・初期データ取得 ──────────────────────
  useEffect(() => {
    if (!jwt || !userId) { navigate('/login'); return; }

    const fetchMe = () =>
      fetch(`${API}/api/online/me`,      { headers: { Authorization:`Bearer ${jwt}` } })
        .then(r=>r.ok?r.json():null).then(d=>{ if(d?.ok){ setMyRating(d.rating); setMyGames(d.games); } }).catch(()=>{});
    const fetchAdm = () =>
      fetch(`${API}/auth/me`,            { headers: { Authorization:`Bearer ${jwt}` } })
        .then(r=>r.ok?r.json():null).then(d=>{ if(d?.ok) setIsAdmin(d.isAdmin===true); }).catch(()=>{});
    const fetchLB = () =>
      fetch(`${API}/api/online/leaderboard`)
        .then(r=>r.ok?r.json():null).then(d=>{ if(d?.ok) setLeaderboard(d.leaderboard||[]); }).catch(()=>{});
    const fetchHist = () =>
      fetch(`${API}/api/online/history`, { headers: { Authorization:`Bearer ${jwt}` } })
        .then(r=>r.ok?r.json():null).then(d=>{ if(d?.ok) setHistory(d.games||[]); }).catch(()=>{});
    fetchMe(); fetchAdm(); fetchLB(); fetchHist();

    // ── Socket 接続 ───────────────────────────────────────
    const socket = io(`${API}/online`, { auth:{ token:jwt }, transports:['websocket','polling'] });
    socketRef.current = socket;

    socket.on('wait_list', ({ list }) => setWaitList(list || []));

    socket.on('matched', (data) => {
      const role = data.sente.userId === userId ? 'sente' : 'gote';
      myColorRef.current = role;
      gameRef.current    = data;
      setGame(data);
      setMyColor(role);
      dispatch({ type:'RESET' });
      const init = makeClockInit(data.timeControl, data.byoyomiSeconds, data.byoyomi);
      clockRef.current = { sente:{ ...init }, gote:{ ...init } };
      setClockDisp({ sente:{ ...init }, gote:{ ...init } });
      setSelectedCell(null); setDropSelected(null); setHighlightSet(new Set());
      setGameOver(null); setOppReconnecting(null);
      setQuickMatchKey(null);
      setInvitePending(false);
      setIncomingInvite(null);
      sessionStorage.setItem('shogi_online_game', 'true');
      setView('game');
    });

    socket.on('game_restored', (data) => {
      myColorRef.current = data.myColor;
      gameRef.current    = data;
      setGame(data);
      setMyColor(data.myColor);
      dispatch({ type:'RESET' });
      // 棋譜を再生して盤面復元
      (data.moves ?? []).forEach((m, i) =>
        dispatch({ type:'APPLY_MOVE', move:m, player: i%2===0?1:2 })
      );
      sessionStorage.setItem('shogi_online_game', 'true');
      // サーバーの実残時間からクロックを復元
      const elapsed = Date.now() - (data.lastMoveAt ?? Date.now());
      const sc = data.clock ?? {
        sente: { main: (data.timeControl ?? 600) * 1000, byo: (data.byoyomiSeconds ?? 30) * 1000 },
        gote:  { main: (data.timeControl ?? 600) * 1000, byo: (data.byoyomiSeconds ?? 30) * 1000 },
      };
      const restoreRole = (role) => {
        const c = sc[role];
        const active = data.currentPlayer === role;
        let mainMs = c.main, byoMs = c.byo;
        if (active) {
          if (mainMs > 0) {
            mainMs = Math.max(0, mainMs - elapsed);
            if (mainMs === 0 && (data.byoyomi ?? 0) > 0)
              byoMs = Math.max(0, byoMs - Math.max(0, elapsed - c.main));
          } else if ((data.byoyomi ?? 0) > 0) {
            byoMs = Math.max(0, byoMs - elapsed);
          }
        }
        return { main: Math.round(mainMs / 1000), byo: Math.max(0, Math.round(byoMs / 1000)), inByo: mainMs === 0 && (data.byoyomi ?? 0) > 0 };
      };
      clockRef.current = { sente: restoreRole('sente'), gote: restoreRole('gote') };
      setClockDisp({ ...clockRef.current });
      setGameOver(null); setOppReconnecting(null);
      setQuickMatchKey(null);
      setView('game');
    });

    socket.on('opponent_move', ({ move }) => {
      const oppColorNum = myColorRef.current === 'sente' ? 2 : 1;
      dispatch({ type:'APPLY_MOVE', move, player: oppColorNum });
      if (moveAudioRef.current) { moveAudioRef.current.currentTime = 0; moveAudioRef.current.play().catch(() => {}); }
      // 相手が指したら相手の秒読みリセット
      const oppRole = myColorRef.current === 'sente' ? 'gote' : 'sente';
      const g = gameRef.current;
      if (g?.byoyomi) {
        const prev = clockRef.current[oppRole];
        const bys  = g.byoyomiSeconds ?? 30;
        clockRef.current = { ...clockRef.current,
          [oppRole]: { ...prev, byo: bys, inByo: prev.main === 0 } };
        setClockDisp({ ...clockRef.current });
      }
    });

    socket.on('game_over', (data) => {
      sessionStorage.removeItem('shogi_online_game');
      setGameOver(data);
      clearInterval(timerRef.current);
      if (data.newRating !== undefined) setMyRating(data.newRating);
    });

    socket.on('opponent_reconnecting', ({ seconds }) => {
      setOppReconnecting({ seconds });
      let s = seconds;
      const iv = setInterval(() => {
        s--;
        setOppReconnecting(v => v ? { seconds: s } : null);
        if (s <= 0) clearInterval(iv);
      }, 1000);
    });

    socket.on('opponent_reconnected', () => setOppReconnecting(null));

    socket.on('move_rejected', ({ moves }) => {
      // サーバーの確定棋譜でロールバック
      dispatch({ type: 'RESET' });
      (moves ?? []).forEach((m, i) =>
        dispatch({ type: 'APPLY_MOVE', move: m, player: i % 2 === 0 ? 1 : 2 })
      );
      setSelectedCell(null); setDropSelected(null);
      setHighlightSet(new Set()); setPendingMove(null);
      setIllegalWarn(true);
      setTimeout(() => setIllegalWarn(false), 3000);
    });

    socket.on('random_queuing',   () => {});
    socket.on('random_cancelled', () => setQuickMatchKey(null));
    socket.on('challenge_failed', () => alert('相手がすでに対局を開始しました'));

    socket.on('active_games', ({ list }) => setActiveGamesList(list || []));

    socket.on('friend_invite_received', (data) => setIncomingInvite(data));
    socket.on('friend_invite_rejected', ({ toName }) => {
      setInvitePending(false);
      alert(`${toName}さんに断られました`);
    });
    socket.on('friend_invite_timeout', () => setInvitePending(false));
    socket.on('friend_invite_error',   ({ error }) => { setInvitePending(false); alert(error); });

    socket.on('spectate_joined', (data) => {
      setSpectateGame(data);
      setSpectateOver(null);
      dispatchSpec({ type: 'RESET' });
      (data.moves ?? []).forEach((m, i) =>
        dispatchSpec({ type: 'APPLY_MOVE', move: m, player: i % 2 === 0 ? 1 : 2 })
      );
      spectateMoveRef.current = data.moves?.length ?? 0;
      const elapsed = Date.now() - (data.lastMoveAt ?? Date.now());
      const sc = data.clock ?? {
        sente: { main: (data.timeControl ?? 600) * 1000, byo: (data.byoyomiSeconds ?? 30) * 1000 },
        gote:  { main: (data.timeControl ?? 600) * 1000, byo: (data.byoyomiSeconds ?? 30) * 1000 },
      };
      const toSec = (ms) => Math.round(ms / 1000);
      const restoreSpec = (role) => {
        const c = sc[role];
        const active = data.currentPlayer === role;
        let mainMs = c.main, byoMs = c.byo;
        if (active) {
          if (mainMs > 0) {
            mainMs = Math.max(0, mainMs - elapsed);
            if (mainMs === 0 && (data.byoyomi ?? 0) > 0)
              byoMs = Math.max(0, byoMs - Math.max(0, elapsed - c.main));
          } else if ((data.byoyomi ?? 0) > 0) {
            byoMs = Math.max(0, byoMs - elapsed);
          }
        }
        return { main: toSec(mainMs), byo: Math.max(0, toSec(byoMs)), inByo: mainMs === 0 && (data.byoyomi ?? 0) > 0 };
      };
      clockSpecRef.current = { sente: restoreSpec('sente'), gote: restoreSpec('gote') };
      setClockSpecDisp({ ...clockSpecRef.current });
      setView('spectating');
    });

    socket.on('spectate_move', ({ move, moveNumber, clock }) => {
      const playerNum = moveNumber % 2 === 1 ? 1 : 2;
      dispatchSpec({ type: 'APPLY_MOVE', move, player: playerNum });
      if (moveAudioRef.current) { moveAudioRef.current.currentTime = 0; moveAudioRef.current.play().catch(() => {}); }
      spectateMoveRef.current = moveNumber;
      if (clock) {
        const toSec = (ms) => Math.round(ms / 1000);
        clockSpecRef.current = {
          sente: { main: toSec(clock.sente.main), byo: Math.max(0, toSec(clock.sente.byo)), inByo: clock.sente.main === 0 && clock.sente.byo > 0 },
          gote:  { main: toSec(clock.gote.main),  byo: Math.max(0, toSec(clock.gote.byo)),  inByo: clock.gote.main  === 0 && clock.gote.byo  > 0 },
        };
        setClockSpecDisp({ ...clockSpecRef.current });
      }
    });

    socket.on('spectate_game_over', ({ winner, reason }) => {
      setSpectateOver({ winner, reason });
      clearInterval(timerRef.current);
    });

    // game_restored が来なければ古いフラグを削除（対局期限切れ対策）
    let gameRestoredRef = false;
    socket.once('game_restored', () => { gameRestoredRef = true; });
    const staleTimer = setTimeout(() => {
      if (!gameRestoredRef) sessionStorage.removeItem('shogi_online_game');
    }, 4000);

    return () => {
      socket.disconnect();
      clearInterval(timerRef.current);
      clearTimeout(staleTimer);
    };
  }, [jwt, userId]); // eslint-disable-line

  // ─── タイマー ─────────────────────────────────────────────
  useEffect(() => {
    clearInterval(timerRef.current);
    if (view !== 'game' || gameOver) return;

    timerRef.current = setInterval(() => {
      const role   = gsRef.current.currentPlayer === 1 ? 'sente' : 'gote';
      const isMine = role === myColorRef.current;
      const prev   = clockRef.current[role];
      const hasByo = (gameRef.current?.byoyomi ?? 0) > 0;

      let next = { ...prev };
      if (!prev.inByo) {
        if (prev.main > 0) {
          next.main = prev.main - 1;
          if (next.main === 0 && hasByo) next.inByo = true;
        }
        // タイムアウトはサーバーが検出して game_over を送信するため、ここでは emit しない
      } else {
        next.byo = prev.byo - 1;
        if (next.byo <= 0) {
          next.byo = 0;
          // タイムアウトはサーバーが検出して game_over を送信するため、ここでは emit しない
        }
      }

      // 残り30秒以下でビープ（自分のターンのみ）
      const remaining = next.inByo ? next.byo : next.main;
      if (isMine && remaining <= 30 && remaining > 0) {
        beep(remaining <= 10 ? 1200 : 880, 0.06);
      }

      clockRef.current = { ...clockRef.current, [role]: next };
      setClockDisp({ ...clockRef.current });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [view, gameOver, gs.currentPlayer]); // eslint-disable-line

  // ─── 観戦タイマー ─────────────────────────────────────────
  useEffect(() => {
    clearInterval(timerRef.current);
    if (view !== 'spectating' || spectateOver) return;
    timerRef.current = setInterval(() => {
      const role   = gsSpecRef.current.currentPlayer === 1 ? 'sente' : 'gote';
      const hasByo = (spectateGame?.byoyomi ?? 0) > 0;
      const prev   = clockSpecRef.current[role];
      let next = { ...prev };
      if (!prev.inByo) {
        if (prev.main > 0) {
          next.main = prev.main - 1;
          if (next.main === 0 && hasByo) next.inByo = true;
        }
      } else {
        next.byo = Math.max(0, prev.byo - 1);
      }
      clockSpecRef.current = { ...clockSpecRef.current, [role]: next };
      setClockSpecDisp({ ...clockSpecRef.current });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [view, spectateOver, gsSpec.currentPlayer, spectateGame]); // eslint-disable-line

  // ─── 指し手実行 ───────────────────────────────────────────
  const doMove = useCallback((move) => {
    const myColorNum = myColorRef.current === 'sente' ? 1 : 2;
    const cur        = gsRef.current;
    const result     = applyMove(cur.board, cur.hands, move, myColorNum);
    const oppPlayer  = myColorNum === 1 ? 2 : 1;
    const mated      = isInCheck(result.board, oppPlayer) && isCheckmate(result.board, result.hands, oppPlayer);
    dispatch({ type:'APPLY_MOVE', move, player: myColorNum });

    // 自分が指したら秒読みリセット
    const myRole = myColorRef.current;
    const g = gameRef.current;
    if (g?.byoyomi) {
      const prev = clockRef.current[myRole];
      const bys  = g.byoyomiSeconds ?? 30;
      clockRef.current = { ...clockRef.current,
        [myRole]: { ...prev, byo: bys, inByo: prev.main === 0 } };
      setClockDisp({ ...clockRef.current });
    }

    if (moveAudioRef.current) { moveAudioRef.current.currentTime = 0; moveAudioRef.current.play().catch(() => {}); }
    setSelectedCell(null); setDropSelected(null); setHighlightSet(new Set());
    socketRef.current?.emit('move', {
      gameId: gameRef.current?.id,
      move,
      winner: mated ? (myColorNum===1?'sente':'gote') : null,
      reason: mated ? 'checkmate' : null,
    });
  }, []);

  // ─── 盤面クリック ──────────────────────────────────────────
  const handleCellClick = useCallback((row, col) => {
    const myColorNum = myColorRef.current === 'sente' ? 1 : 2;
    const cur = gsRef.current;
    if (!gameRef.current || gameOver) return;
    if (cur.currentPlayer !== myColorNum) return;
    const cell = cur.board[row]?.[col];

    if (dropSelected) {
      const dests = getLegalDropDestinations(cur.board, cur.hands, dropSelected.type, myColorNum);
      if (dests.some(([r,c]) => r===row && c===col)) { doMove({ from:null, to:[row,col], piece:dropSelected.type }); }
      else { setDropSelected(null); setHighlightSet(new Set()); }
      return;
    }
    if (selectedCell) {
      const [sr,sc] = selectedCell;
      if (sr===row && sc===col) { setSelectedCell(null); setHighlightSet(new Set()); return; }
      const dests = getLegalMoveDestinations(cur.board, cur.hands, sr, sc);
      const legal = dests.some(([r,c]) => r===row && c===col);
      if (legal) {
        const piece  = cur.board[sr][sc];
        const base   = piece.type.startsWith('+') ? piece.type.slice(1) : piece.type;
        const inZ    = myColorNum===1 ? row<=2 : row>=6;
        const fromZ  = myColorNum===1 ? sr<=2  : sr>=6;
        const canP   = canPromote(base) && (inZ||fromZ) && !isPromoted(piece.type);
        const mustP  = mustPromote(piece.type, row, myColorNum);
        if (mustP) { doMove({ from:[sr,sc], to:[row,col], promote:true }); }
        else if (canP) { setPendingMove({ from:[sr,sc], to:[row,col], pieceBase: base }); }
        else { doMove({ from:[sr,sc], to:[row,col], promote:false }); }
        return;
      }
      if (cell && cell.player===myColorNum) {
        setSelectedCell([row,col]);
        setHighlightSet(new Set(getLegalMoveDestinations(cur.board, cur.hands, row, col).map(([r,c])=>`${r},${c}`)));
        return;
      }
      setSelectedCell(null); setHighlightSet(new Set()); return;
    }
    if (cell && cell.player===myColorNum) {
      setSelectedCell([row,col]);
      setHighlightSet(new Set(getLegalMoveDestinations(cur.board, cur.hands, row, col).map(([r,c])=>`${r},${c}`)));
    }
  }, [selectedCell, dropSelected, gameOver, doMove]);

  // HandTile は onSelect({ player, type }) を呼ぶのでオブジェクト分割
  const handleDropSelect = useCallback(({ type }) => {
    const myColorNum = myColorRef.current === 'sente' ? 1 : 2;
    const cur = gsRef.current;
    if (!gameRef.current || gameOver) return;
    if (cur.currentPlayer !== myColorNum) return;
    if (dropSelected?.type === type) { setDropSelected(null); setHighlightSet(new Set()); return; }
    setSelectedCell(null);
    setDropSelected({ type, player: myColorNum });
    setHighlightSet(new Set(getLegalDropDestinations(cur.board, cur.hands, type, myColorNum).map(([r,c])=>`${r},${c}`)));
  }, [dropSelected, gameOver]);

  // ─── ロビー操作 ───────────────────────────────────────────
  const handleJoinWait = () => {
    socketRef.current?.emit('join_wait', waitSettings);
    setInWaitList(true);
    setShowWaitModal(false);
  };
  const handleLeaveWait = () => {
    socketRef.current?.emit('leave_wait');
    setInWaitList(false);
  };
  const handleChallenge = (targetId) => {
    socketRef.current?.emit('challenge', { targetId });
  };

  const handleQuickMatch = (preset) => {
    if (quickMatchKey) return; // 既にマッチング中
    setQuickMatchKey(preset.key);
    socketRef.current?.emit('random_match', {
      timeControl: preset.timeControl, byoyomi: preset.byoyomi, byoyomiSeconds: preset.byoyomiSeconds,
    });
  };
  const handleQuickCancel = () => {
    socketRef.current?.emit('random_cancel');
    setQuickMatchKey(null);
  };

  const handleResign = () => {
    socketRef.current?.emit('resign', { gameId: gameRef.current?.id });
    setShowResign(false);
  };
  const handleGameOverClose = () => {
    sessionStorage.removeItem('shogi_online_game');
    setView('lobby'); setGame(null); setGameOver(null);
    setInWaitList(false); setQuickMatchKey(null);
    fetch(`${API}/api/online/me`,      { headers:{ Authorization:`Bearer ${jwt}` } }).then(r=>r.ok?r.json():null).then(d=>{ if(d?.ok){ setMyRating(d.rating); setMyGames(d.games); } }).catch(()=>{});
    fetch(`${API}/api/online/history`, { headers:{ Authorization:`Bearer ${jwt}` } }).then(r=>r.ok?r.json():null).then(d=>{ if(d?.ok) setHistory(d.games||[]); }).catch(()=>{});
  };

  const handleSpectate = (gameId) => {
    socketRef.current?.emit('spectate', { gameId });
  };

  // ─── 友達 API ─────────────────────────────────────────────
  const fetchFriends = async () => {
    setFriendsLoading(true);
    try {
      const r = await fetch(`${API}/api/friends`, { headers: { Authorization: `Bearer ${jwt}` } });
      const d = await r.json();
      if (d.ok) { setFriends(d.friends || []); setPendingReceived(d.pendingReceived || []); setPendingSent(d.pendingSent || []); }
    } catch {} finally { setFriendsLoading(false); }
  };

  const searchUsers = async (q) => {
    if (!q.trim()) { setFriendResults([]); return; }
    setFriendSearching(true);
    try {
      const r = await fetch(`${API}/api/friends/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${jwt}` } });
      const d = await r.json();
      if (d.ok) setFriendResults(d.users || []);
    } catch {} finally { setFriendSearching(false); }
  };

  const sendFriendRequest = async (toId) => {
    const r = await fetch(`${API}/api/friends/request`, {
      method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ toId }),
    });
    const d = await r.json();
    if (d.ok) { fetchFriends(); searchUsers(friendSearch); }
    else alert(d.error);
  };

  const respondFriendRequest = async (fromId, action) => {
    const r = await fetch(`${API}/api/friends/respond`, {
      method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId, action }),
    });
    const d = await r.json();
    if (d.ok) fetchFriends();
    else alert(d.error);
  };

  const removeFriend = async (friendId, name) => {
    if (!window.confirm(`${name}さんを友達から削除しますか？`)) return;
    const r = await fetch(`${API}/api/friends/${friendId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${jwt}` },
    });
    const d = await r.json();
    if (d.ok) fetchFriends();
    else alert(d.error);
  };

  const sendGameInvite = () => {
    if (!inviteTarget || !socketRef.current) return;
    socketRef.current.emit('friend_invite', { toId: inviteTarget.userId, config: inviteConfig });
    setShowInviteDialog(false);
    setInvitePending(true);
  };

  const acceptInvite = () => {
    if (!incomingInvite || !socketRef.current) return;
    socketRef.current.emit('friend_invite_accept', { inviteId: incomingInvite.inviteId });
    setIncomingInvite(null);
  };

  const rejectInvite = () => {
    if (!incomingInvite || !socketRef.current) return;
    socketRef.current.emit('friend_invite_reject', { inviteId: incomingInvite.inviteId });
    setIncomingInvite(null);
  };

  const handleLeaveSpectate = () => {
    socketRef.current?.emit('leave_spectate', { gameId: spectateGame?.gameId ?? spectateGame?.id });
    setView('lobby');
    setSpectateGame(null);
    setSpectateOver(null);
    dispatchSpec({ type: 'RESET' });
  };

  const flipped      = myColor === 'gote';
  const myColorNum   = myColor === 'sente' ? 1 : 2;
  const oppColorNum  = myColorNum === 1 ? 2 : 1;
  const oppInfo      = myColor === 'sente' ? game?.gote : game?.sente;
  const myInfo       = myColor === 'sente' ? game?.sente : game?.gote;

  // 友達タブを開いたときに最新状態を取得
  useEffect(() => {
    if (lobbyTab === 'friends' && jwt) fetchFriends();
  }, [lobbyTab]); // eslint-disable-line

  const handleLogout = () => {
    localStorage.removeItem('shogi_jwt');
    navigate('/login');
  };

  // ─── タイマー表示ヘルパー (大) ──────────────────────────────
  const renderClock = (role, active) => {
    const c = clockDisp[role] ?? { main:0, byo:0, inByo:false };
    const hasByo = (game?.byoyomi ?? 0) > 0;
    const secs   = c.inByo ? c.byo : c.main;
    const low    = active && secs <= 30;
    return (
      <div className={`font-mono font-black tabular-nums leading-none select-none flex-shrink-0
        ${active ? (low ? 'text-red-400 animate-pulse' : 'text-white') : 'text-gray-500'}`}
        style={{ fontSize: '2rem' }}
      >
        {c.main > 0 && <span>{formatTime(c.main)}</span>}
        {c.main === 0 && hasByo && <span>{c.byo}<span style={{ fontSize:'1rem' }}>秒</span></span>}
        {c.main > 0 && hasByo && !c.inByo && (
          <span className="text-gray-600 ml-1" style={{ fontSize:'0.7rem' }}>+{c.byo}</span>
        )}
        {c.inByo && c.main > 0 && (
          <span className="text-orange-400 ml-1" style={{ fontSize:'0.875rem' }}>({c.byo}秒)</span>
        )}
      </div>
    );
  };

  const renderClockSpec = (role, active) => {
    const c = clockSpecDisp[role] ?? { main:0, byo:0, inByo:false };
    const hasByo = (spectateGame?.byoyomi ?? 0) > 0;
    const secs   = c.inByo ? c.byo : c.main;
    const low    = active && secs <= 30;
    return (
      <div className={`font-mono font-black tabular-nums leading-none select-none flex-shrink-0
        ${active ? (low ? 'text-red-400 animate-pulse' : 'text-white') : 'text-gray-500'}`}
        style={{ fontSize: '2rem' }}>
        {c.main > 0 && <span>{formatTime(c.main)}</span>}
        {c.main === 0 && hasByo && <span>{c.byo}<span style={{ fontSize:'1rem' }}>秒</span></span>}
        {c.main > 0 && hasByo && !c.inByo && (
          <span className="text-gray-600 ml-1" style={{ fontSize:'0.7rem' }}>+{c.byo}</span>
        )}
        {c.inByo && c.main > 0 && (
          <span className="text-orange-400 ml-1" style={{ fontSize:'0.875rem' }}>({c.byo}秒)</span>
        )}
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════
  //  対局画面 — 全画面縦伸び
  // ══════════════════════════════════════════════════════════
  if (view === 'game') {
    const oppRole   = myColor === 'sente' ? 'gote' : 'sente';
    const myRole    = myColor ?? 'sente';
    const oppName   = oppInfo?.displayName || oppInfo?.email?.split('@')[0] || '…';
    const myName    = myInfo?.displayName  || userEmail?.split('@')[0]   || '…';
    const myActive  = gs.currentPlayer === myColorNum  && !gameOver;
    const oppActive = gs.currentPlayer === oppColorNum && !gameOver;
    return (
      <div className="h-screen bg-gray-950 text-gray-100 flex justify-center overflow-hidden">
        {/* 投了確認 */}
        {showResign && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 text-center space-y-4 shadow-2xl">
              <p className="text-white text-lg font-bold">投了しますか？</p>
              <div className="flex gap-3 justify-center">
                <button onClick={handleResign}
                  className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold">投了</button>
                <button onClick={() => setShowResign(false)}
                  className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">キャンセル</button>
              </div>
            </div>
          </div>
        )}
        {/* 対局結果 */}
        {gameOver && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
            <div className="bg-gray-900 border border-gray-600 rounded-2xl p-8 text-center space-y-4 shadow-2xl max-w-sm w-full mx-4">
              <p className={`text-4xl font-black ${gameOver.winner===myColor?'text-yellow-400':'text-red-400'}`}>
                {gameOver.winner===myColor?'勝ち！':'負け'}
              </p>
              <p className="text-gray-400 text-sm">{REASON_LABEL[gameOver.reason]??gameOver.reason}</p>
              {gameOver.ratingChange !== undefined && (
                <div className="text-2xl font-bold">
                  <span className={gameOver.ratingChange>=0?'text-green-400':'text-red-400'}>
                    {gameOver.ratingChange>=0?'+':''}{gameOver.ratingChange}
                  </span>
                  <span className="text-gray-400 text-lg ml-2">→ R{gameOver.newRating}</span>
                </div>
              )}
              <p className="text-gray-400 text-sm">{getGrade(gameOver.newRating??myRating)}</p>
              <button onClick={handleGameOverClose}
                className="mt-2 px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold w-full">
                ロビーに戻る
              </button>
            </div>
          </div>
        )}
        {/* 相手切断中バナー */}
        {oppReconnecting && !gameOver && (
          <div className="fixed top-2 left-1/2 -translate-x-1/2 z-40
                          bg-yellow-900 border border-yellow-600 text-yellow-200
                          px-4 py-2 rounded-lg text-sm shadow-lg pointer-events-none">
            相手が再接続中… {oppReconnecting.seconds}秒
          </div>
        )}
        {/* 不正手警告バナー */}
        {illegalWarn && (
          <div className="fixed top-2 left-1/2 -translate-x-1/2 z-40
                          bg-red-900 border border-red-500 text-red-200
                          px-4 py-2 rounded-lg text-sm shadow-lg pointer-events-none font-bold">
            ⚠ 不正な手です — 盤面を元に戻しました
          </div>
        )}

        {/*
          中央列: h-full で画面高さにぴったり収まる。
          情報バー・駒台は flex-none、盤面エリアは flex-1。
          列幅 = min(画面幅, 画面高さ - バー/駒台の合計高さ) で横長PCも対応。
        */}
        <div
          className="h-full flex flex-col"
          style={{ width: 'min(100vw, calc(100vh - 200px))' }}
        >
          {/* ── 相手情報行: 左寄せ [名前→タイマー] 右端に投了 ── */}
          <div className="flex-none flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-800">
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <p className="font-bold text-sm leading-tight truncate">{oppName}</p>
                <p className="text-yellow-400 text-xs">{getGrade(oppInfo?.rating??1500)} R{oppInfo?.rating??1500}</p>
              </div>
              {renderClock(oppRole, oppActive)}
            </div>
            {!gameOver && (
              <button onClick={() => setShowResign(true)}
                className="flex-shrink-0 ml-2 px-4 py-1.5 bg-red-900/60 hover:bg-red-800 text-red-300
                           rounded-lg text-sm font-bold border border-red-800 transition-colors">
                投了
              </button>
            )}
          </div>

          {/* ── 相手駒台 ── */}
          <div className="flex-none">
            <HandRowHorizontal hands={gs.hands} player={oppColorNum} activePlayer={gs.currentPlayer}
              dropSelected={null} onDropSelect={()=>{}} editMode={false}
              align={flipped?'right':'left'} flipped={flipped} />
          </div>

          {/* ── 盤面: ResizeObserver で flex-1 の実寸を計測し正方形に収める ── */}
          <div ref={boardAreaRef} className="flex-1 min-h-0 overflow-hidden flex items-center justify-center">
            <div
              className="relative flex-shrink-0"
              style={{
                width:  boardPx || '90%',
                height: boardPx ? boardPx * 10 / 9 : undefined,
                aspectRatio: boardPx ? undefined : '9 / 10',
                containerType: 'inline-size',
              }}
            >
              <BoardCore board={gs.board} hands={gs.hands} selectedCell={selectedCell}
                highlightSet={highlightSet} lastMove={gs.lastMove} candidateArrows={[]}
                activePlayer={gs.currentPlayer} onCellClick={pendingMove ? undefined : handleCellClick}
                editMode={false} flipped={flipped} sideLayout={false} />
              {/* 成り選択オーバーレイ */}
              {pendingMove && !gameOver && (() => {
                const [toR, toC] = pendingMove.to;
                const visC = flipped ? 8 - toC : toC;
                const visR = flipped ? 8 - toR : toR;
                const leftPct = (visC / 9 + 1/18) * 100;
                const topPct  = (visR / 9) * 100;
                const base = pendingMove.pieceBase;
                return (
                  <div
                    className="absolute z-20 flex gap-2 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  >
                    <button onClick={() => { doMove({...pendingMove, promote:true}); setPendingMove(null); }}
                      className="flex flex-col items-center justify-center rounded shadow-xl active:scale-95 transition-transform"
                      style={{ width:52,height:52,background:'#FFF9C4',border:'2.5px solid #DC2626',boxShadow:'0 4px 12px rgba(0,0,0,0.6)' }}>
                      <span className="font-black leading-none text-red-600" style={{fontSize:28}}>{PIECE_KANJI['+'+base]??'+'}</span>
                      <span className="text-[9px] text-red-500 font-bold">成</span>
                    </button>
                    <button onClick={() => { doMove({...pendingMove, promote:false}); setPendingMove(null); }}
                      className="flex flex-col items-center justify-center rounded shadow-xl active:scale-95 transition-transform"
                      style={{ width:52,height:52,background:'#FFF9C4',border:'2.5px solid #374151',boxShadow:'0 4px 12px rgba(0,0,0,0.6)' }}>
                      <span className="font-black leading-none text-gray-900" style={{fontSize:28}}>{PIECE_KANJI[base]??base}</span>
                      <span className="text-[9px] text-gray-500 font-bold">不成</span>
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── 自分駒台 ── */}
          <div className="flex-none">
            <HandRowHorizontal hands={gs.hands} player={myColorNum} activePlayer={gs.currentPlayer}
              dropSelected={dropSelected} onDropSelect={handleDropSelect} editMode={false}
              align={flipped?'left':'right'} flipped={flipped} />
          </div>

          {/* ── 自分情報行: 右寄せ [タイマー→名前] 左端に手番表示 ── */}
          <div className="flex-none flex items-center justify-between px-3 py-2 bg-gray-900 border-t border-gray-800">
            <div className="text-xs text-gray-500 flex-shrink-0">
              {!gameOver && (myActive ? '▶ あなたの番' : '待機中…')}
            </div>
            <div className="flex items-center gap-3 min-w-0">
              {renderClock(myRole, myActive)}
              <div className="min-w-0 text-right">
                <p className="font-bold text-sm leading-tight truncate">{myName}</p>
                <p className="text-yellow-400 text-xs">{getGrade(myRating)} R{myRating}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  観戦画面 — 全画面縦伸び
  // ══════════════════════════════════════════════════════════
  if (view === 'spectating') {
    const senteActive = gsSpec.currentPlayer === 1 && !spectateOver;
    const goteActive  = gsSpec.currentPlayer === 2 && !spectateOver;
    const senteName   = spectateGame?.sente?.displayName || spectateGame?.sente?.email?.split('@')[0] || '先手';
    const goteName    = spectateGame?.gote?.displayName  || spectateGame?.gote?.email?.split('@')[0]  || '後手';
    const senteRating = spectateGame?.sente?.rating ?? 1500;
    const goteRating  = spectateGame?.gote?.rating  ?? 1500;

    return (
      <div className="h-screen bg-gray-950 text-gray-100 flex justify-center overflow-hidden">
        {spectateOver && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
            <div className="bg-gray-900 border border-gray-600 rounded-2xl p-8 text-center space-y-4 shadow-2xl max-w-sm w-full mx-4">
              <p className="text-2xl font-black text-white">対局終了</p>
              <p className="text-lg font-bold text-yellow-400">
                {spectateOver.winner === 'draw' ? '引き分け' :
                 spectateOver.winner === 'sente' ? `▲ ${senteName} の勝ち` : `△ ${goteName} の勝ち`}
              </p>
              <p className="text-gray-400 text-sm">{REASON_LABEL[spectateOver.reason] ?? spectateOver.reason}</p>
              <button onClick={handleLeaveSpectate}
                className="mt-2 px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold w-full">
                ロビーに戻る
              </button>
            </div>
          </div>
        )}

        <div className="h-full flex flex-col" style={{ width: 'min(100vw, calc(100vh - 200px))' }}>
          {/* 後手（上側） */}
          <div className="flex-none flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-800">
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <p className="font-bold text-sm leading-tight truncate">△ {goteName}</p>
                <p className="text-yellow-400 text-xs">{getGrade(goteRating)} R{goteRating}</p>
              </div>
              {renderClockSpec('gote', goteActive)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-purple-400 border border-purple-600 px-2 py-0.5 rounded">観戦中</span>
              <button onClick={handleLeaveSpectate}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-bold border border-gray-600">
                退出
              </button>
            </div>
          </div>

          <div className="flex-none">
            <HandRowHorizontal hands={gsSpec.hands} player={2} activePlayer={gsSpec.currentPlayer}
              dropSelected={null} onDropSelect={() => {}} editMode={false}
              align="left" flipped={false} />
          </div>

          <div ref={boardAreaRef} className="flex-1 min-h-0 overflow-hidden flex items-center justify-center">
            <div
              className="relative flex-shrink-0"
              style={{
                width:  boardPx || '90%',
                height: boardPx ? boardPx * 10 / 9 : undefined,
                aspectRatio: boardPx ? undefined : '9 / 10',
                containerType: 'inline-size',
              }}
            >
              <BoardCore board={gsSpec.board} hands={gsSpec.hands} selectedCell={null}
                highlightSet={new Set()} lastMove={gsSpec.lastMove} candidateArrows={[]}
                activePlayer={gsSpec.currentPlayer} onCellClick={undefined}
                editMode={false} flipped={false} sideLayout={false} />
            </div>
          </div>

          <div className="flex-none">
            <HandRowHorizontal hands={gsSpec.hands} player={1} activePlayer={gsSpec.currentPlayer}
              dropSelected={null} onDropSelect={() => {}} editMode={false}
              align="right" flipped={false} />
          </div>

          {/* 先手（下側） */}
          <div className="flex-none flex items-center justify-between px-3 py-2 bg-gray-900 border-t border-gray-800">
            <div className="text-xs text-gray-500">
              {!spectateOver && (senteActive ? '▶ 先手の番' : '▶ 後手の番')}
              {spectateOver && '対局終了'}
            </div>
            <div className="flex items-center gap-3 min-w-0">
              {renderClockSpec('sente', senteActive)}
              <div className="min-w-0 text-right">
                <p className="font-bold text-sm leading-tight truncate">▲ {senteName}</p>
                <p className="text-yellow-400 text-xs">{getGrade(senteRating)} R{senteRating}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  ロビー画面
  // ══════════════════════════════════════════════════════════
  const activePreset = quickMatchKey ? QUICK_MATCH.find(p => p.key === quickMatchKey) : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <TsumeNav />
      {/* 待ち受け登録モーダル */}
      {showWaitModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="font-bold text-lg text-white">待ち受け設定</h3>
            <div>
              <div className="text-xs text-gray-400 mb-2">持ち時間</div>
              <div className="grid grid-cols-4 gap-1">
                {TIME_OPTIONS.map(({label,val}) => (
                  <button key={val} onClick={() => setWaitSettings(s=>({...s,timeControl:val}))}
                    className={`py-1.5 rounded text-sm ${waitSettings.timeControl===val?'bg-blue-600 text-white':'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-2">秒読み</div>
              <div className="grid grid-cols-4 gap-1">
                {BYO_OPTIONS.map(({label,val}) => (
                  <button key={val} onClick={() => setWaitSettings(s=>({...s,byoyomi:val>0?1:0,byoyomiSeconds:val}))}
                    className={`py-1.5 rounded text-sm ${waitSettings.byoyomiSeconds===val&&(val===0?!waitSettings.byoyomi:true)?'bg-blue-600 text-white':'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={handleJoinWait}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold">
                登録する
              </button>
              <button onClick={() => setShowWaitModal(false)}
                className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg">
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ヘッダー */}
      <div className="lg:pl-64 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <h1 className="font-bold text-lg flex-1">オンライン対局</h1>
        <div className="text-xs text-gray-500">待機: {waitList.length}人</div>
        <AccountMenu email={userEmail} userId={userId} isAdmin={isAdmin} onLogout={handleLogout} />
      </div>

      <div className="lg:pl-64 pb-20 lg:pb-6">
        <div className="max-w-7xl mx-auto p-4 lg:p-6 lg:flex lg:gap-8 lg:items-start">

        {/* 左: 自分のR */}
        <div className="lg:w-56 lg:shrink-0 space-y-4 mb-4 lg:mb-0">
          <div className="bg-gray-900 rounded-xl border border-gray-700 p-5 text-center">
            <div className="text-gray-400 text-xs mb-1">あなたのレーティング</div>
            <div className="text-4xl font-black text-white">{myRating}</div>
            <div className="text-yellow-400 font-bold text-lg mt-1">{getGrade(myRating)}</div>
            <div className="text-gray-500 text-xs mt-2">{myGames}局</div>
          </div>

          {/* 待ち受け登録ボタン */}
          {!inWaitList ? (
            <button onClick={() => setShowWaitModal(true)}
              className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200 font-medium rounded-xl text-sm">
              待ち受け登録
            </button>
          ) : (
            <div className="bg-gray-900 rounded-xl border border-green-700 p-3 text-center space-y-1.5">
              <p className="text-green-400 font-bold text-sm">待ち受け中…</p>
              <button onClick={handleLeaveWait}
                className="w-full py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs">
                取り消す
              </button>
            </div>
          )}
        </div>

        {/* 右: タブ */}
        <div className="flex-1 min-w-0">
          <div className="flex border-b border-gray-800 mb-5 overflow-x-auto">
            {[['quick','クイックマッチ'],['wait','待ち受け一覧'],['friends','友達'],['watch','観戦'],['rank','ランキング'],['history','対局履歴']].map(([t,l])=>(
              <button key={t} onClick={() => setLobbyTab(t)}
                className={`px-4 lg:px-6 py-3 text-sm lg:text-base font-medium border-b-2 whitespace-nowrap transition-colors
                  ${lobbyTab===t?'border-blue-500 text-white':'border-transparent text-gray-500 hover:text-gray-300'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* クイックマッチ */}
          {lobbyTab==='quick' && (
            <div className="space-y-3">
              <p className="text-gray-500 text-xs">棋力の近い相手と自動でマッチングします</p>

              {/* マッチング待ち中 */}
              {activePreset && (
                <div className="bg-blue-950 border border-blue-700 rounded-xl p-4 text-center space-y-3">
                  <div className="flex justify-center">
                    <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>
                  </div>
                  <p className="text-blue-300 font-bold">
                    {activePreset.label}将棋 — 相手を探しています…
                  </p>
                  <button onClick={handleQuickCancel}
                    className="px-6 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">
                    キャンセル
                  </button>
                </div>
              )}

              {/* プリセットボタン */}
              {!activePreset && (
                <div className="grid grid-cols-3 gap-4 lg:gap-6">
                  {QUICK_MATCH.map((preset) => (
                    <button key={preset.key} onClick={() => handleQuickMatch(preset)}
                      className="flex flex-col items-center justify-center py-8 lg:py-14 rounded-2xl
                                 bg-gradient-to-b from-blue-900/60 to-blue-950 border border-blue-700/60
                                 hover:from-blue-800/80 hover:border-blue-500 transition-all group">
                      <span className="text-3xl lg:text-5xl font-black text-white group-hover:text-blue-200">
                        {preset.label}
                      </span>
                      <span className="text-xs lg:text-sm text-blue-400 mt-1.5">将棋</span>
                      {preset.desc && (
                        <span className="text-xs text-gray-500 mt-0.5">{preset.desc}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 待ち受け一覧 */}
          {lobbyTab==='wait' && (
            <div>
              {waitList.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">待ち受け中のプレイヤーはいません</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs border-b border-gray-800">
                      <th className="text-left pb-2 pl-2">プレイヤー</th>
                      <th className="pb-2">段級</th>
                      <th className="pb-2">持ち時間</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {waitList.map((w) => {
                      const isMe = w.userId === userId;
                      const tLabel = TIME_OPTIONS.find(t=>t.val===w.timeControl)?.label ?? `${w.timeControl}秒`;
                      const byLabel = w.byoyomi ? `+${w.byoyomiSeconds}秒` : '';
                      return (
                        <tr key={w.id} className={`border-b border-gray-800/50 ${isMe?'bg-blue-900/20':''}`}>
                          <td className="py-2.5 pl-2">
                            <Link to={`/profile/${w.userId}`} className="text-gray-200 hover:text-white">
                              {w.displayName || w.email?.split('@')[0]}
                            </Link>
                          </td>
                          <td className="text-center text-yellow-400 text-xs">
                            {getGrade(w.rating)} R{w.rating}
                          </td>
                          <td className="text-center text-gray-400 text-xs">
                            {tLabel}{byLabel}
                          </td>
                          <td className="text-center pr-2">
                            {isMe ? (
                              <span className="text-green-500 text-xs">待ち受け中</span>
                            ) : (
                              <button onClick={() => handleChallenge(w.userId)}
                                className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-bold">
                                挑戦
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* 友達 */}
          {lobbyTab==='friends' && (
            <div className="space-y-5">
              {/* ユーザー検索 */}
              <div>
                <div className="text-xs text-gray-400 mb-2 font-medium">ユーザーを検索</div>
                <div className="relative mb-3">
                  <input
                    type="text"
                    placeholder="表示名で検索..."
                    value={friendSearch}
                    onChange={e => { setFriendSearch(e.target.value); searchUsers(e.target.value); }}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                  />
                  {friendSearching && <div className="absolute right-3 top-2.5 w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>}
                </div>
                {friendResults.length > 0 && (
                  <div className="space-y-2">
                    {friendResults.map(u => (
                      <div key={u.userId} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ backgroundColor: u.avatarColor }}>
                          {(u.displayName||'?')[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-100 truncate">{u.displayName}</div>
                          <div className="text-xs text-gray-400">R{u.rating}</div>
                        </div>
                        {u.friendStatus === 'none' && (
                          <button onClick={() => sendFriendRequest(u.userId)} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white font-bold transition-colors flex-shrink-0">申請</button>
                        )}
                        {u.friendStatus === 'pending_sent' && <span className="text-xs text-gray-400 flex-shrink-0">申請中</span>}
                        {u.friendStatus === 'pending_received' && (
                          <button onClick={() => respondFriendRequest(u.userId, 'accept')} className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded-lg text-xs text-white font-bold transition-colors flex-shrink-0">承認</button>
                        )}
                        {u.friendStatus === 'friends' && <span className="text-xs text-green-400 flex-shrink-0">友達</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 受信した申請 */}
              {pendingReceived.length > 0 && (
                <div>
                  <div className="text-xs text-yellow-400 mb-2 font-medium">友達リクエスト ({pendingReceived.length})</div>
                  <div className="space-y-2">
                    {pendingReceived.map(u => (
                      <div key={u.userId} className="flex items-center gap-3 bg-gray-800/60 border border-yellow-600/30 rounded-lg px-3 py-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ backgroundColor: u.avatarColor }}>
                          {(u.displayName||'?')[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-100 truncate">{u.displayName}</div>
                          <div className="text-xs text-gray-400">R{u.rating}</div>
                        </div>
                        <button onClick={() => respondFriendRequest(u.userId, 'accept')} className="px-2 py-1 bg-green-600 hover:bg-green-500 rounded-lg text-xs text-white font-bold transition-colors flex-shrink-0">承認</button>
                        <button onClick={() => respondFriendRequest(u.userId, 'reject')} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-300 transition-colors flex-shrink-0">拒否</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 友達一覧 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-400 font-medium">友達 ({friends.length})</div>
                  <button onClick={fetchFriends} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">更新</button>
                </div>
                {friendsLoading && <div className="text-xs text-gray-500 text-center py-4">読み込み中...</div>}
                {!friendsLoading && friends.length === 0 && (
                  <div className="text-sm text-gray-500 text-center py-6">まだ友達がいません<br/><span className="text-xs">上の検索で友達を追加しましょう</span></div>
                )}
                <div className="space-y-2">
                  {friends.map(u => (
                    <div key={u.userId} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                      <div className="relative flex-shrink-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: u.avatarColor }}>
                          {(u.displayName||'?')[0]}
                        </div>
                        <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-gray-800 ${u.online ? 'bg-green-400' : 'bg-gray-600'}`}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-100 truncate">{u.displayName}</div>
                        <div className="text-xs text-gray-400">R{u.rating} · {u.online ? <span className="text-green-400">オンライン</span> : 'オフライン'}</div>
                      </div>
                      {u.online && view !== 'game' && (
                        <button
                          onClick={() => { setInviteTarget(u); setShowInviteDialog(true); }}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white font-bold transition-colors flex-shrink-0"
                        >
                          対局
                        </button>
                      )}
                      <button onClick={() => removeFriend(u.userId, u.displayName)} className="p-1 text-gray-600 hover:text-red-400 transition-colors flex-shrink-0" title="友達を削除">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                </div>

                {/* 送信済み申請 */}
                {pendingSent.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-gray-500 mb-2">申請中 ({pendingSent.length})</div>
                    {pendingSent.map(u => (
                      <div key={u.userId} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: u.avatarColor }}>
                          {(u.displayName||'?')[0]}
                        </div>
                        <span className="text-gray-400 flex-1 truncate">{u.displayName}</span>
                        <span className="text-xs text-gray-600">承認待ち</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 観戦 */}
          {lobbyTab==='watch' && (
            <div>
              {activeGamesList.length === 0 ? (
                <p className="text-gray-600 text-sm text-center py-8">現在対局中のゲームはありません</p>
              ) : (
                <div className="space-y-2">
                  {activeGamesList.map((g) => {
                    const tLabel = TIME_OPTIONS.find(t => t.val === g.timeControl)?.label ?? `${g.timeControl}秒`;
                    const byLabel = g.byoyomi ? `+${g.byoyomiSeconds}秒` : '';
                    const sName = g.sente?.displayName || g.sente?.email?.split('@')[0] || '先手';
                    const gName = g.gote?.displayName  || g.gote?.email?.split('@')[0]  || '後手';
                    return (
                      <div key={g.id} className="flex items-center gap-3 bg-gray-800/60 rounded-xl px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm flex-wrap">
                            <span className="text-gray-200 truncate">▲ {sName}</span>
                            <span className="text-gray-600">vs</span>
                            <span className="text-gray-200 truncate">△ {gName}</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {tLabel}{byLabel} · {g.moveCount}手目
                          </div>
                        </div>
                        <button onClick={() => handleSpectate(g.id)}
                          className="flex-shrink-0 px-4 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded-lg text-sm font-bold transition-colors">
                          観戦
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ランキング */}
          {lobbyTab==='rank' && (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {leaderboard.length===0 ? (
                <p className="text-gray-600 text-sm text-center py-8">まだ対局記録がありません</p>
              ) : leaderboard.map((u,i) => (
                <div key={u.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded text-sm
                    ${u.id===userId?'bg-blue-900/40 border border-blue-700':'bg-gray-800/40'}`}>
                  <span className={`w-5 text-center font-bold text-xs
                    ${i===0?'text-yellow-400':i===1?'text-gray-300':i===2?'text-amber-600':'text-gray-600'}`}>
                    {i+1}
                  </span>
                  <Link to={`/profile/${u.id}`} className="flex-1 text-gray-200 hover:text-white truncate">
                    {u.display_name || u.email?.split('@')[0]}
                  </Link>
                  <span className="text-yellow-400 text-xs">{getGrade(u.rating)}</span>
                  <span className="font-bold tabular-nums">R{u.rating}</span>
                  <span className="text-gray-600 text-xs">{u.rating_games}局</span>
                </div>
              ))}
            </div>
          )}

          {/* 対局履歴 */}
          {lobbyTab==='history' && (() => {
            const filtered = filterGames(history, userId, histResultFilter, histReasonFilter, histTimeFilter);
            return (
              <div className="space-y-3">
                <GameHistoryFilter
                  resultFilter={histResultFilter} setResultFilter={setHistResultFilter}
                  reasonFilter={histReasonFilter} setReasonFilter={setHistReasonFilter}
                  timeFilter={histTimeFilter}     setTimeFilter={setHistTimeFilter}
                  total={history.length} filtered={filtered.length}
                />
                {history.length === 0
                  ? <p className="text-gray-600 text-sm text-center py-8">対局履歴がありません</p>
                  : filtered.length === 0
                    ? <p className="text-gray-600 text-sm text-center py-8">条件に一致する対局がありません</p>
                    : filtered.map(g => (
                        <GameHistoryCard
                          key={g.id}
                          game={g}
                          perspectiveId={userId}
                          onReplay={() => setReplayGame(g)}
                          onAnalyze={() => navigateToAnalysis(g)}
                        />
                      ))
                }
              </div>
            );
          })()}
        </div>
        </div>
      </div>

      {replayGame && (
        <ReplayViewer
          game={replayGame}
          onClose={() => setReplayGame(null)}
          onAnalyze={() => { setReplayGame(null); navigateToAnalysis(replayGame); }}
        />
      )}

      {/* 友達対局招待ダイアログ */}
      {showInviteDialog && inviteTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowInviteDialog(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white mb-4">{inviteTarget.displayName}さんに対局を申し込む</h3>
            <div className="space-y-3 mb-5">
              <div>
                <div className="text-xs text-gray-400 mb-1.5">持ち時間</div>
                <div className="flex gap-2 flex-wrap">
                  {TIME_OPTIONS.map(o => (
                    <button key={o.val} onClick={() => setInviteConfig(c => ({ ...c, timeControl: o.val }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${inviteConfig.timeControl === o.val ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1.5">秒読み</div>
                <div className="flex gap-2 flex-wrap">
                  {BYO_OPTIONS.map(o => (
                    <button key={o.val} onClick={() => setInviteConfig(c => ({ ...c, byoyomi: o.val > 0 ? 1 : 0, byoyomiSeconds: o.val }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${inviteConfig.byoyomiSeconds === o.val ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={inviteConfig.rated} onChange={e => setInviteConfig(c => ({ ...c, rated: e.target.checked }))}
                  className="w-4 h-4 accent-blue-500"/>
                <span className="text-sm text-gray-300">レーティング対局にする</span>
              </label>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowInviteDialog(false)} className="flex-1 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors">キャンセル</button>
              <button onClick={sendGameInvite} className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors">申し込む</button>
            </div>
          </div>
        </div>
      )}

      {/* 招待送信中オーバーレイ */}
      {invitePending && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 text-center shadow-2xl">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
            <div className="text-white font-bold mb-1">対局の申し込みを送りました</div>
            <div className="text-gray-400 text-sm mb-5">相手の承認を待っています…</div>
            <button onClick={() => setInvitePending(false)} className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 text-sm transition-colors">キャンセル</button>
          </div>
        </div>
      )}

      {/* 友達からの対局招待ポップアップ */}
      {incomingInvite && view !== 'game' && (
        <div className="fixed bottom-4 left-0 right-0 flex justify-center z-50 px-4">
          <div className="bg-gray-800 border border-blue-500/60 rounded-xl p-4 max-w-sm w-full shadow-2xl">
            <div className="text-white font-bold mb-0.5">{incomingInvite.fromName}さんから対局の申し込み</div>
            <div className="text-gray-400 text-xs mb-3">
              持ち時間: {incomingInvite.config?.timeControl ? `${Math.floor(incomingInvite.config.timeControl/60)}分` : '—'}
              {incomingInvite.config?.byoyomiSeconds > 0 && ` / 秒読み: ${incomingInvite.config.byoyomiSeconds}秒`}
              {incomingInvite.config?.rated ? ' · レーティング対局' : ' · フリー対局'}
            </div>
            <div className="flex gap-2">
              <button onClick={rejectInvite} className="flex-1 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-bold transition-colors">断る</button>
              <button onClick={acceptInvite} className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors">受ける</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
