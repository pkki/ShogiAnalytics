// ============================================================
//  src/webrtc/bridge.js
//  VirtualSocket — socket.io と同じ .on()/.emit()/.disconnect()
//  シグナリング接続に socket.io-client を使用 (ブラウザ標準 RTCPeerConnection)
//
//  マルチエージェント対応:
//    - agent-connected / agent-disconnected イベントで接続一覧を管理
//    - emit('__select_agent', agentId) で対象エージェントを切り替え
//    - 最初に接続してきたエージェントを自動選択
//    - 選択中エージェント切断時は次のオンラインエージェントに自動フォールバック
//    - シグナリング再接続時は前回選択エージェントを優先復帰
//
//  別デバイス接続対応:
//    - isPassive=true のとき: agent-connected イベントは通知するが WebRTC は確立しない
//    - emit('__take_over') でパッシブ解除 → サーバーに take_over 送信 → 通常動作へ
// ============================================================
import { io as signalingIO } from 'socket.io-client';

const SERVER_URL   = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:3010';
const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function parseJwt(token) {
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return {}; }
}

export function createWebRTCSocket(token) {
  const { userId } = parseJwt(token);

  const handlers   = {};
  const sendQueue  = [];
  let pc             = null;   // 現在のRTCPeerConnection
  let dc             = null;   // 現在のDataChannel
  let sigSk          = null;
  let selectedAgentId  = null; // 現在選択中のエージェント
  let preferredAgentId = null; // シグナリング再接続後に優先選択するエージェント
  // パッシブモード: 別デバイスが接続中。DC が生きている間は手動切替まで接続しない
  let isPassive = false;
  // 手動で引き継がれた (taken_over) フラグ: DC があっても手動切替まで接続しない
  let manuallyDisplaced = false;
  // ページ可視性追跡: DC が開いた状態でバックグラウンドに移行したか
  // → another_device_active 受信時に自分自身の旧セッション起因かを判定するために使用
  let pageWasActive  = false; // バックグラウンド移行時に DC が開いていたか
  let pageHiddenAt   = 0;    // バックグラウンドに移行した時刻

  // シグナリング経由で接続中のエージェントを追跡
  const connectedAgentInfos = new Map(); // agentId → agentInfo

  // Page Visibility API: DC が開いた状態でバックグラウンドへ移行した瞬間を記録
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && dc && dc.readyState === 'open') {
        pageWasActive = true;
        pageHiddenAt  = Date.now();
      }
    });
  }

  const socket = {
    on(event, handler) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return socket;
    },
    emit(event, data) {
      // ブリッジ内部コマンド — DataChannel には送らない
      if (event === '__select_agent') {
        if (!isPassive) startWebRTCWithAgent(data);
        return socket;
      }
      if (event === '__take_over') {
        // data = 引き継ぎ後に選択したい agentId (null なら自動選択)
        isPassive = false;
        manuallyDisplaced = false; // 手動で切り替えたのでフラグ解除
        preferredAgentId = data || null;
        selectedAgentId = null;
        connectedAgentInfos.clear();
        closePcDc();
        sigSk.emit('take_over');
        return socket;
      }
      const msg = JSON.stringify({ event, data });
      if (dc && dc.readyState === 'open') { dc.send(msg); }
      else { sendQueue.push(msg); }
      return socket;
    },
    disconnect() {
      try { dc?.close();  } catch (_) {}
      try { pc?.close();  } catch (_) {}
      try { sigSk?.disconnect(); } catch (_) {}
    },
  };

  function fire(event, ...args) {
    (handlers[event] || []).forEach((h) => {
      try { h(...args); } catch (e) { console.error('[bridge] handler error', event, e); }
    });
  }

  function onDcOpen() {
    console.log('[bridge] DataChannel open — flushing', sendQueue.length, 'queued messages');
    while (sendQueue.length > 0) dc.send(sendQueue.shift());
    fire('connect');
  }

  function onDcMessage(ev) {
    try { const { event, data } = JSON.parse(ev.data); fire(event, data); }
    catch { console.warn('[bridge] invalid message', ev.data); }
  }

  function setupDataChannel(channel) {
    dc = channel;
    dc.onopen    = onDcOpen;
    dc.onmessage = onDcMessage;
    dc.onclose   = () => {
      // pc がまだ残っていれば予期しないクローズ
      const unexpected = !!pc;
      dc = null;
      console.log('[bridge] DataChannel closed', unexpected ? '(unexpected)' : '(intentional)');
      if (!unexpected) return;

      fire('connect_error', new Error('DataChannel closed'));

      // taken_over を受け取っていない (manuallyDisplaced=false) なら再接続する
      if (manuallyDisplaced) {
        // taken_over で意図的にパッシブ化 → 再接続しない
        try { pc?.close(); } catch (_) {} pc = null;
        return;
      }

      // パッシブ状態を解除して再接続
      isPassive = false;
      const prevAgentId = selectedAgentId;
      selectedAgentId = null;
      try { pc?.close(); } catch (_) {} pc = null;

      if (prevAgentId && connectedAgentInfos.has(prevAgentId)) {
        setTimeout(() => {
          if (selectedAgentId) return;
          console.log('[bridge] Auto-reconnecting to agent:', prevAgentId);
          startWebRTCWithAgent(prevAgentId);
          const info = connectedAgentInfos.get(prevAgentId);
          if (info) fire('agent:selected', info);
        }, 1000);
      } else {
        // エージェントもいなくなった → agent-connected で復帰
        fire('device_activated');
      }
    };
  }

  function onError(reason) {
    console.error('[bridge] error:', reason);
    fire('connect_error', new Error(reason));
  }

  function closePcDc() {
    if (dc) { try { dc.close(); } catch (_) {} dc = null; }
    if (pc) { try { pc.close(); } catch (_) {} pc = null; }
  }

  function startWebRTCWithAgent(agentId) {
    console.log('[bridge] Establishing WebRTC with agent:', agentId);
    sendQueue.length = 0;
    closePcDc();
    selectedAgentId = agentId;

    const myPc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pc = myPc;
    setupDataChannel(pc.createDataChannel('shogi', { ordered: true }));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        sigSk.emit('ice-candidate', {
          agentId,
          candidate:     candidate.candidate,
          sdpMid:        candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        });
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (myPc !== pc) return;
      console.log('[bridge] ICE:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected')
        onError('ICE ' + pc.iceConnectionState);
    };

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => sigSk.emit('offer', { agentId, sdp: pc.localDescription.sdp, type: pc.localDescription.type }))
      .catch((e) => onError(e.message));
  }

  // ── シグナリング接続 ─────────────────────────────────────
  sigSk = signalingIO(SERVER_URL, {
    query:      { role: 'frontend' },
    auth:       { token },
    transports: ['websocket', 'polling'],
  });

  sigSk.on('connect', () => {
    console.log('[bridge] Signaling connected. userId:', userId);

    // DataChannel がまだ生きているなら WebRTC を再起動しない
    const dcAlive = dc && dc.readyState === 'open';
    connectedAgentInfos.clear();

    if (dcAlive) {
      console.log('[bridge] Signaling reconnected with live DataChannel — keeping WebRTC session');
      return;
    }

    if (isPassive) {
      // パッシブ中の再接続はそのまま待機
      // agent-connected で DC 未接続なら自動復帰する
      console.log('[bridge] Signaling reconnected while passive — staying passive');
      return;
    }

    // アクティブデバイスの再接続: WebRTC を再確立する
    preferredAgentId = selectedAgentId;
    selectedAgentId  = null;
    closePcDc();

    if (preferredAgentId) {
      setTimeout(() => {
        if (selectedAgentId || isPassive) return;
        preferredAgentId = null;
        const next = connectedAgentInfos.values().next().value;
        if (next) {
          console.log('[bridge] preferred agent gone — falling back to:', next.agentId);
          startWebRTCWithAgent(next.agentId);
          fire('agent:selected', next);
        }
      }, 3000);
    }
  });

  // アクティブ frontend が切断し、このソケットが自動昇格された
  sigSk.on('promoted', () => {
    if (!isPassive) {
      // パッシブモードに入る前に promoted が届いた (再接続競合の自動解消)
      // DataChannel を壊さないよう何もせず device_activated だけ発火して終了
      console.log('[bridge] promoted received while not passive — ignored (reconnect race)');
      fire('device_activated');
      return;
    }
    // manuallyDisplaced であっても promoted = 相手デバイスが切断済みなので復帰する
    manuallyDisplaced = false;
    console.log('[bridge] Promoted to active frontend — leaving passive mode');
    isPassive = false;
    selectedAgentId = null;
    preferredAgentId = null;
    connectedAgentInfos.clear();
    closePcDc();
    fire('device_activated');
    // agent-connected イベントが activateFrontend から続いて届くので WebRTC は自動起動
  });

  // 同一アカウントで別ブラウザが接続中 → パッシブモードへ
  sigSk.on('another_device_active', () => {
    // DC が開いたまま直前にバックグラウンドへ移行していた場合 (60秒以内) は
    // 自分自身の旧セッション (凍結ソケット) が原因とみなして自動引き継ぎ
    if (!manuallyDisplaced && pageWasActive && Date.now() - pageHiddenAt < 60_000) {
      console.log('[bridge] Detected self-reconnect after background — auto-taking over own frozen session');
      pageWasActive = false;
      pageHiddenAt  = 0;
      preferredAgentId = null;
      selectedAgentId  = null;
      connectedAgentInfos.clear();
      closePcDc();
      sigSk.emit('take_over');
      return;
    }
    console.log('[bridge] Another device is active — entering passive mode');
    isPassive = true;
    closePcDc();
    selectedAgentId = null;
    fire('another_device_active');
  });

  // 別デバイスに引き継がれた (このデバイスは強制切断)
  sigSk.on('taken_over', () => {
    console.log('[bridge] Session taken over by another device');
    isPassive = true;
    manuallyDisplaced = true; // 手動で引き継がれた → 手動操作まで自動復帰しない
    selectedAgentId = null;
    preferredAgentId = null;
    connectedAgentInfos.clear();
    closePcDc();
    fire('taken_over');
    // サーバーが disconnect(true) するので socket.io は自動再接続しない → 手動で再接続してパッシブモードへ
    setTimeout(() => { if (!sigSk.connected) sigSk.connect(); }, 500);
  });

  sigSk.on('connect_error', (err) => {
    console.error('[bridge] Signaling failed:', err.message);
    if (err.message.includes('invalid') || err.message.includes('token') || err.message.includes('expired')) {
      localStorage.removeItem('shogi_jwt');
      fire('auth_error', err);
    }
    onError('signaling: ' + err.message);
  });

  // エージェントがシグナリングに接続してきた
  sigSk.on('agent-connected', (agentInfo) => {
    console.log('[bridge] Agent connected to signaling:', agentInfo);
    connectedAgentInfos.set(agentInfo.agentId, agentInfo);
    fire('agent:connected', agentInfo);

    // パッシブ中はエージェント一覧のみ更新 — WebRTC は確立しない
    // promoted イベント または 手動切替 (__take_over) でのみ復帰する
    if (isPassive) return;

    if (!selectedAgentId) {
      if (!preferredAgentId || preferredAgentId === agentInfo.agentId) {
        preferredAgentId = null;
        startWebRTCWithAgent(agentInfo.agentId);
        fire('agent:selected', agentInfo);
      }
    }
  });

  // エージェントがシグナリングから切断した
  sigSk.on('agent-disconnected', ({ agentId }) => {
    console.log('[bridge] Agent disconnected:', agentId);
    connectedAgentInfos.delete(agentId);
    fire('agent:disconnected', { agentId });

    if (selectedAgentId === agentId) {
      selectedAgentId = null;
      closePcDc();
      fire('agent:left');

      if (!isPassive) {
        const next = connectedAgentInfos.values().next().value;
        if (next) {
          console.log('[bridge] selected agent left — auto-selecting:', next.agentId);
          startWebRTCWithAgent(next.agentId);
          fire('agent:selected', next);
        }
      }
    }
  });

  // SDP answer: agentId でフィルタリング
  sigSk.on('answer', ({ agentId: answerAgentId, sdp, type }) => {
    if (answerAgentId !== selectedAgentId || !pc) return;
    pc.setRemoteDescription(new RTCSessionDescription({ sdp, type }))
      .catch((e) => onError('setRemoteDescription: ' + e.message));
  });

  // ICE candidate: agentId でフィルタリング
  sigSk.on('ice-candidate', ({ agentId: candAgentId, candidate, sdpMid, sdpMLineIndex }) => {
    if (candAgentId !== selectedAgentId || !pc) return;
    if (candidate) {
      pc.addIceCandidate(new RTCIceCandidate({ candidate, sdpMid, sdpMLineIndex }))
        .catch((e) => console.warn('[bridge] addIceCandidate:', e.message));
    }
  });

  return socket;
}
