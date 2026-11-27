import { useEffect } from 'react';
import { BrowserRouter } from 'react-router';

import { PosScreens } from './PosScreens';
import type { Services } from './services';

export function PosApp({ services }: { services: Services }) {
  // Syncing runs while the till is open, whoever is logged in.
  useEffect(() => services.sync.start(), [services]);

  return (
    <BrowserRouter>
      <PosScreens services={services} />
    </BrowserRouter>
  );
}
