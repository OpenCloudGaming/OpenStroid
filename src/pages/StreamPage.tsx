import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Badge, Box, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { IconMaximize, IconMouse, IconPlayerStop, IconPointer } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { OpenStroidStreamClient, type StreamCursorState, type StreamMouseMode } from '../stream/OpenStroidStreamClient';
import type { StreamLaunchResponse } from '../types';

const FALLBACK_CURSOR_IMAGE =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path d="M4 3v25.5l6.9-6.2 4.1 9.7 4.5-1.9-4.1-9.5h9.8L4 3Z" fill="white" stroke="black" stroke-width="2" stroke-linejoin="round"/></svg>',
  );

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clientRef = useRef<OpenStroidStreamClient | null>(null);
  const [status, setStatus] = useState('Preparing');
  const [logs, setLogs] = useState<string[]>([]);
  const [launch, setLaunch] = useState<StreamLaunchResponse | null | undefined>(undefined);
  const [cursor, setCursor] = useState<StreamCursorState>({ x: 0.5, y: 0.5, visible: false, imageUrl: null });
  const [videoBox, setVideoBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [mouseMode, setMouseMode] = useState<StreamMouseMode>('absolute');

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
      audioElement: audioRef.current ?? undefined,
      onStatus: (nextStatus) => {
        console.log('[OpenStroid stream] status', nextStatus);
        setStatus(nextStatus);
      },
      onLog: (message) => {
        console.log('[OpenStroid stream]', message);
        setLogs((current) => [message, ...current].slice(0, 16));
      },
      onCursor: setCursor,
      onMouseMode: setMouseMode,
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

  useEffect(() => {
    function updateVideoBox() {
      const video = videoRef.current;
      if (!video) return;
      const rect = video.getBoundingClientRect();
      const videoWidth = video.videoWidth || 16;
      const videoHeight = video.videoHeight || 9;
      const frameRatio = rect.width / Math.max(rect.height, 1);
      const videoRatio = videoWidth / Math.max(videoHeight, 1);

      if (videoRatio > frameRatio) {
        const height = rect.width / videoRatio;
        setVideoBox({
          left: rect.left,
          top: rect.top + (rect.height - height) / 2,
          width: rect.width,
          height,
        });
        return;
      }

      const width = rect.height * videoRatio;
      setVideoBox({
        left: rect.left + (rect.width - width) / 2,
        top: rect.top,
        width,
        height: rect.height,
      });
    }

    updateVideoBox();
    window.addEventListener('resize', updateVideoBox);
    window.addEventListener('fullscreenchange', updateVideoBox);
    return () => {
      window.removeEventListener('resize', updateVideoBox);
      window.removeEventListener('fullscreenchange', updateVideoBox);
    };
  }, [launch]);

  const cursorPosition = useMemo(
    () => ({
      left: videoBox.left + Math.min(Math.max(cursor.x, 0), 1) * videoBox.width,
      top: videoBox.top + Math.min(Math.max(cursor.y, 0), 1) * videoBox.height,
    }),
    [cursor.x, cursor.y, videoBox],
  );

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
        muted
        onLoadedMetadata={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const videoRatio = event.currentTarget.videoWidth / Math.max(event.currentTarget.videoHeight, 1);
          const frameRatio = rect.width / Math.max(rect.height, 1);
          if (videoRatio > frameRatio) {
            const height = rect.width / videoRatio;
            setVideoBox({ left: rect.left, top: rect.top + (rect.height - height) / 2, width: rect.width, height });
          } else {
            const width = rect.height * videoRatio;
            setVideoBox({ left: rect.left + (rect.width - width) / 2, top: rect.top, width, height: rect.height });
          }
          console.log('[OpenStroid stream] video metadata', {
            videoWidth: event.currentTarget.videoWidth,
            videoHeight: event.currentTarget.videoHeight,
            readyState: event.currentTarget.readyState,
          });
        }}
        onPlaying={(event) => {
          console.log('[OpenStroid stream] video playing', {
            videoWidth: event.currentTarget.videoWidth,
            videoHeight: event.currentTarget.videoHeight,
            readyState: event.currentTarget.readyState,
          });
        }}
        style={{
          width: '100vw',
          height: '100vh',
          objectFit: 'contain',
          background: '#000',
          display: 'block',
          outline: 'none',
          cursor: 'none',
        }}
      />
      <audio ref={audioRef} autoPlay />

      <Box
        style={{
          position: 'fixed',
          left: cursorPosition.left,
          top: cursorPosition.top,
          width: 34,
          height: 42,
          pointerEvents: 'none',
          zIndex: 8,
          opacity: cursor.visible ? 1 : 0,
          transform: 'translate(0, 0)',
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.75))',
        }}
      >
        <img
          src={FALLBACK_CURSOR_IMAGE}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 28,
            height: 36,
            objectFit: 'contain',
          }}
        />
        {cursor.imageUrl && (
          <img
            src={cursor.imageUrl}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 34,
              height: 42,
              objectFit: 'contain',
            }}
          />
        )}
      </Box>

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
          <Tooltip label={mouseMode === 'relative' ? 'Relative mouse' : 'Absolute mouse'} position="bottom">
            <ActionIcon
              variant="filled"
              color={mouseMode === 'relative' ? 'cyan' : 'gray'}
              size="lg"
              aria-label={mouseMode === 'relative' ? 'Switch to absolute mouse mode' : 'Switch to relative mouse mode'}
              onClick={() => {
                void clientRef.current?.toggleMouseMode();
              }}
            >
              {mouseMode === 'relative' ? <IconMouse size={18} /> : <IconPointer size={18} />}
            </ActionIcon>
          </Tooltip>
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
            ) : logs.map((line, index) => (
              <Text key={`${index}-${line}`} size="xs" ff="monospace" c="dimmed" style={{ wordBreak: 'break-word' }}>
                {line}
              </Text>
            ))}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
