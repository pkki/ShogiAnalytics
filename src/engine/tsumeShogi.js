/**
 * tsumeShogi.js — 詰将棋ソルバー
 *
 * 詰将棋のルール:
 * - 攻め方(attacker)は毎手必ず王手をかける
 * - 玉方(defender)は王手から逃げる
 * - 攻め方が詰みになる手順を見つける
 */
import {
  applyMove, isCheckmate, isInCheck,
  getMoveDestinations, getDropDestinations,
  isMoveLegal, isDropLegal,
  canPromote, isPromoted,
} from '../state/gameState.js';

/** 指定プレイヤーの全合法手を生成 */
function generateAllLegalMoves(board, hands, player) {
  const moves = [];

  // 盤上の駒の移動
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (!piece || piece.player !== player) continue;
      const dests = getMoveDestinations(board, r, c);
      for (const [dr, dc] of dests) {
        // 不成
        const mustPromote =
          (piece.type === 'P' || piece.type === 'L') && (player === 1 ? dr === 0 : dr === 8) ||
          piece.type === 'N' && (player === 1 ? dr <= 1 : dr >= 7);
        if (!mustPromote && isMoveLegal(board, hands, [r, c], [dr, dc], false, player)) {
          moves.push({ from: [r, c], to: [dr, dc], promote: false });
        }
        // 成り
        if (canPromote(piece.type) && !isPromoted(piece.type)) {
          const inPromo = player === 1 ? (dr <= 2 || r <= 2) : (dr >= 6 || r >= 6);
          if (inPromo && isMoveLegal(board, hands, [r, c], [dr, dc], true, player)) {
            moves.push({ from: [r, c], to: [dr, dc], promote: true });
          }
        }
      }
    }
  }

  // 持ち駒を打つ
  for (const pt of Object.keys(hands[player] || {})) {
    if ((hands[player][pt] || 0) <= 0) continue;
    const dests = getDropDestinations(board, pt, player);
    for (const [dr, dc] of dests) {
      if (isDropLegal(board, hands, pt, [dr, dc], player)) {
        moves.push({ from: null, to: [dr, dc], promote: false, piece: pt });
      }
    }
  }

  return moves;
}

/**
 * 詰将棋ソルバー
 * @param {Array} board 9x9盤面
 * @param {Object} hands 持ち駒
 * @param {number} attacker 攻め方 (1 or 2)
 * @param {number} maxHalfMoves 最大手数 (1=1手詰, 3=3手詰, ...)
 * @returns {Array|null} 解手順ツリー or null (解なし/タイムアウト)
 *
 * 解手順ツリー形式:
 * [ { move, defenses: [ { defMove, reply: [...] | null } ] } ]
 * - defenses が空配列 → その手で即詰み
 * - reply が null → 玉方の手の後で詰みを探せなかった (通常は起きない)
 */
// timeoutMs = 0 でタイムアウト無効 (Worker 側で使用)
export function solveTsume(board, hands, attacker, maxHalfMoves, timeoutMs = 10_000) {
  const defender = attacker === 1 ? 2 : 1;
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity;

  function solve(b, h, isAttackerTurn, halfLeft) {
    if (Date.now() > deadline) throw new Error('timeout');
    const currentPlayer = isAttackerTurn ? attacker : defender;

    if (isAttackerTurn) {
      // OR ノード: 攻め方は王手になる手を1つ以上見つければよい
      if (halfLeft === 0) return null;
      const legalMoves = generateAllLegalMoves(b, h, attacker);
      const solutions = [];
      for (const move of legalMoves) {
        const { board: nb, hands: nh } = applyMove(b, h, move, attacker);
        if (!isInCheck(nb, defender)) continue; // 王手でなければスキップ
        if (isCheckmate(nb, nh, defender)) {
          solutions.push({ move, defenses: [] }); // 即詰み
        } else if (halfLeft > 1) {
          const defenses = solve(nb, nh, false, halfLeft - 1);
          if (defenses !== null) solutions.push({ move, defenses });
        }
      }
      return solutions.length > 0 ? solutions : null;
    } else {
      // AND ノード: 玉方の全ての手に対応できなければ解なし
      const legalMoves = generateAllLegalMoves(b, h, defender);
      if (legalMoves.length === 0) return []; // 合法手なし (詰み)
      const responses = [];
      for (const move of legalMoves) {
        const { board: nb, hands: nh } = applyMove(b, h, move, defender);
        const reply = solve(nb, nh, true, halfLeft - 1);
        if (reply === null) return null; // 逃げられた
        responses.push({ defMove: move, reply });
      }
      return responses;
    }
  }

  try {
    return solve(board, hands, true, maxHalfMoves);
  } catch (e) {
    if (e.message === 'timeout') return null;
    throw e;
  }
}

/**
 * 詰め手数を自動判定して解を返す (1〜9手詰めを試みる)
 * @returns {{ solution: Array, numMoves: number } | null}
 */
export function findTsumeSolution(board, hands, attacker) {
  for (let n = 1; n <= 9; n += 2) {
    const sol = solveTsume(board, hands, attacker, n);
    if (sol) return { solution: sol, numMoves: n };
  }
  return null;
}
