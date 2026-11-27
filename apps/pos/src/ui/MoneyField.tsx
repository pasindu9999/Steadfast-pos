import type { ComponentProps } from 'react';

import { TextField } from './TextField';

/** A dollar amount as typed. It is turned into cents by `@pos/core`, never here. */
export function MoneyField(props: ComponentProps<typeof TextField>) {
  return <TextField autoFocus inputMode="decimal" {...props} />;
}
