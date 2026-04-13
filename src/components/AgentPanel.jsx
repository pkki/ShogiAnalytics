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
import { useTranslation } from 'react-i18next';

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
  if (!res.ok) throw new Error(json.error || 'Server error');
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
function StatusBadge({ isSelected, isOnline, revoked, t }) {
  if (revoked)    return <span className="text-xs text-red-400">{t('status.revoked', 'Revoked')}</span>;
  if (isSelected) return <span className="text-xs text-green-400">{t('status.inUse', 'In use')}</span>;
  if (isOnline)   return <span className="text-xs text-yellow-400">{t('status.standby', 'Standby')}</span>;
  return null;
}

export default function AgentPanel({ connectedAgents, selectedAgentId, authToken, onSelectAgent, onOpenSettings, isPassive }) {
  const [open, setOpen]       = useState(false);
  const [regAgents, setReg]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const panelRef              = useRef(null);
  const { t } = useTranslation();

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
    if (!confirm(t('agent.confirmDelete'))) return;
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

  // ブラウザエンジン選択中はパッシブモードでもヘッダーを正常表示
  const isBrowserSelected = selectedAgentId === '__browser_engine__';
  const dotColor = isPassive && !isBrowserSelected && connectedAgents.length > 0 ? 'bg-amber-400'
    : isConnected ? 'bg-green-400'
    : connectedAgents.length > 0 ? 'bg-yellow-400'
    : 'bg-gray-500';

  const headerLabel = isPassive && !isBrowserSelected && connectedAgents.length > 0
    ? t('agent.otherDeviceInUse')
    : isConnected ? (selectedAgent?.name || t('agent.label'))
    : t('agent.label');

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
            <span className="font-semibold">{t('agent.localAgents')}</span>
            <div className="flex items-center gap-2">
              <a
                href={AGENT_DOWNLOAD_WIN}
                download
                title={t('agent.downloadWindows')}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs
                           bg-blue-700 hover:bg-blue-600 text-white transition-colors"
              >
                <Download size={11} />
                Win
              </a>
              <a
                href={AGENT_DOWNLOAD_MAC}
                download
                title={t('agent.downloadMac')}
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
              {t('agent.online', { count: connectedAgents.length })}
            </p>

            {connectedAgents.length === 0 ? (
              <div className="text-xs text-gray-500 space-y-0.5">
                <p>{t('agent.noConnected')}</p>
                <p className="pt-1 font-medium text-gray-400">{t('agent.connectionGuide')}</p>
                <p>{t('agent.step1')}</p>
                <p>{t('agent.step2')}</p>
                <p>{t('agent.step3')}</p>
              </div>
            ) : (
              <>
                {isPassive && (
                  <p className="text-xs text-amber-400/80 mb-2 px-0.5">
                    {t('agent.anotherDeviceInUse')}
                  </p>
                )}
                <ul className="space-y-1">
                  {connectedAgents.map((agent) => {
                    // ブラウザエンジンはローカルなのでパッシブモードの影響を受けない
                    const isBrowser = agent.agentId === '__browser_engine__';
                    const isSel = isBrowser
                      ? agent.agentId === selectedAgentId
                      : !isPassive && agent.agentId === selectedAgentId;
                    const showAsPassive = isPassive && !isBrowser;
                    return (
                      <li key={agent.agentId}>
                        <div className={`flex items-center gap-1 rounded-lg border
                            ${showAsPassive
                              ? 'bg-amber-900/10 border-amber-700/20'
                              : isSel
                                ? 'bg-green-900/30 border-green-700/40'
                                : 'hover:bg-gray-800 border-transparent'}`}>
                          <button
                            onClick={() => onSelectAgent(agent.agentId)}
                            className="flex items-center gap-2.5 px-2.5 py-2 flex-1 min-w-0 text-left"
                          >
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0
                              ${showAsPassive ? 'bg-amber-400' : isSel ? 'bg-green-400' : 'bg-yellow-400'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate leading-tight">{agent.name}</div>
                              {agent.engineName && (
                                <div className="text-xs text-gray-400 truncate leading-tight mt-0.5">
                                  {agent.engineName}
                                </div>
                              )}
                            </div>
                            <span className={`text-xs flex-shrink-0
                              ${showAsPassive ? 'text-amber-400/70' : isSel ? 'text-green-400' : 'text-gray-500'}`}>
                              {showAsPassive ? t('button.switch', 'Switch') : isSel ? t('status.inUse', 'In use') : t('button.select', 'Select')}
                            </span>
                          </button>
                          {/* 選択中エージェントのみ設定ボタンを表示 */}
                          {isSel && onOpenSettings && (
                            <button
                              onClick={() => { setOpen(false); onOpenSettings(); }}
                              title={t('header.engineSettings')}
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
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('agent.registered')}</p>
              <button onClick={fetchRegistered}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors">{t('button.refresh', 'Refresh')}</button>
            </div>

            {loading && <p className="text-xs text-gray-500 py-1">{t('common.loading')}</p>}
            {error   && <p className="text-xs text-red-400 py-1">{error}</p>}
            {!loading && enriched.length === 0 && (
              <p className="text-xs text-gray-500 py-1">{t('agent.noRegistered')}</p>
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
                        t={t}
                      />
                      {!a.revoked && (
                        <button
                          onClick={() => revokeAgent(a.id)}
                          className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                        >
                          {t('common.delete')}
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
