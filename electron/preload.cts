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

console.log('[OpenStroid preload] loaded');

contextBridge.exposeInMainWorld('openStroid', {
  openStream: (launch: StreamLaunchPayload) => ipcRenderer.invoke('openstroid:open-stream', launch) as Promise<{ ok: boolean }>,
  getStreamLaunch: async () => {
    console.log('[OpenStroid preload] requesting stream launch');
    const launch = await ipcRenderer.invoke('openstroid:get-stream-launch') as StreamLaunchPayload | null;
    console.log('[OpenStroid preload] stream launch response', Boolean(launch), launch?.streamingUrl);
    installLocalStorageState(launch?.localStorage);
    return launch;
  },
});
