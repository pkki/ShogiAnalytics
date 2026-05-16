import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Users, Activity, Database, BookOpen, Mail, Share2, Shield, UserCheck } from 'lucide-react';
import { Helmet } from 'react-helmet-async';

const API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:8080';
const LIMIT = 50;

function authHeaders() {
  const token = localStorage.getItem('shogi_jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path) {
  const res = await fetch(`${API}${path}`, { headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function formatDuration(ms) {
  if (ms < 60000) return `${Math.floor(ms / 1000)}秒`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}分`;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return m > 0 ? `${h}時間${m}分` : `${h}時間`;
}

function formatDate(unixSec) {
  if (!unixSec) return '—';
  return new Date(unixSec * 1000).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatCard({ icon: Icon, label, value, color, sub }) {
  const colors = {
    blue:   'text-blue-400 bg-blue-900/30',
    green:  'text-green-400 bg-green-900/30',
    purple: 'text-purple-400 bg-purple-900/30',
    orange: 'text-orange-400 bg-orange-900/30',
    teal:   'text-teal-400 bg-teal-900/30',
    gray:   'text-gray-400 bg-gray-800',
  };
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${colors[color] || colors.gray}`}>
          <Icon size={14} />
        </div>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white tabular-nums">
        {value != null ? Number(value).toLocaleString() : '—'}
      </div>
      {sub && <div className="text-xs text-gray-600">{sub}</div>}
    </div>
  );
}

function Avatar({ name, email, color }) {
  const ch = (name || email || '?')[0].toUpperCase();
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
         style={{ backgroundColor: color || '#2563eb' }}>
      {ch}
    </div>
  );
}

export default function AdminPage() {
  const [stats, setStats] = useState(null);
  const [online, setOnline] = useState([]);
  const [users, setUsers] = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState('created_at_desc');
  const [error, setError] = useState('');
  const [statsLoading, setStatsLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  // 統計 + オンライン (マウント時 + 手動更新)
  async function loadOverview() {
    setStatsLoading(true);
    setError('');
    try {
      const [s, o] = await Promise.all([
        apiFetch('/admin/stats'),
        apiFetch('/admin/online'),
      ]);
      setStats(s);
      setOnline(o.online || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setStatsLoading(false);
    }
  }

  // ユーザー一覧 (page/search/sort 変化時)
  async function loadUsers() {
    setUsersLoading(true);
    try {
      const q = new URLSearchParams({ page, limit: LIMIT, sort });
      if (search) q.set('search', search);
      const data = await apiFetch(`/admin/users?${q}`);
      setUsers(data.users || []);
      setUserTotal(data.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setUsersLoading(false);
    }
  }

  // 初期ロード
  useEffect(() => { loadOverview(); }, []); // eslint-disable-line

  // ページ / 検索 / ソート 変化でユーザー再取得
  useEffect(() => { loadUsers(); }, [page, search, sort]); // eslint-disable-line

  // オンラインを30秒ごとに自動更新
  useEffect(() => {
    const id = setInterval(async () => {
      setOnlineLoading(true);
      setNow(Date.now());
      try {
        const o = await apiFetch('/admin/online');
        setOnline(o.online || []);
      } catch {}
      setOnlineLoading(false);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  // 経過時間の表示を1分ごと更新
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  function handleSearch(e) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  function handleRefresh() {
    loadOverview();
    loadUsers();
  }

  const isAccessDenied = error.includes('管理者権限') || error.includes('403') || error.includes('Forbidden');

  if (isAccessDenied) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">アクセス拒否</h1>
          <p className="text-gray-400 mb-6">このページは管理者専用です</p>
          <Link to="/app" className="text-blue-400 hover:text-blue-300 text-sm">アプリに戻る</Link>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(userTotal / LIMIT);
  const onlineSet  = new Set(online.map(o => o.userId));

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Helmet>
        <title>管理者ダッシュボード — ShogiAnalytics</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      {/* ヘッダー */}
      <header className="px-6 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-950 z-10">
        <div className="flex items-center gap-2 text-sm">
          <Link to="/app" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
            <img src="/icons/icon-192x192.png" className="w-5 h-5" alt="ShogiAnalytics" />
          </Link>
          <span className="text-gray-700">/</span>
          <span className="font-semibold text-gray-200">管理者ダッシュボード</span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={statsLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700
                     border border-gray-600 rounded-lg text-xs text-gray-300 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={11} className={statsLoading ? 'animate-spin' : ''} />
          更新
        </button>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-8">

        {error && !isAccessDenied && (
          <div className="bg-red-900/40 border border-red-600/50 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* ── 統計カード ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">概要</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={Users}    label="総ユーザー数"  value={stats?.total_users}   color="blue" />
            <StatCard icon={Activity} label="オンライン中"   value={stats?.online_count}  color="green" />
            <StatCard icon={Database} label="保存棋譜数"     value={stats?.total_kifs}    color="purple" />
            <StatCard icon={BookOpen} label="詰将棋数"       value={stats?.total_tsume}   color="orange" />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <StatCard icon={UserCheck} label="今日の登録"   value={stats?.new_today}   color="green"  sub="過去24時間" />
            <StatCard icon={UserCheck} label="今週の登録"   value={stats?.new_week}    color="blue"   sub="過去7日間" />
            <StatCard icon={UserCheck} label="今月の登録"   value={stats?.new_month}   color="purple" sub="過去30日間" />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <StatCard icon={Share2} label="共有棋譜数"       value={stats?.total_shares}   color="teal" />
            <StatCard icon={Mail}   label="お問い合わせ数"   value={stats?.total_contacts} color="gray" />
          </div>
        </section>

        {/* ── オンラインユーザー ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">オンライン中</h2>
            <span className="bg-green-900/50 text-green-400 text-xs px-2 py-0.5 rounded-full font-medium">
              {online.length}
            </span>
            {onlineLoading && <RefreshCw size={11} className="animate-spin text-gray-600" />}
            <span className="text-xs text-gray-700 ml-auto">30秒ごと自動更新</span>
          </div>

          {online.length === 0 ? (
            <div className="text-gray-600 text-sm py-4">現在オンラインのユーザーはいません</div>
          ) : (
            <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">ユーザー</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">接続時刻</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">接続時間</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">エージェント</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">サブ端末</th>
                  </tr>
                </thead>
                <tbody>
                  {online.map((u) => (
                    <tr key={u.userId} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <Avatar name={u.display_name} email={u.email} color={u.avatar_color} />
                            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-gray-900" />
                          </div>
                          <div>
                            {u.display_name && <div className="text-xs font-medium text-white">{u.display_name}</div>}
                            <div className="text-xs text-gray-400">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {u.connected_at
                          ? new Date(u.connected_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-green-400 font-medium">
                        {u.connected_at ? formatDuration(now - u.connected_at) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {u.agent_count > 0
                          ? <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded-full">{u.agent_count}台</span>
                          : <span className="text-xs text-gray-700">なし</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {u.passive_count > 0 ? `+${u.passive_count}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── ユーザー一覧 ── */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              ユーザー一覧
              <span className="ml-2 text-gray-700 normal-case font-normal">
                {userTotal.toLocaleString()}人
              </span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <form onSubmit={handleSearch} className="flex gap-1">
                <input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder="メール / 名前で検索"
                  className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-xs text-white
                             placeholder-gray-500 outline-none focus:border-blue-500 transition-colors w-44"
                />
                <button type="submit"
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg text-xs text-gray-300 transition-colors">
                  検索
                </button>
                {search && (
                  <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
                    className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                    ✕
                  </button>
                )}
              </form>
              <select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}
                className="bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-gray-300
                           outline-none focus:border-blue-500 transition-colors">
                <option value="created_at_desc">登録日 新しい順</option>
                <option value="created_at_asc">登録日 古い順</option>
                <option value="email_asc">メール順</option>
                <option value="kif_desc">棋譜数 多い順</option>
                <option value="tsume_desc">詰将棋数 多い順</option>
              </select>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">ユーザー</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">登録日</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">棋譜</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">詰将棋</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">認証方法</th>
                  </tr>
                </thead>
                <tbody className={usersLoading ? 'opacity-50' : ''}>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <Avatar name={u.display_name} email={u.email} color={u.avatar_color} />
                            {onlineSet.has(u.id) && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-gray-900" />
                            )}
                          </div>
                          <div className="min-w-0">
                            {u.display_name && (
                              <div className="text-xs font-medium text-white truncate">{u.display_name}</div>
                            )}
                            <div className="text-xs text-gray-400 truncate">{u.email}</div>
                            <div className="text-[10px] text-gray-700 font-mono truncate">{u.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{formatDate(u.created_at)}</td>
                      <td className="px-4 py-3 text-xs text-gray-300">{(u.kif_count || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs text-gray-300">{(u.tsume_count || 0).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {u.verified
                            ? <span className="text-[10px] bg-green-900/40 text-green-400 border border-green-900 px-1.5 py-0.5 rounded">メール認証済</span>
                            : <span className="text-[10px] bg-yellow-900/40 text-yellow-500 border border-yellow-900 px-1.5 py-0.5 rounded">未認証</span>}
                          {u.has_google
                            ? <span className="text-[10px] bg-blue-900/40 text-blue-400 border border-blue-900 px-1.5 py-0.5 rounded">Google</span>
                            : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!usersLoading && users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-gray-600 text-sm">
                        ユーザーが見つかりません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ページネーション */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {((page - 1) * LIMIT + 1).toLocaleString()}–{Math.min(page * LIMIT, userTotal).toLocaleString()} / {userTotal.toLocaleString()}件
                </span>
                <div className="flex items-center gap-1">
                  <button disabled={page <= 1} onClick={() => setPage(1)}
                    className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed
                               border border-gray-700 rounded transition-colors text-gray-400">
                    «
                  </button>
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed
                               border border-gray-700 rounded transition-colors text-gray-300">
                    前へ
                  </button>
                  <span className="px-3 py-1 text-xs text-gray-400">
                    {page} / {totalPages}
                  </span>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed
                               border border-gray-700 rounded transition-colors text-gray-300">
                    次へ
                  </button>
                  <button disabled={page >= totalPages} onClick={() => setPage(totalPages)}
                    className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed
                               border border-gray-700 rounded transition-colors text-gray-400">
                    »
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="text-xs text-gray-700 pb-8 text-center">
          オンライン情報は30秒ごとに自動更新
        </div>
      </main>
    </div>
  );
}
