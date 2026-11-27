import { utcDateTimeSchema } from '@pos/core';
import { z } from 'zod';

import { ApiException } from '../../common/api-exception.js';

const cursorSchema = z.object({
  v: z.literal(1),
  since: utcDateTimeSchema.refine((since) => Date.parse(since) >= 0),
});

export function encodeCursor(since: Date): string {
  return Buffer.from(JSON.stringify({ v: 1, since: since.toISOString() })).toString('base64url');
}

export function decodeCursor(cursor: string): Date {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    value = undefined;
  }
  const parsed = cursorSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiException(400, 'VALIDATION_FAILED', 'cursor: not a cursor from this server');
  }
  return new Date(parsed.data.since);
}
