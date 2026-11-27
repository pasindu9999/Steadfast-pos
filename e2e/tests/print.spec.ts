/**
 * Receipts on 80 mm paper, printed offline (task P7-2, ARCH §7.5). The sample receipts are saved
 * as PDF in `artifacts/`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { BULK_ITEMS, ITEMS, type StubApi } from '../support/stub-api.js';
import { expect, test } from '../support/test.js';
import { logIn, payCash, scan, setUpTill } from '../support/till.js';

/** CSS pixels. */
const px = (mm: number) => (mm * 96) / 25.4;
/** PDF points. */
const pt = (mm: number) => (mm * 72) / 25.4;

const PAPER = { width: Math.round(px(80)), height: 1000 };
const SCREEN = { width: 1280, height: 800 };

const artifact = (name: string) =>
  fileURLToPath(new URL(`../artifacts/${name}.pdf`, import.meta.url));

interface PrintProbe {
  prints: number;
}

/** An offline till whose print dialog only counts how often it was asked for. */
async function offlineTill(page: Page, api: StubApi): Promise<void> {
  await page.addInitScript(() => {
    const probe = window as unknown as PrintProbe;
    probe.prints = 0;
    window.print = () => void (probe.prints += 1);
  });
  await setUpTill(page, api);
  await page.context().setOffline(true);
  await page.reload();
  await logIn(page);
}

const prints = (page: Page) => page.evaluate(() => (window as unknown as PrintProbe).prints);
const afterPrint = (page: Page) =>
  page.evaluate(() => void window.dispatchEvent(new Event('afterprint')));

/** A cash sale with four lines, a long name, a discount and 5c rounding. */
async function sampleSale(page: Page): Promise<void> {
  for (const { barcode } of [ITEMS.linen, ITEMS.linen, ITEMS.coat, ITEMS.tee]) {
    await scan(page, barcode);
  }
  await page.getByRole('button', { name: 'Cart discount' }).click();
  await page.getByLabel('Percent off').fill('7');
  await page.getByLabel('Percent off').press('Enter');
  await payCash(page);
}

/** Returns one of the shirts of the sale just made, from Returns. */
async function sampleReturn(page: Page): Promise<void> {
  await page.keyboard.press('F8');
  await page.getByRole('button', { name: /^S01-T1-000001/ }).click();
  await page.getByRole('button', { name: /^One more of Linen Shirt/ }).click();
  await page.getByRole('button', { name: 'Wrong size' }).click();
  await page.getByRole('button', { name: 'Complete return' }).click();
  await expect(page.getByRole('heading', { name: 'Return complete' })).toBeVisible();
}

/** The Print button is enabled once everything on the receipt is drawn. */
const ready = (page: Page) =>
  expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();

/** Everything wrong with the page as it would go on paper. */
async function paperProblems(page: Page): Promise<string[]> {
  return page.evaluate((printable) => {
    const problems: string[] = [];
    const receipt = document.querySelector('[data-print-receipt]');
    if (!receipt) return ['no receipt'];
    const paper = receipt.getBoundingClientRect();
    const outside = (rect: DOMRect) =>
      rect.left < paper.left - 0.5 || rect.right > paper.right + 0.5;

    if (paper.width > printable + 0.5) problems.push(`receipt is ${paper.width}px wide`);
    if (paper.left < 0 || paper.right > window.innerWidth + 0.5) problems.push('off the page');
    if (document.documentElement.scrollWidth > window.innerWidth) problems.push('page scrolls');

    for (const element of receipt.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && outside(rect)) problems.push(`${element.tagName} sticks out`);
    }
    // Text can overflow a box that is itself the right size.
    const texts = document.createTreeWalker(receipt, NodeFilter.SHOW_TEXT);
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some(outside)) {
        problems.push(`text sticks out: ${node.textContent}`);
      }
    }
    // Nothing but the receipt takes any room.
    for (const element of document.body.querySelectorAll('*')) {
      const around = element.contains(receipt) || receipt.contains(element);
      if (!around && element.getClientRects().length > 0) {
        problems.push(`also printed: ${element.tagName} ${element.textContent?.slice(0, 40)}`);
      }
    }
    return problems;
  }, px(72));
}

async function asPaper(page: Page): Promise<void> {
  await page.setViewportSize(PAPER);
  await page.emulateMedia({ media: 'print' });
}

async function asScreen(page: Page): Promise<void> {
  await page.setViewportSize(SCREEN);
  await page.emulateMedia({ media: null });
}

async function expectAppHidden(page: Page): Promise<void> {
  await expect(page.getByRole('banner')).toBeHidden();
  await expect(page.getByTestId('sync-badge')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { level: 2 })).toBeHidden();
}

async function codeWidth(page: Page): Promise<number> {
  const box = await page.getByRole('img', { name: /^QR code for/ }).boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
  return box!.width;
}

/** The pages of a PDF, as `[width, height]` in points. */
function pdfPages(file: string): [number, number][] {
  const text = readFileSync(file, 'latin1');
  return [...text.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((match) => [
    Number(match[1]),
    Number(match[2]),
  ]);
}

/**
 * Presses Print, as a cashier would, which sizes the page from the receipt on screen. The PDF then
 * takes its size from the page's own rules.
 */
async function savePdf(page: Page, name: string): Promise<[number, number][]> {
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await page.pdf({ path: artifact(name), preferCSSPageSize: true });
  return pdfPages(artifact(name));
}

/** One page, 80 mm wide, and no longer than the receipt by more than a few millimetres. */
async function expectOneSlip(page: Page, pages: [number, number][]): Promise<void> {
  expect(pages).toHaveLength(1);
  const [width, height] = pages[0]!;
  expect(Math.abs(width - pt(80))).toBeLessThan(1);
  const receipt = await page.locator('[data-print-receipt]').boundingBox();
  const spare = height - (receipt!.height * 72) / 96;
  expect(spare).toBeGreaterThanOrEqual(0);
  expect(spare).toBeLessThan(pt(3));
}

test('a sale receipt fits the paper, alone', async ({ page, api }) => {
  await offlineTill(page, api);
  await sampleSale(page);
  await ready(page);
  const receipt = page.getByRole('article', { name: 'Receipt S01-T1-000001' });
  for (const text of [
    'Demo Boutique',
    'ABN 00 000 000 000',
    'Served by Casey Cashier',
    'Linen Shirt — Black / M',
    'Discount',
    'GST included',
    'Cash rounding',
    'Change',
    'Returns within 14 days',
    'Demo — © Udara Kurukulasooriya',
  ]) {
    await expect(receipt).toContainText(text);
  }

  await asPaper(page);

  await expectAppHidden(page);
  expect(await paperProblems(page)).toEqual([]);
  expect(await codeWidth(page)).toBeGreaterThanOrEqual(px(30));
  await expect(receipt).toHaveCSS('font-family', /monospace/);
  await expect(receipt).toHaveCSS('color', 'rgb(0, 0, 0)');
  for (const item of await receipt.getByRole('listitem').all()) {
    await expect(item).toHaveCSS('break-inside', 'avoid');
  }

  await asScreen(page);
  const pages = await savePdf(page, 'sale-receipt');
  await expectOneSlip(page, pages);
  expect(await prints(page)).toBe(1);
});

test('a return receipt fits the paper, alone', async ({ page, api }) => {
  await offlineTill(page, api);
  await sampleSale(page);
  await sampleReturn(page);
  await ready(page);
  const receipt = page.getByRole('article', { name: 'Return receipt R-S01-T1-000001' });
  await expect(receipt).toContainText('RETURN');
  await expect(receipt).toContainText('Original receipt S01-T1-000001');
  await expect(receipt).toContainText('Demo — © Udara Kurukulasooriya');

  await asPaper(page);

  await expectAppHidden(page);
  expect(await paperProblems(page)).toEqual([]);

  await asScreen(page);
  await expectOneSlip(page, await savePdf(page, 'return-receipt'));
});

test('the densest code still fits, at the full width', async ({ page, api }) => {
  await offlineTill(page, api);
  for (const { barcode } of BULK_ITEMS) await scan(page, barcode);
  await payCash(page);
  await ready(page);

  await asPaper(page);

  expect(await paperProblems(page)).toEqual([]);
  expect(await codeWidth(page)).toBeCloseTo(px(72), 0);
});

test('prints by itself once turned on, then goes back to work', async ({ page, api }) => {
  await offlineTill(page, api);
  await scan(page, ITEMS.tee.barcode);
  await payCash(page);
  await ready(page);
  expect(await prints(page)).toBe(0);
  // The box shows what is saved, so it is ticked a moment after the click.
  await page.getByRole('checkbox', { name: /print automatically/i }).click();
  await expect(page.getByRole('checkbox', { name: /print automatically/i })).toBeChecked();
  await page.getByRole('button', { name: 'New sale' }).click();

  await scan(page, ITEMS.tee.barcode);
  await payCash(page);
  await expect.poll(() => prints(page)).toBe(1);
  await page.getByRole('checkbox', { name: /print automatically/i }).focus();
  await afterPrint(page);
  await expect(page.getByRole('button', { name: 'New sale' })).toBeFocused();

  // The setting is stored, and a reload does not print the receipt again.
  await page.reload();
  await logIn(page);
  await ready(page);
  await expect(page.getByRole('checkbox', { name: /print automatically/i })).toBeChecked();
  expect(await prints(page)).toBe(0);

  // Printing from the browser's menu on the sale screen ends in the scan box.
  await page.getByRole('button', { name: 'New sale' }).click();
  const scanBox = page.getByRole('combobox', { name: 'Scan or search' });
  await expect(scanBox).toBeFocused();
  await scanBox.blur();
  await afterPrint(page);
  await expect(scanBox).toBeFocused();
});

test('keeps the page rule the printer driver is given', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="stylesheet"]').getAttribute('href');

  const css = await (await request.get(href ?? '')).text();

  expect(css).toMatch(/@page\s*\{\s*size:\s*80mm auto;\s*margin:\s*0/);
});
