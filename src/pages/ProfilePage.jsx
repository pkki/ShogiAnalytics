/**
 * ProfilePage.jsx
 * ユーザープロフィールページ
 * /profile/:userId  — 他人閲覧 + 自分は編集可
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Heart, Bookmark, Edit2, Check, X, ChevronRight } from 'lucide-react';
import TsumeNav from '../components/TsumeNav.jsx';

const CLOUD_API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';

const AVATAR_COLORS = [
  '#2563eb','#7c3aed','#db2777','#dc2626','#d97706',
  '#16a34a','#0891b2','#475569',
];

function Avatar({ color, name, size = 48 }) {
  const initial = (name || '?')[0].toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{ width: size, height: size, background: color || '#2563eb', fontSize: size * 0.42 }}
    >
      {initial}
    </div>
  );
}

const PIECE_CHAR_P = { P:'歩',L:'香',N:'桂',S:'銀',G:'金',B:'角',R:'飛',K:'玉',
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
              {PIECE_CHAR_P[piece.type] || piece.type}
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

function GridCard({ token, title, createdAt, numMoves, boardJson, likes, bookmarks, authorName, showAuthor }) {
  const board = (() => {
    try { return boardJson ? JSON.parse(boardJson) : null; } catch { return null; }
  })();
  return (
    <Link
      to={`/tsume/${token}`}
      className="block bg-gray-800 border border-gray-700 hover:border-gray-500
                 rounded-xl overflow-hidden transition-all group"
    >
      <div className="p-3 bg-amber-950/20">
        <MiniBoardPreview boardJson={boardJson} />
      </div>
      <div className="px-2 pb-2 pt-1">
        {showAuthor && authorName && (
          <p className="text-[10px] text-gray-500 mb-0.5 truncate">{authorName} 作</p>
        )}
        <p className="text-xs text-white group-hover:text-blue-300 transition-colors leading-snug line-clamp-2">
          {title}
        </p>
        <div className="flex items-center justify-between mt-1">
          {numMoves > 0 && (
            <span className="text-[10px] bg-gray-700 text-gray-400 rounded-full px-1.5 py-0.5">
              {numMoves}手
            </span>
          )}
          <span className="text-[10px] text-red-400 flex items-center gap-0.5 ml-auto">
            <Heart size={9} /> {likes}
          </span>
        </div>
      </div>
    </Link>
  );
}

function TsumeCard({ token, title, createdAt, numMoves, boardJson, likes, bookmarks, authorName, showAuthor }) {
  const date = createdAt ? new Date(createdAt * 1000).toLocaleDateString('ja-JP') : '';
  return (
    <Link
      to={`/tsume/${token}`}
      className="flex bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500
                 rounded-xl overflow-hidden transition-all group"
    >
      {/* ミニ盤面 */}
      <div className="w-20 shrink-0 p-1.5 bg-amber-950/20">
        <MiniBoardPreview boardJson={boardJson} />
      </div>
      {/* テキスト情報 */}
      <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
        <div>
          {showAuthor && authorName && (
            <p className="text-xs text-gray-500 mb-0.5 truncate">{authorName} 作</p>
          )}
          <p className="font-bold text-white group-hover:text-blue-300 transition-colors text-sm leading-snug line-clamp-2">{title}</p>
          {numMoves > 0 && (
            <span className="inline-block mt-1 text-xs bg-gray-700 text-gray-300 rounded-full px-2 py-0.5">{numMoves}手詰め</span>
          )}
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-gray-600">{date}</p>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="flex items-center gap-0.5"><Heart size={11} className="text-red-400" /> {likes}</span>
            <span className="flex items-center gap-0.5"><Bookmark size={11} className="text-blue-400" /> {bookmarks}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function ProfilePage() {
  const { t } = useTranslation();
  const { userId }  = useParams();
  const navigate    = useNavigate();
  const [profile, setProfile] = useState(null);
  const [tsumes,  setTsumes]  = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [tab,     setTab]     = useState('posts'); // 'posts' | 'bookmarks'
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // 自分かどうか
  const myToken = localStorage.getItem('shogi_jwt');
  const myUserId = (() => {
    try { return myToken ? JSON.parse(atob(myToken.split('.')[1])).userId : null; } catch { return null; }
  })();
  const isMe = myUserId === userId;

  // プロフィール編集状態
  const [editing, setEditing] = useState(false);
  const [editName,  setEditName]  = useState('');
  const [editBio,   setEditBio]   = useState('');
  const [editColor, setEditColor] = useState('#2563eb');
  const [saving, setSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const headers = {};
      if (myToken) headers['Authorization'] = `Bearer ${myToken}`;
      const res  = await fetch(`${CLOUD_API}/api/profile/${userId}`, { headers });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setProfile(data.profile);
      setTsumes(data.tsumes || []);
      setEditName(data.profile.displayName || '');
      setEditBio(data.profile.bio || '');
      setEditColor(data.profile.avatarColor || '#2563eb');
    } catch {
      setError(t('profile.loadError'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadBookmarks = useCallback(async () => {
    if (!isMe || !myToken) return;
    try {
      const res  = await fetch(`${CLOUD_API}/api/profile/${userId}/bookmarks`, {
        headers: { Authorization: `Bearer ${myToken}` },
      });
      const data = await res.json();
      if (data.ok) setBookmarks(data.bookmarks || []);
    } catch {}
  }, [userId, isMe, myToken]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { if (tab === 'bookmarks') loadBookmarks(); }, [tab, loadBookmarks]);

  async function handleSaveProfile() {
    if (!myToken) return;
    setSaving(true);
    try {
      await fetch(`${CLOUD_API}/api/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${myToken}` },
        body: JSON.stringify({ displayName: editName, bio: editBio, avatarColor: editColor }),
      });
      setProfile(p => ({ ...p, displayName: editName, bio: editBio, avatarColor: editColor }));
      setEditing(false);
    } catch {
      alert(t('profile.saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center lg:ml-64">
      <TsumeNav />
      <svg className="animate-spin w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
      </svg>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4 lg:ml-64">
      <TsumeNav />
      <div className="text-center">
        <p className="text-red-400">{error}</p>
        <Link to="/" className="text-blue-400 text-sm mt-2 block">{t('profile.backToTop')}</Link>
      </div>
    </div>
  );

  const displayName = profile?.displayName || profile?.email?.split('@')[0] || t('profile.anonymous');

  return (
    <div className="min-h-screen bg-gray-900 text-white lg:ml-64">
      <TsumeNav />
      <Helmet>
        <title>{displayName}{t('profile.title')}</title>
      </Helmet>

      {/* ヘッダー */}
      <div className="border-b border-gray-700 bg-gray-900/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div>
            <p className="font-bold text-white leading-none">{displayName}</p>
            <p className="text-xs text-gray-500 mt-0.5">{tsumes.length}{t('profile.tsumeCount')}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto">

        {/* プロフィールヘッダー */}
        <div className="px-4 pt-5 pb-4 border-b border-gray-700">
          <div className="flex items-start justify-between gap-4">
            <Avatar color={editing ? editColor : profile?.avatarColor} name={editing ? editName || '?' : displayName} size={64} />

            {isMe && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-500
                           text-gray-300 text-sm hover:bg-gray-800 transition-colors"
              >
                <Edit2 size={13} /> {t('profile.editProfile')}
              </button>
            )}
            {isMe && editing && (
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)}
                  className="p-2 rounded-full border border-gray-600 text-gray-400 hover:bg-gray-800 transition-colors">
                  <X size={14} />
                </button>
                <button onClick={handleSaveProfile} disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500
                             text-white text-sm font-bold transition-colors disabled:opacity-60">
                  <Check size={14} /> {saving ? `${t('profile.save')}…` : t('profile.save')}
                </button>
              </div>
            )}
          </div>

          {editing ? (
            <div className="mt-3 flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{t('profile.displayName')} (30)</label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value.slice(0, 30))}
                  placeholder={t('profile.displayName')}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                             focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{t('profile.bio')} (160)</label>
                <textarea
                  value={editBio}
                  onChange={e => setEditBio(e.target.value.slice(0, 160))}
                  rows={3}
                  placeholder={t('profile.bio')}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                             focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-2 block">{t('profile.avatarColor')}</label>
                <div className="flex gap-2 flex-wrap">
                  {AVATAR_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setEditColor(c)}
                      className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                      style={{
                        background: c,
                        outline: editColor === c ? `3px solid white` : '2px solid transparent',
                        outlineOffset: 2,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <p className="font-bold text-white text-lg leading-tight">{displayName}</p>
              {profile?.bio && (
                <p className="text-gray-300 text-sm mt-2 whitespace-pre-wrap">{profile.bio}</p>
              )}
            </div>
          )}
        </div>

        {/* タブ */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setTab('posts')}
            className={`flex-1 py-3 text-sm font-bold transition-colors
              ${tab === 'posts' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}
          >
            {t('profile.posts')}
          </button>
          {isMe && (
            <button
              onClick={() => setTab('bookmarks')}
              className={`flex-1 py-3 text-sm font-bold transition-colors
                ${tab === 'bookmarks' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {t('profile.bookmarks')}
            </button>
          )}
        </div>

        {/* コンテンツ */}
        <div className="py-3 px-4">
          {tab === 'posts' && (
            tsumes.length === 0
              ? <p className="text-gray-500 text-sm text-center py-8">{t('profile.noTsume')}</p>
              : <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {tsumes.map(t => (
                    <GridCard
                      key={t.token}
                      token={t.token}
                      title={t.title}
                      createdAt={t.created_at}
                      numMoves={t.num_moves}
                      boardJson={t.board_json}
                      likes={t.likes}
                      bookmarks={t.bookmarks}
                      showAuthor={false}
                    />
                  ))}
                </div>
          )}
          {tab === 'bookmarks' && (
            bookmarks.length === 0
              ? <p className="text-gray-500 text-sm text-center py-8">{t('profile.noBookmarks')}</p>
              : <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {bookmarks.map(b => (
                    <GridCard
                      key={b.token}
                      token={b.token}
                      title={b.title}
                      createdAt={b.created_at}
                      numMoves={b.num_moves}
                      boardJson={b.board_json}
                      likes={b.likes}
                      bookmarks={null}
                      authorName={b.author_name}
                      showAuthor
                    />
                  ))}
                </div>
          )}
        </div>

      </div>
    </div>
  );
}