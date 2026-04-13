// ============================================================
//  AccountMenu — 右上アカウント表示 + ログアウト
//  props:
//    email:    string
//    onLogout: () => void
// ============================================================
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Smartphone, Settings, Info, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const ANDROID_DOWNLOAD_URL = import.meta.env.VITE_ANDROID_DOWNLOAD_URL || '';
// Capacitor ネイティブ環境 (Android アプリ内) では表示しない
const isNative = !!(window.Capacitor?.isNativePlatform?.());

export default function AccountMenu({ email, userId, onLogout, onShowShares, onShowSettings, onShowContact }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { t } = useTranslation();

  // パネル外クリックで閉じる
  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const initial = email?.[0]?.toUpperCase() || '?';
  const short   = email?.split('@')[0] || '';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-1.5 py-1 rounded-md
                   bg-gray-800 hover:bg-gray-700 text-sm text-gray-200
                   border border-gray-600 transition-colors"
        title={email}
      >
        <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center
                        text-xs font-bold text-white flex-shrink-0">
          {initial}
        </div>
        <span className="hidden sm:inline max-w-28 truncate text-gray-300">{short}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-56
                        bg-gray-900 border border-gray-700 rounded-lg shadow-2xl
                        text-sm text-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <div className="text-xs text-gray-500 mb-0.5">{t('accountMenu.loggedIn')}</div>
            <div className="font-medium truncate text-gray-100">{email}</div>
          </div>
          <div className="p-1">
            {userId && (
              <Link
                to={`/profile/${userId}`}
                onClick={() => setOpen(false)}
                className="w-full text-left px-3 py-2 rounded hover:bg-gray-800
                           text-gray-200 hover:text-white transition-colors flex items-center gap-2"
              >
                <User size={13} className="text-gray-400" />
                {t('accountMenu.myProfile')}
              </Link>
            )}
            {onShowSettings && (
              <button
                onClick={() => { setOpen(false); onShowSettings(); }}
                className="w-full text-left px-3 py-2 rounded hover:bg-gray-800
                           text-gray-200 hover:text-white transition-colors flex items-center gap-2"
              >
                <Settings size={13} className="text-gray-400" />
                {t('accountMenu.settings')}
              </button>
            )}
            {onShowShares && (
              <button
                onClick={() => { setOpen(false); onShowShares(); }}
                className="w-full text-left px-3 py-2 rounded hover:bg-gray-800
                           text-gray-200 hover:text-white transition-colors"
              >
                {t('accountMenu.sharedGames')}
              </button>
            )}
            {onShowContact && (
              <button
                onClick={() => { setOpen(false); onShowContact(); }}
                className="w-full text-left px-3 py-2 rounded hover:bg-gray-800
                           text-gray-200 hover:text-white transition-colors flex items-center gap-2"
              >
                <Info size={13} className="text-gray-400" />
                {t('accountMenu.contact')}
              </button>
            )}
            {!isNative && ANDROID_DOWNLOAD_URL && (
              <a
                href={ANDROID_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-800
                           text-gray-200 hover:text-white transition-colors"
              >
                <Smartphone size={14} className="text-green-400 flex-shrink-0" />
                {t('accountMenu.downloadAndroid')}
              </a>
            )}
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="w-full text-left px-3 py-2 rounded hover:bg-gray-800
                         text-red-400 hover:text-red-300 transition-colors"
            >
              {t('accountMenu.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
