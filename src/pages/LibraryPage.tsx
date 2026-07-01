import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  ScrollArea,
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
  IconCloudComputing,
  IconCloudDownload,
  IconDeviceGamepad2,
  IconInfoCircle,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconSparkles,
} from '@tabler/icons-react';
import {
  getGameDetails,
  getLibraryDashboard,
  launchStream,
  synchronizePlatform,
} from '../api';
import { AuthCaptureDebugPanel } from '../components/AuthCaptureDebugPanel';
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

export function LibraryPage() {
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
  const catalogGames = useMemo(
    () => uniqueGames((dashboard.catalogGames ?? []).map(coerceGame)),
    [dashboard.catalogGames],
  );
  const newGames = useMemo(
    () => uniqueGames((dashboard.newGames ?? []).map(coerceGame)),
    [dashboard.newGames],
  );
  const carouselGames = useMemo(
    () => uniqueGames((dashboard.carousel ?? []).map(coerceGame)),
    [dashboard.carousel],
  );
  const installedIds = useMemo(() => new Set(installedGames.map((game) => game.id)), [installedGames]);
  const allGames = useMemo(
    () => uniqueGames([...installedGames, ...newGames, ...catalogGames, ...carouselGames]),
    [catalogGames, carouselGames, installedGames, newGames],
  );

  const visibleGames = useMemo(() => {
    const source = filter === 'installed' ? installedGames : allGames;
    const filtered = source.filter((game) => {
      if (!matchesSearch(game, query)) return false;
      if (filter === 'controller') return isControllerFriendly(game);
      if (filter === 'free') return isFree(game);
      return true;
    });
    return sortGames(filtered, filter === 'recent' ? 'recent' : sort);
  }, [allGames, filter, installedGames, query, sort]);

  const featuredGame = useMemo(
    () => carouselGames.find((game) => imageUrl(game)) ?? installedGames[0] ?? newGames[0] ?? allGames[0] ?? null,
    [allGames, carouselGames, installedGames, newGames],
  );

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
    void fetchDashboard();
  }, [fetchDashboard]);

  return (
    <Box maw={1440} mx="auto">
      <Group justify="space-between" align="flex-start" mb="lg">
        <Stack gap={4}>
          <Title order={2} fw={800}>Library</Title>
          <Text c="dimmed" size="sm">
            {installedGames.length} installed. Use Install to search the full Boosteroid catalog.
          </Text>
        </Stack>
        <Group gap="xs">
          <Button
            component={Link}
            to="/install"
            variant="light"
            color="cyan"
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
        <Stack gap="xl">
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
            <Alert color="cyan" variant="light" radius="md" title={`Starting ${launchingGameName}`}>
              Requesting a Boosteroid machine. Queue and startup state will continue in the stream window.
            </Alert>
          )}

          {featuredGame && (
            <FeaturePanel
              game={featuredGame}
              installed={installedIds.has(featuredGame.id)}
              isLaunching={launchingGameId === featuredGame.id}
              onLaunch={handleLaunch}
              onDetails={openDetails}
            />
          )}

          <Group align="flex-end" justify="space-between" gap="md">
            <Group gap="sm" style={{ flex: 1 }}>
              <TextInput
                placeholder="Search games"
                leftSection={<IconSearch size={16} />}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                w={{ base: '100%', sm: 320 }}
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
                w={140}
              />
            </Group>
            <SegmentedControl
              value={filter}
              onChange={(value) => setFilter(value as FilterKey)}
              data={[
                { value: 'installed', label: 'Installed' },
                { value: 'all', label: 'All' },
                { value: 'recent', label: 'Recent' },
                { value: 'controller', label: 'Controller' },
                { value: 'free', label: 'Free' },
              ]}
            />
          </Group>

          {visibleGames.length === 0 ? (
            <EmptyLibrary />
          ) : (
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5, xl: 6 }} spacing="md">
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
            </SimpleGrid>
          )}

          {newGames.length > 0 && (
            <GameRail
              title="New on Boosteroid"
              games={newGames.slice(0, 14)}
              installedIds={installedIds}
              launchingGameId={launchingGameId}
              onLaunch={handleLaunch}
              onDetails={openDetails}
            />
          )}

          <DashboardFacts dashboard={dashboard} installedCount={installedGames.length} />

          <Box>
            <AuthCaptureDebugPanel compact title="Diagnostics: latest upstream capture" />
          </Box>
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

function FeaturePanel({
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
    <Box
      style={{
        position: 'relative',
        minHeight: 260,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#12161f',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {coverUrl && <Image src={coverUrl} alt={game.name} fit="cover" h={300} w="100%" />}
      <Overlay gradient="linear-gradient(90deg, rgba(6,8,12,0.95), rgba(6,8,12,0.72) 45%, rgba(6,8,12,0.08))" zIndex={1} />
      <Stack gap="md" maw={520} p="xl" style={{ position: 'absolute', inset: 0, zIndex: 2, justifyContent: 'flex-end' }}>
        <Group gap="xs">
          <Badge color={installed ? 'teal' : 'gray'} variant="filled">{installed ? 'Installed' : storeLabel(game)}</Badge>
          {isControllerFriendly(game) && <Badge color="indigo" variant="light">Controller</Badge>}
        </Group>
        <Stack gap={4}>
          <Title order={2} c="white" fw={800}>{game.name}</Title>
          <Text size="sm" c="gray.3" lineClamp={2}>
            {String(game.description ?? 'Ready through the captured Boosteroid dashboard data.')}
          </Text>
        </Stack>
        <Group>
          <Button leftSection={<IconPlayerPlay size={16} />} color="teal" loading={isLaunching} onClick={() => onLaunch(game)}>
            Play
          </Button>
          <Button variant="light" color="gray" leftSection={<IconInfoCircle size={16} />} onClick={() => void onDetails(game)}>
            Details
          </Button>
        </Group>
      </Stack>
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
      style={{
        backgroundColor: '#12161f',
        border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}
    >
      <Box style={{ position: 'relative', aspectRatio: '3 / 4', overflow: 'hidden' }}>
        {coverUrl ? (
          <Image src={coverUrl} alt={game.name} h="100%" w="100%" fit="cover" />
        ) : (
          <Center h="100%" bg="dark.7">
            <IconDeviceGamepad2 size={42} color="var(--mantine-color-dark-2)" />
          </Center>
        )}
        <Overlay gradient="linear-gradient(0deg, rgba(0,0,0,0.9), rgba(0,0,0,0.05) 64%)" zIndex={1} />
        <Stack gap={6} p="sm" style={{ position: 'absolute', inset: 'auto 0 0 0', zIndex: 2 }}>
          <Group gap={6}>
            <Badge size="xs" color={installed ? 'teal' : 'gray'} variant={installed ? 'filled' : 'light'}>
              {installed ? 'Installed' : storeLabel(game)}
            </Badge>
          </Group>
          <Text fw={700} size="sm" c="white" lineClamp={2} lh={1.25}>{game.name}</Text>
          <Group gap={6} wrap="nowrap">
            <Button
              size="xs"
              color="teal"
              leftSection={<IconPlayerPlay size={13} />}
              loading={isLaunching}
              onClick={() => onLaunch(game)}
              style={{ flex: 1 }}
            >
              Play
            </Button>
            <Tooltip label="Details">
              <ActionIcon size="lg" variant="light" color="gray" onClick={() => void onDetails(game)}>
                <IconInfoCircle size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      </Box>
    </Card>
  );
}

function GameRail({
  title,
  games,
  installedIds,
  launchingGameId,
  onLaunch,
  onDetails,
}: {
  title: string;
  games: InstalledGame[];
  installedIds: Set<number>;
  launchingGameId: number | null;
  onLaunch: (game: InstalledGame) => void;
  onDetails: (game: InstalledGame) => void;
}) {
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <IconSparkles size={18} color="var(--mantine-color-yellow-5)" />
        <Title order={3} fw={700}>{title}</Title>
      </Group>
      <ScrollArea type="hover" offsetScrollbars>
        <Group gap="md" wrap="nowrap" pb="xs">
          {games.map((game) => (
            <Box key={game.id} w={176} style={{ flex: '0 0 176px' }}>
              <GameCard
                game={game}
                installed={installedIds.has(game.id)}
                isLaunching={launchingGameId === game.id}
                onLaunch={onLaunch}
                onDetails={onDetails}
              />
            </Box>
          ))}
        </Group>
      </ScrollArea>
    </Stack>
  );
}

function DashboardFacts({ dashboard, installedCount }: { dashboard: LibraryDashboard; installedCount: number }) {
  const activeSubscriptions = dashboard.account.subscriptions.length;
  const hasActiveSession = Boolean(dashboard.sessions.active && Object.keys(dashboard.sessions.active).length > 0);

  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
      <Fact icon={<IconDeviceGamepad2 size={18} />} label="Installed games" value={String(installedCount)} tone="teal" />
      <Fact icon={<IconCloudComputing size={18} />} label="Session state" value={hasActiveSession ? 'Active' : 'Idle'} tone={hasActiveSession ? 'green' : 'gray'} />
      <Fact icon={<IconSparkles size={18} />} label="Subscription records" value={String(activeSubscriptions)} tone="yellow" />
    </SimpleGrid>
  );
}

function Fact({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: string }) {
  return (
    <Group
      gap="sm"
      p="md"
      style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, background: '#10141b' }}
    >
      <ThemeIcon color={tone} variant="light" radius={8}>{icon}</ThemeIcon>
      <Box>
        <Text size="xs" c="dimmed">{label}</Text>
        <Text fw={800}>{value}</Text>
      </Box>
    </Group>
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
                <Badge color={installed ? 'teal' : 'gray'}>{installed ? 'Installed' : storeLabel(game)}</Badge>
                {isControllerFriendly(game) && <Badge color="indigo" variant="light">Controller</Badge>}
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
            <Button color="teal" leftSection={<IconPlayerPlay size={16} />} loading={isLaunching} onClick={() => onLaunch(game)}>
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
    <Stack gap="xl">
      <Skeleton height={260} radius="md" />
      <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5, xl: 6 }} spacing="md">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} height={260} radius="md" />
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
          <IconCloudComputing size={36} />
        </ThemeIcon>
        <Stack gap={4} align="center">
          <Title order={3} fw={700} ta="center">No games match this view</Title>
          <Text c="dimmed" size="sm" ta="center">
            Adjust search or filters, then refresh the captured Boosteroid dashboard data.
          </Text>
        </Stack>
      </Stack>
    </Center>
  );
}
