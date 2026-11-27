import { z } from 'zod';

/** Stable codes: the API sends them and clients branch on them. */
export const ERROR_CODES = [
  'SEQ_GAP',
  'SEQ_REUSED',
  'OVER_RETURN',
  'INVALID_PAYLOAD',
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'TERMINAL_MISMATCH',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * `code` is parsed as any string, so a terminal running an older cached build keeps syncing when the
 * API adds a code (ARCH §8.6). The API should only send {@link ErrorCode} values.
 */
export const errorDetailSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
});
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const apiErrorSchema = z.object({ error: errorDetailSchema });
export type ApiError = z.infer<typeof apiErrorSchema>;
