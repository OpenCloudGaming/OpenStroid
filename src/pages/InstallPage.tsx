import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Drawer,
  Group,
  Image,
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
  IconCloudDownload,
  IconDeviceGamepad2,
  IconInfoCircle,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';
import {
  getCatalogGames,
  getGameDetails,
  getInstalledGames,
  installGame,
  launchStream,
  searchCatalogGames,
  uninstallGame,
} from '../api';
import type { InstalledGame } from '../types';
import {
  coerceGame,
  imageUrl,
  isControllerFriendly,
  isFree,
  matchesSearch,
  sortGames,
  storeLabel,
  uniqueGames,
  type SortKey,
} from '../lib/gameUtils';

type LoadState = 'idle' | 'loading' | 'success' | 'error';
type FilterKey = 'all' | 'not-installed' | 'installed' | 'controller' | 'free';

const PAGE_SIZE = 50;

function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

export function InstallPage() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [games, setGames] = useState<InstalledGame[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<number>>(new Set());
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState('');
  const [actionGameId, setActionGameId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [selectedGame, setSelectedGame] = useState<InstalledGame | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const refreshInstalled = useCallback(async () => {
    const installed = uniqueGames((await getInstalledGames()).map(coerceGame));
    setInstalledIds(new Set(installed.map((game) => game.id)));
  }, []);

  const loadGames = useCallback(async (searchText: string) => {
    setLoadState('loading');
    setError('');
    try {
      const rawGames = searchText.trim()
        ? await searchCatalogGames({ name: searchText.trim() })
        : await getCatalogGames({ page: 1, paginate: PAGE_SIZE });
      setGames(uniqueGames(rawGames.map(coerceGame)));
      await refreshInstalled();
      setLoadState('success');
    } catch (err) {
      setError(errorMessage(err, 'Could not load Boosteroid catalog games.'));
      setLoadState('error');
    }
  }, [refreshInstalled]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query), 350);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    void loadGames(debouncedQuery);
  }, [debouncedQuery, loadGames]);

  const visibleGames = useMemo(() => {
    const filtered = games.filter((game) => {
      if (!matchesSearch(game, query)) return false;
      if (filter === 'installed') return installedIds.has(game.id);
      if (filter === 'not-installed') return !installedIds.has(game.id);
      if (filter === 'controller') return isControllerFriendly(game);
      if (filter === 'free') return isFree(game);
      return true;
    });
    return sortGames(filtered, sort);
  }, [filter, games, installedIds, query, sort]);

  const handleInstall = useCallback(async (game: InstalledGame) => {
    setActionGameId(game.id);
    setActionMessage('');
    try {
      const result = await installGame(game.id);
      const installedGame = coerceGame(result) ?? game;
      setInstalledIds((current) => new Set(current).add(game.id));
      setGames((current) => current.map((item) => item.id === game.id ? { ...item, ...installedGame, installed: true } : item));
      setActionMessage(`${game.name} was added to your library.`);
    } catch (err) {
      setActionMessage(errorMessage(err, `Could not install ${game.name}.`));
    } finally {
      setActionGameId(null);
    }
  }, []);

  const handleUninstall = useCallback(async (game: InstalledGame) => {
    setActionGameId(game.id);
    setActionMessage('');
    try {
      await uninstallGame(game.id);
      setInstalledIds((current) => {
        const next = new Set(current);
        next.delete(game.id);
        return next;
      });
      setGames((current) => current.map((item) => item.id === game.id ? { ...item, installed: false } : item));
      setActionMessage(`${game.name} was removed from your library.`);
    } catch (err) {
      setActionMessage(errorMessage(err, `Could not uninstall ${game.name}.`));
    } finally {
      setActionGameId(null);
    }
  }, []);

  const handleLaunch = useCallback(async (game: InstalledGame) => {
    setActionGameId(game.id);
    setActionMessage('');
    try {
      const launch = await launchStream(game.id);
      window.sessionStorage.setItem('openstroid:lastLaunch', JSON.stringify(launch));
      if (window.openStroid?.openStream) {
        await window.openStroid.openStream(launch);
      } else {
        window.location.assign('/stream');
      }
    } catch (err) {
      setActionMessage(errorMessage(err, `Could not launch ${game.name}.`));
    } finally {
      setActionGameId(null);
    }
  }, []);

  const openDetails = useCallback(async (game: InstalledGame) => {
    setSelectedGame(game);
    setDetailsLoading(true);
    try {
      const details = await getGameDetails(game.id);
      if (details) setSelectedGame({ ...game, ...details, id: game.id, name: details.name || game.name });
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  return (
    <Box maw={1440} mx="auto">
      <Group justify="space-between" align="flex-start" mb="lg">
        <Stack gap={4}>
          <Title order={2} fw={800}>Install Games</Title>
          <Text c="dimmed" size="sm">
            Search the Boosteroid catalog and add games to your OpenStroid library.
          </Text>
        </Stack>
        <Tooltip label="Refresh catalog">
          <ActionIcon variant="light" color="gray" size="lg" onClick={() => void loadGames(debouncedQuery)}>
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Stack gap="lg">
        {error && (
          <Alert icon={<IconAlertCircle size={18} />} color="red" variant="light" title="Catalog failed">
            {error}
          </Alert>
        )}

        {actionMessage && (
          <Alert
            color={actionMessage.startsWith('Could not') ? 'red' : 'teal'}
            variant="light"
            withCloseButton
            onClose={() => setActionMessage('')}
          >
            {actionMessage}
          </Alert>
        )}

        <Group justify="space-between" align="flex-end" gap="md">
          <Group gap="sm" style={{ flex: 1 }}>
            <TextInput
              placeholder="Search any Boosteroid game"
              leftSection={<IconSearch size={16} />}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              w={{ base: '100%', sm: 360 }}
            />
            <Select
              aria-label="Sort catalog"
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
              { value: 'all', label: 'All' },
              { value: 'not-installed', label: 'Available' },
              { value: 'installed', label: 'Installed' },
              { value: 'controller', label: 'Controller' },
              { value: 'free', label: 'Free' },
            ]}
          />
        </Group>

        {loadState === 'loading' ? (
          <CatalogSkeleton />
        ) : visibleGames.length === 0 ? (
          <EmptyCatalog hasQuery={Boolean(query.trim())} onReset={() => setQuery('')} />
        ) : (
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5, xl: 6 }} spacing="md">
            {visibleGames.map((game) => (
              <CatalogCard
                key={game.id}
                game={game}
                installed={installedIds.has(game.id)}
                isBusy={actionGameId === game.id}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
                onLaunch={handleLaunch}
                onDetails={openDetails}
              />
            ))}
          </SimpleGrid>
        )}
      </Stack>

      <CatalogDetailsDrawer
        game={selectedGame}
        installed={selectedGame ? installedIds.has(selectedGame.id) : false}
        isLoading={detailsLoading}
        isBusy={selectedGame ? actionGameId === selectedGame.id : false}
        onClose={() => setSelectedGame(null)}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
        onLaunch={handleLaunch}
      />
    </Box>
  );
}

function CatalogCard({
  game,
  installed,
  isBusy,
  onInstall,
  onUninstall,
  onLaunch,
  onDetails,
}: {
  game: InstalledGame;
  installed: boolean;
  isBusy: boolean;
  onInstall: (game: InstalledGame) => void;
  onUninstall: (game: InstalledGame) => void;
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
        <Overlay gradient="linear-gradient(0deg, rgba(0,0,0,0.92), rgba(0,0,0,0.08) 62%)" zIndex={1} />
        <Stack gap={7} p="sm" style={{ position: 'absolute', inset: 'auto 0 0 0', zIndex: 2 }}>
          <Group gap={6}>
            <Badge size="xs" color={installed ? 'teal' : 'gray'} variant={installed ? 'filled' : 'light'}>
              {installed ? 'Installed' : storeLabel(game)}
            </Badge>
          </Group>
          <Text fw={800} size="sm" c="white" lineClamp={2} lh={1.2}>
            {game.name}
          </Text>
          <Group gap={6} wrap="nowrap">
            {installed ? (
              <Button
                size="xs"
                color="teal"
                leftSection={<IconPlayerPlay size={13} />}
                loading={isBusy}
                onClick={() => onLaunch(game)}
                style={{ flex: 1 }}
              >
                Play
              </Button>
            ) : (
              <Button
                size="xs"
                color="cyan"
                leftSection={<IconCloudDownload size={13} />}
                loading={isBusy}
                onClick={() => onInstall(game)}
                style={{ flex: 1 }}
              >
                Install
              </Button>
            )}
            <Tooltip label="Details">
              <ActionIcon size="lg" variant="light" color="gray" onClick={() => void onDetails(game)}>
                <IconInfoCircle size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      </Box>
      {installed && (
        <Button size="xs" variant="subtle" color="red" radius={0} loading={isBusy} onClick={() => onUninstall(game)}>
          Remove from library
        </Button>
      )}
    </Card>
  );
}

function CatalogDetailsDrawer({
  game,
  installed,
  isLoading,
  isBusy,
  onClose,
  onInstall,
  onUninstall,
  onLaunch,
}: {
  game: InstalledGame | null;
  installed: boolean;
  isLoading: boolean;
  isBusy: boolean;
  onClose: () => void;
  onInstall: (game: InstalledGame) => void;
  onUninstall: (game: InstalledGame) => void;
  onLaunch: (game: InstalledGame) => void;
}) {
  const coverUrl = game ? imageUrl(game) : '';

  return (
    <Drawer opened={Boolean(game)} onClose={onClose} position="right" size="lg" title="Catalog details">
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
            {String(game.description ?? game.shortDescription ?? 'No description was provided by Boosteroid for this catalog item.')}
          </Text>
          <SimpleGrid cols={2}>
            <Detail label="Store" value={storeLabel(game)} />
            <Detail label="Application ID" value={String(game.id)} />
            <Detail label="Input" value={isControllerFriendly(game) ? 'Controller ready' : 'Keyboard/mouse'} />
            <Detail label="Library" value={installed ? 'Installed' : 'Available'} />
          </SimpleGrid>
          <Group>
            {installed ? (
              <>
                <Button color="teal" leftSection={<IconPlayerPlay size={16} />} loading={isBusy} onClick={() => onLaunch(game)}>
                  Play
                </Button>
                <Button variant="light" color="red" loading={isBusy} onClick={() => onUninstall(game)}>
                  Remove
                </Button>
              </>
            ) : (
              <Button color="cyan" leftSection={<IconCloudDownload size={16} />} loading={isBusy} onClick={() => onInstall(game)}>
                Install
              </Button>
            )}
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

function CatalogSkeleton() {
  return (
    <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5, xl: 6 }} spacing="md">
      {Array.from({ length: 18 }).map((_, i) => (
        <Skeleton key={i} height={270} radius="md" />
      ))}
    </SimpleGrid>
  );
}

function EmptyCatalog({ hasQuery, onReset }: { hasQuery: boolean; onReset: () => void }) {
  return (
    <Center py={72}>
      <Stack align="center" gap="md" maw={420}>
        <ThemeIcon size={72} radius={8} variant="light" color="gray">
          <IconSearch size={36} />
        </ThemeIcon>
        <Stack gap={4} align="center">
          <Title order={3} fw={700} ta="center">No catalog games found</Title>
          <Text c="dimmed" size="sm" ta="center">
            {hasQuery ? 'Try another game name or clear search to load the default catalog.' : 'Refresh the catalog after your Boosteroid session is active.'}
          </Text>
        </Stack>
        {hasQuery && (
          <Button variant="light" color="gray" onClick={onReset}>
            Clear search
          </Button>
        )}
      </Stack>
    </Center>
  );
}
