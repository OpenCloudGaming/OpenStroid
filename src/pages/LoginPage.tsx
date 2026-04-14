import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Center,
  Code,
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
  IconCheck,
  IconExternalLink,
  IconPlayerStop,
  IconRefresh,
  IconSparkles,
} from '@tabler/icons-react';
import { AxiosError } from 'axios';
import {
  cancelLoginCapture,
  getLoginCaptureStatus,
  startLoginCapture,
} from '../api';
import { useAuth } from '../auth';
import { AuthCaptureDebugPanel } from '../components/AuthCaptureDebugPanel';
import type { ApiError, LoginCaptureSessionStatus, LoginCaptureStatus } from '../types';

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set<LoginCaptureStatus>(['succeeded', 'failed', 'cancelled', 'timed_out']);

function describeStatus(status: LoginCaptureStatus): string {
  switch (status) {
    case 'starting':
      return 'Launching a real browser window on the backend host.';
    case 'awaiting_user':
      return 'Finish login in the Boosteroid window. Turnstile stays on Boosteroid.';
    case 'succeeded':
      return 'Authenticated session captured. OpenStroid is establishing its own first-party session.';
    case 'failed':
      return 'Capture failed before an authenticated upstream session was detected.';
    case 'cancelled':
      return 'Capture was cancelled and the browser context was cleaned up.';
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

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleStart = useCallback(async () => {
    stopPolling();
    setIsSubmitting(true);
    setServerError(null);
    try {
      const started = await startLoginCapture();
      const initialStatus = await getLoginCaptureStatus(started.id);
      setCapture(initialStatus);
      void pollStatus(started.id);
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      const fallback = axiosErr.response?.status === 409
        ? 'A login capture is already running. Use refresh to follow it or cancel it first.'
        : 'Could not start the Boosteroid browser login flow.';
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
        <Stack gap="xl" w="100%" maw={860}>
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
            <Text c="dimmed" size="sm" ta="center">Boosteroid login now runs in a real upstream browser window.</Text>
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
                <Stack gap={4} maw={560}>
                  <Title order={3} fw={600}>Sign in with Boosteroid</Title>
                  <Text size="sm" c="dimmed">
                    OpenStroid launches a visible browser on the backend host, waits for you to finish the real Boosteroid login and Turnstile challenge there, then captures the resulting upstream session into the existing OpenStroid cookie session.
                  </Text>
                </Stack>
                <ThemeIcon size={44} radius="xl" variant="light" color="brand">
                  <IconSparkles size={22} />
                </ThemeIcon>
              </Group>

              <List
                spacing="xs"
                size="sm"
                icon={<ThemeIcon color="brand" size={22} radius="xl"><IconCheck size={14} /></ThemeIcon>}
              >
                <List.Item>Credentials are entered only on Boosteroid’s own page.</List.Item>
                <List.Item>The backend-owned browser context is the source of truth for upstream cookies and auth payloads.</List.Item>
                <List.Item>Captured cookies, payloads, and request metadata are saved to disk and exposed through a gated debug endpoint.</List.Item>
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
                  leftSection={<IconExternalLink size={16} />}
                  onClick={() => void handleStart()}
                  loading={isSubmitting}
                >
                  Launch Boosteroid login
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
                <Button
                  size="md"
                  variant="subtle"
                  color="red"
                  leftSection={<IconPlayerStop size={16} />}
                  onClick={() => void handleCancel()}
                  disabled={!capture || TERMINAL_STATUSES.has(capture.status) || isSubmitting}
                >
                  Cancel capture
                </Button>
              </Group>

              <Alert color={statusTone} variant="light" title={capture ? `Status: ${capture.status}` : 'No capture running'}>
                <Stack gap={6}>
                  <Text size="sm">{capture ? describeStatus(capture.status) : 'Start a capture to open the browser window and begin manual login.'}</Text>
                  {capture && (
                    <>
                      <Text size="xs" c="dimmed">Capture ID: <Code>{capture.id}</Code></Text>
                      <Text size="xs" c="dimmed">Timeout: {new Date(capture.timeoutAt).toLocaleString()}</Text>
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
                </Stack>
              </Alert>
            </Stack>
          </Paper>

          <AuthCaptureDebugPanel title="Latest debug capture" />
        </Stack>
      </Center>
    </Box>
  );
}
