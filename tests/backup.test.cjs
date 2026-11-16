const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '../free/index.html'), 'utf8');
const constants = html.slice(html.indexOf('const COLORS ='), html.indexOf('coreConfig.copyPrevByDefault'));
const validation = html.slice(html.indexOf('function asId('), html.indexOf('async function onImportFile'));
const context = vm.createContext({ SAFE_ID: /^[A-Za-z0-9_-]{1,64}$/ });
vm.runInContext(constants + validation, context);
const normalize = value => context.normalizeBackup(value);

function backup() {
  return {
    app: 'budget', format: 1,
    months: [{ id: 'm1', year: 2026, month: 11, half: 1, income: 1000.25, saved: 100 }],
    entries: [{ id: 'e1', month_id: 'm1', type: 'planned', category: 'me', name: 'Еда', planned: 300, actual: 250.5 }],
    backlog: [{ id: 'b1', category: 'me', name: 'Покупка', planned: 200 }],
    categories: [{ id: 'me', name: 'Я', color: '#3b82f6' }],
  };
}

test('current backup preserves financial values and category', () => {
  const result = normalize(backup());
  assert.equal(result.months[0].income, 1000.25);
  assert.equal(result.entries[0].actual, 250.5);
  assert.equal(result.backlog[0].planned, 200);
  assert.equal(result.categories[0].name, 'Я');
});

test('legacy format without categories recovers referenced categories', () => {
  const data = backup();
  delete data.format;
  delete data.categories;
  assert.equal(normalize(data).categories[0].id, 'me');
});

test('corrupted amounts, periods, references and structures are rejected', () => {
  const cases = [
    b => { b.months[0].income = '100oops'; },
    b => { b.entries[0].actual = null; },
    b => { b.backlog[0].planned = Infinity; },
    b => { b.months[0].month = 1.5; },
    b => { b.months[0].year = '2026'; },
    b => { b.entries[0].type = 'unknown'; },
    b => { b.entries[0].month_id = 'missing'; },
    b => { b.entries = {}; },
    b => { b.categories = null; },
    b => { b.format = 0; },
    b => { b.format = 2; },
    b => { b.entries[0].id = "bad'id"; },
  ];
  for (const mutate of cases) {
    const data = backup();
    mutate(data);
    assert.throws(() => normalize(data), undefined, mutate.toString());
  }
});

test('duplicate IDs in every collection and duplicate periods are rejected', () => {
  for (const key of ['months', 'entries', 'backlog', 'categories']) {
    const data = backup();
    data[key].push({ ...data[key][0] });
    assert.throws(() => normalize(data), /id повторяется/);
  }
  const data = backup();
  data.months.push({ ...data.months[0], id: 'm2' });
  assert.throws(() => normalize(data), /период повторяется/);
});
