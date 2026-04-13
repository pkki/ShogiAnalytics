import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import Turnstile from '../components/Turnstile';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

const API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:8080';

async function apiPost(path, body, errorFallback = 'Server error') {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || errorFallback);
  return json;
}

function Input({ label, type = 'text', value, onChange, placeholder, maxLength, autoComplete }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400 font-medium tracking-wide">{label}</label>
      <input
        type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} maxLength={maxLength} autoComplete={autoComplete}
        className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white
                   placeholder-gray-500 text-sm outline-none
                   focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
      />
    </div>
  );
}

function ErrorBanner({ msg }) {
  if (!msg) return null;
  return (
    <div className="bg-red-900/40 border border-red-600/50 rounded-lg px-3 py-2 text-red-300 text-sm">
      {msg}
    </div>
  );
}

function SubmitBtn({ loading, disabled, children }) {
  const { t } = useTranslation();
  return (
    <button type="submit" disabled={loading || disabled}
      className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed
                 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors">
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          {t('login.processing')}
        </span>
      ) : children}
    </button>
  );
}

export default function LoginPage({ onSuccess }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState(searchParams.get('mode') === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [tsToken, setTsToken] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const googleBtnRef = useRef(null);

  // Google Sign-In ボタンの初期化
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCallback,
    });
    if (googleBtnRef.current) {
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'filled_black', size: 'large', width: 320,
        locale: t('common.language') === 'Language' ? 'en' : 'ja',
        text: 'continue_with',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  async function handleGoogleCallback({ credential }) {
    setError(''); setLoading(true);
    try {
      const res = await apiPost('/auth/google', { idToken: credential });
      localStorage.setItem('shogi_jwt', res.token);
      onSuccess?.(res.token);
      navigate('/app');
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  const hasTurnstile = !!import.meta.env.VITE_TURNSTILE_SITE_KEY;

  const handleTsVerify = useCallback((token) => setTsToken(token), []);
  const handleTsExpire = useCallback(() => setTsToken(''), []);

  async function handleLogin(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await apiPost('/auth/login', { email, password, turnstileToken: tsToken });
      localStorage.setItem('shogi_jwt', res.token);
      onSuccess?.(res.token);
      navigate('/app');
    } catch (err) {
      if (err.message.includes('認証が完了していません')) {
        setPendingEmail(email);
        setView('verify');
      } else {
        setError(err.message);
        setTsToken('');
        window.turnstile?.reset?.();
      }
    } finally { setLoading(false); }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await apiPost('/auth/signup', { email, password, turnstileToken: tsToken });
      setPendingEmail(email);
      setView('verify');
    } catch (err) {
      setError(err.message);
      setTsToken('');
      window.turnstile?.reset?.();
    } finally { setLoading(false); }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await apiPost('/auth/verify', { email: pendingEmail, code });
      setView('login');
      setEmail(pendingEmail);
      setPassword('');
      setCode('');
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  async function handleResend() {
    setError(''); setLoading(true);
    try {
      await apiPost('/auth/signup', { email: pendingEmail, password });
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  const canSubmit = (!hasTurnstile || !!tsToken);
  const canSignup = canSubmit && agreedToTerms;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <Helmet>
        <title>{t('login.title')}</title>
        <meta name="description" content={t('login.description')} />
        <link rel="canonical" href="https://analytics.pkkis.com/login" />
        <meta property="og:title" content={t('login.title')} />
        <meta property="og:url" content="https://analytics.pkkis.com/login" />
        <meta name="robots" content="noindex" />
      </Helmet>
      {/* ヘッダー */}
      <header className="px-6 py-4 border-b border-gray-800">
        <Link to="/" className="flex items-center gap-2 w-fit">
          <img src="/icons/icon-192x192.png" className="w-7 h-7" alt={t('appName')} />
          <span className="font-bold text-white text-sm tracking-wide">{t('appName')}</span>
        </Link>
      </header>

      {/* メインカード */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-8 shadow-2xl">

          {/* ロゴ */}
          <div className="text-center mb-6">
            <div className="flex justify-center mb-3">
              <img src="/icons/icon-192x192.png" className="w-12 h-12" alt={t('appName')} />
            </div>
            <h1 className="text-xl font-bold text-white tracking-wide">{t('appName')}</h1>
            <p className="text-xs text-gray-500 mt-1">
              {view === 'login'  && t('login.loginPrompt')}
              {view === 'signup' && t('login.signupPrompt')}
              {view === 'verify' && t('login.verifyPrompt')}
            </p>
          </div>

          {/* ── Google ボタン (login / signup 共通) ── */}
          {GOOGLE_CLIENT_ID && view !== 'verify' && (
            <div className="flex flex-col gap-3 mb-4">
              <ErrorBanner msg={error} />
              <div ref={googleBtnRef} className="flex justify-center" />
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-700" />
                <span className="text-xs text-gray-500">{t('login.or')}</span>
                <div className="flex-1 h-px bg-gray-700" />
              </div>
            </div>
          )}

          {/* ── ログイン ── */}
          {view === 'login' && (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              {!GOOGLE_CLIENT_ID && <ErrorBanner msg={error} />}
              <Input label={t('login.email')} type="email" value={email} onChange={setEmail}
                placeholder="you@example.com" autoComplete="email" />
              <Input label={t('login.password')} type="password" value={password} onChange={setPassword}
                placeholder={t('login.passwordPlaceholder')} autoComplete="current-password" />
              <Turnstile onVerify={handleTsVerify} onExpire={handleTsExpire} />
              <SubmitBtn loading={loading} disabled={!canSubmit}>{t('login.login')}</SubmitBtn>
              <button type="button" onClick={() => { setView('signup'); setError(''); setTsToken(''); }}
                className="text-center text-xs text-gray-500 hover:text-gray-300 transition-colors py-1">
                {t('login.createAccount')}
              </button>
            </form>
          )}

          {/* ── 新規登録 ── */}
          {view === 'signup' && (
            <form onSubmit={handleSignup} className="flex flex-col gap-4">
              {!GOOGLE_CLIENT_ID && <ErrorBanner msg={error} />}
              <Input label={t('login.email')} type="email" value={email} onChange={setEmail}
                placeholder="you@example.com" autoComplete="email" />
              <Input label={t('login.passwordHint')} type="password" value={password} onChange={setPassword}
                placeholder={t('login.passwordPlaceholder')} autoComplete="new-password" />
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={agreedToTerms}
                  onChange={e => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-blue-500 shrink-0 cursor-pointer" />
                <span className="text-xs text-gray-400 leading-relaxed">
                  <Link to="/terms" target="_blank"
                    className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-0.5">
                    {t('login.terms')}<ExternalLink size={10} />
                  </Link>
                  {' '}{t('login.and')}{' '}
                  <Link to="/privacy" target="_blank"
                    className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-0.5 mx-0.5">
                    {t('login.privacy')}<ExternalLink size={10} />
                  </Link>
                  {t('login.agreeTerms')}
                </span>
              </label>
              <Turnstile onVerify={handleTsVerify} onExpire={handleTsExpire} />
              <SubmitBtn loading={loading} disabled={!canSignup}>{t('login.signup')}</SubmitBtn>
              <button type="button" onClick={() => { setView('login'); setError(''); setTsToken(''); }}
                className="text-center text-xs text-gray-500 hover:text-gray-300 transition-colors py-1">
                {t('login.backToLogin')}
              </button>
            </form>
          )}

          {/* ── メール認証 ── */}
          {view === 'verify' && (
            <form onSubmit={handleVerify} className="flex flex-col gap-4">
              <div className="bg-blue-900/30 border border-blue-600/40 rounded-lg px-3 py-2 text-blue-300 text-xs">
                <strong>{pendingEmail}</strong> {t('login.verifyCodeSent')}
              </div>
              <ErrorBanner msg={error} />
              <Input label={t('login.verifyCode')} type="text" value={code}
                onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456" maxLength={6} autoComplete="one-time-code" />
              <SubmitBtn loading={loading}>{t('login.verify')}</SubmitBtn>
              <div className="flex gap-2 justify-center text-xs text-gray-500">
                <button type="button" onClick={handleResend}
                  className="hover:text-gray-300 transition-colors">
                  {t('login.resend')}
                </button>
                <span>·</span>
                <button type="button" onClick={() => { setView('login'); setError(''); }}
                  className="hover:text-gray-300 transition-colors">
                  {t('login.backBtn')}
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
