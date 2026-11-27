export function isOutOfRange(error: unknown): boolean {
  const { code, meta, cause } = (error ?? {}) as {
    code?: string;
    meta?: unknown;
    cause?: unknown;
  };
  return code === 'P2020' || JSON.stringify([meta, cause])?.includes('22003') === true;
}
