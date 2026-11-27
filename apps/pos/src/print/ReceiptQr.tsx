import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

interface ReceiptQrProps {
  payload: string;
  receiptNo: string;
}

/** The code for returns, drawn on this device. A very long sale does not fit in one. */
export function ReceiptQr({ payload, receiptNo }: ReceiptQrProps) {
  const [drawn, setDrawn] = useState<{ payload: string; image: string | null }>();

  useEffect(() => {
    let current = true;
    const show = (image: string | null) => {
      if (current) setDrawn({ payload, image });
    };
    QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M' }).then(
      (svg) => show(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`),
      () => show(null),
    );
    return () => {
      current = false;
    };
  }, [payload]);

  if (drawn?.payload !== payload) return null;
  if (drawn.image === null) {
    return (
      <p className="font-semibold">
        This sale is too large for a QR code. For a return, use receipt number {receiptNo}.
      </p>
    );
  }
  return (
    <img
      src={drawn.image}
      alt={`QR code for ${receiptNo}`}
      data-payload={payload}
      className="mx-auto w-64"
    />
  );
}
