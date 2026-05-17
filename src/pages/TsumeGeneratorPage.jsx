import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AccountMenu from '../components/AccountMenu.jsx';
import {
  ChevronLeft, RotateCcw, Lightbulb, Play, Square, Shuffle, Cpu, Wifi, WifiOff,
  SkipBack, SkipForward, ChevronRight as ChevronRightIcon, FlipVertical2, Trophy,
  Globe, ExternalLink,
} from 'lucide-react';
import {
  applyMove,
  getLegalMoveDestinations, getLegalDropDestinations,
  canPromote, isPromoted,
  boardToSFENForEngine, parseUSIMove,
} from '../state/gameState.js';
import { BoardCore, HandRowHorizontal, HandColumnVertical } from '../components/ShogiBoard.jsx';
import TsumeNav from '../components/TsumeNav.jsx';
import TsumeGeneratorWorkerClass from '../engine/tsumeGenerator.worker.js?worker';
import { createWebRTCSocket, createWebSocketRelaySocket, isWebRTCAvailable } from '../webrtc/bridge.js';
import { generateCandidatePosition, usesAllHandPieces } from '../utils/tsumeGenerator.js';

const CLOUD_API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';

// ── ヘルパー (TsumePage と同じロジック) ─────────────────────────────

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

function depthOf(solution) {
  if (!solution || solution.length === 0) return 0;
  let max = 0;
  for (const node of solution) {
    let d = 1;
    if (node.defenses?.length > 0) {
      let maxDef = 0;
      for (const def of node.defenses) maxDef = Math.max(maxDef, 1 + depthOf(def.reply));
      d += maxDef;
    }
    max = Math.max(max, d);
  }
  return max;
}

function extractMainLine(solution, attacker, defender) {
  const moves = [];
  let current = solution;
  while (current && current.length > 0) {
    const node = current[0];
    moves.push({ move: node.move, playerNum: attacker });
    if (!node.defenses || node.defenses.length === 0) break;
    let bestDef = node.defenses[0];
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

function computeAnswerStates(initBoard, initHands, moves) {
  const states = [{ board: initBoard, hands: initHands, lastMove: null }];
  let board = initBoard, hands = initHands;
  for (const { move, playerNum } of moves) {
    try {
      const { board: nb, hands: nh } = applyMove(board, hands, move, playerNum);
      board = nb; hands = nh;
      states.push({ board: nb, hands: nh, lastMove: moveToLastMove(move) });
    } catch { break; }
  }
  return states;
}

// USI 手順リスト → 解答ツリー (線形: エンジンの主要手順のみ)
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
    try {
      const { board: nb, hands: nh } = applyMove(b, h, move, player);
      if (isAttackerTurn) {
        const defenses = build(moves.slice(1), nb, nh, false) ?? [];
        return [{ move, defenses }];
      } else {
        const reply = build(moves.slice(1), nb, nh, true);
        return [{ defMove: move, reply: reply ?? [] }];
      }
    } catch { return isAttackerTurn ? null : []; }
  }
  return build(usiMoves, board, hands, true) ?? null;
}

// ── 難易度設定 ────────────────────────────────────────────────────

const DIFFICULTIES = [
  { label: '1手', moves: 1,  engine: false },
  { label: '3手', moves: 3,  engine: false },
  { label: '5手', moves: 5,  engine: false },
  { label: '7手', moves: 7,  engine: true  },
  { label: '9手', moves: 9,  engine: true  },
  { label: '13手', moves: 13, engine: true  },
  { label: '超手数', moves: 0,  engine: true  }, // moves=0 = エンジン任せ
];

// エンジン使用時のパラメータ
function engineParams(moves) {
  if (moves === 0)  return { timeLimit: 30000, maxAttempts: 20, minMoves: 1  };
  if (moves === 1)  return { timeLimit: 300,   maxAttempts: 80, minMoves: 1  };
  if (moves <= 3)   return { timeLimit: 800,   maxAttempts: 60, minMoves: 3  };
  if (moves <= 5)   return { timeLimit: 1500,  maxAttempts: 50, minMoves: 5  };
  if (moves <= 7)   return { timeLimit: 5000,  maxAttempts: 40, minMoves: moves - 2 };
  if (moves <= 9)   return { timeLimit: 10000, maxAttempts: 30, minMoves: moves - 2 };
  if (moves <= 13)  return { timeLimit: 20000, maxAttempts: 20, minMoves: moves - 2 };
  return             { timeLimit: 30000, maxAttempts: 15, minMoves: moves - 4 };
}

// ── メインコンポーネント ─────────────────────────────────────────────

export default function TsumeGeneratorPage() {
  const navigate = useNavigate();
  const authInfo = useMemo(() => {
    const t = localStorage.getItem('shogi_jwt');
    if (!t) return null;
    try {
      const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { email: p.email, userId: p.userId };
    } catch { return null; }
  }, []);

  const [difficulty,      setDifficulty]      = useState(3);
  const [forceEngine,     setForceEngine]     = useState(false);
  const [lastMethod,      setLastMethod]      = useState(null);
  const [publishEnabled,  setPublishEnabled]  = useState(true);
  const [publishedToken,  setPublishedToken]  = useState(null);
  const [continuousMode,  setContinuousMode]  = useState(false);
  const continuousTimerRef  = useRef(null);
  const continuousModeRef   = useRef(false); // render ごとに同期し stale closure を防ぐ
  // idle | generating | solving | solved
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(null); // { attempt, max }

  // エンジン
  const [engineStatus, setEngineStatus] = useState('disconnected'); // disconnected | connecting | standby | busy
  const [engineName,   setEngineName]   = useState('');
  const engineSocketRef   = useRef(null);
  const engineCallbackRef = useRef(null); // (result) => void
  const enginePVRef       = useRef([]);   // ローカルエージェントの PV 蓄積用
  const engineTimerRef    = useRef(null);

  // JS Worker
  const workerRef  = useRef(null);

  const puzzleRef   = useRef(null);
  const genIdRef    = useRef(0);   // キャンセル用世代番号
  const autoPlayRef = useRef(null);

  // 盤面状態
  const [board,            setBoard]            = useState(null);
  const [hands,            setHands]            = useState(null);
  const [currentPlayer,    setCurrentPlayer]    = useState(1);
  const [currentSolutions, setCurrentSolutions] = useState(null);
  const [moveCount,        setMoveCount]        = useState(0);

  // UI 状態
  const [selected,     setSelected]     = useState(null);
  const [highlightSet, setHighlightSet] = useState(() => new Set());
  const [lastMove,     setLastMove]     = useState(null);
  const [message,      setMessage]      = useState('');
  const [showPromo,    setShowPromo]    = useState(null);
  const [flipped,      setFlipped]      = useState(false);

  // 解答表示
  const [showAnswer,   setShowAnswer]   = useState(false);
  const [answerStep,   setAnswerStep]   = useState(0);
  const [answerStates, setAnswerStates] = useState(null);
  const [autoPlay,     setAutoPlay]     = useState(false);

  // ── エンジン接続 ──────────────────────────────────────────────────

  useEffect(() => {
    const token = localStorage.getItem('shogi_jwt');
    if (!token) return;

    setEngineStatus('connecting');
    const socket = import.meta.env.VITE_USE_WEBRTC === 'true' && isWebRTCAvailable()
      ? createWebRTCSocket(token)
      : createWebSocketRelaySocket(token);
    engineSocketRef.current = socket;

    socket.on('connect',       () => {});
    socket.on('connect_error', () => { setEngineStatus('disconnected'); });

    socket.on('agent:connected', (info) => {
      setEngineStatus('standby');
      setEngineName(info?.name || info?.agentId || 'エンジン');
    });
    socket.on('agent:selected', (info) => {
      setEngineStatus('standby');
      setEngineName(info?.name || info?.agentId || 'エンジン');
    });
    socket.on('agent:left', () => {
      setEngineStatus('disconnected');
      setEngineName('');
    });
    socket.on('agent:disconnected', () => {
      setEngineStatus('disconnected');
      setEngineName('');
    });

    socket.on('engine:status', ({ status }) => {
      if (status === 'standby') {
        setEngineStatus('standby');
        // ローカルエージェントが bestmove を返した場合のフォールバック
        if (engineCallbackRef.current) {
          const pv = enginePVRef.current;
          enginePVRef.current = [];
          clearTimeout(engineTimerRef.current);
          const cb = engineCallbackRef.current;
          engineCallbackRef.current = null;
          cb(pv.length > 0 ? { found: true, moves: pv } : { found: false, moves: [] });
        }
      } else if (status === 'thinking') {
        setEngineStatus('busy');
      }
    });

    socket.on('engine:info', (data) => {
      // PV を蓄積 (ローカルエージェント用)
      if (engineCallbackRef.current && data.pv) {
        enginePVRef.current = Array.isArray(data.pv) ? data.pv : data.pv.split(' ').filter(Boolean);
      }
    });

    socket.on('tsume:solution', ({ moves }) => {
      if (engineCallbackRef.current) {
        clearTimeout(engineTimerRef.current);
        const cb = engineCallbackRef.current;
        engineCallbackRef.current = null;
        enginePVRef.current = [];
        cb({ found: true, moves: Array.isArray(moves) ? moves : moves.split(' ').filter(Boolean) });
      }
    });

    socket.on('tsume:failed', () => {
      if (engineCallbackRef.current) {
        clearTimeout(engineTimerRef.current);
        const cb = engineCallbackRef.current;
        engineCallbackRef.current = null;
        enginePVRef.current = [];
        cb({ found: false, moves: [] });
      }
    });

    return () => {
      socket.emit('stop');
      if (engineCallbackRef.current) {
        engineCallbackRef.current({ found: false, moves: [] });
        engineCallbackRef.current = null;
      }
      clearTimeout(engineTimerRef.current);
      clearTimeout(continuousTimerRef.current);
      workerRef.current?.terminate();
      workerRef.current = null;
      socket.disconnect();
      engineSocketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // generateRef: 常に最新の generate を指す（連続生成用）
  const generateRef = useRef(null);

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
  const numMoves = puzzle?.numMoves ?? difficulty;

  const diffInfo    = DIFFICULTIES.find(d => d.moves === difficulty) ?? DIFFICULTIES[1];
  const engineOk    = engineStatus === 'standby' || engineStatus === 'busy';
  // 実際にエンジンを使うか（元からエンジン必須 OR 1~5手でもエンジン強制）
  const willUseEngine = diffInfo.engine || (forceEngine && engineOk);

  // ── 状態リセット ─────────────────────────────────────────────────

  function clearPuzzleState() {
    setBoard(null); setHands(null);
    setSelected(null); setHighlightSet(new Set());
    setLastMove(null); setMessage('');
    setShowAnswer(false); setAnswerStep(0); setAnswerStates(null);
    setAutoPlay(false); setShowPromo(null);
    setLastMethod(null); setPublishedToken(null);
    puzzleRef.current = null;
    clearInterval(autoPlayRef.current);
  }

  // 生成された局面を公開する
  async function publishPuzzle(puzzleData) {
    if (!publishEnabled) return;
    const authToken = localStorage.getItem('shogi_jwt');
    if (!authToken) return; // 未ログインは投稿しない
    try {
      const title = `${puzzleData.numMoves}手詰め（AI生成）`;
      const res = await fetch(`${CLOUD_API}/api/tsume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title,
          puzzle: {
            board: puzzleData.board, hands: puzzleData.hands,
            attacker: puzzleData.attacker, solution: puzzleData.solution,
            numMoves: puzzleData.numMoves,
          },
          visibility: 'public',
          description: '',
          source: 'generator',
        }),
      });
      const json = await res.json();
      if (json.ok) setPublishedToken(json.token);
    } catch (_) {}
  }

  // ── エンジンへの問い合わせ (Promise) ─────────────────────────────

  function askEngine(sfen, timeLimit) {
    return new Promise((resolve) => {
      // 以前の問い合わせを破棄
      if (engineCallbackRef.current) {
        engineCallbackRef.current({ found: false, moves: [] });
        engineCallbackRef.current = null;
      }
      clearTimeout(engineTimerRef.current);
      enginePVRef.current = [];

      engineCallbackRef.current = resolve;
      const safetyBuffer = timeLimit <= 2000 ? 1500 : 5000;
      engineTimerRef.current = setTimeout(() => {
        if (engineCallbackRef.current === resolve) {
          engineCallbackRef.current = null;
          enginePVRef.current = [];
          resolve({ found: false, moves: [] });
        }
      }, timeLimit + safetyBuffer);

      engineSocketRef.current.emit('solve_tsume', { sfen, timeLimit });
    });
  }

  // ── エンジンによる生成ループ ──────────────────────────────────────

  async function generateWithEngine(numMoves) {
    const myId = ++genIdRef.current;
    const { timeLimit, maxAttempts, minMoves } = engineParams(numMoves);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (genIdRef.current !== myId) return;
      setProgress({ attempt, max: maxAttempts });

      // 1~5手は逆算候補（詰みに近い局面）を使う → エンジンの成功率が高い
      const seed = Date.now() ^ (attempt * 0x9f3b7);
      const pos = numMoves > 0 && numMoves <= 5
        ? generateRetrogradeCandidatePosition(numMoves, seed)
        : generateCandidatePosition(numMoves || 9, seed);
      if (!pos) continue;

      const sfen = boardToSFENForEngine(pos.board, pos.hands, 1, 1);
      const result = await askEngine(sfen, timeLimit);

      if (genIdRef.current !== myId) return;

      if (result.found && result.moves.length > 0) {
        const actual = result.moves.length;
        if (actual >= minMoves) {
          const solution = usiMovesToSolutionTree(result.moves, pos.board, pos.hands, 1);
          if (solution && usesAllHandPieces(solution, pos.hands[1]) && genIdRef.current === myId) {
            const pd = { board: pos.board, hands: pos.hands, attacker: 1, solution, numMoves: actual };
            puzzleRef.current = pd;
            setBoard(pos.board); setHands(pos.hands);
            setCurrentPlayer(1); setCurrentSolutions(solution);
            setMoveCount(0); setPhase('solving'); setProgress(null);
            publishPuzzle(pd);
            return;
          }
        }
      }
    }

    if (genIdRef.current === myId) {
      if (continuousModeRef.current) {
        continuousTimerRef.current = setTimeout(() => generateRef.current?.(), 1000);
      } else {
        setPhase('idle'); setProgress(null);
        setMessage('生成に失敗しました。エンジンが接続されているか確認してください。');
      }
    }
  }

  // ── JS Worker による生成（Promise 版） ──────────────────────────

  function runJSWorker(numMoves) {
    return new Promise((resolve) => {
      workerRef.current?.terminate();
      const w = new TsumeGeneratorWorkerClass();
      workerRef.current = w;
      w.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          setProgress({ attempt: data.attempt, max: data.max });
        } else if (data.type === 'result') {
          workerRef.current = null;
          resolve({ ok: true, ...data });
        } else if (data.type === 'failed') {
          workerRef.current = null;
          resolve({ ok: false });
        }
      };
      w.postMessage({ cmd: 'generate', numMoves, useRetrograde: true });
    });
  }

  function generateWithJS(numMoves) {
    runJSWorker(numMoves).then(data => {
      if (data.ok) {
        puzzleRef.current = data;
        setBoard(data.board); setHands(data.hands);
        setCurrentPlayer(data.attacker); setCurrentSolutions(data.solution);
        setMoveCount(0); setPhase('solving'); setProgress(null);
        setLastMethod(data.method ?? null);
        publishPuzzle(data);
      } else {
        if (continuousModeRef.current) {
          continuousTimerRef.current = setTimeout(() => generateRef.current?.(), 1000);
        } else {
          setPhase('idle'); setProgress(null);
          setMessage('生成に失敗しました。もう一度お試しください。');
        }
      }
    });
  }

  // ── JS生成 → エンジン検証（1~5手 forceEngine 用） ───────────────
  // JS Worker で逆算生成（速い）→ 生成できた局面を1回だけエンジンに確認。
  // ランダム候補を何十回も投げる方式に比べ大幅に速い。

  async function generateWithJSThenEngine(numMoves) {
    const myId = ++genIdRef.current;

    // Step 1: JS Worker で局面生成
    const jsData = await runJSWorker(numMoves);
    if (genIdRef.current !== myId) return;

    if (!jsData.ok) {
      if (continuousModeRef.current) {
        continuousTimerRef.current = setTimeout(() => generateRef.current?.(), 1000);
      } else {
        setPhase('idle'); setProgress(null);
        setMessage('生成に失敗しました。もう一度お試しください。');
      }
      return;
    }

    // Step 2: エンジンで確認（1回だけ）
    setProgress({ attempt: 0, max: 1 });
    const sfen = boardToSFENForEngine(jsData.board, jsData.hands, 1, 1);
    const { timeLimit } = engineParams(numMoves);
    const engineResult = await askEngine(sfen, timeLimit);

    if (genIdRef.current !== myId) return;

    if (engineResult.found && engineResult.moves.length >= numMoves) {
      const solution = usiMovesToSolutionTree(engineResult.moves, jsData.board, jsData.hands, 1);
      if (solution && usesAllHandPieces(solution, jsData.hands[1])) {
        const pd = { board: jsData.board, hands: jsData.hands, attacker: 1, solution, numMoves: engineResult.moves.length };
        puzzleRef.current = pd;
        setBoard(jsData.board); setHands(jsData.hands);
        setCurrentPlayer(1); setCurrentSolutions(solution);
        setMoveCount(0); setPhase('solving'); setProgress(null);
        setLastMethod('engine');
        publishPuzzle(pd);
        return;
      }
    }

    // JS解はワーカー内で余り駒チェック済みなのでそのまま使用
    puzzleRef.current = jsData;
    setBoard(jsData.board); setHands(jsData.hands);
    setCurrentPlayer(jsData.attacker); setCurrentSolutions(jsData.solution);
    setMoveCount(0); setPhase('solving'); setProgress(null);
    setLastMethod(jsData.method ?? null);
    publishPuzzle(jsData);
  }

  // ── 生成キャンセル ────────────────────────────────────────────────

  function cancelGeneration() {
    ++genIdRef.current;
    workerRef.current?.terminate();
    workerRef.current = null;
    engineSocketRef.current?.emit('stop');
    if (engineCallbackRef.current) {
      engineCallbackRef.current({ found: false, moves: [] });
      engineCallbackRef.current = null;
    }
    clearTimeout(engineTimerRef.current);
    enginePVRef.current = [];
    setPhase('idle');
    setProgress(null);
  }

  // ── 生成メイン ───────────────────────────────────────────────────

  function generate() {
    clearTimeout(continuousTimerRef.current);
    ++genIdRef.current;
    workerRef.current?.terminate();
    workerRef.current = null;
    engineSocketRef.current?.emit('stop');
    if (engineCallbackRef.current) {
      engineCallbackRef.current({ found: false, moves: [] });
      engineCallbackRef.current = null;
    }
    clearTimeout(engineTimerRef.current);
    enginePVRef.current = [];

    setPhase('generating');
    setProgress(null);
    clearPuzzleState();

    if (diffInfo.engine) {
      // 7手以上: エンジン必須（純エンジン生成）
      if (!engineOk || !engineSocketRef.current) {
        setPhase('idle');
        setMessage('エンジン未接続です。ローカルエージェントを起動してください。');
        return;
      }
      generateWithEngine(difficulty).catch(() => {});
    } else if (forceEngine && engineOk && engineSocketRef.current) {
      // 1~5手 + エンジン使用ON: JS逆算で生成 → エンジンで1回確認
      generateWithJSThenEngine(difficulty).catch(() => {});
    } else {
      // 1~5手 デフォルト: JS逆算のみ
      generateWithJS(difficulty);
    }
  }

  // render ごとに最新値を ref に同期
  generateRef.current      = generate;
  continuousModeRef.current = continuousMode;

  // ── リセット ────────────────────────────────────────────────────

  function resetPuzzle() {
    if (!puzzle) return;
    setBoard(puzzle.board); setHands(puzzle.hands);
    setCurrentPlayer(puzzle.attacker); setCurrentSolutions(puzzle.solution);
    setMoveCount(0);
    setSelected(null); setHighlightSet(new Set());
    setLastMove(null); setMessage('');
    setShowPromo(null);
    setShowAnswer(false); setAnswerStep(0); setAutoPlay(false);
    clearInterval(autoPlayRef.current);
    setPhase('solving');
  }

  // ── 解答表示 ────────────────────────────────────────────────────

  function openAnswer() {
    if (!puzzle) return;
    const mainLine = extractMainLine(puzzle.solution, attacker, defender);
    const states   = computeAnswerStates(puzzle.board, puzzle.hands, mainLine);
    setAnswerStates(states); setAnswerStep(0);
    setShowAnswer(true); setAutoPlay(false);
  }

  function closeAnswer() {
    setShowAnswer(false); setAutoPlay(false);
    clearInterval(autoPlayRef.current);
  }

  // 連続生成: 問題が表示されたら(solving)8秒後に自動で次の問題を生成。解かなくてもOK
  useEffect(() => {
    if (phase !== 'solving' || !continuousMode) return;
    const t = setTimeout(() => generateRef.current?.(), 1000);
    continuousTimerRef.current = t;
    return () => {
      clearTimeout(t);
      if (continuousTimerRef.current === t) continuousTimerRef.current = null;
    };
  }, [phase, continuousMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 指し手 ──────────────────────────────────────────────────────

  function executeAttackerMove(move) {
    setShowPromo(null);
    setSelected(null); setHighlightSet(new Set());

    const matched = currentSolutions?.find(s =>
      movesMatch(s.move, move) || movesMatch(s.move, { ...move, promote: !move.promote })
    );
    if (!matched) {
      setMessage('❌ その手は最善手ではありません。もう一度考えてみよう！');
      return;
    }
    const eff = matched.move;
    const { board: nb, hands: nh } = applyMove(board, hands, eff, attacker);
    setBoard(nb); setHands(nh);
    setLastMove(moveToLastMove(eff)); setMoveCount(c => c + 1);
    setMessage('');

    if (matched.defenses.length === 0) {
      setPhase('solved'); setCurrentSolutions([]);
      if (continuousMode) {
        clearTimeout(continuousTimerRef.current);
        continuousTimerRef.current = setTimeout(() => generateRef.current?.(), 1500);
      }
      return;
    }
    setCurrentPlayer(defender);

    setTimeout(() => {
      let best = matched.defenses[0];
      let bestD = depthOf(best.reply);
      for (let i = 1; i < matched.defenses.length; i++) {
        const d = depthOf(matched.defenses[i].reply);
        if (d > bestD) { bestD = d; best = matched.defenses[i]; }
      }
      const { board: nb2, hands: nh2 } = applyMove(nb, nh, best.defMove, defender);
      setBoard(nb2); setHands(nh2);
      setLastMove(moveToLastMove(best.defMove)); setMoveCount(c => c + 1);
      if (!best.reply || best.reply.length === 0) {
        setPhase('solved'); setCurrentSolutions([]);
        if (continuousMode) {
          clearTimeout(continuousTimerRef.current);
          continuousTimerRef.current = setTimeout(() => generateRef.current?.(), 1500);
        }
      } else {
        setCurrentSolutions(best.reply); setCurrentPlayer(attacker);
      }
    }, 600);
  }

  // ── 盤面クリック ─────────────────────────────────────────────────

  function handleCellClick(r, c) {
    if (showAnswer || phase !== 'solving' || currentPlayer !== attacker) return;
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
        executeAttackerMove(move); return;
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

  // ── 持ち駒クリック ───────────────────────────────────────────────

  function handleDropSelect({ player, type } = {}) {
    if (showAnswer || phase !== 'solving' || currentPlayer !== attacker) return;
    if (!type || player !== attacker) { setSelected(null); setHighlightSet(new Set()); return; }
    if (selected?.type === 'hand' && selected.piece === type) {
      setSelected(null); setHighlightSet(new Set()); return;
    }
    const dests = getLegalDropDestinations(board, hands, type, attacker);
    setSelected({ type: 'hand', player: attacker, piece: type });
    setHighlightSet(new Set(dests.map(([dr, dc]) => `${dr},${dc}`)));
    setMessage('');
  }

  // ── ヒント ───────────────────────────────────────────────────────

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

  // ── 表示用データ ─────────────────────────────────────────────────

  const displayBoard    = showAnswer && answerStates ? answerStates[answerStep].board    : board;
  const displayHands    = showAnswer && answerStates ? answerStates[answerStep].hands    : hands;
  const displayLastMove = showAnswer && answerStates ? answerStates[answerStep].lastMove : lastMove;
  const answerTotal     = answerStates ? answerStates.length - 1 : 0;

  const selectedCell = (!showAnswer && selected?.type === 'board') ? { row: selected.row, col: selected.col } : null;
  const dropSelected = (!showAnswer && selected?.type === 'hand')  ? { player: selected.player, type: selected.piece } : null;

  const leftPCPlayer  = flipped ? attacker : defender;
  const rightPCPlayer = flipped ? defender : attacker;
  const topMobPlayer  = flipped ? attacker : defender;
  const botMobPlayer  = flipped ? defender : attacker;

  function getDropProps(player) {
    if (showAnswer || player !== attacker) return { dropSelected: null, onDropSelect: null };
    return { dropSelected, onDropSelect: handleDropSelect };
  }

  const statusText = showAnswer
    ? (answerStep === 0 ? '解答手順（初期局面）' : `第${answerStep}手${answerStep % 2 === 1 ? '（攻め方）' : '（玉方）'}`)
    : phase === 'solved'                             ? '🎉 正解！詰みました！'
    : message                                        ? message
    : currentPlayer === defender && phase === 'solving' ? '玉方が応手中...'
    : `${numMoves}手詰め：攻め方の番`;

  const statusColor = showAnswer                              ? 'bg-blue-900/40 text-blue-300'
    : phase === 'solved'                                     ? 'bg-green-900/50 text-green-300'
    : message.startsWith('❌')                               ? 'bg-red-900/40 text-red-300'
    : message.startsWith('💡')                               ? 'bg-amber-900/30 text-amber-300'
    : currentPlayer === defender && phase === 'solving'      ? 'bg-gray-800/80 text-gray-400'
    :                                                          'bg-gray-800/80 text-gray-300';

  // ── レンダリング ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-white lg:ml-64 pb-16 lg:pb-0">
      <TsumeNav />

      {/* ヘッダー */}
      <div className="sticky top-0 z-20 bg-gray-900/95 backdrop-blur border-b border-gray-700">
        <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 py-2.5">
          <Link to="/tsume/category/all" className="text-gray-400 hover:text-white transition-colors shrink-0 p-1">
            <ChevronLeft size={20} />
          </Link>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm">詰将棋ジェネレーター</p>
            <p className="text-xs text-gray-500">ランダムな詰将棋を自動生成して解こう</p>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border shrink-0
            ${engineStatus === 'standby' || engineStatus === 'busy'
              ? 'bg-green-900/40 border-green-700/50 text-green-300'
              : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
            {engineStatus === 'standby' || engineStatus === 'busy'
              ? <><Cpu size={10} className="shrink-0" />{engineName || 'エンジン'}</>
              : engineStatus === 'connecting'
              ? <><Wifi size={10} className="animate-pulse shrink-0" />接続中</>
              : <><WifiOff size={10} className="shrink-0" />未接続</>}
          </div>
          {authInfo && (
            <AccountMenu
              email={authInfo.email}
              userId={authInfo.userId}
              onLogout={() => { localStorage.removeItem('shogi_jwt'); navigate('/login'); }}
            />
          )}
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="flex gap-5 items-start">

          {/* 左スペーサー */}
          <div className="hidden lg:block w-36 shrink-0" />

          {/* 中央: パズル本体 */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">

            {/* 難易度選択 */}
            <div className="flex flex-col gap-2">
              <div className="flex gap-1.5 flex-wrap">
                {DIFFICULTIES.map(d => {
                  const needsEngine = d.engine;
                  const disabled    = phase === 'generating';
                  return (
                    <button
                      key={d.moves}
                      onClick={() => setDifficulty(d.moves)}
                      disabled={disabled}
                      className={`relative px-3 py-1.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 border
                        ${difficulty === d.moves
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : needsEngine
                          ? engineOk
                            ? 'bg-gray-800 border-purple-700/50 text-purple-300 hover:bg-purple-900/30'
                            : 'bg-gray-800/50 border-gray-700/50 text-gray-600'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
                    >
                      {d.label}
                      {needsEngine && <span className="ml-1 text-[9px] text-purple-400 align-super"><Cpu size={8} className="inline" /></span>}
                    </button>
                  );
                })}
              </div>

              {/* エンジン関連の注記 + 1~5手エンジン強制トグル */}
              <div className="flex items-center gap-3 flex-wrap">
                {(diffInfo.engine || willUseEngine) && (
                  <p className="text-[11px] text-purple-400/80 flex items-center gap-1">
                    <Cpu size={10} />
                    {diffInfo.engine ? 'ローカルエージェントが必要です' : 'エンジンで生成します'}
                    {engineOk && ` (${engineName || 'エンジン'} 接続済み)`}
                  </p>
                )}
                {/* 1~5手: エンジン使用トグル (エンジン接続時のみ表示) */}
                {!diffInfo.engine && engineOk && (
                  <button
                    onClick={() => setForceEngine(f => !f)}
                    disabled={phase === 'generating'}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-50
                      ${forceEngine
                        ? 'bg-purple-900/50 border-purple-500/60 text-purple-300'
                        : 'bg-gray-800/60 border-gray-700/60 text-gray-500 hover:text-gray-300 hover:border-gray-600'}`}
                  >
                    <Cpu size={10} />
                    エンジン使用 {forceEngine ? 'ON' : 'OFF'}
                  </button>
                )}
              </div>
            </div>

            {/* 生成ボタン行 */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={generate}
                disabled={phase === 'generating'}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-600
                           hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-60"
              >
                <Shuffle size={14} />
                {phase === 'generating' ? '生成中...' : '新しい問題'}
              </button>
              {/* 連続生成トグル */}
              <button
                onClick={() => setContinuousMode(m => !m)}
                disabled={phase === 'generating'}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50
                  ${continuousMode
                    ? 'bg-emerald-900/40 border-emerald-600/60 text-emerald-300'
                    : 'bg-gray-800/60 border-gray-700 text-gray-500 hover:text-gray-300'}`}
              >
                <Shuffle size={11} />
                連続生成 {continuousMode ? 'ON' : 'OFF'}
              </button>
              {/* 公開チェックボックス */}
              <label className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors select-none
                ${publishEnabled
                  ? 'bg-blue-900/30 border-blue-600/50 text-blue-300'
                  : 'bg-gray-800/60 border-gray-700 text-gray-500'}`}>
                <input
                  type="checkbox"
                  checked={publishEnabled}
                  onChange={e => setPublishEnabled(e.target.checked)}
                  className="w-3 h-3 accent-blue-500"
                />
                <Globe size={11} />
                <span className="text-xs font-medium">公開する</span>
              </label>
              {/* 公開済みバッジ */}
              {publishedToken && (
                <a
                  href={`/tsume/${publishedToken}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-900/30
                             border border-green-600/50 text-green-300 text-xs hover:bg-green-900/50 transition-colors"
                >
                  <Globe size={11} />
                  公開済み
                  <ExternalLink size={10} />
                </a>
              )}
              {board && phase !== 'generating' && (
                <>
                  <button
                    onClick={handleHint}
                    disabled={phase !== 'solving' || !currentSolutions?.length}
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
              {board && phase !== 'generating' && (
                <button
                  onClick={() => setFlipped(f => !f)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors
                    ${flipped ? 'bg-purple-600/30 text-purple-300' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                >
                  <FlipVertical2 size={13} /> 反転
                </button>
              )}
            </div>

            {/* 生成中 */}
            {phase === 'generating' && (
              <div className="flex flex-col items-center gap-3 py-10">
                <svg className="animate-spin w-8 h-8 text-emerald-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <p className="text-gray-400 text-sm">
                  {diffInfo.engine ? 'エンジンで探索中...' : '逆算生成中...'}
                </p>
                {progress && (
                  <div className="w-full max-w-xs">
                    <div className="w-full bg-gray-800 rounded-full h-1.5">
                      <div className="bg-emerald-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (progress.attempt / progress.max) * 100)}%` }} />
                    </div>
                    <p className="text-center text-xs text-gray-600 mt-1">{progress.attempt} / {progress.max} 試行</p>
                  </div>
                )}
                <button
                  onClick={cancelGeneration}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-600
                             hover:border-red-500/60 text-gray-400 hover:text-red-400 text-sm transition-colors"
                >
                  <Square size={13} /> キャンセル
                </button>
              </div>
            )}

            {/* アイドル */}
            {phase === 'idle' && !board && (
              <div className="text-center py-14 flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center">
                  <Shuffle size={26} className="text-gray-600" />
                </div>
                <p className="text-gray-500 text-sm">「新しい問題」を押して詰将棋を生成しましょう</p>
                {message && <p className="text-red-400 text-xs mt-1 max-w-xs text-center">{message}</p>}
              </div>
            )}

            {/* 盤面エリア */}
            {board && phase !== 'generating' && (
              <>
                {/* ステータスバー */}
                <div className={`rounded-xl px-4 py-2 text-center text-sm font-medium transition-all ${statusColor}`}>
                  {statusText}
                  {lastMethod && (
                    <span className={`ml-2 text-[10px] font-normal opacity-70`}>
                      {lastMethod === 'retrograde' ? '· 逆算生成' : '· ランダム生成'}
                    </span>
                  )}
                  {continuousMode && phase === 'solving' && (
                    <span className="ml-2 text-[10px] text-emerald-400 opacity-80 animate-pulse">· 連続生成中</span>
                  )}
                </div>

                {/* 盤面 */}
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
                    <div className="hidden lg:flex self-stretch">
                      <HandColumnVertical
                        hands={displayHands} player={leftPCPlayer} activePlayer={currentPlayer}
                        pieceAlign="top" flipped={flipped}
                        {...getDropProps(leftPCPlayer)}
                      />
                    </div>
                    <div className="flex-1">
                      <BoardCore
                        board={displayBoard}
                        selectedCell={showAnswer ? null : selectedCell}
                        highlightSet={showAnswer ? new Set() : highlightSet}
                        lastMove={displayLastMove}
                        onCellClick={showAnswer ? undefined : handleCellClick}
                        activePlayer={currentPlayer}
                        flipped={flipped}
                      />
                    </div>
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

                {/* 解答ナビゲーション */}
                {showAnswer && answerStates && (
                  <div className="bg-gray-800 border border-blue-500/30 rounded-xl px-4 py-3 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-blue-300 font-bold">解答手順</span>
                      <span className="text-xs text-gray-400">{answerStep} / {answerTotal} 手</span>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => { setAnswerStep(0); setAutoPlay(false); }} disabled={answerStep === 0}
                        className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-30">
                        <SkipBack size={16} />
                      </button>
                      <button onClick={() => { setAnswerStep(s => Math.max(0, s - 1)); setAutoPlay(false); }} disabled={answerStep === 0}
                        className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-30">
                        <ChevronLeft size={16} />
                      </button>
                      <button onClick={() => setAutoPlay(a => !a)}
                        className={`p-2 rounded-lg transition-colors ${autoPlay ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>
                        {autoPlay ? <Square size={16} /> : <Play size={16} />}
                      </button>
                      <button onClick={() => { setAnswerStep(s => Math.min(answerTotal, s + 1)); setAutoPlay(false); }} disabled={answerStep === answerTotal}
                        className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-30">
                        <ChevronRightIcon size={16} />
                      </button>
                      <button onClick={() => { setAnswerStep(answerTotal); setAutoPlay(false); }} disabled={answerStep === answerTotal}
                        className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-30">
                        <SkipForward size={16} />
                      </button>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all"
                        style={{ width: answerTotal > 0 ? `${(answerStep / answerTotal) * 100}%` : '0%' }} />
                    </div>
                    <button onClick={closeAnswer} className="text-xs text-gray-500 hover:text-gray-300 transition-colors text-center">
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
              </>
            )}
          </div>

          {/* 右スペーサー */}
          <div className="hidden lg:block w-36 shrink-0" />
        </div>
      </div>

      {/* 詰み達成オーバーレイ */}
      {phase === 'solved' && !showAnswer && (
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
            {continuousMode ? (
              <div className="w-full text-center">
                <p className="text-emerald-400 text-sm animate-pulse">次の問題を自動生成中...</p>
                <button
                  onClick={() => { clearTimeout(continuousTimerRef.current); setContinuousMode(false); }}
                  className="mt-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  連続生成を止める
                </button>
              </div>
            ) : (
              <>
                <button onClick={generate}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors">
                  次の問題へ
                </button>
                <button onClick={resetPuzzle} className="text-gray-400 hover:text-gray-300 text-sm">
                  もう一度挑戦
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 成り確認ダイアログ */}
      {showPromo && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => { executeAttackerMove({ ...showPromo, promote: false }); setShowPromo(null); }}>
          <div className="bg-gray-800 border border-gray-600 rounded-2xl p-5 flex flex-col gap-3 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <p className="text-white text-center font-bold">成りますか？</p>
            <div className="flex gap-3">
              <button onClick={() => { executeAttackerMove({ ...showPromo, promote: true }); setShowPromo(null); }}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors">
                成る
              </button>
              <button onClick={() => { executeAttackerMove({ ...showPromo, promote: false }); setShowPromo(null); }}
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
