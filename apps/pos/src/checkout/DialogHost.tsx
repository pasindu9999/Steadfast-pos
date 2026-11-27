import { useRegisterState } from '../ui/context';
import { ApprovalDialog } from './ApprovalDialog';
import { ClearSaleDialog } from './ClearSaleDialog';
import { DiscountDialog } from './DiscountDialog';
import { MiscItemDialog } from './MiscItemDialog';
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
    default: {
      const unhandled: never = dialog;
      return unhandled;
    }
  }
}
