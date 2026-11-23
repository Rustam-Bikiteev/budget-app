const { test, expect } = require('./fixtures.cjs');

test('IndexedDB adapter: shared contract, rollback and version-1 reserve migration', async ({ page }) => {
  await page.goto('/free/');
  const result = await page.evaluate(async () => {
    const { createIndexedDBAdapter } = await import('/storage/indexeddb.mjs');
    const { storageContract } = await import('/tests/storage-contract.mjs');
    const categories = [{ id: 'one', name: 'Категория', color: '#123456' }];
    let id = 0;
    const make = name => createIndexedDBAdapter({ indexedDB, name, uid: () => String(++id),
      getCategories: () => categories, defaultCategories: categories });
    const adapter = make('contract');
    const { month } = await storageContract(adapter);
    const backlog = await adapter.createBacklog({ category: 'one', name: 'Сохранить', planned: 100 });
    let rejected = false;
    try { await adapter.backlogToEntry(backlog.id, 'missing'); } catch { rejected = true; }
    const unchanged = (await adapter.listBacklog()).some(row => row.id === backlog.id);
    await adapter.close();

    await new Promise((resolve, reject) => {
      const request = indexedDB.open('legacy-contract', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('months', { keyPath: 'id' }).createIndex('period', ['year','month','half'], { unique: true });
        db.createObjectStore('entries', { keyPath: 'id' }).createIndex('month_id', 'month_id');
        db.createObjectStore('backlog', { keyPath: 'id' }); db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction(['months','entries'], 'readwrite');
        transaction.objectStore('months').add({ id: 'm', year: 2026, month: 11, half: 1, income: 1000, saved: 0 });
        transaction.objectStore('entries').add({ id: 'r', month_id: 'm', type: 'mandatory', category: 'one', name: 'Непредвиденные', planned: 100, actual: 20 });
        transaction.objectStore('entries').add({ id: 'p', month_id: 'm', type: 'mandatory', category: 'one', name: 'Платёж', planned: 50, actual: 0 });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = () => reject(transaction.error);
      };
    });
    const migrated = make('legacy-contract');
    const before = await migrated.getMonth('m');
    await migrated.updateEntry('r', { name: 'Подушка' });
    await migrated.updateEntry('p', { name: 'Непредвиденные' });
    const backup = await migrated.snapshot();
    await migrated.close();
    const reopened = make('legacy-contract'), after = await reopened.getMonth('m');
    await reopened.close();
    const restored = make('restore-contract');
    await restored.restore(backup);
    const restoredEntries = (await restored.getMonth('m')).entries;
    await restored.close();
    return { rejected, unchanged, before: before.entries, after: after.entries, backup, restoredEntries, month };
  });
  expect(result.rejected && result.unchanged).toBe(true);
  expect(result.before.find(row => row.id === 'r').is_reserve).toBe(true);
  expect(result.after.find(row => row.id === 'r')).toMatchObject({ name: 'Подушка', is_reserve: true });
  expect(result.after.find(row => row.id === 'p')).toMatchObject({ name: 'Непредвиденные', is_reserve: false });
  expect(result.backup.format).toBe(2);
  expect(result.restoredEntries).toEqual(result.after);
});

test('cloud view: explicit reserve control survives rename without guessing ordinary names', async ({ page }) => {
  await page.goto('/design/preview.html?theme=lilac');
  await page.getByRole('button', { name: 'Платежи', exact: true }).click();
  const row = page.locator('[data-eid="12"]');
  await row.getByRole('checkbox', { name: 'Резерв: Коммунальные услуги', exact: true }).check();
  const name = row.locator('[data-f=name]');
  await name.fill('Подушка'); await name.press('Tab');
  await expect(row.getByRole('checkbox', { name: 'Резерв: Подушка', exact: true })).toBeChecked();
  expect(await page.evaluate(() => state.entries.find(row => row.id === 12).is_reserve)).toBe(true);
  await row.getByRole('checkbox', { name: 'Резерв: Подушка', exact: true }).uncheck();
  await row.locator('[data-f=name]').fill('Непредвиденные'); await row.locator('[data-f=name]').press('Tab');
  expect(await page.evaluate(() => state.entries.find(row => row.id === 12).is_reserve)).toBe(false);
});
