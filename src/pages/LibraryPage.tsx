import { useEffect, useState, useCallback } from 'react';
import {
  Title,
  Text,
  SimpleGrid,
  Card,
  Group,
  Stack,
  Skeleton,
  Box,
  Alert,
  Button,
  Center,
  Badge,
  Image,
  Overlay,
  ThemeIcon,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconRefresh,
  IconDeviceGamepad2,
  IconCloudComputing,
  IconPlayerPlay,
} from '@tabler/icons-react';
import { getInstalledGames, launchStream } from '../api';
import { AuthCaptureDebugPanel } from '../components/AuthCaptureDebugPanel';
import type { InstalledGame } from '../types';

type LoadState = 'loading' | 'success' | 'error';

export function LibraryPage() {
  const [games, setGames] = useState<InstalledGame[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [launchingGameId, setLaunchingGameId] = useState<number | null>(null);
  const [launchError, setLaunchError] = useState<string>('');

  const fetchGames = useCallback(async () => {
    setLoadState('loading');
    setErrorMsg('');
    try {
      const data = await getInstalledGames();
      setGames(data);
      setLoadState('success');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to load your game library.';
      setErrorMsg(msg);
      setLoadState('error');
    }
  }, []);

  const handleLaunch = useCallback(async (game: InstalledGame) => {
    setLaunchingGameId(game.id);
    setLaunchError('');
    try {
      const launch = await launchStream(game.id);
      if (window.openStroid?.openStream) {
        await window.openStroid.openStream(launch);
      } else {
        window.open(launch.streamingUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        `Failed to launch ${game.name}.`;
      setLaunchError(msg);
    } finally {
      setLaunchingGameId(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchGames();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fetchGames]);

  return (
    <Box maw={1200} mx="auto">
      <Group justify="space-between" align="flex-end" mb="xl">
        <Stack gap={4}>
          <Title order={2} fw={700} style={{ letterSpacing: '-0.01em' }}>
            My Games
          </Title>
          <Text c="dimmed" size="sm">
            {loadState === 'success' && games.length > 0
              ? `${games.length} game${games.length !== 1 ? 's' : ''} in your library`
              : 'Your installed cloud games'}
          </Text>
        </Stack>
        {loadState !== 'loading' && (
          <Button
            variant="subtle"
            color="brand"
            size="sm"
            leftSection={<IconRefresh size={16} />}
            onClick={fetchGames}
          >
            Refresh
          </Button>
        )}
      </Group>

      {loadState === 'loading' && <LibrarySkeleton />}

      {launchError && (
        <Alert
          icon={<IconAlertCircle size={20} />}
          title="Could not start stream"
          color="red"
          variant="light"
          radius="lg"
          mb="lg"
          withCloseButton
          onClose={() => setLaunchError('')}
        >
          {launchError}
        </Alert>
      )}

      {loadState === 'error' && (
        <Alert
          icon={<IconAlertCircle size={20} />}
          title="Could not load games"
          color="red"
          variant="light"
          radius="lg"
        >
          <Stack gap="sm">
            <Text size="sm">{errorMsg}</Text>
            <Button
              variant="light"
              color="red"
              size="xs"
              w="fit-content"
              onClick={fetchGames}
              leftSection={<IconRefresh size={14} />}
            >
              Try again
            </Button>
          </Stack>
        </Alert>
      )}

      {loadState === 'success' && games.length === 0 && <EmptyLibrary />}

      {loadState === 'success' && games.length > 0 && (
        <SimpleGrid
          cols={{ base: 1, xs: 2, sm: 3, md: 4, lg: 5 }}
          spacing="lg"
        >
          {games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              isLaunching={launchingGameId === game.id}
              onLaunch={handleLaunch}
            />
          ))}
        </SimpleGrid>
      )}

      <Box mt="xl">
        <AuthCaptureDebugPanel compact title="Debug: latest upstream capture" />
      </Box>
    </Box>
  );
}

function GameCard({
  game,
  isLaunching,
  onLaunch,
}: {
  game: InstalledGame;
  isLaunching: boolean;
  onLaunch: (game: InstalledGame) => void;
}) {
  const coverUrl = game.cover || game.icon;

  return (
    <Card
      padding={0}
      style={{
        backgroundColor: 'var(--mantine-color-dark-6)',
        border: '1px solid var(--mantine-color-dark-4)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 200ms ease',
        position: 'relative',
      }}
      styles={{
        root: {
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
            borderColor: 'var(--mantine-color-brand-7)',
          },
        },
      }}
      onClick={() => onLaunch(game)}
    >
      <Box style={{ position: 'relative', aspectRatio: '3/4', overflow: 'hidden' }}>
        {coverUrl ? (
          <Image
            src={coverUrl}
            alt={game.name}
            h="100%"
            w="100%"
            fit="cover"
            fallbackSrc=""
          />
        ) : (
          <Box
            style={{
              height: '100%',
              width: '100%',
              background:
                'linear-gradient(135deg, var(--mantine-color-dark-5) 0%, var(--mantine-color-dark-7) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconDeviceGamepad2
              size={48}
              color="var(--mantine-color-dark-3)"
            />
          </Box>
        )}
        <Overlay
          gradient="linear-gradient(0deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 60%)"
          zIndex={1}
        />
        <Box
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '16px 12px 12px',
            zIndex: 2,
          }}
        >
          <Text fw={600} size="sm" c="white" lineClamp={2} style={{ lineHeight: 1.3 }}>
            {game.name}
          </Text>
          {game.slug && (
            <Badge
              variant="light"
              color="brand"
              size="xs"
              mt={6}
            >
              Installed
            </Badge>
          )}
          <Button
            mt="sm"
            size="xs"
            radius="md"
            color="brand"
            leftSection={<IconPlayerPlay size={14} />}
            loading={isLaunching}
            onClick={(event) => {
              event.stopPropagation();
              onLaunch(game);
            }}
          >
            Play
          </Button>
        </Box>
      </Box>
    </Card>
  );
}

function LibrarySkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, sm: 3, md: 4, lg: 5 }} spacing="lg">
      {Array.from({ length: 10 }).map((_, i) => (
        <Card
          key={i}
          padding={0}
          radius="lg"
          style={{
            backgroundColor: 'var(--mantine-color-dark-6)',
            border: '1px solid var(--mantine-color-dark-4)',
            overflow: 'hidden',
          }}
        >
          <Skeleton height={0} style={{ paddingBottom: '133%' }} radius={0} />
        </Card>
      ))}
    </SimpleGrid>
  );
}

function EmptyLibrary() {
  return (
    <Center py={80}>
      <Stack align="center" gap="lg" maw={400}>
        <ThemeIcon
          size={80}
          radius="xl"
          variant="light"
          color="brand"
          style={{ opacity: 0.6 }}
        >
          <IconCloudComputing size={40} />
        </ThemeIcon>
        <Stack gap={4} align="center">
          <Title order={3} fw={600} ta="center">
            No games yet
          </Title>
          <Text c="dimmed" size="sm" ta="center">
            Your installed games will appear here. Browse the store to add games
            to your library.
          </Text>
        </Stack>
      </Stack>
    </Center>
  );
}
