const MAX_DEPTH = 32;
const REPLACEMENT = '�';

export function toStorable(input: unknown): { value: unknown; changed: boolean } {
  let changed = false;
  const replaced = <T>(value: T): T => {
    changed = true;
    return value;
  };
  const clean = (text: string) => {
    const result = text.replaceAll('\0', REPLACEMENT).replace(/\p{Surrogate}/gu, REPLACEMENT);
    return result === text ? text : replaced(result);
  };
  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === 'string') return clean(node);
    if (typeof node === 'number') return Number.isFinite(node) ? node : replaced(null);
    if (typeof node !== 'object' || node === null) return node;
    if (depth === MAX_DEPTH) return replaced(null);
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    return Object.fromEntries(
      Object.entries(node).map(([key, item]) => [clean(key), walk(item, depth + 1)]),
    );
  };
  const value = walk(input, 0);
  return { value, changed };
}
