/**
 * Staff PIN hashes (ARCH §11): made on the server, verified offline on a terminal.
 * Format: `pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>`.
 */
export const PIN_HASH_ITERATIONS = 210_000;

const ALGORITHM = 'pbkdf2-sha256';
const MAX_ITERATIONS = 10_000_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const PIN_PATTERN = /^[0-9]{4,8}$/;
const HASH_PATTERN = /^pbkdf2-sha256\$([1-9]\d{0,7})\$((?:[0-9a-f]{2})+)\$([0-9a-f]{64})$/;

/** The parts of WebCrypto used here. `core` loads neither DOM nor Node types. */
interface WebCryptoSubset {
  getRandomValues(array: Uint8Array): Uint8Array;
  subtle: {
    importKey(
      format: 'raw',
      keyData: Uint8Array,
      algorithm: 'PBKDF2',
      extractable: false,
      usages: ['deriveBits'],
    ): Promise<unknown>;
    deriveBits(
      algorithm: { name: 'PBKDF2'; hash: 'SHA-256'; salt: Uint8Array; iterations: number },
      key: unknown,
      length: number,
    ): Promise<ArrayBuffer>;
  };
}

const webCrypto = () => (globalThis as unknown as { crypto: WebCryptoSubset }).crypto;

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string) =>
  Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  // A valid PIN is ASCII digits, so each character is one byte.
  const bytes = Uint8Array.from(pin, (digit) => digit.charCodeAt(0));
  const { subtle } = webCrypto();
  const key = await subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return toHex(new Uint8Array(bits));
}

export async function hashPin(
  pin: string,
  options: { iterations?: number; salt?: Uint8Array } = {},
): Promise<string> {
  const { iterations = PIN_HASH_ITERATIONS } = options;
  if (!isValidPin(pin)) {
    throw new RangeError('a PIN must be 4 to 8 digits');
  }
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new RangeError(`iterations must be an integer from 1 to ${MAX_ITERATIONS}`);
  }
  const salt = options.salt ?? webCrypto().getRandomValues(new Uint8Array(SALT_BYTES));
  const digest = await derive(pin, salt, iterations);
  return `${ALGORITHM}$${iterations}$${toHex(salt)}$${digest}`;
}

/** `false` for a wrong or invalid PIN, and for a hash this function can't read. */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const match = HASH_PATTERN.exec(storedHash);
  if (match === null || !isValidPin(pin)) return false;
  const [, iterationText = '', saltHex = '', expected = ''] = match;
  const iterations = Number(iterationText);
  if (iterations > MAX_ITERATIONS) return false;

  const actual = await derive(pin, fromHex(saltHex), iterations);
  // Compares every character, so timing does not reveal how much matched.
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}
