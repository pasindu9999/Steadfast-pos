// @vitest-environment jsdom
/** A shift's first two sales from the login screen, with the network cut (CLAUDE.md rule 1). */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { CASHIER_PIN, LINEN_BARCODE, MANAGER_PIN, seedShop, TEE_BARCODE } from '../test/shop';

afterEach(() => vi.unstubAllGlobals());

describe('whole checkout with no network', () => {
  it('logs in, sells for cash and by card, and writes one event for each', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetch);
    const database = await seedShop();
    const clock = createKeyClock();
    const { user } = renderPos({ database, services: { keyTime: clock.read, beep: vi.fn() } });
    const scan = (code: string) => clock.scanning(() => user.keyboard(`${code}{Enter}`));
    const amount = (id: string) => screen.getByTestId(id).textContent;

    await user.click(await screen.findByRole('button', { name: /casey cashier/i }));
    await user.keyboard(`${CASHIER_PIN}{Enter}`);
    await findScanBox();

    // Cash: two items and a discount that needs a manager.
    await scan(LINEN_BARCODE);
    await scan(TEE_BARCODE);
    await user.keyboard('{F4}');
    await user.type(within(screen.getByRole('dialog')).getByRole('textbox'), '25{Enter}');
    await user.click(await screen.findByRole('button', { name: /morgan manager/i }));
    await user.keyboard(`${MANAGER_PIN}{Enter}`);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(amount('total')).toBe('$93.00');
    await user.keyboard('{F2}100{Enter}');
    expect((await screen.findByTestId('change-due')).textContent).toBe('$7.00');
    await screen.findByRole('img', { name: /qr code for S01-T1-000001/i });

    // Card: the next sale starts by scanning on the receipt.
    await scan(TEE_BARCODE);
    await findScanBox();
    await user.keyboard('{F3}000123');
    await user.click(screen.getByRole('button', { name: 'Yes, approved' }));
    await screen.findByRole('article', { name: 'Receipt S01-T1-000002' });

    expect((await database.sales.orderBy('receiptNo').toArray()).map((s) => s.totalCents)).toEqual([
      9300, 3500,
    ]);
    expect((await database.outbox.toArray()).map((event) => [event.seq, event.status])).toEqual([
      [1, 'pending'],
      [2, 'pending'],
    ]);
    expect((await database.stockMovements.toArray()).map((m) => m.delta)).toEqual([-1, -1, -1]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
