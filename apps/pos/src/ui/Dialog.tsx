import { useEffect, useEffectEvent, useId, type ReactNode } from 'react';

import { useRegisterState } from './context';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** One step of the sale on top of the till. The till behind it is inert, so focus stays here. */
export function Dialog({ title, onClose, children }: DialogProps) {
  const titleId = useId();
  const scanIgnored = useRegisterState((register) => register.scanIgnored);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center overflow-auto bg-slate-900/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md space-y-3 rounded-md bg-white p-4"
      >
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        {children}
        {scanIgnored && (
          <p role="status" className="rounded-md bg-amber-200 p-2 font-semibold text-amber-950">
            Scan ignored. Finish or close this step first.
          </p>
        )}
      </div>
    </div>
  );
}
