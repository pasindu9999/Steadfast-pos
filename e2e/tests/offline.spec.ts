/** The app opens and sells with no network (task P7-1, ARCH §7.6). */
import { ITEMS } from '../support/stub-api.js';
import { expect, test } from '../support/test.js';
import { logIn, payCash, scan, setUpTill } from '../support/till.js';

test('reloads offline, still enrolled, and sells', async ({ page, context, api }) => {
  await setUpTill(page, api);
  // A first install is not an update.
  await expect(page.getByText('Update available')).toBeHidden();

  await context.setOffline(true);
  await page.reload();
  // The staff list, not the setup form: the terminal's data is intact.
  await logIn(page);
  await expect(page.getByRole('banner')).toContainText('Demo Boutique');
  await expect(page.getByRole('banner')).toContainText('Terminal T1');
  await expect(page.getByTestId('sync-badge')).toHaveText('Offline');

  await scan(page, ITEMS.linen.barcode);
  await expect(page.getByTestId('total')).toHaveText('$89.00');
  await payCash(page);
  await expect(page.getByTestId('sync-badge')).toHaveText('Offline · 1 unsynced receipt');

  // And it is all still there after another offline reload.
  await page.reload();
  await logIn(page);
  await expect(page.getByTestId('sync-badge')).toHaveText('Offline · 1 unsynced receipt');
});

test('opens a receipt address offline', async ({ page, context, api }) => {
  await setUpTill(page, api);
  await context.setOffline(true);
  await page.reload();
  await logIn(page);
  await scan(page, ITEMS.tee.barcode);
  await payCash(page);
  const address = page.url();
  expect(new URL(address).pathname).toMatch(/^\/receipt\/[0-9a-f-]{36}$/);

  // A new tab, so nothing of the app is in memory.
  const tab = await context.newPage();
  await tab.goto(address);
  await logIn(tab);

  await expect(tab.getByRole('article', { name: 'Receipt S01-T1-000001' })).toBeVisible();
});

test('never answers for the API', async ({ page, context, api }) => {
  await setUpTill(page, api);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const requests = await (await caches.open(name)).keys();
      urls.push(...requests.map((request) => request.url));
    }
    return urls;
  });
  expect(cached.some((url) => url.includes('index.html'))).toBe(true);
  // The enrolment and the pull went to the API; neither was stored.
  expect(cached.filter((url) => url.startsWith(api.url) || url.includes('/v1/'))).toEqual([]);

  await context.setOffline(true);
  // An app address is answered from the cache; an API address on the same origin is not.
  await page.goto('/returns');
  await expect(page.getByRole('list', { name: 'Staff' })).toBeVisible();
  await expect(page.goto('/v1/health')).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
});
