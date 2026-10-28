import { defineConfig } from '@playwright/test';

// E2E runs against a real Meetfolio server (API + built web app) on a throwaway database.
// By default `npm run test:e2e` starts it via e2e/server.mjs; set E2E_BASE_URL to reuse a running instance.
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8799';
const executablePath = process.env.PW_CHROMIUM || (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);

const launchOptions = {
  executablePath,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions, permissions: ['microphone'], locale: 'zh-CN' },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet-1024', use: { viewport: { width: 1024, height: 768 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: 'node e2e/server.mjs', url: `${baseURL}/api/health`, timeout: 120_000, reuseExistingServer: false },
});
