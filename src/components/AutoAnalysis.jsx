import { useState, useEffect } from 'react';
import { PlayCircle, StopCircle, CheckCircle2, Loader2, BarChart2 } from 'lucide-react';

const COND_TYPES = [
  { label: '時間',     type: 'movetime', unit: '秒',   default: 3,   min: 1,  max: 300,    toServer: v => v * 1000 },
  { label: 'ノード数', type: 'nodes',    unit: 'K',    default: 500, min: 1,  max: 100000, toServer: v => v * 1000 },
  { label: '深さ',     type: 'depth',    unit: '',     default: 15,  min: 1,  max: 60,     toServer: v => v },
];

const fmtTime = (s) => s >= 60 ? `${Math.floor(s / 60)}分${s % 60}秒` : `${s}秒`;

export default function AutoAnalysis({ status, progress, totalMoves, onStart, onStop, disabled = false }) {
  const [collapsed,   setCollapsed]   = useState(false);
  const [condType, setCondType]   = useState('movetime');
  const [condValues, setCondValues] = useState({ movetime: 3, nodes: 500, depth: 15 });
  const [rangeFrom, setRangeFrom] = useState(0);
  const [rangeTo,   setRangeTo]   = useState(0);

  // KIF が読み込まれたら終了手を自動更新
  useEffect(() => {
    setRangeTo(totalMoves > 0 ? totalMoves : 0);
  }, [totalMoves]);

  const isRunning  = status === 'running';
  const isComplete = status === 'complete';
  const pct = progress && progress.total > 0
    ? Math.round(progress.current / progress.total * 100)
    : 0;

  const cond       = COND_TYPES.find(c => c.type === condType);
  const condVal    = condValues[condType];
  const rangeCount = Math.max(0, rangeTo - rangeFrom + 1);

  // 推定残り時間（movetime のみ計算可能）
  const remaining = condType === 'movetime' && progress
    ? Math.ceil((progress.total - progress.current) * condVal)
    : null;

  const setCondVal = (v) => {
    const val = Math.max(cond.min, Math.min(cond.max, Number(v) || cond.min));
    setCondValues(prev => ({ ...prev, [condType]: val }));
  };

  const handleStart = () => {
    onStart(
      { type: condType, value: cond.toServer(condVal) },
      rangeFrom,
      rangeTo,
    );
  };

  return (
    <div className="mx-3 bg-gray-800 rounded-2xl border border-gray-700 p-4 flex flex-col gap-3">

      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={15} className="text-blue-400" />
          <span className="text-sm font-bold text-white">棋譜解析</span>
          {isComplete && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <CheckCircle2 size={12} /> 完了
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-gray-500 hover:text-gray-300 transition-colors px-1"
          title={collapsed ? '展開' : '最小化'}
        >
          {collapsed ? '▼' : '▲'}
        </button>
      </div>

      {!collapsed && <>
      {/* 設定パネル（実行中は非表示） */}
      {!isRunning && (
        <>
          {/* 終了条件 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-gray-500">終了条件</span>
            <div className="flex gap-1.5">
              {COND_TYPES.map(c => (
                <button
                  key={c.type}
                  onClick={() => setCondType(c.type)}
                  className={`flex-1 py-1 rounded-lg text-xs font-bold transition-colors
                    ${condType === c.type
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={condVal}
                min={cond.min}
                max={cond.max}
                onChange={e => setCondVal(e.target.value)}
                className="w-24 bg-gray-700 text-white text-sm font-mono rounded-lg px-2 py-1
                  border border-gray-600 focus:border-blue-500 outline-none text-right"
              />
              {cond.unit && <span className="text-xs text-gray-400">{cond.unit}</span>}
              {condType === 'movetime' && rangeCount > 0 && (
                <span className="text-xs text-gray-500">
                  ≈ 約 {fmtTime(rangeCount * condVal)}
                </span>
              )}
            </div>
          </div>

          {/* 解析範囲 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-gray-500">解析範囲</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={rangeFrom}
                  min={0}
                  max={totalMoves}
                  onChange={e => {
                    const v = Math.max(0, Math.min(totalMoves, Number(e.target.value) || 0));
                    setRangeFrom(v);
                    if (v > rangeTo) setRangeTo(v);
                  }}
                  className="w-16 bg-gray-700 text-white text-sm font-mono rounded-lg px-2 py-1
                    border border-gray-600 focus:border-blue-500 outline-none text-right"
                />
                <span className="text-xs text-gray-400">手目</span>
              </div>
              <span className="text-xs text-gray-500">〜</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={rangeTo}
                  min={rangeFrom}
                  max={totalMoves}
                  onChange={e => {
                    const v = Math.max(rangeFrom, Math.min(totalMoves, Number(e.target.value) || rangeFrom));
                    setRangeTo(v);
                  }}
                  className="w-16 bg-gray-700 text-white text-sm font-mono rounded-lg px-2 py-1
                    border border-gray-600 focus:border-blue-500 outline-none text-right"
                />
                <span className="text-xs text-gray-400">手目</span>
              </div>
              <span className="text-xs text-gray-500">（{rangeCount} 局面）</span>
            </div>
          </div>
        </>
      )}

      {/* 進捗バー（実行中） */}
      {isRunning && progress && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-gray-300">
            <span className="flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin text-blue-400" />
              {progress.current} / {progress.total} 局面
              {progress.depth > 0 && (
                <span className="text-gray-500">（深さ {progress.depth}）</span>
              )}
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {remaining !== null && remaining > 0 && (
            <p className="text-[10px] text-gray-600 text-right">
              残り約 {fmtTime(remaining)}
            </p>
          )}
        </div>
      )}

      {/* ボタン */}
      {!isRunning ? (
        <button
          onClick={handleStart}
          disabled={totalMoves === 0 || rangeCount === 0 || disabled}
          title={disabled ? '検討中は棋譜解析を開始できません' : undefined}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-xl
            bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500
            text-white text-sm font-bold transition-colors ${disabled ? 'opacity-50' : ''}`}
        >
          <PlayCircle size={16} />
          棋譜解析を開始
        </button>
      ) : (
        <button
          onClick={onStop}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl
            bg-red-700 hover:bg-red-600 text-white text-sm font-bold transition-colors"
        >
          <StopCircle size={16} />
          停止
        </button>
      )}
      </>}
    </div>
  );
}
