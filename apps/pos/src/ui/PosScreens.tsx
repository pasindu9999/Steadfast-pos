/** The till once the terminal is set up. It needs a router around it. */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useStore } from 'zustand';

import { loadCatalogIndex } from '../catalog/load-catalog-index';
import { CheckoutScreen } from '../checkout/CheckoutScreen';
import { getTerminalInfo } from '../db/settings-repo';
import { LoginScreen } from '../staff/LoginScreen';
import { RegisterContext, ServicesContext } from './context';
import { RegisterLayout } from './RegisterLayout';
import type { Services } from './services';

export function PosScreens({ services }: { services: Services }) {
  const { database, stores } = services;
  // Rebuilt only when the stored catalogue changes (ARCH §6.3).
  const catalog = useLiveQuery(() => loadCatalogIndex(database), [database]);
  const info = useLiveQuery(() => getTerminalInfo(database), [database]);
  const staff = useStore(stores.session, (session) => session.staff);
  const data = useMemo(() => (catalog && info ? { catalog, ...info } : null), [catalog, info]);

  if (data === null) return <p className="p-6">Loading catalogue…</p>;

  return (
    <ServicesContext value={services}>
      <RegisterContext value={data}>
        {staff === null ? (
          <LoginScreen />
        ) : (
          <Routes>
            <Route element={<RegisterLayout />}>
              <Route index element={<CheckoutScreen />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        )}
      </RegisterContext>
    </ServicesContext>
  );
}
