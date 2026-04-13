import { Group, Text, Menu, Avatar, UnstyledButton, Box } from '@mantine/core';
import { IconLogout, IconUser, IconChevronDown } from '@tabler/icons-react';
import { useAuth } from '../auth';

export function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <Group h="100%" px="lg" justify="space-between">
      <Group gap="xs">
        <Box
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #00d4f5 0%, #6600f5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text fw={800} size="sm" c="white" style={{ lineHeight: 1 }}>
            OS
          </Text>
        </Box>
        <Text
          fw={700}
          size="lg"
          variant="gradient"
          gradient={{ from: 'brand.4', to: 'accent.4', deg: 135 }}
        >
          OpenStroid
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
