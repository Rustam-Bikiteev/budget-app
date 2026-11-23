const { runtimeSource } = require('./runtime-source.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');

function setup(refresh = async () => {}) {
  const listeners = {};
  const indicator = { dataset: {}, style: { setProperty() {}, removeProperty() {} } };
  const fields = {
    'pull-refresh': indicator, 'pull-refresh-text': { textContent: '' },
    app: { classList: { contains: () => false } }, 'refresh-btn': { disabled: false },
  };
  let calls = 0;
  const window = { scrollY: 0 };
  const context = vm.createContext({
    window,
    document: { getElementById: id => fields[id], addEventListener: (name, handler) => { listeners[name] = handler; } },
    refreshData: async () => { calls++; await refresh(); },
    flash() {},
  });
  context.providedRefresh = context.refreshData;
  for (const path of ['shared/core.js', 'app.js']) {
    vm.runInContext(runtimeSource(path), context);
  }
  vm.runInContext('activeModal = () => null; flash = () => {}; lifecycle.refresh = providedRefresh; initPullToRefresh()', context);
  const start = (x = 0, y = 0, interactive = false) => listeners.touchstart({
    touches: [{ clientX: x, clientY: y }], target: { closest: () => interactive },
  });
  const move = (x, y) => listeners.touchmove({
    touches: [{ clientX: x, clientY: y }], cancelable: true, preventDefault() {},
  });
  return { window, fields, indicator, start, move, calls: () => calls,
    end: () => listeners.touchend({ touches: [] }), cancel: () => listeners.touchcancel(),
    run: code => vm.runInContext(code, context),
  };
}

test('pull refresh requires a vertical threshold from the top', async () => {
  const app = setup();
  app.window.scrollY = 20; app.start(); app.move(0, 200); await app.end();
  app.window.scrollY = 0; app.start(); app.move(0, 50); await app.end();
  app.start(); app.move(180, 150); await app.end();
  app.start(); app.move(0, 160); app.cancel(); await app.end();
  assert.equal(app.calls(), 0);
  app.start(); app.move(0, 160);
  assert.equal(app.indicator.dataset.state, 'ready');
  await app.end();
  assert.equal(app.calls(), 1);
  assert.equal(app.indicator.dataset.state, undefined);
});

test('pull refresh preserves edits, modal input and controls', async () => {
  const app = setup();
  app.start(0, 0, true); app.move(0, 200); await app.end();
  app.run('document.activeElement = {matches: () => true}'); app.start(); app.move(0, 200); await app.end();
  app.run('document.activeElement = null; activeModal = () => ({})');
  app.start(); app.move(0, 200); await app.end();
  assert.equal(app.calls(), 0);
});

test('refresh runs once and can retry after failure', async () => {
  let complete;
  const app = setup(() => new Promise((resolve, reject) => { complete = reject; }));
  app.start(); app.move(0, 200);
  const pending = app.end();
  assert.equal(app.indicator.dataset.state, 'refreshing');
  app.start(); app.move(0, 200); await app.end();
  assert.equal(app.calls(), 1);
  complete(Error('Offline')); await pending;
  assert.equal(app.indicator.dataset.state, undefined);
  app.start(); app.move(0, 200);
  const retry = app.end();
  assert.equal(app.calls(), 2);
  complete(Error('Offline')); await retry;
});
