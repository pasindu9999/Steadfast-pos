import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { QR_QUIET_ZONE, qrWidthMm } from './qr-size';

interface ReceiptQrProps {
  payload: string;
  receiptNo: string;
  /** Called once the code, or the note in its place, is on screen. */
  onReady?: () => void;
}

interface Code {
  image: string;
  widthMm: number;
}

async function drawCode(payload: string): Promise<Code> {
  const options = { errorCorrectionLevel: 'M', margin: QR_QUIET_ZONE } as const;
  const svg = await QRCode.toString(payload, { ...options, type: 'svg' });
  return {
    image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    widthMm: qrWidthMm(QRCode.create(payload, options).modules.size),
  };
}

/** The code for returns, drawn on this device. A very long sale does not fit in one. */
export function ReceiptQr({ payload, receiptNo, onReady }: ReceiptQrProps) {
  const [drawn, setDrawn] = useState<{ payload: string; code: Code | null }>();
  const tooLarge = drawn?.payload === payload && drawn.code === null;

  useEffect(() => {
    let current = true;
    const show = (code: Code | null) => {
      if (current) setDrawn({ payload, code });
    };
    drawCode(payload).then(show, () => show(null));
    return () => {
      current = false;
    };
  }, [payload]);

  useEffect(() => {
    if (tooLarge) onReady?.();
  }, [tooLarge, onReady]);

  if (drawn?.payload !== payload) return null;
  if (drawn.code === null) {
    return (
      <p className="receipt-keep font-semibold">
        This sale is too large for a QR code. For a return, use receipt number {receiptNo}.
      </p>
    );
  }
  return (
    <img
      src={drawn.code.image}
      alt={`QR code for ${receiptNo}`}
      data-payload={payload}
      className="receipt-qr receipt-keep mx-auto"
      style={{ width: `${drawn.code.widthMm}mm` }}
      onLoad={onReady}
      // Paper without a picture is better than no paper.
      onError={onReady}
    />
  );
}
