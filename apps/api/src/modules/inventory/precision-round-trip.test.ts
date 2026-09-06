import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import "../../lib/decimal.js";

/**
 * Round-trip de precisão contra o banco real — PREC-MIG-A.
 *
 * BACKLOG #19: `Decimal(18,6)` zerava quantidade física derivada em
 * microdosagem. O componente `MP-000147` declara `0,000048 kg` sobre base 1000;
 * produzir uma unidade dá `4,8e-8 kg`, que a coluna antiga persistia como
 * `0,000000` — a Ordem de Produção afirmava que o material não era necessário.
 *
 * Estes testes gravam e leem de verdade, porque é a gravação que perdia. Um
 * teste só de aritmética teria passado o tempo todo: o motor sempre esteve
 * certo.
 *
 * A massa criada leva o prefixo `PREC-A-` em `reason` e é removida ao final.
 */

const PREFIXO = "PREC-A-roundtrip";

/** O valor exato de #19, na unidade de estoque, ao produzir uma unidade. */
const MICRODOSAGEM = "0.000000048";

const CASOS = [
  { nome: "6 casas", valor: "0.123456" },
  { nome: "8 casas", valor: "0.12345678" },
  { nome: "12 casas", valor: "0.123456789012" },
  { nome: "microdosagem de #19", valor: MICRODOSAGEM },
  { nome: "menor fração suportada", valor: "0.000000000001" },
  { nome: "range: 12 inteiros e 12 decimais", valor: "999999999999.999999999999" },
];

describe("precisão de quantidade sobrevive ao banco", () => {
  const prisma = getPrisma();
  let itemId: string | null = null;
  const criados: string[] = [];

  beforeAll(async () => {
    const item = await prisma.item.findFirst({ select: { id: true } });
    itemId = item?.id ?? null;
  });

  afterAll(async () => {
    if (criados.length > 0) {
      await prisma.inventoryMovement.deleteMany({ where: { id: { in: criados } } });
    }
  });

  async function gravar(valor: string): Promise<Prisma.Decimal> {
    const mov = await prisma.inventoryMovement.create({
      data: {
        itemId: itemId!,
        type: "ADJUSTMENT_IN",
        sourceType: "MANUAL_ADJUSTMENT",
        quantity: new Prisma.Decimal(valor),
        reason: `${PREFIXO}-${valor}`,
        occurredAt: new Date(),
      },
      select: { id: true },
    });
    criados.push(mov.id);
    const lido = await prisma.inventoryMovement.findUniqueOrThrow({
      where: { id: mov.id },
      select: { quantity: true },
    });
    return lido.quantity;
  }

  for (const caso of CASOS) {
    it(`preserva ${caso.nome} — ${caso.valor}`, async () => {
      if (!itemId) return; // banco sem item: nada a provar, não é falha de precisão
      const lido = await gravar(caso.valor);
      expect(lido.equals(new Prisma.Decimal(caso.valor))).toBe(true);
      expect(lido.toString()).toBe(new Prisma.Decimal(caso.valor).toString());
    });
  }

  it("microdosagem de #19 não vira zero — o defeito que originou a migration", async () => {
    if (!itemId) return;
    const lido = await gravar(MICRODOSAGEM);
    expect(lido.isZero()).toBe(false);
    expect(lido.toFixed(12)).toBe("0.000000048000");
    // A prova de que a coluna antiga perdia: com seis casas isto é zero.
    expect(lido.toFixed(6)).toBe("0.000000");
  });

  it("acima de 12 casas o banco arredonda — por isso a API recusa antes", async () => {
    if (!itemId) return;
    // Caracterização da fronteira: se um caminho escapar da validação de
    // `quantityDecimalSchema`, é ISTO que acontece — arredondamento silencioso.
    const lido = await gravar("0.1234567890123");
    expect(lido.toString()).toBe("0.123456789012");
  });

  it("gravar e reler sem alterar preserva o valor byte a byte", async () => {
    if (!itemId) return;
    const original = "4.053187640000";
    const lido = await gravar(original);
    // Reescreve exatamente o que leu, como faz um formulário aberto e salvo
    // sem edição — e o valor tem que sobreviver à volta.
    const id = criados[criados.length - 1]!;
    await prisma.inventoryMovement.update({
      where: { id },
      data: { quantity: new Prisma.Decimal(lido.toString()) },
    });
    const relido = await prisma.inventoryMovement.findUniqueOrThrow({
      where: { id },
      select: { quantity: true },
    });
    expect(relido.quantity.equals(new Prisma.Decimal(original))).toBe(true);
    expect(relido.quantity.toFixed(12)).toBe("4.053187640000");
  });
});
