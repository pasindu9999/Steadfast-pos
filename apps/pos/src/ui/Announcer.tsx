import { useRegisterState } from './context';

/** Tells screen readers what a scan did. */
export function Announcer() {
  const announcement = useRegisterState((register) => register.announcement);
  return (
    <p aria-live="polite" data-testid="announcement" className="sr-only">
      {announcement}
    </p>
  );
}
