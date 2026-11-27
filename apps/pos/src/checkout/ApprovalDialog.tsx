import { StaffPinForm } from '../staff/StaffPinForm';
import type { LoginStaff } from '../staff/staff-pin';
import { Button } from '../ui/Button';
import { useRegisterState } from '../ui/context';
import { Dialog } from '../ui/Dialog';

interface ApprovalDialogProps {
  reason: string;
  onApproved: (approver: LoginStaff) => void;
}

export function ApprovalDialog({ reason, onApproved }: ApprovalDialogProps) {
  const close = useRegisterState((register) => register.closeDialog);

  return (
    <Dialog title="Manager approval" onClose={close}>
      <p>{reason}</p>
      <StaffPinForm minRole="manager" submitLabel="Approve" onVerified={onApproved} />
      <Button className="w-full" onClick={close}>
        Cancel
      </Button>
    </Dialog>
  );
}
