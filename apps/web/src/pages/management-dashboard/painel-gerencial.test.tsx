import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ManagementDashboardDTO, UserRole, ValorDoRecorteDTO } from "@veridi/shared";
import {
  MANAGEMENT_DASHBOARD_ROLES,
  MENSAGEM_DE_PERIODO_INVERTIDO,
  MENSAGEM_PERIODO_SEM_FIM,
  USER_ROLES,
} from "@veridi/shared";

/**
 * Painel Gerencial — a tela (MANAGEMENT-DASHBOARD-V1-01).
 *
 * O read model é mockado: aqui se prova o que a tela faz com cada leitura do
 * DTO — que "sem documento", "incompleto" e "completo" nunca se confundem, que
 * o período mora na URL e não consulta o que o servidor recusaria, que só o
 * perfil permitido pergunta, e que cada link leva a uma tela que filtra
 * exatamente o que o número conta.
 */

const auth = vi.hoisted(() => ({ papel: "ADMIN" as UserRole }));

vi.mock("../../lib/management-dashboard-api", () => ({ getManagementDashboard: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Pessoa", role: auth.papel } }),
}));

import { canSeeNavItem, navItems, visibleNavGroups } from "../../app/navigation";
import { helpTopics } from "../../help/help-content";
import { getManagementDashboard } from "../../lib/management-dashboard-api";
import { ManagementDashboardPage } from "./ManagementDashboardPage";

const vazio: ValorDoRecorteDTO = { count: 0, withValue: 0, amount: null };

function painelVazio(): ManagementDashboardDTO {
  const indicador = () => ({ current: vazio, previous: vazio, variationPercent: null, withoutValue: [] });
  return {
    generatedAt: "2026-09-15T15:00:00.000Z",
    today: "2026-09-15",
    period: {
      preset: "mes-atual",
      current: { from: "2026-09-01", to: "2026-09-15" },
      previous: { from: "2026-08-01", to: "2026-08-15" },
    },
    result: {
      billed: indicador(),
      confirmedOrders: indicador(),
      contractedPurchases: indicador(),
      billedCustomers: { current: 0, previous: 0, variationPercent: null },
    },
    position: { toShip: { ...vazio, withoutValue: [] }, toBill: { ...vazio, withoutValue: [] } },
    trend: { granularity: "day", buckets: [{ from: "2026-09-01", to: "2026-09-01", ...vazio }] },
    rankings: {
      customers: { rows: [], excluded: [], excludedTotal: 0 },
      products: { rows: [], excluded: [], excludedTotal: 0 },
    },
    commitments: {
      window: { from: "2026-09-15", to: "2026-10-14" },
      scheduledDeliveries: { ...vazio, items: [] },
      lateDeliveries: { count: 0, items: [] },
      expectedPurchases: { count: 0, items: [] },
    },
  };
}

let local = { pathname: "", search: "" };

function Sonda() {
  const location = useLocation();
  local = { pathname: location.pathname, search: location.search };
  return null;
}

function abrir(url = "/gestao/painel-gerencial") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/gestao/painel-gerencial"
          element={
            <>
              <ManagementDashboardPage />
              <Sonda />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const consultas = () => vi.mocked(getManagementDashboard).mock.calls.map(([parametros]) => parametros);
const cartao = (nome: string) => screen.getByRole("article", { name: nome });
const pode = (papel: UserRole) => MANAGEMENT_DASHBOARD_ROLES.includes(papel);

beforeEach(() => {
  auth.papel = "ADMIN";
  local = { pathname: "", search: "" };
  vi.mocked(getManagementDashboard).mockReset();
  vi.mocked(getManagementDashboard).mockResolvedValue(painelVazio());
});

describe("rota, menu e perfil", () => {
  it("Gestão → Painel Gerencial, só para ADMIN e COMMERCIAL; o Painel Operacional segue no topo", () => {
    const item = navItems.find((candidato) => candidato.id === "management-dashboard");
    expect(item).toMatchObject({ label: "Painel Gerencial", path: "/gestao/painel-gerencial", implemented: true });
    for (const papel of USER_ROLES) {
      const gestao = visibleNavGroups(papel).find((grupo) => grupo.id === "management");
      const nomes = gestao?.items.map((entrada) => entrada.label) ?? [];
      expect(nomes.includes("Painel Gerencial"), papel).toBe(pode(papel));
      expect(canSeeNavItem(item!, papel), papel).toBe(pode(papel));
    }
    expect(navItems[0]).toMatchObject({ id: "dashboard", label: "Painel", path: "/" });
    expect(navItems[0]?.roles).toBeUndefined();
  });

  it("a rota está declarada no app", () => {
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(app).toContain('<Route path="/gestao/painel-gerencial" element={<ManagementDashboardPage />} />');
  });

  it.each(USER_ROLES)("%s: só o perfil permitido consulta; os demais leem a recusa sem pedir nada", async (papel) => {
    auth.papel = papel;
    abrir();
    if (pode(papel)) {
      await waitFor(() => expect(getManagementDashboard, papel).toHaveBeenCalledTimes(1));
      expect(screen.queryByText("Seu perfil não permite ver o Painel Gerencial."), papel).toBeNull();
      return;
    }
    expect(await screen.findByText("Seu perfil não permite ver o Painel Gerencial."), papel).toBeInTheDocument();
    expect(getManagementDashboard, papel).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Mês atual" }), papel).toBeNull();
  });
});

describe("carregando, erro e vazio", () => {
  it("carregando: a frase, e nenhum cartão", async () => {
    vi.mocked(getManagementDashboard).mockReturnValue(new Promise(() => {}));
    abrir();
    expect(await screen.findByRole("status")).toHaveTextContent("Carregando…");
    expect(screen.queryByRole("article", { name: "Faturado" })).toBeNull();
  });

  it("erro: a frase da falha e Tentar novamente, que consulta de novo", async () => {
    vi.mocked(getManagementDashboard)
      .mockRejectedValueOnce(new Error("Falha de rede."))
      .mockResolvedValueOnce(painelVazio());
    abrir();
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Falha de rede.");
    fireEvent.click(within(alerta).getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("article", { name: "Faturado" })).toBeInTheDocument();
    expect(getManagementDashboard).toHaveBeenCalledTimes(2);
  });

  it("base vazia: travessão e a frase de cada bloco — nunca R$ 0,00, nunca 'Valores incompletos'", async () => {
    const { container } = abrir();
    const faturado = await screen.findByRole("article", { name: "Faturado" });

    expect(within(faturado).getByText("—")).toBeInTheDocument();
    expect(faturado).toHaveTextContent("Sem faturamentos no período.");
    expect(faturado).toHaveTextContent("Anterior: sem registros · Sem base de comparação");
    expect(cartao("Pedidos confirmados")).toHaveTextContent("Nenhum pedido confirmado no período.");
    expect(cartao("Compras contratadas")).toHaveTextContent("Nenhuma ordem de compra contratada no período.");
    expect(cartao("Clientes faturados")).toHaveTextContent("Nenhum cliente com faturamento emitido no período.");
    expect(cartao("A expedir")).toHaveTextContent("Nenhum pedido com saldo a expedir.");
    expect(cartao("A faturar")).toHaveTextContent("Nenhuma expedição aguardando faturamento.");

    expect(container.textContent).not.toMatch(/R\$\s?0,00/);
    expect(container.textContent).not.toContain("Valores incompletos");
    expect(container.textContent).not.toContain("0 de 0");
    // Sem documento: nada de link para lista vazia, nada de proporção desenhada.
    expect(screen.queryByRole("link", { name: "Ver faturamentos" })).toBeNull();
    expect(screen.queryByRole("img", { name: /Composição da carteira/ })).toBeNull();

    expect(screen.getByText("Nenhum cliente faturado no período.")).toBeInTheDocument();
    expect(screen.getByText("Nenhum produto faturado no período.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma entrega programada na janela.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma entrega atrasada.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma compra prevista na janela.")).toBeInTheDocument();
    expect(
      screen.getByText(/Esta tela não mostra contas a receber, contas a pagar, caixa, impostos, margem nem CMV/),
    ).toBeInTheDocument();
  });
});

describe("resultado do período", () => {
  it("valores completos: o total, quantos documentos o formam, o anterior e a variação", async () => {
    const dto = painelVazio();
    dto.result.billed = {
      current: { count: 32, withValue: 32, amount: "120450.00" },
      previous: { count: 30, withValue: 30, amount: "111300.00" },
      variationPercent: "8.2",
      withoutValue: [],
    };
    dto.result.confirmedOrders = {
      current: { count: 14, withValue: 14, amount: "98300.00" },
      previous: { count: 12, withValue: 12, amount: "100000.00" },
      variationPercent: "-1.7",
      withoutValue: [],
    };
    dto.result.contractedPurchases = {
      current: { count: 1, withValue: 1, amount: "12800.00" },
      previous: vazio,
      variationPercent: null,
      withoutValue: [],
    };
    dto.result.billedCustomers = { current: 9, previous: 6, variationPercent: "50.0" };
    vi.mocked(getManagementDashboard).mockResolvedValue(dto);
    abrir();

    const faturado = await screen.findByRole("article", { name: "Faturado" });
    expect(faturado).toHaveTextContent("120.450,00");
    expect(faturado).toHaveTextContent("32 documentos, todos com valor.");
    expect(faturado).toHaveTextContent("Anterior: R$ 111.300,00 · +8,2%");
    expect(within(faturado).getByRole("link", { name: "Ver faturamentos" })).toHaveAttribute(
      "href",
      "/comercial/faturamento?status=ISSUED&period=custom&dateFrom=2026-09-01&dateTo=2026-09-15",
    );

    const pedidos = cartao("Pedidos confirmados");
    expect(pedidos).toHaveTextContent("98.300,00");
    expect(pedidos).toHaveTextContent("14 pedidos, todos com preço acordado.");
    expect(pedidos).toHaveTextContent("−1,7%");
    // A lista de Pedidos não filtra pela data de confirmação: nenhum link que não filtre.
    expect(within(pedidos).queryByRole("link")).toBeNull();

    const compras = cartao("Compras contratadas");
    expect(compras).toHaveTextContent("1 OC, com preço.");
    expect(compras).toHaveTextContent("Anterior: sem registros · Sem base de comparação");
    expect(within(compras).getByRole("link", { name: "Ver ordens de compra" })).toHaveAttribute(
      "href",
      "/compras/ordens?status=contratadas&period=custom&dateFrom=2026-09-01&dateTo=2026-09-15",
    );

    const clientes = cartao("Clientes faturados");
    expect(within(clientes).getByText("9")).toBeInTheDocument();
    expect(clientes).toHaveTextContent("Anterior: 6 · +50,0%");

    expect(screen.getByText("01/09/2026 a 15/09/2026 · comparado com 01/08/2026 a 15/08/2026")).toBeInTheDocument();
  });

  it("valores incompletos: sem soma que pareça total, N de M e os documentos que faltam", async () => {
    const dto = painelVazio();
    dto.result.billed = {
      current: { count: 3, withValue: 2, amount: null },
      previous: { count: 2, withValue: 2, amount: "500.00" },
      variationPercent: null,
      withoutValue: [{ id: "fat-9", code: "FAT-000009" }],
    };
    dto.result.confirmedOrders = {
      current: { count: 1, withValue: 0, amount: null },
      previous: vazio,
      variationPercent: null,
      withoutValue: [{ id: "ped-7", code: "PED-000007" }],
    };
    dto.result.contractedPurchases = {
      current: { count: 15, withValue: 3, amount: null },
      previous: vazio,
      variationPercent: null,
      withoutValue: Array.from({ length: 10 }, (_, indice) => ({ id: `oc-${indice}`, code: `OC-00000${indice}` })),
    };
    vi.mocked(getManagementDashboard).mockResolvedValue(dto);
    abrir();

    const faturado = await screen.findByRole("article", { name: "Faturado" });
    expect(within(faturado).getByText("Valores incompletos")).toHaveClass("mgmt-card__value--incomplete");
    expect(faturado).toHaveTextContent("2 de 3 documentos com valor.");
    expect(faturado).toHaveTextContent("Sem base de comparação");
    // O único valor em reais no cartão é o do período anterior.
    expect(faturado.textContent?.match(/R\$/g)).toHaveLength(1);
    expect(within(faturado).getByText("Faturamentos sem valor (1)")).toBeInTheDocument();
    expect(within(faturado).getByRole("link", { name: "FAT-000009", hidden: true })).toHaveAttribute(
      "href",
      "/comercial/faturamento/fat-9",
    );

    const pedidos = cartao("Pedidos confirmados");
    expect(pedidos).toHaveTextContent("0 de 1 pedido com preço acordado.");
    expect(within(pedidos).getByRole("link", { name: "PED-000007", hidden: true })).toHaveAttribute(
      "href",
      "/comercial/pedidos/ped-7",
    );

    const compras = cartao("Compras contratadas");
    expect(compras).toHaveTextContent("3 de 15 OCs com preço.");
    expect(within(compras).getByText("OCs sem preço completo (12)")).toBeInTheDocument();
    expect(within(compras).getAllByRole("link", { hidden: true }).filter((link) => link.textContent?.startsWith("OC-"))).toHaveLength(10);
    expect(compras).toHaveTextContent("e mais 2.");
  });
});

describe("período", () => {
  it("abre em Mês atual; cada atalho consulta pelo nome e fica na URL", async () => {
    abrir();
    await waitFor(() => expect(consultas()).toEqual([{ period: "mes-atual" }]));
    expect(screen.getByRole("button", { name: "Mês atual" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Acumulado no ano" }));
    await waitFor(() => expect(consultas().at(-1)).toEqual({ period: "acumulado-ano" }));
    expect(local.search).toBe("?period=acumulado-ano");
    expect(screen.getByRole("button", { name: "Acumulado no ano" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    await waitFor(() => expect(consultas().at(-1)).toEqual({ period: "mes-anterior" }));

    fireEvent.click(screen.getByRole("button", { name: "Mês atual" }));
    await waitFor(() => expect(consultas().at(-1)).toEqual({ period: "mes-atual" }));
    expect(local.search).toBe("");
  });

  it("Personalizado nasce com o período que estava na tela e consulta as duas datas", async () => {
    abrir();
    await screen.findByRole("article", { name: "Faturado" });

    fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));
    await waitFor(() =>
      expect(consultas().at(-1)).toEqual({ period: "custom", dateFrom: "2026-09-01", dateTo: "2026-09-15" }),
    );
    expect(screen.getByLabelText("Data inicial")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("Data final")).toHaveValue("2026-09-15");
    expect(new URLSearchParams(local.search).get("period")).toBe("custom");
  });

  it("data digitada só consulta quando a digitação para (300 ms)", async () => {
    vi.useFakeTimers();
    try {
      abrir("/gestao/painel-gerencial?period=custom&dateFrom=2026-09-01&dateTo=2026-09-15");
      expect(consultas()).toHaveLength(1);

      fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-09-30" } });
      await act(async () => {
        vi.advanceTimersByTime(299);
      });
      expect(consultas()).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(consultas()).toHaveLength(2);
      expect(consultas().at(-1)).toEqual({ period: "custom", dateFrom: "2026-09-01", dateTo: "2026-09-30" });
      expect(new URLSearchParams(local.search).get("dateTo")).toBe("2026-09-30");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Personalizado sem data final não consulta: a frase fica junto dos campos", async () => {
    abrir("/gestao/painel-gerencial?period=custom&dateFrom=2026-09-01");
    expect(await screen.findByRole("alert")).toHaveTextContent(MENSAGEM_PERIODO_SEM_FIM);
    expect(screen.getByLabelText("Data final")).toHaveAttribute("aria-invalid", "true");
    expect(getManagementDashboard).not.toHaveBeenCalled();
  });

  it("Personalizado invertido não consulta", async () => {
    abrir("/gestao/painel-gerencial?period=custom&dateFrom=2026-09-21&dateTo=2026-09-20");
    expect(await screen.findByRole("alert")).toHaveTextContent(MENSAGEM_DE_PERIODO_INVERTIDO);
    expect(getManagementDashboard).not.toHaveBeenCalled();
  });

  it("trocar de período não deixa o número do período anterior à vista enquanto carrega", async () => {
    const dto = painelVazio();
    dto.result.billed = {
      current: { count: 1, withValue: 1, amount: "777.00" },
      previous: vazio,
      variationPercent: null,
      withoutValue: [],
    };
    vi.mocked(getManagementDashboard).mockResolvedValueOnce(dto).mockReturnValueOnce(new Promise(() => {}));
    abrir();
    expect(await screen.findByText(/777,00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Carregando…");
    expect(screen.queryByText(/777,00/)).toBeNull();
  });
});

describe("posição atual", () => {
  it("A expedir e A faturar pelo preço acordado, com a composição quando os dois estão completos", async () => {
    const dto = painelVazio();
    dto.position = {
      toShip: { count: 6, withValue: 6, amount: "210000.00", withoutValue: [] },
      toBill: { count: 3, withValue: 3, amount: "18600.00", withoutValue: [] },
    };
    vi.mocked(getManagementDashboard).mockResolvedValue(dto);
    abrir();

    const aExpedir = await screen.findByRole("article", { name: "A expedir" });
    expect(aExpedir).toHaveTextContent("210.000,00");
    expect(aExpedir).toHaveTextContent("6 pedidos, todos com preço acordado.");
    expect(within(aExpedir).getByRole("link", { name: "Ver pedidos da carteira" })).toHaveAttribute(
      "href",
      "/comercial/pedidos?status=carteira",
    );
    const aFaturar = cartao("A faturar");
    expect(aFaturar).toHaveTextContent("3 expedições, todas com preço acordado.");
    expect(within(aFaturar).getByRole("link", { name: "Ver expedições a faturar" })).toHaveAttribute(
      "href",
      "/relatorios/faturamento/pendentes",
    );

    expect(
      screen.getByRole("img", { name: "Composição da carteira: A expedir 91,9%, A faturar 8,1%" }),
    ).toBeInTheDocument();
    // Lado a lado, nunca um terceiro número: A expedir + A faturar não vira total.
    expect(screen.queryByText(/228\.600,00/)).toBeNull();
    expect(screen.getByText(/Não depende do período/)).toBeInTheDocument();
  });

  it("valor incompleto: nenhuma proporção desenhada, e os pedidos sem preço citados", async () => {
    const dto = painelVazio();
    dto.position = {
      toShip: {
        count: 6,
        withValue: 4,
        amount: null,
        withoutValue: [
          { id: "ped-1", code: "PED-000001" },
          { id: "ped-2", code: "PED-000002" },
        ],
      },
      toBill: { count: 3, withValue: 3, amount: "18600.00", withoutValue: [] },
    };
    vi.mocked(getManagementDashboard).mockResolvedValue(dto);
    abrir();

    expect(await screen.findByText(/Sem composição da carteira/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Composição da carteira/ })).toBeNull();
    const aExpedir = cartao("A expedir");
    expect(aExpedir).toHaveTextContent("Valores incompletos");
    expect(aExpedir).toHaveTextContent("4 de 6 pedidos com preço acordado.");
    expect(within(aExpedir).getByText("Pedidos sem preço acordado (2)")).toBeInTheDocument();
    expect(within(aExpedir).getByRole("link", { name: "PED-000002", hidden: true })).toHaveAttribute(
      "href",
      "/comercial/pedidos/ped-2",
    );
  });
});

describe("tendência", () => {
  it("cada barra com faturamento abre os faturamentos do intervalo; a incompleta não tem altura", async () => {
    const dto = painelVazio();
    dto.trend = {
      granularity: "day",
      buckets: [
        { from: "2026-09-01", to: "2026-09-01", count: 1, withValue: 1, amount: "300.00" },
        { from: "2026-09-02", to: "2026-09-02", count: 0, withValue: 0, amount: null },
        { from: "2026-09-03", to: "2026-09-03", count: 2, withValue: 1, amount: null },
        { from: "2026-09-04", to: "2026-09-04", count: 1, withValue: 1, amount: "150.00" },
      ],
    };
    vi.mocked(getManagementDashboard).mockResolvedValue(dto);
    abrir();

    const lista = await screen.findByRole("list", { name: "Faturado por dia" });
    const barras = within(lista).getAllByRole("listitem");
    expect(barras).toHaveLength(4);

    const cheia = within(barras[0]!).getByRole("link");
    expect(cheia).toHaveAttribute(
      "href",
      "/comercial/faturamento?status=ISSUED&period=custom&dateFrom=2026-09-01&dateTo=2026-09-01",
    );
    expect(cheia).toHaveTextContent("01/09/2026: R$ 300,00");
    expect(barras[0]!.querySelector<HTMLElement>(".mgmt-trend__bar")?.style.getPropertyValue("--altura")).toBe("100");
    expect(barras[3]!.querySelector<HTMLElement>(".mgmt-trend__bar")?.style.getPropertyValue("--altura")).toBe("50");

    expect(within(barras[1]!).queryByRole("link")).toBeNull();
    expect(barras[1]).toHaveTextContent("02/09/2026: sem faturamento");

    expect(barras[2]).toHaveTextContent("Incompleto");
    expect(barras[2]!.querySelector(".mgmt-trend__bar")).toBeNull();
    expect(within(barras[2]!).getByRole("link")).toHaveAttribute("href", expect.stringContaining("dateFrom=2026-09-03"));
    expect(screen.getByText(/“Incompleto”: há faturamento sem valor no intervalo/)).toBeInTheDocument();
  });
});

describe("rankings", () => {
  it("clientes por Faturado, com a Visão do Cliente, os faturamentos do período e quem ficou fora", async () => {
    const dto = painelVazio();
    dto.rankings.customers = {
      rows: [
        { customerId: "cli-1", code: "CLI-000012", name: "Cliente A", amount: "40100.00", billingCount: 5 },
        { customerId: "cli-2", code: "CLI-000007", name: "Cliente B", amount: "25300.00", billingCount: 1 },
      ],
      excluded: [{ customerId: "cli-9", code: "CLI-000044", name: "Cliente C", billingCount: 3, withoutValue: 1 }],
      excludedTotal: 1,
    };
    vi.mocked(getManagementDashboard).mockResolvedValue(dto);
    abrir();

    const secao = await screen.findByRole("region", { name: "Clientes — Faturado no período" });
    expect(within(secao).getByRole("link", { name: "CLI-000012 Cliente A" })).toHaveAttribute(
      "href",
      "/consultas/clientes/cli-1/faturamentos",
    );
    expect(within(secao).getByRole("link", { name: "5 documentos no período" })).toHaveAttribute(
      "href",
      "/comercial/faturamento?status=ISSUED&period=custom&dateFrom=2026-09-01&dateTo=2026-09-15&customerId=cli-1",
    );
    expect(within(secao).getByRole("link", { name: "1 documento no período" })).toBeInTheDocument();
    expect(secao).toHaveTextContent("40.100,00");
    expect(secao).toHaveTextContent("Fora do ranking — faturamento sem valor no período:");
    expect(within(secao).getByRole("link", { name: "CLI-000044 Cliente C" })).toHaveAttribute(
      "href",
      expect.stringContaining("customerId=cli-9"),
    );
    expect(secao).toHaveTextContent("1 de 3 documentos sem valor");
  });

  it("produtos pelo valor das linhas antes do desconto, com a quantidade de cada unidade — nunca somada", async () => {
    const dto = painelVazio();
    dto.rankings.products = {
      rows: [
        {
          productId: "prod-1",
          code: "PROD-000031",
          name: "Produto X",
          customerId: "cli-1",
          amount: "22000.00",
          quantities: [
            { unitCode: "kg", quantity: "300" },
            { unitCode: "un", quantity: "5000" },
          ],
        },
        {
          productId: "prod-2",
          code: "PROD-000018",
          name: "Produto Y",
          customerId: null,
          amount: "19500.00",
          quantities: [{ unitCode: "L", quantity: "12.5" }],
        },
      ],
      excluded: [{ productId: "prod-9", code: "PROD-000099", name: "Produto Z", customerId: "cli-3", linesWithoutPrice: 2 }],
      excludedTotal: 1,
    };
    vi.mocked(getManagementDashboard).mockResolvedValue(dto);
    const { container } = abrir();

    const secao = await screen.findByRole("region", { name: "Produtos — valor das linhas, antes do desconto" });
    expect(secao).toHaveTextContent("A soma deste ranking não é o Faturado");
    expect(within(secao).getByRole("link", { name: "PROD-000031 Produto X" })).toHaveAttribute(
      "href",
      "/consultas/clientes/cli-1/produtos/prod-1",
    );
    // Produto sem dono não tem Visão do Cliente para abrir: texto, sem link que chute.
    expect(within(secao).queryByRole("link", { name: "PROD-000018 Produto Y" })).toBeNull();
    expect(secao).toHaveTextContent("300 kg · 5.000 un");
    expect(secao).toHaveTextContent("12,5 L");
    expect(secao).not.toHaveTextContent("5.300");
    expect(secao).toHaveTextContent("PROD-000099 Produto Z · 2 linhas sem preço");
    // Ranking é lista legível, não tabela minúscula.
    expect(container.querySelector("table")).toBeNull();
  });
});

describe("próximos compromissos", () => {
  it("entregas abrem o Pedido, compras esperadas abrem a OC; compra sem valor previsto", async () => {
    const dto = painelVazio();
    dto.commitments = {
      window: { from: "2026-09-15", to: "2026-10-14" },
      scheduledDeliveries: {
        count: 12,
        withValue: 12,
        amount: "64000.00",
        items: [
          {
            deliveryId: "ent-1",
            customerOrderId: "ped-1",
            customerOrderCode: "PED-000001",
            sequence: 2,
            scheduledDate: "2026-09-20",
            customerName: "Cliente A",
          },
        ],
      },
      lateDeliveries: {
        count: 1,
        items: [
          {
            deliveryId: "ent-9",
            customerOrderId: "ped-9",
            customerOrderCode: "PED-000009",
            sequence: 1,
            scheduledDate: "2026-09-10",
            customerName: null,
          },
        ],
      },
      expectedPurchases: {
        count: 1,
        items: [{ purchaseOrderId: "oc-1", code: "OC-000001", supplierName: "Fornecedor A", expectedDeliveryDate: "2026-09-25" }],
      },
    };
    vi.mocked(getManagementDashboard).mockResolvedValue(dto);
    abrir();

    const programadas = await screen.findByRole("article", { name: "Entregas programadas" });
    expect(programadas).toHaveTextContent("64.000,00 acordado, antes do desconto do pedido.");
    expect(within(programadas).getByRole("link", { name: "PED-000001" })).toHaveAttribute("href", "/comercial/pedidos/ped-1");
    expect(programadas).toHaveTextContent("PED-000001 · Entrega 2 · 20/09/2026 · Cliente A");
    expect(programadas).toHaveTextContent("e mais 11.");

    const atrasadas = cartao("Entregas atrasadas");
    expect(atrasadas).toHaveTextContent("PED-000009 · Entrega 1 · 10/09/2026");
    expect(within(atrasadas).getByRole("link", { name: "PED-000009" })).toHaveAttribute("href", "/comercial/pedidos/ped-9");

    const compras = cartao("Compras esperadas");
    expect(within(compras).getByRole("link", { name: "OC-000001" })).toHaveAttribute("href", "/compras/ordens/oc-1");
    expect(compras).toHaveTextContent("OC-000001 · Fornecedor A · 25/09/2026");
    expect(compras).not.toHaveTextContent("R$");

    expect(screen.getByText(/Hoje e os 29 dias seguintes \(15\/09\/2026 a 14\/10\/2026\)/)).toBeInTheDocument();
  });

  it("entrega de Pedido sem preço acordado deixa o valor das programadas incompleto", async () => {
    const dto = painelVazio();
    dto.commitments.scheduledDeliveries = {
      count: 2,
      withValue: 1,
      amount: null,
      items: [
        {
          deliveryId: "ent-1",
          customerOrderId: "ped-1",
          customerOrderCode: "PED-000001",
          sequence: 1,
          scheduledDate: "2026-09-20",
          customerName: "Cliente A",
        },
        {
          deliveryId: "ent-2",
          customerOrderId: "ped-2",
          customerOrderCode: "PED-000002",
          sequence: 1,
          scheduledDate: "2026-09-22",
          customerName: "Cliente B",
        },
      ],
    };
    vi.mocked(getManagementDashboard).mockResolvedValue(dto);
    abrir();

    const programadas = await screen.findByRole("article", { name: "Entregas programadas" });
    expect(programadas).toHaveTextContent("Valores incompletos — 1 de 2 entregas com preço acordado.");
    expect(programadas.textContent).not.toMatch(/R\$/);
  });
});

describe("Como funciona", () => {
  it("abre a ajuda da própria tela, que diz o que ela não é", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /Como funciona/ }));
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo).toHaveTextContent("Painel Gerencial: valores comerciais, não financeiros");
    for (const trecho of [
      "contas a receber",
      "contas a pagar",
      "caixa",
      "impostos",
      "margem realizada",
      "CMV do período",
      "Faturado não significa recebido",
      "compras contratadas não significam pagas",
    ]) {
      expect(dialogo.textContent, trecho).toContain(trecho);
    }
  });

  it("a ajuda não usa a sigla em inglês nem chama o faturado de receita, lucro ou gasto", () => {
    const texto = JSON.stringify(helpTopics["painelGerencial.comoFunciona"]);
    expect(texto).not.toMatch(/YTD|receita|lucro|gasto/i);
  });
});

describe("390px", () => {
  const css = readFileSync(join(process.cwd(), "src", "pages", "management-dashboard", "management-dashboard.css"), "utf8");

  it("cartões, posição, compromissos e rankings empilham: nenhuma coluna pede mais largura do que a tela", () => {
    const grades = [...css.matchAll(/grid-template-columns:\s*([^;]+);/g)].map((achado) => achado[1]!.trim());
    const automaticas = grades.filter((grade) => grade.startsWith("repeat(auto-fit"));
    expect(automaticas.length).toBeGreaterThanOrEqual(2);
    for (const grade of automaticas) expect(grade, grade).toMatch(/^repeat\(auto-fit, minmax\(min\(100%, \d+px\), 1fr\)\)$/);
  });

  it("nenhuma largura mínima maior que 390px; a única rolagem horizontal é a das barras; o período quebra linha", () => {
    const larguras = [...css.matchAll(/min-width:\s*(\d+)px/g)].map((achado) => Number(achado[1]));
    expect(larguras.filter((largura) => largura > 390)).toEqual([]);
    const rolagens = [...css.matchAll(/([.\w-]+)\s*\{[^}]*overflow-x:\s*auto/g)].map((achado) => achado[1]);
    expect(rolagens).toEqual([".mgmt-trend"]);
    expect(css).toMatch(/\.mgmt-filter\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
