import type { VoidRefusal } from './void-rules';

export type VoidFailure = VoidRefusal | 'NOT_READY' | 'APPROVAL_REQUIRED' | 'INVALID_VOID';

/** A void refused before anything was written. The UI words it for the cashier. */
export class VoidRefusedError extends Error {
  override readonly name = 'VoidRefusedError';

  constructor(
    readonly code: VoidFailure,
    /** For logs: names the fields at fault, never their values. */
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}
