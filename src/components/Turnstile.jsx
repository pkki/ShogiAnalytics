import { useEffect, useRef } from 'react';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export default function Turnstile({ onVerify, onExpire }) {
  const ref = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    if (!SITE_KEY) return;

    function render() {
      if (!ref.current || widgetId.current != null) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        theme: 'dark',
        callback: (token) => onVerify?.(token),
        'expired-callback': () => { onExpire?.(); widgetId.current = null; },
      });
    }

    if (window.turnstile) {
      render();
      return;
    }

    const existing = document.getElementById('cf-turnstile-script');
    if (!existing) {
      const script = document.createElement('script');
      script.id = 'cf-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      script.onload = render;
      document.head.appendChild(script);
    } else {
      existing.addEventListener('load', render);
    }

    return () => {
      if (widgetId.current != null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [onVerify, onExpire]);

  if (!SITE_KEY) return null;

  return <div ref={ref} className="flex justify-center mt-1" />;
}
