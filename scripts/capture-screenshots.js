// Capture the real app without showing or focusing a window. Electron captures
// each WebContentsView separately, so a hidden window lays those captures out at
// their native coordinates. No website text or app controls are replaced.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_SETTINGS } = require('../src/settings');

async function captureWindow(application, filename) {
  const png = await application.evaluate(async ({ BaseWindow, BrowserWindow }) => {
    const source = BaseWindow.getAllWindows()[0];
    const [width, height] = source.getContentSize();
    const layers = [];
    for (const view of source.contentView.children) {
      if (!view.getVisible()) continue;
      layers.push({
        bounds: view.getBounds(),
        image: (await view.webContents.capturePage()).toDataURL(),
      });
    }
    const capture = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    try {
      const images = layers
        .map(
          ({ bounds: b, image }) =>
            `<img src="${image}" style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px">`,
        )
        .join('');
      await capture.loadURL(
        `data:text/html,${encodeURIComponent(`<html><body style="margin:0;overflow:hidden">${images}</body></html>`)}`,
      );
      await capture.webContents.executeJavaScript(
        'Promise.all([...document.images].map(image => image.decode()))',
      );
      return (await capture.webContents.capturePage()).toPNG().toString('base64');
    } finally {
      capture.destroy();
    }
  });
  await fs.writeFile(filename, Buffer.from(png, 'base64'));
}

(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-stack-screenshots-'));
  const output = path.resolve('output/playwright/readme');
  let application;
  try {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, 'settings.json'),
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        enabledEngines: ['bing', 'duckduckgo'],
        theme: 'light',
      }),
    );
    application = await electron.launch({
      args: [path.join(__dirname, '..'), '--background-test', `--user-data-dir=${dataDir}`],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    });
    const page = await application.firstWindow();
    await page.waitForURL('app://search-stack/index.html');
    await application.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()[0].setContentSize(1440, 900),
    );
    await page.locator('#query').fill('OpenStreetMap');
    await page.locator('#query').press('Enter');
    await expect(page.locator('.engine-state[data-status="ready"]')).toHaveCount(2, {
      timeout: 30000,
    });
    await page.locator('#split-toggle').click();
    await expect
      .poll(() =>
        application.evaluate(
          ({ BaseWindow }) =>
            BaseWindow.getAllWindows()[0].contentView.children.filter((view) => view.getVisible())
              .length,
        ),
      )
      .toBe(3);
    // Lazy content and fonts can settle after the document's load event.
    await page.waitForTimeout(3000);
    await captureWindow(application, path.join(output, 'split-day.png'));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.waitForTimeout(1000);
    await captureWindow(application, path.join(output, 'split-night.png'));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('New profile name', { exact: true }).fill('Personal');
    await page.getByRole('button', { name: 'Add profile', exact: true }).click();
    await page.getByLabel('Google: Personal', { exact: true }).check();
    await page.locator('#settings-dialog').evaluate((dialog) => {
      dialog.scrollTop = 0;
    });
    await page.waitForTimeout(250);
    await captureWindow(application, path.join(output, 'settings.png'));
    expect(
      await application.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].isVisible()),
    ).toBe(false);
    console.log(
      `Captured hidden app windows in ${output}. Inspect the images before copying them into docs/screenshots.`,
    );
  } finally {
    if (application) await application.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
