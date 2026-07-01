import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Center,
  Code,
  Group,
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
  IconCopy,
  IconPlayerStop,
  IconPuzzle,
  IconRefresh,
} from '@tabler/icons-react';
import { AxiosError } from 'axios';
import {
  cancelLoginCapture,
  getLoginCaptureStatus,
  startLoginCapture,
} from '../api';
import { useAuth } from '../auth';
import type {
  ApiError,
  LoginCaptureSessionStatus,
  LoginCaptureStatus,
} from '../types';

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set<LoginCaptureStatus>(['succeeded', 'failed', 'cancelled', 'timed_out']);
const EXTENSION_PATH = 'extension/openstroid-capture';

function describeStatus(status: LoginCaptureStatus): string {
  switch (status) {
    case 'starting':
      return 'Creating a local extension capture session.';
    case 'awaiting_user':
      return 'Pair the extension, sign in on Boosteroid, then keep this page open while OpenStroid waits for the captured session.';
    case 'succeeded':
      return 'Session captured. OpenStroid is ready to continue.';
    case 'failed':
      return 'Capture failed before a usable session was received.';
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
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const pollHandle = useRef<number | null>(null);
  const pollStatusRef = useRef<(captureId: string) => Promise<void>>(async () => {});

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/my-games';

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
          void pollStatusRef.current(captureId);
        }, POLL_INTERVAL_MS);
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'Failed to read login status.');
    }
  }, [from, navigate, refreshSession]);

  useEffect(() => {
    pollStatusRef.current = pollStatus;
  }, [pollStatus]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startCapture = useCallback(async () => {
    stopPolling();
    setIsSubmitting(true);
    setServerError(null);
    setCopyState('idle');
    try {
      const started = await startLoginCapture('extension');
      setPairingCode(started.extensionPairingCode ?? null);
      const initialStatus = await getLoginCaptureStatus(started.id);
      setCapture(initialStatus);
      void pollStatus(started.id);
      window.open(started.loginUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      const fallback = axiosErr.response?.status === 409
        ? 'A login capture is already running. Follow that session or cancel it first.'
        : 'Could not start the extension login session.';
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
      setPairingCode(null);
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
      setServerError(axiosErr.response?.data?.message || 'No login session is currently available.');
    }
  }, [capture, pollStatus, stopPolling]);

  const copyPairingCode = useCallback(async () => {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('failed');
    }
  }, [pairingCode]);

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
        background: '#0b0d12',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Center w="100%" p="lg">
        <Stack gap="lg" w="100%" maw={860}>
          <Stack gap={6} align="center">
            <ThemeIcon size={56} radius={8} color="cyan" variant="filled">
              <IconPuzzle size={30} />
            </ThemeIcon>
            <Title order={1} ta="center" fw={800} size="h2">
              Sign in with your Boosteroid browser session
            </Title>
            <Text c="dimmed" size="sm" ta="center" maw={640}>
              OpenStroid uses the companion Chrome extension in your normal browser profile. It does not launch an automated browser for login.
            </Text>
          </Stack>

          <Paper
            w="100%"
            p="xl"
            radius="md"
            style={{
              backgroundColor: '#10141b',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <Stack gap="lg">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4} maw={600}>
                  <Title order={3} fw={700}>Extension login</Title>
                  <Text size="sm" c="dimmed">
                    Load <Code>{EXTENSION_PATH}</Code>, set its backend URL to <Code>http://127.0.0.1:3001</Code>, then pair it with the code below.
                  </Text>
                </Stack>
                <Button
                  size="md"
                  color="teal"
                  leftSection={<IconPuzzle size={16} />}
                  onClick={() => void startCapture()}
                  loading={isSubmitting}
                >
                  Start login
                </Button>
              </Group>

              <SimpleSteps />

              {serverError && (
                <Alert icon={<IconAlertCircle size={18} />} color="red" variant="light">
                  {serverError}
                </Alert>
              )}

              {pairingCode && (
                <Paper p="md" radius="md" bg="rgba(20, 184, 166, 0.08)" style={{ border: '1px solid rgba(20,184,166,0.25)' }}>
                  <Group justify="space-between" align="center">
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed">Pairing code</Text>
                      <Code fz={28} fw={800}>{pairingCode}</Code>
                    </Stack>
                    <Button variant="light" color={copyState === 'failed' ? 'red' : 'teal'} leftSection={<IconCopy size={16} />} onClick={() => void copyPairingCode()}>
                      {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
                    </Button>
                  </Group>
                </Paper>
              )}

              <Group>
                <Button
                  variant="light"
                  leftSection={<IconBrandChrome size={16} />}
                  onClick={() => window.open('https://boosteroid.com/', '_blank', 'noopener,noreferrer')}
                >
                  Open Boosteroid
                </Button>
                <Button
                  variant="light"
                  leftSection={<IconRefresh size={16} />}
                  onClick={() => void handleRefresh()}
                  disabled={isSubmitting}
                >
                  Refresh status
                </Button>
              </Group>

              <Alert color={statusTone} variant="light" title={capture ? `Status: ${capture.status}` : 'No login session running'}>
                <Stack gap={6}>
                  <Text size="sm">
                    {capture ? describeStatus(capture.status) : 'Click Start login, paste the pairing code into the extension, then sign in on Boosteroid.'}
                  </Text>
                  {capture && (
                    <>
                      <Text size="xs" c="dimmed">Capture ID: <Code>{capture.id}</Code></Text>
                      <Text size="xs" c="dimmed">Timeout: {new Date(capture.timeoutAt).toLocaleString()}</Text>
                      {capture.errors.length > 0 && (
                        <Text size="xs" c="yellow.3">{capture.errors[capture.errors.length - 1]}</Text>
                      )}
                    </>
                  )}
                  {capture && !TERMINAL_STATUSES.has(capture.status) && (
                    <Group gap="sm">
                      <Loader size="sm" type="dots" color="teal" />
                      <Text size="xs" c="dimmed">Checking for the extension capture every {POLL_INTERVAL_MS / 1000}s.</Text>
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
                      Cancel login
                    </Button>
                  )}
                </Stack>
              </Alert>
            </Stack>
          </Paper>
        </Stack>
      </Center>
    </Box>
  );
}

function SimpleSteps() {
  return (
    <Group gap="md" grow align="stretch">
      {[
        ['1', 'Start login'],
        ['2', 'Paste the code into the extension'],
        ['3', 'Sign in on Boosteroid'],
      ].map(([number, label]) => (
        <Paper key={number} p="md" radius="md" bg="#0b0f15" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon color="teal" variant="light" radius={8}>
              {number === '3' ? <IconCheck size={16} /> : <Text fw={800}>{number}</Text>}
            </ThemeIcon>
            <Text size="sm" fw={700}>{label}</Text>
          </Group>
        </Paper>
      ))}
    </Group>
  );
}
