import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const outputPath = fileURLToPath(new URL('../docs/verification/stream-color/sdr-diagnostics.png', import.meta.url));
const server = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4173'], {
  cwd: projectRoot,
  stdio: 'ignore',
});

for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    if ((await fetch(origin)).ok) break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.localStorage.setItem('stream_stats_visible', 'true');
    window.sessionStorage.setItem('openstroid:lastLaunch', JSON.stringify({
      appId: 1091,
      app: { name: 'Cyberpunk 2077 — SDR diagnostics' },
      sessionId: 'color-verification',
      streamingUrl: 'https://example.invalid',
      gateways: ['gateway.example.invalid'],
      streamClientConfig: {
        homeUrl: 'https://example.invalid',
        sessionId: 'color-verification',
        sessionQueries: ['sessionId=color-verification&token=verification'],
        gateways: ['gateway.example.invalid'],
        accessToken: '',
        authDataToken: '',
      },
      localStorage: {},
      cookies: [],
      startPayload: {},
    }));
  });
  await page.route('wss://gateway.example.invalid/**', (route) => route.abort());
  await page.goto(`${origin}/stream`);
  await page.waitForTimeout(750);
  await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) return;
    video.poster = `data:image/svg+xml,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
        <defs>
          <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#153051"/><stop offset="1" stop-color="#f1623f"/></linearGradient>
          <linearGradient id="road" x2="1"><stop stop-color="#090b13"/><stop offset=".5" stop-color="#25283b"/><stop offset="1" stop-color="#0b0d16"/></linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#sky)"/>
        <circle cx="1210" cy="235" r="145" fill="#ffbe4c" opacity=".92"/>
        <path d="M0 570 L430 320 760 570 1040 360 1600 570V900H0Z" fill="#101522"/>
        <path d="M0 610H1600V900H0Z" fill="url(#road)"/>
        <path d="M625 900L760 610H840L985 900Z" fill="#f4d55f" opacity=".78"/>
        <rect x="55" y="58" width="480" height="170" rx="18" fill="#080a12" opacity=".82" stroke="#45f0df" stroke-width="3"/>
        <text x="90" y="125" fill="#45f0df" font-family="sans-serif" font-size="34" font-weight="700">SDR color pipeline</text>
        <text x="90" y="178" fill="white" font-family="sans-serif" font-size="26">BT.709 · limited range · client HDR off</text>
        <rect x="1160" y="675" width="310" height="100" rx="12" fill="#f32961"/>
        <text x="1210" y="738" fill="white" font-family="sans-serif" font-size="32" font-weight="700">COLOR CHECK</text>
      </svg>`)} `;
  });
  await page.screenshot({ path: outputPath });
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

console.log(outputPath);
