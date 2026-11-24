const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../free/sw.js'), 'utf8');

function setup(overrides = {}) {
  const handlers = {};
  const deleted = [];
  let shell;
  const cache = { addAll: async urls => { shell = urls; }, match: async () => undefined };
  vm.runInNewContext(source, {
    self: { addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting() {}, clients: { claim() {} } },
    caches: { keys: async () => ['another-app-v1', 'budget-free-v1', 'budget-free-v5', 'budget-free-v6', 'budget-free-v7'],
      delete: async key => { deleted.push(key); }, open: async () => cache },
    fetch: async () => { throw Error('Offline'); },
    location: { origin: 'https://example.test' }, URL, Response,
    ...overrides,
  });
  return { handlers, deleted, cache, shell: () => shell };
}

test('activation removes only old Budget caches', async () => {
  const app = setup();
  let done;
  app.handlers.activate({ waitUntil: p => { done = p; } });
  await done;
  assert.deepEqual(app.deleted, ['budget-free-v1', 'budget-free-v5', 'budget-free-v6']);
});

test('installation caches directory and explicit HTML entry points', async () => {
  const app = setup();
  let done;
  app.handlers.install({ waitUntil: p => { done = p; } });
  await done;
  assert.ok(app.shell().includes('./'));
  assert.ok(app.shell().includes('index.html'));
  assert.ok(app.shell().includes('../shared/core.css'));
});

test('offline uses own cache and returns a useful response for cache misses', async () => {
  const app = setup();
  const request = { method: 'GET', url: 'https://example.test/free/index.html' };
  let response;
  const event = { request, respondWith: p => { response = p; }, waitUntil() {} };
  app.cache.match = async () => new Response('cached app');
  app.handlers.fetch(event);
  assert.equal(await (await response).text(), 'cached app');
  app.cache.match = async () => undefined;
  app.handlers.fetch(event);
  assert.equal((await response).status, 503);
});
