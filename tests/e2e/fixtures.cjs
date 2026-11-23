const { test: base, expect } = require('@playwright/test');

// Every context is fresh. External HTTP is blocked and fails the test, including
// accidental Supabase/CDN requests. No production credentials or storageState.
const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    const assertSafe = await guardContext(context, baseURL);
    await use(context);
    assertSafe();
  },
});

async function guardContext(context, baseURL) {
  const unexpected = [];
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin) return route.continue();
    unexpected.push(url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });
  // No scenario needs a WebSocket. Never connect even if production Realtime
  // bootstrap is accidentally introduced into the safe preview.
  await context.routeWebSocket('**/*', socket => {
    unexpected.push(socket.url());
    socket.close();
  });
  return () => {
    expect(unexpected, 'External requests and WebSockets must never leave the test context').toEqual([]);
    expect(errors, 'Uncaught browser errors').toEqual([]);
  };
}

async function openFree(page) {
  await page.goto('/free/');
  await expect(page.locator('#empty-state')).toBeVisible();
  const guide = page.locator('#guide');
  if (await guide.isVisible()) await guide.getByRole('button', { name: 'Понятно' }).click();
}

module.exports = { test, expect, openFree, guardContext };
