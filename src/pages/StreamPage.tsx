import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Badge, Box, Group, Paper, Stack, Text } from '@mantine/core';
import { IconMaximize, IconPlayerStop } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { OpenStroidStreamClient } from '../stream/OpenStroidStreamClient';
import type { StreamLaunchResponse } from '../types';

function readFallbackLaunch(): StreamLaunchResponse | null {
  try {
    const raw = window.sessionStorage.getItem('openstroid:lastLaunch');
    return raw ? (JSON.parse(raw) as StreamLaunchResponse) : null;
  } catch {
    return null;
  }
}

export function StreamPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const clientRef = useRef<OpenStroidStreamClient | null>(null);
  const [status, setStatus] = useState('Preparing');
  const [logs, setLogs] = useState<string[]>([]);
  const [launch, setLaunch] = useState<StreamLaunchResponse | null | undefined>(undefined);

  const title = useMemo(() => {
    const name = launch?.app?.name;
    return typeof name === 'string' ? name : `Session ${launch?.sessionId ?? ''}`;
  }, [launch]);

  useEffect(() => {
    let disposed = false;

    async function loadLaunch() {
      const payload = await window.openStroid?.getStreamLaunch?.();
      if (!disposed) {
        const nextLaunch = payload ?? readFallbackLaunch();
        console.log('[OpenStroid stream] launch payload', {
          hasPayload: Boolean(nextLaunch),
          sessionId: nextLaunch?.sessionId,
          gatewayCount: nextLaunch?.streamClientConfig?.gateways?.length ?? 0,
          queryCount: nextLaunch?.streamClientConfig?.sessionQueries?.length ?? 0,
          hasAccessToken: Boolean(nextLaunch?.streamClientConfig?.accessToken),
          hasAuthDataToken: Boolean(nextLaunch?.streamClientConfig?.authDataToken),
        });
        setLaunch(nextLaunch);
        setLogs((current) => [
          nextLaunch
            ? `[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] Launch payload loaded for session ${nextLaunch.sessionId}`
            : `[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] No stream launch payload was available.`,
          ...current,
        ].slice(0, 16));
      }
    }

    void loadLaunch();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!launch || !videoRef.current) return undefined;

    const client = new OpenStroidStreamClient({
      videoElement: videoRef.current,
      onStatus: (nextStatus) => {
        console.log('[OpenStroid stream] status', nextStatus);
        setStatus(nextStatus);
      },
      onLog: (message) => {
        console.log('[OpenStroid stream]', message);
        setLogs((current) => [message, ...current].slice(0, 16));
      },
    });
    clientRef.current = client;
    void client.connect(launch.streamClientConfig).catch((error: unknown) => {
      setStatus('Failed');
      setLogs((current) => [
        `[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] ${error instanceof Error ? error.message : 'Stream connection failed'}`,
        ...current,
      ].slice(0, 16));
    });

    return () => {
      void client.disconnect(true);
      clientRef.current = null;
    };
  }, [launch]);

  return (
    <Box
      style={{
        minHeight: '100vh',
        background: '#050608',
        color: 'white',
        overflow: 'hidden',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        controls={false}
        style={{
          width: '100vw',
          height: '100vh',
          objectFit: 'contain',
          background: '#000',
          display: 'block',
          outline: 'none',
        }}
      />

      <Group
        justify="space-between"
        align="center"
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          right: 12,
          pointerEvents: 'none',
        }}
      >
        <Paper
          bg="rgba(8, 10, 14, 0.72)"
          p="sm"
          radius="md"
          style={{ border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)' }}
        >
          <Group gap="sm">
            <Badge color={status === 'Streaming' ? 'green' : status === 'Failed' ? 'red' : 'blue'} variant="filled">
              {status}
            </Badge>
            <Text fw={700} size="sm">
              {title}
            </Text>
          </Group>
        </Paper>

        <Group gap="xs" style={{ pointerEvents: 'auto' }}>
          <ActionIcon
            variant="filled"
            color="gray"
            size="lg"
            aria-label="Fullscreen"
            onClick={() => document.documentElement.requestFullscreen().catch(() => undefined)}
          >
            <IconMaximize size={18} />
          </ActionIcon>
          <ActionIcon
            variant="filled"
            color="red"
            size="lg"
            aria-label="Disconnect"
            onClick={() => {
              void clientRef.current?.disconnect();
              navigate('/library');
            }}
          >
            <IconPlayerStop size={18} />
          </ActionIcon>
        </Group>
      </Group>

      {status !== 'Streaming' && (
        <Paper
          bg="rgba(8, 10, 14, 0.78)"
          p="md"
          radius="md"
          style={{
            position: 'fixed',
            left: 16,
            bottom: 16,
            width: 'min(680px, calc(100vw - 32px))',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <Stack gap={6}>
            {launch === undefined ? (
              <Text size="sm" c="dimmed">
                Loading stream launch payload...
              </Text>
            ) : !launch ? (
              <Text size="sm" c="red.3">
                No launch payload was passed to this window. Start the game again from the library.
              </Text>
            ) : logs.length === 0 ? (
              <Text size="sm" c="dimmed">
                Connecting to Boosteroid gateway...
              </Text>
            ) : logs.map((line) => (
              <Text key={line} size="xs" ff="monospace" c="dimmed" style={{ wordBreak: 'break-word' }}>
                {line}
              </Text>
            ))}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
