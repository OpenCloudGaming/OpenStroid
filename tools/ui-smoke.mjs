import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const server = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4173'], {
  cwd: projectRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += chunk;
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk;
});

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Vite preview did not start.\n${serverOutput}`);
}

const installedGames = [{
  id: 1,
  name: 'Installed Game',
  store: { name: 'Steam' },
}];
const catalogGames = [
  { id: 2, name: 'Catalog Game', store: { name: 'Epic' } },
  { id: 3, name: 'Another Catalog Game', store: { name: 'Steam' } },
];
let installRequests = 0;

async function mockApi(page) {
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/session') {
      await route.fulfill({ json: { authenticated: true, user: { id: 1, email: 'tester@example.com', name: 'Test User' } } });
      return;
    }
    if (path === '/library/installed') {
      await route.fulfill({ json: { games: installedGames } });
      return;
    }
    if (path === '/library/facets') {
      await route.fulfill({ json: { collections: [{ id: 1, name: 'Install' }], genres: [], platforms: [], orderBy: [], languages: [] } });
      return;
    }
    if (path === '/library/catalog') {
      await route.fulfill({ json: { games: catalogGames } });
      return;
    }
    if (path === '/library/apps/2/install') {
      installRequests += 1;
      await route.fulfill({ json: { result: catalogGames[0] } });
      return;
    }
    if (path.startsWith('/library/apps/')) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ json: { game: { id: 2, name: 'Catalog Game details' } } });
      return;
    }
    await route.continue();
  });
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await mockApi(page);

  await page.goto(`${origin}/install`);
  await page.getByText('Catalog Game', { exact: true }).waitFor();
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(viewport.scrollWidth <= viewport.clientWidth, `Install page overflows horizontally: ${viewport.scrollWidth}px > ${viewport.clientWidth}px`);

  await page.getByText('Catalog Game', { exact: true }).click();
  await page.getByText('Catalog details', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  assert.equal(await page.getByText('Catalog details', { exact: true }).count(), 0, 'A completed details request reopened a closed drawer');

  await page.getByLabel('Install Catalog Game').focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  assert.equal(installRequests, 1, 'Keyboard activation did not run the card action');
  assert.equal(await page.getByText('Catalog details', { exact: true }).count(), 0, 'Keyboard activation opened details instead of running the card action');

  await page.setViewportSize({ width: 800, height: 844 });
  assert.equal(await page.getByLabel('Open navigation').isVisible(), true, 'Navigation disappeared at the tablet breakpoint');
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`${origin}/settings`);
  await page.getByRole('dialog', { name: 'Settings' }).waitFor();
  await page.getByText('20 Mbps', { exact: true }).waitFor();
  await page.getByText('70%', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close settings');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached' });
  assert.equal(new URL(page.url()).pathname, '/my-games');
  await page.goBack();
  assert.notEqual(new URL(page.url()).pathname, '/settings', 'Back navigation reopened the closed settings dialog');
  assert.deepEqual(runtimeErrors, []);
  console.log('UI smoke checks passed.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
