const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,
  BaseWindow,
  Menu,
  net,
  protocol,
  session,
  WebContentsView,
  ipcMain,
} = require('electron');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const PROVIDERS = {
  google: {
    label: 'Google',
    searchUrl(query) {
      const url = new URL('https://www.google.com/search');
      url.searchParams.set('q', query);
      return url.toString();
    },
  },
  bing: {
    label: 'Bing',
    searchUrl(query) {
      const url = new URL('https://www.bing.com/search');
      url.searchParams.set('q', query);
      return url.toString();
    },
  },
  yahoo: {
    label: 'Yahoo',
    searchUrl(query) {
      const url = new URL('https://search.yahoo.com/search');
      url.searchParams.set('p', query);
      return url.toString();
    },
  },
  baidu: {
    label: 'Baidu',
    searchUrl(query) {
      const url = new URL('https://www.baidu.com/s');
      url.searchParams.set('wd', query);
      return url.toString();
    },
  },
};

const MAX_PROFILES = 12;
const MAX_ACTIVE_PAGES = 12;
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_SETTINGS = {
  version: 1,
  profiles: [{ id: 'default', name: 'Default' }],
  engineProfiles: Object.fromEntries(Object.keys(PROVIDERS).map((id) => [id, ['default']])),
};

const providerViews = new Map();
const installedProviderSessions = new Set();
let windowRef;
let appView;
let currentViewKeys = new Set();
let currentSearchProviders = [];
let searchGeneration = 0;
let settingsOverlayOpen = false;
let settings = structuredClone(DEFAULT_SETTINGS);

const assetFiles = new Map([
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/renderer.js', 'renderer.js'],
]);

function cloneSettings(value) {
  return structuredClone(value);
}

function validateSettings(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.profiles) || !value.engineProfiles) {
    throw new Error('Settings are invalid.');
  }
  if (value.profiles.length < 1 || value.profiles.length > MAX_PROFILES) {
    throw new Error(`Create between 1 and ${MAX_PROFILES} profiles.`);
  }

  const profiles = [];
  const ids = new Set();
  const names = new Set();
  for (const profile of value.profiles) {
    const id = String(profile?.id || '');
    const name = String(profile?.name || '').trim();
    if (!PROFILE_ID_PATTERN.test(id) || ids.has(id)) throw new Error('Profile identifiers are invalid.');
    if (!name || name.length > 48 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error('Profile names must be 1–48 characters long.');
    }
    const normalizedName = name.toLowerCase();
    if (names.has(normalizedName)) throw new Error('Profile names must be unique.');
    ids.add(id);
    names.add(normalizedName);
    profiles.push({ id, name });
  }
  if (!ids.has('default')) throw new Error('The Default profile must remain available.');

  const engineProfiles = {};
  for (const providerId of Object.keys(PROVIDERS)) {
    const selected = value.engineProfiles[providerId];
    if (!Array.isArray(selected)) throw new Error('Choose profiles for each search engine.');
    const unique = [...new Set(selected.map((id) => String(id)))];
    if (unique.some((id) => !ids.has(id))) throw new Error('A selected profile no longer exists.');
    engineProfiles[providerId] = unique;
  }
  return { version: 1, profiles, engineProfiles };
}

async function loadSettings() {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    const contents = await fs.readFile(settingsPath, 'utf8');
    settings = validateSettings(JSON.parse(contents));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Using default Search Stack settings:', error.message);
    settings = cloneSettings(DEFAULT_SETTINGS);
  }
}

async function persistSettings(nextSettings) {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  const temporaryPath = `${settingsPath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(nextSettings, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, settingsPath);
}

function profileById(profileId) {
  return settings.profiles.find((profile) => profile.id === profileId);
}

function viewKey(providerId, profileId) {
  return `${providerId}:${profileId}`;
}

function partitionFor(providerId, profileId) {
  return `persist:search-${providerId}-${profileId}`;
}

function appAssetPath(url) {
  let pathname;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'app:' || parsed.hostname !== 'search-stack') return null;
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }

  const assetName = assetFiles.get(pathname);
  return assetName ? path.join(__dirname, assetName) : null;
}

function isAppRenderer(sender) {
  return appView && !appView.webContents.isDestroyed() && sender === appView.webContents;
}

function findProviderState(sender) {
  for (const state of providerViews.values()) {
    if (state.view.webContents === sender) return state;
  }
  return null;
}

function isSafeHttpsUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function sendToApp(channel, payload) {
  if (appView && !appView.webContents.isDestroyed()) appView.webContents.send(channel, payload);
}

function sendStatus(state, status, details = {}) {
  if (state.generation !== searchGeneration || !currentViewKeys.has(state.key)) return;
  sendToApp('app:provider-status', {
    providerId: state.providerId,
    profileId: state.profileId,
    viewKey: state.key,
    status,
    ...details,
  });
}

function sendHistoryState(state) {
  if (state.view.webContents.isDestroyed()) return;
  sendToApp('app:history-state', {
    viewKey: state.key,
    canGoBack: state.view.webContents.navigationHistory.canGoBack(),
    canGoForward: state.view.webContents.navigationHistory.canGoForward(),
  });
}

function safeDownloadName(name) {
  const cleaned = String(name || 'download').replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim();
  return (cleaned || 'download').slice(0, 180);
}

function isSafeDownloadUrl(rawUrl) {
  if (isSafeHttpsUrl(rawUrl)) return true;
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'blob:' && isSafeHttpsUrl(url.origin);
  } catch {
    return false;
  }
}

function installProviderSession(providerId, profileId, providerSession) {
  const partition = partitionFor(providerId, profileId);
  if (installedProviderSessions.has(partition)) return;
  installedProviderSessions.add(partition);

  providerSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  providerSession.setPermissionCheckHandler(() => false);
  providerSession.on('will-download', (_event, item, contents) => {
    const state = findProviderState(contents);
    const downloadUrls = item.getURLChain();
    if (!state || !currentViewKeys.has(state.key) || !item.hasUserGesture()
      || !isSafeHttpsUrl(item.getInitiatorOrigin())
      || downloadUrls.length === 0
      || downloadUrls.some((url) => !isSafeDownloadUrl(url))) {
      item.cancel();
      return;
    }

    item.setSaveDialogOptions({
      title: `Save download from ${PROVIDERS[providerId].label}`,
      defaultPath: path.join(app.getPath('downloads'), safeDownloadName(item.getFilename())),
    });
  });
}

function createProviderView(providerId, profileId) {
  const provider = PROVIDERS[providerId];
  const partition = partitionFor(providerId, profileId);
  const providerSession = session.fromPartition(partition);
  installProviderSession(providerId, profileId, providerSession);

  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition,
      preload: path.join(__dirname, 'provider-preload.js'),
    },
  });
  view.setBackgroundColor('#ffffff');
  view.setVisible(false);

  const key = viewKey(providerId, profileId);
  const state = { view, key, providerId, profileId, generation: 0 };
  providerViews.set(key, state);

  view.webContents.on('did-start-loading', () => sendStatus(state, 'loading'));
  view.webContents.on('did-stop-loading', () => sendStatus(state, 'ready'));
  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) sendStatus(state, 'error', { message: errorDescription });
  });
  view.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isSafeHttpsUrl(targetUrl)) event.preventDefault();
  });
  view.webContents.on('will-frame-navigate', (details) => {
    if (!isSafeHttpsUrl(details.url)) details.preventDefault();
  });
  view.webContents.on('will-redirect', (event, targetUrl) => {
    if (!isSafeHttpsUrl(targetUrl)) event.preventDefault();
  });
  view.webContents.on('did-navigate', () => sendHistoryState(state));
  view.webContents.on('did-navigate-in-page', () => sendHistoryState(state));
  view.webContents.on('did-finish-load', () => sendHistoryState(state));
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  windowRef.contentView.addChildView(view);
  return state;
}

function searchTargets(providerIds) {
  const targets = [];
  for (const providerId of providerIds) {
    for (const profileId of settings.engineProfiles[providerId]) {
      const profile = profileById(profileId);
      if (profile) {
        targets.push({
          providerId,
          profileId,
          profileName: profile.name,
          viewKey: viewKey(providerId, profileId),
        });
      }
    }
  }
  return targets;
}

function runSearch(query, providerIds) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery || normalizedQuery.length > 2048) {
    throw new Error('Enter a search up to 2,048 characters long.');
  }
  if (!Array.isArray(providerIds)) throw new Error('Choose at least one search engine.');

  const selected = [...new Set(providerIds.filter((id) => Object.hasOwn(PROVIDERS, id)))];
  if (selected.length === 0) throw new Error('Choose at least one search engine.');
  const targets = searchTargets(selected);
  if (targets.length === 0) throw new Error('Choose at least one profile for a selected search engine in Settings.');
  if (targets.length > MAX_ACTIVE_PAGES) {
    throw new Error(`Choose up to ${MAX_ACTIVE_PAGES} engine and profile combinations per search to keep the app responsive.`);
  }

  searchGeneration += 1;
  currentSearchProviders = selected;
  const thisGeneration = searchGeneration;
  currentViewKeys = new Set(targets.map((target) => target.viewKey));

  for (const key of providerViews.keys()) {
    if (!currentViewKeys.has(key)) destroyProviderView(key);
  }

  for (const target of targets) {
    const state = providerViews.get(target.viewKey) || createProviderView(target.providerId, target.profileId);
    state.generation = thisGeneration;
    state.view.setVisible(true);
    sendStatus(state, 'loading');
    void state.view.webContents.loadURL(PROVIDERS[target.providerId].searchUrl(normalizedQuery)).catch((error) => {
      if (state.generation === thisGeneration && !String(error).includes('ERR_ABORTED')) {
        sendStatus(state, 'error', { message: error.message });
      }
    });
  }

  return { query: normalizedQuery, targets };
}

function syncProviderLayout(rectangles) {
  if (!Array.isArray(rectangles)) return;
  if (settingsOverlayOpen) {
    for (const key of currentViewKeys) providerViews.get(key)?.view.setVisible(false);
    return;
  }
  const [windowWidth, windowHeight] = windowRef.getContentSize();
  const rectByKey = new Map(rectangles.map((rect) => [rect?.viewKey, rect]));

  for (const key of currentViewKeys) {
    const state = providerViews.get(key);
    const rect = rectByKey.get(key);
    if (!state) continue;
    if (!rect) {
      state.view.setVisible(false);
      state.view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
      continue;
    }

    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![x, y, width, height].every(Number.isFinite)) continue;

    const visible = width > 1 && height > 1 && y < windowHeight && y + height > 0;
    state.view.setVisible(visible);
    if (!visible) continue;

    const left = Math.max(0, Math.min(windowWidth, x));
    const top = Math.max(0, Math.min(windowHeight, y));
    const right = Math.max(left + 1, Math.min(windowWidth, x + width));
    const bottom = Math.max(top + 1, Math.min(windowHeight, y + height));
    state.view.setBounds({ x: left, y: top, width: right - left, height: bottom - top });
  }
}

function destroyProviderView(key) {
  const state = providerViews.get(key);
  if (!state) return;
  windowRef?.contentView.removeChildView(state.view);
  providerViews.delete(key);
  currentViewKeys.delete(key);
  if (!state.view.webContents.isDestroyed()) state.view.webContents.destroy();
}

function clearActiveSearchViews() {
  searchGeneration += 1;
  currentSearchProviders = [];
  currentViewKeys.clear();
  for (const key of providerViews.keys()) destroyProviderView(key);
}

function pruneViewsToSettings() {
  const allowedKeys = new Set(searchTargets(currentSearchProviders).map((target) => target.viewKey));
  currentViewKeys = new Set([...currentViewKeys].filter((key) => allowedKeys.has(key)));
  for (const key of providerViews.keys()) {
    if (!allowedKeys.has(key)) destroyProviderView(key);
  }
}

function destroyProfileViews(profileId) {
  for (const [key, state] of providerViews) {
    if (state.profileId === profileId) destroyProviderView(key);
  }
}

async function deleteProfileData(profileId) {
  destroyProfileViews(profileId);
  for (const providerId of Object.keys(PROVIDERS)) {
    const profileSession = session.fromPartition(partitionFor(providerId, profileId));
    await profileSession.clearStorageData();
    await profileSession.clearCache();
  }
}

async function saveSettings(payload) {
  const nextSettings = validateSettings(payload);
  const nextIds = new Set(nextSettings.profiles.map((profile) => profile.id));
  const removedProfiles = settings.profiles.filter((profile) => !nextIds.has(profile.id));

  if (removedProfiles.length) {
    const names = removedProfiles.map((profile) => `“${profile.name}”`).join(', ');
    const { response } = await require('electron').dialog.showMessageBox(windowRef, {
      type: 'warning',
      buttons: ['Keep profile', 'Delete profile and data'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: `Delete ${names}?`,
      detail: 'This permanently removes the profile’s saved sign-ins, cookies, and site data for every search engine.',
    });
    if (response !== 1) return { cancelled: true, settings: cloneSettings(settings) };

    for (const profile of removedProfiles) await deleteProfileData(profile.id);
  }

  await persistSettings(nextSettings);
  settings = nextSettings;
  pruneViewsToSettings();
  return { cancelled: false, settings: cloneSettings(settings) };
}

function installMenu() {
  const focusAccelerator = process.platform === 'darwin' ? 'Command+L' : 'Ctrl+L';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Search Stack',
      submenu: [
        { label: 'Focus search', accelerator: focusAccelerator, click: () => appView?.webContents.send('app:focus-search') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]));
}

function createWindow() {
  windowRef = new BaseWindow({
    width: 1180,
    height: 860,
    minWidth: 760,
    minHeight: 620,
    title: 'Search Stack',
    backgroundColor: '#0b0d10',
  });

  appView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  appView.setBounds({ x: 0, y: 0, width: 1180, height: 860 });
  windowRef.contentView.addChildView(appView);
  installMenu();

  appView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  appView.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const url = new URL(targetUrl);
      if (url.protocol !== 'app:' || url.hostname !== 'search-stack') event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  appView.webContents.on('will-redirect', (event, targetUrl) => {
    try {
      const url = new URL(targetUrl);
      if (url.protocol !== 'app:' || url.hostname !== 'search-stack') event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  appView.webContents.on('did-finish-load', () => {
    const [width, height] = windowRef.getContentSize();
    appView.setBounds({ x: 0, y: 0, width, height });
    sendToApp('app:providers', Object.entries(PROVIDERS).map(([id, provider]) => ({ id, label: provider.label })));
    sendToApp('app:settings', cloneSettings(settings));
  });

  windowRef.on('resize', () => {
    const [width, height] = windowRef.getContentSize();
    appView.setBounds({ x: 0, y: 0, width, height });
    appView.webContents.send('app:layout-changed');
  });
  windowRef.on('closed', () => {
    for (const { view } of providerViews.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    if (appView && !appView.webContents.isDestroyed()) appView.webContents.close();
    providerViews.clear();
    currentViewKeys.clear();
    currentSearchProviders = [];
    windowRef = null;
    appView = null;
    settingsOverlayOpen = false;
  });

  appView.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      console.error(`[app renderer] ${details.message}`);
    }
  });
  void appView.webContents.loadURL('app://search-stack/index.html');
}

app.whenReady().then(async () => {
  await loadSettings();
  protocol.handle('app', (request) => {
    const filePath = appAssetPath(request.url);
    if (!filePath) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!windowRef) createWindow();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

ipcMain.handle('app:search', async (event, payload) => {
  if (!isAppRenderer(event.sender)) throw new Error('Unauthorized app message.');
  return runSearch(payload?.query, payload?.providers);
});
ipcMain.handle('app:clear-search-views', (event) => {
  if (!isAppRenderer(event.sender)) throw new Error('Unauthorized app message.');
  clearActiveSearchViews();
});
ipcMain.handle('app:get-settings', (event) => {
  if (!isAppRenderer(event.sender)) throw new Error('Unauthorized app message.');
  return cloneSettings(settings);
});
ipcMain.handle('app:save-settings', async (event, payload) => {
  if (!isAppRenderer(event.sender)) throw new Error('Unauthorized app message.');
  return saveSettings(payload);
});
ipcMain.handle('app:navigate', (event, payload) => {
  if (!isAppRenderer(event.sender)) throw new Error('Unauthorized app message.');
  const state = providerViews.get(String(payload?.viewKey || ''));
  if (!state || !currentViewKeys.has(state.key) || state.view.webContents.isDestroyed()) return null;

  if (payload.action === 'back' && state.view.webContents.navigationHistory.canGoBack()) {
    state.view.webContents.navigationHistory.goBack();
  } else if (payload.action === 'forward' && state.view.webContents.navigationHistory.canGoForward()) {
    state.view.webContents.navigationHistory.goForward();
  }
  else if (payload.action === 'reload') state.view.webContents.reload();
  else throw new Error('Unsupported navigation action.');

  return {
    canGoBack: state.view.webContents.navigationHistory.canGoBack(),
    canGoForward: state.view.webContents.navigationHistory.canGoForward(),
  };
});
ipcMain.handle('provider:open-link', (event, rawUrl) => {
  const state = findProviderState(event.sender);
  if (!state || !currentViewKeys.has(state.key) || !isSafeHttpsUrl(rawUrl)) return false;
  void state.view.webContents.loadURL(new URL(rawUrl).toString()).catch(() => {});
  return true;
});
ipcMain.on('app:sync-layout', (event, rectangles) => {
  if (isAppRenderer(event.sender)) syncProviderLayout(rectangles);
});
ipcMain.on('app:settings-overlay', (event, isOpen) => {
  if (!isAppRenderer(event.sender)) return;
  settingsOverlayOpen = isOpen === true;
  if (!settingsOverlayOpen) sendToApp('app:layout-changed');
  else {
    for (const key of currentViewKeys) providerViews.get(key)?.view.setVisible(false);
  }
});
ipcMain.on('provider:edge-wheel', (event, deltaY) => {
  const state = findProviderState(event.sender);
  if (!state || !currentViewKeys.has(state.key) || !Number.isFinite(deltaY)) return;
  const boundedDelta = Math.max(-1600, Math.min(1600, deltaY));
  sendToApp('app:scroll-by', boundedDelta);
});
