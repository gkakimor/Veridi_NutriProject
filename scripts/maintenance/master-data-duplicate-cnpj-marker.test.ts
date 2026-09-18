import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { disconnectPrisma } from "../../apps/api/src/db/prisma.js";
import { consultarExclusao } from "../../apps/api/src/modules/master-data-deletion/master-data-deletion.service.js";
import { cadastroPorChave } from "./master-data-catalog.js";
import { aplicar, lerCatalogo, planejar, verificar } from "./master-data-duplicate-sanitization.js";
import type { GrupoPlanejado, Plano } from "./master-data-duplicate-sanitization.js";

/**
 * O saneamento de duplicidades e a marca de nascimento do registro do CNPJ
 * (CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01, §125).
 *
 * `createdWithCustomerId` termina no sufixo de id do Cliente, mas NÃO é
 * referência que se move: guarda o Cliente ORIGINAL da criação. O MERGE move
 * o `customerId` do registro do absorvido para o canônico e deixa a marca
 * como está — e o registro movido deixa de ser filho técnico de quem o
 * recebeu: a exclusão física do canônico passa a ser recusada por ele.
 *
 * O PLAN varre a tabela inteira de Clientes do banco de teste, que outras
 * faixas também usam: todo caso procura o SEU grupo pelo nome e todo APPLY usa
 * `somente`.
 */

const prisma = new PrismaClient();
const TRAVA_DO_ARQUIVO = "teste:master-data-duplicate-cnpj-marker";
const HISTORICO = "customer_cnpj_registration_history";

const criados = { clientes: [] as string[] };

afterEach(async () => {
  // O registro do CNPJ sai junto, pelo CASCADE do Cliente.
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  criados.clientes = [];
});

afterAll(async () => {
  await prisma.$disconnect();
  await disconnectPrisma();
});

let sequencia = Math.floor(Math.random() * 50_000);
const proximoCodigo = (): string => `CLI-9${String(++sequencia).padStart(5, "0")}`;
const marca = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();

async function criarCliente(nome: string, email: string | null = null) {
  const cliente = await prisma.customer.create({ data: { code: proximoCodigo(), legalName: nome, email } });
  criados.clientes.push(cliente.id);
  return cliente;
}

/** O registro que a criação do Cliente grava: marcado com ele mesmo. */
function registroDaCriacao(customerId: string) {
  return prisma.customerCnpjRegistrationHistory.create({
    data: { customerId, createdWithCustomerId: customerId, kind: "EDIT", changes: [] },
  });
}

function acharGrupo(plano: Plano, nome: string): GrupoPlanejado {
  const grupo = plano.grupos.find((g) => g.chaveDoNome === nome.trim().toUpperCase());
  if (!grupo) throw new Error(`grupo "${nome}" não saiu no plano`);
  return grupo;
}

/** Dois Clientes do mesmo nome, cada um com o registro da criação; o canônico é o mais completo. */
async function duplicados() {
  const nome = `Cliente Marca ${marca()}`;
  const absorvido = await criarCliente(nome);
  const canonico = await criarCliente(nome.toUpperCase(), "compras@exemplo.com");
  const doAbsorvido = await registroDaCriacao(absorvido.id);
  const doCanonico = await registroDaCriacao(canonico.id);
  const plano = await planejar(prisma, ["CUSTOMER"]);
  const grupo = acharGrupo(plano, nome);
  return { absorvido, canonico, doAbsorvido, doCanonico, plano, grupo };
}

describe("saneamento × marca da criação do registro do CNPJ", () => {
  it("o catálogo do Cliente leva a chave do histórico, e nunca a marca — nem como id sem chave", async () => {
    const catalogo = await prisma.$transaction((tx) => lerCatalogo(tx, cadastroPorChave("CUSTOMER")));
    expect(catalogo).toContainEqual({ tabela: HISTORICO, coluna: "customerId", tipo: "fk", aoApagar: "c" });
    expect(catalogo.filter((coluna) => coluna.coluna === "createdWithCustomerId")).toEqual([]);
    // A rede por sufixo a pegaria: é a exclusão explícita que a tira.
    expect("createdWithCustomerId".toLowerCase().endsWith("customerid")).toBe(true);
    expect(cadastroPorChave("CUSTOMER").origensImoveis).toEqual([`${HISTORICO}.createdWithCustomerId`]);
  });

  it("MERGE move o customerId do registro e NUNCA a marca; o VERIFY não a cobra; o registro movido deixa de ser técnico", async () => {
    const { absorvido, canonico, doAbsorvido, doCanonico, plano, grupo } = await duplicados();
    expect(grupo.situacao, grupo.motivos.join("; ")).toBe("PRONTO");
    expect(grupo.canonico.id).toBe(canonico.id);
    expect(grupo.movimentos).toEqual([{ tabela: HISTORICO, coluna: "customerId", linhas: 1 }]);
    for (const lado of [grupo.canonico, ...grupo.absorvidos]) {
      expect(lado.referencias.map((referencia) => referencia.coluna)).not.toContain("createdWithCustomerId");
    }

    // Antes do MERGE, cada um tem o seu registro técnico.
    expect(await consultarExclusao("CUSTOMER", absorvido.id)).toMatchObject({
      canDelete: true,
      removedTogether: [{ source: "Registro dos dados do CNPJ feito na criação", count: 1 }],
    });

    const [resultado] = await aplicar(prisma, plano, { somente: [grupo.grupo], trava: TRAVA_DO_ARQUIVO });
    expect(resultado?.situacao, resultado?.motivo ?? "").toBe("APLICADO");
    expect(resultado?.efeito).toEqual({
      [HISTORICO]: { ins: 0, upd: 1, del: 0 },
      customers: { ins: 0, upd: 0, del: 1 },
    });

    // O ponteiro mudou; a marca guarda o Cliente ORIGINAL da criação.
    expect(await prisma.customerCnpjRegistrationHistory.findUniqueOrThrow({ where: { id: doAbsorvido.id } })).toMatchObject({
      customerId: canonico.id,
      createdWithCustomerId: absorvido.id,
    });
    expect(await prisma.customerCnpjRegistrationHistory.findUniqueOrThrow({ where: { id: doCanonico.id } })).toMatchObject({
      customerId: canonico.id,
      createdWithCustomerId: canonico.id,
    });
    expect(await prisma.customer.count({ where: { id: absorvido.id } })).toBe(0);

    const conferencia = await verificar(prisma, [grupo]);
    expect(conferencia.problemas).toEqual([]);

    // A exclusão física do canônico: o registro que veio do absorvido é uso real.
    const check = await consultarExclusao("CUSTOMER", canonico.id);
    expect(check.canDelete).toBe(false);
    expect(check.removedTogether).toEqual([]);
    expect(check.references).toEqual([
      expect.objectContaining({
        source: "Histórico dos dados cadastrais do CNPJ",
        count: 1,
        reason: expect.stringContaining("criação de outro cliente"),
      }),
    ]);
  });

  it("plano adulterado que mande mover a marca aborta no APPLY, sem gravar nada", async () => {
    const { absorvido, doAbsorvido, plano, grupo } = await duplicados();
    expect(grupo.situacao, grupo.motivos.join("; ")).toBe("PRONTO");
    // Só a lista do absorvido muda: movimentos e impressão seguem os do banco,
    // então o APPLY chega à execução — e é a guarda dela que recusa.
    const adulterado: Plano = {
      ...plano,
      grupos: plano.grupos.map((g) =>
        g.grupo !== grupo.grupo
          ? g
          : {
              ...g,
              absorvidos: g.absorvidos.map((a) => ({
                ...a,
                referencias: [
                  ...a.referencias,
                  { tabela: HISTORICO, coluna: "createdWithCustomerId", tipo: "id" as const, linhas: 1 },
                ],
              })),
            },
      ),
    };

    const [resultado] = await aplicar(prisma, adulterado, { somente: [grupo.grupo], trava: TRAVA_DO_ARQUIVO });
    expect(resultado?.situacao).toBe("FALHOU");
    expect(resultado?.motivo).toMatch(/createdWithCustomerId guarda a origem da linha e nunca se move/);
    // Nada mudou: o registro segue no absorvido, com a marca dele.
    expect(await prisma.customer.count({ where: { id: absorvido.id } })).toBe(1);
    expect(await prisma.customerCnpjRegistrationHistory.findUniqueOrThrow({ where: { id: doAbsorvido.id } })).toMatchObject({
      customerId: absorvido.id,
      createdWithCustomerId: absorvido.id,
    });
  });
});
