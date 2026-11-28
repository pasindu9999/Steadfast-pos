/**
 * Printing goes through the browser's own dialog, so it works offline with any printer the device
 * knows (ARCH §7.5).
 */
export const PAPER_WIDTH_MM = 80;

/** Marks the one element that goes on paper (see `print.css`). */
const RECEIPT = '[data-print-receipt]';
const PAGE_STYLE = 'style[data-print-page]';
const PX_PER_MM = 96 / 25.4;
/** So that rounding never spills the last line onto a second page. */
const SPARE_MM = 0.5;

export type PrintTarget = EventTarget & Pick<Window, 'print' | 'document'>;

export interface Printer {
  /** Opens the print dialog. Never throws. */
  print: () => void;
  /**
   * Sizes the page whenever printing starts, from here or from the browser's menu, and calls
   * `done` when the dialog closes. Returns the clean-up.
   */
  watch: (done: () => void) => () => void;
  /** Asks for a receipt to be printed as soon as it is on screen. Kept in memory only. */
  request: (id: string) => void;
  /** Whether this receipt was asked for. `true` only once. */
  take: (id: string) => boolean;
  /** Drops a request for any other receipt. */
  keepOnly: (id: string | null) => void;
}

function clearPage({ document }: PrintTarget): void {
  document.querySelector(PAGE_STYLE)?.remove();
}

/**
 * CSS cannot say "80 mm wide, as long as it needs": `size: 80mm auto` is not valid, and browsers
 * ignore it. So the receipt is measured, and the length is stated.
 */
function sizePage(target: PrintTarget): void {
  clearPage(target);
  const { document } = target;
  const receipt = document.querySelector(RECEIPT);
  if (!receipt) return;
  const length = Math.ceil(receipt.getBoundingClientRect().height / PX_PER_MM + SPARE_MM);
  // A page shorter than it is wide would be printed sideways.
  const height = Math.max(PAPER_WIDTH_MM, length);
  const style = document.createElement('style');
  style.setAttribute('data-print-page', '');
  style.textContent = `@page { size: ${PAPER_WIDTH_MM}mm ${height}mm; margin: 0; }`;
  // At the end, so it wins over the stylesheet's `@page`.
  document.body.append(style);
}

export function createPrinter(findTarget: () => PrintTarget = () => window): Printer {
  let waiting: string | null = null;

  return {
    print() {
      try {
        const target = findTarget();
        // Not every browser says `beforeprint`.
        sizePage(target);
        target.print();
      } catch (error) {
        // The receipt stays on screen, to be printed again.
        console.warn('printing failed', (error as Error | null)?.name);
      }
    },
    watch(done) {
      const target = findTarget();
      const before = () => sizePage(target);
      const after = () => {
        clearPage(target);
        done();
      };
      target.addEventListener('beforeprint', before);
      target.addEventListener('afterprint', after);
      return () => {
        target.removeEventListener('beforeprint', before);
        target.removeEventListener('afterprint', after);
      };
    },
    request(id) {
      waiting = id;
    },
    take(id) {
      if (waiting !== id) return false;
      waiting = null;
      return true;
    },
    keepOnly(id) {
      if (waiting !== id) waiting = null;
    },
  };
}
