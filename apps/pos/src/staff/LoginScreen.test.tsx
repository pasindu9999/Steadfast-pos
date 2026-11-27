// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { getSetting } from '../db/settings-repo';
import { CASHIER_ID } from '../test/checkout-fixtures';
import { findScanBox, renderPos } from '../test/render';
import { CASHIER_PIN, seedShop } from '../test/shop';
import { createTestDb } from '../test/test-db';
import { readyDb } from '../test/checkout-fixtures';

async function openLogin() {
  const database = await seedShop();
  const view = renderPos({ database });
  await screen.findByRole('button', { name: /casey cashier/i });
  return { ...view, database };
}

const pinBox = () => screen.getByLabelText<HTMLInputElement>('PIN');

describe('LoginScreen', () => {
  it('lists the active staff by name, and nobody else', async () => {
    await openLogin();

    const names = screen.getAllByRole('button').map((button) => button.textContent);
    expect(names).toEqual([
      expect.stringContaining('Casey Cashier'),
      expect.stringContaining('Morgan Manager'),
    ]);
  });

  it('opens the till after the right PIN, using only the keyboard', async () => {
    const { user } = await openLogin();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: /casey cashier/i }));
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(pinBox());
    await user.keyboard(`${CASHIER_PIN}{Enter}`);

    const scanBox = await findScanBox();
    await waitFor(() => expect(document.activeElement).toBe(scanBox));
    expect(screen.getByText(/casey cashier/i)).toBeTruthy();
  });

  it('hides the PIN as it is typed', async () => {
    const { user } = await openLogin();

    await user.click(screen.getByRole('button', { name: /casey cashier/i }));

    expect(pinBox().type).toBe('password');
    expect(pinBox().inputMode).toBe('numeric');
  });

  it('counts down after a wrong PIN and clears the box', async () => {
    const { user } = await openLogin();

    await user.click(screen.getByRole('button', { name: /casey cashier/i }));
    await user.keyboard('2222{Enter}');

    expect((await screen.findByRole('alert')).textContent).toBe('Wrong PIN. 4 attempts left.');
    expect(pinBox().value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(pinBox()));
  });

  it('locks after five wrong PINs', async () => {
    const { user } = await openLogin();

    await user.click(screen.getByRole('button', { name: /casey cashier/i }));
    for (const left of [4, 3, 2]) {
      await user.keyboard('2222{Enter}');
      await screen.findByText(`Wrong PIN. ${left} attempts left.`);
    }
    await user.keyboard('2222{Enter}');
    await screen.findByText('Wrong PIN. 1 attempt left.');
    await user.keyboard('2222{Enter}');

    expect(await screen.findByText(/too many wrong pins/i)).toBeTruthy();
  });

  it('does not count something that cannot be a PIN', async () => {
    const { user, database } = await openLogin();

    await user.click(screen.getByRole('button', { name: /casey cashier/i }));
    await user.keyboard('12{Enter}');

    expect((await screen.findByRole('alert')).textContent).toBe('Enter 4 to 8 digits.');
    expect(await getSetting(database, 'pinAttempts')).toBeUndefined();
  });

  it('counts one attempt when Enter is pressed twice', async () => {
    const { user, database } = await openLogin();

    await user.click(screen.getByRole('button', { name: /casey cashier/i }));
    await user.keyboard('2222{Enter}{Enter}');
    await screen.findByText('Wrong PIN. 4 attempts left.');

    const attempts = await getSetting(database, 'pinAttempts');
    expect(attempts?.[CASHIER_ID]?.failures).toBe(1);
  });

  it('goes back to the list to pick someone else', async () => {
    const { user } = await openLogin();

    await user.click(screen.getByRole('button', { name: /casey cashier/i }));
    await user.click(screen.getByRole('button', { name: /someone else/i }));

    expect(screen.getByRole('button', { name: /morgan manager/i })).toBeTruthy();
    expect(screen.queryByLabelText('PIN')).toBeNull();
  });

  it('says so when no staff have been downloaded', async () => {
    renderPos({ database: await readyDb({}, createTestDb()) });

    expect(await screen.findByText(/no staff/i)).toBeTruthy();
  });
});
