const { test, expect, guardContext } = require('./fixtures.cjs');

test('free: module shell upgrades with an open tab and reloads saved data offline', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const safe = await guardContext(context, baseURL);
  try {
    const page = await context.newPage();
    await page.goto(baseURL + '/free/');
    await page.getByRole('button', { name: 'Понятно', exact: true }).click();
    await page.getByRole('button', { name: 'Создать бюджет', exact: true }).click();
    await page.getByRole('button', { name: '+ Добавить трату', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Название записи', exact: true });
    await name.fill('Сохранено офлайн'); await name.press('Tab');
    await expect(page.locator('#save-status')).toHaveText('Сохранено');
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('/tests/e2e/legacy-free-sw.js', { scope: '/free/' });
      const worker = registration.installing || registration.waiting || registration.active;
      if (worker.state !== 'activated') await new Promise(resolve => worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); }));
      await caches.open('another-app-smoke');
    });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('legacy-free-sw.js');
    await name.fill('Открытый ввод');
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('/free/sw.js');
      const worker = registration.installing || registration.waiting || registration.active;
      if (worker.state !== 'activated') await new Promise(resolve => worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); }));
    });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/free/sw.js');
    await expect(name).toHaveValue('Открытый ввод');
    expect(await page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining(['budget-free-v7', 'another-app-smoke']));
    expect(await page.evaluate(() => caches.keys())).not.toContain('budget-free-v4');
    await context.setOffline(true);
    await page.reload();
    await expect(name).toHaveValue('Сохранено офлайн');
    expect(await page.evaluate(() => api.getMonth(state.monthId).then(data => data.entries[0].name))).toBe('Сохранено офлайн');
    safe();
  } finally { await context.close(); }
});
