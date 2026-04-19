/**
 * BrowserEngine.worker.js v2
 * 改善点:
 *   - 位置ボーナス評価 (PST: piece-square tables)
 *   - 静止探索 (quiescence search) — horizon effect 軽減
 *   - キラー手 (killer moves) — ベータカット手を優先
 *   - ヒストリーヒューリスティック — 過去のカット手を優先
 *   - MVV-LVA 手順整列 (最大価値の駒を最小コストで取る手を優先)
 *   - 詰み距離スコアリング
 */

// ── 駒の基本価値 ────────────────────────────────────────────────
const PIECE_VALUE = {
  P: 100, L: 350, N: 360, S: 640, G: 680, B: 1100, R: 1300,
  '+P': 500, '+L': 600, '+N': 600, '+S': 700, '+B': 1300, '+R': 1500,
  K: 15000,
};

// 位置ボーナス [row=0..8]
// player=1: row=0 が敵陣最深部 → そのまま参照
// player=2: row=8 が敵陣最深部 → [8-row] で参照
const PST = {
  P:  [80, 55, 40, 28, 18, 12,  8,  4,  0],
  L:  [25, 18, 12,  8,  6,  4,  3,  1,  0],
  N:  [ 0,  0, 20, 14,  9,  6,  4,  2,  0],
  S:  [18, 16, 14, 12, 10,  8,  9, 11, 12],
  G:  [14, 14, 12, 12, 10,  8,  8, 10, 12],
  B:  [15, 12, 12, 14, 16, 14, 12, 12, 15],
  R:  [12, 10,  8,  8, 12,  8,  8, 10, 12],
  K:  [-8, -5,  0,  0,  2, 10, 18, 25, 32],
  '+P':[38, 30, 24, 20, 16, 12,  8,  4,  0],
  '+L':[22, 16, 12,  8,  6,  4,  3,  2,  0],
  '+N':[22, 16, 12,  8,  6,  4,  3,  2,  0],
  '+S':[18, 16, 14, 12, 10,  8,  6,  4,  2],
  '+B':[15, 12, 12, 14, 16, 14, 12, 12, 15],
  '+R':[12, 10,  8,  8, 12,  8,  8, 10, 12],
};

const PROMOTABLE = new Set(['P','L','N','S','B','R']);
const PROMOTE_ZONE = { 1: [0,1,2], 2: [6,7,8] };

function isPromoted(t) { return t && t[0] === '+'; }
function canPromote(t) { return PROMOTABLE.has(t); }
function demote(t)     { return t[0] === '+' ? t.slice(1) : t; }
function opp(p)        { return p === 1 ? 2 : 1; }

function copyBoard(board) { return board.map(row => [...row]); }
function copyHands(hands) { return { 1: { ...hands[1] }, 2: { ...hands[2] } }; }

// ── 移動先生成 (pseudo-legal) ──────────────────────────────────
function getMoveDests(board, row, col) {
  const cell = board[row][col];
  if (!cell) return [];
  const { type, player } = cell;
  const d = player === 1 ? -1 : 1;
  const dests = [];

  const add = (r, c) => {
    if (r >= 0 && r < 9 && c >= 0 && c < 9 && board[r][c]?.player !== player)
      dests.push([r, c]);
  };
  const slide = (dr, dc) => {
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 9 && c >= 0 && c < 9) {
      if (board[r][c]?.player === player) break;
      dests.push([r, c]);
      if (board[r][c]) break;
      r += dr; c += dc;
    }
  };

  switch (type) {
    case 'P':  add(row + d, col); break;
    case 'L':  slide(d, 0); break;
    case 'N':  add(row + 2*d, col - 1); add(row + 2*d, col + 1); break;
    case 'S':
      [[d,-1],[d,0],[d,1],[-d,-1],[-d,1]].forEach(([dr,dc]) => add(row+dr, col+dc));
      break;
    case 'G': case '+P': case '+L': case '+N': case '+S':
      [[d,-1],[d,0],[d,1],[0,-1],[0,1],[-d,0]].forEach(([dr,dc]) => add(row+dr, col+dc));
      break;
    case 'B':
      [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc]) => slide(dr,dc));
      break;
    case 'R':
      [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => slide(dr,dc));
      break;
    case '+B':
      [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc]) => slide(dr,dc));
      [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => add(row+dr, col+dc));
      break;
    case '+R':
      [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => slide(dr,dc));
      [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc]) => add(row+dr, col+dc));
      break;
    case 'K':
      [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc]) => add(row+dr, col+dc));
      break;
    default: break;
  }
  return dests;
}

function findKing(board, player) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (board[r][c]?.type === 'K' && board[r][c]?.player === player) return [r, c];
  return null;
}

function isAttacked(board, row, col, byPlayer) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const cell = board[r][c];
      if (!cell || cell.player !== byPlayer) continue;
      if (getMoveDests(board, r, c).some(([tr,tc]) => tr === row && tc === col)) return true;
    }
  return false;
}

function inCheck(board, player) {
  const king = findKing(board, player);
  return king ? isAttacked(board, king[0], king[1], opp(player)) : false;
}

// ── 指し手適用 ──────────────────────────────────────────────────
function applyMove(board, hands, move, player) {
  const nb = copyBoard(board);
  const nh = copyHands(hands);
  if (move.drop) {
    nb[move.to[0]][move.to[1]] = { type: move.drop, player };
    nh[player][move.drop]--;
    if (nh[player][move.drop] <= 0) delete nh[player][move.drop];
  } else {
    const piece = nb[move.from[0]][move.from[1]];
    const cap   = nb[move.to[0]][move.to[1]];
    if (cap) {
      const ct = demote(cap.type);
      nh[player][ct] = (nh[player][ct] || 0) + 1;
    }
    nb[move.to[0]][move.to[1]] = move.promote
      ? { type: '+' + piece.type, player }
      : { type: piece.type, player };
    nb[move.from[0]][move.from[1]] = null;
  }
  return { board: nb, hands: nh };
}

// ── 合法手生成 (全手) ──────────────────────────────────────────
function genMoves(board, hands, player) {
  const moves = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const cell = board[r][c];
    if (!cell || cell.player !== player) continue;
    for (const [tr, tc] of getMoveDests(board, r, c)) {
      const pz = PROMOTE_ZONE[player];
      const mustProm = ((cell.type==='P'||cell.type==='L') && (player===1?tr===0:tr===8))
                    || (cell.type==='N' && (player===1?tr<=1:tr>=7));
      const canProm  = canPromote(cell.type) && (pz.includes(r) || pz.includes(tr));
      if (mustProm) {
        moves.push({ from:[r,c], to:[tr,tc], promote:true });
      } else {
        moves.push({ from:[r,c], to:[tr,tc], promote:false });
        if (canProm) moves.push({ from:[r,c], to:[tr,tc], promote:true });
      }
    }
  }
  for (const [pt, cnt] of Object.entries(hands[player] || {})) {
    if (!cnt) continue;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (board[r][c]) continue;
      if ((pt==='P'||pt==='L') && (player===1?r===0:r===8)) continue;
      if (pt==='N' && (player===1?r<=1:r>=7)) continue;
      if (pt === 'P') {
        let nifu = false;
        for (let rr = 0; rr < 9; rr++)
          if (board[rr][c]?.type==='P' && board[rr][c]?.player===player) { nifu=true; break; }
        if (nifu) continue;
      }
      moves.push({ drop:pt, to:[r,c] });
    }
  }
  return moves.filter(mv => {
    const { board: nb } = applyMove(board, hands, mv, player);
    return !inCheck(nb, player);
  });
}

// 捕獲手のみ (静止探索用)
function genCaptures(board, hands, player) {
  const moves = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const cell = board[r][c];
    if (!cell || cell.player !== player) continue;
    for (const [tr, tc] of getMoveDests(board, r, c)) {
      if (!board[tr][tc]) continue; // 捕獲のみ
      const pz = PROMOTE_ZONE[player];
      const mustProm = ((cell.type==='P'||cell.type==='L') && (player===1?tr===0:tr===8))
                    || (cell.type==='N' && (player===1?tr<=1:tr>=7));
      const canProm  = canPromote(cell.type) && (pz.includes(r) || pz.includes(tr));
      // 捕獲時は成れるなら成りを選ぶ (得)
      if (mustProm || canProm) {
        moves.push({ from:[r,c], to:[tr,tc], promote:true });
      } else {
        moves.push({ from:[r,c], to:[tr,tc], promote:false });
      }
    }
  }
  return moves.filter(mv => {
    const { board: nb } = applyMove(board, hands, mv, player);
    return !inCheck(nb, player);
  });
}

// ── 評価関数 (PST付き) ─────────────────────────────────────────
function evaluate(board, hands, player) {
  let score = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const cell = board[r][c];
    if (!cell) continue;
    const pstRow = cell.player === 1 ? r : 8 - r;
    const v = (PIECE_VALUE[cell.type] || 0) + ((PST[cell.type] || [])[pstRow] || 0);
    score += cell.player === 1 ? v : -v;
  }
  for (const [pt, cnt] of Object.entries(hands[1] || {})) score += (PIECE_VALUE[pt] || 0) * cnt;
  for (const [pt, cnt] of Object.entries(hands[2] || {})) score -= (PIECE_VALUE[pt] || 0) * cnt;
  return player === 1 ? score : -score;
}

// ── 手の採点 ───────────────────────────────────────────────────
const MAX_PLY = 32;
const killers  = Array.from({ length: MAX_PLY }, () => [null, null]);
const histMap  = new Map();

function mvKey(mv) {
  if (mv.drop) return `d${mv.drop}${mv.to[0]}${mv.to[1]}`;
  return `${mv.from[0]}${mv.from[1]}${mv.to[0]}${mv.to[1]}${mv.promote ? '+' : ''}`;
}

function scoreMv(mv, board, ply) {
  // 駒取り: MVV-LVA (Victim価値大・Attacker価値小 を優先)
  if (!mv.drop && board[mv.to[0]][mv.to[1]]) {
    const victim   = PIECE_VALUE[board[mv.to[0]][mv.to[1]].type] || 0;
    const attacker = PIECE_VALUE[board[mv.from[0]][mv.from[1]].type] || 0;
    return 20000 + victim * 10 - attacker;
  }
  // 成り
  if (mv.promote) return 15000;
  // キラー手
  const key = mvKey(mv);
  const k = killers[ply] || [];
  if (k[0] && mvKey(k[0]) === key) return 14000;
  if (k[1] && mvKey(k[1]) === key) return 13000;
  // ヒストリー
  return histMap.get(key) || 0;
}

function sortMoves(moves, board, ply) {
  for (const mv of moves) mv._s = scoreMv(mv, board, ply);
  moves.sort((a, b) => b._s - a._s);
}

function sortCaptures(moves, board) {
  for (const mv of moves) {
    const victim   = (PIECE_VALUE[board[mv.to[0]][mv.to[1]]?.type] || 0);
    const attacker = mv.drop ? 0 : (PIECE_VALUE[board[mv.from[0]][mv.from[1]]?.type] || 0);
    mv._s = victim * 10 - attacker;
  }
  moves.sort((a, b) => b._s - a._s);
}

// ── 探索 ───────────────────────────────────────────────────────
let stopFlag  = false;
let nodeCount = 0;
const INF        = 9999999;
const MATE_SCORE = INF - 2000; // 詰みスコア基準値

// 静止探索: 駒取りが続く局面を落ち着くまで読む
function quiescence(board, hands, player, alpha, beta, qd) {
  if (stopFlag) return 0;
  nodeCount++;

  const standPat = evaluate(board, hands, player);
  if (standPat >= beta)  return beta;
  if (standPat > alpha)  alpha = standPat;
  if (qd >= 5)           return alpha; // 静止探索の深さ上限

  const captures = genCaptures(board, hands, player);
  sortCaptures(captures, board);

  for (const mv of captures) {
    if (stopFlag) return alpha;
    const { board: nb, hands: nh } = applyMove(board, hands, mv, player);
    const score = -quiescence(nb, nh, opp(player), -beta, -alpha, qd + 1);
    if (score >= beta) return beta;
    if (score > alpha)  alpha = score;
  }
  return alpha;
}

// 本探索 (negamax + alpha-beta)
function alphaBeta(board, hands, player, depth, alpha, beta, ply) {
  if (stopFlag) return 0;
  nodeCount++;

  if (depth <= 0) return quiescence(board, hands, player, alpha, beta, 0);

  const moves = genMoves(board, hands, player);
  if (moves.length === 0) return -(MATE_SCORE - ply); // 詰み

  sortMoves(moves, board, ply);

  for (const mv of moves) {
    if (stopFlag) return alpha;
    const { board: nb, hands: nh } = applyMove(board, hands, mv, player);
    const score = -alphaBeta(nb, nh, opp(player), depth - 1, -beta, -alpha, ply + 1);
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      // ベータカット: quiet手ならキラー手・ヒストリーを更新
      if (!mv.drop && !board[mv.to[0]][mv.to[1]]) {
        if (ply < MAX_PLY) {
          const k = killers[ply];
          if (!k[0] || mvKey(k[0]) !== mvKey(mv)) { k[1] = k[0]; k[0] = mv; }
        }
        const key = mvKey(mv);
        histMap.set(key, (histMap.get(key) || 0) + depth * depth);
      }
      return alpha;
    }
  }
  return alpha;
}

// ── USI 変換 ───────────────────────────────────────────────────
const FILES_USI = ['9','8','7','6','5','4','3','2','1'];
const RANKS_USI = ['a','b','c','d','e','f','g','h','i'];
function toUSI(mv) {
  if (mv.drop) return `${mv.drop.toLowerCase()}*${FILES_USI[mv.to[1]]}${RANKS_USI[mv.to[0]]}`;
  return `${FILES_USI[mv.from[1]]}${RANKS_USI[mv.from[0]]}${FILES_USI[mv.to[1]]}${RANKS_USI[mv.to[0]]}${mv.promote ? '+' : ''}`;
}

// ── SFEN パーサ ────────────────────────────────────────────────
const USI_TO_TYPE = { p:'P',l:'L',n:'N',s:'S',g:'G',b:'B',r:'R',k:'K' };
function parseSFEN(sfen) {
  const parts = sfen.split(' ');
  const turn  = parts[1] === 'b' ? 1 : 2;
  const board = Array.from({ length: 9 }, () => Array(9).fill(null));
  let r = 0, c = 0, promote = false;
  for (const ch of parts[0]) {
    if (ch === '/') { r++; c = 0; promote = false; }
    else if (ch === '+') { promote = true; }
    else if (/\d/.test(ch)) { c += parseInt(ch); promote = false; }
    else {
      const type = promote ? '+' + USI_TO_TYPE[ch.toLowerCase()] : USI_TO_TYPE[ch.toLowerCase()];
      board[r][c] = { type, player: ch === ch.toUpperCase() ? 1 : 2 };
      c++; promote = false;
    }
  }
  const hands = { 1:{}, 2:{} };
  const hs = parts[2] || '-';
  if (hs !== '-') {
    let n = 1;
    for (const ch of hs) {
      if (/\d/.test(ch)) n = parseInt(ch);
      else {
        const p  = ch === ch.toUpperCase() ? 1 : 2;
        const tp = ch.toUpperCase();
        hands[p][tp] = (hands[p][tp] || 0) + n;
        n = 1;
      }
    }
  }
  return { board, hands, player: turn };
}

// ── 日本語ラベル ───────────────────────────────────────────────
const FILES_JP = ['１','２','３','４','５','６','７','８','９'];
const RANKS_JP = ['一','二','三','四','五','六','七','八','九'];
const PIECE_JP = {
  P:'歩', L:'香', N:'桂', S:'銀', G:'金', B:'角', R:'飛', K:'玉',
  '+P':'と', '+L':'成香', '+N':'成桂', '+S':'成銀', '+B':'馬', '+R':'竜',
};
function moveToJP(mv, board, player) {
  const mark = player === 1 ? '▲' : '△';
  if (mv.drop) return `${mark}${FILES_JP[mv.to[1]]}${RANKS_JP[mv.to[0]]}${PIECE_JP[mv.drop]}打`;
  const piece = board[mv.from[0]][mv.from[1]];
  const name  = PIECE_JP[piece?.type] ?? '?';
  return `${mark}${FILES_JP[mv.to[1]]}${RANKS_JP[mv.to[0]]}${name}${mv.promote ? '成' : ''}(${9-mv.from[1]}${mv.from[0]+1})`;
}

// ── 反復深化メイン ─────────────────────────────────────────────
let thinkTimer = null;
let multiPV    = 1;

function stopThinking() {
  stopFlag = true;
  if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; }
}

function think(sfen, maxDepthParam, timeLimitMs, mpv) {
  stopFlag  = false;
  multiPV   = mpv || 1;
  nodeCount = 0;
  for (let i = 0; i < MAX_PLY; i++) killers[i] = [null, null];
  histMap.clear();

  const { board, hands, player } = parseSFEN(sfen);
  const allMoves = genMoves(board, hands, player);

  if (allMoves.length === 0) {
    self.postMessage({ type: 'bestmove', move: 'resign' });
    return;
  }

  const maxDepth  = maxDepthParam || 8;
  const startTime = Date.now();
  const timeLimit = timeLimitMs  || 3000;

  const moveScores = allMoves.map(mv => ({ mv, score: -INF }));

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (stopFlag) break;
    if (Date.now() - startTime > timeLimit * 0.85) break;

    for (const ms of moveScores) {
      if (stopFlag) break;
      const { board: nb, hands: nh } = applyMove(board, hands, ms.mv, player);
      ms.score = -alphaBeta(nb, nh, opp(player), depth - 1, -INF, INF, 1);
      ms.nodeCount = nodeCount;  // 各手のノード数を記録
    }
    if (stopFlag) break;

    moveScores.sort((a, b) => b.score - a.score);

    // info 送信 (MultiPV分)
    const pvCount = Math.min(multiPV, moveScores.length);
    for (let i = 0; i < pvCount; i++) {
      const ms     = moveScores[i];
      const isMate = Math.abs(ms.score) >= MATE_SCORE - maxDepth * 2;
      const mateIn = isMate ? Math.max(1, MATE_SCORE - Math.abs(ms.score)) : null;
      self.postMessage({
        type:    'info',
        multipv: i + 1,
        depth,
        score:   ms.score,
        pvJP:    moveToJP(ms.mv, board, player),
        pvUSI:   toUSI(ms.mv),
        nodes:   ms.nodeCount ?? nodeCount,  // 各 multipv に対応するノード数を使用
        isMate,
        mateIn,
      });
    }
  }

  self.postMessage({ type: 'bestmove', move: toUSI(moveScores[0].mv) });
}

// ── メッセージ受信 ─────────────────────────────────────────────
self.onmessage = ({ data }) => {
  const { cmd } = data;
  if (cmd === 'start_analysis' || cmd === 'analyze') {
    stopThinking();
    thinkTimer = setTimeout(
      () => think(data.sfen, data.maxDepth || 8, data.timeLimit || 3000, data.multiPV || 1),
      10,
    );
  } else if (cmd === 'stop') {
    stopThinking();
    self.postMessage({ type: 'stopped' });
  } else if (cmd === 'ai_think') {
    stopThinking();
    thinkTimer = setTimeout(
      () => think(data.sfen, data.maxDepth || 6, data.timeLimit || 2000, 1),
      10,
    );
  }
};
