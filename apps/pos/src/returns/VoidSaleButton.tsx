import { useLiveQuery } from 'dexie-react-hooks';

import { Button } from '../ui/Button';
import { useRegisterState, useServices } from '../ui/context';
import { loadVoidState } from './commit-void';
import { VOID_REFUSALS } from './void-message';

/** Offers to void a sale and, when that isn't possible, says why. */
export function VoidSaleButton({ saleId }: { saleId: string }) {
  const { database, now } = useServices();
  const openDialog = useRegisterState((register) => register.openDialog);
  const state = useLiveQuery(() => loadVoidState(database, saleId, now()), [database, saleId, now]);

  if (!state) return null;
  const { refusal } = state;
  return (
    <div className="space-y-1">
      <Button
        variant="danger"
        disabled={refusal !== null}
        onClick={() => openDialog({ type: 'void', saleId })}
      >
        Void sale
      </Button>
      {refusal !== null && <p>{VOID_REFUSALS[refusal]}</p>}
    </div>
  );
}
