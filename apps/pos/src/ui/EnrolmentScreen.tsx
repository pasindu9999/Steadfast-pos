import { useState } from 'react';

import type { TerminalState } from '../db/settings-repo';
import type { EnrolmentInput } from '../sync/enrol-terminal';
import { enrolmentMessage } from './enrolment-message';

interface EnrolmentScreenProps {
  state: Exclude<TerminalState, 'ready'>;
  defaultApiUrl: string;
  onEnrol: (input: EnrolmentInput) => Promise<void>;
  onDownload: () => Promise<void>;
}

export function EnrolmentScreen({
  state,
  defaultApiUrl,
  onEnrol,
  onDownload,
}: EnrolmentScreenProps) {
  const [apiUrl, setApiUrl] = useState(defaultApiUrl);
  const [enrolmentCode, setEnrolmentCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(enrolmentMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Set up this terminal</h2>
      {state === 'not_enrolled' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => onEnrol({ apiUrl, enrolmentCode }));
          }}
        >
          <p>
            <label>
              Server address{' '}
              <input
                type="url"
                required
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
              />
            </label>
          </p>
          <p>
            <label>
              Enrolment code{' '}
              <input
                required
                autoComplete="off"
                spellCheck={false}
                value={enrolmentCode}
                onChange={(event) => setEnrolmentCode(event.target.value)}
              />
            </label>
          </p>
          <button type="submit" disabled={busy}>
            Set up terminal
          </button>
        </form>
      ) : (
        <>
          <p>This terminal is enrolled. It needs the catalogue before it can sell.</p>
          <button type="button" disabled={busy} onClick={() => void run(onDownload)}>
            Download catalogue
          </button>
        </>
      )}
      {busy && <p role="status">Working…</p>}
      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
}
