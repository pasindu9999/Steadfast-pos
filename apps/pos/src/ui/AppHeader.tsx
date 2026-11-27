import { SyncBadge } from '../sync/SyncBadge';
import { Button } from './Button';
import { useCart, useRegister, useSession } from './context';

export function AppHeader() {
  const { store, terminalCode } = useRegister();
  const staff = useSession((session) => session.staff);
  const signOut = useSession((session) => session.signOut);
  // Another person must not inherit a half-built sale and its approvals.
  const selling = useCart((cart) => cart.lines.length > 0);

  return (
    <header className="flex flex-wrap items-center gap-4 border-b-2 border-slate-300 px-4 py-2">
      <h1 className="text-lg font-bold">{store.name}</h1>
      <span>Terminal {terminalCode}</span>
      <div className="ml-auto flex items-center gap-4">
        <SyncBadge />
        <span>
          {staff?.name} ({staff?.role})
        </span>
        <Button
          onClick={signOut}
          disabled={selling}
          title={selling ? 'Finish, park or clear the sale first' : undefined}
        >
          Log out
        </Button>
      </div>
    </header>
  );
}
