import { PosDatabase } from '../db/database';

/** An empty database with its own name, so tests never share rows. */
export function createTestDb(): PosDatabase {
  return new PosDatabase(`pos-test-${crypto.randomUUID()}`);
}
