// ============================================================
//  KIF / KIFU フォーマットパーサー
// ============================================================

const FILE_KAN = { '１':1,'２':2,'３':3,'４':4,'５':5,'６':6,'７':7,'８':8,'９':9 };
const RANK_KAN = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
const KANJI_TYPE = {
  '王':'K','玉':'K','飛':'R','竜':'+R','龍':'+R','角':'B','馬':'+B',
  '金':'G','銀':'S','全':'+S','仝':'+S','桂':'N','圭':'+N','香':'L','杏':'+L','歩':'P','と':'+P',
  // 「成X」2文字表記への対応 (chars[i]が'成'のとき次の文字で判定)
};

// ─── 持駒/盤面の漢字数字 ────────────────────────────────────
const NUM_KAN = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
const COUNT_KAN = ['','','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七','十八'];

function parseKanjiNum(str) {
  if (!str) return 1;
  if (str === '十') return 10;
  if (str.startsWith('十')) return 10 + (NUM_KAN[str[1]] || 0);
  return NUM_KAN[str] || 1;
}

// 持駒文字列 → { R: 2, B: 2, ... }
function parseHolding(str) {
  const hands = {};
  if (!str || /^なし/.test(str.trim())) return hands;
  for (const g of str.trim().split(/\s+/)) {
    if (!g) continue;
    const type = KANJI_TYPE[g[0]];
    if (!type) continue;
    const base = type.startsWith('+') ? type.slice(1) : type;
    hands[base] = parseKanjiNum(g.slice(1));
  }
  return hands;
}

// 盤面1行 "| ・ ・v玉 ・|一" → 9セルの配列
function parseBoardRow(line) {
  const m = line.match(/^\|(.*)\|[一二三四五六七八九]$/);
  if (!m) return null;
  const content = m[1];
  if ([...content].length !== 18) return null;
  const chars = [...content];
  const cells = [];
  for (let i = 0; i < 9; i++) {
    const prefix = chars[i * 2];
    const kanji  = chars[i * 2 + 1];
    if (kanji === '・') {
      cells.push(null);
    } else {
      const type = KANJI_TYPE[kanji];
      if (type) cells.push({ type, player: prefix === 'v' ? 2 : 1, promoted: type.startsWith('+') });
      else cells.push(null);
    }
  }
  return cells;
}

// 初期局面セクションを抽出（なければ null）
function extractInitialPosition(lines) {
  let goteIdx = -1, senteIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^後手の持駒[：:]/.test(lines[i].trim())) goteIdx = i;
    if (/^先手の持駒[：:]/.test(lines[i].trim())) { senteIdx = i; break; }
  }
  if (goteIdx < 0 || senteIdx < 0) return null;

  const goteHand  = parseHolding(lines[goteIdx].trim().replace(/^後手の持駒[：:]/, ''));
  const senteHand = parseHolding(lines[senteIdx].trim().replace(/^先手の持駒[：:]/, ''));

  const board = Array.from({ length: 9 }, () => Array(9).fill(null));
  let rowParsed = 0;
  for (let i = goteIdx + 1; i < senteIdx; i++) {
    const t = lines[i].trimEnd(); // 行頭の '|' を保持するため trimEnd のみ
    if (!t.trimStart().startsWith('|')) continue;
    const cells = parseBoardRow(t.trim());
    if (cells && rowParsed < 9) { board[rowParsed] = cells; rowParsed++; }
  }
  if (rowParsed !== 9) return null;
  return { board, hands: { 1: senteHand, 2: goteHand } };
}

// ─── 持駒 → KIF 表示文字列 ──────────────────────────────────
const HAND_ORDER  = ['R','B','G','S','N','L','P'];
const HAND_KANJI  = { R:'飛',B:'角',G:'金',S:'銀',N:'桂',L:'香',P:'歩' };
const BOARD_KANJI = {
  K:'玉', R:'飛','+R':'龍',B:'角','+B':'馬',
  G:'金',S:'銀','+S':'全',N:'桂','+N':'圭',L:'香','+L':'杏',P:'歩','+P':'と',
};

function handsToKIF(hands) {
  const parts = [];
  for (const t of HAND_ORDER) {
    const cnt = hands[t] || 0;
    if (cnt > 0) parts.push(`${HAND_KANJI[t]}${cnt === 1 ? '' : (COUNT_KAN[cnt] || String(cnt))}`);
  }
  return parts.length > 0 ? parts.join(' ') : 'なし';
}

// 盤面 + 持駒 → KIF ヘッダー行リスト（詰将棋KIF形式）
export function boardToKIFLines(board, hands) {
  const RANKS = ['一','二','三','四','五','六','七','八','九'];
  const SEP   = '+---------------------------+';
  const lines = [];
  lines.push(`後手の持駒：${handsToKIF(hands[2])} `);
  lines.push('  ９ ８ ７ ６ ５ ４ ３ ２ １');
  lines.push(SEP);
  for (let row = 0; row < 9; row++) {
    let s = '|';
    for (let col = 0; col < 9; col++) {
      const cell = board[row][col];
      if (!cell) { s += ' ・'; continue; }
      const prefix = cell.player === 2 ? 'v' : ' ';
      const kanji  = cell.type === 'K'
        ? (cell.player === 1 ? '王' : '玉')
        : (BOARD_KANJI[cell.type] || '？');
      s += prefix + kanji;
    }
    s += `|${RANKS[row]}`;
    lines.push(s);
  }
  lines.push(SEP);
  lines.push(`先手の持駒：${handsToKIF(hands[1])} `);
  return lines;
}
const DISP_FILES = '０１２３４５６７８９';
const DISP_RANKS = ['','一','二','三','四','五','六','七','八','九'];

// KIF coordinate (file 1-9, rank 1-9) → internal [row, col]
function kc(f, r) { return [r - 1, 9 - f]; }

function makeLabel(destFile, destRank, pieceKanji, promote, isDrop, isSame) {
  const dest = isSame ? '同　' : `${DISP_FILES[destFile] ?? '?'}${DISP_RANKS[destRank] ?? '?'}`;
  return `${dest}${pieceKanji}${promote ? '成' : ''}${isDrop ? '打' : ''}`;
}

// ─── KIF 1行をパース ────────────────────────────────────────
function parseMoveLineKIF(line, lastTo) {
  const m = line.match(/^(\d+)\s+(.+)/);
  if (!m) return null;
  const moveNum = parseInt(m[1]);
  let notation = m[2];

  // 終局 (投了・中断など) — ゲーム終了マーカー
  if (/^(投了|中断|千日手|持将棋|詰み|不詰|反則勝ち|反則負け|反則|切れ負け|入玉勝ち|不戦勝|不戦敗|中止|時間切れ)/.test(notation.trim())) {
    return { moveNumber: moveNum, isEnd: true };
  }

  // 移動元 (ab) を先に切り出す ← 時刻より前に来る
  const fromMatch = notation.match(/\((\d)(\d)\)/);
  // 消費時間を先に取得 (M:SS/HH:MM:SS) の左辺
  const timeMatch = notation.match(/\(\s*([0-9]+:[0-9]+)\s*\/[^)]*\)/);
  const usedTime = timeMatch ? timeMatch[1] : null;
  // 時刻情報・コメントを削除
  notation = notation
    .replace(/\([0-9:\/]+\).*$/, '')   // 時刻 (H:MM/HH:MM:SS)
    .replace(/T\d+$/, '')              // T+数字
    .replace(/\(\d\d\)\s*$/, '')       // 移動元 (再度)
    .trim();

  const chars = [...notation];
  let i = 0;

  // 移動先
  let destFile, destRank, toRow, toCol, isSame = false;
  if (chars[i] === '同') {
    if (!lastTo) return null;
    [toRow, toCol] = lastTo;
    isSame = true;
    i++;
    while (i < chars.length && (chars[i] === '　' || chars[i] === ' ')) i++;
  } else if (FILE_KAN[chars[i]] !== undefined) {
    destFile = FILE_KAN[chars[i]]; i++;
    destRank = RANK_KAN[chars[i]]; i++;
    if (!destFile || !destRank) return null;
    [toRow, toCol] = kc(destFile, destRank);
  } else {
    return null;
  }

  // 駒漢字 (1文字 or 「成X」2文字表記)
  // 成香・成桂・成銀は香桂銀が KANJI_TYPE に存在するため、undefined チェックでは検出できない
  const NARI_2CHAR = { '香':'+L', '桂':'+N', '銀':'+S' };
  let pieceKanji = chars[i]; i++;
  if (pieceKanji === '成' && NARI_2CHAR[chars[i]]) {
    // 「成香」「成桂」「成銀」などの2文字表記
    const pieceType2 = NARI_2CHAR[chars[i]];
    pieceKanji = '成' + chars[i]; i++;
    // promote は false (既に成り済み)
    const isDrop2 = chars[i] === '打';
    const dropPiece2 = isDrop2 ? pieceType2.replace('+', '') : null;
    let from2 = null;
    if (!isDrop2 && fromMatch) from2 = kc(parseInt(fromMatch[1]), parseInt(fromMatch[2]));
    return {
      moveNumber: moveNum,
      label: makeLabel(destFile, destRank, pieceKanji, false, isDrop2, isSame),
      from: from2, to: [toRow, toCol], promote: false, dropPiece: dropPiece2, usedTime, isEnd: false,
    };
  }
  const pieceType = KANJI_TYPE[pieceKanji];
  if (!pieceType) return null;

  // 成
  const promote = chars[i] === '成';
  if (promote) i++;

  // 打
  const isDrop = chars[i] === '打';
  const dropPiece = isDrop ? pieceType.replace('+', '') : null;

  // 移動元
  let from = null;
  if (!isDrop && fromMatch) {
    from = kc(parseInt(fromMatch[1]), parseInt(fromMatch[2]));
  }

  return {
    moveNumber: moveNum,
    label: makeLabel(destFile, destRank, pieceKanji, promote, isDrop, isSame),
    from,
    to: [toRow, toCol],
    promote,
    dropPiece,
    usedTime,
    isEnd: false,
  };
}

// ─── CSA フォーマット 1行パース ─────────────────────────────
const CSA_TYPE = {
  'FU':'P','KY':'L','KE':'N','GI':'S','KI':'G','KA':'B','HI':'R',
  'OU':'K','TO':'+P','NY':'+L','NK':'+N','NG':'+S','UM':'+B','RY':'+R',
};

function parseMoveLineCSA(line, moveNum) {
  // +7776FU or -3334FU
  const m = line.match(/^([+-])(\d)(\d)(\d)(\d)([A-Z]{2})/);
  if (!m) return null;
  const player = m[1] === '+' ? 1 : 2;
  const fromFile = parseInt(m[2]), fromRank = parseInt(m[3]);
  const toFile   = parseInt(m[4]), toRank   = parseInt(m[5]);
  const csa = m[6];
  const pieceType = CSA_TYPE[csa];
  if (!pieceType) return null;

  const isDrop = fromFile === 0 && fromRank === 0;
  const from   = isDrop ? null : kc(fromFile, fromRank);
  const to     = kc(toFile, toRank);
  const promote = !isDrop && csa !== m[6].replace(/^(TO|NY|NK|NG|UM|RY)$/, m[6]);

  // 簡易ラベル
  const destF = DISP_FILES[toFile] ?? '?';
  const destR = DISP_RANKS[toRank] ?? '?';
  const kanjiMap = {
    'P':'歩','L':'香','N':'桂','S':'銀','G':'金','B':'角','R':'飛','K':'王',
    '+P':'と','+L':'杏','+N':'圭','+S':'全','+B':'馬','+R':'竜',
  };
  const label = `${destF}${destR}${kanjiMap[pieceType] ?? csa}${isDrop ? '打' : ''}`;

  return {
    moveNumber: moveNum,
    label,
    from,
    to,
    promote: false, // CSA encodes promoted piece type directly
    dropPiece: isDrop ? pieceType.replace('+', '') : null,
    isEnd: false,
  };
}

// ─── ** コメント行から候補手データをパース ─────────────────
function parseCandidateComment(line) {
  const rankM = line.match(/候補(\d+)/);
  if (!rankM) return null;
  const depthM = line.match(/深さ\s+(\d+)/);
  const nodesM = line.match(/ノード数\s+(\d+)/);
  const evalM  = line.match(/評価値\s+(詰[-+]?\d+|[-+]?\d+)/);
  const pvM    = line.match(/読み筋\s+(.+)$/);
  const scoreStr = evalM ? evalM[1] : null;
  let score = 0, isMate = false, mateIn = null;
  if (scoreStr) {
    if (scoreStr.startsWith('詰')) {
      isMate = true;
      mateIn = parseInt(scoreStr.slice(1)) || 0;
      score  = mateIn > 0 ? 32000 : -32000;
    } else {
      score = parseInt(scoreStr) || 0;
    }
  }
  return {
    multipv: parseInt(rankM[1]),
    depth:   depthM ? parseInt(depthM[1]) : null,
    nodes:   nodesM ? parseInt(nodesM[1]) : null,
    score, isMate, mateIn,
    pvJP: pvM ? pvM[1].trim() : '',
  };
}

// ─── メインパーサー ─────────────────────────────────────────
export function parseKIF(text) {
  const lines = text.split(/\r?\n/);
  const moves = [];
  const gameInfo = {};
  let lastTo = null;
  let csaMoveNum = 1;
  const pendingCandidates = [];
  const isCsa = lines.some(l => /^PI/.test(l) || /^[+-]\d{4}[A-Z]{2}/.test(l));

  // 初期局面セクション（詰将棋KIF等）
  const initialPos = extractInitialPosition(lines);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith("'")) continue;

    // ── * コメント行（** は候補手データを抽出、それ以外は読み飛ばす） ──
    if (line.startsWith('*')) {
      if (line.startsWith('**')) {
        const cand = parseCandidateComment(line);
        if (cand) pendingCandidates.push(cand);
      }
      continue;
    }

    // ── ヘッダー情報 ──
    if (/^先手[：:]/.test(line) || /^下手[：:]/.test(line)) {
      gameInfo.senteName = line.replace(/^(先手|下手)[：:]/, '').trim();
    } else if (/^後手[：:]/.test(line) || /^上手[：:]/.test(line)) {
      gameInfo.goteName = line.replace(/^(後手|上手)[：:]/, '').trim();
    } else if (/^手合割[：:]/.test(line)) {
      gameInfo.handicap = line.replace(/^手合割[：:]/, '').trim();
    } else if (/^後手番$/.test(line)) {
      gameInfo.goteFirst = true;
    } else if (/^開始日時[：:]/.test(line)) {
      gameInfo.startTime = line.replace(/^開始日時[：:]/, '').trim();
    } else if (/^終了日時[：:]/.test(line)) {
      gameInfo.endTime = line.replace(/^終了日時[：:]/, '').trim();
    } else if (/^棋戦[：:]/.test(line)) {
      gameInfo.event = line.replace(/^棋戦[：:]/, '').trim();
    } else if (/^戦型[：:]/.test(line)) {
      gameInfo.opening = line.replace(/^戦型[：:]/, '').trim();
    } else if (/^表題[：:]/.test(line)) {
      gameInfo.title = line.replace(/^表題[：:]/, '').trim();
    } else if (/^持ち時間[：:]/.test(line)) {
      gameInfo.timeControl = line.replace(/^持ち時間[：:]/, '').trim();
    } else if (/^秒読み[：:]/.test(line)) {
      gameInfo.byoyomi = line.replace(/^秒読み[：:]/, '').trim();
    } else if (/^消費時間[：:]/.test(line)) {
      gameInfo.timeUsed = line.replace(/^消費時間[：:]/, '').trim();
    } else if (/^場所[：:]/.test(line)) {
      gameInfo.site = line.replace(/^場所[：:]/, '').trim();
    } else if (/^掲載[：:]/.test(line)) {
      gameInfo.source = line.replace(/^掲載[：:]/, '').trim();
    } else if (/^備考[：:]/.test(line)) {
      gameInfo.note = line.replace(/^備考[：:]/, '').trim();
    }

    // ── CSA フォーマット ──
    if (isCsa && /^[+-]\d{4}[A-Z]{2}/.test(line)) {
      const mv = parseMoveLineCSA(line, csaMoveNum++);
      if (mv) { moves.push(mv); lastTo = mv.to; }
      pendingCandidates.length = 0;
      continue;
    }
    if (isCsa && (/^%/.test(line) || /^T/.test(line))) continue;

    // ── KIF フォーマット ──
    if (!isCsa && /^\d+\s/.test(line)) {
      const mv = parseMoveLineKIF(line, lastTo);
      if (!mv) { pendingCandidates.length = 0; continue; }
      if (mv.isEnd) break;
      if (pendingCandidates.length > 0) {
        mv.preCandidates = [...pendingCandidates];
        pendingCandidates.length = 0;
      }
      moves.push(mv);
      lastTo = mv.to;
    }
  }

  return {
    moves,
    gameInfo,
    initialBoard: initialPos?.board ?? null,
    initialHands: initialPos?.hands ?? null,
    goteFirst: gameInfo.goteFirst ?? false,
  };
}

// ─── テキストがKIF/CSAっぽいか判定 ────────────────────────
export function looksLikeKIF(text) {
  return /^\s*\d+\s+[１-９]/m.test(text) ||
    text.includes('手合割') ||
    text.includes('先手：') ||
    text.includes('後手：') ||
    text.includes('上手：') ||
    text.includes('下手：') ||
    text.includes('先手の持駒') ||
    text.includes('後手の持駒') ||
    /^[+-]\d{4}[A-Z]{2}/m.test(text);
}

// ─── バイナリから文字コードを自動判定してテキスト化 ────────
export function decodeKIFBuffer(buffer) {
  // まず UTF-8 で試みる
  let text = new TextDecoder('utf-8').decode(buffer);
  // KIF 漢字が含まれていれば OK
  if (/[歩飛角金銀桂香王玉]/.test(text)) return text;
  // Shift-JIS で再試行
  try {
    text = new TextDecoder('shift-jis').decode(buffer);
    if (/[歩飛角金銀桂香王玉]/.test(text)) return text;
  } catch { /* shift-jis not supported in some envs */ }
  // フォールバック: UTF-8 のまま返す
  return new TextDecoder('utf-8').decode(buffer);
}
