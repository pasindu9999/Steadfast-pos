/** The blank margin around a code, in modules, that scanners need. */
export const QR_QUIET_ZONE = 4;

const MM_PER_MODULE = 0.5;
const MIN_WIDTH_MM = 40;
/** The printable width of 80 mm paper. */
const MAX_WIDTH_MM = 72;

/**
 * How wide to print a code of `modules` squares a side. A long sale makes a dense code, which gets
 * the whole width, so that a 203 dpi thermal head still has about three dots for each square.
 */
export function qrWidthMm(modules: number): number {
  const wanted = (modules + 2 * QR_QUIET_ZONE) * MM_PER_MODULE;
  return Math.min(MAX_WIDTH_MM, Math.max(MIN_WIDTH_MM, wanted));
}
