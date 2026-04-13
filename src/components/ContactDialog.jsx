import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export default function ContactDialog({ onClose, apiBase = '', authToken = '' }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState(null);

  const widgetRef = useRef(null);
  const widgetIdRef = useRef(null);

  const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

  useEffect(() => {
    let mounted = true;

    function renderWidget() {
      try {
        if (!window.turnstile || !widgetRef.current) return;
        // remove existing widget if present
        if (widgetIdRef.current != null && window.turnstile.reset) {
          try { window.turnstile.reset(widgetIdRef.current); } catch (_) {}
          widgetIdRef.current = null;
        }
        widgetIdRef.current = window.turnstile.render(widgetRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => { if (mounted) setTurnstileToken(token); },
          'error-callback': () => { if (mounted) setTurnstileToken(null); },
          'expired-callback': () => { if (mounted) setTurnstileToken(null); },
        });
      } catch (e) {
        console.warn('[turnstile] render error', e);
      }
    }

    if (window.turnstile) {
      renderWidget();
    } else {
      // load script
      if (!document.querySelector('script[data-turnstile]')) {
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        s.async = true;
        s.defer = true;
        s.setAttribute('data-turnstile', '1');
        s.onload = renderWidget;
        document.head.appendChild(s);
      } else {
        // script exists but not ready yet
        const existing = document.querySelector('script[data-turnstile]');
        existing.addEventListener('load', renderWidget);
      }
    }

    return () => { mounted = false; };
  }, [SITE_KEY]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!subject.trim() || !body.trim()) { setError('件名と本文を入力してください'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/contact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim(), turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '送信に失敗しました');
      setSuccess(true);
      setSubject(''); setBody('');
      // reset widget if possible
      try { if (window.turnstile && widgetIdRef.current != null && window.turnstile.reset) window.turnstile.reset(widgetIdRef.current); } catch (_) {}
    } catch (err) {
      setError(err.message || '送信中にエラーが発生しました');
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-12" onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-2xl mx-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-base font-bold text-white">お問い合わせ</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4">
          <div className="mb-3">
            <label className="text-sm text-gray-400 mb-1 block">件名</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div className="mb-3">
            <label className="text-sm text-gray-400 mb-1 block">内容</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-y" />
          </div>

          <div className="mb-3">
            <div ref={widgetRef} />
          </div>

          {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
          {success && <div className="text-sm text-green-400 mb-3">送信しました。ご連絡ありがとうございます。</div>}

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors">キャンセル</button>
            <button type="submit" disabled={loading}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm text-white font-bold transition-colors">
              {loading ? '送信中...' : '送信'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
