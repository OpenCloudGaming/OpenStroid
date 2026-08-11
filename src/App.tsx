import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { lazy, Suspense } from 'react';
import { Center, Loader, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { theme } from './theme';
import { AuthProvider } from './auth';
import { RequireAuth } from './components/RequireAuth';
import { SettingsModalHost } from './components/SettingsModalHost';
import { AuthenticatedLayout } from './layouts/AuthenticatedLayout';

const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const MyGamesPage = lazy(() => import('./pages/LibraryPage').then((module) => ({ default: module.MyGamesPage })));
const LibraryCatalogPage = lazy(() => import('./pages/LibraryCatalogPage').then((module) => ({ default: module.LibraryCatalogPage })));
const InstallPage = lazy(() => import('./pages/InstallPage').then((module) => ({ default: module.InstallPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const StreamPage = lazy(() => import('./pages/StreamPage').then((module) => ({ default: module.StreamPage })));

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="top-right" />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<Center h="100vh"><Loader color="brand" type="dots" /></Center>}>
            <AppRoutes />
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </MantineProvider>
  );
}

function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { backgroundPath?: string } | null;
  const settingsOpen = location.pathname === '/settings';
  const backgroundPath =
    settingsOpen && state?.backgroundPath && state.backgroundPath !== '/settings'
      ? state.backgroundPath
      : settingsOpen
        ? '/my-games'
        : undefined;
  const routesLocation = backgroundPath
    ? { ...location, pathname: backgroundPath }
    : location;

  const closeSettings = () => {
    const returnPath = state?.backgroundPath;
    navigate(returnPath && returnPath !== '/settings' ? returnPath : '/my-games', { replace: true });
  };

  return (
    <>
      <Routes location={routesLocation}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/stream" element={<StreamPage />} />
        <Route
          element={
            <RequireAuth>
              <AuthenticatedLayout />
            </RequireAuth>
          }
        >
          <Route path="/my-games" element={<MyGamesPage />} />
          <Route path="/library" element={<LibraryCatalogPage />} />
          <Route path="/install" element={<InstallPage />} />
          <Route path="/settings" element={null} />
        </Route>
        <Route path="*" element={<Navigate to="/my-games" replace />} />
      </Routes>

      {settingsOpen && (
        <RequireAuth>
          <SettingsModalHost open={settingsOpen} onClose={closeSettings}>
            <SettingsPage onClose={closeSettings} />
          </SettingsModalHost>
        </RequireAuth>
      )}
    </>
  );
}
