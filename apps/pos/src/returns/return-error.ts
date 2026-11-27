export type ReturnFailure =
  | 'NOT_READY'
  | 'SALE_NOT_FOUND'
  | 'SALE_VOIDED'
  | 'NOTHING_SELECTED'
  | 'OVER_RETURN'
  | 'REASON_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'INVALID_RETURN';

/** A return refused before anything was written. The UI words it for the cashier. */
export class ReturnRefusedError extends Error {
  override readonly name = 'ReturnRefusedError';

  constructor(
    readonly code: ReturnFailure,
    /** For logs: names the fields at fault, never their values. */
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}
