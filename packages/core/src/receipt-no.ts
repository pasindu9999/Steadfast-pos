/** The human-readable receipt and return numbers of ARCH §4.3. */
export interface ReceiptNumberParts {
  /** 1–8 characters, A–Z and 0–9, e.g. `S01`. */
  storeCode: string;
  /** 1–8 characters, A–Z and 0–9, e.g. `T2`. */
  terminalCode: string;
  /** Per-terminal counter, starting at 1. */
  seq: number;
}

const SEQ_DIGITS = 6;
const CODE = '[A-Z0-9]{1,8}';
/** A valid store or terminal code. */
export const RECEIPT_CODE_PATTERN = new RegExp(`^${CODE}$`);
// Six digits, zero-padded; longer sequences carry no leading zero.
const NUMBER = `(${CODE})-(${CODE})-(\\d{${SEQ_DIGITS}}|[1-9]\\d{${SEQ_DIGITS},})`;
const RECEIPT_PATTERN = new RegExp(`^${NUMBER}$`);
const RETURN_PATTERN = new RegExp(`^R-${NUMBER}$`);

export function formatReceiptNo({ storeCode, terminalCode, seq }: ReceiptNumberParts): string {
  for (const code of [storeCode, terminalCode]) {
    if (!RECEIPT_CODE_PATTERN.test(code)) {
      throw new RangeError(`store and terminal codes must match ${CODE}, got "${code}"`);
    }
  }
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new RangeError(`seq must be a positive integer, got ${seq}`);
  }
  return `${storeCode}-${terminalCode}-${String(seq).padStart(SEQ_DIGITS, '0')}`;
}

export function formatReturnNo(parts: ReceiptNumberParts): string {
  return `R-${formatReceiptNo(parts)}`;
}

function parse(pattern: RegExp, input: string): ReceiptNumberParts | null {
  const match = pattern.exec(input.trim().toUpperCase());
  if (match === null) return null;
  const [, storeCode = '', terminalCode = '', digits = ''] = match;
  const seq = Number(digits);
  if (!Number.isSafeInteger(seq) || seq < 1) return null;
  return { storeCode, terminalCode, seq };
}

/** Accepts typed or scanned input (any case, surrounding spaces). Returns `null` if invalid. */
export function parseReceiptNo(input: string): ReceiptNumberParts | null {
  return parse(RECEIPT_PATTERN, input);
}

export function parseReturnNo(input: string): ReceiptNumberParts | null {
  return parse(RETURN_PATTERN, input);
}
