/**
 * TsumeNav.jsx
 * 詰将棋・プロフィール系ページ共通ナビ。
 * - デスクトップ (lg+): 固定左サイドバー w-52
 * - モバイル       : 画面下部のタブバー（アイコンのみ）
 */
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, User, LayoutGrid, Home, Languages } from 'lucide-react';

function parseUserId() {
  try {
    const token = localStorage.getItem('shogi_jwt');
    if (!token) return null;
    return JSON.parse(atob(token.split('.')[1])).userId;
  } catch { return null; }
}

function NavLinks({ userId, onClose }) {
  const loc = useLocation();
  const { t } = useTranslation();

  const items = [
    {
      icon: BookOpen,
      label: t('nav.tsume'),
      sub:   t('nav.tsumeList'),
      to:    '/tsume/category/all',
    },
    ...(userId ? [{
      icon:  User,
      label: t('nav.profile'),
      to:    `/profile/${userId}`,
    }] : []),
    {
      icon:  LayoutGrid,
      label: t('nav.mainApp'),
      to:    '/app',
    },
  ];

  return (
    <nav className="flex flex-col gap-1 py-4">
      {items.map(item => {
        const active = loc.pathname === item.to || loc.pathname.startsWith(item.to + '/');
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onClose}
            className={`flex items-center gap-4 px-4 py-3 rounded-xl mx-2 transition-colors
              ${active
                ? 'bg-blue-600/20 text-blue-300'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
          >
            <item.icon size={22} className="shrink-0" />
            <div className="min-w-0">
              <p className={`text-base leading-tight ${active ? 'font-bold' : 'font-medium'}`}>
                {item.label}
              </p>
              {item.sub && (
                <p className="text-xs text-gray-500 leading-tight mt-0.5">{item.sub}</p>
              )}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarHeader() {
  const { t } = useTranslation();
  return (
    <Link to="/" className="px-5 py-4 border-b border-gray-700 flex items-center gap-2 hover:bg-gray-800 transition-colors">
      <img src="/icons/icon-192x192.png" className="w-5 h-5 lg:w-7 lg:h-7" alt={t('appName')} />
      <span className="text-base font-bold text-white tracking-tight">{t('appName')}</span>
    </Link>
  );
}

export default function TsumeNav() {
  const loc = useLocation();
  const { t, i18n } = useTranslation();
  const userId = parseUserId();
  const isJa = i18n.language === 'ja' || i18n.language?.startsWith('ja-');
  const toggleLang = () => i18n.changeLanguage(isJa ? 'en' : 'ja');

  const tabItems = [
    { icon: Home,       label: t('nav.home'), to: '/' },
    { icon: BookOpen,   label: t('nav.tsume'),    to: '/tsume/category/all' },
    ...(userId ? [{ icon: User, label: t('nav.profile'), to: `/profile/${userId}` }] : []),
    { icon: LayoutGrid, label: t('nav.mainApp'),  to: '/app' },
  ];

  return (
    <>
      {/* ── デスクトップ: 固定左サイドバー ── */}
      <aside className="hidden lg:flex flex-col fixed top-0 left-0 h-full w-64
                        bg-gray-900 border-r border-gray-700 z-30">
        <SidebarHeader />
        <NavLinks userId={userId} onClose={() => {}} />
        <div className="mt-auto px-4 py-4 border-t border-gray-700">
          <button
            onClick={toggleLang}
            className="flex items-center gap-2 px-3 py-2 rounded-xl w-full
                       text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <Languages size={18} className="shrink-0" />
            <span className="text-sm">{isJa ? 'English' : '日本語'}</span>
          </button>
        </div>
      </aside>

      {/* ── モバイル: ボトムタブバー ── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-gray-900 border-t border-gray-700
                      flex items-stretch">
        {tabItems.map(item => {
          const active = item.to === '/'
            ? loc.pathname === '/'
            : loc.pathname === item.to || loc.pathname.startsWith(item.to + '/');
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors
                ${active ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
            >
              <item.icon size={22} />
              <span className="text-[10px] leading-tight">{item.label}</span>
            </Link>
          );
        })}
        <button
          onClick={toggleLang}
          className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5
                     text-gray-500 hover:text-gray-300 transition-colors"
        >
          <Languages size={22} />
          <span className="text-[10px] leading-tight">{isJa ? 'EN' : 'JA'}</span>
        </button>
      </nav>
    </>
  );
}
