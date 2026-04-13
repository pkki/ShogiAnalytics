import { Download, RefreshCw, X } from 'lucide-react';

/**
 * アップデート通知バナー
 * type: 'pwa'  → SWアップデート (今すぐ更新ボタン)
 * type: 'apk'  → APKアップデート (ダウンロードリンク)
 */
export default function UpdateBanner({ type, apkUrl, onUpdate, onDismiss }) {
  if (type === 'pwa') {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-[200] flex justify-center pointer-events-none pb-3 px-3">
        <div className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl
          bg-gray-800 border border-blue-500/50 shadow-2xl text-sm max-w-md w-full">
          <RefreshCw size={16} className="text-blue-400 shrink-0" />
          <span className="flex-1 text-gray-200">新しいバージョンがあります</span>
          <button
            onClick={onUpdate}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors shrink-0"
          >
            今すぐ更新
          </button>
          <button onClick={onDismiss} className="p-1 text-gray-500 hover:text-gray-300 transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (type === 'apk') {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-[200] flex justify-center pointer-events-none pb-3 px-3">
        <div className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl
          bg-gray-800 border border-green-500/50 shadow-2xl text-sm max-w-md w-full">
          <Download size={16} className="text-green-400 shrink-0" />
          <span className="flex-1 text-gray-200">アプリの新しいバージョンがあります</span>
          <a
            href={apkUrl}
            className="px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-xs font-bold transition-colors shrink-0"
          >
            更新する
          </a>
          <button onClick={onDismiss} className="p-1 text-gray-500 hover:text-gray-300 transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
