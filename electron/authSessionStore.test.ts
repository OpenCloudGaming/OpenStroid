import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EncryptedAuthSessionStore, linuxPasswordStore, type SecureStorage } from './authSessionStore.js';

function fakeSecureStorage(backend: ReturnType<SecureStorage['getSelectedStorageBackend']> = 'kwallet6'): SecureStorage {
  return {
    decryptString: (encrypted) => Buffer.from(encrypted.toString(), 'base64').toString(),
    encryptString: (plainText) => Buffer.from(Buffer.from(plainText).toString('base64')),
    getSelectedStorageBackend: () => backend,
    isEncryptionAvailable: () => true,
  };
}

test('restores an encrypted session from a new store instance', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstroid-auth-'));
  const filePath = path.join(directory, 'auth-session.bin');
  const firstLaunch = new EncryptedAuthSessionStore(filePath, fakeSecureStorage(), 'linux');
  const secondLaunch = new EncryptedAuthSessionStore(filePath, fakeSecureStorage(), 'linux');

  assert.equal(await firstLaunch.write('encrypted-session-handoff'), true);
  assert.equal(await secondLaunch.read(), 'encrypted-session-handoff');
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
});

test('intentional logout removes the persisted session', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstroid-auth-'));
  const filePath = path.join(directory, 'auth-session.bin');
  const store = new EncryptedAuthSessionStore(filePath, fakeSecureStorage(), 'linux');

  await store.write('encrypted-session-handoff');
  assert.equal(await store.write(null), true);
  assert.equal(await store.read(), null);
});

test('invalid encrypted data is discarded instead of reused', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstroid-auth-'));
  const filePath = path.join(directory, 'auth-session.bin');
  const secureStorage = fakeSecureStorage();
  secureStorage.decryptString = () => {
    throw new Error('invalid ciphertext');
  };
  await fs.writeFile(filePath, 'invalid', { mode: 0o600 });

  const store = new EncryptedAuthSessionStore(filePath, secureStorage, 'linux');
  assert.equal(await store.read(), null);
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
});

test('does not persist credentials with Linux basic text encryption', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstroid-auth-'));
  const filePath = path.join(directory, 'auth-session.bin');
  const store = new EncryptedAuthSessionStore(filePath, fakeSecureStorage('basic_text'), 'linux');

  assert.equal(await store.write('encrypted-session-handoff'), false);
  assert.equal(await store.read(), null);
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
});

test('uses secure storage on non-Linux platforms without a Linux backend', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstroid-auth-'));
  const filePath = path.join(directory, 'auth-session.bin');
  const firstLaunch = new EncryptedAuthSessionStore(filePath, fakeSecureStorage('unknown'), 'win32');
  const secondLaunch = new EncryptedAuthSessionStore(filePath, fakeSecureStorage('unknown'), 'win32');

  assert.equal(await firstLaunch.write('encrypted-session-handoff'), true);
  assert.equal(await secondLaunch.read(), 'encrypted-session-handoff');
});

test('retains the last valid session when a secure write fails', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstroid-auth-'));
  const filePath = path.join(directory, 'auth-session.bin');
  const secureStorage = fakeSecureStorage();
  const store = new EncryptedAuthSessionStore(filePath, secureStorage, 'linux');

  await store.write('valid-session');
  secureStorage.encryptString = () => {
    throw new Error('keyring unavailable');
  };
  await assert.rejects(store.write('replacement-session'), /keyring unavailable/);
  secureStorage.encryptString = fakeSecureStorage().encryptString;
  assert.equal(await store.read(), 'valid-session');
});

test('selects KWallet 6 for KDE Plasma 6 sessions', () => {
  assert.equal(linuxPasswordStore({ XDG_CURRENT_DESKTOP: 'KDE', KDE_SESSION_VERSION: '6' }), 'kwallet6');
  assert.equal(linuxPasswordStore({ XDG_CURRENT_DESKTOP: 'GNOME' }), null);
});
