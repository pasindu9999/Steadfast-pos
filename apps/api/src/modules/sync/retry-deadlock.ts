const MAX_RETRIES = 3;

export function isDeadlock(error: unknown): boolean {
  const { code, meta, cause } = (error ?? {}) as {
    code?: string;
    meta?: unknown;
    cause?: unknown;
  };
  return code === 'P2034' || JSON.stringify([meta, cause])?.includes('40P01') === true;
}

// A parked return belongs to another terminal, so applying it can lock that terminal's row while
// its own push waits for the sale. Postgres rolls one side back, and it is safe to run again
// (ARCH §4.4).
export async function retryOnDeadlock<T>(transaction: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await transaction();
    } catch (error) {
      if (retry === MAX_RETRIES || !isDeadlock(error)) throw error;
    }
  }
}
