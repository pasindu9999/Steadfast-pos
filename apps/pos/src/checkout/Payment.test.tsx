// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { CASHIER, LINEN_BARCODE, MANAGER_PIN, seedShop, TEE_BARCODE } from '../test/shop';

afterEach(() => vi.restoreAllMocks());

// Linen $89.00 + Tee $35.00 = $124.00. With 7% off the sale: $115.32, or $115.30 in cash.
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
const inDialog = (name: string | RegExp) =>
  within(dialog()).getByRole<HTMLButtonElement>('button', { name });
const field = (name: string | RegExp) =>
  within(dialog()).getByRole<HTMLInputElement>('textbox', { name });
const amount = (id: string) => screen.getByTestId(id).textContent;
const noDialog = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
const isFocused = (element: Element) => waitFor(() => expect(document.activeElement).toBe(element));
const saved = () => screen.findByRole('heading', { name: 'Sale complete' });

async function openPayment({ user }: Till, method: 'Cash' | 'Card') {
  await user.click(button(method));
  return screen.findByRole('dialog', { name: `${method} payment` });
}

async function discountCart({ user }: Till, percent: string) {
  await user.click(button('Cart discount'));
  await user.type(field(/percent off/i), `${percent}{Enter}`);
}

describe('payment buttons', () => {
  it('wait for something to sell', async () => {
    await openTill({ items: [] });

    expect(button('Cash').disabled).toBe(true);
    expect(button('Card').disabled).toBe(true);
  });
});

describe('cash', () => {
  it('shows the 5c rounding as its own line', async () => {
    const till = await openTill({ items: [LINEN_BARCODE, TEE_BARCODE] });
    await discountCart(till, '7');

    await openPayment(till, 'Cash');

    expect(amount('pay-total')).toBe('$115.32');
    expect(amount('pay-rounding')).toBe('-$0.02');
    expect(amount('pay-due')).toBe('$115.30');
  });

  it('cannot complete until enough is tendered', async () => {
    const till = await openTill();
    await openPayment(till, 'Cash');
    const received = field(/cash received/i);
    await isFocused(received);
    expect(inDialog('Complete sale').disabled).toBe(true);
    expect(amount('change')).toBe('Still to pay $89.00');

    await till.user.keyboard('88.99');
    expect(amount('change')).toBe('Still to pay $0.01');
    expect(inDialog('Complete sale').disabled).toBe(true);
    await till.user.keyboard('{Enter}');

    expect(await till.database.sales.count()).toBe(0);
  });

  it('shows the change and saves the sale on Enter', async () => {
    const till = await openTill();
    await openPayment(till, 'Cash');

    await till.user.keyboard('100');
    expect(amount('change')).toBe('Change $11.00');
    await till.user.keyboard('{Enter}');

    await saved();
    expect((await screen.findByTestId('change-due')).textContent).toBe('$11.00');
    expect((await till.database.payments.toArray())[0]).toMatchObject({
      method: 'cash',
      tenderedCents: 10000,
      changeCents: 1100,
    });
  });

  it('has quick tender buttons that fill the amount and wait', async () => {
    const till = await openTill();
    await openPayment(till, 'Cash');
    const received = field(/cash received/i);

    await till.user.click(inDialog('$100'));
    expect(received.value).toBe('100.00');
    await isFocused(received);
    await till.user.click(inDialog('$20'));
    expect(received.value).toBe('20.00');
    expect(inDialog('Complete sale').disabled).toBe(true);
    await till.user.click(inDialog('$50'));
    expect(received.value).toBe('50.00');
    await till.user.click(inDialog(/^exact/i));
    expect(received.value).toBe('89.00');
    expect(amount('change')).toBe('Change $0.00');
    expect(await till.database.sales.count()).toBe(0);

    // Typing replaces a quick amount.
    await till.user.keyboard('90');
    expect(received.value).toBe('90');
  });

  it('tenders the rounded total as exact cash', async () => {
    const till = await openTill({ items: [LINEN_BARCODE, TEE_BARCODE] });
    await discountCart(till, '7');
    await openPayment(till, 'Cash');

    await till.user.click(inDialog(/^exact/i));
    await till.user.keyboard('{Enter}');

    await saved();
    expect((await till.database.sales.toArray())[0]).toMatchObject({
      totalCents: 11530,
      roundingCents: -2,
    });
  });

  it('has a keypad', async () => {
    const till = await openTill();
    await openPayment(till, 'Cash');
    const keypad = within(dialog()).getByRole('group', { name: 'Keypad' });
    const key = (name: string) => within(keypad).getByRole('button', { name });

    for (const name of ['9', '0', 'Decimal point', '5']) await till.user.click(key(name));
    expect(field(/cash received/i).value).toBe('90.5');
    await till.user.click(key('Delete last digit'));
    expect(field(/cash received/i).value).toBe('90.');
    await till.user.click(key('Clear amount'));
    expect(field(/cash received/i).value).toBe('');
  });

  it('refuses a barcode scanned into the amount', async () => {
    const till = await openTill();
    await openPayment(till, 'Cash');

    await till.scan(TEE_BARCODE);

    expect(dialog()).toBeTruthy();
    expect(screen.getByText(/scan ignored/i)).toBeTruthy();
    expect(within(dialog()).getByRole('alert').textContent).toMatch(/far more than the total/);
    expect(inDialog('Complete sale').disabled).toBe(true);
    expect(await till.database.sales.count()).toBe(0);
  });

  it('closes on Escape, keeping the cart and focusing the scan box', async () => {
    const till = await openTill();
    await openPayment(till, 'Cash');

    await till.user.keyboard('{Escape}');

    await noDialog();
    expect(amount('total')).toBe('$89.00');
    await isFocused(till.scanBox);
  });
});

describe('card', () => {
  it('asks whether the EFTPOS terminal approved', async () => {
    const till = await openTill({ items: [LINEN_BARCODE, TEE_BARCODE] });
    await discountCart(till, '7');
    await openPayment(till, 'Card');

    // Card sales are not rounded.
    expect(amount('pay-total')).toBe('$115.32');
    expect(screen.queryByTestId('pay-rounding')).toBeNull();
    expect(within(dialog()).getByText('Did the EFTPOS terminal approve?')).toBeTruthy();
    await isFocused(field(/reference/i));
  });

  it('is not approved by Enter in a field', async () => {
    const till = await openTill();
    await openPayment(till, 'Card');

    await till.user.keyboard('000123{Enter}');
    await till.user.type(field(/last 4/i), '4242{Enter}');

    expect(dialog()).toBeTruthy();
    expect(await till.database.sales.count()).toBe(0);
  });

  it('saves the sale with the reference once approved', async () => {
    const till = await openTill();
    await openPayment(till, 'Card');
    await till.user.keyboard('000123');
    await till.user.type(field(/last 4/i), '4242');

    await till.user.click(inDialog('Yes, approved'));

    await saved();
    expect((await till.database.payments.toArray())[0]).toMatchObject({
      method: 'card',
      amountCents: 8900,
      cardReference: '000123',
      cardLast4: '4242',
    });
  });

  it('can be done by keyboard alone', async () => {
    const till = await openTill();
    await openPayment(till, 'Card');

    // Reference, last 4, then the approval button.
    await till.user.tab();
    await till.user.tab();
    await isFocused(inDialog('Yes, approved'));
    await till.user.keyboard('{Enter}');

    await saved();
    expect(await till.database.sales.count()).toBe(1);
  });

  it('keeps the cart when the card is declined', async () => {
    const till = await openTill();
    await openPayment(till, 'Card');

    await till.user.click(inDialog('No, declined'));

    await noDialog();
    expect(amount('total')).toBe('$89.00');
    await isFocused(till.scanBox);
    expect(await till.database.sales.count()).toBe(0);
  });

  it('refuses a card number', async () => {
    const till = await openTill();
    await openPayment(till, 'Card');
    await till.user.keyboard('4111 1111 1111 1111');

    await till.user.click(inDialog('Yes, approved'));

    expect(within(dialog()).getByRole('alert').textContent).toMatch(/never enter card numbers/i);
    expect(await till.database.sales.count()).toBe(0);
  });

  it('cannot be approved by a scan', async () => {
    const till = await openTill();
    await openPayment(till, 'Card');
    inDialog('Yes, approved').focus();

    await till.scan(TEE_BARCODE);

    expect(screen.getByText(/scan ignored/i)).toBeTruthy();
    expect(await till.database.sales.count()).toBe(0);
  });
});

describe('paying once', () => {
  async function expectOneSale(till: Till) {
    await saved();
    expect(await till.database.sales.count()).toBe(1);
    expect(await till.database.outbox.count()).toBe(1);
  }

  it('survives a double click', async () => {
    const till = await openTill();
    await openPayment(till, 'Cash');
    await till.user.click(inDialog(/^exact/i));

    await till.user.dblClick(inDialog('Complete sale'));

    await expectOneSale(till);
  });

  it('survives Enter pressed twice', async () => {
    const till = await openTill();
    await openPayment(till, 'Cash');

    await till.user.keyboard('100{Enter}{Enter}');

    await expectOneSale(till);
  });

  it('survives a double click on card approval', async () => {
    const till = await openTill();
    await openPayment(till, 'Card');

    await till.user.dblClick(inDialog('Yes, approved'));

    await expectOneSale(till);
  });

  it('ignores an Enter that is held down', async () => {
    const till = await openTill();
    await openPayment(till, 'Card');

    const handled = fireEvent.keyDown(inDialog('Yes, approved'), { key: 'Enter', repeat: true });

    // `false`: the browser is told not to press the button.
    expect(handled).toBe(false);
  });
});

describe('when the sale cannot be saved', () => {
  it('keeps the cart, says so, and saves on the next try', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const till = await openTill();
    const fail = () => {
      throw new Error('disk trouble');
    };
    till.database.sales.hook('creating', fail);
    await openPayment(till, 'Cash');

    await till.user.keyboard('100{Enter}');

    const alert = await within(dialog()).findByRole('alert');
    expect(alert.textContent).toMatch(/not saved/i);
    expect(alert.textContent).not.toContain('disk trouble');
    expect(amount('total')).toBe('$89.00');

    till.database.sales.hook('creating').unsubscribe(fail);
    await till.user.click(inDialog('Complete sale'));
    await saved();
    expect(await till.database.sales.count()).toBe(1);
  });
});

describe('a discount still waiting for a manager', () => {
  it('is approved before payment opens', async () => {
    const till = await openTill({ items: [LINEN_BARCODE, LINEN_BARCODE] });
    await till.user.click(button('Discount on Linen Shirt — Black / M'));
    await till.user.click(within(dialog()).getByRole('radio', { name: /dollars/i }));
    await till.user.type(field(/dollars off/i), '20{Enter}');
    await till.user.click(button(/decrease quantity of linen/i));

    await till.user.click(button('Cash'));
    expect(screen.queryByRole('dialog', { name: 'Cash payment' })).toBeNull();
    await till.user.click(await screen.findByRole('button', { name: /morgan manager/i }));
    await till.user.keyboard(`${MANAGER_PIN}{Enter}`);

    expect(await screen.findByRole('dialog', { name: 'Cash payment' })).toBeTruthy();
    expect(amount('pay-due')).toBe('$69.00');
  });
});
