import { useMemo, type KeyboardEvent } from 'react';

import { isReceiptEntry } from '../returns/parse-lookup';
import { useOpenReturns } from '../returns/use-open-returns';
import { useRegister, useRegisterState, useServices } from '../ui/context';
import { optionId } from './option-id';
import { addEntry, reportNotFound } from './register-actions';
import { resolveEntry } from './resolve-entry';
import { SearchResults } from './SearchResults';
import { useActionDeps } from './use-register-actions';

const LIST_ID = 'search-results';

/** The scan and search box. It holds focus whenever nothing else is being done (ARCH §7.2). */
export function ScanBar() {
  const { scanFocus } = useServices();
  const { catalog } = useRegister();
  const deps = useActionDeps();
  const openReturns = useOpenReturns();
  const search = useRegisterState((register) => register.search);
  const highlighted = useRegisterState((register) => register.highlighted);
  const setSearch = useRegisterState((register) => register.setSearch);
  const highlight = useRegisterState((register) => register.highlight);
  const dismiss = useRegisterState((register) => register.dismiss);
  const results = useMemo(() => catalog.search(search), [catalog, search]);
  const open = results.length > 0;

  function move(step: 1 | -1) {
    if (!open) return;
    const from = highlighted ?? (step === 1 ? -1 : 0);
    highlight((from + step + results.length) % results.length);
  }

  function submit() {
    const outcome = resolveEntry({ query: search, results, highlighted, catalog });
    if (outcome.type === 'add') addEntry(deps, outcome.entry);
    else if (outcome.type === 'not_found') {
      // A pasted or slowly scanned receipt is not an unknown item.
      if (isReceiptEntry(outcome.code)) openReturns(outcome.code);
      else reportNotFound(deps, outcome.code);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const actions: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Enter: () => {
        if (!event.repeat) submit();
      },
      Escape: dismiss,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  return (
    <div>
      <input
        ref={(element) => scanFocus.set(element)}
        autoFocus
        role="combobox"
        aria-label="Scan or search"
        aria-expanded={open}
        aria-controls={open ? LIST_ID : undefined}
        aria-activedescendant={open && highlighted !== null ? optionId(highlighted) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Scan a barcode, or type a name or SKU"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-14 w-full rounded-md border-2 border-slate-700 px-4 text-xl"
      />
      {open && (
        <SearchResults
          id={LIST_ID}
          results={results}
          highlighted={highlighted}
          onPick={(entry) => {
            addEntry(deps, entry);
            scanFocus.focus();
          }}
        />
      )}
    </div>
  );
}
