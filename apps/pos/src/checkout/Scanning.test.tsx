// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { productFixture, variantFixture } from '../test/fixtures';
import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { CASHIER, LINEN_BARCODE, MANAGER_PIN, MISC_ID, seedShop, TEE_BARCODE } from '../test/shop';

const UNKNOWN = '9300000000001';

async function openTill({ misc = true } = {}) {
  const database = await seedShop();
  if (!misc) await database.variants.delete(MISC_ID);
  const clock = createKeyClock();
  const beep = vi.fn();
  const view = renderPos({
    database,
    signedInAs: CASHIER,
    services: { keyTime: clock.read, beep },
  });
  const scanBox = await findScanBox();
  const scan = async (code: string) => {
    await clock.scanning(() => view.user.keyboard(`${code}{Enter}`));
  };
  return { ...view, database, scanBox, scan, beep };
}

const cart = () => screen.getByRole('region', { name: 'Cart' });
const cartLines = () => within(cart()).queryAllByRole('listitem');
const total = () => screen.getByTestId('total').textContent;
const dialog = () => screen.getByRole('dialog');
const isFocused = (element: Element) => waitFor(() => expect(document.activeElement).toBe(element));

describe('scanning', () => {
  it('adds the item, beeps and keeps the focus', async () => {
    const { scan, scanBox, beep } = await openTill();

    await scan(LINEN_BARCODE);

    expect(cartLines()).toHaveLength(1);
    expect(cartLines()[0]!.textContent).toContain('Linen Shirt — Black / M');
    expect(total()).toBe('$89.00');
    expect(beep).toHaveBeenLastCalledWith('ok');
    expect(scanBox.value).toBe('');
    await isFocused(scanBox);
  });

  it('accepts a scanned SKU', async () => {
    const { scan } = await openTill();

    await scan('TEE-NVY-L');

    expect(cartLines()[0]!.textContent).toContain('Summer Tee — Navy / L');
  });

  it('counts a second scan on the same line', async () => {
    const { scan } = await openTill();

    await scan(LINEN_BARCODE);
    await scan(LINEN_BARCODE);

    expect(cartLines()).toHaveLength(1);
    expect(within(cartLines()[0]!).getByTestId('qty').textContent).toBe('2');
    expect(total()).toBe('$178.00');
  });

  it('highlights the line just scanned, for a moment', async () => {
    const { scan } = await openTill();

    await scan(LINEN_BARCODE);
    await scan(TEE_BARCODE);

    expect(cartLines().map((line) => line.dataset.flash)).toEqual(['false', 'true']);
    await waitFor(() => expect(cartLines()[1]!.dataset.flash).toBe('false'), { timeout: 2000 });
  });

  it('announces what was added', async () => {
    const { scan } = await openTill();

    await scan(LINEN_BARCODE);

    expect(screen.getByTestId('announcement').textContent).toBe('Added Linen Shirt — Black / M');
  });

  it('drops whatever had been typed in the box', async () => {
    const { user, scan, scanBox } = await openTill();

    await user.keyboard('lin');
    await scan(TEE_BARCODE);

    expect(scanBox.value).toBe('');
    expect(cartLines()[0]!.textContent).toContain('Summer Tee');
  });

  it('does not press a button that happens to have the focus', async () => {
    const { scan, scanBox } = await openTill();
    screen.getByRole('button', { name: /log out/i }).focus();

    await scan(LINEN_BARCODE);

    expect(cartLines()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /casey cashier/i })).toBeNull();
    await isFocused(scanBox);
  });

  it('sends typing back to the scan box', async () => {
    const { user, scanBox } = await openTill();
    screen.getByRole('button', { name: /log out/i }).focus();

    await user.keyboard('tee');

    expect(scanBox.value).toBe('tee');
  });
});

describe('searching', () => {
  it('lists the matches with their price', async () => {
    const { user } = await openTill();

    await user.keyboard('linen');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]!.textContent).toContain('LIN-BLK-M');
    expect(options[0]!.textContent).toContain('$89.00');
  });

  it('shows at most eight', async () => {
    const { user, database } = await openTill();
    await database.products.add(productFixture({ id: 'p9', name: 'Cotton Cap' }));
    await database.variants.bulkAdd(
      Array.from({ length: 12 }, (_, index) =>
        variantFixture({ id: `cap-${index}`, productId: 'p9', color: `Shade ${index}` }),
      ),
    );

    await user.keyboard('cotton');

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(8));
  });

  it('adds the result chosen with the arrow keys and Enter', async () => {
    const { user, scanBox } = await openTill();

    // "s" matches both; "Summer Tee" ranks first because its name starts with it.
    await user.keyboard('s');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const second = screen.getAllByRole('option')[1]!;
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(scanBox.getAttribute('aria-activedescendant')).toBe(second.id);
    await user.keyboard('{Enter}');

    expect(cartLines()[0]!.textContent).toContain('Linen Shirt');
    expect(scanBox.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
    await isFocused(scanBox);
  });

  it('wraps from the first result up to the last', async () => {
    const { user } = await openTill();

    await user.keyboard('s{ArrowUp}');

    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');
  });

  it('adds a typed SKU', async () => {
    const { user } = await openTill();

    await user.keyboard('tee-nvy-l{Enter}');

    expect(cartLines()[0]!.textContent).toContain('Summer Tee');
  });

  it('adds a clicked result and returns to the box', async () => {
    const { user, scanBox } = await openTill();

    await user.keyboard('linen');
    await user.click(screen.getByRole('option'));

    expect(cartLines()).toHaveLength(1);
    await isFocused(scanBox);
  });

  it('is cleared by Escape', async () => {
    const { user, scanBox } = await openTill();

    await user.keyboard('linen{Escape}');

    expect(scanBox.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does nothing on Enter in an empty box', async () => {
    const { user } = await openTill();

    await user.keyboard('{Enter}');

    expect(cartLines()).toHaveLength(0);
    expect(screen.queryByTestId('notice')).toBeNull();
  });
});

describe('an unknown code', () => {
  it('says so, with an error beep, and adds nothing', async () => {
    const { scan, beep, scanBox } = await openTill();

    await scan(UNKNOWN);

    expect(screen.getByTestId('notice').textContent).toContain(`No item with code ${UNKNOWN}`);
    expect(beep).toHaveBeenLastCalledWith('error');
    expect(cartLines()).toHaveLength(0);
    await isFocused(scanBox);
  });

  it('is reported for a typed search with no match', async () => {
    const { user } = await openTill();

    await user.keyboard('velvet{Enter}');

    expect(screen.getByTestId('notice').textContent).toContain('No item with code velvet');
  });

  it('is dismissed by the next item', async () => {
    const { scan } = await openTill();

    await scan(UNKNOWN);
    await scan(LINEN_BARCODE);

    expect(screen.queryByTestId('notice')).toBeNull();
  });

  it('can be dismissed', async () => {
    const { user, scan, scanBox } = await openTill();

    await scan(UNKNOWN);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('notice')).toBeNull();
    await isFocused(scanBox);
  });

  it('is not offered as a misc item when the catalogue has no placeholder', async () => {
    const { scan } = await openTill({ misc: false });

    await scan(UNKNOWN);

    expect(screen.queryByRole('button', { name: /misc item/i })).toBeNull();
  });
});

describe('a misc item', () => {
  async function startMisc() {
    const till = await openTill();
    await till.scan(UNKNOWN);
    await till.user.click(screen.getByRole('button', { name: /add misc item/i }));
    await isFocused(within(dialog()).getByLabelText('Price'));
    return till;
  }

  it('is sold at a typed price after a manager PIN, by keyboard', async () => {
    const { user, scanBox } = await startMisc();

    await user.keyboard('12.50{Enter}');
    // Only managers are listed.
    await screen.findByRole('button', { name: /morgan manager/i });
    expect(within(dialog()).queryByRole('button', { name: /casey/i })).toBeNull();
    await user.keyboard('{Enter}');
    await user.keyboard(`${MANAGER_PIN}{Enter}`);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(cartLines()[0]!.textContent).toContain(`Misc item (${UNKNOWN})`);
    expect(total()).toBe('$12.50');
    expect(screen.queryByTestId('notice')).toBeNull();
    await isFocused(scanBox);
  });

  it.each(['', '0', 'abc', '1.234'])('asks again for the price %j', async (price) => {
    const { user } = await startMisc();

    await user.keyboard(`${price}{Enter}`);

    expect(within(dialog()).getByRole('alert').textContent).toBe('Enter a price above $0.');
    expect(within(dialog()).queryByRole('button', { name: /morgan/i })).toBeNull();
  });

  it('adds nothing when cancelled at the price', async () => {
    const { user, scanBox } = await startMisc();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cartLines()).toHaveLength(0);
    await isFocused(scanBox);
  });

  it('adds nothing when the approval is cancelled', async () => {
    const { user, scanBox } = await startMisc();

    await user.keyboard('5{Enter}');
    await screen.findByRole('button', { name: /morgan manager/i });
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cartLines()).toHaveLength(0);
    await isFocused(scanBox);
  });

  it('ignores a scan while the dialog is open', async () => {
    const { scan } = await startMisc();

    await scan(LINEN_BARCODE);

    // The scanner's Enter did not move on to the approval.
    expect(within(dialog()).getByLabelText('Price')).toBeTruthy();
    expect(cartLines()).toHaveLength(0);
    expect(dialog().textContent).toContain('Scan ignored');
  });
});

describe('more than ten of one item', () => {
  async function scanTen() {
    const till = await openTill();
    for (let index = 0; index < 10; index += 1) await till.scan(LINEN_BARCODE);
    expect(screen.queryByRole('dialog')).toBeNull();
    await till.scan(LINEN_BARCODE);
    await screen.findByRole('button', { name: /morgan manager/i });
    return till;
  }
  const qty = () => screen.getByTestId('qty').textContent;

  it('needs a manager', async () => {
    const { user, scanBox } = await scanTen();

    expect(qty()).toBe('10');
    await user.keyboard('{Enter}');
    await user.keyboard(`${MANAGER_PIN}{Enter}`);

    await waitFor(() => expect(qty()).toBe('11'));
    await isFocused(scanBox);
  });

  it('stays at ten when cancelled', async () => {
    const { user } = await scanTen();

    await user.keyboard('{Escape}');

    expect(qty()).toBe('10');
  });
});
