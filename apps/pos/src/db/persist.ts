export type StoragePersistence = 'persisted' | 'denied' | 'unsupported';

type Persistable = Partial<Pick<StorageManager, 'persist' | 'persisted'>>;

/**
 * Asks the browser not to evict the database, which holds sales the server may not have yet
 * (ARCH §13). It never throws, so start-up carries on whatever the answer.
 */
export async function requestPersistentStorage(
  storage: Persistable | undefined = globalThis.navigator?.storage,
): Promise<StoragePersistence> {
  if (!storage?.persist || !storage.persisted) return 'unsupported';
  try {
    if (await storage.persisted()) return 'persisted';
    return (await storage.persist()) ? 'persisted' : 'denied';
  } catch {
    return 'denied';
  }
}
