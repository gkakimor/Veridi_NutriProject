import { PrismaClient } from "@prisma/client";
import { USER_CODE_PREFIX } from "@veridi/shared";
import { hashPassword } from "../src/lib/password.js";
import { nextSequenceCode } from "../src/lib/sequence-code.js";

/**
 * Seed de INFRAESTRUTURA — só o que a aplicação não consegue existir sem.
 *
 * Diferente de `seed.ts`, que popula um ambiente de demonstração com
 * clientes, itens, fornecedores, produtos e compras. Aqui não entra dado de
 * negócio nenhum, de propósito: a rodada de validação exige que Cliente,
 * Fornecedor, Item, Produto, Projeto, Pedido e todo o resto nasçam PELA
 * INTERFACE. Um seed que adianta esse trabalho invalida o teste — passa a
 * provar que o banco aceita a linha, não que a tela deixa a pessoa criá-la.
 *
 * O que sobra são duas coisas:
 *
 * 1. UNIDADES DE MEDIDA. Não há tela para cadastrá-las e o schema as trata
 *    como tabela de referência: item, formulação e estoque apontam para
 *    `code`. Sem elas nenhum cadastro salva. O catálogo nasce da migration
 *    `20260925093012_reference_units_of_measure`, em QUALQUER instalação —
 *    produção inclusive, que não roda seed. Este seed só confere que ele
 *    está lá: uma segunda lista aqui seria uma segunda fonte da verdade.
 * 2. UM USUÁRIO. Sem login não há interface para usar, e criar o primeiro
 *    usuário pela interface exigiria estar logado.
 *
 * Sequences de código (CLI-, PROD-, OP-…) não precisam de seed: as
 * migrations as criam, e o primeiro `nextSequenceCode` entrega o 000001.
 *
 *   pnpm exec dotenv -e .env -- pnpm --filter @veridi/api exec tsx prisma/seed-infra.ts
 */

const prisma = new PrismaClient();

/** O catálogo que a migration de referência cria. Conferido, nunca semeado aqui. */
const UNIDADES_DE_REFERENCIA = ["mg", "g", "kg", "un", "mL", "L"];

async function conferirUnidades(): Promise<number> {
  const existentes = new Set(
    (await prisma.unitOfMeasure.findMany({ select: { code: true } })).map((u) => u.code),
  );
  const faltam = UNIDADES_DE_REFERENCIA.filter((code) => !existentes.has(code));
  if (faltam.length > 0) {
    throw new Error(
      `Catálogo de unidades sem ${faltam.join(", ")}: aplique as migrations antes deste seed.`,
    );
  }
  return existentes.size;
}

/**
 * O usuário de acesso.
 *
 * Credenciais vêm do ambiente quando existirem; o padrão só vale em base
 * local recriada do zero, e a senha padrão é deliberadamente óbvia para não
 * ser confundida com credencial de verdade.
 */
async function semearUsuario(): Promise<string> {
  const email = process.env["SEED_ADMIN_EMAIL"] ?? "admin@veridi.local";
  const senha = process.env["SEED_ADMIN_PASSWORD"] ?? "veridi-local-dev";

  const existente = await prisma.user.findUnique({ where: { email } });
  if (existente) {
    await prisma.user.update({ where: { email }, data: { active: true, role: "ADMIN" } });
    return email;
  }

  // O código sai da MESMA sequence que a tela de Usuários usa: um `USR-`
  // inventado aqui sairia da numeração e apareceria fora de ordem na lista.
  await prisma.user.create({
    data: {
      code: await nextSequenceCode(prisma, "user_code_seq", USER_CODE_PREFIX),
      email,
      name: "Administrador local",
      role: "ADMIN",
      active: true,
      passwordHash: await hashPassword(senha),
    },
  });
  return email;
}

async function main(): Promise<void> {
  const quantasUnidades = await conferirUnidades();
  const email = await semearUsuario();

  /*
   * A contagem é a prova de que este seed não plantou negócio. Se algum dia
   * alguém acrescentar um cliente "só para facilitar", o número deixa de ser
   * zero e a validação pela interface para de valer.
   */
  const [clientes, fornecedores, itens, produtos] = await Promise.all([
    prisma.customer.count(),
    prisma.supplier.count(),
    prisma.item.count(),
    prisma.product.count(),
  ]);

  console.log(`Unidades de medida (da migration): ${quantasUnidades}.`);
  console.log(`Usuário de acesso: ${email}.`);
  console.log(
    `Dado de negócio: clientes ${clientes}, fornecedores ${fornecedores}, ` +
      `itens ${itens}, produtos ${produtos} — todos devem nascer pela interface.`,
  );

  if (clientes + fornecedores + itens + produtos > 0) {
    throw new Error(
      "Este seed não pode deixar dado de negócio no banco. Rode contra base recriada.",
    );
  }
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
