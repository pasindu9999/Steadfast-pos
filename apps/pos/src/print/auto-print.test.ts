import { describe, expect, it, vi } from 'vitest';

import { putSettings } from '../db/settings-repo';
import { createTestDb } from '../test/test-db';
import { requestAutoPrint } from './auto-print';
import { createPrinter } from './print-service';

const printer = () => createPrinter();

describe('requestAutoPrint', () => {
  it('asks for nothing on a new terminal', async () => {
    const queue = printer();

    await requestAutoPrint(createTestDb(), queue, 'sale-1');

    expect(queue.take('sale-1')).toBe(false);
  });

  it('asks for the sale when the setting is on', async () => {
    const database = createTestDb();
    await putSettings(database, { autoPrint: true });
    const queue = printer();

    await requestAutoPrint(database, queue, 'sale-1');

    expect(queue.take('sale-1')).toBe(true);
  });

  it('asks for nothing once it is turned off again', async () => {
    const database = createTestDb();
    await putSettings(database, { autoPrint: true });
    await putSettings(database, { autoPrint: false });
    const queue = printer();

    await requestAutoPrint(database, queue, 'sale-1');

    expect(queue.take('sale-1')).toBe(false);
  });

  it('never fails a saved sale when the setting cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const database = createTestDb();
    database.close({ disableAutoOpen: true });

    await expect(requestAutoPrint(database, printer(), 'sale-1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('auto-print skipped', expect.any(String));
    warn.mockRestore();
  });
});
