import { build } from 'esbuild';
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function load(entry, plugins = []) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false, plugins });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { buildBookNote, patchBookInfo } = await load('src/noteTemplate.ts');
const values = {
  isbn: '9780000000001', author: 'Author', translator: 'Translator', year: '2026',
  publisher: 'Publisher', title: 'A Book', subjectId: '42', rating: '8.6',
  cover: 'https://example.com/cover.jpg', intro: 'A new description.',
};

test('updates actual legacy template table, cover and empty description without changing metadata or notes', () => {
  const original = buildBookNote({}, null, 'A Book') + '\n## My notes\nKeep **this** and [[links]].\n';
  const updated = patchBookInfo(original, values);
  const frontmatter = original.slice(0, original.indexOf('\n---', 4) + 4);
  assert.ok(updated.startsWith(frontmatter));
  for (const value of [values.isbn, values.author, values.translator, values.year, values.publisher, values.rating, values.cover, values.intro, '/subject/42/']) assert.ok(updated.includes(value), value);
  assert.ok(updated.endsWith('\n## My notes\nKeep **this** and [[links]].\n'));
  assert.equal(patchBookInfo(updated, values), updated, 'second completion is idempotent');
});

test('supports fully quoted cards and local covers with spaces; keeps custom fields and CRLF', () => {
  const original = ['---', 'title: original', '---', '> [!bookinfo]+ Book', '> ![bookcover|180](old.jpg)', '> | ISBN | old |', '> | 自定义 | personal |', '', '> [!abstract]- Description', '> （暂无简介）', '', 'My notes', ''].join('\r\n');
  const updated = patchBookInfo(original, { ...values, cover: 'my cover (1).webp' });
  assert.ok(updated.includes('> ![bookcover|180](<my cover (1).webp>)\r\n'));
  assert.ok(updated.includes(`> | ISBN | ${values.isbn} |\r\n`));
  assert.ok(updated.includes('> | 自定义 | personal |\r\n'));
  assert.equal(updated.replace(/\r\n/g, '').includes('\n'), false);
});

test('missing source and empty fields retain values; manual description survives overwrite intent', () => {
  const original = ['> [!bookinfo] Book', '> ![bookcover|200](old.jpg)', '> | ISBN | old-isbn |', '> | 来源 | [old](https://old.example) |', '> | 作者 | user-author |', '', '> [!abstract] Description', '> My own introduction.', ''].join('\n');
  const updated = patchBookInfo(original, { isbn: 'new-isbn', author: '', subjectId: '', intro: 'Incoming intro' });
  assert.ok(updated.includes('| ISBN | new-isbn |'));
  for (const retained of ['old.jpg', '[old](https://old.example)', 'user-author', 'My own introduction.']) assert.ok(updated.includes(retained));
  assert.ok(!updated.includes('Incoming intro'));
  assert.equal(patchBookInfo(original, {}), original);
});

test('notes without cards, fenced examples and later cards/descriptions remain untouched', () => {
  const example = '```markdown\n> [!bookinfo] Example\n> | ISBN | example |\n```\n';
  assert.equal(patchBookInfo(example + '\nMy plain note\n', values), example + '\nMy plain note\n');
  const first = '> [!bookinfo] First\n> | ISBN | first |\n';
  const later = '\n## Journal\n> [!abstract] unrelated\n> （暂无简介）\n\n> [!bookinfo] Second\n> | ISBN | second |\n';
  const updated = patchBookInfo(example + first + later, values);
  assert.ok(updated.startsWith(example));
  assert.ok(updated.includes(`| ISBN | ${values.isbn} |`));
  assert.ok(updated.endsWith(later));
});

test('only recognized table rows change, pipe values remain a cell and code inside cards is preserved', () => {
  const original = '> [!bookinfo] Book\n> ```\n> | 作者 | literal example |\n> ```\n> | 出版社 | old |\n> | 未知 | keep |\n';
  const updated = patchBookInfo(original, { publisher: 'One | Two\nPress', author: 'new' });
  assert.ok(updated.includes('> | 出版社 | One \\| Two Press |'));
  assert.ok(updated.includes('> | 作者 | literal example |'));
  assert.ok(updated.includes('> | 未知 | keep |'));
});

const { FetchModal } = await load('src/fetchModal.ts', [{ name: 'bookinfo-host', setup(builder) {
  builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'bookinfo' }));
  builder.onResolve({ filter: /^\.\/sources$/ }, () => ({ path: 'sources', namespace: 'bookinfo' }));
  builder.onLoad({ filter: /.*/, namespace: 'bookinfo' }, ({ path }) => ({ contents: path === 'host' ? `
    export class Modal {} export class Notice {} export class TFile {} export class TFolder {}
    export const normalizePath = p => p;
    export const getLanguage = () => 'zh';
  ` : `
    export const fetchDoubanById = async () => globalThis.__bookinfoDouban;
    export const fetchDoubanByIsbn = fetchDoubanById; export const fetchDouban = fetchDoubanById;
    export const looksLikeIsbn = () => false; export const searchDouban = async () => [];
    export const searchDoubanByIsbn = searchDouban; export const searchWeread = searchDouban;
    export const coverFileNameFor = () => 'cover.jpg'; export const downloadImage = async () => null;
  ` }));
} }]);

function host(body, attributes = {}) {
  let text = body; let writes = 0; let reads = 0;
  const fm = { ...attributes };
  const file = { basename: 'A Book', path: 'books/A Book.md' };
  const modal = Object.create(FetchModal.prototype);
  Object.assign(modal, {
    file, overwrite: false, useDouban: true, keyword: 'A Book',
    plugin: { settings: { authorField: 'writers', coverField: 'image', downloadCover: false } },
    app: {
      metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
      fileManager: { processFrontMatter: async (_file, callback) => callback(fm) },
      vault: {
        read: async () => { reads++; return text; },
        process: async (_file, callback) => { writes++; text = callback(text + '\nConcurrent user note.'); },
      },
    },
    setStatus: () => {}, ensureSameBook: async () => true,
  });
  return { modal, fm, text: () => text, writes: () => writes, reads: () => reads };
}

test('real apply uses retained custom fields and downloaded cover; preserves description and concurrent notes', async () => {
  globalThis.__bookinfoDouban = { subjectId: '42', publisher: 'Incoming Press', rating: '8.6', yearPublished: '2026', desc: 'Incoming intro' };
  try {
    const original = buildBookNote({}, null, 'A Book').replace('（暂无简介）', 'My handwritten introduction.');
    const h = host(original, { writers: ['Chosen Author'], publisher: 'Chosen Press', title: '[[A Book]]', desc: 'Existing description' });
    h.modal.plugin.settings.downloadCover = true;
    h.modal.downloadCover = async () => 'cover.webp';
    await h.modal.apply({ title: 'A Book', author: 'Incoming Author', cover: 'https://example.com/cover.jpg', subjectId: '42' });
    assert.equal(h.fm.writers[0], 'Chosen Author');
    assert.ok(h.text().includes('- Chosen Author'));
    assert.ok(h.text().includes('Chosen Press'));
    assert.ok(!h.text().includes('Incoming Author'));
    assert.ok(!h.text().includes('Incoming Press'));
    assert.ok(h.text().includes('(cover.webp)'));
    assert.ok(h.text().includes('/subject/42/'));
    assert.ok(h.text().includes('My handwritten introduction.'));
    assert.ok(h.text().endsWith('Concurrent user note.'));
    assert.equal(h.writes(), 1);
  } finally { delete globalThis.__bookinfoDouban; }
});

test('real apply avoids redundant body writes and never creates cards in legacy plain notes', async () => {
  globalThis.__bookinfoDouban = null;
  try {
    const h = host('Plain note with no generated card.');
    await h.modal.apply({ author: 'Author' });
    assert.equal(h.fm.writers[0], 'Author');
    assert.equal(h.text(), 'Plain note with no generated card.');
    assert.equal(h.writes(), 0);
    const current = patchBookInfo(buildBookNote({}, null, 'A Book'), { author: 'Author' });
    const h2 = host(current, { writers: ['Author'] });
    await h2.modal.apply({ author: 'Author' });
    assert.equal(h2.writes(), 0);
  } finally { delete globalThis.__bookinfoDouban; }
});

test('cancelling the same-book confirmation leaves properties and body unchanged', async () => {
  globalThis.__bookinfoDouban = null;
  try {
    const h = host(buildBookNote({}, null, 'A Book'));
    h.modal.ensureSameBook = async () => false;
    await h.modal.apply({ author: 'Wrong Author' });
    assert.deepEqual(h.fm, {});
    assert.equal(h.reads(), 0);
    assert.equal(h.writes(), 0);
  } finally { delete globalThis.__bookinfoDouban; }
});

test('overwrite updates retained attributes and card together; Douban-only cover is usable', async () => {
  globalThis.__bookinfoDouban = { subjectId: '42', cover: 'https://example.com/douban.jpg', publisher: 'New Press', rating: '9.0', desc: 'Fetched intro' };
  try {
    const h = host(buildBookNote({}, null, 'A Book'), { writers: ['Old Author'], publisher: 'Old Press' });
    h.modal.overwrite = true;
    await h.modal.apply({ author: 'New Author', subjectId: '42' });
    assert.deepEqual(h.fm.writers, ['New Author']);
    for (const value of ['New Author', 'New Press', '9.0', 'Fetched intro', 'https://example.com/douban.jpg']) assert.ok(h.text().includes(value), value);
    assert.ok(!h.text().includes('Old Author'));
    assert.equal(h.writes(), 1);
    await h.modal.apply({ author: 'New Author', subjectId: '42' });
    assert.equal(h.writes(), 1, 'unchanged completion must not add a body write');
  } finally { delete globalThis.__bookinfoDouban; }
});

test('BOM frontmatter and tilde-fenced examples are not treated as real cards', () => {
  const yaml = '\uFEFF---\ndescription: |\n  > [!bookinfo] YAML text\n  > | ISBN | yaml-example |\n---\n';
  const code = '~~~markdown\n> [!bookinfo] Example\n> | ISBN | code-example |\n~~~\n';
  const card = '> [!bookinfo] Real\n> | ISBN | old |\n';
  const updated = patchBookInfo(yaml + code + card, { isbn: values.isbn });
  assert.ok(updated.startsWith(yaml + code));
  assert.ok(updated.endsWith(`> [!bookinfo] Real\n> | ISBN | ${values.isbn} |\n`));
});
