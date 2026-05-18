/**
 * tsumeGenerator.js — ランダム詰将棋局面生成
 *
 * generateTsumePosition  : JS ソルバーで検証 (1/3/5手詰め用、Worker から呼ぶ)
 * generateCandidatePosition: 検証なしで局面だけ生成 (エンジン検証用)
 */
import { isInCheck, isCheckmate } from '../state/gameState.js';
import { solveTsume } from '../engine/tsumeShogi.js';

// 将棋の全駒数（玉を除く）
const PIECE_TOTALS = { R: 2, B: 2, G: 4, S: 4, N: 4, L: 4, P: 18 };

/**
 * 解手順ツリーの「最短詰み手数」を返す（攻め方視点の最小経路）。
 * 正しい N 手詰め問題なら minSolveDepth(finalSol) === N のはず。
 * 短い経路が混入していれば N より小さくなるので不正検出に使う。
 */
function minSolveDepth(sol) {
  if (!sol || sol.length === 0) return Infinity;
  let min = Infinity;
  for (const node of sol) {
    if (!node.defenses || node.defenses.length === 0) {
      min = Math.min(min, 1);
    } else {
      let worst = 0;
      for (const d of node.defenses) {
        worst = Math.max(worst, 1 + minSolveDepth(d.reply));
      }
      min = Math.min(min, 1 + worst);
    }
  }
  return min === Infinity ? 0 : min;
}

/**
 * 玉方の持ち駒を自動計算する。
 * 詰将棋のルール: 玉方は盤上にない・攻め方も持っていない駒を全て持つ。
 */
export function fillDefenderHand(board, hands) {
  const onBoard = { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 };
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p || p.type === 'K') continue;
      const base = p.type.startsWith('+') ? p.type.slice(1) : p.type;
      if (base in onBoard) onBoard[base]++;
    }
  const defHand = {};
  for (const [type, total] of Object.entries(PIECE_TOTALS)) {
    const used = (onBoard[type] || 0) + (hands[1][type] || 0);
    const rem = total - used;
    if (rem > 0) defHand[type] = rem;
  }
  hands[2] = defHand;
}

/**
 * 解答ツリー内で攻め方が持ち駒を全種類使っているか確認する（余り駒禁止）。
 * 解答の全変化を走査し、各駒種が1回以上打たれていれば OK。
 */
export function usesAllHandPieces(solution, attHands) {
  if (!solution || !attHands) return false;
  const needed = Object.keys(attHands).filter(k => attHands[k] > 0);
  // 持ち駒が0枚の局面も除外（盤上の駒だけで詰む局面は不可）
  if (needed.length === 0) return false;

  // 解答ツリー全体の和集合で使用駒を確認（簡易チェック）
  // 厳密な余り駒チェックは hasNoSparePieces を使う
  const used = new Set();
  function visit(nodes) {
    for (const node of (nodes ?? [])) {
      if (node.move?.from === null && node.move?.piece) used.add(node.move.piece);
      for (const def of (node.defenses ?? [])) visit(def.reply);
    }
  }
  visit(solution);

  return needed.every(type => used.has(type));
}

/**
 * 余り駒を hands[1] から除去する（インプレース）。
 * 各駒を1枚減らして再ソルバーを走らせ、まだ詰めるなら余り駒として除去する。
 * 除去後に持ち駒が1枚以上残れば true、全て余り駒なら false を返す。
 * @param {Array} board
 * @param {Object} hands  { 1: {...}, 2: {...} } — hands[1] を直接変更する
 * @param {number} numMoves
 * @param {number} timeoutMs 各チェックのタイムアウト
 */
export function trimSparePieces(board, hands, numMoves, timeoutMs) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [type, count] of Object.entries({ ...hands[1] })) {
      if ((count || 0) <= 0) continue;
      const th = { 1: { ...hands[1] }, 2: { ...(hands[2] || {}) } };
      th[1][type] = count - 1;
      if (!th[1][type]) delete th[1][type];
      fillDefenderHand(board, th);
      const sol = solveTsume(board, th, 1, numMoves, timeoutMs);
      if (sol && sol.length > 0) {
        // この駒は余り → hands[1] から除去
        hands[1][type] = count - 1;
        if (!hands[1][type]) delete hands[1][type];
        fillDefenderHand(board, hands);
        changed = true;
        break;
      }
    }
  }
  return Object.values(hands[1]).some(c => (c || 0) > 0);
}

function getBaseType(t) {
  return t.startsWith('+') ? t.slice(1) : t;
}

// 盤上 + hands[1] での baseType の使用枚数 (両プレイヤー合計)
function countUsedOfBase(board, hands1, baseType) {
  let n = 0;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p || p.type === 'K') continue;
      if (getBaseType(p.type) === baseType) n++;
    }
  n += (hands1[baseType] || 0);
  return n;
}

// xorshift32 RNG
function makeRng(seed) {
  let s = ((seed ^ 0xdeadbeef) >>> 0) || 0xcafebabe;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function findKing(board, player) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c]?.type === 'K' && board[r][c]?.player === player) return [r, c];
  return null;
}

function isValidStart(board, hands) {
  const k1 = findKing(board, 1);
  const k2 = findKing(board, 2);
  if (!k1 || !k2) return false;

  // 両玉が隣接していない
  if (Math.abs(k1[0] - k2[0]) <= 1 && Math.abs(k1[1] - k2[1]) <= 1) return false;

  // 攻め方の玉が王手されていない
  if (isInCheck(board, 1)) return false;

  // 初期局面で玉方が既に王手されていない (詰将棋は攻め方の初手が王手でなければならない)
  if (isInCheck(board, 2)) return false;

  // 既に詰んでいる状態でない
  if (isCheckmate(board, hands, 2)) return false;

  // 違法駒配置チェック (成れない位置に歩・香・桂)
  for (let c = 0; c < 9; c++) {
    for (let r = 0; r < 9; r++) {
      const p = board[r][c];
      if (!p) continue;
      if (p.type === 'P' && p.player === 1 && r === 0) return false;
      if (p.type === 'P' && p.player === 2 && r === 8) return false;
      if (p.type === 'L' && p.player === 1 && r === 0) return false;
      if (p.type === 'L' && p.player === 2 && r === 8) return false;
      if (p.type === 'N' && p.player === 1 && r <= 1) return false;
      if (p.type === 'N' && p.player === 2 && r >= 7) return false;
    }
  }

  // 二歩チェック
  for (let c = 0; c < 9; c++) {
    let p1 = 0, p2 = 0;
    for (let r = 0; r < 9; r++) {
      const p = board[r][c];
      if (p?.type === 'P') { if (p.player === 1) p1++; else p2++; }
    }
    if (p1 > 1 || p2 > 1) return false;
  }

  return true;
}

// 持ち駒に使う駒種 (生駒のみ)
const HAND_PIECES = ['G', 'S', 'R', 'B', 'L', 'N', 'P'];

// 盤上配置に使う攻め方の駒種 (成り駒も可)
const BOARD_ATK_PIECES = ['G', 'S', 'R', 'B', '+R', '+B', '+S', '+N', '+L', '+P'];

// 玉方の守備駒
const BOARD_DEF_PIECES = ['G', 'S'];

/**
 * N手詰め局面を生成する。
 * @param {number} numMoves 1 | 3 | 5
 * @param {number} seed
 * @param {function} onProgress (attempt, maxAttempts) => void
 * @returns {{ board, hands, attacker, solution, numMoves } | null}
 */
export function generateTsumePosition(numMoves, seed, onProgress) {
  const rng = makeRng(seed ?? Date.now());

  const MAX_ATTEMPTS      = numMoves === 1 ? 800 : numMoves === 3 ? 600 : 300;
  const TIME_SOLVE        = numMoves === 1 ? 200 : numMoves === 3 ? 600 : 2000;
  const TIME_EXCLUDE      = numMoves === 3 ? 150 : numMoves === 5 ? 400 : 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    onProgress?.(attempt, MAX_ATTEMPTS);

    const board = Array(9).fill(null).map(() => Array(9).fill(null));
    const hands = { 1: {}, 2: {} };

    // 玉方の玉 (player 2) を上部に配置
    const defRow = Math.floor(rng() * 3);
    const defCol = Math.floor(rng() * 9);
    board[defRow][defCol] = { type: 'K', player: 2 };

    // 攻め方の玉 (player 1) を下部に配置 (隣接禁止)
    let attRow, attCol, placed = false;
    for (let ki = 0; ki < 50; ki++) {
      attRow = 6 + Math.floor(rng() * 3);
      attCol = Math.floor(rng() * 9);
      if (!(Math.abs(attRow - defRow) <= 1 && Math.abs(attCol - defCol) <= 1)) {
        placed = true;
        break;
      }
    }
    if (!placed) continue;
    board[attRow][attCol] = { type: 'K', player: 1 };

    // 攻め方の持ち駒
    const numHand = numMoves === 1 ? 1 + Math.floor(rng() * 2)
                  : numMoves === 3 ? 2 + Math.floor(rng() * 2)
                  : 2 + Math.floor(rng() * 3);
    for (let i = 0; i < numHand; i++) {
      // 残り枚数がある駒種のみ加算
      for (let hi = 0; hi < HAND_PIECES.length * 3; hi++) {
        const p = HAND_PIECES[Math.floor(rng() * HAND_PIECES.length)];
        if (countUsedOfBase(board, hands[1], p) < PIECE_TOTALS[p]) {
          hands[1][p] = (hands[1][p] || 0) + 1;
          break;
        }
      }
    }

    // 攻め方の盤上駒 (3手・5手用)
    if (numMoves >= 3) {
      const numBoardAtk = Math.floor(rng() * (numMoves === 3 ? 2 : 3));
      const usedPawnCols = new Set();
      for (let i = 0; i < numBoardAtk; i++) {
        const pType = BOARD_ATK_PIECES[Math.floor(rng() * BOARD_ATK_PIECES.length)];
        const pBase = getBaseType(pType);
        if (countUsedOfBase(board, hands[1], pBase) >= PIECE_TOTALS[pBase]) continue;
        for (let ai = 0; ai < 40; ai++) {
          const r = Math.floor(rng() * 9);
          const c = Math.floor(rng() * 9);
          if (board[r][c]) continue;
          if (pType === 'P' && r === 0) continue;
          if (pType === 'L' && r === 0) continue;
          if (pType === 'N' && r <= 1) continue;
          if (pType === 'P' && usedPawnCols.has(c)) continue;
          board[r][c] = { type: pType, player: 1 };
          if (pType === 'P') usedPawnCols.add(c);
          break;
        }
      }
    }

    // 玉方の守備駒 (3手・5手用)
    if (numMoves >= 3 && rng() < 0.7) {
      const numDef = 1 + Math.floor(rng() * (numMoves === 3 ? 2 : 3));
      for (let i = 0; i < numDef; i++) {
        const pType = BOARD_DEF_PIECES[Math.floor(rng() * BOARD_DEF_PIECES.length)];
        for (let bi = 0; bi < 30; bi++) {
          const r = Math.max(0, Math.min(8, defRow + Math.round((rng() - 0.5) * 4)));
          const c = Math.max(0, Math.min(8, defCol + Math.round((rng() - 0.5) * 4)));
          if (!board[r][c]) {
            board[r][c] = { type: pType, player: 2 };
            break;
          }
        }
      }
    }

    // 玉方の持ち駒を確定（盤上・攻め方手駒以外の全駒）
    fillDefenderHand(board, hands);

    if (!isValidStart(board, hands)) continue;

    // 短手数で解ける局面を除外 (numMoves >= 3 は常にチェック)
    if (numMoves >= 3) {
      const tExclude = TIME_EXCLUDE > 0 ? TIME_EXCLUDE : 200;
      const shorter = solveTsume(board, hands, 1, numMoves - 2, tExclude, true);
      if (shorter) continue;
    }

    // N手詰めを解く
    const sol = solveTsume(board, hands, 1, numMoves, TIME_SOLVE);
    if (sol && sol.length > 0) {
      // 余り駒を除去して持ち駒を必要最小限に整理
      const TIME_SPARE = numMoves === 1 ? 100 : numMoves === 3 ? 200 : 500;
      const hasHand = trimSparePieces(board, hands, numMoves, TIME_SPARE);
      if (!hasHand) continue; // 全て余り駒だった（持ち駒なしで詰む）
      // trim 後に局面が簡単になっていないか再確認
      if (numMoves >= 3) {
        const tExclude = TIME_EXCLUDE > 0 ? TIME_EXCLUDE : 500;
        const shorter = solveTsume(board, hands, 1, numMoves - 2, tExclude, true);
        if (shorter) continue;
      }
      // 持ち駒が変わったため再ソルブ
      const finalSol = solveTsume(board, hands, 1, numMoves, TIME_SOLVE);
      if (finalSol && finalSol.length > 0 && minSolveDepth(finalSol) === numMoves) {
        return { board, hands, attacker: 1, solution: finalSol, numMoves };
      }
    }
  }

  return null;
}

/**
 * ソルバー検証なしで局面候補を生成する。
 * エンジンで検証する場合に使用 (7手以上の超手数向け)。
 *
 * @param {number} numMoves 目安手数 (駒数の調整に使用)
 * @param {number} seed
 * @returns {{ board, hands } | null}
 */
export function generateCandidatePosition(numMoves, seed) {
  const rng = makeRng(seed ?? Date.now());

  for (let attempt = 0; attempt < 80; attempt++) {
    const board = Array(9).fill(null).map(() => Array(9).fill(null));
    const hands = { 1: {}, 2: {} };

    // 玉方の玉を上部に配置 (7手以上は端や角を優先)
    let defRow, defCol;
    if (numMoves >= 7 && rng() < 0.6) {
      defRow = Math.floor(rng() * 3);
      defCol = rng() < 0.5 ? Math.floor(rng() * 2) : 8 - Math.floor(rng() * 2);
    } else {
      defRow = Math.floor(rng() * 3);
      defCol = Math.floor(rng() * 9);
    }
    board[defRow][defCol] = { type: 'K', player: 2 };

    // 攻め方の玉を下部に配置
    let attRow, attCol, placed = false;
    for (let ki = 0; ki < 50; ki++) {
      attRow = 6 + Math.floor(rng() * 3);
      attCol = Math.floor(rng() * 9);
      if (!(Math.abs(attRow - defRow) <= 1 && Math.abs(attCol - defCol) <= 1)) {
        placed = true; break;
      }
    }
    if (!placed) continue;
    board[attRow][attCol] = { type: 'K', player: 1 };

    // 持ち駒: 手数が多いほど多く
    const numHand = numMoves <= 5  ? 1 + Math.floor(rng() * 2)
                  : numMoves <= 9  ? 3 + Math.floor(rng() * 2)
                  : numMoves <= 13 ? 4 + Math.floor(rng() * 3)
                  :                  5 + Math.floor(rng() * 3);
    for (let i = 0; i < numHand; i++) {
      for (let hi = 0; hi < HAND_PIECES.length * 3; hi++) {
        const p = HAND_PIECES[Math.floor(rng() * HAND_PIECES.length)];
        if (countUsedOfBase(board, hands[1], p) < PIECE_TOTALS[p]) {
          hands[1][p] = (hands[1][p] || 0) + 1;
          break;
        }
      }
    }

    // 盤上の攻め方の駒
    const numBoardAtk = numMoves <= 5  ? Math.floor(rng() * 2)
                      : numMoves <= 9  ? 1 + Math.floor(rng() * 3)
                      :                  2 + Math.floor(rng() * 4);
    const usedPawnCols = new Set();
    for (let i = 0; i < numBoardAtk; i++) {
      const pType = BOARD_ATK_PIECES[Math.floor(rng() * BOARD_ATK_PIECES.length)];
      const pBase = getBaseType(pType);
      if (countUsedOfBase(board, hands[1], pBase) >= PIECE_TOTALS[pBase]) continue;
      for (let ai = 0; ai < 40; ai++) {
        const r = Math.floor(rng() * 9);
        const c = Math.floor(rng() * 9);
        if (board[r][c]) continue;
        if (pType === 'P' && r === 0) continue;
        if (pType === 'L' && r === 0) continue;
        if (pType === 'N' && r <= 1) continue;
        if (pType === 'P' && usedPawnCols.has(c)) continue;
        board[r][c] = { type: pType, player: 1 };
        if (pType === 'P') usedPawnCols.add(c);
        break;
      }
    }

    // 玉方の守備駒 (多いほど逃げ道が複雑になり長手数になりやすい)
    const numDef = numMoves <= 5  ? Math.floor(rng() * 2)
                 : numMoves <= 9  ? 1 + Math.floor(rng() * 3)
                 :                  2 + Math.floor(rng() * 4);
    for (let i = 0; i < numDef; i++) {
      const pType = BOARD_DEF_PIECES[Math.floor(rng() * BOARD_DEF_PIECES.length)];
      for (let bi = 0; bi < 30; bi++) {
        const r = Math.max(0, Math.min(8, defRow + Math.round((rng() - 0.5) * 5)));
        const c = Math.max(0, Math.min(8, defCol + Math.round((rng() - 0.5) * 5)));
        if (!board[r][c]) { board[r][c] = { type: pType, player: 2 }; break; }
      }
    }

    fillDefenderHand(board, hands);
    if (!isValidStart(board, hands)) continue;
    return { board, hands };
  }
  return null;
}
