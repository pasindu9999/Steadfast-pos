import { useLiveQuery } from 'dexie-react-hooks';
import { useRef } from 'react';

import { Button } from '../ui/Button';
import { useCart, useRegisterState, useServices } from '../ui/context';
import { Dialog } from '../ui/Dialog';
import { listParkedSales } from './parked-sales';
import { ParkedSaleItem } from './ParkedSaleItem';

export function ParkedSalesDialog() {
  const { database } = useServices();
  const close = useRegisterState((register) => register.closeDialog);
  const blocked = useCart((cart) => cart.lines.length > 0);
  const parked = useLiveQuery(() => listParkedSales(database), [database]);
  const closeButton = useRef<HTMLButtonElement>(null);

  return (
    <Dialog title="Parked sales" onClose={close}>
      {blocked && <p>Finish, park or clear the current sale first to resume one.</p>}
      {parked?.length === 0 && <p>No parked sales.</p>}
      <ul className="divide-y divide-slate-300">
        {parked?.map((sale, index) => (
          <ParkedSaleItem
            key={sale.id}
            sale={sale}
            blocked={blocked}
            focusFirst={index === 0 && !blocked}
            // The button that was pressed is gone, so focus needs somewhere to be.
            onDiscarded={() => closeButton.current?.focus()}
          />
        ))}
      </ul>
      <Button ref={closeButton} autoFocus={blocked} onClick={close}>
        Close
      </Button>
    </Dialog>
  );
}
