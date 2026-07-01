import { Badge, Box, Group, Text, Menu, Avatar, UnstyledButton } from '@mantine/core';
import { IconLogout, IconUser, IconChevronDown, IconPlugConnected, IconSettings } from '@tabler/icons-react';
import { NavLink as RouterNavLink } from 'react-router-dom';
import { useAuth } from '../auth';

export function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <Group h="100%" px="lg" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        <Badge
          variant="light"
          color="teal"
          leftSection={<IconPlugConnected size={13} />}
          styles={{ root: { textTransform: 'none' } }}
        >
          Bridge online
        </Badge>
        <Text size="sm" c="dimmed" visibleFrom="sm">
          {user?.email ?? 'Authenticated'}
        </Text>
      </Group>

      <Menu shadow="md" width={200} position="bottom-end" withArrow>
        <Menu.Target>
          <UnstyledButton>
            <Group gap="xs">
              <Avatar
                size={34}
                radius="xl"
                color="brand"
                src={user?.avatar}
              >
                {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
              </Avatar>
              <Box visibleFrom="sm">
                <Text size="sm" fw={500} c="dimmed" style={{ lineHeight: 1.2 }}>
                  {user?.name || user?.email || 'Account'}
                </Text>
              </Box>
              <IconChevronDown size={14} color="var(--mantine-color-dimmed)" />
            </Group>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown
          style={{
            backgroundColor: 'var(--mantine-color-dark-7)',
            border: '1px solid var(--mantine-color-dark-4)',
          }}
        >
          <Menu.Item
            leftSection={<IconUser size={14} />}
            disabled
          >
            Profile
          </Menu.Item>
          <Menu.Item
            component={RouterNavLink}
            to="/settings"
            leftSection={<IconSettings size={14} />}
          >
            Settings
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            color="red"
            leftSection={<IconLogout size={14} />}
            onClick={logout}
          >
            Sign out
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
