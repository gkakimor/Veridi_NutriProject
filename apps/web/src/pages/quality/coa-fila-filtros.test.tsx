import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { QualityQueueResponse } from "@veridi/shared";

/**
 * Documentos / CoA — filtros da fila (FILTER-OPERATIONS-WAVE-01).
 *
 * Três coisas se provam aqui:
 *
 * 1. **Todos.** O `<select>` só oferecia "Pendências" e um `CoaStatus`
 *    exato: não havia como ver a fila inteira, e um lote já aprovado
 *    aparecia só se alguém adivinhasse escolher "Aprovado".
 * 2. **Pendências chega mesmo à consulta.** O default vira `onlyPending` na
 *    API — e nunca `coaStatus`, que é outra pergunta: `PENDING` é UM dos
 *    três estados que exigem ação, não os três.
 * 3. **Nada de corte.** A paginação é do servidor e o rodapé usa o `total`
 *    dele, não o tamanho da página.
 */

vi.mock("../../lib/attachments-api", () => ({
  listQualityQueue: vi.fn(),
  approveCoa: vi.fn(),
  rejectCoa: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "QUALITY" } }),
}));

import { listQualityQueue } from "../../lib/attachments-api";
import { clearStoredFilters } from "../../lib/stored-filters";
import { CoaQueuePage } from "./CoaQueuePage";

const VAZIO: QualityQueueResponse = { rows: [], page: 1, pageSize: 20, total: 0 };

type Consulta = NonNullable<Parameters<typeof listQualityQueue>[0]>;

const chamadas = () => vi.mocked(listQualityQueue).mock.calls;
const ultimaConsulta = () => chamadas()[chamadas().length - 1]?.[0] as Consulta;

async function abrir(url = "/") {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <CoaQueuePage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listQualityQueue).toHaveBeenCalled());
  return resultado;
}

beforeEach(() => {
  clearStoredFilters("u-1", "coa-queue");
  vi.mocked(listQualityQueue).mockReset();
  vi.mocked(listQualityQueue).mockResolvedValue(VAZIO);
});

describe("recorte documental", () => {
  it("o default é Pendências, e ele chega à API como `onlyPending`", async () => {
    await abrir();
    const consulta = ultimaConsulta();
    expect(consulta.onlyPending).toBe(true);
    // `onlyPending` e `coaStatus` são perguntas diferentes: nunca as duas.
    expect(consulta.coaStatus).toBeUndefined();
    expect(screen.getByLabelText("Filtrar por situação documental")).toHaveValue("pendencias");
  });

  it("`Todos` não manda recorte nenhum — é a ausência que devolve a fila inteira", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por situação documental"), {
      target: { value: "todos" },
    });
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.onlyPending).toBeUndefined();
      expect(consulta.coaStatus).toBeUndefined();
    });
  });

  it("`Todos` existe na lista de opções — antes não existia", async () => {
    await abrir();
    const opcoes = [
      ...screen.getByLabelText("Filtrar por situação documental").querySelectorAll("option"),
    ];
    expect(opcoes.map((opcao) => opcao.value)).toContain("todos");
    expect(opcoes.map((opcao) => opcao.textContent)).toContain("Todos");
  });

  it("um status exato vira `coaStatus`, e some `onlyPending`", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por situação documental"), {
      target: { value: "APPROVED" },
    });
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.coaStatus).toBe("APPROVED");
      expect(consulta.onlyPending).toBeUndefined();
    });
  });

  /*
   * `pendencias` e `PENDING` moram na mesma URL e querem dizer coisas
   * diferentes. O sentinela em minúsculas existe para que ninguém confunda os
   * dois lendo o endereço — e para que `?coa=PENDING` continue sendo o status
   * exato, não o recorte de três.
   */
  it("`PENDING` é o status exato, não o recorte de pendências", async () => {
    await abrir("/?coa=PENDING");
    const consulta = ultimaConsulta();
    expect(consulta.coaStatus).toBe("PENDING");
    expect(consulta.onlyPending).toBeUndefined();
  });
});

describe("demais filtros e contexto", () => {
  it("busca continua", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar lote ou item"), {
      target: { value: "LT-2026" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "LT-2026" }));
  });

  it("`somente com saldo` continua e vai para a URL", async () => {
    await abrir();
    fireEvent.click(screen.getByLabelText("Somente com saldo"));
    await waitFor(() => expect(ultimaConsulta().onlyWithBalance).toBe(true));
  });

  it("contexto por link — item, fornecedor e cliente — chega à consulta", async () => {
    await abrir("/?itemId=item-1&supplierId=sup-1&ownerCustomerId=cli-1");
    expect(ultimaConsulta()).toMatchObject({
      itemId: "item-1",
      supplierId: "sup-1",
      ownerCustomerId: "cli-1",
    });
  });

  it("a URL restaura o recorte inteiro", async () => {
    await abrir("/?coa=APPROVED&search=LT-1&comSaldo=sim");
    expect(ultimaConsulta()).toMatchObject({
      coaStatus: "APPROVED",
      search: "LT-1",
      onlyWithBalance: true,
    });
    expect(screen.getByLabelText("Filtrar por situação documental")).toHaveValue("APPROVED");
    expect(screen.getByLabelText("Somente com saldo")).toBeChecked();
  });
});

describe("paginação sem corte", () => {
  it("o rodapé e a paginação usam o total do SERVIDOR", async () => {
    // 250 lotes na fila, 20 por página.
    vi.mocked(listQualityQueue).mockResolvedValue({ ...VAZIO, total: 250 });
    await abrir();

    expect(await screen.findByText(/Página 1 de 13 — 250 lote/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima" })).toBeEnabled();
  });

  it("avançar página preserva o recorte", async () => {
    vi.mocked(listQualityQueue).mockResolvedValue({ ...VAZIO, total: 250 });
    await abrir("/?coa=APPROVED");

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultimaConsulta().page).toBe(2));
    expect(ultimaConsulta().coaStatus).toBe("APPROVED");
  });

  it("nunca pede mais de uma página por vez", async () => {
    vi.mocked(listQualityQueue).mockResolvedValue({ ...VAZIO, total: 250 });
    await abrir();
    for (const [params] of chamadas()) {
      expect(params?.pageSize).toBe(20);
    }
  });

  it("trocar filtro volta para a página 1", async () => {
    vi.mocked(listQualityQueue).mockResolvedValue({ ...VAZIO, total: 250 });
    await abrir("/?page=5");
    expect(ultimaConsulta().page).toBe(5);

    fireEvent.change(screen.getByLabelText("Filtrar por situação documental"), {
      target: { value: "todos" },
    });
    await waitFor(() => expect(ultimaConsulta().page).toBe(1));
  });
});

describe("chips e limpar", () => {
  it("o default não vira chip; o resto vira e some pelo ×", async () => {
    const primeira = await abrir();
    expect(screen.queryByText(/^Filtros \(/)).toBeNull();
    primeira.unmount();

    const { container } = await abrir("/?coa=APPROVED&search=LT-1&comSaldo=sim");
    expect(screen.getByText("Filtros (3)")).toBeInTheDocument();
    const chips = container.querySelector(".filter-chips") as HTMLElement;
    expect(within(chips).getByText("Aprovado")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Saldo" }));
    await waitFor(() => expect(ultimaConsulta().onlyWithBalance).toBeUndefined());
    expect(ultimaConsulta().coaStatus).toBe("APPROVED");
  });

  it("remover o chip de CoA devolve Pendências, não `sem filtro`", async () => {
    await abrir("/?coa=APPROVED");
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro CoA" }));
    await waitFor(() => expect(ultimaConsulta().onlyPending).toBe(true));
  });

  it("`Limpar filtros` volta ao default da Qualidade", async () => {
    await abrir("/?coa=todos&search=LT-1&comSaldo=sim");
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.search).toBeUndefined();
      expect(consulta.onlyWithBalance).toBeUndefined();
      expect(consulta.onlyPending).toBe(true);
    });
  });
});
