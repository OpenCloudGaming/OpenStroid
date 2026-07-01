import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconDeviceGamepad2,
  IconLogout,
  IconPlugConnected,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
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

type SettingsSectionId = 'account' | 'bridge' | 'stream' | 'diagnostics';

const SETTINGS_NAV: Array<{
  id: SettingsSectionId;
  label: string;
  icon: ComponentType<{ size?: number; stroke?: number }>;
}> = [
  { id: 'stream', label: 'Stream', icon: IconDeviceGamepad2 },
  { id: 'account', label: 'Account', icon: IconUser },
  { id: 'bridge', label: 'Bridge', icon: IconPlugConnected },
  { id: 'diagnostics', label: 'Diagnostics', icon: IconAlertCircle },
];

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
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, refreshSession, isLoading } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(() => readAppSettings());
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'teal' | 'red' | 'blue'>('blue');
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('stream');

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

  const navigateSettings = useCallback((section: SettingsSectionId) => {
    setActiveSection(section);
    document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const closeSettings = useCallback(() => {
    const state = location.state as { backgroundPath?: string } | null;
    const backgroundPath = state?.backgroundPath;
    navigate(backgroundPath && backgroundPath !== '/settings' ? backgroundPath : '/my-games');
  }, [location.state, navigate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSettings();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeSettings]);

  return (
    <Box className="openstroid-settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <button type="button" className="openstroid-settings-scrim" aria-label="Close settings" onClick={closeSettings} />

      <Paper className="openstroid-settings-modal" p={0} onClick={(event) => event.stopPropagation()}>
        <Group className="openstroid-settings-modal-header" justify="space-between" wrap="nowrap">
          <Title order={1}>Settings</Title>
          <Group gap="xs" wrap="nowrap">
            {status && (
              <Alert color={statusTone} variant="light" py={5} px="sm" withCloseButton onClose={() => setStatus('')}>
                {status}
              </Alert>
            )}
            <Button variant="light" color="gray" size="xs" leftSection={<IconRefresh size={14} />} onClick={() => void checkBridge()}>
              Check bridge
            </Button>
            <Button color="brand" size="xs" leftSection={<IconCheck size={14} />} onClick={save}>
              Save
            </Button>
            <UnstyledButton className="openstroid-settings-close" aria-label="Close settings" onClick={closeSettings}>
              <IconX size={16} />
            </UnstyledButton>
          </Group>
        </Group>

        <Paper className="openstroid-settings-shell" p={0}>
          <aside className="openstroid-settings-rail" aria-label="Settings sections">
            <TextInput
              aria-label="Search settings"
              placeholder="Search settings..."
              leftSection={<IconSearch size={16} />}
            />
            <nav className="openstroid-settings-nav">
              {SETTINGS_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <UnstyledButton
                    key={item.id}
                    className="openstroid-settings-nav-item"
                    data-active={activeSection === item.id}
                    onClick={() => navigateSettings(item.id)}
                  >
                    <Icon size={16} stroke={2} />
                    <span>{item.label}</span>
                  </UnstyledButton>
                );
              })}
            </nav>
          </aside>

          <Stack className="openstroid-settings-content" gap="md">
            <SettingSection id="stream" title="Stream Defaults">
              <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
                <Stack gap="xs">
                  <Text size="sm" fw={700}>Quality preset</Text>
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
                    <Text size="sm" fw={700}>Frame rate</Text>
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
                    <Text size="sm" fw={700}>Max bitrate</Text>
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
                    <Text size="sm" fw={700}>Volume</Text>
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

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md" mt="lg">
                <Switch checked={settings.stream.muted} onChange={(event) => updateStream({ muted: event.currentTarget.checked })} label="Mute audio" />
                <Switch checked={settings.stream.fsrEnabled} onChange={(event) => updateStream({ fsrEnabled: event.currentTarget.checked })} label="FSR upscaling" />
                <Switch checked={settings.stream.micEnabled} onChange={(event) => updateStream({ micEnabled: event.currentTarget.checked })} label="Microphone bridge" />
                <Switch checked={settings.stream.statsVisible} onChange={(event) => updateStream({ statsVisible: event.currentTarget.checked })} label="Stats overlay" />
              </SimpleGrid>

              <Group mt="lg">
                <Button variant="light" color="gray" leftSection={<IconSettings size={16} />} onClick={reset}>
                  Reset defaults
                </Button>
                <Text size="xs" c="dimmed">Current defaults are applied to new stream sessions.</Text>
              </Group>
            </SettingSection>

            <SettingSection id="account" title="Account">
              <Group justify="space-between" gap="md">
                <Stack gap={3}>
                  <Group gap="xs">
                    <Text size="sm" fw={700}>{user?.name || user?.email || 'OpenStroid user'}</Text>
                    <Badge color={user ? 'brand' : 'red'} variant="light">{user ? 'Signed in' : 'Offline'}</Badge>
                  </Group>
                  <Text size="sm" c="dimmed">{user?.email ?? 'No email in local session.'}</Text>
                </Stack>
                <Group gap="xs">
                  <Button variant="light" color="gray" loading={isLoading} leftSection={<IconRefresh size={16} />} onClick={() => void refreshSession()}>
                    Refresh session
                  </Button>
                  <Button variant="light" color="red" leftSection={<IconLogout size={16} />} onClick={() => void logout()}>
                    Sign out
                  </Button>
                </Group>
              </Group>
            </SettingSection>

            <SettingSection id="bridge" title="Bridge">
              <Stack gap="md">
                <Group justify="space-between" gap="md">
                  <Text size="sm" c="dimmed">Local bridge status</Text>
                  <Badge color={bridgeStatus === 'online' ? 'brand' : bridgeStatus === 'offline' ? 'red' : 'blue'} variant="light">
                    {bridgeStatus}
                  </Badge>
                </Group>
                <TextInput
                  name="bridgeUrl"
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
                <Text size="xs" c="dimmed">
                  Default bridge URL: <Code>{DEFAULT_SETTINGS.bridgeUrl}</Code>
                </Text>
              </Stack>
            </SettingSection>

            <SettingSection id="diagnostics" title="Diagnostics">
              <AuthCaptureDebugPanel compact title="Latest upstream capture" />
            </SettingSection>
          </Stack>
        </Paper>
      </Paper>
    </Box>
  );
}

function SettingSection({ id, title, children }: { id: SettingsSectionId; title: string; children: ReactNode }) {
  return (
    <Paper id={`settings-${id}`} className="openstroid-settings-section" p="lg">
      <Title className="openstroid-settings-section-header" order={3} fw={600}>
        {title}
      </Title>
      <Box mt="lg">{children}</Box>
    </Paper>
  );
}
