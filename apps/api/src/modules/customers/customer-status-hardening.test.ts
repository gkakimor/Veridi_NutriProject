import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { CUSTOMER_STATUS_CHANGE_ROLES, USER_ROLES } from "@veridi/shared";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Situação cadastral endurecida — CUSTOMER-STATUS-HARDENING-01, §95.
 *
 * Duas coisas fechadas aqui:
 *
 * 1. **Quem muda a situação.** Bloquear, desbloquear, inativar e reativar são
 *    de Comercial e Administrador; os demais perfis recebem 403 na API — não
 *    só um botão escondido — e continuam lendo situação, motivo e histórico.
 * 2. **O documento em andamento enxerga a situação ATUAL.** Projeto e Pedido
 *    trazem `customerStatus` do cadastro de agora, a cada leitura: o aviso da
 *    tela aparece depois do bloqueio e some depois da reativação, sem nada
 *    gravado no documento. Quem recusa o próximo passo continua sendo a
 *    guarda de venda, e nada é cancelado.
 */

const clientes: string[] = [];
const projetos: string[] = [];
const pedidos: string[] = [];
const produtos: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  if (pedidos.length > 0) {
    await prisma.customerOrder.deleteMany({ where: { id: { in: pedidos } } });
  }
  if (projetos.length > 0) {
    await prisma.quoteLine.deleteMany({ where: { quoteVersion: { projectId: { in: projetos } } } });
    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.projectProduct.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.projectStatusHistory.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.project.deleteMany({ where: { id: { in: projetos } } });
  }
  if (produtos.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: produtos } } });
    const itens = await prisma.product.findMany({
      where: { id: { in: produtos } },
      select: { finishedProductItemId: true },
    });
    await prisma.product.deleteMany({ where: { id: { in: produtos } } });
    const ids = itens
      .map((produto) => produto.finishedProductItemId)
      .filter((id): id is string => id !== null);
    if (ids.length > 0) await prisma.item.deleteMany({ where: { id: { in: ids } } });
  }
  if (clientes.length > 0) {
    // O histórico sai junto (cascade) — Cliente não tem exclusão física no app.
    await prisma.customer.deleteMany({ where: { id: { in: clientes } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarCliente(app: App) {
  const response = await app.inject({
    method: "POST",
    url: "/customers",
    payload: { legalName: `Cliente endurecimento ${marca()}` },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json() as { id: string; status: string };
  clientes.push(body.id);
  return body;
}

function acao(app: App, id: string, caminho: string, reason?: string) {
  return app.inject({
    method: "POST",
    url: `/customers/${id}/${caminho}`,
    ...(reason === undefined ? {} : { payload: { reason } }),
  });
}

async function ler(app: App, url: string) {
  const response = await app.inject({ method: "GET", url });
  expect(response.statusCode, `GET ${url}`).toBe(200);
  return response.json();
}

async function mudar(app: App, id: string, caminho: string, reason: string, situacao: string) {
  const response = await acao(app, id, caminho, reason);
  expect(response.statusCode, `${caminho}: ${response.body}`).toBe(200);
  expect(response.json().status, caminho).toBe(situacao);
}

const PODEM_MUDAR = ["ADMIN", "COMMERCIAL"] as const satisfies readonly UserRole[];
const SO_LEEM = USER_ROLES.filter((role) => !CUSTOMER_STATUS_CHANGE_ROLES.includes(role));

describe("CUSTOMER-STATUS-HARDENING-01 — quem muda a situação cadastral", () => {
  it("a lista é Comercial e Administrador, e só eles", () => {
    expect([...CUSTOMER_STATUS_CHANGE_ROLES].sort()).toEqual([...PODEM_MUDAR].sort());
    expect([...SO_LEEM].sort()).toEqual(["PRODUCTION", "PURCHASING", "QUALITY", "VIEWER"]);
  });

  it.each(PODEM_MUDAR)(
    "%s bloqueia, desbloqueia, inativa e reativa — com motivo, autor e histórico",
    async (role) => {
      const app = buildTestApp(role);
      await app.ready();
      const { user } = await createAuthenticatedUser(role);
      const cliente = await criarCliente(app);

      // O motivo continua obrigatório para quem pode.
      const semMotivo = await acao(app, cliente.id, "block");
      expect(semMotivo.statusCode, `${role}: sem motivo`).toBe(400);
      expect(semMotivo.json().error, role).toBe("validation_error");
      const soEspacos = await acao(app, cliente.id, "deactivate", "   ");
      expect(soEspacos.statusCode, `${role}: só espaços`).toBe(400);

      await mudar(app, cliente.id, "block", "Inadimplência desde março", "BLOCKED");
      await mudar(app, cliente.id, "unblock", "Dívida quitada", "ACTIVE");
      await mudar(app, cliente.id, "deactivate", "Encerrou as operações", "INACTIVE");
      await mudar(app, cliente.id, "activate", "Voltou a comprar", "ACTIVE");

      const eventos = await getPrisma().customerStatusHistory.findMany({
        where: { customerId: cliente.id },
        orderBy: { changedAt: "asc" },
      });
      expect(
        eventos.map((evento) => `${evento.fromStatus}->${evento.toStatus}: ${evento.reason}`),
        role,
      ).toEqual([
        "ACTIVE->BLOCKED: Inadimplência desde março",
        "BLOCKED->ACTIVE: Dívida quitada",
        "ACTIVE->INACTIVE: Encerrou as operações",
        "INACTIVE->ACTIVE: Voltou a comprar",
      ]);
      for (const evento of eventos) {
        // Autor vem da sessão: id e nome congelado no evento.
        expect(evento.changedByUserId, role).toBe(user.id);
        expect(evento.changedByNameSnapshot, role).toBe(`Usuário de Teste ${role}`);
        expect(evento.changedAt, role).toBeInstanceOf(Date);
      }

      // O histórico pela API continua o mesmo contrato.
      const historico = await ler(app, `/customers/${cliente.id}/status-history`);
      expect(historico.events, role).toHaveLength(4);
      expect(historico.events[0], role).toMatchObject({
        fromStatus: "INACTIVE",
        toStatus: "ACTIVE",
        reason: "Voltou a comprar",
        changedByName: `Usuário de Teste ${role}`,
      });

      await app.close();
    },
  );

  it.each(SO_LEEM)("%s recebe 403 nas quatro ações, e nada muda", async (role) => {
    const admin = buildTestApp("ADMIN");
    const semPermissao = buildTestApp(role);
    await admin.ready();
    await semPermissao.ready();

    const ativo = await criarCliente(admin);
    const bloqueado = await criarCliente(admin);
    await mudar(admin, bloqueado.id, "block", "Inadimplência desde março", "BLOCKED");
    const inativo = await criarCliente(admin);
    await mudar(admin, inativo.id, "deactivate", "Encerrou as operações", "INACTIVE");

    // Cada ação a partir da situação que ela aceitaria: a recusa é do perfil,
    // não da transição.
    const tentativas = [
      { cliente: ativo, caminho: "block", situacao: "ACTIVE" },
      { cliente: ativo, caminho: "deactivate", situacao: "ACTIVE" },
      { cliente: bloqueado, caminho: "unblock", situacao: "BLOCKED" },
      { cliente: bloqueado, caminho: "deactivate", situacao: "BLOCKED" },
      { cliente: inativo, caminho: "activate", situacao: "INACTIVE" },
    ];
    for (const { cliente, caminho, situacao } of tentativas) {
      const resposta = await acao(semPermissao, cliente.id, caminho, "Tentativa sem permissão");
      expect(resposta.statusCode, `${role} ${caminho}`).toBe(403);
      expect(resposta.json(), `${role} ${caminho}`).toEqual({
        error: "forbidden",
        message: "Seu perfil não permite esta ação.",
      });
      const depois = await ler(semPermissao, `/customers/${cliente.id}`);
      expect(depois.status, `${role} ${caminho}`).toBe(situacao);
    }

    // O perfil é conferido antes do corpo e antes da existência do cliente.
    const semCorpo = await acao(semPermissao, ativo.id, "block");
    expect(semCorpo.statusCode, `${role}: sem corpo`).toBe(403);
    const inexistente = await acao(
      semPermissao,
      "00000000-0000-4000-8000-000000000000",
      "unblock",
      "Qualquer",
    );
    expect(inexistente.statusCode, `${role}: cliente inexistente`).toBe(403);

    // Só os dois eventos do ADMIN: a recusa não grava nada.
    const eventos = await getPrisma().customerStatusHistory.findMany({
      where: { customerId: { in: [ativo.id, bloqueado.id, inativo.id] } },
    });
    expect(eventos.map((evento) => evento.toStatus).sort(), role).toEqual(["BLOCKED", "INACTIVE"]);

    await admin.close();
    await semPermissao.close();
  });

  it("quem só lê continua vendo situação, motivo e histórico", async () => {
    const admin = buildTestApp("ADMIN");
    const consulta = buildTestApp("VIEWER");
    await admin.ready();
    await consulta.ready();

    const cliente = await criarCliente(admin);
    await mudar(admin, cliente.id, "block", "Inadimplência desde março", "BLOCKED");

    const detalhe = await ler(consulta, `/customers/${cliente.id}`);
    expect(detalhe.status).toBe("BLOCKED");
    expect(detalhe.block.reason).toBe("Inadimplência desde março");

    const lista = await ler(consulta, `/customers?ids=${cliente.id}&status=BLOCKED`);
    expect(lista.customers.map((c: { id: string }) => c.id)).toEqual([cliente.id]);

    const historico = await ler(consulta, `/customers/${cliente.id}/status-history`);
    expect(historico.events).toHaveLength(1);
    expect(historico.events[0]).toMatchObject({
      fromStatus: "ACTIVE",
      toStatus: "BLOCKED",
      reason: "Inadimplência desde março",
      changedByName: "Usuário de Teste ADMIN",
    });

    const visao = await ler(consulta, `/customers/${cliente.id}/consultation/summary`);
    expect(visao.customer.status).toBe("BLOCKED");
    expect(visao.statusHistory).toHaveLength(1);

    await admin.close();
    await consulta.close();
  });

  it("o PATCH do cadastro não é porta para a situação, nem com os campos no corpo", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const cliente = await criarCliente(app);

    const resposta = await app.inject({
      method: "PATCH",
      url: `/customers/${cliente.id}`,
      payload: { notes: "Só a nota muda", active: false, blocked: true, status: "BLOCKED" },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      notes: "Só a nota muda",
      active: true,
      blocked: false,
      status: "ACTIVE",
    });
    const eventos = await getPrisma().customerStatusHistory.count({ where: { customerId: cliente.id } });
    expect(eventos).toBe(0);

    await app.close();
  });
});

describe("CUSTOMER-STATUS-HARDENING-01 — documento em andamento lê a situação atual", () => {
  it("Projeto e Orçamento: o aviso acompanha o cadastro, a guarda recusa e nada é cancelado", async () => {
    const app = buildTestApp("COMMERCIAL");
    await app.ready();
    const cliente = await criarCliente(app);

    const projetoCriado = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { customerId: cliente.id, name: `Projeto endurecimento ${marca()}` },
    });
    expect(projetoCriado.statusCode).toBe(201);
    const projetoId = projetoCriado.json().id as string;
    projetos.push(projetoId);

    const versao = await app.inject({ method: "POST", url: `/projects/${projetoId}/quote-versions` });
    expect(versao.statusCode).toBe(201);
    const versaoId = versao.json().id as string;

    const projetoAntes = await ler(app, `/projects/${projetoId}`);
    expect(projetoAntes.customerStatus).toBe("ACTIVE");
    const statusDoProjeto = projetoAntes.status as string;

    await mudar(app, cliente.id, "block", "Inadimplência desde março", "BLOCKED");

    const projetoBloqueado = await ler(app, `/projects/${projetoId}`);
    expect(projetoBloqueado.customerStatus).toBe("BLOCKED");
    expect(projetoBloqueado.status).toBe(statusDoProjeto);
    expect(projetoBloqueado.quoteVersions.map((q: { status: string }) => q.status)).toEqual(["DRAFT"]);
    // A lista traz o mesmo campo, da mesma leitura — nenhuma consulta por linha.
    const lista = await ler(app, `/projects?search=${encodeURIComponent(projetoAntes.name)}`);
    expect(lista.projects.map((p: { customerStatus: string }) => p.customerStatus)).toEqual(["BLOCKED"]);

    // A guarda de sempre continua sendo a autoridade: o rascunho não é enviado…
    const envio = await app.inject({ method: "POST", url: `/quote-versions/${versaoId}/send` });
    expect(envio.statusCode).toBe(400);
    expect(envio.json().error).toBe("customer_blocked");
    expect(envio.json().message).toContain("Inadimplência desde março");
    // …e continua rascunho, intacto.
    expect((await ler(app, `/quote-versions/${versaoId}`)).status).toBe("DRAFT");

    await mudar(app, cliente.id, "deactivate", "Encerrou as operações", "INACTIVE");
    expect((await ler(app, `/projects/${projetoId}`)).customerStatus).toBe("INACTIVE");

    // Reativar devolve o bloqueio latente; desbloquear devolve o ATIVO.
    await mudar(app, cliente.id, "activate", "Voltou a negociar", "BLOCKED");
    expect((await ler(app, `/projects/${projetoId}`)).customerStatus).toBe("BLOCKED");
    await mudar(app, cliente.id, "unblock", "Acordo fechado", "ACTIVE");

    const projetoDepois = await ler(app, `/projects/${projetoId}`);
    expect(projetoDepois.customerStatus).toBe("ACTIVE");
    expect(projetoDepois.status).toBe(statusDoProjeto);
    expect(projetoDepois.cancelledAt).toBeNull();
    expect(projetoDepois.quoteVersions.map((q: { status: string }) => q.status)).toEqual(["DRAFT"]);

    await app.close();
  });

  it("Pedido: rascunho bloqueado não confirma, não é cancelado, e confirma depois do desbloqueio", async () => {
    const app = buildTestApp("COMMERCIAL");
    const admin = buildTestApp("ADMIN");
    await app.ready();
    await admin.ready();
    const cliente = await criarCliente(app);

    // Produto do próprio cliente, com item de produto acabado — o mínimo que a
    // confirmação aceita.
    const m = marca();
    const item = await getPrisma().item.create({
      data: {
        type: "FINISHED_PRODUCT",
        code: `PA-CSH-${m}`,
        name: `Item endurecimento ${m}`,
        unitCode: "kg",
        controlsLot: true,
        controlsExpiry: false,
        requiresQualityRelease: false,
        active: true,
      },
    });
    const produtoCriado = await admin.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: cliente.id,
        name: `Produto endurecimento ${m}`,
        finishedProductItemId: item.id,
      },
    });
    expect(produtoCriado.statusCode, produtoCriado.body).toBe(201);
    const produtoId = produtoCriado.json().id as string;
    produtos.push(produtoId);

    const criado = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: cliente.id, lines: [{ productId: produtoId, orderedQuantity: "10" }] },
    });
    expect(criado.statusCode, criado.body).toBe(201);
    const pedidoId = criado.json().id as string;
    pedidos.push(pedidoId);
    expect(criado.json().customerStatus).toBe("ACTIVE");

    await mudar(app, cliente.id, "block", "Inadimplência desde março", "BLOCKED");

    const bloqueado = await ler(app, `/customer-orders/${pedidoId}`);
    expect(bloqueado.status).toBe("DRAFT");
    expect(bloqueado.customerStatus).toBe("BLOCKED");
    const lista = await ler(app, `/customer-orders?customerId=${cliente.id}`);
    expect(
      lista.customerOrders.map((p: { id: string; customerStatus: string }) => `${p.id}:${p.customerStatus}`),
    ).toEqual([`${pedidoId}:BLOCKED`]);

    const recusada = await app.inject({ method: "POST", url: `/customer-orders/${pedidoId}/confirm` });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().error).toBe("customer_blocked");
    const aindaRascunho = await ler(app, `/customer-orders/${pedidoId}`);
    expect(aindaRascunho.status).toBe("DRAFT");
    expect(aindaRascunho.cancelledAt).toBeNull();
    expect(aindaRascunho.lines).toHaveLength(1);

    await mudar(app, cliente.id, "deactivate", "Encerrou as operações", "INACTIVE");
    const inativo = await ler(app, `/customer-orders/${pedidoId}`);
    expect(inativo.customerStatus).toBe("INACTIVE");
    const recusadaInativo = await app.inject({ method: "POST", url: `/customer-orders/${pedidoId}/confirm` });
    expect(recusadaInativo.statusCode).toBe(400);
    expect(recusadaInativo.json().error).toBe("inactive_customer");

    await mudar(app, cliente.id, "activate", "Voltou a comprar", "BLOCKED");
    await mudar(app, cliente.id, "unblock", "Acordo fechado", "ACTIVE");

    // A leitura seguinte já não avisa, e o mesmo rascunho confirma.
    expect((await ler(app, `/customer-orders/${pedidoId}`)).customerStatus).toBe("ACTIVE");
    const confirmado = await app.inject({ method: "POST", url: `/customer-orders/${pedidoId}/confirm` });
    expect(confirmado.statusCode, confirmado.body).toBe(200);
    expect(confirmado.json().status).toBe("CONFIRMED");

    // Confirmado, a situação continua sendo a de agora — fora do snapshot.
    await mudar(app, cliente.id, "block", "Nova inadimplência", "BLOCKED");
    const depois = await ler(app, `/customer-orders/${pedidoId}`);
    expect(depois.status).toBe("CONFIRMED");
    expect(depois.customerStatus).toBe("BLOCKED");

    await app.close();
    await admin.close();
  });
});
