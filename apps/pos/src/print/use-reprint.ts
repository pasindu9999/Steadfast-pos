import { useNavigate } from 'react-router';

import { useServices } from '../ui/context';

/** What a receipt screen is opened with to show an earlier receipt again. */
interface ReprintState {
  reprint: true;
}

export const isReprint = (state: unknown) => (state as ReprintState | null)?.reprint === true;

/** Opens an earlier sale's or return's receipt and prints it. */
export function useReprint(): (kind: 'receipt' | 'return', id: string) => void {
  const { printer } = useServices();
  const navigate = useNavigate();

  return (kind, id) => {
    printer.request(id);
    const state: ReprintState = { reprint: true };
    void navigate(`/${kind}/${id}`, { state });
  };
}
