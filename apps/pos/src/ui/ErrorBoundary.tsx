import { Component, type ReactNode } from 'react';

import { Button } from './Button';

interface ErrorBoundaryProps {
  children: ReactNode;
  onReload?: () => void;
}

/** A failing local database must not leave a blank screen. The raw error is never shown. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    const { onReload = () => window.location.reload() } = this.props;
    return (
      <main role="alert" className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p>Reload the till. Completed sales are saved on this device.</p>
        <p>If this keeps happening, check that the device has free storage and tell the manager.</p>
        <Button variant="primary" onClick={onReload}>
          Reload
        </Button>
      </main>
    );
  }
}
