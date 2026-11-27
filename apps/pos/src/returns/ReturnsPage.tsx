import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useShortcut } from '../checkout/use-shortcut';
import { Button } from '../ui/Button';
import { useServices } from '../ui/context';
import type { SaleRef } from './load-returnable';
import { findSale } from './lookup';
import { lookupMessage } from './lookup-message';
import { LookupField } from './LookupField';
import { RecentSales } from './RecentSales';
import { SaleSummary } from './SaleSummary';
import type { ReturnsState } from './use-open-returns';

/** Returns and voids: find the sale, then act on it. Everything comes from this device. */
export function ReturnsPage() {
  const { database, scanFocus } = useServices();
  const navigate = useNavigate();
  const location = useLocation();
  const [selected, setSelected] = useState<SaleRef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** The latest request wins, however long an earlier lookup takes. */
  const latest = useRef(0);

  function show(ref: SaleRef | null, problem: string | null = null) {
    latest.current += 1;
    setSelected(ref);
    setMessage(problem);
  }

  async function find(text: string): Promise<boolean> {
    const request = (latest.current += 1);
    const result = await findSale(database, text);
    const found = result.status === 'found';
    if (request === latest.current) {
      show(found ? result.ref : null, found ? null : lookupMessage(result));
    }
    return found;
  }

  const arrive = useEffectEvent((state: ReturnsState | null) => {
    if (state) void find(state.entry);
  });
  useEffect(() => {
    arrive(location.state as ReturnsState | null);
  }, [location.key, location.state]);

  function close() {
    show(null);
    scanFocus.focus();
  }

  // Escape closes the sale first, then leaves Returns.
  useShortcut((shortcut) => {
    if (shortcut !== 'dismiss') return;
    if (selected === null && message === null) void navigate('/');
    else close();
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="mr-auto text-2xl font-bold">Returns</h2>
        <Button onClick={() => void navigate('/')}>Back to sale</Button>
      </div>
      <LookupField onEntry={find} />
      {message !== null && (
        <p role="alert" className="font-semibold text-red-800">
          {message}
        </p>
      )}
      {selected !== null ? (
        <SaleSummary saleRef={selected} onClose={close} />
      ) : (
        <RecentSales
          onPick={(saleId) => {
            show({ kind: 'local', saleId });
            // The button that was pressed is about to go.
            scanFocus.focus();
          }}
        />
      )}
    </div>
  );
}
