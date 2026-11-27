// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PosDatabase } from '../db/database';
import { putSettings, saveSyncHalt } from '../db/settings-repo';
import { createKeyClock } from '../test/key-clock';
import { findScanBox, renderPos } from '../test/render';
import { CASHIER, LINEN_BARCODE, seedShop } from '../test/shop';
import { sell } from '../test/sync-fixtures';
import { createMemoryChannelHub, shareStatus } from './channel';
import { createIdleSyncControls, type SyncStatus } from './status-store';

afterEach(() => vi.useRealTimers());

interface Options {
  status?: Partial<SyncStatus>;
  database?: PosDatabase;
  now?: () => Date;
}

async function openTill({ status, database, now }: Options = {}) {
  const shop = database ?? (await seedShop());
  const syncNow = vi.fn();
  const sync = { ...createIdleSyncControls(), syncNow };
  sync.status.setState({ reachable: true, storage: 'persisted', ...status });
  const clock = createKeyClock();
  const view = renderPos({
    database: shop,
    signedInAs: CASHIER,
    services: { sync, keyTime: clock.read, beep: vi.fn(), ...(now ? { now } : {}) },
  });
  const scanBox = await findScanBox();
  // It appears once it has read the outbox.
  await screen.findByTestId('sync-badge');
  const scan = (code: string) => clock.scanning(() => view.user.keyboard(`${code}{Enter}`));
  return { ...view, database: shop, sync, syncNow, scanBox, scan };
}

/** The badge button in the header, which carries the state as its text. */
const badge = () => screen.getByTestId('sync-badge');
const shows = (label: string) => waitFor(() => expect(badge().textContent).toBe(label));
const sheet = () => screen.queryByRole('dialog', { name: 'Sync details' });

describe('SyncBadge', () => {
  it('sits in the header and says all is synced', async () => {
    await openTill();

    await shows('Online · All synced');
    expect(within(screen.getByRole('banner')).getByTestId('sync-badge')).toBe(badge());
    expect(badge().dataset.tone).toBe('green');
  });

  it('follows the outbox as sales are committed and sent', async () => {
    const { database } = await openTill();
    await shows('Online · All synced');

    await act(() => sell(database, 2));
    await shows('Syncing · 2');

    await act(() => database.outbox.toCollection().modify({ status: 'synced' }));
    await shows('Online · All synced');
  });

  it('follows the connection', async () => {
    const { database, sync } = await openTill();
    await act(() => sell(database, 3));

    act(() => sync.status.setState({ reachable: false }));

    await shows('Offline · 3 unsynced receipts');
    expect(badge().dataset.tone).toBe('amber');
  });

  it('is announced to screen readers when it changes', async () => {
    await openTill();

    await shows('Online · All synced');

    expect(badge().querySelector('[aria-live="polite"]')?.textContent).toBe('Online · All synced');
  });

  it('needs attention for a saved halt', async () => {
    const database = await seedShop();
    await saveSyncHalt(database, 'UNAUTHORIZED', new Date());

    await openTill({ database });

    await shows('Needs attention');
    expect(badge().dataset.tone).toBe('red');
  });

  it('needs attention once a sale has waited over 2 hours, without anything else changing', async () => {
    // Only the interval is faked: the database needs real timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let now = new Date();
    const database = await seedShop();
    await sell(database);
    await openTill({ database, status: { reachable: false }, now: () => now });
    await shows('Offline · 1 unsynced receipt');

    now = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 60_000);
    await act(() => vi.advanceTimersByTimeAsync(60_000));

    await shows('Needs attention');
  });

  it('runs its clock only while something is waiting', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { database } = await openTill();
    // Counted outside `waitFor`, which runs an interval of its own.
    const intervals = async () => {
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      return vi.getTimerCount();
    };
    await shows('Online · All synced');
    expect(await intervals()).toBe(0);

    await act(() => sell(database));
    await shows('Syncing · 1');
    expect(await intervals()).toBe(1);

    await act(() => database.outbox.toCollection().modify({ status: 'synced' }));
    await shows('Online · All synced');
    expect(await intervals()).toBe(0);
  });

  it('stays in step with another tab', async () => {
    const open = createMemoryChannelHub();
    const { sync } = await openTill();
    const other = createIdleSyncControls();
    const stops = [shareStatus(sync.status, open()), shareStatus(other.status, open())];

    act(() => other.status.setState({ reachable: false }));

    await shows('Offline');
    stops.forEach((stop) => stop());
  });
});

describe('the details sheet', () => {
  it('never opens by itself, whatever the state', async () => {
    const { database, sync } = await openTill();

    await act(() => saveSyncHalt(database, 'SEQ_REUSED', new Date()));
    act(() => sync.status.setState({ reachable: false }));
    await shows('Needs attention');

    expect(sheet()).toBeNull();
  });

  it('opens on a tap with the last sync time and the number waiting', async () => {
    const database = await seedShop();
    await sell(database, 2);
    await putSettings(database, { lastSyncedAt: '2026-11-20T02:05:00.000Z' });
    const { user } = await openTill({ database });
    await shows('Syncing · 2');

    await user.click(badge());

    const details = sheet()!;
    // In the store's time zone, not UTC.
    expect(within(details).getByTestId('last-synced').textContent).toMatch(/20 Nov 2026.*1:05/);
    expect(within(details).getByTestId('pending-count').textContent).toBe('2');
    expect(badge().getAttribute('aria-expanded')).toBe('true');
    expect(details.getAttribute('aria-modal')).not.toBe('true');
  });

  it('says when nothing has been synced yet', async () => {
    const { user } = await openTill();

    await user.click(badge());

    expect(within(sheet()!).getByTestId('last-synced').textContent).toBe('Not yet');
  });

  it('lists refused receipts and why syncing needs attention', async () => {
    const database = await seedShop();
    await sell(database);
    await database.outbox
      .toCollection()
      .modify({ status: 'failed', error: { code: 'UNKNOWN_VARIANT', message: 'raw detail' } });
    const { user } = await openTill({ database, status: { storage: 'denied' } });
    await shows('Needs attention');

    await user.click(badge());

    const details = sheet()!.textContent;
    expect(details).toContain('S01-T1-000001');
    expect(details).toContain('UNKNOWN_VARIANT');
    expect(details).toContain('1 receipt was refused by the server.');
    expect(details).toMatch(/may delete saved data/i);
    // The server's own message is not for the cashier.
    expect(details).not.toContain('raw detail');
  });

  it('syncs when asked, and stays open', async () => {
    const { user, syncNow } = await openTill();
    await user.click(badge());

    await user.click(screen.getByRole('button', { name: 'Sync now' }));

    expect(syncNow).toHaveBeenCalledOnce();
    expect(sheet()).not.toBeNull();
  });

  it('shows that a sync is running', async () => {
    const { user, sync } = await openTill();
    await user.click(badge());

    act(() => sync.status.setState({ syncing: true }));

    expect(sheet()!.textContent).toContain('Syncing now…');
  });

  it.each([
    ['Escape', '{Escape}'],
    ['the Close button', null],
    ['the badge', 'badge'],
  ])('closes with %s and returns to the scan box', async (_, how) => {
    const { user, scanBox } = await openTill();
    await user.click(badge());

    if (how === null) await user.click(screen.getByRole('button', { name: 'Close' }));
    else if (how === 'badge') await user.click(badge());
    else await user.keyboard(how);

    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(scanBox);
  });

  it('returns to the badge where there is no scan box, as on a receipt', async () => {
    const { user, scan } = await openTill();
    await scan(LINEN_BARCODE);
    await user.keyboard('{F3}');
    await user.click(screen.getByRole('button', { name: 'Yes, approved' }));
    await screen.findByRole('article', { name: /receipt/i });
    await user.click(badge());

    await user.keyboard('{Escape}');

    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(badge());
  });

  it('leaves the till working: a scan still adds a line', async () => {
    const { user, scan, scanBox } = await openTill();
    await user.click(badge());

    await scan(LINEN_BARCODE);

    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('$89.00'));
    expect(document.activeElement).toBe(scanBox);
    expect(screen.getByRole('main').closest('[inert]')).toBeNull();
  });

  it('lets Escape close a payment dialog first', async () => {
    const { user, scan } = await openTill();
    await scan(LINEN_BARCODE);
    await user.click(badge());
    await user.keyboard('{F3}');
    expect(screen.getByRole('dialog', { name: 'Card payment' })).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Card payment' })).toBeNull();
    expect(sheet()).not.toBeNull();
  });

  it('never blocks a sale, even while red', async () => {
    const database = await seedShop();
    await saveSyncHalt(database, 'UNAUTHORIZED', new Date());
    const { user, scan } = await openTill({ database, status: { reachable: false } });
    await shows('Needs attention');

    await scan(LINEN_BARCODE);
    await user.keyboard('{F3}');
    await user.click(screen.getByRole('button', { name: 'Yes, approved' }));

    await screen.findByRole('article', { name: 'Receipt S01-T1-000001' });
    expect(await database.sales.count()).toBe(1);
  });
});
