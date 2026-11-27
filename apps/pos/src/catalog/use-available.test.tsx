import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/test-db';
import { useAvailable } from './use-available';

// Reactivity is covered through liveQuery in `db/stock-repo.test.ts`; there is no DOM here.
describe('useAvailable', () => {
  it('is undefined until the database has answered', () => {
    const database = createTestDb();
    function Probe() {
      return <p>{String(useAvailable('v1', database))}</p>;
    }

    expect(renderToString(<Probe />)).toContain('undefined');
  });
});
