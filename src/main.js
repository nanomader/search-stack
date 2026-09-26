const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,
  BaseWindow,
  Menu,
  net,
  nativeTheme,
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

const {
  DEFAULT_SETTINGS,
  MAX_ACTIVE_PAGES,
  validateSettings,
  enginesFor,
  searchUrl,
  isSafeHttpsUrl,
} = require('./settings');
let PROVIDERS = {};
function refreshProviders() {
  PROVIDERS = Object.fromEntries(enginesFor(settings).map((e) => [e.id, e]));
}

const backgroundTest = app.commandLine.hasSwitch('background-test');
const providerViews = new Map();
const installedProviderSessions = new Set();
let windowRef;
let appView;
let currentViewKeys = new Set();
let currentSearchProviders = [];
let searchGeneration = 0;
let settingsOverlayOpen = false;
let activeViewKey = '';
let settingsQueue = Promise.resolve();
function queueSettings(operation) {
  const result = settingsQueue.then(operation);
  settingsQueue = result.catch(() => {});
  return result;
}
let settings = structuredClone(DEFAULT_SETTINGS);

const assetFiles = new Map([
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/renderer.js', 'renderer.js'],
  ['/icon.png', 'icon.png'],
]);

async function loadSettings() {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    const contents = await fs.readFile(settingsPath, 'utf8');
    settings = validateSettings(JSON.parse(contents));
  } catch (error) {
    if (error.code !== 'ENOENT')
      console.warn('Using default Search Stack settings:', error.message);
    settings = structuredClone(DEFAULT_SETTINGS);
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

function sendToApp(channel, payload) {
  if (appView && !appView.webContents.isDestroyed()) appView.webContents.send(channel, payload);
}

function sendStatus(state, status, details = {}) {
  state.status = status;
  if (['ready', 'error', 'crashed', 'stopped', 'unresponsive'].includes(status))
    clearTimeout(state.loadTimer);
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
    url: state.view.webContents.getURL(),
    canGoBack: state.view.webContents.navigationHistory.canGoBack(),
    canGoForward: state.view.webContents.navigationHistory.canGoForward(),
  });
}

function safeDownloadName(name) {
  const cleaned = String(name || 'download')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .trim();
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

  providerSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  providerSession.setPermissionCheckHandler(() => false);
  providerSession.on('will-download', (_event, item, contents) => {
    const state = findProviderState(contents);
    const downloadUrls = item.getURLChain();
    if (
      !state ||
      !currentViewKeys.has(state.key) ||
      !item.hasUserGesture() ||
      !isSafeHttpsUrl(item.getInitiatorOrigin()) ||
      downloadUrls.length === 0 ||
      downloadUrls.some((url) => !isSafeDownloadUrl(url))
    ) {
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
  const state = {
    view,
    key,
    providerId,
    profileId,
    generation: 0,
    status: 'loading',
    lastUrl: '',
    loadTimer: null,
  };
  providerViews.set(key, state);
  // Electron's native 'unresponsive' event is not reliable for every composed
  // view. A ping to the isolated preload checks the visible page's event loop.
  state.healthTimer = setInterval(() => {
    if (view.webContents.isDestroyed()) return;
    if (
      !view.getVisible() ||
      settingsOverlayOpen ||
      windowRef?.isMinimized() ||
      !state.documentReady
    ) {
      state.pingSentAt = 0;
      return;
    }
    if (state.pingSentAt) {
      if (Date.now() - state.pingSentAt > 8000) {
        sendStatus(state, 'unresponsive', {
          message: 'Page is not responding. Reload to recover.',
        });
      }
      return;
    }
    state.pingSentAt = Date.now();
    view.webContents.send('provider:ping');
  }, 2000);
  state.healthTimer.unref();

  view.webContents.on('did-start-navigation', (_event, url, inPlace, isMainFrame) => {
    if (!isMainFrame || inPlace) return;
    state.lastUrl = url;
    state.documentReady = false;
    state.pingSentAt = 0;
    clearTimeout(state.loadTimer);
    sendStatus(state, 'loading');
    state.loadTimer = setTimeout(() => {
      if (state.status === 'loading')
        sendStatus(state, 'slow', { message: 'Taking longer than expected' });
    }, 15000);
  });
  view.webContents.on('dom-ready', () => {
    state.documentReady = true;
    state.pingSentAt = 0;
  });
  view.webContents.on('did-stop-loading', () => {
    if (['loading', 'slow'].includes(state.status)) sendStatus(state, 'ready');
  });
  view.webContents.on('unresponsive', () =>
    sendStatus(state, 'unresponsive', { message: 'Page is not responding. Reload to recover.' }),
  );
  view.webContents.on('responsive', () => {
    if (state.status === 'unresponsive') sendStatus(state, 'ready');
  });
  view.webContents.on('render-process-gone', (_event, details) => {
    view.setVisible(false);
    sendStatus(state, 'crashed', {
      message: `Page stopped (${details.reason}). Reload to recover.`,
    });
  });
  installShortcuts(view.webContents);
  view.webContents.on('focus', () => {
    if (!currentViewKeys.has(key) || !view.getVisible() || settingsOverlayOpen) return;
    activeViewKey = key;
    sendToApp('app:page-focused', key);
  });
  view.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3)
        sendStatus(state, 'error', { message: errorDescription });
    },
  );
  view.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isSafeHttpsUrl(targetUrl)) event.preventDefault();
  });
  view.webContents.on('will-frame-navigate', (details) => {
    if (!isSafeHttpsUrl(details.url)) details.preventDefault();
  });
  view.webContents.on('will-redirect', (event, targetUrl) => {
    if (!isSafeHttpsUrl(targetUrl)) event.preventDefault();
  });
  view.webContents.on('did-navigate', () => {
    state.lastUrl = view.webContents.getURL();
    sendHistoryState(state);
  });
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
  if (targets.length === 0)
    throw new Error('Choose at least one profile for a selected search engine in Settings.');
  if (targets.length > MAX_ACTIVE_PAGES) {
    throw new Error(
      `Choose up to ${MAX_ACTIVE_PAGES} engine and profile combinations per search to keep the app responsive.`,
    );
  }

  searchGeneration += 1;
  currentSearchProviders = selected;
  const thisGeneration = searchGeneration;
  currentViewKeys = new Set(targets.map((target) => target.viewKey));

  for (const key of providerViews.keys()) {
    if (!currentViewKeys.has(key)) destroyProviderView(key);
  }

  for (const target of targets) {
    const previous = providerViews.get(target.viewKey);
    if (previous && ['crashed', 'unresponsive', 'slow'].includes(previous.status)) {
      destroyProviderView(target.viewKey);
      currentViewKeys.add(target.viewKey);
    }
    const state =
      providerViews.get(target.viewKey) || createProviderView(target.providerId, target.profileId);
    state.generation = thisGeneration;
    state.view.setVisible(false);
    sendStatus(state, 'loading');
    void state.view.webContents
      .loadURL(searchUrl(PROVIDERS[target.providerId], normalizedQuery))
      .catch((error) => {
        if (state.generation === thisGeneration && !String(error).includes('ERR_ABORTED')) {
          sendStatus(state, 'error', { message: error.message });
        }
      });
  }

  return { query: normalizedQuery, targets };
}

function hideProviderViews() {
  for (const key of currentViewKeys) providerViews.get(key)?.view.setVisible(false);
}

function syncProviderLayout(rectangles) {
  if (!Array.isArray(rectangles)) return;
  if (settingsOverlayOpen) {
    hideProviderViews();
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

    const visible =
      !['error', 'crashed', 'unresponsive'].includes(state.status) &&
      width > 1 &&
      height > 1 &&
      y < windowHeight &&
      y + height > 0;
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
  clearTimeout(state.loadTimer);
  clearInterval(state.healthTimer);
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
  const allowedKeys = new Set(
    searchTargets(currentSearchProviders.filter((id) => PROVIDERS[id])).map(
      (target) => target.viewKey,
    ),
  );
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

async function clearSessionData(providerId, profileId) {
  const providerSession = session.fromPartition(partitionFor(providerId, profileId));
  await providerSession.clearStorageData();
  await providerSession.clearCache();
}

async function deleteProfileData(profileId) {
  destroyProfileViews(profileId);
  for (const providerId of Object.keys(PROVIDERS)) {
    await clearSessionData(providerId, profileId);
  }
}

async function saveSettings(payload) {
  const nextSettings = validateSettings(payload);
  const nextIds = new Set(nextSettings.profiles.map((profile) => profile.id));
  const removedProfiles = settings.profiles.filter((profile) => !nextIds.has(profile.id));
  const removedEngines = settings.customEngines.filter(
    (engine) => !nextSettings.customEngines.some((next) => next.id === engine.id),
  );

  if (removedProfiles.length || removedEngines.length) {
    const names = [
      ...removedProfiles.map((p) => `profile “${p.name}”`),
      ...removedEngines.map((e) => `engine “${e.label}”`),
    ].join(', ');
    const { response } = await require('electron').dialog.showMessageBox(windowRef, {
      type: 'warning',
      buttons: ['Cancel', 'Delete and clear data'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: `Delete ${names}?`,
      detail:
        'This permanently clears saved sign-ins, cookies, and site data belonging to the removed profiles or engines.',
    });
    if (response !== 1) return { cancelled: true, settings: structuredClone(settings) };

    for (const profile of removedProfiles) await deleteProfileData(profile.id);
    for (const engine of removedEngines) {
      for (const profile of settings.profiles) {
        destroyProviderView(viewKey(engine.id, profile.id));
        await clearSessionData(engine.id, profile.id);
      }
    }
  }

  await persistSettings(nextSettings);
  settings = nextSettings;
  refreshProviders();
  nativeTheme.themeSource = settings.theme;
  pruneViewsToSettings();
  return { cancelled: false, settings: structuredClone(settings) };
}

function appCommand(command) {
  if (!appView || appView.webContents.isDestroyed()) return;
  appView.webContents.focus();
  sendToApp('app:command', command);
}
function installShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    let command;
    if (mod && ['l', 'k'].includes(key)) command = 'search';
    else if (mod && key === ',') command = 'settings';
    else if (input.control && key === 'tab') command = input.shift ? 'previous' : 'next';
    else if (mod && /^[1-9]$/.test(key)) command = `page-${key}`;
    else if (mod && input.shift && key === 's') command = 'layout';
    else if (!settingsOverlayOpen && ((mod && key === 'r') || key === 'f5')) {
      event.preventDefault();
      navigatePage(activeViewKey, 'reload');
      return;
    } else if (!settingsOverlayOpen && key === 'escape') {
      event.preventDefault();
      navigatePage(activeViewKey, 'stop');
      return;
    } else if (
      !settingsOverlayOpen &&
      ((input.alt && ['arrowleft', 'arrowright'].includes(key)) ||
        (mod && ['[', ']'].includes(key)))
    ) {
      event.preventDefault();
      navigatePage(activeViewKey, ['arrowleft', '['].includes(key) ? 'back' : 'forward');
      return;
    }
    if (command) {
      event.preventDefault();
      appCommand(command);
    }
  });
}
function installMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Search Stack',
        submenu: [
          { label: 'Search', click: () => appCommand('search') },
          { label: 'Settings…', click: () => appCommand('settings') },
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
      { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'minimize' }] },
    ]),
  );
}

function createWindow() {
  windowRef = new BaseWindow({
    width: 1180,
    height: 860,
    minWidth: 680,
    minHeight: 480,
    autoHideMenuBar: true,
    title: 'Search Stack',
    icon: path.join(__dirname, 'icon.png'),
    show: !backgroundTest,
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
  installShortcuts(appView.webContents);

  appView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const eventName of ['will-navigate', 'will-redirect']) {
    appView.webContents.on(eventName, (event, targetUrl) => {
      try {
        const url = new URL(targetUrl);
        if (url.protocol !== 'app:' || url.hostname !== 'search-stack') event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
  }

  appView.webContents.on('did-finish-load', () => {
    const [width, height] = windowRef.getContentSize();
    appView.setBounds({ x: 0, y: 0, width, height });
    sendToApp(
      'app:providers',
      Object.entries(PROVIDERS).map(([id, provider]) => ({ id, label: provider.label })),
    );
    sendToApp('app:settings', structuredClone(settings));
  });

  windowRef.on('resize', () => {
    const [width, height] = windowRef.getContentSize();
    appView.setBounds({ x: 0, y: 0, width, height });
    appView.webContents.send('app:layout-changed');
  });
  windowRef.on('closed', () => {
    for (const { view, loadTimer, healthTimer } of providerViews.values()) {
      clearTimeout(loadTimer);
      clearInterval(healthTimer);
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
  // Set the running Dock icon explicitly; macOS may retain Electron's cached icon
  // after upgrading an installation that previously used the default artwork.
  if (process.platform === 'darwin') app.dock.setIcon(path.join(__dirname, 'icon.png'));
  await loadSettings();
  refreshProviders();
  nativeTheme.themeSource = settings.theme;
  protocol.handle('app', (request) => {
    const filePath = appAssetPath(request.url);
    if (!filePath) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  if (backgroundTest && process.platform === 'darwin') app.setActivationPolicy('prohibited');
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

function handleAppRequest(channel, handler) {
  ipcMain.handle(channel, (event, payload) => {
    if (!isAppRenderer(event.sender)) throw new Error('Unauthorized app message.');
    return handler(payload);
  });
}

handleAppRequest('app:search', async (payload) => {
  return runSearch(payload?.query, payload?.providers);
});
handleAppRequest('app:clear-search-views', () => {
  clearActiveSearchViews();
});
handleAppRequest('app:get-settings', async () => {
  await settingsQueue;
  return structuredClone(settings);
});
handleAppRequest('app:save-settings', async (payload) => {
  return queueSettings(() => saveSettings(payload));
});
handleAppRequest('app:preferences', (patch) => {
  return queueSettings(async () => {
    const next = validateSettings({
      ...settings,
      enabledEngines: patch?.enabledEngines ?? settings.enabledEngines,
      presentation: patch?.presentation ?? settings.presentation,
      splitPages: patch?.splitPages ?? settings.splitPages,
    });
    await persistSettings(next);
    settings = next;
    return structuredClone(settings);
  });
});
function navigatePage(key, action) {
  const state = providerViews.get(key);
  if (!state || !currentViewKeys.has(key) || state.view.webContents.isDestroyed()) return;
  const wc = state.view.webContents;
  if (action === 'back') {
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  } else if (action === 'forward') {
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  } else if (action === 'stop') {
    sendStatus(state, 'stopped', { message: 'Loading stopped' });
    wc.stop();
  } else if (action === 'reload') {
    const url = state.lastUrl || wc.getURL();
    if (!isSafeHttpsUrl(url)) return;
    if (['crashed', 'unresponsive', 'slow'].includes(state.status)) {
      const { providerId, profileId, generation } = state;
      destroyProviderView(key);
      currentViewKeys.add(key);
      const replacement = createProviderView(providerId, profileId);
      replacement.generation = generation;
      void replacement.view.webContents.loadURL(url).catch(() => {});
    } else if (state.status === 'error') void wc.loadURL(url).catch(() => {});
    else wc.reload();
    sendToApp('app:layout-changed');
  } else throw new Error('Unsupported navigation action.');
}
handleAppRequest('app:navigate', (payload) => {
  return navigatePage(String(payload?.viewKey || ''), payload?.action);
});
ipcMain.on('app:active-page', (event, key) => {
  if (isAppRenderer(event.sender) && currentViewKeys.has(key)) activeViewKey = key;
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
  else hideProviderViews();
});
ipcMain.on('provider:edge-wheel', (event, deltaY) => {
  const state = findProviderState(event.sender);
  if (!state || !currentViewKeys.has(state.key) || !Number.isFinite(deltaY)) return;
  const boundedDelta = Math.max(-1600, Math.min(1600, deltaY));
  sendToApp('app:scroll-by', boundedDelta);
});

ipcMain.on('provider:pong', (event) => {
  const state = findProviderState(event.sender);
  if (state && event.senderFrame === event.sender.mainFrame) state.pingSentAt = 0;
});
