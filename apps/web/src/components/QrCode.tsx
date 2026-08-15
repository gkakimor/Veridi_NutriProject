import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeProps {
  value: string;
  size?: number;
  label?: string;
}

/** QR gerado no cliente a partir de `value` — nunca persistido como imagem no backend. */
export function QrCode({ value, size = 128, label }: QrCodeProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(false);

    QRCode.toString(value, { type: "svg", margin: 1, width: size })
      .then((result) => {
        if (!cancelled) setSvg(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div className="qr-code qr-code--error" style={{ width: size, height: size }}>
        QR indisponível
      </div>
    );
  }

  return (
    <div
      className="qr-code"
      role="img"
      aria-label={label ?? `Código QR do lote, valor ${value}`}
      style={{ width: size, height: size }}
    >
      {svg && <span dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}
