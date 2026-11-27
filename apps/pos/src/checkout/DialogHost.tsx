import { CardRefundDialog } from '../returns/CardRefundDialog';
import { VoidDialog } from '../returns/VoidDialog';
import { useRegisterState } from '../ui/context';
import { ApprovalDialog } from './ApprovalDialog';
import { CardDialog } from './CardDialog';
import { CashDialog } from './CashDialog';
import { ClearSaleDialog } from './ClearSaleDialog';
import { DiscountDialog } from './DiscountDialog';
import { MiscItemDialog } from './MiscItemDialog';
import { ParkedSalesDialog } from './ParkedSalesDialog';
import { QuantityDialog } from './QuantityDialog';

export function DialogHost() {
  const dialog = useRegisterState((register) => register.dialog);
  if (dialog === null) return null;

  switch (dialog.type) {
    case 'approval':
      return <ApprovalDialog reason={dialog.reason} onApproved={dialog.onApproved} />;
    case 'misc_item':
      return <MiscItemDialog code={dialog.code} />;
    case 'quantity':
      return <QuantityDialog lineKey={dialog.key} />;
    case 'discount':
      return <DiscountDialog target={dialog.target} />;
    case 'clear_sale':
      return <ClearSaleDialog />;
    case 'cash':
      return <CashDialog />;
    case 'card':
      return <CardDialog />;
    case 'parked':
      return <ParkedSalesDialog />;
    case 'card_refund':
      return <CardRefundDialog amountCents={dialog.amountCents} onApproved={dialog.onApproved} />;
    case 'void':
      return <VoidDialog saleId={dialog.saleId} />;
    default: {
      const unhandled: never = dialog;
      return unhandled;
    }
  }
}
