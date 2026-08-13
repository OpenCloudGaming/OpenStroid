import fs from 'node:fs/promises';
import path from 'node:path';

export interface SecureStorage {
  decryptString(encrypted: Buffer): string;
  encryptString(plainText: string): Buffer;
  getSelectedStorageBackend(): 'basic_text' | 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' | 'unknown';
  isEncryptionAvailable(): boolean;
}

export interface AuthSessionStore {
  read(): Promise<string | null>;
  write(value: string | null): Promise<boolean>;
}

export function linuxPasswordStore(environment: NodeJS.ProcessEnv): 'kwallet6' | null {
  const desktop = environment.XDG_CURRENT_DESKTOP ?? environment.DESKTOP_SESSION ?? '';
  const isKde = desktop.split(':').some((value) => value.toLowerCase().includes('kde'))
    || environment.KDE_FULL_SESSION === 'true';
  return isKde && environment.KDE_SESSION_VERSION === '6' ? 'kwallet6' : null;
}

export class EncryptedAuthSessionStore implements AuthSessionStore {
  constructor(
    private readonly filePath: string,
    private readonly secureStorage: SecureStorage,
    private readonly platform = process.platform,
  ) {}

  private encryptionAvailable(): boolean {
    if (!this.secureStorage.isEncryptionAvailable()) return false;
    if (this.platform !== 'linux') return true;
    const backend = this.secureStorage.getSelectedStorageBackend();
    return backend !== 'basic_text' && backend !== 'unknown';
  }

  async read(): Promise<string | null> {
    if (!this.encryptionAvailable()) return null;

    try {
      const encrypted = await fs.readFile(this.filePath);
      return this.secureStorage.decryptString(encrypted) || null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await this.clear();
      }
      return null;
    }
  }

  async write(value: string | null): Promise<boolean> {
    if (!value) {
      await this.clear();
      return true;
    }
    if (!this.encryptionAvailable()) return false;

    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(temporaryPath, this.secureStorage.encryptString(value), { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
    await fs.chmod(this.filePath, 0o600);
    return true;
  }

  private async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}
