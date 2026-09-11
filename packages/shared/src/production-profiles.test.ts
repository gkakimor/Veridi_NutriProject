import { describe, expect, it } from "vitest";
import {
  ProductionPlanInputError,
  ProductionProfileDraftNotCopyableError,
  isCapacityResourceType,
  planProductionProfile,
  productionProfileSnapshot,
} from "./production-profiles.js";
import type { ProductionPlanStepInput, ProductionProfileVersionDTO } from "./production-profiles.js";

/**
 * A conta do Perfil de Produção — `PRODUCT_RULES.md` §89.
 *
 * Os números vêm do handoff PLANNING-PRODUCTION-PROFILE-01. A pergunta que
 * mais importa é a da capacidade: 2 operadores por 2 h são uma etapa de 2 h e
 * 4 horas-recurso — nunca uma etapa de 4 h.
 */

const operador = {
  industrialResourceId: "r-op",
  resourceName: "Mão de obra — Produção",
  resourceType: "LABOR" as const,
};
const misturador = {
  industrialResourceId: "r-mix",
  resourceName: "Misturador",
  resourceType: "EQUIPMENT" as const,
};
const encapsuladora = {
  industrialResourceId: "r-enc",
  resourceName: "Encapsuladora",
  resourceType: "EQUIPMENT" as const,
};

function etapa(
  sobre: Partial<ProductionPlanStepInput> & Pick<ProductionPlanStepInput, "sequence" | "name">,
): ProductionPlanStepInput {
  return {
    setupDurationMinutes: 0,
    runDurationMinutes: 120,
    scalingMode: "PROPORTIONAL",
    resources: [],
    ...sobre,
  };
}

const umaEtapa = (sobre: Partial<ProductionPlanStepInput> = {}) => ({
  referenceQuantity: "1000",
  steps: [etapa({ sequence: 1, name: "Etapa", ...sobre })],
});

describe("planProductionProfile — a conta do Perfil de Produção", () => {
  it("proporcional: 2 h por 1.000 un viram 6 h para 3.000 un", () => {
    const plano = planProductionProfile(umaEtapa(), "3000");
    expect(plano.steps[0]).toMatchObject({ batches: null, runMinutes: "360", durationMinutes: "360" });
  });

  it("proporcional: 2 h por 1.000 un viram 3 h para 1.500 un", () => {
    const plano = planProductionProfile(umaEtapa(), "1500");
    expect(plano.steps[0]!.runMinutes).toBe("180");
  });

  it("por lote: 1.500 un em lotes de 1.000 são 2 lotes e 4 h — nunca regra de três", () => {
    const plano = planProductionProfile(umaEtapa({ scalingMode: "BY_BATCH" }), "1500");
    expect(plano.steps[0]).toMatchObject({ batches: 2, runMinutes: "240", durationMinutes: "240" });
  });

  it("por lote: múltiplo exato da base não ganha lote extra, e um pedaço de lote é lote inteiro", () => {
    expect(planProductionProfile(umaEtapa({ scalingMode: "BY_BATCH" }), "3000").steps[0]!.batches).toBe(3);
    expect(planProductionProfile(umaEtapa({ scalingMode: "BY_BATCH" }), "1").steps[0]!.batches).toBe(1);
    expect(planProductionProfile(umaEtapa({ scalingMode: "BY_BATCH" }), "1000.000000000001").steps[0]!.batches).toBe(2);
  });

  it("preparação não escala: 30 min + 6 h = 6h30, e continua 30 min em 3 lotes", () => {
    const proporcional = planProductionProfile(umaEtapa({ setupDurationMinutes: 30 }), "3000");
    expect(proporcional.steps[0]).toMatchObject({
      setupMinutes: "30",
      runMinutes: "360",
      durationMinutes: "390",
    });

    const porLote = planProductionProfile(
      umaEtapa({ setupDurationMinutes: 30, scalingMode: "BY_BATCH" }),
      "3000",
    );
    expect(porLote.steps[0]).toMatchObject({ batches: 3, setupMinutes: "30", durationMinutes: "390" });
  });

  it("2 operadores por 2 h: etapa de 2 h, demanda de 4 horas-recurso", () => {
    const plano = planProductionProfile(
      umaEtapa({ resources: [{ ...operador, resourceQuantity: 2 }] }),
      "1000",
    );
    expect(plano.steps[0]!.durationMinutes).toBe("120");
    expect(plano.steps[0]!.resources[0]!.demandMinutes).toBe("240");
    expect(plano.totalDurationMinutes).toBe("120");
  });

  it("3 máquinas por 2 h: etapa de 2 h, demanda de 6 horas-recurso", () => {
    const plano = planProductionProfile(
      umaEtapa({ resources: [{ ...encapsuladora, resourceQuantity: 3 }] }),
      "1000",
    );
    expect(plano.steps[0]!.durationMinutes).toBe("120");
    expect(plano.resources).toEqual([
      {
        industrialResourceId: "r-enc",
        resourceName: "Encapsuladora",
        resourceType: "EQUIPMENT",
        demandMinutes: "360",
      },
    ]);
  });

  it("etapas sequenciais: o total é a soma das durações, na ordem da sequência", () => {
    // Pesagem 30 min · Mistura 3 h · Encapsulamento 6h30 · Embalagem 3 h = 13 h.
    const plano = planProductionProfile(
      {
        referenceQuantity: "1000",
        steps: [
          etapa({ sequence: 4, name: "Embalagem", runDurationMinutes: 60 }),
          etapa({ sequence: 1, name: "Pesagem", runDurationMinutes: 10 }),
          etapa({ sequence: 3, name: "Encapsulamento", setupDurationMinutes: 30, runDurationMinutes: 120 }),
          etapa({ sequence: 2, name: "Mistura", runDurationMinutes: 60 }),
        ],
      },
      "3000",
    );
    expect(plano.steps.map((s) => [s.name, s.durationMinutes])).toEqual([
      ["Pesagem", "30"],
      ["Mistura", "180"],
      ["Encapsulamento", "390"],
      ["Embalagem", "180"],
    ]);
    expect(plano.totalDurationMinutes).toBe("780");
  });

  it("a demanda do recurso soma entre as etapas e inclui a preparação", () => {
    const plano = planProductionProfile(
      {
        referenceQuantity: "1000",
        steps: [
          etapa({
            sequence: 1,
            name: "Mistura",
            runDurationMinutes: 60,
            resources: [
              { ...operador, resourceQuantity: 2 },
              { ...misturador, resourceQuantity: 1 },
            ],
          }),
          etapa({
            sequence: 2,
            name: "Encapsulamento",
            setupDurationMinutes: 30,
            runDurationMinutes: 120,
            resources: [
              { ...operador, resourceQuantity: 1 },
              { ...encapsuladora, resourceQuantity: 2 },
            ],
          }),
        ],
      },
      "1000",
    );
    // Mistura: 60 min × 2 operadores; Encapsulamento: (30 + 120) min × 1 operador.
    expect(plano.resources.map((r) => [r.resourceName, r.demandMinutes])).toEqual([
      ["Mão de obra — Produção", "270"],
      ["Misturador", "60"],
      ["Encapsuladora", "300"],
    ]);
  });

  it("o recurso fica ocupado na preparação: 30 + 120 min com 2 recursos são 300 min-recurso", () => {
    const plano = planProductionProfile(
      umaEtapa({
        setupDurationMinutes: 30,
        runDurationMinutes: 120,
        resources: [{ ...operador, resourceQuantity: 2 }],
      }),
      "1000",
    );
    expect(plano.steps[0]!.durationMinutes).toBe("150");
    expect(plano.steps[0]!.resources[0]!.demandMinutes).toBe("300");
    expect(plano.resources[0]!.demandMinutes).toBe("300");
  });

  it("Decimal do começo ao fim: 7 min por 1.000 un, para 1.234 un, são 8,638 min exatos", () => {
    const plano = planProductionProfile(umaEtapa({ runDurationMinutes: 7 }), "1234");
    expect(plano.steps[0]!.runMinutes).toBe("8.638");
  });

  it("quantidade zero, negativa ou ilegível é recusada — nunca vira zero", () => {
    for (const ruim of ["0", "-10", "abc", "", "NaN", "Infinity"]) {
      expect(() => planProductionProfile(umaEtapa(), ruim)).toThrow(ProductionPlanInputError);
    }
    expect(() => planProductionProfile({ ...umaEtapa(), referenceQuantity: "0" }, "10")).toThrow(
      ProductionPlanInputError,
    );
  });

  it("quantidade de recursos zero ou fracionária é recusada pelo motor também", () => {
    for (const ruim of [0, 1.5, -1]) {
      expect(() =>
        planProductionProfile(umaEtapa({ resources: [{ ...operador, resourceQuantity: ruim }] }), "1000"),
      ).toThrow(ProductionPlanInputError);
    }
  });

  it("energia não é recurso de capacidade; mão de obra e equipamento são", () => {
    expect(isCapacityResourceType("ENERGY")).toBe(false);
    expect(isCapacityResourceType("LABOR")).toBe(true);
    expect(isCapacityResourceType("EQUIPMENT")).toBe(true);
  });
});

function versao(sobre: Partial<ProductionProfileVersionDTO> = {}): ProductionProfileVersionDTO {
  return {
    id: "ppv-1",
    productionProfileId: "ppr-1",
    profileCode: "PPR-000001",
    profileName: "Cápsulas — linha padrão",
    versionNumber: 1,
    versionLabel: "V1",
    status: "ACTIVE",
    referenceQuantity: "1000",
    referenceUomCode: "un",
    notes: null,
    steps: [
      {
        id: "st-1",
        sequence: 1,
        name: "Mistura",
        description: "Misturar até homogeneizar",
        setupDurationMinutes: 15,
        runDurationMinutes: 60,
        scalingMode: "BY_BATCH",
        resources: [
          {
            id: "sr-1",
            industrialResourceId: "r-mix",
            resourceCode: "RIN-000002",
            resourceName: "Misturador",
            resourceType: "EQUIPMENT",
            resourceActive: true,
            resourceQuantity: 1,
            notes: null,
            sortOrder: 0,
          },
        ],
      },
    ],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: "2026-09-11T12:10:00.000Z",
    activatedBy: "Admin",
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    ...sobre,
  };
}

describe("productionProfileSnapshot — o contrato da cópia para a OP (PLANNING-OP-SNAPSHOT-01)", () => {
  it("copia a versão inteira POR VALOR: mudar a origem depois não muda a cópia", () => {
    const origem = versao();
    const copia = productionProfileSnapshot(origem);

    expect(copia).toEqual({
      sourceProfileId: "ppr-1",
      sourceProfileCode: "PPR-000001",
      sourceProfileName: "Cápsulas — linha padrão",
      sourceVersionId: "ppv-1",
      sourceVersionNumber: 1,
      referenceQuantity: "1000",
      referenceUomCode: "un",
      steps: [
        {
          sequence: 1,
          name: "Mistura",
          description: "Misturar até homogeneizar",
          setupDurationMinutes: 15,
          runDurationMinutes: 60,
          scalingMode: "BY_BATCH",
          resources: [
            {
              industrialResourceId: "r-mix",
              resourceCode: "RIN-000002",
              resourceName: "Misturador",
              resourceType: "EQUIPMENT",
              resourceQuantity: 1,
            },
          ],
        },
      ],
    });

    origem.steps[0]!.name = "Mistura rápida";
    origem.steps[0]!.resources[0]!.resourceQuantity = 4;
    expect(copia.steps[0]!.name).toBe("Mistura");
    expect(copia.steps[0]!.resources[0]!.resourceQuantity).toBe(1);
  });

  it("rascunho não é copiável — ainda muda", () => {
    expect(() => productionProfileSnapshot(versao({ status: "DRAFT" }))).toThrow(
      ProductionProfileDraftNotCopyableError,
    );
  });
});
