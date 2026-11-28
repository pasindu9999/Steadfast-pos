/** What a person does at the till, for the browser tests. */
import { expect, type Page } from '@playwright/test';

import { CASHIER, ENROLMENT_CODE, type StubApi } from './stub-api.js';

export async function enrol(page: Page, api: StubApi): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Server address').fill(api.url);
  await page.getByLabel('Enrolment code').fill(ENROLMENT_CODE);
  await page.getByRole('button', { name: 'Set up terminal' }).click();
  await expect(page.getByRole('list', { name: 'Staff' })).toBeVisible();
}

/**
 * Waits until the service worker is active and then in control of the page. A first install does
 * not take over the page that registered it, so the page is reloaded once.
 */
export async function awaitServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { active } = await navigator.serviceWorker.ready;
    if (!active || active.state === 'activated') return;
    await new Promise<void>((resolve) => {
      active.addEventListener('statechange', () => {
        if (active.state === 'activated') resolve();
      });
    });
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** An enrolled till whose app is stored on the device. */
export async function setUpTill(page: Page, api: StubApi): Promise<void> {
  await enrol(page, api);
  await awaitServiceWorker(page);
}

export async function logIn(page: Page): Promise<void> {
  await page.getByRole('button', { name: new RegExp(CASHIER.name) }).click();
  await page.getByLabel('PIN').fill(CASHIER.pin);
  await page.getByLabel('PIN').press('Enter');
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

export async function scan(page: Page, barcode: string): Promise<void> {
  const box = page.getByRole('combobox', { name: 'Scan or search' });
  await box.fill(barcode);
  await box.press('Enter');
  await expect(box).toHaveValue('');
}

/** Takes the exact cash and waits for the receipt. */
export async function payCash(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Cash/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Cash payment' });
  await dialog.getByRole('button', { name: 'Exact' }).click();
  await dialog.getByRole('button', { name: 'Complete sale' }).click();
  await expect(page.getByRole('heading', { name: 'Sale complete' })).toBeVisible();
}
