import { isValidPin, type StaffRole } from '@pos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '../ui/Button';
import { useRegister, useServices } from '../ui/context';
import { PIN_ERROR_MESSAGE, PIN_FORMAT_MESSAGE, pinMessage } from './pin-message';
import { listLoginStaff, type LoginStaff, verifyStaffPin } from './staff-pin';

interface StaffPinFormProps {
  /** `manager` for an approval at the till. */
  minRole: StaffRole;
  submitLabel: string;
  onVerified: (staff: LoginStaff) => void;
}

/** Pick the person, then take the PIN (ARCH §11). Everything is checked on the device. */
export function StaffPinForm({ minRole, submitLabel, onVerified }: StaffPinFormProps) {
  const { database, now } = useServices();
  const { store } = useRegister();
  const people = useLiveQuery(() => listLoginStaff(database, { minRole }), [database, minRole]);
  const [selected, setSelected] = useState<LoginStaff | null>(null);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const checking = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  function choose(person: LoginStaff | null) {
    setSelected(person);
    setPin('');
    setMessage(null);
  }

  async function submit(event: FormEvent, person: LoginStaff) {
    event.preventDefault();
    // A ref, not state: a second Enter can arrive before the screen has updated.
    if (checking.current || pin === '') return;
    if (!isValidPin(pin)) {
      setMessage(PIN_FORMAT_MESSAGE);
      return;
    }
    checking.current = true;
    try {
      const result = await verifyStaffPin(database, { staffId: person.id, pin, minRole, now });
      if (result.status === 'ok') {
        onVerified(result.staff);
        return;
      }
      setMessage(pinMessage(result, store.timezone));
    } catch {
      setMessage(PIN_ERROR_MESSAGE);
    } finally {
      checking.current = false;
    }
    setPin('');
    input.current?.focus();
  }

  if (people === undefined) return <p>Loading staff…</p>;
  if (people.length === 0) {
    return <p role="alert">No staff on this terminal can do this. Download the catalogue again.</p>;
  }

  if (selected === null) {
    return (
      <ul className="space-y-2" aria-label="Staff">
        {people.map((person, index) => (
          <li key={person.id}>
            <Button className="w-full" autoFocus={index === 0} onClick={() => choose(person)}>
              {person.name} <span className="font-normal">({person.role})</span>
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event, selected)} className="space-y-3">
      <p className="font-semibold">{selected.name}</p>
      <label className="block">
        <span className="block">PIN</span>
        <input
          ref={input}
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          className="min-h-12 w-full rounded-md border-2 border-slate-500 px-3 text-xl"
        />
      </label>
      {message !== null && (
        <p role="alert" className="font-semibold text-red-800">
          {message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
        <Button onClick={() => choose(null)}>Someone else</Button>
      </div>
    </form>
  );
}
