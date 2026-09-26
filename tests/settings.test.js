const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, validateSettings, validateTemplate, searchUrl, BUILTIN_ENGINES } = require('../src/settings');
test('migrates v1 settings without changing saved profile IDs or selections', () => {
  const legacy = { version: 1, profiles: [{id:'default',name:'Default'},{id:'p-personal',name:'Personal'}], engineProfiles: {google:['p-personal'],bing:[],yahoo:['default'],baidu:['default']} };
  const actual = validateSettings(legacy);
  assert.deepEqual(actual.profiles, legacy.profiles);
  assert.deepEqual(actual.engineProfiles.google, ['p-personal']);
  assert.deepEqual(actual.engineProfiles.bing, []);
  assert.equal(actual.theme, 'system');
  assert.deepEqual(actual.engineProfiles.duckduckgo, ['default']);
});
test('query is encoded as data, including Unicode, URLs and delimiters', () => {
  const query = '猫 &x=1 # + / {query}';
  for (const e of BUILTIN_ENGINES) {
    const url = new URL(searchUrl(e, query));
    assert.equal([...url.searchParams.values()][0], query);
    assert.equal(url.hash, '');
  }
});
test('custom URL boundary rejects credentials, schemes, host placeholders and duplicates', () => {
  for (const value of ['http://example.com?q={query}', 'javascript:{query}', 'https://u:p@example.com?q={query}', 'https://{query}.com/', 'https://example.com/#{query}', 'https://example.com', 'https://example.com?q={query}&b={query}']) assert.throws(() => validateTemplate(value), value);
  assert.equal(validateTemplate('https://example.com/find/{query}'), 'https://example.com/find/{query}');
});
test('settings reject unknown profiles, duplicate names and unsafe custom engines', () => {
  let s = structuredClone(DEFAULT_SETTINGS); s.engineProfiles.google = ['missing']; assert.throws(() => validateSettings(s));
  s = structuredClone(DEFAULT_SETTINGS); s.profiles.push({id:'another',name:'default'}); assert.throws(() => validateSettings(s));
  s = structuredClone(DEFAULT_SETTINGS); s.customEngines.push({id:'google',label:'Fake',template:'https://example.com?q={query}'}); assert.throws(() => validateSettings(s));
  s = structuredClone(DEFAULT_SETTINGS); s.theme = 'unknown'; assert.throws(() => validateSettings(s));
});
