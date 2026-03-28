// ============================================================
//  ShogiAnalytics — App Server (統合版)
//
//  担当:
//    1. ビルド済みフロントエンド (dist/) の静的配信
//    2. ユーザー認証 (signup / verify / login) — SQLite + SMTP
//    3. WebRTC シグナリング — Socket.io ルーム中継
//
//  USI エンジンは local-agent が担当 (このファイルには含まれない)
//
//  HTTP エンドポイント:
//    POST /auth/signup   → 6桁認証コードをSMTP送信
//    POST /auth/verify   → コード検証・本登録
//    POST /auth/login    → JWT 発行
//    GET  /auth/me       → トークン検証
//    GET  /health        → ヘルスチェック
//
//  Socket.io (WebRTC シグナリング):
//    role=frontend : JWT 必須 → userIdはJWTから自動取得
//    role=agent    : JWT 必須 → userIdはJWTから自動取得
//    ※ agentSecret は廃止。両ロールともJWT認証で統一。
// ============================================================
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const http       = require('http');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const express    = require('express');
const { Server } = require('socket.io');
const Database   = require('better-sqlite3');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');

// ── 設定 ───────────────────────────────────────────────────
const PORT               = parseInt(process.env.PORT || '3010');
const JWT_SECRET         = process.env.JWT_SECRET || null;
const JWT_EXPIRES        = process.env.JWT_EXPIRES || '24h';
const DIST_DIR           = path.join(__dirname, '..', 'dist');
const TURNSTILE_SECRET   = process.env.TURNSTILE_SECRET_KEY || '';

if (!JWT_SECRET) {
  console.warn('[warn] JWT_SECRET 未設定 — 本番環境では必ず設定してください');
}
const JWT_SECRET_SAFE = JWT_SECRET || 'insecure-dev-default-please-change';

// ── Turnstile トークン検証 ───────────────────────────────────
async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) return true; // 未設定時はスキップ
  if (!token) return false;
  const body = new URLSearchParams({
    secret: TURNSTILE_SECRET,
    response: token,
  });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const json = await res.json();
  return json.success === true;
}

// LAN IP 取得
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ── SQLite ─────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'shogi.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    verified      INTEGER DEFAULT 0,
    created_at    INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS verifications (
    email      TEXT PRIMARY KEY,
    code       TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_pairings (
    code        TEXT PRIMARY KEY,
    agent_info  TEXT NOT NULL,
    user_id     TEXT,
    agent_id    TEXT,
    approved    INTEGER DEFAULT 0,
    agent_token TEXT,
    expires_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agents (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    engine_name TEXT,
    revoked     INTEGER DEFAULT 0,
    last_seen   INTEGER,
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS kifs (
    id         TEXT PRIMARY KEY,
    user_key   TEXT NOT NULL,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_kifs_user ON kifs(user_key);
  CREATE TABLE IF NOT EXISTS contact_messages (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    email      TEXT NOT NULL,
    subject    TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
`);
console.log('[db] SQLite 初期化完了 (server/shogi.db)');

// ── SMTP ───────────────────────────────────────────────────
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  console.log(`[mailer] SMTP 設定済み: ${process.env.SMTP_HOST}`);
} else {
  console.log('[mailer] SMTP 未設定 — 認証コードはコンソールに表示されます');
}

async function sendVerificationEmail(email, code) {
  if (!transporter) {
    console.log('\n' + '='.repeat(50));
    console.log(`  📧 宛先: ${email}`);
    console.log(`  🔑 認証コード: ${code}`);
    console.log('='.repeat(50) + '\n');
    return;
  }
  await transporter.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to:      email,
    subject: '【ShogiAnalytics】メール認証コード',
    text:    `認証コード: ${code}\n\n有効期限: 15分`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;
                  background:#1f2937;color:#f9fafb;border-radius:8px;">
        <h2 style="margin-top:0">ShogiAnalytics メール認証</h2>
        <p>以下の認証コードを入力してください：</p>
        <p style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;
                  color:#f59e0b;background:#111827;padding:16px;border-radius:8px;">
          ${code}
        </p>
        <p style="color:#9ca3af;font-size:14px;">有効期限: 15分</p>
      </div>`,
  });
}

// ── JWT ヘルパー ─────────────────────────────────────────────
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET_SAFE, { expiresIn: JWT_EXPIRES });
}
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET_SAFE);
}

// ── 認証ミドルウェア (Express) ────────────────────────────────
// KIF ルート用: JWT ユーザーまたはゲスト ID を受け付ける
function requireKifAuth(req, res, next) {
  const auth    = req.headers.authorization;
  const guestId = req.headers['x-guest-id'];
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    if (token === '__local__') {
      if (!guestId) return res.status(400).json({ error: 'X-Guest-Id ヘッダーが必要です' });
      req.userKey = `guest_${guestId}`;
      return next();
    }
    try {
      const p = verifyToken(token);
      if (p.type === 'agent') return res.status(403).json({ error: 'エージェントトークンでは操作できません' });
      req.userKey = p.userId;
      return next();
    } catch {
      return res.status(401).json({ error: 'トークンが無効または期限切れです' });
    }
  }
  if (guestId) { req.userKey = `guest_${guestId}`; return next(); }
  return res.status(401).json({ error: '認証が必要です' });
}

function requireUser(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res.status(401).json({ error: '認証が必要です' });
  try {
    req.user = verifyToken(auth.slice(7));
    if (req.user.type === 'agent')
      return res.status(403).json({ error: 'エージェントトークンでは操作できません' });
    next();
  } catch {
    res.status(401).json({ error: 'トークンが無効または期限切れです' });
  }
}

// ── Express ────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '5mb' }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Guest-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── 静的配信 ────────────────────────────────────────────────
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
}

// ── ダウンロード配信 (/downloads/ShogiAgent-windows.exe 等) ──
const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
if (fs.existsSync(DOWNLOADS_DIR)) {
  app.use('/downloads', express.static(DOWNLOADS_DIR, { dotfiles: 'deny' }));
}

// ── ヘルスチェック ──────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, service: 'shogi-app-server' }));

// ── GET /api/stats (公開) ──────────────────────────────────
app.get('/api/stats', (_, res) => {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM users WHERE verified = 1').get();
  res.json({ users: count });
});

// ── POST /api/contact (要ログイン) ────────────────────────
app.post('/api/contact', requireUser, async (req, res) => {
  const { subject, body, turnstileToken } = req.body || {};
  if (!subject?.trim() || !body?.trim())
    return res.status(400).json({ error: '件名と本文は必須です' });
  if (!await verifyTurnstile(turnstileToken))
    return res.status(400).json({ error: 'ボット検証に失敗しました。もう一度お試しください' });
  if (subject.trim().length > 100)
    return res.status(400).json({ error: '件名は100文字以内にしてください' });
  if (body.trim().length > 3000)
    return res.status(400).json({ error: '本文は3000文字以内にしてください' });

  db.prepare('INSERT INTO contact_messages (id, user_id, email, subject, body) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), req.user.userId, req.user.email, subject.trim(), body.trim());

  // メール通知 (SMTP設定済みの場合)
  if (transporter) {
    await transporter.sendMail({
      from:    process.env.SMTP_FROM || process.env.SMTP_USER,
      to:      process.env.SMTP_USER,
      subject: `[お問い合わせ] ${subject.trim()}`,
      text:    `差出人: ${req.user.email}\n\n${body.trim()}`,
    }).catch(e => console.error('[contact] mail error:', e.message));
  } else {
    console.log('\n[contact] 新しいお問い合わせ');
    console.log(`  From: ${req.user.email}`);
    console.log(`  件名: ${subject.trim()}`);
    console.log(`  本文: ${body.trim()}\n`);
  }

  res.json({ ok: true });
});

// ── POST /auth/signup ───────────────────────────────────────
app.post('/auth/signup', async (req, res) => {
  const { email, password, turnstileToken } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'email と password は必須です' });
  if (!await verifyTurnstile(turnstileToken))
    return res.status(400).json({ error: 'ボット検証に失敗しました。もう一度お試しください' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: '有効なメールアドレスを入力してください' });
  if (password.length < 8)
    return res.status(400).json({ error: 'パスワードは8文字以上にしてください' });

  try {
    const existing = db.prepare('SELECT id, verified FROM users WHERE email = ?').get(email);
    if (existing?.verified)
      return res.status(409).json({ error: 'このメールアドレスは既に登録済みです' });

    const hash = await bcrypt.hash(password, 12);
    if (existing) {
      db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hash, email);
    } else {
      db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
        .run(crypto.randomUUID(), email, hash);
    }

    const code      = String(crypto.randomInt(100000, 999999));
    const expiresAt = Math.floor(Date.now() / 1000) + 900; // 15分
    db.prepare('INSERT OR REPLACE INTO verifications (email, code, expires_at) VALUES (?, ?, ?)')
      .run(email, code, expiresAt);

    await sendVerificationEmail(email, code);
    res.json({ ok: true, message: '認証コードを送信しました' });
  } catch (e) {
    console.error('[auth] signup error:', e.message);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ── POST /auth/verify ───────────────────────────────────────
app.post('/auth/verify', (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code)
    return res.status(400).json({ error: 'email と code は必須です' });

  const row = db.prepare('SELECT * FROM verifications WHERE email = ?').get(email);
  if (!row)
    return res.status(400).json({ error: '認証コードが見つかりません' });
  if (Math.floor(Date.now() / 1000) > row.expires_at) {
    db.prepare('DELETE FROM verifications WHERE email = ?').run(email);
    return res.status(400).json({ error: '認証コードの有効期限が切れています。再度登録してください' });
  }
  if (row.code !== String(code).trim())
    return res.status(400).json({ error: '認証コードが正しくありません' });

  db.prepare('UPDATE users SET verified = 1 WHERE email = ?').run(email);
  db.prepare('DELETE FROM verifications WHERE email = ?').run(email);
  res.json({ ok: true, message: 'メール認証が完了しました' });
});

// ── POST /auth/login ────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { email, password, turnstileToken } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'email と password は必須です' });
  if (!await verifyTurnstile(turnstileToken))
    return res.status(400).json({ error: 'ボット検証に失敗しました。もう一度お試しください' });

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user)
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
    if (!user.verified)
      return res.status(403).json({ error: 'メール認証が完了していません', needsVerification: true, email });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });

    const token = signToken({ userId: user.id, email: user.email });
    res.json({ ok: true, token, userId: user.id, email: user.email });
  } catch (e) {
    console.error('[auth] login error:', e.message);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ── GET /auth/me ────────────────────────────────────────────
app.get('/auth/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Authorization ヘッダーが必要です' });
  try {
    const p = verifyToken(auth.slice(7));
    res.json({ ok: true, userId: p.userId, email: p.email });
  } catch {
    res.status(401).json({ error: 'トークンが無効または期限切れです' });
  }
});

// ============================================================
//  エージェント ペアリング & 管理 API
// ============================================================

// ── POST /agent/request-pairing ──────────────────────────────
// local-agent が起動時に呼ぶ。認証不要。
app.post('/agent/request-pairing', (req, res) => {
  const { hostname, engineName } = req.body || {};
  const code      = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8文字
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10分
  const agentInfo = JSON.stringify({
    hostname:   hostname   || 'Unknown',
    engineName: engineName || 'Unknown',
  });
  db.prepare('INSERT OR REPLACE INTO agent_pairings (code, agent_info, expires_at) VALUES (?, ?, ?)')
    .run(code, agentInfo, expiresAt);

  // Cloudflare などのリバースプロキシを考慮して URL を構築
  const proto   = req.headers['x-forwarded-proto']?.split(',')[0] || 'http';
  const host    = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const pairingUrl = `${proto}://${host}?pair=${code}`;
  res.json({ ok: true, code, pairingUrl, expiresIn: 600 });
});

// ── GET /agent/pairing-info?code=CODE ────────────────────────
// ブラウザが認証前に agent 情報を取得するために使う。認証不要。
app.get('/agent/pairing-info', (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code は必須です' });
  const row = db.prepare('SELECT * FROM agent_pairings WHERE code = ?').get(code);
  if (!row)  return res.status(404).json({ error: 'ペアリングコードが見つかりません' });
  if (Math.floor(Date.now() / 1000) > row.expires_at)
    return res.status(400).json({ error: 'ペアリングコードの有効期限が切れています' });
  if (row.approved)
    return res.status(400).json({ error: 'このコードは既に使用済みです' });
  res.json({ ok: true, agentInfo: JSON.parse(row.agent_info) });
});

// ── POST /agent/confirm-pairing ──────────────────────────────
// ブラウザからユーザーが認証するときに呼ぶ。ユーザー JWT 必須。
app.post('/agent/confirm-pairing', requireUser, (req, res) => {
  const { code, name } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code は必須です' });

  const row = db.prepare('SELECT * FROM agent_pairings WHERE code = ?').get(code);
  if (!row)  return res.status(404).json({ error: 'ペアリングコードが見つかりません' });
  if (Math.floor(Date.now() / 1000) > row.expires_at)
    return res.status(400).json({ error: 'ペアリングコードの有効期限が切れています' });
  if (row.approved)
    return res.status(400).json({ error: 'このコードは既に使用済みです' });

  const agentInfo = JSON.parse(row.agent_info);
  const agentId   = crypto.randomUUID();
  const agentName = (name || agentInfo.hostname || 'My Agent').slice(0, 64);

  db.prepare('INSERT INTO agents (id, user_id, name, engine_name) VALUES (?, ?, ?, ?)')
    .run(agentId, req.user.userId, agentName, agentInfo.engineName || null);

  // エージェント専用 JWT (30日有効)
  const agentToken = jwt.sign(
    { userId: req.user.userId, agentId, type: 'agent' },
    JWT_SECRET_SAFE,
    { expiresIn: '30d' }
  );

  db.prepare('UPDATE agent_pairings SET approved=1, user_id=?, agent_id=?, agent_token=? WHERE code=?')
    .run(req.user.userId, agentId, agentToken, code);

  res.json({ ok: true, agentId, agentName });
});

// ── GET /agent/poll?code=CODE ────────────────────────────────
// local-agent がペアリング完了を待つために定期ポーリング。認証不要。
app.get('/agent/poll', (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code は必須です' });

  const row = db.prepare('SELECT * FROM agent_pairings WHERE code = ?').get(code);
  if (!row) return res.status(404).json({ error: 'ペアリングコードが見つかりません' });
  if (Math.floor(Date.now() / 1000) > row.expires_at) {
    db.prepare('DELETE FROM agent_pairings WHERE code = ?').run(code);
    return res.status(400).json({ error: 'ペアリングコードの有効期限が切れています' });
  }
  if (!row.approved) return res.json({ ok: true, approved: false });

  const token = row.agent_token;
  db.prepare('DELETE FROM agent_pairings WHERE code = ?').run(code);
  res.json({ ok: true, approved: true, agentToken: token });
});

// ── GET /api/agents ──────────────────────────────────────────
// ユーザーの登録済みエージェント一覧。ユーザー JWT 必須。
app.get('/api/agents', requireUser, (req, res) => {
  const agents = db.prepare(
    `SELECT id, name, engine_name, last_seen, created_at
     FROM agents WHERE user_id = ? AND (revoked IS NULL OR revoked = 0) ORDER BY created_at DESC`
  ).all(req.user.userId);
  res.json({ ok: true, agents });
});

// ── DELETE /api/agents/:id ───────────────────────────────────
// エージェントを無効化。ユーザー JWT 必須。
app.delete('/api/agents/:id', requireUser, (req, res) => {
  const result = db.prepare('DELETE FROM agents WHERE id=? AND user_id=?')
    .run(req.params.id, req.user.userId);
  if (result.changes === 0)
    return res.status(404).json({ error: 'エージェントが見つかりません' });
  res.json({ ok: true });
});

// ── 棋譜クラウド保存 API ─────────────────────────────────────

// POST /api/kif — 保存
app.post('/api/kif', requireKifAuth, (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'title と content は必須です' });
  if (content.length > 200000) return res.status(400).json({ error: '棋譜が大きすぎます (最大 200KB)' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO kifs (id, user_key, title, content) VALUES (?, ?, ?, ?)')
    .run(id, req.userKey, title, content);
  res.json({ ok: true, id });
});

// GET /api/kif — 一覧
app.get('/api/kif', requireKifAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT id, title, created_at FROM kifs WHERE user_key = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.userKey);
  res.json({ ok: true, kifs: rows });
});

// GET /api/kif/:id — 取得
app.get('/api/kif/:id', requireKifAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM kifs WHERE id = ? AND user_key = ?')
    .get(req.params.id, req.userKey);
  if (!row) return res.status(404).json({ error: '棋譜が見つかりません' });
  res.json({ ok: true, kif: row });
});

// DELETE /api/kif/:id — 削除
app.delete('/api/kif/:id', requireKifAuth, (req, res) => {
  const result = db.prepare('DELETE FROM kifs WHERE id = ? AND user_key = ?')
    .run(req.params.id, req.userKey);
  if (result.changes === 0) return res.status(404).json({ error: '棋譜が見つかりません' });
  res.json({ ok: true });
});

// SPA フォールバック (dist/ がある場合)
if (fs.existsSync(DIST_DIR)) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/auth') || req.path.startsWith('/agent') ||
        req.path.startsWith('/api')  || req.path === '/health' || req.path.startsWith('/socket.io'))
      return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// ── HTTP サーバー + Socket.io ───────────────────────────────
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

// ── Socket.io 認証ミドルウェア ────────────────────────────────
// frontend / agent ともに JWT で認証。userId は JWT から自動取得。
io.use((socket, next) => {
  const { role, token } = socket.handshake.query;
  if (role !== 'frontend' && role !== 'agent')
    return next(new Error('invalid role'));
  if (!token)
    return next(new Error('token required'));
  try {
    const payload = verifyToken(token);
    if (role === 'agent') {
      // エージェントは type:'agent' の JWT が必須
      if (payload.type !== 'agent' || !payload.agentId)
        return next(new Error('invalid agent token'));
      // 失効チェック
      const agentRow = db.prepare('SELECT id, name, engine_name, revoked FROM agents WHERE id = ?').get(payload.agentId);
      if (!agentRow || agentRow.revoked)
        return next(new Error('agent revoked or not found'));
      // 名前変更があればDBを更新
      const { agentName, engineName: engineNameQ } = socket.handshake.query;
      if (agentName || engineNameQ) {
        db.prepare(`UPDATE agents SET
          name       = CASE WHEN ? != '' THEN ? ELSE name END,
          engine_name= CASE WHEN ? != '' THEN ? ELSE engine_name END
          WHERE id = ?`)
          .run(agentName || '', agentName || '', engineNameQ || '', engineNameQ || '', payload.agentId);
      }
      const updatedRow = db.prepare('SELECT name, engine_name FROM agents WHERE id = ?').get(payload.agentId);
      socket.data.agentInfo = { agentId: agentRow.id, name: updatedRow.name, engineName: updatedRow.engine_name };
      // last_seen 更新
      db.prepare('UPDATE agents SET last_seen = strftime(\'%s\',\'now\') WHERE id = ?').run(payload.agentId);
    } else {
      // frontend は type:'agent' のトークンで接続不可
      if (payload.type === 'agent')
        return next(new Error('cannot use agent token as frontend'));
    }
    socket.data.user   = payload;
    socket.data.userId = payload.userId;
    return next();
  } catch {
    return next(new Error('invalid or expired token'));
  }
});

// ── シグナリング ルームロジック ────────────────────────────────
// rooms: Map<userId, { frontend: Socket|null, agents: Map<agentId, Socket> }>
const rooms = new Map();

function getRoom(userId) {
  if (!rooms.has(userId)) rooms.set(userId, { frontend: null, pendingFrontend: null, agents: new Map() });
  return rooms.get(userId);
}

// フロントエンドソケットをアクティブ化 (offer/ICE中継 + disconnect処理を登録)
function activateFrontend(socket, room, userId, logId) {
  room.frontend = socket;

  // 既に接続中のエージェントを全て通知
  for (const [, agSock] of room.agents) {
    socket.emit('agent-connected', agSock.data.agentInfo);
  }

  socket.on('offer', ({ agentId, sdp, type }) => {
    console.log(`[sig] offer  frontend→agent(${agentId?.slice(0,8)}…) ${logId}…`);
    room.agents.get(agentId)?.emit('offer', { sdp, type });
  });
  socket.on('ice-candidate', ({ agentId, ...rest }) => {
    room.agents.get(agentId)?.emit('ice-candidate', rest);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[sig] disconnect role=frontend userId=${logId}… reason=${reason}`);
    if (room.frontend === socket) {
      room.frontend = null;
      for (const [, agSock] of room.agents) {
        agSock.emit('peer-left', { role: 'frontend' });
      }
      // 待機中フロントエンドがあれば自動昇格
      if (room.pendingFrontend && !room.pendingFrontend.disconnected) {
        const pending = room.pendingFrontend;
        room.pendingFrontend = null;
        console.log(`[sig] auto-promoting pendingFrontend userId=${logId}…`);
        pending.emit('promoted');
        activateFrontend(pending, room, userId, logId);
      }
    }
    if (!room.frontend && room.agents.size === 0) rooms.delete(userId);
  });
}

io.on('connection', (socket) => {
  const { role } = socket.handshake.query;
  const userId   = socket.data.userId;
  const room     = getRoom(userId);
  const logId    = userId.slice(0, 8);

  console.log(`[sig] connect  role=${role} userId=${logId}…`);

  if (role === 'frontend') {
    const existing = room.frontend;

    if (existing && !existing.disconnected) {
      // 別のブラウザがアクティブ、または同一ブラウザの再接続競合
      // → 2.5秒待ち: 旧ソケットが自然切断すれば再接続とみなして即昇格 (false positive 防止)
      console.log(`[sig] existing frontend for userId=${logId}… waiting 2.5s to check if reconnect`);
      room.pendingFrontend = socket;

      let graceTimer = setTimeout(() => {
        graceTimer = null;
        if (socket.disconnected) return; // 待機中に新ソケットも切断済み
        if (!existing.disconnected) {
          // 旧ソケットがまだ生きている → 本当に別デバイス
          console.log(`[sig] another device confirmed for userId=${logId}… sending another_device_active`);
          socket.emit('another_device_active');
          // パッシブ側にも現在接続中のエージェント情報を送る (表示用)
          for (const [, agSock] of room.agents) {
            socket.emit('agent-connected', agSock.data.agentInfo);
          }
        } else {
          // 旧ソケットが切断済み → 再接続とみなして昇格 (promoted を送らず静かにアクティブ化)
          console.log(`[sig] old socket gone during grace — silently activating reconnected frontend userId=${logId}…`);
          if (room.pendingFrontend === socket) {
            room.pendingFrontend = null;
            activateFrontend(socket, room, userId, logId);
          }
        }
      }, 2500);

      socket.once('take_over', () => {
        console.log(`[sig] take_over confirmed for userId=${logId}…`);
        clearTimeout(graceTimer);
        room.pendingFrontend = null;
        existing.emit('taken_over');
        try { existing.disconnect(true); } catch (_) {}
        activateFrontend(socket, room, userId, logId);
      });

      // 引き継がずに切断した場合のクリーンアップ
      socket.once('disconnect', (reason) => {
        clearTimeout(graceTimer);
        console.log(`[sig] pending frontend disconnect userId=${logId}… reason=${reason}`);
        if (room.pendingFrontend === socket) room.pendingFrontend = null;
        if (!room.frontend && room.agents.size === 0) rooms.delete(userId);
      });
      return;
    }

    // 旧フロントエンドが切断済みの場合はクリーンアップしてアクティブ化
    if (existing) { try { existing.disconnect(true); } catch (_) {} }
    activateFrontend(socket, room, userId, logId);

  } else {
    // role === 'agent'
    const agentId   = socket.data.agentInfo.agentId;
    const agentInfo = socket.data.agentInfo;

    // 同一 agentId の古い接続を置き換え
    if (room.agents.has(agentId)) {
      try { room.agents.get(agentId).disconnect(true); } catch (_) {}
    }
    room.agents.set(agentId, socket);

    // フロントエンド (アクティブ・パッシブ両方) にエージェント接続を通知
    room.frontend?.emit('agent-connected', agentInfo);
    room.pendingFrontend?.emit('agent-connected', agentInfo);

    // エージェントにフロントエンドが既接続なら通知
    if (room.frontend) socket.emit('peer-joined', { role: 'frontend' });

    // answer / ICE はエージェントIDを付けてフロントエンドへ中継
    socket.on('answer', ({ sdp, type }) => {
      console.log(`[sig] answer agent(${agentId.slice(0,8)}…)→frontend ${logId}…`);
      room.frontend?.emit('answer', { agentId, sdp, type });
    });
    socket.on('ice-candidate', (d) => {
      room.frontend?.emit('ice-candidate', { agentId, ...d });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[sig] disconnect role=agent agentId=${agentId.slice(0,8)}… reason=${reason}`);
      if (room.agents.get(agentId) === socket) {
        room.agents.delete(agentId);
        room.frontend?.emit('agent-disconnected', { agentId });
        room.pendingFrontend?.emit('agent-disconnected', { agentId });
      }
      if (!room.frontend && room.agents.size === 0) rooms.delete(userId);
    });
  }
});

// ── サーバー起動 ────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const lan     = getLocalIP();
  const hasDist = fs.existsSync(DIST_DIR);
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   ShogiAnalytics App Server 起動中           ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  ローカル : http://localhost:${PORT}            ║`);
  console.log(`║  LAN     : http://${lan}:${PORT}           ║`);
  if (hasDist) {
    console.log('║  フロント : dist/ 配信中                     ║');
  } else {
    console.log('║  ※ dist/ 未検出 — npm run build を先に実行  ║');
  }
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  認証 API:                                    ║');
  console.log('║  POST /auth/signup  /auth/verify  /auth/login ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  外部公開:                                    ║');
  console.log(`║  cloudflared tunnel --url http://localhost:${PORT} ║`);
  console.log('╚══════════════════════════════════════════════╝\n');
});
