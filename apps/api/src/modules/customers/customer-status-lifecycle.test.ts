import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Situação cadastral do Cliente — CUSTOMER-STATUS-LIFECYCLE-01, §95.
 *
 * O que estes casos protegem: o padrão da listagem (ativo aparece, bloqueado e
 * inativo ficam arquivados), o motivo obrigatório, o histórico que nunca é
 * sobrescrito, a recusa de venda nova e a corrida entre dois comandos.
 */

const criados: string[] = [];

afterEach(async () => {
  if (criados.length === 0) return;
  // O histórico sai junto (cascade) — Cliente não tem exclusão física no app.
  await getPrisma().customer.deleteMany({ where: { id: { in: criados } } });
  criados.length = 0;
});

type App = ReturnType<typeof buildTestApp>;

async function criarCliente(app: App, legalName?: string) {
  const response = await app.inject({
    method: "POST",
    url: "/customers",
    payload: { legalName: legalName ?? `Cliente situação ${Date.now()}-${Math.random()}` },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json() as { id: string; code: string; status: string };
  criados.push(body.id);
  return body;
}

function acao(app: App, id: string, caminho: string, reason?: string) {
  return app.inject({
    method: "POST",
    url: `/customers/${id}/${caminho}`,
    ...(reason === undefined ? {} : { payload: { reason } }),
  });
}

function historico(app: App, id: string) {
  return app.inject({ method: "GET", url: `/customers/${id}/status-history` });
}

interface EventoDoHistorico {
  id: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  changedAt: string;
  changedByName: string | null;
}

/**
 * Espera o POST parar NA TRAVA da linha do cliente. Sem esta prova o caso de
 * corrida não vale nada: sem `FOR UPDATE` o segundo comando não espera, grava
 * o próprio evento e o teste passaria assim mesmo.
 */
async function esperarTravadoNaLinha(): Promise<void> {
  const prisma = getPrisma();
  for (let tentativa = 0; tentativa < 60; tentativa += 1) {
    const [linha] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND query ILIKE '%FROM customers%FOR UPDATE%'
        AND pid <> pg_backend_pid()
    `;
    if ((linha?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("o comando de situação não parou na trava da linha do cliente");
}

describe("CUSTOMER-STATUS-LIFECYCLE-01 — situação cadastral", () => {
  it("cliente nasce ATIVO e bloquear exige motivo", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente(app);
    expect(cliente.status).toBe("ACTIVE");

    const semCorpo = await acao(app, cliente.id, "block");
    expect(semCorpo.statusCode).toBe(400);
    expect(semCorpo.json().error).toBe("validation_error");

    const soEspacos = await acao(app, cliente.id, "block", "    ");
    expect(soEspacos.statusCode).toBe(400);

    const semEvento = await historico(app, cliente.id);
    expect(semEvento.json().events).toHaveLength(0);

    await app.close();
  });

  it("bloquear registra situação anterior, nova, motivo, usuário e data/hora", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente(app);
    const antes = Date.now();
    const bloqueado = await acao(app, cliente.id, "block", "Inadimplência desde março");

    expect(bloqueado.statusCode).toBe(200);
    const corpo = bloqueado.json();
    expect(corpo.status).toBe("BLOCKED");
    expect(corpo.blocked).toBe(true);
    expect(corpo.block.reason).toBe("Inadimplência desde março");
    expect(corpo.block.blockedByName).toBe("Usuário de Teste ADMIN");

    const eventos = historico(app, cliente.id);
    const [evento] = (await eventos).json().events as EventoDoHistorico[];
    expect(evento).toMatchObject({
      fromStatus: "ACTIVE",
      toStatus: "BLOCKED",
      reason: "Inadimplência desde março",
      changedByName: "Usuário de Teste ADMIN",
    });
    expect(new Date(evento!.changedAt).getTime()).toBeGreaterThanOrEqual(antes - 1000);

    await app.close();
  });

  it("desbloquear preserva o evento do bloqueio, sem sobrescrever nada", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente(app);
    await acao(app, cliente.id, "block", "Inadimplência desde março");
    const [bloqueio] = (await historico(app, cliente.id)).json().events as EventoDoHistorico[];

    const desbloqueado = await acao(app, cliente.id, "unblock", "Dívida quitada");
    expect(desbloqueado.statusCode).toBe(200);
    expect(desbloqueado.json().status).toBe("ACTIVE");
    expect(desbloqueado.json().block).toBeNull();

    const eventos = (await historico(app, cliente.id)).json().events as EventoDoHistorico[];
    expect(eventos).toHaveLength(2);
    // O evento anterior continua byte a byte o que era — o motivo do bloqueio
    // não é um campo do cadastro que o desbloqueio regravaria.
    expect(eventos[1]).toEqual(bloqueio);
    expect(eventos[0]).toMatchObject({
      fromStatus: "BLOCKED",
      toStatus: "ACTIVE",
      reason: "Dívida quitada",
    });

    await app.close();
  });

  it("inativar preserva o histórico, e o cliente continua consultável", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente(app);
    await acao(app, cliente.id, "block", "Inadimplência");
    await acao(app, cliente.id, "unblock", "Acordo fechado");
    const antes = (await historico(app, cliente.id)).json().events as EventoDoHistorico[];

    const inativado = await acao(app, cliente.id, "deactivate", "Encerrou as operações");
    expect(inativado.statusCode).toBe(200);
    expect(inativado.json().status).toBe("INACTIVE");

    const depois = (await historico(app, cliente.id)).json().events as EventoDoHistorico[];
    expect(depois).toHaveLength(3);
    expect(depois.slice(1)).toEqual(antes);

    const detalhe = await app.inject({ method: "GET", url: `/customers/${cliente.id}` });
    expect(detalhe.statusCode).toBe(200);
    expect(detalhe.json().status).toBe("INACTIVE");

    await app.close();
  });

  it("reativar um cliente que estava bloqueado devolve o bloqueio, com o motivo original", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente(app);
    await acao(app, cliente.id, "block", "Inadimplência desde março");
    await acao(app, cliente.id, "deactivate", "Arquivado enquanto negocia");

    const reativado = await acao(app, cliente.id, "activate", "Voltou a comprar");
    expect(reativado.statusCode).toBe(200);
    // Arquivar não é desbloquear: o bloqueio ficou latente e voltou.
    expect(reativado.json().status).toBe("BLOCKED");
    expect(reativado.json().block.reason).toBe("Inadimplência desde março");

    const eventos = (await historico(app, cliente.id)).json().events as EventoDoHistorico[];
    expect(eventos.map((evento) => `${evento.fromStatus}->${evento.toStatus}`)).toEqual([
      "INACTIVE->BLOCKED",
      "BLOCKED->INACTIVE",
      "ACTIVE->BLOCKED",
    ]);

    await app.close();
  });

  it("ação que não parte da situação atual é recusa de negócio (409), não 500", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente(app);

    const desbloquearAtivo = await acao(app, cliente.id, "unblock", "Sem bloqueio nenhum");
    expect(desbloquearAtivo.statusCode).toBe(409);
    expect(desbloquearAtivo.json().error).toBe("invalid_status_transition");

    const reativarAtivo = await acao(app, cliente.id, "activate", "Já está ativo");
    expect(reativarAtivo.statusCode).toBe(409);

    await acao(app, cliente.id, "block", "Inadimplência");
    const bloquearDeNovo = await acao(app, cliente.id, "block", "De novo");
    expect(bloquearDeNovo.statusCode).toBe(409);

    const eventos = (await historico(app, cliente.id)).json().events as EventoDoHistorico[];
    expect(eventos).toHaveLength(1);

    await app.close();
  });

  it("filtro da listagem: ativos, bloqueados, inativos e todos", async () => {
    const app = buildTestApp();
    await app.ready();

    const marcador = `SIT${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const ativo = await criarCliente(app, `${marcador} ativo`);
    const bloqueado = await criarCliente(app, `${marcador} bloqueado`);
    const inativo = await criarCliente(app, `${marcador} inativo`);
    await acao(app, bloqueado.id, "block", "Inadimplência");
    await acao(app, inativo.id, "deactivate", "Encerrou as operações");

    const ids = async (filtro: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/customers?search=${marcador}&pageSize=100${filtro}`,
      });
      expect(response.statusCode).toBe(200);
      return (response.json().customers as { id: string }[]).map((c) => c.id).sort();
    };

    expect(await ids("&status=ACTIVE")).toEqual([ativo.id]);
    expect(await ids("&status=BLOCKED")).toEqual([bloqueado.id]);
    expect(await ids("&status=INACTIVE")).toEqual([inativo.id]);
    expect(await ids("&status=BLOCKED,INACTIVE")).toEqual([bloqueado.id, inativo.id].sort());
    // Sem filtro a API devolve todos: quem escolhe o recorte é cada tela.
    expect(await ids("")).toEqual([ativo.id, bloqueado.id, inativo.id].sort());

    const invalido = await app.inject({ method: "GET", url: "/customers?status=ARQUIVADO" });
    expect(invalido.statusCode).toBe(400);

    await app.close();
  });

  it("venda nova para cliente bloqueado é recusada, com a frase e o motivo", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente(app);
    await acao(app, cliente.id, "block", "Inadimplência desde março");

    const pedido = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: cliente.id },
    });
    expect(pedido.statusCode).toBe(400);
    expect(pedido.json().error).toBe("customer_blocked");
    expect(pedido.json().message).toContain("Cliente bloqueado para novas vendas.");
    expect(pedido.json().message).toContain("Inadimplência desde março");

    const projeto = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { customerId: cliente.id, name: "Projeto que não pode nascer" },
    });
    expect(projeto.statusCode).toBe(400);
    expect(projeto.json().error).toBe("customer_blocked");

    await app.close();
  });

  it("venda nova para cliente inativo é recusada, e ele continua consultável", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente(app);
    await acao(app, cliente.id, "deactivate", "Encerrou as operações");

    const pedido = await app.inject({
      method: "POST",
      url: "/customer-orders",
      payload: { customerId: cliente.id },
    });
    expect(pedido.statusCode).toBe(400);
    expect(pedido.json().error).toBe("inactive_customer");
    expect(pedido.json().message).toBe("Cliente inativo.");

    const projeto = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { customerId: cliente.id, name: "Projeto que não pode nascer" },
    });
    expect(projeto.statusCode).toBe(400);
    expect(projeto.json().error).toBe("inactive_customer");

    const consultavel = await app.inject({
      method: "GET",
      url: `/customers?ids=${cliente.id}&status=INACTIVE`,
    });
    expect(consultavel.json().customers).toHaveLength(1);

    await app.close();
  });

  it("a Visão do Cliente traz a situação, o motivo em vigor e o histórico", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente(app);
    await acao(app, cliente.id, "block", "Inadimplência desde março");

    const resumo = await app.inject({
      method: "GET",
      url: `/customers/${cliente.id}/consultation/summary`,
    });
    expect(resumo.statusCode).toBe(200);
    const corpo = resumo.json();
    expect(corpo.customer.status).toBe("BLOCKED");
    expect(corpo.customer.block.reason).toBe("Inadimplência desde março");
    expect(corpo.statusHistory).toHaveLength(1);
    expect(corpo.statusHistory[0]).toMatchObject({
      fromStatus: "ACTIVE",
      toStatus: "BLOCKED",
      reason: "Inadimplência desde março",
    });
    // A situação comercial (§86) continua sendo outra resposta, intacta.
    expect(corpo.commercial.status).toBeDefined();

    await app.close();
  });

  it("dois comandos concorrentes: o segundo espera a trava e é recusado, sem evento duplicado", async () => {
    const app = buildTestApp();
    await app.ready();

    const cliente = await criarCliente(app);

    let aberta!: () => void;
    const travada = new Promise<void>((resolve) => {
      aberta = resolve;
    });
    let soltar!: () => void;
    const segurando = new Promise<void>((resolve) => {
      soltar = resolve;
    });

    /*
     * A transação segura a linha e já bloqueia o cliente — é exatamente o que
     * o segundo comando encontraria se dois usuários clicassem juntos.
     */
    const transacao = getPrisma().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${cliente.id} FOR UPDATE`;
        await tx.customer.update({ where: { id: cliente.id }, data: { blocked: true } });
        aberta();
        await segurando;
      },
      { timeout: 30_000 },
    );

    await travada;
    const concorrente = acao(app, cliente.id, "block", "Bloqueio concorrente");
    await esperarTravadoNaLinha();

    soltar();
    await transacao;

    const resposta = await concorrente;
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().error).toBe("invalid_status_transition");

    const eventos = (await historico(app, cliente.id)).json().events as EventoDoHistorico[];
    expect(eventos).toHaveLength(0);

    await app.close();
  });
});
