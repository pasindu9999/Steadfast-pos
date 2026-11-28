import { useCallback, useEffect, useRef, useState } from 'react';

import { useServices } from '../ui/context';

/**
 * Printing on a receipt screen. Nothing prints until the receipt says it is complete, so the paper
 * never leaves without its code. Afterwards the screen's main button takes the focus.
 */
export function useReceiptPrinting(id: string) {
  const { printer } = useServices();
  const primary = useRef<HTMLButtonElement>(null);
  const [readyId, setReadyId] = useState<string | null>(null);

  useEffect(() => printer.watch(() => primary.current?.focus()), [printer]);

  const onReady = useCallback(() => {
    setReadyId(id);
    if (printer.take(id)) printer.print();
  }, [id, printer]);

  const print = () => printer.print();

  return { primary, ready: readyId === id, onReady, print };
}
