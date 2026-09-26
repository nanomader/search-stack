const BUILTIN_ENGINES = [
  { id: 'google', label: 'Google', template: 'https://www.google.com/search?q={query}' },
  { id: 'bing', label: 'Bing', template: 'https://www.bing.com/search?q={query}' },
  { id: 'yahoo', label: 'Yahoo', template: 'https://search.yahoo.com/search?p={query}' },
  { id: 'baidu', label: 'Baidu', template: 'https://www.baidu.com/s?wd={query}' },
  { id: 'duckduckgo', label: 'DuckDuckGo', template: 'https://duckduckgo.com/?q={query}' },
  { id: 'yandex', label: 'Yandex', template: 'https://yandex.com/search/?text={query}' },
];
const MAX_PROFILES = 12;
const MAX_ACTIVE_PAGES = 12;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_SETTINGS = {
  version: 2, theme: 'system', presentation: 'focus', splitPages: [],
  profiles: [{ id: 'default', name: 'Default' }], customEngines: [],
  enabledEngines: ['google', 'bing', 'yahoo', 'baidu'],
  engineProfiles: Object.fromEntries(BUILTIN_ENGINES.map(({ id }) => [id, ['default']])),
};
function isSafeHttpsUrl(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password; }
  catch { return false; }
}
function validateTemplate(template) {
  if (typeof template !== 'string' || template.length > 2048 || template.split('{query}').length !== 2
    || !isSafeHttpsUrl(template)) throw new Error('Use an HTTPS search URL with exactly one {query} placeholder.');
  const url = new URL(template);
  if (url.origin.includes('{query}') || url.hash.includes('{query}')) {
    throw new Error('Place {query} in the URL path or query parameters.');
  }
  return template;
}
function textName(value, kind) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 48 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error(`${kind} names must be 1–48 characters long.`);
  return name;
}
function enginesFor(settings) { return [...BUILTIN_ENGINES, ...settings.customEngines]; }
function searchUrl(engine, query) { return engine.template.replace('{query}', encodeURIComponent(query.toWellFormed())); }
function validateSettings(value) {
  if (!value || !Array.isArray(value.profiles) || !value.engineProfiles) throw new Error('Settings are invalid.');
  if (value.profiles.length < 1 || value.profiles.length > MAX_PROFILES) throw new Error('Create between 1 and 12 profiles.');
  const ids = new Set(), names = new Set();
  const profiles = value.profiles.map(p => {
    const id = p?.id, name = textName(p?.name, 'Profile');
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || ids.has(id)) throw new Error('Profile identifiers are invalid.');
    if (names.has(name.toLowerCase())) throw new Error('Profile names must be unique.');
    ids.add(id); names.add(name.toLowerCase()); return { id, name };
  });
  if (!ids.has('default')) throw new Error('The Default profile must remain available.');
  const custom = value.customEngines ?? [];
  if (!Array.isArray(custom) || custom.length > 12) throw new Error('Add up to 12 custom engines.');
  const engineIds = new Set(BUILTIN_ENGINES.map(e => e.id));
  const engineNames = new Set(BUILTIN_ENGINES.map(e => e.label.toLowerCase()));
  const customEngines = custom.map(e => {
    const label = textName(e?.label, 'Engine');
    if (typeof e.id !== 'string' || !ID_PATTERN.test(e.id) || !e.id.startsWith('custom-') || engineIds.has(e.id)) throw new Error('Engine identifiers are invalid.');
    if (engineNames.has(label.toLowerCase())) throw new Error('Engine names must be unique.');
    engineIds.add(e.id); engineNames.add(label.toLowerCase());
    return { id: e.id, label, template: validateTemplate(e.template) };
  });
  const enabled = value.enabledEngines ?? DEFAULT_SETTINGS.enabledEngines;
  if (!Array.isArray(enabled) || enabled.some(id => !engineIds.has(id))) throw new Error('Selected engines are invalid.');
  const engineProfiles = Object.fromEntries([...engineIds].map(id => {
    const selected = value.engineProfiles[id] ?? ['default'];
    if (!Array.isArray(selected) || selected.some(p => !ids.has(p))) throw new Error('A selected profile no longer exists.');
    return [id, [...new Set(selected)]];
  }));
  const theme = value.theme ?? 'system', presentation = value.presentation ?? 'focus';
  if (!['system', 'light', 'dark'].includes(theme)) throw new Error('Theme is invalid.');
  if (!['focus', 'stack', 'split'].includes(presentation)) throw new Error('Layout is invalid.');
  const requestedSplit = value.splitPages ?? [];
  if (!Array.isArray(requestedSplit) || requestedSplit.length > 2 || requestedSplit.some(key => typeof key !== 'string')) throw new Error('Split pages are invalid.');
  const availablePages = new Set(Object.entries(engineProfiles).flatMap(([id, profiles]) => profiles.map(profile => `${id}:${profile}`)));
  const splitPages = [...new Set(requestedSplit)].filter(key => availablePages.has(key));
  return { version: 2, splitPages, profiles, customEngines, engineProfiles, enabledEngines: [...new Set(enabled)], theme, presentation };
}
module.exports = { BUILTIN_ENGINES, DEFAULT_SETTINGS, MAX_ACTIVE_PAGES, validateSettings, validateTemplate, enginesFor, searchUrl, isSafeHttpsUrl };
