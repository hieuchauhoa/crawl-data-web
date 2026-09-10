import { accessSync, constants, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

function commandVersion(name, args = ['--version']) {
  const result = spawnSync(name, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || result.stderr || '').trim().split('\n')[0];
}

function ok(label, detail = '') {
  console.log(`[OK]   ${label}${detail ? ` -> ${detail}` : ''}`);
}
function miss(label, detail = '') {
  console.log(`[MISS] ${label}${detail ? ` -> ${detail}` : ''}`);
}
function warn(label, detail = '') {
  console.log(`[WARN] ${label}${detail ? ` -> ${detail}` : ''}`);
}

console.log('=== Crawl Data Web Phase 0 - Environment Check ===');
console.log(`Platform: ${process.platform} ${process.arch}`);

let allCoreOk = true;

const nodeVersion = commandVersion('node', ['-v']);
if (nodeVersion) ok('node', nodeVersion);
else { miss('node'); allCoreOk = false; }

const npmVersion = commandVersion('npm', ['-v']);
if (npmVersion) ok('npm', npmVersion);
else { miss('npm'); allCoreOk = false; }

let mariaName = 'mariadb';
let mariaVersion = commandVersion('mariadb');
if (!mariaVersion) {
  mariaName = 'mysql';
  mariaVersion = commandVersion('mysql');
}
if (mariaVersion) ok(mariaName, mariaVersion);
else { miss('mariadb/mysql', 'install MariaDB client and add it to PATH'); allCoreOk = false; }

const browserCandidates = process.platform === 'linux'
  ? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['chrome', 'chrome.exe'];

let browser = null;
for (const candidate of browserCandidates) {
  if (candidate.startsWith('/')) {
    if (existsSync(candidate)) { browser = candidate; break; }
  } else if (commandVersion(candidate)) {
    browser = candidate;
    break;
  }
}
if (browser) ok('Chrome/Chromium', browser);
else warn('Chrome/Chromium', 'not found on PATH/common paths; browser GUI is required for the MV3 picker');

const envFile = path.join(repo, 'apps', 'server', '.env');
if (existsSync(envFile)) ok('apps/server/.env');
else { miss('apps/server/.env', 'copy apps/server/.env.example to apps/server/.env'); allCoreOk = false; }

const workspace = path.join(repo, 'workspaces');
try {
  if (existsSync(workspace)) accessSync(workspace, constants.W_OK);
  ok('workspace path', workspace);
} catch {
  miss('workspace writable', workspace);
  allCoreOk = false;
}

console.log('');
if (allCoreOk) console.log('Core environment looks ready for Phase 0.');
else console.log('Fix the missing core items above before Phase 0 acceptance testing.');
