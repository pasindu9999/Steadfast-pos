import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useStore } from 'zustand';

import { Button } from '../ui/Button';
import { useCart, useRegisterState, useServices, useSession } from '../ui/context';
import { isTillIdle } from './till-idle';

/** Says that a new version is ready. It never takes the focus and never interrupts (ARCH §7.6). */
export function UpdateToast() {
  const { updates, stores } = useServices();
  const { available, applying } = useStore(updates.status);
  const { pathname } = useLocation();
  const signedIn = useSession((session) => session.staff !== null);
  const cartLines = useCart((cart) => cart.lines.length);
  const committing = useCart((cart) => cart.committing);
  const dialog = useRegisterState((register) => register.dialog?.type ?? null);
  const idle = isTillIdle({ signedIn, path: pathname, cartLines, committing, dialog });

  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  /** The till as it is at that moment, which may be after the new version has taken over. */
  const idleNow = () => {
    const cart = stores.cart.getState();
    return isTillIdle({
      signedIn: stores.session.getState().staff !== null,
      path: path.current,
      cartLines: cart.lines.length,
      committing: cart.committing,
      dialog: stores.register.getState().dialog?.type ?? null,
    });
  };

  return (
    <div role="status" className="fixed bottom-4 left-4 z-[4] max-w-xs print:hidden">
      {available && (
        <div className="space-y-2 rounded-md border-2 border-slate-900 bg-white p-3 text-slate-900 shadow-lg">
          <p className="font-bold">Update available</p>
          <p>
            {idle ? 'You will enter your PIN again.' : 'Finish the current sale or return first.'}
          </p>
          <Button
            variant="primary"
            disabled={!idle || applying}
            onClick={() => updates.apply(idleNow)}
          >
            {applying ? 'Updating…' : 'Update now'}
          </Button>
        </div>
      )}
    </div>
  );
}
