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
 * FO-03 — Pendências de qualidade: todas, num retrato só
 * (FO03-PENDING-CUTOFF-01, PAGED-DOCUMENT-SNAPSHOT-01).
 *
 * A folha imprimia só a primeira página de 100; depois passou a ler todas as
 * páginas por deslocamento, e uma pendência saindo da fila com outra entrando
 * entre duas páginas mantinha o `total` e escondia um lote sem aviso. Agora a
 * folha faz UMA leitura `all=true`: o servidor devolve o recorte inteiro de um
 * retrato do banco, ou recusa acima do teto.
 *
 * O servidor falso responde como `quality.service.ts`: `onlyPending` é
 * `coaStatus` em PENDING/RECEIVED/REJECTED, a ordem é `coaStatus` (ordem do
 * enum no Postgres) e depois `code`, `all` devolve o recorte inteiro com
 * `total` igual às linhas e, acima do teto, recusa com a frase da API.
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

/** O teto de `QUALITY_QUEUE_ALL_ROWS_LIMIT` e a frase de `QualityQueueTooLargeError`. */
const TETO = 1000;
const FRASE_DO_TETO =
  "A fila tem mais de 1.000 lotes neste recorte — acima do limite de um documento. Trate parte das pendências em Qualidade → Documentos / CoA e gere de novo.";

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

/** A fila como o servidor a lê em cada chamada — `fila()` é o banco daquele instante. */
function servidorDaFila(fila: () => QualityQueueRowDTO[]) {
  vi.mocked(listQualityQueue).mockImplementation(async (params = {}) => {
    const linhas = recorte(fila(), params);
    if (params.all) {
      if (linhas.length > TETO) throw new Error(FRASE_DO_TETO);
      return { rows: linhas, page: 1, pageSize: linhas.length, total: linhas.length };
    }
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
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

describe("FO-03 — todas as pendências, e só elas, numa leitura", () => {
  it.each([0, 1, 100, 101, 500])(
    "%i pendência(s) entre 40 lotes fora do recorte: a folha traz todas, na ordem do servidor",
    async (quantidade) => {
      const lotes = massa(quantidade, 40);
      servidorDaFila(() => lotes);
      const esperadas = recorte(lotes, { onlyPending: true });
      expect(esperadas).toHaveLength(quantidade);

      const container = await folhaGerada();
      const folha = within(container);

      // Todas, na ordem do servidor.
      expect(lotesNaFolha(container)).toEqual(esperadas.map((row) => row.lotCode));
      // Lote aprovado ou sem exigência de laudo não é pendência.
      const fora = lotes.filter((row) => NAO_PENDENCIAS.includes(row.coaStatus)).map((row) => row.lotCode);
      expect(lotesNaFolha(container).filter((codigo) => fora.includes(codigo))).toEqual([]);
      expect(folha.queryByText("Aprovado")).toBeNull();
      expect(folha.queryByText("Não exigido")).toBeNull();

      // A contagem do papel é o total do servidor.
      const campo = [...container.querySelectorAll('[data-pdf-role="field"]')].find((el) =>
        el.textContent?.startsWith("Lotes pendentes"),
      )!;
      expect(within(campo as HTMLElement).getByText(String(quantidade))).toBeTruthy();
      if (quantidade === 0) expect(folha.getByText("Nenhuma pendência de qualidade.")).toBeTruthy();
      expect(container.querySelectorAll('[data-pdf-role="write"]')).toHaveLength(quantidade);

      // Uma leitura só, do recorte inteiro: nenhuma página, nenhum deslocamento.
      expect(pedidos()).toEqual([{ onlyPending: true, all: true }]);
    },
  );
});

describe("FO-03 — a fila mudando não vira folha misturada", () => {
  it("uma pendência sai e outra entra logo depois da leitura: a folha é o retrato da leitura, inteiro", async () => {
    // O cenário que escapava da leitura por páginas: 125 pendências, uma sai
    // antes do deslocamento e outra entra depois dele — total igual, nenhuma
    // chave repetida, um lote fora do papel.
    let lotes = massa(125, 40);
    const retrato = recorte(lotes, { onlyPending: true });
    const sai = retrato[0]!;
    const entra = lote(9999, "PENDING");
    servidorDaFila(() => {
      const agora = lotes;
      lotes = [...lotes.map((row) => (row === sai ? { ...row, coaStatus: "APPROVED" as const } : row)), entra];
      return agora;
    });

    const container = await folhaGerada();

    expect(lotesNaFolha(container)).toEqual(retrato.map((row) => row.lotCode));
    expect(lotesNaFolha(container)).toContain(sai.lotCode);
    expect(lotesNaFolha(container)).not.toContain(entra.lotCode);
    expect(pedidos()).toHaveLength(1);
  });
});

describe("FO-03 — leitura recusada ou incompleta não vira folha", () => {
  it("acima do teto: a frase do servidor na tela, nenhum PDF e nenhuma segunda leitura", async () => {
    const lotes = massa(TETO + 1, 40);
    servidorDaFila(() => lotes);

    abrirTela();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(`Não foi possível gerar o documento: ${FRASE_DO_TETO}`);
    expect(renderPdfBlob).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Baixar PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeDisabled();
    expect(pedidos()).toEqual([{ onlyPending: true, all: true }]);
  });

  it("a leitura falha: nenhum PDF, e a tela diz que não gerou", async () => {
    vi.mocked(listQualityQueue).mockRejectedValue(
      new Error("Erro interno do servidor (500). Tente novamente ou avise o suporte."),
    );

    abrirTela();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Não foi possível gerar o documento: Erro interno do servidor (500). Tente novamente ou avise o suporte.",
    );
    expect(renderPdfBlob).not.toHaveBeenCalled();
    expect(screen.queryByTitle(/^Documento /)).toBeNull();
  });

  it("resposta que não fecha com o próprio total: nenhum PDF", async () => {
    const linhas = recorte(massa(3, 0), { onlyPending: true });
    vi.mocked(listQualityQueue).mockResolvedValue({ rows: linhas, page: 1, pageSize: 4, total: 4 });

    abrirTela();

    expect(await screen.findByRole("alert")).toHaveTextContent("A fila não fechou com o total informado.");
    expect(renderPdfBlob).not.toHaveBeenCalled();
  });
});
