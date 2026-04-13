import { useState, useCallback } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  TextInput,
  PasswordInput,
  Button,
  Paper,
  Title,
  Text,
  Stack,
  Box,
  Center,
  Alert,
  Transition,
  Checkbox,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconMail, IconLock, IconAlertCircle } from '@tabler/icons-react';
import { AxiosError } from 'axios';
import { Turnstile } from 'react-turnstile';
import { useAuth } from '../auth';
import { API_CONFIG } from '../api/config';
import type { ApiError } from '../types';
import classes from './LoginPage.module.css';

export function LoginPage() {
  const { login, isAuthenticated, isBootstrapping, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [turnstileInstanceKey, setTurnstileInstanceKey] = useState(0);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/library';

  const form = useForm({
    initialValues: {
      email: '',
      password: '',
      remember_me: false,
    },
    validate: {
      email: (value) => {
        if (!value.trim()) return 'Email is required';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address';
        return null;
      },
      password: (value) => {
        if (!value) return 'Password is required';
        if (value.length < 8) return 'Password must be at least 8 characters';
        return null;
      },
    },
    validateInputOnBlur: true,
  });

  const handleTurnstileVerify = useCallback((token: string) => {
    setTurnstileToken(token);
    setTurnstileError(null);
  }, []);

  const handleTurnstileError = useCallback(() => {
    setTurnstileToken(null);
    setTurnstileError('Captcha verification failed. Please try again.');
  }, []);

  const handleTurnstileExpire = useCallback(() => {
    setTurnstileToken(null);
  }, []);

  const handleSubmit = useCallback(async (values: { email: string; password: string; remember_me: boolean }) => {
    if (!turnstileToken) {
      setServerError('Please complete the captcha verification.');
      return;
    }

    setServerError(null);
    try {
      await login({
        email: values.email,
        password: values.password,
        remember_me: values.remember_me,
        'cf-turnstile-response': turnstileToken,
      });
      navigate(from, { replace: true });
    } catch (err) {
      setTurnstileToken(null);
      setTurnstileInstanceKey((current) => current + 1);

      const axiosErr = err as AxiosError<ApiError>;
      const status = axiosErr.response?.status;
      const data = axiosErr.response?.data;
      if (status === 422 || status === 403) {
        const raw = data as Record<string, unknown> | undefined;
        const nested = raw?.error as Record<string, unknown> | undefined;
        const msg =
          (raw?.message as string) ||
          (raw?.error_message as string) ||
          (nested?.message as string) ||
          'We could not find those credentials.';
        setServerError(msg);
      } else if (data?.message) {
        setServerError(data.message);
      } else if (axiosErr.message === 'Network Error') {
        setServerError('Unable to reach the server. Check your connection.');
      } else {
        setServerError('An unexpected error occurred. Please try again.');
      }
    }
  }, [from, login, navigate, turnstileToken]);

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
      <Box
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <Box
          style={{
            position: 'absolute',
            top: '-30%',
            left: '-10%',
            width: '600px',
            height: '600px',
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(0, 212, 245, 0.04) 0%, transparent 70%)',
            filter: 'blur(40px)',
          }}
        />
        <Box
          style={{
            position: 'absolute',
            bottom: '-20%',
            right: '-5%',
            width: '500px',
            height: '500px',
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(102, 0, 245, 0.04) 0%, transparent 70%)',
            filter: 'blur(40px)',
          }}
        />
      </Box>

      <Center style={{ position: 'relative', zIndex: 1, width: '100%', padding: '24px' }}>
        <Stack gap="xl" align="center" w="100%" maw={400}>
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
              <Text fw={900} size="xl" c="white" style={{ lineHeight: 1 }}>
                OS
              </Text>
            </Box>
            <Title
              order={1}
              ta="center"
              fw={800}
              style={{ fontSize: '2rem', letterSpacing: '-0.02em' }}
            >
              <Text
                component="span"
                inherit
                variant="gradient"
                gradient={{ from: 'brand.3', to: 'accent.4', deg: 135 }}
              >
                OpenStroid
              </Text>
            </Title>
            <Text c="dimmed" size="sm" ta="center">
              Cloud gaming, open source
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
            <form onSubmit={form.onSubmit(handleSubmit)}>
              <Stack gap="md">
                <Title order={3} fw={600} size="lg">
                  Sign in to your account
                </Title>

                <Transition
                  mounted={!!(serverError || turnstileError)}
                  transition="slide-down"
                  duration={200}
                >
                  {(styles) => (
                    <Alert
                      style={styles}
                      variant="light"
                      color="red"
                      icon={<IconAlertCircle size={18} />}
                      withCloseButton
                      onClose={() => {
                        setServerError(null);
                        setTurnstileError(null);
                      }}
                      radius="md"
                    >
                      {serverError || turnstileError}
                    </Alert>
                  )}
                </Transition>

                <TextInput
                  label="Email"
                  placeholder="you@example.com"
                  leftSection={<IconMail size={16} />}
                  size="md"
                  autoComplete="email"
                  disabled={isLoading}
                  classNames={{ input: classes.loginInput }}
                  {...form.getInputProps('email')}
                />

                <PasswordInput
                  label="Password"
                  placeholder="Enter your password"
                  leftSection={<IconLock size={16} />}
                  size="md"
                  autoComplete="current-password"
                  disabled={isLoading}
                  classNames={{ input: classes.loginInput }}
                  {...form.getInputProps('password')}
                />

                <Checkbox
                  label="Remember me"
                  size="sm"
                  disabled={isLoading}
                  styles={{
                    input: {
                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
                      borderColor: 'var(--mantine-color-dark-4)',
                    },
                  }}
                  {...form.getInputProps('remember_me', { type: 'checkbox' })}
                />

                <Box
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    minHeight: 65,
                  }}
                >
                  <Turnstile
                    key={turnstileInstanceKey}
                    sitekey={API_CONFIG.turnstileSiteKey}
                    onVerify={handleTurnstileVerify}
                    onError={handleTurnstileError}
                    onExpire={handleTurnstileExpire}
                    theme="dark"
                    size="flexible"
                    retry="auto"
                    retryInterval={3000}
                  />
                </Box>

                <Button
                  type="submit"
                  fullWidth
                  size="md"
                  loading={isLoading}
                  disabled={!turnstileToken}
                  mt="xs"
                  variant="gradient"
                  gradient={{ from: 'brand.5', to: 'accent.6', deg: 135 }}
                  style={{
                    fontWeight: 600,
                    height: 46,
                    transition: 'all 150ms ease',
                  }}
                >
                  Sign in
                </Button>
              </Stack>
            </form>
          </Paper>

          <Text c="dimmed" size="xs" ta="center">
            OpenStroid uses a same-origin auth bridge. Browser sessions stay on OpenStroid,
            while upstream tokens remain inside secure HttpOnly cookies.
          </Text>
        </Stack>
      </Center>
    </Box>
  );
}
