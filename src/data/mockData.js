// 将棋の駒の文字マッピング
export const PIECE_CHARS = {
  K: '王', k: '玉',
  R: '飛', r: '竜',
  B: '角', b: '馬',
  G: '金',
  S: '銀', s: '成銀',
  N: '桂', n: '成桂',
  L: '香', l: '成香',
  P: '歩', p: 'と',
  EMPTY: '',
};

// 初期盤面 (9x9) — 大文字=先手(下/南), 小文字=後手(上/北)
// 配列インデックス [row][col], row=0が後手陣9段目, row=8が先手陣1段目
export const INITIAL_BOARD = [
  ['L2','N2','S2','G2','K2','G2','S2','N2','L2'],
  [null,'R2',null,null,null,null,null,'B2',null],
  ['P2','P2','P2','P2','P2','P2','P2','P2','P2'],
  [null,null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null,null],
  ['P1','P1','P1','P1','P1','P1','P1','P1','P1'],
  [null,'B1',null,null,null,null,null,'R1',null],
  ['L1','N1','S1','G1','K1','G1','S1','N1','L1'],
];

// 各マスのデータ: { piece, player }
// player: 1=先手, 2=後手
export function parseBoardCell(code) {
  if (!code) return null;
  const player = parseInt(code.slice(-1));
  const piece = code.slice(0, -1);
  const pieceMap = {
    L: '香', N: '桂', S: '銀', G: '金', K: player === 1 ? '王' : '玉',
    B: '角', R: '飛', P: '歩',
  };
  return { piece: pieceMap[piece] || piece, player };
}

// 形勢グラフ用ダミーデータ (評価値 centipawn)
export const EVAL_HISTORY = [
  { move: 0,  eval: 0,    label: '開始' },
  { move: 1,  eval: 30,   label: '７六歩' },
  { move: 2,  eval: 10,   label: '３四歩' },
  { move: 3,  eval: 50,   label: '２六歩' },
  { move: 4,  eval: 20,   label: '８四歩' },
  { move: 5,  eval: 80,   label: '２五歩' },
  { move: 6,  eval: 40,   label: '８五歩' },
  { move: 7,  eval: 120,  label: '７八金' },
  { move: 8,  eval: 90,   label: '３二金' },
  { move: 9,  eval: 150,  label: '２四歩' },
  { move: 10, eval: 100,  label: '２四同歩' },
  { move: 11, eval: 220,  label: '２四同飛' },
  { move: 12, eval: 180,  label: '８六歩' },
  { move: 13, eval: 310,  label: '８六同歩' },
  { move: 14, eval: 260,  label: '８六同飛' },
  { move: 15, eval: 180,  label: '２三歩' },
  { move: 16, eval: 220,  label: '２三同金' },
  { move: 17, eval: 350,  label: '２三同飛成' },
  { move: 18, eval: 420,  label: '４二銀' },
  { move: 19, eval: 280,  label: '３三角' },
  { move: 20, eval: 380,  label: '８七歩' },
  { move: 21, eval: 500,  label: '７七角' },
  { move: 22, eval: 380,  label: '８八歩成' },
  { move: 23, eval: 480,  label: '８八同銀' },
  { move: 24, eval: 320,  label: '２二角成' },
  { move: 25, eval: 650,  label: '２二同銀' },
  { move: 26, eval: 580,  label: '５五角' },
  { move: 27, eval: 420,  label: '４四歩' },
  { move: 28, eval: 600,  label: '８二角成' },
  { move: 29, eval: 480,  label: '４五歩' },
  { move: 30, eval: 720,  label: '２三竜' },
];

// 現在の局面（30手目）
export const CURRENT_MOVE = 30;

// 現在の評価値
export const CURRENT_EVAL = 720;

// 候補手（読み筋）
export const CANDIDATE_MOVES = [
  {
    rank: 1,
    move: '３三銀',
    eval: 720,
    delta: 0,
    depth: 24,
    nodes: '1.2M',
    pv: '３三銀 ４二玉 ７三馬 ３三玉 ２三竜 ４四玉 ４五歩',
  },
  {
    rank: 2,
    move: '４二玉',
    eval: 540,
    delta: -180,
    depth: 24,
    nodes: '980K',
    pv: '４二玉 ３三銀 ３一玉 ２一竜 ４一金 ４三銀成',
  },
  {
    rank: 3,
    move: '４三銀',
    eval: 480,
    delta: -240,
    depth: 23,
    nodes: '750K',
    pv: '４三銀 ２一竜 ３二金 ７三馬 ４二玉 ５二金',
  },
  {
    rank: 4,
    move: '３二玉',
    eval: 310,
    delta: -410,
    depth: 22,
    nodes: '520K',
    pv: '３二玉 ２三竜 ４二玉 ５三銀 ４三玉 ４四歩',
  },
  {
    rank: 5,
    move: '６二銀',
    eval: 180,
    delta: -540,
    depth: 21,
    nodes: '380K',
    pv: '６二銀 ７三馬 ４五歩 ８二馬 ６三銀 ５五角',
  },
];

// 持駒ダミーデータ
export const HAND_PIECES = {
  sente: { 角: 1, 歩: 2 },
  gote:  { 銀: 1, 歩: 1 },
};
export const GAME_INFO = {
  sente: { name: '先手', mark: '▲', time: '' },
  gote:  { name: '後手', mark: '△', time: '' },
};
