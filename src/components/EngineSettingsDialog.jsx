import { useState, useMemo } from 'react';
import { X, Search, RotateCcw, CheckCircle2, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ── オプション種別ごとのコントロール ─────────────────────────
function SpinControl({ opt, value, onChange }) {
  return (
    <input
      type="number"
      min={opt.min} max={opt.max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-32 bg-gray-900 border border-gray-600 rounded-lg px-2 py-1 text-sm
        text-white focus:outline-none focus:border-blue-500 tabular-nums"
    />
  );
}

function CheckControl({ value, onChange }) {
  const checked = value === 'true' || value === true;
  return (
    <button
      onClick={() => onChange(checked ? 'false' : 'true')}
      className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0
        ${checked ? 'bg-blue-600' : 'bg-gray-600'}`}
      role="switch" aria-checked={checked}
    >
      <span className={`absolute top-0.5 left-0 w-4 h-4 bg-white rounded-full shadow transition-transform
        ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

function ComboControl({ opt, value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-gray-900 border border-gray-600 rounded-lg px-2 py-1 text-sm
        text-white focus:outline-none focus:border-blue-500"
    >
      {opt.vars.map(v => <option key={v} value={v}>{v}</option>)}
    </select>
  );
}

function StringControl({ value, onChange }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-48 bg-gray-900 border border-gray-600 rounded-lg px-2 py-1 text-sm
        text-white focus:outline-none focus:border-blue-500 font-mono"
    />
  );
}

function OptionRow({ opt, value, onChange, isChanged }) {
  const { t } = useTranslation();
  const control = (() => {
    switch (opt.type) {
      case 'spin':              return <SpinControl  opt={opt} value={value} onChange={onChange} />;
      case 'check':             return <CheckControl value={value} onChange={onChange} />;
      case 'combo':             return <ComboControl opt={opt} value={value} onChange={onChange} />;
      case 'string': case 'filename': return <StringControl value={value} onChange={onChange} />;
      case 'button':            return (
        <button
          onClick={() => onChange('__button__')}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-white transition-colors"
        >
          {t('engineSettingsDialog.execute')}
        </button>
      );
      default: return <span className="text-gray-500 text-xs">{opt.type}</span>;
    }
  })();

  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition-colors
      ${isChanged ? 'bg-blue-900/20 border border-blue-700/40' : 'hover:bg-gray-700/40'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-white font-mono truncate">{opt.name}</span>
          {isChanged && <CheckCircle2 size={12} className="text-blue-400 shrink-0" />}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{opt.type}</span>
          {opt.default !== '' && (
            <span className="text-[10px] text-gray-500">{t('engineSettingsDialog.defaultLabel')} {opt.default}</span>
          )}
          {opt.type === 'spin' && opt.min !== undefined && (
            <span className="text-[10px] text-gray-600">[{opt.min}〜{opt.max}]</span>
          )}
        </div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

// ── ライセンス情報（ブラウザエンジン用） ──────────────────────
const LICENSE_ENTRIES = [
  {
    key: 'yaneuraou',
    name: 'やねうら王 (YaneuraOu)',
    license: 'GNU GPL v3',
    url: 'https://github.com/yaneurao/YaneuraOu',
  },
  {
    key: 'suishoPetite',
    name: 'SuishoPetite 評価関数',
    license: '独自ライセンス（非商用推奨）',
    url: 'https://github.com/mizar/YaneuraOu',
  },
  {
    key: 'suisho5',
    name: '水匠5 (Suisho5) 評価関数',
    license: '独自ライセンス（非商用推奨）',
    url: 'https://github.com/yaneurao/YaneuraOu/releases/tag/suisho5',
  },
];

function LicenseSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-5 mb-3 rounded-xl border border-gray-700/60 bg-gray-800/40 overflow-hidden shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-700/30 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-gray-400">
          <Scale size={13} className="text-gray-500" />
          {t('engineSettingsDialog.licenseTitle')}
        </span>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          {LICENSE_ENTRIES.map(entry => (
            <div key={entry.key} className="flex flex-col gap-1 pt-3 border-t border-gray-700/40 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-white">{entry.name}</span>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[200px]"
                >
                  {entry.url.replace('https://', '')}
                </a>
              </div>
              <span className="inline-block text-[10px] font-mono bg-gray-700 text-yellow-300 px-1.5 py-0.5 rounded w-fit">
                {entry.license}
              </span>
              <p className="text-[10px] text-gray-500 leading-relaxed">
                {t(`engineSettingsDialog.licenses.${entry.key}.note`)}
              </p>
            </div>
          ))}
          <div className="pt-3 border-t border-gray-700/40">
            <p className="text-[10px] text-gray-600 leading-relaxed">
              {t('engineSettingsDialog.licenseFooter')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── メインダイアログ ─────────────────────────────────────────
export default function EngineSettingsDialog({ options, onClose, onApply, engineStatus, engineMessage, suisho5Ready, isBrowserEngine }) {
  const { t } = useTranslation();
  // 「適用」した時点の値をbaselineとして保持。適用後に更新することで
  // 「適用→別の値に戻す」操作でも変更ありとみなせる。
  const [baseline, setBaseline] = useState(() => {
    const b = {};
    for (const o of options) b[o.name] = String(o.value ?? o.default ?? '');
    return b;
  });

  // 編集中の値マップ: name → string value
  const [editMap, setEditMap] = useState(() => ({ ...baseline }));
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.name.toLowerCase().includes(q));
  }, [options, query]);

  // baseline との差分のみ「変更あり」とみなす
  const changedOptions = useMemo(() =>
    options.filter(o => String(editMap[o.name] ?? '') !== String(baseline[o.name] ?? '')),
    [options, editMap, baseline],
  );

  function handleChange(name, val) {
    // Suisho5 未ダウンロード時: 選択前に確認ダイアログを表示
    if (name === 'エンジン' && val === 'Suisho5 (強力NNUE)' && suisho5Ready === false) {
      if (!window.confirm('Suisho5（約100MB）をダウンロードしますか？\n強力なNNUEエンジンが利用できるようになります。')) {
        return;
      }
    }
    setEditMap(prev => ({ ...prev, [name]: val }));
    setApplied(false);
    // button type → 即時送信
    if (val === '__button__') {
      onApply([{ name, value: '' }]);
    }
  }

  function handleReset(name) {
    const opt = options.find(o => o.name === name);
    if (opt) handleChange(name, opt.default);
  }

  function handleApply() {
    if (changedOptions.length === 0) return;
    onApply(changedOptions.map(o => ({ name: o.name, value: editMap[o.name] })));
    // 適用後にbaselineを更新することで、「元に戻す」操作でも変更ありとみなせる
    setBaseline({ ...editMap });
    setApplied(true);
  }

  function handleResetAll() {
    const m = {};
    for (const o of options) m[o.name] = o.default;
    setEditMap(m);
    setApplied(false);
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl
          w-full max-w-xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">{t('engineSettingsDialog.title')}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{t('engineSettingsDialog.optionCount', { count: options.length })}</p>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* 検索 */}
        <div className="px-5 py-3 border-b border-gray-700/50 shrink-0">
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
            <Search size={14} className="text-gray-500 shrink-0" />
            <input
              type="text" placeholder={t('engineSettingsDialog.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-600
                focus:outline-none"
            />
          </div>
        </div>

        {/* 変更件数バナー */}
        {changedOptions.length > 0 && !applied && (
          <div className="mx-5 mt-3 shrink-0 px-3 py-2 bg-blue-900/30 border border-blue-700/50
            rounded-lg flex items-center justify-between text-xs">
            <span className="text-blue-300">{t('engineSettingsDialog.changedCount', { count: changedOptions.length })}</span>
            <button onClick={handleResetAll}
              className="flex items-center gap-1 text-gray-400 hover:text-white">
              <RotateCcw size={11} /> {t('engineSettingsDialog.resetAll')}
            </button>
          </div>
        )}
        {applied && (
          <div className="mx-5 mt-3 shrink-0 px-3 py-2 bg-green-900/30 border border-green-700/50
            rounded-lg text-xs text-green-300 flex items-center gap-1.5">
            <CheckCircle2 size={12} /> {t('engineSettingsDialog.applied')}
          </div>
        )}

        {/* ダウンロード進捗 */}
        {engineStatus === 'connecting' && engineMessage && (
          <div className="mx-5 mt-3 shrink-0 px-3 py-2 bg-blue-900/20 border border-blue-700/40
            rounded-lg flex items-center gap-2 text-xs text-blue-300">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
            {engineMessage}
          </div>
        )}

        {/* オプション一覧 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-1">
          {filtered.length === 0 && (
            <p className="text-gray-600 text-sm text-center py-8">{t('engineSettingsDialog.noResults')}</p>
          )}
          {filtered.map(opt => (
            <div key={opt.name} className="relative group">
              <OptionRow
                opt={opt}
                value={editMap[opt.name] ?? opt.default}
                onChange={(v) => handleChange(opt.name, v)}
                isChanged={String(editMap[opt.name] ?? '') !== String(baseline[opt.name] ?? '')}
              />
              {/* リセットボタン（変更済みのみ表示） */}
              {editMap[opt.name] !== opt.default && (
                <button
                  onClick={() => handleReset(opt.name)}
                  className="absolute right-24 top-1/2 -translate-y-1/2 p-1 rounded
                    text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t('engineSettingsDialog.resetToDefault')}
                >
                  <RotateCcw size={11} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* ライセンス情報（ブラウザエンジン選択時のみ） */}
        {isBrowserEngine && <LicenseSection />}

        {/* フッター */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700 shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors">
            {t('engineSettingsDialog.close')}
          </button>
          <button
            onClick={handleApply}
            disabled={changedOptions.length === 0}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700
              disabled:text-gray-500 text-sm text-white font-bold transition-colors"
          >
            {t('engineSettingsDialog.apply')} {changedOptions.length > 0 ? `(${changedOptions.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
