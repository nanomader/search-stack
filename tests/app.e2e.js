const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_SETTINGS } = require('../src/settings');
let application, page, dataDir;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
async function launch() {
  application = await electron.launch({ args: [path.join(__dirname, '..'), '--background-test', `--user-data-dir=${dataDir}`], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  page = await application.firstWindow();
  expect(await application.evaluate(({BaseWindow}) => BaseWindow.getAllWindows()[0].isVisible())).toBe(false);
  await page.waitForURL('app://search-stack/index.html');
  await expect(page.locator('.engine-option').first()).toBeVisible();
}
async function providerIds() {
  return application.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'window' && w.getURL().startsWith('https:')).sort((a,b) => a.id-b.id).map(w => w.id));
}
async function fixtureSessions() {
  // Real native WebContentsViews, sandbox, IPC and session storage; deterministic
  // HTTPS responses replace only the external servers, never application code.
  const configuration = await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8').then(JSON.parse).catch(() => DEFAULT_SETTINGS);
  await application.evaluate(({ session }, configuration) => {
    for (const engine of Object.keys(configuration.engineProfiles)) {
      for (const {id: profile} of configuration.profiles) {
        const ses = session.fromPartition(`persist:search-${engine}-${profile}`);
        ses.protocol.handle('https', request => {
          const u = new URL(request.url);
          if (u.pathname === '/fail') return Response.error();
          if (u.pathname === '/hang') return new Promise(() => {});
          return new Response(`<!doctype html><html><head><title>${u.hostname}</title></head><body style="height:4000px;background:#fff;color:#222"><h1>${u.hostname}</h1><p id="query"></p><input id="site-input" aria-label="Site input"><a href="https://${u.hostname}/result" target="_blank">Open result</a><a href="http://unsafe.invalid/">Unsafe link</a><a href="javascript:void(0)" onclick="document.body.dataset.menuOpened='yes'">Open site menu</a><script>document.getElementById('query').textContent = new URL(location.href).search;</script></body></html>`, { headers: { 'content-type': 'text/html' } });
        });
      }
    }
  }, configuration);
}
async function search(query = 'independent search') {
  await page.getByRole('searchbox', { name:'Search query' }).fill(query);
  await page.getByRole('searchbox', { name:'Search query' }).press('Enter');
  await expect(page.locator('.scan-tab')).toHaveCount(4);
  await expect(page.locator('.engine-state[data-status="ready"]')).toHaveCount(4);
}
async function nativeInput(id, key, modifiers = []) {
  await application.evaluate(({webContents}, {id,key,modifiers}) => {
    const wc = webContents.fromId(id); wc.focus();
    wc.sendInputEvent({type:'keyDown',keyCode:key,modifiers});
    wc.sendInputEvent({type:'keyUp',keyCode:key,modifiers});
  }, {id,key,modifiers});
}
test.beforeEach(async () => { dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-stack-e2e-')); await launch(); });
test.afterEach(async () => { if(application) await application.close(); await fs.rm(dataDir, {recursive:true,force:true}); });
test('full app: compact views, switching, native shortcuts, history, themes and resize', async () => {
  await fixtureSessions(); await search('猫 & coffee');
  const ids = await providerIds(); expect(ids).toHaveLength(4);
  const chrome = await page.locator('.engine-section:not([hidden]) .provider-slot').boundingBox();
  expect(chrome.y).toBe(130); expect(chrome.width).toBe(await page.evaluate(() => innerWidth));
  await application.evaluate(({webContents}, id) => webContents.fromId(id).executeJavaScript('window.scrollTo(0,500)'), ids[0]);
  await page.getByRole('button', {name:'Next search page',exact:true}).click();
  await expect(page.locator('.scan-tab.is-active')).toContainText('Bing');
  await page.getByRole('button', {name:'Google, Default profile',exact:true}).click();
  expect(await application.evaluate(({webContents}, id) => webContents.fromId(id).executeJavaScript('scrollY'), ids[0])).toBe(500);
  await nativeInput(ids[0], 'l', [process.platform === 'darwin' ? 'meta' : 'control']);
  await expect(page.locator('#query')).toBeFocused();
  await nativeInput(ids[0], 'Tab', ['control']);
  await expect(page.locator('.scan-tab.is-active')).toContainText('Bing');
  await nativeInput(ids[1], '1', [process.platform === 'darwin' ? 'meta' : 'control']);
  await expect(page.locator('.scan-tab.is-active')).toContainText('Google');
  const google = application.windows().find(p => p.url().includes('google.com'));
  await google.getByRole('link', {name:'Open result',exact:true}).click();
  await expect(google).toHaveURL('https://www.google.com/result');
  await page.locator('.engine-section:not([hidden])').getByRole('button',{name:'Back',exact:true}).click();
  await expect(google).toHaveURL(/\/search\?/);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  expect(await application.evaluate(({BaseWindow}) => BaseWindow.getAllWindows()[0].contentView.children.slice(1).every(v => !v.getVisible()))).toBe(true);
  await page.getByLabel('Theme', {exact:true}).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  expect(await providerIds()).toEqual(ids);
  await page.screenshot({path:'output/playwright/night.png'});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByLabel('Theme', {exact:true}).selectOption('light');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.screenshot({path:'output/playwright/day.png'});
  await page.locator('#scan-mode-toggle').click();
  await expect(page.locator('.engine-section:visible')).toHaveCount(4);
  await page.locator('#scan-mode-toggle').click();
  await application.evaluate(({BaseWindow}) => BaseWindow.getAllWindows()[0].setContentSize(680,480));
  await expect.poll(async () => (await page.locator('.engine-section:not([hidden]) .provider-slot').boundingBox()).height).toBe(350);
  await page.screenshot({path:'output/playwright/compact.png'});
});
test('full app: failed load, stopped load and crashed renderer recover independently', async () => {
  await fixtureSessions(); await search(); const ids = await providerIds();
  await application.evaluate(({webContents}, id) => { void webContents.fromId(id).loadURL('https://www.google.com/fail').catch(()=>{}); }, ids[0]);
  await expect(page.locator('.engine-section').first().locator('.engine-state')).toHaveAttribute('data-status','error');
  await page.getByRole('button',{name:'Next search page',exact:true}).click();
  await expect(page.locator('.scan-tab.is-active')).toContainText('Bing');
  await application.evaluate(({webContents}, id) => { void webContents.fromId(id).loadURL('https://www.bing.com/hang').catch(()=>{}); }, ids[1]);
  await expect(page.locator('.engine-section').nth(1).locator('.engine-state')).toHaveAttribute('data-status','loading');
  await page.locator('.engine-section:not([hidden])').getByRole('button',{name:'Stop loading',exact:true}).click();
  await expect(page.locator('.engine-section').nth(1).locator('.engine-state')).toHaveAttribute('data-status','stopped');
  await application.evaluate(({webContents}, id) => webContents.fromId(id).forcefullyCrashRenderer(), ids[2]);
  await page.getByRole('button',{name:'Yahoo, Default profile',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry page',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Retry page',exact:true}).click();
  await expect(page.locator('.engine-section').nth(2).locator('.engine-state')).toHaveAttribute('data-status','ready');
  await expect(page.locator('.engine-section').first().locator('.engine-state')).toHaveAttribute('data-status','error');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
});
test('full app: custom engines, duplicate Google profiles, isolated persistent cookies and settings', async () => {
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByLabel('New profile name',{exact:true}).fill('Personal');
  await page.getByRole('button',{name:'Add profile',exact:true}).click();
  await page.getByLabel('Google: Personal',{exact:true}).check();
  await page.getByLabel('Name',{exact:true}).fill('Reference');
  await page.getByLabel('Search URL',{exact:true}).fill('https://example.com/search?q={query}');
  await page.getByRole('button',{name:'Add engine',exact:true}).click();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  const settings = JSON.parse(await fs.readFile(path.join(dataDir,'settings.json'),'utf8'));
  await fixtureSessions();
  await page.locator('#query').fill('cats & dogs'); await page.locator('#query').press('Enter');
  await expect(page.locator('.scan-tab')).toHaveCount(6);
  await expect(page.locator('.engine-state[data-status="ready"]')).toHaveCount(6);
  await expect(page.getByRole('button',{name:'Google, Personal profile',exact:true})).toBeVisible();
  const customPage = application.windows().find(p => p.url().startsWith('https://example.com/'));
  expect(new URL(customPage.url()).searchParams.get('q')).toBe('cats & dogs');
  const personal = settings.profiles.find(p=>p.name==='Personal').id;
  const ids = await providerIds();
  await page.locator('#split-toggle').click();
  await page.getByLabel('Right search page',{exact:true}).selectOption(`google:${personal}`);
  await expect(page.getByLabel('Left search page',{exact:true})).toHaveValue('google:default');
  await expect.poll(async () => (await visibleNativeViews()).map(view=>view.id)).toEqual(ids.slice(0,2));
  expect(await application.evaluate(async ({webContents},ids) => Promise.all(ids.slice(0,2).map(id=>webContents.fromId(id).executeJavaScript('location.hostname'))),ids)).toEqual(['www.google.com','www.google.com']);
  await application.evaluate(async ({session}, personal) => {
    const regular = session.fromPartition('persist:search-google-default');
    const other = session.fromPartition(`persist:search-google-${personal}`);
    await regular.cookies.set({url:'https://www.google.com',name:'session-test',value:'signed-in-fixture',expirationDate:Date.now()/1000+86400});
    await other.cookies.set({url:'https://www.google.com',name:'session-test',value:'separate-fixture',expirationDate:Date.now()/1000+86400});
    await regular.flushStorageData(); await other.flushStorageData();
  },personal);
  await application.close(); await launch();
  await expect(page.locator('.engine-option')).toHaveCount(7);
  const values = await application.evaluate(async ({session}, personal) => {
    const a = await session.fromPartition('persist:search-google-default').cookies.get({name:'session-test'});
    const b = await session.fromPartition(`persist:search-google-${personal}`).cookies.get({name:'session-test'});
    return [a[0]?.value,b[0]?.value];
  }, personal);
  expect(values).toEqual(['signed-in-fixture','separate-fixture']);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByLabel('Google: Personal',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Enable Reference',{exact:true})).toBeChecked();
  // Simulate the native confirmation answer, retaining real deletion/storage code.
  await application.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response:0}); });
  await page.getByRole('button',{name:'Remove Personal profile',exact:true}).click();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await expect(page.locator('#settings-notice')).toHaveText('No changes saved.');
  await expect(page.getByLabel('Google: Personal',{exact:true})).toBeChecked();
  await application.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response:1}); });
  await page.getByRole('button',{name:'Remove Personal profile',exact:true}).click();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  const remaining = await application.evaluate(async ({session},personal) => [
    (await session.fromPartition('persist:search-google-default').cookies.get({name:'session-test'})).length,
    (await session.fromPartition(`persist:search-google-${personal}`).cookies.get({name:'session-test'})).length,
  ],personal);
  expect(remaining).toEqual([1,0]);

});

test('full app: a frozen website cannot freeze the app controls or other engines', async () => {
  await fixtureSessions(); await search(); const ids = await providerIds();
  // Do not await the intentionally endless work in the remote renderer.
  await application.evaluate(({webContents}, id) => { void webContents.fromId(id).executeJavaScript('while (true) {}').catch(()=>{}); }, ids[0]);
  await page.getByRole('button',{name:'Next search page',exact:true}).click({timeout:3000});
  await expect(page.locator('.scan-tab.is-active')).toContainText('Bing');
  await page.getByRole('button',{name:'Settings',exact:true}).click({timeout:3000});
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  // Keep the frozen page visible so the app event-loop watchdog checks it.
  await page.getByRole('button',{name:'Google, Default profile',exact:true}).click();
  await nativeInput(ids[0], 'a');
  await expect(page.locator('.engine-section').first().locator('.engine-state')).toHaveAttribute('data-status','unresponsive',{timeout:25000});
  await page.getByRole('button',{name:'Google, Default profile',exact:true}).click();
  await page.getByRole('button',{name:'Retry page',exact:true}).click();
  await expect(page.locator('.engine-section').first().locator('.engine-state')).toHaveAttribute('data-status','ready');
});
test('full app: remote pages have no app bridge and unsafe navigation stays blocked', async () => {
  await fixtureSessions(); await search(); const ids = await providerIds();
  expect(await application.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript('[typeof require, typeof process, typeof searchStack]'),ids[0])).toEqual(['undefined','undefined','undefined']);
  const google = application.windows().find(p=>p.url().includes('google.com'));
  await google.getByRole('link',{name:'Open site menu',exact:true}).click();
  await expect(google.locator('body')).toHaveAttribute('data-menu-opened','yes');
  await google.getByRole('link',{name:'Unsafe link',exact:true}).click({noWaitAfter:true});
  // Chromium keeps the old document when Electron cancels this navigation;
  // CDP's Page URL can temporarily be empty, so assert the native document.
  expect(await application.evaluate(({webContents},id) => webContents.fromId(id).executeJavaScript('location.href'),ids[0])).toMatch(/https:\/\/www.google.com\/search/);
  await application.evaluate(({webContents},id) => webContents.fromId(id).executeJavaScript('window.open("https://example.com/popup"); undefined'),ids[0]);
  expect((await providerIds()).length).toBe(4);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  for (const engine of ['Google','Bing','Yahoo','Baidu']) await page.getByLabel(`Enable ${engine}`,{exact:true}).uncheck();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await expect(page.locator('.engine-section')).toHaveCount(0);
  await expect.poll(async () => (await providerIds()).length).toBe(0);
});

async function visibleNativeViews() {
  return application.evaluate(({BaseWindow}) => BaseWindow.getAllWindows()[0].contentView.children.slice(1)
    .filter(view => view.getVisible()).map(view => ({id:view.webContents.id,...view.getBounds()})).sort((a,b)=>a.x-b.x));
}
async function expectPair(left, right) {
  await expect(page.getByLabel('Left search page',{exact:true})).toHaveValue(left);
  await expect(page.getByLabel('Right search page',{exact:true})).toHaveValue(right);
  const ids = await application.evaluate(({BaseWindow}) => BaseWindow.getAllWindows()[0].contentView.children.slice(1)
    .filter(view=>view.webContents.getURL().startsWith('https:')).map(view=>({id:view.webContents.id,host:new URL(view.webContents.getURL()).hostname})));
  const host = {google:'www.google.com',bing:'www.bing.com',yahoo:'search.yahoo.com',baidu:'www.baidu.com'};
  await expect.poll(async () => (await visibleNativeViews()).map(view=>view.id)).toEqual([
    ids.find(view=>view.host===host[left.split(':')[0]]).id,
    ids.find(view=>view.host===host[right.split(':')[0]]).id,
  ]);
}
test('split: independent native panes, choice, swap, shortcuts, geometry and modal visibility', async () => {
  await fixtureSessions(); await search();
  const ids = await providerIds();
  await application.evaluate(async ({webContents},ids) => {
    await webContents.fromId(ids[0]).executeJavaScript('window.scrollTo(0,420); window.preserved = "left"');
    await webContents.fromId(ids[1]).executeJavaScript('window.scrollTo(0,730); window.preserved = "right"');
  },ids);
  await page.getByRole('button',{name:'◫ Split',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-presentation','split');
  await expectPair('google:default','bing:default');
  const panes = await visibleNativeViews();
  expect(panes[0].x).toBe(0); expect(panes[0].y).toBe(130);
  expect(panes[1].x).toBeGreaterThanOrEqual(panes[0].width);
  expect(panes[0].height).toBe(panes[1].height);
  expect(panes[1].x + panes[1].width).toBe(await page.evaluate(()=>innerWidth));
  expect(await application.evaluate(async ({webContents},ids) => Promise.all(ids.slice(0,2).map(id=>webContents.fromId(id).executeJavaScript('[scrollY,window.preserved]'))),ids)).toEqual([[420,'left'],[730,'right']]);
  await page.getByLabel('Right search page',{exact:true}).selectOption('yahoo:default');
  await expectPair('google:default','yahoo:default');
  await page.getByLabel('Left search page',{exact:true}).selectOption('yahoo:default');
  await expectPair('yahoo:default','google:default');
  await page.getByRole('button',{name:'Swap comparison sides',exact:true}).click();
  await expectPair('google:default','yahoo:default');
  await nativeInput(ids[2], '2', [process.platform === 'darwin' ? 'meta' : 'control']);
  await expectPair('google:default','bing:default');
  // Left stays unchanged when the right site's focused shortcut switches engines.
  await expect(page.locator('#right-choice')).toHaveClass(/is-active/);
  expect(await providerIds()).toEqual(ids);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect.poll(visibleNativeViews).toEqual([]);
  await page.getByLabel('Theme',{exact:true}).selectOption('dark');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await expectPair('google:default','bing:default');
  await page.screenshot({path:'output/playwright/split-night.png'});
  await application.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setContentSize(680,480));
  await expect.poll(async ()=>(await visibleNativeViews()).map(({height})=>height)).toEqual([350,350]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'output/playwright/split-compact.png'});
  await page.getByRole('button',{name:'⛶ Single',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-presentation','focus');
  await expect(page.locator('.engine-section:visible')).toHaveAttribute('data-view-key','bing:default');
  expect(await providerIds()).toEqual(ids);
});
test('split: saved pair survives searches and restart, repairs removed choices, and recovers one side', async () => {
  await fixtureSessions(); await search();
  await page.locator('#split-toggle').click();
  await page.getByLabel('Left search page',{exact:true}).selectOption('baidu:default');
  await page.getByLabel('Right search page',{exact:true}).selectOption('yahoo:default');
  await search('second query');
  await expectPair('baidu:default','yahoo:default');
  // Await persisted preference through the app before restarting its process.
  await expect.poll(async()=> (await page.evaluate(()=>window.searchStack.getSettings())).splitPages).toEqual(['baidu:default','yahoo:default']);
  await application.close(); await launch();
  await fixtureSessions(); await search('after restart');
  await expectPair('baidu:default','yahoo:default');
  const ids=await providerIds();
  await application.evaluate(({webContents},id)=>webContents.fromId(id).forcefullyCrashRenderer(),ids[2]);
  const right=page.locator('.engine-section[data-pane="right"]:visible');
  await expect(right.getByRole('button',{name:'Retry page',exact:true})).toBeVisible();
  await right.getByRole('button',{name:'Retry page',exact:true}).click();
  await expect(right.locator('.engine-state')).toHaveAttribute('data-status','ready');
  await expectPair('baidu:default','yahoo:default');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByLabel('Enable Baidu',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await expectPair('google:default','yahoo:default');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByLabel('Enable Yahoo',{exact:true}).uncheck();
  await page.getByLabel('Enable Bing',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-presentation','focus');
  await expect(page.locator('#split-toggle')).toBeDisabled();
  await expect.poll(async()=> (await visibleNativeViews()).length).toBe(1);
});
