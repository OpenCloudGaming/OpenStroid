import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  getInstalledGames,
  launchStream,
  synchronizePlatform,
} from '../api';
import type { InstalledGame } from '../types';
import {
  coerceGame,
  describeLaunchError,
  imageUrl,
  isControllerFriendly,
  isFree,
  matchesSearch,
  sortGames,
  storeLabel,
  uniqueGames,
  type SortKey,
} from '../lib/gameUtils';

type LoadState = 'loading' | 'success' | 'error';
type FilterKey = 'all' | 'installed' | 'controller' | 'free' | 'recent';

export function MyGamesPage() {
  const [games, setGames] = useState<InstalledGame[]>([]);
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
  const detailsRequestId = useRef(0);

  const fetchLibrary = useCallback(async () => {
    setLoadState('loading');
    setErrorMsg('');
    try {
      setGames(await getInstalledGames());
      setLoadState('success');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to load your Boosteroid library.';
      setErrorMsg(msg);
      setLoadState('error');
    }
  }, []);

  const installedGames = useMemo(
    () => uniqueGames(games.map(coerceGame)),
    [games],
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
      setLaunchError(describeLaunchError(err, game.name));
    } finally {
      setLaunchingGameId(null);
      setLaunchingGameName('');
    }
  }, []);

  const openDetails = useCallback(async (game: InstalledGame) => {
    const requestId = ++detailsRequestId.current;
    setSelectedGame(game);
    setIsDetailLoading(true);
    try {
      const details = await getGameDetails(game.id).catch(() => null);
      if (details && detailsRequestId.current === requestId) {
        setSelectedGame({ ...game, ...details, id: game.id, name: details.name || game.name });
      }
    } finally {
      if (detailsRequestId.current === requestId) setIsDetailLoading(false);
    }
  }, []);

  const closeDetails = useCallback(() => {
    detailsRequestId.current += 1;
    setSelectedGame(null);
    setIsDetailLoading(false);
  }, []);

  const handleSync = useCallback(async (platform: string) => {
    setSyncingPlatform(platform);
    setSyncMessage('');
    try {
      await synchronizePlatform(platform);
      setSyncMessage(`${platform} synchronization started.`);
      await fetchLibrary();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        `Could not synchronize ${platform}.`;
      setSyncMessage(msg);
    } finally {
      setSyncingPlatform(null);
    }
  }, [fetchLibrary]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void fetchLibrary();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [fetchLibrary]);

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
        <Tooltip label="Refresh library">
          <ActionIcon variant="light" color="gray" size="lg" onClick={() => void fetchLibrary()}>
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {loadState === 'loading' && <LibrarySkeleton />}

      {loadState === 'error' && (
        <Alert icon={<IconAlertCircle size={20} />} title="Could not load library" color="red" variant="light" radius="md">
          <Stack gap="sm">
            <Text size="sm">{errorMsg}</Text>
            <Button variant="light" color="red" size="xs" w="fit-content" onClick={() => void fetchLibrary()} leftSection={<IconRefresh size={14} />}>
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
            <Box className="openstroid-filter-scroll">
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
            </Box>
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
        onClose={closeDetails}
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
        if (event.target !== event.currentTarget) return;
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
            {String(game.description ?? game.shortDescription ?? 'No description was provided by Boosteroid for this game.')}
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
            Adjust the search or filters, then refresh your Boosteroid library.
          </Text>
        </Stack>
      </Stack>
    </Center>
  );
}
