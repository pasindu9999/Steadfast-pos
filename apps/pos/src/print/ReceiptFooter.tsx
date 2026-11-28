import { DEMO_FOOTER, RETURNS_POLICY } from './receipt-text';

/** The bottom of every receipt. Only a sale states the returns policy. */
export function ReceiptFooter({ policy = false }: { policy?: boolean }) {
  return (
    <footer className="receipt-keep space-y-2 text-center">
      {policy && <p>{RETURNS_POLICY}</p>}
      <p>{DEMO_FOOTER}</p>
    </footer>
  );
}
