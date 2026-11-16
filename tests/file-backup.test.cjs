const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const html = readFileSync(join(__dirname, '../free/index.html'), 'utf8');
const exportsSource = html.slice(html.indexOf('async function markBackedUp'), html.indexOf('function pickImportFile'));
const autosaveSource = html.slice(html.indexOf('let fileHandle ='), html.indexOf("document.addEventListener('visibilitychange', () => {", html.indexOf('let fileHandle =')));

function setup() {
  const stored = {};
  const context = vm.createContext({
    meta: { lastBackupAt: 0, lastExportAt: 0 }, Date, Blob, File,
    api: { snapshot: async () => ({ app: 'budget', exportedAt: '2026-11-16T12:00:00Z' }) },
    setMeta: async (key, value) => { stored[key] = value; },
    renderBanner() {}, renderSettings() {}, flash() {}, downloadBlob() {},
    matchMedia: () => ({ matches: false }), navigator: {}, clearTimeout, setTimeout,
  });
  vm.runInContext(exportsSource + autosaveSource, context);
  return { context, stored, run: code => vm.runInContext(code, context) };
}

test('download needs explicit confirmation and confirms the exported snapshot time', async () => {
  const app = setup();
  await app.context.exportBackup();
  assert.equal(app.context.meta.lastBackupAt, 0);
  assert.ok(app.context.meta.lastExportAt > 0);
  await app.context.confirmExportSaved();
  assert.equal(app.stored.lastBackupAt, Date.parse('2026-11-16T12:00:00Z'));
});

test('cancelled sharing does not confirm or record an export', async () => {
  const app = setup();
  app.context.matchMedia = () => ({ matches: true });
  app.context.navigator = { canShare: () => true, share: async () => { const error = new Error('cancel'); error.name = 'AbortError'; throw error; } };
  await app.context.exportBackup();
  assert.equal(app.context.meta.lastBackupAt, 0);
  assert.equal(app.context.meta.lastExportAt, 0);
});

test('concurrent autosaves are serialized and confirmed only after closing the file', async () => {
  const app = setup();
  let active = 0, max = 0, closed = 0;
  app.context.handle = { createWritable: async () => {
    active++;
    max = Math.max(max, active);
    return { write: async () => { await new Promise(resolve => setTimeout(resolve, 5)); }, close: async () => { active--; closed++; } };
  } };
  app.run("fileHandle = handle; filePerm = 'granted';");
  await Promise.all([app.context.writeBackupFile(), app.context.writeBackupFile()]);
  assert.equal(max, 1);
  assert.equal(closed, 2);
  assert.equal(app.context.meta.lastBackupAt, Date.parse('2026-11-16T12:00:00Z'));
});

test('failed file close does not confirm a backup and leaves an error status', async () => {
  const app = setup();
  app.context.handle = { queryPermission: async () => 'granted', createWritable: async () => ({ write: async () => {}, close: async () => { throw Error('disk full'); } }) };
  app.run("fileHandle = handle; filePerm = 'granted';");
  await app.context.writeBackupFile();
  assert.equal(app.context.meta.lastBackupAt, 0);
  assert.equal(app.run('fileError'), 'disk full');
});

test('failed write aborts the stream and a later successful write clears the error', async () => {
  const app = setup();
  let aborted = false;
  app.context.handle = { queryPermission: async () => 'granted', createWritable: async () => ({
    write: async () => { throw Error('write failed'); },
    abort: async () => { aborted = true; },
  }) };
  app.run("fileHandle = handle; filePerm = 'granted';");
  await app.context.writeBackupFile();
  assert.equal(aborted, true);
  assert.equal(app.context.meta.lastBackupAt, 0);
  app.context.handle.createWritable = async () => ({ write: async () => {}, close: async () => {} });
  await app.context.writeBackupFile();
  assert.equal(app.run('fileError'), '');
  assert.ok(app.context.meta.lastBackupAt > 0);
});
