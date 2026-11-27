import { useRegister, useSession } from '../ui/context';
import { StaffPinForm } from './StaffPinForm';

export function LoginScreen() {
  const { store, terminalCode } = useRegister();
  const signIn = useSession((session) => session.signIn);

  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-bold">{store.name}</h1>
      <p>Terminal {terminalCode}. Who is serving?</p>
      <StaffPinForm minRole="cashier" submitLabel="Log in" onVerified={signIn} />
    </main>
  );
}
