import { build } from 'esbuild';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const load = async (entry) => {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};
const { readingYear, matchesShelfFilters, readingSummary } = await load('src/reading.ts');
const { MetadataCache } = await load('src/metadataCache.ts');
const book = (finishedDate, status = '读完', source = '') => ({ finishedDate, status, source, title: 'Book Alpha', author: 'Jane', categories: ['文学'] });
test('valid years, leap dates, timestamps and old notes', () => {
  for (const date of ['', 'bad', '2023-02-29', '2024-13-01', '2024-04-31', '2024-01-01garbage', '2024-01-01T99:99:00Z']) assert.equal(readingYear(date), '');
  assert.equal(readingYear('2024-02-29'), '2024');
  assert.equal(readingYear('2025-01-01T00:00:00Z'), '2025');
});
test('year intersects search, category and status; both sort directions preserve membership', () => {
  const books = [book('2024-01-01'), book('2025-01-01'), book(''), book('2024-02-01', '在读')];
  const filter = (year, q = 'jane', status = '读完', category = '文学') => books.filter(b => matchesShelfFilters(b, q, status, category, year));
  assert.equal(filter('2024').length, 1);
  assert.equal(filter('all').length, 3);
  assert.equal(filter('unknown').length, 1);
  assert.equal(filter('2024', 'missing').length, 0);
  assert.equal(filter('2024', '', '全部', '科学').length, 0);
  assert.equal(filter('2024', '', '全部').length, 2);

});
test('finished-only totals, unknown dates and missing source balance', () => {
  const s = readingSummary([book('2024-01-01', '读完', 'Kindle'), book('invalid'), book(''), book('2025-01-01', '在读', '纸质书')]);
  assert.equal(s.years.get('2024'), 1); assert.equal(s.years.get('unknown'), 2);
  assert.equal(s.sources.get(''), 2); assert.equal(s.sources.get('Kindle'), 1);
  assert.deepEqual([...readingSummary([]).years], []);
});
test('cache deduplicates concurrent loads, isolates mutations and restores persisted results', async () => {
  let saved = ''; let calls = 0;
  const cache = new MetadataCache(async text => { saved = text; });
  const loader = async () => { calls++; return [{ title: 'A' }]; };
  const [a,b] = await Promise.all([cache.get('source/query', loader), cache.get('source/query', loader)]);
  a[0].title = 'Changed'; assert.equal(b[0].title, 'A'); assert.equal(calls, 1);
  const restored = new MetadataCache(); restored.restore(saved);
  assert.equal((await restored.get('source/query', loader))[0].title, 'A'); assert.equal(calls, 1);
  await restored.get('other-source/query', loader); assert.equal(calls, 2);
});
test('expiration, corrupt files, network failures, nulls and empty results retry', async () => {
  let now = 100; let calls = 0; const cache = new MetadataCache(undefined, () => now);
  cache.restore('invalid JSON');
  const loader = async () => { calls++; return { title: 'A' }; };
  await cache.get('key', loader); now += 8 * 86400000; await cache.get('key', loader); assert.equal(calls, 2);
  for (const value of [null, []]) { let n = 0; const fn = async () => { n++; return value; }; await cache.get('empty', fn); await cache.get('empty', fn); assert.equal(n, 2); }
  await assert.rejects(cache.get('error', async () => { throw Error('offline'); }));
  assert.deepEqual(await cache.get('error', loader), { title: 'A' });
  const brokenDisk = new MetadataCache(async () => { throw Error('read only'); });
  assert.deepEqual(await brokenDisk.get('key', loader), { title: 'A' });
});
test('bounded cache evicts oldest entry; clear prevents in-flight repopulation', async () => {
  let saved = ''; const cache = new MetadataCache(async text => { saved = text; });
  for (let i = 0; i < 201; i++) await cache.get(String(i), async () => ({ title: String(i) }));
  assert.equal(JSON.parse(saved).entries.length, 200);
  let called = false; await cache.get('0', async () => { called = true; return { title: '0' }; }); assert.ok(called);
  let release; const pending = cache.get('late', () => new Promise(resolve => { release = resolve; }));
  await cache.clear(); release({ title: 'late' }); await pending;
  assert.deepEqual(JSON.parse(saved).entries, []);
  let retried = false; await cache.get('late', async () => { retried = true; return { title: 'new' }; }); assert.ok(retried);
});

test('actual shelf pipeline combines filters with ascending and descending sorting', async () => {
  const result = await build({ entryPoints: ['src/view.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'obsidian-test', setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
        export class ItemView {} export class Modal {} export class Notice {} export class TFile {}
        export class TFolder {} export class Menu {} export class PluginSettingTab {} export class Setting {}
        export class AbstractInputSuggest {} export const normalizePath = p => p;
        export const getLanguage = () => 'zh'; export const requestUrl = async () => { throw Error('unexpected network'); };
      ` }));
    } }],
  });
  const { BookShelfView } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const view = Object.create(BookShelfView.prototype);
  Object.assign(view, { books: [ { ...book('2024-01-01'), title: 'Zulu' }, { ...book('2024-01-01'), title: 'Alpha' }, { ...book('2025-01-01'), title: 'Other' } ], searchText: 'jane', statusFilter: '读完', categoryFilter: '文学', yearFilter: '2024', sortMode: 'title', sortDesc: false });
  assert.deepEqual(view.filteredBooks().map(b => b.title), ['Alpha', 'Zulu']);
  view.sortDesc = true;
  assert.deepEqual(view.filteredBooks().map(b => b.title), ['Zulu', 'Alpha']);
});

test('source APIs use persistent cache, retry HTTP failures and reject challenge pages', async () => {
  const result = await build({ entryPoints: ['src/sources.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'metadata-network', setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock-network' }));
      build.onLoad({ filter: /.*/, namespace: 'mock-network' }, () => ({ contents: `
        export const requestUrl = options => globalThis.__bookShelfRequest(options);
        export const getLanguage = () => 'zh';
      ` }));
    } }],
  });
  const sources = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const calls = []; let saved = ''; let challenge = true; let offline = true;
  globalThis.__bookShelfRequest = async ({ url }) => {
    calls.push(url);
    if (url.includes('weread')) return { status: 200, json: { books: [{ bookInfo: { title: 'Example', bookId: '1' } }] } };
    if (url.includes('subject_suggest')) {
      if (offline) { offline = false; return { status: 503 }; }
      return { status: 200, text: JSON.stringify([{ type: 'b', title: 'Example', url: 'https://book.douban.com/subject/42/' }]) };
    }
    return { status: 200, text: challenge ? '<html>Verify you are human</html>' : '<span property="v:itemreviewed">Example</span>' };
  };
  try {
    sources.configureMetadataCache(new MetadataCache(async text => { saved = text; }));
    await Promise.all([sources.searchWeread('Example'), sources.searchWeread('Example')]);
    assert.equal(calls.length, 1);
    const restored = new MetadataCache(); restored.restore(saved); sources.configureMetadataCache(restored);
    await sources.searchWeread('Example'); assert.equal(calls.length, 1);
    await assert.rejects(sources.searchDouban('Example'));
    assert.equal((await sources.searchDouban('Example')).length, 1);
    await sources.searchDouban('Example'); assert.equal(calls.length, 3);
    assert.equal(await sources.fetchDoubanById('42'), null);
    challenge = false;
    assert.equal((await sources.fetchDoubanById('42')).title, 'Example');
    await sources.fetchDoubanById('42'); assert.equal(calls.length, 5);
  } finally { delete globalThis.__bookShelfRequest; }
});

test('stats rendering keeps a custom source named unknown and labels unknown dates accessibly', async () => {
  const result = await build({ entryPoints: ['src/statsView.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'stats-host', setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stats-host' }));
      build.onLoad({ filter: /.*/, namespace: 'stats-host' }, () => ({ contents: `export class ItemView {} export class TFile {} export const getLanguage = () => 'zh';` }));
    } }],
  });
  const { BookStatsView } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const texts = [], labels = [];
  const element = () => ({
    createDiv: options => { if (options?.text) texts.push(options.text); return element(); },
    createSpan: options => { texts.push(options.text); return element(); },
    createEl: () => element(),
    setAttribute: (key, value) => { if (key === 'aria-label') labels.push(value); },
  });
  const view = Object.create(BookStatsView.prototype);
  view.plugin = { collectBooks: () => [book('', '读完', 'unknown')] };
  view.renderReadingSummary(element());
  assert.ok(texts.includes('unknown'));
  assert.ok(labels.includes('未填写有效读完日期: 1'));
  assert.ok(labels.includes('unknown: 1'));
});
