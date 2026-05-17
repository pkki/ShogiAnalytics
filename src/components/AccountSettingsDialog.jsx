import { useState } from 'react';
import { X, Save, Loader2, Wifi, Radio } from 'lucide-react';

const USE_WEBRTC = import.meta.env.VITE_USE_WEBRTC === 'true';

export default function AccountSettingsDialog({ settings, onClose, onSave, preferWebSocket, onToggleWebSocket }) {
  const [swarUsername, setSwarUsername] = useState(settings?.swarUsername ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await onSave({ swarUsername: swarUsername.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-sm flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <h2 className="text-base font-bold text-white">アカウント設定</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
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
