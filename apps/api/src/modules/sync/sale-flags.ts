import { calculateCart, type SaleCompletedPayload, type StoreConfig, sumCents } from '@pos/core';

export type SaleFlag = 'total_mismatch' | 'price_drift' | 'clock_skew' | 'unknown_staff';

export interface SaleFlagInput {
  payload: SaleCompletedPayload;
  store: StoreConfig;
  currentPrices: ReadonlyMap<string, number>;
  occurredAt: Date;
  receivedAt: Date;
  staffKnown: boolean;
}

const MAX_CLOCK_AHEAD_MS = 10 * 60_000;

function totalsMatch(sale: SaleCompletedPayload, store: StoreConfig): boolean {
  const lines = [...sale.lines].sort((a, b) => a.lineNo - b.lineNo);
  const tender = sale.payments.every((payment) => payment.method === 'card') ? 'card' : 'cash';
  try {
    const expected = calculateCart(lines, sale.cartDiscount, store, tender);
    const headerMatches = (
      ['subtotalCents', 'discountCents', 'taxCents', 'roundingCents', 'totalCents'] as const
    ).every((field) => sale[field] === expected[field]);
    const linesMatch = lines.every((line, index) => {
      const priced = expected.lines[index]!;
      return (
        line.lineDiscountCents === priced.discountCents &&
        line.taxCents === priced.taxCents &&
        line.lineTotalCents === priced.lineTotalCents
      );
    });
    const paid = sumCents(sale.payments.map((payment) => payment.amountCents));
    return headerMatches && linesMatch && paid === sale.totalCents;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

export function saleFlags(input: SaleFlagInput): SaleFlag[] {
  const { payload, store, currentPrices, occurredAt, receivedAt, staffKnown } = input;
  const checks: [SaleFlag, boolean][] = [
    ['total_mismatch', !totalsMatch(payload, store)],
    [
      'price_drift',
      payload.lines.some((line) => currentPrices.get(line.variantId) !== line.unitPriceCents),
    ],
    ['clock_skew', occurredAt.getTime() - receivedAt.getTime() > MAX_CLOCK_AHEAD_MS],
    ['unknown_staff', !staffKnown],
  ];
  return checks.filter(([, raised]) => raised).map(([flag]) => flag);
}
