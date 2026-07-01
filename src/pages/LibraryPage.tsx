import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Drawer,
  Group,
  Image,
  Menu,
  Overlay,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBrandSteam,
  IconChevronDown,
  IconCloudDownload,
  IconDeviceGamepad2,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';
import {
  getGameDetails,
  getLibraryDashboard,
  launchStream,
  synchronizePlatform,
} from '../api';
import type { InstalledGame, LibraryDashboard } from '../types';

type LoadState = 'loading' | 'success' | 'error';
type FilterKey = 'all' | 'installed' | 'controller' | 'free' | 'recent';
type SortKey = 'name' | 'recent' | 'store';

const EMPTY_DASHBOARD: LibraryDashboard = {
  user: null,
  installedGames: [],
  catalogGames: [],
  newGames: [],
  carousel: [],
  facets: {
    collections: [],
    genres: [],
    platforms: [],
    orderBy: [],
    languages: [],
  },
  account: {
    subscriptions: [],
  },
  sessions: {
    active: null,
    last: null,
  },
  generatedAt: '',
};

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
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

function coerceGame(value: unknown): InstalledGame | null {
  const source = nestedGameRecord(value);
  const id = firstNumber(source, ['id', 'appId', 'applicationId', 'gameId']);
  const fallback = recordFrom(value);
  const fallbackId = firstNumber(fallback, ['id', 'appId', 'applicationId', 'gameId']);
  const gameId = id || fallbackId;
  if (!gameId) return null;

  const name = firstString(source, ['name', 'title', 'displayName']) ||
    firstString(fallback, ['name', 'title', 'displayName']) ||
    `Application ${gameId}`;

  return {
    ...fallback,
    ...source,
    id: gameId,
    name,
  } as InstalledGame;
}

function uniqueGames(values: Array<InstalledGame | null>): InstalledGame[] {
  const seen = new Set<number>();
  return values.filter((game): game is InstalledGame => {
    if (!game || seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
}

function imageUrl(game: InstalledGame): string {
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
    if (Array.isArray(value)) {
      const found = value.map(recordFrom).map((item) => firstString(item, ['url', 'src', 'imageUrl'])).find(Boolean);
      if (found) return found;
    }
  }

  return '';
}

function storeLabel(game: InstalledGame): string {
  const record = recordFrom(game);
  const platform = recordFrom(record.platform);
  const store = recordFrom(record.store);
  return firstString(store, ['name', 'title', 'slug']) ||
    firstString(platform, ['name', 'title', 'slug']) ||
    firstString(record, ['store', 'platform', 'platformName']) ||
    'Cloud';
}

function isControllerFriendly(game: InstalledGame): boolean {
  const text = JSON.stringify(game).toLowerCase();
  return text.includes('controller') || text.includes('gamepad') || text.includes('xinput');
}

function isFree(game: InstalledGame): boolean {
  const record = recordFrom(game);
  const monetizeType = firstString(record, ['monetizeType', 'monetization', 'priceType']).toLowerCase();
  if (monetizeType.includes('free')) return true;
  if (record.isFree === true || record.free === true) return true;
  const price = Number(record.price ?? record.priceValue);
  return Number.isFinite(price) && price === 0;
}

function dateScore(game: InstalledGame): number {
  const record = recordFrom(game);
  const raw = firstString(record, ['lastPlayedAt', 'installedAt', 'updatedAt', 'releaseDate', 'createdAt']);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function matchesSearch(game: InstalledGame, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${game.name} ${game.slug ?? ''} ${storeLabel(game)}`.toLowerCase().includes(needle);
}

function sortGames(games: InstalledGame[], sort: SortKey): InstalledGame[] {
  return [...games].sort((a, b) => {
    if (sort === 'recent') return dateScore(b) - dateScore(a);
    if (sort === 'store') return storeLabel(a).localeCompare(storeLabel(b));
    return a.name.localeCompare(b.name);
  });
}

export function MyGamesPage() {
  const [dashboard, setDashboard] = useState<LibraryDashboard>(EMPTY_DASHBOARD);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [launchingGameId, setLaunchingGameId] = useState<number | null>(null);
  const [launchingGameName, setLaunchingGameName] = useState('');
  const [launchError, setLaunchError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('installed');
  const [sort, setSort] = useState<SortKey>('name');
  const [selectedGame, setSelectedGame] = useState<InstalledGame | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState('');

  const fetchDashboard = useCallback(async () => {
    setLoadState('loading');
    setErrorMsg('');
    try {
      const data = await getLibraryDashboard();
      setDashboard({
        ...EMPTY_DASHBOARD,
        ...data,
        facets: { ...EMPTY_DASHBOARD.facets, ...data.facets },
        account: { ...EMPTY_DASHBOARD.account, ...data.account },
        sessions: { ...EMPTY_DASHBOARD.sessions, ...data.sessions },
      });
      setLoadState('success');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to load the Boosteroid dashboard data.';
      setErrorMsg(msg);
      setLoadState('error');
    }
  }, []);

  const installedGames = useMemo(
    () => uniqueGames((dashboard.installedGames ?? []).map(coerceGame)),
    [dashboard.installedGames],
  );
  const installedIds = useMemo(() => new Set(installedGames.map((game) => game.id)), [installedGames]);

  const visibleGames = useMemo(() => {
    const filtered = installedGames.filter((game) => {
      if (!matchesSearch(game, query)) return false;
      if (filter === 'controller') return isControllerFriendly(game);
      if (filter === 'free') return isFree(game);
      return true;
    });
    return sortGames(filtered, filter === 'recent' ? 'recent' : sort);
  }, [filter, installedGames, query, sort]);

  const handleLaunch = useCallback(async (game: InstalledGame) => {
    setLaunchingGameId(game.id);
    setLaunchingGameName(game.name);
    setLaunchError('');
    try {
      const launch = await launchStream(game.id);
      window.sessionStorage.setItem('openstroid:lastLaunch', JSON.stringify(launch));
      if (window.openStroid?.openStream) {
        await window.openStroid.openStream(launch);
      } else {
        window.location.assign('/stream');
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        `Failed to launch ${game.name}.`;
      setLaunchError(msg);
    } finally {
      setLaunchingGameId(null);
      setLaunchingGameName('');
    }
  }, []);

  const openDetails = useCallback(async (game: InstalledGame) => {
    setSelectedGame(game);
    setIsDetailLoading(true);
    try {
      const details = await getGameDetails(game.id);
      if (details) setSelectedGame({ ...game, ...details, id: game.id, name: details.name || game.name });
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  const handleSync = useCallback(async (platform: string) => {
    setSyncingPlatform(platform);
    setSyncMessage('');
    try {
      await synchronizePlatform(platform);
      setSyncMessage(`${platform} synchronization started.`);
      await fetchDashboard();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        `Could not synchronize ${platform}.`;
      setSyncMessage(msg);
    } finally {
      setSyncingPlatform(null);
    }
  }, [fetchDashboard]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void fetchDashboard();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [fetchDashboard]);

  return (
    <Box maw={1440} mx="auto">
      <Group className="openstroid-page-actions" justify="flex-end" gap="xs" mb="md">
        <Button
          component={Link}
          to="/install"
          variant="light"
          color="brand"
          size="sm"
          leftSection={<IconCloudDownload size={16} />}
        >
          Install games
        </Button>
        <Menu position="bottom-end" shadow="lg">
          <Menu.Target>
            <Button
              variant="light"
              color="gray"
              size="sm"
              leftSection={<IconBrandSteam size={16} />}
              rightSection={<IconChevronDown size={14} />}
              loading={Boolean(syncingPlatform)}
            >
              Sync
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {['steam', 'epic', 'battle-net'].map((platform) => (
              <Menu.Item key={platform} onClick={() => void handleSync(platform)}>
                {platform}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        <Tooltip label="Refresh dashboard">
          <ActionIcon variant="light" color="gray" size="lg" onClick={() => void fetchDashboard()}>
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {loadState === 'loading' && <LibrarySkeleton />}

      {loadState === 'error' && (
        <Alert icon={<IconAlertCircle size={20} />} title="Could not load dashboard" color="red" variant="light" radius="md">
          <Stack gap="sm">
            <Text size="sm">{errorMsg}</Text>
            <Button variant="light" color="red" size="xs" w="fit-content" onClick={() => void fetchDashboard()} leftSection={<IconRefresh size={14} />}>
              Try again
            </Button>
          </Stack>
        </Alert>
      )}

      {loadState === 'success' && (
        <Stack gap="lg">
          {syncMessage && (
            <Alert color={syncMessage.includes('Could not') ? 'red' : 'teal'} variant="light" withCloseButton onClose={() => setSyncMessage('')}>
              {syncMessage}
            </Alert>
          )}

          {launchError && (
            <Alert icon={<IconAlertCircle size={20} />} title="Could not start stream" color="red" variant="light" radius="md" withCloseButton onClose={() => setLaunchError('')}>
              {launchError}
            </Alert>
          )}

          {launchingGameId !== null && (
            <Alert color="brand" variant="light" radius="md" title={`Starting ${launchingGameName}`}>
              Requesting a Boosteroid machine. Queue and startup state will continue in the stream window.
            </Alert>
          )}

          <Group className="openstroid-toolbar" align="center" justify="space-between" gap="md">
            <Group gap="sm" style={{ flex: 1, minWidth: 0 }}>
              <TextInput
                placeholder="Search your library"
                leftSection={<IconSearch size={16} />}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                w={{ base: '100%', sm: 340 }}
              />
              <Select
                aria-label="Sort games"
                value={sort}
                onChange={(value) => setSort((value as SortKey | null) ?? 'name')}
                data={[
                  { value: 'name', label: 'Name' },
                  { value: 'recent', label: 'Recent' },
                  { value: 'store', label: 'Store' },
                ]}
                w={{ base: '100%', xs: 150 }}
              />
            </Group>
            <SegmentedControl
              value={filter}
              onChange={(value) => setFilter(value as FilterKey)}
              data={[
                { value: 'installed', label: 'All' },
                { value: 'recent', label: 'Recent' },
                { value: 'controller', label: 'Controller' },
                { value: 'free', label: 'Free' },
              ]}
            />
          </Group>

          {visibleGames.length === 0 ? (
            <EmptyLibrary />
          ) : (
            <Box className="openstroid-game-grid">
              {visibleGames.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  installed={installedIds.has(game.id)}
                  isLaunching={launchingGameId === game.id}
                  onLaunch={handleLaunch}
                  onDetails={openDetails}
                />
              ))}
            </Box>
          )}
        </Stack>
      )}

      <GameDetailsDrawer
        game={selectedGame}
        isLoading={isDetailLoading}
        installed={selectedGame ? installedIds.has(selectedGame.id) : false}
        isLaunching={selectedGame ? launchingGameId === selectedGame.id : false}
        onClose={() => setSelectedGame(null)}
        onLaunch={handleLaunch}
      />
    </Box>
  );
}

function GameCard({
  game,
  installed,
  isLaunching,
  onLaunch,
  onDetails,
}: {
  game: InstalledGame;
  installed: boolean;
  isLaunching: boolean;
  onLaunch: (game: InstalledGame) => void;
  onDetails: (game: InstalledGame) => void;
}) {
  const coverUrl = imageUrl(game);

  return (
    <Card
      padding={0}
      className="openstroid-game-card"
      role="button"
      tabIndex={0}
      onClick={() => void onDetails(game)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void onDetails(game);
        }
      }}
    >
      <Box className="openstroid-game-card-media">
        {coverUrl ? (
          <Image src={coverUrl} alt={game.name} h="100%" w="100%" fit="cover" />
        ) : (
          <Center h="100%" bg="dark.7">
            <IconDeviceGamepad2 size={42} color="var(--mantine-color-dark-2)" />
          </Center>
        )}
        <span className="openstroid-card-gradient" />
        {installed && <span className="openstroid-card-state">✓</span>}
        <button
          type="button"
          className="openstroid-card-action"
          title={`Play ${game.name}`}
          aria-label={`Play ${game.name}`}
          disabled={isLaunching}
          onClick={(event) => {
            event.stopPropagation();
            onLaunch(game);
          }}
        >
          <IconPlayerPlay size={18} fill="currentColor" />
        </button>
        <Box className="openstroid-card-info">
          <Text className="openstroid-card-platform">{storeLabel(game)}</Text>
          <Text className="openstroid-card-title">{game.name}</Text>
        </Box>
      </Box>
    </Card>
  );
}

function GameDetailsDrawer({
  game,
  isLoading,
  installed,
  isLaunching,
  onClose,
  onLaunch,
}: {
  game: InstalledGame | null;
  isLoading: boolean;
  installed: boolean;
  isLaunching: boolean;
  onClose: () => void;
  onLaunch: (game: InstalledGame) => void;
}) {
  const coverUrl = game ? imageUrl(game) : '';

  return (
    <Drawer opened={Boolean(game)} onClose={onClose} position="right" size="lg" title="Game details">
      {!game ? null : (
        <Stack gap="md">
          <Box style={{ position: 'relative', aspectRatio: '16 / 9', overflow: 'hidden', borderRadius: 8, background: '#10141b' }}>
            {coverUrl ? <Image src={coverUrl} alt={game.name} h="100%" fit="cover" /> : <Center h="100%"><IconDeviceGamepad2 size={42} /></Center>}
            <Overlay gradient="linear-gradient(0deg, rgba(0,0,0,0.75), rgba(0,0,0,0.1))" zIndex={1} />
            <Stack gap={6} p="md" style={{ position: 'absolute', bottom: 0, zIndex: 2 }}>
              <Group gap="xs">
                <Badge color={installed ? 'brand' : 'gray'}>{installed ? 'Installed' : storeLabel(game)}</Badge>
                {isControllerFriendly(game) && <Badge color="blue" variant="light">Controller</Badge>}
              </Group>
              <Title order={3} c="white">{game.name}</Title>
            </Stack>
          </Box>
          {isLoading && <Skeleton h={48} />}
          <Text size="sm" c="dimmed">
            {String(game.description ?? game.shortDescription ?? 'No description was provided by the upstream dashboard response.')}
          </Text>
          <Divider />
          <SimpleGrid cols={2}>
            <Detail label="Store" value={storeLabel(game)} />
            <Detail label="Application ID" value={String(game.id)} />
            <Detail label="Slug" value={String(game.slug ?? 'n/a')} />
            <Detail label="Input" value={isControllerFriendly(game) ? 'Controller ready' : 'Keyboard/mouse'} />
          </SimpleGrid>
          <Group>
            <Button color="brand" leftSection={<IconPlayerPlay size={16} />} loading={isLaunching} onClick={() => onLaunch(game)}>
              Play
            </Button>
            <Button variant="light" color="gray" onClick={() => window.open(`https://cloud.boosteroid.com/application/${game.id}`, '_blank', 'noopener,noreferrer')}>
              Open upstream
            </Button>
          </Group>
        </Stack>
      )}
    </Drawer>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="sm" fw={700} lineClamp={1}>{value}</Text>
    </Box>
  );
}

function LibrarySkeleton() {
  return (
    <Stack gap="lg">
      <Group className="openstroid-toolbar" gap="md">
        <Skeleton height={38} width={340} radius="md" />
        <Skeleton height={38} width={150} radius="md" />
      </Group>
      <SimpleGrid cols={{ base: 1, xs: 2, sm: 3, md: 4, lg: 5, xl: 6 }} spacing="md">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} height={220} radius="md" />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function EmptyLibrary() {
  return (
    <Center py={72}>
      <Stack align="center" gap="md" maw={420}>
        <ThemeIcon size={72} radius={8} variant="light" color="gray">
          <IconDeviceGamepad2 size={36} />
        </ThemeIcon>
        <Stack gap={4} align="center">
          <Title order={3} fw={600} ta="center">No games match this view</Title>
          <Text c="dimmed" size="sm" ta="center">
            Adjust search or filters, then refresh the captured Boosteroid dashboard data.
          </Text>
        </Stack>
      </Stack>
    </Center>
  );
}
