import { useEffect, type MouseEvent } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { DialogHost } from '../checkout/DialogHost';
import { scanCode, startPayment } from '../checkout/register-actions';
import { useActionDeps } from '../checkout/use-register-actions';
import { useScanner } from '../checkout/use-scanner';
import { useShortcut } from '../checkout/use-shortcut';
import { isReceiptEntry } from '../returns/parse-lookup';
import { useOpenReturns } from '../returns/use-open-returns';
import { Announcer } from './Announcer';
import { AppHeader } from './AppHeader';
import { useCart, useRegisterState, useServices } from './context';

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="option"]';

export function RegisterLayout() {
  const { printer, scanFocus, stores } = useServices();
  const deps = useActionDeps();
  const dialogOpen = useRegisterState((register) => register.dialog !== null);
  const lines = useCart((cart) => cart.lines);
  const cartDiscount = useCart((cart) => cart.cartDiscount);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const openReturns = useOpenReturns();

  useScanner((code) => {
    // A scan must never confirm a dialog, least of all a payment.
    const register = stores.register.getState();
    if (register.dialog) {
      register.ignoreScan();
      return;
    }
    // A receipt is looked up in Returns, as is anything scanned while there. An item's own code
    // always comes first.
    if (pathname === '/returns' || (!deps.catalog.lookup(code) && isReceiptEntry(code))) {
      openReturns(code);
      return;
    }
    // On a receipt, a scan starts the next sale.
    if (pathname !== '/') void navigate('/');
    scanCode(deps, code);
  });

  useShortcut((shortcut) => {
    const register = stores.register.getState();
    switch (shortcut) {
      case 'cash':
      case 'card':
        startPayment(deps, shortcut);
        break;
      case 'discount':
        register.openDialog({ type: 'discount', target: { type: 'cart' } });
        break;
      case 'dismiss':
        register.dismiss();
        break;
      case 'returns':
        openReturns();
        break;
      case 'exact':
        // The cash dialog's own.
        break;
      default: {
        const unhandled: never = shortcut;
        return unhandled;
      }
    }
  });

  // Focus goes back to the scan box after every change to the cart, and when a dialog closes,
  // however it closed.
  useEffect(() => {
    if (!dialogOpen) scanFocus.focus();
  }, [dialogOpen, lines, cartDiscount, scanFocus]);

  // After printing, the scan box has the focus again. Receipt screens focus their own button.
  useEffect(() => printer.watch(() => scanFocus.focus()), [printer, scanFocus]);

  // A print asked for is dropped on leaving its receipt.
  useEffect(() => printer.keepOnly(pathname.split('/')[2] ?? null), [printer, pathname]);

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
