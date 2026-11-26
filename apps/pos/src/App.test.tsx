import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('renders the project name', () => {
    expect(renderToString(<App />)).toContain('Offline-First Apparel POS');
  });
});
