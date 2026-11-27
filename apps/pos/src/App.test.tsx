import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('renders the project name while the local database opens', () => {
    const html = renderToString(<App />);

    expect(html).toContain('Offline-First Apparel POS');
    expect(html).toContain('Starting');
  });
});
