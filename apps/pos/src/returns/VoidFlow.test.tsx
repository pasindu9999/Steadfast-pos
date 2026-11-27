// @vitest-environment jsdom
/** Voiding a sale at the till, with the network cut (CLAUDE.md rule 1). */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TenderInput } from '../checkout/sale-draft';
import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { makeSale, otherTerminalQr, recordReturnRows } from '../test/return-fixtures';
import { CASHIER, MANAGER_PIN, seedShop } from '../test/shop';

const fetch = vi.fn(() => Promise.reject(new Error('offline')));
beforeEach(() => vi.stubGlobal('fetch', fetch));
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

/** 12:00 on 27 November in Sydney. */
const SOLD = new Date('2026-11-27T01:00:00.000Z');
const LATER = new Date('2026-11-27T05:00:00.000Z');
const NEXT_DAY = new Date('2026-11-28T01:00:00.000Z');

interface OpenOptions {
  tender?: TenderInput;
  now?: Date;
}

async function openTill({ tender, now = LATER }: OpenOptions = {}) {
  const database = await seedShop();
  const { sale } = await makeSale(database, undefined, tender, () => SOLD);
  const clock = createKeyClock();
  const view = renderPos({
    database,
    signedInAs: CASHIER,
    services: { keyTime: clock.read, beep: vi.fn(), now: () => now },
  });
  await findScanBox();
  await view.user.keyboard('{F8}');
  const lookup = await screen.findByRole<HTMLInputElement>('textbox', { name: /receipt number/i });
  const find = async (entry = 'S01-T1-000001') => {
    await view.user.click(lookup);
    await view.user.paste(entry);
    await view.user.keyboard('{Enter}');
    return screen.findByRole('region', { name: /^Sale / });
  };
  return { ...view, database, sale, lookup, find };
}

const findVoidButton = () => screen.findByRole<HTMLButtonElement>('button', { name: 'Void sale' });
const isFocused = (element: Element) => waitFor(() => expect(document.activeElement).toBe(element));
const noDialog = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

describe('voiding a sale', () => {
  it('takes a manager’s PIN, shows the voided receipt and gives the scan box back', async () => {
    const { user, database, sale, find } = await openTill();
    await find();

    (await findVoidButton()).focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Void sale' });
    await within(dialog).findByText(/hand back \$267\.00 in cash/i);
    await user.type(within(dialog).getByRole('textbox', { name: /reason/i }), 'Rung up twice');
    await user.click(await within(dialog).findByRole('button', { name: /morgan manager/i }));
    // No PIN yet: nothing happens.
    await user.keyboard('{Enter}');
    await user.keyboard('0000{Enter}');
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/pin/i);
    expect((await database.sales.get(sale.id))?.status).toBe('completed');
    await user.keyboard(`${MANAGER_PIN}{Enter}`);

    await screen.findByRole('heading', { name: 'Sale voided' });
    const receipt = await screen.findByRole('article', { name: 'Receipt S01-T1-000001' });
    expect(receipt.textContent).toContain('VOIDED');
    expect(screen.queryByTestId('change-due')).toBeNull();
    expect(screen.queryByRole('img', { name: /qr code/i })).toBeNull();
    await noDialog();
    expect(await database.sales.get(sale.id)).toMatchObject({
      status: 'voided',
      voidReason: 'Rung up twice',
    });
    expect((await database.outbox.toArray()).map((row) => row.type)).toEqual([
      'SALE_COMPLETED',
      'SALE_VOIDED',
    ]);

    const next = screen.getByRole('button', { name: 'New sale' });
    await isFocused(next);
    await user.keyboard('{Enter}');
    await isFocused(await findScanBox());
  });

  it('says to reverse a card payment on the terminal', async () => {
    const { user, find } = await openTill({ tender: { method: 'card' } });
    await find();

    await user.click(await findVoidButton());

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/reverse \$267\.00 on the eftpos terminal/i);
  });

  it.each(['Cancel', 'Escape'])('saves nothing after %s', async (way) => {
    const { user, database, find, lookup } = await openTill();
    await find();
    await user.click(await findVoidButton());
    await screen.findByRole('dialog');

    if (way === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await noDialog();
    await isFocused(lookup);
    expect(await database.outbox.count()).toBe(1);
    // The sale is still open.
    expect(screen.getByRole('region', { name: 'Sale S01-T1-000001' })).toBeDefined();
  });
});

describe('a sale that cannot be voided', () => {
  it('says why for a sale of an earlier day', async () => {
    const { find } = await openTill({ now: NEXT_DAY });
    const sale = await find();

    expect((await findVoidButton()).disabled).toBe(true);
    expect(sale.textContent).toContain('only on the day it was made');
  });

  it('says why for another terminal’s sale', async () => {
    const { find } = await openTill();
    const sale = await find(otherTerminalQr());

    expect((await findVoidButton()).disabled).toBe(true);
    expect(sale.textContent).toContain('Only the terminal that made a sale can void it');
  });

  it('says why for a sale with a return', async () => {
    const { database, sale: made, find } = await openTill();
    await recordReturnRows(database, made.id, [[1, 1]]);
    const sale = await find();

    expect((await findVoidButton()).disabled).toBe(true);
    expect(sale.textContent).toContain('has been returned');
  });

  it('offers no void for a voided sale', async () => {
    const { database, find } = await openTill();
    await database.sales.toCollection().modify({ status: 'voided' });

    await find();

    expect(screen.queryByRole('button', { name: 'Void sale' })).toBeNull();
  });
});
