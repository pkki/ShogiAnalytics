/**
 * ProfilePage.jsx
 * ユーザープロフィールページ
 * /profile/:userId  — 他人閲覧 + 自分は編集可
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Heart, Bookmark, Edit2, Check, X, Flag,
} from 'lucide-react';
import TsumeNav from '../components/TsumeNav.jsx';

const CLOUD_API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';

const AVATAR_COLORS = [
  '#2563eb','#7c3aed','#db2777','#dc2626','#d97706',
  '#16a34a','#0891b2','#475569',
];

// ── Piece display ─────────────────────────────────────────────────
const PIECE_CHAR = {
  P:'歩', L:'香', N:'桂', S:'銀', G:'金', B:'角', R:'飛', K:'玉',
  '+P':'と', '+L':'杏', '+N':'圭', '+S':'全', '+B':'馬', '+R':'竜',
};
const HAND_ORDER = ['R','B','G','S','N','L','P'];

// ── Rating → grade (将棋倶楽部24 準拠) ───────────────────────────
function ratingToGrade(r = 1500) {
  if (r >= 2500) return '九段';
  if (r >= 2400) return '八段';
  if (r >= 2300) return '七段';
  if (r >= 2200) return '六段';
  if (r >= 2100) return '五段';
  if (r >= 2000) return '四段';
  if (r >= 1900) return '三段';
  if (r >= 1800) return '二段';
  if (r >= 1700) return '初段';
  if (r >= 1600) return '一級';
  if (r >= 1500) return '二級';
  if (r >= 1400) return '三級';
  if (r >= 1300) return '四級';
  if (r >= 1200) return '五級';
  if (r >= 1100) return '六級';
  if (r >= 1000) return '七級';
  if (r >= 900)  return '八級';
  if (r >= 800)  return '九級';
  return '十級';
}

// ── Initial board & move applier (for replay) ────────────────────
const INITIAL_BOARD = [
  [{type:'L',player:2},{type:'N',player:2},{type:'S',player:2},{type:'G',player:2},{type:'K',player:2},{type:'G',player:2},{type:'S',player:2},{type:'N',player:2},{type:'L',player:2}],
  [null,{type:'R',player:2},null,null,null,null,null,{type:'B',player:2},null],
  [{type:'P',player:2},{type:'P',player:2},{type:'P',player:2},{type:'P',player:2},{type:'P',player:2},{type:'P',player:2},{type:'P',player:2},{type:'P',player:2},{type:'P',player:2}],
  [null,null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null,null],
  [null,null,null,null,null,null,null,null,null],
  [{type:'P',player:1},{type:'P',player:1},{type:'P',player:1},{type:'P',player:1},{type:'P',player:1},{type:'P',player:1},{type:'P',player:1},{type:'P',player:1},{type:'P',player:1}],
  [null,{type:'B',player:1},null,null,null,null,null,{type:'R',player:1},null],
  [{type:'L',player:1},{type:'N',player:1},{type:'S',player:1},{type:'G',player:1},{type:'K',player:1},{type:'G',player:1},{type:'S',player:1},{type:'N',player:1},{type:'L',player:1}],
];

function applyMoveToState(board, hands, move, player) {
  const nb = board.map(r => r.map(c => c ? { ...c } : null));
  const nh = { 1: { ...hands[1] }, 2: { ...hands[2] } };
  const [toR, toC] = move.to;
  if (move.from) {
    const [fr, fc] = move.from;
    const piece = nb[fr][fc];
    if (!piece) return { board: nb, hands: nh };
    const target = nb[toR][toC];
    if (target) {
      const base = target.type.startsWith('+') ? target.type.slice(1) : target.type;
      nh[player][base] = (nh[player][base] || 0) + 1;
    }
    nb[fr][fc] = null;
    const baseType = piece.type.startsWith('+') ? piece.type.slice(1) : piece.type;
    nb[toR][toC] = { type: move.promote ? '+' + baseType : piece.type, player };
  } else if (move.piece) {
    nh[player][move.piece] = Math.max(0, (nh[player][move.piece] || 0) - 1);
    nb[toR][toC] = { type: move.piece, player };
  }
  return { board: nb, hands: nh };
}

function computeGameStates(moves) {
  const states = [{
    board: INITIAL_BOARD.map(r => r.map(c => c ? { ...c } : null)),
    hands: { 1: {}, 2: {} },
  }];
  for (let i = 0; i < moves.length; i++) {
    const prev = states[i];
    states.push(applyMoveToState(prev.board, prev.hands, moves[i], i % 2 === 0 ? 1 : 2));
  }
  return states;
}

// ── Avatar ────────────────────────────────────────────────────────
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

// ── MiniBoardPreview ───────────────────────────────────────────────
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

// ── GridCard ──────────────────────────────────────────────────────
function GridCard({ token, title, numMoves, boardJson, likes, authorName, showAuthor }) {
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

// ── HandRow (for ReplayViewer) ────────────────────────────────────
function HandRow({ hands, player, name, flip }) {
  const h = hands[player] || {};
  const pieces = HAND_ORDER.filter(t => (h[t] || 0) > 0);
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 bg-gray-800/60 min-h-[36px] ${flip ? 'flex-row-reverse' : ''}`}>
      <span className="text-[10px] text-gray-500 shrink-0">{name}</span>
      <span className="text-[10px] text-gray-600 shrink-0">持</span>
      {pieces.length === 0
        ? <span className="text-[10px] text-gray-600">なし</span>
        : pieces.map(t => (
            <span key={t} className="inline-flex items-center gap-0.5">
              <span style={{
                fontWeight: 900,
                fontSize: 13,
                color: '#111',
                background: '#e8c96a',
                borderRadius: 3,
                padding: '1px 3px',
                display: 'inline-block',
                transform: flip ? 'rotate(180deg)' : 'none',
                lineHeight: 1.2,
              }}>
                {PIECE_CHAR[t] || t}
              </span>
              {h[t] > 1 && <span className="text-[10px] text-gray-400">{h[t]}</span>}
            </span>
          ))
      }
    </div>
  );
}

// ── ReplayViewer ──────────────────────────────────────────────────
function ReplayViewer({ game, onClose }) {
  const moves = useMemo(() => {
    try { return game.moves ? JSON.parse(game.moves) : []; } catch { return []; }
  }, [game.moves]);

  const states = useMemo(() => computeGameStates(moves), [moves]);
  const [idx, setIdx] = useState(0);

  const { board, hands } = states[idx];
  const senteName = game.sente_name || game.sente_email?.split('@')[0] || '先手';
  const goteName  = game.gote_name  || game.gote_email?.split('@')[0] || '後手';
  const date = game.finished_at ? new Date(game.finished_at * 1000).toLocaleDateString('ja-JP') : '';

  const btnBase = 'p-1.5 rounded text-gray-400 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed';

  // keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft')  setIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx(i => Math.min(states.length - 1, i + 1));
      if (e.key === 'Escape')     onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [states.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2"
         onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm max-h-[95vh] overflow-hidden flex flex-col shadow-2xl"
           onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 shrink-0">
          <div className="text-sm leading-tight">
            <span className="font-bold text-white">{goteName}</span>
            <span className="text-gray-500 mx-1.5 text-xs">後手</span>
            <span className="text-gray-600 mx-1">vs</span>
            <span className="text-gray-500 mx-1.5 text-xs">先手</span>
            <span className="font-bold text-white">{senteName}</span>
            {date && <span className="text-gray-600 text-xs ml-2">{date}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white ml-2 shrink-0 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Gote hand (top, flipped) */}
        <HandRow hands={hands} player={2} name={goteName} flip />

        {/* Board */}
        <div style={{ containerType: 'inline-size' }} className="px-2 shrink-0">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(9,1fr)',
            gridTemplateRows: 'repeat(9,1fr)',
            aspectRatio: '9/10',
            border: '2px solid #92400e',
          }}>
            {board.flatMap((row, r) => row.map((piece, c) => (
              <div key={`${r}-${c}`}
                style={{ background: '#e8c96a', borderRight: '1px solid #92400e30', borderBottom: '1px solid #92400e30' }}
                className="flex items-center justify-center overflow-hidden">
                {piece && (
                  <span style={{
                    fontSize: '9cqw',
                    fontWeight: 900,
                    color: piece.type.startsWith('+') ? '#c00' : '#111',
                    transform: piece.player === 2 ? 'rotate(180deg)' : 'none',
                    lineHeight: 1,
                    display: 'block',
                  }}>
                    {PIECE_CHAR[piece.type] || piece.type}
                  </span>
                )}
              </div>
            )))}
          </div>
        </div>

        {/* Sente hand (bottom) */}
        <HandRow hands={hands} player={1} name={senteName} flip={false} />

        {/* Navigation */}
        <div className="flex items-center justify-center gap-1 px-4 py-2.5 border-t border-gray-700 shrink-0">
          <button onClick={() => setIdx(0)} disabled={idx === 0} className={btnBase}>
            <ChevronsLeft size={16} />
          </button>
          <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0} className={btnBase}>
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs text-gray-400 w-24 text-center tabular-nums">
            {idx === 0 ? '初期局面' : `${idx} / ${moves.length}手`}
          </span>
          <button onClick={() => setIdx(i => Math.min(states.length - 1, i + 1))} disabled={idx === states.length - 1} className={btnBase}>
            <ChevronRight size={16} />
          </button>
          <button onClick={() => setIdx(states.length - 1)} disabled={idx === states.length - 1} className={btnBase}>
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ReportModal ───────────────────────────────────────────────────
function ReportModal({ game, reportedId, reportedName, onClose }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const myToken = localStorage.getItem('shogi_jwt');
  const myUserId = (() => {
    try { return myToken ? JSON.parse(atob(myToken.split('.')[1])).userId : null; } catch { return null; }
  })();
  const isSente = game.sente_id === myUserId;
  const date = game.finished_at ? new Date(game.finished_at * 1000).toLocaleDateString('ja-JP') : '';

  async function handleSubmit() {
    if (!reason.trim() || !myToken) return;
    setSubmitting(true);
    setErrMsg('');
    try {
      const res = await fetch(`${CLOUD_API}/api/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${myToken}` },
        body: JSON.stringify({ gameId: game.id, reportedId, reason: reason.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubmitted(true);
      } else {
        setErrMsg(data.error || '通報に失敗しました');
      }
    } catch {
      setErrMsg('通報に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl max-w-md w-full p-5 shadow-2xl"
           onClick={e => e.stopPropagation()}>
        {submitted ? (
          <div className="text-center py-4">
            <p className="text-green-400 font-bold text-lg mb-2">通報を受け付けました</p>
            <p className="text-gray-400 text-sm mb-4">内容を確認次第対応いたします。</p>
            <button onClick={onClose}
              className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm text-white transition-colors">
              閉じる
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-white text-base flex items-center gap-2">
                <Flag size={16} className="text-red-400" />
                ユーザーを通報
              </h2>
              <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="mb-4 p-3 bg-gray-800 rounded-xl text-sm">
              <p className="font-bold text-white">{reportedName}</p>
              <p className="text-gray-500 text-xs mt-0.5">対局日: {date}（{isSente ? '先手' : '後手'}）</p>
            </div>
            <label className="block text-xs text-gray-400 mb-1">
              通報理由 <span className="text-gray-600">（最大500文字）</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value.slice(0, 500))}
              placeholder="AIを使った不正が疑われる、など通報理由を詳しく記載してください"
              rows={4}
              className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2 text-sm text-white
                         resize-none focus:outline-none focus:border-blue-500 mb-1"
            />
            <p className="text-right text-xs text-gray-600 mb-3">{reason.length}/500</p>
            {errMsg && <p className="text-red-400 text-xs mb-2">{errMsg}</p>}
            <div className="flex gap-2">
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors">
                キャンセル
              </button>
              <button
                onClick={handleSubmit}
                disabled={!reason.trim() || submitting}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-sm text-white font-bold
                           transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? '送信中…' : '通報する'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── ProfilePage ───────────────────────────────────────────────────
export default function ProfilePage() {
  const { t } = useTranslation();
  const { userId }  = useParams();
  const navigate    = useNavigate();
  const [profile, setProfile] = useState(null);
  const [tsumes,  setTsumes]  = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [tab,     setTab]     = useState('posts');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [games,   setGames]   = useState([]);

  const [replayGame,  setReplayGame]  = useState(null);
  const [reportState, setReportState] = useState(null);

  const myToken = localStorage.getItem('shogi_jwt');
  const myUserId = useMemo(() => {
    try { return myToken ? JSON.parse(atob(myToken.split('.')[1])).userId : null; } catch { return null; }
  }, [myToken]);
  const isMe = myUserId === userId;

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

  const loadGames = useCallback(async () => {
    try {
      const headers = {};
      if (myToken) headers['Authorization'] = `Bearer ${myToken}`;
      const res  = await fetch(`${CLOUD_API}/api/profile/${userId}/games`, { headers });
      const data = await res.json();
      if (data.ok) setGames(data.games || []);
    } catch {}
  }, [userId, myToken]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { if (tab === 'bookmarks') loadBookmarks(); }, [tab, loadBookmarks]);
  useEffect(() => { if (tab === 'games') loadGames(); }, [tab, loadGames]);

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
  const grade    = ratingToGrade(profile?.rating);
  const wins     = profile?.wins   ?? 0;
  const losses   = profile?.losses ?? 0;
  const draws    = profile?.draws  ?? 0;
  const winRate  = (wins + losses) > 0 ? Math.round(wins / (wins + losses) * 100) : null;

  const REASON_LABEL = {
    resign: '投了', timeout: '時間切れ', checkmate: '詰み',
    disconnect: '切断', draw: '引き分け',
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white lg:ml-64 pb-20 lg:pb-4">
      <TsumeNav />

      {replayGame  && <ReplayViewer game={replayGame}  onClose={() => setReplayGame(null)} />}
      {reportState && <ReportModal  {...reportState}   onClose={() => setReportState(null)} />}

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
            <Avatar
              color={editing ? editColor : profile?.avatarColor}
              name={editing ? editName || '?' : displayName}
              size={64}
            />
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
                        outline: editColor === c ? '3px solid white' : '2px solid transparent',
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
                <p className="text-gray-300 text-sm mt-1.5 whitespace-pre-wrap">{profile.bio}</p>
              )}

              {/* ── 戦績・レーティング ── */}
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-white tabular-nums">
                    {profile?.rating ?? 1500}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 border border-yellow-500/30
                                   text-yellow-300 text-xs font-bold">
                    {grade}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span>
                    <span className="font-bold text-blue-400">{wins}</span>
                    <span className="text-gray-500 ml-0.5 text-xs">勝</span>
                  </span>
                  <span>
                    <span className="font-bold text-red-400">{losses}</span>
                    <span className="text-gray-500 ml-0.5 text-xs">敗</span>
                  </span>
                  {draws > 0 && (
                    <span>
                      <span className="font-bold text-gray-400">{draws}</span>
                      <span className="text-gray-500 ml-0.5 text-xs">引</span>
                    </span>
                  )}
                  {winRate !== null && (
                    <span className="text-gray-500 text-xs">
                      勝率 <span className="text-gray-300 font-semibold">{winRate}%</span>
                    </span>
                  )}
                  {wins + losses + draws === 0 && (
                    <span className="text-gray-600 text-xs">対局なし</span>
                  )}
                </div>
              </div>
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
          <button
            onClick={() => setTab('games')}
            className={`flex-1 py-3 text-sm font-bold transition-colors
              ${tab === 'games' ? 'text-white border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}
          >
            対局履歴
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

          {/* 投稿タブ */}
          {tab === 'posts' && (
            tsumes.length === 0
              ? <p className="text-gray-500 text-sm text-center py-8">{t('profile.noTsume')}</p>
              : <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {tsumes.map(item => (
                    <GridCard
                      key={item.token}
                      token={item.token}
                      title={item.title}
                      numMoves={item.num_moves}
                      boardJson={item.board_json}
                      likes={item.likes}
                      showAuthor={false}
                    />
                  ))}
                </div>
          )}

          {/* ブックマークタブ */}
          {tab === 'bookmarks' && (
            bookmarks.length === 0
              ? <p className="text-gray-500 text-sm text-center py-8">{t('profile.noBookmarks')}</p>
              : <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {bookmarks.map(b => (
                    <GridCard
                      key={b.token}
                      token={b.token}
                      title={b.title}
                      numMoves={b.num_moves}
                      boardJson={b.board_json}
                      likes={b.likes}
                      authorName={b.author_name}
                      showAuthor
                    />
                  ))}
                </div>
          )}

          {/* 対局履歴タブ */}
          {tab === 'games' && (
            games.length === 0
              ? <p className="text-gray-500 text-sm text-center py-8">対局履歴はありません</p>
              : <div className="flex flex-col gap-2">
                  {games.map(g => {
                    const isSente = g.sente_id === userId;
                    const myRatingBefore = isSente ? g.sente_rating_before : g.gote_rating_before;
                    const myRatingAfter  = isSente ? g.sente_rating_after  : g.gote_rating_after;
                    const oppName = isSente
                      ? (g.gote_name  || g.gote_email?.split('@')[0]  || '相手')
                      : (g.sente_name || g.sente_email?.split('@')[0] || '相手');
                    const oppId   = isSente ? g.gote_id : g.sente_id;
                    const isDraw  = g.winner === 'draw';
                    const won     = !isDraw && ((isSente && g.winner === 'sente') || (!isSente && g.winner === 'gote'));
                    const ratingDelta = myRatingAfter != null ? myRatingAfter - myRatingBefore : null;
                    const date    = g.finished_at ? new Date(g.finished_at * 1000).toLocaleDateString('ja-JP') : '';
                    const hasMoves = g.moves && g.moves.length > 2;
                    const viewerPlayed = myUserId && (g.sente_id === myUserId || g.gote_id === myUserId);
                    const canReport = myUserId && !isMe && viewerPlayed && myUserId !== oppId;

                    return (
                      <div key={g.id}
                        className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-3">
                          {/* 勝敗 */}
                          <div className={`text-sm font-bold w-7 text-center shrink-0 ${
                            isDraw ? 'text-gray-400' : won ? 'text-blue-400' : 'text-red-400'
                          }`}>
                            {isDraw ? '引' : won ? '勝' : '負'}
                          </div>

                          {/* 対局情報 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 text-sm">
                              <span className="text-gray-500 text-xs shrink-0">{isSente ? '先手' : '後手'}</span>
                              <Link to={`/profile/${oppId}`}
                                className="text-white font-bold hover:text-blue-300 truncate transition-colors">
                                {oppName}
                              </Link>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-500">{date}</span>
                              {g.reason && (
                                <span className="text-xs text-gray-600">
                                  {REASON_LABEL[g.reason] || g.reason}
                                </span>
                              )}
                              {hasMoves && (
                                <span className="text-xs text-gray-600">
                                  {(() => { try { return JSON.parse(g.moves).length; } catch { return 0; } })()}手
                                </span>
                              )}
                            </div>
                          </div>

                          {/* レーティング変動 */}
                          <div className="text-right shrink-0">
                            <div className="text-sm text-gray-300 font-mono tabular-nums">
                              {myRatingAfter ?? myRatingBefore}
                            </div>
                            {ratingDelta != null && (
                              <div className={`text-xs font-bold ${ratingDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {ratingDelta >= 0 ? '+' : ''}{ratingDelta}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* ボタン行 */}
                        {(hasMoves || canReport) && (
                          <div className="flex gap-2 mt-2 pt-2 border-t border-gray-700/60">
                            {hasMoves && (
                              <button
                                onClick={() => setReplayGame(g)}
                                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600
                                           text-xs text-gray-300 transition-colors"
                              >
                                棋譜を見る
                              </button>
                            )}
                            {canReport && (
                              <button
                                onClick={() => setReportState({ game: g, reportedId: oppId, reportedName: oppName })}
                                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-gray-700 hover:bg-red-900/40
                                           text-xs text-gray-500 hover:text-red-400 transition-colors ml-auto"
                              >
                                <Flag size={11} /> 通報
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
          )}
        </div>

      </div>
    </div>
  );
}
