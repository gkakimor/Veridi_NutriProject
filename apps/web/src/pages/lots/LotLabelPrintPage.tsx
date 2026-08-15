import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { LotDTO } from "@veridi/shared";
import { getLot } from "../../lib/lots-api";
import { LotLabel } from "./LotLabel";
import "./lot-label-print.css";

/**
 * Rota de impressão dedicada, fora do AppShell (sem topbar/sidebar). MVP usa
 * apenas impressão via navegador — sem servidor de impressão/ZPL/Zebra.
 */
export function LotLabelPrintPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [lot, setLot] = useState<LotDTO | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    getLot(id)
      .then(setLot)
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return (
      <div className="lot-label-print">
        <p>Lote não encontrado.</p>
        <button type="button" className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← Voltar
        </button>
      </div>
    );
  }

  if (!lot) return null;

  return (
    <div className="lot-label-print">
      <div className="lot-label-print__toolbar">
        <button type="button" className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← Voltar
        </button>
        <button type="button" className="btn btn--primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>

      <div className="lot-label-print__sheet">
        <LotLabel lot={lot} />
      </div>
    </div>
  );
}
