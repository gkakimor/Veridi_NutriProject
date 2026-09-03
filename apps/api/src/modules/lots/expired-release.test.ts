import { beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * Liberar afirma que o lote pode ser usado.
 *
 * Um lote com validade passada era aceito na liberação: o status ia para
 * AVAILABLE e a listagem imprimia "Vencido" por cima. Disponível continuava
 * zero, porque a validade já barra o consumo — então a Qualidade registrava
 * uma liberação, via a confirmação na tela, e o material seguia inutilizável.
 *
 * É o mesmo princípio do CoA, que já recusava liberar sem laudo aprovado: a
 * liberação é uma afirmação sobre o lote, não um carimbo.
 */

let itemId: string;

beforeAll(async () => {
  const prisma = getPrisma();
  const marca = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-VEN-${marca}`,
      name: `Insumo validade ${marca}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: true,
      requiresQualityRelease: true,
    },
  });
  itemId = item.id;
});

async function criarLoteAguardando(validade: Date | null) {
  const prisma = getPrisma();
  const marca = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return prisma.lot.create({
    data: {
      code: `LT-VEN-${marca}`,
      itemId,
      initialReceivedQuantity: "10",
      status: "AWAITING_RELEASE",
      expiryDate: validade,
    },
  });
}

describe("Liberação de lote respeita a validade", () => {
  it("lote vencido não é liberado, e o estado não muda", async () => {
    const app = buildTestApp();
    await app.ready();

    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const lote = await criarLoteAguardando(ontem);

    const resposta = await app.inject({ method: "POST", url: `/lots/${lote.id}/release` });

    expect(resposta.statusCode).toBeGreaterThanOrEqual(400);
    // O que prova o bloqueio é o estado, não a resposta: um erro na tela com
    // o lote liberado por baixo seria pior que nenhum erro.
    const depois = await getPrisma().lot.findUniqueOrThrow({ where: { id: lote.id } });
    expect(depois.status).toBe("AWAITING_RELEASE");
    expect(depois.releasedAt).toBeNull();

    await app.close();
  });

  it("lote dentro da validade continua liberando normalmente", async () => {
    const app = buildTestApp();
    await app.ready();

    const daquiUmAno = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const lote = await criarLoteAguardando(daquiUmAno);

    const resposta = await app.inject({ method: "POST", url: `/lots/${lote.id}/release` });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().status).toBe("AVAILABLE");

    await app.close();
  });

  it("lote sem validade controlada não é afetado", async () => {
    const app = buildTestApp();
    await app.ready();

    const lote = await criarLoteAguardando(null);
    const resposta = await app.inject({ method: "POST", url: `/lots/${lote.id}/release` });

    expect(resposta.statusCode).toBe(200);
    await app.close();
  });
});
