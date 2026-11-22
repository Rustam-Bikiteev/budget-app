const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const core = readFileSync(join(__dirname, '../shared/core.js'), 'utf8');
const cloud = readFileSync(join(__dirname, '../app.js'), 'utf8');

function setup(overrides = {}) {
  const fields = {};
  const field = id => fields[id] ||= { value: '', textContent: '', disabled: false, classList: { toggle() {} }, focus() {} };
  field('q-offplan').checked = true;
  field('q-source').value = 'free';
  field('q-sum').value = '20';
  field('q-name').value = 'Аптека';
  field('sheet-overlay').querySelectorAll = () => ['q-source', 'q-sum', 'q-name', 'q-save'].map(field);
  const calls = [];
  const api = Object.fromEntries(['createEntry', 'updateEntry', 'updateMonth'].map(method => [method, async (...args) => {
    calls.push({ method, args });
    if (overrides[method]) return overrides[method](...args);
    if (method === 'createEntry') return { id: 9, ...args[0] };
  }]));
  const context = vm.createContext({ document: { addEventListener() {}, getElementById: field }, api });
  vm.runInContext(core, context);
  vm.runInContext(cloud, context);
  const run = code => vm.runInContext(code, context);
  run(`
    state.monthId = quickMonthId = 1;
    state.income = 200; state.saved = 50;
    state.allMonths = [{ id: 1, saved: 50 }];
    state.entries = [{ id: 2, type: 'mandatory', name: 'Непредвиденные', planned: 40, actual: 5 }];
    renderAll = flash = closeModal = () => {};
  `);
  return {
    calls, fields, run,
    save: () => run('saveQuick({preventDefault() {}})'),
    state: () => JSON.parse(run('JSON.stringify(state)')),
  };
}

test('plus opens a normal new record with no source selector', () => {
  const app = setup();
  app.run('renderWho = openModal = () => {}; openQuick()');
  assert.equal(app.fields['q-offplan'].checked, false);
  assert.equal(app.fields['q-actual'].value, '');
  assert.equal(app.fields['q-sum-label'].textContent, 'План, ₽');
});

test('normal records only allocate plan and never merge with a same-name expense', async () => {
  const app = setup();
  app.fields['q-offplan'].checked = false;
  app.fields['q-source'].value = 'saved';
  app.run("state.entries.push({id:3,type:'planned',category:'shared',name:'Аптека',planned:50,actual:10})");
  await app.save();
  const expense = app.state().entries.find(e => e.id === 9);
  assert.equal(expense.planned, 20);
  assert.equal(expense.actual, 0);
  assert.equal(app.state().saved, 50);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].method, 'createEntry');
  assert.equal(app.state().entries.find(e => e.id === 3).actual, 10);
});

test('normal records accept separate fact and zero plan without debiting sources', async () => {
  const app = setup();
  app.fields['q-offplan'].checked = false;
  app.fields['q-sum'].value = '';
  app.run("document.getElementById('q-actual').value = '15'");
  await app.save();
  assert.equal(app.state().entries.find(e => e.id === 9).actual, 15);
  assert.equal(app.state().entries.find(e => e.id === 9).planned, 0);
  assert.equal(app.calls.length, 1);
});

for (const source of ['free', 'saved', 'reserve']) {
  test(`new expense uses ${source} without double-counting`, async () => {
    const app = setup();
    app.fields['q-source'].value = source;
    const before = app.run('calc().free');
    await app.save();
    const state = app.state();
    const expense = state.entries.find(e => e.id === 9);
    assert.equal(expense.actual, 20);
    assert.equal(expense.planned, 20);
    assert.equal(state.saved, source === 'saved' ? 30 : 50);
    assert.equal(state.allMonths[0].saved, state.saved);
    assert.equal(state.entries[0].actual, source === 'reserve' ? 25 : 5);
    assert.equal(app.run('calc().free'), before - (source === 'free' ? 20 : 0));
    assert.equal(app.fields['q-save'].disabled, false);
  });
}

test('existing expense retains its unspent plan when extra money is allocated', async () => {
  const app = setup();
  app.fields['q-source'].value = 'saved';
  app.run("state.entries.push({id:3,type:'planned',category:'shared',name:'Аптека',planned:50,actual:10})");
  const before = app.run('calc().free');
  await app.save();
  const expense = app.state().entries.find(e => e.id === 3);
  assert.equal(expense.planned, 70);
  assert.equal(expense.actual, 30);
  assert.equal(app.run('calc().free'), before);
  assert.equal(app.calls.some(c => c.method === 'createEntry'), false);
});

test('already overspent expense only takes the newly entered amount from savings', async () => {
  const app = setup();
  app.fields['q-source'].value = 'saved';
  app.run("state.entries.push({id:3,type:'planned',category:'shared',name:'Аптека',planned:10,actual:50})");
  const before = app.run('calc().free');
  await app.save();
  const expense = app.state().entries.find(e => e.id === 3);
  assert.equal(expense.planned, 70);
  assert.equal(expense.actual, 70);
  assert.equal(app.state().saved, 30);
  assert.equal(app.run('calc().free'), before);
});

test('insufficient source and invalid amounts do not write anything', async () => {
  const app = setup();
  app.fields['q-source'].value = 'reserve';
  app.fields['q-sum'].value = '36';
  await app.save();
  assert.equal(app.fields['q-save'].disabled, true);
  app.fields['q-source'].value = 'saved';
  app.fields['q-sum'].value = '51';
  await app.save();
  for (const amount of ['-20', '0', 'bad']) {
    app.fields['q-sum'].value = amount;
    await app.save();
  }
  assert.equal(app.calls.length, 0);
});

test('free money can go into deficit so a real expense can still be recorded', async () => {
  const app = setup();
  app.run('state.income = 0');
  await app.save();
  assert.equal(app.state().entries.length, 2);
  assert.ok(app.run('calc().free') < 0);
});

test('failed source debit does not create an expense and permits retry', async () => {
  let fail = true;
  const app = setup({ updateMonth: async () => { if (fail) throw Error('Offline'); } });
  app.fields['q-source'].value = 'saved';
  await app.save();
  assert.equal(app.calls.length, 1);
  assert.equal(app.state().saved, 50);
  assert.match(app.fields['q-error'].textContent, /Не удалось/);
  fail = false;
  await app.save();
  assert.equal(app.state().saved, 30);
  assert.equal(app.state().entries.length, 2);
});

test('failed expense write refunds the selected source', async () => {
  const app = setup({ createEntry: async () => { throw Error('Offline'); } });
  app.fields['q-source'].value = 'reserve';
  await app.save();
  assert.deepEqual(app.calls.filter(c => c.method === 'updateEntry').map(c => c.args[1].actual), [25, 5]);
  assert.equal(app.state().entries.length, 1);
  assert.equal(app.state().entries[0].actual, 5);
  assert.equal(app.run('quickBlocked'), false);
});

test('failed refund is explicit and blocks repeated debits', async () => {
  let updates = 0;
  const app = setup({
    createEntry: async () => { throw Error('Offline'); },
    updateMonth: async () => { if (++updates === 2) throw Error('Offline'); },
  });
  app.fields['q-source'].value = 'saved';
  await app.save();
  assert.equal(app.state().saved, 30);
  assert.match(app.fields['q-error'].textContent, /источник уменьшен/);
  assert.equal(app.fields['q-save'].disabled, true);
  await app.save();
  assert.equal(updates, 2);
});

test('double submit is ignored and navigation cannot put the expense into another sprint', async () => {
  let complete;
  const app = setup({ createEntry: row => new Promise(resolve => { complete = () => resolve({ id: 9, ...row }); }) });
  const pending = app.save();
  await app.save();
  assert.equal(app.calls.length, 1);
  app.run('state.monthId = 2; state.entries = []; state.saved = 100');
  complete();
  await pending;
  assert.equal(app.calls[0].args[0].month_id, 1);
  assert.equal(app.state().entries.length, 0);
  assert.equal(app.state().saved, 100);
});
