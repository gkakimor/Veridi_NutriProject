import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CustomerOrderStatus, ProjectStatus } from "@prisma/client";
import { hojeComercial } from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import { situacaoComercial, type FatosComerciais } from "./commercial-status.js";

/**
 * Situação comercial do Cliente — CUSTOMER-COMMERCIAL-STATUS-01, `PRODUCT_RULES.md` §86.
 *
 * A precedência, de cima para baixo: converteu alguma vez → Cliente ativo;
 * Projeto aguardando ou em amostra → Prospect; sem oportunidade aberta há até
 * 15 dias civis → Prospect; depois disso → Inativo. `Customer.active` não
 * entra na conta.
 *
 * A primeira metade prova a regra sem banco, com relógio fixo. A segunda
 * prova que o FILTRO da listagem — que decide no banco — concorda com ela, e
 * que a lista não consulta nada por Cliente.
 */

const DIA = 24 * 60 * 60 * 1000;

describe("derivação — a regra, com relógio fixo", () => {
  /** 20/09/2026 ao meio-dia de São Paulo. */
  const AGORA = new Date("2026-09-20T15:00:00.000Z");
  const haDias = (dias: number) => new Date(AGORA.getTime() - dias * DIA);

  const fatos = (overrides: Partial<FatosComerciais> = {}): FatosComerciais => ({
    createdAt: AGORA,
    projects: [],
    customerOrders: [],
    ...overrides,
  });
  const projeto = (
    overrides: Partial<FatosComerciais["projects"][number]> = {},
  ): FatosComerciais["projects"][number] => ({
    code: "PROJ-000001",
    status: "WAITING",
    createdAt: haDias(40),
    approvedAt: null,
    cancelledAt: null,
    statusHistory: [],
    ...overrides,
  });

  it("cliente novo é Prospect — e o motivo diz até quando", () => {
    const situacao = situacaoComercial(fatos(), AGORA);
    expect(situacao.status).toBe("PROSPECT");
    expect(situacao.reason).toBe(
      "Cliente cadastrado em 20/09/2026 · sem oportunidade aberta, Prospect até 05/10/2026",
    );
    expect(situacao.customerSince).toBeNull();
  });

  it("15 dias civis completos sem atividade: Inativo — o 15º dia ainda é Prospect", () => {
    expect(situacaoComercial(fatos({ createdAt: haDias(15) }), AGORA).status).toBe("PROSPECT");
    const inativo = situacaoComercial(fatos({ createdAt: haDias(16) }), AGORA);
    expect(inativo.status).toBe("INACTIVE");
    expect(inativo.reason).toMatch(/^Sem atividade comercial há mais de 15 dias · Cliente cadastrado em/);
  });

  it("a janela conta o DIA CIVIL da Veridi, não o dia UTC", () => {
    // 04/09 às 23:30 em São Paulo já é 05/09 em UTC. Pelo dia da Veridi o
    // último dia de Prospect foi 19/09; pelo dia UTC seria 20/09.
    const situacao = situacaoComercial(
      fatos({ createdAt: new Date("2026-09-05T02:30:00.000Z") }),
      AGORA,
    );
    expect(situacao.status).toBe("INACTIVE");
  });

  it("Projeto aguardando ou em amostra mantém Prospect, mesmo com cadastro antigo", () => {
    for (const status of ["WAITING", "SAMPLE"] as const) {
      const situacao = situacaoComercial(
        fatos({ createdAt: haDias(90), projects: [projeto({ status })] }),
        AGORA,
      );
      expect(situacao.status, status).toBe("PROSPECT");
      expect(situacao.reason).toBe("Projeto PROJ-000001 em andamento");
    }
    const dois = situacaoComercial(
      fatos({ projects: [projeto(), projeto({ code: "PROJ-000002", status: "SAMPLE" })] }),
      AGORA,
    );
    expect(dois.reason).toBe("2 projetos em andamento");
  });

  it("STAND_BY não é oportunidade aberta: a janela começa na entrada nele", () => {
    const emStandBy = (dias: number) =>
      fatos({
        createdAt: haDias(60),
        projects: [
          projeto({
            status: "STAND_BY",
            createdAt: haDias(60),
            statusHistory: [
              { toStatus: "WAITING", changedAt: haDias(60) },
              { toStatus: "STAND_BY", changedAt: haDias(dias) },
            ],
          }),
        ],
      });
    const recente = situacaoComercial(emStandBy(5), AGORA);
    expect(recente.status).toBe("PROSPECT");
    expect(recente.reason).toMatch(/^Projeto PROJ-000001 em stand-by desde 15\/09\/2026/);
    expect(situacaoComercial(emStandBy(20), AGORA).status).toBe("INACTIVE");
  });

  it("sair do STAND_BY para WAITING volta a Prospect na hora", () => {
    const situacao = situacaoComercial(
      fatos({
        createdAt: haDias(90),
        projects: [
          projeto({
            status: "WAITING",
            statusHistory: [
              { toStatus: "STAND_BY", changedAt: haDias(60) },
              { toStatus: "WAITING", changedAt: haDias(1) },
            ],
          }),
        ],
      }),
      AGORA,
    );
    expect(situacao.status).toBe("PROSPECT");
    expect(situacao.reason).toBe("Projeto PROJ-000001 em andamento");
  });

  it("cancelamento de Projeto abre a janela", () => {
    const cancelado = (dias: number) =>
      fatos({
        createdAt: haDias(90),
        projects: [
          projeto({
            status: "CANCELLED",
            createdAt: haDias(90),
            cancelledAt: haDias(dias),
            statusHistory: [{ toStatus: "CANCELLED", changedAt: haDias(dias) }],
          }),
        ],
      });
    const recente = situacaoComercial(cancelado(3), AGORA);
    expect(recente.status).toBe("PROSPECT");
    expect(recente.reason).toMatch(/^Projeto PROJ-000001 cancelado em 17\/09\/2026/);
    expect(situacaoComercial(cancelado(30), AGORA).status).toBe("INACTIVE");
  });

  it("Projeto aprovado converte para sempre — nem a falta de atividade nem o cancelamento depois desfazem", () => {
    const aprovado = situacaoComercial(
      fatos({ createdAt: haDias(900), projects: [projeto({ status: "APPROVED", approvedAt: haDias(400) })] }),
      AGORA,
    );
    expect(aprovado.status).toBe("ACTIVE");
    expect(aprovado.reason).toBe("Projeto aprovado (PROJ-000001)");
    expect(aprovado.customerSince).toBe("2025-08-16");

    const depoisCancelado = situacaoComercial(
      fatos({
        projects: [
          projeto({ status: "CANCELLED", approvedAt: haDias(400), cancelledAt: haDias(300) }),
        ],
      }),
      AGORA,
    );
    expect(depoisCancelado.status).toBe("ACTIVE");
  });

  it("Pedido confirmado direto converte, sem Projeto nenhum", () => {
    const situacao = situacaoComercial(
      fatos({ createdAt: haDias(50), customerOrders: [{ code: "PED-000007", confirmedAt: haDias(40) }] }),
      AGORA,
    );
    expect(situacao.status).toBe("ACTIVE");
    expect(situacao.reason).toBe("Pedido confirmado (PED-000007)");
    expect(situacao.customerSince).toBe("2026-08-11");
  });

  it("Cliente desde é a conversão MAIS ANTIGA — nunca a do último Pedido", () => {
    const situacao = situacaoComercial(
      fatos({
        projects: [projeto({ status: "APPROVED", approvedAt: haDias(10) })],
        customerOrders: [
          { code: "PED-000009", confirmedAt: haDias(2) },
          { code: "PED-000003", confirmedAt: haDias(200) },
        ],
      }),
      AGORA,
    );
    expect(situacao.customerSince).toBe("2026-03-04");
    expect(situacao.reason).toBe("Pedido confirmado (PED-000003)");
  });
});

type App = ReturnType<typeof buildTestApp>;

describe("listagem, filtro e Consulta — com banco", () => {
  const tag = `CCS${Date.now()}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const criados = { customers: [] as string[], projects: [] as string[], orders: [] as string[] };
  const haDias = (dias: number) => new Date(Date.now() - dias * DIA);
  const esperado: Record<string, "ACTIVE" | "PROSPECT" | "INACTIVE"> = {};
  const clientes: Record<string, string> = {};
  let desdeDoK = "";
  let desdeDoF = "";
  let app: App;

  async function cliente(
    sufixo: string,
    situacao: "ACTIVE" | "PROSPECT" | "INACTIVE",
    extras: { createdAt?: Date; active?: boolean } = {},
  ) {
    const criado = await getPrisma().customer.create({
      data: {
        code: `CLI-${tag}-${sufixo}`,
        legalName: `Cliente ${tag} ${sufixo}`,
        active: extras.active ?? true,
        createdAt: extras.createdAt ?? new Date(),
      },
    });
    criados.customers.push(criado.id);
    clientes[sufixo] = criado.id;
    esperado[sufixo] = situacao;
    return criado.id;
  }

  async function projeto(
    customerId: string,
    sufixo: string,
    dados: {
      status: ProjectStatus;
      createdAt: Date;
      approvedAt?: Date;
      cancelledAt?: Date;
      historico: { toStatus: ProjectStatus; changedAt: Date }[];
    },
  ) {
    const criado = await getPrisma().project.create({
      data: {
        code: `PROJ-${tag}-${sufixo}`,
        customerId,
        name: `Projeto ${tag} ${sufixo}`,
        entryDate: dados.createdAt,
        status: dados.status,
        createdAt: dados.createdAt,
        approvedAt: dados.approvedAt ?? null,
        cancelledAt: dados.cancelledAt ?? null,
        statusHistory: { create: dados.historico },
      },
    });
    criados.projects.push(criado.id);
    return criado;
  }

  async function pedido(
    customerId: string,
    sufixo: string,
    dados: { status: CustomerOrderStatus; confirmedAt?: Date },
  ) {
    const criado = await getPrisma().customerOrder.create({
      data: {
        code: `PED-${tag}-${sufixo}`,
        customerId,
        status: dados.status,
        confirmedAt: dados.confirmedAt ?? null,
      },
    });
    criados.orders.push(criado.id);
    return criado;
  }

  beforeAll(async () => {
    app = buildTestApp("ADMIN");
    await app.ready();

    await cliente("A", "PROSPECT");
    await cliente("B", "INACTIVE", { createdAt: haDias(30) });

    const c = await cliente("C", "PROSPECT", { createdAt: haDias(30) });
    await projeto(c, "C", {
      status: "WAITING",
      createdAt: haDias(30),
      historico: [{ toStatus: "WAITING", changedAt: haDias(30) }],
    });

    const d = await cliente("D", "INACTIVE", { createdAt: haDias(60) });
    await projeto(d, "D", {
      status: "STAND_BY",
      createdAt: haDias(60),
      historico: [
        { toStatus: "WAITING", changedAt: haDias(60) },
        { toStatus: "STAND_BY", changedAt: haDias(20) },
      ],
    });

    const e = await cliente("E", "PROSPECT", { createdAt: haDias(60) });
    await projeto(e, "E", {
      status: "STAND_BY",
      createdAt: haDias(60),
      historico: [
        { toStatus: "WAITING", changedAt: haDias(60) },
        { toStatus: "STAND_BY", changedAt: haDias(5) },
      ],
    });

    // Cadastro INATIVO e Cliente ativo ao mesmo tempo: perguntas diferentes.
    const f = await cliente("F", "ACTIVE", { createdAt: haDias(300), active: false });
    const aprovadoF = await projeto(f, "F", {
      status: "APPROVED",
      createdAt: haDias(300),
      approvedAt: haDias(250),
      historico: [
        { toStatus: "WAITING", changedAt: haDias(300) },
        { toStatus: "APPROVED", changedAt: haDias(250) },
      ],
    });
    desdeDoF = hojeComercial(aprovadoF.approvedAt!);

    const g = await cliente("G", "ACTIVE", { createdAt: haDias(50) });
    await pedido(g, "G", { status: "CONFIRMED", confirmedAt: haDias(40) });

    const h = await cliente("H", "ACTIVE", { createdAt: haDias(50) });
    await pedido(h, "H", { status: "CANCELLED", confirmedAt: haDias(40) });

    const i = await cliente("I", "INACTIVE", { createdAt: haDias(30) });
    await pedido(i, "I", { status: "DRAFT" });

    const j = await cliente("J", "INACTIVE", { createdAt: haDias(30) });
    await pedido(j, "J", { status: "CANCELLED" });

    const k = await cliente("K", "ACTIVE", { createdAt: haDias(400) });
    await projeto(k, "K", {
      status: "APPROVED",
      createdAt: haDias(20),
      approvedAt: haDias(10),
      historico: [
        { toStatus: "WAITING", changedAt: haDias(20) },
        { toStatus: "APPROVED", changedAt: haDias(10) },
      ],
    });
    const antigo = await pedido(k, "K", { status: "SHIPPED", confirmedAt: haDias(200) });
    desdeDoK = hojeComercial(antigo.confirmedAt!);

    await cliente("L", "PROSPECT", { active: false });
  });

  afterAll(async () => {
    await app.close();
    const prisma = getPrisma();
    await prisma.customerOrder.deleteMany({ where: { id: { in: criados.orders } } });
    // O histórico de status sai junto com o Projeto (onDelete: Cascade).
    await prisma.project.deleteMany({ where: { id: { in: criados.projects } } });
    await prisma.customer.deleteMany({ where: { id: { in: criados.customers } } });
  });

  async function listar(filtros: Record<string, string> = {}) {
    const query = new URLSearchParams({ search: tag, pageSize: "100", ...filtros });
    const resposta = await app.inject({ method: "GET", url: `/customers?${query.toString()}` });
    expect(resposta.statusCode, resposta.body).toBe(200);
    return resposta.json() as {
      customers: { legalName: string; active: boolean; commercial: { status: string; reason: string; customerSince: string | null } }[];
      total: number;
    };
  }
  const sufixo = (legalName: string) => legalName.split(" ").at(-1)!;

  it("a listagem devolve a situação de cada Cliente, derivada dos fatos", async () => {
    const { customers } = await listar();
    const situacoes = Object.fromEntries(customers.map((c) => [sufixo(c.legalName), c.commercial.status]));
    expect(situacoes).toEqual(esperado);
  });

  it("cada filtro devolve só a sua situação, e a contagem bate com a derivação", async () => {
    for (const status of ["ACTIVE", "PROSPECT", "INACTIVE"] as const) {
      const resultado = await listar({ commercialStatus: status });
      const esperados = Object.keys(esperado)
        .filter((chave) => esperado[chave] === status)
        .sort();
      expect(resultado.customers.map((c) => sufixo(c.legalName)).sort(), status).toEqual(esperados);
      expect(resultado.total).toBe(esperados.length);
      expect(resultado.customers.every((c) => c.commercial.status === status)).toBe(true);
    }
    // Sem filtro: todos — os seletores de Cliente das outras telas não perdem ninguém.
    expect((await listar()).total).toBe(Object.keys(esperado).length);
    const invalido = await app.inject({ method: "GET", url: "/customers?commercialStatus=OUTRO" });
    expect(invalido.statusCode).toBe(400);
  });

  it("Customer.active não decide nada: cadastro inativo pode ser Cliente ativo", async () => {
    const { customers } = await listar({ active: "false" });
    const porSufixo = Object.fromEntries(customers.map((c) => [sufixo(c.legalName), c]));
    expect(porSufixo.F!.commercial.status).toBe("ACTIVE");
    expect(porSufixo.F!.active).toBe(false);
    expect(porSufixo.L!.commercial.status).toBe("PROSPECT");
    const ativosComCadastroInativo = await listar({ active: "false", commercialStatus: "ACTIVE" });
    expect(ativosComCadastroInativo.customers.map((c) => sufixo(c.legalName))).toEqual(["F"]);
  });

  it("Pedido confirmado e depois cancelado continua provando conversão; rascunho e cancelado antes, não", async () => {
    const { customers } = await listar();
    const porSufixo = Object.fromEntries(customers.map((c) => [sufixo(c.legalName), c.commercial]));
    expect(porSufixo.H).toMatchObject({ status: "ACTIVE", reason: `Pedido confirmado (PED-${tag}-H)` });
    expect(porSufixo.I!.status).toBe("INACTIVE");
    expect(porSufixo.J!.status).toBe("INACTIVE");
    expect(porSufixo.K!.customerSince).toBe(desdeDoK);
  });

  it("zero N+1: a listagem não consulta Projeto, Pedido nem histórico por Cliente", async () => {
    const prisma = getPrisma() as unknown as Record<string, unknown>;
    const chamadas: string[] = [];
    const modelos = ["project", "customerOrder", "projectStatusHistory"];
    const originais = new Map<string, unknown>();
    for (const modelo of modelos) {
      const delegado = prisma[modelo] as object;
      originais.set(modelo, delegado);
      Object.defineProperty(prisma, modelo, {
        configurable: true,
        writable: true,
        value: new Proxy(delegado, {
          get(alvo, metodo) {
            const valor = Reflect.get(alvo, metodo) as unknown;
            if (typeof valor !== "function") return valor;
            return (...args: unknown[]) => {
              chamadas.push(`${modelo}.${String(metodo)}`);
              return (valor as (...a: unknown[]) => unknown).apply(alvo, args);
            };
          },
        }),
      });
    }
    try {
      const { customers } = await listar();
      expect(customers).toHaveLength(Object.keys(esperado).length);
      expect(customers.every((c) => c.commercial !== undefined)).toBe(true);
    } finally {
      /*
       * Devolve o MESMO delegado que estava lá. Apagar a sobreposição não basta
       * para delegado de modelo: o proxy do cliente Prisma deixava a
       * propriedade indefinida para o resto do arquivo.
       */
      for (const modelo of modelos) {
        Object.defineProperty(prisma, modelo, {
          configurable: true,
          writable: true,
          value: originais.get(modelo),
        });
      }
    }
    expect(chamadas).toEqual([]);
  });

  it("a Consulta devolve situação, motivo, cliente desde e o resumo de Projetos", async () => {
    const resumoF = (
      await app.inject({ method: "GET", url: `/customers/${clientes.F}/consultation/summary` })
    ).json();
    expect(resumoF.commercial).toEqual({
      status: "ACTIVE",
      reason: `Projeto aprovado (PROJ-${tag}-F)`,
      customerSince: desdeDoF,
    });
    expect(resumoF.projectSummary).toEqual({ open: 0, standBy: 0, approved: 1, cancelled: 0 });

    const resumoD = (
      await app.inject({ method: "GET", url: `/customers/${clientes.D}/consultation/summary` })
    ).json();
    expect(resumoD.commercial.status).toBe("INACTIVE");
    expect(resumoD.commercial.reason).toMatch(new RegExp(`Projeto PROJ-${tag}-D em stand-by desde`));
    expect(resumoD.projectSummary).toEqual({ open: 0, standBy: 1, approved: 0, cancelled: 0 });
  });
});
