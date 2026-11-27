import type { ApiClient } from './api-client';

/**
 * Connectivity means the API answers its health check. `navigator.onLine` is never trusted: it
 * reports `true` on captive Wi-Fi (ARCH §4.7).
 */
export async function checkHealth(client: Pick<ApiClient, 'health'>): Promise<boolean> {
  try {
    await client.health();
    return true;
  } catch {
    return false;
  }
}
