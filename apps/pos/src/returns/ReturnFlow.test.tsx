// @vitest-environment jsdom
/** Taking a return at the till, with the network cut (CLAUDE.md rule 1). */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaleDraft, TenderInput } from '../checkout/sale-draft';
import { getSetting } from '../db/settings-repo';
import { cart, cartLine } from '../test/checkout-fixtures';
import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { makeSale, OTHER_RECEIPT_NO, otherTerminalQr } from '../test/return-fixtures';
import { CASHIER, MANAGER_PIN, seedShop } from '../test/shop';

const fetch = vi.fn(() => Promise.reject(new Error('offline')));
beforeEach(() => vi.stubGlobal('fetch', fetch));
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const SHIRT = 'Linen Shirt — Black / M';

interface OpenOptions {
  draft?: SaleDraft;
  tender?: TenderInput;
}

/** The till, signed in, on Returns, after one sale (three shirts for cash unless told). */
async function openReturns({ draft, tender }: OpenOptions = {}) {
  const database = await seedShop();
  await makeSale(database, draft, tender);
  const clock = createKeyClock();
  const view = renderPos({
    database,
    signedInAs: CASHIER,
    services: { keyTime: clock.read, beep: vi.fn() },
  });
  await findScanBox();
  await view.user.keyboard('{F8}');
  const lookup = await screen.findByRole<HTMLInputElement>('textbox', { name: /receipt number/i });
  const find = async (entry: string) => {
    await view.user.click(lookup);
    await view.user.paste(entry);
    await view.user.keyboard('{Enter}');
    return screen.findByRole('region', { name: /^Sale / });
  };
  return { ...view, database, lookup, find };
}

const quantity = () =>
  screen.getByRole<HTMLInputElement>('textbox', { name: /quantity to return/i });
const reason = () => screen.getByRole<HTMLInputElement>('textbox', { name: /^reason/i });
const method = (name: 'Cash' | 'Card') => screen.getByRole<HTMLInputElement>('radio', { name });
const complete = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Complete return' });
const amountDue = () => screen.getByTestId('refund-due').textContent;
const findReceipt = (returnNo = 'R-S01-T1-000001') =>
  screen.findByRole('article', { name: `Return receipt ${returnNo}` });
const isFocused = (element: Element) => waitFor(() => expect(document.activeElement).toBe(element));
const noDialog = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

type User = Awaited<ReturnType<typeof openReturns>>['user'];

async function tabTo(user: User, element: Element) {
  for (let presses = 0; presses < 40 && document.activeElement !== element; presses += 1) {
    await user.tab();
  }
  expect(document.activeElement).toBe(element);
}

async function approve(user: User, pin = MANAGER_PIN) {
  await user.click(await screen.findByRole('button', { name: /morgan manager/i }));
  await user.keyboard(`${pin}{Enter}`);
}

/** One shirt, with a reason: ready to complete once there is a method. */
async function chooseOne(user: User) {
  await user.type(quantity(), '1');
  await user.type(reason(), 'Wrong size');
}

describe('a cash return', () => {
  it('is made by keyboard alone, shows its receipt and gives the scan box back', async () => {
    const { user, database } = await openReturns();
    await user.keyboard('S01-T1-000001{Enter}');
    await screen.findByRole('region', { name: 'Sale S01-T1-000001' });
    expect(method('Cash').checked).toBe(true);
    expect(complete().disabled).toBe(true);

    await tabTo(user, quantity());
    await user.keyboard('1');
    await tabTo(user, reason());
    await user.keyboard('Wrong size');
    expect(amountDue()).toBe('$89.00');
    await user.keyboard('{Enter}');

    const receipt = await findReceipt();
    expect(receipt.textContent).toContain('RETURN');
    expect(receipt.textContent).toContain('S01-T1-000001');
    expect(receipt.textContent).toContain(SHIRT);
    expect(receipt.textContent).toContain('Refunded by cash');
    expect(receipt.textContent).toContain('Served by Casey Cashier');
    expect(screen.getByRole('heading', { name: 'Return complete' })).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    const done = screen.getByRole('button', { name: 'Done' });
    await isFocused(done);
    await user.keyboard('{Enter}');
    await isFocused(await findScanBox());

    expect(await database.returns.count()).toBe(1);
    expect((await database.outbox.toArray()).map((row) => row.type)).toEqual([
      'SALE_COMPLETED',
      'RETURN_COMPLETED',
    ]);
  });

  it('makes one return however often Enter is pressed', async () => {
    const { user, database, find } = await openReturns();
    await find('S01-T1-000001');
    await chooseOne(user);

    await user.keyboard('{Enter}{Enter}{Enter}');

    await findReceipt();
    expect(await database.returns.count()).toBe(1);
    expect(await getSetting(database, 'returnSeq')).toBe(1);
  });

  it('shows the 5c rounding before the money is handed back', async () => {
    const { user, find } = await openReturns({
      draft: cart({ lines: [cartLine({ unitPriceCents: 1002 })] }),
    });
    await find('S01-T1-000001');
    await user.type(quantity(), '1');

    expect(screen.getByTestId('refund-total').textContent).toBe('$10.02');
    expect(screen.getByTestId('refund-rounding').textContent).toBe('-$0.02');
    expect(amountDue()).toBe('$10.00');
  });

  it('keeps a damaged item out of stock', async () => {
    const { user, database, find } = await openReturns();
    await find('S01-T1-000001');
    await chooseOne(user);

    await user.click(screen.getByRole('checkbox', { name: /back into stock/i }));
    await user.click(complete());

    expect((await findReceipt()).textContent).toContain('Not returned to stock');
    expect((await database.stockMovements.toArray()).map((m) => m.reason)).toEqual(['sale']);
  });

  it('holds the quantity to what is left, and moves it with the buttons', async () => {
    const { user, find } = await openReturns();
    await find('S01-T1-000001');
    const less = screen.getByRole<HTMLButtonElement>('button', { name: /one less/i });
    const more = screen.getByRole<HTMLButtonElement>('button', { name: /one more/i });
    expect(less.disabled).toBe(true);

    await user.type(quantity(), '9');
    expect(quantity().value).toBe('3');
    expect(more.disabled).toBe(true);

    await user.click(less);
    expect(quantity().value).toBe('2');
    await user.clear(quantity());
    await user.click(more);
    expect(quantity().value).toBe('1');
  });

  it('fills the reason from a quick choice', async () => {
    const { user, find } = await openReturns();
    await find('S01-T1-000001');

    await user.click(screen.getByRole('button', { name: 'Faulty' }));

    expect(reason().value).toBe('Faulty');
  });

  it('says so when the return cannot be saved, and keeps what was chosen', async () => {
    const { user, database, find } = await openReturns();
    database.returns.hook('creating', () => {
      throw new Error('power cut');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await find('S01-T1-000001');
    await chooseOne(user);

    await user.click(complete());

    expect((await screen.findByRole('alert')).textContent).toMatch(/return was not saved/i);
    expect(quantity().value).toBe('1');
    expect(await database.outbox.count()).toBe(1);
    vi.restoreAllMocks();
  });
});

describe('a card return', () => {
  const openCardSale = async () => {
    const view = await openReturns({ tender: { method: 'card' } });
    await view.find('S01-T1-000001');
    await chooseOne(view.user);
    return view;
  };

  it('defaults to card and asks whether the terminal approved the refund', async () => {
    const { user, database } = await openCardSale();
    expect(method('Card').checked).toBe(true);

    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Card refund' });
    await user.type(within(dialog).getByRole('textbox'), '000456{Enter}');
    // Enter in the field approves nothing.
    expect(await database.returns.count()).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Yes, approved' }));

    expect((await findReceipt()).textContent).toContain('Refunded by card');
    expect((await database.returns.toArray())[0]?.refunds[0]).toMatchObject({
      method: 'card',
      cardReference: '000456',
    });
  });

  it('saves nothing when the refund is declined', async () => {
    const { user, database, lookup } = await openCardSale();
    await user.click(complete());

    await user.click(await screen.findByRole('button', { name: 'No, declined' }));

    await noDialog();
    await isFocused(lookup);
    expect(await database.returns.count()).toBe(0);
    expect(quantity().value).toBe('1');
  });
});

describe('a return that needs a manager', () => {
  it('asks above $100.00, and takes only the right PIN', async () => {
    const { user, database, find } = await openReturns();
    await find('S01-T1-000001');
    await user.type(quantity(), '2');
    await user.type(reason(), 'Wrong size{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Manager approval' });
    expect(dialog.textContent).toContain('$178.00');
    await approve(user, '0000');
    expect((await screen.findByRole('alert')).textContent).toMatch(/pin/i);
    expect(await database.returns.count()).toBe(0);
    await user.keyboard(`${MANAGER_PIN}{Enter}`);

    await findReceipt();
    expect(await database.returns.count()).toBe(1);
  });

  it('takes the other terminal’s sale once a method is chosen and a manager approves', async () => {
    const { user, database, find, lookup } = await openReturns();
    const sale = await find(otherTerminalQr());
    expect(sale.textContent).toContain('Check the paper receipt');
    expect(method('Cash').checked).toBe(false);
    expect(method('Card').checked).toBe(false);
    await chooseOne(user);
    expect(complete().disabled).toBe(true);
    await user.click(method('Cash'));

    // Cancelled first: nothing is saved.
    await user.click(complete());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await noDialog();
    await isFocused(lookup);
    expect(await database.returns.count()).toBe(0);

    await user.click(complete());
    await approve(user);

    const receipt = await findReceipt();
    expect(receipt.textContent).toContain(OTHER_RECEIPT_NO);
    expect(amountDue()).toBe('$89.00');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await isFocused(await findScanBox());
  });
});

describe('a sale with nothing to return', () => {
  it('offers no return once everything is back', async () => {
    const { user, find } = await openReturns({ draft: cart() });
    await find('S01-T1-000001');
    await chooseOne(user);
    await user.click(complete());
    await findReceipt();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await findScanBox();

    await user.keyboard('S01-T1-000001{Enter}');
    const sale = await screen.findByRole('region', { name: 'Sale S01-T1-000001' });

    expect(sale.textContent).toContain('Returned 1');
    expect(sale.textContent).toContain('Everything on this sale has been returned');
    expect(screen.queryByRole('button', { name: 'Complete return' })).toBeNull();
  });

  it('offers none for a voided sale', async () => {
    const { database, find } = await openReturns();
    await database.sales.toCollection().modify({ status: 'voided' });

    const sale = await find('S01-T1-000001');

    expect(sale.textContent).toContain('VOIDED');
    expect(screen.queryByRole('button', { name: 'Complete return' })).toBeNull();
  });
});
