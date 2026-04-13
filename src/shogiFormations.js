// ============================================================
//  将棋局面における囲い・戦型の自動検出
//  board[row][col]: row 0=1段, row 8=9段, col 0=9筋, col 8=1筋
//  ※ 先手(player1)の囲い・戦型のみを返す
// ============================================================

// 読み上げ用ふりがなマップ
export const FORMATION_READINGS = {
  '穴熊':           'あなぐま',
  '矢倉囲い':       'やぐらがこい',
  '金無双':         'きんむそう',
  'ミレニアム':     'みれにあむ',
  '銀冠':           'ぎんかんむり',
  '天守閣美濃':     'てんしゅかくみの',
  'エルモ囲い':     'えるもがこい',
  '高美濃':         'たかみの',
  '本美濃囲い':     'ほんみのがこい',
  '雁木囲い':       'がんぎがこい',
  'カニ囲い':       'かにがこい',
  '中住まい':       'なかずまい',
  '舟囲い':         'ふながこい',
  '左美濃':         'ひだりみの',
  '四間飛車':       'しけんびしゃ',
  '三間飛車':       'さんけんびしゃ',
  '石田流':         'いしだりゅう',
  '中飛車':         'なかびしゃ',
  'ゴキゲン中飛車': 'ごきげんなかびしゃ',
  '向かい飛車':     'むかいびしゃ',
  '端飛車':         'はしびしゃ',
  '右四間飛車':     'みぎしけんびしゃ',
  '袖飛車':         'そでびしゃ',
  '相振り飛車':     'あいふりびしゃ',
  '相掛かり':       'あいがかり',
  '角換わり':       'かくがわり',
  '棒銀':           'ぼうぎん',
  '早繰り銀':       'はやぐりぎん',
  '腰掛け銀':       'こしかけぎん',
};

// ── ユーティリティ ────────────────────────────────────────────────────

function has(board, r, c, types, player) {
  if (r < 0 || r > 8 || c < 0 || c > 8) return false;
  const p = board[r][c];
  if (!p || p.player !== player) return false;
  return Array.isArray(types) ? types.includes(p.type) : p.type === types;
}

// player1 視点の正規化座標（player2 は 180度反転）
function norm(r, c, player) {
  return player === 1 ? [r, c] : [8 - r, 8 - c];
}

function hasN(board, r, c, types, player) {
  const [nr, nc] = norm(r, c, player);
  return has(board, nr, nc, types, player);
}

// 王の正規化座標を返す（player1 視点）
function findKingNorm(board, player) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && p.player === player && p.type === 'K')
        return norm(r, c, player);
    }
  return null;
}

// 飛車（未成）の位置を返す
function findRookPos(board, player) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && p.player === player && p.type === 'R') return [r, c];
    }
  return null;
}

// ── 囲い検出（先手 player1 のみ） ────────────────────────────────────
function detectCastle(board) {
  return;
  const player = 1;
  const rookPos = findRookPos(board, player);
  // 振り飛車判定: 先手飛車の初期位置は 2八 = col7
  const isFuribisha = rookPos !== null && rookPos[1] !== 7;

  const king = findKingNorm(board, player);
  if (!king) return null;
  const [kr, kc] = king;

  // 初期位置(5九 = row8,col4)から動いていなければ囲いなし
  if (kr === 8 && kc === 4) return null;

  const GS = ['G', 'S'];

  // ── 穴熊: 玉が端一列に潜る ─────────────────────────────────────────
  // 9九(r8,c0) / 9八(r7,c0) / 1九(r8,c8) / 1八(r7,c8)
  if (kr >= 7 && (kc === 0 || kc === 8)) return '穴熊';

  // ── 玉 8八(r7,c1) 系 ─────────────────────────────────────────────
  if (kr === 7 && kc === 1) {
    const sv77 = hasN(board, 6, 2, 'S', player);   // 銀7七
    const g78  = hasN(board, 7, 2, 'G', player);   // 金7八
    const g69  = hasN(board, 8, 3, 'G', player);   // 金6九
    const g79  = hasN(board, 8, 2, 'G', player);   // 金7九
    const sv79 = hasN(board, 8, 2, 'S', player);   // 銀7九
    const n77  = hasN(board, 6, 2, 'N', player);   // 桂7七
    // 矢倉: 銀7七 + 金(7八 or 6九)
    if (sv77 && (g78 || g69)) return '矢倉囲い';
    // 金無双: 金7九 + 金7八
    if (g79 && g78) return '金無双';
    // ミレニアム: 銀7九 + 桂7七
    if (sv79 && n77) return 'ミレニアム';
  }

  // ── 玉 8九(r8,c1) 系 ─────────────────────────────────────────────
  if (kr === 8 && kc === 1) {
    const g79  = hasN(board, 8, 2, 'G', player);   // 金7九
    const g88  = hasN(board, 7, 1, 'G', player);   // 金8八
    const sv88 = hasN(board, 7, 1, 'S', player);   // 銀8八
    const n77  = hasN(board, 6, 2, 'N', player);   // 桂7七
    // 金無双: 金7九 + 金8八
    if (g79 && g88) return '金無双';
    // ミレニアム(一段目形): 銀8八 + 桂7七
    if (sv88 && n77) return 'ミレニアム';
  }

  // ── 銀冠: 玉 7七(r6,c2) ─────────────────────────────────────────
  if (kr === 6 && kc === 2) {
    if (hasN(board, 6, 3, 'S', player) || hasN(board, 5, 3, 'S', player)) return '銀冠';
  }

  // ── 天守閣美濃: 振り飛車専用・玉が5段目以上(r<=4) ─────────────────
  if (isFuribisha && kr <= 4 && kc >= 1 && kc <= 3) {
    if (hasN(board, 7, 3, 'G', player) || hasN(board, 7, 2, 'G', player)) return '天守閣美濃';
  }

  // ── 玉 7八(r7,c2) 系 ─────────────────────────────────────────────
  if (kr === 7 && kc === 2) {
    const g68  = hasN(board, 7, 3, 'G', player);   // 金6八
    const g58  = hasN(board, 7, 4, 'G', player);   // 金5八
    const sv68 = hasN(board, 7, 3, 'S', player);   // 銀6八
    const sv67 = hasN(board, 6, 3, 'S', player);   // 銀6七
    const sv57 = hasN(board, 6, 4, 'S', player);   // 銀5七
    const g88  = hasN(board, 7, 1, 'G', player);   // 金8八
    // エルモ囲い: 銀6八 + 金5九(r8,c4)
    if (sv68 && hasN(board, 8, 4, 'G', player)) return 'エルモ囲い';
    // 高美濃: 金5八 + 銀6七
    if (g58 && sv67) return '高美濃';
    // 本美濃: 金6八 + 銀(5七 or 6七)
    if (g68 && (sv57 || sv67)) return '本美濃囲い';
    // 雁木: 金銀が5〜6段目に前進展開
    if ((g68 || g58) && hasN(board, 6, 4, GS, player) && hasN(board, 6, 5, GS, player)) return '雁木囲い';
    // カニ囲い: 金8八 + 金(6八 or 5八) ― 矢倉への過渡形
    if (g88 && (g68 || g58)) return 'カニ囲い';
  }

  // ── 雁木囲い: 玉 6八(r7,c3) ─────────────────────────────────────
  if (kr === 7 && kc === 3) {
    if (hasN(board, 6, 3, GS, player) && hasN(board, 6, 4, GS, player)) return '雁木囲い';
    if (hasN(board, 7, 2, 'G', player)) return '舟囲い';
  }

  // ── 舟囲い: 玉 6九(r8,c3) ───────────────────────────────────────
  if (kr === 8 && kc === 3) {
    if (hasN(board, 7, 2, 'G', player) || hasN(board, 7, 4, 'G', player) || hasN(board, 8, 4, 'G', player))
      return '舟囲い';
  }

  // ── 左美濃: 居飛車専用 ─── 振り飛車時は絶対に検出しない ─────────────
  // 玉が kr>=7 かつ kc=5〜7 (3〜1筋側)
  // 金が4八(r7,c5)にいて、かつ銀か金が隣接していること
  if (!isFuribisha && kr >= 7 && kc >= 5 && kc <= 7) {
    if (hasN(board, 7, 5, 'G', player) &&
        (hasN(board, 7, 6, GS, player) || hasN(board, 6, 5, 'S', player)))
      return '左美濃';
  }

  // ── 中住まい: 居飛車専用・玉 5八(r7,c4) ─────────────────────────
  if (!isFuribisha && kr === 7 && kc === 4) return '中住まい';

  return null;
}

// ── 戦型検出（先手 player1 のみ） ────────────────────────────────────
function detectStrategies(board, hands) {
  const results = [];
  const r1 = findRookPos(board, 1);
  const r2 = findRookPos(board, 2);

  const p1Col = r1 ? r1[1] : null;
  const p2Col = r2 ? r2[1] : null;

  // 先手飛車の初期位置: 2八 = col7  後手飛車の初期位置: 8二 = col1
  const p1Moved = p1Col !== null && p1Col !== 7;
  const p2Moved = p2Col !== null && p2Col !== 1;

  // ── 先手振り飛車系 ──────────────────────────────────────────────
  if (p1Moved) {
    if (p1Col === 3) {
      results.push('四間飛車');
    } else if (p1Col === 2) {
      // 石田流: 7六歩(row5,col2) + 7五歩(row4,col2) 両方揃った完成形
      if (has(board, 5, 2, 'P', 1) && has(board, 4, 2, 'P', 1))
        results.push('石田流');
      else
        results.push('三間飛車');
    } else if (p1Col === 4) {
      results.push('中飛車');
    } else if (p1Col === 1) {
      results.push('向かい飛車');
    } else if (p1Col === 0) {
      results.push('端飛車');
    } else if (p1Col === 5) {
      results.push('右四間飛車');
    } else if (p1Col === 6) {
      results.push('袖飛車');
    }
    // 相振り飛車: 後手も振り飛車域 (col>=4) に振っている
    if (p2Moved && p1Col <= 4 && p2Col >= 4) results.push('相振り飛車');
    return results; // 振り飛車中は居飛車系戦術を検出しない
  }

  // ── 先手居飛車系（飛車が 2八=col7 にある場合のみ） ──────────────────

  // 相掛かり: 先手2五歩(row4,col7) AND 後手8五歩(row4,col1) が両方揃った形
  if (!p2Moved && has(board, 4, 7, 'P', 1) && has(board, 4, 1, 'P', 2))
    results.push('相掛かり');

  // 角換わり: 両者の角が初期位置になく、いずれかの手駒に角がある
  const p1BishopGone = !has(board, 7, 1, 'B', 1);
  const p2BishopGone = !has(board, 1, 7, 'B', 2);
  const bishopsInHand = (hands[1]?.['B'] || 0) + (hands[2]?.['B'] || 0) > 0;
  if (p1BishopGone && p2BishopGone && bishopsInHand) results.push('角換わり');

  // 棒銀: 銀が2筋(col7)を 2五(row4) または 2四(row3) まで前進
  if (has(board, 4, 7, 'S', 1) || has(board, 3, 7, 'S', 1)) results.push('棒銀');

  // 早繰り銀: 銀が 4六(row5,col5) に到達（斜め前進の完成形）
  if (has(board, 5, 5, 'S', 1)) results.push('早繰り銀');

  // 腰掛け銀: 銀が 5六(row5,col4) に据わっている
  // 棒銀・早繰り銀が未検出のときのみ
  if (has(board, 5, 4, 'S', 1) && !results.includes('棒銀') && !results.includes('早繰り銀'))
    results.push('腰掛け銀');

  return results;
}

// ── 公開 API ──────────────────────────────────────────────────────────
// 先手(player1)の囲いと戦型を重複なしで返す
export function detectFormations(board, hands) {
  if (!board || !hands) return [];
  const seen = new Set();
  const add = (name) => { if (name) seen.add(name); };

  // 囲い: 先手のみ
  add(detectCastle(board));

  // 戦型: 先手のみ
  for (const s of detectStrategies(board, hands)) seen.add(s);

  return [...seen];
}