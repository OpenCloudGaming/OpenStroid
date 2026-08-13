const LEGACY_STORAGE_KEYS = ['access_token', 'refresh_token', 'boosteroid_auth'] as const;
const SESSION_HANDOFF_KEY = 'openstroid:session-handoff';
let desktopSessionHandoff: string | null | undefined;
let desktopSessionLoad: Promise<string | null> | null = null;

async function readDesktopSessionHandoff(): Promise<string | null> {
  const read = window.openStroid?.readSessionHandoff;
  if (!read) return null;
  if (desktopSessionHandoff !== undefined) return desktopSessionHandoff;
  desktopSessionLoad ??= read().then((value) => {
    desktopSessionHandoff = value;
    sessionStorage.removeItem(SESSION_HANDOFF_KEY);
    return value;
  });
  return desktopSessionLoad;
}

export async function readSessionHandoff(): Promise<string | null> {
  if (window.openStroid?.readSessionHandoff) {
    return readDesktopSessionHandoff();
  }
  return sessionStorage.getItem(SESSION_HANDOFF_KEY);
}

export async function writeSessionHandoff(value: string | null | undefined): Promise<void> {
  if (window.openStroid?.writeSessionHandoff) {
    const nextValue = value || null;
    const currentValue = await readDesktopSessionHandoff();
    if (currentValue === nextValue) return;
    const write = window.openStroid.writeSessionHandoff;
    await write(nextValue);
    desktopSessionHandoff = nextValue;
    desktopSessionLoad = Promise.resolve(nextValue);
    sessionStorage.removeItem(SESSION_HANDOFF_KEY);
    return;
  }
  if (value) {
    sessionStorage.setItem(SESSION_HANDOFF_KEY, value);
    return;
  }
  sessionStorage.removeItem(SESSION_HANDOFF_KEY);
}

export function clearLegacyAuthStorage(): void {
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

async function clearSessionHandoff(): Promise<void> {
  await writeSessionHandoff(null);
}

export async function clearAuthStorage(): Promise<void> {
  clearLegacyAuthStorage();
  await clearSessionHandoff();
}
