import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import jsQR from "jsqr";

interface LotScannerProps {
  onDetect: (rawValue: string) => void;
}

/**
 * Leitura de lote via câmera (getUserMedia + canvas + jsQR) com digitação
 * manual sempre disponível — câmera nunca é obrigatória. Permissão de câmera
 * só é pedida ao clicar em "Abrir câmera". Reutilizável para futuros fluxos
 * de Recebimento/Picking/Consumo.
 */
export function LotScanner({ onDetect }: LotScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  const [manualCode, setManualCode] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  function stopCamera() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  }

  useEffect(() => stopCamera, []);

  function tick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(imageData.data, imageData.width, imageData.height);
        if (result?.data) {
          stopCamera();
          onDetect(result.data);
          return;
        }
      }
    }
    frameRef.current = requestAnimationFrame(tick);
  }

  async function startCamera() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      frameRef.current = requestAnimationFrame(tick);
    } catch {
      setCameraError("Não foi possível acessar a câmera. Use a digitação manual abaixo.");
    }
  }

  function handleManualSubmit(event: FormEvent) {
    event.preventDefault();
    if (manualCode.trim()) onDetect(manualCode.trim());
  }

  return (
    <div className="lot-scanner">
      {!cameraActive && (
        <button type="button" className="btn btn--primary" onClick={startCamera}>
          Abrir câmera
        </button>
      )}

      {cameraError && <p className="form-alert" role="alert">{cameraError}</p>}

      {cameraActive && (
        <div className="lot-scanner__preview">
          <video ref={videoRef} className="lot-scanner__video" playsInline muted />
          <canvas ref={canvasRef} hidden />
          <button type="button" className="btn btn--ghost" onClick={stopCamera}>
            Cancelar
          </button>
        </div>
      )}

      <form className="field lot-scanner__manual" onSubmit={handleManualSubmit}>
        <label htmlFor="lot-scanner-manual">Digite o lote</label>
        <div className="lot-scanner__manual-row">
          <input
            id="lot-scanner-manual"
            type="text"
            placeholder="LT-20260815-000123"
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
          />
          <button type="submit" className="btn btn--secondary" disabled={!manualCode.trim()}>
            Buscar
          </button>
        </div>
      </form>
    </div>
  );
}
