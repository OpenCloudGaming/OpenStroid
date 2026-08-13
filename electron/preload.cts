import { contextBridge, ipcRenderer } from 'electron';

interface StreamLaunchPayload {
  streamingUrl: string;
  streamClientConfig?: unknown;
  localStorage?: Record<string, unknown>;
  cookies?: unknown[];
}

function installLocalStorageState(state: Record<string, unknown> = {}) {
  if (!state || typeof state !== 'object') return;
  for (const [key, value] of Object.entries(state)) {
    window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

contextBridge.exposeInMainWorld('openStroid', {
  readSessionHandoff: () => ipcRenderer.invoke('openstroid:auth-session:read') as Promise<string | null>,
  writeSessionHandoff: (value: string | null) => ipcRenderer.invoke('openstroid:auth-session:write', value) as Promise<{ persisted: boolean }>,
  openStream: (launch: StreamLaunchPayload) => ipcRenderer.invoke('openstroid:open-stream', launch) as Promise<{ ok: boolean }>,
  getStreamLaunch: async () => {
    const launch = await ipcRenderer.invoke('openstroid:get-stream-launch') as StreamLaunchPayload | null;
    installLocalStorageState(launch?.localStorage);
    return launch;
  },
});
