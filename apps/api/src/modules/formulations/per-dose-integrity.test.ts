import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import {
  FormulationContextIncompleteError,
  computeComponentRequirement,
  missingFormulationContext,
} from "../../lib/formulation-math.js";

/**
 * Integridade da formulação por dose — hotfix do CRITICAL da auditoria
 * VAL-LEG-01.
 *
 * O defeito real: uma versão `FIXED_BASIS` com quatro componentes
 * `PER_DOSE` e `dosesPerPackage` nulo. O motor fazia `dosesPerPackage ?? 0`,
 * cada material saía com necessidade ZERO, e o custo industrial se declarava
 * "Completo — referências reais de compra" com material R$ 0,00.
 *
 * Estes testes reproduzem o cenário auditado com os números reais e provam
 * as três barreiras: motor, ativação e completude do custo.
 *
 * Fixtures próprias do arquivo. Nenhuma leitura global, nenhum `deleteMany`
 * sem escopo — este hotfix nasceu de auditoria, e um teste que passa por
 * acidente aqui esconde exatamente o que ele deveria pegar.
 */

const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureTemplateIds: string[] = [];
const fixtureCostVersionIds: string[] = [];

type App = ReturnType<typeof buildTestApp>;

/** Os quatro componentes do produto auditado (0250PL, THE KING). */
const RECEITA = [
  { rotulo: "Cafeina", mgPorDose: "200", pureza: "90", precoKg: "272", esperadoKg: "1.2" },
  { rotulo: "Dioxido", mgPorDose: "5", pureza: null, precoKg: "32", esperadoKg: "0.03" },
  { rotulo: "Celulose", mgPorDose: "253", pureza: null, precoKg: "26", esperadoKg: "1.518" },
  { rotulo: "Estearato", mgPorDose: "20", pureza: null, precoKg: "29.90", esperadoKg: "0.12" },
];

const DOSES = 60;
const EMBALAGENS = 100;

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
  if (fixtureCostVersionIds.length > 0) {
    await prisma.industrialCostCalculation.deleteMany({
      where: { industrialCostVersionId: { in: fixtureCostVersionIds } },
    });
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialCostVersionId: { in: fixtureCostVersionIds } },
    });
    await prisma.industrialCostLine.deleteMany({
      where: { industrialCostVersionId: { in: fixtureCostVersionIds } },
    });
    await prisma.industrialCostVersion.deleteMany({
      where: { id: { in: fixtureCostVersionIds } },
    });
  }
  if (fixtureTemplateIds.length > 0) {
    await prisma.formulationTemplateComponent.deleteMany({
      where: { formulationTemplateVersion: { formulationTemplateId: { in: fixtureTemplateIds } } },
    });
    await prisma.formulationTemplateVersion.deleteMany({
      where: { formulationTemplateId: { in: fixtureTemplateIds } },
    });
    await prisma.formulationTemplate.deleteMany({ where: { id: { in: fixtureTemplateIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({
      where: { productId: { in: fixtureProductIds } },
    });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  // Nenhum lote, recebimento ou compra é criado aqui: o cenário para no
  // custo prospectivo, que é onde o defeito vivia.
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const UNIDADES = [
  {
    code: "kg",
    label: "Quilograma",
    dimension: "MASS" as const,
    toBaseFactor: new Prisma.Decimal("1000"),
  },
  {
    code: "mg",
    label: "Miligrama",
    dimension: "MASS" as const,
    toBaseFactor: new Prisma.Decimal("0.001"),
  },
];

async function criarItem(app: App, rotulo: string, pureza: string | null) {
  const response = await app.inject({
    method: "POST",
    url: "/items",
    payload: {
      type: "RAW_MATERIAL",
      name: `${rotulo} PD ${marca()}`,
      unitCode: "kg",
      ...(pureza ? { defaultPurityPercent: pureza } : {}),
    },
  });
  const item = response.json();
  fixtureItemIds.push(item.id);
  return item;
}

async function criarProduto(app: App) {
  const acabado = (
    await app.inject({
      method: "POST",
      url: "/items",
      payload: { type: "FINISHED_PRODUCT", name: `PA PD ${marca()}`, unitCode: "un" },
    })
  ).json();
  fixtureItemIds.push(acabado.id);

  const product = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: { name: `Cafeina PD ${marca()}`, finishedProductItemId: acabado.id },
    })
  ).json();
  fixtureProductIds.push(product.id);
  return product;
}

/**
 * Rascunho no arranjo exato da auditoria: modo `FIXED_BASIS`, componentes
 * `PER_DOSE`, doses em branco.
 */
async function criarRascunhoAuditado(app: App, doses: number | null = null) {
  const product = await criarProduto(app);
  const itens: { id: string }[] = [];
  for (const linha of RECEITA) itens.push(await criarItem(app, linha.rotulo, linha.pureza));

  const version = (
    await app.inject({
      method: "POST",
      url: `/products/${product.id}/formulation-versions`,
      payload: {},
    })
  ).json();

  const atualizada = await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${version.id}`,
    payload: {
      basisQuantity: "1",
      calculationMode: "FIXED_BASIS",
      dosesPerPackage: doses,
      components: RECEITA.map((linha, index) => ({
        itemId: itens[index]!.id,
        quantity: linha.mgPorDose,
        unitCode: "mg",
        basis: "PER_DOSE",
        supplyResponsibility: "VERIDI",
        ...(linha.pureza ? { purityPercentApplied: linha.pureza } : {}),
      })),
    },
  });

  return { product, itens, version: atualizada.json() };
}

describe("Motor: doses por embalagem ausente nunca vira zero", () => {
  const componente = {
    basis: "PER_DOSE" as const,
    quantity: new Prisma.Decimal("200"),
    unitCode: "mg",
    stockUnitCode: "kg",
    purityPercentApplied: null,
    overagePercent: null,
  };

  it("null recusa o cálculo em vez de devolver 0 kg", () => {
    expect(() =>
      computeComponentRequirement(componente, new Prisma.Decimal(EMBALAGENS), {
        basisQuantity: new Prisma.Decimal("1"),
        dosesPerPackage: null,
      }, UNIDADES),
    ).toThrow(FormulationContextIncompleteError);
  });

  it("zero é premissa inválida, não uma fórmula sem material", () => {
    expect(() =>
      computeComponentRequirement(componente, new Prisma.Decimal(EMBALAGENS), {
        basisQuantity: new Prisma.Decimal("1"),
        dosesPerPackage: 0,
      }, UNIDADES),
    ).toThrow(FormulationContextIncompleteError);
  });

  it("negativo é inválido", () => {
    expect(() =>
      computeComponentRequirement(componente, new Prisma.Decimal(EMBALAGENS), {
        basisQuantity: new Prisma.Decimal("1"),
        dosesPerPackage: -60,
      }, UNIDADES),
    ).toThrow(FormulationContextIncompleteError);
  });

  it("reproduz as quantidades reais do caso auditado: 100 embalagens × 60 doses", () => {
    for (const linha of RECEITA) {
      const requirement = computeComponentRequirement(
        {
          basis: "PER_DOSE",
          quantity: new Prisma.Decimal(linha.mgPorDose),
          unitCode: "mg",
          stockUnitCode: "kg",
          purityPercentApplied: null,
          overagePercent: null,
        },
        new Prisma.Decimal(EMBALAGENS),
        { basisQuantity: new Prisma.Decimal("1"), dosesPerPackage: DOSES },
        UNIDADES,
      );
      // Teórico, antes de pureza — é o número que a auditoria calculou à mão.
      expect(requirement.theoreticalQuantity.toString()).toBe(linha.esperadoKg);
      expect(requirement.requiredQuantity.greaterThan(0)).toBe(true);
    }
  });

  it("pureza continua exigindo mais massa — 90% na cafeína", () => {
    const requirement = computeComponentRequirement(
      {
        basis: "PER_DOSE",
        quantity: new Prisma.Decimal("200"),
        unitCode: "mg",
        stockUnitCode: "kg",
        purityPercentApplied: new Prisma.Decimal("90"),
        overagePercent: null,
      },
      new Prisma.Decimal(EMBALAGENS),
      { basisQuantity: new Prisma.Decimal("1"), dosesPerPackage: DOSES },
      UNIDADES,
    );
    expect(requirement.theoreticalQuantity.toString()).toBe("1.2");
    // 1,2 ÷ 0,90 — mais massa para entregar o mesmo teor.
    expect(requirement.requiredQuantity.toFixed(6)).toBe("1.333333");
  });

  it("fórmula que não depende de doses continua calculando sem o campo", () => {
    const requirement = computeComponentRequirement(
      {
        basis: "FIXED_BASIS",
        quantity: new Prisma.Decimal("2"),
        unitCode: "kg",
        stockUnitCode: "kg",
        purityPercentApplied: null,
        overagePercent: null,
      },
      new Prisma.Decimal("500"),
      { basisQuantity: new Prisma.Decimal("100"), dosesPerPackage: null },
      UNIDADES,
    );
    expect(requirement.requiredQuantity.toString()).toBe("10");
  });

  it("a pergunta é sobre a base do COMPONENTE, não sobre o modo da versão", () => {
    // Exatamente o arranjo que passou pelo gate antigo.
    expect(
      missingFormulationContext([{ basis: "PER_DOSE" }], { dosesPerPackage: null }),
    ).toBe("DOSES_PER_PACKAGE");
    expect(
      missingFormulationContext([{ basis: "FIXED_BASIS" }], { dosesPerPackage: null }),
    ).toBeNull();
    expect(
      missingFormulationContext([{ basis: "PER_DOSE" }], { dosesPerPackage: DOSES }),
    ).toBeNull();
  });
});

describe("Ativação da formulação", () => {
  const app = buildTestApp();

  it("rascunho pode ficar incompleto, mas ativar sem doses é recusado", async () => {
    const { version } = await criarRascunhoAuditado(app, null);

    // Rascunho aceita: é onde a premissa vai ser informada.
    expect(version.status).toBe("DRAFT");
    expect(version.components).toHaveLength(RECEITA.length);
    // E não mente sobre quantidade: sem premissa, não há número.
    expect(version.components[0].physicalPerUnit).toBeNull();

    const recusa = await app.inject({
      method: "POST",
      url: `/formulation-versions/${version.id}/activate`,
    });
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().error).toBe("activation_blocked");
    expect(recusa.json().message).toContain("doses por embalagem");
  });

  it("com doses informadas, ativa e passa a quantificar material", async () => {
    const { version } = await criarRascunhoAuditado(app, null);

    const comDoses = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${version.id}`,
      payload: { dosesPerPackage: DOSES },
    });
    expect(comDoses.statusCode).toBe(200);
    expect(comDoses.json().dosesPerPackage).toBe(DOSES);
    // 200 mg × 60 doses = 12 g = 0,012 kg por unidade acabada.
    expect(comDoses.json().components[0].theoreticalPerUnit).toBe("0.012");

    const ativada = await app.inject({
      method: "POST",
      url: `/formulation-versions/${version.id}/activate`,
    });
    expect(ativada.statusCode).toBe(200);
    expect(ativada.json().status).toBe("ACTIVE");
  });

  it("nova versão a partir da ativa permite corrigir a premissa herdada", async () => {
    // Reproduz a recuperação que o Caso 01 vai precisar: V1 ativa sem
    // doses (legado), V2 rascunho onde se informa, V2 ativa.
    const { version } = await criarRascunhoAuditado(app, DOSES);
    await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });

    const prisma = getPrisma();
    // Volta a V1 ao estado legado inválido — sem passar pelo gate, que é
    // justamente o que aconteceu antes deste hotfix existir.
    await prisma.formulationVersion.update({
      where: { id: version.id },
      data: { dosesPerPackage: null },
    });

    const v2 = await app.inject({
      method: "POST",
      url: `/formulation-versions/${version.id}/new-version`,
    });
    expect(v2.statusCode).toBe(201);
    const rascunho = v2.json();
    // Herda o nulo do legado — e é isso mesmo: nada é preenchido sozinho.
    expect(rascunho.dosesPerPackage).toBeNull();

    const corrigida = await app.inject({
      method: "PATCH",
      url: `/formulation-versions/${rascunho.id}`,
      payload: { dosesPerPackage: DOSES },
    });
    expect(corrigida.json().dosesPerPackage).toBe(DOSES);

    const ativada = await app.inject({
      method: "POST",
      url: `/formulation-versions/${rascunho.id}/activate`,
    });
    expect(ativada.statusCode).toBe(200);

    // V1 continua histórica e intacta, com o nulo que tinha.
    const v1 = await prisma.formulationVersion.findUniqueOrThrow({ where: { id: version.id } });
    expect(v1.status).toBe("INACTIVE");
    expect(v1.dosesPerPackage).toBeNull();
  });
});

describe("Custo industrial não se declara completo sobre formulação inválida", () => {
  const app = buildTestApp();

  /**
   * Formulação ativa inválida — o registro legado do §9: ativada antes do
   * gate existir. Nada é migrado nem desativado; o que muda é que o cálculo
   * falha fechado.
   */
  async function cenarioLegadoInvalido() {
    const { product, itens, version } = await criarRascunhoAuditado(app, DOSES);
    await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });

    const prisma = getPrisma();
    await prisma.formulationVersion.update({
      where: { id: version.id },
      data: { dosesPerPackage: null },
    });

    const estrutura = (
      await app.inject({
        method: "POST",
        url: `/products/${product.id}/industrial-costs`,
        payload: { referenceOutputQuantity: String(EMBALAGENS), referenceOutputUomCode: "un" },
      })
    ).json();
    fixtureCostVersionIds.push(estrutura.id);

    return { product, itens, version, estrutura };
  }

  it("estrutura acusa pendência bloqueante e não fica completa", async () => {
    const { product, estrutura } = await cenarioLegadoInvalido();

    const lida = await app.inject({ method: "GET", url: `/products/${product.id}/industrial-costs` });
    const corpo = lida.json();
    const versao = corpo.versions.find((row: { id: string }) => row.id === estrutura.id);
    expect(versao?.complete).toBe(false);

    const pendencia = (corpo.draft ?? versao).pendencies.find(
      (row: { code: string }) => row.code === "FORMULATION_DOSES_MISSING",
    );
    expect(pendencia).toBeTruthy();
    expect(pendencia.severity).toBe("BLOCKING");
    expect(pendencia.target).toBe("FORMULATION");
  });

  it("cálculo não devolve material R$ 0,00 nem qualidade COMPLETE", async () => {
    const { estrutura } = await cenarioLegadoInvalido();

    const calculo = await app.inject({
      method: "GET",
      url: `/industrial-costs/${estrutura.id}/calculate`,
    });
    expect(calculo.statusCode).toBe(200);
    const resultado = calculo.json();

    // Nenhuma linha de material fingindo custo conhecido.
    expect(resultado.materials).toHaveLength(0);
    expect(resultado.quality).not.toBe("COMPLETE_REAL_REFERENCE");
    expect(resultado.quality).not.toBe("COMPLETE_WITH_ESTIMATES");
    expect(resultado.directIndustrialCost).toBeNull();
    expect(resultado.totalIndustrialCost).toBeNull();

    const aviso = resultado.warnings.find(
      (row: { code: string }) => row.code === "FORMULATION_DOSES_MISSING",
    );
    expect(aviso).toBeTruthy();
    expect(aviso.target).toBe("FORMULATION");
    expect(aviso.message).toContain("doses por embalagem");
  });

  it("salvar o cálculo é recusado — documento enganoso não vira histórico", async () => {
    const { estrutura } = await cenarioLegadoInvalido();

    const salvo = await app.inject({
      method: "POST",
      url: `/industrial-costs/${estrutura.id}/calculations`,
      payload: { costReferenceDate: new Date().toISOString() },
    });
    expect(salvo.statusCode).toBe(409);
    expect(salvo.json().error).toBe("formulation_incomplete");
  });
});

describe("Template de formulação não vira caminho novo para fórmula inválida", () => {
  const app = buildTestApp();

  it("matriz com componente por dose não ativa sem doses", async () => {
    const item = await criarItem(app, "Cafeina TPL", null);

    const template = (
      await app.inject({
        method: "POST",
        url: "/formulation-templates",
        payload: { name: `TPL PD ${marca()}`, basisQuantity: "1", calculationMode: "FIXED_BASIS" },
      })
    ).json();
    fixtureTemplateIds.push(template.id);

    const rascunho = template.draftVersion;
    const recusa = await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${rascunho.id}`,
      payload: {
        components: [{ itemId: item.id, quantity: "200", unitCode: "mg", basis: "PER_DOSE" }],
      },
    });
    // A premissa é cobrada já na edição: o componente por dose a exige.
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().error).toBe("invalid_component");

    const aceita = await app.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${rascunho.id}`,
      payload: {
        dosesPerPackage: DOSES,
        components: [{ itemId: item.id, quantity: "200", unitCode: "mg", basis: "PER_DOSE" }],
      },
    });
    expect(aceita.statusCode).toBe(200);
    // Modo FIXED_BASIS não apaga mais as doses que o componente usa.
    expect(aceita.json().dosesPerPackage).toBe(DOSES);

    const ativada = await app.inject({
      method: "POST",
      url: `/formulation-template-versions/${rascunho.id}/activate`,
    });
    expect(ativada.statusCode).toBe(200);
  });

  it("salvar como template leva as doses junto, e aplicar as devolve", async () => {
    const { version } = await criarRascunhoAuditado(app, DOSES);
    await app.inject({ method: "POST", url: `/formulation-versions/${version.id}/activate` });

    const template = (
      await app.inject({
        method: "POST",
        url: `/formulation-versions/${version.id}/save-as-template`,
        payload: { name: `TPL origem ${marca()}` },
      })
    ).json();
    fixtureTemplateIds.push(template.id);

    const rascunhoTemplate = template.draftVersion ?? template.activeVersion;
    expect(rascunhoTemplate.dosesPerPackage).toBe(DOSES);

    // Só matriz ATIVA é aplicável — rascunho ainda está sendo escrito.
    const versaoTemplate = (
      await app.inject({
        method: "POST",
        url: `/formulation-template-versions/${rascunhoTemplate.id}/activate`,
      })
    ).json();
    expect(versaoTemplate.dosesPerPackage).toBe(DOSES);

    // Aplicar noutro produto: a premissa viaja com a matriz.
    const outro = await criarProduto(app);
    const aplicada = await app.inject({
      method: "POST",
      url: `/products/${outro.id}/formulation-versions/from-template`,
      payload: { formulationTemplateVersionId: versaoTemplate.id },
    });
    expect(aplicada.statusCode).toBe(201);
    expect(aplicada.json().dosesPerPackage).toBe(DOSES);
  });
});
