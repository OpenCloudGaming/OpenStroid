import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Center,
  Code,
  Collapse,
  Divider,
  Group,
  Image,
  List,
  Loader,
  Paper,
  SimpleGrid,
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
  IconDeviceDesktop,
  IconExternalLink,
  IconKey,
  IconPlayerStop,
  IconPuzzle,
  IconQrcode,
  IconRefresh,
} from '@tabler/icons-react';
import { AxiosError } from 'axios';
import {
  cancelLoginCapture,
  cancelQRCodeLogin,
  getLoginCaptureStatus,
  getQRCodeLoginStatus,
  startLoginCapture,
  startQRCodeLogin,
} from '../api';
import { useAuth } from '../auth';
import type {
  ApiError,
  LoginCaptureMethod,
  LoginCaptureSessionStatus,
  LoginCaptureStatus,
  QRCodeLoginSessionStatus,
  QRCodeLoginStatus,
} from '../types';

const CAPTURE_POLL_INTERVAL_MS = 1500;
const DEFAULT_QR_POLL_INTERVAL_MS = 3000;
const CAPTURE_TERMINAL_STATUSES = new Set<LoginCaptureStatus>(['succeeded', 'failed', 'cancelled', 'timed_out']);
const QR_TERMINAL_STATUSES = new Set<QRCodeLoginStatus>(['succeeded', 'cancelled', 'timed_out']);
const EXTENSION_PATH = 'extension/openstroid-capture';

function describeStatus(status: LoginCaptureStatus, method: LoginCaptureMethod | undefined): string {
  switch (status) {
    case 'starting':
      return method === 'browser'
        ? 'Launching the Electron-managed backend browser fallback.'
        : 'Creating an extension capture session in the desktop bridge.';
    case 'awaiting_user':
      return method === 'browser'
        ? 'Complete login in the Electron-managed backend browser window.'
        : 'Use the OpenStroid Chrome extension while you log in on Boosteroid in your normal Chrome profile.';
    case 'succeeded':
      return 'Captured upstream auth state. OpenStroid Desktop is establishing its local first-party session.';
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

function describeQRCodeStatus(session: QRCodeLoginSessionStatus | null): string {
  if (!session) return 'Creating a QR login code.';
  switch (session.status) {
    case 'polling':
      return 'Waiting for Boosteroid to verify this QR code.';
    case 'succeeded':
      return 'QR code verified. OpenStroid is establishing your local session.';
    case 'cancelled':
      return 'QR login was cancelled.';
    case 'timed_out':
      return 'QR login timed out. Generate a new code to keep going.';
    default:
      return 'Waiting for QR login status.';
  }
}

export function LoginPage() {
  const { refreshSession, isAuthenticated, isBootstrapping } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [qrSession, setQrSession] = useState<QRCodeLoginSessionStatus | null>(null);
  const [capture, setCapture] = useState<LoginCaptureSessionStatus | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStartingQr, setIsStartingQr] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [manualImportOpen, setManualImportOpen] = useState(false);
  const [extensionPairingCode, setExtensionPairingCode] = useState<string | null>(null);
  const capturePollHandle = useRef<number | null>(null);
  const qrPollHandle = useRef<number | null>(null);
  const qrSessionRef = useRef<QRCodeLoginSessionStatus | null>(null);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/library';

  const applyQRCodeSession = useCallback((session: QRCodeLoginSessionStatus | null) => {
    qrSessionRef.current = session;
    setQrSession(session);
  }, []);

  const stopCapturePolling = useCallback(() => {
    if (capturePollHandle.current !== null) {
      window.clearTimeout(capturePollHandle.current);
      capturePollHandle.current = null;
    }
  }, []);

  const stopQRCodePolling = useCallback(() => {
    if (qrPollHandle.current !== null) {
      window.clearTimeout(qrPollHandle.current);
      qrPollHandle.current = null;
    }
  }, []);

  const pollQRCodeStatus = useCallback(async (sessionId: string) => {
    try {
      const next = await getQRCodeLoginStatus(sessionId);
      applyQRCodeSession(next);
      setServerError(null);

      if (next.status === 'succeeded' && next.sessionEstablished) {
        await refreshSession();
        navigate(from, { replace: true });
        return;
      }

      if (!QR_TERMINAL_STATUSES.has(next.status)) {
        qrPollHandle.current = window.setTimeout(() => {
          void pollQRCodeStatus(sessionId);
        }, next.pollIntervalMs || DEFAULT_QR_POLL_INTERVAL_MS);
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'Failed to read QR login status.');
    }
  }, [applyQRCodeSession, from, navigate, refreshSession]);

  const startQRCodeFlow = useCallback(async () => {
    stopQRCodePolling();
    setIsStartingQr(true);
    setServerError(null);
    setCapture(null);
    setExtensionPairingCode(null);

    try {
      const started = await startQRCodeLogin();
      applyQRCodeSession(started);
      if (!QR_TERMINAL_STATUSES.has(started.status)) {
        qrPollHandle.current = window.setTimeout(() => {
          void pollQRCodeStatus(started.id);
        }, started.pollIntervalMs || DEFAULT_QR_POLL_INTERVAL_MS);
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'Could not start QR login.');
    } finally {
      setIsStartingQr(false);
    }
  }, [applyQRCodeSession, pollQRCodeStatus, stopQRCodePolling]);

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

      if (!CAPTURE_TERMINAL_STATUSES.has(next.status)) {
        capturePollHandle.current = window.setTimeout(() => {
          void pollStatus(captureId);
        }, CAPTURE_POLL_INTERVAL_MS);
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'Failed to read login capture status.');
    }
  }, [from, navigate, refreshSession]);

  useEffect(() => {
    if (!isAuthenticated && !isBootstrapping) {
      void startQRCodeFlow();
    }
  }, [isAuthenticated, isBootstrapping, startQRCodeFlow]);

  useEffect(() => () => {
    stopQRCodePolling();
    stopCapturePolling();
    const activeQRCodeSession = qrSessionRef.current;
    if (activeQRCodeSession && !QR_TERMINAL_STATUSES.has(activeQRCodeSession.status)) {
      void cancelQRCodeLogin(activeQRCodeSession.id).catch(() => undefined);
    }
  }, [stopCapturePolling, stopQRCodePolling]);

  const cancelActiveQRCode = useCallback(async () => {
    stopQRCodePolling();
    if (qrSession && !QR_TERMINAL_STATUSES.has(qrSession.status)) {
      const cancelled = await cancelQRCodeLogin(qrSession.id).catch(() => null);
      if (cancelled) {
        applyQRCodeSession(cancelled);
      }
    }
  }, [applyQRCodeSession, qrSession, stopQRCodePolling]);

  const startCapture = useCallback(async (method: LoginCaptureMethod) => {
    await cancelActiveQRCode();
    stopCapturePolling();
    setIsSubmitting(true);
    setServerError(null);
    setManualImportOpen(true);
    try {
      const started = await startLoginCapture(method);
      setExtensionPairingCode(started.extensionPairingCode ?? null);
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
          ? 'Could not start the Electron-managed backend browser fallback.'
          : 'Could not start the desktop extension capture session.';
      setServerError(axiosErr.response?.data?.message || fallback);
    } finally {
      setIsSubmitting(false);
    }
  }, [cancelActiveQRCode, pollStatus, stopCapturePolling]);

  const handleCancel = useCallback(async () => {
    if (!capture) return;
    stopCapturePolling();
    setIsSubmitting(true);
    try {
      const cancelled = await cancelLoginCapture(capture.id);
      setCapture(cancelled);
      setExtensionPairingCode(null);
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'Failed to cancel the active capture.');
    } finally {
      setIsSubmitting(false);
    }
  }, [capture, stopCapturePolling]);

  const handleRefresh = useCallback(async () => {
    setServerError(null);
    if (capture?.id) {
      stopCapturePolling();
      await pollStatus(capture.id);
      return;
    }

    try {
      const latest = await getLoginCaptureStatus();
      setCapture(latest);
      if (!CAPTURE_TERMINAL_STATUSES.has(latest.status)) {
        void pollStatus(latest.id);
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'No capture session is currently available.');
    }
  }, [capture?.id, pollStatus, stopCapturePolling]);

  const statusTone = useMemo(() => {
    if (!capture) return 'blue';
    if (capture.status === 'succeeded') return 'teal';
    if (capture.status === 'failed' || capture.status === 'timed_out' || capture.status === 'cancelled') return 'yellow';
    return 'blue';
  }, [capture]);

  const qrStatusTone = useMemo(() => {
    if (!qrSession || qrSession.status === 'polling') return 'blue';
    if (qrSession.status === 'succeeded') return 'teal';
    return 'yellow';
  }, [qrSession]);

  if (isAuthenticated && !isBootstrapping) {
    return <Navigate to={from} replace />;
  }

  return (
    <Box
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, var(--mantine-color-dark-9), var(--mantine-color-dark-8))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Center style={{ position: 'relative', zIndex: 1, width: '100%', padding: '24px' }}>
        <Stack gap="xl" w="100%" maw={1080}>
          <Group gap="sm" justify="center">
            <ThemeIcon size={42} radius="md" variant="gradient" gradient={{ from: 'brand.5', to: 'accent.6', deg: 135 }}>
              <IconQrcode size={24} />
            </ThemeIcon>
            <Stack gap={0}>
              <Title order={1} fw={800} style={{ fontSize: '2rem' }}>OpenStroid Desktop</Title>
              <Text c="dimmed" size="sm">Boosteroid sign-in</Text>
            </Stack>
          </Group>

          <Paper
            w="100%"
            p="xl"
            radius="lg"
            style={{
              backgroundColor: 'rgba(37, 38, 43, 0.84)',
              border: '1px solid var(--mantine-color-dark-4)',
            }}
          >
            <Stack gap="lg">
              {serverError && (
                <Alert icon={<IconAlertCircle size={18} />} color="red" variant="light">
                  {serverError}
                </Alert>
              )}

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl" verticalSpacing="xl">
                <Box
                  style={{
                    minHeight: 360,
                    borderRadius: 8,
                    border: '1px solid var(--mantine-color-dark-4)',
                    backgroundColor: 'var(--mantine-color-dark-7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 20,
                  }}
                >
                  {qrSession?.qrCodeDataUrl ? (
                    <Image
                      src={qrSession.qrCodeDataUrl}
                      alt="QR code"
                      fit="contain"
                      style={{
                        width: 'min(100%, 500px)',
                        imageRendering: 'pixelated',
                      }}
                    />
                  ) : (
                    <Stack gap="sm" align="center">
                      <Loader color="brand" />
                      <Text size="sm" c="dimmed">Preparing QR code</Text>
                    </Stack>
                  )}
                </Box>

                <Stack gap="lg" justify="center">
                  <ThemeIcon size={54} radius="xl" variant="light" color="brand">
                    <IconDeviceDesktop size={26} />
                  </ThemeIcon>
                  <Stack gap="xs">
                    <Title order={2} fw={750}>Scan to Sign In</Title>
                    <Text size="lg">Use your phone camera or QR reader app</Text>
                    <Text c="dimmed">
                      Stay on this page and you will be automatically logged in once the code is verified!
                    </Text>
                  </Stack>

                  <Alert color={qrStatusTone} variant="light" title={qrSession ? `Status: ${qrSession.status}` : 'Starting QR login'}>
                    <Stack gap={8}>
                      <Text size="sm">{describeQRCodeStatus(qrSession)}</Text>
                      {qrSession && !QR_TERMINAL_STATUSES.has(qrSession.status) && (
                        <Group gap="sm">
                          <Loader size="sm" type="dots" color="brand" />
                          <Text size="xs" c="dimmed">Polling every {(qrSession.pollIntervalMs || DEFAULT_QR_POLL_INTERVAL_MS) / 1000}s.</Text>
                        </Group>
                      )}
                      {qrSession?.errors.at(-1) && (
                        <Text size="xs" c="yellow.3">{qrSession.errors.at(-1)}</Text>
                      )}
                    </Stack>
                  </Alert>

                  <Group>
                    <Button
                      variant="gradient"
                      gradient={{ from: 'brand.5', to: 'accent.6', deg: 135 }}
                      leftSection={<IconRefresh size={16} />}
                      onClick={() => void startQRCodeFlow()}
                      loading={isStartingQr}
                    >
                      New Code
                    </Button>
                    <Button
                      variant="light"
                      leftSection={<IconKey size={16} />}
                      onClick={() => setManualImportOpen((opened) => !opened)}
                    >
                      Manual Import
                    </Button>
                  </Group>
                </Stack>
              </SimpleGrid>

              <Collapse expanded={manualImportOpen}>
                <Divider color="dark.4" mb="lg" />
                <Stack gap="lg">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4} maw={650}>
                      <Title order={3} fw={600}>Connect with manual import</Title>
                      <Text size="sm" c="dimmed">
                        Use the companion Chrome extension to send upstream cookies and auth evidence to the local Electron bridge.
                      </Text>
                    </Stack>
                    <ThemeIcon size={44} radius="xl" variant="light" color="brand">
                      <IconPuzzle size={22} />
                    </ThemeIcon>
                  </Group>

                  <List
                    spacing="xs"
                    size="sm"
                    icon={<ThemeIcon color="brand" size={22} radius="xl"><IconCheck size={14} /></ThemeIcon>}
                  >
                    <List.Item>Run OpenStroid Desktop so the local bridge is available on <Code>http://127.0.0.1:3001</Code>.</List.Item>
                    <List.Item>Load the unpacked Chrome extension from <Code>{EXTENSION_PATH}</Code>.</List.Item>
                    <List.Item>Set the extension backend URL to <Code>http://127.0.0.1:3001</Code> and paste the pairing code shown below.</List.Item>
                    <List.Item>Log in on <Code>boosteroid.com</Code> in that same Chrome profile.</List.Item>
                  </List>

                  <Group>
                    <Button
                      size="md"
                      variant="gradient"
                      gradient={{ from: 'brand.5', to: 'accent.6', deg: 135 }}
                      leftSection={<IconPuzzle size={16} />}
                      onClick={() => void startCapture('extension')}
                      loading={isSubmitting}
                    >
                      Start desktop extension capture
                    </Button>
                    <Button
                      size="md"
                      variant="light"
                      leftSection={<IconBrandChrome size={16} />}
                      onClick={() => window.open('https://boosteroid.com/', '_blank', 'noopener,noreferrer')}
                    >
                      Open Boosteroid in Chrome
                    </Button>
                    <Button
                      size="md"
                      variant="light"
                      leftSection={<IconRefresh size={16} />}
                      onClick={() => void handleRefresh()}
                      disabled={isSubmitting}
                    >
                      Refresh capture status
                    </Button>
                  </Group>

                  <Alert color={statusTone} variant="light" title={capture ? `Status: ${capture.status}` : 'No capture running'}>
                    <Stack gap={6}>
                      <Text size="sm">{capture ? describeStatus(capture.status, capture.captureMethod) : 'Start a capture session in OpenStroid Desktop, then finish the pairing flow in Chrome.'}</Text>
                      {capture && (
                        <>
                          <Text size="xs" c="dimmed">Capture ID: <Code>{capture.id}</Code></Text>
                          <Text size="xs" c="dimmed">Method: <Code>{capture.captureMethod}</Code></Text>
                          {extensionPairingCode && capture.captureMethod === 'extension' && (
                            <Text size="xs" c="dimmed">Pairing code: <Code>{extensionPairingCode}</Code></Text>
                          )}
                          <Text size="xs" c="dimmed">Timeout: {new Date(capture.timeoutAt).toLocaleString()}</Text>
                          {capture.finalUrl && <Text size="xs" c="dimmed">Final URL: <Code>{capture.finalUrl}</Code></Text>}
                          {capture.errors.length > 0 && (
                            <Text size="xs" c="yellow.3">{capture.errors[capture.errors.length - 1]}</Text>
                          )}
                          {capture.diagnostics && (
                            <Code block>{JSON.stringify(capture.diagnostics, null, 2)}</Code>
                          )}
                        </>
                      )}
                      {capture && !CAPTURE_TERMINAL_STATUSES.has(capture.status) && (
                        <Group gap="sm">
                          <Loader size="sm" type="dots" color="brand" />
                          <Text size="xs" c="dimmed">Electron is polling capture status every {CAPTURE_POLL_INTERVAL_MS / 1000}s.</Text>
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
                          Continue to my library
                        </Button>
                      )}
                      {capture && !CAPTURE_TERMINAL_STATUSES.has(capture.status) && (
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

                  <Stack gap="xs">
                    <Title order={4} fw={600}>Electron-managed browser fallback</Title>
                    <Text size="sm" c="dimmed">
                      Use only if the extension path is temporarily unavailable.
                    </Text>
                    <Group>
                      <Button
                        size="sm"
                        variant="subtle"
                        leftSection={<IconExternalLink size={14} />}
                        onClick={() => void startCapture('browser')}
                        loading={isSubmitting}
                      >
                        Start browser fallback
                      </Button>
                      <Text size="sm" c="dimmed">
                        Companion extension folder: <Code>{EXTENSION_PATH}</Code>
                      </Text>
                    </Group>
                  </Stack>
                </Stack>
              </Collapse>
            </Stack>
          </Paper>
        </Stack>
      </Center>
    </Box>
  );
}
