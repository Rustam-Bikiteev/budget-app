const { runtimeSource } = require('./runtime-source.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');

function setup() {
  const status = { dataset: {}, textContent: '', classList: { remove() {} }, replaceChildren() {} };
  const context = vm.createContext({ clearTimeout() {}, document: {
    addEventListener() {}, getElementById: () => status,
  } });
  vm.runInContext(runtimeSource('shared/core.js'), context);
  const run = code => vm.runInContext(code, context);
  return { status, run, context };
}

test('save feedback waits for the entire operation and does not use a delay', async () => {
  const { status, run, context } = setup();
  let finish;
  context.write = () => new Promise(resolve => { finish = resolve; });
  const saving = run('runSaveAction(write)');
  assert.equal(status.textContent, 'Сохраняется');
  finish();
  await saving;
  assert.equal(status.textContent, 'Сохранено');
  assert.equal(status.dataset.state, 'saved');
});

test('concurrent writes keep saving until all complete and preserve any error', async () => {
  const { status, run, context } = setup();
  let completeFirst, failSecond;
  context.first = () => new Promise(resolve => { completeFirst = resolve; });
  context.second = () => new Promise((resolve, reject) => { failSecond = reject; });
  const first = run('runSaveAction(first)');
  const second = run('runSaveAction(second)');
  completeFirst();
  await first;
  assert.equal(status.textContent, 'Сохраняется');
  failSecond(new Error('Storage unavailable'));
  assert.equal(await second, false);
  assert.equal(status.textContent, 'Не удалось сохранить');

  // A late success from another operation cannot hide an earlier failure.
  const third = run('runSaveAction(first)');
  const fourth = run('runSaveAction(second)');
  failSecond(new Error('Denied'));
  await fourth;
  completeFirst();
  await third;
  assert.equal(status.textContent, 'Не удалось сохранить');
  await run('runSaveAction(async () => {})');
  assert.equal(status.textContent, 'Сохранено');
});

test('confirm opening does not claim success; internally handled failure stays visible', async () => {
  const { status, run } = setup();
  await run('runSaveAction(() => {})');
  assert.equal(status.textContent, '');
  await run('runSaveAction(async () => false)');
  assert.equal(status.textContent, 'Не удалось сохранить');
});

test('context reset isolates save status from a late failure in the previous family', async () => {
  const { status, run, context } = setup();
  let finishOld, finishCurrent;
  context.old = () => new Promise(resolve => { finishOld = resolve; });
  context.current = () => new Promise(resolve => { finishCurrent = resolve; });
  const old = run('runSaveAction(old)');
  run('resetContext()');
  const current = run('runSaveAction(current)');
  finishOld(false); await old;
  assert.equal(status.textContent, 'Сохраняется');
  finishCurrent(); await current;
  assert.equal(status.textContent, 'Сохранено');
  assert.equal(run('savePending'), 0);
});
