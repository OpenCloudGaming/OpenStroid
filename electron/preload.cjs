const { contextBridge, ipcRenderer } = require('electron');

function parseStreamState() {
  const prefix = '--openstroid-stream-state=';
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) return {};

  try {
    const decoded = Buffer.from(arg.slice(prefix.length), 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed.localStorage || {};
  } catch {
    return {};
  }
}

function installStreamState() {
  const state = parseStreamState();
  for (const [key, value] of Object.entries(state)) {
    window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

installStreamState();

contextBridge.exposeInMainWorld('openStroid', {
  openStream: (launch) => ipcRenderer.invoke('openstroid:open-stream', launch),
});
