import { PrismaClient } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
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
 *    `code`. Sem elas nenhum cadastro salva.
 * 2. UM USUÁRIO. Sem login não há interface para usar, e criar o primeiro
 *    usuário pela interface exigiria estar logado.
 *
 * Sequences de código (CLI-, PROD-, OP-…) não precisam de seed: nascem na
 * primeira chamada de `nextSequenceCode`.
 *
 *   pnpm exec dotenv -e .env -- pnpm --filter @veridi/api exec tsx prisma/seed-infra.ts
 */

const prisma = new PrismaClient();

interface UnidadeSeed {
  code: string;
  label: string;
  dimension: UomDimension;
  toBaseFactor: string;
}

/** As mesmas de `seed.ts` — a lista é a tabela de referência, não exemplo. */
const unidades: UnidadeSeed[] = [
  { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  { code: "mL", label: "Mililitro", dimension: "VOLUME", toBaseFactor: "0.001" },
  { code: "L", label: "Litro", dimension: "VOLUME", toBaseFactor: "1" },
];

async function semearUnidades(): Promise<number> {
  for (const unidade of unidades) {
    await prisma.unitOfMeasure.upsert({
      where: { code: unidade.code },
      update: {
        label: unidade.label,
        dimension: unidade.dimension,
        toBaseFactor: unidade.toBaseFactor,
      },
      create: unidade,
    });
  }
  return unidades.length;
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
  const quantasUnidades = await semearUnidades();
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

  console.log(`Unidades de medida: ${quantasUnidades}.`);
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
