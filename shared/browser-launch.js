import { chromium } from 'playwright';
import { spawn, execSync } from 'child_process';
import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');

export async function launchBrowser({ headless = true, ...rest } = {}) {
  return chromium.launch({ headless, ...rest });
}

function findFreePort() {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function waitForPort(port, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      await new Promise((res, rej) => {
        const s = net.connect(port, '127.0.0.1', res);
        s.on('error', rej);
      });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  throw new Error(`Chrome CDP port ${port} not ready after ${timeout}ms`);
}

// Chrome 115+ blocks CDP on the default user data dir.
// Fix: rsync profile to a temp dir, then launch Chrome ourselves
// (bypasses Playwright's --use-mock-keychain so real session cookies work).
export async function launchChromeProfileContext(profileDir) {
  // Include PID in tmpdir so concurrent calls for the same profile don't conflict
  const tmpBase = path.join(os.tmpdir(), `pw-chrome-${profileDir.replace(/\s+/g, '-')}-${process.pid}`);
  const srcProfile = path.join(CHROME_DATA_DIR, profileDir);
  const dstProfile = path.join(tmpBase, profileDir);

  fs.mkdirSync(dstProfile, { recursive: true });
  execSync(`rsync -a --delete --exclude='Cache' --exclude='Cache_Data' --exclude='Code Cache' "${srcProfile}/" "${dstProfile}/"`, { stdio: 'pipe' });

  const localState = path.join(CHROME_DATA_DIR, 'Local State');
  if (fs.existsSync(localState)) {
    fs.copyFileSync(localState, path.join(tmpBase, 'Local State'));
  }

  const port = await findFreePort();
  const chrome = spawn(CHROME_PATH, [
    `--profile-directory=${profileDir}`,
    `--user-data-dir=${tmpBase}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--disable-background-networking',
    '--disable-sync',
  ], { stdio: 'ignore' });

  chrome.on('exit', (code) => {
    if (code !== 0 && code !== null) console.warn('[browser-launch] Chrome exited unexpectedly (code', code + ')');
  });

  await waitForPort(port, 60_000);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  } catch (err) {
    chrome.kill();
    throw err;
  }
  const contexts = browser.contexts();
  const context = contexts[0] ?? await browser.newContext();

  const _close = context.close.bind(context);
  context.close = async () => {
    await _close().catch(() => {});
    chrome.kill();
  };

  return context;
}
