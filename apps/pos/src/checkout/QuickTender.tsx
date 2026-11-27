import { type Cents, formatAUD } from '@pos/core';

import { Button } from '../ui/Button';
import { QUICK_TENDER_CENTS } from './tender';

export function QuickTender({
  dueCents,
  onAmount,
}: {
  dueCents: Cents;
  onAmount: (cents: Cents) => void;
}) {
  return (
    <div role="group" aria-label="Quick amounts" className="grid grid-cols-4 gap-2">
      <Button onClick={() => onAmount(dueCents)}>Exact</Button>
      {QUICK_TENDER_CENTS.map((cents) => (
        <Button key={cents} onClick={() => onAmount(cents)}>
          {formatAUD(cents).replace('.00', '')}
        </Button>
      ))}
    </div>
  );
}
