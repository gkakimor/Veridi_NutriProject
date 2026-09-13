import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { hojeComercial } from "@veridi/shared";
import type { DashboardDTO } from "@veridi/shared";

/**
 * Dashboard — o período é o dia da Veridi, em qualquer fuso de quem abre a
 * tela (DASHBOARD-BUSINESS-DATE-01).
 *
 * O "Personalizado" nascia com o dia do NAVEGADOR (`dateInputValueOffset`): às
 * 01:30 UTC — 22:30 de 12/09 em São Paulo — um navegador em UTC já abria os
 * campos terminando em 13/09. A faixa "No período" lia o instante devolvido no
 * fuso do navegador: o mesmo 12/09 aparecia "12/09 até 13/09" em UTC e "11/09
 * até 12/09" em UTC-07. E o período viajava como instantes ISO montados na
 * tela.
 *
 * Agora ele vai como dois DIAS (`YYYY-MM-DD`), o contrato das listas e dos
 * Relatórios, e quem abre o dia comercial é o servidor — as bordas estão em
 * `api modules/dashboard/dashboard-dia-comercial.test.ts`. Aqui: presets e
 * personalizado mandam o MESMO par de dias em UTC, UTC-07 e São Paulo, inclusive
 * às 01:30 UTC; mesmo dia e intervalo sem off-by-one; campo limpo não derruba a
 * tela; a faixa mostra o dia comercial; e nenhum código do Dashboard volta a
 * montar período com o relógio do navegador.
 */

vi.mock("../lib/dashboard-api", () => ({ getDashboard: vi.fn() }));
vi.mock("../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Admin", role: "ADMIN" } }),
}));

import { getDashboard } from "../lib/dashboard-api";
import { DashboardPage } from "./DashboardPage";

/** Os três navegadores do handoff, com o deslocamento que cada um tem em 12/09. */
const FUSOS = [
  { nome: "UTC", fuso: "UTC", deslocamentoEmMinutos: 0 },
  { nome: "UTC-07", fuso: "Etc/GMT+7", deslocamentoEmMinutos: 420 },
  { nome: "São Paulo", fuso: "America/Sao_Paulo", deslocamentoEmMinutos: 180 },
];

/** 22:30 de 12/09 em São Paulo — em UTC já é dia 13. */
const VIRADA_UTC = new Date("2026-09-13T01:30:00.000Z");

/** O que o servidor devolve para 12/09 → 12/09: o dia comercial, fim inclusivo. */
const DASHBOARD = {
  period: {
    from: "2026-09-12T03:00:00.000Z",
    to: "2026-09-13T02:59:59.999Z",
    customerOrdersCreated: 0,
    receiptsCompleted: 0,
    productionOrdersCompleted: 0,
    shipmentsConfirmed: 0,
    billingsIssued: 0,
    billedAmount: null,
    billingsWithCompletePricing: 0,
  },
  currentState: {
    commercial: {
      confirmedOrders: 0,
      inFulfillmentOrders: 0,
      partiallyShippedOrders: 0,
      ordersAwaitingShipment: 0,
      shipmentsAwaitingBilling: 0,
    },
    production: {
      draft: 0,
      planned: 0,
      released: 0,
      inProduction: 0,
      withShortage: 0,
      completedWithIncompleteCost: 0,
      withoutRoute: 0,
    },
    purchasing: { openOrders: 0, partiallyReceived: 0, lateOrders: 0, itemsOnOrder: 0 },
    inventory: { lotsAwaitingQuality: 0, lotsBlocked: 0, lotsExpired: 0, lotsNearExpiry: 0 },
  },
  attention: [],
  attentionGroups: [],
  attentionTotal: 0,
  attentionLimit: 20,
  movementSummary: {
    receiptIn: 0,
    productionConsumption: 0,
    sampleConsumption: 0,
    finishedGoodProduction: 0,
    shipmentOut: 0,
    adjustments: 0,
    loss: 0,
  },
  recentMovements: [],
  movementActivity: [],
} as unknown as DashboardDTO;

/** Roda `corpo` com o navegador no fuso pedido — e confere que o fuso pegou. */
async function noFuso<T>(
  { fuso, deslocamentoEmMinutos }: (typeof FUSOS)[number],
  corpo: () => Promise<T> | T,
): Promise<T> {
  const original = process.env.TZ;
  process.env.TZ = fuso;
  try {
    // Sem isto o teste passaria sem nunca ter mudado de fuso.
    expect(new Date("2026-09-12T12:00:00.000Z").getTimezoneOffset()).toBe(deslocamentoEmMinutos);
    return await corpo();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

/** Os períodos que a tela pediu à API, na ordem. */
function periodosPedidos(): [string, string][] {
  return vi.mocked(getDashboard).mock.calls.map(([from, to]) => [from, to]);
}

function ultimoPeriodo(): [string, string] | undefined {
  return periodosPedidos().at(-1);
}

function abrir() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

function clicar(nome: string) {
  fireEvent.click(screen.getByRole("button", { name: nome }));
}

/** Abre o personalizado, escolhe os dois dias e devolve o período que chegou à API. */
async function escolher(de: string, ate: string): Promise<[string, string]> {
  clicar("Personalizado");
  fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: de } });
  fireEvent.change(screen.getByLabelText("Data final"), { target: { value: ate } });
  await waitFor(() => expect(ultimoPeriodo()).toEqual([de, ate]));
  return ultimoPeriodo()!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDashboard).mockResolvedValue(DASHBOARD);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(VIRADA_UTC);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("o bug: o dia do relógio do navegador", () => {
  it("às 01:30 UTC o dia local muda com o fuso; o comercial, não", async () => {
    const locais: string[] = [];
    const comerciais: string[] = [];
    for (const fuso of FUSOS) {
      await noFuso(fuso, () => {
        // Reprodução do que `dateInputValueOffset(0)` fazia — só aqui, nunca no Dashboard.
        const agora = new Date();
        const mes = `${agora.getMonth() + 1}`.padStart(2, "0");
        const dia = `${agora.getDate()}`.padStart(2, "0");
        locais.push(`${agora.getFullYear()}-${mes}-${dia}`);
        comerciais.push(hojeComercial());
      });
    }
    expect(locais).toEqual(["2026-09-13", "2026-09-12", "2026-09-12"]);
    expect(comerciais).toEqual(["2026-09-12", "2026-09-12", "2026-09-12"]);
  });
});

describe("períodos prontos no dia comercial", () => {
  it("Hoje, 7 dias, 30 dias e de volta a Hoje: os mesmos dias nos três fusos, às 01:30 UTC", async () => {
    const medidos: string[] = [];
    for (const fuso of FUSOS) {
      medidos.push(
        await noFuso(fuso, async () => {
          vi.mocked(getDashboard).mockClear();
          const { unmount } = abrir();
          await waitFor(() => expect(periodosPedidos()).toHaveLength(1));
          clicar("7 dias");
          await waitFor(() => expect(periodosPedidos()).toHaveLength(2));
          clicar("30 dias");
          await waitFor(() => expect(periodosPedidos()).toHaveLength(3));
          clicar("Hoje");
          await waitFor(() => expect(periodosPedidos()).toHaveLength(4));
          const pedidos = JSON.stringify(periodosPedidos());
          unmount();
          return pedidos;
        }),
      );
    }
    expect(new Set(medidos).size).toBe(1);
    expect(JSON.parse(medidos[0]!)).toEqual([
      ["2026-09-12", "2026-09-12"],
      ["2026-09-06", "2026-09-12"],
      ["2026-08-14", "2026-09-12"],
      ["2026-09-12", "2026-09-12"],
    ]);
  });
});

describe("período personalizado", () => {
  it("abre os campos na janela do dia comercial — 06/09 a 12/09 às 01:30 UTC, nos três fusos", async () => {
    for (const fuso of FUSOS) {
      await noFuso(fuso, async () => {
        vi.mocked(getDashboard).mockClear();
        const { unmount } = abrir();
        clicar("Personalizado");
        expect(screen.getByLabelText("Data inicial")).toHaveValue("2026-09-06");
        expect(screen.getByLabelText("Data final")).toHaveValue("2026-09-12");
        await waitFor(() => expect(ultimoPeriodo()).toEqual(["2026-09-06", "2026-09-12"]));
        unmount();
      });
    }
  });

  it("mesmo dia: 12/09 → 12/09 chega à API como from=2026-09-12 e to=2026-09-12 nos três fusos", async () => {
    const medidos: string[] = [];
    for (const fuso of FUSOS) {
      medidos.push(
        await noFuso(fuso, async () => {
          const { unmount } = abrir();
          const periodo = await escolher("2026-09-12", "2026-09-12");
          unmount();
          return JSON.stringify(periodo);
        }),
      );
    }
    expect(medidos).toEqual(Array(3).fill(JSON.stringify(["2026-09-12", "2026-09-12"])));
  });

  it("intervalo: 11/09 → 12/09 chega com as duas pontas intactas nos três fusos", async () => {
    const medidos: string[] = [];
    for (const fuso of FUSOS) {
      medidos.push(
        await noFuso(fuso, async () => {
          const { unmount } = abrir();
          const periodo = await escolher("2026-09-11", "2026-09-12");
          unmount();
          return JSON.stringify(periodo);
        }),
      );
    }
    expect(medidos).toEqual(Array(3).fill(JSON.stringify(["2026-09-11", "2026-09-12"])));
  });

  it("campo limpo: a ponta vai vazia, sem conversão, e a tela continua de pé", async () => {
    abrir();
    clicar("Personalizado");
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "" } });
    await waitFor(() => expect(ultimoPeriodo()).toEqual(["", "2026-09-12"]));
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "" } });
    await waitFor(() => expect(ultimoPeriodo()).toEqual(["", ""]));
    expect(screen.getByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(await screen.findByText(/— contagem de documentos/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("faixa do período", () => {
  it("mostra o dia comercial que o servidor devolveu: 12/09 até 12/09 nos três fusos", async () => {
    for (const fuso of FUSOS) {
      await noFuso(fuso, async () => {
        const { unmount } = abrir();
        expect(await screen.findByText("12/09/2026 até 12/09/2026 — contagem de documentos")).toBeInTheDocument();
        unmount();
      });
    }
  });
});

describe("guarda estrutural", () => {
  /** Tira comentário: a explicação do bug pode citar o padrão; o código, não. */
  function semComentarios(fonte: string): string {
    return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("nenhum código do Dashboard monta período com a meia-noite, o ISO ou o dia do navegador", () => {
    const src = join(process.cwd(), "src");
    const arquivos = [
      join(src, "pages", "DashboardPage.tsx"),
      join(src, "lib", "period.ts"),
      join(src, "lib", "dashboard-api.ts"),
    ];
    for (const arquivo of arquivos) {
      const codigo = semComentarios(readFileSync(arquivo, "utf8"));
      // `new Date(`${dia}T00:00:00`)`, `new Date(dia + "T00:00")` e o fim inventado.
      expect(codigo, arquivo).not.toMatch(/T00:00/);
      expect(codigo, arquivo).not.toMatch(/T23:59/);
      expect(codigo, arquivo).not.toMatch(/new Date\(\s*`/);
      expect(codigo, arquivo).not.toMatch(/new Date\([^)]*\+\s*["'`]T/);
      // O dia vira instante no servidor; a tela não manda ISO.
      expect(codigo, arquivo).not.toMatch(/\.toISOString\(\)/);
      expect(codigo, arquivo).not.toMatch(/\blimites(DoDiaComercial|DeHojeComercial|DeDiasComerciais)\b/);
      // Dia do relógio de quem abriu a tela.
      expect(codigo, arquivo).not.toMatch(/\b(dateInputValueOffset|startOfDay|endOfDay)\b/);
      expect(codigo, arquivo).not.toMatch(/\.(getFullYear|getMonth|getDate|setDate|setHours)\(/);
    }
    // Os períodos prontos são os das listas — uma regra, não duas.
    expect(readFileSync(join(src, "lib", "period.ts"), "utf8")).toMatch(/\bresolveListPeriod\b/);
  });
});
