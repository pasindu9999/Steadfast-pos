/** A new version waits for the cashier and never reloads during a sale (ARCH §7.6). */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { ITEMS } from '../support/stub-api.js';
import { expect, test } from '../support/test.js';
import { logIn, scan, setUpTill } from '../support/till.js';
import { UPDATE_APP_URL } from '../support/urls.js';

const WORKER = fileURLToPath(new URL('../.tmp/dist/sw.js', import.meta.url));

test.use({ baseURL: UPDATE_APP_URL });

let published: string;
test.beforeEach(() => {
  published = readFileSync(WORKER, 'utf8');
});
test.afterEach(() => writeFileSync(WORKER, published));

/** Any change to the worker's bytes is a new version to a browser. */
async function publishNewVersion(page: Page): Promise<void> {
  appendFileSync(WORKER, `\n// ${Date.now()}\n`);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
}

/** Marks the loaded page, so a reload shows up as the mark being gone. */
const markPage = (page: Page) =>
  page.evaluate(() => void Object.assign(window, { loadedOnce: true }));
const sameLoad = (page: Page) => page.evaluate(() => 'loadedOnce' in window);

const updateButton = (page: Page) => page.getByRole('button', { name: 'Update now' });
const waitingWorker = (page: Page) =>
  page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);

test('waits for the sale to end, and for a tap', async ({ page, api }) => {
  await setUpTill(page, api);
  await logIn(page);
  await scan(page, ITEMS.linen.barcode);
  await markPage(page);

  await publishNewVersion(page);

  await expect(page.getByText('Update available')).toBeVisible();
  await expect(updateButton(page)).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Scan or search' })).toBeFocused();
  expect(await sameLoad(page)).toBe(true);
  await expect(page.getByTestId('total')).toHaveText('$89.00');

  await page.getByRole('button', { name: 'Undo last scan' }).click();
  await expect(updateButton(page)).toBeEnabled();
  // Free to update, and still waiting to be asked.
  expect(await waitingWorker(page)).toBe(true);
  expect(await sameLoad(page)).toBe(true);

  const reloaded = page.waitForEvent('load');
  await updateButton(page).click();
  await reloaded;

  await expect(page.getByRole('list', { name: 'Staff' })).toBeVisible();
  expect(await sameLoad(page)).toBe(false);
  expect(await waitingWorker(page)).toBe(false);
  await expect(page.getByText('Update available')).toBeHidden();
});

test('offers an update that was already waiting when the till opened', async ({ page, api }) => {
  await setUpTill(page, api);
  await publishNewVersion(page);
  await expect(page.getByText('Update available')).toBeVisible();

  await page.reload();

  await expect(page.getByText('Update available')).toBeVisible();
  await expect(updateButton(page)).toBeEnabled();
});

test('never reloads a second tab that is selling', async ({ page, context, api }) => {
  await setUpTill(page, api);
  await logIn(page);
  const selling = await context.newPage();
  await selling.goto('/');
  await logIn(selling);
  await scan(selling, ITEMS.tee.barcode);
  await markPage(selling);

  await publishNewVersion(page);
  await expect(updateButton(page)).toBeEnabled();
  await expect(updateButton(selling)).toBeDisabled();

  const reloaded = page.waitForEvent('load');
  await updateButton(page).click();
  await reloaded;

  // The new version has taken over both tabs, but the busy one has not moved.
  await expect.poll(() => waitingWorker(selling)).toBe(false);
  expect(await sameLoad(selling)).toBe(true);
  await expect(selling.getByTestId('total')).toHaveText('$35.00');
  await expect(selling.getByText('Update available')).toBeVisible();
  await expect(updateButton(selling)).toBeDisabled();

  // It still sells, and updates when its cashier says so.
  await selling.getByRole('button', { name: 'Undo last scan' }).click();
  expect(await sameLoad(selling)).toBe(true);
  const second = selling.waitForEvent('load');
  await updateButton(selling).click();
  await second;
  await expect(selling.getByRole('list', { name: 'Staff' })).toBeVisible();
  await expect(selling.getByText('Update available')).toBeHidden();
});
