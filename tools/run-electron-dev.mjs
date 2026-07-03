import { spawn } from 'node:child_process';
import electronPath from 'electron';

const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:3000';
const waitTimeoutMs = Number(process.env.ELECTRON_RENDERER_WAIT_TIMEOUT_MS ?? 60000);
const retryDelayMs = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRenderer() {
  const deadline = Date.now() + waitTimeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(rendererUrl);
      if (response.status > 0) {
        return;
      }
    } catch {
      // Vite is still starting.
    }

    await sleep(retryDelayMs);
  }

  throw new Error(`Timed out waiting for renderer at ${rendererUrl}`);
}

function appendNodeOption(currentValue, option) {
  return currentValue?.trim() ? `${currentValue} ${option}` : option;
}

await waitForRenderer();

const child = spawn(electronPath, ['electron/main.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: rendererUrl,
    NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, '--import tsx'),
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
