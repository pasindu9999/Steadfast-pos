/**
 * What a return would pay back. The screen and the commit both use it, and every amount comes from
 * `@pos/core` (ARCH §6.4). Pure.
 */
import {
  applyRefundRounding,
  type Cents,
  type RefundLine,
  refundForLines,
  requiresReturnApproval,
  type TenderMethod,
} from '@pos/core';

import type { ReturnableSale } from './load-returnable';

/** What the cashier chose for one line of the sale. */
export interface ReturnSelection {
  lineNo: number;
  qty: number;
  /** `false` for damaged goods: they don't go back into stock. */
  restock: boolean;
}

export interface QuoteLine extends RefundLine {
  variantId: string;
  name: string;
  restock: boolean;
}

export interface ReturnQuote {
  /** The lines with something to return, in line number order. */
  lines: QuoteLine[];
  /** The exact refund. */
  refundTotalCents: Cents;
  roundingCents: Cents;
  /** The money handed back. */
  refundAmountCents: Cents;
  needsApproval: boolean;
}

/**
 * @param method `null` while none is chosen, which leaves the amount unrounded
 * @throws RangeError for a quantity, line or selection the sale can't take
 */
export function quoteReturn(
  sale: ReturnableSale,
  selections: readonly ReturnSelection[],
  method: TenderMethod | null,
  cashRoundingCents: number,
): ReturnQuote {
  const chosen = new Map(selections.map((selection) => [selection.lineNo, selection]));
  if (chosen.size !== selections.length) throw new RangeError('a line was chosen twice');

  const refund = refundForLines(
    sale.lines.map(({ lineNo, soldQty, lineTotalCents, returnedQty }) => ({
      lineNo,
      qty: soldQty,
      lineTotalCents,
      returnedQty,
    })),
    new Map(selections.map(({ lineNo, qty }) => [lineNo, qty])),
  );
  const { refundTotalCents } = refund;
  const lines = refund.lines.map((line) => {
    // `refundForLines` only returns lines of this sale that were chosen.
    const sold = sale.lines.find((entry) => entry.lineNo === line.saleLineNo)!;
    const { restock } = chosen.get(line.saleLineNo)!;
    return { ...line, variantId: sold.variantId, name: sold.name, restock };
  });
  const rounded = method
    ? applyRefundRounding(refundTotalCents, method, cashRoundingCents)
    : { roundingCents: 0, refundAmountCents: refundTotalCents };

  return {
    lines,
    refundTotalCents,
    ...rounded,
    needsApproval: requiresReturnApproval({ refundTotalCents, saleOnRecord: sale.onRecord }),
  };
}
