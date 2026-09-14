import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CoaStatus, QualityQueueRowDTO } from "@veridi/shared";
import { COA_STATUSES } from "@veridi/shared";
import { QualityPendingSheetPage } from "./OperationalSheets";
import type { QualityQueueParams } from "../../lib/attachments-api";
import { listQualityQueue } from "../../lib/attachments-api";

/**
 * FO-03 — Pendências de qualidade, sem corte (FO03-PENDING-CUTOFF-01).
 *
 * A folha pedia `listQualityQueue({ pageSize: 100 })`: sem `onlyPending`, a
 * primeira página era de TODOS os lotes — aprovado e sem exigência de laudo
 * vinham antes das pendências —, e da 101ª linha em diante nada entrava. O
 * papel omitia pendência sem avisar e contava as que sobraram como todas.
 *
 * O servidor falso responde como `quality.service.ts`: `onlyPending` é
 * `coaStatus` em PENDING/RECEIVED/REJECTED, a ordem é `coaStatus` (ordem do
 * enum no Postgres) e depois `code`, `total` sai do mesmo recorte e
 * `pageSize` acima de 100 é recusado, como no schema da rota.
 */

vi.mock("@react-pdf/renderer", async () => ({ ...(await import("../../pdf/testing/react-pdf-dom")) }));

const renderPdfBlob = vi.fn();
vi.mock("../../pdf/render", () => ({
  renderPdfBlob: (...args: unknown[]) => renderPdfBlob(...args),
  downloadPdf: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({ useOptionalAuth: () => null }));
vi.mock("../../lib/attachments-api", () => ({ listQualityQueue: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  renderPdfBlob.mockReset().mockResolvedValue(new Blob(["%PDF-1.3"], { type: "application/pdf" }));
  URL.createObjectURL = vi.fn(() => "blob:veridi/fo-03");
  URL.revokeObjectURL = vi.fn();
});

/** O recorte de `onlyPending` no servidor. */
const PENDENCIAS: readonly CoaStatus[] = ["PENDING", "RECEIVED", "REJECTED"];
const NAO_PENDENCIAS: readonly CoaStatus[] = ["NOT_REQUIRED", "APPROVED"];

function lote(sequencia: number, coaStatus: CoaStatus): QualityQueueRowDTO {
  return {
    lotId: `lot-${sequencia}`,
    lotCode: `LT-20260901-${String(sequencia).padStart(6, "0")}`,
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Coenzima Q10",
    sourceName: null,
    declaredNutrient: null,
    lotOrigin: "RECEIPT",
    supplierName: "Insumos Ltda",
    ownerType: "VERIDI",
    ownerCustomerName: null,
    receivedAt: "2026-09-01T13:00:00.000Z",
    expiryDate: "2027-09-01T00:00:00.000Z",
    isExpired: false,
    requiresCoa: coaStatus !== "NOT_REQUIRED",
    coaStatus,
    coaReviewedByName: null,
    coaReviewNote: null,
    lotStatus: coaStatus === "REJECTED" ? "BLOCKED" : "AWAITING_RELEASE",
    onHand: "25",
    unitCode: "kg",
  };
}

/**
 * `pendentes` pendências e `outros` lotes fora do recorte, com códigos
 * intercalados e cadastrados fora de ordem: a ordem da folha só pode vir do
 * servidor.
 */
function massa(pendentes: number, outros: number): QualityQueueRowDTO[] {
  const lotes: QualityQueueRowDTO[] = [];
  let sequencia = 0;
  for (let i = 0; i < Math.max(pendentes, outros); i += 1) {
    if (i < outros) lotes.push(lote((sequencia += 1), NAO_PENDENCIAS[i % NAO_PENDENCIAS.length]!));
    if (i < pendentes) lotes.push(lote((sequencia += 1), PENDENCIAS[i % PENDENCIAS.length]!));
  }
  return lotes.reverse();
}

function ordemDoServidor(a: QualityQueueRowDTO, b: QualityQueueRowDTO): number {
  const porStatus = COA_STATUSES.indexOf(a.coaStatus) - COA_STATUSES.indexOf(b.coaStatus);
  if (porStatus !== 0) return porStatus;
  return a.lotCode < b.lotCode ? -1 : a.lotCode > b.lotCode ? 1 : 0;
}

function recorte(lotes: QualityQueueRowDTO[], params: QualityQueueParams): QualityQueueRowDTO[] {
  return lotes
    .filter((row) =>
      params.coaStatus ? row.coaStatus === params.coaStatus : !params.onlyPending || PENDENCIAS.includes(row.coaStatus),
    )
    .sort(ordemDoServidor);
}

function servidorDaFila(lotes: QualityQueueRowDTO[]) {
  vi.mocked(listQualityQueue).mockImplementation(async (params = {}) => {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    if (pageSize > 100) throw new Error("Erro de validação");
    const linhas = recorte(lotes, params);
    return { rows: linhas.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: linhas.length };
  });
}

function abrirTela() {
  render(
    <MemoryRouter initialEntries={["/print/qualidade-pendencias"]}>
      <Routes>
        <Route path="/print/qualidade-pendencias" element={<QualityPendingSheetPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A folha que a página mandou gerar, lida como DOM. */
async function folhaGerada() {
  abrirTela();
  await waitFor(() => expect(renderPdfBlob).toHaveBeenCalledTimes(1));
  const { container } = render(renderPdfBlob.mock.calls[0]![0] as ReactElement);
  return container;
}

/** Código do lote de cada linha de dado da tabela, na ordem do papel. */
function lotesNaFolha(container: HTMLElement): string[] {
  // A linha da tabela vazia não tem célula: não é lote.
  return [...container.querySelectorAll('[data-pdf-role="row"]')]
    .map((linha) => linha.querySelector('[data-pdf-role="cell"]')?.textContent)
    .filter((codigo): codigo is string => typeof codigo === "string");
}

function pedidos() {
  return vi.mocked(listQualityQueue).mock.calls.map(([params]) => params);
}

describe("FO-03 — todas as pendências, e só elas", () => {
  it.each([0, 1, 100, 101, 125])(
    "%i pendência(s) entre 40 lotes fora do recorte: a folha traz todas, na ordem do servidor",
    async (quantidade) => {
      const lotes = massa(quantidade, 40);
      servidorDaFila(lotes);
      const esperadas = recorte(lotes, { onlyPending: true });
      expect(esperadas).toHaveLength(quantidade);

      const container = await folhaGerada();
      const folha = within(container);

      // Todas, na ordem do servidor — concatenar as páginas não reordena.
      expect(lotesNaFolha(container)).toEqual(esperadas.map((row) => row.lotCode));
      // Lote aprovado ou sem exigência de laudo não é pendência.
      const fora = lotes.filter((row) => NAO_PENDENCIAS.includes(row.coaStatus)).map((row) => row.lotCode);
      expect(lotesNaFolha(container).filter((codigo) => fora.includes(codigo))).toEqual([]);
      expect(folha.queryByText("Aprovado")).toBeNull();
      expect(folha.queryByText("Não exigido")).toBeNull();

      // A contagem do papel é o total do servidor, não a primeira página.
      const campo = [...container.querySelectorAll('[data-pdf-role="field"]')].find((el) =>
        el.textContent?.startsWith("Lotes pendentes"),
      )!;
      expect(within(campo as HTMLElement).getByText(String(quantidade))).toBeTruthy();
      if (quantidade === 0) expect(folha.getByText("Nenhuma pendência de qualidade.")).toBeTruthy();
      expect(container.querySelectorAll('[data-pdf-role="write"]')).toHaveLength(quantidade);

      // Recorte no servidor e uma requisição por página, nunca uma por linha.
      const paginas = Math.max(1, Math.ceil(quantidade / 100));
      expect(pedidos()).toEqual(
        Array.from({ length: paginas }, (_, i) => ({ onlyPending: true, page: i + 1, pageSize: 100 })),
      );
    },
  );
});

describe("FO-03 — leitura incompleta não vira folha", () => {
  it("a segunda página falha: nenhum PDF, e a tela diz que não gerou", async () => {
    const lotes = massa(125, 40);
    servidorDaFila(lotes);
    const servidor = vi.mocked(listQualityQueue).getMockImplementation()!;
    vi.mocked(listQualityQueue).mockImplementation(async (params = {}) => {
      if (params.page === 2) {
        throw new Error("Erro interno do servidor (500). Tente novamente ou avise o suporte.");
      }
      return servidor(params);
    });

    abrirTela();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Não foi possível gerar o documento: Erro interno do servidor (500). Tente novamente ou avise o suporte.",
    );
    expect(renderPdfBlob).not.toHaveBeenCalled();
    expect(screen.queryByTitle(/^Documento /)).toBeNull();
    expect(screen.getByRole("button", { name: "Baixar PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeDisabled();
    expect(pedidos().map((params) => params?.page)).toEqual([1, 2]);
  });

  it("uma pendência sai da fila entre as páginas: o total muda, e nenhum PDF sai", async () => {
    const lotes = massa(125, 40);
    const aprovadoNoMeio = recorte(lotes, { onlyPending: true })[0]!;
    const depois = lotes.map((row) => (row === aprovadoNoMeio ? { ...row, coaStatus: "APPROVED" as const } : row));
    vi.mocked(listQualityQueue).mockImplementation(async (params = {}) => {
      const page = params.page ?? 1;
      const pageSize = params.pageSize ?? 20;
      const linhas = recorte(page === 1 ? lotes : depois, params);
      return { rows: linhas.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: linhas.length };
    });

    abrirTela();

    expect(await screen.findByRole("alert")).toHaveTextContent("A lista mudou enquanto era lida.");
    expect(renderPdfBlob).not.toHaveBeenCalled();
  });
});
