export type CheckoutFailure = 'NOT_READY' | 'EMPTY_CART' | 'INSUFFICIENT_TENDER' | 'INVALID_SALE';

/** A sale refused before anything was written. The UI words it for the cashier. */
export class CheckoutError extends Error {
  override readonly name = 'CheckoutError';

  constructor(
    readonly code: CheckoutFailure,
    /** For logs: names the fields at fault, never their values. */
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}
