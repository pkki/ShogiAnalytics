import { Settings, Swords, Menu } from 'lucide-react';

export default function Header({ onOpenSettings, onOpenGame, gameMode, agentSlot, accountSlot, onMenuOpen }) {

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700 sticky top-0 z-50">
      <div className="flex items-center gap-2">
        {/* モバイル: ドロワーを開くボタン */}
        <button
          className="md:hidden p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          title="メニュー"
          onClick={onMenuOpen}
        >
          <Menu size={18} />
        </button>

        <img src="/icons/icon-192x192.png" className="w-7 h-7" alt="将棋アナリティクス" />
        <span className="hidden md:inline font-bold text-white text-base tracking-wide">将棋アナリティクス</span>
        {gameMode === 'playing' && (
          <span className="text-xs bg-blue-600/20 border border-blue-600/40 text-blue-400 px-2 py-0.5 rounded-full">
            対局中
          </span>
        )}
        {gameMode === 'ended' && (
          <span className="text-xs bg-gray-700 border border-gray-600 text-gray-400 px-2 py-0.5 rounded-full">
            対局終了
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {agentSlot}
        <button
          onClick={onOpenGame}
          className={`p-2 rounded-lg transition-colors
            ${gameMode
              ? 'text-blue-400 hover:bg-gray-700'
              : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
          title="対局"
        >
          <Swords size={20} />
        </button>
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
            title="エンジン設定"
          >
            <Settings size={20} />
          </button>
        )}
        {accountSlot && <div className="border-l border-gray-700 pl-2">{accountSlot}</div>}
      </div>
    </header>
  );
}
