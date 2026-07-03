import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Divider,
  Drawer,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconChartBar,
  IconClipboard,
  IconGauge,
  IconMaximize,
  IconMicrophone,
  IconMicrophoneOff,
  IconPlayerStop,
  IconRefresh,
  IconSettings,
  IconDeviceGamepad2,
  IconVolume,
  IconVolumeOff,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { OpenStroidStreamClient } from '../stream/OpenStroidStreamClient';
import {
  MAX_STREAM_BITRATE_MBPS,
  MIN_STREAM_BITRATE_MBPS,
  STREAM_ENCODING_OPTIONS,
  STREAM_QUALITY_OPTIONS,
  STREAM_RESOLUTION_OPTIONS,
  type StreamEncodingPreset,
  type StreamQualityPreset,
  type StreamResolutionPreset,
} from '../stream/streamOptions';
import { dequeueStreamSession, logStreamSession } from '../api';
import { readAppSettings, SETTINGS_KEYS } from '../lib/userSettings';
import type { StreamLaunchResponse, StreamRealtimeStats } from '../types';

function readFallbackLaunch(): StreamLaunchResponse | null {
  try {
    const raw = window.sessionStorage.getItem('openstroid:lastLaunch');
    return raw ? (JSON.parse(raw) as StreamLaunchResponse) : null;
  } catch {
    return null;
  }
}

function statusColor(status: string) {
  if (status === 'Streaming') return 'teal';
  if (status === 'Failed' || status === 'Disconnected') return 'red';
  if (status === 'Connection degraded') return 'yellow';
  return 'blue';
}

function mbps(value: number) {
  return `${(value / 1_000_000).toFixed(1)} Mbps`;
}

export function StreamPage() {
  const initialAppSettings = useMemo(() => readAppSettings(), []);
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clientRef = useRef<OpenStroidStreamClient | null>(null);
  const [status, setStatus] = useState('Preparing');
  const [logs, setLogs] = useState<string[]>([]);
  const [launch, setLaunch] = useState<StreamLaunchResponse | null | undefined>(undefined);
  const [stats, setStats] = useState<StreamRealtimeStats | null>(null);
  const [statsVisible, setStatsVisible] = useState(() => initialAppSettings.stream.statsVisible);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [volume, setVolume] = useState(() => initialAppSettings.stream.volume);
  const [muted, setMuted] = useState(() => initialAppSettings.stream.muted);
  const [maxBitrate, setMaxBitrate] = useState(() => initialAppSettings.stream.maxBitrate);
  const [maxFps, setMaxFps] = useState(() => initialAppSettings.stream.maxFps);
  const [quality, setQuality] = useState<StreamQualityPreset>(() => initialAppSettings.stream.quality);
  const [resolution, setResolution] = useState<StreamResolutionPreset>(() => initialAppSettings.stream.resolution);
  const [encoding, setEncoding] = useState<StreamEncodingPreset>(() => initialAppSettings.stream.encoding);
  const [fsrEnabled, setFsrEnabled] = useState(() => initialAppSettings.stream.fsrEnabled);
  const [micEnabled, setMicEnabled] = useState(() => initialAppSettings.stream.micEnabled);
  const [controllerCount, setControllerCount] = useState(0);
  const initialSettingsRef = useRef({
    volume,
    muted,
    maxBitrate,
    maxFps,
    quality,
    resolution,
    encoding,
    fsrEnabled,
    micEnabled,
  });

  const title = useMemo(() => {
    const name = launch?.app?.name;
    return typeof name === 'string' ? name : `Session ${launch?.sessionId ?? ''}`;
  }, [launch]);

  const appendLog = useCallback((message: string) => {
    setLogs((current) => [message, ...current].slice(0, 18));
  }, []);

  useEffect(() => {
    let disposed = false;

    async function loadLaunch() {
      const payload = await window.openStroid?.getStreamLaunch?.();
      if (disposed) return;
      const nextLaunch = payload ?? readFallbackLaunch();
      setLaunch(nextLaunch);
      appendLog(
        nextLaunch
          ? `[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] Launch payload loaded for session ${nextLaunch.sessionId}`
          : `[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] No stream launch payload was available.`,
      );
    }

    void loadLaunch();
    return () => {
      disposed = true;
    };
  }, [appendLog]);

  useEffect(() => {
    if (!launch || !videoRef.current) return undefined;

    const client = new OpenStroidStreamClient({
      videoElement: videoRef.current,
      audioElement: audioRef.current ?? undefined,
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
      },
      onLog: appendLog,
      onStats: setStats,
      onControllerCount: setControllerCount,
    });
    const initialSettings = initialSettingsRef.current;
    client.setAudioVolume(initialSettings.volume);
    client.setMuted(initialSettings.muted);
    client.setMaxBitrateMbps(initialSettings.maxBitrate);
    client.setMaxFramerate(initialSettings.maxFps);
    client.setQuality(initialSettings.quality);
    client.setResolutionPreset(initialSettings.resolution);
    client.setEncoding(initialSettings.encoding);
    client.setFsrEnabled(initialSettings.fsrEnabled);
    client.setMicrophoneEnabled(initialSettings.micEnabled);
    clientRef.current = client;

    void logStreamSession({ event: 'openstroid_stream_opened', sessionId: launch.sessionId }).catch(() => undefined);
    void client.connect(launch.streamClientConfig).catch((error: unknown) => {
      setStatus('Failed');
      appendLog(`[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] ${error instanceof Error ? error.message : 'Stream connection failed'}`);
    });

    return () => {
      void client.disconnect(true);
      clientRef.current = null;
    };
  }, [appendLog, launch]);

  const updateVolume = useCallback((value: number) => {
    setVolume(value);
    window.localStorage.setItem(SETTINGS_KEYS.streamVolume, String(value));
    clientRef.current?.setAudioVolume(value);
    if (value > 0) {
      setMuted(false);
      window.localStorage.setItem(SETTINGS_KEYS.streamMuted, 'false');
      clientRef.current?.setMuted(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      window.localStorage.setItem(SETTINGS_KEYS.streamMuted, String(next));
      clientRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const applyBitrate = useCallback((value: number) => {
    setMaxBitrate(value);
    window.localStorage.setItem(SETTINGS_KEYS.streamBitrate, String(value));
    clientRef.current?.setMaxBitrateMbps(value);
  }, []);

  const applyFps = useCallback((value: number) => {
    const next = value >= 120 ? 120 : 60;
    setMaxFps(next);
    window.localStorage.setItem(SETTINGS_KEYS.streamFps, String(next));
    clientRef.current?.setMaxFramerate(next);
  }, []);

  const applyQuality = useCallback((value: StreamQualityPreset) => {
    setQuality(value);
    window.localStorage.setItem(SETTINGS_KEYS.streamQuality, value);
    clientRef.current?.setQuality(value);
  }, []);

  const applyResolution = useCallback((value: StreamResolutionPreset) => {
    setResolution(value);
    window.localStorage.setItem(SETTINGS_KEYS.streamResolution, value);
    clientRef.current?.setResolutionPreset(value);
  }, []);

  const applyEncoding = useCallback((value: StreamEncodingPreset) => {
    setEncoding(value);
    window.localStorage.setItem(SETTINGS_KEYS.streamEncoding, value);
    clientRef.current?.setEncoding(value);
  }, []);

  const toggleStats = useCallback(() => {
    setStatsVisible((current) => {
      const next = !current;
      window.localStorage.setItem(SETTINGS_KEYS.streamStats, String(next));
      return next;
    });
  }, []);

  const handleReconnect = useCallback(async () => {
    try {
      await clientRef.current?.reconnect();
    } catch (error) {
      appendLog(`[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] ${error instanceof Error ? error.message : 'Reconnect failed'}`);
    }
  }, [appendLog]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      clientRef.current?.sendClipboardPaste(text);
    } catch (error) {
      appendLog(`[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] Clipboard read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [appendLog]);

  const handleStop = useCallback(async () => {
    await clientRef.current?.disconnect();
    await dequeueStreamSession().catch(() => undefined);
    navigate('/my-games');
  }, [navigate]);

  return (
    <Box style={{ minHeight: '100vh', background: '#030405', color: 'white', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        controls={false}
        muted
        style={{
          width: '100vw',
          height: '100vh',
          objectFit: 'contain',
          background: '#000',
          display: 'block',
          outline: 'none',
        }}
      />
      <audio ref={audioRef} autoPlay />

      <TopStatus status={status} title={title} controllerCount={controllerCount} />

      {statsVisible && <StatsPanel stats={stats} maxBitrate={maxBitrate} />}

      {status !== 'Streaming' && <LogPanel launch={launch} logs={logs} />}

      <ControlBar
        status={status}
        statsVisible={statsVisible}
        muted={muted || volume === 0}
        onToggleStats={toggleStats}
        onToggleMute={toggleMute}
        onOpenSettings={() => setSettingsOpened(true)}
        onReconnect={() => void handleReconnect()}
        onFullscreen={() => document.documentElement.requestFullscreen().catch(() => undefined)}
        onStop={() => void handleStop()}
      />

      <SettingsDrawer
        opened={settingsOpened}
        onClose={() => setSettingsOpened(false)}
        quality={quality}
        resolution={resolution}
        encoding={encoding}
        maxBitrate={maxBitrate}
        maxFps={maxFps}
        volume={volume}
        muted={muted}
        fsrEnabled={fsrEnabled}
        micEnabled={micEnabled}
        onQualityChange={applyQuality}
        onResolutionChange={applyResolution}
        onEncodingChange={applyEncoding}
        onBitrateChange={applyBitrate}
        onFpsChange={applyFps}
        onVolumeChange={updateVolume}
        onMutedChange={(value) => {
          setMuted(value);
          window.localStorage.setItem(SETTINGS_KEYS.streamMuted, String(value));
          clientRef.current?.setMuted(value);
        }}
        onFsrChange={(value) => {
          setFsrEnabled(value);
          window.localStorage.setItem(SETTINGS_KEYS.streamFsr, String(value));
          clientRef.current?.setFsrEnabled(value);
        }}
        onMicChange={(value) => {
          setMicEnabled(value);
          window.localStorage.setItem(SETTINGS_KEYS.streamMic, String(value));
          clientRef.current?.setMicrophoneEnabled(value);
        }}
        onPaste={() => void handlePaste()}
      />
    </Box>
  );
}

function TopStatus({
  status,
  title,
  controllerCount,
}: {
  status: string;
  title: string;
  controllerCount: number;
}) {
  return (
    <Group justify="space-between" align="center" style={{ position: 'fixed', top: 12, left: 12, right: 12, pointerEvents: 'none', zIndex: 10 }}>
      <Paper bg="rgba(7, 9, 13, 0.72)" p="sm" radius="md" style={{ border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)' }}>
        <Group gap="sm" wrap="nowrap">
          <Badge color={statusColor(status)} variant="filled">{status}</Badge>
          {controllerCount > 0 && (
            <Badge color="grape" variant="light" leftSection={<IconDeviceGamepad2 size={12} />}>
              {controllerCount === 1 ? 'Controller connected' : `${controllerCount} controllers`}
            </Badge>
          )}
          <Text fw={800} size="sm" lineClamp={1}>{title}</Text>
        </Group>
      </Paper>
    </Group>
  );
}

function StatsPanel({ stats, maxBitrate }: { stats: StreamRealtimeStats | null; maxBitrate: number }) {
  const bitrate = stats?.bitrate ?? 0;
  const bitratePercent = Math.min(100, Math.round((bitrate / Math.max(maxBitrate * 1_000_000, 1)) * 100));

  return (
    <Paper
      bg="rgba(7, 9, 13, 0.78)"
      p="md"
      radius="md"
      style={{ position: 'fixed', left: 16, bottom: 88, width: 310, border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)', zIndex: 10 }}
    >
      <Stack gap="xs">
        <Group justify="space-between">
          <Group gap="xs">
            <IconGauge size={16} />
            <Text fw={800} size="sm">Stream stats</Text>
          </Group>
          <Text size="xs" c="dimmed">{stats?.codec ?? 'codec'}</Text>
        </Group>
        <Progress value={bitratePercent} color={bitratePercent > 85 ? 'yellow' : 'teal'} size="sm" />
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Bitrate</Text>
          <Text size="xs" fw={700}>{mbps(bitrate)}</Text>
        </Group>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">FPS</Text>
          <Text size="xs" fw={700}>{stats?.decodedFps ?? 0} decoded / {stats?.receivedFps ?? 0} received</Text>
        </Group>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Packet loss</Text>
          <Text size="xs" fw={700}>{stats?.packetLoss ?? 0}%</Text>
        </Group>
        <Text size="xs" c="dimmed" lineClamp={1}>{stats?.gatewayHost || 'Waiting for gateway'}</Text>
      </Stack>
    </Paper>
  );
}

function LogPanel({ launch, logs }: { launch: StreamLaunchResponse | null | undefined; logs: string[] }) {
  return (
    <Paper
      bg="rgba(7, 9, 13, 0.78)"
      p="md"
      radius="md"
      style={{ position: 'fixed', left: 16, bottom: 88, width: 'min(680px, calc(100vw - 32px))', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)', zIndex: 11 }}
    >
      <Stack gap={6}>
        {launch === undefined ? (
          <Text size="sm" c="dimmed">Loading stream launch payload...</Text>
        ) : !launch ? (
          <Text size="sm" c="red.3">No launch payload was passed to this window. Start the game again from the library.</Text>
        ) : logs.length === 0 ? (
          <Text size="sm" c="dimmed">Connecting to Boosteroid gateway...</Text>
        ) : logs.map((line, index) => (
          <Text key={`${index}-${line}`} size="xs" ff="monospace" c="dimmed" style={{ wordBreak: 'break-word' }}>
            {line}
          </Text>
        ))}
      </Stack>
    </Paper>
  );
}

function ControlBar({
  statsVisible,
  muted,
  onToggleStats,
  onToggleMute,
  onOpenSettings,
  onReconnect,
  onFullscreen,
  onStop,
}: {
  status: string;
  statsVisible: boolean;
  muted: boolean;
  onToggleStats: () => void;
  onToggleMute: () => void;
  onOpenSettings: () => void;
  onReconnect: () => void;
  onFullscreen: () => void;
  onStop: () => void;
}) {
  return (
    <Paper
      bg="rgba(7, 9, 13, 0.78)"
      p={8}
      radius="md"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(16px)',
        zIndex: 12,
      }}
    >
      <Group gap={6} wrap="nowrap">
        <Tooltip label={statsVisible ? 'Hide stats' : 'Show stats'}>
          <ActionIcon variant={statsVisible ? 'filled' : 'subtle'} color="teal" size="lg" onClick={onToggleStats}>
            <IconChartBar size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={muted ? 'Unmute' : 'Mute'}>
          <ActionIcon variant="subtle" color={muted ? 'red' : 'gray'} size="lg" onClick={onToggleMute}>
            {muted ? <IconVolumeOff size={18} /> : <IconVolume size={18} />}
          </ActionIcon>
        </Tooltip>
        <Divider orientation="vertical" />
        <Tooltip label="Stream settings">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={onOpenSettings}>
            <IconSettings size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Reconnect">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={onReconnect}>
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Fullscreen">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={onFullscreen}>
            <IconMaximize size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Stop session">
          <ActionIcon variant="filled" color="red" size="lg" onClick={onStop}>
            <IconPlayerStop size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  );
}

function SettingsDrawer({
  opened,
  onClose,
  quality,
  resolution,
  encoding,
  maxBitrate,
  maxFps,
  volume,
  muted,
  fsrEnabled,
  micEnabled,
  onQualityChange,
  onResolutionChange,
  onEncodingChange,
  onBitrateChange,
  onFpsChange,
  onVolumeChange,
  onMutedChange,
  onFsrChange,
  onMicChange,
  onPaste,
}: {
  opened: boolean;
  onClose: () => void;
  quality: StreamQualityPreset;
  resolution: StreamResolutionPreset;
  encoding: StreamEncodingPreset;
  maxBitrate: number;
  maxFps: number;
  volume: number;
  muted: boolean;
  fsrEnabled: boolean;
  micEnabled: boolean;
  onQualityChange: (value: StreamQualityPreset) => void;
  onResolutionChange: (value: StreamResolutionPreset) => void;
  onEncodingChange: (value: StreamEncodingPreset) => void;
  onBitrateChange: (value: number) => void;
  onFpsChange: (value: number) => void;
  onVolumeChange: (value: number) => void;
  onMutedChange: (value: boolean) => void;
  onFsrChange: (value: boolean) => void;
  onMicChange: (value: boolean) => void;
  onPaste: () => void;
}) {
  return (
    <Drawer opened={opened} onClose={onClose} position="right" size={380} title="Stream settings">
      <Stack gap="lg">
        <Stack gap="xs">
          <Text size="sm" fw={800}>Quality preset</Text>
          <SegmentedControl
            value={quality}
            onChange={(value) => onQualityChange(value as StreamQualityPreset)}
            data={STREAM_QUALITY_OPTIONS}
            fullWidth
          />
        </Stack>
        <Stack gap="xs">
          <Text size="sm" fw={800}>Resolution</Text>
          <SegmentedControl
            value={resolution}
            onChange={(value) => onResolutionChange(value as StreamResolutionPreset)}
            data={STREAM_RESOLUTION_OPTIONS.map(({ value, label }) => ({ value, label }))}
            fullWidth
          />
          <Text size="xs" c="dimmed">Uses Boosteroid&apos;s WebRTC screenSize/x/y path.</Text>
        </Stack>
        <Stack gap="xs">
          <Text size="sm" fw={800}>Encoding</Text>
          <SegmentedControl
            value={encoding}
            onChange={(value) => onEncodingChange(value as StreamEncodingPreset)}
            data={STREAM_ENCODING_OPTIONS}
            fullWidth
          />
          <Text size="xs" c="dimmed">Applies on reconnect. AV1 falls back to H.264 if the browser or gateway rejects it.</Text>
        </Stack>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" fw={800}>Max bitrate</Text>
            <Text size="sm" c="dimmed">{maxBitrate} Mbps</Text>
          </Group>
          <Slider min={MIN_STREAM_BITRATE_MBPS} max={MAX_STREAM_BITRATE_MBPS} step={1} value={maxBitrate} onChange={onBitrateChange} marks={[{ value: 7, label: '7' }, { value: 20, label: '20' }, { value: 50, label: '50' }, { value: MAX_STREAM_BITRATE_MBPS, label: String(MAX_STREAM_BITRATE_MBPS) }]} />
        </Stack>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" fw={800}>Frame rate</Text>
            <Text size="sm" c="dimmed">{maxFps} FPS</Text>
          </Group>
          <SegmentedControl
            value={String(maxFps)}
            onChange={(value) => onFpsChange(Number(value))}
            data={[
              { value: '60', label: '60 FPS' },
              { value: '120', label: '120 FPS' },
            ]}
            fullWidth
          />
        </Stack>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" fw={800}>Volume</Text>
            <Text size="sm" c="dimmed">{muted ? 'Muted' : `${volume}%`}</Text>
          </Group>
          <Slider min={0} max={100} step={1} value={volume} onChange={onVolumeChange} />
          <Switch checked={muted} onChange={(event) => onMutedChange(event.currentTarget.checked)} label="Mute audio" />
        </Stack>
        <Divider />
        <Switch checked={fsrEnabled} onChange={(event) => onFsrChange(event.currentTarget.checked)} label="FSR upscaling" />
        <Switch
          checked={micEnabled}
          onChange={(event) => onMicChange(event.currentTarget.checked)}
          label="Microphone bridge"
          thumbIcon={micEnabled ? <IconMicrophone size={12} /> : <IconMicrophoneOff size={12} />}
        />
        <Tooltip label="Paste clipboard into the remote session">
          <ActionIcon variant="light" color="gray" size="lg" onClick={onPaste}>
            <IconClipboard size={18} />
          </ActionIcon>
        </Tooltip>
      </Stack>
    </Drawer>
  );
}
