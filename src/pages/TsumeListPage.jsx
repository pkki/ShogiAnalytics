/**
 * TsumeListPage.jsx
 * 詰将棋一覧ページ  /tsume/category/:moves
 * moves: 1-5 | 7-11 | 13+ | all
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { Heart, ChevronRight, Lock, Shuffle, User, CheckCircle } from 'lucide-react';
import TsumeNav from '../components/TsumeNav.jsx';
import AccountMenu from '../components/AccountMenu.jsx';
import { useAccountSettings } from '../hooks/useAccountSettings.jsx';

const CLOUD_API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';

// Category labels are now derived from i18n in the component

const PIECE_CHAR = { P:'歩',L:'香',N:'桂',S:'銀',G:'金',B:'角',R:'飛',K:'玉',
  '+P':'と','+L':'杏','+N':'圭','+S':'全','+B':'馬','+R':'竜' };

function MiniBoardPreview({ boardJson }) {
  const board = (() => {
    try { return boardJson ? JSON.parse(boardJson) : null; } catch { return null; }
  })();
  if (!board) return <div className="w-full aspect-square bg-gray-700 rounded" />;
  const cells = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      cells.push(
        <div key={`${r}-${c}`}
          className="border border-amber-900/30 flex items-center justify-center overflow-hidden"
          style={{ background: '#e8c96a', minWidth: 0, minHeight: 0 }}>
          {piece && (
            <span style={{
              fontSize: '8cqw',
              fontWeight: 900,
              color: piece.type.startsWith('+') ? '#c00' : '#000',
              transform: piece.player === 2 ? 'rotate(180deg)' : 'none',
              lineHeight: 1,
              display: 'block',
            }}>
              {PIECE_CHAR[piece.type] || piece.type}
            </span>
          )}
        </div>
      );
    }
  }
  return (
    <div style={{ containerType: 'inline-size', width: '100%' }}>
      <div className="w-full rounded overflow-hidden border border-amber-900/30"
        style={{ aspectRatio: '1/1', display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gridTemplateRows: 'repeat(9,1fr)' }}>
        {cells}
      </div>
    </div>
  );
}

function GridCard({ item }) {
  const { t } = useTranslation();
  const board = (() => {
    try { return item.board_json ? JSON.parse(item.board_json) : null; } catch { return null; }
  })();
  return (
    <Link
      to={`/tsume/${item.token}`}
      className="block bg-gray-800 border border-gray-700 hover:border-gray-500
                 rounded-xl overflow-hidden transition-all group"
    >
      <div className="p-3 bg-amber-950/20 relative">
        <MiniBoardPreview boardJson={item.board_json} />
        {item.visibility === 'unlisted' && (
          <span className="absolute top-2 right-2 flex items-center gap-0.5 bg-gray-900/80
            text-blue-400 text-[9px] font-medium px-1.5 py-0.5 rounded-full border border-blue-500/30">
            <Lock size={8} /> {t('tsume.unlisted')}
          </span>
        )}
      </div>
      <div className="px-2 pb-2 pt-1">
        <p className="text-xs text-white group-hover:text-blue-300 transition-colors leading-snug line-clamp-2">
          {item.title}
        </p>
        {item.author_name && (
          <p className="text-[10px] text-gray-500 mt-0.5 truncate">{item.author_name} {t('tsume.by')}</p>
        )}
        {item.description && (
          <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2 leading-snug">{item.description}</p>
        )}
        <div className="flex items-center justify-between mt-1">
          {item.num_moves > 0 && (
            <span className="text-[10px] bg-gray-700 text-gray-400 rounded-full px-1.5 py-0.5">
              {item.num_moves}{t('tsume.moves')}
            </span>
          )}
          <span className="text-[10px] text-red-400 flex items-center gap-0.5 ml-auto">
            <Heart size={9} /> {item.likes}
          </span>
        </div>
      </div>
    </Link>
  );
}

const CATEGORY_MOVE_KEYS = ['1-5', '7-11', '13+'];

function CategorySidebar() {
  const { t } = useTranslation();
  return (
    <aside className="w-full flex flex-col gap-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">{t('tsume.list')}</p>
      {CATEGORY_MOVE_KEYS.map(moves => (
        <Link
          key={moves}
          to={`/tsume/category/${moves}`}
          className="flex items-center justify-between px-4 py-3 bg-gray-800
                     hover:bg-gray-700 border border-gray-700 hover:border-gray-500
                     rounded-xl transition-colors group"
        >
          <span className="text-sm font-bold text-gray-200 group-hover:text-blue-300">
            {t(`tsume.categories.${moves}`)}
          </span>
          <ChevronRight size={16} className="text-gray-500 group-hover:text-blue-400 shrink-0" />
        </Link>
      ))}
      <Link
        to="/tsume/category/all"
        className="flex items-center justify-between px-4 py-3 bg-gray-800/50
                   hover:bg-gray-700 border border-gray-700/60 hover:border-gray-500
                   rounded-xl transition-colors group"
      >
        <span className="text-sm text-gray-400 group-hover:text-blue-300">{t('tsume.seeAll')}</span>
        <ChevronRight size={16} className="text-gray-500 group-hover:text-blue-400 shrink-0" />
      </Link>
    </aside>
  );
}

export default function TsumeListPage() {
  const { moves } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const PAGE_SIZE = 40;

  const [items,       setItems]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(true);
  const [offset,      setOffset]      = useState(0);
  const [sort,        setSort]        = useState('recent');
  const [sourceTab,   setSourceTab]   = useState(
    () => localStorage.getItem('tsume_list_tab') === 'generator' ? 'generator' : 'user'
  );
  const [unsolvedOnly, setUnsolvedOnly] = useState(() => {
  // ブラウザから保存されたデータを取得
    const saved = localStorage.getItem('tsume_unsolved_only');
    // データが 'true' なら true、それ以外（データがない、または 'false'）なら false にする
    return saved === 'true';
  });
  const sentinelRef = useRef(null);
  const fetchingRef = useRef(false); // 二重フェッチ防止

  const label = t(`tsume.categories.${moves}`) || t('tsume.categories.all');

  const authInfo = useMemo(() => {
    const userId = localStorage.getItem('shogi_uid');
    const email  = localStorage.getItem('shogi_email');
    return userId ? { userId, email } : null;
  }, []);
  const { dialog: settingsDialog, onShowSettings } = useAccountSettings(null);

  const fetchItems = useCallback(async (currentOffset, reset) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        sort, limit: String(PAGE_SIZE), offset: String(currentOffset), source: sourceTab,
      });
      if (moves && moves !== 'all') params.set('moves', moves);
      if (unsolvedOnly && authInfo) params.set('unsolved', '1');
      const r = await fetch(`${CLOUD_API}/api/tsume/list?${params}`);
      const d = await r.json();
      if (d.ok) {
        setItems(prev => reset ? d.items : [...prev, ...d.items]);
        setHasMore(d.hasMore);
        setOffset(currentOffset + d.items.length);
      }
    } catch (_) {}
    finally {
      if (reset) setLoading(false); else setLoadingMore(false);
      fetchingRef.current = false;
    }
  }, [moves, sort, sourceTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // sort / tab / moves / unsolved が変わったらリセット
  useEffect(() => {
    setItems([]); setOffset(0); setHasMore(true);
    fetchItems(0, true);
  }, [moves, sort, sourceTab, unsolvedOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sentinel が見えたら追加読み込み
  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
        fetchItems(offset, false);
      }
    }, { rootMargin: '200px' });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, loading, offset, fetchItems]);

  return (
    <div className="min-h-screen bg-gray-900 text-white lg:ml-64 pb-16 lg:pb-0">
      {settingsDialog}
      <TsumeNav />
      <Helmet>
        <title>{label} | {t('appName')}</title>
        <meta name="description" content={`${t('appName')} ${label}`} />
        <link rel="canonical" href={`https://analytics.pkkis.com/tsume/category/${moves}`} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={t('appName')} />
        <meta property="og:title" content={`${label} | ${t('appName')}`} />
        <meta property="og:url" content={`https://analytics.pkkis.com/tsume/category/${moves}`} />
        <meta property="og:image" content="https://analytics.pkkis.com/icons/icon-512x512.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${label} | ${t('appName')}`} />
        <meta name="twitter:image" content="https://analytics.pkkis.com/icons/icon-512x512.png" />
      </Helmet>

      {/* ヘッダー */}
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-700">
        <div className="flex items-center gap-3 px-4 py-3 lg:ml-64">
          <p className="font-bold text-white flex-1">{label}</p>
          {/* ソート切り替え */}
          <div className="flex gap-1">
            {[['recent', t('tsume.sortRecent')], ['likes', t('tsume.sortLikes')]].map(([key, lbl]) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={`px-3 py-1 rounded-full text-xs transition-colors
                  ${sort === key ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-white'}`}
              >
                {lbl}
              </button>
            ))}
          </div>
          {/* 未クリアフィルター (ログイン時のみ) */}
         {authInfo && (
            <button
              onClick={() => {
                // 1. 次の状態（いまの逆）を計算
                const nextValue = !unsolvedOnly;
                // 2. Reactの状態を更新
                setUnsolvedOnly(nextValue);
                // 3. ブラウザ（localStorage）に文字列として保存
                localStorage.setItem('tsume_unsolved_only', String(nextValue));
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors border
                ${unsolvedOnly
                  ? 'bg-emerald-600/20 border-emerald-500/60 text-emerald-300'
                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-white'}`}
            >
              <CheckCircle size={11} />
              未クリア
            </button>
          )}
          {authInfo ? (
            <AccountMenu
              email={authInfo.email}
              userId={authInfo.userId}
              onLogout={() => {
                fetch(`${CLOUD_API}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
                localStorage.removeItem('shogi_uid');
                localStorage.removeItem('shogi_email');
                navigate('/login');
              }}
              onShowSettings={onShowSettings}
            />
          ) : (
            <Link to="/login"
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-colors">
              ログイン
            </Link>
          )}
        </div>
        {/* ソースタブ */}
        <div className="flex border-t border-gray-700/60 lg:ml-64">
          {[
            { key: 'user',      label: 'ユーザーが作成', icon: User },
            { key: 'generator', label: 'ジェネレーターが作成', icon: Shuffle },
          ].map(({ key, label: tabLabel, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setSourceTab(key); localStorage.setItem('tsume_list_tab', key); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors border-b-2
                ${sourceTab === key
                  ? 'border-blue-500 text-blue-300'
                  : 'border-transparent text-gray-500 hover:text-gray-300'}`}
            >
              <Icon size={12} />
              {tabLabel}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-5 items-start px-4 py-4">
        {/* 左スペーサー */}
        <div className="hidden lg:block w-36 shrink-0" />

        {/* 中央: グリッド表示 */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <svg className="animate-spin w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
            </div>
          ) : items.length === 0 ? (
            <p className="text-gray-500 text-center py-16">{t('tsume.noItems')}</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-4">{items.length} 件{hasMore ? '以上' : ''}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {items.map(item => (
                  <GridCard key={item.token} item={item} />
                ))}
              </div>
              {/* 無限スクロール用センチネル */}
              <div ref={sentinelRef} className="h-1" />
              {loadingMore && (
                <div className="flex justify-center py-6">
                  <svg className="animate-spin w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                  </svg>
                </div>
              )}
              {!hasMore && items.length > 0 && (
                <p className="text-center text-xs text-gray-600 py-6">すべて表示しました</p>
              )}
            </>
          )}
        </div>

        {/* 右: カテゴリサイドバー */}
        <div className="hidden lg:block w-36 shrink-0">
          <CategorySidebar />
        </div>
      </div>
    </div>
  );
}