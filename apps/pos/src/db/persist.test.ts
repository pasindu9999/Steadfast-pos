import { describe, expect, it, vi } from 'vitest';

import { requestPersistentStorage } from './persist';

const storage = (persisted: boolean, granted: boolean) => ({
  persisted: vi.fn(() => Promise.resolve(persisted)),
  persist: vi.fn(() => Promise.resolve(granted)),
});

describe('requestPersistentStorage', () => {
  it('reports unsupported when the browser has no storage manager', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
    expect(await requestPersistentStorage({})).toBe('unsupported');
  });

  it('does not ask again when storage is already persistent', async () => {
    const manager = storage(true, false);

    expect(await requestPersistentStorage(manager)).toBe('persisted');
    expect(manager.persist).not.toHaveBeenCalled();
  });

  it('asks for persistence and reports that it was granted', async () => {
    const manager = storage(false, true);

    expect(await requestPersistentStorage(manager)).toBe('persisted');
    expect(manager.persist).toHaveBeenCalledOnce();
  });

  it('reports a refusal', async () => {
    expect(await requestPersistentStorage(storage(false, false))).toBe('denied');
  });

  it('treats an error as not persisted, so start-up carries on', async () => {
    const manager = {
      persisted: () => Promise.resolve(false),
      persist: () => Promise.reject(new Error('SecurityError')),
    };

    expect(await requestPersistentStorage(manager)).toBe('denied');
  });

  it('works with the global navigator when it has no storage manager', async () => {
    expect(await requestPersistentStorage()).toBe('unsupported');
  });
});
