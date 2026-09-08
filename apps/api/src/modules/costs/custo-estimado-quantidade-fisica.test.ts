import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { computeFormulationRequirements } from "../production-orders/requirement-calc.js";

/**
 * A estimativa de custo da Formulação usa a MESMA quantidade física que os
 * Requirements — F-02-2.
 *
 * O defeito: a estimativa multiplicava o custo unitário por
 * `convertUomDecimal(component.quantity, ...)`, ou seja, pela quantidade
 * DECLARADA só convertida de unidade. Isso ignora tudo o que o motor da
 * formulação faz depois: o fator da base (doses por embalagem, base fixa,
 * unidade acabada), a pureza e o overage.
 *
 * Num produto de 60 doses o componente entra 60 vezes por embalagem, e a
 * estimativa subestimava o material por um fator 60 — em silêncio, e ao lado
 * da própria tela que mostrava a quantidade certa.
 *
 * Conversão de unidade é uma ETAPA da matemática, não a matemática inteira.
 *
 * Fixtures próprias do arquivo; nenhum `deleteMany` sem escopo.
 */

const DOSES = 60;

/** Base 1 embalagem: mantém a leitura "por unidade acabada" direta. */
const BASE = "1";

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  const prisma = getPrisma();
  const units: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] = [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
    { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ];
  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductIds.length > 0) {
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.itemCostReference.deleteMany({ where: { itemId: { in: fixtureItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function criarItem(app: App, unitCode: string, unitCost: string | null) {
  const item = (
    await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name: `MP QF ${marca()}`, unitCode },
    })
  ).json();
  fixtureItemIds.push(item.id);
  if (unitCost !== null) {
    // Referência manual: última da hierarquia canônica (§53) e a única fonte
    // determinística sem compra nem oferta. A FONTE do preço não é o assunto
    // deste arquivo — a QUANTIDADE é.
    const referencia = await app.inject({
      method: "POST",
      url: `/items/${item.id}/cost-references`,
      payload: { unitCost },
    });
    expect(referencia.statusCode, referencia.body).toBe(201);
  }
  return item as { id: string; code: string; unitCode: string };
}

interface ComponenteDoCenario {
  itemId: string;
  quantity: string;
  unitCode: string;
  basis?: "FIXED_BASIS" | "PER_DOSE" | "PER_FINISHED_UNIT";
  supplyResponsibility?: "VERIDI" | "CUSTOMER";
  purityPercentApplied?: string;
  overagePercent?: string;
  quantityMode?: "PHYSICAL_DIRECT" | "THEORETICAL_WITH_ADJUSTMENTS";
  applyPurityAdjustment?: boolean;
  applyOverageAdjustment?: boolean;
}

async function criarVersao(
  app: App,
  componentes: ComponenteDoCenario[],
  opcoes: { doses?: number | null; basisQuantity?: string } = {},
) {
  const acabado = (
    await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "FINISHED_PRODUCT", name: `PA QF ${marca()}`, unitCode: "un" },
    })
  ).json();
  fixtureItemIds.push(acabado.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        name: `Produto QF ${marca()}`,
        finishedProductItemId: acabado.id,
        customerId: await fixtureCustomerId(),
      },
    })
  ).json();
  expect(product.id, JSON.stringify(product)).toBeTruthy();
  fixtureProductIds.push(product.id);

  const version = (
    await app.inject({ method: "POST", url: `/products/${product.id}/formulation-versions`, payload: {} })
  ).json();

  const atualizada = await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${version.id}`,
    payload: {
      basisQuantity: opcoes.basisQuantity ?? BASE,
      calculationMode: "FIXED_BASIS",
      dosesPerPackage: opcoes.doses === undefined ? DOSES : opcoes.doses,
      components: componentes,
    },
  });
  expect(atualizada.statusCode, atualizada.body).toBe(200);
  return { versionId: version.id as string, versao: atualizada.json() };
}

interface LinhaDaEstimativa {
  itemId: string;
  requiredQuantity: string;
  stockUnitCode: string;
  unitCost: string | null;
  costSource: string;
  customerSupplied: boolean;
  estimatedComponentCost: string | null;
}

async function estimar(app: App, versionId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/formulation-versions/${versionId}/cost-estimate`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as {
    basisQuantity: string;
    components: LinhaDaEstimativa[];
    quality: string;
    estimatedMaterialCost: string | null;
    estimatedMaterialUnitCost: string | null;
    missingCostItems: string[];
  };
}

function linhaDe(dto: { components: LinhaDaEstimativa[] }, itemId: string) {
  const linha = dto.components.find((c) => c.itemId === itemId);
  expect(linha, `componente ${itemId} ausente na estimativa`).toBeTruthy();
  return linha!;
}

describe("F-02-2 — quantidade da estimativa de custo é a física canônica", () => {
  it("contrato: para a MESMA versão, Requirements e estimativa devolvem a mesma quantidade", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    // Um componente de cada arranjo que o motor trata de forma diferente.
    const cafeina = await criarItem(app, "kg", "272");
    const celulose = await criarItem(app, "kg", "26");
    const estearato = await criarItem(app, "kg", "29.90");
    const flagsDesligadas = await criarItem(app, "kg", "50");
    const pote = await criarItem(app, "un", "1.35");

    const { versionId, versao } = await criarVersao(app, [
      {
        // Teórica com ajustes: pureza 90% e overage 5%, ambos autorizados.
        itemId: cafeina.id,
        quantity: "200",
        unitCode: "mg",
        basis: "PER_DOSE",
        purityPercentApplied: "90",
        overagePercent: "5",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        applyPurityAdjustment: true,
        applyOverageAdjustment: true,
      },
      // Física direta, sem ajuste nenhum: o fator 60 aparece puro.
      { itemId: celulose.id, quantity: "253", unitCode: "mg", basis: "PER_DOSE" },
      {
        // Física direta com pureza e overage PREENCHIDOS: documentação, não conta.
        itemId: estearato.id,
        quantity: "20",
        unitCode: "mg",
        basis: "PER_DOSE",
        purityPercentApplied: "80",
        overagePercent: "10",
        quantityMode: "PHYSICAL_DIRECT",
      },
      {
        // Teórica com ajustes, mas com as duas marcas DESLIGADAS.
        itemId: flagsDesligadas.id,
        quantity: "100",
        unitCode: "mg",
        basis: "PER_DOSE",
        purityPercentApplied: "80",
        overagePercent: "10",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        applyPurityAdjustment: false,
        applyOverageAdjustment: false,
      },
      // Embalagem: uma por unidade acabada, independentemente da dose.
      { itemId: pote.id, quantity: "1", unitCode: "un", basis: "PER_FINISHED_UNIT" },
    ]);

    const dto = await estimar(app, versionId);

    // O motor autoritativo, chamado direto — a mesma base da estimativa.
    const requirements = await computeFormulationRequirements(
      getPrisma(),
      versionId,
      new Prisma.Decimal(versao.basisQuantity),
    );
    expect(requirements).toHaveLength(5);

    for (const requirement of requirements) {
      const linha = linhaDe(dto, requirement.itemId);
      // Igualdade no Decimal TÉCNICO, antes de qualquer apresentação.
      expect(
        new Prisma.Decimal(linha.requiredQuantity).equals(requirement.requiredQuantity),
        `${requirement.itemCode}: requirement ${requirement.requiredQuantity.toString()} × custo ${linha.requiredQuantity}`,
      ).toBe(true);
      expect(linha.stockUnitCode).toBe(requirement.stockUnitCode);
    }

    await app.close();
  });

  it("caso 60×: 200 mg por dose × 60 doses são 0,012 kg — não 0,0002 kg", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await criarItem(app, "kg", "272");
    const { versionId } = await criarVersao(app, [
      { itemId: item.id, quantity: "200", unitCode: "mg", basis: "PER_DOSE" },
    ]);

    const linha = linhaDe(await estimar(app, versionId), item.id);
    // 200 mg × 60 doses = 12 000 mg = 0,012 kg.
    expect(new Prisma.Decimal(linha.requiredQuantity).toFixed(12)).toBe("0.012000000000");
    // 0,012 kg × R$ 272/kg = R$ 3,264.
    expect(linha.estimatedComponentCost).toBe("3.26");
    await app.close();
  });

  it("pureza: teórico 1 kg a 80% exige 1,25 kg físicos, e o custo acompanha", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await criarItem(app, "kg", "100");
    const { versionId } = await criarVersao(
      app,
      [
        {
          itemId: item.id,
          quantity: "1",
          unitCode: "kg",
          basis: "FIXED_BASIS",
          purityPercentApplied: "80",
          quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
          applyPurityAdjustment: true,
        },
      ],
      { doses: null },
    );

    const linha = linhaDe(await estimar(app, versionId), item.id);
    expect(new Prisma.Decimal(linha.requiredQuantity).toFixed(6)).toBe("1.250000");
    expect(linha.estimatedComponentCost).toBe("125.00");
    await app.close();
  });

  it("overage: 20% de perda de processo entra na quantidade que o custo multiplica", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await criarItem(app, "kg", "10");
    const { versionId } = await criarVersao(
      app,
      [
        {
          itemId: item.id,
          quantity: "2",
          unitCode: "kg",
          basis: "FIXED_BASIS",
          overagePercent: "20",
          quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
          applyOverageAdjustment: true,
        },
      ],
      { doses: null },
    );

    const linha = linhaDe(await estimar(app, versionId), item.id);
    expect(new Prisma.Decimal(linha.requiredQuantity).toFixed(6)).toBe("2.400000");
    expect(linha.estimatedComponentCost).toBe("24.00");
    await app.close();
  });

  it("marca desligada não aplica o percentual, mesmo preenchido", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await criarItem(app, "kg", "10");
    const { versionId } = await criarVersao(
      app,
      [
        {
          itemId: item.id,
          quantity: "2",
          unitCode: "kg",
          basis: "FIXED_BASIS",
          purityPercentApplied: "80",
          overagePercent: "20",
          quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
          applyPurityAdjustment: false,
          applyOverageAdjustment: false,
        },
      ],
      { doses: null },
    );

    const linha = linhaDe(await estimar(app, versionId), item.id);
    expect(new Prisma.Decimal(linha.requiredQuantity).toFixed(6)).toBe("2.000000");
    expect(linha.estimatedComponentCost).toBe("20.00");
    await app.close();
  });

  it("física direta ignora pureza preenchida — registrar não é autorizar", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await criarItem(app, "kg", "10");
    const { versionId } = await criarVersao(
      app,
      [
        {
          itemId: item.id,
          quantity: "2",
          unitCode: "kg",
          basis: "FIXED_BASIS",
          purityPercentApplied: "80",
          overagePercent: "20",
          quantityMode: "PHYSICAL_DIRECT",
        },
      ],
      { doses: null },
    );

    const linha = linhaDe(await estimar(app, versionId), item.id);
    expect(new Prisma.Decimal(linha.requiredQuantity).toFixed(6)).toBe("2.000000");
    await app.close();
  });

  it("precisão: a quantidade chega com mais de seis casas, sem arredondar para bater", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await criarItem(app, "kg", "100");
    const { versionId, versao } = await criarVersao(app, [
      {
        itemId: item.id,
        quantity: "200",
        unitCode: "mg",
        basis: "PER_DOSE",
        purityPercentApplied: "97.123456",
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
        applyPurityAdjustment: true,
      },
    ]);

    const linha = linhaDe(await estimar(app, versionId), item.id);
    const doCusto = new Prisma.Decimal(linha.requiredQuantity);
    const [requirement] = await computeFormulationRequirements(
      getPrisma(),
      versionId,
      new Prisma.Decimal(versao.basisQuantity),
    );

    expect(doCusto.equals(requirement!.requiredQuantity)).toBe(true);
    // A igualdade não vem de arredondamento: o valor tem casa significativa
    // além da sexta, e cortá-lo ali mudaria o número.
    expect(doCusto.toFixed(6)).not.toBe(doCusto.toString());
    expect(doCusto.decimalPlaces()).toBeGreaterThan(6);
    await app.close();
  });

  it("material do cliente: quantidade física existe, custo de aquisição Veridi não", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const veridi = await criarItem(app, "kg", "272");
    // Referência manual no item do cliente: nem assim vira custo Veridi.
    const doCliente = await criarItem(app, "kg", "500");

    const { versionId, versao } = await criarVersao(app, [
      { itemId: veridi.id, quantity: "200", unitCode: "mg", basis: "PER_DOSE" },
      {
        itemId: doCliente.id,
        quantity: "50",
        unitCode: "mg",
        basis: "PER_DOSE",
        supplyResponsibility: "CUSTOMER",
      },
    ]);

    const dto = await estimar(app, versionId);
    const linhaCliente = linhaDe(dto, doCliente.id);
    expect(linhaCliente.customerSupplied).toBe(true);
    expect(linhaCliente.unitCost).toBeNull();
    expect(linhaCliente.estimatedComponentCost).toBeNull();
    expect(linhaCliente.costSource).toBe("EXCLUDED_CUSTOMER_SUPPLIED");
    // A quantidade continua sendo a física canônica: 50 mg × 60 = 0,003 kg.
    expect(new Prisma.Decimal(linhaCliente.requiredQuantity).toFixed(12)).toBe("0.003000000000");

    const requirements = await computeFormulationRequirements(
      getPrisma(),
      versionId,
      new Prisma.Decimal(versao.basisQuantity),
    );
    for (const requirement of requirements) {
      expect(
        new Prisma.Decimal(linhaDe(dto, requirement.itemId).requiredQuantity).equals(
          requirement.requiredQuantity,
        ),
      ).toBe(true);
    }

    // Só o material Veridi entra no total: 0,012 kg × R$ 272 = R$ 3,264.
    expect(dto.estimatedMaterialCost).toBe("3.26");
    await app.close();
  });

  it("sem doses por embalagem o custo não existe — não é zero e não é estimado", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await criarItem(app, "kg", "272");
    const { versionId } = await criarVersao(
      app,
      [{ itemId: item.id, quantity: "200", unitCode: "mg", basis: "PER_DOSE" }],
      { doses: null },
    );

    const dto = await estimar(app, versionId);
    expect(dto.quality).toBe("NO_COST");
    expect(dto.estimatedMaterialCost).toBeNull();
    expect(dto.estimatedMaterialUnitCost).toBeNull();
    // Nenhuma linha inventada com quantidade declarada nem com zero.
    expect(dto.components).toHaveLength(0);
    await app.close();
  });

  it("ativar a versão não muda a quantidade: DRAFT e ACTIVE estimam igual", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const item = await criarItem(app, "kg", "272");
    const { versionId } = await criarVersao(app, [
      { itemId: item.id, quantity: "200", unitCode: "mg", basis: "PER_DOSE" },
    ]);

    const rascunho = await estimar(app, versionId);
    const ativacao = await app.inject({
      method: "POST",
      url: `/formulation-versions/${versionId}/activate`,
    });
    expect(ativacao.statusCode, ativacao.body).toBe(200);
    const ativa = await estimar(app, versionId);

    expect(linhaDe(ativa, item.id).requiredQuantity).toBe(linhaDe(rascunho, item.id).requiredQuantity);
    expect(ativa.estimatedMaterialCost).toBe(rascunho.estimatedMaterialCost);
    await app.close();
  });
});
