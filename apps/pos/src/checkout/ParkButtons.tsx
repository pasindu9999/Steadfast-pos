import { useLiveQuery } from 'dexie-react-hooks';

import { Button } from '../ui/Button';
import { useCart, useRegisterState, useServices, useSession } from '../ui/context';
import { parkCurrentSale } from './park-actions';
import { listParkedSales } from './parked-sales';
import { useParkDeps } from './use-park-deps';

export function ParkButtons() {
  const deps = useParkDeps();
  const { database } = useServices();
  const staffName = useSession((session) => session.staff?.name ?? null);
  const empty = useCart((cart) => cart.lines.length === 0);
  const committing = useCart((cart) => cart.committing);
  const openDialog = useRegisterState((register) => register.openDialog);
  const count = useLiveQuery(() => listParkedSales(database), [database])?.length ?? 0;

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button disabled={empty || committing} onClick={() => void parkCurrentSale(deps, staffName)}>
        Park sale
      </Button>
      <Button disabled={count === 0} onClick={() => openDialog({ type: 'parked' })}>
        Parked sales ({count})
      </Button>
    </div>
  );
}
