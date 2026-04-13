import { useState } from 'react';
import { Swords, X } from 'lucide-react';

// ── 開始局面 ─────────────────────────────────────────────────────────
const POSITIONS = [
  { id: 'even',       label: '平手' },
  { id: 'lance',      label: '香落ち' },
  { id: 'rlance',     label: '右香落ち' },
  { id: 'bishop',     label: '角落ち' },
  { id: 'rook',       label: '飛車落ち' },
  { id: 'rook-lance', label: '飛香落ち' },
  { id: '2piece',     label: '二枚落ち' },
  { id: '4piece',     label: '四枚落ち' },
  { id: '6piece',     label: '六枚落ち' },
  { id: '8piece',     label: '八枚落ち' },
  { id: '10piece',    label: '十枚落ち' },
];

// ── 人間の時間設定形式 ────────────────────────────────────────────────
const HUMAN_TIME_FORMATS = [
  { id: 'byoyomi',   label: '秒読み' },
  { id: 'classical', label: '持ち時間+秒読み' },
  { id: 'fischer',   label: 'フィッシャー' },
  { id: 'infinite',  label: '無制限' },
];

// ── CPU の思考条件 ────────────────────────────────────────────────────
const CPU_THINK_TYPES = [
  { id: 'nodes',   label: 'ノード数' },
  { id: 'depth',   label: '深さ' },
  { id: 'byoyomi', label: '秒読み' },
];

function clamp(v, min, max) { return Math.max(min, Math.min(max, Number(v) || min)); }

function NumInput({ value, min, max, onChange, width = 'w-16' }) {
  return (
    <input type="number" value={value} min={min} max={max}
      onChange={e => onChange(clamp(e.target.value, min, max))}
      className={`${width} bg-gray-700 text-white text-sm font-mono rounded-lg px-2 py-1
        border border-gray-600 focus:border-blue-500 outline-none text-right`}
    />
  );
}

// デフォルト値
const DEFAULT_HUMAN = {
  type: 'human',
  timeFormat: 'byoyomi',
  byoyomiSec: 30,
  initMin: 10, initSec: 0,
  byoyomiSec2: 30,
  incSec: 10,
};
const DEFAULT_CPU = {
  type: 'cpu',
  thinkType: 'nodes',
  thinkNodes: 500,   // K nodes
  thinkDepth: 15,
  thinkByo: 5,       // seconds
};

// ── 人間用時間設定 ────────────────────────────────────────────────────
function HumanTimeSettings({ data, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {HUMAN_TIME_FORMATS.map(f => (
          <button key={f.id} onClick={() => onChange('timeFormat', f.id)}
            className={`px-2 py-1 rounded text-xs font-bold transition-colors
              ${data.timeFormat === f.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-gray-900/60 rounded-lg p-2 flex flex-col gap-1.5">
        {data.timeFormat === 'byoyomi' && (
          <div className="flex items-center gap-1">
            <NumInput value={data.byoyomiSec} min={1} max={600}
              onChange={v => onChange('byoyomiSec', v)} />
            <span className="text-xs text-gray-400">秒 / 手</span>
          </div>
        )}

        {data.timeFormat === 'classical' && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500 w-12">持ち時間</span>
              <NumInput value={data.initMin} min={0} max={600} width="w-12"
                onChange={v => onChange('initMin', v)} />
              <span className="text-xs text-gray-400">分</span>
              <NumInput value={data.initSec} min={0} max={59} width="w-10"
                onChange={v => onChange('initSec', v)} />
              <span className="text-xs text-gray-400">秒</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500 w-12">秒読み</span>
              <NumInput value={data.byoyomiSec2} min={1} max={600} width="w-12"
                onChange={v => onChange('byoyomiSec2', v)} />
              <span className="text-xs text-gray-400">秒</span>
            </div>
          </>
        )}

        {data.timeFormat === 'fischer' && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500 w-12">初期時間</span>
              <NumInput value={data.initMin} min={0} max={600} width="w-12"
                onChange={v => onChange('initMin', v)} />
              <span className="text-xs text-gray-400">分</span>
              <NumInput value={data.initSec} min={0} max={59} width="w-10"
                onChange={v => onChange('initSec', v)} />
              <span className="text-xs text-gray-400">秒</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500 w-12">加算</span>
              <NumInput value={data.incSec} min={1} max={300} width="w-12"
                onChange={v => onChange('incSec', v)} />
              <span className="text-xs text-gray-400">秒 / 手</span>
            </div>
          </>
        )}

        {data.timeFormat === 'infinite' && (
          <span className="text-xs text-gray-500">時間制限なし</span>
        )}
      </div>
    </div>
  );
}

// ── CPU 思考条件設定 ─────────────────────────────────────────────────
function CPUThinkSettings({ data, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        {CPU_THINK_TYPES.map(t => (
          <button key={t.id} onClick={() => onChange('thinkType', t.id)}
            className={`flex-1 py-1 rounded text-xs font-bold transition-colors
              ${data.thinkType === t.id
                ? 'bg-orange-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-gray-900/60 rounded-lg p-2">
        {data.thinkType === 'nodes' && (
          <div className="flex items-center gap-1">
            <NumInput value={data.thinkNodes} min={1} max={100000}
              onChange={v => onChange('thinkNodes', v)} />
            <span className="text-xs text-gray-400">K ノード</span>
          </div>
        )}
        {data.thinkType === 'depth' && (
          <div className="flex items-center gap-1">
            <NumInput value={data.thinkDepth} min={1} max={60}
              onChange={v => onChange('thinkDepth', v)} />
            <span className="text-xs text-gray-400">手 先読み</span>
          </div>
        )}
        {data.thinkType === 'byoyomi' && (
          <div className="flex items-center gap-1">
            <NumInput value={data.thinkByo} min={1} max={300}
              onChange={v => onChange('thinkByo', v)} />
            <span className="text-xs text-gray-400">秒 / 手</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── プレイヤーセクション ──────────────────────────────────────────────
function PlayerSection({ num, data, onChange }) {
  const isBlack = num === 1;
  const label   = isBlack ? '▲ 先手' : '△ 後手';
  const color   = isBlack ? 'text-blue-400' : 'text-red-400';
  const activeBg = isBlack ? 'bg-blue-600' : 'bg-red-600';

  return (
    <div className="flex flex-col gap-2 flex-1 min-w-0">
      {/* 先手/後手ラベル + 種別切り替え */}
      <div className="flex items-center justify-between">
        <span className={`text-sm font-bold ${color}`}>{label}</span>
        <div className="flex gap-1">
          {[
            { id: 'human', label: 'あなた' },
            { id: 'cpu',   label: 'CPU' },
          ].map(t => (
            <button key={t.id} onClick={() => onChange('type', t.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors
                ${data.type === t.id
                  ? `${activeBg} text-white`
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 設定内容 */}
      {data.type === 'human'
        ? <HumanTimeSettings data={data} onChange={onChange} />
        : <CPUThinkSettings  data={data} onChange={onChange} />}
    </div>
  );
}

// ── メインダイアログ ──────────────────────────────────────────────────
export default function GameSetupDialog({ onClose, onStart }) {
  const [startPos, setStartPos] = useState('even');
  const [hideInfo, setHideInfo] = useState(false);
  const [players, setPlayers]   = useState({
    1: { ...DEFAULT_HUMAN },
    2: { ...DEFAULT_CPU  },
  });

  const setPlayer = (num, key, val) =>
    setPlayers(prev => ({ ...prev, [num]: { ...prev[num], [key]: val } }));

  const handleStart = () => {
    const buildConfig = (p) => {
      if (p.type === 'human') {
        const timeParams = {};
        if (p.timeFormat === 'byoyomi')   timeParams.byoyomiMs = p.byoyomiSec * 1000;
        if (p.timeFormat === 'classical') { timeParams.initMs = (p.initMin * 60 + p.initSec) * 1000; timeParams.byoyomiMs = p.byoyomiSec2 * 1000; }
        if (p.timeFormat === 'fischer')   { timeParams.initMs = (p.initMin * 60 + p.initSec) * 1000; timeParams.incMs = p.incSec * 1000; }
        return { type: 'human', timeFormat: p.timeFormat, timeParams };
      } else {
        const thinkParams = {};
        if (p.thinkType === 'nodes')   thinkParams.nodes    = p.thinkNodes * 1000; // K → actual
        if (p.thinkType === 'depth')   thinkParams.depth    = p.thinkDepth;
        if (p.thinkType === 'byoyomi') thinkParams.byoyomiMs = p.thinkByo * 1000;
        return { type: 'cpu', thinkType: p.thinkType, thinkParams };
      }
    };
    onStart({
      startPos,
      players: { 1: buildConfig(players[1]), 2: buildConfig(players[2]) },
      hideInfo,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-800 rounded-2xl border border-gray-700 w-full max-w-xl p-5
        flex flex-col gap-4 shadow-2xl my-auto">

        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Swords size={18} className="text-blue-400" />
            <span className="font-bold text-white text-base">AI 対局設定</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* 開始局面 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-gray-500">開始局面</span>
          <div className="grid grid-cols-4 gap-1">
            {POSITIONS.map(pos => (
              <button key={pos.id} onClick={() => setStartPos(pos.id)}
                className={`py-1.5 rounded-lg text-xs font-bold transition-colors
                  ${startPos === pos.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'}`}>
                {pos.label}
              </button>
            ))}
          </div>
        </div>

        {/* プレイヤー設定（2カラム） */}
        <div className="flex gap-3">
          {[1, 2].map(num => (
            <PlayerSection
              key={num}
              num={num}
              data={players[num]}
              onChange={(key, val) => setPlayer(num, key, val)}
            />
          ))}
        </div>

        {/* 非表示設定 */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none
          px-3 py-2.5 bg-gray-900/50 rounded-xl border border-gray-700/50">
          <input type="checkbox" checked={hideInfo} onChange={e => setHideInfo(e.target.checked)}
            className="w-4 h-4 accent-blue-500 rounded" />
          <span className="text-sm text-gray-300">対局中は形勢・候補手を非表示にする</span>
        </label>

        {/* 開始ボタン */}
        <button onClick={handleStart}
          className="flex items-center justify-center gap-2 py-3 rounded-xl
            bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors">
          <Swords size={16} />
          対局開始
        </button>
      </div>
    </div>
  );
}
