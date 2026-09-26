const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('searchStack', {
  platform: process.platform,
  savePreferences(patch) {
    return ipcRenderer.invoke('app:preferences', patch);
  },
  setActivePage(key) {
    ipcRenderer.send('app:active-page', key);
  },
  onPageFocused(callback) {
    subscribe('app:page-focused', callback);
  },
  onCommand(callback) {
    subscribe('app:command', callback);
  },
  search(query, providers) {
    return ipcRenderer.invoke('app:search', { query, providers });
  },
  getSettings() {
    return ipcRenderer.invoke('app:get-settings');
  },
  saveSettings(settings) {
    return ipcRenderer.invoke('app:save-settings', settings);
  },
  navigate(viewKey, action) {
    return ipcRenderer.invoke('app:navigate', { viewKey, action });
  },
  syncLayout(rectangles) {
    ipcRenderer.send('app:sync-layout', rectangles);
  },
  clearSearchViews() {
    return ipcRenderer.invoke('app:clear-search-views');
  },
  setSettingsOpen(isOpen) {
    ipcRenderer.send('app:settings-overlay', Boolean(isOpen));
  },
  onProviders(callback) {
    return subscribe('app:providers', callback);
  },
  onSettings(callback) {
    return subscribe('app:settings', callback);
  },
  onProviderStatus(callback) {
    return subscribe('app:provider-status', callback);
  },
  onHistoryState(callback) {
    return subscribe('app:history-state', callback);
  },
  onScrollBy(callback) {
    return subscribe('app:scroll-by', (deltaY) => {
      if (Number.isFinite(deltaY)) callback(deltaY);
    });
  },
  onFocusSearch(callback) {
    return subscribe('app:focus-search', () => callback());
  },
  onLayoutChanged(callback) {
    return subscribe('app:layout-changed', () => callback());
  },
});
