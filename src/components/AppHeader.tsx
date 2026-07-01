import { Menu, UnstyledButton } from '@mantine/core';
import { IconLogout, IconUser, IconChevronDown, IconPlugConnected, IconSettings } from '@tabler/icons-react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

export function AppHeader() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const initials = user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div className="openstroid-header-right">
      <button type="button" className="openstroid-header-chip" aria-label="Bridge status">
        <IconPlugConnected size={13} />
        Bridge online
      </button>

      <Menu shadow="md" width={200} position="bottom-end" withArrow>
        <Menu.Target>
          <UnstyledButton className="openstroid-user-button" aria-label="Open account menu">
            <span className="openstroid-user-avatar">{initials}</span>
            <span className="openstroid-user-info">
              <span className="openstroid-user-name">{user?.name || user?.email || 'Account'}</span>
              <span className="openstroid-user-tier">OpenStroid</span>
            </span>
            <IconChevronDown size={14} className="openstroid-user-chevron" />
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown
          style={{
            backgroundColor: 'var(--os-panel)',
            border: '1px solid var(--os-border)',
          }}
        >
          <Menu.Item leftSection={<IconUser size={14} />} disabled>
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
          <Menu.Item color="red" leftSection={<IconLogout size={14} />} onClick={logout}>
            Sign out
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
