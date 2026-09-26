const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('searchStack', {
  platform: process.platform,
  savePreferences(patch) { return ipcRenderer.invoke('app:preferences', patch); },
  setActivePage(key) { ipcRenderer.send('app:active-page', key); },
  onPageFocused(callback) { ipcRenderer.on('app:page-focused', (_event, key) => callback(key)); },
  onCommand(callback) { ipcRenderer.on('app:command', (_event, command) => callback(command)); },
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
    const listener = (_event, providers) => callback(providers);
    ipcRenderer.on('app:providers', listener);
    return () => ipcRenderer.removeListener('app:providers', listener);
  },
  onSettings(callback) {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('app:settings', listener);
    return () => ipcRenderer.removeListener('app:settings', listener);
  },
  onProviderStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('app:provider-status', listener);
    return () => ipcRenderer.removeListener('app:provider-status', listener);
  },
  onHistoryState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app:history-state', listener);
    return () => ipcRenderer.removeListener('app:history-state', listener);
  },
  onScrollBy(callback) {
    const listener = (_event, deltaY) => {
      if (Number.isFinite(deltaY)) callback(deltaY);
    };
    ipcRenderer.on('app:scroll-by', listener);
    return () => ipcRenderer.removeListener('app:scroll-by', listener);
  },
  onFocusSearch(callback) {
    const listener = () => callback();
    ipcRenderer.on('app:focus-search', listener);
    return () => ipcRenderer.removeListener('app:focus-search', listener);
  },
  onLayoutChanged(callback) {
    const listener = () => callback();
    ipcRenderer.on('app:layout-changed', listener);
    return () => ipcRenderer.removeListener('app:layout-changed', listener);
  },
});
