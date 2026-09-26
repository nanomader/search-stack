// Opt-in network test: records real website outcomes without treating a consent
// or anti-bot page as search results. Never signs in or accepts consent.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_SETTINGS } = require('../src/settings');
(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-stack-live-'));
  let app;
  try {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.enabledEngines.push('duckduckgo', 'yandex');
    await fs.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify(settings));
    app = await electron.launch({
      args: [path.join(__dirname, '..'), '--background-test', `--user-data-dir=${dataDir}`],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    });
    const page = await app.firstWindow();
    await page.waitForURL('app://search-stack/index.html');
    await page.locator('#query').fill('Electron WebContentsView documentation');
    const start = Date.now();
    await page.locator('#query').press('Enter');
    await expect(page.locator('.scan-tab')).toHaveCount(6);
    await expect
      .poll(async () => page.locator('.engine-state[data-status="loading"]').count(), {
        timeout: 30000,
      })
      .toBe(0);
    const nativeIds = await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()[0]
        .contentView.children.slice(1)
        .map((v) => v.webContents.id),
    );
    const outcomes = [];
    for (let i = 0; i < 6; i++) {
      const switchStart = Date.now();
      await page.locator('.scan-tab').nth(i).click();
      await expect(page.locator('.engine-section:not([hidden])')).toHaveAttribute(
        'data-view-key',
        `${settings.enabledEngines[i]}:default`,
      );
      await expect
        .poll(() =>
          app.evaluate(({ BaseWindow }) =>
            BaseWindow.getAllWindows()[0]
              .contentView.children.slice(1)
              .filter((v) => v.getVisible())
              .map((v) => v.webContents.id),
          ),
        )
        .toEqual([nativeIds[i]]);
      const switchMs = Date.now() - switchStart;
      const panel = page.locator('.engine-section').nth(i);
      const key = await panel.getAttribute('data-view-key');
      const id = nativeIds[i];
      const detail = id
        ? await app.evaluate(async ({ webContents }, id) => {
            const wc = webContents.fromId(id);
            const text = await Promise.race([
              wc.executeJavaScript('document.body.innerText.slice(0,6000)'),
              new Promise((resolve) => setTimeout(() => resolve('[text unavailable]'), 3000)),
            ]);
            return { url: wc.getURL(), title: wc.getTitle(), text };
          }, id)
        : {};
      const status = await panel.locator('.engine-state').getAttribute('data-status');
      outcomes.push({ key, status, switchMs, ...detail });
      if (id) {
        const image = await app.evaluate(
          async ({ webContents }, id) => (await webContents.fromId(id).capturePage()).toDataURL(),
          id,
        );
        await fs.mkdir('output/playwright/live', { recursive: true });
        await fs.writeFile(
          `output/playwright/live/${settings.enabledEngines[i]}.png`,
          Buffer.from(image.split(',')[1], 'base64'),
        );
      }
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await page.screenshot({ path: 'output/playwright/live/settings.png' });
    const report = {
      date: new Date().toISOString(),
      platform: process.platform,
      elapsedMs: Date.now() - start,
      outcomes,
    };
    await fs.writeFile('output/playwright/live/report.json', JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          ...report,
          outcomes: outcomes.map(({ text, ...rest }) => ({
            ...rest,
            excerpt: text?.slice(0, 200),
          })),
        },
        null,
        2,
      ),
    );
    if (process.env.SEARCH_STACK_PREVIEW === '1') {
      await page.getByLabel('Theme', { exact: true }).selectOption('light');
      await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.locator('.scan-tab').first().click();
      console.log('Preview ready; terminate this process to close the isolated preview.');
      await new Promise((resolve) => process.once('SIGINT', resolve));
    }
  } finally {
    if (app) await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
