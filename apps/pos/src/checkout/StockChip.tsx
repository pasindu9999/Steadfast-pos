import { useAvailable } from '../catalog/use-available';
import { useServices } from '../ui/context';

/** A warning, never a block: the item is in the customer's hands (ARCH §5.3). */
export function StockChip({ variantId }: { variantId: string }) {
  const { database } = useServices();
  const available = useAvailable(variantId, database);
  if (available === undefined || available > 0) return null;

  return (
    <p className="inline-block rounded-full border-2 border-amber-700 bg-amber-200 px-3 py-1 text-sm font-semibold text-amber-950">
      System shows 0 — sale allowed
    </p>
  );
}
