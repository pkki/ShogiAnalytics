import { useState, useCallback } from 'react';
import AccountSettingsDialog from '../components/AccountSettingsDialog.jsx';

const API_BASE = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';

/**
 * 設定ダイアログをどのページからでも開けるようにするフック。
 * AccountMenu の onShowSettings に渡す関数と、ダイアログ要素を返す。
 */
export function useAccountSettings(_authToken) {
  const [show, setShow] = useState(false);
  const [settings, setSettings] = useState({});
  const [preferWebSocket, setPreferWebSocket] = useState(
    () => localStorage.getItem('shogi_prefer_ws') === '1'
  );

  const onShowSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`, { credentials: 'include' });
      const data = await res.json();
      if (data?.settings) setSettings(data.settings);
    } catch (_) {}
    setShow(true);
  }, []);

  const onSave = useCallback(async (patch) => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data?.ok) setSettings(data.settings ?? {});
    } catch (_) {}
  }, []);

  const dialog = show ? (
    <AccountSettingsDialog
      settings={settings}
      onClose={() => setShow(false)}
      onSave={async (s) => { await onSave(s); setShow(false); }}
      preferWebSocket={preferWebSocket}
      onToggleWebSocket={v => {
        setPreferWebSocket(v);
        localStorage.setItem('shogi_prefer_ws', v ? '1' : '0');
      }}
    />
  ) : null;

  return { dialog, onShowSettings };
}
