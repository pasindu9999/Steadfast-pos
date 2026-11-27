// @vitest-environment jsdom
/** Finding a sale to return, by keyboard and scanner, with the network cut (CLAUDE.md rule 1). */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { makeSale, OTHER_RECEIPT_NO, otherTerminalQr } from '../test/return-fixtures';
import { CASHIER, LINEN_BARCODE, seedShop } from '../test/shop';

const fetch = vi.fn(() => Promise.reject(new Error('offline')));
beforeEach(() => vi.stubGlobal('fetch', fetch));
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

/** `{` and `[` are commands to `userEvent.keyboard` unless doubled. */
const asKeys = (text: string) => text.replace(/[{[]/g, '$&$&');

async function openTill({ sales = 1 } = {}) {
  const database = await seedShop();
  for (let made = 0; made < sales; made += 1) await makeSale(database);
  const clock = createKeyClock();
  const view = renderPos({
    database,
    signedInAs: CASHIER,
    services: { keyTime: clock.read, beep: vi.fn() },
  });
  await findScanBox();
  const scan = (code: string) => clock.scanning(() => view.user.keyboard(`${asKeys(code)}{Enter}`));
  /** A scan with a pause in the middle, as a poor Bluetooth link gives. */
  const brokenScan = async (code: string) => {
    const middle = Math.floor(code.length / 2);
    await clock.scanning(() => view.user.keyboard(asKeys(code.slice(0, middle))));
    await scan(code.slice(middle));
  };
  return { ...view, database, scan, brokenScan };
}

const findLookup = () =>
  screen.findByRole<HTMLInputElement>('textbox', { name: /receipt number/i });
const findSale = (receiptNo: string) => screen.findByRole('region', { name: `Sale ${receiptNo}` });
const isFocused = (element: Element) => waitFor(() => expect(document.activeElement).toBe(element));
const cartLines = () =>
  within(screen.getByRole('region', { name: 'Cart' })).queryAllByRole('listitem');

describe('opening Returns', () => {
  it.each([
    ['F8', '{F8}'],
    ['the button', null],
  ])('opens with %s, with the lookup field ready', async (_, keys) => {
    const { user } = await openTill();

    if (keys) await user.keyboard(keys);
    else await user.click(screen.getByRole('button', { name: /returns/i }));

    await isFocused(await findLookup());
  });

  it('goes back to the scan box with Escape or the button', async () => {
    const { user } = await openTill();

    await user.keyboard('{F8}');
    await findLookup();
    await user.keyboard('{Escape}');
    await isFocused(await findScanBox());

    await user.keyboard('{F8}');
    await user.click(await screen.findByRole('button', { name: 'Back to sale' }));
    await isFocused(await findScanBox());
  });
});

describe('finding a sale', () => {
  it('finds one by a typed receipt number', async () => {
    const { user } = await openTill();
    await user.keyboard('{F8}');
    const lookup = await findLookup();

    await user.keyboard('s01-t1-000001{Enter}');

    const sale = await findSale('S01-T1-000001');
    expect(sale.textContent).toContain('Linen Shirt — Black / M');
    expect(sale.textContent).toContain('Sold 3');
    expect(sale.textContent).toContain('$267.00');
    expect(sale.textContent).toContain('Paid by cash');
    expect(lookup.value).toBe('');
    await isFocused(lookup);
  });

  it('opens one from the recent sales, by keyboard alone, and closes it with Escape', async () => {
    const { user } = await openTill({ sales: 2 });
    await user.keyboard('{F8}');
    const lookup = await findLookup();
    const recent = await screen.findByRole('button', { name: /S01-T1-000001/ });

    recent.focus();
    await user.keyboard('{Enter}');

    await findSale('S01-T1-000001');
    await isFocused(lookup);
    await user.keyboard('{Escape}');
    await screen.findByRole('button', { name: /S01-T1-000002/ });
    expect(screen.queryByRole('region', { name: /^Sale / })).toBeNull();
    await isFocused(lookup);
  });

  it('takes the other terminal’s sale from a pasted receipt code', async () => {
    const { user } = await openTill({ sales: 0 });
    await user.keyboard('{F8}');
    await findLookup();

    await user.paste(otherTerminalQr());
    await user.keyboard('{Enter}');

    const sale = await findSale(OTHER_RECEIPT_NO);
    expect(sale.textContent).toContain('Linen Shirt — Black / M');
    expect(sale.textContent).toContain('Sold 2');
    expect(sale.textContent).toContain('receipt code');
  });

  it.each(['at once', 'with a pause'])('reads a receipt code scanned %s', async (how) => {
    const { user, scan, brokenScan } = await openTill({ sales: 0 });
    await user.keyboard('{F8}');
    await findLookup();

    await (how === 'at once' ? scan : brokenScan)(otherTerminalQr());

    await findSale(OTHER_RECEIPT_NO);
  });

  it('reads a scan while a button has the focus', async () => {
    const { user, scan } = await openTill();
    await user.keyboard('{F8}');
    await findLookup();
    screen.getByRole('button', { name: 'Back to sale' }).focus();

    await scan(otherTerminalQr());

    await findSale(OTHER_RECEIPT_NO);
  });

  it.each([
    [OTHER_RECEIPT_NO, /not on this terminal.*scan the code/i],
    ['S09-T1-000001', /another store/i],
    ['{"saleId":', /could not be read/i],
    ['R-S01-T1-000001', /return receipt/i],
    [LINEN_BARCODE, /not a receipt/i],
  ])('says why %s finds nothing, ready for another try', async (entry, message) => {
    const { user, stores } = await openTill();
    await user.keyboard('{F8}');
    const lookup = await findLookup();

    await user.paste(entry);
    await user.keyboard('{Enter}');

    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    // The whole entry is selected, so the next one replaces it.
    expect(lookup.value.slice(lookup.selectionStart!, lookup.selectionEnd!)).toBe(entry);
    expect(stores.cart.getState().lines).toEqual([]);
  });
});

describe('a receipt on the sale screen', () => {
  it.each(['at once', 'with a pause'])(
    'opens in Returns when scanned %s, and keeps the cart',
    async (how) => {
      const { user, scan, brokenScan } = await openTill({ sales: 0 });
      await scan(LINEN_BARCODE);

      await (how === 'at once' ? scan : brokenScan)(otherTerminalQr());

      await findSale(OTHER_RECEIPT_NO);
      // Once to close the sale, once to leave Returns.
      await user.keyboard('{Escape}');
      await user.keyboard('{Escape}');
      const scanBox = await findScanBox();
      expect(scanBox.value).toBe('');
      expect(cartLines()).toHaveLength(1);
      await isFocused(scanBox);
    },
  );

  it('opens in Returns when its number is scanned', async () => {
    const { scan } = await openTill();

    await scan('S01-T1-000001');

    await findSale('S01-T1-000001');
  });

  it('opens in Returns when its number or code is entered in the scan box', async () => {
    const { user } = await openTill();

    await user.keyboard('S01-T1-000001{Enter}');
    await findSale('S01-T1-000001');

    await user.click(screen.getByRole('button', { name: 'Back to sale' }));
    await findScanBox();
    await user.paste(otherTerminalQr());
    await user.keyboard('{Enter}');
    await findSale(OTHER_RECEIPT_NO);
  });

  it('leaves payment keys alone on Returns, even with items in the cart', async () => {
    const { user, scan } = await openTill();
    await scan(LINEN_BARCODE);
    await user.keyboard('{F8}');
    await findLookup();

    await user.keyboard('{F2}{F3}{F4}');

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
