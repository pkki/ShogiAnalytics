import { Settings, Swords, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

function LangToggle() {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja' || i18n.language?.startsWith('ja-');
  const toggle = () => i18n.changeLanguage(isJa ? 'en' : 'ja');
  return (
    <button
      onClick={toggle}
      className="px-2 py-1 rounded-lg text-xs font-bold border border-gray-600 text-gray-400
                 hover:border-blue-500 hover:text-blue-300 transition-colors"
      title={isJa ? 'Switch to English' : '日本語に切り替え'}
    >
      {isJa ? 'EN' : 'JA'}
    </button>
  );
}

export default function Header({ onOpenSettings, onOpenGame, gameMode, agentSlot, accountSlot, onMenuOpen }) {
  const { t } = useTranslation();

  return (
    <header className="flex items-center justify-between bg-gray-900 border-b border-gray-700 sticky top-0 z-50
      px-2 py-1 lg:px-4 lg:py-3">
      <div className="flex items-center gap-1.5 lg:gap-2">
        {/* モバイル: ドロワーを開くボタン */}
        <button
          className="lg:hidden p-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          title={t('nav.menu')}
          onClick={onMenuOpen}
        >
          <Menu size={15} />
        </button>

        <Link to="/" className="flex items-center gap-1.5 lg:gap-2">
          <img src="/icons/icon-192x192.png" className="w-5 h-5 lg:w-7 lg:h-7" alt={t('appName')} />
          <span className="hidden lg:inline font-bold text-white text-base tracking-wide hover:text-gray-300 transition-colors">{t('appName')}</span>
        </Link>
        {gameMode === 'playing' && (
          <span className="text-[10px] md:text-xs bg-blue-600/20 border border-blue-600/40 text-blue-400 px-1.5 py-0.5 rounded-full">
            {t('header.playing')}
          </span>
        )}
        {gameMode === 'ended' && (
          <span className="text-[10px] md:text-xs bg-gray-700 border border-gray-600 text-gray-400 px-1.5 py-0.5 rounded-full">
            {t('header.ended')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 lg:gap-2">
        {agentSlot}
        <LangToggle />
        <button
          onClick={onOpenGame}
          className={`p-1 lg:p-2 rounded-lg transition-colors
            ${gameMode
              ? 'text-blue-400 hover:bg-gray-700'
              : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
          title={t('header.game')}
        >
          <Swords size={16} className="lg:hidden" />
          <Swords size={20} className="hidden lg:block" />
        </button>
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="p-1 lg:p-2 rounded-lg hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
            title={t('header.engineSettings')}
          >
            <Settings size={16} className="lg:hidden" />
            <Settings size={20} className="hidden lg:block" />
          </button>
        )}
        {accountSlot && <div className="border-l border-gray-700 pl-1.5 lg:pl-2">{accountSlot}</div>}
      </div>
    </header>
  );
}
