const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { downloadArtifact } = require('@electron/get');
const extract = require('extract-zip');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const { version } = require(path.join(electronDir, 'package.json'));
const distPath = path.join(electronDir, 'dist');
const pathFile = path.join(electronDir, 'path.txt');
const platformPath = getPlatformPath();

function getPlatformPath() {
  const platform = process.env.npm_config_platform || process.platform;

  switch (platform) {
    case 'darwin':
    case 'mas':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'win32':
      return 'electron.exe';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}

function isInstalled() {
  try {
    const installedVersion = fs
      .readFileSync(path.join(distPath, 'version'), 'utf-8')
      .replace(/^v/, '');
    const installedPath = fs.readFileSync(pathFile, 'utf-8');
    const executablePath = path.join(distPath, installedPath.trim());

    return (
      installedVersion === version &&
      installedPath.trim() === platformPath &&
      fs.existsSync(executablePath)
    );
  } catch {
    return false;
  }
}

async function extractZip(zipPath, destination) {
  fs.mkdirSync(destination, { recursive: true });

  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'inherit' },
    );
    return;
  }

  await extract(zipPath, { dir: destination });
}

(async () => {
  if (isInstalled()) {
    return;
  }

  fs.rmSync(distPath, { recursive: true, force: true });
  try {
    fs.unlinkSync(pathFile);
  } catch {
    // path.txt may not exist yet.
  }

  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;

  console.log(`Installing Electron ${version} for ${platform}-${arch}`);
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform,
    arch,
    checksums: require(path.join(electronDir, 'checksums.json')),
  });

  await extractZip(zipPath, distPath);
  await fs.promises.writeFile(pathFile, platformPath);

  if (!isInstalled()) {
    throw new Error('Electron binary is missing after install');
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
