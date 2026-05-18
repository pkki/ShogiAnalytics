/**
 * quizUtils.js
 * 保存済みKIF棋譜から「中盤悪手」クイズ問題を抽出するユーティリティ。
 *
 * 流れ:
 *   1. parseKIF でKIFテキストをパース
 *   2. 局面を applyMove で順番に再現
 *   3. 各手の CPL (centipawn loss) を preCandidates スコアから計算
 *   4. CPL ≥ MISTAKE かつフェーズが中盤 の局面をクイズ候補として返す
 */
import { parseKIF } from '../parsers/kifParser.js';
import { applyMove } from '../state/gameState.js';
import { detectPhase, INACCURACY } from './weaknessUtils.js';

// ── KIF座標変換 ──────────────────────────────────────────────────
const FILE_KAN = { '１':1,'２':2,'３':3,'４':4,'５':5,'６':6,'７':7,'８':8,'９':9 };
const RANK_KAN = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
function kc(f, r) { return [r - 1, 9 - f]; } // KIF file(1-9) + rank(1-9) → [row,col]

// ── 平手初期局面 ─────────────────────────────────────────────────
function makeInitialBoard() {
  return [
    [{type:'L',player:2},{type:'N',player:2},{type:'S',player:2},{type:'G',player:2},{type:'K',player:2},{type:'G',player:2},{type:'S',player:2},{type:'N',player:2},{type:'L',player:2}],
    [null,{type:'R',player:2},null,null,null,null,null,{type:'B',player:2},null],
    Array(9).fill(null).map(() => ({type:'P',player:2})),
    Array(9).fill(null),Array(9).fill(null),Array(9).fill(null),
    Array(9).fill(null).map(() => ({type:'P',player:1})),
    [null,{type:'B',player:1},null,null,null,null,null,{type:'R',player:1},null],
    [{type:'L',player:1},{type:'N',player:1},{type:'S',player:1},{type:'G',player:1},{type:'K',player:1},{type:'G',player:1},{type:'S',player:1},{type:'N',player:1},{type:'L',player:1}],
  ];
}

function deepCopyBoard(b) { return b.map(row => row.map(c => c ? { ...c } : null)); }
function deepCopyHands(h) { return { 1: { ...h[1] }, 2: { ...h[2] } }; }

// kifParser の move → applyMove 用フォーマットに変換
function kifMoveToApply(mv) {
  return {
    from: mv.from || null,
    to: mv.to,
    promote: mv.promote || false,
    piece: mv.dropPiece || null,
  };
}

const PIECE_KAN_MAP = {
  '王':'K','玉':'K','飛':'R','竜':'+R','龍':'+R','角':'B','馬':'+B',
  '金':'G','銀':'S','全':'+S','仝':'+S','桂':'N','圭':'+N',
  '香':'L','杏':'+L','歩':'P','と':'+P',
};

/**
 * pvJP 文字列から全手をパースして applyMove 用フォーマットの配列を返す。
 * 各要素: { from, to, promote, piece, player, label }
 * @param {string} pvJP  "▲７六歩(77) △８四歩(83)..." 形式
 * @param {number} maxMoves  最大手数（デフォルト5）
 */
export function parsePvJPMoves(pvJP, maxMoves = 5) {
  if (!pvJP) return [];
  const tokens = pvJP.trim().split(/\s+/).slice(0, maxMoves);
  const moves = [];
  let lastTo = null;

  for (const token of tokens) {
    const s = token.replace(/^[▲△▽▼]/, '');
    const player = /^[▲▼]/.test(token) ? 1 : 2;

    let i = 0, to = null;
    if (s.startsWith('同')) {
      to = lastTo ? [...lastTo] : null;
      i = 1;
      while (i < s.length && (s[i] === '　' || s[i] === ' ')) i++;
    } else {
      const f = FILE_KAN[s[0]], r = RANK_KAN[s[1]];
      if (f !== undefined && r !== undefined) { to = kc(f, r); i = 2; }
    }
    if (!to) break;

    const pieceChar = s[i] ?? '';
    const rawType = PIECE_KAN_MAP[pieceChar] ?? null;
    const isDrop = s.includes('打');
    const piece = isDrop && rawType ? rawType.replace('+', '') : null;
    const promote = !isDrop && s[i + 1] === '成';
    const fromM = s.match(/\((\d)(\d)\)$/);
    const from = !isDrop && fromM ? kc(parseInt(fromM[1]), parseInt(fromM[2])) : null;
    const label = token.replace(/\(\d+\)$/, '');

    moves.push({ from, to, promote, piece, player, label });
    lastTo = to;
  }
  return moves;
}

/**
 * pvJP 文字列（例 "▲７六歩(77) △８四歩(83)..."）の
 * 先頭トークンを解析して { to:[row,col], from:[row,col]|null, isDrop } を返す。
 * @param {string} pvJP
 * @param {number[]|null} lastTo 直前の指し手の移動先（「同」対応）
 */
export function parsePvJPFirstMove(pvJP, lastTo) {
  if (!pvJP) return null;
  const token = pvJP.trim().split(/\s+/)[0];
  const s = token.replace(/^[▲△▽▼]/, '');

  // 移動元 "(77)" 形式
  const fromM = s.match(/\((\d)(\d)\)$/);
  const from  = fromM ? kc(parseInt(fromM[1]), parseInt(fromM[2])) : null;

  const isDrop = s.includes('打');

  let to = null;
  if (s.startsWith('同')) {
    to = lastTo ? [lastTo[0], lastTo[1]] : null;
  } else {
    const destFile = FILE_KAN[s[0]];
    const destRank = RANK_KAN[s[1]];
    if (destFile && destRank) to = kc(destFile, destRank);
  }

  return to ? { to, from, isDrop } : null;
}

/**
 * KIFテキストから中盤悪手のクイズ候補を抽出する。
 *
 * @returns {Array<{
 *   boardBeforeMove, handsBeforeMove, player,
 *   moveNumber, cpl, phase,
 *   bestMove, secondBestMove,
 *   bestPvJP, secondBestPvJP,
 *   senteName, goteName
 * }>}
 */
export function extractQuizPositions(kifText) {
  const { moves, gameInfo, initialBoard, initialHands, goteFirst } = parseKIF(kifText);
  if (moves.length < 15) return [];

  let board = initialBoard ? deepCopyBoard(initialBoard) : makeInitialBoard();
  let hands = initialHands ? deepCopyHands(initialHands) : { 1: {}, 2: {} };

  const firstPlayer = goteFirst ? 2 : 1;
  const playerOf = (i) => i % 2 === 0 ? firstPlayer : (3 - firstPlayer);

  // 全局面を再構築
  const positions = [{ board: deepCopyBoard(board), hands: deepCopyHands(hands) }];
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    const player = playerOf(i);
    try {
      const res = applyMove(board, hands, kifMoveToApply(mv), player);
      board = res.board;
      hands = res.hands;
    } catch {
      break;
    }
    positions.push({ board: deepCopyBoard(board), hands: deepCopyHands(hands) });
  }

  const result = [];
  let lastTo = null;

  for (let i = 0; i < moves.length - 1; i++) {
    const mv      = moves[i];
    const player  = playerOf(i);

    // 両局面に評価値が必要
    const preCands  = mv.preCandidates;          // position before move i
    const nextCands = moves[i + 1]?.preCandidates; // position after move i
    if (!preCands?.length || !nextCands?.length) { lastTo = mv.to; continue; }

    const best      = preCands.find(c => c.multipv === 1) ?? preCands[0];
    const afterBest = nextCands.find(c => c.multipv === 1) ?? nextCands[0];
    if (best.score == null || afterBest.score == null) { lastTo = mv.to; continue; }
    if (best.isMate || afterBest.isMate) { lastTo = mv.to; continue; }

    // CPL 計算（先手絶対値で保存されているので符号調整）
    const cpl = player === 1
      ? Math.max(0, best.score - afterBest.score)
      : Math.max(0, afterBest.score - best.score);

    if (cpl < INACCURACY) { lastTo = mv.to; continue; }

    // フェーズ判定（序盤は除外、中盤以降を対象）
    const posBefore = positions[i];
    if (!posBefore) { lastTo = mv.to; continue; }
    const phase = detectPhase(i + 1, best, posBefore.hands);
    if (phase === 'opening') { lastTo = mv.to; continue; }

    // 最善手を pvJP からパース
    const bestMove = parsePvJPFirstMove(best.pvJP, lastTo);
    if (!bestMove?.to) { lastTo = mv.to; continue; }

    const secondBestCand = preCands.find(c => c.multipv === 2);
    const secondBestMove = secondBestCand?.pvJP
      ? parsePvJPFirstMove(secondBestCand.pvJP, lastTo)
      : null;

    result.push({
      boardBeforeMove:  posBefore.board,
      handsBeforeMove:  posBefore.hands,
      player,
      moveNumber:       i + 1,
      cpl,
      phase,
      bestMove,
      secondBestMove,
      bestPvJP:         best.pvJP            || '',
      secondBestPvJP:   secondBestCand?.pvJP || '',
      bestScore:        best.score,
      secondScore:      secondBestCand?.score ?? null,
      actualScore:      afterBest.score,
      actualMoveLabel:  mv.label             || '',
      afterBestPvJP:    afterBest.pvJP       || '',
      senteName:        gameInfo.senteName   || '先手',
      goteName:         gameInfo.goteName    || '後手',
    });

    lastTo = mv.to;
  }

  return result;
}
