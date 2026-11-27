import { useEffect, type MouseEvent } from 'react';
import { Outlet } from 'react-router';

import { DialogHost } from '../checkout/DialogHost';
import { scanCode } from '../checkout/register-actions';
import { useActionDeps } from '../checkout/use-register-actions';
import { useScanner } from '../checkout/use-scanner';
import { Announcer } from './Announcer';
import { AppHeader } from './AppHeader';
import { useCart, useRegisterState, useServices } from './context';

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="option"]';

export function RegisterLayout() {
  const { scanFocus, stores } = useServices();
  const deps = useActionDeps();
  const dialogOpen = useRegisterState((register) => register.dialog !== null);
  const lines = useCart((cart) => cart.lines);
  const cartDiscount = useCart((cart) => cart.cartDiscount);

  useScanner((code) => {
    // A scan must never confirm a dialog, least of all a payment.
    const register = stores.register.getState();
    if (register.dialog) register.ignoreScan();
    else scanCode(deps, code);
  });

  // Focus goes back to the scan box after every change to the cart, and when a dialog closes,
  // however it closed.
  useEffect(() => {
    if (!dialogOpen) scanFocus.focus();
  }, [dialogOpen, lines, cartDiscount, scanFocus]);

  // The next cashier starts with a clean screen.
  useEffect(() => () => stores.register.getState().reset(), [stores]);

  /** A tap on empty space must not leave the focus nowhere. */
  function refocus(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target as Element).closest(INTERACTIVE)) scanFocus.focus();
  }

  return (
    <>
      <div className="flex min-h-screen flex-col" inert={dialogOpen} onClick={refocus}>
        <AppHeader />
        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </div>
      <DialogHost />
      <Announcer />
    </>
  );
}
