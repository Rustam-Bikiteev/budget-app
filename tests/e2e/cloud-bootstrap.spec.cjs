const { test, expect } = require('./fixtures.cjs');
const { postgrestFixture } = require('../supabase-fixture.cjs');
const { cloudSdkFixture } = require('./cloud-fixture.cjs');
const { initialPeriod } = require('../../shared/domain.mjs');
const A = '00000000-0000-0000-0000-000000000010', B = '00000000-0000-0000-0000-000000000020';
const user = { id: '00000000-0000-0000-0000-000000000001' }, token = 'a'.repeat(64);
const household = (id = A, name = 'Семья Альфа', role = 'owner') => ({
  id, name, role, revision: 1, settings: { categories: [{ id: 'general', name: 'Общие', color: '#64748b', default: true }] },
  members: [{ household_id: id, user_id: user.id, role }],
});
async function openCloud(page, config = {}, suffix = '') {
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.supabase={createClient(){return (${cloudSdkFixture.toString()})(${postgrestFixture.toString()},${JSON.stringify(config)})}};`,
  }));
  await page.goto('/' + suffix);
}
async function login(page) {
  await page.locator('#login-email').fill('tester@example.invalid');
  await page.locator('#login-pass').fill('fixture-password');
  await page.locator('#login-btn').click();
}
async function account(page) {
  const profile = page.locator('.lilac-profile');
  if (await profile.getAttribute('aria-label') !== 'Аккаунт') await profile.click();
  await profile.click();
}

test('root Auth errors, email confirmation, family creation and explicit reserve RPC', async ({ page }) => {
  await openCloud(page);
  await expect(page.locator('#login-overlay')).toBeVisible();
  await page.screenshot({ path: 'test-results/cloud-login.png', fullPage: true });
  await page.evaluate(() => { cloudTest.confirmEmail = true; });
  await page.locator('#login-email').fill('tester@example.invalid');
  await page.locator('#login-pass').fill('fixture-password');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.locator('#login-err')).toContainText('Подтвердите почту');
  await page.evaluate(() => { cloudTest.loginError = { message: 'Invalid login credentials' }; });
  await page.locator('#login-btn').click();
  await expect(page.getByRole('alert')).toHaveText('Неверная почта или пароль');
  await expect(page.getByRole('alert')).toHaveCSS('color', 'rgb(156, 48, 74)');
  await page.evaluate(() => { cloudTest.loginError = null; });
  await page.locator('#login-btn').click();
  await expect(page.locator('#family-onboarding')).toBeVisible();
  await page.screenshot({ path: 'test-results/cloud-onboarding.png', fullPage: true });
  expect(await page.evaluate(() => cloudTest.fixture.calls.filter(c => c.table))).toEqual([]);
  const family = household();
  await page.evaluate(family => {
    cloudTest.households = [family]; cloudTest.details[family.id] = family;
    cloudTest.replies.push({ name: 'budget_create_household', data: family });
  }, family);
  await page.locator('#family-name').fill(family.name);
  await page.getByRole('button', { name: 'Создать семейный бюджет', exact: true }).click();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#empty-state')).toBeVisible();
  const period = await page.evaluate(() => ({ year: state.year, month: state.month, half: state.half }));
  const month = { id: 1, household_id: A, revision: 1, income: 0, saved: 0, ...period };
  await page.evaluate(month => cloudTest.replies.push({ name: 'budget_mutate', operation: 'create_month', data: { row: month, month }, tables: { months: [month] } }), month);
  await page.getByRole('button', { name: 'Создать бюджет', exact: true }).click();
  await page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Платежи', exact: true }).click();
  const entry = { id: 2, household_id: A, month_id: 1, revision: 1, type: 'mandatory', category: 'general', name: '', planned: 0, actual: 0, is_reserve: false };
  await page.evaluate(({ entry, month }) => cloudTest.replies.push({ name: 'budget_mutate', operation: 'create_entry', data: { row: entry, month: { ...month, revision: 2 } }, tables: { entries: [entry] } }), { entry, month });
  await page.getByRole('button', { name: '+ Добавить платёж', exact: true }).click();
  const reserve = page.getByRole('checkbox', { name: 'Резерв: Без названия', exact: true });
  await expect(reserve).toBeEnabled();
  await page.evaluate(({ entry, month }) => cloudTest.replies.push({ name: 'budget_mutate', operation: 'update_entry', data: { row: { ...entry, revision: 2, is_reserve: true }, month: { ...month, revision: 3 } } }), { entry, month });
  await reserve.check();
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  expect(await page.evaluate(() => cloudTest.fixture.calls.filter(c => c.rpc === 'budget_mutate').map(c => c.args.payload))).toEqual([
    period, { month_id: 1, expected_revision: 1, is_reserve: false, type: 'mandatory', category: 'general', name: '', planned: 0, actual: 0 },
    { id: 2, expected_revision: 1, is_reserve: true },
  ]);
  await account(page);
  await expect(page.locator('#family-account')).toContainText(family.name);
  await expect(page.locator('#family-account')).toContainText('Владелец');
  await page.screenshot({ path: 'test-results/cloud-account-desktop.png', fullPage: true });
});

test('invite survives login/reload; member joins without owner controls or external navigation', async ({ page }) => {
  await openCloud(page, {}, '#invite=' + token);
  await expect(page.locator('#login-overlay')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await page.reload(); await login(page);
  await expect(page.locator('#family-token')).toHaveValue(token);
  const family = household(A, 'Семья Бета', 'member');
  await page.evaluate(family => {
    cloudTest.households = [family]; cloudTest.details[family.id] = family;
    cloudTest.replies.push({ name: 'budget_join_household', error: { code: 'P0001', message: 'invalid_invite' } });
  }, family);
  await page.getByRole('button', { name: 'Присоединиться по приглашению', exact: true }).click();
  await expect(page.locator('#family-error')).toContainText('Приглашение недействительно');
  await expect(page.locator('#family-token')).toHaveValue(token);
  await page.evaluate(id => cloudTest.replies.push({ name: 'budget_join_household', data: { household_id: id } }), A);
  await page.getByRole('button', { name: 'Присоединиться по приглашению', exact: true }).click();
  await expect(page.locator('#app')).toBeVisible(); await account(page);
  await expect(page.locator('#empty-state')).toBeHidden();
  await expect(page.locator('#expense-fab')).toBeHidden();
  await expect(page.locator('#family-account')).toContainText('Участник');
  await expect(page.locator('#family-invite')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('budget-invite'))).toBeNull();
  expect(await page.evaluate(() => cloudTest.fixture.calls.filter(c => c.rpc === 'budget_join_household').map(c => c.args))).toEqual([{ token }, { token }]);
});

test('owner invite retry, household/category settings and mobile account use scoped RPCs', async ({ page }) => {
  const family = household();
  await page.setViewportSize({ width: 390, height: 844 });
  await openCloud(page, { session: { user }, households: [family], details: { [A]: family } });
  await expect(page.locator('#app')).toBeVisible(); await account(page);
  await page.evaluate(() => cloudTest.replies.push({ name: 'budget_create_invite', error: { message: 'Network timeout' } }));
  await page.locator('#family-invite').click();
  await expect(page.locator('#account-error')).not.toBeEmpty();
  await page.evaluate(token => cloudTest.replies.push({ name: 'budget_create_invite', data: { token, expires_at: '2026-11-24T12:00:00Z' } }), token);
  await page.locator('#family-invite').click();
  await expect(page.locator('#invite-link')).toHaveValue(new URL('/', page.url()).href + '#invite=' + token);
  const invites = await page.evaluate(() => cloudTest.fixture.calls.filter(c => c.rpc === 'budget_create_invite').map(c => c.args));
  expect(invites[0]).toEqual(invites[1]); expect(invites[0].household_id).toBe(A);
  const updated = { ...family, name: 'Наш дом', revision: 2, settings: { categories: [{ ...family.settings.categories[0], name: 'Дом' }] } };
  await page.evaluate(updated => {
    cloudTest.details[updated.id] = updated;
    cloudTest.replies.push({ name: 'budget_mutate', operation: 'update_settings', data: { row: updated, month: null } });
  }, updated);
  await page.locator('#family-edit-name').fill('Наш дом'); await page.locator('[data-family-cat="general"]').fill('Дом');
  await page.getByRole('button', { name: 'Сохранить настройки семьи', exact: true }).click();
  await expect(page.locator('#family-account h2')).toHaveText('Наш дом');
  const mutation = await page.evaluate(() => cloudTest.fixture.calls.find(c => c.rpc === 'budget_mutate').args);
  expect(mutation.payload).toEqual({ expected_revision: 1, name: 'Наш дом', settings: updated.settings });
  await expect(page.getByRole('button', { name: 'Удалить категорию' })).toBeDisabled();
  await page.getByRole('button', { name: 'Добавить категорию' }).click();
  const addedInput = page.getByRole('textbox', { name: 'Название категории' }).last();
  await addedInput.fill('Настя');
  const addedId = await addedInput.getAttribute('data-family-cat');
  const colorPicker = page.locator(`[data-family-color="${addedId}"]`);
  await expect(colorPicker).toHaveValue('#7546c7');
  await colorPicker.fill('#007d70');
  const withCategory = { ...updated, revision: 3, settings: { categories: [
    ...updated.settings.categories, { id: addedId, name: 'Настя', color: '#007d70' },
  ] } };
  await page.evaluate(updated => {
    cloudTest.replies.push({ name: 'budget_mutate', operation: 'update_settings', data: { row: updated, month: null } });
  }, withCategory);
  await page.getByRole('button', { name: 'Сохранить настройки семьи', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await expect(page.locator(`[data-family-cat="${addedId}"]`)).toHaveValue('Настя');
  await expect(colorPicker).toHaveValue('#007d70');
  const categoryRow = page.locator('.family-category-row').last();
  await expect(categoryRow).toHaveCSS('display', 'grid');
  await expect(page.locator('#family-settings fieldset')).toHaveCSS('border-top-width', '0px');
  const inputBox = await categoryRow.getByRole('textbox', { name: 'Название категории' }).boundingBox();
  const removeBox = await categoryRow.getByRole('button').boundingBox();
  expect(removeBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width);
  expect(removeBox.y).toBeLessThan(inputBox.y + inputBox.height);
  expect(removeBox.width).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: 'test-results/cloud-account-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Удалить категорию' }).last().click();
  await expect(page.locator('#family-category-note')).toContainText('«Дом»');
  await page.evaluate(updated => {
    cloudTest.replies.push({ name: 'budget_mutate', operation: 'update_settings', data: { row: updated, month: null } });
  }, { ...updated, revision: 4 });
  await page.getByRole('button', { name: 'Сохранить настройки семьи', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const writes = await page.evaluate(() => cloudTest.fixture.calls.filter(c => c.rpc === 'budget_mutate').map(c => c.args.payload));
  expect(writes.slice(1)).toEqual([
    { expected_revision: 2, name: 'Наш дом', settings: withCategory.settings },
    { expected_revision: 3, name: 'Наш дом', settings: updated.settings },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('family/account changes clear state and ignore late reads, writes and old Realtime callbacks', async ({ page }) => {
  const first = household(), second = household(B, 'Семья Гамма', 'member'); second.settings.categories[0].name = 'Поездки';
  await openCloud(page, { session: { user }, households: [first, second], details: { [A]: first, [B]: second } });
  await expect(page.locator('#family-onboarding')).toBeVisible();
  await page.getByRole('button', { name: first.name, exact: true }).click();
  await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(() => {
    cloudTest.replies.push({ name: 'budget_mutate', operation: 'create_backlog', defer: true, data: { row: { id: 99, name: 'Секрет семьи Альфа' }, month: null } });
    window.oldWrite = api.createBacklog({ category: 'general', name: 'Секрет семьи Альфа', planned: 1 }).catch(error => error.message);
  });
  await account(page); await page.locator('#family-switch').click();
  await page.getByRole('button', { name: second.name, exact: true }).click();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#family-account h2')).toHaveText(second.name);
  expect(await page.evaluate(() => cloudTest.channels[0].removed)).toBe(true);
  const before = await page.evaluate(() => cloudTest.fixture.calls.length);
  await page.evaluate(() => { cloudTest.channels[0].handlers.forEach(h => h.callback({})); cloudTest.release(); });
  expect(await page.evaluate(() => oldWrite)).toContain('Контекст изменился');
  expect(await page.evaluate(() => state.backlog)).toEqual([]);
  expect(await page.evaluate(() => cloudTest.fixture.calls.length)).toBe(before);
  expect(await page.evaluate(() => cloudTest.channels[1].handlers.map(h => h.filter.filter))).toEqual(Array(3).fill('household_id=eq.' + B));
  await page.evaluate(() => {
    const from = cloudTest.fixture.client.from;
    cloudTest.fixture.client.from = table => {
      const q = from(table); if (table === 'months') {
        const then = q.then.bind(q);
        q.then = (resolve, reject) => new Promise(done => { cloudTest.releaseRead = () => done(then(resolve, reject)); });
      }
      return q;
    };
    window.oldRead = api.listMonths().catch(error => error.message);
  });
  await expect.poll(() => page.evaluate(() => !!cloudTest.releaseRead)).toBe(true);
  await page.evaluate(() => cloudTest.setSession(null));
  await expect(page.locator('#login-overlay')).toBeVisible();
  await page.evaluate(() => cloudTest.releaseRead());
  expect(await page.evaluate(() => oldRead)).toContain('Контекст изменился');
  expect(await page.evaluate(() => ({ entries: state.entries, backlog: state.backlog, months: state.allMonths, household: api.getContext().householdId }))).toEqual({ entries: [], backlog: [], months: [], household: null });
  await expect(page.locator('#family-account')).toBeEmpty(); await expect(page.locator('#app')).toBeHidden();
});

test('conflict refresh preserves edited fields; quick and cover use one atomic RPC without compensation', async ({ page }) => {
  const family = household();
  const month = { id: 1, household_id: A, revision: 3, income: 1000, saved: 200, ...initialPeriod(new Date(), 'cloud') };
  const expense = { id: 2, household_id: A, month_id: 1, revision: 1, type: 'planned', category: 'general', name: 'Покупка', planned: 50, actual: 80, is_reserve: false };
  await openCloud(page, { session: { user }, households: [family], details: { [A]: family }, tables: { months: [month], entries: [expense] } });
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Траты', exact: true }).click();
  const row = page.locator('.row[data-eid="2"]');
  await page.evaluate(() => cloudTest.replies.push({ name: 'budget_mutate', operation: 'update_entry', error: { code: '40001', message: 'revision_conflict' } }));
  await row.locator('[data-f=name]').fill('Мой черновик');
  await row.locator('[data-f=name]').press('Enter');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
  await expect(row.locator('[data-f=name]')).toHaveValue('Мой черновик');
  // The other member changed both name and plan. Only our edited name survives.
  const newer = { ...expense, name: 'Чужая правка', planned: 90, actual: 120, revision: 2 };
  await page.evaluate(({ newer, month }) => { cloudTest.fixture.tables.entries = [newer]; cloudTest.fixture.tables.months = [{ ...month, revision: 4 }]; }, { newer, month });
  const beforeRealtime = await page.evaluate(() => cloudTest.fixture.calls.length);
  await page.evaluate(() => cloudTest.channels[0].handlers[1].callback({}));
  expect(await page.evaluate(() => cloudTest.fixture.calls.length)).toBe(beforeRealtime);
  await account(page); await page.locator('#refresh-btn').click();
  await page.locator('.lilac-bottom-nav').getByRole('button', { name: 'Траты', exact: true }).click();
  await expect(row.locator('[data-f=name]')).toHaveValue('Мой черновик');
  await expect(row.locator('[data-f=planned]')).toHaveValue('90');
  const saved = { ...newer, name: 'Мой черновик', revision: 3 };
  await page.evaluate(({ saved, month }) => cloudTest.replies.push({ name: 'budget_mutate', operation: 'update_entry', data: { row: saved, month: { ...month, revision: 5 } } }), { saved, month });
  await row.locator('[data-f=name]').focus(); await row.locator('[data-f=name]').press('Enter');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  const edits = await page.evaluate(() => cloudTest.fixture.calls.filter(c => c.rpc === 'budget_mutate').map(c => c.args));
  expect(edits[0].request_id).not.toBe(edits[1].request_id);
  expect(edits[1].payload).toEqual({ id: 2, expected_revision: 2, name: 'Мой черновик', planned: 90, actual: 120 });
  await page.getByRole('button', { name: 'Добавить трату', exact: true }).click();
  await page.locator('#q-offplan').check(); await page.locator('#q-source').selectOption('saved');
  await page.locator('#q-name').fill('Лекарства'); await page.locator('#q-sum').fill('20');
  await page.evaluate(() => cloudTest.replies.push({ name: 'budget_mutate', operation: 'quick_expense', error: { code: 'P0001', message: 'insufficient_funds' } }));
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('#q-error')).toContainText('не хватает денег');
  await expect(page.locator('#q-sum')).toHaveValue('20');
  const quick = { ...expense, id: 3, name: 'Лекарства', planned: 20, actual: 20 };
  await page.evaluate(({ saved, quick, month }) => cloudTest.replies.push({ name: 'budget_mutate', operation: 'quick_expense', data: { row: quick, month: { ...month, revision: 6, saved: 180 } }, tables: { months: [{ ...month, revision: 6, saved: 180 }], entries: [saved, quick] } }), { saved, quick, month });
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.locator('#sheet-overlay')).toBeHidden();
  await expect(row.locator('[data-f=planned]')).toHaveValue('90');
  await row.locator('.rem').click();
  const covered = { ...saved, planned: 120, revision: 4 };
  await page.evaluate(({ covered, quick, month }) => cloudTest.replies.push({ name: 'budget_mutate', operation: 'cover_overrun', data: { row: covered, month: { ...month, revision: 7, saved: 150 } }, tables: { months: [{ ...month, revision: 7, saved: 150 }], entries: [covered, quick] } }), { covered, quick, month });
  await page.getByRole('button', { name: /Из отложенных/ }).click();
  await expect(row.locator('[data-f=planned]')).toHaveValue('120');
  const mutations = await page.evaluate(() => cloudTest.fixture.calls.filter(c => c.rpc === 'budget_mutate').map(c => c.args));
  expect(mutations.map(c => c.operation)).toEqual(['update_entry', 'update_entry', 'quick_expense', 'quick_expense', 'cover_overrun']);
  expect(mutations[3].payload.expected_revision).toBe(5);
  expect(mutations[4].payload.expected_revision).toBe(6);
  expect(await page.evaluate(() => cloudTest.fixture.calls.filter(c => c.table).every(c => c.operation === 'select' && c.filters.some(([k,v]) => k === 'household_id' && v === api.getContext().householdId)))).toBe(true);
});
