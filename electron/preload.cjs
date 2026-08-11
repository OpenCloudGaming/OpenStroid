const { contextBridge, ipcRenderer } = require('electron');

function installLocalStorageState(state = {}) {
  if (!state || typeof state !== 'object') return;
  for (const [key, value] of Object.entries(state)) {
    window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

contextBridge.exposeInMainWorld('openStroid', {
  openStream: (launch) => ipcRenderer.invoke('openstroid:open-stream', launch),
  getStreamLaunch: async () => {
    const launch = await ipcRenderer.invoke('openstroid:get-stream-launch');
    installLocalStorageState(launch?.localStorage);
    return launch;
  },
});
