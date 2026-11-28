import { encodeReceiptQr } from '@pos/core';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';

import { qrWidthMm } from './qr-size';

describe('printed QR width', () => {
  it.each([
    // The smallest code there is.
    [21, 40],
    [72, 40],
    [73, 40.5],
    [135, 71.5],
    [136, 72],
    // The largest code there is.
    [177, 72],
  ])('gives %i modules %f mm', (modules, mm) => {
    expect(qrWidthMm(modules)).toBe(mm);
  });

  it('leaves the largest receipt code three dots a module on a 203 dpi printer', () => {
    const lines = Array.from({ length: 45 }, (_, index) => ({
      lineNo: index + 1,
      variantId: `3333${String(index).padStart(4, '0')}-0000-4000-8000-000000000000`,
      qty: 999,
      lineTotalCents: 99_999_999,
    }));
    const payload = encodeReceiptQr({
      saleId: '01920f3a-7b2c-7000-8000-0000000000aa',
      receiptNo: 'S01-T1-000001',
      lines: lines.slice(0, 42),
    });
    const { size } = QRCode.create(payload, { errorCorrectionLevel: 'M' }).modules;
    // 8 dots a millimetre; the quiet zone is 4 modules on each side.
    const dotsPerModule = (qrWidthMm(size) * 8) / (size + 8);

    expect(dotsPerModule).toBeGreaterThanOrEqual(3);
  });
});
