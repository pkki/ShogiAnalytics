import { useReducer, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { FilePlus, Download, FolderOpen, Clipboard, FlipHorizontal2, GitBranch, Cpu, BarChart2, X, Cloud, Trash2, Loader2, TrendingUp } from 'lucide-react';
import { io as socketIO } from 'socket.io-client';
import { createWebRTCSocket } from './webrtc/bridge';
import { Navigate } from 'react-router-dom';
import AgentPanel from './components/AgentPanel';
import PairingDialog from './components/PairingDialog';
import AccountMenu from './components/AccountMenu';
import Header from './components/Header';
import ShogiBoard, { BoardCore, HandColumnVertical } from './components/ShogiBoard';
import EvaluationMeter from './components/EvaluationMeter';
import NavigationPanel from './components/NavigationPanel';
import EvaluationGraph from './components/EvaluationGraph';
import CandidateMoves from './components/CandidateMoves';
import MoveTreePanel from './components/MoveTreePanel';
import PlayerInfo from './components/PlayerInfo';
import MoveList from './components/MoveList';
import PVBoard from './components/PVBoard';
import EngineSettingsDialog from './components/EngineSettingsDialog';
import AutoAnalysis from './components/AutoAnalysis';
import GameSetupDialog from './components/GameSetupDialog';
import {
  buildInitialTree, addUserMoveNode, buildTreeFromMoves,
  buildGameTree, createHandicapBoard,
  canPromote, isPromoted,
  getLegalMoveDestinations, getLegalDropDestinations,
  isInCheck, isCheckmate,
  findBranchPoint, getPathFromRoot,
  buildPVStates, buildPVStatesUSI,
  boardToSFEN, usiMoveToJapanese, parseUSIMove,
  getPieceChar,
} from './state/gameState';
import { parseKIF, looksLikeKIF, decodeKIFBuffer } from './parsers/kifParser';
import { GAME_INFO } from './data/mockData';
import './index.css';

// ── モバイル分割位置の下限（盤面が画面幅いっぱいになる点） ────────
// 盤幅 = min((dvh-split-250)×0.9+130px, vw-8px)
// 高さ由来値が vw-8 に達した時点を下限にする
function calcMinMobileSplit() {
  // visualViewport は iOS Safari でも URL バー表示に左右されない安定した値を返す
  const dvh = window.visualViewport?.height ?? window.innerHeight;
  const vw  = window.visualViewport?.width  ?? window.innerWidth;
  return Math.max(
    120,
    Math.ceil(dvh - (vw - 138) * 10 / 9 - 240)
  );
}
// 手番マークと移動元座標を付与するヘルパー関数
// ▼▼▼ 追加: 読み筋用のフォーマット関数 ▼▼▼
function formatUSIMove(japaneseText, usi, player) {
  const mark = player === 1 ? '▲' : '△';
  
  // 持ち駒を打つ手（例: "P*5e"）や不正な文字列の場合は座標をつけない
  if (!usi || usi.length < 4 || usi[1] === '*') {
    return `${mark}${japaneseText}`;
  }

  // USI文字列(例: "7g7f")から移動元の座標を抽出
  const fromX = usi[0];
  const fromY = usi.charCodeAt(1) - 96; // 'a'->1, 'b'->2 ... 'i'->9 に変換
  
  return `${mark}${japaneseText}(${fromX}${fromY})`;
}
// ▲▲▲
// ── クラウド保存ユーティリティ ────────────────────────────────
const CLOUD_API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';
function getGuestId() {
  let id = localStorage.getItem('shogi_guest_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('shogi_guest_id', id); }
  return id;
}

// ─────────────────────────────────────────────────────────
// ヘルパー: [r,c] → "r,c"
// ─────────────────────────────────────────────────────────
function toKey(rc) { return rc ? `${rc[0]},${rc[1]}` : null; }
function nodeLastMove(node) {
  if (!node) return null;
  const from = toKey(node.moveFrom);
  const to   = toKey(node.moveTo);
  if (!to) return null;
  return { from, to };
}

// ─────────────────────────────────────────────────────────
// 初期 state
// ─────────────────────────────────────────────────────────
function makeInitState() {
  const tree = buildInitialTree();
  return {
    ...tree,
    selectedCell: null,
    dropSelected: null,
    promoteDialog: null,
    lastMove: null,   // { from: "r,c"|null, to: "r,c" }
    showTree: false,
  };
}

function inPromotionZone(row, player) {
  return player === 1 ? row <= 2 : row >= 6;
}

// ─────────────────────────────────────────────────────────
// Reducer
// ─────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {

    case 'NAVIGATE_TO': {
      const target = state.nodes[action.nodeId];
      if (!target) return state;
      return {
        ...state,
        currentId: action.nodeId,
        selectedCell: null, dropSelected: null, promoteDialog: null,
        lastMove: nodeLastMove(target),
      };
    }

    case 'CELL_CLICK': {
      const { row, col } = action;
      const node = state.nodes[state.currentId];
      const board = node.board;
      const hands = node.hands;
      const player = node.moveNumber % 2 === 0 ? 1 : 2;
      const cell = board[row]?.[col];
      // 子ノードがなくメインライン上 → 分岐ではなくメインライン延伸
      const isMainLineLeaf = node.children.length === 0 && state.mainLineIds.includes(state.currentId);

      if (state.dropSelected) {
        if (state.dropSelected.player !== player || cell) return { ...state, dropSelected: null };
        const legalDrops = getLegalDropDestinations(board, hands, state.dropSelected.type, player);
        if (!legalDrops.some(([r, c]) => r === row && c === col)) return { ...state, dropSelected: null };
        const updated = addUserMoveNode(state, null, [row, col], false, state.dropSelected.type);
        const base = {
          ...state,
          nodes: updated.nodes, currentId: updated.currentId,
          dropSelected: null,
          lastMove: { from: null, to: `${row},${col}` },
        };
        return (action.inGame || isMainLineLeaf) ? { ...base, mainLineIds: [...state.mainLineIds, updated.currentId] } : base;
      }

      if (state.selectedCell) {
        const { row: fr, col: fc } = state.selectedCell;
        if (fr === row && fc === col) return { ...state, selectedCell: null };
        if (cell?.player === player) return { ...state, selectedCell: { row, col } };

        const fromPiece = board[fr]?.[fc];
        if (!fromPiece || fromPiece.player !== player) return { ...state, selectedCell: null };

        const validDests = getLegalMoveDestinations(board, hands, fr, fc);
        const isValid = validDests.some(([r, c]) => r === row && c === col);
        if (!isValid) return { ...state, selectedCell: cell?.player === player ? { row, col } : null };

        const promotable =
          canPromote(fromPiece.type) && !isPromoted(fromPiece.type) &&
          (inPromotionZone(row, player) || inPromotionZone(fr, player));

        if (promotable) return { ...state, promoteDialog: { piece: fromPiece, from: [fr, fc], to: [row, col] }, selectedCell: null };

        const updated = addUserMoveNode(state, [fr, fc], [row, col], false);
        const base = {
          ...state,
          nodes: updated.nodes, currentId: updated.currentId,
          selectedCell: null,
          lastMove: { from: `${fr},${fc}`, to: `${row},${col}` },
        };
        return (action.inGame || isMainLineLeaf) ? { ...base, mainLineIds: [...state.mainLineIds, updated.currentId] } : base;
      }

      if (cell?.player === player) return { ...state, selectedCell: { row, col } };
      return state;
    }

    case 'SELECT_DROP': {
      const node = state.nodes[state.currentId];
      const player = node.moveNumber % 2 === 0 ? 1 : 2;
      if (action.piece.player !== player) return state;
      const isSame = state.dropSelected?.type === action.piece.type && state.dropSelected?.player === action.piece.player;
      return { ...state, dropSelected: isSame ? null : action.piece, selectedCell: null };
    }

    case 'RESOLVE_PROMOTE': {
      if (!state.promoteDialog) return state;
      const { from, to } = state.promoteDialog;
      const parentNode = state.nodes[state.currentId];
      const isMainLineLeaf = parentNode.children.length === 0 && state.mainLineIds.includes(state.currentId);
      const updated = addUserMoveNode(state, from, to, action.promote);
      const base = {
        ...state,
        nodes: updated.nodes, currentId: updated.currentId,
        promoteDialog: null,
        lastMove: { from: `${from[0]},${from[1]}`, to: `${to[0]},${to[1]}` },
      };
      return (action.inGame || isMainLineLeaf) ? { ...base, mainLineIds: [...state.mainLineIds, updated.currentId] } : base;
    }

    case 'UPDATE_EVAL': {
      const node = state.nodes[action.nodeId];
      if (!node) return state;
      const updates = { evalScore: action.evalScore };
      if (action.candidates != null) updates.savedCandidates = action.candidates;
      return {
        ...state,
        nodes: { ...state.nodes, [action.nodeId]: { ...node, ...updates } },
      };
    }

    case 'SAVE_CANDIDATES': {
      const node = state.nodes[action.nodeId];
      if (!node) return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.nodeId]: { ...node, savedCandidates: action.candidates } },
      };
    }

    case 'APPLY_AI_MOVE': {
      const { from, to, promote, isDrop, piece } = action.move;
      const updated = addUserMoveNode(
        state,
        isDrop ? null : from,
        to,
        promote ?? false,
        isDrop ? piece : undefined,
      );
      return {
        ...state,
        nodes: updated.nodes,
        currentId: updated.currentId,
        mainLineIds: [...state.mainLineIds, updated.currentId],
        selectedCell: null, dropSelected: null,
        lastMove: { from: isDrop ? null : `${from[0]},${from[1]}`, to: `${to[0]},${to[1]}` },
      };
    }

    case 'TOGGLE_TREE': return { ...state, showTree: !state.showTree };

    case 'LOAD_KIF': {
      const { nodes, rootId, mainLineIds, currentId } = action.tree;
      return { nodes, rootId, mainLineIds, currentId, selectedCell: null, dropSelected: null, promoteDialog: null, lastMove: null, showTree: false };
    }

    default: return state;
  }
}

// ─────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// KIF テキストを処理してゲーム状態を更新する
// ─────────────────────────────────────────────────────────
async function readFileText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(decodeKIFBuffer(e.target.result));
    reader.readAsArrayBuffer(file);
  });
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null, makeInitState);
  const [pvCandidate, setPvCandidate] = useState(null);
  const [gameInfo, setGameInfo] = useState(GAME_INFO);
  const [kifError, setKifError] = useState(null);

  // ── エンジン状態 ──────────────────────────────────────────
  const [engineStatus, setEngineStatus]   = useState('connecting');
  const [engineMessage, setEngineMessage] = useState('');
  const [candidates, setCandidates]       = useState([]);
  const [maxDepth, setMaxDepth]           = useState(0);
  const [engineOptions, setEngineOptions] = useState([]);
  const [showSettings, setShowSettings]   = useState(false);
  const [isAnalyzing, setIsAnalyzing]     = useState(false);
  const [multiPV, setMultiPV]                 = useState(5);
  const [autoAnalysisStatus, setAutoAnalysisStatus] = useState('idle');   // 'idle'|'running'|'complete'
  const [autoAnalysisProgress, setAutoAnalysisProgress] = useState(null); // { current, total, depth? }
  // ── AI 対局 ──────────────────────────────────────────────
  const [gameMode, setGameMode]           = useState(null);   // null | 'playing' | 'ended'
  const [gameConfig, setGameConfig]       = useState(null);
  const [gameTimes, setGameTimes]         = useState({ 1: 0, 2: 0 });
  const [inByoyomi, setInByoyomi]         = useState({ 1: false, 2: false });
  const [isAiThinking, setIsAiThinking]   = useState(false);
  const [showGameSetup, setShowGameSetup] = useState(false);
  const [gameResult, setGameResult]       = useState(null);   // null | { winner: 1|2, reason: string }
  const [kifTermination, setKifTermination] = useState(null); // null | { label: string, moveNumber: number, winner: 1|2 }
  const [flipped, setFlipped]             = useState(false);

  // ── 解析パネル表示状態 ──
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);

  // ── クラウド保存パネル ──
  const [showCloudPanel, setShowCloudPanel]   = useState(false);
  const [cloudKifs, setCloudKifs]             = useState(null); // null=未読込
  const [cloudSaving, setCloudSaving]         = useState(false);
  const [openFlyout, setOpenFlyout]           = useState(null); // null | 'file' | 'mobile-file'
  const [openSaveMenu, setOpenSaveMenu]       = useState(null); // null | 'desktop' | 'mobile'

  // ── モバイルドロワー ──
  const [mobileMenuOpen, setMobileMenuOpen]   = useState(false);

  // ── パネルサイズ (ドラッグリサイズ + localStorage 永続化) ──
  const [panelSizes, setPanelSizes] = useState(() => {
    let sizes = { boardPx: 440, moveListPx: 300, candidatePx: 210, mobileSplitPx: 350 };
    try {
      const s = localStorage.getItem('shogi_panel_sizes_v1');
      if (s) sizes = { ...sizes, ...JSON.parse(s) };
    } catch { /* ignore */ }
    return { ...sizes, mobileSplitPx: Math.max(calcMinMobileSplit(), sizes.mobileSplitPx) };
  });
  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem('shogi_panel_sizes_v1', JSON.stringify(panelSizes));
    }, 400);
    return () => clearTimeout(t);
  }, [panelSizes]);

  // ── 盤面コンテナ高さ監視（dvh 依存を排除してコンテナサイズ基準にする） ──
  const boardColumnRef  = useRef(null);
  const [boardColumnH,  setBoardColumnH]  = useState(0);
  // デスクトップ: 盤面以外の要素（対局者名・navArea）の実高さを計測して盤サイズを最大化
  const boardPlayerRef  = useRef(null);
  const [boardPlayerH,  setBoardPlayerH]  = useState(0);
  const boardNavAreaRef = useRef(null);
  const [boardNavAreaH, setBoardNavAreaH] = useState(0);
  const mobileTopRef    = useRef(null);
  const [mobileTopH,    setMobileTopH]  = useState(0);
  // mobileTopW: vw 依存を完全に排除するためコンテナの実幅も追跡する
  // (iPadOS Safari では 100vw がスクロールバー幅や URL バー変動の影響を受けレイアウト崩壊の原因となる)
  const [mobileTopW,    setMobileTopW]  = useState(0);

  useEffect(() => {
    const el = boardColumnRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setBoardColumnH(entry.contentRect.height));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = boardPlayerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setBoardPlayerH(entry.contentRect.height));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = boardNavAreaRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setBoardNavAreaH(entry.contentRect.height));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = mobileTopRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setMobileTopH(entry.contentRect.height);
      setMobileTopW(entry.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // クラウドパネルが開いたら一覧を取得
  useEffect(() => {
    if (showCloudPanel) loadCloudKifs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCloudPanel]);

  // フライアウトを外側クリックで閉じる
  useEffect(() => {
    if (!openFlyout) return;
    const handler = (e) => {
      if (
        !flyoutRef.current?.contains(e.target) &&
        !mobileFlyoutRef.current?.contains(e.target)
      ) setOpenFlyout(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openFlyout]);

  // 保存メニューを外側クリックで閉じる
  useEffect(() => {
    if (!openSaveMenu) return;
    const handler = (e) => {
      if (
        !saveMenuRef.current?.contains(e.target) &&
        !mobileSaveMenuRef.current?.contains(e.target)
      ) setOpenSaveMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openSaveMenu]);

  // WebRTC モード時の認証トークン。非WebRTCモードは固定値で認証スキップ
  const [authToken, setAuthToken] = useState(() => {
    if (import.meta.env.VITE_USE_WEBRTC !== 'true') return '__local__';
    return localStorage.getItem('shogi_jwt') || '';
  });
  // エージェント接続状態 (マルチエージェント対応)
  const [connectedAgents, setConnectedAgents]   = useState([]);  // シグナリング接続中エージェント一覧
  const [selectedAgentId, setSelectedAgentId]   = useState(null); // WebRTC 確立対象エージェント
  const selectedAgentIdRef = useRef(null);
  const isAgentConnected   = !!selectedAgentId;  // 派生値
  const selectedAgent      = connectedAgents.find((a) => a.agentId === selectedAgentId) || null;
  // ペアリングダイアログ (?pair= URL パラメーター)
  const [pairCode, setPairCode] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('pair');
    return p || '';
  });
  // エージェント未接続警告ダイアログ
  const [agentWarning, setAgentWarning] = useState(false);
  // デバイス切り替え確認ダイアログ (エージェント切り替え時)
  const [pendingAgentSwitch, setPendingAgentSwitch] = useState(null); // { agentId, agentName }
  // 別ブラウザがアクティブ (パッシブモード)
  const [anotherDeviceActive, setAnotherDeviceActive] = useState(false);
  const anotherDeviceActiveRef = useRef(false); // useCallback のスタールクロージャ対策
  // 引き継ぎ確認ダイアログ (アクション実行時に表示)
  const [showTakeoverDialog, setShowTakeoverDialog] = useState(false);
  // 引き継ぎ後に選択するエージェントID (切り替えボタン押下時にセット)
  const [pendingTakeoverAgentId, setPendingTakeoverAgentId] = useState(null);

  const socketRef          = useRef(null);
  const candMapRef         = useRef({});
  const candidatesRef      = useRef([]);   // 候補手保存時の stale closure 回避
  const currentIdRef       = useRef(null);
  const connectedAgentsRef = useRef([]);   // requireAgent stale closure 回避
  const analyzingPlayerRef = useRef(1);
  const analyzeSessionRef  = useRef(null); // 検討セッション追跡 {multiPV} — 変化時のみ再起動
  const prevIsAnalyzingRef = useRef(false);
  const mainLineIdsRef     = useRef([]);   // auto-analysis result で nodeId を解決
  const gameConfigRef      = useRef(null);
  const gameTimesRef       = useRef({ 1: 0, 2: 0 });
  const inByoyomiRef       = useRef({ 1: false, 2: false });
  const turnStartTimeRef   = useRef(null);
  const desktopFileRef     = useRef(null);
  const mobileFileRef      = useRef(null);
  const aiThinkStartRef    = useRef(null);
  const flyoutRef          = useRef(null);
  const mobileFlyoutRef    = useRef(null);
  const saveMenuRef        = useRef(null);
  const mobileSaveMenuRef  = useRef(null);
  const gameModeRef        = useRef(null);

  // ── KIF テキストをパースして読み込む ──
  const loadKifText = useCallback((text) => {
    setKifError(null);
    setKifTermination(null);
    const { moves, gameInfo: gi } = parseKIF(text);
    if (moves.length === 0) {
      setKifError('棋譜を解析できませんでした。KIF / KIFU / CSA 形式のファイルを確認してください。');
      return;
    }
    const tree = buildTreeFromMoves(moves);

    // KIF テキストから終局情報（投了・中断・詰みなど）を検出して保存
    // buildTreeFromMoves は盤面変化のない終局手をノード化しないため、
    // テキストから直接パースして kifTermination state に保持する
    const terminationMatch = text.match(/^\s*\d+\s*(投了|中断|詰み|千日手|持将棋)/m);
    const terminationLabel = terminationMatch?.[1] ?? null;
    if (terminationLabel) {
      const totalMoves = tree.mainLineIds.length - 1;
      // totalMoves 手終了後の手番プレイヤー（そのプレイヤーが投了/中断した側）
      const resigningPlayer = totalMoves % 2 === 0 ? 1 : 2;
      setKifTermination({
        label: terminationLabel,
        moveNumber: totalMoves + 1,
        winner: resigningPlayer === 1 ? 2 : 1,
      });
    }

    dispatch({ type: 'LOAD_KIF', tree });
    setGameInfo({
      sente: { name: gi.senteName || '先手', mark: '▲', time: '0:00:00' },
      gote:  { name: gi.goteName  || '後手', mark: '△', time: '0:00:00' },
    });
    // ** コメント行から読み込んだ候補手・評価値を復元
    // moves[i].preCandidates = 手i+1の直前局面 = mainLineIds[i] の候補手
    moves.forEach((mv, i) => {
      if (!mv.preCandidates?.length) return;
      const nodeId = tree.mainLineIds[i];
      if (!nodeId) return;
      // KIF から読んだスコアは既に先手絶対値なので isAbsolute フラグを付ける
      const absCands = mv.preCandidates.map(c => ({ ...c, isAbsolute: true }));
      dispatch({ type: 'SAVE_CANDIDATES', nodeId, candidates: absCands });
      const best = absCands.find(c => c.multipv === 1) ?? absCands[0];
      if (best != null) dispatch({ type: 'UPDATE_EVAL', nodeId, evalScore: best.score });
    });
    if (tree.parseError != null) {
      setKifError(`${tree.parseError}手目以降の棋譜を正しく読み込めませんでした（未対応の表記または不正な棋譜の可能性があります）。${tree.parseError - 1}手目までの局面は正常に読み込まれています。`);
    }
  }, []);

  // ── ファイルから読み込む ──
  const handleLoadFile = useCallback(async (file) => {
    const text = await readFileText(file);
    loadKifText(text);
  }, [loadKifText]);

  // ── クリップボードから貼り付け ──
  const handlePasteKif = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { setKifError('クリップボードが空です。'); return; }
      loadKifText(text);
    } catch {
      setKifError('クリップボードへのアクセスが拒否されました。ブラウザの権限設定を確認してください。');
    }
  }, [loadKifText]);

  // ── グローバル Ctrl+V / paste イベント ──
  useEffect(() => {
    const onPaste = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const text = e.clipboardData?.getData('text') ?? '';
      if (looksLikeKIF(text)) {
        e.preventDefault();
        loadKifText(text);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [loadKifText]);

  // ── Socket.io 接続 (または WebRTC DataChannel) ───────────
  useEffect(() => {
    if (!authToken) return; // WebRTC モード: 未ログイン時は接続しない

    let s;
    if (import.meta.env.VITE_USE_WEBRTC === 'true') {
      // WebRTC モード: シグナリング経由で local-agent と DataChannel を確立
      s = createWebRTCSocket(authToken);
    } else {
      // ローカル Socket.io モード (従来)
      // 開発時は Vite プロキシ経由で 3010 へ、本番ビルド時はサーバーと同一オリジン
      const socketUrl = import.meta.env.DEV ? 'http://127.0.0.1:3010' : window.location.origin;
      s = socketIO(socketUrl, { transports: ['websocket', 'polling'] });
    }
    socketRef.current = s;

    s.on('engine:status', ({ status, message }) => {
      setEngineStatus(status);
      if (message) setEngineMessage(message);
    });

    s.on('engine:info', (data) => {
      const idx = (data.multipv ?? 1) - 1;
      candMapRef.current[idx] = data;
      const arr = Object.values(candMapRef.current).sort((a, b) => a.multipv - b.multipv);
      candidatesRef.current = arr;

      // 対局中 + 非表示設定の場合は候補手・評価値を表示・記録しない
      const isGamePlaying = gameModeRef.current === 'playing';
      const shouldHide    = isGamePlaying && gameConfigRef.current?.hideInfo;

      if (!shouldHide) {
        setCandidates(arr);
        setMaxDepth(prev => data.depth > prev ? data.depth : prev);
        // 評価値を現局面ノードに記録（先手視点に正規化）
        //if ((data.multipv ?? 1) === 1 && currentIdRef.current) {
        //  const player = analyzingPlayerRef.current;
        //  const evalScore = player === 1 ? data.score : -data.score;
        //  dispatch({ type: 'UPDATE_EVAL', nodeId: currentIdRef.current, evalScore });
        //}
      }
    });

    s.on('engine:options', (opts) => setEngineOptions(opts));

    s.on('connect_error', () => {
      setEngineStatus('error');
      setAutoAnalysisStatus('idle');
      setAutoAnalysisProgress(null);
      setIsAnalyzing(false);
      setIsAiThinking(false);
    });

    // JWT 期限切れ: ログイン画面に戻す
    s.on('auth_error', () => {
      localStorage.removeItem('shogi_jwt');
      setAuthToken('');
    });

    // 同一アカウントで別ブラウザが接続中 — パッシブモードへ (ダイアログは表示しない)
    let passiveTimeoutId = null;
    s.on('another_device_active', () => {
      s.emit('stop_and_standby');
      anotherDeviceActiveRef.current = true;
      setAnotherDeviceActive(true);
      // selectedAgentId は null のまま (WebRTC 未確立) なのでエンジン状態もリセット
      selectedAgentIdRef.current = null;
      setSelectedAgentId(null);
      setEngineOptions([]);
      setCandidates([]);
      setEngineStatus('standby');
      setAutoAnalysisStatus('idle');
      setAutoAnalysisProgress(null);
      setIsAnalyzing(false);
      setIsAiThinking(false);

      // サーバーが promoted を送ってこない場合のフォールバック:
      // 20秒後もパッシブのままなら自動リセット（旧セッションのタイムアウト等で stuck になる対策）
      clearTimeout(passiveTimeoutId);
      passiveTimeoutId = setTimeout(() => {
        if (anotherDeviceActiveRef.current) {
          console.warn('[App] passive timeout — auto-resetting anotherDeviceActive');
          anotherDeviceActiveRef.current = false;
          setAnotherDeviceActive(false);
        }
      }, 20000);
    });

    // 別デバイスに引き継がれた → パッシブモードへ (ダイアログは出さない)
    // connectedAgents は消さない — 再接続後に agent:connected で復元されるまで表示を維持
    s.on('taken_over', () => {
      s.emit('stop_and_standby');
      anotherDeviceActiveRef.current = true;
      setAnotherDeviceActive(true);
      selectedAgentIdRef.current = null;
      setSelectedAgentId(null);
      setEngineOptions([]);
      setCandidates([]);
      setEngineStatus('standby');
      setAutoAnalysisStatus('idle');
      setAutoAnalysisProgress(null);
      setIsAnalyzing(false);
      setIsAiThinking(false);
    });

    // アクティブ frontend が切断しこのデバイスが自動昇格 → パッシブ解除
    s.on('device_activated', () => {
      clearTimeout(passiveTimeoutId);
      anotherDeviceActiveRef.current = false;
      setAnotherDeviceActive(false);
    });

    // エージェント接続状態 (マルチエージェント)
    s.on('agent:connected', (agentInfo) => {
      setConnectedAgents((prev) =>
        prev.some((a) => a.agentId === agentInfo.agentId) ? prev : [...prev, agentInfo]
      );
    });
    s.on('agent:selected', (agentInfo) => {
      // ブリッジが自動選択 (初回 or フォールバック) — エンジン状態をリセット
      selectedAgentIdRef.current = agentInfo.agentId;
      setSelectedAgentId(agentInfo.agentId);
      setEngineOptions([]);
      setCandidates([]);
      setEngineStatus('connecting');
      setAutoAnalysisStatus('idle');
      setAutoAnalysisProgress(null);
      setIsAnalyzing(false);
      setIsAiThinking(false);
    });
    s.on('agent:disconnected', ({ agentId }) => {
      setConnectedAgents((prev) => prev.filter((a) => a.agentId !== agentId));
      if (selectedAgentIdRef.current === agentId) {
        selectedAgentIdRef.current = null;
        setSelectedAgentId(null);
      }
    });
    s.on('agent:left', () => {
      selectedAgentIdRef.current = null;
      setSelectedAgentId(null);
      setEngineOptions([]);
      setCandidates([]);
      setEngineStatus('error');
      setAutoAnalysisStatus('idle');
      setAutoAnalysisProgress(null);
      setIsAnalyzing(false);
      setIsAiThinking(false);
    });

    // ── 自動解析イベント ──
    s.on('auto_analysis:started', () => {
      setAutoAnalysisStatus('running');
    });

    s.on('auto_analysis:progress', (data) => {
      setAutoAnalysisProgress({ current: data.current, total: data.total, depth: data.depth ?? 0 });
    });

    s.on('auto_analysis:result', ({ moveIndex, evalScore, candidates }) => {
      const nodeId = mainLineIdsRef.current[moveIndex];
      if (nodeId) {
        dispatch({ type: 'UPDATE_EVAL', nodeId, evalScore, candidates: candidates ?? null });
        // 解析中の手に自動移動
        dispatch({ type: 'NAVIGATE_TO', nodeId });
      }
    });

    s.on('auto_analysis:complete', ({ total }) => {
      setAutoAnalysisStatus('complete');
      setAutoAnalysisProgress(prev => ({ ...(prev ?? {}), current: total, total }));
      s.emit('restart_engine');
    });

    s.on('auto_analysis:stopped', () => {
      setAutoAnalysisStatus('idle');
      s.emit('restart_engine');
    });

    // ── AI 対局 ──
    s.on('ai:bestmove', ({ move }) => {
      aiThinkStartRef.current = null;
      setIsAiThinking(false);
      if (!move || move === '(none)' || move === 'resign') {
        // AI が投了 — 人間側の勝ち
        const aiPlayer = analyzingPlayerRef.current;
        const humanWinner = aiPlayer === 1 ? 2 : 1;
        setGameResult({ winner: humanWinner, reason: 'AI 投了' });
        setGameMode('ended');
        return;
      }
      const parsed = parseUSIMove(move);
      if (parsed) {
        dispatch({ type: 'APPLY_AI_MOVE', move: parsed });
      } else {
        setGameMode('ended');
      }
    });

    return () => {
      s.disconnect();
      selectedAgentIdRef.current = null;
      setConnectedAgents([]);
      setSelectedAgentId(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  // mainLineIds を ref に同期（自動解析のコールバックで使用）
  useEffect(() => { mainLineIdsRef.current = state.mainLineIds; }, [state.mainLineIds]);
  useEffect(() => { connectedAgentsRef.current = connectedAgents; }, [connectedAgents]);
  // ゲーム設定 / 残り時間を ref に同期（socket クロージャで参照）
  useEffect(() => { gameConfigRef.current  = gameConfig;  }, [gameConfig]);
  useEffect(() => { gameTimesRef.current   = gameTimes;   }, [gameTimes]);
  useEffect(() => { inByoyomiRef.current   = inByoyomi;   }, [inByoyomi]);
  useEffect(() => { gameModeRef.current    = gameMode;    }, [gameMode]);

  // 持ち時間更新ヘルパー（ref に保持してクロージャから呼べるようにする）
  const applyMoveTimeRef = useRef(null);
  applyMoveTimeRef.current = (player, elapsed) => {
    const pc = gameConfigRef.current?.players?.[player];
    if (!pc || pc.type !== 'human') return;  // CPU は時間管理不要
    const { timeFormat, timeParams: tp = {} } = pc;
    if (timeFormat === 'infinite') return;
    const times  = gameTimesRef.current;
    const ib     = inByoyomiRef.current;
    const remain = (times[player] ?? 0) - elapsed;

    if (timeFormat === 'byoyomi') {
      const nt = { ...times, [player]: tp.byoyomiMs ?? 30000 };
      gameTimesRef.current = nt; setGameTimes(nt);
    } else if (timeFormat === 'classical') {
      if (remain <= 0 || ib[player]) {
        const nt = { ...times, [player]: tp.byoyomiMs ?? 30000 };
        const ni = { ...ib, [player]: true };
        gameTimesRef.current = nt; inByoyomiRef.current = ni;
        setGameTimes(nt); setInByoyomi(ni);
      } else {
        const nt = { ...times, [player]: remain };
        gameTimesRef.current = nt; setGameTimes(nt);
      }
    } else if (timeFormat === 'fischer') {
      const nt = { ...times, [player]: Math.max(0, remain) + (tp.incMs ?? 0) };
      gameTimesRef.current = nt; setGameTimes(nt);
    }
  };

  // 対局中: 手が進んだら前の手番プレイヤーの持ち時間を更新し、ターン開始時刻をリセット
  useEffect(() => {
    if (gameMode !== 'playing') return;
    const mn = state.nodes[state.currentId]?.moveNumber ?? 0;
    if (mn === 0) { turnStartTimeRef.current = Date.now(); return; } // ゲーム開始
    const justMoved = mn % 2 === 1 ? 1 : 2;
    const elapsed = turnStartTimeRef.current ? Date.now() - turnStartTimeRef.current : 0;
    applyMoveTimeRef.current(justMoved, elapsed);
    turnStartTimeRef.current = Date.now();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentId, gameMode]);

  // タイマーティック（持ち時間リアルタイム表示用）
  const [tickMs, setTickMs] = useState(0);
  useEffect(() => {
    if (gameMode !== 'playing') return;
    const hasTimer = gameConfig?.players && Object.values(gameConfig.players).some(
      pc => pc.type === 'human' && ['byoyomi', 'classical', 'fischer'].includes(pc.timeFormat)
    );
    if (!hasTimer) return;
    const id = setInterval(() => setTickMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [gameMode, gameConfig]);

  // ── 詰み判定: 手番側が詰んでいたら対局終了 ────────────────
  useEffect(() => {
    if (gameMode !== 'playing') return;
    const node = state.nodes[state.currentId];
    if (!node || node.moveNumber === 0) return;
    if (isCheckmate(node.board, node.hands, activePlayer)) {
      const winner = activePlayer === 1 ? 2 : 1;
      setGameResult({ winner, reason: '詰み' });
      setGameMode('ended');
      socketRef.current?.emit('stop_ai_think');
      socketRef.current?.emit('restart_engine');
      setIsAiThinking(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentId, gameMode]);

  // ── AI 手番: AI の番になったら思考させる ──────────────────
  useEffect(() => {
    if (gameMode !== 'playing') return;
    const config = gameConfigRef.current;
    if (!config) return;
    const pc = config.players?.[activePlayer];
    if (!pc || pc.type !== 'cpu') return;  // 人間の手番
    const s = socketRef.current;
    if (!s) return;
    const node = state.nodes[state.currentId];
    if (!node) return;
    const sfen = boardToSFEN(node.board, node.hands, activePlayer, node.moveNumber);
    analyzingPlayerRef.current = activePlayer;  // engine:info の評価値正規化に使用
    setIsAiThinking(true);
    aiThinkStartRef.current = Date.now();
    s.emit('ai_think', {
      sfen,
      cpuConfig:      { thinkType: pc.thinkType, thinkParams: pc.thinkParams },
      remainingTimes: gameTimesRef.current,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentId, gameMode]);

  // ── 局面変更 → サーバーへ解析リクエスト ────────────────────
  // ── 局面変更 → サーバーへ解析リクエスト ────────────────────
  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;
    
    // 候補手が存在すれば前の局面に保存してからクリア
    const prevId = currentIdRef.current;
    if (prevId && candidatesRef.current.length > 0) {
      // ▼▼▼ 修正: 局面移動時・検討OFF時に1回だけ評価値と候補手を保存する ▼▼▼
      const best = candidatesRef.current.find(c => c.multipv === 1) || candidatesRef.current[0];
      const player = analyzingPlayerRef.current; // 解析していた手番
      const evalScore = player === 1 ? best.score : -best.score; // 常に先手視点に正規化
      
      // SAVE_CANDIDATESの代わりにUPDATE_EVALを使って、評価値と候補手を同時にツリーに保存します
      dispatch({ 
        type: 'UPDATE_EVAL', 
        nodeId: prevId, 
        evalScore: evalScore, 
        candidates: candidatesRef.current 
      });
      // ▲▲▲
    }
    
    currentIdRef.current = state.currentId;
    candMapRef.current = {};
    candidatesRef.current = [];
    setCandidates([]);
    setMaxDepth(0);
    
    if (gameMode === 'playing') return;     // 対局進行中は解析しない（ended は検討可）
    
    // ▼▼▼ 修正: 'complete' をブロック条件から外す ▼▼▼
    // 以前は `|| autoAnalysisStatus === 'complete'` があったため自動解析後に手動検討ができませんでした
    if (autoAnalysisStatus === 'running') return; 
    // ▲▲▲

    if (!isAnalyzing) {
      // 検討が ON→OFF に変わった場合はエンジンを再起動、単なるナビゲーションはソフト停止
      s.emit(prevIsAnalyzingRef.current ? 'restart_engine' : 'stop_and_standby');
      prevIsAnalyzingRef.current = false;
      analyzeSessionRef.current = null;
      return;
    }
    
    prevIsAnalyzingRef.current = true;
    const node = state.nodes[state.currentId];
    if (!node) return;
    const player = node.moveNumber % 2 === 0 ? 1 : 2;
    analyzingPlayerRef.current = player;
    const sfen = boardToSFEN(node.board, node.hands, player, node.moveNumber);
    
    // 検討開始時 or MultiPV変更時のみエンジンを再起動してリフレッシュ
    const prevSession = analyzeSessionRef.current;
    const isNewSession = !prevSession || prevSession.multiPV !== multiPV;
    analyzeSessionRef.current = { multiPV };
    s.emit(isNewSession ? 'start_analysis' : 'analyze', { sfen });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentId, isAnalyzing, autoAnalysisStatus, gameMode, multiPV]);

  const currentNode = state.nodes[state.currentId];
  const board  = currentNode?.board ?? [];
  const hands  = currentNode?.hands ?? { 1: {}, 2: {} };
  const moveNumber = currentNode?.moveNumber ?? 0;
  const activePlayer = moveNumber % 2 === 0 ? 1 : 2;
  const inCheck = board.length > 0 ? isInCheck(board, activePlayer) : false;

  // 持ち時間の表示フォーマット
  function fmtMs(ms) {
    if (ms == null || ms < 0) return '0:00';
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const needsTimer = gameMode && gameConfig?.players && Object.values(gameConfig.players).some(
    pc => pc.type === 'human' && ['byoyomi', 'classical', 'fischer'].includes(pc.timeFormat)
  );
  // tickMs は 0.5 秒ごとに更新して再描画を誘発、実際の経過時間は Date.now() で計算
  const displayTimes = (() => {
    if (!gameMode || !needsTimer) return { 1: '', 2: '' };
    void tickMs; // 再描画トリガー
    const elapsed = turnStartTimeRef.current ? Math.max(0, Date.now() - turnStartTimeRef.current) : 0;
    const result = { 1: '', 2: '' };
    for (const p of [1, 2]) {
      const pc = gameConfig?.players?.[p];
      if (!pc || pc.type !== 'human') continue;
      if (!['byoyomi', 'classical', 'fischer'].includes(pc.timeFormat)) continue;
      result[p] = fmtMs(activePlayer === p ? Math.max(0, gameTimes[p] - elapsed) : gameTimes[p]);
    }
    return result;
  })();

  // ── ハイライト ──
  const highlightSet = (() => {
    if (state.selectedCell) {
      const dests = getLegalMoveDestinations(board, hands, state.selectedCell.row, state.selectedCell.col);
      return new Set(dests.map(([r,c]) => `${r},${c}`));
    }
    if (state.dropSelected) {
      const dests = getLegalDropDestinations(board, hands, state.dropSelected.type, state.dropSelected.player);
      return new Set(dests.map(([r,c]) => `${r},${c}`));
    }
    return new Set();
  })();

  // ── メインラインインデックス / 分岐点 ──
  const mainLineIdx = state.mainLineIds.indexOf(state.currentId);
  const isOnBranch = mainLineIdx < 0;
  const branchPoint = isOnBranch
    ? findBranchPoint(state.nodes, state.currentId, state.mainLineIds)
    : mainLineIdx;

  // ライブ評価値（エンジンの最善手 score、手番視点 → 先手視点に変換）
  const liveEval = candidates[0]?.score ?? null;
  const evalScore = liveEval !== null
    ? (activePlayer === 1 ? liveEval : -liveEval)
    : (currentNode?.evalScore ?? 0);

  // ── 形勢グラフデータをノードから構築（CPL / 手の品質付き）──
  const graphData = useMemo(() => {
    let ids;
    if (isOnBranch) {
      const mainSet = new Set(state.mainLineIds);
      const path = getPathFromRoot(state.nodes, state.currentId);
      const branchNodes = path.filter(id => !mainSet.has(id));
      ids = [...state.mainLineIds.slice(0, branchPoint + 1), ...branchNodes];
    } else {
      ids = state.mainLineIds;
    }
    const data = ids.map((id, i) => {
      const node = state.nodes[id];
      return { move: i, nodeId: id, eval: node?.evalScore ?? null, label: node?.label ?? '開始局面',
               quality: null, cpl: 0, isBranchNode: isOnBranch && i > branchPoint };
    });
    // CPL と手の品質を計算（本譜部分のみ）
    for (let i = 1; i < data.length; i++) {
      if (data[i].isBranchNode) continue; // 分岐部分はCPL計算しない
      const curr = data[i]; const prev = data[i - 1];
      if (curr.eval == null || prev.eval == null) continue;
      const mover = i % 2 === 1 ? 1 : 2;  // 奇数手=先手
      // cpl: 手番視点での損失（評価値が下がった分）
      const cpl = mover === 1
        ? Math.max(0, prev.eval - curr.eval)
        : Math.max(0, curr.eval - prev.eval);
      // improvement: 手番視点での改善量（評価値が上がった分）
      const improvement = mover === 1
        ? Math.max(0, curr.eval - prev.eval)
        : Math.max(0, prev.eval - curr.eval);
      curr.cpl = cpl;
      if      (cpl >= 500)         curr.quality = 'blunder';
      else if (cpl >= 300)         curr.quality = 'dubious';
      else if (improvement >= 150) curr.quality = 'good';
    }
    return data;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mainLineIds, state.nodes, state.currentId, isOnBranch, branchPoint]);

  // グラフ上の現在位置インデックス（分岐中は本譜+分岐の合算インデックス）
  const graphCurrentIdx = useMemo(() => {
    if (!isOnBranch) return mainLineIdx;
    const mainSet = new Set(state.mainLineIds);
    const path = getPathFromRoot(state.nodes, state.currentId);
    const firstBranchInPath = path.findIndex(id => !mainSet.has(id));
    const depth = firstBranchInPath >= 0 ? path.length - firstBranchInPath : 0;
    return branchPoint + depth;
  }, [isOnBranch, mainLineIdx, branchPoint, state.mainLineIds, state.nodes, state.currentId]);

  // ── 最善手矢印（ライブ候補手 → 保存済み候補手の順で参照）────────
  const bestMoveArrow = useMemo(() => {
    // ライブ候補手優先、なければ棋譜解析で保存したデータを使う
    const src = candidates.length > 0 ? candidates : (currentNode?.savedCandidates ?? []);
    if (!src[0]) return null;

    // pvUSI がある場合（ライブ解析・棋譜解析）
    if (src[0].pvUSI) {
      const firstUSI = src[0].pvUSI.trim().split(/\s+/)[0];
      const mv = parseUSIMove(firstUSI);
      if (!mv) return null;
      return mv.isDrop ? { from: null, to: mv.to, dropPiece: mv.piece } : { from: mv.from, to: mv.to };
    }

    // pvUSI がない場合: pvJP（例: "▲２六歩(27) △８四歩(83) ..."）をパース
    if (src[0].pvJP) {
      // ▲２六歩(27) → to=２六, from=(27)  /  打ち駒: ▲２六歩打 など
      const fullWidth = { '１':1,'２':2,'３':3,'４':4,'５':5,'６':6,'７':7,'８':8,'９':9 };
      const kanjiRow  = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
      const kanjiPiece = { '歩':'P','香':'L','桂':'N','銀':'S','金':'G','角':'B','飛':'R' };
      const firstMove = src[0].pvJP.trim().split(/\s+/)[0];
      // 駒打ち: ▲２六歩打  → fromなし
      const dropMatch = firstMove.match(/[▲△]([１-９])([一二三四五六七八九])([歩香桂銀金角飛])打/);
      if (dropMatch) {
        const toCol = fullWidth[dropMatch[1]]; // KIF列 (1-9)
        const toRow = kanjiRow[dropMatch[2]];  // KIF段 (1-9)
        // board配列: row = toRow-1, col = 9-toCol
        return { from: null, to: [toRow - 1, 9 - toCol], dropPiece: kanjiPiece[dropMatch[3]] ?? null };
      }
      // 通常手: ▲２六歩(27)
      const moveMatch = firstMove.match(/[▲△]([１-９])([一二三四五六七八九])[^\(]*\((\d)(\d)\)/);
      if (moveMatch) {
        const toCol   = fullWidth[moveMatch[1]];
        const toRow   = kanjiRow[moveMatch[2]];
        const fromCol = parseInt(moveMatch[3]); // KIF列
        const fromRow = parseInt(moveMatch[4]); // KIF段
        return {
          from: [fromRow - 1, 9 - fromCol],
          to:   [toRow  - 1, 9 - toCol],
        };
      }
    }

    return null;
  }, [candidates, currentNode, isAnalyzing]);

  // ── MultiPV 変更 ──────────────────────────────────────────
  const handleMultiPVChange = useCallback((n) => {
    setMultiPV(n);
    socketRef.current?.emit('set_options', [{ name: 'MultiPV', value: String(n) }]);
  }, []);

  // ── 棋譜解析 ──────────────────────────────────────────────
  // JWT から email を取り出す
  const userEmail = useMemo(() => {
    if (!authToken || authToken === '__local__') return null;
    try { return JSON.parse(atob(authToken.split('.')[1])).email || null; }
    catch { return null; }
  }, [authToken]);

  // エージェント必須チェック (WebRTC モードのみ) — ref 経由で stale closure を回避
  function requireAgent() {
    if (import.meta.env.VITE_USE_WEBRTC !== 'true') return true;
    if (selectedAgentIdRef.current) return true;
    // パッシブモード: 別デバイスがアクティブ → 引き継ぎ確認を表示 (refで最新値を参照)
    if (anotherDeviceActiveRef.current) {
      setPendingTakeoverAgentId(null); // 特定エージェント指定なし
      setShowTakeoverDialog(true);
      return false;
    }
    setAgentWarning(true);
    return false;
  }

  // エンジン使用中の状態をリセットして別エージェントに切り替える
  function doSwitchAgent(agentId) {
    const s = socketRef.current;
    // 旧エージェントのエンジンを停止 (DataChannel がまだ開いている場合)
    if (s && selectedAgentIdRef.current) {
      s.emit('stop');
      s.emit('stop_auto_analysis');
      s.emit('stop_ai_think');
    }
    selectedAgentIdRef.current = agentId;
    setSelectedAgentId(agentId);
    setEngineOptions([]);
    setCandidates([]);
    setEngineStatus('connecting');
    setAutoAnalysisStatus('idle');
    setAutoAnalysisProgress(null);
    setIsAnalyzing(false);
    setIsAiThinking(false);
    s?.emit('__select_agent', agentId);
  }

  // エージェント選択 (ユーザーが AgentPanel で選択)
  function handleSelectAgent(agentId) {
    if (!anotherDeviceActiveRef.current && agentId === selectedAgentId) return;
    // パッシブモード: 引き継ぎ確認を表示 (引き継ぎ後にこのエージェントを選択)
    if (anotherDeviceActiveRef.current) {
      setPendingTakeoverAgentId(agentId);
      setShowTakeoverDialog(true);
      return;
    }
    // エンジンが使用中なら確認ダイアログを表示
    const isBusy = engineStatus === 'thinking' || autoAnalysisStatus === 'running' || isAiThinking;
    if (isBusy) {
      const agentInfo = connectedAgents.find((a) => a.agentId === agentId);
      setPendingAgentSwitch({ agentId, agentName: agentInfo?.name ?? 'エージェント' });
      return;
    }
    doSwitchAgent(agentId);
  }

  // ログアウト
  function handleLogout() {
    localStorage.removeItem('shogi_jwt');
    setAuthToken('');
  }

  const handleStartAutoAnalysis = useCallback((condition, rangeFrom, rangeTo) => {
    if (!requireAgent()) return false;
    const s = socketRef.current;
    if (!s) return false;
    // 指定範囲の局面 SFEN リストを構築
    const slicedIds = state.mainLineIds.slice(rangeFrom, rangeTo + 1);
    const positions = slicedIds.map((id, i) => {
      const node = state.nodes[id];
      const player = node.moveNumber % 2 === 0 ? 1 : 2;
      const sfen = boardToSFEN(node.board, node.hands, player, node.moveNumber);
      return { sfen, player, moveIndex: rangeFrom + i };
    });
    if (positions.length === 0) return false;
    setAutoAnalysisStatus('running');
    setAutoAnalysisProgress({ current: 0, total: positions.length, depth: 0 });
    s.emit('start_auto_analysis', { positions, condition });
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mainLineIds, state.nodes, multiPV]);

  const handleStopAutoAnalysis = useCallback(() => {
    socketRef.current?.emit('stop_auto_analysis');
  }, []);

  // ── AI 対局ハンドラ ───────────────────────────────────────
  const handleStartGame = useCallback((config) => {
    if (!requireAgent()) return;
    socketRef.current?.emit('stop_ai_think');
    const board = createHandicapBoard(config.startPos);
    const tree  = buildGameTree(board, null);
    dispatch({ type: 'LOAD_KIF', tree });
    setGameConfig(config);
    // 初期持ち時間を設定（先後独立、人間のみ）
    const initTimes = { 1: 0, 2: 0 };
    for (const p of [1, 2]) {
      const pc = config.players[p];
      if (pc.type !== 'human') continue;
      const tp = pc.timeParams ?? {};
      if (pc.timeFormat === 'byoyomi')            initTimes[p] = tp.byoyomiMs ?? 0;
      else if (pc.timeFormat === 'classical')     initTimes[p] = tp.initMs ?? 0;
      else if (pc.timeFormat === 'fischer')       initTimes[p] = tp.initMs ?? 0;
    }
    setGameTimes(initTimes); gameTimesRef.current = initTimes;
    const ib = { 1: false, 2: false };
    setInByoyomi(ib); inByoyomiRef.current = ib;
    gameConfigRef.current = config;
    turnStartTimeRef.current = Date.now();
    setGameMode('playing');
    setGameResult(null);
    setKifTermination(null);
    setIsAiThinking(false);
    setIsAnalyzing(false);
    setAutoAnalysisStatus('idle');
    setShowGameSetup(false);
  }, []);

  const handleResign = useCallback(() => {
    socketRef.current?.emit('stop_ai_think');
    socketRef.current?.emit('restart_engine');
    setIsAiThinking(false);
    const winner = activePlayer === 1 ? 2 : 1;
    setGameResult({ winner, reason: '投了' });
    setGameMode('ended');
  }, [activePlayer]);

  const handleExitGame = useCallback(() => {
    socketRef.current?.emit('stop_ai_think');
    socketRef.current?.emit('stop_and_standby');
    setIsAiThinking(false);
    setGameMode(null);
    setGameResult(null);
  }, []);

  const handleNewGame = useCallback(() => {
    socketRef.current?.emit('stop_ai_think');
    setIsAiThinking(false);
    setGameMode(null);
    setGameResult(null);
    setKifTermination(null);
    dispatch({ type: 'LOAD_KIF', tree: buildInitialTree() });
    setGameInfo({
      sente: { name: '先手', mark: '▲', time: '0:00:00' },
      gote:  { name: '後手', mark: '△', time: '0:00:00' },
    });
  }, []);

  // ── KIF テキスト生成（保存・クラウド共通） ──
  const buildKifContent = useCallback((withEval) => {
    const nodes = state.nodes;
    const ids   = state.mainLineIds;
    const now   = new Date();
    const pad2  = n => String(n).padStart(2, '0');
    const date  = `${now.getFullYear()}/${pad2(now.getMonth()+1)}/${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    const lines = [
      '# Generated by ShogiAnalytics',
      `開始日時：${date}`,
      '手合割：平手',
      `先手：${gameInfo.sente.name}`,
      `後手：${gameInfo.gote.name}`,
      '手数----指手---------消費時間--',
    ];

    // ▼▼ 変更: パラメータに基準となる盤面 (parentNode) を追加 ▼▼
    // ▼▼ 変更: パラメータに基準となる盤面 (parentNode) を追加 ▼▼
    const appendCandidates = (cands, parentNode) => {
      if (!cands || cands.length === 0 || !parentNode) return;

      // 親局面の手番を判定（0手目は先手(1), 1手目は後手(2)）
      const player = parentNode.moveNumber % 2 === 0 ? 1 : 2;

      cands.forEach((c, i) => {
        const rank  = c.multipv ?? (i + 1);
        let absoluteScore = c.score ?? 0;
        // isAbsolute は KIF 読み込み済み（既に先手絶対値）なので反転しない
        if (!c.isAbsolute && player === 2) {
          absoluteScore = -absoluteScore; // 後手番エンジン視点 → 先手絶対値に変換
        }
        
        // 反転させた absoluteScore を使うように変更
        const eval_ = c.isMate ? `詰${c.mateIn}` : String(absoluteScore);
        
        // 【修正】 seldepth (12/19など) の出力をやめ、元の「深さ 12」形式に戻す
        const depth = c.depth ? `深さ ${c.depth}` : '';
        
        // ノード数（K表記などをせず生の数値）
        const nodes_ = c.nodes != null ? `ノード数 ${c.nodes}` : '';
        
        // 読み筋(pvUSI)を日本語(▲７六歩(77)形式)に展開
        let formattedPV = '';
        if (c.pvUSI) {
          try {
            const pvs = buildPVStatesUSI(c.pvUSI, parentNode.board, parentNode.hands, player);
            
            formattedPV = pvs.slice(1).map((s, idx) => {
              const currentPlayer = (player + idx) % 2 !== 0 ? 1 : 2;
              const mark = currentPlayer === 1 ? '▲' : '△'; 
              
              let text = s.label;
              if (s.moveFrom) {
                const file = 9 - s.moveFrom[1];
                const rankPos = s.moveFrom[0] + 1;
                text = `${text}(${file}${rankPos})`;
              }
              return `${mark}${text}`;
            }).join(' ');
          } catch (e) {
            formattedPV = c.pvUSI; 
          }
        } else {
          formattedPV = c.pvJP || '';
        }

        // 【修正】 "Engine hisui..." の文字列を削除し、以前の順番に完全に戻す
        // これによって他の将棋ソフトでも確実に「評価値」の数字が認識されるようになります
        const parts = [
          `候補${rank}`, 
          depth, 
          nodes_, 
          `評価値 ${eval_}`, 
          formattedPV ? `読み筋 ${formattedPV}` : ''
        ].filter(Boolean);
        
        lines.push(`** ${parts.join(' ')}`);
      });
    };

    for (let i = 1; i < ids.length; i++) {
      const parentNode = nodes[ids[i - 1]];
      const node = nodes[ids[i]];
      if (!node) continue;

      // ▼▼ 変更: parentNode も一緒に渡す ▼▼
      if (withEval) appendCandidates(parentNode?.savedCandidates, parentNode);
      
      // 打ち駒は移動元座標なし（打 で明示済み）、通常手は (FC) 形式
      const fromStr = node.moveFrom
        ? `(${9 - node.moveFrom[1]}${node.moveFrom[0] + 1})`
        : '';
      lines.push(`${String(i).padStart(4)} ${node.label ?? '？'}${fromStr}   ( 0:00/00:00:00)`);
    }

    // 投了・中断などの終局手を追加
    if (kifTermination?.label) {
      const winnerStr = kifTermination.winner === 1 ? '先手' : '後手';
      lines.push(`${String(ids.length).padStart(4)} ${kifTermination.label}   ( 0:00/00:00:00)`);
      lines.push(`まで${ids.length - 1}手で${winnerStr}の勝ち`);
    } else {
      lines.push(`まで${ids.length - 1}手`);
    }
    
    return lines.join('\r\n');
  }, [state.nodes, state.mainLineIds, gameInfo, kifTermination]);
  const handleSaveKif = useCallback((withEval) => {
    const content = buildKifContent(withEval);
    const blob = new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    
    a.href = url; 
    a.download = 'kifu.kif'; 
    a.style.display = 'none';
    
    document.body.appendChild(a); 
    a.click();                    

    // ▼▼▼ 修正: すぐに消さず、スマホがダウンロードを始めるまで少し待つ ▼▼▼
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url); // 100ミリ秒後にメモリを解放する
    }, 100);
    // ▲▲▲
    
  }, [buildKifContent]);

  // ── クラウド: 一覧取得 ──
  const loadCloudKifs = useCallback(async () => {
    const guestId = getGuestId();
    try {
      const res = await fetch(`${CLOUD_API}/api/kif`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          ...(authToken === '__local__' ? { 'X-Guest-Id': guestId } : {}),
        },
      });
      const data = await res.json();
      setCloudKifs(data.ok ? data.kifs : []);
    } catch { setCloudKifs([]); }
  }, [authToken]);

  // ── クラウド: 保存 ──
  const handleCloudSave = useCallback(async (withEval) => {
    const content = buildKifContent(withEval);
    const sente   = gameInfo.sente.name || '先手';
    const gote    = gameInfo.gote.name  || '後手';
    const moves   = state.mainLineIds.length - 1;
    const date    = new Date().toLocaleDateString('ja-JP');
    const title   = `${sente} vs ${gote} (${moves}手) ${date}`;
    setCloudSaving(true);
    try {
      const guestId = getGuestId();
      const res = await fetch(`${CLOUD_API}/api/kif`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          ...(authToken === '__local__' ? { 'X-Guest-Id': guestId } : {}),
        },
        body: JSON.stringify({ title, content }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '保存に失敗しました');
      await loadCloudKifs();
    } catch (e) {
      alert(`クラウド保存エラー: ${e.message}`);
    } finally { setCloudSaving(false); }
  }, [buildKifContent, gameInfo, state.mainLineIds.length, authToken, loadCloudKifs]);

  // ── クラウド: 読み込み ──
  const handleCloudLoad = useCallback(async (id) => {
    const guestId = getGuestId();
    try {
      const res = await fetch(`${CLOUD_API}/api/kif/${id}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          ...(authToken === '__local__' ? { 'X-Guest-Id': guestId } : {}),
        },
      });
      const data = await res.json();
      if (data.ok) { loadKifText(data.kif.content); setShowCloudPanel(false); }
      else throw new Error(data.error);
    } catch (e) { alert(`読み込みエラー: ${e.message}`); }
  }, [authToken, loadKifText]);

  // ── クラウド: 削除 ──
  const handleCloudDelete = useCallback(async (id) => {
    if (!confirm('この棋譜をクラウドから削除しますか？')) return;
    const guestId = getGuestId();
    try {
      await fetch(`${CLOUD_API}/api/kif/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
          ...(authToken === '__local__' ? { 'X-Guest-Id': guestId } : {}),
        },
      });
      setCloudKifs(prev => prev?.filter(k => k.id !== id) ?? prev);
    } catch (e) { alert(`削除エラー: ${e.message}`); }
  }, [authToken]);

  // ── MoveList 用データ計算 ──
  const movePath = getPathFromRoot(state.nodes, state.currentId);
  const mainSet  = new Set(state.mainLineIds);

  let moveListIds;
  let moveListBranchStart = -1;

  if (!isOnBranch) {
    // 本譜すべて表示
    moveListIds = state.mainLineIds;
  } else {
    // 本譜 0..branchPoint + 分岐手順
    const firstBranchInPath = movePath.findIndex(id => !mainSet.has(id));
    moveListIds = [
      ...state.mainLineIds.slice(0, branchPoint + 1),
      ...(firstBranchInPath >= 0 ? movePath.slice(firstBranchInPath) : []),
    ];
    moveListBranchStart = branchPoint + 1;
  }

  // ── PV局面列 ──
  // pvCandidate.pvUSI があれば USI形式で解析、なければ日本語形式
  const pvStates = pvCandidate
    ? (pvCandidate.pvUSI
        ? buildPVStatesUSI(pvCandidate.pvUSI, board, hands, activePlayer)
        : buildPVStates(pvCandidate.pv ?? '', board, hands, activePlayer))
    : null;

  // ── 候補手: ライブ優先、なければ保存済みを表示 ───────────────
  const savedCandidates  = currentNode?.savedCandidates ?? [];
  const displayCands     = candidates.length > 0 ? candidates : savedCandidates;
  const isSavedData      = candidates.length === 0 && savedCandidates.length > 0;

  const liveCandidates = displayCands.map((c, i) => {
    // 1. 候補手（最初の1手目）にマークと座標を付与
    const firstUSI = c.pvUSI ? c.pvUSI.split(' ')[0] : null;
    // pvUSI or c.move がある場合は formatUSIMove でマーク+座標を付与
    // pvJP のみの場合（KIF読み込み済み）はトークンが既に "▲７六歩(77)" 形式なのでそのまま使う
    const rawMoveJP = c.move ?? (firstUSI ? usiMoveToJapanese(firstUSI, board, activePlayer) : null);
    const formattedMove = rawMoveJP !== null
      ? formatUSIMove(rawMoveJP, firstUSI, activePlayer)
      : (c.pvJP?.split(/\s+/)[0] || '?');

    // 2. 読み筋（その後の展開）の各手にマークと座標を付与
    const formattedPV = (() => {
      if (!c.pvUSI) return c.pvJP || '';
      try {
        const tokens = c.pvUSI.trim().split(/\s+/).slice(0, 8);
        const pvs = buildPVStatesUSI(tokens.join(' '), board, hands, activePlayer);
        return pvs.slice(1).map((s, idx) => {
          // 読み筋の手番を計算（現在のプレイヤーから順番に反転）
          const currentPlayer = (activePlayer + idx) % 2 !== 0 ? 1 : 2;
          return formatUSIMove(s.label, tokens[idx], currentPlayer);
        }).join(' ');
      } catch {
        return c.pvUSI;
      }
    })();

    const normScore = c.isAbsolute ? c.score : (activePlayer === 1 ? c.score : -c.score);
    const normMateIn = (c.isMate && !c.isAbsolute && c.mateIn !== null)
      ? (activePlayer === 1 ? c.mateIn : -c.mateIn)
      : c.mateIn;

    return {
      rank: i + 1,
      move: formattedMove, // ← 追加した関数を通したものをセット
      score: normScore,
      isMate: c.isMate,
      mateIn: normMateIn,
      depth: c.depth,
      nodes: c.nodes,
      pvUSI: c.pvUSI,
      pvJP: formattedPV,   // ← 追加した関数を通したものをセット
      pv: '' 
    };
  });

  const handleMoveChange = useCallback((idx) => {
    const id = state.mainLineIds[Math.max(0, Math.min(state.mainLineIds.length - 1, idx))];
    if (id) dispatch({ type: 'NAVIGATE_TO', nodeId: id });
  }, [state.mainLineIds]);

  const handleReturnToMain = useCallback(() => {
    const id = state.mainLineIds[branchPoint];
    if (id) dispatch({ type: 'NAVIGATE_TO', nodeId: id });
  }, [state.mainLineIds, branchPoint]);

  const handleBranchPrev = useCallback(() => {
    const parentId = state.nodes[state.currentId]?.parentId;
    if (parentId) dispatch({ type: 'NAVIGATE_TO', nodeId: parentId });
  }, [state.nodes, state.currentId]);

  const handleBranchNext = useCallback(() => {
    const children = state.nodes[state.currentId]?.children;
    if (children?.[0]) dispatch({ type: 'NAVIGATE_TO', nodeId: children[0] });
  }, [state.nodes, state.currentId]);

  const hasBranchNext = (state.nodes[state.currentId]?.children?.length ?? 0) > 0;

  const displayMove = isOnBranch ? moveNumber : mainLineIdx;

  // 対局中の人間以外の手番・AI思考中はボード入力を封鎖
  const boardLocked = gameMode === 'ended' || (gameMode === 'playing' && (isAiThinking || gameConfig?.players?.[activePlayer]?.type !== 'human'));
  const cellClickDispatch  = (r, c) => { if (!boardLocked) dispatch({ type: 'CELL_CLICK', row: r, col: c, inGame: gameMode === 'playing' }); };
  const dropSelectDispatch = (p)    => { if (!boardLocked) dispatch({ type: 'SELECT_DROP', piece: p }); };

  // ─── 共通パーツ ───────────────────────────────────────

  // AI思考中オーバーレイ
  const aiOverlay = isAiThinking && (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 rounded-xl">
      <div className="flex items-center gap-2 bg-gray-900/90 px-4 py-2 rounded-full border border-gray-600">
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-sm font-bold text-white">AI 思考中…</span>
      </div>
    </div>
  );

  // 対局中ゲームコントロール
  // 対局中は形勢・候補手を非表示にするか
  const gameInfoHidden = gameMode === 'playing' && gameConfig?.hideInfo;

  const gameControls = gameMode && (
    <div className="mx-3 flex items-center justify-between gap-2 py-1.5 px-3
      bg-gray-800 rounded-xl border border-gray-700">
      <div className="flex items-center gap-2 text-sm">
        {gameMode === 'playing' && (
          isAiThinking
            ? <><span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" /><span className="text-gray-300">AI 思考中…</span></>
            : gameConfig?.players?.[activePlayer]?.type === 'human'
              ? <><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /><span className="text-green-300 font-bold">あなたの手番</span></>
              : <span className="text-gray-400">—</span>
        )}
        {gameMode === 'ended' && (
          gameResult
            ? <span className="text-yellow-300 font-bold">
                {gameResult.reason} — {gameResult.winner === 1 ? '先手' : '後手'}の勝ち
              </span>
            : <span className="text-gray-400">対局終了</span>
        )}
      </div>
      <div className="flex gap-2">
        {gameMode === 'playing' && (
          <button onClick={handleResign}
            className="px-3 py-1 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-bold transition-colors">
            投了
          </button>
        )}
        <button onClick={handleExitGame}
          className="px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-bold transition-colors">
          {gameMode === 'ended' ? '閉じる' : '中断'}
        </button>
      </div>
    </div>
  );

  // 盤面アセンブリの最大サイズ（幅・高さ共用）
  // mobileTopH/W は ResizeObserver 由来なので vw/vh 不使用
  const boardAssemblyPx = mobileTopH > 0 && mobileTopW > 0
    ? Math.min(
        Math.max(130, Math.round((mobileTopH - 198) * 0.9 + 130)),
        Math.max(130, mobileTopW - 8)
      )
    : null;

  const mobileBoardArea = (
    <div
      className="flex gap-1 items-stretch select-none overflow-hidden min-w-0"
      data-board-area
      style={boardAssemblyPx ? {
        // ★ WebKit (iPad Safari) は縮小時に grid + aspect-ratio の
        // intrinsic size が残留するため、幅・高さ両方の上限を明示する。
        maxWidth:  `${boardAssemblyPx}px`,
        maxHeight: `${boardAssemblyPx}px`,
      } : undefined}
    >
      <HandColumnVertical
        hands={hands} player={flipped ? 1 : 2}
        activePlayer={activePlayer}
        dropSelected={state.dropSelected}
        onDropSelect={dropSelectDispatch}
        pieceAlign="top"
      />
      <div className="flex-1 min-w-0 relative">
        <BoardCore
          board={board}
          hands={hands}
          selectedCell={state.selectedCell}
          highlightSet={highlightSet}
          lastMove={state.lastMove}
          bestMove={bestMoveArrow}
          activePlayer={activePlayer}
          onCellClick={cellClickDispatch}
          flipped={flipped}
          sideLayout
        />
        {aiOverlay}
      </div>
      <HandColumnVertical
        hands={hands} player={flipped ? 2 : 1}
        activePlayer={activePlayer}
        dropSelected={state.dropSelected}
        onDropSelect={dropSelectDispatch}
        pieceAlign="bottom"
      />
    </div>
  );

  const navArea = (
    <>
      {gameControls}
      {!gameInfoHidden && <EvaluationMeter evalValue={evalScore} />}
      <NavigationPanel
        currentMove={displayMove}
        totalMoves={state.mainLineIds.length - 1}
        onMoveChange={handleMoveChange}
        onOpenTree={() => dispatch({ type: 'TOGGLE_TREE' })}
        currentLabel={currentNode?.label}
        isOnBranch={isOnBranch}
        onReturnToMain={handleReturnToMain}
        onBranchPrev={handleBranchPrev}
        onBranchNext={handleBranchNext}
        hasBranchNext={hasBranchNext}
        onLoadFile={handleLoadFile}
        onPasteKif={handlePasteKif}
        onNewGame={handleNewGame}
        onSaveKif={handleSaveKif}
        onFlip={() => setFlipped(v => !v)}
        flipped={flipped}
      />
      {kifError && (
        <div className="mx-3 px-3 py-2 bg-red-900/40 border border-red-700/50 rounded-xl text-xs text-red-300 flex items-start justify-between gap-2">
          <span>{kifError}</span>
          <button onClick={() => setKifError(null)} className="text-red-400 hover:text-white shrink-0">✕</button>
        </div>
      )}
    </>
  );


  const handleEngineRestart = useCallback(() => {
    socketRef.current?.emit('restart_engine');
  }, []);

  const engineBadge = isAgentConnected && (engineStatus === 'connecting' || engineStatus === 'error') && (
    <div className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-amber-900/40 border border-amber-700/50">
      <svg className="animate-spin w-3 h-3 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span className="text-[10px] text-amber-300 font-medium truncate max-w-[80px] hidden sm:inline">{engineMessage || '起動中'}</span>
      <button onClick={handleEngineRestart}
        className="text-[10px] text-amber-400 hover:text-amber-200 font-bold shrink-0 px-1 py-0.5 rounded border border-amber-600/50 hover:border-amber-400/70 transition-colors"
      >再起動</button>
    </div>
  );

  const engineRestartBtn = isAgentConnected && engineStatus !== 'connecting' && engineStatus !== 'error' && (
    <button onClick={handleEngineRestart} title="エンジン強制再起動"
      className="text-[10px] text-gray-500 hover:text-amber-400 font-medium px-1 py-0.5 rounded border border-gray-700 hover:border-amber-600/50 transition-colors shrink-0"
    >再起動</button>
  );

  const analysisArea = (
    <>
      {!gameInfoHidden && (
        <EvaluationGraph
          currentMove={graphCurrentIdx}
          graphData={graphData}
          onNavigate={(idx) => {
            const nodeId = graphData[idx]?.nodeId;
            if (nodeId) dispatch({ type: 'NAVIGATE_TO', nodeId });
          }}
          isBranch={isOnBranch}
          branchPoint={branchPoint}
        />
      )}
      {!gameInfoHidden && (
        <>
          <div className="border-t border-gray-700/50 mx-3" />
          <CandidateMoves
            candidates={liveCandidates}
            engineStatus={engineStatus}
            maxDepth={maxDepth}
            multiPV={multiPV}
            isSaved={isSavedData}
            onMultiPVChange={handleMultiPVChange}
            onPVClick={(cand) => setPvCandidate(cand)}
          />
        </>
      )}
    </>
  );

  // WebRTC モードで未ログイン → ログインページへリダイレクト
  if (import.meta.env.VITE_USE_WEBRTC === 'true' && !authToken) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="overflow-hidden bg-gray-900 text-white flex flex-col"
      style={{ height: '100svh', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <Header
        onOpenSettings={import.meta.env.VITE_USE_WEBRTC === 'true' ? null : () => setShowSettings(true)}
        onOpenGame={() => { if (isAnalyzing || autoAnalysisStatus === 'running') return; setShowGameSetup(true); }}
        gameMode={gameMode}
        agentSlot={
          import.meta.env.VITE_USE_WEBRTC === 'true'
            ? <div className="flex items-center gap-2">
                {engineBadge}{engineRestartBtn}
                <AgentPanel
                  connectedAgents={connectedAgents}
                  selectedAgentId={selectedAgentId}
                  authToken={authToken}
                  onSelectAgent={handleSelectAgent}
                  onOpenSettings={() => setShowSettings(true)}
                  isPassive={anotherDeviceActive}
                />
              </div>
            : null
        }
        accountSlot={
          <div className="flex items-center gap-2">
            {import.meta.env.VITE_USE_WEBRTC !== 'true' && (engineBadge || engineRestartBtn)}
            {userEmail
              ? <AccountMenu email={userEmail} onLogout={handleLogout} />
              : null}
          </div>
        }
        onMenuOpen={() => setMobileMenuOpen(true)}
      />

      {/* ══ モバイルドロワーメニュー（デスクトップサイドバーと同じ構造） ══ */}
      <input ref={mobileFileRef} type="file" accept=".kif,.kifu,.csa" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleLoadFile(f); e.target.value = ''; }} />
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-[100] flex">
          {/* バックドロップ */}
          <div className="absolute inset-0 bg-black/60"
            onClick={() => { setMobileMenuOpen(false); setShowCloudPanel(false); setShowAnalysisPanel(false); setOpenFlyout(null); }} />

          {/* サイドバー + パネル */}
          <div className="relative flex h-full shadow-2xl">

            {/* 64px サイドバー列（デスクトップと同一） */}
            <div className="flex flex-col items-stretch border-r border-gray-700 bg-gray-900 flex-shrink-0 z-20" style={{ width: 64 }}>
              <SidebarAction icon={<FilePlus size={17} />} label="新規" onClick={() => { handleNewGame(); setMobileMenuOpen(false); setOpenFlyout(null); }} />

              {/* 開く — フライアウト */}
              <div ref={mobileFlyoutRef} className="relative">
                <SidebarAction
                  icon={<FolderOpen size={17} />}
                  label="開く"
                  onClick={() => setOpenFlyout(v => v === 'mobile-file' ? null : 'mobile-file')}
                  active={openFlyout === 'mobile-file'}
                />
                {openFlyout === 'mobile-file' && (
                  <div className="absolute left-full top-0 z-30 ml-1 w-44 bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-1.5 flex flex-col gap-0.5">
                    <FlyoutItem icon={<FolderOpen size={13} />} label="ファイルを開く"
                      onClick={() => { mobileFileRef.current?.click(); setOpenFlyout(null); setMobileMenuOpen(false); }} />
                    <FlyoutItem icon={<Clipboard size={13} />} label="貼り付け"
                      onClick={() => { handlePasteKif(); setOpenFlyout(null); setMobileMenuOpen(false); }} />
                  </div>
                )}
              </div>

              <div ref={mobileSaveMenuRef} className="relative">
                <SidebarAction
                  icon={<Download size={17} />}
                  label="保存"
                  onClick={() => setOpenSaveMenu(v => v === 'mobile' ? null : 'mobile')}
                  active={openSaveMenu === 'mobile'}
                />
                {openSaveMenu === 'mobile' && (
                  <div 
                  className="absolute left-full top-0 z-30 ml-1 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-1.5 flex flex-col gap-0.5"
                  // ▼▼▼ これを追加！(タッチ判定の貫通を防ぐバリア) ▼▼▼
                  onPointerDown={(e) => e.stopPropagation()} 
                >
                  <FlyoutItem icon={<TrendingUp size={13} />} label="評価値を含めて保存"
                    onClick={() => { handleSaveKif(true); setOpenSaveMenu(null); setMobileMenuOpen(false); }} />
                  <FlyoutItem icon={<Download size={13} />} label="評価値なしで保存"
                    onClick={() => { handleSaveKif(false); setOpenSaveMenu(null); setMobileMenuOpen(false); }} />
                </div>
                )}
              </div>
              <SidebarAction
                icon={<Cloud size={17} />}
                label="クラウド"
                onClick={() => { setShowCloudPanel(v => !v); setShowAnalysisPanel(false); setOpenFlyout(null); }}
                active={showCloudPanel}
              />

              <div className="mx-3 my-1 border-t border-gray-700/60" />

              <SidebarAction
                icon={<Cpu size={17} />}
                label="検討"
                onClick={() => {
                  if (autoAnalysisStatus === 'running') return;
                  if (!isAnalyzing && !requireAgent()) return;
                  setIsAnalyzing(v => !v);
                  setMobileMenuOpen(false);
                }}
                active={isAnalyzing}
                pulse={isAnalyzing}
                disabled={autoAnalysisStatus === 'running'}
              />
              <SidebarAction
                icon={<BarChart2 size={17} />}
                label="解析"
                onClick={() => { setShowAnalysisPanel(v => !v); setShowCloudPanel(false); setOpenFlyout(null); }}
                active={showAnalysisPanel || autoAnalysisStatus === 'running'}
                pulse={autoAnalysisStatus === 'running'}
              />

              <div className="flex-1" />
              <SidebarAction icon={<FlipHorizontal2 size={17} />} label="反転" onClick={() => { setFlipped(v => !v); setMobileMenuOpen(false); }} active={flipped} />
              <SidebarAction icon={<GitBranch size={17} />} label="ツリー" onClick={() => { dispatch({ type: 'TOGGLE_TREE' }); setMobileMenuOpen(false); }} />
            </div>

            {/* 解析パネル */}
            {showAnalysisPanel && (
              <div className="flex flex-col bg-gray-900 border-r border-gray-700 h-full" style={{ width: 300 }}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
                  <div className="flex items-center gap-2">
                    <BarChart2 size={15} className="text-blue-400" />
                    <span className="text-sm font-bold text-white">棋譜解析</span>
                  </div>
                  <button onClick={() => setShowAnalysisPanel(false)}
                    className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                  {gameMode !== 'playing' ? (
                    <AutoAnalysis
                      status={autoAnalysisStatus}
                      progress={autoAnalysisProgress}
                      totalMoves={state.mainLineIds.length - 1}
                      onStart={(cond, from, to) => { if (handleStartAutoAnalysis(cond, from, to)) { setShowAnalysisPanel(false); setMobileMenuOpen(false); } }}
                      onStop={handleStopAutoAnalysis}
                      disabled={isAnalyzing}
                    />
                  ) : (
                    <p className="text-xs text-gray-500 px-4 py-3">対局中は棋譜解析を使用できません。</p>
                  )}
                </div>
              </div>
            )}

            {/* クラウドパネル */}
            {showCloudPanel && (
              <div className="flex flex-col bg-gray-900 border-r border-gray-700 h-full" style={{ width: 300 }}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
                  <div className="flex items-center gap-2">
                    <Cloud size={15} className="text-blue-400" />
                    <span className="text-sm font-bold text-white">クラウド棋譜</span>
                  </div>
                  <button onClick={() => setShowCloudPanel(false)}
                    className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                    <X size={14} />
                  </button>
                </div>
                <div className="px-3 py-3 border-b border-gray-700 shrink-0 flex gap-2">
                  <button
                    onClick={() => handleCloudSave(true)}
                    disabled={cloudSaving}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                  >
                    {cloudSaving ? <Loader2 size={12} className="animate-spin" /> : <TrendingUp size={12} />}
                    評価値あり
                  </button>
                  <button
                    onClick={() => handleCloudSave(false)}
                    disabled={cloudSaving}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                  >
                    {cloudSaving ? <Loader2 size={12} className="animate-spin" /> : <Cloud size={12} />}
                    評価値なし
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {cloudKifs === null ? (
                    <div className="flex items-center justify-center h-20 text-gray-500 text-xs gap-2">
                      <Loader2 size={14} className="animate-spin" />読み込み中...
                    </div>
                  ) : cloudKifs.length === 0 ? (
                    <p className="text-xs text-gray-500 px-4 py-6 text-center">保存された棋譜はありません</p>
                  ) : (
                    <div className="flex flex-col gap-0.5 p-2">
                      {cloudKifs.map(kif => (
                        <div key={kif.id} className="flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-gray-800 group">
                          <button className="flex-1 min-w-0 text-left"
                            onClick={() => { handleCloudLoad(kif.id); setMobileMenuOpen(false); setShowCloudPanel(false); }}>
                            <div className="text-xs text-gray-200 truncate">{kif.title}</div>
                            <div className="text-[10px] text-gray-500 mt-0.5">
                              {new Date(kif.created_at * 1000).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </button>
                          <button onClick={() => handleCloudDelete(kif.id)}
                            className="p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100"
                            title="削除">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ モバイル: 縦2分割（境界ドラッグ可、absolute配置） ══ */}
      <main className="lg:hidden flex-1 overflow-hidden relative">
        {/* 上段: 盤面 + ナビ */}
        <div ref={mobileTopRef} className="absolute inset-x-0 top-0 flex flex-col overflow-hidden pt-1.5"
          style={{ bottom: panelSizes.mobileSplitPx + 8 }}>
          {/* 盤面エリア（対局者名 + 盤） */}
          <div className="mx-auto flex flex-col gap-2 overflow-hidden" style={{
            width: '100%',
            maxWidth: boardAssemblyPx ? `${boardAssemblyPx}px` : '100%',
          }}>
            {/* 対局者名 */}
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <PlayerInfo
                  name={gameMode
                    ? (gameConfig?.players?.[flipped ? 1 : 2]?.type === 'human' ? 'あなた' : 'CPU')
                    : (flipped ? gameInfo.sente.name : gameInfo.gote.name)}
                  mark={flipped ? gameInfo.sente.mark : gameInfo.gote.mark}
                  time={displayTimes[flipped ? 1 : 2] || (flipped ? gameInfo.sente.time : gameInfo.gote.time)}
                  isActive={activePlayer === (flipped ? 1 : 2)}
                  player={flipped ? 1 : 2}
                  inCheck={inCheck && activePlayer === (flipped ? 1 : 2)}
                />
              </div>
              <div className="flex-1 min-w-0">
                <PlayerInfo
                  name={gameMode
                    ? (gameConfig?.players?.[flipped ? 2 : 1]?.type === 'human' ? 'あなた' : 'CPU')
                    : (flipped ? gameInfo.gote.name : gameInfo.sente.name)}
                  mark={flipped ? gameInfo.gote.mark : gameInfo.sente.mark}
                  time={displayTimes[flipped ? 2 : 1] || (flipped ? gameInfo.gote.time : gameInfo.sente.time)}
                  isActive={activePlayer === (flipped ? 2 : 1)}
                  player={flipped ? 2 : 1}
                  inCheck={inCheck && activePlayer === (flipped ? 2 : 1)}
                />
              </div>
            </div>
            {mobileBoardArea}
          </div>
          {/* ナビエリア（内容が多い場合はスクロール） */}
          <div className="overflow-y-auto">
            {navArea}
          </div>
        </div>
        {/* ドラッグハンドル（絶対位置） */}
        <div
          className="absolute inset-x-0 z-10 touch-none group flex items-center justify-center
            cursor-row-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors"
          style={{ bottom: panelSizes.mobileSplitPx, height: 8, background: '#334155' }}
          onMouseDown={(e) => startDrag(e, panelSizes.mobileSplitPx, (v) => {
            setPanelSizes(s => ({ ...s, mobileSplitPx: Math.max(calcMinMobileSplit(), Math.min(500, v)) }));
          }, 'y', true)}
          onTouchStart={(e) => startDrag(e, panelSizes.mobileSplitPx, (v) => {
            setPanelSizes(s => ({ ...s, mobileSplitPx: Math.max(calcMinMobileSplit(), Math.min(500, v)) }));
          }, 'y', true)}
        >
          <div className="w-10 h-1 rounded-full bg-blue-400 opacity-40 group-hover:opacity-100 group-active:opacity-100 transition-opacity" />
        </div>
        {/* 下段: 形成グラフ + 候補手 */}
        <div className="absolute inset-x-0 bottom-0 overflow-y-auto overscroll-y-contain border-t border-gray-700/50"
          style={{ height: panelSizes.mobileSplitPx }}>
          {analysisArea}
        </div>
      </main>

      {/* ══ デスクトップ: 新レイアウト ══ */}
      {/* 左サイドバー | 盤面(左上) + [指し手|グラフ](右上) | 候補手(下段) */}
      <div className="hidden lg:flex flex-1 overflow-hidden relative">

        {/* 左サイドバー: ファイル操作 + 解析タブ */}
        <div className="flex flex-col items-stretch border-r border-gray-700 bg-gray-900/30 flex-shrink-0 z-20"
          style={{ width: 64 }}>
          <input
            ref={desktopFileRef}
            type="file"
            accept=".kif,.kifu,.csa"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLoadFile(f); e.target.value = ''; }}
          />
          <SidebarAction icon={<FilePlus size={17} />} label="新規" onClick={handleNewGame} />
          {/* 開く — フライアウト付き */}
          <div ref={flyoutRef} className="relative">
            <SidebarAction
              icon={<FolderOpen size={17} />}
              label="開く"
              onClick={() => setOpenFlyout(v => v === 'file' ? null : 'file')}
              active={openFlyout === 'file'}
            />
            {openFlyout === 'file' && (
              <div className="absolute left-full top-0 z-30 ml-1 w-44 bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-1.5 flex flex-col gap-0.5">
                <FlyoutItem icon={<FolderOpen size={13} />} label="ファイルを開く"
                  onClick={() => { desktopFileRef.current?.click(); setOpenFlyout(null); }} />
                <FlyoutItem icon={<Clipboard size={13} />} label="貼り付け"
                  onClick={() => { handlePasteKif(); setOpenFlyout(null); }} />
              </div>
            )}
          </div>
          <div ref={saveMenuRef} className="relative">
            <SidebarAction
              icon={<Download size={17} />}
              label="保存"
              onClick={() => setOpenSaveMenu(v => v === 'desktop' ? null : 'desktop')}
              active={openSaveMenu === 'desktop'}
            />
            {openSaveMenu === 'desktop' && (
              <div className="absolute left-full top-0 z-30 ml-1 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-1.5 flex flex-col gap-0.5">
                <FlyoutItem icon={<TrendingUp size={13} />} label="評価値を含めて保存"
                  onClick={() => { handleSaveKif(true); setOpenSaveMenu(null); }} />
                <FlyoutItem icon={<Download size={13} />} label="評価値なしで保存"
                  onClick={() => { handleSaveKif(false); setOpenSaveMenu(null); }} />
              </div>
            )}
          </div>
          <SidebarAction
            icon={<Cloud size={17} />}
            label="クラウド"
            onClick={() => setShowCloudPanel(v => !v)}
            active={showCloudPanel}
          />
          {/* セパレーター */}
          <div className="mx-3 my-1 border-t border-gray-700/60" />
          {/* 検討トグル */}
          <SidebarAction
            icon={<Cpu size={17} />}
            label="検討"
            onClick={() => {
              if (autoAnalysisStatus === 'running') return;
              if (!isAnalyzing && !requireAgent()) return;
              setIsAnalyzing(v => !v);
            }}
            active={isAnalyzing}
            pulse={isAnalyzing}
            disabled={autoAnalysisStatus === 'running'}
          />
          {/* 解析パネル開閉 */}
          <SidebarAction
            icon={<BarChart2 size={17} />}
            label="解析"
            onClick={() => setShowAnalysisPanel(v => !v)}
            active={showAnalysisPanel || autoAnalysisStatus === 'running'}
            pulse={autoAnalysisStatus === 'running'}
          />
          <div className="flex-1" />
          <SidebarAction icon={<FlipHorizontal2 size={17} />} label="反転" onClick={() => setFlipped(v => !v)} active={flipped} />
          <SidebarAction icon={<GitBranch size={17} />} label="ツリー" onClick={() => dispatch({ type: 'TOGGLE_TREE' })} />
        </div>

        {/* 解析パネル（サイドバー右隣にオーバーレイ表示） */}
        {showAnalysisPanel && (
          <div className="absolute top-0 bottom-0 z-20 flex flex-col bg-gray-900 border-r border-gray-700"
            style={{ left: 64, width: 300 }}>
            {/* パネルヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
              <div className="flex items-center gap-2">
                <BarChart2 size={15} className="text-blue-400" />
                <span className="text-sm font-bold text-white">棋譜解析</span>
              </div>
              <button onClick={() => setShowAnalysisPanel(false)}
                className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                <X size={14} />
              </button>
            </div>
            {/* パネル本体 */}
            <div className="flex-1 overflow-y-auto py-2">
              {gameMode !== 'playing' ? (
                <AutoAnalysis
                  status={autoAnalysisStatus}
                  progress={autoAnalysisProgress}
                  totalMoves={state.mainLineIds.length - 1}
                  onStart={(cond, from, to) => { if (handleStartAutoAnalysis(cond, from, to)) setShowAnalysisPanel(false); }}
                  onStop={handleStopAutoAnalysis}
                  disabled={isAnalyzing}
                />
              ) : (
                <p className="text-xs text-gray-500 px-4 py-3">対局中は棋譜解析を使用できません。</p>
              )}
            </div>
          </div>
        )}

        {/* クラウドパネル（サイドバー右隣にオーバーレイ表示） */}
        {showCloudPanel && (
          <div className="absolute top-0 bottom-0 z-20 flex flex-col bg-gray-900 border-r border-gray-700"
            style={{ left: 64, width: 300 }}>
            {/* パネルヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
              <div className="flex items-center gap-2">
                <Cloud size={15} className="text-blue-400" />
                <span className="text-sm font-bold text-white">クラウド棋譜</span>
              </div>
              <button onClick={() => setShowCloudPanel(false)}
                className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                <X size={14} />
              </button>
            </div>
            {/* 保存ボタン（評価値あり/なし） */}
            <div className="px-3 py-3 border-b border-gray-700 shrink-0 flex gap-2">
              <button
                onClick={() => handleCloudSave(true)}
                disabled={cloudSaving}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
              >
                {cloudSaving ? <Loader2 size={12} className="animate-spin" /> : <TrendingUp size={12} />}
                評価値あり
              </button>
              <button
                onClick={() => handleCloudSave(false)}
                disabled={cloudSaving}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
              >
                {cloudSaving ? <Loader2 size={12} className="animate-spin" /> : <Cloud size={12} />}
                評価値なし
              </button>
            </div>
            {/* 棋譜リスト */}
            <div className="flex-1 overflow-y-auto">
              {cloudKifs === null ? (
                <div className="flex items-center justify-center h-20 text-gray-500 text-xs">
                  <Loader2 size={14} className="animate-spin mr-2" />読み込み中...
                </div>
              ) : cloudKifs.length === 0 ? (
                <p className="text-xs text-gray-500 px-4 py-6 text-center">保存された棋譜はありません</p>
              ) : (
                <div className="flex flex-col gap-0.5 p-2">
                  {cloudKifs.map(kif => (
                    <div key={kif.id}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-gray-800 group">
                      <button
                        onClick={() => handleCloudLoad(kif.id)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="text-xs text-gray-200 truncate">{kif.title}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {new Date(kif.created_at * 1000).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                        </div>
                      </button>
                      <button
                        onClick={() => handleCloudDelete(kif.id)}
                        className="p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100"
                        title="削除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* メインコンテンツ */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* 上段: 盤面(左上) + 指し手/グラフ(右上) */}
          <div className="flex flex-1 min-h-0 overflow-hidden ">

            {/* 左上: 盤面エリア（幅はpanelSizes.boardPxで制御） */}
            <div
              ref={boardColumnRef}
              className="flex flex-col gap-1.5 pt-2 pb-1 px-3 overflow-y-auto overscroll-y-contain flex-shrink-0"
              style={{ width: panelSizes.boardPx, minWidth: 200 }}
            >
              {/* 対局者名ヘッダー: 左=上手、右=下手 */}
              <div ref={boardPlayerRef} className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <PlayerInfo
                    name={gameMode
                      ? (gameConfig?.players?.[flipped ? 1 : 2]?.type === 'human' ? 'あなた' : 'CPU')
                      : (flipped ? gameInfo.sente.name : gameInfo.gote.name)}
                    mark={flipped ? gameInfo.sente.mark : gameInfo.gote.mark}
                    time={displayTimes[flipped ? 1 : 2] || (flipped ? gameInfo.sente.time : gameInfo.gote.time)}
                    isActive={activePlayer === (flipped ? 1 : 2)}
                    player={flipped ? 1 : 2}
                    inCheck={inCheck && activePlayer === (flipped ? 1 : 2)}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <PlayerInfo
                    name={gameMode
                      ? (gameConfig?.players?.[flipped ? 2 : 1]?.type === 'human' ? 'あなた' : 'CPU')
                      : (flipped ? gameInfo.gote.name : gameInfo.sente.name)}
                    mark={flipped ? gameInfo.gote.mark : gameInfo.sente.mark}
                    time={displayTimes[flipped ? 2 : 1] || (flipped ? gameInfo.gote.time : gameInfo.sente.time)}
                    isActive={activePlayer === (flipped ? 2 : 1)}
                    player={flipped ? 2 : 1}
                    inCheck={inCheck && activePlayer === (flipped ? 2 : 1)}
                  />
                </div>
              </div>

              {/* 盤面
                  盤グリッドの縦横比は 9:10 (幅:高さ)
                  アセンブリ = 駒台左 + 盤グリッド + 駒台右 ≈ 盤グリッド幅 + 104px
                  → assembly_max_width = availH × (9/10) + 104
                  使える高さ = カラム高さ - 対局者名高さ - navArea高さ - padding/gap
              */}
              <div className="w-full flex justify-center overflow-hidden min-h-0">
                {(() => {
                  const fixedOverhead = 24; // pt-2(8) + pb-1(4) + gap-1.5×2(12)
                  const availH = boardColumnH > 0
                    ? boardColumnH - (boardPlayerH || 50) - (boardNavAreaH || 160) - fixedOverhead
                    : 0;
                  const maxW = availH > 0 ? Math.round(availH * 0.9 + 104) : 0;
                  return (
                    <div className="flex gap-1 items-stretch select-none min-w-0" data-board-area style={{
                      width: maxW > 0 ? `min(100%, ${maxW}px)` : '100%',
                    }}>
                      <HandColumnVertical
                        hands={hands} player={flipped ? 1 : 2}
                        activePlayer={activePlayer}
                        dropSelected={state.dropSelected}
                        onDropSelect={dropSelectDispatch}
                        pieceAlign="top"
                      />
                      <div className="flex-1 min-w-0 relative">
                        <BoardCore
                          board={board}
                          hands={hands}
                          selectedCell={state.selectedCell}
                          highlightSet={highlightSet}
                          lastMove={state.lastMove}
                          bestMove={bestMoveArrow}
                          activePlayer={activePlayer}
                          onCellClick={cellClickDispatch}
                          flipped={flipped}
                          sideLayout
                        />
                        {aiOverlay}
                      </div>
                      <HandColumnVertical
                        hands={hands} player={flipped ? 2 : 1}
                        activePlayer={activePlayer}
                        dropSelected={state.dropSelected}
                        onDropSelect={dropSelectDispatch}
                        pieceAlign="bottom"
                      />
                    </div>
                  );
                })()}
              </div>

              <div ref={boardNavAreaRef}>{navArea}</div>
            </div>

            {/* ── 水平ドラッグハンドル（盤面 | 右パネル） ── */}
            <DragHandle
              axis="x"
              onMouseDown={(e) => startDrag(e, panelSizes.boardPx, (v) =>
                setPanelSizes(s => ({ ...s, boardPx: Math.max(200, v) })),
                'x'
              )}
            />

            {/* 右上: 指し手一覧(上) → 形成グラフ(下) の縦積み */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

              {/* 指し手一覧（高さはpanelSizes.moveListPxで制御） */}
              <div className="flex flex-col overflow-hidden flex-shrink-0"
                style={{ height: panelSizes.moveListPx }}>
                <MoveList
                  nodes={state.nodes}
                  moveListIds={moveListIds}
                  branchStart={moveListBranchStart}
                  currentId={state.currentId}
                  onNavigate={(id) => dispatch({ type: 'NAVIGATE_TO', nodeId: id })}
                  termination={kifTermination}
                />
              </div>
              {/* 投了・中断などの終局手を MoveList 直下に表示（対局モード中は非表示） */}
              {kifTermination && !gameMode && (
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs border-t border-gray-700/30 flex-shrink-0 bg-gray-900/50">
                  <span className="w-6 text-right text-gray-500 shrink-0 tabular-nums">
                    {kifTermination.moveNumber}
                  </span>
                  <span className="font-medium text-red-400">{kifTermination.label}</span>
                  <span className="ml-auto text-gray-400">
                    {kifTermination.winner === 1 ? '▲先手' : '△後手'}の勝ち
                  </span>
                </div>
              )}

              {/* ── 垂直ドラッグハンドル（指し手 | グラフ） ── */}
              <DragHandle
                axis="y"
                onMouseDown={(e) => startDrag(e, panelSizes.moveListPx, (v) =>
                  setPanelSizes(s => ({ ...s, moveListPx: Math.max(0, v) })),
                  'y'
                )}
              />

              {/* 形成グラフのみ */}
              <div className="flex flex-col flex-1 min-h-0 overflow-y-auto overscroll-y-contain pt-3">
                {!gameInfoHidden && (
                  <EvaluationGraph
                    currentMove={isOnBranch ? branchPoint : mainLineIdx}
                    graphData={graphData}
                    onNavigate={handleMoveChange}
                    isBranch={isOnBranch}
                    branchPoint={branchPoint}
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── 垂直ドラッグハンドル（上段 | 候補手） ── */}
          {!gameInfoHidden && (
            <DragHandle
              axis="y"
              onMouseDown={(e) => startDrag(e, panelSizes.candidatePx, (v) =>
                setPanelSizes(s => ({ ...s, candidatePx: Math.max(0, v) })),
                'y', true  // inverted: 上にドラッグ = 増やす
              )}
            />
          )}

          {/* 下段: 候補手・読み筋 */}
          {!gameInfoHidden && (
            <div className="flex-shrink-0 overflow-hidden" style={{ height: panelSizes.candidatePx }}>
              <CandidateMoves
                candidates={liveCandidates}
                engineStatus={engineStatus}
                maxDepth={maxDepth}
                multiPV={multiPV}
                isSaved={isSavedData}
                onMultiPVChange={handleMultiPVChange}
                onPVClick={(cand) => setPvCandidate(cand)}
                fillHeight
              />
            </div>
          )}
        </div>
      </div>

      {/* ツリーパネル */}
      {state.showTree && (
        <MoveTreePanel
          nodes={state.nodes}
          rootId={state.rootId}
          mainLineIds={state.mainLineIds}
          currentId={state.currentId}
          onNavigate={(id) => { dispatch({ type: 'NAVIGATE_TO', nodeId: id }); dispatch({ type: 'TOGGLE_TREE' }); }}
          onClose={() => dispatch({ type: 'TOGGLE_TREE' })}
        />
      )}

      {/* 成りダイアログ（グローバル） */}
      {state.promoteDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-6 flex flex-col items-center gap-4
            shadow-2xl border border-gray-600 w-64">
            <p className="text-white font-bold text-lg">成りますか？</p>
            <div className="text-amber-300 text-4xl font-bold leading-none">
              {getPieceChar(state.promoteDialog.piece.type, state.promoteDialog.piece.player)}
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => dispatch({ type: 'RESOLVE_PROMOTE', promote: true, inGame: gameMode === 'playing' })}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-bold transition-colors"
              >成る</button>
              <button
                onClick={() => dispatch({ type: 'RESOLVE_PROMOTE', promote: false, inGame: gameMode === 'playing' })}
                className="flex-1 py-3 bg-gray-600 hover:bg-gray-500 rounded-xl text-white font-bold transition-colors"
              >成らない</button>
            </div>
          </div>
        </div>
      )}

      {/* PV読み筋ボード */}
      {pvCandidate && pvStates && (
        <PVBoard
          candidate={pvCandidate}
          states={pvStates}
          activePlayer={activePlayer}
          onClose={() => setPvCandidate(null)}
        />
      )}

      {/* AI 対局セットアップ */}
      {showGameSetup && (
        <GameSetupDialog
          onClose={() => setShowGameSetup(false)}
          onStart={(config) => handleStartGame(config)}
        />
      )}

      {/* エンジン設定ダイアログ */}
      {showSettings && (
        <EngineSettingsDialog
          options={engineOptions}
          onClose={() => setShowSettings(false)}
          onApply={(changedOpts) => {
            // パッシブモード: 別デバイスがアクティブ → 引き継ぎ確認を表示
            if (anotherDeviceActiveRef.current) { setPendingTakeoverAgentId(null); setShowTakeoverDialog(true); return; }
            socketRef.current?.emit('set_options', changedOpts);
            // ローカルの options.value も更新
            setEngineOptions(prev => prev.map(o => {
              const ch = changedOpts.find(c => c.name === o.name);
              return ch ? { ...o, value: ch.value } : o;
            }));
          }}
        />
      )}

      {/* エージェントペアリングダイアログ (?pair= URL) */}
      {pairCode && authToken && (
        <PairingDialog
          pairCode={pairCode}
          authToken={authToken}
          onDone={() => setPairCode('')}
        />
      )}

      {/* 引き継ぎ確認ダイアログ (検討/解析/対局/設定 実行時にパッシブモードで表示) */}
      {showTakeoverDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 text-gray-200">
            <h2 className="text-base font-bold mb-2">別のデバイスが使用中です</h2>
            <p className="text-sm text-gray-400 mb-5">
              現在別のデバイスがエンジンを使用中です。<br />
              このデバイスに切り替えますか？<br />
              <span className="text-xs text-gray-500">切り替えると、そちらの検討・棋譜解析が停止されます。</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowTakeoverDialog(false)}
                className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm font-semibold transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  const agentId = pendingTakeoverAgentId;
                  setShowTakeoverDialog(false);
                  setPendingTakeoverAgentId(null);
                  anotherDeviceActiveRef.current = false;
                  setAnotherDeviceActive(false);
                  socketRef.current?.emit('__take_over', agentId); // agentId は null 可 (auto-select)
                }}
                className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-semibold transition-colors"
              >
                このデバイスに切り替える
              </button>
            </div>
          </div>
        </div>
      )}


      {/* デバイス切り替え確認ダイアログ */}
      {pendingAgentSwitch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 text-gray-200">
            <h2 className="text-base font-bold mb-2">デバイスを切り替えますか？</h2>
            <p className="text-sm text-gray-400 mb-5">
              現在のデバイスでエンジンが使用中です。<br />
              <span className="text-white font-medium">{pendingAgentSwitch.agentName}</span> に切り替えると、
              実行中の検討・棋譜解析が停止されます。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setPendingAgentSwitch(null)}
                className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm font-semibold transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  const { agentId } = pendingAgentSwitch;
                  setPendingAgentSwitch(null);
                  doSwitchAgent(agentId);
                }}
                className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-semibold transition-colors"
              >
                切り替える
              </button>
            </div>
          </div>
        </div>
      )}

      {/* エージェント未接続警告 */}
      {agentWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 text-gray-200">
            <h2 className="text-lg font-bold mb-3">ローカルエージェントが必要です</h2>
            <p className="text-sm text-gray-400 mb-5">
              解析・対局機能を使用するには、ShogiAgent.exe を起動して接続してください。
              右上のエージェントアイコンから接続状況を確認できます。
            </p>
            <button
              onClick={() => setAgentWarning(false)}
              className="w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-semibold transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ドラッグリサイズ ヘルパー（マウス＆タッチ共用） ──────────────
// axis: 'x' = 水平ドラッグ（幅変更）、'y' = 垂直ドラッグ（高さ変更）
// inverted: true なら delta を逆転（上ドラッグ = 増加）
function startDrag(e, startPx, onUpdate, axis = 'x', inverted = false) {
  e.preventDefault();
  const isTouch = e.type === 'touchstart';
  const getCoord = (ev) => {
    const src = isTouch ? (ev.touches?.[0] ?? ev.changedTouches?.[0]) : ev;
    return axis === 'x' ? src.clientX : src.clientY;
  };
  const start = getCoord(e);
  const onMove = (ev) => {
    const raw = getCoord(ev) - start;
    onUpdate(Math.round(startPx + (inverted ? -raw : raw)));
  };
  const cleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', cleanup);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', cleanup);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  if (isTouch) {
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', cleanup);
  } else {
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', cleanup);
  }
}

function DragHandle({ axis, onMouseDown, style: extraStyle }) {
  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onMouseDown}
      className={`flex-shrink-0 group relative z-10 flex items-center justify-center touch-none
        transition-colors hover:bg-blue-500/30 active:bg-blue-500/50
        ${axis === 'x' ? 'cursor-col-resize' : 'cursor-row-resize'}`}
      style={{
        ...(axis === 'x' ? { width: 4 } : { height: 8 }),
        background: '#334155',
        ...extraStyle,
      }}
    >
      <div className={`absolute rounded-full bg-blue-400 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity
        ${axis === 'x' ? 'w-0.5 h-8' : 'h-1 w-10'}`} />
    </div>
  );
}

function FlyoutItem({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs w-full text-left text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
    >
      {icon}{label}
    </button>
  );
}

function SidebarAction({ icon, label, onClick, active = false, pulse = false, disabled = false }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={label}
      className={`flex flex-col items-center gap-1 w-full py-3 text-[10px] font-medium transition-colors
        ${disabled ? 'opacity-30 cursor-not-allowed' :
          active ? 'text-blue-400 bg-blue-900/30' :
          'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
    >
      <div className="relative">
        {icon}
        {pulse && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        )}
      </div>
      <span>{label}</span>
    </button>
  );
}