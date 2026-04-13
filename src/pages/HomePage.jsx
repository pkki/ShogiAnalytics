import { useState, useEffect, useRef, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BarChart2, Cpu, Cloud, Smartphone, GitBranch,
  TrendingUp, ArrowRight, CheckCircle, Zap, BookOpen,
  Mail, Users, Shield, Clock, ChevronDown,
  Globe, Lock, Terminal, Home, Send, Loader2, Swords, Menu, X,
} from 'lucide-react';
import Turnstile from '../components/Turnstile';

const API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:8080';

// ── タイピングアニメーション ─────────────────────────────────
function useTyping(phrases, speed = 80, pause = 2400) {
  const [text, setText] = useState('');
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const current = phrases[phraseIdx];
    let id;
    if (!deleting && text === current) {
      id = setTimeout(() => setDeleting(true), pause);
    } else if (deleting && text === '') {
      setDeleting(false);
      setPhraseIdx(i => (i + 1) % phrases.length);
    } else {
      id = setTimeout(() => setText(prev =>
        deleting ? prev.slice(0, -1) : current.slice(0, prev.length + 1)
      ), deleting ? speed / 2 : speed);
    }
    return () => clearTimeout(id);
  }, [text, deleting, phraseIdx, phrases, speed, pause]);
  return text;
}

// ── スクロール検知 ───────────────────────────────────────────
function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setInView(true); },
      { threshold }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView];
}

// ── カウントアップ ───────────────────────────────────────────
function useCounter(target, duration, active) {
  const [count, setCount] = useState(0);
  const t0 = useRef(null);
  const raf = useRef(null);
  useEffect(() => {
    if (!active || target === 0) { setCount(target); return; }
    t0.current = null;
    const tick = (ts) => {
      if (!t0.current) t0.current = ts;
      const p = Math.min((ts - t0.current) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setCount(Math.floor(e * target));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active, target, duration]);
  return count;
}

// ── スタッツカード (数値) ────────────────────────────────────
function StatCard({ value, suffix, label, duration = 1800 }) {
  const [ref, inView] = useInView(0.3);
  const count = useCounter(value, duration, inView);
  return (
    <div ref={ref}
      className="text-center p-6 rounded-2xl bg-gray-800/40 border border-gray-700/50
                 hover:border-blue-500/40 transition-all duration-500"
      style={{ opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateY(16px)',
               transition: 'opacity .6s ease, transform .6s ease, border-color .3s' }}>
      <div className="text-4xl md:text-5xl font-black mb-1"
        style={{ background: 'linear-gradient(135deg,#60a5fa,#22d3ee)',
                 WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
        {count.toLocaleString()}{suffix}
      </div>
      <div className="text-gray-400 text-sm">{label}</div>
    </div>
  );
}

// ── スタッツカード (テキスト) ────────────────────────────────
function StatCardText({ val, label }) {
  const [ref, inView] = useInView(0.3);
  return (
    <div ref={ref}
      className="text-center p-6 rounded-2xl bg-gray-800/40 border border-gray-700/50
                 hover:border-blue-500/40 transition-all duration-500"
      style={{ opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateY(16px)',
               transition: 'opacity .6s ease, transform .6s ease, border-color .3s' }}>
      <div className="text-2xl md:text-3xl font-black font-mono mb-1"
        style={{ background: 'linear-gradient(135deg,#60a5fa,#22d3ee)',
                 WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
        {val}
      </div>
      <div className="text-gray-400 text-sm">{label}</div>
    </div>
  );
}

// ── 特徴カード ───────────────────────────────────────────────
function FeatureCard({ icon, title, desc, delay = 0 }) {
  const [ref, inView] = useInView(0.1);
  return (
    <div ref={ref}
      className="bg-gray-800/60 border border-gray-700/60 rounded-2xl p-6 relative overflow-hidden
                 hover:border-blue-500/50 hover:bg-gray-800/80 transition-all duration-300 group"
      style={{ opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateY(28px)',
               transition: `opacity .6s ease ${delay}ms, transform .6s ease ${delay}ms, border-color .3s` }}>
      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full
                      -translate-y-16 translate-x-16 group-hover:bg-blue-500/10 transition-colors duration-500" />
      <div className="w-12 h-12 bg-blue-600/15 border border-blue-500/30 rounded-xl
                      flex items-center justify-center mb-4
                      group-hover:bg-blue-600/25 group-hover:border-blue-500/60
                      group-hover:scale-110 transition-all duration-300">
        {icon}
      </div>
      <h3 className="text-white font-bold text-base mb-2">{title}</h3>
      <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

// ── ステップ ─────────────────────────────────────────────────
function Step({ n, total, icon, title, desc, detail }) {
  return (
    <div className="flex gap-5 group">
      <div className="flex flex-col items-center">
        <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-black text-sm
                        flex items-center justify-center shrink-0
                        group-hover:bg-blue-500 group-hover:scale-110 transition-all duration-300
                        shadow-lg shadow-blue-600/30">
          {n}
        </div>
        {n < total && (
          <div className="w-px flex-1 mt-2"
            style={{ background: 'linear-gradient(to bottom, #2563eb, transparent)' }} />
        )}
      </div>
      <div className="pb-10">
        <div className="flex items-center gap-2 mb-1.5">{icon}
          <h4 className="text-white font-bold text-base">{title}</h4>
        </div>
        <p className="text-gray-400 text-sm leading-relaxed mb-3">{desc}</p>
        {detail && (
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3
                          text-xs text-gray-500 leading-relaxed">{detail}</div>
        )}
      </div>
    </div>
  );
}

// ── FAQ アコーディオン ────────────────────────────────────────
function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-700/60 rounded-xl overflow-hidden hover:border-gray-600/60 transition-colors">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left
                   hover:bg-gray-800/50 transition-colors gap-4">
        <span className="text-white text-sm font-medium">{q}</span>
        <ChevronDown size={15}
          className={`text-gray-400 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ${open ? 'max-h-64' : 'max-h-0'}`}>
        <div className="px-5 pb-4 pt-3 text-gray-400 text-sm leading-relaxed border-t border-gray-700/40">
          {a}
        </div>
      </div>
    </div>
  );
}

// ── お問い合わせフォーム ─────────────────────────────────────
function ContactForm() {
  const { t } = useTranslation();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('shogi_jwt') : null;
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [tsToken, setTsToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // 'ok' | 'error'
  const [errMsg, setErrMsg] = useState('');

  const hasTurnstile = !!import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const canSubmit = !hasTurnstile || !!tsToken;

  const handleTsVerify = useCallback((tk) => setTsToken(tk), []);
  const handleTsExpire = useCallback(() => setTsToken(''), []);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setResult(null);
    try {
      const res = await fetch(`${API}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subject, body, turnstileToken: tsToken }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrMsg(json.error || t('home.contact.error'));
        setResult('error');
        setTsToken('');
        window.turnstile?.reset?.();
      } else {
        setResult('ok');
        setSubject('');
        setBody('');
        setTsToken('');
      }
    } catch {
      setErrMsg(t('home.contact.networkError')); setResult('error');
    } finally { setLoading(false); }
  }

  if (!token) {
    return (
      <div className="bg-gray-800/40 border border-gray-700/60 rounded-2xl p-8 text-center">
        <Mail size={32} className="text-blue-400 mx-auto mb-3" />
        <p className="text-gray-300 text-sm mb-4">
          {t('home.contact.loginRequired')}
        </p>
        <Link to="/login"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white
                     font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors">
          {t('home.contact.loginBtn')}
          <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  if (result === 'ok') {
    return (
      <div className="bg-green-900/20 border border-green-600/40 rounded-2xl p-8 text-center">
        <CheckCircle size={32} className="text-green-400 mx-auto mb-3" />
        <p className="text-green-300 font-semibold mb-1">{t('home.contact.sent')}</p>
        <p className="text-gray-400 text-sm">{t('home.contact.sentDesc')}</p>
        <button onClick={() => setResult(null)}
          className="mt-4 text-xs text-gray-500 hover:text-gray-300 transition-colors underline">
          {t('home.contact.sendAnother')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {result === 'error' && (
        <div className="bg-red-900/30 border border-red-600/40 rounded-xl px-4 py-3 text-red-300 text-sm">
          {errMsg}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-gray-400 font-medium">{t('home.contact.subject')}</label>
        <input value={subject} onChange={e => setSubject(e.target.value)}
          placeholder={t('home.contact.subjectPlaceholder')} maxLength={100} required
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white text-sm
                     placeholder-gray-500 outline-none focus:border-blue-500 focus:ring-1
                     focus:ring-blue-500 transition-colors" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-gray-400 font-medium">{t('home.contact.body')}</label>
        <textarea value={body} onChange={e => setBody(e.target.value)}
          placeholder={t('home.contact.bodyPlaceholder')} maxLength={3000} required rows={5}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white text-sm
                     placeholder-gray-500 outline-none focus:border-blue-500 focus:ring-1
                     focus:ring-blue-500 transition-colors resize-none" />
        <p className="text-xs text-gray-600 text-right">{body.length} / 3000</p>
      </div>
      <Turnstile onVerify={handleTsVerify} onExpire={handleTsExpire} />
      <button type="submit" disabled={loading || !canSubmit}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500
                   disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold
                   rounded-lg py-3 text-sm transition-colors">
        {loading ? <><Loader2 size={15} className="animate-spin" />{t('home.contact.submitting')}</> : <><Send size={15} />{t('home.contact.submit')}</>}
      </button>
    </form>
  );
}

// ── メインコンポーネント ─────────────────────────────────────
export default function HomePage() {
  const { t, i18n } = useTranslation();
  const isJa = i18n.language === 'ja' || i18n.language?.startsWith('ja-');
  const typingPhrases = t('home.typingWords', { returnObjects: true });
  const typedText = useTyping(Array.isArray(typingPhrases) ? typingPhrases : ['外出先で', 'スマホでも', 'どこでも']);
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userCount, setUserCount] = useState(null);
  const isLoggedIn = !!localStorage.getItem('shogi_jwt');

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  useEffect(() => {
    fetch(`${API}/api/stats`)
      .then(r => r.json())
      .then(d => setUserCount(d.users ?? 0))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white overflow-x-hidden">
      <Helmet>
        <html lang={t('common.language') === 'Language' ? 'en' : 'ja'} />
        <title>{t('appName')} | {t('appTagline')}</title>
        <meta name="description" content={t('appDescription')} />
        <link rel="canonical" href="https://analytics.pkkis.com/" />
        <meta property="og:title" content={`${t('appName')} | ${t('appTagline')}`} />
        <meta property="og:description" content={t('appDescription')} />
        <meta property="og:url" content="https://analytics.pkkis.com/" />
        <meta property="og:type" content="website" />
      </Helmet>

      {/* ══ グローバル CSS ══ */}
      <style>{`
        @keyframes glowPulse {
          0%,100% { opacity:.1; transform:scale(1); }
          50%      { opacity:.2; transform:scale(1.05); }
        }
        @keyframes blinkCursor {
          0%,100% { opacity:1; } 50% { opacity:0; }
        }
        @keyframes shimmer {
          0%   { background-position:-200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes particleRise {
          0%   { transform:translateY(0) scale(0); opacity:0; }
          8%   { opacity:.6; }
          90%  { opacity:.4; }
          100% { transform:translateY(-100vh) scale(1.2); opacity:0; }
        }
        @keyframes gridMove {
          0%   { background-position:0 0; }
          100% { background-position:40px 40px; }
        }
        @keyframes graphDraw {
          from { stroke-dashoffset:600; }
          to   { stroke-dashoffset:0; }
        }
        @keyframes scanLine {
          0%   { top:-2px; opacity:0; }
          4%   { opacity:1; }
          96%  { opacity:1; }
          100% { top:100%; opacity:0; }
        }
        .glow-pulse { animation: glowPulse 4s ease-in-out infinite; }
        .cursor-blink { animation: blinkCursor 1s step-end infinite; }
        .shimmer-text {
          background: linear-gradient(90deg,#60a5fa 0%,#22d3ee 25%,#a78bfa 50%,#22d3ee 75%,#60a5fa 100%);
          background-size: 200% auto;
          -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;
          animation: shimmer 5s linear infinite;
        }
        .grid-bg {
          background-image:
            linear-gradient(rgba(59,130,246,.07) 1px,transparent 1px),
            linear-gradient(90deg,rgba(59,130,246,.07) 1px,transparent 1px);
          background-size:40px 40px;
          animation: gridMove 10s linear infinite;
        }
        .graph-line {
          stroke-dasharray:600; stroke-dashoffset:600;
          animation: graphDraw 2.5s ease-out .3s forwards;
        }
        .scan-line {
          position:absolute; left:0; right:0; height:2px;
          background:linear-gradient(90deg,transparent,rgba(59,130,246,.5),transparent);
          animation: scanLine 4s ease-in-out infinite;
        }
      `}</style>

      {/* ══ ヘッダー ════════════════════════════════════════════ */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300
                         ${scrolled
                           ? 'bg-gray-950/95 backdrop-blur-md border-b border-gray-800/80 shadow-xl shadow-black/30'
                           : 'bg-transparent'}`}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          {/* ロゴ */}
          <div className="flex items-center gap-2.5 shrink-0">
            <img src="/icons/icon-192x192.png" className="w-8 h-8" alt={t('appName')} />
            <span className="font-bold text-white tracking-wide text-sm">{t('appName')}</span>
          </div>

          {/* PC ナビ */}
          <nav className="hidden md:flex items-center gap-7">
            {[
              ['#features', t('nav.features')],
              ['#howto',    t('nav.howto')],
              ['#faq',      t('nav.faq')],
              ['#contact',  t('nav.contact')],
            ].map(([h,l]) => (
              <a key={h} href={h} className="text-xs text-gray-400 hover:text-white transition-colors tracking-wide">{l}</a>
            ))}
            <Link to="/tsume/category/all" className="text-xs text-amber-400 hover:text-amber-300 transition-colors tracking-wide font-medium">
              {t('nav.tsumeList')}
            </Link>
          </nav>

          {/* 右側コントロール */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 言語切替（常時表示） */}
            <button
              onClick={() => i18n.changeLanguage(isJa ? 'en' : 'ja')}
              title={isJa ? 'Switch to English' : '日本語に切り替え'}
              className="px-2 py-1 rounded-lg text-xs font-bold border border-gray-600 text-gray-400
                         hover:border-blue-500 hover:text-blue-300 transition-colors">
              {isJa ? 'EN' : 'JA'}
            </button>

            {/* PC: ログイン/開くボタン */}
            {isLoggedIn ? (
              <Link to="/app"
                className="hidden md:inline-flex text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold
                           px-4 py-2 rounded-lg transition-all shadow-lg shadow-blue-600/30
                           hover:shadow-blue-600/50 hover:scale-105">
                {t('nav.openApp')}
              </Link>
            ) : (
              <>
                <Link to="/login" className="hidden md:inline-flex text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5">
                  {t('nav.login')}
                </Link>
                <Link to="/login?mode=signup"
                  className="hidden md:inline-flex text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold
                             px-4 py-2 rounded-lg transition-all shadow-lg shadow-blue-600/30
                             hover:shadow-blue-600/50 hover:scale-105">
                  {t('nav.startFree')}
                </Link>
              </>
            )}

            {/* スマホ: ハンバーガーボタン */}
            <button
              onClick={() => setMobileMenuOpen(v => !v)}
              className="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              aria-label={t('nav.menu')}
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* スマホ ドロップダウンメニュー */}
        <div className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out
          ${mobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="bg-gray-950 border-t border-gray-800 px-4 py-4 flex flex-col gap-1">
            {[
              ['#features', t('nav.features')],
              ['#howto',    t('nav.howto')],
              ['#faq',      t('nav.faq')],
              ['#contact',  t('nav.contact')],
            ].map(([h,l]) => (
              <a key={h} href={h} onClick={() => setMobileMenuOpen(false)}
                className="text-sm text-gray-300 hover:text-white px-3 py-2.5 rounded-lg hover:bg-gray-800 transition-colors">
                {l}
              </a>
            ))}
            <Link to="/tsume/category/all" onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2 text-sm text-amber-400 hover:text-amber-300 px-3 py-2.5 rounded-lg hover:bg-gray-800 transition-colors font-medium">
              <Swords size={14} />{t('nav.tsumeList')}
            </Link>
            <div className="border-t border-gray-800 mt-1 pt-3 flex flex-col gap-2">
              {isLoggedIn ? (
                <Link to="/app" onClick={() => setMobileMenuOpen(false)}
                  className="text-sm bg-blue-600 hover:bg-blue-500 text-white font-bold
                             px-4 py-2.5 rounded-lg text-center transition-colors">
                  {t('nav.openApp')}
                </Link>
              ) : (
                <>
                  <Link to="/login" onClick={() => setMobileMenuOpen(false)}
                    className="text-sm text-gray-300 hover:text-white px-3 py-2.5 rounded-lg hover:bg-gray-800 transition-colors text-center">
                    {t('nav.login')}
                  </Link>
                  <Link to="/login?mode=signup" onClick={() => setMobileMenuOpen(false)}
                    className="text-sm bg-blue-600 hover:bg-blue-500 text-white font-bold
                               px-4 py-2.5 rounded-lg text-center transition-colors">
                    {t('nav.startFree')}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ══ ヒーロー ════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-20 pb-8 overflow-hidden">
        <div className="absolute inset-0 grid-bg" style={{ opacity:.5 }} />
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-600/12 rounded-full blur-3xl glow-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl glow-pulse"
            style={{ animationDelay:'2s' }} />
        </div>
        {[...Array(10)].map((_, i) => (
          <div key={i} className="absolute rounded-full pointer-events-none"
            style={{ width:`${2+(i%3)}px`, height:`${2+(i%3)}px`,
                     background:i%3===0?'#60a5fa':i%3===1?'#22d3ee':'#a78bfa', opacity:.5,
                     left:`${8+i*9}%`, bottom:'-4px',
                     animation:`particleRise ${7+i*.9}s ease-in infinite`,
                     animationDelay:`${i*.8}s` }} />
        ))}

        <div className="relative max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-blue-600/10 border border-blue-500/30
                          text-blue-400 text-xs font-medium px-4 py-2 rounded-full mb-8
                          shadow-lg shadow-blue-600/10">
            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            <Home size={11} />
            {t('home.badge')}
          </div>

          {/* メインコピー */}
          <h1 className="text-5xl md:text-7xl font-black leading-tight tracking-tight mb-6">
            <span className="shimmer-text">
              {typedText || '\u00A0'}
              <span className="cursor-blink" style={{ WebkitTextFillColor:'#60a5fa' }}>|</span>
            </span>
            <br />
            <span>{t('home.heroHeadline')}</span>
          </h1>

          {/* サブコピー */}
          <div className="bg-blue-600/10 border border-blue-500/20 rounded-2xl px-6 py-4 mb-8 max-w-2xl mx-auto">
            <p className="text-blue-300 text-base font-semibold mb-1">{t('home.whatYouCanDo')}</p>
            <p className="text-gray-300 text-sm leading-relaxed">
              {t('home.whatYouCanDoDesc')}
              <br />
              <span className="text-gray-400">{t('home.whatYouCanDoNote')}</span>
            </p>
          </div>

          <p className="text-gray-400 text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            {t('home.heroDesc')}
          </p>

          <div className="flex justify-center mb-16">
            {isLoggedIn ? (
              <Link to="/app"
                className="inline-flex items-center justify-center gap-2
                           bg-blue-600 hover:bg-blue-500 text-white font-bold
                           px-9 py-4 rounded-xl transition-all duration-200 text-base
                           shadow-2xl shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-105">
                {t('nav.openApp')}
                <ArrowRight size={18} />
              </Link>
            ) : (
              <Link to="/login?mode=signup"
                className="inline-flex items-center justify-center gap-2
                           bg-blue-600 hover:bg-blue-500 text-white font-bold
                           px-9 py-4 rounded-xl transition-all duration-200 text-base
                           shadow-2xl shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-105">
                {t('nav.startFree')}
                <ArrowRight size={18} />
              </Link>
            )}
          </div>

          {/* アプリUI モック */}
          <div className="relative max-w-3xl mx-auto">
            <div className="absolute -inset-1 bg-blue-500/10 rounded-3xl blur-2xl" />
            <div className="relative bg-gray-900/90 border border-gray-700/80 rounded-2xl overflow-hidden
                            shadow-2xl backdrop-blur-sm">
              <div className="scan-line" />
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800/80 bg-gray-900/60">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
                <div className="ml-3 flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-xs text-gray-400 font-mono">{t('home.engineConnected')}</span>
                </div>
                <div className="ml-auto font-mono text-xs text-green-400">深さ: 22 |ノード数:1.4M </div>
              </div>
              <div className="p-4 grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-2">
                  <div className="text-xs text-gray-500 mb-2 flex items-center gap-1.5">
                    <Cpu size={10} className="text-blue-400" /> AI 候補手 (MultiPV 3)
                  </div>
                  {[
                    { r:1, move:'▲７六歩', score:'+124', pv:'△3四歩 ▲2六歩 △8四歩', active:true },
                    { r:2, move:'▲２六歩', score:'+98',  pv:'△8四歩 ▲2五歩 △8五歩', active:false },
                    { r:3, move:'▲６八銀', score:'+71',  pv:'△3四歩 ▲7六歩 △4二銀', active:false },
                  ].map(c => (
                    <div key={c.r}
                      className={`flex items-center justify-between rounded-xl px-3 py-2.5 border transition-all
                                  ${c.active?'bg-blue-600/15 border-blue-500/50':'bg-gray-800/80 border-gray-700/60'}`}>
                      <div className="flex items-center gap-2.5">
                        <span className={`w-5 h-5 rounded text-xs font-bold flex items-center justify-center
                                         ${c.active?'bg-blue-600 text-white':'bg-gray-700 text-gray-400'}`}>{c.r}</span>
                        <div className="text-left">
                          <div className="text-white font-bold text-sm leading-none">{c.move}</div>
                          <div className="text-gray-500 text-xs font-mono mt-0.5">{c.pv}</div>
                        </div>
                      </div>
                      <span className="font-bold text-sm text-blue-400 font-mono">{c.score}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50">
                  <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                    <TrendingUp size={10} className="text-blue-400" /> 形勢グラフ
                  </div>
                  <svg viewBox="0 0 80 90" className="w-full">
                    <defs>
                      <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity=".5" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <line x1="0" y1="45" x2="80" y2="45" stroke="#374151" strokeWidth=".5" strokeDasharray="2,2" />
                    <polygon points="0,45 10,42 20,38 30,41 40,36 50,30 60,33 70,24 80,20 80,45" fill="url(#gf)" />
                    <polyline className="graph-line"
                      points="0,45 10,42 20,38 30,41 40,36 50,30 60,33 70,24 80,20"
                      fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="80" cy="20" r="2.5" fill="#3b82f6" />
                  </svg>
                  <div className="mt-1 text-center font-mono font-bold text-xs text-blue-400">{t('home.sente')} +124</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-40">
          <span className="text-xs text-gray-500 tracking-widest">SCROLL</span>
          <div className="w-5 h-8 border border-gray-600 rounded-full flex justify-center pt-1.5">
            <div className="w-1 h-1.5 bg-gray-500 rounded-full animate-bounce" />
          </div>
        </div>
      </section>

      {/* ══ スタッツ ════════════════════════════════════════════ */}
      <section className="py-16 px-6 border-y border-gray-800/60 bg-gray-900/20">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {userCount !== null
              ? <StatCard value={userCount} suffix={t('home.stats.userSuffix')} label={t('home.stats.users')} />
              : <div className="text-center p-6 rounded-2xl bg-gray-800/40 border border-gray-700/50">
                  <div className="text-gray-500 text-sm">{t('home.stats.loadingUsers')}</div>
                </div>
            }
            <StatCard value={0} suffix="円" label={t('home.stats.price')} />
            <StatCardText val="KIF / CSA" label={t('home.stats.format')} />
            <StatCardText val={t('home.stats.operationVal')} label={t('home.stats.operation')} />
          </div>
          <p className="text-center text-xs text-gray-600 mt-4">
            {t('home.stats.note')}
          </p>
        </div>
      </section>

      {/* ══ このサービスの仕組み ═══════════════════════════════════ */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-blue-600/10 border border-blue-500/20
                            text-blue-400 text-xs px-3 py-1.5 rounded-full mb-4">
              <Zap size={10} /> {t('home.howItWorks.badge')}
            </div>
            <h2 className="text-3xl font-black text-white mb-4">{t('home.howItWorks.title')}</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-8">
            {[
              {
                icon: <Home size={22} className="text-blue-400" />,
                title: t('home.howItWorks.step1Title'),
                desc: t('home.howItWorks.step1Desc'),
              },
              {
                icon: <Globe size={22} className="text-blue-400" />,
                title: t('home.howItWorks.step2Title'),
                desc: t('home.howItWorks.step2Desc'),
              },
              {
                icon: <Smartphone size={22} className="text-blue-400" />,
                title: t('home.howItWorks.step3Title'),
                desc: t('home.howItWorks.step3Desc'),
              },
            ].map(({ icon, title, desc }) => (
              <div key={title}
                className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-5
                           hover:border-blue-500/30 transition-colors group">
                <div className="w-12 h-12 bg-blue-600/15 border border-blue-500/30 rounded-xl
                                flex items-center justify-center mb-4
                                group-hover:bg-blue-600/25 group-hover:scale-110 transition-all duration-300">
                  {icon}
                </div>
                <h3 className="text-white font-bold text-sm mb-2">{title}</h3>
                <p className="text-gray-400 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* 注意書き */}
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 bg-yellow-500/20 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-yellow-400 text-xs font-bold">!</span>
              </div>
              <div>
                <p className="text-yellow-300 font-semibold text-sm mb-1">{t('home.howItWorks.warningTitle')}</p>
                <p className="text-gray-400 text-xs leading-relaxed">
                  {t('home.howItWorks.warningDesc')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 特徴 ════════════════════════════════════════════════ */}
      <section id="features" className="py-24 px-6 bg-gray-900/40 border-y border-gray-800/40">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-blue-600/10 border border-blue-500/20
                            text-blue-400 text-xs px-3 py-1.5 rounded-full mb-4">
              <Zap size={10} /> {t('home.features.badge')}
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-4">{t('home.features.title')}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard delay={0}   icon={<Cpu      size={22} className="text-blue-400" />}
              title={t('home.features.engine.title')}
              desc={t('home.features.engine.desc')} />
            <FeatureCard delay={80}  icon={<BarChart2 size={22} className="text-blue-400" />}
              title={t('home.features.graph.title')}
              desc={t('home.features.graph.desc')} />
            <FeatureCard delay={160} icon={<BookOpen  size={22} className="text-blue-400" />}
              title={t('home.features.batch.title')}
              desc={t('home.features.batch.desc')} />
            <FeatureCard delay={240} icon={<Cloud      size={22} className="text-blue-400" />}
              title={t('home.features.cloud.title')}
              desc={t('home.features.cloud.desc')} />
            <FeatureCard delay={320} icon={<Smartphone size={22} className="text-blue-400" />}
              title={t('home.features.multi.title')}
              desc={t('home.features.multi.desc')} />
            <FeatureCard delay={400} icon={<GitBranch  size={22} className="text-blue-400" />}
              title={t('home.features.tree.title')}
              desc={t('home.features.tree.desc')} />
            <FeatureCard delay={480} icon={<Swords size={22} className="text-amber-400" />}
              title={t('home.features.tsume.title')}
              desc={t('home.features.tsume.desc')} />
          </div>
        </div>
      </section>

      {/* ══ 詰将棋共有セクション ════════════════════════════════ */}
      <section className="py-24 px-6 bg-amber-950/10 border-y border-amber-800/20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-amber-600/10 border border-amber-500/30
                            text-amber-400 text-xs px-3 py-1.5 rounded-full mb-4">
              <Swords size={10} /> {t('home.tsume.badge')}
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-4">{t('home.tsume.title')}</h2>
            <p className="text-gray-400 text-base max-w-xl mx-auto">{t('home.tsume.desc')}</p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-8">
            {[
              { num: '①', title: t('home.tsume.step1'), desc: t('home.tsume.step1desc') },
              { num: '②', title: t('home.tsume.step2'), desc: t('home.tsume.step2desc') },
              { num: '③', title: t('home.tsume.step3'), desc: t('home.tsume.step3desc') },
            ].map(({ num, title, desc }) => (
              <div key={num}
                className="bg-gray-800/50 border border-amber-700/30 rounded-2xl p-5
                           hover:border-amber-500/40 transition-colors group">
                <div className="w-10 h-10 bg-amber-600/15 border border-amber-500/30 rounded-xl
                                flex items-center justify-center mb-4 text-amber-400 font-black text-sm
                                group-hover:bg-amber-600/25 transition-all duration-300">
                  {num}
                </div>
                <h3 className="text-white font-bold text-sm mb-2">{title}</h3>
                <p className="text-gray-400 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4
                          bg-amber-900/20 border border-amber-700/30 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 bg-amber-500/20 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-amber-400 text-xs font-bold">✓</span>
              </div>
              <div>
                <p className="text-amber-300 font-semibold text-sm mb-0.5">{t('home.tsume.noteTitle')}</p>
                <p className="text-gray-400 text-xs leading-relaxed">{t('home.tsume.noteDesc')}</p>
              </div>
            </div>
            <Link to="/tsume/category/all"
              className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl
                         bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold
                         transition-all shadow-lg shadow-amber-600/30 hover:scale-105">
              <Swords size={15} />
              {t('home.tsume.cta')}
            </Link>
          </div>
        </div>
      </section>

      {/* ══ 技術スペック ════════════════════════════════════════ */}
      <section className="py-14 px-6 border-b border-gray-800/40">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon:<Terminal size={18} className="text-cyan-400" />, val:'USI Protocol', sub:t('home.tech.engine') },
              { icon:<Globe    size={18} className="text-cyan-400" />, val:'WebRTC P2P',   sub:t('home.tech.webrtc') },
              { icon:<Lock     size={18} className="text-cyan-400" />, val:'JWT + HTTPS',  sub:t('home.tech.security') },
              { icon:<Shield   size={18} className="text-cyan-400" />, val:'P2P 直結',     sub:t('home.tech.p2p') },
            ].map(({ icon, val, sub }) => (
              <div key={val}
                className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-5 text-center
                           hover:border-cyan-500/30 hover:bg-gray-800/70 transition-all duration-300 group">
                <div className="flex justify-center mb-3 group-hover:scale-110 transition-transform duration-300">{icon}</div>
                <div className="text-sm font-black text-white font-mono mb-1">{val}</div>
                <div className="text-xs text-gray-500">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 使い方 ══════════════════════════════════════════════ */}
      <section id="howto" className="py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-blue-600/10 border border-blue-500/20
                            text-blue-400 text-xs px-3 py-1.5 rounded-full mb-4">
              <BookOpen size={10} /> {t('home.howto.badge')}
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-4">{t('home.howto.title')}</h2>
            <p className="text-gray-400 text-base">{t('home.howto.subtitle')}</p>
          </div>
          <div className="grid md:grid-cols-2 gap-16 items-start">
            <div>
              <Step n={1} total={3} icon={<Users size={13} className="text-blue-400" />}
                title={t('home.howto.step1Title')}
                desc={t('home.howto.step1Desc')}
                detail={t('home.howto.step1Detail')} />
              <Step n={2} total={3} icon={<Terminal size={13} className="text-blue-400" />}
                title={t('home.howto.step2Title')}
                desc={t('home.howto.step2Desc')}
                detail={t('home.howto.step2Detail')} />
              <Step n={3} total={3} icon={<BarChart2 size={13} className="text-blue-400" />}
                title={t('home.howto.step3Title')}
                desc={t('home.howto.step3Desc')}
                detail={t('home.howto.step3Detail')} />
            </div>
            <div className="space-y-4">
              {[
                { icon:<Shield size={16} className="text-green-400" />, title:t('home.howto.security.title'), body:t('home.howto.security.body') },
                { icon:<Clock  size={16} className="text-yellow-400" />, title:t('home.howto.guest.title'),    body:t('home.howto.guest.body') },
                { icon:<Home   size={16} className="text-blue-400" />,  title:t('home.howto.pc.title'),       body:t('home.howto.pc.body') },
              ].map(({ icon, title, body }) => (
                <div key={title}
                  className="bg-gray-900 border border-gray-700/60 rounded-2xl p-5
                             hover:border-blue-500/30 hover:bg-gray-900/80 transition-all duration-300">
                  <div className="flex items-center gap-2.5 mb-2">{icon}
                    <h4 className="text-white font-bold text-sm">{title}</h4>
                  </div>
                  <p className="text-gray-400 text-xs leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ FAQ ═════════════════════════════════════════════════ */}
      <section id="faq" className="py-24 px-6 bg-gray-900/40 border-y border-gray-800/40">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-blue-600/10 border border-blue-500/20
                            text-blue-400 text-xs px-3 py-1.5 rounded-full mb-4">{t('home.faq.badge')}</div>
            <h2 className="text-3xl font-black text-white mb-3">{t('home.faq.title')}</h2>
          </div>
          <div className="space-y-3">
            {[
              { q: t('home.faq.q1'), a: t('home.faq.a1') },
              { q: t('home.faq.q2'), a: t('home.faq.a2') },
              { q: t('home.faq.q3'), a: t('home.faq.a3') },
              { q: t('home.faq.q4'), a: t('home.faq.a4') },
              { q: t('home.faq.q5'), a: t('home.faq.a5') },
              { q: t('home.faq.q6'), a: t('home.faq.a6') },
            ].map(item => <FaqItem key={item.q} {...item} />)}
          </div>
        </div>
      </section>

      {/* ══ お問い合わせ ════════════════════════════════════════ */}
      <section id="contact" className="py-24 px-6">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 bg-blue-600/10 border border-blue-500/20
                            text-blue-400 text-xs px-3 py-1.5 rounded-full mb-4">
              <Mail size={10} /> {t('home.contact.badge')}
            </div>
            <h2 className="text-3xl font-black text-white mb-3">{t('home.contact.title')}</h2>
            <p className="text-gray-400 text-sm leading-relaxed" style={{ whiteSpace: 'pre-line' }}>
              {t('home.contact.desc')}
            </p>
          </div>
          <ContactForm />
        </div>
      </section>

      {/* ══ 最終CTA ═════════════════════════════════════════════ */}
      <section className="py-28 px-6 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg" style={{ opacity:.3 }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                        w-[600px] h-[400px] bg-blue-600/10 rounded-full blur-3xl glow-pulse" />
        <div className="relative max-w-xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-black text-white mb-4 leading-tight">
            {t('home.cta.headline1')}
            <br />
            <span className="shimmer-text">{t('home.cta.headline2')}</span>
          </h2>
          <p className="text-gray-400 text-base mb-3">
            {t('home.cta.free')}
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 justify-center mb-10">
            {(t('home.cta.features', { returnObjects: true }) || []).map(feat => (
              <li key={feat} className="flex items-center gap-1.5 text-gray-400 text-xs">
                <CheckCircle size={12} className="text-blue-400 shrink-0" />{feat}
              </li>
            ))}
          </ul>
          <Link to="/login?mode=signup"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500
                       text-white font-bold px-12 py-4 rounded-xl transition-all duration-200
                       text-base shadow-2xl shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-105">
            {t('home.cta.startFree')}
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* ══ フッター ════════════════════════════════════════════ */}
      <footer className="border-t border-gray-800 py-10 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-start justify-between gap-10 mb-8">
            <div className="max-w-xs">
              <div className="flex items-center gap-2 mb-3">
                <img src="/icons/icon-192x192.png" className="w-7 h-7" alt={t('appName')} />
                <span className="text-sm font-bold text-white">{t('appName')}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                {t('home.footer.desc')}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-10 text-xs">
              {[
                { title: t('home.footer.product'), links:[
                  { label: t('home.footer.features'), href:'#features' },
                  { label: t('home.footer.howto'),    href:'#howto' },
                  { label: t('home.footer.openApp'),  to:'/app' },
                ]},
                { title: t('home.footer.support'), links:[
                  { label:'FAQ',                       href:'#faq' },
                  { label: t('home.footer.contact'),  href:'#contact' },
                  { label: t('nav.login'),             to:'/login' },
                ]},
                { title: t('home.footer.tech'), links:[
                  { label:'USI Protocol', href:null },
                  { label:'WebRTC P2P',   href:null },
                  { label:'KIF / CSA',    href:null },
                ]},
              ].map(({ title, links }) => (
                <div key={title}>
                  <h5 className="text-white font-semibold mb-3 text-xs">{title}</h5>
                  <ul className="space-y-2 text-gray-500">
                    {links.map(({ label, href, to }) => (
                      <li key={label}>
                        {to ? <Link to={to} className="hover:text-gray-300 transition-colors">{label}</Link>
                           : href ? <a href={href} className="hover:text-gray-300 transition-colors">{label}</a>
                           : <span>{label}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-xs text-gray-600">© {new Date().getFullYear()} ShogiAnalytics. {t('home.footer.copyright')}</p>
            <div className="flex items-center gap-4">
              <Link to="/terms" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">{t('home.footer.terms')}</Link>
              <Link to="/privacy" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">{t('home.footer.privacy')}</Link>
              <p className="text-xs text-gray-700 font-mono">Powered by USI Engine · WebRTC · React + Vite</p>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
