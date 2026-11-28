import { useLiveQuery } from 'dexie-react-hooks';

import { useReprint } from '../print/use-reprint';
import { Button } from '../ui/Button';
import { useServices } from '../ui/context';

/** The returns of a sale made on this terminal, to print their receipts again. */
export function SaleReturns({ saleId }: { saleId: string }) {
  const { database } = useServices();
  const reprint = useReprint();
  const returns = useLiveQuery(
    () => database.returns.where('originalSaleId').equals(saleId).sortBy('occurredAt'),
    [database, saleId],
  );

  if (!returns?.length) return null;
  return (
    <ul aria-label="Returns of this sale" className="space-y-2">
      {returns.map(({ id, returnNo }) => (
        <li key={id}>
          <Button onClick={() => reprint('return', id)}>Reprint return receipt {returnNo}</Button>
        </li>
      ))}
    </ul>
  );
}
