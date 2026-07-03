import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconCopy, IconRefresh } from '@tabler/icons-react';
import { AxiosError } from 'axios';
import { getAuthCaptureDebug } from '../api';
import type { ApiError, AuthCaptureDebugResponse } from '../types';

interface AuthCaptureDebugPanelProps {
  title?: string;
  compact?: boolean;
  variant?: 'default' | 'settings';
}

export function AuthCaptureDebugPanel({
  title = 'Captured upstream auth evidence',
  compact = false,
  variant = 'default',
}: AuthCaptureDebugPanelProps) {
  const [data, setData] = useState<AuthCaptureDebugResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getAuthCaptureDebug();
      setData(response);
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      setError(axiosErr.response?.data?.message || 'Debug capture is not available yet.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  if (variant === 'settings') {
    return (
      <div className="settings-row settings-row--column">
        <div className="settings-row-top">
          <label className="settings-label">{title}</label>
          <button type="button" className="settings-export-logs-btn" disabled={isLoading} onClick={() => void load()}>
            <IconRefresh size={16} />
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="settings-subtle-hint">Loading latest capture artifact…</div>
        ) : null}

        {!isLoading && error ? (
          <div className="settings-subtle-hint" style={{ color: 'var(--warning)' }}>
            {error}
          </div>
        ) : null}

        {!isLoading && data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            <div className="settings-subtle-hint">
              Capture ID: <code>{data.artifact.id}</code>
            </div>
            <div className="settings-subtle-hint">
              Artifact: <code>{data.artifactPath ?? 'in-memory only'}</code>
            </div>
            <CopyButton value={JSON.stringify(data, null, 2)} timeout={1500}>
              {({ copied, copy }) => (
                <button type="button" className="settings-export-logs-btn" onClick={copy}>
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  {copied ? 'Copied' : 'Copy JSON'}
                </button>
              )}
            </CopyButton>
            <pre
              className="settings-path-value"
              style={{
                maxHeight: compact ? 320 : 480,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Paper
      p={compact ? 'md' : 'xl'}
      radius="lg"
      style={{
        backgroundColor: 'rgba(37, 38, 43, 0.72)',
        border: '1px solid var(--mantine-color-dark-4)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Title order={compact ? 4 : 3} fw={600}>{title}</Title>
            <Text size="sm" c="dimmed">
              Raw cookies, network payloads, and bridge session data submitted by the companion extension.
            </Text>
          </Stack>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconRefresh size={14} />}
            onClick={() => void load()}
            loading={isLoading}
          >
            Refresh
          </Button>
        </Group>

        {isLoading && (
          <Group gap="sm">
            <Loader size="sm" type="dots" color="brand" />
            <Text size="sm" c="dimmed">Loading latest capture artifact…</Text>
          </Group>
        )}

        {!isLoading && error && (
          <Alert icon={<IconAlertCircle size={18} />} color="yellow" variant="light">
            {error}
          </Alert>
        )}

        {!isLoading && data && (
          <Stack gap="sm">
            <Group gap="xl">
              <Text size="sm" c="dimmed">Capture ID: <Code>{data.artifact.id}</Code></Text>
              <Text size="sm" c="dimmed">Artifact: <Code>{data.artifactPath ?? 'in-memory only'}</Code></Text>
            </Group>
            <CopyButton value={JSON.stringify(data, null, 2)} timeout={1500}>
              {({ copied, copy }) => (
                <Button
                  size="xs"
                  variant="light"
                  color={copied ? 'teal' : 'brand'}
                  leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  onClick={copy}
                >
                  {copied ? 'Copied' : 'Copy JSON'}
                </Button>
              )}
            </CopyButton>
            <ScrollArea.Autosize mah={compact ? 320 : 480} offsetScrollbars>
              <Code block>{JSON.stringify(data, null, 2)}</Code>
            </ScrollArea.Autosize>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
