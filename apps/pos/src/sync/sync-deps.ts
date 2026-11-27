import type { PosDatabase } from '../db/database';
import type { ApiClient } from './api-client';

/** What the online parts of the terminal need, passed in so tests can replace them. */
export interface SyncDeps {
  database: PosDatabase;
  createClient: (baseUrl: string) => ApiClient;
}
