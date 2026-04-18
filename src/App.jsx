import { useReducer, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { createBrowserEngineAdapter, BROWSER_AGENT_ID, BROWSER_AGENT_INFO } from './engine/BrowserEngineAdapter';
import { FilePlus, Download, FolderOpen, Clipboard, FlipHorizontal2, GitBranch, Cpu, BarChart2, X, Cloud, Trash2, Loader2, TrendingUp, ChevronLeft, ChevronRight, CornerUpLeft, Eye, EyeOff, List, Share2, Settings, PenSquare, Check, Info, Swords } from 'lucide-react';
import { io as socketIO } from 'socket.io-client';
import { createWebRTCSocket } from './webrtc/bridge';
import { Navigate } from 'react-router-dom';
import AgentPanel from './components/AgentPanel';
import PairingDialog from './components/PairingDialog';
import AccountMenu from './components/AccountMenu';
import Header from './components/Header';
import ContactDialog from './components/ContactDialog';
import ShogiBoard, { BoardCore, HandColumnVertical, HandRowHorizontal, EditPalette, PieceBox, PieceBoxHorizontal } from './components/ShogiBoard';
import EvaluationMeter, { EvalBarVertical } from './components/EvaluationMeter';
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
import ShogiWarsDialog from './components/ShogiWarsDialog';
import AccountSettingsDialog from './components/AccountSettingsDialog';
import UpdateBanner from './components/UpdateBanner';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  applyMove,
  buildInitialTree, buildPositionTree, addUserMoveNode, buildTreeFromMoves,
  buildGameTree, createHandicapBoard, createInitialBoard, createInitialHands,
  canPromote, isPromoted, copyBoard, copyHands,
  getLegalMoveDestinations, getLegalDropDestinations,
  isInCheck, isCheckmate,
  findBranchPoint, getPathFromRoot,
  buildPVStates, buildPVStatesUSI,
  boardToSFEN, boardToSFENForEngine, usiMoveToJapanese, parseUSIMove,
  getPieceChar,
  detectHandicapType, HANDICAP_KIF_NAME, KIF_NAME_TO_HANDICAP,
  findKing,
} from './state/gameState';
import { parseKIF, looksLikeKIF, decodeKIFBuffer, boardToKIFLines } from './parsers/kifParser';
import TsumeWorkerClass from './engine/tsumeShogi.worker.js?worker';
import { GAME_INFO } from './data/mockData';
import { detectFormations } from './shogiFormations';
import './index.css';

// ── USI 詰み手順 → ツリー変換 ──────────────────────────────────────
function usiMovesToSolutionTree(usiMoves, board, hands, attacker) {
  const defender = attacker === 1 ? 2 : 1;
  function build(moves, b, h, isAttackerTurn) {
    if (moves.length === 0) return isAttackerTurn ? null : [];
    const parsed = parseUSIMove(moves[0]);
    if (!parsed) return isAttackerTurn ? null : [];
    const move = parsed.isDrop
      ? { from: null, to: parsed.to, promote: false, piece: parsed.piece }
      : { from: parsed.from, to: parsed.to, promote: parsed.promote };
    const player = isAttackerTurn ? attacker : defender;
    const { board: nb, hands: nh } = applyMove(b, h, move, player);
    if (isAttackerTurn) {
      const defenses = build(moves.slice(1), nb, nh, false) ?? [];
      return [{ move, defenses }];
    } else {
      const reply = build(moves.slice(1), nb, nh, true);
      return [{ defMove: move, reply: reply ?? [] }];
    }
  }
  return build(usiMoves, board, hands, true) ?? null;
}

// ── 日時文字列ヘルパー ─────────────────────────────────────────────
function nowTimeStr() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── 棋譜情報ダイアログ ───────────────────────────────────────────
function KifInfoDialog({ gameInfo, onClose, onChange }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ ...gameInfo });

  function set(key, val) { setDraft(prev => ({ ...prev, [key]: val })); }
  function setPlayer(side, field, val) {
    setDraft(prev => ({ ...prev, [side]: { ...prev[side], [field]: val } }));
  }

  const rows = [
    { label: t('app.sente'), render: () => (
      <input value={draft.sente.name} onChange={e => setPlayer('sente', 'name', e.target.value)}
        className="w-48 bg-gray-900 border border-gray-600 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
    )},
    { label: t('app.gote'), render: () => (
      <input value={draft.gote.name} onChange={e => setPlayer('gote', 'name', e.target.value)}
        className="w-48 bg-gray-900 border border-gray-600 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
    )},
    { label: t('gameInfo.startTime'), key: 'startTime' },
    { label: t('gameInfo.endTime'),   key: 'endTime' },
    { label: t('gameInfo.tournament'), key: 'event' },
    { label: t('gameInfo.opening'),   key: 'opening' },
    { label: t('gameInfo.title'),     key: 'title' },
    { label: t('gameInfo.timeControl'), key: 'timeControl' },
    { label: t('gameInfo.byoyomi'),   key: 'byoyomi' },
    { label: t('gameInfo.timeUsed'),  key: 'timeUsed' },
    { label: t('gameInfo.venue'),     key: 'site' },
    { label: t('gameInfo.source'),    key: 'source' },
    { label: t('gameInfo.notes'),     key: 'note' },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-md flex flex-col"
        style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <h2 className="text-base font-bold text-white">{t('dialog.gameRecordInfo')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-sm">
            <tbody>
              {rows.map(row => (
                <tr key={row.label} className="border-b border-gray-800">
                  <td className="py-2 pr-3 text-gray-400 whitespace-nowrap w-24">{row.label}</td>
                  <td className="py-2">
                    {row.render ? row.render() : (
                      <input value={draft[row.key] ?? ''} onChange={e => set(row.key, e.target.value)}
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700 shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors">
            {t('button.cancel')}
          </button>
          <button onClick={() => { onChange(draft); onClose(); }}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm text-white font-bold transition-colors">
            {t('button.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 将棋ウォーズ sfen_body → ゲームツリー変換 ────────────────────
function sfenBodyToTree(sfenBody) {
  const movesIdx = sfenBody.indexOf(' moves ');
  if (movesIdx === -1) return buildInitialTree();
  const usiMovesStr = sfenBody.slice(movesIdx + 7).trim();
  if (!usiMovesStr) return buildInitialTree();
  const usiMoves = usiMovesStr.split(/\s+/);
  const initialBoard = createInitialBoard();
  const initialHands = createInitialHands();
  // buildPVStatesUSI でラベル付き局面列を生成してから parsedMoves 化する
  const states = buildPVStatesUSI(usiMovesStr, initialBoard, initialHands, 1);
  const parsedMoves = usiMoves.map((usiStr, i) => {
    const mv = parseUSIMove(usiStr);
    if (!mv) return null;
    return {
      moveNumber: i + 1,
      label:      states[i + 1]?.label ?? usiStr,
      from:       mv.from,
      to:         mv.to,
      promote:    mv.promote,
      dropPiece:  mv.isDrop ? mv.piece : null,
    };
  }).filter(Boolean);
  return buildTreeFromMoves(parsedMoves);
}

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

// ── アップデートチェック用定数 ────────────────────────────────
const IS_NATIVE = !!(window.Capacitor?.isNativePlatform?.());
const ANDROID_DOWNLOAD_URL = import.meta.env.VITE_ANDROID_DOWNLOAD_URL || '';
// ANDROID_DOWNLOAD_URL からオーナー/リポジトリ と 現在タグ を取得
function parseApkUrl(downloadUrl) {
  try {
    const m = downloadUrl.match(/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\//);
    if (!m) return null;
    return { repo: m[1], currentTag: m[2] };
  } catch { return null; }
}
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
// セッション永続化 (棋譜・解析結果)
// ─────────────────────────────────────────────────────────
const SESSION_KEY = 'shogi_session_v2';
function loadSession() {
  try {
    const s = localStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────
// 初期 state
// ─────────────────────────────────────────────────────────
function makeInitState() {
  const saved = loadSession();
  if (saved?.tree) {
    return {
      ...saved.tree,
      selectedCell: null,
      dropSelected: null,
      promoteDialog: null,
      showTree: false,
    };
  }
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

    case 'START_FROM_POSITION': {
      const tree = buildPositionTree(action.board, action.hands);
      return { ...tree, selectedCell: null, dropSelected: null, promoteDialog: null, lastMove: null, showTree: false };
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
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(reducer, null, makeInitState);

  // ── 駒音 ──────────────────────────────────────────────────
  const moveAudioRef   = useRef(null);
  const prevNodesCount = useRef(0);
  useEffect(() => {
    moveAudioRef.current = new Audio('/attack.mp3');
    moveAudioRef.current.preload = 'auto';
    moveAudioRef.current.volume = 0.3;
    prevNodesCount.current = Object.keys(state.nodes).length;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const count = Object.keys(state.nodes).length;
    if (count - prevNodesCount.current === 1) {
      if (moveAudioRef.current) {
        moveAudioRef.current.currentTime = 0;
        moveAudioRef.current.play().catch(() => {});
      }
    }
    prevNodesCount.current = count;
  }, [state.nodes]);

  const [pvCandidate, setPvCandidate] = useState(null);
  const [gameInfo, setGameInfo] = useState(() => loadSession()?.gameInfo ?? GAME_INFO);
  const [kifError, setKifError] = useState(null);

  // ── エンジン状態 ──────────────────────────────────────────
  const [engineStatus, setEngineStatus]   = useState('connecting');
  const [engineMessage, setEngineMessage] = useState('');
  const [candidates, setCandidates]       = useState([]);
  const [maxDepth, setMaxDepth]           = useState(0);
  const [engineOptions, setEngineOptions] = useState([]);
  const [suisho5Ready, setSuisho5Ready]   = useState(false);
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
  const [kifTermination, setKifTermination] = useState(() => loadSession()?.kifTermination ?? null); // null | { label: string, moveNumber: number, winner: 1|2 }
  const announcedFormationsRef = useRef(new Set());
  const [formationDisplay, setFormationDisplay] = useState(null); // string | null
  const formationTimerRef = useRef(null);
  const [flipped, setFlipped]             = useState(() => loadSession()?.flipped ?? false);

  // ── 解析パネル表示状態 ──
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);

  // ── 局面編集モード ──
  const [editMode, setEditMode]           = useState(false);
  const [editBoard, setEditBoard]         = useState(null);
  const [editHands, setEditHands]         = useState(null);
  const [editBox, setEditBox]             = useState({});
  const [editHeld, setEditHeld]           = useState(null); // { pieceType, player } | null
  // スマホのダブルタップ復元用: 直前の拾い上げ情報
  const lastPickupRef = useRef(null); // { row, col, type, player, prevHeld, time }
  const [editCursorPos, setEditCursorPos] = useState(null); // { x, y } マウス追従用

  // ── 設定パネル ──
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [arrowCount, setArrowCount] = useState(() => {
    const v = parseInt(localStorage.getItem('shogi_arrow_count') ?? '4', 10);
    return isNaN(v) ? 4 : Math.min(4, Math.max(0, v));
  });

  // ── 棋譜情報ダイアログ ──
  const [showKifInfo, setShowKifInfo] = useState(false);

  // ── 将棋ウォーズ取り込みダイアログ ──
  const [showShogiWars, setShowShogiWars] = useState(false);

  // ── アップデートバナー ──
  // PWA: useRegisterSW で新しい SW が待機中かを検知
  const { needRefresh: [swNeedRefresh, setSwNeedRefresh], updateServiceWorker } = useRegisterSW();
  // APK: GitHub Releases API でビルド時刻と比較
  const [apkUpdateAvailable, setApkUpdateAvailable] = useState(false);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);

  // ── アカウント設定 ──
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [userSettings, setUserSettings] = useState({});
  const [showContactDialog, setShowContactDialog] = useState(false);

  // ── クラウド保存パネル ──
  const [showCloudPanel, setShowCloudPanel]   = useState(false);
  const [cloudKifs, setCloudKifs]             = useState(null); // null=未読込
  const [cloudSaving, setCloudSaving]         = useState(false);
  const [openFlyout, setOpenFlyout]           = useState(null); // null | 'file' | 'mobile-file'
  const [openSaveMenu, setOpenSaveMenu]       = useState(null); // null | 'desktop' | 'mobile'

  // ── モバイルドロワー ──
  const [mobileMenuOpen,    setMobileMenuOpen]    = useState(false);
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false);
  // モバイル表示切替（メニューから制御）
  const [showMobileEvalBar,    setShowMobileEvalBar]    = useState(true);
  const [showMobileEvalGraph,  setShowMobileEvalGraph]  = useState(true);
  const [showMobileCandidates, setShowMobileCandidates] = useState(true);
  const [showMobileMoveList,   setShowMobileMoveList]   = useState(false);
  const [mobileMoveListVisible, setMobileMoveListVisible] = useState(false);

  // ── パネルサイズ (ドラッグリサイズ + localStorage 永続化) ──
  const [panelSizes, setPanelSizes] = useState(() => {
    const vw  = window.visualViewport?.width  ?? window.innerWidth;
    const dvh = window.visualViewport?.height ?? window.innerHeight;
    // 盤面グリッドのデフォルト幅:
    //   盤面ブロック高さ目標 = 画面高 - ヘッダー(44) - 解析エリア最小(260)
    //   盤幅 = (目標高 - 駒台×2+プレイヤー情報×2 約152px) × 9/10
    //   最低でも画面幅の75%は確保
    const targetBoardW = Math.round((dvh - 44 - 260 - 152) * 9 / 10);
    const defaultBoardSizePx = Math.min(vw, Math.max(Math.round(vw * 0.75), targetBoardW));
    let sizes = { boardPx: 440, moveListPx: 300, candidatePx: 210, mobileSplitPx: 350, mobileBoardSizePx: defaultBoardSizePx, mobileGraphPx: 90, mobileCandidatePx: null };
    try {
      const s = localStorage.getItem('shogi_panel_sizes_v1');
      if (s) {
        const saved = JSON.parse(s);
        sizes = { ...sizes, ...saved };
        // null からの移行: 保存値が null なら計算済みデフォルトを使用
        if (sizes.mobileBoardSizePx == null) sizes.mobileBoardSizePx = defaultBoardSizePx;
      }
    } catch { /* ignore */ }
    return { ...sizes, mobileSplitPx: Math.max(calcMinMobileSplit(), sizes.mobileSplitPx) };
  });
  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem('shogi_panel_sizes_v1', JSON.stringify(panelSizes));
    }, 400);
    return () => clearTimeout(t);
  }, [panelSizes]);

  // ── 局面編集ハンドラー ──
  const PROMOTABLE_SET = new Set(['R','B','S','N','L','P']);
  const TOTAL_PIECES = { K: 2, R: 2, B: 2, G: 4, S: 4, N: 4, L: 4, P: 18 };

  const enterEditMode = useCallback(() => {
    const node = state.nodes[state.currentId];
    const board = copyBoard(node.board);
    const hands = copyHands(node.hands);
    // 盤上・持駒にない駒を駒箱に
    const used = {};
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) {
        const cell = board[r][c];
        if (cell) { const b = cell.type.startsWith('+') ? cell.type.slice(1) : cell.type; used[b] = (used[b]||0)+1; }
      }
    for (const p of [1,2])
      for (const [t,cnt] of Object.entries(hands[p]||{})) used[t] = (used[t]||0)+cnt;
    const box = {};
    for (const [t,total] of Object.entries(TOTAL_PIECES)) { const rem = total-(used[t]||0); if (rem>0) box[t]=rem; }
    setEditBoard(board);
    setEditHands(hands);
    setEditBox(box);
    setEditHeld(null);
    setEditCursorPos(null);
    setEditMode(true);
  }, [state]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setEditBoard(null);
    setEditHands(null);
    setEditBox({});
    setEditHeld(null);
    setEditCursorPos(null);
  }, []);

  const confirmEditPosition = useCallback(() => {
    dispatch({ type: 'START_FROM_POSITION', board: editBoard, hands: editHands });
    setEditMode(false);
    setEditBoard(null);
    setEditHands(null);
    setEditBox({});
    setEditHeld(null);
    setEditCursorPos(null);
  }, [editBoard, editHands]);

  const handleEditCellClick = useCallback((row, col) => {
    if (editHeld) {
      setEditBoard(prev => {
        const nb = prev.map(r => [...r]);
        nb[row][col] = { type: editHeld.pieceType, player: editHeld.player, promoted: editHeld.pieceType.startsWith('+') };
        return nb;
      });
      setEditHeld(null);
    } else {
      setEditBoard(prev => {
        const cell = prev[row]?.[col];
        if (!cell) return prev;
        const nb = prev.map(r => [...r]);
        nb[row][col] = null;
        // 前に持っていた駒を駒箱へ返す
        if (editHeld) {
          const base = editHeld.pieceType.startsWith('+') ? editHeld.pieceType.slice(1) : editHeld.pieceType;
          setEditBox(prev2 => ({ ...prev2, [base]: (prev2[base]||0)+1 }));
        }
        // ダブルタップ復元用: 拾い上げ情報を記録
        lastPickupRef.current = { row, col, type: cell.type, player: cell.player, prevHeld: editHeld, time: Date.now() };
        setEditHeld({ pieceType: cell.type, player: cell.player });
        return nb;
      });
    }
  }, [editHeld]);

  const handleEditRightClick = useCallback((row, col) => {
    setEditBoard(prev => {
      let cell = prev[row]?.[col];
      const nb = prev.map(r => [...r]);

      // スマホのダブルタップ: 1タップ目で駒が拾われてセルが空になっている場合、拾い上げをアンドゥして駒を復元
      if (!cell) {
        const lp = lastPickupRef.current;
        if (lp && lp.row === row && lp.col === col && Date.now() - lp.time < 450) {
          lastPickupRef.current = null;
          cell = { type: lp.type, player: lp.player, promoted: lp.type.startsWith('+') };
          // editHeld と editBox を元に戻す
          if (lp.prevHeld) {
            // prevHeld が駒箱に入っていたのでその分を差し引く
            const base = lp.prevHeld.pieceType.startsWith('+') ? lp.prevHeld.pieceType.slice(1) : lp.prevHeld.pieceType;
            setEditBox(prev2 => {
              const nb2 = { ...prev2 };
              nb2[base] = (nb2[base] || 0) - 1;
              if (nb2[base] <= 0) delete nb2[base];
              return nb2;
            });
            setEditHeld(lp.prevHeld);
          } else {
            setEditHeld(null);
          }
        }
      }

      if (!cell) return prev;

      const { type, player } = cell;
      const base = type.startsWith('+') ? type.slice(1) : type;
      const promoted = type.startsWith('+');

      if (base === 'K') {
        // 王・玉は消えない。相手の王が盤上に存在しない場合のみプレイヤーを反転
        const targetPlayer = player === 1 ? 2 : 1;
        const opponentHasKing = prev.some((boardRow, ri) =>
          boardRow.some((boardCell, ci) =>
            boardCell && boardCell.type === 'K' && boardCell.player === targetPlayer
            && !(ri === row && ci === col)
          )
        );
        if (!opponentHasKing) {
          nb[row][col] = { type: 'K', player: targetPlayer, promoted: false };
        } else {
          nb[row][col] = cell; // 相手の王が既にいる場合は元に戻す
        }
        return nb;
      }

      if (!promoted && PROMOTABLE_SET.has(base)) {
        nb[row][col] = { type: '+' + base, player, promoted: true };
      } else if (promoted) {
        nb[row][col] = { type: base, player: player === 1 ? 2 : 1, promoted: false };
      } else if (player === 1) {
        nb[row][col] = { type, player: 2, promoted: false };
      } else {
        nb[row][col] = null;
      }
      return nb;
    });
  }, []);

  const handleEditHandSelect = useCallback(({ player, type }) => {
    if (editHeld) {
      const baseType = editHeld.pieceType.startsWith('+') ? editHeld.pieceType.slice(1) : editHeld.pieceType;
      // 王は持駒にできないので駒箱へ
      if (baseType === 'K') {
        setEditBox(prev => ({ ...prev, K: (prev.K||0)+1 }));
        setEditHeld(null);
        return;
      }
      setEditHands(prev => {
        const nh = { 1: { ...prev[1] }, 2: { ...prev[2] } };
        nh[player][baseType] = (nh[player][baseType] || 0) + 1;
        return nh;
      });
      setEditHeld(null);
    } else {
      setEditHands(prev => {
        const nh = { 1: { ...prev[1] }, 2: { ...prev[2] } };
        if ((nh[player][type] || 0) <= 0) return prev;
        nh[player][type]--;
        if (nh[player][type] === 0) delete nh[player][type];
        // 前に持っていた駒を駒箱へ返す
        if (editHeld) {
          const base = editHeld.pieceType.startsWith('+') ? editHeld.pieceType.slice(1) : editHeld.pieceType;
          setEditBox(prev2 => ({ ...prev2, [base]: (prev2[base]||0)+1 }));
        }
        setEditHeld({ pieceType: type, player });
        return nh;
      });
    }
  }, [editHeld]);

  const handleEditHandRightClick = useCallback(({ player, type }) => {
    setEditHands(prev => {
      const nh = { 1: { ...prev[1] }, 2: { ...prev[2] } };
      if ((nh[player][type] || 0) <= 0) return prev;
      nh[player][type]--;
      if (nh[player][type] === 0) delete nh[player][type];
      return nh;
    });
  }, []);

  const handleEditMouseMove = useCallback((e) => {
    if (!editMode) return;
    setEditCursorPos({ x: e.clientX, y: e.clientY });
  }, [editMode]);

  const handleEditMouseLeave = useCallback(() => {
    setEditCursorPos(null);
  }, []);

  const handleEditHandAreaClick = useCallback((player) => {
    if (!editHeld) return;
    handleEditHandSelect({ player, type: editHeld.pieceType });
  }, [editHeld, handleEditHandSelect]);

  // 持っている駒を駒箱に返す
  const handleReturnToBox = useCallback(() => {
    if (!editHeld) return;
    const base = editHeld.pieceType.startsWith('+') ? editHeld.pieceType.slice(1) : editHeld.pieceType;
    setEditBox(prev => ({ ...prev, [base]: (prev[base]||0)+1 }));
    setEditHeld(null);
  }, [editHeld]);

  // 駒箱から駒を持ち上げる
  const handleBoxPick = useCallback((type) => {
    setEditBox(prev => {
      if ((prev[type]||0) <= 0) return prev;
      const nb = { ...prev };
      nb[type]--;
      if (nb[type] === 0) delete nb[type];
      // 前に持っていた駒を駒箱へ返す
      if (editHeld) {
        const base = editHeld.pieceType.startsWith('+') ? editHeld.pieceType.slice(1) : editHeld.pieceType;
        nb[base] = (nb[base]||0)+1;
      }
      return nb;
    });
    // 王の場合: 盤上に先手の王がいれば後手(玉)、いなければ先手(王)
    let player = 1;
    if (type === 'K' && editBoard) {
      const hasP1King = editBoard.some(r => r.some(c => c && c.type === 'K' && c.player === 1));
      if (hasP1King) player = 2;
    }
    setEditHeld({ pieceType: type, player });
  }, [editHeld, editBoard]);

  // 全部駒箱へ移動
  const handleMoveAllToBox = useCallback(() => {
    const newBox = {};
    const addToBox = (type, count=1) => { newBox[type] = (newBox[type]||0)+count; };
    if (editBoard) {
      for (let r = 0; r < 9; r++)
        for (let c = 0; c < 9; c++) {
          const cell = editBoard[r][c];
          if (cell) addToBox(cell.type.startsWith('+') ? cell.type.slice(1) : cell.type);
        }
    }
    if (editHands) {
      for (const p of [1,2])
        for (const [t,cnt] of Object.entries(editHands[p]||{})) addToBox(t, cnt);
    }
    if (editHeld) addToBox(editHeld.pieceType.startsWith('+') ? editHeld.pieceType.slice(1) : editHeld.pieceType);
    // 既存の駒箱と合算
    for (const [t,cnt] of Object.entries(editBox||{})) addToBox(t, cnt);
    setEditBoard(Array(9).fill(null).map(() => Array(9).fill(null)));
    setEditHands({ 1: {}, 2: {} });
    setEditBox(newBox);
    setEditHeld(null);
  }, [editBoard, editHands, editBox, editHeld]);

  // 平手配置
  const handleFlatHand = useCallback(() => {
    setEditBoard(createInitialBoard());
    setEditHands(createInitialHands());
    setEditBox({});
    setEditHeld(null);
  }, []);

  // 詰将棋配置: 後手玉を5一に、残り駒を後手持駒へ（先手王は駒箱）
  const handleTsumeSetup = useCallback(() => {
    const newBoard = Array(9).fill(null).map(() => Array(9).fill(null));
    newBoard[0][4] = { type: 'K', player: 2, promoted: false }; // 後手玉を5一
    setEditBoard(newBoard);
    setEditHands({ 1: {}, 2: { R: 2, B: 2, G: 4, S: 4, N: 4, L: 4, P: 18 } });
    setEditBox({ K: 1 }); // 先手王は駒箱へ
    setEditHeld(null);
  }, []);

  const handleEditPalettePick = useCallback((pieceType, player) => {
    setEditHeld(prev => (prev?.pieceType === pieceType && prev?.player === player) ? null : { pieceType, player });
  }, []);

  // ── 設定の永続化 ──
  useEffect(() => { localStorage.setItem('shogi_arrow_count', String(arrowCount)); }, [arrowCount]);

  // ── セッション保存 (棋譜・解析結果の永続化) ──
  useEffect(() => {
    const t = setTimeout(() => {
      const { nodes, rootId, mainLineIds, currentId, lastMove } = state;
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          tree: { nodes, rootId, mainLineIds, currentId, lastMove },
          gameInfo,
          kifTermination,
          flipped,
        }));
      } catch { /* storage quota exceeded 等 */ }
    }, 500);
    return () => clearTimeout(t);
  }, [state, gameInfo, kifTermination, flipped]);

  // ── 盤面コンテナ高さ監視（dvh 依存を排除してコンテナサイズ基準にする） ──
  const boardColumnRef  = useRef(null);
  const [boardColumnH,  setBoardColumnH]  = useState(0);
  // デスクトップ: 盤面以外の要素（対局者名・navArea）の実高さを計測して盤サイズを最大化
  const boardPlayerRef  = useRef(null);
  const [boardPlayerH,  setBoardPlayerH]  = useState(0);
  const boardNavAreaRef = useRef(null);
  const [boardNavAreaH, setBoardNavAreaH] = useState(0);
  const mobileTopRef       = useRef(null);
  const mobileBoardRef     = useRef(null);
  const mobileCandidatesRef = useRef(null);
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

  // 起動時トークン検証: 期限切れなら削除、7日以内に期限切れなら自動リフレッシュ
  useEffect(() => {
    const token = localStorage.getItem('shogi_jwt');
    if (!token || token === '__local__') return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        // 期限切れ → ログアウト
        localStorage.removeItem('shogi_jwt');
        setAuthToken('');
        return;
      }
      // 7日以内に期限切れ → 自動リフレッシュ
      if (payload.exp && payload.exp - now < 7 * 24 * 3600) {
        fetch(`${CLOUD_API}/auth/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.token) {
              localStorage.setItem('shogi_jwt', data.token);
              setAuthToken(data.token);
            }
          })
          .catch(() => {});
      }
    } catch { /* JWT解析失敗 = 不正トークン → 何もしない */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android APK アップデートチェック (Capacitor ネイティブ環境のみ)
  useEffect(() => {
    if (!IS_NATIVE || !ANDROID_DOWNLOAD_URL) return;
    const parsed = parseApkUrl(ANDROID_DOWNLOAD_URL);
    if (!parsed) return;
    const { repo, currentTag } = parsed;
    fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.tag_name) return;
        // 最新リリースのタグが現在インストール済みのタグと異なれば更新あり
        if (data.tag_name !== currentTag) setApkUpdateAvailable(true);
      })
      .catch(() => {});
  }, []);

  // ログイン状態になったらサーバーからユーザー設定を取得
  useEffect(() => {
    if (!authToken || authToken === '__local__') return;
    fetch(`${CLOUD_API}/api/settings`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.ok) setUserSettings(data.settings ?? {}); })
      .catch(() => {});
  }, [authToken]);

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
  // WebRTC ネットワーク非対応エラー
  const [webrtcNetworkError, setWebrtcNetworkError] = useState(false);
  const [showWebrtcErrorDetail, setShowWebrtcErrorDetail] = useState(false);
  const iceFailCountRef = useRef(0);
  // 棋譜共有
  const [shareUrl, setShareUrl]         = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied]   = useState(false);
  // 詰将棋共有
  const [tsumeUrl, setTsumeUrl]                   = useState(null);
  const [tsumeLoading, setTsumeLoading]           = useState(false);
  const [tsumeCopied, setTsumeCopied]             = useState(false);
  const [tsumeProgress, setTsumeProgress]         = useState(null); // { currentDepth, maxDepth } | null
  const [showTsumeTitleDialog, setShowTsumeTitleDialog] = useState(false);
  const [tsumeTitle, setTsumeTitle]               = useState('');
  const [tsumeVisibility, setTsumeVisibility]     = useState('public');   // 'public' | 'unlisted'
  const [tsumeDescription, setTsumeDescription]  = useState('');
  const tsumeWorkerRef                            = useRef(null);
  // 共有棋譜一覧
  const [showShares, setShowShares]     = useState(false);
  const [shareList, setShareList]       = useState([]);
  const [shareListLoading, setShareListLoading] = useState(false);
  const [shareListCopied, setShareListCopied]   = useState(null); // token

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
  const tsumeCallbackRef    = useRef(null); // 詰将棋解析コールバック (engine path)
  const tsumePVRef          = useRef([]);   // go mate → bestmove 応答時の PV 復元用 (ローカルエージェント対応)
  const tsumeContextRef     = useRef(null); // { board, hands, postFn } — isMate検出時にJSソルバーへ切り替えるため

  // ── 指し手一覧ボトムシート開閉ヘルパー ──
  const openMobileMoveList = useCallback(() => {
    // メニューが開いていれば即閉じる（競合防止）
    setMobileMenuOpen(false);
    setMobileMenuVisible(false);
    setShowMobileMoveList(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setMobileMoveListVisible(true)));
  }, []);

  const closeMobileMoveList = useCallback(() => {
    setMobileMoveListVisible(false);
    setTimeout(() => setShowMobileMoveList(false), 220);
  }, []);

  // ── モバイルメニュー開閉ヘルパー ──
  const openMobileMenu = useCallback(() => {
    // 指し手一覧が開いていれば即閉じる（競合防止）
    setShowMobileMoveList(false);
    setMobileMoveListVisible(false);
    setMobileMenuOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setMobileMenuVisible(true)));
  }, []);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuVisible(false);
    setTimeout(() => {
      setMobileMenuOpen(false);
      setShowCloudPanel(false);
      setShowAnalysisPanel(false);
      setOpenFlyout(null);
      setOpenSaveMenu(null);
    }, 220);
  }, []);

  // ── KIF テキストをパースして読み込む ──
  const loadKifText = useCallback((text) => {
    setKifError(null);
    setKifTermination(null);
    const { moves, gameInfo: gi, initialBoard, initialHands, goteFirst } = parseKIF(text);

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

    if (moves.length === 0 && !resolvedBoard) {
      setKifError(t('error.kifParsingFailed'));
      return;
    }
    const tree = buildTreeFromMoves(
      moves,
      { board: resolvedBoard ?? null, hands: resolvedHands ?? null, goteFirst },
    );

    // KIF テキストから終局情報（投了・中断・詰みなど）を検出して保存
    // buildTreeFromMoves は盤面変化のない終局手をノード化しないため、
    // テキストから直接パースして kifTermination state に保持する
    const terminationMatch = text.match(
      /^\s*\d+\s*(投了|中断|詰み|千日手|持将棋|切れ負け|反則勝ち|反則負け|入玉勝ち|不戦勝|不戦敗|不詰)/m
    );
    const terminationLabel = terminationMatch?.[1] ?? null;
    if (terminationLabel) {
      const totalMoves = tree.mainLineIds.length - 1;
      // 次の手番プレイヤー（= terminationが起きた時点での手番）
      const nextPlayer  = totalMoves % 2 === 0 ? 1 : 2;
      // 直前に指したプレイヤー
      const justMoved   = nextPlayer === 1 ? 2 : 1;

      let winner = null;
      if (['投了', '切れ負け', '反則負け'].includes(terminationLabel)) {
        // 手番側が負ける → 相手の勝ち
        winner = nextPlayer === 1 ? 2 : 1;
      } else if (terminationLabel === '反則勝ち') {
        // 直前の指し手が反則 → 指した側の相手（= nextPlayer）の勝ち
        winner = nextPlayer;
      } else if (terminationLabel === '詰み') {
        // 手番側が詰んでいる → 相手の勝ち
        winner = nextPlayer === 1 ? 2 : 1;
      } else if (terminationLabel === '入玉勝ち') {
        // 手番側が入玉宣言で勝ち
        winner = nextPlayer;
      } else if (terminationLabel === '不戦勝') {
        winner = 1; // 先手（上手）の勝ち
      } else if (terminationLabel === '不戦敗') {
        winner = 2; // 先手（上手）の負け → 後手の勝ち
      }
      // 千日手・持将棋・中断・不詰 → winner = null (引き分け/中断)

      setKifTermination({ label: terminationLabel, moveNumber: totalMoves + 1, winner });
    }

    dispatch({ type: 'LOAD_KIF', tree });
    setGameInfo({
      sente:       { name: gi.senteName || '先手', mark: '▲', time: '0:00:00' },
      gote:        { name: gi.goteName  || '後手', mark: '△', time: '0:00:00' },
      startTime:   gi.startTime   ?? '',
      endTime:     gi.endTime     ?? '',
      event:       gi.event       ?? '',
      opening:     gi.opening     ?? '',
      title:       gi.title       ?? '',
      timeControl: gi.timeControl ?? '',
      byoyomi:     gi.byoyomi     ?? '',
      timeUsed:    gi.timeUsed    ?? '',
      site:        gi.site        ?? '',
      source:      gi.source      ?? '',
      note:        gi.note        ?? '',
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
      setKifError(t('error.kifPartialLoadFailure', { moveNumber: tree.parseError, prevMoveNumber: tree.parseError - 1 }));
    }
  }, []);

  // ── ファイルから読み込む ──
  const handleLoadFile = useCallback(async (file) => {
    const text = await readFileText(file);
    loadKifText(text);
  }, [loadKifText]);

  // ── 将棋ウォーズ棋譜を読み込む ──
  const loadShogiWarsGame = useCallback((record) => {
    setKifError(null);
    setKifTermination(null);
    const tree = sfenBodyToTree(record.sfen_body ?? '');
    dispatch({ type: 'LOAD_KIF', tree });

    const blackName = record.player_info?.black?.name ?? '先手';
    const whiteName = record.player_info?.white?.name ?? '後手';

    // 勝者を先後から判定
    const bm = record.memberships?.find(m => m.location_key === 'black');
    const wm = record.memberships?.find(m => m.location_key === 'white');
    const winner = bm?.judge_key === 'win' ? 1 : wm?.judge_key === 'win' ? 2 : null;

    const finalName = record.final_info?.name ?? '';
    if (finalName) {
      setKifTermination({ label: finalName, moveNumber: record.turn_max, winner });
    }

    // battled_at: "2026-03-31T16:04:42.000+09:00" → "2026/03/31 16:04:42"
    const d = new Date(record.battled_at ?? '');
    const p = n => String(n).padStart(2, '0');
    const startTime = isNaN(d)
      ? (record.battled_at ?? '')
      : `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;

    setGameInfo({
      sente:       { name: blackName, mark: '▲', time: '0:00:00' },
      gote:        { name: whiteName, mark: '△', time: '0:00:00' },
      startTime,
      endTime:     '',
      event:       record.xmode_info?.name ?? '',
      opening:     '',
      title:       record.title ?? '',
      timeControl: record.rule_info?.name ?? '',
      byoyomi:     '',
      timeUsed:    '',
      site:        '将棋ウォーズ',
      source:      '',
      note:        '',
    });
    setShowShogiWars(false);
  }, []);

  // ── クリップボードから貼り付け ──
  const handlePasteKif = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { setKifError(t('error.clipboardEmpty')); return; }
      loadKifText(text);
    } catch {
      setKifError(t('error.clipboardAccessDenied'));
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
      // ブラウザエンジン選択中は bridge 経由のイベントを無視（ブラウザアダプター側が管理）
      if (selectedAgentIdRef.current === BROWSER_AGENT_ID) return;
      setEngineStatus(status);
      if (message) setEngineMessage(message);
      // ローカルエージェントが go mate に対して bestmove を返した場合、
      // checkmate イベントが来ないまま standby に戻る。
      // その場合は engine:info で蓄積した PV を使って tsume:solution を代替する。
      if (status === 'standby' && tsumeCallbackRef.current) {
        const pv = tsumePVRef.current;
        tsumePVRef.current = [];
        if (pv.length > 0) {
          tsumeCallbackRef.current({ found: true, moves: pv });
        }
        // pv が空の場合は tsume:failed が別途来るはず。来なければキャンセル扱いにしない
        // (ユーザーが手動キャンセルした場合は tsumeCallbackRef.current = null になっている)
      }
    });

    s.on('engine:info', (data) => {
      const idx = (data.multipv ?? 1) - 1;
      candMapRef.current[idx] = data;
      const arr = Object.values(candMapRef.current).sort((a, b) => a.multipv - b.multipv);
      candidatesRef.current = arr;

      // 詰将棋解析中に isMate の info が来た時点でエンジンを止め、JS ソルバーへ切り替える。
      // ローカルエージェントは go mate に対して checkmate ではなく bestmove を返すため
      // tsume:solution が来ない。mateIn が確定した瞬間に対処する。
      // 修正後
if (tsumeCallbackRef.current && data.isMate && data.mateIn != null && data.mateIn > 0) {
  socketRef.current?.emit('stop');
  tsumeCallbackRef.current = null;
  tsumePVRef.current = [];

  // ★ mateIn確定時点でオーバーレイを即座に閉じる
  //    候補手/読み筋にはすでに詰み手順が表示されているので待つ必要はない
  setTsumeProgress(null);

  const ctx = tsumeContextRef.current;
  tsumeContextRef.current = null;
  if (ctx && !tsumeWorkerRef.current) {
    // 共有リンク用の正確な手順ツリーを JS ソルバーで取得（バックグラウンド）
    const w = new TsumeWorkerClass();
    tsumeWorkerRef.current = w;
    w.onmessage = async ({ data: d }) => {
      if (d.type === 'solution') {
        w.terminate();
        tsumeWorkerRef.current = null;
        // setTsumeProgress(null) は上で既に呼び済み
        setTsumeLoading(false);
        try { await ctx.postFn(d.solution, d.numMoves); }
        catch (e) { alert(`詰将棋共有エラー: ${e.message}`); }
      } else if (d.type === 'failed') {
        w.terminate();
        tsumeWorkerRef.current = null;
        setTsumeLoading(false);
        alert('解が見つかりませんでした');
      }
      // progress メッセージはオーバーレイが消えたので更新不要
    };
    w.onerror = (e) => {
      w.terminate();
      tsumeWorkerRef.current = null;
      setTsumeLoading(false);
      alert(`解析エラー: ${e.message}`);
    };
    w.postMessage({ cmd: 'solve', board: ctx.board, hands: ctx.hands, attacker: 1, maxMoves: data.mateIn });
  } else {
    // ctx が null（ありえないはずだが念のため）
    setTsumeLoading(false);
  }
}

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

    s.on('engine:options', (opts) => {
      setEngineOptions(opts);
      if (opts.suisho5Ready !== undefined) setSuisho5Ready(opts.suisho5Ready);
    });

    s.on('connect_error', (err) => {
      // ブラウザエンジン選択中は bridge の接続エラーを無視
      if (selectedAgentIdRef.current === BROWSER_AGENT_ID) return;
      setEngineStatus('error');
      setAutoAnalysisStatus('idle');
      setAutoAnalysisProgress(null);
      setIsAnalyzing(false);
      setIsAiThinking(false);
      // ICE 失敗が続いた場合はネットワーク非対応と判定
      if (import.meta.env.VITE_USE_WEBRTC === 'true' && err?.message?.startsWith('ICE')) {
        iceFailCountRef.current += 1;
        if (iceFailCountRef.current >= 3) setWebrtcNetworkError(true);
      }
    });

    s.on('connect', () => {
      iceFailCountRef.current = 0;
      setWebrtcNetworkError(false);
    });

    // JWT 期限切れ: ログイン画面に戻す
    s.on('auth_error', () => {
      localStorage.removeItem('shogi_jwt');
      setAuthToken('');
    });

    // 別デバイスがローカルエージェントを占有 → ブラウザエンジンに自動切り替え
    function switchToBrowserOnPassive() {
      // リモートエージェントを使用中なら停止コマンドを送る
      if (selectedAgentIdRef.current !== BROWSER_AGENT_ID) {
        s.emit('stop_and_standby');
      }
      anotherDeviceActiveRef.current = true;
      setAnotherDeviceActive(true);
      // ブラウザエンジンに自動切り替え
      selectedAgentIdRef.current = BROWSER_AGENT_ID;
      setSelectedAgentId(BROWSER_AGENT_ID);
      setEngineOptions([]);
      setCandidates([]);
      setEngineMessage('');
      setEngineStatus('standby');
      setAutoAnalysisStatus('idle');
      setAutoAnalysisProgress(null);
      setIsAnalyzing(false);
      setIsAiThinking(false);
      // browserAdapter はこの useEffect 内で後から初期化されるが、
      // イベントが発火する時点では初期化済み (クロージャ参照)
      browserAdapter.emit('__select_agent', BROWSER_AGENT_ID);
    }

    // 同一アカウントで別ブラウザが接続中 → ブラウザエンジンへ自動切り替え
    s.on('another_device_active', switchToBrowserOnPassive);

    // 別デバイスに引き継がれた → ブラウザエンジンへ自動切り替え
    // connectedAgents は消さない — 再接続後に agent:connected で復元されるまで表示を維持
    s.on('taken_over', switchToBrowserOnPassive);

    // アクティブ frontend が切断しこのデバイスが自動昇格 → パッシブ解除
    s.on('device_activated', () => {
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
    s.on('tsume:progress', ({ mateIn }) => {
      setTsumeProgress(prev => prev?.engine ? { ...prev, currentDepth: mateIn } : prev);
    });
    s.on('tsume:solution', ({ moves }) => {
      if (tsumeCallbackRef.current) tsumeCallbackRef.current({ found: true, moves });
    });
    s.on('tsume:failed', () => {
      if (tsumeCallbackRef.current) tsumeCallbackRef.current({ found: false });
    });

    s.on('ai:bestmove', ({ move }) => {
      aiThinkStartRef.current = null;
      setIsAiThinking(false);
      if (!move || move === '(none)' || move === 'resign') {
        // AI が投了 — 人間側の勝ち
        const aiPlayer = analyzingPlayerRef.current;
        const humanWinner = aiPlayer === 1 ? 2 : 1;
        setGameResult({ winner: humanWinner, reason: 'AI 投了' });
        setKifTermination({ label: '投了', moveNumber: mainLineIdsRef.current.length, winner: humanWinner });
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

    // ── ブラウザエンジンを仮想エージェントとして常時登録 ──
    const browserAdapter = createBrowserEngineAdapter();
    // ブラウザエンジンからのイベントを App と同じリスナーに転送
    browserAdapter.on('engine:status',          d => handleBrowserEvent('engine:status', d));
    browserAdapter.on('engine:info',            d => handleBrowserEvent('engine:info', d));
    browserAdapter.on('engine:bestmove',        d => handleBrowserEvent('engine:bestmove', d));
    browserAdapter.on('engine:options',         d => handleBrowserEvent('engine:options', d));
    browserAdapter.on('ai:bestmove',            d => handleBrowserEvent('ai:bestmove', d));
    browserAdapter.on('auto_analysis:result',   d => handleBrowserEvent('auto_analysis:result', d));
    browserAdapter.on('auto_analysis:progress', d => handleBrowserEvent('auto_analysis:progress', d));
    browserAdapter.on('auto_analysis:complete', d => handleBrowserEvent('auto_analysis:complete', d));
    browserAdapter.on('auto_analysis:stopped',  d => handleBrowserEvent('auto_analysis:stopped', d));

    function handleBrowserEvent(event, data) {
      // ブラウザエンジンが選択されているときだけ転送
      if (selectedAgentIdRef.current !== BROWSER_AGENT_ID) return;
      switch (event) {
        case 'engine:status':          setEngineStatus(data.status); setEngineMessage(data.message ?? ''); break;
        case 'engine:info': {
          const idx = (data.multipv ?? 1) - 1;
          candMapRef.current[idx] = data;
          const arr = Object.values(candMapRef.current).sort((a,b) => a.multipv - b.multipv);
          candidatesRef.current = arr;
          const isGamePlaying = gameModeRef.current === 'playing';
          const shouldHide    = isGamePlaying && gameConfigRef.current?.hideInfo;
          if (!shouldHide) { setCandidates(arr); setMaxDepth(prev => data.depth > prev ? data.depth : prev); }
          break;
        }
        case 'engine:bestmove':        break; // 検討中は無視
        case 'engine:options':         setEngineOptions(data); if (data.suisho5Ready !== undefined) setSuisho5Ready(data.suisho5Ready); break;
        case 'ai:bestmove': {
          aiThinkStartRef.current = null; setIsAiThinking(false);
          if (!data.move || data.move === '(none)' || data.move === 'resign') {
            const aiPlayer = analyzingPlayerRef.current;
            const humanWinner = aiPlayer === 1 ? 2 : 1;
            setGameResult({ winner: humanWinner, reason: 'AI 投了' });
            setKifTermination({ label: '投了', moveNumber: mainLineIdsRef.current.length, winner: humanWinner });
            setGameMode('ended');
          } else {
            const parsed = parseUSIMove(data.move);
            if (parsed) dispatch({ type: 'APPLY_AI_MOVE', move: parsed });
            else setGameMode('ended');
          }
          break;
        }
        case 'auto_analysis:result': {
          const nodeId = mainLineIdsRef.current[data.moveIndex];
          if (nodeId) { dispatch({ type: 'UPDATE_EVAL', nodeId, evalScore: data.evalScore, candidates: data.candidates ?? null }); dispatch({ type: 'NAVIGATE_TO', nodeId }); }
          break;
        }
        case 'auto_analysis:progress': setAutoAnalysisProgress({ current: data.current, total: data.total, depth: data.depth ?? 0 }); break;
        case 'auto_analysis:complete': setAutoAnalysisStatus('complete'); setAutoAnalysisProgress(prev => ({ ...(prev??{}), current: data.total, total: data.total })); break;
        case 'auto_analysis:stopped':  setAutoAnalysisStatus('idle'); break;
        case 'tsume:solution':
        case 'tsume:failed':
          // エージェント選択に関係なく常にコールバックを呼ぶ (ガード外で処理)
          break;
        default: break;
      }
    }

    // tsume イベントはエージェント選択に関係なく常に処理する
    browserAdapter.on('tsume:progress', ({ mateIn }) => {
      setTsumeProgress(prev => prev?.engine ? { ...prev, currentDepth: mateIn } : prev);
    });
    browserAdapter.on('tsume:solution', d => {
      if (tsumeCallbackRef.current) tsumeCallbackRef.current({ found: true, moves: d.moves });
    });
    browserAdapter.on('tsume:failed', () => {
      if (tsumeCallbackRef.current) tsumeCallbackRef.current({ found: false });
    });

    // ブラウザエンジンをリストに追加
    setConnectedAgents(prev => prev.some(a => a.agentId === BROWSER_AGENT_ID) ? prev : [...prev, BROWSER_AGENT_INFO]);
    const browserAdapterRef = { current: browserAdapter };

    // socketRef のラッパー: 選択エージェントに応じて送信先を切り替える
    const origEmit = s.emit.bind(s);
    s.emit = function(event, data) {
      // __take_over は常に bridge へ（ブラウザエンジン選択中でもサーバーに届ける）
      if (event === '__take_over') {
        origEmit(event, data);
        return;
      }
      if (selectedAgentIdRef.current === BROWSER_AGENT_ID) {
        browserAdapterRef.current.emit(event, data);
      } else {
        origEmit(event, data);
      }
    };

    return () => {
      browserAdapter.disconnect();
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

  // 対局開始/終了時刻を gameInfo に記録
  useEffect(() => {
    if (gameMode === 'playing') {
      setGameInfo(prev => ({ ...prev, startTime: nowTimeStr(), endTime: '' }));
    } else if (gameMode === 'ended') {
      setGameInfo(prev => ({ ...prev, endTime: nowTimeStr() }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode]);

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
      setKifTermination({ label: '詰み', moveNumber: state.mainLineIds.length, winner });
      setGameMode('ended');
      socketRef.current?.emit('stop_ai_think');
      socketRef.current?.emit('restart_engine');
      setIsAiThinking(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentId, gameMode]);

  // ── 囲い・戦型検出 → 音声 + テキストアナウンス ─────────────────
  useEffect(() => {
    if (gameMode !== 'playing') return;
    const node = state.nodes[state.currentId];
    if (!node || node.moveNumber < 3) return;

    const formations = detectFormations(node.board, node.hands);
    const newOnes = formations.filter(f => !announcedFormationsRef.current.has(f));
    if (newOnes.length === 0) return;

    newOnes.forEach(f => {
      announcedFormationsRef.current.add(f);
      if (window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(f);
        utter.lang = 'ja-JP';
        window.speechSynthesis.speak(utter);
      }
    });

    // テキストオーバーレイ: 最初の新フォーメーションを2秒表示
    const displayName = newOnes[0];
    setFormationDisplay(displayName);
    if (formationTimerRef.current) clearTimeout(formationTimerRef.current);
    formationTimerRef.current = setTimeout(() => {
      setFormationDisplay(null);
      formationTimerRef.current = null;
    }, 2000);
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
    const sfen = boardToSFENForEngine(node.board, node.hands, activePlayer, node.moveNumber);
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
    // ※ 自動解析中は auto_analysis:result が正しいデータを保存するので、
    //   ここでは上書きしない（engine:info の「次局面」データで汚染されるのを防ぐ）
    const prevId = currentIdRef.current;
    if (prevId && candidatesRef.current.length > 0 && autoAnalysisStatus !== 'running') {
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
    const sfen = boardToSFENForEngine(node.board, node.hands, player, node.moveNumber);

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

  // ── 候補手矢印（ライブ候補手 → 保存済み候補手の順で参照、最大4手）──
  const candidateArrows = useMemo(() => {
    const src = candidates.length > 0 ? candidates : (currentNode?.savedCandidates ?? []);
    if (!src.length) return [];

    const LABELS = ['最', '次', '3', '4'];
    const fullWidth  = { '１':1,'２':2,'３':3,'４':4,'５':5,'６':6,'７':7,'８':8,'９':9 };
    const kanjiRow   = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
    const kanjiPiece = { '歩':'P','香':'L','桂':'N','銀':'S','金':'G','角':'B','飛':'R' };

    const sorted = [...src].sort((a, b) => (a.multipv ?? 99) - (b.multipv ?? 99)).slice(0, arrowCount);
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
  }, [candidates, currentNode, isAnalyzing, arrowCount]);

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

  const userId = useMemo(() => {
    if (!authToken || authToken === '__local__') return null;
    try { return JSON.parse(atob(authToken.split('.')[1])).userId || null; }
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
    setEngineMessage('');
    // ブラウザエンジンはローカルWorkerなので 'connecting' にしない
    // (ダウンロード中なら adapter 側が connecting に変更する)
    setEngineStatus(agentId === BROWSER_AGENT_ID ? 'standby' : 'connecting');
    setAutoAnalysisStatus('idle');
    setAutoAnalysisProgress(null);
    setIsAnalyzing(false);
    setIsAiThinking(false);
    s?.emit('__select_agent', agentId);
    // ブラウザエンジンの場合: MultiPV を同期して engine:options を即座に発火させる
    // (setEngineOptions([]) と同じバッチ内で setEngineOptions(options) が呼ばれ最終値が正しくなる)
    s?.emit('set_options', [{ name: 'MultiPV', value: String(multiPV) }]);
  }

  // エージェント選択 (ユーザーが AgentPanel で選択)
  function handleSelectAgent(agentId) {
    if (!anotherDeviceActiveRef.current && agentId === selectedAgentId) return;
    // パッシブモード: ブラウザエンジンはローカルなので引き継ぎ不要 → 直接切り替え
    // ローカルエージェントへの切り替えは引き継ぎ確認を表示
    if (anotherDeviceActiveRef.current && agentId !== BROWSER_AGENT_ID) {
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
    setUserSettings({});
  }

  // ユーザー設定をサーバーに保存
  const saveUserSettings = useCallback(async (patch) => {
    const res = await fetch(`${CLOUD_API}/api/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data?.ok) setUserSettings(data.settings ?? {});
  }, [authToken]);

  const handleStartAutoAnalysis = useCallback((condition, rangeFrom, rangeTo) => {
    if (!requireAgent()) return false;
    const s = socketRef.current;
    if (!s) return false;
    // 指定範囲の局面 SFEN リストを構築
    const slicedIds = state.mainLineIds.slice(rangeFrom, rangeTo + 1);
    const positions = slicedIds.map((id, i) => {
      const node = state.nodes[id];
      const player = node.moveNumber % 2 === 0 ? 1 : 2;
      const sfen = boardToSFENForEngine(node.board, node.hands, player, node.moveNumber);
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
    // プレイヤー名を設定 (human → '先手'/'後手', CPU → エンジン名)
    const agentName = connectedAgents.find(a => a.agentId === selectedAgentId)?.name ?? 'CPU';
    const senteName = config.players[1].type === 'human' ? '先手' : agentName;
    const goteName  = config.players[2].type === 'human' ? '後手' : agentName;
    setGameInfo(prev => ({ ...prev, sente: { ...prev.sente, name: senteName }, gote: { ...prev.gote, name: goteName } }));
    setGameMode('playing');
    setGameResult(null);
    setKifTermination(null);
    setIsAiThinking(false);
    setIsAnalyzing(false);
    setAutoAnalysisStatus('idle');
    // 囲い・戦型アナウンス初期化
    announcedFormationsRef.current = new Set();
    if (formationTimerRef.current) { clearTimeout(formationTimerRef.current); formationTimerRef.current = null; }
    setFormationDisplay(null);
    setShowGameSetup(false);
  }, [connectedAgents, selectedAgentId]);

  const handleResign = useCallback(() => {
    socketRef.current?.emit('stop_ai_think');
    socketRef.current?.emit('restart_engine');
    setIsAiThinking(false);
    const winner = activePlayer === 1 ? 2 : 1;
    setGameResult({ winner, reason: '投了' });
    setKifTermination({ label: '投了', moveNumber: state.mainLineIds.length, winner });
    setGameMode('ended');
  }, [activePlayer, state.mainLineIds.length]);

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
      startTime: '', endTime: '', event: '', opening: '', title: '',
      timeControl: '', byoyomi: '', timeUsed: '', site: '', source: '', note: '',
    });
  }, []);

  // ── KIF テキスト生成（保存・クラウド共通） ──
  const buildKifContent = useCallback((withEval) => {
    const nodes = state.nodes;
    const ids   = state.mainLineIds;
    const now   = new Date();
    const pad2  = n => String(n).padStart(2, '0');
    const date  = `${now.getFullYear()}/${pad2(now.getMonth()+1)}/${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

    // 初期局面が平手か判定
    const rootNode  = nodes[ids[0]];
    const rootBoard = rootNode?.board;
    const rootHands = rootNode?.hands;
    // 平手・駒落ち・詰将棋(カスタム) を判定
    const handicapType = detectHandicapType(rootBoard, rootHands); // 'even' | 'rook' | ... | null

    const startTimeStr = gameInfo.startTime || date;
    const lines = ['# Generated by ShogiAnalytics', `開始日時：${startTimeStr}`];
    if (gameInfo.endTime)     lines.push(`終了日時：${gameInfo.endTime}`);
    if (gameInfo.event)       lines.push(`棋戦：${gameInfo.event}`);
    if (gameInfo.opening)     lines.push(`戦型：${gameInfo.opening}`);
    if (gameInfo.title)       lines.push(`表題：${gameInfo.title}`);
    if (gameInfo.timeControl) lines.push(`持ち時間：${gameInfo.timeControl}`);
    if (gameInfo.byoyomi)     lines.push(`秒読み：${gameInfo.byoyomi}`);
    if (gameInfo.timeUsed)    lines.push(`消費時間：${gameInfo.timeUsed}`);
    if (gameInfo.site)        lines.push(`場所：${gameInfo.site}`);
    if (gameInfo.source)      lines.push(`掲載：${gameInfo.source}`);
    if (gameInfo.note)        lines.push(`備考：${gameInfo.note}`);
    if (handicapType === 'even' || !rootBoard) {
      // 平手
      lines.push('手合割：平手');
      lines.push(`先手：${gameInfo.sente.name}`, `後手：${gameInfo.gote.name}`);
    } else if (handicapType) {
      // 駒落ち: 上手(player2=後手=駒を渡す側) / 下手(player1=先手=駒をもらう側)
      lines.push(`手合割：${HANDICAP_KIF_NAME[handicapType]}`);
      lines.push(`上手：${gameInfo.gote.name}`, `下手：${gameInfo.sente.name}`);
    } else {
      // 詰将棋 or カスタム初期局面: 盤面図 + 先手/後手
      lines.push(...boardToKIFLines(rootBoard, rootHands));
      lines.push(`先手：${gameInfo.sente.name}`, `後手：${gameInfo.gote.name}`);
    }
    lines.push('手数----指手---------消費時間--');

    // 現在の局面のライブ候補手を保存 (まだ dispatch されていないものを KIF に含める)
    const liveNodeId = state.currentId;
    const liveCands  = candidatesRef.current.length > 0 ? candidatesRef.current.slice() : null;
    // ノードの候補手を取得: 現在の局面ならライブ優先、それ以外は保存済みを使う
    const getCands = (nodeId, node) => {
      if (nodeId === liveNodeId && liveCands) return liveCands;
      return node?.savedCandidates ?? null;
    };

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

      // 各手の前の局面の候補手を出力 (ライブ優先)
      if (withEval) appendCandidates(getCands(ids[i - 1], parentNode), parentNode);

      // 打ち駒は移動元座標なし（打 で明示済み）、通常手は (FC) 形式
      const fromStr = node.moveFrom
        ? `(${9 - node.moveFrom[1]}${node.moveFrom[0] + 1})`
        : '';
      lines.push(`${String(i).padStart(4)} ${node.label ?? '？'}${fromStr}   ( 0:00/00:00:00)`);
    }

    // 最後の局面 (末尾ノード) の候補手も出力
    if (withEval && ids.length > 0) {
      const lastId   = ids[ids.length - 1];
      const lastNode = nodes[lastId];
      if (lastNode) appendCandidates(getCands(lastId, lastNode), lastNode);
    }

    // 終局手を追加
    if (kifTermination?.label) {
      const label = kifTermination.label;
      const winner = kifTermination.winner;
      const moveCount = ids.length - 1;

      // 千日手は消費時間 0
      const timeStr = label === '千日手' ? ' ( 0:00/ 0:00:00)' : '   ( 0:00/00:00:00)';
      lines.push(`${String(ids.length).padStart(4)} ${label}${timeStr}`);

      // 引き分け・中断系
      const drawLabels = new Set(['千日手', '持将棋', '中断', '不詰']);
      if (drawLabels.has(label)) {
        lines.push(`まで${moveCount}手で${label}`);
      } else if (label === '不戦勝') {
        lines.push(`まで${moveCount}手で先手の不戦勝`);
      } else if (label === '不戦敗') {
        lines.push(`まで${moveCount}手で先手の不戦敗`);
      } else if (winner != null) {
        const winnerStr = winner === 1 ? '先手' : '後手';
        lines.push(`まで${moveCount}手で${winnerStr}の勝ち`);
      } else {
        lines.push(`まで${moveCount}手`);
      }
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

  // ── 棋譜共有リンク作成 ──
  const handleShare = useCallback(async () => {
    const content = buildKifContent(true);
    const sente = gameInfo.sente.name || '先手';
    const gote  = gameInfo.gote.name  || '後手';
    const moves = state.mainLineIds.length - 1;
    const date  = new Date().toLocaleDateString('ja-JP');
    const title = `${sente} vs ${gote} (${moves}手) ${date}`;
    setShareLoading(true);
    try {
      const res = await fetch(`${CLOUD_API}/api/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ title, content }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '共有に失敗しました');
      setShareUrl(`${window.location.origin}/share/${data.token}`);
    } catch (e) {
      alert(`共有エラー: ${e.message}`);
    } finally {
      setShareLoading(false);
    }
  }, [buildKifContent, gameInfo, state.mainLineIds.length]);

  // ── 詰将棋判定: 先手の王がなく後手の玉がある ──
  const isTsumePosition = useMemo(() => {
    if (!board || !board.length) return false;
    return !findKing(board, 1) && !!findKing(board, 2);
  }, [board]);

  // ── 詰将棋共有リンク作成 ──
  const handleShareTsume = useCallback(() => {
    if (!board || !hands) return;
    if (tsumeLoading) return;
    setTsumeTitle('');
    setTsumeVisibility('public');
    setTsumeDescription('');
    setShowTsumeTitleDialog(true);
  }, [board, hands, tsumeLoading]);

  // ── 詰将棋タイトル入力後の処理 ──
  const handleConfirmTsumeTitle = useCallback(() => {
    if (!board || !hands) return;
    if (tsumeLoading) return;
    setShowTsumeTitleDialog(false);

    const boardSnap = board;
    const handsSnap = hands;
    const titleSnap       = tsumeTitle.trim();
    const visibilitySnap  = tsumeVisibility;
    const descriptionSnap = tsumeDescription.trim();

    async function postPuzzle(solution, numMoves) {
      const puzzle = { board: boardSnap, hands: handsSnap, attacker: 1, solution, numMoves };
      const finalTitle = titleSnap || `${numMoves}手詰め`;
      const res = await fetch(`${CLOUD_API}/api/tsume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ title: finalTitle, puzzle, visibility: visibilitySnap, description: descriptionSnap }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || '共有に失敗しました');
      setTsumeUrl(`${window.location.origin}/tsume/${json.token}`);
    }

    if (socketRef.current) {
      setTsumeLoading(true);
      setTsumeProgress({ engine: true, currentDepth: 0, maxDepth: 30 });
      const sfen = boardToSFENForEngine(boardSnap, handsSnap, 1, 1);
      tsumeCallbackRef.current = async (result) => {
        tsumeCallbackRef.current = null;
        tsumePVRef.current = [];
        setTsumeProgress(null);
        setTsumeLoading(false);
        if (!result.found) {
          alert('解が見つかりませんでした（詰まない局面か30手超えです）');
          return;
        }
        const numMoves = result.moves.length;
        const solution = usiMovesToSolutionTree(result.moves, boardSnap, handsSnap, 1);
        if (!solution) { alert('解析結果の変換に失敗しました'); return; }
        try { await postPuzzle(solution, numMoves); }
        catch (e) { alert(`詰将棋共有エラー: ${e.message}`); }
      };
      tsumePVRef.current = [];
      tsumeContextRef.current = { board: boardSnap, hands: handsSnap, postFn: postPuzzle };
      socketRef.current.emit('solve_tsume', { sfen, timeLimit: 120000 });
    } else {
      if (tsumeWorkerRef.current) return;
      const MAX_MOVES = 30;
      setTsumeLoading(true);
      setTsumeProgress({ currentDepth: 1, maxDepth: MAX_MOVES });
      const worker = new TsumeWorkerClass();
      tsumeWorkerRef.current = worker;
      worker.onmessage = async ({ data: d }) => {
        if (d.type === 'progress') {
          setTsumeProgress({ currentDepth: d.currentDepth, maxDepth: d.maxDepth });
        } else if (d.type === 'solution') {
          worker.terminate();
          tsumeWorkerRef.current = null;
          setTsumeProgress(null);
          setTsumeLoading(false);
          try { await postPuzzle(d.solution, d.numMoves); }
          catch (e) { alert(`詰将棋共有エラー: ${e.message}`); }
        } else if (d.type === 'failed') {
          worker.terminate();
          tsumeWorkerRef.current = null;
          setTsumeProgress(null);
          setTsumeLoading(false);
          alert(`解が見つかりませんでした（${MAX_MOVES}手を超えるか詰まない局面です）`);
        }
      };
      worker.onerror = (e) => {
        worker.terminate();
        tsumeWorkerRef.current = null;
        setTsumeProgress(null);
        setTsumeLoading(false);
        alert(`解析エラー: ${e.message}`);
      };
      worker.postMessage({ cmd: 'solve', board: boardSnap, hands: handsSnap, attacker: 1, maxMoves: MAX_MOVES });
    }
  }, [board, hands, authToken, tsumeLoading, tsumeTitle, tsumeVisibility, tsumeDescription]);

  // ── 詰将棋解析キャンセル ──
  const handleCancelTsume = useCallback(() => {
    if (tsumeWorkerRef.current) {
      tsumeWorkerRef.current.terminate();
      tsumeWorkerRef.current = null;
    }
    if (tsumeCallbackRef.current) {
      tsumeCallbackRef.current = null;
      tsumePVRef.current = [];
      tsumeContextRef.current = null;
      socketRef.current?.emit('stop');
    }
    setTsumeProgress(null);
    setTsumeLoading(false);
  }, []);

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

  // mobileBoardArea は mobile <main> にインライン化

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

  // 未ログイン → ログインページへリダイレクト
  if (!authToken) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="overflow-hidden bg-gray-900 text-white flex flex-col"
      style={{ height: '100dvh', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      onMouseMove={editMode ? handleEditMouseMove : undefined}
      onMouseLeave={editMode ? handleEditMouseLeave : undefined}
    >
      <Helmet>
        <title>将棋アナリティクス | 棋譜解析</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      {/* ── 局面編集: カーソル追従駒 ── */}
      {editMode && editHeld && editCursorPos && (
        <div
          className="fixed z-[9999] pointer-events-none select-none flex items-center justify-center rounded"
          style={{
            left: editCursorPos.x,
            top: editCursorPos.y,
            transform: `translate(-50%, -50%) ${editHeld.player === 2 ? 'rotate(180deg)' : ''}`,
            width: 38, height: 42,
            background: 'rgba(255,220,80,0.93)',
            border: '2px solid rgba(180,140,0,0.8)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            fontSize: 22,
            fontWeight: 'bold',
            color: editHeld.pieceType.startsWith('+') ? '#DC2626' : '#1a1a1a',
          }}
        >
          {getPieceChar(editHeld.pieceType, editHeld.player)}
        </div>
      )}

      {/* ── 棋譜共有URLモーダル ── */}
      {shareUrl && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShareUrl(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-bold text-white flex items-center gap-2">
                <Share2 size={16} className="text-blue-400" />{t('share.created')}
              </p>
              <button onClick={() => setShareUrl(null)}
                className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-400">{t('share.publicNote')}</p>
            <div className="flex gap-2">
              <input readOnly value={shareUrl} onClick={e => e.target.select()}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono min-w-0" />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setShareCopied(true);
                  setTimeout(() => setShareCopied(false), 2000);
                }}
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors shrink-0 min-w-[80px]">
                {shareCopied ? t('button.copied') : t('button.copy')}
              </button>
            </div>
            <a href={shareUrl} target="_blank" rel="noopener noreferrer"
              className="text-center text-xs text-blue-400 hover:text-blue-300 transition-colors">
              {t('share.openInNewTab')}
            </a>
          </div>
        </div>
      )}

      {/* ── 詰将棋解析進捗モーダル ── */}
      {tsumeProgress && (
        <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-5">
            <div className="text-center">
              <p className="font-bold text-white text-base">{t('modal.tsumeAnalyzing')}</p>
              <p className="text-sm text-gray-400 mt-1">
                {tsumeProgress.engine
                  ? (tsumeProgress.currentDepth > 0
                    ? t('progress.searchingMate', { moves: tsumeProgress.currentDepth })
                    : t('progress.analyzing'))
                  : t('progress.searchingMateJsSolver', { moves: tsumeProgress.currentDepth })}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-purple-500 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${tsumeProgress.maxDepth > 0 ? Math.round(((tsumeProgress.currentDepth || 0) / tsumeProgress.maxDepth) * 100) : 0}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                {tsumeProgress.engine ? (
                  <>
                    <span>{tsumeProgress.currentDepth > 0 ? t('progress.mate', { moves: tsumeProgress.currentDepth }) : t('progress.engineSearching')}</span>
                    <span>{t('progress.maxMoves', { moves: tsumeProgress.maxDepth })}</span>
                  </>
                ) : (
                  <>
                    <span>{t('progress.currentMoves', { moves: tsumeProgress.currentDepth })}</span>
                    <span>{t('progress.maxMoves', { moves: tsumeProgress.maxDepth })}</span>
                  </>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500 text-center">
              {t('help.deeperMatesLonger')}
            </p>
            <button onClick={handleCancelTsume}
              className="py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors font-medium">
              {t('button.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ── 詰将棋タイトル入力ダイアログ ── */}
      {showTsumeTitleDialog && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowTsumeTitleDialog(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-bold text-white flex items-center gap-2">
                <Swords size={16} className="text-purple-400" />{t('dialog.tsumePuzzleSettings')}
              </p>
              <button onClick={() => setShowTsumeTitleDialog(false)}
                className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* タイトル */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-400">{t('form.title')}</label>
              <input
                type="text"
                value={tsumeTitle}
                onChange={e => setTsumeTitle(e.target.value.slice(0, 100))}
                placeholder={t('form.titlePlaceholder')}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                onKeyDown={e => e.key === 'Enter' && handleConfirmTsumeTitle()}
              />
              <p className="text-xs text-gray-500">空欄の場合は「X手詰め」となります</p>
            </div>

            {/* 説明 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-400">説明（任意）</label>
              <textarea
                value={tsumeDescription}
                onChange={e => setTsumeDescription(e.target.value.slice(0, 500))}
                placeholder={t('form.descriptionPlaceholder')}
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
              />
              <p className="text-xs text-gray-500 text-right">{tsumeDescription.length} / 500</p>
            </div>

            {/* 公開設定 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-gray-400">公開設定</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTsumeVisibility('public')}
                  className={`flex flex-col items-center gap-1 py-3 px-3 rounded-xl border text-sm font-medium transition-all
                    ${tsumeVisibility === 'public'
                      ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'}`}
                >
                  <span className="text-base">🌐</span>
                  <span>公開</span>
                  <span className="text-[10px] text-gray-500 font-normal">一覧に表示される</span>
                </button>
                <button
                  onClick={() => setTsumeVisibility('unlisted')}
                  className={`flex flex-col items-center gap-1 py-3 px-3 rounded-xl border text-sm font-medium transition-all
                    ${tsumeVisibility === 'unlisted'
                      ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'}`}
                >
                  <span className="text-base">🔗</span>
                  <span>限定公開</span>
                  <span className="text-[10px] text-gray-500 font-normal">URLを知る人のみ</span>
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setShowTsumeTitleDialog(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors font-medium">
                キャンセル
              </button>
              <button onClick={handleConfirmTsumeTitle}
                className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm transition-colors font-medium">
                解析を開始
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 詰将棋共有URLモーダル ── */}
      {tsumeUrl && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setTsumeUrl(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-bold text-white flex items-center gap-2">
                <Swords size={16} className="text-purple-400" />詰将棋共有リンクを作成しました
              </p>
              <button onClick={() => setTsumeUrl(null)}
                className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>
            {/* 公開設定バッジ */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium
              ${tsumeVisibility === 'unlisted'
                ? 'bg-blue-500/15 border border-blue-500/30 text-blue-300'
                : 'bg-green-500/15 border border-green-500/30 text-green-300'}`}>
              <span>{tsumeVisibility === 'unlisted' ? '🔗' : '🌐'}</span>
              <span>
                {tsumeVisibility === 'unlisted'
                  ? '限定公開 — URLを知っている人だけがアクセスできます'
                  : '公開 — 詰将棋一覧に表示されます'}
              </span>
            </div>
            <div className="flex gap-2">
              <input readOnly value={tsumeUrl} onClick={e => e.target.select()}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono min-w-0" />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(tsumeUrl);
                  setTsumeCopied(true);
                  setTimeout(() => setTsumeCopied(false), 2000);
                }}
                className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors shrink-0 min-w-[80px]">
                {tsumeCopied ? 'コピー済み ✓' : 'コピー'}
              </button>
            </div>
            <a href={tsumeUrl} target="_blank" rel="noopener noreferrer"
              className="text-center text-xs text-purple-400 hover:text-purple-300 transition-colors">
              詰将棋ページを開く →
            </a>
          </div>
        </div>
      )}

      {/* ── 共有した棋譜一覧モーダル ── */}
      {showShares && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowShares(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col"
            style={{ maxHeight: '80vh' }}
            onClick={e => e.stopPropagation()}>
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <p className="font-bold text-white">共有した棋譜一覧</p>
              <button onClick={() => setShowShares(false)}
                className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>
            {/* 本体 */}
            <div className="overflow-y-auto flex-1 p-3 flex flex-col gap-2">
              {shareListLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-blue-400" />
                </div>
              ) : shareList.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">共有した棋譜はありません</p>
              ) : shareList.map(s => {
                const url = `${window.location.origin}/share/${s.token}`;
                const copied = shareListCopied === s.token;
                return (
                  <div key={s.token}
                    className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-100 truncate">{s.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(s.created_at * 1000).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        setShareListCopied(s.token);
                        setTimeout(() => setShareListCopied(null), 2000);
                      }}
                      className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors min-w-[90px] text-center
                        ${copied ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
                      {copied ? 'コピー済み ✓' : 'リンクコピー'}
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`「${s.title}」の共有リンクを削除しますか？`)) return;
                        try {
                          await fetch(`${CLOUD_API}/api/share/${s.token}`, {
                            method: 'DELETE',
                            headers: { Authorization: `Bearer ${authToken}` },
                          });
                          setShareList(prev => prev.filter(x => x.token !== s.token));
                        } catch { /* ignore */ }
                      }}
                      className="shrink-0 p-1.5 rounded-lg bg-gray-700 hover:bg-red-600/80 text-gray-400 hover:text-white transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── WebRTC ネットワーク非対応バナー ── */}
      {webrtcNetworkError && (
        <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-red-500/50 rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="text-red-400 text-2xl leading-none">⚠</span>
              <div>
                <p className="text-white font-bold text-base">お使いのネットワークはご利用いただけません</p>
                <p className="text-gray-400 text-sm mt-1">
                  このネットワーク環境ではエンジンとの接続（WebRTC）を確立できませんでした。
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowWebrtcErrorDetail(v => !v)}
                className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors"
              >
                {showWebrtcErrorDetail ? '詳細を隠す' : '詳細'}
              </button>
              <button
                onClick={() => { setWebrtcNetworkError(false); iceFailCountRef.current = 0; }}
                className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 transition-colors"
              >
                閉じる
              </button>
            </div>
            {showWebrtcErrorDetail && (
              <div className="bg-gray-800 rounded-xl p-4 text-sm text-gray-300 flex flex-col gap-2.5">
                <p className="font-semibold text-gray-100">考えられる原因と対処法</p>
                <ul className="flex flex-col gap-2 list-none">
                  <li className="flex gap-2">
                    <span className="text-red-400 shrink-0">①</span>
                    <span><span className="text-gray-100 font-medium">ファイアウォール・プロキシ</span><br />
                    会社・学校のネットワークが WebRTC の UDP 通信をブロックしている可能性があります。ネットワーク管理者に UDP ポート（3478, 19302）の開放を依頼してください。</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-blue-400 shrink-0">②</span>
                    <span><span className="text-gray-100 font-medium">モバイルデータ通信に切り替える</span><br />
                    Wi-Fi を切ってスマートフォンのモバイル回線で接続すると解決することがあります。</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-400 shrink-0">③</span>
                    <span><span className="text-gray-100 font-medium">VPN を試す</span><br />
                    VPN を使用すると NAT 越え制限を回避できる場合があります。</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-yellow-400 shrink-0">④</span>
                    <span><span className="text-gray-100 font-medium">別のネットワーク環境を試す</span><br />
                    自宅の Wi-Fi やテザリングなど、制限の少ない環境で再度お試しください。</span>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
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
              ? <AccountMenu email={userEmail} userId={userId} onLogout={handleLogout}
                  onShowSettings={() => setShowAccountSettings(true)}
                  onShowShares={async () => {
                    setShowShares(true);
                    setShareListLoading(true);
                    try {
                      const res = await fetch(`${CLOUD_API}/api/shares`, {
                        headers: { Authorization: `Bearer ${authToken}` },
                      });
                      const data = await res.json();
                      setShareList(data.ok ? data.shares : []);
                    } catch { setShareList([]); }
                    finally { setShareListLoading(false); }
                  }}
                  // お問い合わせ表示ハンドラ
                  onShowContact={() => setShowContactDialog(true)} />
              : null}
          </div>
        }
        onMenuOpen={() => openMobileMenu()}
      />

      {/* ══ モバイルドロワーメニュー（デスクトップサイドバーと同じ構造） ══ */}
      <input ref={mobileFileRef} type="file" accept=".kif,.kifu,.csa" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleLoadFile(f); e.target.value = ''; }} />
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[100]"
          onClick={(e) => { if (e.target === e.currentTarget) closeMobileMenu(); }}
        >
          {/* バックドロップ（視覚のみ） */}
          <div
            className={`absolute inset-0 bg-black/60 pointer-events-none transition-opacity duration-200
              ${mobileMenuVisible ? 'opacity-100' : 'opacity-0'}`}
          />

          {/* ボトムシート */}
          <div
            className={`absolute bottom-0 left-0 right-0 z-10 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl
              transition-transform duration-200
              ${mobileMenuVisible ? 'translate-y-0' : 'translate-y-full'}`}
          >
            {/* サブパネル（開く / 保存 / 解析 / クラウド）─ ボタングリッドの上に表示 */}
            {(showCloudPanel || showAnalysisPanel || showSettingsPanel || openFlyout === 'mobile-file' || openSaveMenu === 'mobile') && (
              <div className="border-b border-gray-700/60">
                {/* 開くフライアウト */}
                {openFlyout === 'mobile-file' && (
                  <div ref={mobileFlyoutRef} className="flex flex-col p-1.5 gap-0.5">
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700/60 mb-0.5">
                      <FolderOpen size={13} className="text-gray-400" />
                      <span className="text-xs font-semibold text-gray-300">ファイルを開く</span>
                    </div>
                    <FlyoutItem icon={<FolderOpen size={13} />} label="ファイルを開く"
                      onClick={() => { mobileFileRef.current?.click(); closeMobileMenu(); }} />
                    <FlyoutItem icon={<Clipboard size={13} />} label="貼り付け"
                      onClick={() => { handlePasteKif(); closeMobileMenu(); }} />
                    <div className="mx-1 my-0.5 border-t border-gray-700/60" />
                    <FlyoutItem icon={<Swords size={13} />} label="将棋ウォーズ棋譜"
                      onClick={() => { setShowShogiWars(true); closeMobileMenu(); }} />
                  </div>
                )}
                {/* 保存フライアウト */}
                {openSaveMenu === 'mobile' && (
                  <div ref={mobileSaveMenuRef} className="flex flex-col p-1.5 gap-0.5">
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700/60 mb-0.5">
                      <Download size={13} className="text-gray-400" />
                      <span className="text-xs font-semibold text-gray-300">保存</span>
                    </div>
                    <FlyoutItem icon={<TrendingUp size={13} />} label="評価値を含めて保存"
                      onClick={() => { handleSaveKif(true); closeMobileMenu(); }} />
                    <FlyoutItem icon={<Download size={13} />} label="評価値なしで保存"
                      onClick={() => { handleSaveKif(false); closeMobileMenu(); }} />
                    <div className="mx-1 my-0.5 border-t border-gray-700/60" />
                    <FlyoutItem icon={shareLoading ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />} label="共有リンクを作成"
                      onClick={() => { handleShare(); closeMobileMenu(); }} />
                    {isTsumePosition && (
                      <FlyoutItem icon={tsumeLoading ? <Loader2 size={13} className="animate-spin" /> : <Swords size={13} />} label="詰将棋として共有"
                        onClick={() => { handleShareTsume(); closeMobileMenu(); }} />
                    )}
                  </div>
                )}
                {/* 解析パネル */}
                {showAnalysisPanel && (
                  <div className="flex flex-col" style={{ maxHeight: '55vh' }}>
                    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
                      <div className="flex items-center gap-2">
                        <BarChart2 size={14} className="text-blue-400" />
                        <span className="text-sm font-bold text-white">棋譜解析</span>
                      </div>
                      <button onClick={() => setShowAnalysisPanel(false)}
                        className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="overflow-y-auto py-2">
                      {gameMode !== 'playing' ? (
                        <AutoAnalysis
                          status={autoAnalysisStatus}
                          progress={autoAnalysisProgress}
                          totalMoves={state.mainLineIds.length - 1}
                          onStart={(cond, from, to) => { if (handleStartAutoAnalysis(cond, from, to)) { setShowAnalysisPanel(false); closeMobileMenu(); } }}
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
                  <div className="flex flex-col" style={{ maxHeight: '55vh' }}>
                    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
                      <div className="flex items-center gap-2">
                        <Cloud size={14} className="text-blue-400" />
                        <span className="text-sm font-bold text-white">クラウド棋譜</span>
                      </div>
                      <button onClick={() => setShowCloudPanel(false)}
                        className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="px-3 py-2 border-b border-gray-700 shrink-0 flex gap-2">
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
                    <div className="overflow-y-auto">
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
                              <button
                                className="flex-1 text-left text-xs text-gray-300 hover:text-white truncate"
                                onClick={() => { handleCloudLoad(kif.id); closeMobileMenu(); }}
                              >
                                {kif.title || '無題'}
                              </button>
                              <button
                                onClick={() => handleCloudDelete(kif.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400 transition-all"
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
                {/* 設定パネル */}
                {showSettingsPanel && (
                  <div className="flex flex-col">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
                      <div className="flex items-center gap-2">
                        <Settings size={14} className="text-gray-400" />
                        <span className="text-sm font-bold text-white">設定</span>
                      </div>
                      <button onClick={() => setShowSettingsPanel(false)}
                        className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="px-4 py-4 flex flex-col gap-5">
                      <div>
                        <div className="text-xs font-semibold text-gray-300 mb-3">候補手矢印の表示数</div>
                        <div className="flex gap-1.5">
                          {[0,1,2,3,4].map(n => (
                            <button key={n}
                              onClick={() => setArrowCount(n)}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors
                                ${arrowCount === n
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}`}
                            >{n === 0 ? '非表示' : n}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ハンドルバー */}
            <div className="flex items-center justify-center pt-2 pb-1">
              <div className="w-8 h-1 rounded-full bg-gray-600" />
            </div>

            {/* アクションボタングリッド */}
            <div className="grid grid-cols-6 gap-1 px-2 pb-1">
              {/* 新規 */}
              <MobileMenuBtn icon={<FilePlus size={18} />} label="新規"
                onClick={() => { handleNewGame(); closeMobileMenu(); }} />
              {/* 開く */}
              <MobileMenuBtn icon={<FolderOpen size={18} />} label="開く"
                active={openFlyout === 'mobile-file'}
                onClick={() => { setOpenFlyout(v => v === 'mobile-file' ? null : 'mobile-file'); setOpenSaveMenu(null); setShowCloudPanel(false); setShowAnalysisPanel(false); }} />
              {/* 保存 */}
              <MobileMenuBtn icon={<Download size={18} />} label="保存"
                active={openSaveMenu === 'mobile'}
                onClick={() => { setOpenSaveMenu(v => v === 'mobile' ? null : 'mobile'); setOpenFlyout(null); setShowCloudPanel(false); setShowAnalysisPanel(false); }} />
              {/* クラウド */}
              <MobileMenuBtn icon={<Cloud size={18} />} label="クラウド"
                active={showCloudPanel}
                onClick={() => { setShowCloudPanel(v => !v); setShowAnalysisPanel(false); setOpenFlyout(null); setOpenSaveMenu(null); }} />
              {/* 解析 */}
              <MobileMenuBtn icon={<BarChart2 size={18} />} label="解析"
                active={showAnalysisPanel || autoAnalysisStatus === 'running'}
                pulse={autoAnalysisStatus === 'running'}
                onClick={() => { setShowAnalysisPanel(v => !v); setShowCloudPanel(false); setOpenFlyout(null); setOpenSaveMenu(null); }} />
              {/* 検討 */}
              <MobileMenuBtn icon={<Cpu size={18} />} label="検討"
                active={isAnalyzing}
                pulse={isAnalyzing}
                disabled={autoAnalysisStatus === 'running'}
                onClick={() => {
                  if (autoAnalysisStatus === 'running') return;
                  if (!isAnalyzing && !requireAgent()) return;
                  setIsAnalyzing(v => !v);
                  closeMobileMenu();
                }} />
            </div>

            <div className="grid grid-cols-6 gap-1 px-2 pb-3">
              {/* ツリー */}
              <MobileMenuBtn icon={<GitBranch size={18} />} label="ツリー"
                onClick={() => { dispatch({ type: 'TOGGLE_TREE' }); closeMobileMenu(); }} />
              {/* 反転 */}
              <MobileMenuBtn icon={<FlipHorizontal2 size={18} />} label="反転"
                active={flipped}
                onClick={() => { setFlipped(v => !v); closeMobileMenu(); }} />
              {/* 形勢バー */}
              <MobileMenuBtn
                icon={showMobileEvalBar ? <Eye size={18} /> : <EyeOff size={18} />}
                label="形勢バー"
                active={showMobileEvalBar}
                onClick={() => setShowMobileEvalBar(v => !v)} />
              {/* グラフ */}
              <MobileMenuBtn
                icon={showMobileEvalGraph ? <Eye size={18} /> : <EyeOff size={18} />}
                label="グラフ"
                active={showMobileEvalGraph}
                onClick={() => setShowMobileEvalGraph(v => !v)} />
              {/* 候補手 */}
              <MobileMenuBtn
                icon={showMobileCandidates ? <Eye size={18} /> : <EyeOff size={18} />}
                label="候補手"
                active={showMobileCandidates}
                onClick={() => setShowMobileCandidates(v => !v)} />
              {/* 棋譜情報 */}
              <MobileMenuBtn icon={<Info size={18} />} label="棋譜情報"
                onClick={() => { setShowKifInfo(true); closeMobileMenu(); }} />
              {/* 局面編集 */}
              <MobileMenuBtn icon={<PenSquare size={18} />} label="局面編集"
                active={editMode}
                onClick={() => {
                  if (editMode) { confirmEditPosition(); closeMobileMenu(); }
                  else { enterEditMode(); closeMobileMenu(); setShowSettingsPanel(false); setShowCloudPanel(false); setShowAnalysisPanel(false); setOpenFlyout(null); setOpenSaveMenu(null); }
                }} />
              {/* 設定 */}
              <MobileMenuBtn icon={<Settings size={18} />} label="設定"
                active={showSettingsPanel}
                onClick={() => { setShowSettingsPanel(v => !v); setShowCloudPanel(false); setShowAnalysisPanel(false); setOpenFlyout(null); setOpenSaveMenu(null); }} />
              {/* 閉じる */}
              <MobileMenuBtn icon={<X size={18} />} label="閉じる"
                onClick={closeMobileMenu} />
            </div>
          </div>
        </div>
      )}

      {/* ══ 指し手一覧ボトムシート（モバイル） ══ */}
      {showMobileMoveList && (
        <div className="lg:hidden fixed inset-0 z-[50]">
          {/* バックドロップ */}
          <div
            className={`absolute inset-0 bg-black/50 transition-opacity duration-200
              ${mobileMoveListVisible ? 'opacity-100' : 'opacity-0'}`}
            onClick={closeMobileMoveList}
          />
          {/* ボトムシート */}
          <div
            className={`absolute inset-x-0 bottom-0 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl
              flex flex-col transition-transform duration-200 ease-out
              ${mobileMoveListVisible ? 'translate-y-0' : 'translate-y-full'}`}
            style={{ height: '35dvh' }}
          >
            {/* ドラッグバー */}
            <div className="flex justify-center pt-2 pb-1 flex-shrink-0" onClick={closeMobileMoveList}>
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <MoveList
              nodes={state.nodes}
              moveListIds={moveListIds}
              branchStart={moveListBranchStart}
              currentId={state.currentId}
              onNavigate={(nodeId) => dispatch({ type: 'NAVIGATE_TO', nodeId })}
              termination={!gameMode ? kifTermination : null}
            />
          </div>
        </div>
      )}

      {/* ══ モバイル: ぴよ将棋風レイアウト ══ */}
      <main className="lg:hidden flex-1 overflow-hidden flex flex-col">

        {/* ── 盤面ブロック（先手後手・駒台は全幅、盤面グリッドのみリサイズ） ── */}
        <div className="flex-shrink-0 select-none" data-board-area
          style={{ cursor: editMode && editHeld ? 'none' : undefined }}>
          {/* 対局コントロール */}
          {gameControls}

          {/* 上手プレイヤー情報（全幅） */}
          <PlayerInfo
            compact
            name={gameMode
              ? (gameConfig?.players?.[flipped ? 1 : 2]?.type === 'human' ? 'あなた' : 'CPU')
              : (flipped ? gameInfo.sente.name : gameInfo.gote.name)}
            mark={flipped ? gameInfo.sente.mark : gameInfo.gote.mark}
            time={displayTimes[flipped ? 1 : 2] || (flipped ? gameInfo.sente.time : gameInfo.gote.time)}
            isActive={activePlayer === (flipped ? 1 : 2)}
            player={flipped ? 1 : 2}
            inCheck={inCheck && activePlayer === (flipped ? 1 : 2)}
          />

          {/* 上手持駒（全幅） */}
          <HandRowHorizontal
            hands={editMode ? editHands : hands} player={flipped ? 1 : 2}
            activePlayer={activePlayer}
            dropSelected={editMode ? null : state.dropSelected}
            onDropSelect={editMode ? handleEditHandSelect : dropSelectDispatch}
            onEditRightClick={editMode ? handleEditHandRightClick : undefined}
            onHandAreaClick={editMode ? handleEditHandAreaClick : undefined}
            editMode={editMode}
            flipped={flipped}
            align="right"
          />

          {/* 盤面グリッドのみ: 中央寄せ + 幅制御 */}
          <div className="flex justify-center">
            <div
              ref={mobileBoardRef}
              style={{
                width: panelSizes.mobileBoardSizePx != null
                  ? panelSizes.mobileBoardSizePx
                  : '100%',
                maxWidth: '100%',
              }}
            >
              <div className="flex items-stretch">
                <div className="flex-1 relative min-w-0">
                  <BoardCore
                    board={editMode ? editBoard : board}
                    hands={editMode ? editHands : hands}
                    selectedCell={editMode ? null : state.selectedCell}
                    highlightSet={editMode ? new Set() : highlightSet}
                    lastMove={editMode ? null : state.lastMove}
                    candidateArrows={editMode ? [] : candidateArrows}
                    activePlayer={activePlayer}
                    onCellClick={editMode ? handleEditCellClick : cellClickDispatch}
                    onEditRightClick={editMode ? handleEditRightClick : undefined}
                    editMode={editMode}
                    flipped={flipped}
                  />
                  {!editMode && aiOverlay}
                </div>
                {showMobileEvalBar && !gameInfoHidden && !editMode && (
                  <EvalBarVertical evalValue={evalScore} />
                )}
              </div>
            </div>
          </div>

          {/* 下手持駒（全幅） */}
          <HandRowHorizontal
            hands={editMode ? editHands : hands} player={flipped ? 2 : 1}
            activePlayer={activePlayer}
            dropSelected={editMode ? null : state.dropSelected}
            onDropSelect={editMode ? handleEditHandSelect : dropSelectDispatch}
            onEditRightClick={editMode ? handleEditHandRightClick : undefined}
            onHandAreaClick={editMode ? handleEditHandAreaClick : undefined}
            editMode={editMode}
            align="left"
            flipped={flipped}
          />

          {/* 下手プレイヤー情報（全幅） */}
          <PlayerInfo
            compact
            name={gameMode
              ? (gameConfig?.players?.[flipped ? 2 : 1]?.type === 'human' ? 'あなた' : 'CPU')
              : (flipped ? gameInfo.gote.name : gameInfo.sente.name)}
            mark={flipped ? gameInfo.gote.mark : gameInfo.sente.mark}
            time={displayTimes[flipped ? 2 : 1] || (flipped ? gameInfo.gote.time : gameInfo.sente.time)}
            isActive={activePlayer === (flipped ? 2 : 1)}
            player={flipped ? 2 : 1}
            inCheck={inCheck && activePlayer === (flipped ? 2 : 1)}
          />

          {/* 駒箱（局面編集中のみ表示） */}
          {editMode && (
            <PieceBoxHorizontal
              editBox={editBox}
              editHeld={editHeld}
              onPick={handleBoxPick}
              onMoveAllToBox={handleMoveAllToBox}
              onReturnToBox={handleReturnToBox}
              onFlatHand={handleFlatHand}
              onTsumeSetup={handleTsumeSetup}
            />
          )}
        </div>

        {/* ── ドラッグハンドル（盤面 ↔ 解析）: Y ドラッグで盤の幅を変更 ── */}
        <DragHandle
          axis="y"
          onMouseDown={(e) => {
            const vw = window.visualViewport?.width ?? window.innerWidth;
            const startW = mobileBoardRef.current?.getBoundingClientRect().width
              ?? panelSizes.mobileBoardSizePx ?? vw;
            startDrag(e, startW, (v) => {
              const maxW = window.visualViewport?.width ?? window.innerWidth;
              setPanelSizes(s => ({ ...s, mobileBoardSizePx: Math.max(150, Math.min(maxW, v)) }));
            }, 'y');
          }}
        />

        {/* ── 解析ブロック（残りスペース） ── */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">

          {/* 形勢グラフ */}
          {showMobileEvalGraph && !gameInfoHidden && (
            <>
              <div className="flex-shrink-0">
                <EvaluationGraph
                  currentMove={graphCurrentIdx}
                  graphData={graphData}
                  onNavigate={(idx) => {
                    const nodeId = graphData[idx]?.nodeId;
                    if (nodeId) dispatch({ type: 'NAVIGATE_TO', nodeId });
                  }}
                  isBranch={isOnBranch}
                  branchPoint={branchPoint}
                  height={panelSizes.mobileGraphPx}
                  compact
                />
              </div>
              {/* ── ドラッグハンドル（グラフ ↔ 候補手） ── */}
              <DragHandle
                axis="y"
                onMouseDown={(e) => startDrag(
                  e, panelSizes.mobileGraphPx,
                  (v) => setPanelSizes(s => ({ ...s, mobileGraphPx: Math.max(40, Math.min(300, v)) })),
                  'y'
                )}
              />
            </>
          )}

          {/* 分岐バナー */}
          {isOnBranch && (
            <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-purple-900/40 border-y border-purple-700/50">
              <span className="text-xs text-purple-300 font-semibold flex items-center gap-1">
                <GitBranch size={12} />分岐中
              </span>
              <button
                onClick={handleReturnToMain}
                className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-xs font-bold transition-colors"
              >
                <CornerUpLeft size={11} />本譜に戻す
              </button>
            </div>
          )}

          {/* KIF エラー */}
          {kifError && (
            <div className="flex-shrink-0 mx-3 my-1 px-3 py-2 bg-red-900/40 border border-red-700/50 rounded-xl text-xs text-red-300 flex items-start justify-between gap-2">
              <span>{kifError}</span>
              <button onClick={() => setKifError(null)} className="text-red-400 hover:text-white shrink-0">✕</button>
            </div>
          )}

          {/* 手数スライダー */}
          {!isOnBranch && (
            <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1">
              <span className="text-xs text-gray-400 tabular-nums w-12 text-right shrink-0">{displayMove}手目</span>
              <input
                type="range" min={0} max={state.mainLineIds.length - 1} value={displayMove}
                onChange={(e) => handleMoveChange(Number(e.target.value))}
                className="flex-1 h-2 rounded-full accent-blue-500 cursor-pointer"
              />
              <span className="text-xs text-gray-400 tabular-nums w-8 shrink-0">{state.mainLineIds.length - 1}手</span>
            </div>
          )}

          {/* ── ナビバー（5ボタン・アイコンのみ） ── */}
          <div className="flex-shrink-0 grid grid-cols-5 gap-0.5 px-1 py-0.5 border-t border-gray-700/80 bg-gray-900/90">
            {/* 指し手一覧 */}
            <button
              onClick={() => showMobileMoveList ? closeMobileMoveList() : openMobileMoveList()}
              className={`flex items-center justify-center py-1.5 rounded-lg active:scale-95 transition-all
                ${showMobileMoveList ? 'bg-blue-600 text-white' : 'bg-gray-700/80 hover:bg-gray-600 text-gray-200'}`}
              title="指し手一覧"
            >
              <List size={18} />
            </button>
            {/* ◀ */}
            <button
              onClick={() => isOnBranch ? handleBranchPrev() : handleMoveChange(Math.max(0, displayMove - 1))}
              className="flex items-center justify-center py-1.5 rounded-lg bg-gray-700/80 hover:bg-gray-600 active:scale-95 transition-all text-gray-200"
              title="戻る"
            >
              <ChevronLeft size={18} />
            </button>
            {/* ▶ */}
            <button
              onClick={() => isOnBranch ? handleBranchNext() : handleMoveChange(Math.min(state.mainLineIds.length - 1, displayMove + 1))}
              disabled={isOnBranch && !hasBranchNext}
              className="flex items-center justify-center py-1.5 rounded-lg bg-gray-700/80 hover:bg-gray-600 active:scale-95 disabled:opacity-40 transition-all text-gray-200"
              title="進む"
            >
              <ChevronRight size={18} />
            </button>
            {/* 検討 */}
            <button
              onClick={() => {
                if (autoAnalysisStatus === 'running') return;
                if (!isAnalyzing && !requireAgent()) return;
                setIsAnalyzing(v => !v);
              }}
              disabled={autoAnalysisStatus === 'running'}
              className={`flex items-center justify-center py-1.5 rounded-lg active:scale-95 transition-all disabled:opacity-40
                ${isAnalyzing ? 'bg-blue-600 text-white' : 'bg-gray-700/80 hover:bg-gray-600 text-gray-200'}`}
              title="検討"
            >
              <Cpu size={16} className={isAnalyzing ? 'animate-pulse' : ''} />
            </button>
            {/* 本筋 */}
            <button
              onClick={handleReturnToMain}
              disabled={!isOnBranch}
              className={`flex items-center justify-center py-1.5 rounded-lg active:scale-95 transition-all
                ${isOnBranch ? 'bg-purple-700 hover:bg-purple-600 text-white' : 'bg-gray-700/80 text-gray-500 opacity-40'}`}
              title="本筋"
            >
              <CornerUpLeft size={16} />
            </button>
          </div>

          {/* 候補手/読み筋（常に表示） */}
          {showMobileCandidates && !gameInfoHidden && (
            <div
              ref={mobileCandidatesRef}
              className="overflow-y-auto overscroll-contain"
              style={{ flex: 1 }}
            >
              <CandidateMoves
                compact
                candidates={liveCandidates}
                engineStatus={engineStatus}
                maxDepth={maxDepth}
                multiPV={multiPV}
                isSaved={isSavedData}
                onMultiPVChange={handleMultiPVChange}
                onPVClick={(cand) => setPvCandidate(cand)}
              />
            </div>
          )}
        </div>
      </main>

      {/* ══ デスクトップ: 新レイアウト ══ */}
      {/* 左サイドバー | 盤面(左上) + [指し手|グラフ](右上) | 候補手(下段) */}
      <div className="hidden lg:flex flex-1 overflow-hidden relative">

        {/* 左サイドバー: ファイル操作 + 解析タブ */}
        <div className="flex flex-col items-stretch border-r border-gray-700 bg-gray-900/30 flex-shrink-0 z-20 overflow-y-auto overflow-x-hidden sidebar-no-scroll"
          style={{ width: 64 }}>
          <input
            ref={desktopFileRef}
            type="file"
            accept=".kif,.kifu,.csa"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLoadFile(f); e.target.value = ''; }}
          />
          <SidebarAction icon={<FilePlus size={17} />} label={t('sidebar.new')} onClick={handleNewGame} />
          {/* 開く — フライアウト付き */}
          <div ref={flyoutRef} className="relative">
            <SidebarAction
              icon={<FolderOpen size={17} />}
              label={t('sidebar.open')}
              onClick={() => setOpenFlyout(v => v === 'file' ? null : 'file')}
              active={openFlyout === 'file'}
            />
            {openFlyout === 'file' && (
              <div
                  className="fixed z-30 ml-1 w-52 bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-1.5 flex flex-col gap-0.5"
                  style={{
                    left: flyoutRef.current?.getBoundingClientRect().right + 4,
                    top:  flyoutRef.current?.getBoundingClientRect().top,
                  }}
              >
                <FlyoutItem icon={<FolderOpen size={13} />} label={t('sidebar.openFile')}
                  onClick={() => { desktopFileRef.current?.click(); setOpenFlyout(null); }} />
                <FlyoutItem icon={<Clipboard size={13} />} label={t('sidebar.paste')}
                  onClick={() => { handlePasteKif(); setOpenFlyout(null); }} />
                <div className="mx-1 my-0.5 border-t border-gray-700/60" />
                <FlyoutItem icon={<Swords size={13} />} label={t('sidebar.shogiWars')}
                  onClick={() => { setShowShogiWars(true); setOpenFlyout(null); }} />
              </div>
            )}
          </div>
          <div ref={saveMenuRef} className="relative">
            <SidebarAction
              icon={<Download size={17} />}
              label={t('sidebar.save')}
              onClick={() => setOpenSaveMenu(v => v === 'desktop' ? null : 'desktop')}
              active={openSaveMenu === 'desktop'}
            />
            {openSaveMenu === 'desktop' && (
              <div
                className="fixed z-30 ml-1 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-1.5 flex flex-col gap-0.5"
                style={{
                  left: saveMenuRef.current?.getBoundingClientRect().right + 4,
                  top:  saveMenuRef.current?.getBoundingClientRect().top,
                }}
              >
                <FlyoutItem icon={<TrendingUp size={13} />} label={t('sidebar.saveWithEval')}
                  onClick={() => { handleSaveKif(true); setOpenSaveMenu(null); }} />
                <FlyoutItem icon={<Download size={13} />} label={t('sidebar.saveNoEval')}
                  onClick={() => { handleSaveKif(false); setOpenSaveMenu(null); }} />
                <div className="mx-1 my-0.5 border-t border-gray-700/60" />
                <FlyoutItem icon={shareLoading ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />} label={t('sidebar.createLink')}
                  onClick={() => { handleShare(); setOpenSaveMenu(null); }} />
                {isTsumePosition && (
                  <FlyoutItem icon={tsumeLoading ? <Loader2 size={13} className="animate-spin" /> : <Swords size={13} />} label={t('sidebar.shareAsTsume')}
                    onClick={() => { handleShareTsume(); setOpenSaveMenu(null); }} />
                )}
              </div>
            )}
          </div>
          <SidebarAction
            icon={<Cloud size={17} />}
            label={t('sidebar.cloud')}
            onClick={() => { setShowCloudPanel(v => !v); setShowSettingsPanel(false); setShowAnalysisPanel(false); }}
            active={showCloudPanel}
          />
          {/* セパレーター */}
          <div className="mx-3 my-1 border-t border-gray-700/60" />
          {/* 検討トグル */}
          <SidebarAction
            icon={<Cpu size={17} />}
            label={t('sidebar.review')}
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
            label={t('sidebar.analyze')}
            onClick={() => { setShowAnalysisPanel(v => !v); setShowSettingsPanel(false); setShowCloudPanel(false); }}
            active={showAnalysisPanel || autoAnalysisStatus === 'running'}
            pulse={autoAnalysisStatus === 'running'}
          />
          <SidebarAction icon={<Info size={17} />} label={t('sidebar.kifInfo')}
            onClick={() => setShowKifInfo(true)}
          />
          <div className="flex-1 min-h-0" />
          <SidebarAction icon={<PenSquare size={17} />} label={t('sidebar.editPos')}
            onClick={() => {
              if (editMode) { confirmEditPosition(); }
              else { enterEditMode(); setShowAnalysisPanel(false); setShowCloudPanel(false); setShowSettingsPanel(false); }
            }}
            active={editMode}
          />
          <SidebarAction icon={<Settings size={17} />} label={t('sidebar.settings')}
            onClick={() => { setShowSettingsPanel(v => !v); setShowAnalysisPanel(false); setShowCloudPanel(false); }}
            active={showSettingsPanel}
          />
          <SidebarAction icon={<FlipHorizontal2 size={17} />} label={t('sidebar.flip')} onClick={() => setFlipped(v => !v)} active={flipped} />
          <SidebarAction icon={<GitBranch size={17} />} label={t('sidebar.tree')} onClick={() => dispatch({ type: 'TOGGLE_TREE' })} />
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

        {/* 設定パネル（サイドバー右隣にオーバーレイ表示） */}
        {showSettingsPanel && (
          <div className="absolute top-0 bottom-0 z-20 flex flex-col bg-gray-900 border-r border-gray-700"
            style={{ left: 64, width: 260 }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
              <div className="flex items-center gap-2">
                <Settings size={15} className="text-gray-400" />
                <span className="text-sm font-bold text-white">設定</span>
              </div>
              <button onClick={() => setShowSettingsPanel(false)}
                className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
              <div>
                <div className="text-xs font-semibold text-gray-300 mb-3">候補手矢印の表示数</div>
                <div className="flex gap-1.5">
                  {[0,1,2,3,4].map(n => (
                    <button key={n}
                      onClick={() => setArrowCount(n)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors
                        ${arrowCount === n
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}`}
                    >{n === 0 ? '非表示' : n}</button>
                  ))}
                </div>
              </div>
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
                      cursor: editMode && editHeld ? 'none' : undefined,
                    }}>
                      <HandColumnVertical
                        hands={editMode ? editHands : hands} player={flipped ? 1 : 2}
                        activePlayer={activePlayer}
                        dropSelected={editMode ? null : state.dropSelected}
                        onDropSelect={editMode ? handleEditHandSelect : dropSelectDispatch}
                        onEditRightClick={editMode ? handleEditHandRightClick : undefined}
                        onHandAreaClick={editMode ? handleEditHandAreaClick : undefined}
                        editMode={editMode}
                        pieceAlign="top"
                        flipped={flipped}
                      />
                      <div className="flex-1 min-w-0 relative">
                        <BoardCore
                          board={editMode ? editBoard : board}
                          hands={editMode ? editHands : hands}
                          selectedCell={editMode ? null : state.selectedCell}
                          highlightSet={editMode ? new Set() : highlightSet}
                          lastMove={editMode ? null : state.lastMove}
                          candidateArrows={editMode ? [] : candidateArrows}
                          activePlayer={activePlayer}
                          onCellClick={editMode ? handleEditCellClick : cellClickDispatch}
                          onEditRightClick={editMode ? handleEditRightClick : undefined}
                          editMode={editMode}
                          flipped={flipped}
                          sideLayout
                        />
                        {!editMode && aiOverlay}
                      </div>
                      <HandColumnVertical
                        hands={editMode ? editHands : hands} player={flipped ? 2 : 1}
                        activePlayer={activePlayer}
                        dropSelected={editMode ? null : state.dropSelected}
                        onDropSelect={editMode ? handleEditHandSelect : dropSelectDispatch}
                        onEditRightClick={editMode ? handleEditHandRightClick : undefined}
                        onHandAreaClick={editMode ? handleEditHandAreaClick : undefined}
                        editMode={editMode}
                        pieceAlign="bottom"
                        flipped={flipped}
                      />
                    </div>
                  );
                })()}
              </div>

              <div ref={boardNavAreaRef}>
                {editMode && (
                  <PieceBoxHorizontal
                    editBox={editBox}
                    editHeld={editHeld}
                    onPick={handleBoxPick}
                    onMoveAllToBox={handleMoveAllToBox}
                    onReturnToBox={handleReturnToBox}
                    onFlatHand={handleFlatHand}
                    onTsumeSetup={handleTsumeSetup}
                  />
                )}
                {navArea}
              </div>
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
                  termination={!gameMode ? kifTermination : null}
                />
              </div>

              {/* ── 垂直ドラッグハンドル（指し手 | グラフ） ── */}
              <DragHandle
                axis="y"
                onMouseDown={(e) => startDrag(e, panelSizes.moveListPx, (v) =>
                  setPanelSizes(s => ({ ...s, moveListPx: Math.max(0, v) })),
                  'y'
                )}
              />

              {/* 形成グラフのみ */}
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden pt-3 pb-2">
                {!gameInfoHidden && (
                  <EvaluationGraph
                    currentMove={isOnBranch ? branchPoint : mainLineIdx}
                    graphData={graphData}
                    onNavigate={handleMoveChange}
                    isBranch={isOnBranch}
                    branchPoint={branchPoint}
                    fillContainer
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

      {/* アップデートバナー */}
      {!updateBannerDismissed && swNeedRefresh && (
        <UpdateBanner
          type="pwa"
          onUpdate={() => { updateServiceWorker(true); setSwNeedRefresh(false); }}
          onDismiss={() => setUpdateBannerDismissed(true)}
        />
      )}
      {!updateBannerDismissed && apkUpdateAvailable && (
        <UpdateBanner
          type="apk"
          apkUrl={ANDROID_DOWNLOAD_URL}
          onDismiss={() => setUpdateBannerDismissed(true)}
        />
      )}

      {/* 将棋ウォーズ棋譜取り込みダイアログ */}
      {showShogiWars && (
        <ShogiWarsDialog
          onClose={() => setShowShogiWars(false)}
          onLoad={loadShogiWarsGame}
          defaultUsername={userSettings.swarUsername ?? ''}
        />
      )}

      {/* アカウント設定ダイアログ */}
      {showAccountSettings && (
        <AccountSettingsDialog
          settings={userSettings}
          onClose={() => setShowAccountSettings(false)}
          onSave={saveUserSettings}
        />
      )}

      {/* お問い合わせダイアログ */}
      {showContactDialog && (
        <ContactDialog apiBase={CLOUD_API} authToken={authToken} onClose={() => setShowContactDialog(false)} />
      )}

      {/* 棋譜情報ダイアログ */}
      {showKifInfo && (
        <KifInfoDialog
          gameInfo={gameInfo}
          onClose={() => setShowKifInfo(false)}
          onChange={(updated) => setGameInfo(updated)}
        />
      )}

      {/* エンジン設定ダイアログ */}
      {showSettings && (
        <EngineSettingsDialog
          options={engineOptions}
          engineStatus={engineStatus}
          engineMessage={engineMessage}
          suisho5Ready={suisho5Ready}
          isBrowserEngine={selectedAgentId === BROWSER_AGENT_ID}
          onClose={() => setShowSettings(false)}
          onApply={(changedOpts) => {
            // パッシブモード: 別デバイスがアクティブ かつ ブラウザエンジン以外 → 引き継ぎ確認を表示
            if (anotherDeviceActiveRef.current && selectedAgentIdRef.current !== BROWSER_AGENT_ID) { setPendingTakeoverAgentId(null); setShowTakeoverDialog(true); return; }
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

      {/* 囲い・戦型アナウンス */}
      {formationDisplay && (
        <div key={formationDisplay} className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="formation-announce bg-black/80 text-white font-bold px-10 py-5 rounded-2xl shadow-2xl"
            style={{ fontSize: 'clamp(1.5rem, 5vw, 2.5rem)', letterSpacing: '0.05em' }}>
            {formationDisplay}
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
        userSelect: 'none',
        WebkitUserSelect: 'none',
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

function MobileMenuBtn({ icon, label, onClick, active = false, pulse = false, disabled = false }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={label}
      className={`flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-[10px] font-medium transition-all active:scale-95
        ${disabled ? 'opacity-30 cursor-not-allowed' :
          active ? 'bg-blue-900/50 text-blue-400' :
          'text-gray-300 hover:bg-gray-700/60'}`}
    >
      <div className="relative">
        {icon}
        {pulse && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        )}
      </div>
      <span className="leading-none">{label}</span>
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