import { useId, useRef, useState } from 'react';

import { useServices } from '../ui/context';
import type { BadgeTone } from './badge-state';
import { SyncDetailsSheet } from './SyncDetailsSheet';
import { useSyncBadge } from './use-sync-badge';

/** Each pair meets WCAG AA contrast. The label says the state too, so colour is not needed. */
const TONES: Record<BadgeTone, string> = {
  green: 'border-green-800 bg-green-100 text-green-900',
  blue: 'border-blue-800 bg-blue-100 text-blue-900',
  amber: 'border-amber-800 bg-amber-200 text-amber-950',
  red: 'border-red-800 bg-red-700 text-white',
  grey: 'border-slate-600 bg-slate-100 text-slate-900',
};

/** The sync status in the header (ARCH §4.8). It informs and never interrupts. */
export function SyncBadge() {
  const { scanFocus } = useServices();
  const data = useSyncBadge();
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const button = useRef<HTMLButtonElement>(null);

  if (!data) return null;

  function close() {
    setOpen(false);
    // The scan box takes the focus where there is one. The receipt screen has none.
    button.current?.focus();
    scanFocus.focus();
  }

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        data-testid="sync-badge"
        data-tone={data.badge.tone}
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={`min-h-12 min-w-12 rounded-full border-2 px-4 font-semibold ${TONES[data.badge.tone]}`}
      >
        <span aria-live="polite">{data.badge.label}</span>
      </button>
      {open && <SyncDetailsSheet id={sheetId} data={data} onClose={close} />}
    </div>
  );
}
