import { useState, useCallback, useEffect } from 'react';
import { X, BarChart3, Loader2, AlertCircle, CheckSquare, Square, TrendingUp, RefreshCw } from 'lucide-react';
import { parseKIF } from '../parsers/kifParser';
import { buildTreeFromMoves } from '../state/gameState';

// ── 定数 ────────────────────────────────────────────────────────────
const PHASE_DEFS = [
  { key: 'opening', label: '序盤', colorBg: 'bg-blue-900/30',   colorBorder: 'border-blue-700/50',   colorText: 'text-blue-300',   colorDot: 'bg-blue-400' },
  { key: 'midgame', label: '中盤', colorBg: 'bg-yellow-900/30', colorBorder: 'border-yellow-700/50', colorText: 'text-yellow-300', colorDot: 'bg-yellow-400' },
  { key: 'endgame', label: '終盤', colorBg: 'bg-red-900/30',    colorBorder: 'border-red-700/50',    colorText: 'text-red-300',    colorDot: 'bg-red-400' },
];
const BLUNDER    = 500;
const MISTAKE    = 300;
const INACCURACY = 100;
const MAX_SELECT = 30;

// ── 非歩駒が手駒にあるか（駒交換発生の判定）────────────────────────
const NON_PAWN = ['R', 'B', 'G', 'S', 'N', 'L'];
function hasNonPawnInHand(hands) {
  return NON_PAWN.some(p => (hands?.[1]?.[p] || 0) + (hands?.[2]?.[p] || 0) > 0);
}

// ── フェーズ判定 ─────────────────────────────────────────────────────
function detectPhase(moveNum, cand, hands) {
  // 終盤: |評価値| >= 2000 OR 詰み手数が短い（15手以内）
  if (cand.isMate && cand.mateIn !== null && Math.abs(cand.mateIn) <= 15) return 'endgame';
  if (Math.abs(cand.score) >= 2000) return 'endgame';
  // 序盤: 40手未満 かつ 非歩の駒交換なし
  if (moveNum < 40 && !hasNonPawnInHand(hands)) return 'opening';
  // それ以外は中盤
  return 'midgame';
}

// ── KIF から CPL を抽出 ──────────────────────────────────────────────
function extractCpls(content, playerSide) {
  let parsed;
  try { parsed = parseKIF(content); } catch { return []; }
  const { moves } = parsed;
  if (moves.length < 2) return [];

  // 手駒取得のためにツリーを構築
  let tree;
  try {
    tree = buildTreeFromMoves(moves, {
      board: parsed.initialBoard,
      hands: parsed.initialHands,
      goteFirst: parsed.goteFirst ?? false,
    });
  } catch { tree = null; }

  const result = [];
  for (let i = 0; i < moves.length - 1; i++) {
    const mv = moves[i], next = moves[i + 1];
    if (!mv.preCandidates?.length || !next.preCandidates?.length) continue;

    const cand     = mv.preCandidates[0];
    const candNext = next.preCandidates[0];
    // 詰みの局面は CPL が不定なのでスキップ
    if (cand.isMate || candNext.isMate) continue;

    const evalBefore = cand.score;
    const evalAfter  = candNext.score;
    const moveNum    = mv.moveNumber;           // 1-indexed
    const player     = moveNum % 2 === 1 ? 1 : 2;
    if (playerSide !== 0 && player !== playerSide) continue;

    const cpl = player === 1
      ? Math.max(0, evalBefore - evalAfter)
      : Math.max(0, evalAfter  - evalBefore);

    // フェーズ: 手を指す直前の局面（mainLineIds[i] = i手目の局面）の手駒を参照
    const nodeHands = tree?.nodes?.[tree.mainLineIds?.[i]]?.hands ?? null;
    const phase = detectPhase(moveNum, cand, nodeHands);

    result.push({ moveNum, player, cpl, phase });
  }
  return result;
}

// ── 集計 ────────────────────────────────────────────────────────────
function aggregate(cpls) {
  const phaseStats = {};
  for (const ph of PHASE_DEFS) {
    const pc = cpls.filter(c => c.phase === ph.key);
    const moveNums = pc.map(c => c.moveNum);
    phaseStats[ph.key] = {
      count:      pc.length,
      blunder:    pc.filter(c => c.cpl >= BLUNDER).length,
      mistake:    pc.filter(c => c.cpl >= MISTAKE   && c.cpl < BLUNDER).length,
      inaccuracy: pc.filter(c => c.cpl >= INACCURACY && c.cpl < MISTAKE).length,
      avgCpl:     pc.length ? Math.round(pc.reduce((s, c) => s + c.cpl, 0) / pc.length) : null,
      minMove:    moveNums.length ? Math.min(...moveNums) : null,
      maxMove:    moveNums.length ? Math.max(...moveNums) : null,
    };
  }
  const allAvg = cpls.length ? Math.round(cpls.reduce((s, c) => s + c.cpl, 0) / cpls.length) : null;
  const accuracy = allAvg !== null
    ? Math.max(0, Math.min(100, Math.round(100 * Math.exp(-allAvg / 400)))) : null;
  return {
    phaseStats,
    totalMoves:   cpls.length,
    totalBlunder: cpls.filter(c => c.cpl >= BLUNDER).length,
    totalMistake: cpls.filter(c => c.cpl >= MISTAKE && c.cpl < BLUNDER).length,
    avgCpl: allAvg, accuracy,
  };
}

// ── 精度メーター ─────────────────────────────────────────────────────
function AccuracyMeter({ value }) {
  if (value === null) return null;
  const color = value >= 80 ? '#22c55e' : value >= 60 ? '#eab308' : value >= 40 ? '#f97316' : '#ef4444';
  const r = 30, cx = 38, cy = 38, stroke = 8;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="76" height="76" viewBox="0 0 76 76">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#374151" strokeWidth={stroke} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ / 4} strokeLinecap="round" />
        <text x={cx} y={cy + 5} textAnchor="middle" fill={color} fontSize="16" fontWeight="bold">{value}</text>
      </svg>
      <span className="text-xs text-gray-400">精度</span>
    </div>
  );
}

// ── フェーズ行（横長・モバイル向け） ────────────────────────────────
function PhaseRow({ def, stats }) {
  const hasData = stats && stats.count > 0;
  const rangeSub = hasData && stats.minMove !== null
    ? stats.minMove === stats.maxMove
      ? `${stats.minMove}手`
      : `${stats.minMove}〜${stats.maxMove}手`
    : null;
  return (
    <div className={`rounded-xl px-3 py-2.5 border ${def.colorBg} ${def.colorBorder}`}>
      {/* ヘッダー行 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${def.colorDot}`} />
          <span className={`font-bold text-sm ${def.colorText}`}>{def.label}</span>
          {rangeSub && <span className="text-xs text-gray-500">{rangeSub}</span>}
        </div>
        {hasData && stats.avgCpl !== null && (
          <span className={`text-xs font-bold ${stats.avgCpl >= BLUNDER ? 'text-red-400' : stats.avgCpl >= MISTAKE ? 'text-orange-400' : 'text-gray-300'}`}>
            平均{stats.avgCpl}cp
          </span>
        )}
      </div>
      {/* コンテンツ */}
      {!hasData ? (
        <p className="text-xs text-gray-500">評価値データなし</p>
      ) : (
        <div className="flex gap-3">
          {/* バーチャート */}
          <div className="flex-1 space-y-1.5">
            {[
              { label: '悪手',  count: stats.blunder,    color: 'bg-red-500' },
              { label: '疑問手', count: stats.mistake,    color: 'bg-orange-500' },
              { label: '緩手',  count: stats.inaccuracy, color: 'bg-yellow-500' },
            ].map(({ label, count, color }) => {
              const maxVal = Math.max(stats.blunder + stats.mistake + stats.inaccuracy, 1);
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-9 shrink-0">{label}</span>
                  <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                    <div className={`${color} h-1.5 rounded-full`} style={{ width: `${(count / maxVal) * 100}%` }} />
                  </div>
                  <span className="text-xs font-bold text-white w-4 text-right">{count}</span>
                </div>
              );
            })}
          </div>
          {/* 合計ミス数 */}
          <div className="flex flex-col items-center justify-center bg-gray-700/40 rounded-lg px-3 shrink-0">
            <span className="text-lg font-bold text-white leading-none">
              {stats.blunder + stats.mistake}
            </span>
            <span className="text-xs text-gray-400">ミス</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── メインコンポーネント ─────────────────────────────────────────────
export default function WeaknessAnalysisDialog({ onClose, authToken, apiBase }) {
  const [kifList,      setKifList]      = useState(null);
  const [loadingList,  setLoadingList]  = useState(false);
  const [selected,     setSelected]     = useState(new Set());
  const [sideMap,      setSideMap]      = useState({});   // id → 1=先手 2=後手（未設定=null）
  const [analyzing,    setAnalyzing]    = useState(false);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState('');
  const [gameResults,  setGameResults]  = useState([]);

  const hdrs = () => ({
    Authorization: `Bearer ${authToken}`,
    ...(authToken === '__local__' ? { 'X-Guest-Id': localStorage.getItem('guestId') || '' } : {}),
  });

  const fetchList = useCallback(async () => {
    setLoadingList(true); setError('');
    try {
      const res = await fetch(`${apiBase}/api/kif`, { headers: hdrs() });
      const data = await res.json();
      setKifList(data.ok ? data.kifs : []);
    } catch { setError('棋譜一覧の取得に失敗しました'); setKifList([]); }
    finally { setLoadingList(false); }
  }, [authToken, apiBase]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_SELECT) next.add(id);
    return next;
  });

  const toggleSide = (id, e) => {
    e.stopPropagation();
    setSideMap(prev => ({ ...prev, [id]: prev[id] === 1 ? 2 : 1 }));
  };

  const setAllSides = (v) => setSideMap(prev => {
    const next = { ...prev };
    selected.forEach(id => { next[id] = v; });
    return next;
  });

  const handleAnalyze = useCallback(async () => {
    if (!selected.size) return;
    setAnalyzing(true); setError(''); setResult(null); setGameResults([]);
    const allCpls = [], perGame = [];
    for (const id of selected) {
      try {
        const res = await fetch(`${apiBase}/api/kif/${id}`, { headers: hdrs() });
        const data = await res.json();
        if (!data.ok) continue;
        const side = sideMap[id] ?? 1;
        const cpls = extractCpls(data.kif.content, side);
        allCpls.push(...cpls);
        const title = kifList?.find(k => k.id === id)?.title ?? '無題';
        perGame.push({ id, title, stats: aggregate(cpls), moveCount: cpls.length, side });
      } catch { /* skip */ }
    }
    if (!allCpls.length) {
      setError('選択した棋譜に評価値データがありません。検討モードで解析後に「評価値付きで保存」した棋譜を選んでください。');
    } else {
      setResult(aggregate(allCpls));
      setGameResults(perGame.filter(g => g.moveCount > 0));
    }
    setAnalyzing(false);
  }, [selected, sideMap, apiBase, authToken, kifList]);

  const noKifs = kifList !== null && kifList.length === 0;
  const showResult = !!result;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg h-[92vh] sm:max-h-[92vh] flex flex-col overflow-hidden">

        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <BarChart3 size={17} className="text-purple-400" />
            <span className="font-bold text-white">弱点分析</span>
            {showResult && (
              <button onClick={() => setResult(null)}
                className="ml-1 text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded-lg hover:bg-gray-700">
                ← 棋譜選択
              </button>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* ── 棋譜選択画面 ── */}
        {!showResult && (
          <>
            {/* 列ヘッダー */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700/50 shrink-0">
              <span className="flex-1 text-xs text-gray-500">棋譜</span>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={fetchList} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded-lg hover:bg-gray-700">
                  <RefreshCw size={11} />
                </button>
                <span className="text-xs text-gray-500 w-14 text-center">自分の手番</span>
              </div>
            </div>

            {/* リスト（flex-1 で残り全部） */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {loadingList ? (
                <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
              ) : noKifs ? (
                <p className="text-center py-10 text-gray-500 text-sm px-6">
                  クラウドに保存された棋譜がありません。<br />検討後に「評価値付きで保存」すると表示されます。
                </p>
              ) : kifList ? (
                kifList.map(kif => {
                  const isSel = selected.has(kif.id);
                  return (
                    <div key={kif.id}
                      className={`flex items-center gap-2 px-4 py-3 border-b border-gray-700/40 last:border-0 transition-colors
                        ${isSel ? 'bg-purple-900/20' : 'active:bg-gray-800'}`}>
                      <button onClick={() => toggleSelect(kif.id)} className="shrink-0 p-0.5">
                        {isSel
                          ? <CheckSquare size={18} className="text-purple-400" />
                          : <Square      size={18} className="text-gray-500" />}
                      </button>
                      <button onClick={() => toggleSelect(kif.id)} className="flex-1 text-left min-w-0 py-0.5">
                        <span className="text-sm text-gray-200 truncate block leading-snug">{kif.title || '無題'}</span>
                        <span className="text-xs text-gray-500">
                          {new Date(kif.created_at * 1000).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                        </span>
                      </button>
                      {isSel ? (
                        <button onClick={(e) => toggleSide(kif.id, e)}
                          className={`shrink-0 w-14 py-1.5 rounded-lg text-xs font-bold transition-colors
                            ${(sideMap[kif.id] ?? 1) === 1 ? 'bg-blue-600 text-white' : 'bg-red-700 text-white'}`}>
                          {(sideMap[kif.id] ?? 1) === 1 ? '▲先手' : '△後手'}
                        </button>
                      ) : (
                        <span className="shrink-0 w-14" />
                      )}
                    </div>
                  );
                })
              ) : null}
            </div>

            {/* フッター固定 */}
            <div className="shrink-0 border-t border-gray-700 px-4 py-3 flex flex-col gap-2">
              {selected.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 shrink-0">{selected.size}件 まとめて:</span>
                  <button onClick={() => setAllSides(1)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">
                    ▲先手
                  </button>
                  <button onClick={() => setAllSides(2)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white font-semibold transition-colors">
                    △後手
                  </button>
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-900/40 border border-red-700/50 text-red-300">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="text-xs leading-relaxed">{error}</span>
                </div>
              )}
              <button onClick={handleAnalyze} disabled={!selected.size || analyzing}
                className="w-full py-3 rounded-xl font-bold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors">
                {analyzing
                  ? <><Loader2 size={16} className="animate-spin" />分析中...</>
                  : <><TrendingUp size={16} />{selected.size > 0 ? `${selected.size}件を分析する` : '棋譜を選んでください'}</>}
              </button>
            </div>
          </>
        )}

        {/* ── 結果画面 ── */}
        {showResult && (
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3 min-h-0">

          {/* 結果 */}
          {result && (
            <div className="flex flex-col gap-3">

              {/* 総合サマリー */}
              <div className="bg-gray-800 rounded-xl p-3 flex items-center gap-4">
                <AccuracyMeter value={result.accuracy} />
                <div className="flex-1 grid grid-cols-2 gap-1.5">
                  {[
                    { label: '分析手数', value: result.totalMoves, color: 'text-white' },
                    { label: '平均損失', value: result.avgCpl != null ? `${result.avgCpl}cp` : '—', color: 'text-white' },
                    { label: '悪手',     value: result.totalBlunder, color: 'text-red-400' },
                    { label: '疑問手',   value: result.totalMistake, color: 'text-orange-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-gray-700/50 rounded-lg px-2.5 py-1.5">
                      <p className="text-xs text-gray-400">{label}</p>
                      <p className={`font-bold text-base leading-tight ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* フェーズ別内訳（縦積み） */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5 font-semibold">フェーズ別弱点</p>
                <div className="flex flex-col gap-2">
                  {PHASE_DEFS.map(def => (
                    <PhaseRow key={def.key} def={def} stats={result.phaseStats[def.key]} />
                  ))}
                </div>
              </div>

              {/* 棋譜別スコア */}
              {gameResults.length > 1 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5 font-semibold">棋譜別スコア</p>
                  <div className="flex flex-col gap-1">
                    {gameResults.map(g => (
                      <div key={g.id} className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg">
                        <span className="flex-1 text-xs text-gray-300 truncate">{g.title}</span>
                        {g.stats.accuracy != null && (
                          <span className={`text-xs font-bold shrink-0 ${g.stats.accuracy >= 70 ? 'text-green-400' : g.stats.accuracy >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {g.stats.accuracy}点
                          </span>
                        )}
                        {g.stats.totalBlunder > 0 && (
                          <span className="text-xs text-red-400 shrink-0">悪手{g.stats.totalBlunder}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 弱点アドバイス */}
              <WeaknessSummary phaseStats={result.phaseStats} />
            </div>
          )}
          </div>
        )}

      </div>
    </div>
  );
}

function WeaknessSummary({ phaseStats }) {
  const worst = PHASE_DEFS.reduce((best, ph) => {
    const s = phaseStats[ph.key];
    if (!s || s.count === 0 || s.avgCpl === null) return best;
    return (!best || s.avgCpl > best.avgCpl) ? { ...ph, ...s } : best;
  }, null);
  if (!worst) return null;
  const tips = {
    opening: '序盤の定跡・駒組みを見直しましょう。基本戦型の勉強が効果的です。',
    midgame: '中盤の大局観を磨きましょう。候補手を絞る練習や棋譜並べが有効です。',
    endgame: '終盤の寄せが課題です。詰将棋練習で終盤力を向上させましょう。',
  };
  return (
    <div className="bg-purple-900/20 border border-purple-700/40 rounded-xl px-3 py-3">
      <p className="text-sm font-bold text-purple-300 mb-1">
        弱点: <span className="text-white">{worst.label}</span>
        <span className="text-xs font-normal text-gray-400 ml-1">（平均損失 {worst.avgCpl}cp）</span>
      </p>
      <p className="text-xs text-gray-300 leading-relaxed">{tips[worst.key]}</p>
    </div>
  );
}
