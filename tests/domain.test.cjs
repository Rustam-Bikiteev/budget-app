const { test } = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../shared/domain.mjs');

test('explicit reserve survives rename and ordinary payment names never change its type', () => {
  const reserve = domain.normalizeEntry({ type: 'mandatory', name: 'Непредвиденные', planned: 100, actual: 20 });
  assert.equal(domain.isReserve({ ...reserve, name: 'Подушка' }), true);
  assert.equal(domain.isReserve(domain.normalizeEntry({ ...reserve, is_reserve: false })), false);
  assert.equal(domain.isReserve({ type: 'mandatory', name: 'Непредвиденные' }), false);
});

test('local and cloud summaries intentionally use different reserve/allocation rules', () => {
  const input = { income: 1000, saved: 100, entries: [
    { type: 'mandatory', name: 'Резерв', is_reserve: true, planned: 200, actual: 50 },
    { type: 'planned', planned: 100, actual: 130 },
  ] };
  assert.deepEqual(domain.localSummary(input), { mandatory: 200, spent: 130, allowed: 700, remain: 570 });
  assert.deepEqual(domain.cloudSummary(input), { mand: 150, mandPaid: 0, life: 750, allocated: 130, spent: 130, free: 620 });
});

test('periods keep local/current-month and cloud/previous-sprint boundary rules', () => {
  assert.deepEqual(domain.initialPeriod(new Date(2027, 0, 9), 'local'), { year: 2027, month: 1, half: 2 });
  assert.deepEqual(domain.initialPeriod(new Date(2027, 0, 9), 'cloud'), { year: 2026, month: 12, half: 2 });
  assert.deepEqual(domain.shiftPeriod({ year: 2027, month: 1, half: 1 }, -1), { year: 2026, month: 12, half: 2 });
  assert.deepEqual(domain.shiftPeriod({ year: 2026, month: 12, half: 2 }, 1), { year: 2027, month: 1, half: 1 });
  assert.equal(domain.periodDaysLeft({ year: 2026, month: 11, half: 1 }, new Date(2026, 10, 24)), 1);
  assert.equal(domain.periodDaysLeft({ year: 2026, month: 11, half: 1 }, new Date(2026, 10, 25)), null);
});

test('category order uses supplied family categories, including unknown categories', () => {
  const rows = [{ category: 'unknown' }, { category: 'b' }, { category: 'a' }];
  assert.deepEqual(domain.sortCategories(rows, [{ id: 'a' }, { id: 'b' }]).map(row => row.category), ['a','b','unknown']);
  assert.equal(rows[0].category, 'unknown');
});
