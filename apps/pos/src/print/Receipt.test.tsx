// @vitest-environment jsdom
import { encodeReceiptQr, receiptQrSchema } from '@pos/core';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commitSale } from '../checkout/commit-sale';
import type { SaleDraft, TenderInput } from '../checkout/sale-draft';
import { cart, cartLine, LINEN_ID, TEE_ID } from '../test/checkout-fixtures';
import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { CASHIER, seedShop, TEE_BARCODE } from '../test/shop';

afterEach(() => vi.unstubAllGlobals());

// Linen $89.00 + Tee $35.00, 7% off the sale: $115.32, or $115.30 in cash.
const TWO_ITEMS = cart({
  lines: [
    cartLine(),
    cartLine({
      variantId: TEE_ID,
      sku: 'TEE-NVY-L',
      name: 'Summer Tee — Navy / L',
      unitPriceCents: 3500,
    }),
  ],
  cartDiscount: { type: 'percent', value: 7 },
});

async function openReceipt(
  draft: SaleDraft = cart(),
  tender: TenderInput = { method: 'cash', tenderedCents: 20000 },
) {
  // The receipt is read from this terminal's database and nowhere else.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('no network on the receipt'))),
  );
  const database = await seedShop();
  const { sale, lines } = await commitSale(draft, tender, {
    database,
    // 11:30 in Sydney.
    now: () => new Date('2026-11-27T00:30:00Z'),
  });
  const clock = createKeyClock();
  const view = renderPos({
    database,
    route: `/receipt/${sale.id}`,
    signedInAs: CASHIER,
    services: { keyTime: clock.read, beep: vi.fn() },
  });
  const receipt = await screen.findByRole('article', { name: `Receipt ${sale.receiptNo}` });
  const scan = (code: string) => clock.scanning(() => view.user.keyboard(`${code}{Enter}`));
  return { ...view, database, sale, lines, receipt, scan };
}

const amount = (id: string) => screen.queryByTestId(id)?.textContent;

describe('receipt for a cash sale', () => {
  it('shows the store, number, time in the store zone and cashier', async () => {
    const { receipt, sale } = await openReceipt();

    const text = within(receipt);
    expect(text.getByText('Demo Boutique')).toBeTruthy();
    expect(text.getByText(sale.receiptNo)).toBeTruthy();
    expect(text.getByText(/27 Nov 2026.*11:30/)).toBeTruthy();
    expect(text.getByText('Served by Casey Cashier')).toBeTruthy();
  });

  it('shows the lines, discounts, GST, rounding and change', async () => {
    const { receipt } = await openReceipt(TWO_ITEMS);

    const items = within(receipt).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Linen Shirt — Black / M');
    expect(items[0]?.textContent).toContain('1 × $89.00');
    expect(items[0]?.textContent).toContain('Discount -$6.23');
    expect(items[0]?.textContent).toContain('$82.77');
    expect(amount('receipt-subtotal')).toBe('$124.00');
    expect(amount('receipt-discount')).toBe('-$8.68');
    expect(amount('receipt-tax')).toBe('$10.48');
    expect(amount('receipt-rounding')).toBe('-$0.02');
    expect(amount('receipt-total')).toBe('$115.30');
    expect(amount('receipt-tendered')).toBe('$200.00');
    expect(amount('receipt-change')).toBe('$84.70');
    expect(amount('change-due')).toBe('$84.70');
  });

  it('leaves out a discount and rounding that are zero', async () => {
    await openReceipt();

    expect(amount('receipt-discount')).toBeUndefined();
    expect(amount('receipt-rounding')).toBeUndefined();
  });
});

describe('receipt for a card sale', () => {
  it('shows the card details and no change', async () => {
    const { receipt } = await openReceipt(cart(), {
      method: 'card',
      cardReference: '000123',
      cardLast4: '4242',
    });

    expect(within(receipt).getByText('Reference 000123')).toBeTruthy();
    expect(within(receipt).getByText('Card ending 4242')).toBeTruthy();
    expect(amount('receipt-card')).toBe('$89.00');
    expect(amount('change-due')).toBeUndefined();
    expect(amount('receipt-change')).toBeUndefined();
  });
});

describe('printed receipt', () => {
  it('carries the ABN, the returns policy and the demo footer', async () => {
    const { receipt } = await openReceipt();

    const text = within(receipt);
    expect(text.getByText('ABN 00 000 000 000')).toBeTruthy();
    expect(text.getByText(/returns within 14 days with this receipt/i)).toBeTruthy();
    expect(text.getByText(/items unworn with tags attached/i)).toBeTruthy();
    expect(text.getByText(/Australian Consumer Law/)).toBeTruthy();
    expect(text.getByText('Demo — © Udara Kurukulasooriya')).toBeTruthy();
  });

  it('is what the page prints', async () => {
    const { receipt } = await openReceipt();

    expect(receipt.hasAttribute('data-print-receipt')).toBe(true);
    expect(document.querySelectorAll('[data-print-receipt]')).toHaveLength(1);
  });

  it('draws the code at least 30 mm wide', async () => {
    await openReceipt(TWO_ITEMS);

    const image = await screen.findByRole<HTMLImageElement>('img', { name: /^QR code/ });

    expect(image.style.width).toMatch(/mm$/);
    expect(Number.parseFloat(image.style.width)).toBeGreaterThanOrEqual(30);
  });
});

describe('receipt QR code', () => {
  it('carries the payload of ARCH §7.4', async () => {
    const { sale, lines } = await openReceipt(TWO_ITEMS);

    const image = await screen.findByRole<HTMLImageElement>('img', {
      name: `QR code for ${sale.receiptNo}`,
    });
    expect(image.src).toMatch(/^data:image\/svg\+xml/);
    const payload = encodeReceiptQr({ saleId: sale.id, receiptNo: sale.receiptNo, lines });
    expect(image.dataset['payload']).toBe(payload);
    expect(receiptQrSchema.parse(JSON.parse(payload)).lines).toEqual([
      [LINEN_ID, 1, 8277],
      [TEE_ID, 1, 3255],
    ]);
  });

  it('says so when the sale is too large for a code', async () => {
    const lines = Array.from({ length: 60 }, () => cartLine({ unitPriceCents: 100 }));
    const { sale } = await openReceipt(cart({ lines }));

    const note = await screen.findByText(/too large for a QR code/i);

    expect(note.textContent).toContain(sale.receiptNo);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('leaving the receipt', () => {
  it('starts a new sale from the focused button', async () => {
    const { user } = await openReceipt();
    const next = screen.getByRole('button', { name: 'New sale' });
    await waitFor(() => expect(document.activeElement).toBe(next));

    await user.keyboard('{Enter}');

    const scanBox = await findScanBox();
    await waitFor(() => expect(document.activeElement).toBe(scanBox));
  });

  it('starts the next sale with a scanned item', async () => {
    const till = await openReceipt();

    await till.scan(TEE_BARCODE);

    const scanBox = await findScanBox();
    expect(screen.getByTestId('total').textContent).toBe('$35.00');
    await waitFor(() => expect(document.activeElement).toBe(scanBox));
    expect(await till.database.sales.count()).toBe(1);
  });

  it('says when there is no such receipt', async () => {
    const database = await seedShop();
    renderPos({ database, route: '/receipt/no-such-sale', signedInAs: CASHIER });

    expect(await screen.findByRole('heading', { name: 'Receipt not found' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New sale' })).toBeTruthy();
  });
});
