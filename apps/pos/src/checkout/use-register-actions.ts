import { useMemo } from 'react';

import { useRegister, useServices } from '../ui/context';
import type { ActionDeps } from './register-actions';

/** The stores, catalogue and sounds that `register-actions.ts` works with. */
export function useActionDeps(): ActionDeps {
  const { stores, beep } = useServices();
  const { catalog, store } = useRegister();
  return useMemo(
    () => ({ cart: stores.cart, register: stores.register, catalog, store, beep }),
    [stores, catalog, store, beep],
  );
}
