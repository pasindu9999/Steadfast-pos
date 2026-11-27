import { BrowserRouter } from 'react-router';

import { PosScreens } from './PosScreens';
import type { Services } from './services';

export function PosApp({ services }: { services: Services }) {
  return (
    <BrowserRouter>
      <PosScreens services={services} />
    </BrowserRouter>
  );
}
