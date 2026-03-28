import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart2, Cpu, Cloud, Smartphone, GitBranch,
  TrendingUp, ArrowRight, CheckCircle, Zap, BookOpen,
  Mail, Users, Shield, Clock, ChevronDown,
  Globe, Lock, Terminal, Home, Send, Loader2,
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
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('shogi_jwt') : null;
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [tsToken, setTsToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // 'ok' | 'error'
  const [errMsg, setErrMsg] = useState('');

  const hasTurnstile = !!import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const canSubmit = !hasTurnstile || !!tsToken;

  const handleTsVerify = useCallback((t) => setTsToken(t), []);
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
        setErrMsg(json.error || 'エラーが発生しました');
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
      setErrMsg('通信エラーが発生しました'); setResult('error');
    } finally { setLoading(false); }
  }

  if (!token) {
    return (
      <div className="bg-gray-800/40 border border-gray-700/60 rounded-2xl p-8 text-center">
        <Mail size={32} className="text-blue-400 mx-auto mb-3" />
        <p className="text-gray-300 text-sm mb-4">
          お問い合わせにはログインが必要です。
        </p>
        <Link to="/login"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white
                     font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors">
          ログイン / 無料登録
          <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  if (result === 'ok') {
    return (
      <div className="bg-green-900/20 border border-green-600/40 rounded-2xl p-8 text-center">
        <CheckCircle size={32} className="text-green-400 mx-auto mb-3" />
        <p className="text-green-300 font-semibold mb-1">送信しました</p>
        <p className="text-gray-400 text-sm">お問い合わせを受け付けました。確認次第ご返信します。</p>
        <button onClick={() => setResult(null)}
          className="mt-4 text-xs text-gray-500 hover:text-gray-300 transition-colors underline">
          別のお問い合わせをする
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
        <label className="text-xs text-gray-400 font-medium">件名</label>
        <input value={subject} onChange={e => setSubject(e.target.value)}
          placeholder="バグ報告・機能要望・その他" maxLength={100} required
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white text-sm
                     placeholder-gray-500 outline-none focus:border-blue-500 focus:ring-1
                     focus:ring-blue-500 transition-colors" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-gray-400 font-medium">本文</label>
        <textarea value={body} onChange={e => setBody(e.target.value)}
          placeholder="お問い合わせ内容をできるだけ詳しく書いてください。" maxLength={3000} required rows={5}
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
        {loading ? <><Loader2 size={15} className="animate-spin" />送信中…</> : <><Send size={15} />送信する</>}
      </button>
    </form>
  );
}

// ── メインコンポーネント ─────────────────────────────────────
export default function HomePage() {
  const typedText = useTyping(['外出先で', 'スマホでも', 'どこでも']);
  const [scrolled, setScrolled] = useState(false);
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
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/icons/icon-192x192.png" className="w-8 h-8" alt="将棋アナリティクス" />
            <span className="font-bold text-white tracking-wide text-sm">将棋アナリティクス</span>
          </div>
          <nav className="hidden md:flex items-center gap-7">
            {[['#features','機能'],['#howto','使い方'],['#faq','FAQ'],['#contact','お問い合わせ']].map(([h,l]) => (
              <a key={h} href={h} className="text-xs text-gray-400 hover:text-white transition-colors tracking-wide">{l}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <Link to="/app"
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold
                           px-4 py-2 rounded-lg transition-all shadow-lg shadow-blue-600/30
                           hover:shadow-blue-600/50 hover:scale-105">
                アプリを開く
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5">
                  ログイン
                </Link>
                <Link to="/login"
                  className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold
                             px-4 py-2 rounded-lg transition-all shadow-lg shadow-blue-600/30
                             hover:shadow-blue-600/50 hover:scale-105">
                  無料で始める
                </Link>
              </>
            )}
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
            自宅PCの将棋AIを、スマホからでも使えるようにするツール
          </div>

          {/* メインコピー */}
          <h1 className="text-5xl md:text-7xl font-black leading-tight tracking-tight mb-6">
            <span className="shimmer-text">
              {typedText || '\u00A0'}
              <span className="cursor-blink" style={{ WebkitTextFillColor:'#60a5fa' }}>|</span>
            </span>
            <br />
            <span>自宅の将棋AIで解析</span>
          </h1>

          {/* サブコピー: サービスの本質を正直に説明 */}
          <div className="bg-blue-600/10 border border-blue-500/20 rounded-2xl px-6 py-4 mb-8 max-w-2xl mx-auto">
            <p className="text-blue-300 text-base font-semibold mb-1">このサービスでできること</p>
            <p className="text-gray-300 text-sm leading-relaxed">
              自宅PCにインストールした将棋AIエンジン（やねうら王・水匠など）を、
              外出先のスマホやタブレットから使えるようにします。
              <br />
              <span className="text-gray-400">エンジン自体はあなたのPCで動作します。このサービスはその「橋渡し」です。</span>
            </p>
          </div>

          <p className="text-gray-400 text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            棋譜をKIF/CSAで読み込んで解析。候補手・形勢グラフ・読み筋をリアルタイムで確認。
            解析結果はクラウドに保存してどこからでも見返せます。
          </p>

          <div className="flex justify-center mb-16">
            {isLoggedIn ? (
              <Link to="/app"
                className="inline-flex items-center justify-center gap-2
                           bg-blue-600 hover:bg-blue-500 text-white font-bold
                           px-9 py-4 rounded-xl transition-all duration-200 text-base
                           shadow-2xl shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-105">
                アプリを開く
                <ArrowRight size={18} />
              </Link>
            ) : (
              <Link to="/login"
                className="inline-flex items-center justify-center gap-2
                           bg-blue-600 hover:bg-blue-500 text-white font-bold
                           px-9 py-4 rounded-xl transition-all duration-200 text-base
                           shadow-2xl shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-105">
                無料で始める
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
                  <span className="text-xs text-gray-400 font-mono">自宅PCエンジン接続中</span>
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
                  <div className="mt-1 text-center font-mono font-bold text-xs text-blue-400">先手有利 +124</div>
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
              ? <StatCard value={userCount} suffix="名" label="登録ユーザー数" />
              : <div className="text-center p-6 rounded-2xl bg-gray-800/40 border border-gray-700/50">
                  <div className="text-gray-500 text-sm">読み込み中…</div>
                </div>
            }
            <StatCard value={0} suffix="円" label="利用料金（全機能）" />
            <StatCardText val="KIF / CSA" label="対応棋譜フォーマット" />
            <StatCardText val="個人開発" label="運営体制" />
          </div>
          <p className="text-center text-xs text-gray-600 mt-4">
            ※ 個人が趣味で開発・運営しています。障害対応などに時間がかかる場合があります。
          </p>
        </div>
      </section>

      {/* ══ このサービスの仕組み ═══════════════════════════════════ */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-blue-600/10 border border-blue-500/20
                            text-blue-400 text-xs px-3 py-1.5 rounded-full mb-4">
              <Zap size={10} /> 仕組み
            </div>
            <h2 className="text-3xl font-black text-white mb-4">どうやって動いているの？</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-8">
            {[
              {
                icon: <Home size={22} className="text-blue-400" />,
                title: '① 自宅PCのエンジン',
                desc: 'やねうら王などのUSIエンジンが自宅PCで動きます。解析の重い処理はすべてあなたのPC上で行われます。',
              },
              {
                icon: <Globe size={22} className="text-blue-400" />,
                title: '② local-agent が橋渡し',
                desc: '自宅PCで「local-agent」を起動すると、このWebサービスとWebRTC P2Pで接続されます。エンジン通信はサーバーを通過しません。',
              },
              {
                icon: <Smartphone size={22} className="text-blue-400" />,
                title: '③ スマホで解析結果を確認',
                desc: 'スマホやタブレットのブラウザから棋譜を入力すると、自宅PCのエンジンが解析して結果を返します。',
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
                <p className="text-yellow-300 font-semibold text-sm mb-1">外出中に解析するには自宅PCの起動が必要です</p>
                <p className="text-gray-400 text-xs leading-relaxed">
                  エンジンは自宅PCで動くため、外出先から解析するには自宅PCが起動していてlocal-agentが動いている必要があります。
                  PCを起動したまま外出、またはリモート起動できる環境が前提です。
                  アカウントなしのゲストモードでも棋譜の読み込みや閲覧は可能ですが、エンジン解析はlocal-agent接続が必要です。
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
              <Zap size={10} /> Features
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-4">主な機能</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard delay={0}   icon={<Cpu      size={22} className="text-blue-400" />}
              title="USIエンジン リアルタイム解析"
              desc="local-agentで接続した自宅PCのUSIエンジンがリアルタイムで候補手・評価値・読み筋を表示。MultiPVで複数候補を同時表示します。" />
            <FeatureCard delay={80}  icon={<BarChart2 size={22} className="text-blue-400" />}
              title="形勢グラフ"
              desc="全手数の評価値推移をグラフ化。悪手・疑問手・好手を色分けし、クリックで即その局面へジャンプできます。" />
            <FeatureCard delay={160} icon={<BookOpen  size={22} className="text-blue-400" />}
              title="棋譜一括解析"
              desc="KIF/CSAファイルを読み込んで「解析」ボタンを押すだけ。AIが全手を自動解析し、各局面の最善手・評価値を一括記録します。" />
            <FeatureCard delay={240} icon={<Cloud      size={22} className="text-blue-400" />}
              title="クラウド棋譜保存"
              desc="解析結果付きの棋譜をサーバーに保存。どのデバイスからでも続きを閲覧・再解析できます。評価値なし軽量保存も選べます。" />
            <FeatureCard delay={320} icon={<Smartphone size={22} className="text-blue-400" />}
              title="マルチデバイス対応"
              desc="PC・タブレット・スマートフォン全てに最適化されたUI。自宅PCとスマホで役割を分担して使えます。" />
            <FeatureCard delay={400} icon={<GitBranch  size={22} className="text-blue-400" />}
              title="変化手順ツリー"
              desc='「あの手を指していたら？」を気軽に検討できる変化ツリー。変化手も含めてKIFエクスポート可能です。' />
          </div>
        </div>
      </section>

      {/* ══ 技術スペック ════════════════════════════════════════ */}
      <section className="py-14 px-6 border-b border-gray-800/40">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon:<Terminal size={18} className="text-cyan-400" />, val:'USI Protocol', sub:'エンジン接続規格' },
              { icon:<Globe    size={18} className="text-cyan-400" />, val:'WebRTC P2P',   sub:'ブラウザ直結通信' },
              { icon:<Lock     size={18} className="text-cyan-400" />, val:'JWT + HTTPS',  sub:'セキュリティ規格' },
              { icon:<Shield   size={18} className="text-cyan-400" />, val:'P2P 直結',     sub:'エンジン通信はサーバー非経由' },
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
              <BookOpen size={10} /> How to use
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-4">使い方</h2>
            <p className="text-gray-400 text-base">セットアップはかんたん。最短数分で使えます。</p>
          </div>
          <div className="grid md:grid-cols-2 gap-16 items-start">
            <div>
              <Step n={1} total={3} icon={<Users size={13} className="text-blue-400" />}
                title="アカウント作成（無料）"
                desc="メールアドレスとパスワードで無料登録。メール認証後すぐに利用開始できます。"
                detail="登録・利用料は一切不要。クレジットカード入力も必要ありません。" />
              <Step n={2} total={3} icon={<Terminal size={13} className="text-blue-400" />}
                title="local-agent をPCで起動"
                desc="PCにインストール済みのUSIエンジンをlocal-agentで接続します。QRコードをスキャンするだけでペアリング完了。"
                detail={<>
                  <strong className="text-gray-300">対応エンジン例：</strong>やねうら王、水匠、dlshogi など USI 対応エンジン全般。<br />
                  WebRTC P2Pのためエンジンの通信はサーバーを通過しません。
                </>} />
              <Step n={3} total={3} icon={<BarChart2 size={13} className="text-blue-400" />}
                title="棋譜を読み込んで解析スタート"
                desc='KIF/CSAファイルを開くか、テキストを貼り付けるだけ。「解析」ボタンで全手を自動解析します。'
                detail="解析後は形勢グラフ・候補手・読み筋が全手分記録。KIFエクスポートやクラウド保存もできます。" />
            </div>
            <div className="space-y-4">
              {[
                { icon:<Shield size={16} className="text-green-400" />, title:'セキュリティについて',
                  body:'全通信はHTTPS/TLSで暗号化。JWTトークン認証により棋譜データは保護されます。エンジンとのやり取りはWebRTC P2PのためサーバーがAIの思考内容を見ることはありません。' },
                { icon:<Clock  size={16} className="text-yellow-400" />, title:'ゲストモードで今すぐ試せます',
                  body:'アカウント登録なしでもゲストとしてアプリを操作できます。KIF読み込みや盤面確認は今すぐ試せます。ただしエンジン解析・クラウド保存にはログインが必要です。' },
                { icon:<Home   size={16} className="text-blue-400" />, title:'自宅PCが必要です',
                  body:'解析には自宅PCのUSIエンジンが必要です。スマホ単体ではエンジン解析はできません。自宅PCが起動してlocal-agentが動いている状態で、外出先から解析できます。' },
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
                            text-blue-400 text-xs px-3 py-1.5 rounded-full mb-4">FAQ</div>
            <h2 className="text-3xl font-black text-white mb-3">よくある質問</h2>
          </div>
          <div className="space-y-3">
            {[
              { q:'どんなUSIエンジンが使えますか？',
                a:'USI対応エンジンであればどれでも使用可能です。やねうら王・水匠・dlshogi・Gikou・AperyなどPCで動作するUSIエンジンをそのまま接続できます。' },
              { q:'スマホ単体でエンジン解析はできますか？',
                a:'できません。エンジンは自宅PCで動作するため、外出先から解析するには自宅PCが起動していてlocal-agentが動いている必要があります。' },
              { q:'自宅PCを起動したまま外出しないといけないですか？',
                a:'外出先からエンジン解析をする場合はその通りです。PCをスリープさせず、local-agentを起動したままにする必要があります。WoL（Wake on LAN）などでリモート起動する方法もあります。' },
              { q:'対応している棋譜フォーマットは？',
                a:'KIF形式（.kif / .kifu）とCSA形式（.csa）に対応しています。Shift-JISのKIFファイルも自動判別して読み込めます。' },
              { q:'料金はかかりますか？',
                a:'現在は全機能を無料でご利用いただけます。個人開発のため将来的に変更になる可能性はありますが、有料化する場合は事前にお知らせします。' },
              { q:'クラウドに保存した棋譜は安全ですか？',
                a:'JWT認証により、あなたの棋譜は自分のアカウントからしかアクセスできません。ただし個人運営のサービスのため、重要な棋譜はローカルにもバックアップを取ることを推奨します。' },
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
              <Mail size={10} /> Contact
            </div>
            <h2 className="text-3xl font-black text-white mb-3">お問い合わせ</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              バグ報告・機能要望・ご質問はこちらからどうぞ。
              <br />個人運営のため返信に時間がかかる場合があります。
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
            自宅の将棋AIを、
            <br />
            <span className="shimmer-text">どこでも。</span>
          </h2>
          <p className="text-gray-400 text-base mb-3">
            登録無料・クレジットカード不要。
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 justify-center mb-10">
            {['全機能無料', 'KIF / CSA 対応', 'PC・スマホ対応', 'USIエンジン対応'].map(t => (
              <li key={t} className="flex items-center gap-1.5 text-gray-400 text-xs">
                <CheckCircle size={12} className="text-blue-400 shrink-0" />{t}
              </li>
            ))}
          </ul>
          <Link to="/login"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500
                       text-white font-bold px-12 py-4 rounded-xl transition-all duration-200
                       text-base shadow-2xl shadow-blue-600/30 hover:shadow-blue-600/50 hover:scale-105">
            無料で始める
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
                <img src="/icons/icon-192x192.png" className="w-7 h-7" alt="将棋アナリティクス" />
                <span className="text-sm font-bold text-white">将棋アナリティクス</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                自宅PCのUSIエンジンをどこからでも使えるようにする、個人開発の棋譜解析Webアプリ。
              </p>
            </div>
            <div className="grid grid-cols-3 gap-10 text-xs">
              {[
                { title:'プロダクト', links:[
                  { label:'機能一覧', href:'#features' },
                  { label:'使い方', href:'#howto' },
                  { label:'アプリを開く', to:'/app' },
                ]},
                { title:'サポート', links:[
                  { label:'FAQ', href:'#faq' },
                  { label:'お問い合わせ', href:'#contact' },
                  { label:'ログイン', to:'/login' },
                ]},
                { title:'技術情報', links:[
                  { label:'USI Protocol', href:null },
                  { label:'WebRTC P2P', href:null },
                  { label:'KIF / CSA 形式', href:null },
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
            <p className="text-xs text-gray-600">© {new Date().getFullYear()} ShogiAnalytics. 個人開発・運営</p>
            <p className="text-xs text-gray-700 font-mono">Powered by USI Engine · WebRTC · React + Vite</p>
          </div>
        </div>
      </footer>

    </div>
  );
}
