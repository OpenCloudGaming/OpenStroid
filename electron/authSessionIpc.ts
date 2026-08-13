import type { IpcMain } from 'electron';
import type { AuthSessionStore } from './authSessionStore.js';

export function registerAuthSessionIpc(ipcMain: IpcMain, authSessionStore: AuthSessionStore): void {
  ipcMain.handle('openstroid:auth-session:read', () => authSessionStore.read());
  ipcMain.handle('openstroid:auth-session:write', async (_event, value: unknown) => {
    const persisted = await authSessionStore.write(typeof value === 'string' ? value : null);
    if (!persisted) {
      console.warn('[main] secure credential storage is unavailable; authentication will last for this launch only');
    }
    return { persisted };
  });
}
