import { useState, useEffect } from 'react';
import { X, Search, Loader2, ChevronDown } from 'lucide-react';

function formatDate(isoStr) {
  const d = new Date(isoStr);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ShogiWarsDialog({ onClose, onLoad, defaultUsername = '' }) {
  const [username, setUsername] = useState(defaultUsername);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [records, setRecords]   = useState([]);
  const [page, setPage]         = useState(1);
  const [total, setTotal]       = useState(0);
  const [queried, setQueried]   = useState('');

  // defaultUsername が設定されていれば開いた瞬間に自動検索
  useEffect(() => {
    if (defaultUsername) fetchGames(defaultUsername, 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchGames(user, pg) {
    setLoading(true);
    setError(null);
    try {
      const url = `https://www.shogi-extend.com/w.json?query=${encodeURIComponent(user)}&per=10&page=${pg}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`サーバーエラー: HTTP ${res.status}`);
      const data = await res.json();
      if (pg === 1) {
        setRecords(data.records ?? []);
      } else {
        setRecords(prev => [...prev, ...(data.records ?? [])]);
      }
      setTotal(data.total ?? 0);
      setPage(pg);
      setQueried(user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e) {
    e?.preventDefault();
    const u = username.trim();
    if (!u) return;
    setRecords([]);
    fetchGames(u, 1);
  }

  function handleLoadMore() {
    fetchGames(queried, page + 1);
  }

  const hasMore = records.length < total && records.length > 0;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-lg flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">将棋ウォーズ棋譜</h2>
            <p className="text-xs text-gray-500 mt-0.5">ユーザー名で棋譜を検索</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* 検索 */}
        <form onSubmit={handleSearch} className="px-5 py-3 border-b border-gray-700/50 shrink-0">
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
              <Search size={14} className="text-gray-500 shrink-0" />
              <input
                type="text"
                placeholder="将棋ウォーズのユーザー名"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !username.trim()}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-sm text-white font-bold transition-colors flex items-center gap-1.5"
            >
              {loading && records.length === 0
                ? <Loader2 size={15} className="animate-spin" />
                : <Search size={15} />}
              <span>{loading && records.length === 0 ? '検索中…' : '検索'}</span>
            </button>
          </div>
        </form>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {error && (
            <div className="mx-5 mt-4 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-lg text-xs text-red-300">
              {error}
            </div>
          )}

          {records.length === 0 && !loading && !error && (
            <p className="text-gray-600 text-sm text-center py-12">
              {queried ? '棋譜が見つかりませんでした' : 'ユーザー名を入力して検索してください'}
            </p>
          )}

          {records.length > 0 && (
            <div className="px-5 pt-3 pb-1 shrink-0 text-xs text-gray-500">
              全 {total} 件中 {records.length} 件表示
            </div>
          )}

          <div className="flex flex-col gap-1.5 px-3 pb-3">
            {records.map(record => {
              const myMembership  = record.memberships?.find(m => m.user?.key === queried);
              const isWin  = myMembership?.judge_key === 'win';
              const isLose = myMembership?.judge_key === 'lose';
              const blackName = record.player_info?.black?.name ?? '先手';
              const whiteName = record.player_info?.white?.name ?? '後手';
              const description = record.description ?? '';

              return (
                <button
                  key={record.id}
                  onClick={() => onLoad(record)}
                  className="w-full text-left px-3 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors border border-transparent hover:border-gray-600"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] text-gray-400">{formatDate(record.battled_at)}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-gray-500 bg-gray-700/80 px-1.5 py-0.5 rounded">
                        {record.rule_info?.name ?? ''}
                      </span>
                      {isWin && (
                        <span className="text-[10px] font-bold text-yellow-400 bg-yellow-900/30 border border-yellow-700/40 px-1.5 py-0.5 rounded">
                          勝
                        </span>
                      )}
                      {isLose && (
                        <span className="text-[10px] font-bold text-gray-400 bg-gray-700/50 border border-gray-600/40 px-1.5 py-0.5 rounded">
                          負
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-white font-medium">
                    ▲{blackName} vs △{whiteName}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-gray-400 truncate flex-1">{description}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">
                      {record.final_info?.name} ({record.turn_max}手)
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* もっと読み込む */}
          {hasMore && !loading && (
            <div className="px-3 pb-4 shrink-0">
              <button
                onClick={handleLoadMore}
                className="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors flex items-center justify-center gap-1.5"
              >
                <ChevronDown size={14} /> もっと読み込む ({records.length}/{total})
              </button>
            </div>
          )}
          {loading && records.length > 0 && (
            <div className="flex justify-center pb-4 shrink-0">
              <Loader2 size={18} className="animate-spin text-gray-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
