import { useEffect, useEffectEvent } from 'react';
import { useLocation } from 'react-router';

import { useServices } from '../ui/context';
import { isTillKey, type Shortcut, shortcutFor } from './shortcuts';

/**
 * Listens for the till's keys on the window. A listener added while a key is being handled is not
 * given that key, so the F2 that opens the cash dialog does not also act inside it.
 */
export function useShortcut(handle: (shortcut: Shortcut) => void): void {
  const { stores } = useServices();
  const act = useEffectEvent(handle);
  const { pathname } = useLocation();
  const onSaleScreen = useEffectEvent(() => pathname === '/');

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const press = {
        key: event.key,
        repeat: event.repeat,
        modified: event.ctrlKey || event.altKey || event.metaKey,
      };
      if (isTillKey(press)) event.preventDefault();
      const shortcut = shortcutFor(press, {
        dialog: stores.register.getState().dialog?.type ?? null,
        cartEmpty: stores.cart.getState().lines.length === 0,
        onSaleScreen: onSaleScreen(),
      });
      if (shortcut !== null) act(shortcut);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stores]);
}
