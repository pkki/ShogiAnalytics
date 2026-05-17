import { useState, useEffect } from 'react';
import { X, Save, Loader2, Wifi, Radio, Bell, BellOff } from 'lucide-react';

const USE_WEBRTC = import.meta.env.VITE_USE_WEBRTC === 'true';
const API_BASE = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';

async function getVapidKey() {
  const res = await fetch(`${API_BASE}/api/push/vapid-public-key`);
  const data = await res.json();
  return data.key;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function subscribePush(authToken) {
  const reg = await navigator.serviceWorker.ready;
  const vapidKey = await getVapidKey();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });
  const json = sub.toJSON();
  await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return sub;
}

async function unsubscribePush(authToken) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}

const NOTIF_TYPES = [
  { key: 'notifFriendRequest', label: 'フレンドリクエスト' },
  { key: 'notifGameMatched',   label: '対局マッチング' },
  { key: 'notifTsumeLike',     label: '詰将棋のいいね' },
];

export default function AccountSettingsDialog({ settings, onClose, onSave, preferWebSocket, onToggleWebSocket, authToken }) {
  const [swarUsername, setSwarUsername] = useState(settings?.swarUsername ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 通知設定
  const [pushSupported] = useState(() => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  const [pushPermission, setPushPermission] = useState(() => pushSupported ? Notification.permission : 'denied');
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushToggling, setPushToggling] = useState(false);
  const [notifFriendRequest, setNotifFriendRequest] = useState(settings?.notifFriendRequest ?? true);
  const [notifGameMatched,   setNotifGameMatched]   = useState(settings?.notifGameMatched   ?? true);
  const [notifTsumeLike,     setNotifTsumeLike]     = useState(settings?.notifTsumeLike     ?? true);

  useEffect(() => {
    if (!pushSupported) return;
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => setPushSubscribed(!!sub));
    });
  }, [pushSupported]);

  async function handleTogglePush() {
    if (!authToken) return;
    setPushToggling(true);
    try {
      if (pushSubscribed) {
        await unsubscribePush(authToken);
        setPushSubscribed(false);
      } else {
        const perm = await Notification.requestPermission();
        setPushPermission(perm);
        if (perm !== 'granted') return;
        await subscribePush(authToken);
        setPushSubscribed(true);
      }
    } catch (e) {
      console.error('[push] toggle error', e);
    } finally {
      setPushToggling(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await onSave({
        swarUsername: swarUsername.trim(),
        notifFriendRequest,
        notifGameMatched,
        notifTsumeLike,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const notifStates = { notifFriendRequest, notifGameMatched, notifTsumeLike };
  const notifSetters = {
    notifFriendRequest: setNotifFriendRequest,
    notifGameMatched:   setNotifGameMatched,
    notifTsumeLike:     setNotifTsumeLike,
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-sm flex flex-col max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <h2 className="text-base font-bold text-white">アカウント設定</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-5">
          {/* エンジン接続方式 */}
          {USE_WEBRTC && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                エンジン接続方式
              </div>
              <div className="flex rounded-xl overflow-hidden border border-gray-700">
                {[
                  { value: false, label: 'WebRTC', sub: '通常', icon: Radio },
                  { value: true,  label: 'WebSocket', sub: '学校・制限環境向け', icon: Wifi },
                ].map(({ value, label, sub, icon: Icon }) => (
                  <button
                    key={String(value)}
                    onClick={() => onToggleWebSocket(value)}
                    className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors
                      ${preferWebSocket === value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                  >
                    <Icon size={15} />
                    <span>{label}</span>
                    <span className={`text-[10px] font-normal ${preferWebSocket === value ? 'text-blue-200' : 'text-gray-600'}`}>{sub}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-600 mt-1.5">
                WebRTCがブロックされる環境ではWebSocketを選択してください。変更は即時反映されます。
              </p>
            </div>
          )}

          {/* ブラウザ通知 */}
          {pushSupported && authToken && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                ブラウザ通知
              </div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {pushSubscribed
                    ? <Bell size={15} className="text-blue-400" />
                    : <BellOff size={15} className="text-gray-500" />}
                  <span className="text-sm text-gray-300">
                    {pushSubscribed ? '通知が有効です' : '通知が無効です'}
                  </span>
                </div>
                <button
                  onClick={handleTogglePush}
                  disabled={pushToggling || pushPermission === 'denied'}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50
                    ${pushSubscribed
                      ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                >
                  {pushToggling
                    ? <Loader2 size={12} className="animate-spin inline" />
                    : pushSubscribed ? '無効にする' : '有効にする'}
                </button>
              </div>
              {pushPermission === 'denied' && (
                <p className="text-[11px] text-yellow-500 mb-2">
                  ブラウザの通知権限がブロックされています。ブラウザ設定から許可してください。
                </p>
              )}
              {pushSubscribed && (
                <div className="flex flex-col gap-2">
                  {NOTIF_TYPES.map(({ key, label }) => (
                    <label key={key} className="flex items-center justify-between cursor-pointer">
                      <span className="text-sm text-gray-300">{label}</span>
                      <div
                        onClick={() => notifSetters[key](!notifStates[key])}
                        className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer
                          ${notifStates[key] ? 'bg-blue-600' : 'bg-gray-700'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                          ${notifStates[key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                    </label>
                  ))}
                  <p className="text-[11px] text-gray-600 mt-1">
                    各通知タイプのオン/オフは保存ボタンで反映されます
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 将棋ウォーズ */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              将棋ウォーズ
            </div>
            <label className="block text-sm text-gray-300 mb-1.5">ユーザー名</label>
            <input
              type="text"
              value={swarUsername}
              onChange={e => { setSwarUsername(e.target.value); setSaved(false); }}
              placeholder="将棋ウォーズのユーザー名"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white
                placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
            <p className="text-[11px] text-gray-600 mt-1.5">
              設定すると棋譜取り込み時に自動で検索されます
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700 shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors">
            閉じる
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-sm text-white font-bold transition-colors flex items-center gap-1.5"
          >
            {saving
              ? <Loader2 size={14} className="animate-spin" />
              : saved
                ? <Save size={14} className="text-green-400" />
                : <Save size={14} />}
            {saved ? '保存しました' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
