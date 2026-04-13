import { Outlet } from 'react-router-dom';
import { AppShell } from '@mantine/core';
import { AppHeader } from '../components/AppHeader';

export function AuthenticatedLayout() {
  return (
    <AppShell
      header={{ height: 64 }}
      padding="lg"
      styles={{
        main: {
          backgroundColor: 'var(--mantine-color-dark-8)',
          minHeight: '100vh',
        },
      }}
    >
      <AppShell.Header
        style={{
          backgroundColor: 'rgba(20, 21, 23, 0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--mantine-color-dark-4)',
        }}
      >
        <AppHeader />
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
