// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { findScanBox, renderPos } from '../test/render';
import { CASHIER, seedShop } from '../test/shop';

async function openTill() {
  const database = await seedShop();
  const view = renderPos({ database, signedInAs: CASHIER });
  const scanBox = await findScanBox();
  return { ...view, scanBox };
}

describe('RegisterLayout', () => {
  it('shows the store, the terminal and the cashier', async () => {
    await openTill();

    const header = screen.getByRole('banner');
    expect(header.textContent).toContain('Demo Boutique');
    expect(header.textContent).toContain('T1');
    expect(header.textContent).toContain('Casey Cashier');
  });

  it('shows the sync badge in the header', async () => {
    await openTill();

    expect(await within(screen.getByRole('banner')).findByTestId('sync-badge')).toBeTruthy();
  });

  it('focuses the scan box', async () => {
    const { scanBox } = await openTill();

    await waitFor(() => expect(document.activeElement).toBe(scanBox));
  });

  it('starts with an empty cart and nothing to pay', async () => {
    await openTill();

    expect(screen.getByRole('region', { name: 'Cart' }).textContent).toContain('No items yet');
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(within(totals).getByTestId('total').textContent).toBe('$0.00');
    expect(within(totals).getByTestId('tax').textContent).toBe('$0.00');
  });

  it('returns to the scan box after a click on the background', async () => {
    const { user, scanBox } = await openTill();

    await user.click(screen.getByRole('region', { name: 'Cart' }));

    expect(document.activeElement).toBe(scanBox);
  });

  it('logs out to the staff list', async () => {
    const { user } = await openTill();

    await user.click(screen.getByRole('button', { name: /log out/i }));

    expect(await screen.findByRole('button', { name: /casey cashier/i })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('sends an unknown address to the till', async () => {
    const database = await seedShop();
    renderPos({ database, signedInAs: CASHIER, route: '/nowhere' });

    expect(await findScanBox()).toBeTruthy();
  });
});
