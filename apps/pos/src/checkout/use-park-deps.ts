import { useMemo } from 'react';

import { useServices } from '../ui/context';
import type { ParkDeps } from './park-actions';
import { useActionDeps } from './use-register-actions';

/** What `park-actions.ts` works with. */
export function useParkDeps(): ParkDeps {
  const { database, now } = useServices();
  const deps = useActionDeps();
  return useMemo(() => ({ ...deps, database, now }), [deps, database, now]);
}
