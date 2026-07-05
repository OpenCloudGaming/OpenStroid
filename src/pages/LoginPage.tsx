import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Center,
  Group,
  Image,
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
  IconBrandChrome,
  IconQrcode,
  IconRefresh,
} from '@tabler/icons-react';
import { AxiosError } from 'axios';
import {
  cancelQRCodeLogin,
  getQRCodeLoginStatus,
  startQRCodeLogin,
} from '../api';
import { useAuth } from '../auth';
import { writeSessionHandoff } from '../auth/storage';
import type { ApiError, QRCodeLoginSessionStatus, QRCodeLoginStatus } from '../types';

const DEFAULT_QR_POLL_INTERVAL_MS = 3000;
const QR_COMPLETION_RETRY_MS = 750;
const QR_TERMINAL_STATUSES = new Set<QRCodeLoginStatus>(['succeeded', 'cancelled', 'timed_out']);

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
  const [isStartingQr, setIsStartingQr] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const qrPollHandle = useRef<number | null>(null);
  const qrSessionRef = useRef<QRCodeLoginSessionStatus | null>(null);
  const pollQRCodeStatusRef = useRef<(sessionId: string) => Promise<void>>(async () => {});

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/my-games';

  const applyQRCodeSession = useCallback((session: QRCodeLoginSessionStatus | null) => {
    qrSessionRef.current = session;
    setQrSession(session);
  }, []);

  const stopQRCodePolling = useCallback(() => {
    if (qrPollHandle.current !== null) {
      window.clearTimeout(qrPollHandle.current);
      qrPollHandle.current = null;
    }
  }, []);

  const openValidationUrl = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const completeQrLogin = useCallback(async (session: QRCodeLoginSessionStatus): Promise<boolean> => {
    if (session.sessionHandoff) {
      writeSessionHandoff(session.sessionHandoff);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const authenticated = await refreshSession();
      if (authenticated) {
        navigate(from, { replace: true });
        return true;
      }
      if (attempt < 2) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, QR_COMPLETION_RETRY_MS);
        });
      }
    }

    if (session.sessionEstablished) {
      setServerError('Login verified but your local session could not be loaded. Try New Code.');
    }

    return false;
  }, [from, navigate, refreshSession]);

  const pollQRCodeStatus = useCallback(async (sessionId: string) => {
    try {
      const next = await getQRCodeLoginStatus(sessionId);
      applyQRCodeSession(next);
      setServerError(null);

      if (next.status === 'succeeded') {
        stopQRCodePolling();
        if (!next.sessionEstablished && !next.sessionHandoff) {
          qrPollHandle.current = window.setTimeout(() => {
            void pollQRCodeStatusRef.current(sessionId);
          }, QR_COMPLETION_RETRY_MS);
          return;
        }
        const completed = await completeQrLogin(next);
        if (!completed && !next.sessionHandoff && !next.sessionEstablished) {
          qrPollHandle.current = window.setTimeout(() => {
            void pollQRCodeStatusRef.current(sessionId);
          }, QR_COMPLETION_RETRY_MS);
        }
        return;
      }

      if (!QR_TERMINAL_STATUSES.has(next.status)) {
        qrPollHandle.current = window.setTimeout(() => {
          void pollQRCodeStatusRef.current(sessionId);
        }, next.pollIntervalMs || DEFAULT_QR_POLL_INTERVAL_MS);
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'Failed to read QR login status.');
    }
  }, [applyQRCodeSession, completeQrLogin, stopQRCodePolling]);

  useEffect(() => {
    pollQRCodeStatusRef.current = pollQRCodeStatus;
  }, [pollQRCodeStatus]);

  const startQRCodeFlow = useCallback(async (options?: { openInBrowser?: boolean }) => {
    stopQRCodePolling();
    setIsStartingQr(true);
    setServerError(null);

    try {
      const started = await startQRCodeLogin();
      applyQRCodeSession(started);
      if (options?.openInBrowser && started.validationUrl) {
        openValidationUrl(started.validationUrl);
      }
      if (!QR_TERMINAL_STATUSES.has(started.status)) {
        qrPollHandle.current = window.setTimeout(() => {
          void pollQRCodeStatusRef.current(started.id);
        }, started.pollIntervalMs || DEFAULT_QR_POLL_INTERVAL_MS);
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setServerError(axiosErr.response?.data?.message || 'Could not start QR login.');
    } finally {
      setIsStartingQr(false);
    }
  }, [applyQRCodeSession, openValidationUrl, stopQRCodePolling]);

  useEffect(() => {
    if (isAuthenticated || isBootstrapping) return;
    const handle = window.setTimeout(() => {
      void startQRCodeFlow();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [isAuthenticated, isBootstrapping, startQRCodeFlow]);

  useEffect(() => () => {
    stopQRCodePolling();
    const activeQRCodeSession = qrSessionRef.current;
    if (activeQRCodeSession && !QR_TERMINAL_STATUSES.has(activeQRCodeSession.status)) {
      void cancelQRCodeLogin(activeQRCodeSession.id).catch(() => undefined);
    }
  }, [stopQRCodePolling]);

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
        background: '#0b0d12',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Center w="100%" p="lg">
        <Stack gap="lg" w="100%" maw={1080}>
          <Group gap="sm" justify="center">
            <Image
              src="/logo.png"
              alt="OpenStroid logo"
              className="openstroid-login-logo"
              fit="contain"
            />
            <Stack gap={0}>
              <Title order={1} fw={800} size="h2">OpenStroid Desktop</Title>
              <Text c="dimmed" size="sm">Sign in with Boosteroid QR code</Text>
            </Stack>
          </Group>

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
                    border: '1px solid rgba(255,255,255,0.08)',
                    backgroundColor: '#0b0d12',
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
                      <Loader color="cyan" />
                      <Text size="sm" c="dimmed">Preparing QR code</Text>
                    </Stack>
                  )}
                </Box>

                <Stack gap="lg" justify="center">
                  <ThemeIcon size={54} radius="xl" variant="light" color="cyan">
                    <IconQrcode size={26} />
                  </ThemeIcon>
                  <Stack gap="xs">
                    <Title order={2} fw={750}>Scan to Sign In</Title>
                    <Text size="lg">Use your phone camera or the Boosteroid app</Text>
                    <Text c="dimmed">
                      Or click Login to Boosteroid to finish sign-in in your browser. Stay on this page until you are redirected.
                    </Text>
                  </Stack>

                  <Alert color={qrStatusTone} variant="light" title={qrSession ? `Status: ${qrSession.status}` : 'Starting QR login'}>
                    <Stack gap={8}>
                      <Text size="sm">{describeQRCodeStatus(qrSession)}</Text>
                      {qrSession && !QR_TERMINAL_STATUSES.has(qrSession.status) && (
                        <Group gap="sm">
                          <Loader size="sm" type="dots" color="cyan" />
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
                      size="md"
                      color="teal"
                      leftSection={<IconBrandChrome size={16} />}
                      onClick={() => {
                        if (qrSession?.validationUrl) {
                          openValidationUrl(qrSession.validationUrl);
                          return;
                        }
                        void startQRCodeFlow({ openInBrowser: true });
                      }}
                      loading={isStartingQr}
                    >
                      Login to Boosteroid
                    </Button>
                    <Button
                      variant="light"
                      leftSection={<IconRefresh size={16} />}
                      onClick={() => void startQRCodeFlow()}
                      loading={isStartingQr}
                    >
                      New Code
                    </Button>
                  </Group>
                </Stack>
              </SimpleGrid>
            </Stack>
          </Paper>
        </Stack>
      </Center>
    </Box>
  );
}
