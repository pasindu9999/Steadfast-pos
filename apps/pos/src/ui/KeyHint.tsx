/** The key beside a button. Screen readers get it from `aria-keyshortcuts` instead. */
export function KeyHint({ name }: { name: string }) {
  return (
    <kbd aria-hidden="true" className="ml-1 text-sm font-normal">
      {name}
    </kbd>
  );
}
