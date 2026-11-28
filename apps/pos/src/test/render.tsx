/** Renders the till as the app does, on a test database. Needs the jsdom environment. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach } from 'vitest';

import type { PosDatabase } from '../db/database';
import type { LoginStaff } from '../staff/staff-pin';
import { PosScreens } from '../ui/PosScreens';
import { createServices, type Services } from '../ui/services';

afterEach(cleanup);

export interface RenderPosOptions {
  database: PosDatabase;
  route?: string;
  /** Skips the login screen. */
  signedInAs?: LoginStaff;
  /** As the app runs in development, with every effect run twice. */
  strict?: boolean;
  services?: Partial<Omit<Services, 'database' | 'stores'>>;
}

export function renderPos({
  database,
  route = '/',
  signedInAs,
  strict = false,
  services,
}: RenderPosOptions) {
  const pos = createServices(database, services);
  if (signedInAs) pos.stores.session.getState().signIn(signedInAs);
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[route]}>
      <PosScreens services={pos} />
    </MemoryRouter>,
    { reactStrictMode: strict },
  );
  return { user, services: pos, stores: pos.stores };
}

/** The scan box, once the till has loaded. */
export function findScanBox() {
  return screen.findByRole<HTMLInputElement>('combobox', { name: /scan or search/i });
}
