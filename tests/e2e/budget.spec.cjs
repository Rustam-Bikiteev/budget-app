const fs = require('node:fs/promises');
const { test, expect, openFree, guardContext } = require('./fixtures.cjs');

test('cloud UI: new period, expense edit, cover overspend, move purchase', async ({ page }) => {
  await page.goto('/design/preview.html?theme=lilac');
  await expect(page.locator('#lilac-free')).not.toBeEmpty();
  await page.locator('#month-label').click();
  await page.getByRole('button', { name: 'Следующий спринт', exact: true }).click();
  await expect(page.locator('#empty-state')).toBeVisible();
  await page.locator('#copy-cb').uncheck();
  await page.getByRole('button', { name: 'Создать бюджет', exact: true }).click();
  await expect(page.locator('#empty-state')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Добавить трату', exact: true })).toBeEnabled();
  await page.locator('#lilac-budget-editor summary').click();
  await page.locator('#income-inp').fill('10000');
  await page.locator('#income-inp').press('Tab');
  await page.locator('#saved-inp').fill('2000');
  await page.locator('#saved-inp').press('Tab');

  await page.getByRole('button', { name: 'Добавить трату', exact: true }).click();
  await page.locator('#q-who').getByRole('button', { name: 'Настя', exact: true }).click();
  await page.locator('#q-name').fill('Тестовая покупка');
  await page.locator('#q-sum').fill('1000');
  await page.locator('#q-actual').fill('800');
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('#sheet-overlay')).toBeHidden();
  await page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Траты', exact: true }).click();
  const row = page.locator('#planned-body .row').filter({ has: page.getByRole('textbox', { name: 'Название: Тестовая покупка', exact: true }) });
  await expect(row.locator('.cloud-category')).toHaveValue('nastya');
  await expect(row.locator('[data-f=planned]')).toHaveValue('1000');
  await expect(row.locator('[data-f=actual]')).toHaveValue('800');
  await row.locator('[data-f=actual]').fill('1500');
  await row.locator('[data-f=actual]').press('Enter');
  await expect(row.locator('.rem')).toBeEnabled();
  await row.locator('.rem').click();
  await page.getByRole('button', { name: /Из отложенных/ }).click();
  await expect(row.locator('[data-f=planned]')).toHaveValue('1500');
  await expect(row.locator('[data-f=actual]')).toHaveValue('1500');
  await expect(page.locator('#saved-inp')).toHaveValue('1500');
  await expect(row.locator('.rem')).toBeDisabled();

  await row.getByRole('button', { name: 'В будущие покупки: Тестовая покупка', exact: true }).click();
  await expect(page.locator('#confirm-overlay')).toBeVisible();
  await page.locator('#confirm-ok').click();
  await expect(row).toHaveCount(0);
  await page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Будущие покупки', exact: true }).click();
  await page.getByRole('button', { name: 'В спринт: Тестовая покупка', exact: true }).click();
  await expect(page.getByRole('button', { name: 'В спринт: Тестовая покупка', exact: true })).toHaveCount(0);
  await page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Траты', exact: true }).click();
  await expect(row.locator('[data-f=planned]')).toHaveValue('1500');
  // The confirmation explains that backlog has no actual amount.
  await expect(row.locator('[data-f=actual]')).toHaveValue('');
});

test('free: real IndexedDB persistence and JSON restore in a clean browser context', async ({ page, browser, baseURL }, testInfo) => {
  await openFree(page);
  await page.getByRole('button', { name: 'Создать бюджет', exact: true }).click();
  await expect(page.locator('#budget-view')).toBeVisible();
  await page.locator('#income-inp').fill('12500');
  await page.locator('#income-inp').press('Tab');
  await page.locator('#saved-inp').fill('2500');
  await page.locator('#saved-inp').press('Tab');
  await page.getByRole('button', { name: '+ Добавить трату', exact: true }).click();
  const row = page.locator('#planned-body tr[data-eid]');
  await row.getByRole('textbox', { name: 'Название записи' }).fill('Проверка копии');
  await row.getByRole('textbox', { name: 'Название записи' }).press('Tab');
  await row.getByRole('spinbutton', { name: 'Плановая сумма', exact: true }).fill('1200');
  await row.getByRole('spinbutton', { name: 'Плановая сумма', exact: true }).press('Tab');
  await row.getByRole('spinbutton', { name: 'Фактическая сумма', exact: true }).fill('875');
  await row.getByRole('spinbutton', { name: 'Фактическая сумма', exact: true }).press('Tab');
  // Wait for the actual IndexedDB transaction, not a mocked api or UI-only value.
  await expect.poll(() => readStore(page, 'entries')).toMatchObject([{ name: 'Проверка копии', planned: 1200, actual: 875 }]);
  await page.reload();
  await expect(row.getByRole('textbox', { name: 'Название записи' })).toHaveValue('Проверка копии');
  await expect(row.getByRole('spinbutton', { name: 'Фактическая сумма', exact: true })).toHaveValue('875');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.locator('#settings-overlay').getByRole('button', { name: 'Сохранить копию', exact: true }).click();
  const download = await downloading;
  const backupPath = testInfo.outputPath('budget-export.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  expect(backup).toMatchObject({ app: 'budget', format: 2,
    months: [{ income: 12500, saved: 2500 }],
    entries: [{ name: 'Проверка копии', planned: 1200, actual: 875 }],
  });

  // No cookies/storage copied; the same network/error guard applies.
  const clean = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const assertSafe = await guardContext(clean, baseURL);
  try {
    const restored = await clean.newPage();
    await openFree(restored);
    expect(await readStore(restored, 'months')).toEqual([]);
    expect(await readStore(restored, 'entries')).toEqual([]);
    await restored.getByRole('button', { name: 'Настройки', exact: true }).click();
    const choosing = restored.waitForEvent('filechooser');
    await restored.getByRole('button', { name: 'Восстановить из файла', exact: true }).click();
    await (await choosing).setFiles(backupPath);
    await restored.locator('#confirm-ok').click();
    await expect.poll(() => readStore(restored, 'entries')).toEqual(backup.entries);
    await expect.poll(() => readStore(restored, 'months')).toEqual(backup.months);
    await restored.reload();
    await expect(restored.locator('#income-inp')).toHaveValue('12500');
    await expect(restored.locator('#saved-inp')).toHaveValue('2500');
    await expect(restored.getByRole('textbox', { name: 'Название записи' })).toHaveValue('Проверка копии');
    await expect(restored.getByRole('spinbutton', { name: 'Фактическая сумма', exact: true })).toHaveValue('875');
    assertSafe();
  } finally {
    await clean.close();
  }
});

function readStore(page, name) {
  return page.evaluate(store => new Promise((resolve, reject) => {
    const opening = indexedDB.open('budget-free');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction(store, 'readonly');
      const reading = tx.objectStore(store).getAll();
      tx.oncomplete = () => { db.close(); resolve(reading.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), name);
}

test('cloud: clear plan labels, discoverable editor and failed entry save can retry', async ({ page }, testInfo) => {
  await page.goto('/design/preview.html?theme=lilac');
  await expect(page.locator('#lilac-allocated')).toHaveText(/47\s*100/);
  await expect(page.locator('#lilac-allocation-note')).toHaveText(/46\s*500.*600.*47\s*100/);
  await expect(page.getByText('Изменить доход и накопления', { exact: false })).toBeVisible();
  await page.getByText('Изменить доход и накопления', { exact: false }).click();
  const income = page.locator('#income-inp');
  await expect(income).toBeVisible();
  await page.locator('#lilac-budget-editor summary').press('Tab');
  await expect(income).toBeFocused();
  await expect(income).toHaveCSS('outline-color', 'rgb(92, 70, 144)');
  await expect(income).toHaveCSS('font-variant-numeric', 'tabular-nums');
  await page.locator('#lilac-budget-editor summary').click();
  await page.screenshot({ path: testInfo.outputPath('cloud-home-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 760 });
  await expect(page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Будущие покупки', exact: true })).toBeVisible();
  await expect(page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Аналитика', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cloud-home-mobile.png'), fullPage: true });
  await page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Будущие покупки', exact: true }).click();
  await expect(page.locator('.lilac-page-title')).toHaveText('Будущие покупки');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cloud-future-purchases-mobile.png'), fullPage: true });
  await page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Аналитика', exact: true }).click();
  await expect(page.locator('#lilac-left')).toHaveText(/23\s*950/);
  await page.screenshot({ path: testInfo.outputPath('cloud-analytics-mobile.png'), fullPage: true });
  await page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Траты', exact: true }).click();
  const actual = page.locator('#planned-body [data-f=actual]').first();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator('.lilac-bottom-nav')).toHaveCSS('bottom', '8px');
  await expect(page.locator('#expense-fab')).toHaveCSS('bottom', '98px');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(actual).toHaveCSS('min-height', '44px');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    const widths = await page.locator('#planned-body .r-plan').first().evaluate(row => {
      const name = row.querySelector('[data-f=name]');
      const amounts = [...row.querySelectorAll('[data-f=planned], [data-f=actual]')];
      const fields = [name, ...amounts];
      const original = fields.map(field => field.value);
      const measure = field => {
        const style = getComputedStyle(field);
        const text = document.createElement('span');
        text.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        text.style.fontFamily = style.fontFamily;
        text.style.fontSize = style.fontSize;
        text.style.fontWeight = style.fontWeight;
        text.style.fontVariantNumeric = style.fontVariantNumeric;
        text.textContent = field.value;
        document.body.append(text);
        const available = field.getBoundingClientRect().width - parseFloat(style.borderLeftWidth) -
          parseFloat(style.borderRightWidth) - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const fits = text.getBoundingClientRect().width <= available;
        text.remove();
        return { fits, width: field.clientWidth, align: style.textAlign };
      };
      name.value = 'Длинное название запланированной покупки';
      amounts.forEach(field => { field.value = '10000'; });
      const short = fields.map(measure);
      amounts.forEach(field => { field.value = '12345678'; });
      const long = fields.map(measure);
      const contained = row.lastElementChild.getBoundingClientRect().right <= row.getBoundingClientRect().right;
      fields.forEach((field, index) => { field.value = original[index]; });
      return { short, long, contained };
    });
    expect(widths.short.slice(1)).toMatchObject([{ fits: true, align: 'left' }, { fits: true, align: 'left' }]);
    expect(widths.long.slice(1)).toMatchObject([{ fits: true }, { fits: true }]);
    widths.long.slice(1).forEach((field, i) => expect(field.width).toBeGreaterThan(widths.short[i + 1].width));
    expect(widths.long[0].width).toBeLessThan(widths.short[0].width);
    expect(widths.long[0].fits).toBe(false);
    expect(widths.contained).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 760 });
  const remove = page.getByRole('button', { name: 'Удалить: Продукты', exact: true });
  await expect(remove).toHaveCSS('min-height', '44px');
  await remove.click();
  const dialog = page.getByRole('dialog', { name: /Удалить/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('overflow-y', 'auto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cloud-confirm-320.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#planned-foot')).toHaveText(/46\s*500[\s\S]*23\s*150[\s\S]*23\s*350/);
  await controlNextWrite(page, 'updateEntry');
  const name = page.getByRole('textbox', { name: 'Название: Продукты', exact: true });
  await name.fill('Продукты после правки');
  await name.press('Tab');
  await expect(page.locator('#save-status')).toHaveText('Сохраняется');
  await expect(page.locator('#save-status')).toHaveCSS('background-color', 'rgb(238, 237, 240)');
  await page.evaluate(() => window.rejectWrite());
  await expect(page.locator('#save-status')).toHaveText('Не удалось сохранить');
  await expect(page.locator('#save-status')).toHaveCSS('background-color', 'rgb(156, 48, 74)');
  await expect(name).toHaveValue('Продукты после правки');
  await page.screenshot({ path: testInfo.outputPath('cloud-save-error.png'), fullPage: true });
  await name.focus();
  await name.press('Tab');
  await expect(page.locator('#save-status')).toHaveText('Сохранено');
  expect(await page.evaluate(() => state.entries.find(row => row.id === 21).name)).toBe('Продукты после правки');
});

test('free: three-step guide, pending storage, rejection and retry', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/free/');
  await expect(page.locator('#guide')).toBeVisible();
  await expect(page.locator('#guide .guide-steps li')).toHaveCount(3);
  await expect(page.locator('#guide')).toContainText('только в этом браузере');
  await expect(page.locator('#guide details').first()).not.toHaveAttribute('open');
  await page.screenshot({ path: testInfo.outputPath('free-first-run-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
  await page.getByRole('button', { name: 'Создать бюджет', exact: true }).click();
  await expect(page.locator('#budget-view')).toBeVisible();
  const income = page.locator('#income-inp');
  await expect(income).toHaveCSS('min-height', '44px');
  await income.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(income).toBeFocused();
  await expect(income).toHaveCSS('outline-color', 'rgb(29, 78, 216)');
  await expect(income).toHaveCSS('font-variant-numeric', 'tabular-nums');
  const settings = page.getByRole('button', { name: 'Настройки', exact: true });
  await page.setViewportSize({ width: 320, height: 640 });
  await settings.click();
  const dialog = page.getByRole('dialog', { name: 'Настройки', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('overflow-y', 'auto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('free-settings-320.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await controlNextWrite(page, 'updateMonth');
  await income.fill('7777');
  await income.press('Tab');
  await expect(page.locator('#save-status')).toHaveText('Сохраняется');
  await expect(page.locator('#save-status')).toHaveCSS('background-color', 'rgb(239, 246, 255)');
  expect((await readStore(page, 'months'))[0].income).toBe(0);
  await page.evaluate(() => window.rejectWrite());
  await expect(page.locator('#save-status')).toHaveText('Не удалось сохранить');
  await expect(income).toHaveValue('7777');
  await expect(page.locator('#save-status')).toHaveCSS('background-color', 'rgb(185, 28, 28)');
  await page.screenshot({ path: testInfo.outputPath('free-save-error-390.png') });
  await income.focus();
  await income.press('Tab');
  await expect(page.locator('#save-status')).toHaveText('Сохранено');
  expect((await readStore(page, 'months'))[0].income).toBe(7777);
  await page.screenshot({ path: testInfo.outputPath('free-saved-mobile.png'), fullPage: true });
});

// A deferred rejection exercises the real inline handler without a network or disk fault.
// The retry calls the original in-memory/IndexedDB adapter.
async function controlNextWrite(page, method) {
  await page.evaluate(method => {
    const original = api[method];
    api[method] = (...args) => {
      api[method] = original;
      return new Promise((resolve, reject) => {
        window.rejectWrite = () => reject(new Error('Test storage rejection'));
      });
    };
  }, method);
}
