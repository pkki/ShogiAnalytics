// ============================================================
//  AgentPanel — 右上エージェント状態 + 管理パネル
//  props:
//    connectedAgents:  { agentId, name, engineName }[]
//    selectedAgentId:  string | null
//    authToken:        string
//    onSelectAgent(agentId): void
//    onOpenSettings(): void   エンジン設定ダイアログを開く
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Download } from 'lucide-react';

const API = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';
const AGENT_DOWNLOAD_WIN = import.meta.env.VITE_AGENT_DOWNLOAD_WIN || `${API}/downloads/ShogiAgent-windows.exe`;
const AGENT_DOWNLOAD_MAC = import.meta.env.VITE_AGENT_DOWNLOAD_MAC || `${API}/downloads/ShogiAgent-mac.zip`;

async function apiFetch(path, opts = {}, token) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'サーバーエラーが発生しました');
  return json;
}

// ドット色
function statusDot(isSelected, isOnline, revoked) {
  if (revoked)    return 'bg-gray-600';
  if (isSelected) return 'bg-green-400';
  if (isOnline)   return 'bg-yellow-400';
  return 'bg-gray-600';
}

// バッジ
function StatusBadge({ isSelected, isOnline, revoked }) {
  if (revoked)    return <span className="text-xs text-red-400">無効</span>;
  if (isSelected) return <span className="text-xs text-green-400">使用中</span>;
  if (isOnline)   return <span className="text-xs text-yellow-400">待機中</span>;
  return null;
}

export default function AgentPanel({ connectedAgents, selectedAgentId, authToken, onSelectAgent, onOpenSettings, isPassive }) {
  const [open, setOpen]       = useState(false);
  const [regAgents, setReg]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const panelRef              = useRef(null);

  const selectedAgent = connectedAgents.find((a) => a.agentId === selectedAgentId) || null;
  const isConnected   = !!selectedAgentId;

  // パネル外クリックで閉じる
  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const fetchRegistered = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/api/agents', {}, authToken);
      setReg(data.agents || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (open) fetchRegistered();
  }, [open, fetchRegistered]);

  async function revokeAgent(id) {
    if (!confirm('このエージェントを削除しますか？')) return;
    try {
      await apiFetch(`/api/agents/${id}`, { method: 'DELETE' }, authToken);
      setReg((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      alert(e.message);
    }
  }

  // 登録済みエージェントにオンライン状態をマージ
  const enriched = regAgents.map((a) => ({
    ...a,
    isOnline:   connectedAgents.some((ca) => ca.agentId === a.id),
    isSelected: a.id === selectedAgentId,
  }));

  const dotColor = isPassive && connectedAgents.length > 0 ? 'bg-amber-400'
    : isConnected ? 'bg-green-400'
    : connectedAgents.length > 0 ? 'bg-yellow-400'
    : 'bg-gray-500';

  const headerLabel = isPassive && connectedAgents.length > 0
    ? '他のデバイスが使用中'
    : isConnected ? (selectedAgent?.name || 'エージェント')
    : 'エージェント';

  return (
    <div className="relative" ref={panelRef}>
      {/* ヘッダーボタン */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md
                   bg-gray-800 hover:bg-gray-700 text-sm text-gray-200
                   border border-gray-600 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        <span className="hidden sm:inline max-w-36 truncate">
          {headerLabel}
        </span>
        {!isPassive && connectedAgents.length > 1 && (
          <span className="text-xs text-gray-400 tabular-nums">{connectedAgents.length}</span>
        )}
      </button>

      {/* パネル */}
      {open && (
        <div className="absolute right-0 top-9 z-50 bg-gray-900 border border-gray-700
                        rounded-lg shadow-2xl text-sm text-gray-200 overflow-hidden"
             style={{ width: 296 }}>

          {/* ── ヘッダー ── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <span className="font-semibold">ローカルエージェント</span>
            <div className="flex items-center gap-2">
              <a
                href={AGENT_DOWNLOAD_WIN}
                download
                title="Windows版をダウンロード"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs
                           bg-blue-700 hover:bg-blue-600 text-white transition-colors"
              >
                <Download size={11} />
                Win
              </a>
              <a
                href={AGENT_DOWNLOAD_MAC}
                download
                title="Mac版をダウンロード"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs
                           bg-violet-700 hover:bg-violet-600 text-white transition-colors"
              >
                <Download size={11} />
                Mac
              </a>
              <button onClick={() => setOpen(false)}
                      className="text-gray-400 hover:text-white leading-none text-base">✕</button>
            </div>
          </div>

          {/* ── オンライン中 ── */}
          <div className="px-4 py-3 border-b border-gray-700">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              オンライン ({connectedAgents.length})
            </p>

            {connectedAgents.length === 0 ? (
              <div className="text-xs text-gray-500 space-y-0.5">
                <p>接続中のエージェントはありません</p>
                <p className="pt-1 font-medium text-gray-400">接続方法:</p>
                <p>1. ShogiAgent.exe を起動</p>
                <p>2. 表示されたURLをこのブラウザで開く</p>
                <p>3. 承認ボタンを押す</p>
              </div>
            ) : (
              <>
                {isPassive && (
                  <p className="text-xs text-amber-400/80 mb-2 px-0.5">
                    別のデバイスが使用中です
                  </p>
                )}
                <ul className="space-y-1">
                  {connectedAgents.map((agent) => {
                    const isSel = !isPassive && agent.agentId === selectedAgentId;
                    return (
                      <li key={agent.agentId}>
                        <div className={`flex items-center gap-1 rounded-lg border
                            ${isPassive
                              ? 'bg-amber-900/10 border-amber-700/20'
                              : isSel
                                ? 'bg-green-900/30 border-green-700/40'
                                : 'hover:bg-gray-800 border-transparent'}`}>
                          <button
                            onClick={() => onSelectAgent(agent.agentId)}
                            className="flex items-center gap-2.5 px-2.5 py-2 flex-1 min-w-0 text-left"
                          >
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0
                              ${isPassive ? 'bg-amber-400' : isSel ? 'bg-green-400' : 'bg-yellow-400'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate leading-tight">{agent.name}</div>
                              {agent.engineName && (
                                <div className="text-xs text-gray-400 truncate leading-tight mt-0.5">
                                  {agent.engineName}
                                </div>
                              )}
                            </div>
                            <span className={`text-xs flex-shrink-0
                              ${isPassive ? 'text-amber-400/70' : isSel ? 'text-green-400' : 'text-gray-500'}`}>
                              {isPassive ? '切り替え' : isSel ? '使用中' : '選択'}
                            </span>
                          </button>
                          {/* 選択中エージェントのみ設定ボタンを表示 (パッシブ時は非表示) */}
                          {isSel && !isPassive && onOpenSettings && (
                            <button
                              onClick={() => { setOpen(false); onOpenSettings(); }}
                              title="エンジン設定"
                              className="p-2 mr-1 rounded text-gray-400 hover:text-white
                                         hover:bg-green-800/40 transition-colors flex-shrink-0"
                            >
                              <Settings size={14} />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          {/* ── 登録済み ── */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">登録済み</p>
              <button onClick={fetchRegistered}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors">更新</button>
            </div>

            {loading && <p className="text-xs text-gray-500 py-1">読み込み中…</p>}
            {error   && <p className="text-xs text-red-400 py-1">{error}</p>}
            {!loading && enriched.length === 0 && (
              <p className="text-xs text-gray-500 py-1">登録されたエージェントはありません</p>
            )}

            <ul className="space-y-1">
              {enriched.map((a) => (
                <li key={a.id}
                    className={`px-2 py-2 rounded-lg ${a.revoked ? 'opacity-40' : 'hover:bg-gray-800/60'}`}>
                  <div className="flex items-start gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1
                      ${statusDot(a.isSelected, a.isOnline, a.revoked)}`} />
                    {/* 名前・エンジン名 */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate leading-tight">{a.name}</div>
                      {a.engine_name && (
                        <div className="text-xs text-gray-500 truncate leading-tight mt-0.5">
                          {a.engine_name}
                        </div>
                      )}
                    </div>
                    {/* バッジ + 削除ボタン (縦並び) */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <StatusBadge
                        isSelected={a.isSelected}
                        isOnline={a.isOnline}
                        revoked={!!a.revoked}
                      />
                      {!a.revoked && (
                        <button
                          onClick={() => revokeAgent(a.id)}
                          className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
