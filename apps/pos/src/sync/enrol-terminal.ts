/** One-time terminal registration, online (ARCH §4.3). */
import { enrolRequestSchema } from '@pos/core';

import type { PosDatabase } from '../db/database';
import { getSetting, putSettings } from '../db/settings-repo';
import { normaliseApiUrl } from './api-url';
import type { SyncDeps } from './sync-deps';

export type EnrolmentFailure = 'ALREADY_ENROLLED' | 'INVALID_URL' | 'INVALID_CODE';

export class EnrolmentError extends Error {
  override readonly name = 'EnrolmentError';

  constructor(readonly code: EnrolmentFailure) {
    super(code);
  }
}

export interface EnrolmentInput {
  apiUrl: string;
  enrolmentCode: string;
}

async function assertNotEnrolled(database: PosDatabase): Promise<void> {
  // Replacing the counters of a device with unsynced sales could reuse their numbers.
  if (await getSetting(database, 'deviceToken')) throw new EnrolmentError('ALREADY_ENROLLED');
}

export async function enrolTerminal(
  { database, createClient }: SyncDeps,
  { apiUrl, enrolmentCode }: EnrolmentInput,
): Promise<void> {
  const baseUrl = normaliseApiUrl(apiUrl);
  if (baseUrl === null) throw new EnrolmentError('INVALID_URL');
  const request = enrolRequestSchema.safeParse({ enrolmentCode });
  if (!request.success) throw new EnrolmentError('INVALID_CODE');
  // Checked before the request, so a single-use code is not spent for nothing.
  await assertNotEnrolled(database);

  const enrolment = await createClient(baseUrl).enrol(request.data.enrolmentCode);

  await database.transaction('rw', database.settings, async () => {
    // Again: another tab may have enrolled while the request was in flight.
    await assertNotEnrolled(database);
    await putSettings(database, {
      apiUrl: baseUrl,
      deviceToken: enrolment.deviceToken,
      terminalId: enrolment.terminalId,
      terminalCode: enrolment.terminalCode,
      // Resume from the server's high-water marks, so numbers never collide.
      receiptSeq: enrolment.receiptSeq,
      returnSeq: enrolment.returnSeq,
      outboxSeq: enrolment.lastAppliedSeq,
    });
  });
}
