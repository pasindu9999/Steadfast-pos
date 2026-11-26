import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('@pos/core', () => {
  it('loads as an ES module', () => {
    expect(core).toBeDefined();
  });
});
