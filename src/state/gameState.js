// ============================================================
//  将棋盤のゲーム状態管理（ムーブツリー付き）
// ============================================================

export const PIECE_KANJI = {
  K: '王', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩',
  '+R': '竜', '+B': '馬', '+S': '全', '+N': '圭', '+L': '杏', '+P': 'と',
};

export function getPieceChar(type, player) {
  if (type === 'K') return player === 1 ? '王' : '玉';
  return PIECE_KANJI[type] || type;
}

const PROMOTABLE = new Set(['R', 'B', 'S', 'N', 'L', 'P']);
export function canPromote(type) { return PROMOTABLE.has(type); }
export function isPromoted(type) { return type.startsWith('+'); }
export function demote(type) { return type.startsWith('+') ? type.slice(1) : type; }

// ------------------------------------------------------------------
// 初期盤面 [row][col]
//   row 0 = 一段目(後手陣), row 8 = 九段目(先手陣)
//   col 0 = ９筋, col 8 = １筋
// ------------------------------------------------------------------
export function createInitialBoard() {
  const p2 = (t) => ({ type: t, player: 2, promoted: false });
  const p1 = (t) => ({ type: t, player: 1, promoted: false });
  return [
    [p2('L'),p2('N'),p2('S'),p2('G'),p2('K'),p2('G'),p2('S'),p2('N'),p2('L')],
    [null,p2('R'),null,null,null,null,null,p2('B'),null],
    [p2('P'),p2('P'),p2('P'),p2('P'),p2('P'),p2('P'),p2('P'),p2('P'),p2('P')],
    [null,null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null,null],
    [p1('P'),p1('P'),p1('P'),p1('P'),p1('P'),p1('P'),p1('P'),p1('P'),p1('P')],
    [null,p1('B'),null,null,null,null,null,p1('R'),null],
    [p1('L'),p1('N'),p1('S'),p1('G'),p1('K'),p1('G'),p1('S'),p1('N'),p1('L')],
  ];
}

export function createInitialHands() { return { 1: {}, 2: {} }; }

export function copyBoard(board) {
  return board.map(row => row.map(cell => cell ? { ...cell } : null));
}
export function copyHands(hands) {
  return { 1: { ...hands[1] }, 2: { ...hands[2] } };
}

// ------------------------------------------------------------------
// 駒を動かす（盤面への適用）
// ------------------------------------------------------------------
export function applyMove(board, hands, move, player) {
  const nb = copyBoard(board);
  const nh = copyHands(hands);
  const [toR, toC] = move.to;

  if (move.from) {
    const [fr, fc] = move.from;
    const piece = nb[fr][fc];
    if (!piece) return { board: nb, hands: nh };

    const target = nb[toR][toC];
    if (target) {
      const base = demote(target.type) === 'K' ? 'K' : demote(target.type);
      nh[player][base] = (nh[player][base] || 0) + 1;
    }
    nb[fr][fc] = null;
    const newType = move.promote ? (isPromoted(piece.type) ? piece.type : '+' + piece.type) : piece.type;
    nb[toR][toC] = { type: newType, player, promoted: move.promote || piece.promoted };
  } else {
    const pt = move.piece;
    if ((nh[player][pt] || 0) <= 0) return { board: nb, hands: nh };
    nh[player][pt]--;
    if (nh[player][pt] === 0) delete nh[player][pt];
    nb[toR][toC] = { type: pt, player, promoted: false };
  }
  return { board: nb, hands: nh };
}

// ------------------------------------------------------------------
// 王手・合法性判定
// ------------------------------------------------------------------

// byPlayer の駒が (row, col) を攻撃しているか
export function isSquareAttackedBy(board, row, col, byPlayer) {
  const dir = byPlayer === 1 ? -1 : 1; // byPlayer の前方向
  const inB = (r, c) => r >= 0 && r <= 8 && c >= 0 && c <= 8;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (!piece || piece.player !== byPlayer) continue;
      const { type } = piece;

      switch (type) {
        case 'P':
          if (r + dir === row && c === col) return true;
          break;
        case 'L': {
          if (c !== col) break;
          // Lance slides forward only
          let lr = r + dir;
          while (inB(lr, c)) {
            if (lr === row) return true;
            if (board[lr][c]) break; // blocked
            lr += dir;
          }
          break;
        }
        case 'N':
          if ((r + 2 * dir === row) && (c - 1 === col || c + 1 === col)) return true;
          break;
        case 'S':
          if (r + dir === row && (c === col || c - 1 === col || c + 1 === col)) return true;
          if (r - dir === row && (c - 1 === col || c + 1 === col)) return true;
          break;
        case 'G': case '+P': case '+L': case '+N': case '+S':
          // Gold movement
          if (r + dir === row && (c === col || c - 1 === col || c + 1 === col)) return true;
          if (r - dir === row && c === col) return true;
          if (r === row && (c - 1 === col || c + 1 === col)) return true;
          break;
        case 'K':
          if (Math.abs(r - row) <= 1 && Math.abs(c - col) <= 1 && (r !== row || c !== col)) return true;
          break;
        case 'R': {
          // 4 cardinal directions (sliding)
          const rookDirs = [[-1,0],[1,0],[0,-1],[0,1]];
          for (const [dr, dc] of rookDirs) {
            let sr = r + dr, sc = c + dc;
            while (inB(sr, sc)) {
              if (sr === row && sc === col) return true;
              if (board[sr][sc]) break;
              sr += dr; sc += dc;
            }
          }
          break;
        }
        case 'B': {
          const bishopDirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
          for (const [dr, dc] of bishopDirs) {
            let sr = r + dr, sc = c + dc;
            while (inB(sr, sc)) {
              if (sr === row && sc === col) return true;
              if (board[sr][sc]) break;
              sr += dr; sc += dc;
            }
          }
          break;
        }
        case '+R': {
          // Rook slides
          const dragonSlides = [[-1,0],[1,0],[0,-1],[0,1]];
          for (const [dr, dc] of dragonSlides) {
            let sr = r + dr, sc = c + dc;
            while (inB(sr, sc)) {
              if (sr === row && sc === col) return true;
              if (board[sr][sc]) break;
              sr += dr; sc += dc;
            }
          }
          // + diagonal adjacents
          if (Math.abs(r - row) === 1 && Math.abs(c - col) === 1) return true;
          break;
        }
        case '+B': {
          // Bishop slides
          const horseDirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
          for (const [dr, dc] of horseDirs) {
            let sr = r + dr, sc = c + dc;
            while (inB(sr, sc)) {
              if (sr === row && sc === col) return true;
              if (board[sr][sc]) break;
              sr += dr; sc += dc;
            }
          }
          // + cardinal adjacents
          if ((Math.abs(r - row) + Math.abs(c - col)) === 1) return true;
          break;
        }
        default: break;
      }
    }
  }
  return false;
}

// player の王の位置を返す
export function findKing(board, player) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = board[r][c];
      if (cell && cell.player === player && cell.type === 'K') return [r, c];
    }
  }
  return null;
}

// player の王が王手されているか
export function isInCheck(board, player) {
  const king = findKing(board, player);
  if (!king) return false;
  const opponent = player === 1 ? 2 : 1;
  return isSquareAttackedBy(board, king[0], king[1], opponent);
}

// 盤上の駒移動が合法か（自玉を王手に晒さない）
export function isMoveLegal(board, hands, from, to, promote, player) {
  const move = { from, to, promote };
  const { board: newBoard } = applyMove(board, hands, move, player);
  return !isInCheck(newBoard, player);
}

// 駒打ちが合法か（自玉を王手に晒さない + 打ち歩詰め検出）
export function isDropLegal(board, hands, pieceType, to, player) {
  const move = { from: null, to, promote: false, piece: pieceType };
  const { board: newBoard, hands: newHands } = applyMove(board, hands, move, player);

  // 自玉が王手に晒される打ちは不可
  if (isInCheck(newBoard, player)) return false;

  // 打ち歩詰め (uchifuzume) — 歩を打って相手が詰みなら不可
  if (pieceType === 'P') {
    const opponent = player === 1 ? 2 : 1;
    if (isInCheck(newBoard, opponent)) {
      // 相手が詰んでいるか確認
      if (_hasNoLegalMoves(newBoard, newHands, opponent)) return false;
    }
  }

  return true;
}

// 詰み判定: player が王手されており、かつ合法手がない
export function isCheckmate(board, hands, player) {
  if (!isInCheck(board, player)) return false;
  return _hasNoLegalMoves(board, hands, player);
}

// ステイルメイト判定（将棋では通常起きないが安全策）
export function isStalemate(board, hands, player) {
  if (isInCheck(board, player)) return false;
  return _hasNoLegalMoves(board, hands, player);
}

// 内部用: player に合法手が一つもないか
function _hasNoLegalMoves(board, hands, player) {
  // 1. 盤上の駒による逃げ・合い駒・取り
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = board[r][c];
      if (!cell || cell.player !== player) continue;
      const dests = _getMoveDestinationsRaw(board, r, c);
      for (const [dr, dc] of dests) {
        if (isMoveLegal(board, hands, [r, c], [dr, dc], false, player)) return false;
        // 成りバージョンも試す
        if (canPromote(cell.type) && !isPromoted(cell.type)) {
          if (isMoveLegal(board, hands, [r, c], [dr, dc], true, player)) return false;
        }
      }
    }
  }
  // 2. 持ち駒による合い駒
  for (const pt of Object.keys(hands[player] || {})) {
    if ((hands[player][pt] || 0) <= 0) continue;
    const dropDests = _getDropDestinationsRaw(board, pt, player);
    for (const [dr, dc] of dropDests) {
      const move = { from: null, to: [dr, dc], promote: false, piece: pt };
      const { board: nb } = applyMove(board, hands, move, player);
      if (!isInCheck(nb, player)) return false;
    }
  }
  return true;
}

// 内部用: getMoveDestinations と同じロジック (循環参照回避のためインライン)
function _getMoveDestinationsRaw(board, row, col) {
  const piece = board[row]?.[col];
  if (!piece) return [];
  const { type, player } = piece;
  const dir = player === 1 ? -1 : 1;
  const dests = [];
  const inB = (r, c) => r >= 0 && r <= 8 && c >= 0 && c <= 8;
  const tryAdd = (r, c) => {
    if (!inB(r, c)) return false;
    const t = board[r][c];
    if (t?.player === player) return false;
    dests.push([r, c]);
    return !t;
  };
  const slide = (dr, dc) => {
    let r = row + dr, c = col + dc;
    while (inB(r, c)) {
      const t = board[r][c];
      if (t?.player === player) break;
      dests.push([r, c]);
      if (t) break;
      r += dr; c += dc;
    }
  };
  const goldDests = () => {
    tryAdd(row+dir,col); tryAdd(row-dir,col);
    tryAdd(row,col-1);   tryAdd(row,col+1);
    tryAdd(row+dir,col-1); tryAdd(row+dir,col+1);
  };
  switch (type) {
    case 'P':  tryAdd(row+dir, col); break;
    case 'L':  slide(dir, 0); break;
    case 'N':  tryAdd(row+2*dir,col-1); tryAdd(row+2*dir,col+1); break;
    case 'S':
      tryAdd(row+dir,col); tryAdd(row+dir,col-1); tryAdd(row+dir,col+1);
      tryAdd(row-dir,col-1); tryAdd(row-dir,col+1); break;
    case 'G':  goldDests(); break;
    case 'K':
      for (let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(dr||dc) tryAdd(row+dr,col+dc);
      break;
    case 'R':  slide(-1,0);slide(1,0);slide(0,-1);slide(0,1); break;
    case 'B':  slide(-1,-1);slide(-1,1);slide(1,-1);slide(1,1); break;
    case '+R': slide(-1,0);slide(1,0);slide(0,-1);slide(0,1);
               tryAdd(row-1,col-1);tryAdd(row-1,col+1);tryAdd(row+1,col-1);tryAdd(row+1,col+1); break;
    case '+B': slide(-1,-1);slide(-1,1);slide(1,-1);slide(1,1);
               tryAdd(row-1,col);tryAdd(row+1,col);tryAdd(row,col-1);tryAdd(row,col+1); break;
    case '+P': case '+L': case '+N': case '+S': goldDests(); break;
    default: break;
  }
  return dests;
}

// 内部用: getDropDestinations と同じロジック
function _getDropDestinationsRaw(board, pieceType, player) {
  const dests = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c]) continue;
      if ((pieceType === 'P' || pieceType === 'L') && (player===1 ? r===0 : r===8)) continue;
      if (pieceType === 'N' && (player===1 ? r<=1 : r>=7)) continue;
      if (pieceType === 'P') {
        let hasPawn = false;
        for (let rr=0;rr<9;rr++) { const cl=board[rr][c]; if(cl?.player===player&&cl?.type==='P'){hasPawn=true;break;} }
        if (hasPawn) continue;
      }
      dests.push([r, c]);
    }
  }
  return dests;
}

// ------------------------------------------------------------------
// 合法手生成
// ------------------------------------------------------------------
export function getMoveDestinations(board, row, col) {
  const piece = board[row]?.[col];
  if (!piece) return [];
  const { type, player } = piece;
  const dir = player === 1 ? -1 : 1;
  const dests = [];

  const inB = (r, c) => r >= 0 && r <= 8 && c >= 0 && c <= 8;
  const tryAdd = (r, c) => {
    if (!inB(r, c)) return false;
    const t = board[r][c];
    if (t?.player === player) return false;
    dests.push([r, c]);
    return !t;
  };
  const slide = (dr, dc) => {
    let r = row + dr, c = col + dc;
    while (inB(r, c)) {
      const t = board[r][c];
      if (t?.player === player) break;
      dests.push([r, c]);
      if (t) break;
      r += dr; c += dc;
    }
  };
  const goldDests = () => {
    tryAdd(row+dir,col); tryAdd(row-dir,col);
    tryAdd(row,col-1);   tryAdd(row,col+1);
    tryAdd(row+dir,col-1); tryAdd(row+dir,col+1);
  };

  switch (type) {
    case 'P':  tryAdd(row+dir, col); break;
    case 'L':  slide(dir, 0); break;
    case 'N':  tryAdd(row+2*dir,col-1); tryAdd(row+2*dir,col+1); break;
    case 'S':
      tryAdd(row+dir,col); tryAdd(row+dir,col-1); tryAdd(row+dir,col+1);
      tryAdd(row-dir,col-1); tryAdd(row-dir,col+1); break;
    case 'G':  goldDests(); break;
    case 'K':
      for (let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(dr||dc) tryAdd(row+dr,col+dc);
      break;
    case 'R':  slide(-1,0);slide(1,0);slide(0,-1);slide(0,1); break;
    case 'B':  slide(-1,-1);slide(-1,1);slide(1,-1);slide(1,1); break;
    case '+R': slide(-1,0);slide(1,0);slide(0,-1);slide(0,1);
               tryAdd(row-1,col-1);tryAdd(row-1,col+1);tryAdd(row+1,col-1);tryAdd(row+1,col+1); break;
    case '+B': slide(-1,-1);slide(-1,1);slide(1,-1);slide(1,1);
               tryAdd(row-1,col);tryAdd(row+1,col);tryAdd(row,col-1);tryAdd(row,col+1); break;
    case '+P': case '+L': case '+N': case '+S': goldDests(); break;
    default: break;
  }
  return dests;
}

// 打ち駒合法マス（二歩・打ち香・打ち桂の制限）
export function getDropDestinations(board, pieceType, player) {
  const dests = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c]) continue;
      if ((pieceType === 'P' || pieceType === 'L') && (player===1 ? r===0 : r===8)) continue;
      if (pieceType === 'N' && (player===1 ? r<=1 : r>=7)) continue;
      if (pieceType === 'P') {
        let hasPawn = false;
        for (let rr=0;rr<9;rr++) { const cl=board[rr][c]; if(cl?.player===player&&cl?.type==='P'){hasPawn=true;break;} }
        if (hasPawn) continue;
      }
      dests.push([r, c]);
    }
  }
  return dests;
}

// 合法手のみに絞った移動先（自玉を王手に晒す手を除外）
export function getLegalMoveDestinations(board, hands, row, col) {
  const piece = board[row]?.[col];
  if (!piece) return [];
  const { player, type } = piece;
  const promotable = canPromote(type) && !isPromoted(type);
  const dests = getMoveDestinations(board, row, col);
  return dests.filter(([r, c]) => {
    if (isMoveLegal(board, hands, [row, col], [r, c], false, player)) return true;
    // 成駒候補のみ成りバージョンもチェック
    return promotable && isMoveLegal(board, hands, [row, col], [r, c], true, player);
  });
}

// 合法打ち先のみに絞った打ち先（自玉を王手に晒す打ち＋打ち歩詰めを除外）
export function getLegalDropDestinations(board, hands, pieceType, player) {
  const dests = getDropDestinations(board, pieceType, player);
  return dests.filter(([r, c]) => isDropLegal(board, hands, pieceType, [r, c], player));
}

// ------------------------------------------------------------------
// 日本語棋譜表記のパース
// ------------------------------------------------------------------
const FILE_MAP_P = {'１':8,'２':7,'３':6,'４':5,'５':4,'６':3,'７':2,'８':1,'９':0};
const RANK_MAP_P = {'一':0,'二':1,'三':2,'四':3,'五':4,'六':5,'七':6,'八':7,'九':8};
const KANJI_TO_TYPE = {
  '王':'K','玉':'K','飛':'R','竜':'+R','角':'B','馬':'+B',
  '金':'G','銀':'S','全':'+S','桂':'N','圭':'+N','香':'L','杏':'+L','歩':'P','と':'+P',
};

function findFromSquare(board, pieceType, toRow, toCol, player) {
  // 1. 指定タイプで検索
  for (let r=0;r<9;r++) for(let c=0;c<9;c++) {
    const cell = board[r][c];
    if (!cell||cell.player!==player||cell.type!==pieceType) continue;
    if (getMoveDestinations(board,r,c).some(([dr,dc])=>dr===toRow&&dc===toCol)) return [r,c];
  }
  // 2. どんな駒でも（寛容フォールバック）
  for (let r=0;r<9;r++) for(let c=0;c<9;c++) {
    const cell = board[r][c];
    if (!cell||cell.player!==player) continue;
    if (getMoveDestinations(board,r,c).some(([dr,dc])=>dr===toRow&&dc===toCol)) return [r,c];
  }
  return null;
}

function parseMoveLabel(label, lastTo, board, hands, player) {
  const chars = [...label];
  let i = 0;
  let toRow, toCol;

  if (FILE_MAP_P[chars[i]] !== undefined) {
    toCol = FILE_MAP_P[chars[i]]; i++;
    toRow = RANK_MAP_P[chars[i]]; i++;
    if (chars[i] === '同') i++;  // 座標＋同 のケース (e.g. "２四同歩")
  } else if (chars[i] === '同') {
    if (!lastTo) return null;
    [toRow, toCol] = lastTo; i++;
  } else {
    return null;
  }

  const pieceKanji = chars[i]; i++;
  const pieceType = KANJI_TO_TYPE[pieceKanji];
  if (pieceType === undefined) return null;
  const promote = chars[i] === '成';

  const from = findFromSquare(board, pieceType, toRow, toCol, player);
  if (from) return { from, to: [toRow, toCol], promote };

  // 打ちチェック
  const baseType = isPromoted(pieceType) ? demote(pieceType) : pieceType;
  if ((hands[player]?.[baseType] || 0) > 0) {
    return { from: null, to: [toRow, toCol], promote: false, piece: baseType };
  }
  return null;
}

// ------------------------------------------------------------------
// 座標表示
// ------------------------------------------------------------------
const FILES_DISP = ['９','８','７','６','５','４','３','２','１'];
const RANKS_DISP = ['一','二','三','四','五','六','七','八','九'];

export function coordToLabel(row, col) { return `${FILES_DISP[col]}${RANKS_DISP[row]}`; }

export function moveToLabel(board, from, to, promote) {
  const piece = from ? board[from[0]][from[1]] : null;
  const pieceChar = piece ? getPieceChar(piece.type, piece.player) : '?';
  return `${coordToLabel(to[0], to[1])}${pieceChar}${promote ? '成' : ''}`;
}

// ------------------------------------------------------------------
// 手順ツリー
// ------------------------------------------------------------------
let _idSeq = 0;
function newId() { return `n${_idSeq++}`; }

export function buildInitialTree() {
  const nodes = {};
  const rootId = newId();
  nodes[rootId] = {
    id: rootId, move: null, player: null, moveNumber: 0,
    board: createInitialBoard(), hands: createInitialHands(),
    children: [], parentId: null,
    evalScore: null, isMainLine: true, label: '開始局面',
    moveFrom: null, moveTo: null,
  };
  return { nodes, rootId, mainLineIds: [rootId], currentId: rootId };
}

export function buildPositionTree(board, hands) {
  const nodes = {};
  const rootId = newId();
  nodes[rootId] = {
    id: rootId, move: null, player: null, moveNumber: 0,
    board: copyBoard(board), hands: copyHands(hands),
    children: [], parentId: null,
    evalScore: null, isMainLine: true, label: '編集局面',
    moveFrom: null, moveTo: null,
  };
  return { nodes, rootId, mainLineIds: [rootId], currentId: rootId };
}

// ルートからのパス
export function getPathFromRoot(nodes, nodeId) {
  const path = [];
  let cur = nodeId;
  while (cur) { path.unshift(cur); cur = nodes[cur]?.parentId ?? null; }
  return path;
}

// メインライン上の最後のノードを探す（分岐点）
export function findBranchPoint(nodes, currentId, mainLineIds) {
  const mainSet = new Set(mainLineIds);
  let cur = currentId;
  while (cur) {
    if (mainSet.has(cur)) return mainLineIds.indexOf(cur);
    cur = nodes[cur]?.parentId ?? null;
  }
  return 0;
}

// ユーザー指し手ノードを追加
export function addUserMoveNode(state, from, to, promote, dropPieceType = null) {
  const currentNode = state.nodes[state.currentId];
  const player = currentNode.moveNumber % 2 === 0 ? 1 : 2;

  let label, boardResult;
  if (from) {
    label = moveToLabel(currentNode.board, from, to, promote);
    boardResult = applyMove(currentNode.board, currentNode.hands, { from, to, promote }, player);
  } else {
    const pieceChar = getPieceChar(dropPieceType, player);
    label = `${coordToLabel(to[0], to[1])}${pieceChar}打`;
    boardResult = applyMove(
      currentNode.board, currentNode.hands,
      { from: null, to, promote: false, piece: dropPieceType },
      player,
    );
  }

  const newId2 = `u${_idSeq++}`;
  const newNode = {
    id: newId2, move: label, player,
    moveNumber: currentNode.moveNumber + 1,
    board: boardResult.board, hands: boardResult.hands,
    children: [], parentId: state.currentId,
    evalScore: null, isMainLine: false, label,
    moveFrom: from ?? null,
    moveTo: to,
  };

  return {
    nodes: {
      ...state.nodes,
      [state.currentId]: { ...currentNode, children: [...currentNode.children, newId2] },
      [newId2]: newNode,
    },
    currentId: newId2,
  };
}

// ------------------------------------------------------------------
// PV専用: 法的制約を無視した強制パース（フォールバック用）
// ------------------------------------------------------------------
function parsePVMoveForce(label, lastTo, board, hands, player) {
  const chars = [...label];
  let i = 0;
  let toRow, toCol;

  if (chars[i] === '同') {
    if (!lastTo) return null;
    [toRow, toCol] = lastTo; i++;
    while (i < chars.length && (chars[i] === '　' || chars[i] === ' ')) i++;
  } else if (FILE_MAP_P[chars[i]] !== undefined) {
    toCol = FILE_MAP_P[chars[i]]; i++;
    toRow = RANK_MAP_P[chars[i]]; i++;
    if (toRow === undefined || toCol === undefined) return null;
  } else return null;

  const pieceKanji = chars[i]; i++;
  const pieceType = KANJI_TO_TYPE[pieceKanji];
  if (!pieceType) return null;
  const promote = chars[i] === '成';
  const isDrop = chars[promote ? i + 1 : i] === '打';
  const baseType = demote(pieceType);

  if (isDrop) {
    return { from: null, to: [toRow, toCol], promote: false, piece: baseType, _force: true };
  }

  // 盤上から同タイプ（成り前後を問わない）の駒を探す
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = board[r][c];
      if (cell?.player === player && demote(cell.type) === baseType) {
        return { from: [r, c], to: [toRow, toCol], promote, _force: true };
      }
    }
  }
  // 見つからなければ強制打ち
  return { from: null, to: [toRow, toCol], promote: false, piece: baseType, _force: true };
}

// PV専用: 手の適用（手駒0でも強制置き）
function applyMovePV(board, hands, move, player) {
  if (!move._force) return applyMove(board, hands, move, player);

  const nb = copyBoard(board);
  const nh = copyHands(hands);
  const [toR, toC] = move.to;

  // 移動先の駒を取る
  const target = nb[toR][toC];
  if (target && target.player !== player) {
    const base = demote(target.type);
    nh[player][base] = (nh[player][base] || 0) + 1;
  }

  if (move.from) {
    const [fr, fc] = move.from;
    const piece = nb[fr][fc];
    if (piece) {
      nb[fr][fc] = null;
      const newType = move.promote
        ? (isPromoted(piece.type) ? piece.type : '+' + piece.type)
        : piece.type;
      nb[toR][toC] = { type: newType, player, promoted: move.promote || piece.promoted };
    }
  } else {
    const pt = move.piece;
    if (nh[player][pt] > 0) {
      nh[player][pt]--;
      if (nh[player][pt] === 0) delete nh[player][pt];
    }
    nb[toR][toC] = { type: pt, player, promoted: false };
  }
  return { board: nb, hands: nh };
}

// ------------------------------------------------------------------
// 盤面 → SFEN 文字列
// ------------------------------------------------------------------
const SFEN_TYPE = { K:'K', R:'R', B:'B', G:'G', S:'S', N:'N', L:'L', P:'P',
                    '+R':'+R','+B':'+B','+S':'+S','+N':'+N','+L':'+L','+P':'+P' };
const HAND_ORDER = ['R','B','G','S','N','L','P'];

export function boardToSFEN(board, hands, player, moveNumber) {
  // 盤面行列
  const rows = [];
  for (let r = 0; r < 9; r++) {
    let row = ''; let empty = 0;
    for (let c = 0; c < 9; c++) {
      const cell = board[r][c];
      if (!cell) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const base = SFEN_TYPE[cell.type] ?? cell.type;
      row += cell.player === 1 ? base : base.toLowerCase();
    }
    if (empty) row += empty;
    rows.push(row);
  }

  // 手番
  const side = player === 1 ? 'b' : 'w';

  // 持駒
  let handStr = '';
  for (const p of HAND_ORDER) {
    const cnt = hands[1]?.[p] || 0;
    if (cnt > 0) handStr += (cnt > 1 ? cnt : '') + p;
  }
  for (const p of HAND_ORDER) {
    const cnt = hands[2]?.[p] || 0;
    if (cnt > 0) handStr += (cnt > 1 ? cnt : '') + p.toLowerCase();
  }
  if (!handStr) handStr = '-';

  return `${rows.join('/')} ${side} ${handStr} ${moveNumber + 1}`;
}

// ------------------------------------------------------------------
// エンジン用 SFEN: 王が1枚しかない場合、もう1枚を一番遠い空きマスに自動配置
// ------------------------------------------------------------------
export function boardToSFENForEngine(board, hands, player, moveNumber) {
  let p1KingPos = null, p2KingPos = null;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const cell = board[r][c];
      if (cell && cell.type === 'K') {
        if (cell.player === 1) p1KingPos = [r, c];
        else p2KingPos = [r, c];
      }
    }

  if (p1KingPos && p2KingPos) return boardToSFEN(board, hands, player, moveNumber);

  const modBoard = board.map(r => [...r]);

  // 両方ない極端なケース: デフォルト位置に配置
  if (!p1KingPos && !p2KingPos) {
    if (!modBoard[8][4]) modBoard[8][4] = { type: 'K', player: 1, promoted: false };
    if (!modBoard[0][4]) modBoard[0][4] = { type: 'K', player: 2, promoted: false };
    return boardToSFEN(modBoard, hands, player, moveNumber);
  }

  // 片方だけいない: 既存の王から最も遠い空きマスに配置
  const [kr, kc] = p1KingPos ?? p2KingPos;
  const missingPlayer = p1KingPos ? 2 : 1;
  let maxDist = -1, bestR = 0, bestC = 0;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      if (!modBoard[r][c]) {
        const d = (r - kr) ** 2 + (c - kc) ** 2;
        if (d > maxDist) { maxDist = d; bestR = r; bestC = c; }
      }
    }
  modBoard[bestR][bestC] = { type: 'K', player: missingPlayer, promoted: false };
  return boardToSFEN(modBoard, hands, player, moveNumber);
}

// ------------------------------------------------------------------
// USI 指し手文字列パース  例: "7g7f"  "7g7f+"  "P*5e"
// 返り値: { from:[r,c]|null, to:[r,c], promote, isDrop, piece? }
// ------------------------------------------------------------------
const USI_RANK = 'abcdefghi'; // a=1, b=2, ..., i=9

export function parseUSIMove(usiStr) {
  // 駒打ち: "P*5e"
  const dropM = usiStr.match(/^([PLNSGBRKplnsgbrk])\*(\d)([a-i])$/);
  if (dropM) {
    const pt = dropM[1].toUpperCase();
    const toFile = parseInt(dropM[2]);
    const toRank = USI_RANK.indexOf(dropM[3]) + 1;
    return { from: null, to: [toRank - 1, 9 - toFile], promote: false, isDrop: true, piece: pt };
  }
  // 移動: "7g7f" or "7g7f+"
  const moveM = usiStr.match(/^(\d)([a-i])(\d)([a-i])(\+?)$/);
  if (!moveM) return null;
  const from = [USI_RANK.indexOf(moveM[2]), 9 - parseInt(moveM[1])];
  const to   = [USI_RANK.indexOf(moveM[4]), 9 - parseInt(moveM[3])];
  return { from, to, promote: moveM[5] === '+', isDrop: false };
}

// USI 指し手 → 日本語表記  (現局面の board を参照)
export function usiMoveToJapanese(usiStr, board, player) {
  const mv = parseUSIMove(usiStr);
  if (!mv) return usiStr;
  if (mv.isDrop) {
    return `${coordToLabel(mv.to[0], mv.to[1])}${getPieceChar(mv.piece, player)}打`;
  }
  return moveToLabel(board, mv.from, mv.to, mv.promote);
}

// ------------------------------------------------------------------
// USI 形式の読み筋（PV）から局面列を生成
// ------------------------------------------------------------------
export function buildPVStatesUSI(pvUSI, startBoard, startHands, startPlayer) {
  const tokens = pvUSI.trim().split(/\s+/).filter(Boolean);
  const states = [{
    board: copyBoard(startBoard), hands: copyHands(startHands),
    label: '現局面', moveFrom: null, moveTo: null,
  }];
  let curBoard = copyBoard(startBoard);
  let curHands = copyHands(startHands);
  let player = startPlayer;

  for (const tok of tokens) {
    const mv = parseUSIMove(tok);
    if (!mv) { player = player === 1 ? 2 : 1; continue; }

    // 日本語ラベルを生成（適用前の盤面を使う）
    const label = usiMoveToJapanese(tok, curBoard, player);

    // 盤面適用
    const move = mv.isDrop
      ? { from: null, to: mv.to, promote: false, piece: mv.piece }
      : { from: mv.from, to: mv.to, promote: mv.promote };
    const res = applyMovePV(curBoard, curHands, { ...move, _force: true }, player);
    curBoard = res.board;
    curHands = res.hands;

    states.push({
      board: copyBoard(curBoard), hands: copyHands(curHands),
      label,
      moveFrom: mv.from ?? null,
      moveTo:   mv.to,
    });
    player = player === 1 ? 2 : 1;
  }
  return states;
}

// ------------------------------------------------------------------
// 読み筋（PV）から局面列を生成
// ------------------------------------------------------------------
export function buildPVStates(pvString, startBoard, startHands, startPlayer) {
  const moves = pvString.trim().split(/\s+/).filter(Boolean);
  const states = [{
    board: copyBoard(startBoard), hands: copyHands(startHands),
    label: '現局面', moveFrom: null, moveTo: null,
  }];
  let curBoard = copyBoard(startBoard);
  let curHands = copyHands(startHands);
  let player = startPlayer;
  let lastTo = null;

  for (const label of moves) {
    // 通常パース → 失敗したら強制パース
    let moveInfo = parseMoveLabel(label, lastTo, curBoard, curHands, player);
    if (!moveInfo) moveInfo = parsePVMoveForce(label, lastTo, curBoard, curHands, player);

    if (moveInfo) {
      const res = applyMovePV(curBoard, curHands, moveInfo, player);
      curBoard = res.board;
      curHands = res.hands;
      lastTo = moveInfo.to;
    }
    states.push({
      board: copyBoard(curBoard), hands: copyHands(curHands),
      label,
      moveFrom: moveInfo?.from ?? null,
      moveTo: moveInfo?.to ?? null,
    });
    player = player === 1 ? 2 : 1;
  }
  return states;
}

// ------------------------------------------------------------------
// 駒落ち名マッピング（内部 type ↔ KIF 手合割テキスト）
// ------------------------------------------------------------------
export const HANDICAP_KIF_NAME = {
  'lance':      '香落ち',
  'rlance':     '右香落ち',
  'bishop':     '角落ち',
  'rook':       '飛車落ち',
  'rook-lance': '飛香落ち',
  '2piece':     '二枚落ち',
  '4piece':     '四枚落ち',
  '6piece':     '六枚落ち',
  '8piece':     '八枚落ち',
  '10piece':    '十枚落ち',
};
export const KIF_NAME_TO_HANDICAP = Object.fromEntries(
  Object.entries(HANDICAP_KIF_NAME).map(([k, v]) => [v, k])
);

function boardsEqual(a, b) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const x = a[r][c], y = b[r][c];
      if (!x !== !y) return false;
      if (x && y && (x.type !== y.type || x.player !== y.player)) return false;
    }
  return true;
}

/** 盤面・持駒から駒落ちタイプを返す。平手なら 'even'、不明なら null */
export function detectHandicapType(board, hands) {
  if (!board) return null;
  // 持駒があれば駒落ちではない
  if (hands && [1, 2].some(p => Object.values(hands[p] || {}).some(v => v > 0))) return null;
  if (boardsEqual(board, createInitialBoard())) return 'even';
  for (const type of Object.keys(HANDICAP_KIF_NAME)) {
    if (boardsEqual(board, createHandicapBoard(type))) return type;
  }
  return null;
}

// ------------------------------------------------------------------
// 駒落ち開始盤面
// ------------------------------------------------------------------
export function createHandicapBoard(type) {
  const board = createInitialBoard();
  switch (type) {
    case 'lance':      board[0][8] = null; break;                            // 香落ち (1筋)
    case 'rlance':     board[0][0] = null; break;                            // 右香落ち (9筋)
    case 'bishop':     board[1][7] = null; break;                            // 角落ち
    case 'rook':       board[1][1] = null; break;                            // 飛車落ち
    case 'rook-lance': board[1][1] = null; board[0][8] = null; break;        // 飛香落ち
    case '2piece':     board[1][1] = null; board[1][7] = null; break;        // 二枚落ち
    case '4piece':     board[1][1] = null; board[1][7] = null;
                       board[0][0] = null; board[0][8] = null; break;        // 四枚落ち
    case '6piece':     board[1][1] = null; board[1][7] = null;
                       board[0][0] = null; board[0][8] = null;
                       board[0][1] = null; board[0][7] = null; break;        // 六枚落ち
    case '8piece':     board[1][1] = null; board[1][7] = null;
                       board[0][0] = null; board[0][8] = null;
                       board[0][1] = null; board[0][7] = null;
                       board[0][2] = null; board[0][6] = null; break;        // 八枚落ち
    case '10piece':    board[1][1] = null; board[1][7] = null;
                       board[0][0] = null; board[0][8] = null;
                       board[0][1] = null; board[0][7] = null;
                       board[0][2] = null; board[0][6] = null;
                       board[0][3] = null; board[0][5] = null; break;        // 十枚落ち
    default: break;
  }
  return board;
}

// カスタム開始局面からゲームツリーを構築
export function buildGameTree(board, hands) {
  const nodes = {};
  const rootId = newId();
  nodes[rootId] = {
    id: rootId, move: null, player: null, moveNumber: 0,
    board: copyBoard(board),
    hands: hands ? copyHands(hands) : createInitialHands(),
    children: [], parentId: null,
    evalScore: null, isMainLine: true, label: '開始局面',
    moveFrom: null, moveTo: null,
  };
  const mainLineIds = [rootId];
  return { nodes, rootId, mainLineIds, currentId: rootId };
}

// ------------------------------------------------------------------
// パース済み手順配列からムーブツリーを構築
// parsedMoves: [{ moveNumber, label, from, to, promote, dropPiece }]
// ------------------------------------------------------------------
export function buildTreeFromMoves(parsedMoves, initialPos = {}) {
  const nodes = {};
  const rootId = newId();
  const goteFirst = initialPos.goteFirst ?? false;
  let curBoard = initialPos.board ? copyBoard(initialPos.board) : createInitialBoard();
  let curHands = initialPos.hands ? copyHands(initialPos.hands) : createInitialHands();

  nodes[rootId] = {
    id: rootId, move: null, player: null, moveNumber: 0,
    board: copyBoard(curBoard), hands: copyHands(curHands),
    children: [], parentId: null,
    evalScore: null, isMainLine: true, label: '開始局面',
    moveFrom: null, moveTo: null,
  };

  const mainLineIds = [rootId];
  let prevId = rootId;
  let parseError = null;

  for (const mv of parsedMoves) {
    const player = goteFirst
      ? (mv.moveNumber % 2 === 1 ? 2 : 1)
      : (mv.moveNumber % 2 === 1 ? 1 : 2);
    const moveInfo = mv.dropPiece
      ? { from: null, to: mv.to, promote: false, piece: mv.dropPiece }
      : { from: mv.from, to: mv.to, promote: mv.promote };

    // 移動元に駒が存在するか事前チェック (存在しない = パースエラー or 盤面状態が壊れている)
    if (!mv.dropPiece && mv.from) {
      const [fr, fc] = mv.from;
      if (!curBoard[fr]?.[fc]) {
        console.error(`[KIF] ${mv.moveNumber}手目 「${mv.label}」: 移動元(${fr},${fc})に駒がありません — 読み込みを中断`);
        parseError = mv.moveNumber;
        break;
      }
    }

    const res = applyMove(curBoard, curHands, moveInfo, player);
    curBoard = res.board;
    curHands = res.hands;

    const id = newId();
    nodes[id] = {
      id, move: mv.label, player, moveNumber: mv.moveNumber,
      board: copyBoard(curBoard), hands: copyHands(curHands),
      children: [], parentId: prevId,
      evalScore: null, isMainLine: true, label: mv.label,
      moveFrom: mv.from ?? null,
      moveTo: mv.to,
      usedTime: mv.usedTime ?? null,
    };
    nodes[prevId].children.push(id);
    prevId = id;
    mainLineIds.push(id);
  }

  return { nodes, rootId, mainLineIds, currentId: mainLineIds[0], parseError };
}
