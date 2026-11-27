import { formatAUD } from '@pos/core';
import { useState } from 'react';

import type { ParkedSale } from '../db/types';
import { Button } from '../ui/Button';
import { useRegister } from '../ui/context';
import { formatStoreDateTime } from '../ui/format-time';
import { discardParkedSale, resumeParkedSale } from './park-actions';
import { priceCart } from './price-cart';
import { useParkDeps } from './use-park-deps';

interface ParkedSaleItemProps {
  sale: ParkedSale;
  /** A sale is already on the till. */
  blocked: boolean;
  focusFirst: boolean;
  onDiscarded: () => void;
}

export function ParkedSaleItem({ sale, blocked, focusFirst, onDiscarded }: ParkedSaleItemProps) {
  const deps = useParkDeps();
  const { store } = useRegister();
  // Throwing a sale away takes a second press.
  const [confirming, setConfirming] = useState(false);
  const units = sale.cart.lines.reduce((sum, line) => sum + line.qty, 0);
  const when = formatStoreDateTime(sale.parkedAt, store.timezone);

  function discard() {
    onDiscarded();
    void discardParkedSale(deps, sale.id);
  }

  return (
    <li className="space-y-2 py-2">
      <p className="font-semibold">
        {units} {units === 1 ? 'item' : 'items'},{' '}
        {formatAUD(priceCart(sale.cart, store, 'card').totalCents)}
      </p>
      <p>{sale.cart.lines.map((line) => line.name).join(', ')}</p>
      <p>
        Parked {when}
        {sale.staffName !== null && ` by ${sale.staffName}`}
      </p>
      <div className="flex gap-2">
        <Button
          autoFocus={focusFirst}
          variant="primary"
          disabled={blocked}
          aria-label={`Resume sale parked ${when}`}
          onClick={() => void resumeParkedSale(deps, sale.id)}
        >
          Resume
        </Button>
        {confirming ? (
          <Button variant="danger" onClick={discard}>
            Confirm discard
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Discard
          </Button>
        )}
      </div>
    </li>
  );
}
