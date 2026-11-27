// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Broken(): never {
  throw new Error('DatabaseClosedError: secret detail');
}

describe('ErrorBoundary', () => {
  it('shows its children while nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <p>All well</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('All well')).toBeTruthy();
  });

  it('explains a failure without showing the raw error, and offers a reload', async () => {
    // React reports caught errors on the console.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onReload = vi.fn();

    render(
      <ErrorBoundary onReload={onReload}>
        <Broken />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Something went wrong');
    expect(alert.textContent).not.toContain('secret detail');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
