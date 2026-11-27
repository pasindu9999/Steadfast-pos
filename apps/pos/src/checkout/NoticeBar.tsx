import { Button } from '../ui/Button';
import { useRegister, useRegisterState, useServices } from '../ui/context';

/** A message under the scan box. It never blocks: the next item replaces it. */
export function NoticeBar() {
  const { scanFocus } = useServices();
  const { catalog } = useRegister();
  const notice = useRegisterState((register) => register.notice);
  const dismiss = useRegisterState((register) => register.dismiss);
  const openDialog = useRegisterState((register) => register.openDialog);
  if (notice === null) return null;

  return (
    <div
      role="status"
      data-testid="notice"
      className="flex flex-wrap items-center gap-3 rounded-md border-2 border-amber-700 bg-amber-100 p-3 text-amber-950"
    >
      <p className="mr-auto font-semibold">
        {notice.type === 'not_found' ? `No item with code ${notice.code}` : notice.text}
      </p>
      {notice.type === 'not_found' && catalog.miscItem && (
        <Button onClick={() => openDialog({ type: 'misc_item', code: notice.code })}>
          Add misc item
        </Button>
      )}
      <Button
        onClick={() => {
          dismiss();
          scanFocus.focus();
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
