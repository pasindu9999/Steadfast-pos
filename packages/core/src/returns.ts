import {
  assertNonNegativeCents,
  cashRoundingAdjustment,
  mulDivRoundHalfUp,
  sumCents,
  type Cents,
} from './money.js';

export type RefundMethod = 'cash' | 'card' | 'store_credit';

export interface RefundableSaleLine {
  lineNo: number;
  /** Quantity sold. */
  qty: number;
  /** What the customer paid for the whole line. */
  lineTotalCents: Cents;
  /** Quantity already returned by earlier returns. */
  returnedQty?: number;
}

export interface RefundLine {
  saleLineNo: number;
  qty: number;
  refundCents: Cents;
}

export type ReturnErrorCode = 'OVER_RETURN' | 'UNKNOWN_LINE' | 'INVALID_QTY';

export class ReturnError extends RangeError {
  override readonly name = 'ReturnError';

  constructor(
    readonly code: ReturnErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertSaleLines(saleLines: readonly RefundableSaleLine[]): void {
  const seen = new Set<number>();
  for (const { lineNo, qty, lineTotalCents, returnedQty = 0 } of saleLines) {
    if (seen.has(lineNo)) {
      throw new RangeError(`duplicate sale line ${lineNo}`);
    }
    seen.add(lineNo);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw new RangeError(`sale line ${lineNo}: qty must be a positive integer, got ${qty}`);
    }
    if (!Number.isSafeInteger(returnedQty) || returnedQty < 0 || returnedQty > qty) {
      throw new RangeError(`sale line ${lineNo}: invalid returnedQty ${returnedQty}`);
    }
    assertNonNegativeCents(lineTotalCents, 'lineTotalCents');
  }
}

/**
 * Refunds a share of what was paid for each line.
 *
 * Each refund is the difference between two cumulative shares,
 * `round(total × after ÷ sold) − round(total × before ÷ sold)`, so however a line is split across
 * returns, the refunds sum exactly to the line total.
 *
 * @param returnQtys quantity to return, keyed by sale line number
 */
export function refundForLines(
  saleLines: readonly RefundableSaleLine[],
  returnQtys: ReadonlyMap<number, number>,
): { lines: RefundLine[]; refundTotalCents: Cents } {
  assertSaleLines(saleLines);

  const lineNos = new Set(saleLines.map((line) => line.lineNo));
  for (const lineNo of returnQtys.keys()) {
    if (!lineNos.has(lineNo)) {
      throw new ReturnError('UNKNOWN_LINE', `sale has no line ${lineNo}`);
    }
  }

  const lines: RefundLine[] = [];
  for (const { lineNo, qty: soldQty, lineTotalCents, returnedQty = 0 } of saleLines) {
    const qty = returnQtys.get(lineNo) ?? 0;
    if (!Number.isSafeInteger(qty) || qty < 0) {
      throw new ReturnError('INVALID_QTY', `line ${lineNo}: invalid return quantity ${qty}`);
    }
    if (qty === 0) continue;
    if (qty > soldQty - returnedQty) {
      throw new ReturnError(
        'OVER_RETURN',
        `line ${lineNo}: returning ${qty} but only ${soldQty - returnedQty} of ${soldQty} remain`,
      );
    }
    const shareOf = (units: number) => mulDivRoundHalfUp(lineTotalCents, units, soldQty);
    lines.push({
      saleLineNo: lineNo,
      qty,
      refundCents: shareOf(returnedQty + qty) - shareOf(returnedQty),
    });
  }

  return { lines, refundTotalCents: sumCents(lines.map((line) => line.refundCents)) };
}

/** A refund above this needs a manager (ARCH §9). */
export const DEFAULT_RETURN_APPROVAL_THRESHOLD_CENTS: Cents = 10_000;

/**
 * Whether a return needs a manager PIN: the refund is above the threshold, or the terminal has no
 * record of the sale. A receipt code is not signed, so it can't vouch for itself (ARCH §7.4).
 *
 * @param refundTotalCents the exact refund, before any cash rounding
 */
export function requiresReturnApproval({
  refundTotalCents,
  saleOnRecord,
  thresholdCents = DEFAULT_RETURN_APPROVAL_THRESHOLD_CENTS,
}: {
  refundTotalCents: Cents;
  saleOnRecord: boolean;
  thresholdCents?: Cents;
}): boolean {
  assertNonNegativeCents(refundTotalCents, 'refundTotalCents');
  assertNonNegativeCents(thresholdCents, 'thresholdCents');
  return !saleOnRecord || refundTotalCents > thresholdCents;
}

/** Cash refunds round like cash sales; the difference is recorded as `roundingCents` (ARCH §13). */
export function applyRefundRounding(
  refundTotalCents: Cents,
  method: RefundMethod,
  cashRoundingCents: number,
): { roundingCents: Cents; refundAmountCents: Cents } {
  assertNonNegativeCents(refundTotalCents, 'refundTotalCents');
  const roundingCents =
    method === 'cash' ? cashRoundingAdjustment(refundTotalCents, cashRoundingCents) : 0;
  return { roundingCents, refundAmountCents: sumCents([refundTotalCents, roundingCents]) };
}
