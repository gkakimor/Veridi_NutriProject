import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { IndustrialResourceDetailDTO } from "@veridi/shared";

vi.mock("../../lib/industrial-resources-api", () => ({
  createIndustrialResource: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));

import { createIndustrialResource } from "../../lib/industrial-resources-api";
import { useAuth } from "../../app/AuthProvider";
import { IndustrialResourceCreatePage } from "./IndustrialResourceCreatePage";
import {
  PARAM_ORIGEM,
  readContextualCreate,
  startContextualCreate,
} from "../../lib/contextual-create";

/**
 * Recurso industrial foi a última das cinco entidades a ganhar tela oficial,
 * e é a única com permissão real: `ADMIN` no botão da listagem, aqui e no
 * servidor. O que estes testes guardam é isso e o retorno ao formulário de
 * origem — a estrutura de custos, de onde alguém sai no meio de uma linha
 * para cadastrar o recurso que faltava.
 */

const CRIADO = {
  id: "rec-9",
  code: "REC-000009",
  name: "Encapsuladora automática",
  type: "EQUIPMENT",
  rates: [],
} as unknown as IndustrialResourceDetailDTO;

function comoAdmin(role = "ADMIN") {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u-1", name: "Admin", email: "a@v.com", role },
    loading: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

/** Renderiza a rota real, para o teste exercitar a navegação de verdade. */
function abrir(rota = "/gestao/recursos-industriais/novo") {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route path="/gestao/recursos-industriais/novo" element={<IndustrialResourceCreatePage />} />
        <Route path="/gestao/recursos-industriais" element={<p>Listagem de recursos</p>} />
        <Route path="/gestao/recursos-industriais/:id" element={<p>Detalhe do recurso</p>} />
        <Route path="/produtos/:productId/custos" element={<p>Estrutura de custos</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  comoAdmin();
  vi.mocked(createIndustrialResource).mockResolvedValue(CRIADO);
});

describe("Recurso industrial — cadastro direto", () => {
  it("abre com a trilha canônica e sem caminho de volta", async () => {
    abrir();

    expect(await screen.findByRole("heading", { name: "Novo recurso industrial" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Recursos industriais" })).toBeInTheDocument();
    // Sem origem não há para onde voltar: o botão nem existe.
    expect(screen.queryByRole("button", { name: /Voltar para/ })).toBeNull();
  });

  it("salvar leva ao detalhe — é lá que a tarifa entra", async () => {
    const user = userEvent.setup();
    abrir();

    await user.type(await screen.findByLabelText(/^Nome/), "Encapsuladora automática");
    await user.click(screen.getByRole("button", { name: "Criar recurso" }));

    expect(await screen.findByText("Detalhe do recurso")).toBeInTheDocument();
    expect(vi.mocked(createIndustrialResource)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Encapsuladora automática", type: "LABOR" }),
    );
  });

  it("cancelar volta para a listagem sem criar nada", async () => {
    const user = userEvent.setup();
    abrir();

    await user.click(await screen.findByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("Listagem de recursos")).toBeInTheDocument();
    expect(vi.mocked(createIndustrialResource)).not.toHaveBeenCalled();
  });

  it("potência só é pedida para equipamento", async () => {
    const user = userEvent.setup();
    abrir();

    expect(screen.queryByLabelText(/Potência/)).toBeNull();
    await user.selectOptions(screen.getByLabelText("Tipo"), "EQUIPMENT");
    expect(screen.getByLabelText(/Potência/)).toBeInTheDocument();
  });
});

describe("Recurso industrial — permissão", () => {
  /*
   * O gate real está no servidor, que recusa com 403. O desvio aqui é
   * cortesia: quem chega por link sem ser ADMIN não encara um formulário
   * que já se sabe que vai ser recusado no fim.
   */
  it("quem não é ADMIN não fica no formulário", async () => {
    comoAdmin("PRODUCTION");
    abrir();

    expect(await screen.findByText("Listagem de recursos")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Novo recurso industrial" })).toBeNull();
  });

  it("ADMIN fica", async () => {
    abrir();
    expect(await screen.findByRole("heading", { name: "Novo recurso industrial" })).toBeInTheDocument();
  });
});

describe("Recurso industrial — criação contextual", () => {
  const rascunho = { description: "Encapsulação", rateValue: "120,00" };

  function comContexto() {
    const token = startContextualCreate({
      originRoute: "/produtos/prod-1/custos",
      fieldKey: "usageResourceId",
      entityType: "industrialResource",
      draft: rascunho,
    })!;
    return { token, rota: `/gestao/recursos-industriais/novo?${PARAM_ORIGEM}=${token}` };
  }

  it("oferece o caminho de volta, dizendo para onde", async () => {
    const { rota } = comContexto();
    abrir(rota);

    expect(
      await screen.findByRole("button", { name: "← Voltar para Estrutura de custos" }),
    ).toBeInTheDocument();
    // A trilha continua canônica: a origem é caminho de volta, não hierarquia.
    expect(screen.getByRole("link", { name: "Recursos industriais" })).toBeInTheDocument();
  });

  it("salvar devolve à origem com o recurso, identificado pelo id", async () => {
    const user = userEvent.setup();
    const { token, rota } = comContexto();
    abrir(rota);

    await user.type(await screen.findByLabelText(/^Nome/), "Encapsuladora automática");
    await user.click(screen.getByRole("button", { name: "Criar recurso" }));

    expect(await screen.findByText("Estrutura de custos")).toBeInTheDocument();
    const registro = readContextualCreate(token);
    expect(registro?.result?.entityId).toBe("rec-9");
    // O rascunho da origem atravessou a ida e a volta.
    expect(registro?.draft).toEqual(rascunho);
  });

  it("cancelar devolve à origem sem resultado — nada é selecionado", async () => {
    const user = userEvent.setup();
    const { token, rota } = comContexto();
    abrir(rota);

    await user.click(await screen.findByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("Estrutura de custos")).toBeInTheDocument();
    expect(readContextualCreate(token)?.result).toBeUndefined();
    expect(vi.mocked(createIndustrialResource)).not.toHaveBeenCalled();
  });

  /*
   * O F5 é o motivo de a tela existir. O contexto vive no `sessionStorage`
   * endereçado pelo token da URL, então recarregar não o perde — aqui isso é
   * exercido remontando a árvore com a mesma rota, que é o que um refresh
   * faz com o estado do React.
   */
  it("sobrevive a um refresh no meio da criação", async () => {
    const user = userEvent.setup();
    const { token, rota } = comContexto();

    const { unmount } = abrir(rota);
    await screen.findByRole("button", { name: /Voltar para/ });
    unmount();

    abrir(rota);
    await user.type(await screen.findByLabelText(/^Nome/), "Encapsuladora automática");
    await user.click(screen.getByRole("button", { name: "Criar recurso" }));

    await waitFor(() => expect(readContextualCreate(token)?.result?.entityId).toBe("rec-9"));
  });

  it("contexto de outra entidade é ignorado — não volta para campo que não pediu", async () => {
    const token = startContextualCreate({
      originRoute: "/cadastros/produtos/novo",
      fieldKey: "customerId",
      entityType: "customer",
      draft: {},
    })!;
    abrir(`/gestao/recursos-industriais/novo?${PARAM_ORIGEM}=${token}`);

    expect(await screen.findByRole("heading", { name: "Novo recurso industrial" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Voltar para/ })).toBeNull();
  });
});
