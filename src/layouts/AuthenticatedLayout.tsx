import { Outlet, useLocation } from 'react-router-dom';
import { AppShell, Box, Button, Divider, Group, NavLink, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconBrandSteam, IconCloudDownload, IconDeviceGamepad2, IconExternalLink, IconHome, IconServerBolt, IconSettings } from '@tabler/icons-react';
import { NavLink as RouterNavLink } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';

export function AuthenticatedLayout() {
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 260, breakpoint: 'sm' }}
      padding={0}
      styles={{
        main: {
          background: '#0b0d12',
          minHeight: '100vh',
        },
      }}
    >
      <AppShell.Header
        style={{
          backgroundColor: 'rgba(11, 13, 18, 0.9)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <AppHeader />
      </AppShell.Header>
      <AppShell.Navbar
        p="md"
        style={{
          backgroundColor: '#0f1218',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <Stack h="100%" justify="space-between">
          <Stack gap="md">
            <Group gap="sm" h={36}>
              <ThemeIcon size={34} radius={8} color="cyan" variant="filled">
                <IconDeviceGamepad2 size={20} />
              </ThemeIcon>
              <Box>
                <Text fw={800} size="sm" c="white" lh={1.1}>
                  OpenStroid
                </Text>
                <Text size="xs" c="dimmed" lh={1.2}>
                  Desktop client
                </Text>
              </Box>
            </Group>
            <Divider color="rgba(255,255,255,0.08)" />
            <Stack gap={4}>
              <NavLink
                component={RouterNavLink}
                to="/library"
                label="Library"
                leftSection={<IconHome size={18} />}
                active={location.pathname.startsWith('/library')}
                variant="filled"
                color="cyan"
                styles={{
                  root: { borderRadius: 8 },
                  label: { fontWeight: 700 },
                }}
              />
              <NavLink
                component={RouterNavLink}
                to="/install"
                label="Install"
                leftSection={<IconCloudDownload size={18} />}
                active={location.pathname.startsWith('/install')}
                variant="filled"
                color="cyan"
                styles={{
                  root: { borderRadius: 8 },
                  label: { fontWeight: 700 },
                }}
              />
              <NavLink
                component={RouterNavLink}
                to="/settings"
                label="Settings"
                leftSection={<IconSettings size={18} />}
                active={location.pathname.startsWith('/settings')}
                variant="filled"
                color="cyan"
                styles={{
                  root: { borderRadius: 8 },
                  label: { fontWeight: 700 },
                }}
              />
              <NavLink
                label="Bridge"
                leftSection={<IconServerBolt size={18} />}
                disabled
                description="Local session"
                styles={{ root: { borderRadius: 8 } }}
              />
              <NavLink
                label="Platforms"
                leftSection={<IconBrandSteam size={18} />}
                disabled
                description="Sync accounts"
                styles={{ root: { borderRadius: 8 } }}
              />
            </Stack>
          </Stack>
          <Button
            variant="light"
            color="gray"
            size="xs"
            leftSection={<IconExternalLink size={14} />}
            onClick={() => window.open('https://cloud.boosteroid.com/dashboard', '_blank', 'noopener,noreferrer')}
          >
            Boosteroid dashboard
          </Button>
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Box px={{ base: 'md', md: 'xl' }} py="lg">
          <Outlet />
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
