import { useLiveQuery } from 'dexie-react-hooks';

import { getSetting, putSettings } from '../db/settings-repo';
import { useServices } from '../ui/context';

/** Whether this terminal prints each new sale's receipt by itself. */
export function AutoPrintToggle() {
  const { database } = useServices();
  const on = useLiveQuery(
    async () => (await getSetting(database, 'autoPrint')) === true,
    [database],
  );

  return (
    <label className="flex min-h-12 items-center gap-3">
      <input
        type="checkbox"
        className="size-6"
        checked={on ?? false}
        disabled={on === undefined}
        onChange={(event) => void putSettings(database, { autoPrint: event.target.checked })}
      />
      Print automatically after each sale
    </label>
  );
}
