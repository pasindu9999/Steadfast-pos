// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { createIdleSyncControls } from '../sync/status-store';
import { findScanBox } from '../test/render';
import { CASHIER, seedShop } from '../test/shop';
import { PosApp } from './PosApp';
import { createServices } from './services';

afterEach(cleanup);

async function renderApp() {
  let running = 0;
  const sync = {
    ...createIdleSyncControls(),
    start: () => {
      running += 1;
      return () => {
        running -= 1;
      };
    },
  };
  const services = createServices(await seedShop(), { sync });
  services.stores.session.getState().signIn(CASHIER);
  const view = render(
    <StrictMode>
      <PosApp services={services} />
    </StrictMode>,
  );
  await findScanBox();
  return { view, running: () => running };
}

describe('PosApp', () => {
  it('runs one sync engine while the till is open', async () => {
    const { running } = await renderApp();

    expect(running()).toBe(1);
  });

  it('stops it when the till closes', async () => {
    const { view, running } = await renderApp();

    view.unmount();

    expect(running()).toBe(0);
  });
});
