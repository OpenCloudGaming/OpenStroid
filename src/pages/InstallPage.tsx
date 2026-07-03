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
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';
import {
  getCatalogGames,
  getGameDetails,
  getInstalledGames,
  getLibraryFacets,
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

interface InstallPageProps {
  collectionName?: string;
  emptyTitle?: string;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

function facetName(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['name', 'title', 'collectionName', 'slug']) {
    const item = record[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return '';
}

function facetId(value: unknown): string | number | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = record.id ?? record.collectionId ?? record.value;
  if (typeof id === 'string' || typeof id === 'number') return id;
  return null;
}

export function InstallPage({
  collectionName = 'Install',
  emptyTitle = 'No install games found',
}: InstallPageProps = {}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [games, setGames] = useState<InstalledGame[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<number>>(new Set());
  const [collectionId, setCollectionId] = useState<string | number | null>(null);
  const [collectionReady, setCollectionReady] = useState(false);
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

  const resolveCollection = useCallback(async () => {
    setCollectionReady(false);
    try {
      const facets = await getLibraryFacets();
      const normalizedTarget = collectionName.trim().toLowerCase();
      const matched = facets.collections.find((collection) => facetName(collection).toLowerCase() === normalizedTarget);
      setCollectionId(facetId(matched) ?? null);
    } catch {
      setCollectionId(null);
    } finally {
      setCollectionReady(true);
    }
  }, [collectionName]);

  const loadGames = useCallback(async (searchText: string) => {
    if (!collectionReady) return;
    setLoadState('loading');
    setError('');
    try {
      const catalogParams: Record<string, unknown> = { page: 1, paginate: PAGE_SIZE };
      if (collectionId !== null) catalogParams.collection = collectionId;
      const rawGames = searchText.trim()
        ? await searchCatalogGames({ name: searchText.trim() })
        : await getCatalogGames(catalogParams);
      setGames(uniqueGames(rawGames.map(coerceGame)));
      await refreshInstalled();
      setLoadState('success');
    } catch (err) {
      setError(errorMessage(err, 'Could not load Boosteroid catalog games.'));
      setLoadState('error');
    }
  }, [collectionId, collectionReady, refreshInstalled]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void resolveCollection();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [resolveCollection]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query), 350);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!collectionReady) return undefined;
    const handle = window.setTimeout(() => {
      void loadGames(debouncedQuery);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [collectionReady, debouncedQuery, loadGames]);

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

        <Group className="openstroid-toolbar" align="center" justify="space-between" gap="md">
          <Group gap="sm" style={{ flex: 1, minWidth: 0 }}>
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
              w={{ base: '100%', xs: 150 }}
            />
          </Group>
          <Group gap="sm" wrap="nowrap">
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
            <Tooltip label="Refresh catalog">
              <ActionIcon variant="light" color="gray" size="lg" onClick={() => void loadGames(debouncedQuery)}>
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {loadState === 'loading' ? (
          <CatalogSkeleton />
        ) : visibleGames.length === 0 ? (
          <EmptyCatalog title={emptyTitle} hasQuery={Boolean(query.trim())} onReset={() => setQuery('')} />
        ) : (
          <Box className="openstroid-game-grid">
            {visibleGames.map((game) => (
              <CatalogCard
                key={game.id}
                game={game}
                installed={installedIds.has(game.id)}
                isBusy={actionGameId === game.id}
                onInstall={handleInstall}
                onLaunch={handleLaunch}
                onDetails={openDetails}
              />
            ))}
          </Box>
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
  onLaunch,
  onDetails,
}: {
  game: InstalledGame;
  installed: boolean;
  isBusy: boolean;
  onInstall: (game: InstalledGame) => void;
  onLaunch: (game: InstalledGame) => void;
  onDetails: (game: InstalledGame) => void;
}) {
  const coverUrl = imageUrl(game);
  const primaryActionLabel = installed ? `Play ${game.name}` : `Install ${game.name}`;

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
          title={primaryActionLabel}
          aria-label={primaryActionLabel}
          disabled={isBusy}
          onClick={(event) => {
            event.stopPropagation();
            if (installed) {
              onLaunch(game);
            } else {
              onInstall(game);
            }
          }}
        >
          {installed ? <IconPlayerPlay size={18} fill="currentColor" /> : <IconCloudDownload size={18} />}
        </button>
        <Box className="openstroid-card-info">
          <Text className="openstroid-card-platform">{storeLabel(game)}</Text>
          <Text className="openstroid-card-title">{game.name}</Text>
        </Box>
      </Box>
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
                <Badge color={installed ? 'brand' : 'gray'}>{installed ? 'Installed' : storeLabel(game)}</Badge>
                {isControllerFriendly(game) && <Badge color="blue" variant="light">Controller</Badge>}
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
                <Button color="brand" leftSection={<IconPlayerPlay size={16} />} loading={isBusy} onClick={() => onLaunch(game)}>
                  Play
                </Button>
                <Button variant="light" color="red" loading={isBusy} onClick={() => onUninstall(game)}>
                  Remove
                </Button>
              </>
            ) : (
              <Button color="brand" leftSection={<IconCloudDownload size={16} />} loading={isBusy} onClick={() => onInstall(game)}>
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
    <SimpleGrid cols={{ base: 1, xs: 2, sm: 3, md: 4, lg: 5, xl: 6 }} spacing="md">
      {Array.from({ length: 18 }).map((_, i) => (
        <Skeleton key={i} height={220} radius="md" />
      ))}
    </SimpleGrid>
  );
}

function EmptyCatalog({ title, hasQuery, onReset }: { title: string; hasQuery: boolean; onReset: () => void }) {
  return (
    <Center py={72}>
      <Stack align="center" gap="md" maw={420}>
        <ThemeIcon size={72} radius={8} variant="light" color="gray">
          <IconSearch size={36} />
        </ThemeIcon>
        <Stack gap={4} align="center">
          <Title order={3} fw={600} ta="center">{title}</Title>
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
