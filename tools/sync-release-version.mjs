import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(import.meta.dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');

function normalizeVersion(version) {
  const raw = version?.trim();
  if (!raw) {
    throw new Error('Release version is required as an argument or RELEASE_VERSION environment variable.');
  }

  const normalized = raw.startsWith('v') ? raw.slice(1) : raw;
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid semver version: ${raw}`);
  }

  return normalized;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function collectMismatches(version, packageJson, packageLock) {
  const mismatches = [];
  if (packageJson.version !== version) {
    mismatches.push(`package.json has ${packageJson.version}`);
  }

  if (packageLock.version !== version) {
    mismatches.push(`package-lock.json has ${packageLock.version}`);
  }

  const rootPackage = packageLock.packages?.[''];
  if (rootPackage?.version !== version) {
    mismatches.push(`package-lock root package has ${rootPackage?.version ?? 'no version'}`);
  }

  return mismatches;
}

function syncVersion(version) {
  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);

  packageJson.version = version;
  packageLock.version = version;
  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = version;
  }

  writeJson(packageJsonPath, packageJson);
  writeJson(packageLockPath, packageLock);
}

function checkVersion(version) {
  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);
  const mismatches = collectMismatches(version, packageJson, packageLock);

  if (mismatches.length > 0) {
    throw new Error(`Committed package versions do not match release version ${version}: ${mismatches.join('; ')}.`);
  }
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const versionArg = args.find((arg) => arg !== '--check');
const version = normalizeVersion(versionArg ?? process.env.RELEASE_VERSION);

if (checkOnly) {
  checkVersion(version);
} else {
  syncVersion(version);
}

console.log(`${checkOnly ? 'Validated' : 'Synced'} OpenStroid release version ${version}.`);
