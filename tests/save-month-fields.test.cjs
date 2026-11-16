const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../shared/core.js'), 'utf8');

function setup(updateMonth) {
  const fields = {
    'income-inp': { value: '100' },
    'saved-inp': { value: '10' },
  };
  const context = vm.createContext({
    document: { addEventListener() {}, getElementById: id => fields[id] },
    api: { updateMonth },
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    state.monthId = 1;
    state.income = 50;
    state.saved = 5;
    flash = () => {};
    renderSummary = () => {};
  `, context);
  return {
    save: () => vm.runInContext('saveMonthFields()', context),
    read: () => JSON.parse(vm.runInContext('JSON.stringify(state)', context)),
    run: code => vm.runInContext(code, context),
  };
}

test('failed write preserves confirmed amounts and identical input can be retried', async () => {
  let calls = 0;
  const app = setup(async (id, patch) => {
    assert.equal(id, 1);
    assert.equal(patch.income, 100);
    assert.equal(patch.saved, 10);
    if (++calls === 1) throw new Error('Storage unavailable');
  });
  await assert.rejects(app.save(), /Storage unavailable/);
  assert.equal(app.read().income, 50);
  assert.equal(app.read().saved, 5);
  await app.save();
  assert.equal(calls, 2);
  assert.equal(app.read().income, 100);
  assert.equal(app.read().saved, 10);
  await app.save();
  assert.equal(calls, 2);
});

test('amounts stay unconfirmed until the write completes', async () => {
  let complete;
  const app = setup(() => new Promise(resolve => { complete = resolve; }));
  const pending = app.save();
  assert.equal(app.read().income, 50);
  assert.equal(app.read().saved, 5);
  complete();
  await pending;
  assert.equal(app.read().income, 100);
  assert.equal(app.read().saved, 10);
});

test('finishing a write after navigation does not change another period', async () => {
  let complete;
  const app = setup(() => new Promise(resolve => { complete = resolve; }));
  const pending = app.save();
  app.run('state.monthId = 2; state.income = 200; state.saved = 20;');
  complete();
  await pending;
  assert.equal(app.read().monthId, 2);
  assert.equal(app.read().income, 200);
  assert.equal(app.read().saved, 20);
});
