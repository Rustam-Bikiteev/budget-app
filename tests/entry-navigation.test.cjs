const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../shared/core.js'), 'utf8');

function setup() {
  let complete;
  const pending = () => new Promise(resolve => { complete = resolve; });
  const context = vm.createContext({
    document: { addEventListener() {} },
    api: { updateEntry: pending, createEntry: pending, backlogToEntry: pending },
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    state.monthId = 1;
    state.entries = [{id: 'old', month_id: 1, name: 'Old', type: 'planned', category: 'me', planned: 10, actual: 0}];
    cats = [{id: 'me'}];
    getRowValues = () => ({...state.entries[0], name: 'Changed'});
    renderSummary = renderBacklog = renderPlanned = flash = () => {};
  `, context);
  return {
    run: code => vm.runInContext(code, context),
    navigate: () => vm.runInContext("state.monthId = 2; state.entries = [{id: 'new', month_id: 2, name: 'New'}];", context),
    complete: row => complete(row),
  };
}

for (const [name, call] of [
  ['saving', "saveEntry('old')"],
  ['adding', "addEntry('planned')"],
  ['moving from backlog', "moveBacklogEntry('backlog')"],
]) {
  test(`${name} after navigation does not insert a row into another period`, async () => {
    const app = setup();
    const promise = app.run(call);
    app.navigate();
    app.complete({ id: 'old', month_id: 1, name: 'Changed' });
    await promise;
    assert.equal(app.run('state.entries.length'), 1);
    assert.equal(app.run('state.entries[0].id'), 'new');
    assert.equal(app.run('state.entries[0].name'), 'New');
  });
}
