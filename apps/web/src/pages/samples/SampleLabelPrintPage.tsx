import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ProjectSampleDTO } from "@veridi/shared";
import { PROJECT_SAMPLE_STATUS_LABELS } from "@veridi/shared";
import { QrCode } from "../../components/QrCode";
import { getSample } from "../../lib/samples-api";
import "./sample-label-print.css";

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

/**
 * Etiqueta da amostra (A6).
 *
 * O QR carrega `SAMPLE:AM-000001` — nunca `LOT:`. Ler a etiqueta de uma
 * amostra jamais pode abrir a tela de um lote de estoque: são objetos
 * diferentes, e confundi-los levaria alguém a expedir uma amostra.
 *
 * Os dados de cliente/projeto vêm do snapshot congelado na produção quando
 * existe — a etiqueta já impressa não muda porque alguém renomeou o projeto.
 */
export function SampleLabel({ sample }: { sample: ProjectSampleDTO }) {
  const customerName = sample.customerNameSnapshot ?? sample.customerName;
  const projectCode = sample.projectCodeSnapshot ?? sample.projectCode;
  const projectName = sample.projectNameSnapshot ?? sample.projectName;

  return (
    <div className="sample-label">
      <div className="sample-label__header">
        <span>VERIDI NUTRITION</span>
        <span className="sample-label__kind">AMOSTRA</span>
      </div>

      <div>
        <div className="sample-label__code">{sample.code}</div>
        <div className="sample-label__test">
          Teste {sample.testLabel} — {PROJECT_SAMPLE_STATUS_LABELS[sample.status]}
        </div>
      </div>

      <dl className="sample-label__fields">
        <dt>Cliente</dt>
        <dd>{customerName}</dd>
        <dt>Projeto</dt>
        <dd>
          {projectCode} — {projectName}
        </dd>
        <dt>Descrição</dt>
        <dd>{sample.description ?? "—"}</dd>
        <dt>Quantidade</dt>
        <dd>
          {sample.outputQuantity ? `${sample.outputQuantity} ${sample.outputUomCode ?? ""}` : "—"}
        </dd>
        <dt>Produzida em</dt>
        <dd>{formatDateTime(sample.producedAt)}</dd>
        <dt>Responsável</dt>
        <dd>{sample.producedByName ?? sample.createdByName ?? "—"}</dd>
      </dl>

      <div className="sample-label__qr">
        <QrCode value={sample.qrPayload} size={110} label={`Código QR da amostra ${sample.code}`} />
        <span className="sample-label__qr-code">{sample.qrPayload}</span>
        <span className="sample-label__notice">
          Material de desenvolvimento — não é produto acabado e não pode ser comercializado.
        </span>
      </div>
    </div>
  );
}

/** Rota de impressão dedicada, fora do AppShell (mesmo padrão da etiqueta de lote). */
export function SampleLabelPrintPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [sample, setSample] = useState<ProjectSampleDTO | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    getSample(id)
      .then(setSample)
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return (
      <div className="sample-label-print">
        <p>Amostra não encontrada.</p>
        <button type="button" className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← Voltar
        </button>
      </div>
    );
  }

  if (!sample) return null;

  return (
    <div className="sample-label-print">
      <div className="sample-label-print__toolbar">
        <button type="button" className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← Voltar
        </button>
        <button type="button" className="btn btn--primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>

      <div className="sample-label-print__sheet">
        <SampleLabel sample={sample} />
      </div>
    </div>
  );
}
