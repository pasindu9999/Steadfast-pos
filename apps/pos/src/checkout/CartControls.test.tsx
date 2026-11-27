// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LINEN_ID } from '../test/checkout-fixtures';
import { storeFixture } from '../test/fixtures';
import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { CASHIER, LINEN_BARCODE, MANAGER_PIN, seedShop, TEE_BARCODE } from '../test/shop';
import { priceCart } from './price-cart';

const CHIP = 'System shows 0 — sale allowed';

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

const cartRegion = () => screen.getByRole('region', { name: 'Cart' });
const lines = () => within(cartRegion()).queryAllByRole('listitem');
const qtys = () => lines().map((line) => within(line).getByTestId('qty').textContent);
const amount = (id: string) => screen.getByTestId(id).textContent;
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
const dialog = () => screen.getByRole('dialog');
const noDialog = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
const isFocused = (element: Element) => waitFor(() => expect(document.activeElement).toBe(element));
const banner = () => screen.queryByTestId('approval-banner');

/** Picks the manager and types the PIN in the open approval dialog. */
async function approve({ user }: Till) {
  await user.click(await screen.findByRole('button', { name: /morgan manager/i }));
  await user.keyboard(`${MANAGER_PIN}{Enter}`);
}

async function enterDiscount(
  { user }: Till,
  opener: string,
  text: string,
  kind: 'percent' | 'fixed' = 'percent',
) {
  await user.click(button(opener));
  if (kind === 'fixed') await user.click(within(dialog()).getByRole('radio', { name: /dollars/i }));
  const field = within(dialog()).getByRole('textbox');
  await user.type(field, `${text}{Enter}`);
}

const LINEN_DISCOUNT = 'Discount on Linen Shirt — Black / M';

describe('quantities', () => {
  it('goes up and down, keeping the totals and the focus', async () => {
    const { user, scanBox } = await openTill();

    await user.click(button(/increase quantity of linen/i));
    expect(qtys()).toEqual(['2']);
    expect(amount('total')).toBe('$178.00');
    await isFocused(scanBox);

    await user.click(button(/decrease quantity of linen/i));
    expect(qtys()).toEqual(['1']);
    await isFocused(scanBox);
  });

  it('cannot go below one: removing is its own action', async () => {
    await openTill();

    expect(button(/decrease quantity of linen/i).disabled).toBe(true);
  });

  it('can be typed', async () => {
    const till = await openTill();

    await till.user.click(button(/edit quantity of linen/i));
    const field = within(dialog()).getByRole<HTMLInputElement>('textbox');
    await isFocused(field);
    // The current value is selected, so typing replaces it.
    await till.user.keyboard('4{Enter}');

    await noDialog();
    expect(qtys()).toEqual(['4']);
    expect(amount('total')).toBe('$356.00');
    await isFocused(till.scanBox);
  });

  it('refuses a quantity that is not one', async () => {
    const { user } = await openTill();

    await user.click(button(/edit quantity of linen/i));
    await user.keyboard('0{Enter}');

    expect(within(dialog()).getByRole('alert').textContent).toBe(
      'Enter a whole number from 1 to 999.',
    );
    expect(qtys()).toEqual(['1']);
  });

  it('asks a manager above ten', async () => {
    const till = await openTill();

    await till.user.click(button(/edit quantity of linen/i));
    await till.user.keyboard('12{Enter}');
    await approve(till);

    await waitFor(() => expect(qtys()).toEqual(['12']));
    await isFocused(till.scanBox);
  });

  it('is unchanged when that approval is cancelled', async () => {
    const till = await openTill();

    await till.user.click(button(/edit quantity of linen/i));
    await till.user.keyboard('12{Enter}');
    await screen.findByRole('button', { name: /morgan manager/i });
    await till.user.keyboard('{Escape}');

    await noDialog();
    expect(qtys()).toEqual(['1']);
    await isFocused(till.scanBox);
  });
});

describe('removing and undoing', () => {
  it('removes a line and returns to the scan box', async () => {
    const { user, scanBox } = await openTill({ items: [LINEN_BARCODE, TEE_BARCODE] });

    await user.click(button(/remove linen/i));

    expect(lines()).toHaveLength(1);
    expect(amount('total')).toBe('$35.00');
    await isFocused(scanBox);
  });

  it('undoes the last scans one at a time', async () => {
    const { user, scanBox } = await openTill({
      items: [LINEN_BARCODE, TEE_BARCODE, TEE_BARCODE],
    });

    await user.click(button(/undo last scan/i));
    expect(qtys()).toEqual(['1', '1']);
    await isFocused(scanBox);
    await user.click(button(/undo last scan/i));
    await user.click(button(/undo last scan/i));

    expect(lines()).toHaveLength(0);
    expect(button(/undo last scan/i).disabled).toBe(true);
  });

  it('clears the sale only after a yes', async () => {
    const { user, scanBox } = await openTill({ items: [LINEN_BARCODE, TEE_BARCODE] });

    await user.click(button(/clear sale/i));
    await user.click(within(dialog()).getByRole('button', { name: /keep/i }));
    expect(lines()).toHaveLength(2);
    await isFocused(scanBox);

    await user.click(button(/clear sale/i));
    await user.click(within(dialog()).getByRole('button', { name: /yes, clear/i }));
    expect(lines()).toHaveLength(0);
    await isFocused(scanBox);
  });

  it('has nothing to act on in an empty cart', async () => {
    await openTill({ items: [] });

    for (const name of [/undo last scan/i, /cart discount/i, /clear sale/i]) {
      expect(button(name).disabled).toBe(true);
    }
  });

  it('keeps the cashier logged in while there are items', async () => {
    await openTill();

    expect(button(/log out/i).disabled).toBe(true);
  });

  it('works from the keyboard alone', async () => {
    const { user, scanBox } = await openTill();
    const increase = button(/increase quantity of linen/i);

    for (let tabs = 0; tabs < 10 && document.activeElement !== increase; tabs += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(increase);
    await user.keyboard('{Enter}');

    expect(qtys()).toEqual(['2']);
    await isFocused(scanBox);
  });
});

describe('discounts', () => {
  it('applies a small line discount straight away', async () => {
    const till = await openTill();

    await enterDiscount(till, LINEN_DISCOUNT, '10');

    await noDialog();
    expect(lines()[0]!.textContent).toContain('10% off');
    expect(amount('discount')).toBe('-$8.90');
    expect(amount('total')).toBe('$80.10');
    await isFocused(till.scanBox);
  });

  it('applies a dollar discount to the whole cart', async () => {
    const till = await openTill({ items: [LINEN_BARCODE, TEE_BARCODE] });

    await enterDiscount(till, 'Cart discount', '10', 'fixed');

    await noDialog();
    expect(amount('discount')).toBe('-$10.00');
    expect(amount('total')).toBe('$114.00');
    expect(button('Cart discount').parentElement!.textContent).toContain('$10.00 off');
  });

  it.each([
    ['101', 'A discount can’t be more than 100%.'],
    ['12.5', 'Enter a whole percentage from 0 to 100.'],
  ])('refuses %s %', async (text, message) => {
    const till = await openTill();

    await enterDiscount(till, LINEN_DISCOUNT, text);

    expect(within(dialog()).getByRole('alert').textContent).toBe(message);
    expect(amount('total')).toBe('$89.00');
  });

  it('refuses more dollars than the line', async () => {
    const till = await openTill();

    await enterDiscount(till, LINEN_DISCOUNT, '90', 'fixed');

    expect(within(dialog()).getByRole('alert').textContent).toBe(
      'That is more than the line total of $89.00.',
    );
  });

  it('can be removed', async () => {
    const till = await openTill();
    await enterDiscount(till, LINEN_DISCOUNT, '10');

    await till.user.click(button(LINEN_DISCOUNT));
    await till.user.click(within(dialog()).getByRole('button', { name: 'Remove discount' }));

    await noDialog();
    expect(amount('total')).toBe('$89.00');
    expect(screen.queryByTestId('discount')).toBeNull();
  });

  it('needs a manager above 20 %', async () => {
    const till = await openTill();

    await enterDiscount(till, LINEN_DISCOUNT, '25');

    expect(dialog().textContent).toContain('Discount of 25% on Linen Shirt — Black / M');
    expect(amount('total')).toBe('$89.00');
    await approve(till);
    await noDialog();
    expect(amount('total')).toBe('$66.75');
    expect(banner()).toBeNull();
    await isFocused(till.scanBox);
  });

  it('can be given and approved with the keyboard alone', async () => {
    const till = await openTill();
    const opener = button('Cart discount');
    for (let tabs = 0; tabs < 12 && document.activeElement !== opener; tabs += 1) {
      await till.user.tab();
    }

    await till.user.keyboard('{Enter}');
    // Back to the percent / dollars choice, change it, and return to the amount.
    await till.user.tab({ shift: true });
    await till.user.keyboard('{ArrowRight}');
    await till.user.tab();
    await till.user.keyboard('30{Enter}');
    await screen.findByRole('button', { name: /morgan manager/i });
    await till.user.keyboard('{Enter}');
    await till.user.keyboard(`${MANAGER_PIN}{Enter}`);

    await noDialog();
    expect(amount('total')).toBe('$59.00');
    await isFocused(till.scanBox);
  });

  it('is not applied when the approval is cancelled', async () => {
    const till = await openTill();

    await enterDiscount(till, 'Cart discount', '50');
    await screen.findByRole('button', { name: /morgan manager/i });
    await till.user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    await noDialog();
    expect(amount('total')).toBe('$89.00');
    await isFocused(till.scanBox);
  });

  it('is not applied after a wrong PIN', async () => {
    const till = await openTill();

    await enterDiscount(till, LINEN_DISCOUNT, '25');
    await till.user.click(await screen.findByRole('button', { name: /morgan manager/i }));
    await till.user.keyboard('1111{Enter}');

    expect(await within(dialog()).findByText(/wrong pin/i)).toBeTruthy();
    expect(amount('total')).toBe('$89.00');
  });

  it('warns, without blocking, when a later change pushes a line over', async () => {
    const till = await openTill({ items: [LINEN_BARCODE, LINEN_BARCODE] });
    // $20 off $178 is 11 %; off $89 it is 22 %.
    await enterDiscount(till, LINEN_DISCOUNT, '20', 'fixed');
    await noDialog();
    expect(banner()).toBeNull();

    await till.user.click(button(/decrease quantity of linen/i));

    expect(qtys()).toEqual(['1']);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(banner()!.textContent).toContain('needs manager approval');
    await till.user.click(within(banner()!).getByRole('button', { name: 'Approve' }));
    await approve(till);
    await waitFor(() => expect(banner()).toBeNull());
    expect(amount('total')).toBe('$69.00');
  });

  it('shows exactly what core calculates', async () => {
    const till = await openTill({ items: [LINEN_BARCODE, TEE_BARCODE, TEE_BARCODE] });
    await enterDiscount(till, LINEN_DISCOUNT, '19');
    // With its share of this, the shirt goes over 20 %.
    await enterDiscount(till, 'Cart discount', '3.33', 'fixed');
    await approve(till);
    await noDialog();

    const state = till.stores.cart.getState();
    const card = priceCart(state, storeFixture, 'card');
    const cash = priceCart(state, storeFixture, 'cash');
    const dollars = (cents: number) =>
      `$${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
    expect(amount('subtotal')).toBe(dollars(card.subtotalCents));
    expect(amount('discount')).toBe(`-${dollars(card.discountCents)}`);
    expect(amount('tax')).toBe(dollars(card.taxCents));
    expect(amount('total')).toBe(dollars(card.totalCents));
    expect(cash.roundingCents).not.toBe(0);
    expect(amount('cash-total')).toBe(dollars(cash.totalCents));
  });
});

describe('stock', () => {
  it('says nothing while the system shows stock', async () => {
    await openTill();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(CHIP)).toBeNull();
  });

  it.each([0, -3])('warns at %i without blocking anything', async (serverOnHand) => {
    const till = await openTill({ items: [] });
    await till.database.inventory.put({ variantId: LINEN_ID, serverOnHand });

    await till.scan(LINEN_BARCODE);

    expect(await screen.findByText(CHIP)).toBeTruthy();
    expect(button(/increase quantity of linen/i).disabled).toBe(false);
    await till.user.click(button(/increase quantity of linen/i));
    expect(qtys()).toEqual(['2']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('follows the stock as it changes', async () => {
    const till = await openTill();

    await till.database.inventory.put({ variantId: LINEN_ID, serverOnHand: 0 });

    expect(await screen.findByText(CHIP)).toBeTruthy();
  });

  it('is not shown for a misc item', async () => {
    const till = await openTill({ items: [] });
    await till.scan('9300000000001');
    await till.user.click(button(/add misc item/i));
    await till.user.keyboard('5{Enter}');
    await approve(till);
    await noDialog();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(CHIP)).toBeNull();
  });
});
