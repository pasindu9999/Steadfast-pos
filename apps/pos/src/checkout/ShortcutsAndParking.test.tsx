// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { CASHIER, LINEN_BARCODE, MANAGER_PIN, seedShop, TEE_BARCODE } from '../test/shop';

afterEach(() => vi.restoreAllMocks());

async function openTill({ items = [LINEN_BARCODE] } = {}) {
  const database = await seedShop();
  const clock = createKeyClock();
  const view = renderPos({
    database,
    signedInAs: CASHIER,
    services: { keyTime: clock.read, beep: vi.fn() },
  });
  const scanBox = await findScanBox();
  const scan = (code: string) => clock.scanning(() => view.user.keyboard(`${code}{Enter}`));
  for (const code of items) await scan(code);
  return { ...view, database, scanBox, scan };
}

type Till = Awaited<ReturnType<typeof openTill>>;

const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
const dialog = () => screen.getByRole('dialog');
const amount = (id: string) => screen.getByTestId(id).textContent;
const lines = () => within(screen.getByRole('region', { name: 'Cart' })).queryAllByRole('listitem');
const noDialog = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
const isFocused = (element: Element) => waitFor(() => expect(document.activeElement).toBe(element));
const received = () =>
  within(dialog()).getByRole<HTMLInputElement>('textbox', { name: /cash received/i });

async function park({ user }: Till) {
  await user.click(button('Park sale'));
  await waitFor(() => expect(lines()).toHaveLength(0));
}

async function openParked({ user }: Till) {
  await user.click(await screen.findByRole('button', { name: /^parked sales \(\d+\)/i }));
  return screen.findByRole('dialog', { name: 'Parked sales' });
}

describe('keyboard shortcuts', () => {
  it('opens cash with F2, fills the exact amount with F2 again, and pays with Enter', async () => {
    const till = await openTill();

    await till.user.keyboard('{F2}');
    expect(screen.getByRole('dialog', { name: 'Cash payment' })).toBeTruthy();
    expect(received().value).toBe('');
    await till.user.keyboard('{F2}');
    expect(received().value).toBe('89.00');
    await till.user.keyboard('{Enter}');

    await screen.findByRole('heading', { name: 'Sale complete' });
    expect(await till.database.sales.count()).toBe(1);
  });

  it('opens card with F3 and the cart discount with F4, and closes with Escape', async () => {
    const till = await openTill();

    await till.user.keyboard('{F3}');
    expect(screen.getByRole('dialog', { name: 'Card payment' })).toBeTruthy();
    await till.user.keyboard('{Escape}');
    await noDialog();
    await isFocused(till.scanBox);

    await till.user.keyboard('{F4}');
    expect(screen.getByRole('dialog', { name: 'Cart discount' })).toBeTruthy();
    await till.user.keyboard('{Escape}');
    await noDialog();
    await isFocused(till.scanBox);
  });

  it('does not change steps while one is open', async () => {
    const till = await openTill();
    await till.user.keyboard('{F3}');

    await till.user.keyboard('{F2}{F4}');

    expect(screen.getByRole('dialog', { name: 'Card payment' })).toBeTruthy();
  });

  it('ignores them on an empty cart, but keeps the browser out of the way', async () => {
    const till = await openTill({ items: [] });

    // `false`: the browser's own F3 (find) is cancelled.
    expect(fireEvent.keyDown(till.scanBox, { key: 'F3' })).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fireEvent.keyDown(till.scanBox, { key: 'F4', altKey: true })).toBe(true);
  });

  it('clears the search and message with Escape, wherever the focus is', async () => {
    const till = await openTill();
    await till.user.keyboard('9300000000001{Enter}');
    expect(screen.getByTestId('notice')).toBeTruthy();
    button('Cart discount').focus();

    await till.user.keyboard('{Escape}');

    expect(screen.queryByTestId('notice')).toBeNull();
  });

  it('asks for a waiting approval before F2 opens payment', async () => {
    const till = await openTill({ items: [LINEN_BARCODE, LINEN_BARCODE] });
    await till.user.keyboard('{Escape}');
    await till.user.click(button('Discount on Linen Shirt — Black / M'));
    await till.user.click(within(dialog()).getByRole('radio', { name: /dollars/i }));
    await till.user.type(within(dialog()).getByRole('textbox'), '20{Enter}');
    await till.user.click(button(/decrease quantity of linen/i));

    await till.user.keyboard('{F2}');

    expect(screen.queryByRole('dialog', { name: 'Cash payment' })).toBeNull();
    expect(await screen.findByRole('button', { name: /morgan manager/i })).toBeTruthy();
  });
});

describe('park sale', () => {
  it('cannot park or list anything at first', async () => {
    await openTill({ items: [] });

    expect(button('Park sale').disabled).toBe(true);
    expect(button(/^parked sales \(0\)/i).disabled).toBe(true);
  });

  it('puts the sale aside and starts an empty one', async () => {
    const till = await openTill();

    await park(till);

    expect(amount('total')).toBe('$0.00');
    expect(screen.getByTestId('notice').textContent).toMatch(/parked/i);
    expect(await screen.findByRole('button', { name: /^parked sales \(1\)/i })).toBeTruthy();
    await isFocused(till.scanBox);
    expect(await till.database.sales.count()).toBe(0);
  });

  it('lets the cashier log out', async () => {
    const till = await openTill();
    expect(button('Log out').disabled).toBe(true);

    await park(till);

    expect(button('Log out').disabled).toBe(false);
  });

  it('brings a sale back with its discounts and approvals', async () => {
    const till = await openTill({ items: [LINEN_BARCODE, TEE_BARCODE] });
    await till.user.keyboard('{F4}');
    await till.user.type(within(dialog()).getByRole('textbox'), '25{Enter}');
    await till.user.click(await screen.findByRole('button', { name: /morgan manager/i }));
    await till.user.keyboard(`${MANAGER_PIN}{Enter}`);
    await noDialog();
    expect(amount('total')).toBe('$93.00');
    await park(till);

    const list = await openParked(till);
    expect(list.textContent).toContain('2 items');
    expect(list.textContent).toContain('$93.00');
    expect(list.textContent).toContain('Casey Cashier');
    await till.user.click(within(list).getByRole('button', { name: /resume/i }));

    await noDialog();
    expect(lines()).toHaveLength(2);
    expect(amount('total')).toBe('$93.00');
    expect(screen.queryByTestId('approval-banner')).toBeNull();
    await isFocused(till.scanBox);
    expect(button(/^parked sales \(0\)/i).disabled).toBe(true);
  });

  it('will not resume over a sale in progress', async () => {
    const till = await openTill();
    await park(till);
    await till.scan(TEE_BARCODE);

    const list = await openParked(till);

    expect(within(list).getByRole<HTMLButtonElement>('button', { name: /resume/i }).disabled).toBe(
      true,
    );
    expect(list.textContent).toMatch(/current sale first/i);
  });

  it('discards a parked sale after a second press', async () => {
    const till = await openTill();
    await park(till);
    const list = await openParked(till);

    await till.user.click(within(list).getByRole('button', { name: /^discard/i }));
    expect(within(list).getByRole('button', { name: /resume/i })).toBeTruthy();
    await till.user.click(within(list).getByRole('button', { name: /confirm discard/i }));

    await waitFor(() => expect(within(dialog()).queryByRole('listitem')).toBeNull());
    expect(await till.database.settings.get('parkedSales')).toMatchObject({ value: [] });
  });

  it('says so when a sale cannot be discarded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const till = await openTill();
    await park(till);
    const list = await openParked(till);
    till.database.settings.hook('updating', () => {
      throw new Error('disk trouble');
    });

    await till.user.click(within(list).getByRole('button', { name: /^discard/i }));
    await till.user.click(within(list).getByRole('button', { name: /confirm discard/i }));

    await noDialog();
    expect(screen.getByTestId('notice').textContent).toMatch(/not discarded/i);
    expect(button(/^parked sales \(1\)/i).disabled).toBe(false);
  });

  it('works by keyboard alone', async () => {
    const till = await openTill();
    button('Park sale').focus();
    await till.user.keyboard('{Enter}');
    await waitFor(() => expect(lines()).toHaveLength(0));

    const opener = await screen.findByRole('button', { name: /^parked sales \(1\)/i });
    opener.focus();
    await till.user.keyboard('{Enter}');
    const resume = await screen.findByRole('button', { name: /resume/i });
    await isFocused(resume);
    await till.user.keyboard('{Enter}');

    await noDialog();
    expect(lines()).toHaveLength(1);
    await isFocused(till.scanBox);
  });

  it('keeps the cart when it cannot be saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const till = await openTill();
    till.database.settings.hook('creating', () => {
      throw new Error('disk trouble');
    });

    await till.user.click(button('Park sale'));

    await waitFor(() => expect(screen.getByTestId('notice').textContent).toMatch(/not parked/i));
    expect(lines()).toHaveLength(1);
    await till.scan(TEE_BARCODE);
    expect(lines()).toHaveLength(2);
  });
});
