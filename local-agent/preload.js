'use strict';
const { ipcRenderer } = require('electron');

window.api = {
  // 設定
  loadConfig:      ()    => ipcRenderer.invoke('config:load'),
  saveConfig:      (cfg) => ipcRenderer.invoke('config:save', cfg),
  browseEngine:    ()    => ipcRenderer.invoke('config:browse-engine'),

  // エンジン制御
  engineStart:     (p)   => ipcRenderer.invoke('engine:start', p),
  engineSend:      (cmd) => ipcRenderer.send('engine:send', cmd),
  engineKill:      ()    => ipcRenderer.invoke('engine:kill'),
  saveEngineOpts:  (cfg) => ipcRenderer.invoke('engine:save-options', cfg),

  // シェル
  openExternal:    (url) => ipcRenderer.invoke('shell:open-external', url),

  // エンジン出力イベント (main → renderer)
  onEngineLine:    (fn)  => ipcRenderer.on('engine:line',  (_e, v) => fn(v)),
  onEngineExit:    (fn)  => ipcRenderer.on('engine:exit',  (_e, v) => fn(v)),
  onEngineError:   (fn)  => ipcRenderer.on('engine:error', (_e, v) => fn(v)),
};
