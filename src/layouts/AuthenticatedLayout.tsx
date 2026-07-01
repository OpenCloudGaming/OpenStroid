import { Outlet, useLocation } from 'react-router-dom';
import { AppShell, Burger, Button, Drawer, Group, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBooks,
  IconCloudDownload,
  IconExternalLink,
  IconHome,
  IconSettings,
} from '@tabler/icons-react';
import { NavLink as RouterNavLink } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';

const navItems = [
  { to: '/my-games', label: 'My Games', icon: IconHome },
  { to: '/library', label: 'Library', icon: IconBooks },
  { to: '/install', label: 'Install', icon: IconCloudDownload },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

function isActivePath(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AuthenticatedLayout() {
  const location = useLocation();
  const [mobileNavOpened, { toggle: toggleMobileNav, close: closeMobileNav }] = useDisclosure(false);

  const renderNavItems = (onClick?: () => void) => navItems.map((item) => {
    const Icon = item.icon;
    const active = isActivePath(location.pathname, item.to);

    return (
      <UnstyledButton
        key={item.to}
        component={RouterNavLink}
        to={item.to}
        state={item.to === '/settings' ? { backgroundPath: location.pathname } : undefined}
        className="openstroid-nav-link"
        data-active={active}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
      >
        <Icon size={16} stroke={2} />
        <span>{item.label}</span>
      </UnstyledButton>
    );
  });

  return (
    <AppShell
      header={{ height: 48 }}
      padding={0}
      styles={{
        header: {
          backgroundColor: 'rgba(9, 10, 12, 0.96)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(12px)',
        },
        main: {
          minHeight: '100vh',
          background:
            'radial-gradient(900px 420px at 80% -10%, rgba(88,217,138,0.045), transparent 68%), linear-gradient(180deg, #090a0c 0%, #0f1013 100%)',
        },
      }}
    >
      <AppShell.Header>
        <header className="openstroid-header">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={mobileNavOpened}
              onClick={toggleMobileNav}
              hiddenFrom="sm"
              size="sm"
              color="var(--os-ink-soft)"
              aria-label="Open navigation"
            />
            <UnstyledButton
              component={RouterNavLink}
              to="/my-games"
              className="openstroid-brand"
              aria-label="OpenStroid home"
              onClick={closeMobileNav}
            >
              <span className="openstroid-brand-mark">
                <img src="/opennow-logo-mark.png" alt="" aria-hidden="true" draggable={false} />
              </span>
              <span className="openstroid-brand-copy">
                <Text fw={700} size="sm" c="white" lh={1.1}>
                  OpenStroid
                </Text>
              </span>
            </UnstyledButton>
          </Group>

          <nav className="openstroid-nav" aria-label="Primary navigation">
            {renderNavItems()}
          </nav>

          <AppHeader />
        </header>
      </AppShell.Header>

      <Drawer
        opened={mobileNavOpened}
        onClose={closeMobileNav}
        title="OpenStroid"
        size="xs"
        padding="md"
        styles={{
          content: {
            backgroundColor: '#0f1013',
            borderRight: '1px solid rgba(255,255,255,0.08)',
          },
          header: {
            backgroundColor: '#0f1013',
          },
        }}
      >
        <nav className="openstroid-mobile-nav" aria-label="Mobile navigation">
          {renderNavItems(closeMobileNav)}
          <Button
            mt="sm"
            variant="light"
            color="gray"
            leftSection={<IconExternalLink size={14} />}
            onClick={() => {
              window.open('https://cloud.boosteroid.com/dashboard', '_blank', 'noopener,noreferrer');
              closeMobileNav();
            }}
          >
            Boosteroid dashboard
          </Button>
        </nav>
      </Drawer>

      <AppShell.Main>
        <main className="openstroid-main-inner">
          <Outlet />
        </main>
      </AppShell.Main>
    </AppShell>
  );
}
