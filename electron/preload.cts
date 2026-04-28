import { contextBridge, ipcRenderer } from 'electron';

interface StreamLaunchPayload {
  streamingUrl: string;
  localStorage?: Record<string, unknown>;
  cookies?: unknown[];
}

function parseStreamState(): Record<string, unknown> {
  const prefix = '--openstroid-stream-state=';
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) return {};

  try {
    const decoded = Buffer.from(arg.slice(prefix.length), 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as { localStorage?: Record<string, unknown> };
    return parsed.localStorage ?? {};
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
  openStream: (launch: StreamLaunchPayload) => ipcRenderer.invoke('openstroid:open-stream', launch) as Promise<{ ok: boolean }>,
});
