// ============================================================
//  PairingDialog — エージェントペアリング承認ダイアログ
//  props:
//    pairCode:    string  (URL の ?pair= パラメーター)
//    authToken:   string
//    onDone():    void    (承認完了またはキャンセル後)
// ============================================================
import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';

async function apiPost(path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'サーバーエラーが発生しました');
  return json;
}

export default function PairingDialog({ pairCode, authToken, onDone }) {
  const [step, setStep]           = useState('loading'); // loading | confirm | done | error
  const [agentInfo, setAgentInfo] = useState(null);
  const [agentName, setAgentName] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [error, setError]         = useState('');
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    if (!pairCode) return;
    fetch(`${API}/agent/pairing-info?code=${encodeURIComponent(pairCode)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'エラーが発生しました');
        setAgentInfo(data.agentInfo);
        setAgentName(data.agentInfo.hostname || 'My Agent');
        setStep('confirm');
      })
      .catch((e) => {
        setError(e.message);
        setStep('error');
      });
  }, [pairCode]);

  async function handleConfirm() {
    if (enteredCode.trim().toUpperCase() !== pairCode.toUpperCase()) {
      setCodeError(true);
      return;
    }
    setCodeError(false);
    setSaving(true);
    try {
      await apiPost('/agent/confirm-pairing', { code: pairCode, name: agentName }, authToken);
      setStep('done');
    } catch (e) {
      setError(e.message);
      setStep('error');
    } finally {
      setSaving(false);
    }
  }

  function dismiss() {
    // URL から ?pair= を消してから親に通知
    const url = new URL(window.location.href);
    url.searchParams.delete('pair');
    window.history.replaceState({}, '', url.toString());
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 text-gray-200">
        {/* ヘッダー */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-700">
          <h2 className="text-lg font-bold">ローカルエージェントの承認</h2>
        </div>

        <div className="px-6 py-5">
          {/* ロード中 */}
          {step === 'loading' && (
            <p className="text-gray-400 text-sm">エージェント情報を取得中…</p>
          )}

          {/* 確認 */}
          {step === 'confirm' && agentInfo && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">
                以下のエージェントをあなたのアカウントに接続しますか？
              </p>
              <div className="bg-gray-800 rounded-lg px-4 py-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">ホスト名</span>
                  <span className="font-medium">{agentInfo.hostname}</span>
                </div>
                {agentInfo.engineName && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">エンジン</span>
                    <span className="font-medium">{agentInfo.engineName}</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">エージェント名 (任意)</label>
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  maxLength={64}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2
                             text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  ShogiAgent に表示された認証コードを入力
                </label>
                <input
                  type="text"
                  value={enteredCode}
                  onChange={(e) => { setEnteredCode(e.target.value.toUpperCase()); setCodeError(false); }}
                  maxLength={8}
                  placeholder="例: A3F7B2E1"
                  className={`w-full bg-gray-800 border rounded px-3 py-2 text-sm
                             font-mono tracking-widest uppercase focus:outline-none
                             ${codeError ? 'border-red-500 focus:border-red-500' : 'border-gray-600 focus:border-amber-500'}`}
                />
                {codeError && (
                  <p className="text-xs text-red-400 mt-1">認証コードが一致しません</p>
                )}
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={dismiss}
                  className="flex-1 py-2 rounded-lg border border-gray-600 text-gray-300
                             hover:bg-gray-800 text-sm transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={saving}
                  className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-500
                             disabled:opacity-50 text-sm font-semibold transition-colors"
                >
                  {saving ? '承認中…' : '承認する'}
                </button>
              </div>
            </div>
          )}

          {/* 完了 */}
          {step === 'done' && (
            <div className="space-y-4 text-center">
              <div className="text-4xl">✓</div>
              <p className="text-green-400 font-medium">承認しました</p>
              <p className="text-sm text-gray-400">
                エージェントが自動的に接続を完了します。
              </p>
              <button
                onClick={dismiss}
                className="w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500
                           text-sm font-semibold transition-colors"
              >
                閉じる
              </button>
            </div>
          )}

          {/* エラー */}
          {step === 'error' && (
            <div className="space-y-4">
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={dismiss}
                className="w-full py-2 rounded-lg border border-gray-600 text-gray-300
                           hover:bg-gray-800 text-sm transition-colors"
              >
                閉じる
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
