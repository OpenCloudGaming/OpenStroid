import type { InstalledGame } from '../types';

export type SortKey = 'name' | 'recent' | 'store';

export function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    const numberValue = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return 0;
}

function nestedGameRecord(value: unknown): Record<string, unknown> {
  const record = recordFrom(value);
  for (const key of ['application', 'app', 'game', 'item']) {
    const nested = recordFrom(record[key]);
    if (Object.keys(nested).length > 0) return nested;
  }
  return record;
}

export function coerceGame(value: unknown): InstalledGame | null {
  const source = nestedGameRecord(value);
  const fallback = recordFrom(value);
  const id = firstNumber(source, ['id', 'appId', 'applicationId', 'gameId']) ||
    firstNumber(fallback, ['id', 'appId', 'applicationId', 'gameId']);
  if (!id) return null;

  const name = firstString(source, ['name', 'title', 'displayName']) ||
    firstString(fallback, ['name', 'title', 'displayName']) ||
    `Application ${id}`;

  return {
    ...fallback,
    ...source,
    id,
    name,
  } as InstalledGame;
}

export function uniqueGames(values: Array<InstalledGame | null>): InstalledGame[] {
  const seen = new Set<number>();
  return values.filter((game): game is InstalledGame => {
    if (!game || seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
}

export function imageUrl(game: InstalledGame): string {
  const record = recordFrom(game);
  const direct = firstString(record, [
    'cover',
    'coverUrl',
    'image',
    'imageUrl',
    'poster',
    'posterUrl',
    'background',
    'backgroundImage',
    'icon',
    'logo',
  ]);
  if (direct) return direct;

  for (const key of ['media', 'images', 'assets']) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    const found = value
      .map(recordFrom)
      .map((item) => firstString(item, ['url', 'src', 'imageUrl']))
      .find(Boolean);
    if (found) return found;
  }

  return '';
}

export function storeLabel(game: InstalledGame): string {
  const record = recordFrom(game);
  const platform = recordFrom(record.platform);
  const store = recordFrom(record.store);
  return firstString(store, ['name', 'title', 'slug']) ||
    firstString(platform, ['name', 'title', 'slug']) ||
    firstString(record, ['store', 'platform', 'platformName']) ||
    'Cloud';
}

export function isControllerFriendly(game: InstalledGame): boolean {
  const text = JSON.stringify(game).toLowerCase();
  return text.includes('controller') || text.includes('gamepad') || text.includes('xinput');
}

export function isFree(game: InstalledGame): boolean {
  const record = recordFrom(game);
  const monetizeType = firstString(record, ['monetizeType', 'monetization', 'priceType']).toLowerCase();
  if (monetizeType.includes('free')) return true;
  if (record.isFree === true || record.free === true) return true;
  const price = Number(record.price ?? record.priceValue);
  return Number.isFinite(price) && price === 0;
}

export function dateScore(game: InstalledGame): number {
  const record = recordFrom(game);
  const raw = firstString(record, ['lastPlayedAt', 'installedAt', 'updatedAt', 'releaseDate', 'createdAt']);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function matchesSearch(game: InstalledGame, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${game.name} ${game.slug ?? ''} ${storeLabel(game)}`.toLowerCase().includes(needle);
}

export function sortGames(games: InstalledGame[], sort: SortKey): InstalledGame[] {
  return [...games].sort((a, b) => {
    if (sort === 'recent') return dateScore(b) - dateScore(a);
    if (sort === 'store') return storeLabel(a).localeCompare(storeLabel(b));
    return a.name.localeCompare(b.name);
  });
}

export function describeLaunchError(err: unknown, gameName: string): string {
  const response = err && typeof err === 'object' && 'response' in err
    ? (err as { response?: { status?: number; data?: { message?: string } } }).response
    : undefined;

  if (response?.status === 429) {
    return 'Boosteroid is rate-limiting new streams. Wait a minute, then try again.';
  }

  if (typeof response?.data?.message === 'string' && response.data.message.trim()) {
    return response.data.message;
  }

  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }

  return `Failed to launch ${gameName}.`;
}
