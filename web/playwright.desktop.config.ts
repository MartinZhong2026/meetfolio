import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'desktop-e2e',
  timeout: 45000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results-desktop',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    locale: 'zh-CN',
    launchOptions: { executablePath: process.env.PW_CHROMIUM },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'laptop-1366', use: { viewport: { width: 1366, height: 768 } } },
    { name: 'desktop-1920', use: { viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: {
    command: 'npm run desktop',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
});
