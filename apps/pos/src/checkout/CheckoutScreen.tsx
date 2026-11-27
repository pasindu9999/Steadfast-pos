import { CartPanel } from './CartPanel';
import { NoticeBar } from './NoticeBar';
import { ScanBar } from './ScanBar';
import { TotalsPanel } from './TotalsPanel';

export function CheckoutScreen() {
  return (
    <div className="grid items-start gap-4 md:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <ScanBar />
        <NoticeBar />
        <CartPanel />
      </div>
      <TotalsPanel />
    </div>
  );
}
