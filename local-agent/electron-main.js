'use strict';
// ============================================================
//  ShogiAgent — Electron メインプロセス
//  エンジンプロセス管理 + ウィンドウ/トレイ管理
//  WebRTC はレンダラー (ブラウザネイティブ) で動く
// ============================================================
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const cp    = require('child_process');
const rl    = require('readline');

// ── パス ──────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
  serverUrl:          'https://analytics.pkkis.com',
  agentToken:         '',
  enginePath:         '',
  agentName:          '',
  engineDisplayName:  '',
  engineOptions:      {},
};

// ── ウィンドウ / トレイ ────────────────────────────────────
let win  = null;
let tray = null;

// ── エンジン状態 ────────────────────────────────────────────
let engineProc = null;

// ── 設定 ────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH))
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch (_) {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('設定保存失敗:', e.message);
    return false;
  }
}

// ── ウィンドウ作成 ─────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, 'icons', 'icon-512x512.png');

  win = new BrowserWindow({
    width:  800,
    height: 600,
    minWidth:  600,
    minHeight: 450,
    title: 'ShogiAgent',
    icon: iconPath,
    backgroundColor: '#0f172a',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration:  true,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));

  win.once('ready-to-show', () => win.show());

  // × ボタン → バックグラウンド動作の確認
  win.on('close', (e) => {
    e.preventDefault();
    dialog.showMessageBox(win, {
      type:    'question',
      title:   'ShogiAgent',
      message: 'バックグラウンドで動作を続けますか？',
      detail:  'はい: タスクトレイに残り接続を維持します\nいいえ: 完全に終了します',
      buttons: ['はい（バックグラウンドで動作）', 'いいえ（完全に終了）'],
      defaultId: 0,
      cancelId:  0,
    }).then(({ response }) => {
      if (response === 0) {
        win.hide();
      } else {
        app.exit(0);
      }
    });
  });
}

// ── トレイ ────────────────────────────────────────────────
function createTray() {
  const trayIconPath = path.join(__dirname, 'icons', 'favicon-32x32.png');
  const iconImg = nativeImage.createFromPath(trayIconPath);

  tray = new Tray(iconImg);
  tray.setToolTip('ShogiAgent');

  const menu = Menu.buildFromTemplate([
    { label: '開く',   click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: '終了',   click: () => { app.exit(0); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => { win.show(); win.focus(); });
}

// ── IPC: シェル ────────────────────────────────────────────
ipcMain.handle('shell:open-external', (_e, url) => shell.openExternal(url));

// ── IPC: 設定 ──────────────────────────────────────────────
ipcMain.handle('config:load', () => loadConfig());

ipcMain.handle('config:save', (_e, cfg) => {
  const ok = saveConfig(cfg);
  return ok;
});

ipcMain.handle('config:browse-engine', async () => {
  // macOS/Linux では実行ファイルに拡張子がないためフィルターを分岐
  const filters = process.platform === 'win32'
    ? [{ name: 'Executable', extensions: ['exe'] }, { name: 'All', extensions: ['*'] }]
    : [{ name: 'All Files', extensions: ['*'] }];
  const result = await dialog.showOpenDialog(win, {
    title:      'エンジン実行ファイルを選択',
    filters,
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ── IPC: エンジン制御 ──────────────────────────────────────
ipcMain.handle('engine:start', (_e, enginePath) => {
  if (engineProc && engineProc.exitCode === null) {
    return { ok: false, reason: 'already_running' };
  }
  if (!enginePath || !fs.existsSync(enginePath)) {
    return { ok: false, reason: 'not_found' };
  }
  const dir = path.dirname(enginePath);
  try {
    engineProc = cp.spawn(enginePath, [], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    return { ok: false, reason: err.message };
  }

  const reader = rl.createInterface({ input: engineProc.stdout });
  reader.on('line', (line) => {
    if (win && !win.isDestroyed()) win.webContents.send('engine:line', line);
  });

  engineProc.stderr.on('data', () => {}); // 無視
  // EPIPE は非同期で発生するため try-catch では捕捉できない — エラーハンドラで抑制
  engineProc.stdin.on('error', () => {});

  engineProc.on('exit', (code) => {
    engineProc = null;
    if (win && !win.isDestroyed()) win.webContents.send('engine:exit', code);
  });

  engineProc.on('error', (err) => {
    if (win && !win.isDestroyed()) win.webContents.send('engine:error', err.message);
  });

  return { ok: true };
});

ipcMain.on('engine:send', (_e, cmd) => {
  if (engineProc && engineProc.stdin && engineProc.exitCode === null) {
    try { engineProc.stdin.write(cmd + '\n'); } catch (_) {}
  }
});

ipcMain.handle('engine:kill', () => {
  if (!engineProc || engineProc.exitCode !== null) return true;
  return new Promise((resolve) => {
    const proc = engineProc;
    // 既に終了していたらすぐ解決
    proc.once('exit', () => resolve(true));
    try { proc.stdin.write('quit\n'); } catch (_) {}
    // quit を無視するエンジンへの保険: 1.5秒後に強制kill
    setTimeout(() => { try { proc.kill(); } catch (_) {} }, 1500);
  });
});

ipcMain.handle('engine:save-options', (_e, cfg) => {
  saveConfig(cfg);
  return true;
});

// ── シングルインスタンス ───────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 既に起動中 → 既存ウィンドウを前面に出して終了
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  // ── アプリ起動 ─────────────────────────────────────────
  app.whenReady().then(() => {
    createWindow();
    createTray();
  });

  app.on('window-all-closed', (e) => e.preventDefault()); // トレイに残す
  app.on('before-quit', () => {
    if (engineProc) { try { engineProc.kill(); } catch (_) {} }
  });
}