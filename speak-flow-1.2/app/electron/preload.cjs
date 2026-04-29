const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();

function subscribe(channel, callback) {
  const wrapped = (_event, payload) => callback(payload);
  const item = { channel, wrapped };
  ipcRenderer.on(channel, wrapped);
  listeners.add(item);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
    listeners.delete(item);
  };
}

contextBridge.exposeInMainWorld("speakon", {
  isElectron: true,
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  getHistory: () => ipcRenderer.invoke("history:get"),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  processAudio: (payload) => ipcRenderer.invoke("audio:process", payload),
  rewriteText: (payload) => ipcRenderer.invoke("text:rewrite", payload),
  cancelJob: (requestId) => ipcRenderer.invoke("job:cancel", requestId),
  getLocalAsrStatus: () => ipcRenderer.invoke("asr:local-status"),
  startSystemSpeech: (payload) => ipcRenderer.invoke("system-speech:start", payload),
  stopSystemSpeech: (payload) => ipcRenderer.invoke("system-speech:stop", payload),
  getGestureStatus: () => ipcRenderer.invoke("gesture:get-status"),
  restartGestureHelper: () => ipcRenderer.invoke("gesture:restart"),
  listCameras: () => ipcRenderer.invoke("gesture:list-cameras"),
  getShortcutStatus: () => ipcRenderer.invoke("shortcut:get-status"),
  refreshShortcut: () => ipcRenderer.invoke("shortcut:refresh"),
  captureShortcut: () => ipcRenderer.invoke("shortcut:capture"),
  resetShortcut: () => ipcRenderer.invoke("shortcut:reset"),
  openPermissions: (kind) => ipcRenderer.invoke("system:open-permissions", kind),
  preparePasteTarget: () => ipcRenderer.invoke("paste-target:prepare"),
  testLLM: (settings) => ipcRenderer.invoke("llm:test", settings),
  copyText: (text) => ipcRenderer.invoke("clipboard:copy", text),
  setStatus: (status) => ipcRenderer.send("status:set", status),
  showPanel: (view) => ipcRenderer.send("panel:show", view),
  onToggleRecording: (callback) => subscribe("recording:toggle", callback),
  onStartRecording: (callback) => subscribe("recording:start", callback),
  onStopRecording: (callback) => subscribe("recording:stop", callback),
  onCancelRecording: (callback) => subscribe("recording:cancel", callback),
  onSetView: (callback) => subscribe("view:set", callback),
  onHistoryChanged: (callback) => subscribe("history:changed", callback),
  onSettingsChanged: (callback) => subscribe("settings:changed", callback),
  onGestureChanged: (callback) => subscribe("gesture:changed", callback),
  onShortcutChanged: (callback) => subscribe("shortcut:changed", callback),
  removeAllListeners: () => {
    for (const item of listeners) {
      ipcRenderer.removeListener(item.channel, item.wrapped);
    }
    listeners.clear();
  },
});
