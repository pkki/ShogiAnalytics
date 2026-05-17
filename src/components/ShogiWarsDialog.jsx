import { X, Clipboard } from 'lucide-react';

const STEPS = [
  {
    num: 1,
    title: '将棋ウォーズで対局を開く',
    body: '棋譜を読み込みたい対局ページを開き、右上のAIマークをタップします。',
    visual: (
      <div className="flex flex-col items-center gap-2">
        <div className="relative bg-gray-700 rounded-xl p-3 border border-gray-600 shadow-lg">
          {/* 棋神アナリティクス風アイコン */}
          <div className="w-14 h-14 bg-gray-800 rounded-lg border border-gray-500 flex flex-col items-center justify-center gap-0.5 relative overflow-hidden">
            {/* 将棋盤グリッド風 */}
            <div className="grid grid-cols-3 gap-px opacity-50">
              {Array(9).fill(0).map((_, i) => (
                <div key={i} className="w-2 h-2 border border-gray-400 rounded-sm bg-amber-900/30" />
              ))}
            </div>
            {/* AI文字 */}
            <div className="absolute bottom-1 right-1 bg-white text-black text-[8px] font-black rounded px-0.5 leading-tight">
              AI
            </div>
          </div>
        </div>
        <p className="text-xs text-blue-400">→ 棋神アナリティクスが開きます</p>
      </div>
    ),
  },
  {
    num: 2,
    title: '「棋譜を出力」をクリック',
    body: '棋神アナリティクスの左メニューから「棋譜を出力」を選択します。',
    visual: (
      <div className="bg-gray-800 border border-gray-600 rounded-xl overflow-hidden text-xs w-44">
        <div className="bg-gray-700 px-3 py-2 text-gray-200 font-bold text-[11px] flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-500 rounded-sm" />
          棋神アナリティクス
        </div>
        {[
          { label: '棋譜を開く',   icon: '📂' },
          { label: '棋譜を保存',   icon: '💾' },
          { label: '棋譜情報',     icon: '📋' },
        ].map(item => (
          <div key={item.label} className="px-3 py-2 text-gray-500 border-t border-gray-700/60 flex items-center gap-2">
            <span className="text-[10px]">{item.icon}</span>{item.label}
          </div>
        ))}
        <div className="px-3 py-2 bg-blue-600/20 border-t border-blue-500/40 text-blue-300 font-bold flex items-center gap-2">
          <span className="text-[10px]">📥</span>棋譜を出力
        </div>
        <div className="px-3 py-2 text-gray-500 border-t border-gray-700/60 flex items-center gap-2">
          <span className="text-[10px]">🗑️</span>棋譜をリセット
        </div>
      </div>
    ),
  },
  {
    num: 3,
    title: '「コピー」ボタンを押す',
    body: '「棋譜を出力」ダイアログの「kifファイル」欄にある「コピー」ボタンを押すだけでOKです。選択は不要です。',
    visual: (
      <div className="bg-white rounded-xl shadow-xl overflow-hidden text-[11px] w-56 border border-gray-200">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
          <span className="font-bold text-gray-800 text-xs">棋譜を出力</span>
          <span className="text-gray-400 text-base leading-none">×</span>
        </div>
        <div className="px-3 py-2">
          <p className="font-bold text-gray-700 mb-0.5">kifファイル</p>
          <p className="text-gray-500 text-[10px] mb-2 leading-relaxed">kif形式のファイルをダウンロードまたはクリップボードにコピーします。</p>
          <div className="flex items-center gap-1 mb-2">
            <input type="checkbox" readOnly checked className="accent-blue-500" />
            <span className="text-gray-600 text-[10px]">評価値出力</span>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 bg-blue-600 text-white text-center rounded px-2 py-1.5 text-[10px] font-bold">ファイルに出力</div>
            <div className="bg-gray-800 text-white text-center rounded px-3 py-1.5 text-[10px] font-bold ring-2 ring-yellow-400">コピー</div>
          </div>
        </div>
      </div>
    ),
  },
];

export default function ShogiWarsDialog({ onClose, onPaste }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-md flex flex-col"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">将棋ウォーズ棋譜の読み込み方</h2>
            <p className="text-xs text-gray-500 mt-0.5">棋神アナリティクス経由でKIF出力</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* お知らせ */}
        <div className="mx-5 mt-4 shrink-0 bg-amber-900/20 border border-amber-700/40 rounded-xl px-4 py-3 text-xs text-amber-300 leading-relaxed">
          将棋ウォーズは直接の棋譜取得を禁止しています。
          棋神アナリティクスの「棋譜を出力」機能を使って手動でコピーしてください。
        </div>

        {/* ステップ */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-6">
          {STEPS.map(step => (
            <div key={step.num} className="flex gap-4">
              <div className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-black flex items-center justify-center mt-0.5">
                {step.num}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white mb-1">{step.title}</p>
                <p className="text-xs text-gray-400 leading-relaxed mb-3">{step.body}</p>
                <div className="flex justify-center">
                  {step.visual}
                </div>
              </div>
            </div>
          ))}

          {/* ステップ4: 貼り付け */}
          <div className="flex gap-4">
            <div className="shrink-0 w-7 h-7 rounded-full bg-green-600 text-white text-sm font-black flex items-center justify-center mt-0.5">
              4
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white mb-1">将棋アナリティクスに貼り付け</p>
              <p className="text-xs text-gray-400 leading-relaxed mb-3">
                コピーした棋譜をクリップボードに入れたまま、下のボタンを押してください。
              </p>
              <button
                onClick={onPaste}
                className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg"
              >
                <Clipboard size={16} />
                KIFを貼り付けて読み込む
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 pb-4 pt-2 border-t border-gray-800 shrink-0">
          <p className="text-[10px] text-gray-600 text-center">
            棋神アナリティクスは将棋ウォーズの公式AI解析サービスです。
          </p>
        </div>
      </div>
    </div>
  );
}
