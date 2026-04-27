import { chromium } from 'playwright';

export async function launchBrowser({ headless = true, ...rest } = {}) {
  return chromium.launch({ headless, ...rest });
}
