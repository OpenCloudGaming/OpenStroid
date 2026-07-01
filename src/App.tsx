import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { theme } from './theme';
import { AuthProvider } from './auth';
import { RequireAuth } from './components/RequireAuth';
import { AuthenticatedLayout } from './layouts/AuthenticatedLayout';
import { LoginPage } from './pages/LoginPage';
import { MyGamesPage } from './pages/LibraryPage';
import { LibraryCatalogPage } from './pages/LibraryCatalogPage';
import { InstallPage } from './pages/InstallPage';
import { SettingsPage } from './pages/SettingsPage';
import { StreamPage } from './pages/StreamPage';

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="top-right" />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </MantineProvider>
  );
}

function AppRoutes() {
  const location = useLocation();
  const state = location.state as { backgroundPath?: string } | null;
  const settingsOpen = location.pathname === '/settings';
  const backgroundPath =
    settingsOpen && state?.backgroundPath && state.backgroundPath !== '/settings'
      ? state.backgroundPath
      : settingsOpen
        ? '/my-games'
        : undefined;

  return (
    <>
      <Routes location={backgroundPath ?? location}>
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
        </Route>
        <Route path="*" element={<Navigate to="/my-games" replace />} />
      </Routes>

      {settingsOpen && (
        <RequireAuth>
          <SettingsPage />
        </RequireAuth>
      )}
    </>
  );
}
