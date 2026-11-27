// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { CASHIER, CASHIER_PIN, LINEN_BARCODE, seedShop } from '../test/shop';
import { createIdleUpdates } from './app-updater';

async function openTill({ signedIn = true, route = '/', available = true } = {}) {
  const database = await seedShop();
  const apply = vi.fn();
  const updates = { ...createIdleUpdates(), apply };
  updates.status.setState({ available });
  const clock = createKeyClock();
  const view = renderPos({
    database,
    route,
    signedInAs: signedIn ? CASHIER : undefined,
    services: { keyTime: clock.read, beep: vi.fn(), updates },
  });
  const scan = (code: string) => clock.scanning(() => view.user.keyboard(`${code}{Enter}`));
  return { ...view, database, updates, apply, scan };
}

const updateButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /update now/i });
const noToast = () => expect(screen.queryByText('Update available')).toBeNull();

describe('update toast', () => {
  it('is not shown without an update', async () => {
    await openTill({ available: false });
    await findScanBox();

    noToast();
  });

  it('appears when one arrives, leaving the focus in the scan box', async () => {
    const { updates } = await openTill({ available: false });
    const scanBox = await findScanBox();

    act(() => updates.status.setState({ available: true }));

    expect(screen.getByText('Update available')).toBeTruthy();
    expect(document.activeElement).toBe(scanBox);
  });

  it('can be applied between sales, with a warning about the PIN', async () => {
    const { user, apply } = await openTill();
    await findScanBox();

    expect(screen.getByText(/enter your PIN again/i)).toBeTruthy();
    await user.click(updateButton());

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('waits while there is something in the cart', async () => {
    const { user, apply, scan } = await openTill();
    const scanBox = await findScanBox();

    await scan(LINEN_BARCODE);

    // The toast does not get in the way of selling.
    expect(screen.getByTestId('total').textContent).toBe('$89.00');
    expect(updateButton().disabled).toBe(true);
    expect(screen.getByText(/finish the current sale/i)).toBeTruthy();
    expect(document.activeElement).toBe(scanBox);

    await user.click(screen.getByRole('button', { name: /undo last scan/i }));

    await waitFor(() => expect(updateButton().disabled).toBe(false));
    expect(apply).not.toHaveBeenCalled();
  });

  it('gives the updater a check of the till as it is at that moment', async () => {
    const { user, apply, stores } = await openTill();
    await findScanBox();
    await user.click(updateButton());
    const isIdle = apply.mock.calls[0]?.[0] as () => boolean;
    expect(isIdle()).toBe(true);

    act(() => stores.register.getState().openDialog({ type: 'parked' }));

    expect(isIdle()).toBe(false);
  });

  it('waits on the Returns screen', async () => {
    await openTill({ route: '/returns' });

    await screen.findByRole('heading', { name: 'Returns' });

    expect(updateButton().disabled).toBe(true);
  });

  it('waits again as soon as the till leaves the sale screen', async () => {
    const { user, apply } = await openTill();
    await findScanBox();
    await user.click(updateButton());
    const isIdle = apply.mock.calls[0]?.[0] as () => boolean;

    await user.keyboard('{F8}');
    await screen.findByRole('heading', { name: 'Returns' });

    expect(updateButton().disabled).toBe(true);
    expect(isIdle()).toBe(false);
  });

  it('can be applied from the login screen', async () => {
    const { user, apply } = await openTill({ signedIn: false });
    await screen.findByRole('list', { name: 'Staff' });

    await user.click(updateButton());

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('stays after signing in', async () => {
    const { user } = await openTill({ signedIn: false });

    await user.click(await screen.findByRole('button', { name: /casey cashier/i }));
    await user.type(screen.getByLabelText('PIN'), `${CASHIER_PIN}{Enter}`);
    await findScanBox();

    expect(screen.getByText('Update available')).toBeTruthy();
  });

  it('says it is updating, and cannot be tapped twice', async () => {
    const { updates } = await openTill();
    await findScanBox();

    act(() => updates.status.setState({ applying: true }));

    const button = screen.getByRole<HTMLButtonElement>('button', { name: /updating/i });
    expect(button.disabled).toBe(true);
  });
});
