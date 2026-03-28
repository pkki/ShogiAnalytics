// ============================================================
//  ShogiAnalytics — Signaling Server (認証付き)
//
//  HTTP エンドポイント (Express):
//    POST /auth/signup   → 6桁コードをSMTP送信
//    POST /auth/verify   → コード検証・本登録
//    POST /auth/login    → JWT 発行
//    GET  /auth/me       → トークン確認
//    GET  /health        → ヘルスチェック
//
//  WebSocket (Socket.io):
//    role=frontend: JWT 必須
//    role=agent:    AGENT_SECRET 必須
//
//  .env: JWT_SECRET, AGENT_SECRET, SMTP_*, PORT
// ============================================================
'use strict';

require('dotenv').config();

const http      = require('http');
const express   = require('express');
const { Server } = require('socket.io');
const Database  = require('better-sqlite3');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto    = require('crypto');
const path      = require('path');

// ── 設定 ───────────────────────────────────────────────────
const PORT         = parseInt(process.env.PORT || '8080');
const JWT_SECRET   = process.env.JWT_SECRET   || null;
const JWT_EXPIRES  = process.env.JWT_EXPIRES  || '24h';
const AGENT_SECRET = process.env.AGENT_SECRET || null;

if (!JWT_SECRET) {
  console.warn('[warn] JWT_SECRET が未設定です。本番環境では必ず設定してください。');
}
if (!AGENT_SECRET) {
  console.warn('[warn] AGENT_SECRET が未設定です。エージェント認証が無効です。');
}
const JWT_SECRET_SAFE = JWT_SECRET || 'insecure-dev-default-please-change';

// ── SQLite データベース ──────────────────────────────────────
const db = new Database(path.join(__dirname, 'shogi.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    verified     INTEGER DEFAULT 0,
    created_at   INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS verifications (
    email      TEXT PRIMARY KEY,
    code       TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);
console.log('[db] SQLite 初期化完了 (shogi.db)');

// ── SMTP メーラー ────────────────────────────────────────────
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log(`[mailer] SMTP 設定済み: ${process.env.SMTP_HOST}`);
} else {
  console.log('[mailer] SMTP 未設定 — 認証コードはコンソールに表示されます');
}

async function sendVerificationEmail(email, code) {
  if (!transporter) {
    // SMTP 未設定時はコンソールに表示（開発・テスト用）
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
    text:    `認証コード: ${code}\n\n有効期限: 15分\n\nこのメールに心当たりがない場合は無視してください。`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#1f2937;color:#f9fafb;border-radius:8px;">
        <h2 style="color:#f9fafb;margin-top:0">ShogiAnalytics メール認証</h2>
        <p>以下の認証コードを入力してください：</p>
        <p style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;color:#f59e0b;background:#111827;padding:16px;border-radius:8px;">
          ${code}
        </p>
        <p style="color:#9ca3af;font-size:14px;">有効期限: 15分<br>このメールに心当たりがない場合は無視してください。</p>
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

// ── Express アプリ ───────────────────────────────────────────
const app = express();
app.use(express.json());

// CORS (クラウドフレアトンネル等からのアクセスを許可)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── ヘルスチェック ─────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, service: 'shogi-signaling' }));

// ── POST /auth/signup ─────────────────────────────────────
app.post('/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'email と password は必須です' });
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

    // 6桁のランダムな認証コードを生成（15分有効）
    const code      = String(crypto.randomInt(100000, 999999));
    const expiresAt = Math.floor(Date.now() / 1000) + 900;
    db.prepare('INSERT OR REPLACE INTO verifications (email, code, expires_at) VALUES (?, ?, ?)')
      .run(email, code, expiresAt);

    await sendVerificationEmail(email, code);
    res.json({ ok: true, message: '認証コードを送信しました' });
  } catch (e) {
    console.error('[auth] signup error:', e.message);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ── POST /auth/verify ─────────────────────────────────────
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
  res.json({ ok: true, message: 'メール認証が完了しました。ログインしてください' });
});

// ── POST /auth/login ──────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'email と password は必須です' });

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

// ── GET /auth/me ──────────────────────────────────────────
app.get('/auth/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Authorization ヘッダーが必要です' });
  try {
    const payload = verifyToken(auth.slice(7));
    res.json({ ok: true, userId: payload.userId, email: payload.email });
  } catch {
    res.status(401).json({ error: 'トークンが無効または期限切れです' });
  }
});

// ============================================================
//  HTTP サーバー + Socket.io
// ============================================================
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

// ── Socket.io 認証ミドルウェア ────────────────────────────
io.use((socket, next) => {
  const { role, token, agentSecret } = socket.handshake.query;

  if (role === 'agent') {
    // エージェント: AGENT_SECRET で認証
    if (!AGENT_SECRET) return next(); // AGENT_SECRET 未設定は開発用としてパス
    if (agentSecret !== AGENT_SECRET)
      return next(new Error('agent auth failed: invalid secret'));
    return next();
  }

  if (role === 'frontend') {
    // フロントエンド: JWT で認証
    if (!token)
      return next(new Error('token required'));
    try {
      socket.data.user = verifyToken(token);
      return next();
    } catch (e) {
      return next(new Error('invalid or expired token'));
    }
  }

  next(new Error('invalid role'));
});

// ============================================================
//  シグナリング ルームロジック
// ============================================================
// rooms: Map<userId, { frontend: Socket|null, agent: Socket|null }>
const rooms = new Map();

function getRoom(userId) {
  if (!rooms.has(userId)) rooms.set(userId, { frontend: null, agent: null });
  return rooms.get(userId);
}

io.on('connection', (socket) => {
  const { userId, role } = socket.handshake.query;
  const peer = role === 'frontend' ? 'agent' : 'frontend';
  const user = socket.data.user;

  console.log(`[signaling] connect  userId=${userId} role=${role}${user ? ` email=${user.email}` : ''}`);

  const room = getRoom(userId);

  // 古い接続を置き換え
  if (room[role]) {
    try { room[role].disconnect(true); } catch (_) {}
  }
  room[role] = socket;

  // 相手が既に接続中なら通知
  if (room[peer]) {
    socket.emit('peer-joined', { role: peer });
    room[peer].emit('peer-joined', { role });
  }

  // SDP / ICE 中継
  socket.on('offer',         (data) => { console.log(`[signaling] offer  ${role}→${peer} userId=${userId}`); room[peer]?.emit('offer', data); });
  socket.on('answer',        (data) => { console.log(`[signaling] answer ${role}→${peer} userId=${userId}`); room[peer]?.emit('answer', data); });
  socket.on('ice-candidate', (data) => room[peer]?.emit('ice-candidate', data));

  socket.on('disconnect', (reason) => {
    console.log(`[signaling] disconnect userId=${userId} role=${role} reason=${reason}`);
    if (room[role] === socket) {
      room[role] = null;
      room[peer]?.emit('peer-left', { role });
    }
    if (!room.frontend && !room.agent) rooms.delete(userId);
  });
});

// ============================================================
//  サーバー起動
// ============================================================
server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   ShogiAnalytics Signaling Server            ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  ポート    : ${PORT}                              ║`);
  console.log(`║  DB        : shogi.db                        ║`);
  console.log(`║  JWT 有効期限: ${JWT_EXPIRES}                     ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  エンドポイント:                              ║');
  console.log('║  POST /auth/signup   (新規登録)               ║');
  console.log('║  POST /auth/verify   (コード確認)             ║');
  console.log('║  POST /auth/login    (ログイン/JWT発行)       ║');
  console.log('║  GET  /auth/me       (トークン確認)           ║');
  console.log('╚══════════════════════════════════════════════╝\n');
});
