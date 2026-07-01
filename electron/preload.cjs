const { contextBridge, ipcRenderer } = require('electron');

function installLocalStorageState(state = {}) {
  if (!state || typeof state !== 'object') return;
  for (const [key, value] of Object.entries(state)) {
    window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

console.log('[OpenStroid preload] loaded');

contextBridge.exposeInMainWorld('openStroid', {
  openStream: (launch) => ipcRenderer.invoke('openstroid:open-stream', launch),
  getStreamLaunch: async () => {
    console.log('[OpenStroid preload] requesting stream launch');
    const launch = await ipcRenderer.invoke('openstroid:get-stream-launch');
    console.log('[OpenStroid preload] stream launch response', Boolean(launch), launch?.sessionId);
    installLocalStorageState(launch?.localStorage);
    return launch;
  },
});
