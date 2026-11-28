// @vitest-environment jsdom
/** Printing and reprinting at the till, with the network cut (CLAUDE.md rule 1). */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitSale } from '../checkout/commit-sale';
import { getSetting, putSettings } from '../db/settings-repo';
import type { PosDatabase } from '../db/database';
import { commitReturn } from '../returns/commit-return';
import { commitVoid } from '../returns/commit-void';
import { cart, cartLine } from '../test/checkout-fixtures';
import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { makeSale, OTHER_RECEIPT_NO, otherTerminalQr } from '../test/return-fixtures';
import { CASHIER, LINEN_BARCODE, MANAGER, seedShop, TEE_BARCODE } from '../test/shop';

const fetch = vi.fn(() => Promise.reject(new Error('offline')));
/** jsdom cannot print. */
let print = vi.fn<() => void>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetch);
  print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface OpenOptions {
  database?: PosDatabase;
  route?: string;
  strict?: boolean;
}

async function openTill({ database, route, strict }: OpenOptions = {}) {
  const shop = database ?? (await seedShop());
  const clock = createKeyClock();
  const view = renderPos({
    database: shop,
    route,
    strict,
    signedInAs: CASHIER,
    services: { keyTime: clock.read, beep: vi.fn() },
  });
  const scan = (code: string) => clock.scanning(() => view.user.keyboard(`${code}{Enter}`));
  return { ...view, database: shop, scan };
}

type Till = Awaited<ReturnType<typeof openTill>>;

const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
const findButton = (name: string | RegExp) =>
  screen.findByRole<HTMLButtonElement>('button', { name });
const isFocused = (element: Element) => waitFor(() => expect(document.activeElement).toBe(element));
const autoPrintBox = () =>
  screen.findByRole<HTMLInputElement>('checkbox', { name: /print automatically/i });
const findQr = () => screen.findByRole('img', { name: /^QR code for/ });
/** jsdom loads no images, so the test says when the code has been drawn. */
const drawQr = async () => fireEvent.load(await findQr());
const finishPrinting = () => act(() => void window.dispatchEvent(new Event('afterprint')));

async function sellOne({ user, scan }: Till) {
  await findScanBox();
  await scan(LINEN_BARCODE);
  await user.click(button(/^Cash/));
  const dialog = await screen.findByRole('dialog', { name: 'Cash payment' });
  await user.click(within(dialog).getByRole('button', { name: 'Exact' }));
  await user.click(within(dialog).getByRole('button', { name: 'Complete sale' }));
  await screen.findByRole('heading', { name: 'Sale complete' });
}

async function tillWithSale() {
  const database = await seedShop();
  const { sale } = await makeSale(database);
  return { sale, ...(await openTill({ database })) };
}

async function returnOne(database: PosDatabase, saleId: string) {
  return commitReturn(
    {
      ref: { kind: 'local', saleId },
      selections: [{ lineNo: 1, qty: 1, restock: true }],
      reason: 'Wrong size',
      method: 'cash',
      staffId: CASHIER.id,
      approval: null,
      cardReference: null,
    },
    { database, now: () => new Date() },
  );
}

describe('the Print button', () => {
  it('prints the receipt, once its code has been drawn', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(database);
    const { user } = await openTill({ database, route: `/receipt/${sale.id}` });
    const printButton = await findButton('Print');
    expect(printButton.disabled).toBe(true);

    await drawQr();
    expect(print).not.toHaveBeenCalled();
    await user.click(printButton);

    expect(print).toHaveBeenCalledTimes(1);
  });

  it('is on a return receipt too', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(database);
    const { return: returned } = await returnOne(database, sale.id);
    const { user } = await openTill({ database, route: `/return/${returned.id}` });
    await screen.findByRole('article', { name: `Return receipt ${returned.returnNo}` });

    await user.click(button('Print'));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it('prints a voided receipt, which has no code to wait for', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(database);
    await commitVoid(
      { saleId: sale.id, reason: '', approval: MANAGER },
      { database, now: () => new Date() },
    );
    const { user } = await openTill({ database, route: `/receipt/${sale.id}` });
    await screen.findByText('VOIDED');

    await user.click(button('Print'));

    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('returns the focus to New sale when printing is done', async () => {
    const till = await openTill();
    await sellOne(till);
    await drawQr();
    await till.user.click(button('Print'));

    finishPrinting();

    await isFocused(button('New sale'));
  });

  it('returns the focus to Done on a return receipt', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(database);
    const { return: returned } = await returnOne(database, sale.id);
    const { user } = await openTill({ database, route: `/return/${returned.id}` });
    await user.click(await findButton('Print'));

    finishPrinting();

    await isFocused(button('Done'));
  });

  it('returns the focus to the scan box after printing from the browser menu', async () => {
    await openTill();
    const scanBox = await findScanBox();
    scanBox.blur();

    finishPrinting();

    await isFocused(scanBox);
  });
});

describe('auto-print setting', () => {
  it('is off on a new terminal', async () => {
    const till = await openTill();
    await sellOne(till);

    expect((await autoPrintBox()).checked).toBe(false);
    await drawQr();

    expect(print).not.toHaveBeenCalled();
  });

  it('is saved on the terminal', async () => {
    const till = await openTill();
    await sellOne(till);

    await till.user.click(await autoPrintBox());

    await waitFor(async () => expect(await getSetting(till.database, 'autoPrint')).toBe(true));
    expect((await autoPrintBox()).checked).toBe(true);
  });

  it('shows what was saved after the till is reopened', async () => {
    const database = await seedShop();
    await putSettings(database, { autoPrint: true });
    const { sale } = await makeSale(database);

    await openTill({ database, route: `/receipt/${sale.id}` });

    await waitFor(async () => expect((await autoPrintBox()).checked).toBe(true));
  });

  it('does not print the sale being shown when it is turned on', async () => {
    const till = await openTill();
    await sellOne(till);
    await drawQr();

    await till.user.click(await autoPrintBox());

    expect(print).not.toHaveBeenCalled();
  });
});

describe('auto-print after a sale', () => {
  async function autoTill(options: OpenOptions = {}) {
    const database = await seedShop();
    await putSettings(database, { autoPrint: true });
    return openTill({ ...options, database });
  }

  it.each([false, true])('prints once the code is drawn (strict mode: %s)', async (strict) => {
    const till = await autoTill({ strict });
    await sellOne(till);
    await findQr();
    expect(print).not.toHaveBeenCalled();

    await drawQr();
    await drawQr();

    expect(print).toHaveBeenCalledTimes(1);
  });

  it('prints every sale', async () => {
    const till = await autoTill();
    await sellOne(till);
    await drawQr();
    await till.user.click(button('New sale'));
    await findScanBox();

    await sellOne(till);
    await screen.findByRole('article', { name: 'Receipt S01-T1-000002' });
    await drawQr();

    expect(print).toHaveBeenCalledTimes(2);
  });

  it('does not print again when the till reloads on the receipt', async () => {
    const till = await autoTill();
    await sellOne(till);
    await drawQr();
    const saleId = (await till.database.sales.toArray())[0]!.id;
    cleanup();
    print.mockClear();

    await openTill({ database: till.database, route: `/receipt/${saleId}` });
    await drawQr();

    expect(print).not.toHaveBeenCalled();
  });

  it('is dropped if the cashier moves on before the code is drawn', async () => {
    const till = await autoTill();
    await sellOne(till);

    await till.scan(TEE_BARCODE);
    await findScanBox();

    const saleId = (await till.database.sales.toArray())[0]!.id;
    expect(till.services.printer.take(saleId)).toBe(false);
    expect(print).not.toHaveBeenCalled();
    expect(screen.getByTestId('total').textContent).toBe('$35.00');
  });

  it('keeps the sale when printing fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    print.mockImplementation(() => {
      throw new Error('no printer');
    });
    const till = await autoTill();
    await sellOne(till);

    await drawQr();

    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Sale complete' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await till.database.sales.count()).toBe(1);
  });

  it('prints a sale too large for a code, with the note in its place', async () => {
    const database = await seedShop();
    const lines = Array.from({ length: 60 }, () => cartLine({ unitPriceCents: 100 }));
    const { sale } = await commitSale(
      cart({ lines }),
      { method: 'cash', tenderedCents: 10_000 },
      { database },
    );
    const till = await openTill({ database });
    await findScanBox();
    await till.user.click(button(/returns/i));
    await till.user.click(await findButton(`Reprint ${sale.receiptNo}`));

    await screen.findByText(/too large for a QR code/i);

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });
});

describe('printed return receipt', () => {
  it('says RETURN, names the original receipt and carries the footer', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(database);
    const { return: returned } = await returnOne(database, sale.id);
    await openTill({ database, route: `/return/${returned.id}` });

    const receipt = await screen.findByRole('article', {
      name: `Return receipt ${returned.returnNo}`,
    });

    const slip = within(receipt);
    expect(slip.getByText('RETURN')).toBeTruthy();
    expect(slip.getByText(`Original receipt ${sale.receiptNo}`)).toBeTruthy();
    expect(slip.getByText('ABN 00 000 000 000')).toBeTruthy();
    expect(slip.getByText('Demo — © Udara Kurukulasooriya')).toBeTruthy();
    expect(slip.queryByText(/returns within/i)).toBeNull();
    expect(receipt.hasAttribute('data-print-receipt')).toBe(true);
  });
});

describe('reprinting', () => {
  async function inReturns() {
    const till = await tillWithSale();
    await findScanBox();
    await till.user.click(button(/returns/i));
    return till;
  }

  async function expectReprint(receiptNo: string, till: Till) {
    await screen.findByRole('article', { name: `Receipt ${receiptNo}` });
    expect(screen.getByRole('heading', { name: 'Receipt' })).toBeTruthy();
    // Old change is not to be handed over again.
    expect(screen.queryByTestId('change-due')).toBeNull();
    await isFocused(button('Back to Returns'));
    await drawQr();
    expect(print).toHaveBeenCalledTimes(1);
    finishPrinting();
    await isFocused(button('Back to Returns'));
    await till.user.click(button('Back to Returns'));
    await screen.findByRole('heading', { name: 'Returns' });
  }

  it('from the recent sales', async () => {
    const till = await inReturns();

    await till.user.click(await findButton(`Reprint ${till.sale.receiptNo}`));

    await expectReprint(till.sale.receiptNo, till);
  });

  it('from a sale that was looked up', async () => {
    const till = await inReturns();
    await till.user.click(await findButton(new RegExp(`^${till.sale.receiptNo}`)));

    await till.user.click(await findButton('Reprint receipt'));

    await expectReprint(till.sale.receiptNo, till);
  });

  it('of a return, from its sale', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(database);
    const { return: returned } = await returnOne(database, sale.id);
    const till = await openTill({ database });
    await findScanBox();
    await till.user.click(button(/returns/i));
    await till.user.click(await findButton(new RegExp(`^${sale.receiptNo}`)));

    await till.user.click(await findButton(`Reprint return receipt ${returned.returnNo}`));

    await screen.findByRole('article', { name: `Return receipt ${returned.returnNo}` });
    expect(screen.getByRole('heading', { name: 'Return receipt' })).toBeTruthy();
    // The money has already been handed back.
    expect(screen.queryByTestId('refund-due')).toBeNull();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await isFocused(button('Back to Returns'));
  });

  it('is not offered for a sale known only from its code', async () => {
    const till = await openTill();
    await findScanBox();
    await till.user.click(button(/returns/i));
    await till.user.click(await screen.findByRole('textbox', { name: /receipt number/i }));
    await till.user.paste(otherTerminalQr());
    await till.user.keyboard('{Enter}');

    await screen.findByRole('region', { name: `Sale ${OTHER_RECEIPT_NO}` });

    expect(screen.queryByRole('button', { name: /reprint/i })).toBeNull();
  });
});
