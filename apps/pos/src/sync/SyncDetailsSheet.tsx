import { useEffect, useEffectEvent, useId } from 'react';

import { Button } from '../ui/Button';
import { useRegister, useServices } from '../ui/context';
import { formatStoreDateTime } from '../ui/format-time';
import type { SyncBadgeData } from './use-sync-badge';

interface SyncDetailsSheetProps {
  id: string;
  data: SyncBadgeData;
  onClose: () => void;
}

/**
 * Details under the badge. It is not modal: the till behind it keeps working, and scanning carries
 * on (ARCH §4.8).
 */
export function SyncDetailsSheet({ id, data, onClose }: SyncDetailsSheetProps) {
  const { store } = useRegister();
  const { stores } = useServices();
  const titleId = useId();
  const { badge, pending, failed, lastSyncedAt, syncing, syncNow } = data;
  const close = useEffectEvent(onClose);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Escape belongs to a payment step while one is open on top.
      if (event.key !== 'Escape' || stores.register.getState().dialog !== null) return;
      event.preventDefault();
      close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stores]);

  return (
    <div
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      className="absolute top-full right-0 z-[5] mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-md border-2 border-slate-500 bg-white p-4 text-slate-900 shadow-lg"
    >
      <h2 id={titleId} className="text-lg font-bold">
        Sync details
      </h2>
      <p className="font-semibold">{badge.label}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt>Last synced</dt>
        <dd data-testid="last-synced">
          {lastSyncedAt ? formatStoreDateTime(lastSyncedAt, store.timezone) : 'Not yet'}
        </dd>
        <dt>Waiting to upload</dt>
        <dd data-testid="pending-count">{pending}</dd>
      </dl>
      {badge.reasons.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {badge.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {failed.length > 0 && (
        <ul aria-label="Refused receipts" className="max-h-40 overflow-auto">
          {failed.map((receipt) => (
            <li key={receipt.seq}>
              {receipt.number}
              {receipt.code && <span className="text-slate-700"> ({receipt.code})</span>}
            </li>
          ))}
        </ul>
      )}
      <p role="status">{syncing ? 'Syncing now…' : ''}</p>
      <div className="flex gap-2">
        <Button variant="primary" autoFocus onClick={syncNow}>
          Sync now
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
