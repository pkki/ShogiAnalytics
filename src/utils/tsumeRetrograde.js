/**
 * tsumeRetrograde.js — 逆算詰将棋局面生成
 *
 * 詰みの局面 (S_N) から N 手逆算して初期局面 (S_0) を構築する。
 * ランダム生成よりも有効局面の命中率が大幅に高い。
 *
 * forward:  S_0 -[Att1]→ S_1 -[Def1]→ S_2 -[Att2]→ ... -[AttN]→ S_N(詰み)
 * backward: S_N -un-AttN→ S_{N-1} -un-DefN-1→ S_{N-2} ... -un-Att1→ S_0
 */
import {
  getMoveDestinations, isCheckmate, isInCheck, copyHands,
} from '../state/gameState.js';
import { solveTsume } from '../engine/tsumeShogi.js';
import { fillDefenderHand, usesAllHandPieces, trimSparePieces } from './tsumeGenerator.js';

function makeRng(seed) {
  let s = ((seed ^ 0xdeadbeef) >>> 0) || 0xcafebabe;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

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

function findKing(board, player) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c]?.type === 'K' && board[r][c]?.player === player) return [r, c];
  return null;
}

const BOARD_ATK_TYPES = ['G', 'S', 'R', 'B', '+R', '+B', '+S', '+N', '+L', '+P'];
const HAND_TYPES = ['G', 'S', 'R', 'B', 'L', 'N', 'P'];

function isIllegalPlacement(board) {
  for (let c = 0; c < 9; c++) {
    let p1 = 0, p2 = 0;
    for (let r = 0; r < 9; r++) {
      const p = board[r][c];
      if (!p) continue;
      if (p.type === 'P' && p.player === 1 && r === 0) return true;
      if (p.type === 'P' && p.player === 2 && r === 8) return true;
      if (p.type === 'L' && p.player === 1 && r === 0) return true;
      if (p.type === 'L' && p.player === 2 && r === 8) return true;
      if (p.type === 'N' && p.player === 1 && r <= 1) return true;
      if (p.type === 'N' && p.player === 2 && r >= 7) return true;
      if (p.type === 'P') { if (p.player === 1) p1++; else p2++; }
    }
    if (p1 > 1 || p2 > 1) return true;
  }
  return false;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * 玉方が詰んでいる局面 (S_N) をランダムに生成する。
 * @param {number} targetMoves 目標手数 (駒数スケーリングに使用)
 */
function generateCheckmateBase(rng, targetMoves = 5) {
  // 手数が多いほど逆算ステップ数が多い → 盤上駒・持ち駒を多めに用意
  const numPieces = targetMoves <= 3 ? 2 + Math.floor(rng() * 2)
                  : targetMoves <= 5 ? 2 + Math.floor(rng() * 3)
                  : targetMoves <= 9 ? 3 + Math.floor(rng() * 4)
                  :                    4 + Math.floor(rng() * 5);
  const numHand = targetMoves <= 5 ? Math.floor(rng() * 3)
                :                    1 + Math.floor(rng() * 3);

  for (let attempt = 0; attempt < 400; attempt++) {
    const board = Array(9).fill(null).map(() => Array(9).fill(null));
    const hands = { 1: {}, 2: {} };

    // 玉方の玉を上部（端・角優先）に配置
    const defRow = Math.floor(rng() * 3);
    const defCol = rng() < 0.6
      ? ([0, 1, 7, 8])[Math.floor(rng() * 4)]
      : Math.floor(rng() * 9);
    board[defRow][defCol] = { type: 'K', player: 2 };

    // 攻め方の玉を下部に配置
    let attPlaced = false;
    for (let ki = 0; ki < 30; ki++) {
      const ar = 6 + Math.floor(rng() * 3);
      const ac = Math.floor(rng() * 9);
      if (!(Math.abs(ar - defRow) <= 1 && Math.abs(ac - defCol) <= 1)) {
        board[ar][ac] = { type: 'K', player: 1 };
        attPlaced = true; break;
      }
    }
    if (!attPlaced) continue;

    // 攻め方の駒を玉周辺に配置
    for (let i = 0; i < numPieces; i++) {
      const pType = BOARD_ATK_TYPES[Math.floor(rng() * BOARD_ATK_TYPES.length)];
      for (let pi = 0; pi < 40; pi++) {
        const r = Math.max(0, Math.min(8, defRow + Math.round((rng() - 0.5) * 4)));
        const c = Math.max(0, Math.min(8, defCol + Math.round((rng() - 0.5) * 4)));
        if (!board[r][c]) { board[r][c] = { type: pType, player: 1 }; break; }
      }
    }

    // 持ち駒
    for (let i = 0; i < numHand; i++) {
      const p = HAND_TYPES[Math.floor(rng() * HAND_TYPES.length)];
      hands[1][p] = (hands[1][p] || 0) + 1;
    }

    if (isIllegalPlacement(board)) continue;
    if (isInCheck(board, 1)) continue;
    fillDefenderHand(board, hands);
    if (isCheckmate(board, hands, 2)) return { board, hands };
  }
  return null;
}

/**
 * 1 手逆算: `player` の最後の手を un-apply して前の局面を返す。
 *
 * @param {boolean} needsCheckAfter - un-apply 後に玉方 (player 2) が王手されているべきか
 */
function retrogradeStep(board, hands, player, needsCheckAfter, rng) {
  // 守備側 (player=2) の玉の逆算: 玉が逃げた手を un-move する
  // 詰将棋の守備側の手の多くは玉移動なので、これを最初に試みる
  if (player === 2) {
    const kingPos = findKing(board, 2);
    if (kingPos) {
      const [toR, toC] = kingPos;
      const kingCandidates = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const fr = toR + dr;
          const fc = toC + dc;
          if (fr < 0 || fr > 8 || fc < 0 || fc > 8) continue;
          if (board[fr][fc] !== null) continue; // 逆算元マスは空き
          kingCandidates.push({ fr, fc });
        }
      }
      shuffle(kingCandidates, rng);

      for (const { fr, fc } of kingCandidates) {
        const nb = board.map(row => [...row]);
        const nh = copyHands(hands);
        nb[toR][toC] = null;
        nb[fr][fc] = { type: 'K', player: 2 };
        fillDefenderHand(nb, nh);
        if (needsCheckAfter  && !isInCheck(nb, 2)) continue;
        if (!needsCheckAfter &&  isInCheck(nb, 2)) continue;
        if (isInCheck(nb, 1)) continue;
        if (isIllegalPlacement(nb)) continue;
        return { board: nb, hands: nh };
      }
    }
  }

  // player の盤上駒（玉以外）をシャッフルして順に試す
  const pieces = [];
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c]?.player === player && board[r][c]?.type !== 'K')
        pieces.push([r, c]);
  shuffle(pieces, rng);

  for (const [toR, toC] of pieces) {
    const piece = board[toR][toC];
    const candidates = [];

    // A) un-drop: 盤上の駒を持ち駒に戻す
    if (!piece.type.startsWith('+')) {
      candidates.push({ kind: 'undrop' });
    }

    // B) un-move: 別マスから来た（成前の形も試す）
    const fromTypes = [piece.type];
    if (piece.type.startsWith('+')) fromTypes.push(piece.type.slice(1));

    for (const fromType of fromTypes) {
      const wasPromoted = fromType !== piece.type;
      for (let fr = 0; fr < 9; fr++) {
        for (let fc = 0; fc < 9; fc++) {
          if (fr === toR && fc === toC) continue;
          if (board[fr][fc] !== null) continue;

          // 成りの制約
          if (wasPromoted) {
            const inPromo = player === 1 ? (toR <= 2 || fr <= 2) : (toR >= 6 || fr >= 6);
            if (!inPromo) continue;
          }
          // 配置違反の事前スキップ
          if (fromType === 'P' && player === 1 && fr === 0) continue;
          if (fromType === 'P' && player === 2 && fr === 8) continue;
          if (fromType === 'L' && player === 1 && fr === 0) continue;
          if (fromType === 'L' && player === 2 && fr === 8) continue;
          if (fromType === 'N' && player === 1 && fr <= 1) continue;
          if (fromType === 'N' && player === 2 && fr >= 7) continue;

          // (fr,fc) に fromType を置いて (toR,toC) へ移動できるか
          const tempBoard = board.map(row => [...row]);
          tempBoard[toR][toC] = null;
          tempBoard[fr][fc] = { type: fromType, player };
          const dests = getMoveDestinations(tempBoard, fr, fc);
          if (dests.some(([dr, dc]) => dr === toR && dc === toC)) {
            candidates.push({ kind: 'unmove', fr, fc, fromType });
          }
        }
      }
    }

    shuffle(candidates, rng);

    for (const cand of candidates) {
      const nb = board.map(row => [...row]);
      const nh = copyHands(hands);

      if (cand.kind === 'undrop') {
        nb[toR][toC] = null;
        nh[player][piece.type] = (nh[player][piece.type] || 0) + 1;
      } else {
        nb[toR][toC] = null;
        nb[cand.fr][cand.fc] = { type: cand.fromType, player };
      }

      // 玉方の持ち駒を再計算（盤上・攻め方手駒が変わったため）
      fillDefenderHand(nb, nh);

      if (needsCheckAfter  && !isInCheck(nb, 2)) continue;
      if (!needsCheckAfter &&  isInCheck(nb, 2)) continue;
      if (isInCheck(nb, 1)) continue;
      if (isIllegalPlacement(nb)) continue;

      return { board: nb, hands: nh };
    }
  }
  return null;
}

/**
 * 逆算で N 手詰め局面を生成する。1/3/5/7/9/13 手に対応。
 *
 * @param {number} numMoves
 * @param {number} seed
 * @param {function} onProgress
 * @returns {{ board, hands, attacker, solution, numMoves } | null}
 */
export function generateRetrogradeTsume(numMoves, seed, onProgress) {
  const rng = makeRng(seed ?? Date.now());

  const MAX_ATTEMPTS = numMoves <=  1 ? 400
                     : numMoves <=  3 ? 300
                     : numMoves <=  5 ? 200
                     : numMoves <=  7 ? 300
                     : numMoves <=  9 ? 150
                     :                   80;
  const TIME_SOLVE   = numMoves <=  1 ?  300
                     : numMoves <=  3 ? 1000
                     : numMoves <=  5 ? 4000
                     : numMoves <=  7 ? 10000
                     : numMoves <=  9 ? 20000
                     :                 35000;
  const TIME_SHORTER = numMoves <=  5 ?  200 : Math.min(Math.round(TIME_SOLVE / 5), 2000);
  const TIME_SPARE   = numMoves <=  1 ?  100
                     : numMoves <=  3 ?  200
                     : numMoves <=  5 ?  500
                     : numMoves <=  7 ? 1500
                     : numMoves <=  9 ? 3000
                     :                 5000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    onProgress?.(attempt, MAX_ATTEMPTS);

    const base = generateCheckmateBase(rng, numMoves);
    if (!base) continue;

    let { board, hands } = base;
    let ok = true;

    // N 手逆算
    // step=0 → attacker の un-move → needsCheck=false (S_{N-1}: 玉方未王手)
    // step=1 → defender の un-move → needsCheck=true  (S_{N-2}: 攻め方が王手した直後)
    // step=2 → attacker の un-move → needsCheck=false
    // ...
    for (let step = 0; step < numMoves; step++) {
      const player     = step % 2 === 0 ? 1 : 2;
      const needsCheck = step % 2 === 1;
      const res = retrogradeStep(board, hands, player, needsCheck, rng);
      if (!res) { ok = false; break; }
      board = res.board;
      hands = res.hands;
    }
    if (!ok) continue;

    // S_0 の持ち駒を確定して妥当性チェック
    fillDefenderHand(board, hands);
    const k1 = findKing(board, 1);
    const k2 = findKing(board, 2);
    if (!k1 || !k2) continue;
    if (Math.abs(k1[0] - k2[0]) <= 1 && Math.abs(k1[1] - k2[1]) <= 1) continue;
    if (isInCheck(board, 1)) continue;
    if (isInCheck(board, 2)) continue;
    if (isCheckmate(board, hands, 2)) continue;
    if (isIllegalPlacement(board)) continue;

    // 明らかに短い手数（3手以下）で解ける局面を排除する。
    // 逆算局面は1本の N 手経路を保証するが 5 手などの抜け道は防げないため
    // numMoves-2 チェックは過剰に厳しく、ほぼ全候補が弾かれる。
    // 3手以下の抜け道だけを除外すれば実用上十分。
    const shortDepth = numMoves <= 5 ? numMoves - 2 : 3;
    if (shortDepth >= 1) {
      const shorter = solveTsume(board, hands, 1, shortDepth, TIME_SHORTER, true);
      if (shorter) continue;
    }

    // N 手詰めを確認（存在チェックのみ）
    const sol = solveTsume(board, hands, 1, numMoves, TIME_SOLVE, true);
    if (sol && sol.length > 0) {
      const hasHand = trimSparePieces(board, hands, numMoves, TIME_SPARE);
      if (!hasHand) continue;
      const finalSol = solveTsume(board, hands, 1, numMoves, TIME_SOLVE);
      if (finalSol && finalSol.length > 0) {
        return { board, hands, attacker: 1, solution: finalSol, numMoves };
      }
    }
  }

  return null;
}

/**
 * 逆算で局面候補を生成する（ソルバー検証なし）。
 * エンジンで検証する場合に使用。詰みに近い局面を生成するので
 * ランダム候補よりエンジンの成功率が大幅に高い。
 */
export function generateRetrogradeCandidatePosition(numMoves, seed) {
  const rng = makeRng(seed ?? Date.now());

  for (let attempt = 0; attempt < 200; attempt++) {
    const base = generateCheckmateBase(rng, numMoves);
    if (!base) continue;

    let { board, hands } = base;
    let ok = true;

    for (let step = 0; step < numMoves; step++) {
      const player     = step % 2 === 0 ? 1 : 2;
      const needsCheck = step % 2 === 1;
      const res = retrogradeStep(board, hands, player, needsCheck, rng);
      if (!res) { ok = false; break; }
      board = res.board;
      hands = res.hands;
    }
    if (!ok) continue;

    fillDefenderHand(board, hands);
    const k1 = findKing(board, 1);
    const k2 = findKing(board, 2);
    if (!k1 || !k2) continue;
    if (Math.abs(k1[0] - k2[0]) <= 1 && Math.abs(k1[1] - k2[1]) <= 1) continue;
    if (isInCheck(board, 1)) continue;
    if (isInCheck(board, 2)) continue;
    if (isCheckmate(board, hands, 2)) continue;
    if (isIllegalPlacement(board)) continue;

    return { board, hands };
  }
  return null;
}
