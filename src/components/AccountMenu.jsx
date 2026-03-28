// ============================================================
//  AccountMenu — 右上アカウント表示 + ログアウト
//  props:
//    email:    string
//    onLogout: () => void
// ============================================================
import { useState, useEffect, useRef } from 'react';

export default function AccountMenu({ email, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

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
            <div className="text-xs text-gray-500 mb-0.5">ログイン中</div>
            <div className="font-medium truncate text-gray-100">{email}</div>
          </div>
          <div className="p-1">
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="w-full text-left px-3 py-2 rounded hover:bg-gray-800
                         text-red-400 hover:text-red-300 transition-colors"
            >
              ログアウト
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
