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
}

export function AuthCaptureDebugPanel({
  title = 'Captured upstream auth evidence',
  compact = false,
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
    void load();
  }, [load]);

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
