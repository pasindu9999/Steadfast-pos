/** Setting a sale aside, bringing it back or throwing it away, and what the cashier is told. */
import { v7 as uuidv7 } from 'uuid';

import type { PosDatabase } from '../db/database';
import { parkSale, takeParkedSale } from './parked-sales';
import type { ActionDeps } from './register-actions';

export interface ParkDeps extends Pick<ActionDeps, 'cart' | 'register' | 'beep'> {
  database: PosDatabase;
  now: () => Date;
}

function report({ register, beep }: ParkDeps, error: unknown, text: string): void {
  console.error(text, (error as Error | undefined)?.name);
  beep('error');
  register.getState().showNotice({ type: 'message', text });
}

/** The cart is emptied only once it is safely stored. */
export async function parkCurrentSale(deps: ParkDeps, staffName: string | null): Promise<void> {
  const cart = deps.cart.getState();
  if (cart.lines.length === 0 || !cart.beginCommit()) return;
  try {
    const details = { id: uuidv7(), parkedAt: deps.now().toISOString(), staffName };
    await parkSale(deps.database, cart, details);
    cart.endCommit(true);
    deps.register.getState().showNotice({ type: 'message', text: 'Sale parked.' });
  } catch (error) {
    cart.endCommit(false);
    report(deps, error, 'The sale was not parked. Try again.');
  }
}

export async function discardParkedSale(deps: ParkDeps, id: string): Promise<void> {
  try {
    await takeParkedSale(deps.database, id);
  } catch (error) {
    deps.register.getState().closeDialog();
    report(deps, error, 'The parked sale was not discarded. Try again.');
  }
}

/** Only into an empty cart, so no sale is ever mixed into another. */
export async function resumeParkedSale(deps: ParkDeps, id: string): Promise<void> {
  const cart = deps.cart.getState();
  if (cart.lines.length > 0 || !cart.beginCommit()) return;
  try {
    const parked = await takeParkedSale(deps.database, id);
    cart.endCommit(false);
    if (parked) cart.replace(parked.cart);
    deps.register.getState().closeDialog();
  } catch (error) {
    cart.endCommit(false);
    deps.register.getState().closeDialog();
    report(deps, error, 'The parked sale could not be opened. Try again.');
  }
}
