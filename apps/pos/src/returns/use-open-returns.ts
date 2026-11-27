import { useNavigate } from 'react-router';

import { useServices } from '../ui/context';

/** What the Returns screen is opened with. */
export interface ReturnsState {
  /** A scanned, pasted or typed receipt to look up straight away. */
  entry: string;
}

/** Opens Returns from anywhere on the till. The sale being rung up is kept. */
export function useOpenReturns(): (entry?: string) => void {
  const { stores } = useServices();
  const navigate = useNavigate();

  return (entry) => {
    // What was typed into the scan box has been taken from it.
    stores.register.getState().dismiss();
    const state: ReturnsState | null = entry === undefined ? null : { entry };
    void navigate('/returns', { state });
  };
}
