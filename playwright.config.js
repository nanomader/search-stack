const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  testMatch: '*.e2e.js',
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: 'output/playwright/results',
  use: { trace: 'retain-on-failure' },
});
