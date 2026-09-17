import type { StockCountDetailDTO } from "@veridi/shared";
import { STOCK_COUNT_FINDING_KIND_LABELS } from "@veridi/shared";
import { formatDateTime } from "../../lib/dates";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";

interface Evento {
  quando: string;
  texto: string;
  /** Desempate estável para eventos do mesmo instante. */
  ordem: number;
}

const DECISAO = { ADJUST: "Ajustar", NO_ADJUSTMENT: "Não ajustar" } as const;

/**
 * Linha do tempo do inventário, derivada SÓ dos carimbos que o servidor guarda
 * (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * Nada é inventado. Recontagem e decisão guardam só a ÚLTIMA vez por posição,
 * e a linha diz isso em vez de fingir um histórico que não existe. Os
 * registros de contagem ficam na posição, não aqui — são muitos, e cada um já
 * tem autor e hora.
 */
export function eventosDoInventario(inventario: StockCountDetailDTO): Evento[] {
  const eventos: Evento[] = [];
  const somar = (quando: string | null, texto: string, ordem: number) => {
    if (quando) eventos.push({ quando, texto, ordem });
  };

  somar(inventario.createdAt, `Inventário iniciado por ${inventario.createdByName}.`, 0);
  for (const posicao of inventario.positions) {
    const nome = `posição ${formatIntegerPtBr(posicao.sequence)} (${posicao.itemCode}${posicao.lotCode ? ` · ${posicao.lotCode}` : ""})`;
    somar(
      posicao.addedAt,
      `${nome[0]?.toUpperCase()}${nome.slice(1)} adicionada por ${posicao.addedByName ?? "—"}${posicao.addReason ? `: ${posicao.addReason}` : ""}.`,
      1,
    );
    somar(
      posicao.removedAt,
      `${nome[0]?.toUpperCase()}${nome.slice(1)} retirada por ${posicao.removedByName ?? "—"}${posicao.removeReason ? `: ${posicao.removeReason}` : ""}.`,
      1,
    );
    somar(
      posicao.recountRequestedAt,
      `Última recontagem pedida na ${nome} por ${posicao.recountRequestedByName ?? "—"}.`,
      3,
    );
    if (posicao.decision) {
      somar(
        posicao.decidedAt,
        `Última decisão na ${nome}: ${DECISAO[posicao.decision]}, por ${posicao.decidedByName ?? "—"}.`,
        4,
      );
    }
  }
  for (const ocorrencia of inventario.findings) {
    somar(
      ocorrencia.createdAt,
      `Ocorrência registrada por ${ocorrencia.createdByName}: ${STOCK_COUNT_FINDING_KIND_LABELS[ocorrencia.kind]} — ${ocorrencia.identification}.`,
      1,
    );
  }
  somar(
    inventario.firstRoundClosedAt,
    `Primeira contagem concluída por ${inventario.firstRoundClosedByName ?? "—"}.`,
    2,
  );
  somar(inventario.completedAt, `Inventário encerrado por ${inventario.completedByName ?? "—"}.`, 5);
  somar(
    inventario.cancelledAt,
    `Inventário cancelado por ${inventario.cancelledByName ?? "—"}${inventario.cancelReason ? `: ${inventario.cancelReason}` : ""}.`,
    5,
  );

  return eventos.sort((a, b) => (a.quando === b.quando ? a.ordem - b.ordem : a.quando < b.quando ? -1 : 1));
}

export function LinhaDoTempoDoInventario({ inventario }: { inventario: StockCountDetailDTO }) {
  const eventos = eventosDoInventario(inventario);
  return (
    <ol className="inv-linha-do-tempo" aria-label="Linha do tempo do inventário">
      {eventos.map((evento, indice) => (
        <li key={`${evento.quando}-${indice}`}>
          <time dateTime={evento.quando}>{formatDateTime(evento.quando)}</time>
          <span>{evento.texto}</span>
        </li>
      ))}
    </ol>
  );
}
