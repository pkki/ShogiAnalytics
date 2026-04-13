// ============================================================
//  AuthDialog — ログイン / 新規登録 / メール認証
//  props:
//    onSuccess(token: string) — 認証完了後に呼ばれる
// ============================================================
import { useState } from 'react';

const API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:8080';

async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'サーバーエラーが発生しました');
  return json;
}

// ── 共通入力コンポーネント ──────────────────────────────────
function Input({ label, type = 'text', value, onChange, placeholder, maxLength, autoComplete }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400 font-medium tracking-wide">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete={autoComplete}
        className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white
                   placeholder-gray-500 text-sm outline-none
                   focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
      />
    </div>
  );
}

// ── エラーバナー ────────────────────────────────────────────
function ErrorBanner({ msg }) {
  if (!msg) return null;
  return (
    <div className="bg-red-900/40 border border-red-600/50 rounded-lg px-3 py-2 text-red-300 text-sm">
      {msg}
    </div>
  );
}

// ── 送信ボタン ──────────────────────────────────────────────
function SubmitBtn({ loading, children }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed
                 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          処理中…
        </span>
      ) : children}
    </button>
  );
}

// ============================================================
export default function AuthDialog({ onSuccess }) {
  // view: 'login' | 'signup' | 'verify'
  const [view,     setView]     = useState('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [code,     setCode]     = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  // verify 画面に遷移する前に email を保持するための state
  const [pendingEmail, setPendingEmail] = useState('');

  // ── ログイン ───────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await apiPost('/auth/login', { email, password });
      localStorage.setItem('shogi_jwt', res.token);
      onSuccess(res.token);
    } catch (err) {
      if (err.message.includes('認証が完了していません')) {
        setPendingEmail(email);
        setView('verify');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── 新規登録 ───────────────────────────────────────────────
  async function handleSignup(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await apiPost('/auth/signup', { email, password });
      setPendingEmail(email);
      setView('verify');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── コード認証 ─────────────────────────────────────────────
  async function handleVerify(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await apiPost('/auth/verify', { email: pendingEmail, code });
      // 認証完了 → そのままログイン
      setView('login');
      setEmail(pendingEmail);
      setPassword('');
      setCode('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── コード再送 ─────────────────────────────────────────────
  async function handleResend() {
    setError(''); setLoading(true);
    try {
      await apiPost('/auth/signup', { email: pendingEmail, password });
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── 共通ラッパー ───────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-8 shadow-2xl">

        {/* ロゴ */}
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">♟</div>
          <h1 className="text-xl font-bold text-white tracking-wide">ShogiAnalytics</h1>
          <p className="text-xs text-gray-500 mt-1">
            {view === 'login'  && 'ログインしてください'}
            {view === 'signup' && '新規アカウントを作成'}
            {view === 'verify' && 'メール認証コードを入力'}
          </p>
        </div>

        {/* ── ログイン ── */}
        {view === 'login' && (
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <ErrorBanner msg={error} />
            <Input label="メールアドレス" type="email" value={email} onChange={setEmail}
              placeholder="you@example.com" autoComplete="email" />
            <Input label="パスワード" type="password" value={password} onChange={setPassword}
              placeholder="8文字以上" autoComplete="current-password" />
            <SubmitBtn loading={loading}>ログイン</SubmitBtn>
            <button type="button" onClick={() => { setView('signup'); setError(''); }}
              className="text-center text-xs text-gray-500 hover:text-gray-300 transition-colors py-1">
              アカウントを作成 →
            </button>
          </form>
        )}

        {/* ── 新規登録 ── */}
        {view === 'signup' && (
          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            <ErrorBanner msg={error} />
            <Input label="メールアドレス" type="email" value={email} onChange={setEmail}
              placeholder="you@example.com" autoComplete="email" />
            <Input label="パスワード (8文字以上)" type="password" value={password} onChange={setPassword}
              placeholder="8文字以上" autoComplete="new-password" />
            <SubmitBtn loading={loading}>認証コードを送信</SubmitBtn>
            <button type="button" onClick={() => { setView('login'); setError(''); }}
              className="text-center text-xs text-gray-500 hover:text-gray-300 transition-colors py-1">
              ← ログインに戻る
            </button>
          </form>
        )}

        {/* ── メール認証 ── */}
        {view === 'verify' && (
          <form onSubmit={handleVerify} className="flex flex-col gap-4">
            <div className="bg-blue-900/30 border border-blue-600/40 rounded-lg px-3 py-2 text-blue-300 text-xs">
              <strong>{pendingEmail}</strong> に6桁の認証コードを送信しました
            </div>
            <ErrorBanner msg={error} />
            <Input label="認証コード (6桁)" type="text" value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456" maxLength={6} autoComplete="one-time-code" />
            <SubmitBtn loading={loading}>認証して続ける</SubmitBtn>
            <div className="flex gap-2 justify-center text-xs text-gray-500">
              <button type="button" onClick={handleResend}
                className="hover:text-gray-300 transition-colors">
                コードを再送
              </button>
              <span>·</span>
              <button type="button" onClick={() => { setView('login'); setError(''); }}
                className="hover:text-gray-300 transition-colors">
                ← 戻る
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
