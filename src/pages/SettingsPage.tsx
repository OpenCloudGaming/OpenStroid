import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconDeviceGamepad2,
  IconLogout,
  IconPlugConnected,
  IconRefresh,
  IconSettings,
  IconUser,
} from '@tabler/icons-react';
import { AuthCaptureDebugPanel } from '../components/AuthCaptureDebugPanel';
import { useAuth } from '../auth';
import {
  DEFAULT_SETTINGS,
  readAppSettings,
  resetAppSettings,
  saveAppSettings,
  type AppSettings,
  type StreamDefaults,
} from '../lib/userSettings';
import type { StreamQualityPreset } from '../stream/OpenStroidStreamClient';

const EXTENSION_PATH = 'C:\\Users\\Zortos\\Projects\\OpenStroid\\extension\\openstroid-capture';

function updateStreamSettings(settings: AppSettings, patch: Partial<StreamDefaults>): AppSettings {
  return {
    ...settings,
    stream: {
      ...settings.stream,
      ...patch,
    },
  };
}

export function SettingsPage() {
  const { user, logout, refreshSession, isLoading } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(() => readAppSettings());
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'teal' | 'red' | 'blue'>('blue');
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  const checkBridge = useCallback(async () => {
    setBridgeStatus('checking');
    try {
      const response = await fetch('/health');
      const payload = await response.json().catch(() => null);
      setBridgeStatus(response.ok && payload?.desktopBridge ? 'online' : 'offline');
    } catch {
      setBridgeStatus('offline');
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void checkBridge();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [checkBridge]);

  const updateStream = useCallback((patch: Partial<StreamDefaults>) => {
    setSettings((current) => updateStreamSettings(current, patch));
  }, []);

  const save = useCallback(() => {
    saveAppSettings(settings);
    setStatusTone('teal');
    setStatus('Settings saved.');
  }, [settings]);

  const reset = useCallback(() => {
    const defaults = resetAppSettings();
    setSettings(defaults);
    setStatusTone('blue');
    setStatus('Settings reset to defaults.');
  }, []);

  const copyExtensionPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(EXTENSION_PATH);
      setStatusTone('teal');
      setStatus('Extension folder copied.');
    } catch {
      setStatusTone('red');
      setStatus('Could not copy extension folder.');
    }
  }, []);

  return (
    <Box maw={1180} mx="auto">
      <Group justify="space-between" align="flex-start" mb="lg">
        <Stack gap={4}>
          <Title order={2} fw={800}>Settings</Title>
          <Text c="dimmed" size="sm">Account, extension, bridge, and stream defaults.</Text>
        </Stack>
        <Group gap="xs">
          <Button variant="light" color="gray" leftSection={<IconRefresh size={16} />} onClick={() => void checkBridge()}>
            Check bridge
          </Button>
          <Button color="teal" leftSection={<IconCheck size={16} />} onClick={save}>
            Save
          </Button>
        </Group>
      </Group>

      {status && (
        <Alert color={statusTone} variant="light" mb="lg" withCloseButton onClose={() => setStatus('')}>
          {status}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Paper p="lg" radius="md" style={{ background: '#10141b', border: '1px solid rgba(255,255,255,0.08)' }}>
          <Stack gap="md">
            <Group justify="space-between">
              <Group gap="sm">
                <ThemeIcon color="cyan" variant="light" radius={8}>
                  <IconUser size={18} />
                </ThemeIcon>
                <Title order={3} fw={700}>Account</Title>
              </Group>
              <Badge color={user ? 'teal' : 'red'} variant="light">{user ? 'Signed in' : 'Offline'}</Badge>
            </Group>
            <Stack gap={2}>
              <Text size="sm" fw={700}>{user?.name || user?.email || 'OpenStroid user'}</Text>
              <Text size="sm" c="dimmed">{user?.email ?? 'No email in local session.'}</Text>
            </Stack>
            <Group>
              <Button variant="light" color="gray" loading={isLoading} leftSection={<IconRefresh size={16} />} onClick={() => void refreshSession()}>
                Refresh session
              </Button>
              <Button variant="light" color="red" leftSection={<IconLogout size={16} />} onClick={() => void logout()}>
                Sign out
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper p="lg" radius="md" style={{ background: '#10141b', border: '1px solid rgba(255,255,255,0.08)' }}>
          <Stack gap="md">
            <Group justify="space-between">
              <Group gap="sm">
                <ThemeIcon color={bridgeStatus === 'online' ? 'teal' : bridgeStatus === 'offline' ? 'red' : 'blue'} variant="light" radius={8}>
                  <IconPlugConnected size={18} />
                </ThemeIcon>
                <Title order={3} fw={700}>Bridge</Title>
              </Group>
              <Badge color={bridgeStatus === 'online' ? 'teal' : bridgeStatus === 'offline' ? 'red' : 'blue'} variant="light">
                {bridgeStatus}
              </Badge>
            </Group>
            <TextInput
              label="Extension bridge URL"
              value={settings.bridgeUrl}
              onChange={(event) => setSettings((current) => ({ ...current, bridgeUrl: event.currentTarget.value }))}
            />
            <Stack gap={6}>
              <Text size="sm" fw={700}>Chrome extension folder</Text>
              <Group gap="xs" wrap="nowrap">
                <Code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{EXTENSION_PATH}</Code>
                <Button size="xs" variant="light" color="gray" leftSection={<IconCopy size={14} />} onClick={() => void copyExtensionPath()}>
                  Copy
                </Button>
              </Group>
            </Stack>
          </Stack>
        </Paper>
      </SimpleGrid>

      <Paper mt="lg" p="lg" radius="md" style={{ background: '#10141b', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Stack gap="lg">
          <Group gap="sm">
            <ThemeIcon color="violet" variant="light" radius={8}>
              <IconDeviceGamepad2 size={18} />
            </ThemeIcon>
            <Title order={3} fw={700}>Stream Defaults</Title>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
            <Stack gap="xs">
              <Text size="sm" fw={800}>Quality preset</Text>
              <SegmentedControl
                value={settings.stream.quality}
                onChange={(value) => updateStream({ quality: value as StreamQualityPreset })}
                data={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'high', label: 'High' },
                  { value: 'balanced', label: 'Balanced' },
                  { value: 'dataSaver', label: 'Low' },
                ]}
              />
            </Stack>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" fw={800}>Frame rate</Text>
                <Text size="sm" c="dimmed">{settings.stream.maxFps} FPS</Text>
              </Group>
              <SegmentedControl
                value={String(settings.stream.maxFps)}
                onChange={(value) => updateStream({ maxFps: Number(value) >= 120 ? 120 : 60 })}
                data={[
                  { value: '60', label: '60 FPS' },
                  { value: '120', label: '120 FPS' },
                ]}
              />
            </Stack>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" fw={800}>Max bitrate</Text>
                <Text size="sm" c="dimmed">{settings.stream.maxBitrate} Mbps</Text>
              </Group>
              <Slider
                min={3}
                max={40}
                step={1}
                value={settings.stream.maxBitrate}
                onChange={(value) => updateStream({ maxBitrate: value })}
                marks={[{ value: 7, label: '7' }, { value: 20, label: '20' }, { value: 40, label: '40' }]}
              />
            </Stack>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" fw={800}>Volume</Text>
                <Text size="sm" c="dimmed">{settings.stream.muted ? 'Muted' : `${settings.stream.volume}%`}</Text>
              </Group>
              <Slider
                min={0}
                max={100}
                step={1}
                value={settings.stream.volume}
                onChange={(value) => updateStream({ volume: value, muted: value === 0 ? true : settings.stream.muted })}
              />
            </Stack>
          </SimpleGrid>
          <Divider color="rgba(255,255,255,0.08)" />
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
            <Switch checked={settings.stream.muted} onChange={(event) => updateStream({ muted: event.currentTarget.checked })} label="Mute audio" />
            <Switch checked={settings.stream.fsrEnabled} onChange={(event) => updateStream({ fsrEnabled: event.currentTarget.checked })} label="FSR upscaling" />
            <Switch checked={settings.stream.micEnabled} onChange={(event) => updateStream({ micEnabled: event.currentTarget.checked })} label="Microphone bridge" />
            <Switch checked={settings.stream.statsVisible} onChange={(event) => updateStream({ statsVisible: event.currentTarget.checked })} label="Stats overlay" />
          </SimpleGrid>
          <Group>
            <Button variant="light" color="gray" leftSection={<IconSettings size={16} />} onClick={reset}>
              Reset defaults
            </Button>
            <Text size="xs" c="dimmed">Current defaults are applied to new stream sessions.</Text>
          </Group>
        </Stack>
      </Paper>

      <Paper mt="lg" p="lg" radius="md" style={{ background: '#10141b', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Stack gap="md">
          <Group gap="sm">
            <ThemeIcon color="yellow" variant="light" radius={8}>
              <IconAlertCircle size={18} />
            </ThemeIcon>
            <Title order={3} fw={700}>Diagnostics</Title>
          </Group>
          <AuthCaptureDebugPanel compact title="Latest upstream capture" />
        </Stack>
      </Paper>

      <Text mt="md" size="xs" c="dimmed">
        Default bridge URL: <Code>{DEFAULT_SETTINGS.bridgeUrl}</Code>
      </Text>
    </Box>
  );
}
