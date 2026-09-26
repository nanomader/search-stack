const form = document.querySelector('#search-form');
const queryInput = document.querySelector('#query');
const searchButton = document.querySelector('#search-button');
const enginePicker = document.querySelector('#engine-picker');
const results = document.querySelector('#results');
const emptyState = document.querySelector('#empty-state');
const scanToolbar = document.querySelector('#scan-toolbar');
const scanCounter = document.querySelector('#scan-counter');
const scanTabs = document.querySelector('#scan-tabs');
const scanPrevious = document.querySelector('#scan-previous');
const scanNext = document.querySelector('#scan-next');
const scanModeToggle = document.querySelector('#scan-mode-toggle');
const settingsDialog = document.querySelector('#settings-dialog');
const settingsButton = document.querySelector('#settings-button');
const settingsSaveButton = document.querySelector('#settings-save');
const settingsNotice = document.querySelector('#settings-notice');
const profileList = document.querySelector('#profile-list');
const profileMatrix = document.querySelector('#profile-matrix');
const newProfileInput = document.querySelector('#new-profile-name');

let providers = [];
let currentSettings = null;
let workingSettings = null;
let settingsSaving = false;
let currentQuery = '';
let currentProviderIds = [];
let activeViewKey = '';
let focusScan = true;
let scrollYBeforeFocus = 0;
let layoutFrame = 0;
let activeTargetFrame = 0;
let scrollJumpPending = false;
let scrollJumpTimer = 0;

function checkedProviderIds() {
  return [...enginePicker.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function activeTargets(providerIds, sourceSettings = currentSettings) {
  if (!sourceSettings) return [];
  const profilesById = new Map(sourceSettings.profiles.map((profile) => [profile.id, profile]));
  return providerIds.flatMap((providerId) => (sourceSettings.engineProfiles[providerId] || [])
    .map((profileId) => profilesById.get(profileId))
    .filter(Boolean)
    .map((profile) => ({
      providerId,
      profileId: profile.id,
      profileName: profile.name,
      viewKey: `${providerId}:${profile.id}`,
    })));
}

function resultSections() {
  return [...results.querySelectorAll('.engine-section')];
}

function updateScanNavigation() {
  const buttons = [...scanTabs.querySelectorAll('button[data-view-key]')];
  const activeIndex = buttons.findIndex((button) => button.dataset.viewKey === activeViewKey);
  buttons.forEach((button, index) => {
    const selected = index === activeIndex;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-current', selected ? 'location' : 'false');
  });
  buttons[activeIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  scanCounter.textContent = buttons.length && activeIndex >= 0
    ? `${activeIndex + 1} of ${buttons.length}`
    : `0 of ${buttons.length}`;
  scanPrevious.disabled = activeIndex <= 0;
  scanNext.disabled = activeIndex < 0 || activeIndex >= buttons.length - 1;
  scanModeToggle.setAttribute('aria-pressed', String(focusScan));
  scanModeToggle.innerHTML = focusScan
    ? '▤ Stack'
    : '⛶ Focus';
}

function renderScanNavigation(targets) {
  scanTabs.replaceChildren();
  targets.forEach((target, index) => {
    const providerName = providers.find((provider) => provider.id === target.providerId)?.label || target.providerId;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scan-tab';
    button.dataset.viewKey = target.viewKey;
    button.setAttribute('aria-label', `${providerName}, ${target.profileName} profile`);
    button.setAttribute('aria-current', 'false');
    button.title = `${providerName} · ${target.profileName}`;

    const number = document.createElement('span');
    number.className = 'scan-tab-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'scan-tab-name';
    name.textContent = providerName;
    const profile = document.createElement('span');
    profile.className = 'scan-tab-profile';
    profile.textContent = target.profileName;
    const state = document.createElement('span');
    state.className = 'scan-tab-state';
    state.dataset.status = 'loading';
    state.setAttribute('aria-hidden', 'true');
    button.append(number, name, profile, state);
    scanTabs.append(button);
  });
  updateScanNavigation();
}

function applyPresentation() {
  const sections = resultSections();
  document.body.dataset.presentation = focusScan ? 'focus' : 'stack';
  scanToolbar.hidden = sections.length === 0;
  for (const section of sections) {
    section.hidden = focusScan && section.dataset.viewKey !== activeViewKey;
  }
  updateScanNavigation();
  window.searchStack.setActivePage(activeViewKey);
  scheduleLayoutSync();
}

function selectScanTarget(viewKey, { jumpToSection = false } = {}) {
  const section = resultSections().find((item) => item.dataset.viewKey === viewKey);
  if (!section) return;
  activeViewKey = viewKey;
  window.searchStack.setActivePage(viewKey);
  if (focusScan) {
    applyPresentation();
    return;
  }
  updateScanNavigation();
  if (jumpToSection) {
    scrollJumpPending = true;
    clearTimeout(scrollJumpTimer);
    scrollJumpTimer = setTimeout(finishScrollJump, 1400);
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    section.scrollIntoView({ behavior, block: 'start' });
  }
}

function finishScrollJump() {
  clearTimeout(scrollJumpTimer);
  scrollJumpTimer = 0;
  if (!scrollJumpPending) return;
  scrollJumpPending = false;
  updateActiveTargetFromScroll();
}

function cancelScrollJump() {
  clearTimeout(scrollJumpTimer);
  scrollJumpTimer = 0;
  scrollJumpPending = false;
}

function moveScanTarget(step) {
  const buttons = [...scanTabs.querySelectorAll('button[data-view-key]')];
  const index = buttons.findIndex((button) => button.dataset.viewKey === activeViewKey);
  const next = buttons[index + step];
  if (next) selectScanTarget(next.dataset.viewKey, { jumpToSection: !focusScan });
}

function enterFocusScan(viewKey = activeViewKey) {
  if (!resultSections().length) return;
  if (!focusScan) {
    cancelScrollJump();
    scrollYBeforeFocus = window.scrollY;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  const target = resultSections().find((section) => section.dataset.viewKey === viewKey);
  if (target) activeViewKey = viewKey;
  focusScan = true;
  applyPresentation();
}

function exitFocusScan() {
  if (!focusScan) return;
  focusScan = false;
  applyPresentation();
  requestAnimationFrame(() => window.scrollTo({ top: scrollYBeforeFocus, behavior: 'auto' }));
}

function updateActiveTargetFromScroll() {
  activeTargetFrame = 0;
  if (focusScan || scrollJumpPending) return;
  const sections = resultSections();
  if (!sections.length) return;
  const anchor = Math.min(window.innerHeight * 0.35, window.innerHeight - 100);
  let active = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= anchor) active = section;
    else break;
  }
  if (active.dataset.viewKey !== activeViewKey) {
    activeViewKey = active.dataset.viewKey;
    window.searchStack.setActivePage(activeViewKey);
    updateScanNavigation();
  }
}

function updateSearchButtonLabel() { searchButton.textContent = 'Search ↵'; }

function makeProviderPicker(engineProviders) {
  providers = engineProviders;
  enginePicker.replaceChildren();
  for (const { id, label } of providers) {
    const choice = document.createElement('label');
    choice.className = 'engine-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = id;
    checkbox.checked = currentSettings?.enabledEngines.includes(id) ?? false;
    checkbox.addEventListener('change', () => {
      currentProviderIds = checkedProviderIds();
      savePreferences({ enabledEngines: currentProviderIds });
      updateSearchButtonLabel();
      scheduleLayoutSync();
      if (currentQuery && currentProviderIds.length) void submitSearch(currentQuery);
      else if (currentQuery && currentProviderIds.length === 0) {
        setError('Select at least one search engine to show results.');
        void window.searchStack.clearSearchViews();
        clearResults();
        emptyState.hidden = false;
        syncLayout();
      }
    });
    const dot = document.createElement('span');
    dot.className = 'engine-dot';
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    choice.append(checkbox, dot, text);
    enginePicker.append(choice);
  }
  updateSearchButtonLabel();
}

function setError(message) {
  const notice = document.querySelector('#app-notice');
  notice.textContent = message; notice.hidden = false;
}
function clearError() { document.querySelector('#app-notice').hidden = true; }

function createNavigationButton(action, label, symbol, disabled = false) {
  const button = document.createElement('button');
  button.className = 'navigation-button';
  button.type = 'button';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.disabled = disabled;
  button.textContent = symbol;
  return button;
}

function createResultSection(target, index) {
  const section = document.createElement('section');
  section.className = 'engine-section';
  section.dataset.viewKey = target.viewKey;
  section.id = `result-panel-${index + 1}`;

  const heading = document.createElement('header');
  heading.className = 'engine-heading';
  const left = document.createElement('div');
  left.className = 'engine-name-wrap';
  const number = document.createElement('span');
  number.className = 'engine-number';
  number.textContent = String(index + 1).padStart(2, '0');
  const titleWrap = document.createElement('div');
  titleWrap.className = 'engine-title-wrap';
  const title = document.createElement('h2');
  title.className = 'engine-name';
  title.id = `result-title-${index + 1}`;
  title.textContent = providers.find((provider) => provider.id === target.providerId)?.label || target.providerId;
  const profileBadge = document.createElement('span');
  profileBadge.className = 'profile-badge';
  profileBadge.textContent = target.profileName;
  const location = document.createElement('span'); location.className = 'page-location';
  titleWrap.append(title, profileBadge, location);
  left.append(number, titleWrap);

  const tools = document.createElement('div');
  tools.className = 'engine-tools';
  const history = document.createElement('div');
  history.className = 'navigation-controls';
  history.setAttribute('aria-label', 'Page navigation');
  history.append(
    createNavigationButton('back', 'Back', '←', true),
    createNavigationButton('forward', 'Forward', '→', true),
    createNavigationButton('reload', 'Reload', '↻'),
    createNavigationButton('stop', 'Stop loading', '×'),
  );
  const focusButton = document.createElement('button');
  focusButton.className = 'focus-engine-button';
  focusButton.type = 'button';
  focusButton.dataset.focusView = target.viewKey;
  focusButton.textContent = 'Focus this page';
  focusButton.setAttribute('aria-label', `Focus ${title.textContent}, ${target.profileName} profile`);
  const status = document.createElement('span');
  status.className = 'engine-state';
  status.dataset.status = 'loading';
  status.textContent = `Searching for “${currentQuery}”`;
  tools.append(status, history, focusButton);
  heading.append(left, tools);

  const slot = document.createElement('div');
  slot.className = 'provider-slot';
  slot.dataset.viewKey = target.viewKey;
  const placeholder = document.createElement('div');
  placeholder.className = 'engine-placeholder';
  placeholder.textContent = `Loading ${title.textContent} · ${target.profileName}…`;
  slot.append(placeholder);
  section.append(heading, slot);
  return section;
}

function syncLayout() {
  layoutFrame = 0;
  const rectangles = [];
  for (const slot of results.querySelectorAll('.provider-slot')) {
    const rect = slot.getBoundingClientRect();
    rectangles.push({
      viewKey: slot.dataset.viewKey,
      x: Math.round(rect.left),
      y: Math.round(Math.max(rect.top, focusScan ? 0 : 96)),
      width: Math.round(rect.width),
      height: Math.round(Math.max(0, rect.bottom - Math.max(rect.top, focusScan ? 0 : 96))),
    });
  }
  window.searchStack.syncLayout(rectangles);
}

function scheduleLayoutSync() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(syncLayout);
}

async function submitSearch(query) {
  const providerIds = checkedProviderIds();
  const normalized = String(query).trim();
  if (!normalized) {
    queryInput.focus();
    return;
  }
  if (!providerIds.length) {
    setError('Select at least one search engine.');
    void window.searchStack.clearSearchViews();
    clearResults();
    return;
  }
  const targets = activeTargets(providerIds);
  if (!targets.length) {
    setError('Choose at least one profile for a selected engine in Settings.');
    void window.searchStack.clearSearchViews();
    clearResults();
    return;
  }
  if (targets.length > 12) {
    setError('Choose up to 12 engine and profile combinations per search to keep the app responsive.');
    void window.searchStack.clearSearchViews();
    clearResults();
    return;
  }

  clearError();
  const firstSearch = !currentQuery;
  if (firstSearch) focusScan = currentSettings.presentation !== 'stack';
  currentQuery = normalized;
  currentProviderIds = providerIds;
  queryInput.value = normalized;
  activeViewKey = targets[0].viewKey;
  emptyState.hidden = true;
  results.querySelectorAll('.engine-section').forEach((section) => section.remove());
  targets.forEach((target, index) => results.append(createResultSection(target, index)));
  renderScanNavigation(targets);
  applyPresentation();
  scheduleLayoutSync();
  searchButton.disabled = true;
  searchButton.innerHTML = '<span aria-hidden="true">…</span> Searching';
  try {
    await window.searchStack.search(normalized, providerIds);
    window.searchStack.setActivePage(activeViewKey);
  } catch (error) {
    currentQuery = '';
    clearResults();
    setError(error.message || 'Search could not be started.');
  } finally {
    searchButton.disabled = false;
    updateSearchButtonLabel();
    scheduleLayoutSync();
  }
}

function clearResults() {
  results.querySelectorAll('.engine-section').forEach((section) => section.remove());
  scanTabs.replaceChildren();
  cancelScrollJump();
  activeViewKey = '';
  applyPresentation();
  emptyState.hidden = false;
  scheduleLayoutSync();
}

function cloneSettings(source) {
  return structuredClone(source);
}

function renderProfileEditor() {
  if (!workingSettings) return;
  profileList.replaceChildren();
  for (const profile of workingSettings.profiles) {
    const row = document.createElement('div');
    row.className = 'profile-row';
    const name = document.createElement('span');
    name.className = 'profile-row-name';
    name.textContent = profile.name;
    row.append(name);

    if (profile.id === 'default') {
      const badge = document.createElement('span');
      badge.className = 'default-profile-badge';
      badge.textContent = 'Default';
      row.append(badge);
    } else {
      const remove = document.createElement('button');
      remove.className = 'remove-profile-button';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${profile.name} profile`);
      remove.addEventListener('click', () => {
        workingSettings.profiles = workingSettings.profiles.filter((item) => item.id !== profile.id);
        for (const provider of editorProviders()) {
          workingSettings.engineProfiles[provider.id] = workingSettings.engineProfiles[provider.id]
            .filter((id) => id !== profile.id);
        }
        renderSettingsEditor();
      });
      row.append(remove);
    }
    profileList.append(row);
  }
}

function renderProfileMatrix() {
  if (!workingSettings) return;
  profileMatrix.replaceChildren();
  for (const provider of editorProviders()) {
    const engine = document.createElement('section');
    engine.className = 'profile-engine';
    const title = document.createElement('h4');
    const enabledLabel = document.createElement('label');
    const enabled = document.createElement('input');
    enabled.type = 'checkbox'; enabled.checked = workingSettings.enabledEngines.includes(provider.id);
    enabled.setAttribute('aria-label', `Enable ${provider.label}`);
    enabled.addEventListener('change', () => {
      workingSettings.enabledEngines = enabled.checked ? [...workingSettings.enabledEngines, provider.id] : workingSettings.enabledEngines.filter(id => id !== provider.id);
    });
    enabledLabel.append(enabled, document.createTextNode(` ${provider.label}`));
    title.append(enabledLabel);
    if (provider.id.startsWith('custom-')) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.className = 'remove-profile-button';
      remove.setAttribute('aria-label', `Remove ${provider.label} engine`);
      remove.addEventListener('click', () => {
        workingSettings.customEngines = workingSettings.customEngines.filter(e => e.id !== provider.id);
        workingSettings.enabledEngines = workingSettings.enabledEngines.filter(id => id !== provider.id);
        delete workingSettings.engineProfiles[provider.id]; renderProfileMatrix();
      }); title.append(remove);
    }
    const choices = document.createElement('div');
    choices.className = 'profile-engine-choices';
    for (const profile of workingSettings.profiles) {
      const label = document.createElement('label');
      label.className = 'profile-choice';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `${provider.label}: ${profile.name}`);
      checkbox.checked = workingSettings.engineProfiles[provider.id].includes(profile.id);
      checkbox.addEventListener('change', () => {
        const selected = workingSettings.engineProfiles[provider.id];
        workingSettings.engineProfiles[provider.id] = checkbox.checked
          ? [...new Set([...selected, profile.id])]
          : selected.filter((id) => id !== profile.id);
      });
      const text = document.createElement('span');
      text.textContent = profile.name;
      label.append(checkbox, text);
      choices.append(label);
    }
    engine.append(title, choices);
    profileMatrix.append(engine);
  }
}

function renderSettingsEditor() {
  renderProfileEditor();
  renderProfileMatrix();
}

async function openSettings() {
  if (settingsDialog.open) return;
  try {
    currentSettings = await window.searchStack.getSettings();
    workingSettings = cloneSettings(currentSettings);
    workingSettings.enabledEngines = checkedProviderIds();
    document.querySelector('#theme').value = workingSettings.theme;
    settingsNotice.textContent = '';
    newProfileInput.value = '';
    renderSettingsEditor();
    settingsDialog.showModal();
    window.searchStack.setSettingsOpen(true);
  } catch (error) {
    setError(error.message || 'Settings could not be opened.');
  }
}

function addProfile() {
  const name = newProfileInput.value.trim();
  if (!name) {
    settingsNotice.textContent = 'Enter a name for the new profile.';
    newProfileInput.focus();
    return;
  }
  if (name.length > 48 || /[\u0000-\u001f\u007f]/.test(name)) {
    settingsNotice.textContent = 'Profile names must be 1–48 characters long.';
    return;
  }
  if (workingSettings.profiles.some((profile) => profile.name.toLowerCase() === name.toLowerCase())) {
    settingsNotice.textContent = 'Choose a profile name that is not already in use.';
    return;
  }
  if (workingSettings.profiles.length >= 12) {
    settingsNotice.textContent = 'You can create up to 12 profiles.';
    return;
  }

  const profile = { id: `p-${crypto.randomUUID()}`, name };
  workingSettings.profiles.push(profile);
  newProfileInput.value = '';
  settingsNotice.textContent = 'Profile added. Choose which engines should search it.';
  renderSettingsEditor();
}

async function saveSettings() {
  if (settingsSaving) return;
  settingsSaving = true;
  settingsDialog.querySelectorAll('button, input, select').forEach(control => { control.disabled = true; });
  settingsNotice.textContent = 'Saving settings…';
  try {
    const result = await window.searchStack.saveSettings(workingSettings);
    if (result.cancelled) {
      currentSettings = result.settings;
      workingSettings = cloneSettings(result.settings);
      renderSettingsEditor();
      document.querySelector('#theme').value = workingSettings.theme;
      applyTheme();
      settingsNotice.textContent = 'No changes saved.';
      return;
    }
    const searchChanged = JSON.stringify([currentSettings.engineProfiles, currentSettings.customEngines, checkedProviderIds()]) !== JSON.stringify([result.settings.engineProfiles, result.settings.customEngines, result.settings.enabledEngines]);
    currentSettings = result.settings;
    applyTheme();
    makeProviderPicker([...providers.filter(e => !e.id.startsWith('custom-')), ...currentSettings.customEngines]);
    currentProviderIds = checkedProviderIds();
    workingSettings = null;
    settingsDialog.close();
    if (currentQuery && searchChanged) await submitSearch(currentQuery);
  } catch (error) {
    settingsNotice.textContent = error.message || 'Settings could not be saved.';
  } finally {
    settingsSaving = false;
    settingsDialog.querySelectorAll('button, input, select').forEach(control => { control.disabled = false; });
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitSearch(queryInput.value);
});

settingsButton.addEventListener('click', () => void openSettings());
document.querySelector('#settings-close').addEventListener('click', () => settingsDialog.close());
document.querySelector('#settings-cancel').addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('cancel', event => { if (settingsSaving) event.preventDefault(); });
settingsDialog.addEventListener('close', () => { workingSettings = null; applyTheme(); window.searchStack.setSettingsOpen(false); scheduleLayoutSync(); });
document.querySelector('#settings-form').addEventListener('submit', event => event.preventDefault());
document.querySelector('#add-profile-button').addEventListener('click', addProfile);
newProfileInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addProfile();
  }
});
settingsSaveButton.addEventListener('click', () => void saveSettings());
scanModeToggle.addEventListener('click', () => {
  if (focusScan) exitFocusScan();
  else enterFocusScan();
  savePreferences({ presentation: focusScan ? 'focus' : 'stack' });
});
scanPrevious.addEventListener('click', () => moveScanTarget(-1));
scanNext.addEventListener('click', () => moveScanTarget(1));

scanTabs.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view-key]');
  if (button) selectScanTarget(button.dataset.viewKey, { jumpToSection: !focusScan });
});
scanTabs.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const button = event.target.closest('button[data-view-key]');
  if (!button) return;
  event.preventDefault();
  const buttons = [...scanTabs.querySelectorAll('button[data-view-key]')];
  const index = buttons.indexOf(button);
  const next = buttons[index + (event.key === 'ArrowRight' ? 1 : -1)];
  if (next) {
    selectScanTarget(next.dataset.viewKey, { jumpToSection: !focusScan });
    next.focus();
  }
});

results.addEventListener('click', (event) => {
  const focusButton = event.target.closest('button[data-focus-view]');
  if (focusButton) {
    enterFocusScan(focusButton.dataset.focusView);
    return;
  }
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const section = button.closest('.engine-section');
  if (section) void window.searchStack.navigate(section.dataset.viewKey, button.dataset.action).catch(error => setError(error.message));
});

window.searchStack.onProviders((list) => { providers = list; if (currentSettings) makeProviderPicker(list); });
window.searchStack.onSettings((nextSettings) => {
  currentSettings = nextSettings;
  focusScan = currentSettings.presentation !== 'stack';
  applyTheme();
  makeProviderPicker(providers);
  applyPresentation();
});
window.searchStack.onProviderStatus(({ viewKey, status, message }) => {
  const section = results.querySelector(`.engine-section[data-view-key="${CSS.escape(viewKey)}"]`);
  if (!section) return;
  const statusNode = section.querySelector('.engine-state');
  const tab = [...scanTabs.querySelectorAll('button[data-view-key]')]
    .find((button) => button.dataset.viewKey === viewKey);
  if (tab) tab.querySelector('.scan-tab-state').dataset.status = status;
  statusNode.dataset.status = status;
  const messages = { ready: 'Live website', loading: 'Loading…', slow: 'Taking longer than expected', stopped: 'Loading stopped' };
  statusNode.textContent = message || messages[status] || status;
  statusNode.title = statusNode.textContent;
  section.querySelector('[data-action="stop"]').disabled = !['loading', 'slow'].includes(status);
  const slot = section.querySelector('.provider-slot');
  slot.replaceChildren();
  if (['error', 'crashed', 'unresponsive'].includes(status)) {
    const placeholder = document.createElement('div'); placeholder.className = 'engine-placeholder';
    const text = document.createElement('p'); text.textContent = message || 'This page could not load. Other engines are still available.';
    const retry = createNavigationButton('reload', 'Retry page', '↻');
    placeholder.append(text, retry); slot.append(placeholder);
  }
  scheduleLayoutSync();
});
window.searchStack.onHistoryState(({ viewKey, url, canGoBack, canGoForward }) => {
  const section = results.querySelector(`.engine-section[data-view-key="${CSS.escape(viewKey)}"]`);
  if (!section) return;
  const location = section.querySelector('.page-location');
  try { location.textContent = new URL(url).hostname; location.title = url; } catch { location.textContent = ''; }
  section.querySelector('[data-action="back"]').disabled = !canGoBack;
  section.querySelector('[data-action="forward"]').disabled = !canGoForward;
});
window.searchStack.onScrollBy((deltaY) => window.scrollBy({ top: deltaY, behavior: 'auto' }));
window.searchStack.onFocusSearch(() => {
  if (!settingsDialog.open) { queryInput.focus(); queryInput.select(); }
});
window.searchStack.onLayoutChanged(scheduleLayoutSync);

window.addEventListener('scroll', () => {
  scheduleLayoutSync();
  if (!activeTargetFrame) activeTargetFrame = requestAnimationFrame(updateActiveTargetFromScroll);
}, { passive: true });
window.addEventListener('scrollend', finishScrollJump, { passive: true });
window.addEventListener('resize', scheduleLayoutSync, { passive: true });
window.addEventListener('load', () => {
  currentProviderIds = checkedProviderIds();
  scheduleLayoutSync();
});


function editorProviders() { return [...providers.filter(p => !p.id.startsWith('custom-')), ...(workingSettings?.customEngines || [])]; }
function applyTheme() {
  const preference = workingSettings?.theme || currentSettings?.theme || 'system';
  document.documentElement.dataset.theme = preference === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
document.querySelector('#theme').addEventListener('change', event => { workingSettings.theme = event.target.value; applyTheme(); });
document.querySelector('#add-engine').addEventListener('click', () => {
  const label = document.querySelector('#engine-name').value.trim();
  const template = document.querySelector('#engine-url').value.trim();
  try {
    const url = new URL(template);
    if (!label || label.length > 48 || /[\u0000-\u001f\u007f]/.test(label)) throw new Error('Enter an engine name, up to 48 characters.');
    if (editorProviders().some(e => e.label.toLowerCase() === label.toLowerCase())) throw new Error('Engine names must be unique.');
    if (workingSettings.customEngines.length >= 12) throw new Error('Add up to 12 custom engines.');
    if (url.protocol !== 'https:' || url.username || url.password || template.split('{query}').length !== 2 || url.origin.includes('{query}') || url.hash.includes('{query}')) throw new Error('Use an HTTPS URL with one {query} in the path or query parameters.');
    const id = `custom-${crypto.randomUUID()}`;
    workingSettings.customEngines.push({ id, label, template });
    workingSettings.engineProfiles[id] = ['default']; workingSettings.enabledEngines.push(id);
    document.querySelector('#engine-name').value = ''; document.querySelector('#engine-url').value = '';
    settingsNotice.textContent = 'Engine added. Save settings to use it.'; renderProfileMatrix();
  } catch (error) { settingsNotice.textContent = error.message; }
});
window.searchStack.onCommand(command => {
  if (command === 'settings') { void openSettings(); return; }
  if (settingsDialog.open) return;
  if (command === 'search') { queryInput.focus(); queryInput.select(); }
  else if (command === 'next' || command === 'previous') {
    const sections = resultSections(), index = sections.findIndex(s => s.dataset.viewKey === activeViewKey);
    if (sections.length) selectScanTarget(sections[(index + (command === 'next' ? 1 : -1) + sections.length) % sections.length].dataset.viewKey, { jumpToSection: !focusScan });
  } else if (command.startsWith('page-')) {
    const section = resultSections()[Number(command.slice(5)) - 1];
    if (section) selectScanTarget(section.dataset.viewKey, { jumpToSection: !focusScan });
  } else if (command === 'layout') scanModeToggle.click();
});
if (window.searchStack.platform !== 'darwin') document.querySelectorAll('.mod').forEach(node => { node.textContent = 'Ctrl'; });

function savePreferences(patch) {
  void window.searchStack.savePreferences(patch).then(next => { currentSettings = next; }).catch(error => setError(error.message));
}
