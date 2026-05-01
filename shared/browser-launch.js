import { chromium } from 'playwright';
import os from 'os';
import path from 'path';

export async function launchBrowser({ headless = true, ...rest } = {}) {
  return chromium.launch({ headless, ...rest });
}

// Chrome実プロファイルで起動（セッション引き継ぎ用）
// 注意: Chrome が同プロファイルで起動中の場合は失敗する
export async function launchChromeProfileContext(profileDir) {
  const userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    args: [
      `--profile-directory=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    headless: false,
    viewport: { width: 1280, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
}
