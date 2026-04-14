import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Center,
  Code,
  Divider,
  Group,
  List,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowRight,
  IconBrandChrome,
  IconCheck,
  IconExternalLink,
  IconPlayerStop,
  IconRefresh,
  IconPuzzle,
} from '@tabler/icons-react';
import { AxiosError } from 'axios';
import {
  cancelLoginCapture,
  getLoginCaptureStatus,
  startLoginCapture,
} from '../api';
import { useAuth } from '../auth';
import { AuthCaptureDebugPanel } from '../components/AuthCaptureDebugPanel';
import type {
  ApiError,
  LoginCaptureMethod,
  LoginCaptureSessionStatus,
  LoginCaptureStatus,
} from '../types';

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set<LoginCaptureStatus>(['succeeded', 'failed', 'cancelled', 'timed_out']);
const EXTENSION_PATH = 'extension/openstroid-capture';

function describeStatus(status: LoginCaptureStatus, method: LoginCaptureMethod | undefined): string {
  switch (status) {
    case 'starting':
      return method === 'browser'
        ? 'Launching the backend browser fallback.'
        : 'Creating an extension capture session.';
    case 'awaiting_user':
      return method === 'browser'
        ? 'Complete login in the backend-launched browser window.'
        : 'Use the OpenStroid Chrome extension while you log in on Boosteroid in your real browser.';
    case 'succeeded':
      return 'Captured upstream auth state. OpenStroid is establishing its own first-party session.';
    case 'failed':
      return 'Capture failed before a usable upstream session was received.';
    case 'cancelled':
      return 'Capture was cancelled.';
    case 'timed_out':
      return 'Capture timed out before login completed.';
    default:
      return 'Waiting for capture status.';
  }
}

export function LoginPage() {
  const { refreshSession, isAuthenticated, isBootstrapping } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [capture, setCapture] = useState<LoginCaptureSessionStatus | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const pollHandle = useRef<number | null>(null);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/library';

  const stopPolling = useCallback(() => {
    if (pollHandle.current !== null) {
      window.clearTimeout(pollHandle.current);
      pollHandle.current = null;
    }
  }, []);

  const pollStatus = useCallback(async (captureId: string) => {
    try {
      const next = await getLoginCaptureStatus(captureId);
      setCapture(next);
      setServerError(null);

      if (next.status === 'succeeded' && next.sessionEstablished) {
        await refreshSession();
        navigate(from, { replace: true });
        return;
      }

      if (!TERMINAL_STATUSES.has(next.status)) {
        pollHandle.current = window.setTimeout(() => {
          void pollStatus(captureId);
        }, POLL_INTERVAL_MS);
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'Failed to read login capture status.');
    }
  }, [from, navigate, refreshSession]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startCapture = useCallback(async (method: LoginCaptureMethod) => {
    stopPolling();
    setIsSubmitting(true);
    setServerError(null);
    try {
      const started = await startLoginCapture(method);
      const initialStatus = await getLoginCaptureStatus(started.id);
      setCapture(initialStatus);
      void pollStatus(started.id);
      if (method === 'extension') {
        window.open(started.loginUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      const fallback = axiosErr.response?.status === 409
        ? 'A login capture is already running. Follow that session or cancel it first.'
        : method === 'browser'
          ? 'Could not start the backend browser fallback.'
          : 'Could not start the extension capture session.';
      setServerError(axiosErr.response?.data?.message || fallback);
    } finally {
      setIsSubmitting(false);
    }
  }, [pollStatus, stopPolling]);

  const handleCancel = useCallback(async () => {
    if (!capture) return;
    stopPolling();
    setIsSubmitting(true);
    try {
      const cancelled = await cancelLoginCapture(capture.id);
      setCapture(cancelled);
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'Failed to cancel the active capture.');
    } finally {
      setIsSubmitting(false);
    }
  }, [capture, stopPolling]);

  const handleRefresh = useCallback(async () => {
    setServerError(null);
    if (capture?.id) {
      stopPolling();
      await pollStatus(capture.id);
      return;
    }

    try {
      const latest = await getLoginCaptureStatus();
      setCapture(latest);
      if (!TERMINAL_STATUSES.has(latest.status)) {
        void pollStatus(latest.id);
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'No capture session is currently available.');
    }
  }, [capture?.id, pollStatus, stopPolling]);

  const statusTone = useMemo(() => {
    if (!capture) return 'blue';
    if (capture.status === 'succeeded') return 'teal';
    if (capture.status === 'failed' || capture.status === 'timed_out' || capture.status === 'cancelled') return 'yellow';
    return 'blue';
  }, [capture]);

  if (isAuthenticated && !isBootstrapping) {
    return <Navigate to={from} replace />;
  }

  return (
    <Box
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at 20% 50%, rgba(0, 212, 245, 0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(102, 0, 245, 0.06) 0%, transparent 50%), var(--mantine-color-dark-8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Center style={{ position: 'relative', zIndex: 1, width: '100%', padding: '24px' }}>
        <Stack gap="xl" w="100%" maw={920}>
          <Stack gap={6} align="center">
            <Box
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: 'linear-gradient(135deg, #00d4f5 0%, #6600f5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 32px rgba(0, 212, 245, 0.2)',
              }}
            >
              <Text fw={900} size="xl" c="white" style={{ lineHeight: 1 }}>OS</Text>
            </Box>
            <Title order={1} ta="center" fw={800} style={{ fontSize: '2rem', letterSpacing: '-0.02em' }}>
              <Text component="span" inherit variant="gradient" gradient={{ from: 'brand.3', to: 'accent.4', deg: 135 }}>
                OpenStroid
              </Text>
            </Title>
            <Text c="dimmed" size="sm" ta="center">
              Primary login capture now runs through a Chrome extension in your real browser profile.
            </Text>
          </Stack>

          <Paper
            w="100%"
            p="xl"
            radius="lg"
            style={{
              backgroundColor: 'rgba(37, 38, 43, 0.7)',
              border: '1px solid var(--mantine-color-dark-4)',
              backdropFilter: 'blur(20px)',
            }}
          >
            <Stack gap="lg">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4} maw={620}>
                  <Title order={3} fw={600}>Sign in with Boosteroid</Title>
                  <Text size="sm" c="dimmed">
                    Install the unpacked OpenStroid Chrome extension, start a capture session here, then log in to Boosteroid in your normal Chrome profile. The extension observes the real browser session and sends upstream cookies and auth evidence back to the OpenStroid backend.
                  </Text>
                </Stack>
                <ThemeIcon size={44} radius="xl" variant="light" color="brand">
                  <IconBrandChrome size={22} />
                </ThemeIcon>
              </Group>

              <List
                spacing="xs"
                size="sm"
                icon={<ThemeIcon color="brand" size={22} radius="xl"><IconCheck size={14} /></ThemeIcon>}
              >
                <List.Item>Load the unpacked extension from <Code>{EXTENSION_PATH}</Code> into Chrome.</List.Item>
                <List.Item>In the extension popup, keep the backend URL set to <Code>http://localhost:3001</Code> for local dev.</List.Item>
                <List.Item>Start capture below, then complete login on <Code>boosteroid.com</Code> in the same Chrome profile.</List.Item>
              </List>

              {serverError && (
                <Alert icon={<IconAlertCircle size={18} />} color="red" variant="light">
                  {serverError}
                </Alert>
              )}

              <Group>
                <Button
                  size="md"
                  variant="gradient"
                  gradient={{ from: 'brand.5', to: 'accent.6', deg: 135 }}
                  leftSection={<IconPuzzle size={16} />}
                  onClick={() => void startCapture('extension')}
                  loading={isSubmitting}
                >
                  Start extension capture
                </Button>
                <Button
                  size="md"
                  variant="light"
                  leftSection={<IconExternalLink size={16} />}
                  onClick={() => window.open('https://boosteroid.com/', '_blank', 'noopener,noreferrer')}
                >
                  Open Boosteroid login
                </Button>
                <Button
                  size="md"
                  variant="light"
                  leftSection={<IconRefresh size={16} />}
                  onClick={() => void handleRefresh()}
                  disabled={isSubmitting}
                >
                  Refresh status
                </Button>
              </Group>

              <Alert color={statusTone} variant="light" title={capture ? `Status: ${capture.status}` : 'No capture running'}>
                <Stack gap={6}>
                  <Text size="sm">{capture ? describeStatus(capture.status, capture.captureMethod) : 'Start a capture session, then complete login in Chrome with the extension enabled.'}</Text>
                  {capture && (
                    <>
                      <Text size="xs" c="dimmed">Capture ID: <Code>{capture.id}</Code></Text>
                      <Text size="xs" c="dimmed">Method: <Code>{capture.captureMethod}</Code></Text>
                      <Text size="xs" c="dimmed">Timeout: {new Date(capture.timeoutAt).toLocaleString()}</Text>
                      <Text size="xs" c="dimmed">Login URL: <Code>{capture.loginUrl}</Code></Text>
                      {capture.finalUrl && <Text size="xs" c="dimmed">Final URL: <Code>{capture.finalUrl}</Code></Text>}
                      {capture.errors.length > 0 && (
                        <Text size="xs" c="yellow.3">{capture.errors[capture.errors.length - 1]}</Text>
                      )}
                    </>
                  )}
                  {capture && !TERMINAL_STATUSES.has(capture.status) && (
                    <Group gap="sm">
                      <Loader size="sm" type="dots" color="brand" />
                      <Text size="xs" c="dimmed">Polling capture status every {POLL_INTERVAL_MS / 1000}s.</Text>
                    </Group>
                  )}
                  {capture?.status === 'succeeded' && (
                    <Button
                      variant="light"
                      color="teal"
                      size="xs"
                      rightSection={<IconArrowRight size={14} />}
                      onClick={async () => {
                        await refreshSession();
                        navigate(from, { replace: true });
                      }}
                    >
                      Continue to library
                    </Button>
                  )}
                  {capture && !TERMINAL_STATUSES.has(capture.status) && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconPlayerStop size={14} />}
                      onClick={() => void handleCancel()}
                    >
                      Cancel capture
                    </Button>
                  )}
                </Stack>
              </Alert>

              <Divider color="dark.4" />

              <Stack gap="xs">
                <Title order={4} fw={600}>Optional backend browser fallback</Title>
                <Text size="sm" c="dimmed">
                  Use only if the extension flow is unavailable. This still launches a backend-owned browser and may be less reliable against Turnstile than the extension path.
                </Text>
                <Group>
                  <Button
                    size="sm"
                    variant="subtle"
                    leftSection={<IconExternalLink size={14} />}
                    onClick={() => void startCapture('browser')}
                    loading={isSubmitting}
                  >
                    Start backend browser fallback
                  </Button>
                  <Text size="sm" c="dimmed">
                    Load unpacked extension from <Code>{EXTENSION_PATH}</Code>
                  </Text>
                </Group>
              </Stack>
            </Stack>
          </Paper>

          <AuthCaptureDebugPanel title="Latest debug capture" />
        </Stack>
      </Center>
    </Box>
  );
}
