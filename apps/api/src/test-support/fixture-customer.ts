import { getPrisma } from "../db/prisma.js";

/**
 * Cliente compartilhado das fixtures de teste.
 *
 * Produto passou a exigir Cliente na criação, e dezenas de arquivos criam
 * produtos só como pano de fundo para testar outra coisa — estoque,
 * produção, expedição. Cada um inventar o próprio cliente encheria o banco
 * de desenvolvimento de registros que ninguém limpa, e foi exatamente esse
 * acúmulo que já quebrou um relatório paginado antes.
 *
 * Então é UM cliente, com código fixo, criado na primeira vez e reusado por
 * todos: uma linha no banco, sem crescimento e sem limpeza para esquecer.
 * Quem precisa de clientes distintos (escopo, isolamento entre clientes)
 * continua criando os seus.
 */
const FIXTURE_CODE = "CLI-TEST-FIXTURE";

let cached: string | null = null;

export async function fixtureCustomerId(): Promise<string> {
  if (cached) {
    // Outro arquivo pode ter limpado a base entre os dois usos.
    const stillThere = await getPrisma().customer.findUnique({ where: { id: cached } });
    if (stillThere) return cached;
    cached = null;
  }

  const customer = await getPrisma().customer.upsert({
    where: { code: FIXTURE_CODE },
    update: {},
    create: {
      code: FIXTURE_CODE,
      legalName: "Cliente padrão das fixtures de teste",
      tradeName: "Fixture",
      active: true,
    },
  });
  cached = customer.id;
  return customer.id;
}
