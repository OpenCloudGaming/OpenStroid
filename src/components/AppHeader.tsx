import { Badge, Box, Group, Text, Menu, Avatar, UnstyledButton } from '@mantine/core';
import { IconLogout, IconUser, IconChevronDown, IconPlugConnected, IconSettings } from '@tabler/icons-react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

export function AppHeader() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <Group className="openstroid-header-right" gap="sm" wrap="nowrap">
      <Group gap="xs" wrap="nowrap" visibleFrom="md">
        <Badge
          className="openstroid-header-chip"
          variant="outline"
          color="brand"
          leftSection={<IconPlugConnected size={13} />}
          styles={{ root: { textTransform: 'none' } }}
        >
          Bridge online
        </Badge>
      </Group>

      <Menu shadow="md" width={200} position="bottom-end" withArrow>
        <Menu.Target>
          <UnstyledButton className="openstroid-user-button" aria-label="Open account menu">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              <Avatar
                size={34}
                radius={7}
                color="brand"
                src={user?.avatar}
              >
                {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
              </Avatar>
              <Box visibleFrom="sm" style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} c="gray.3" truncate style={{ lineHeight: 1.2, maxWidth: 128 }}>
                  {user?.name || user?.email || 'Account'}
                </Text>
                <Text size="xs" fw={700} c="brand.4" tt="uppercase" style={{ lineHeight: 1.1 }}>
                  OpenStroid
                </Text>
              </Box>
              <IconChevronDown size={14} color="var(--mantine-color-dimmed)" />
            </Group>
          </UnstyledButton>
        </Menu.Target>
          <Menu.Dropdown
            style={{
              backgroundColor: 'var(--os-panel)',
              border: '1px solid var(--os-border)',
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
            state={{ backgroundPath: location.pathname }}
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
