import type {
  FormulationComponentDTO,
  FormulationTemplateComponentDTO,
  FormulationTemplateVersionDTO,
  FormulationVersionDTO,
} from "@veridi/shared";
import { versaoCapsula, versaoLonga, versaoPo } from "./technical-sheet-fixtures";

export { UNIDADES } from "./technical-sheet-fixtures";

/**
 * As MESMAS receitas de referência da ficha do Produto, gravadas como versão
 * de Modelo de Formulação.
 *
 * O Modelo guarda a receita com os mesmos nomes, mas SEM os derivados que a
 * API calcula para a Formulação (alvo e física por dose, por cápsula, por
 * embalagem). Tirar esses campos e deixar a ficha do Modelo recalculá-los pelo
 * motor é o que permite provar a paridade: a mesma receita tem de sair com o
 * mesmo corpo técnico nas duas fichas.
 */

/** O componente da Formulação sem o que a API calcula — como o Modelo o guarda. */
export function componenteDoModelo(component: FormulationComponentDTO): FormulationTemplateComponentDTO {
  return {
    id: component.id,
    itemId: component.itemId,
    itemCode: component.itemCode,
    itemName: component.itemName,
    itemType: component.itemType,
    itemActive: component.itemActive,
    quantity: component.quantity,
    unitCode: component.unitCode,
    basis: component.basis,
    supplyResponsibility: component.supplyResponsibility,
    purityPercentApplied: component.purityPercentApplied,
    overagePercent: component.overagePercent,
    quantityMode: component.quantityMode,
    applyPurityAdjustment: component.applyPurityAdjustment,
    applyOverageAdjustment: component.applyOverageAdjustment,
    notes: component.notes,
    position: component.position,
    stockUnitCode: component.stockUnitCode,
    itemSourceName: component.itemSourceName,
    itemDeclaredNutrient: component.itemDeclaredNutrient,
    itemFamily: component.itemFamily,
    itemPackagingSubtype: component.itemPackagingSubtype,
    itemDefaultPurityPercent: component.itemDefaultPurityPercent,
    itemExternalCode: component.itemExternalCode,
  };
}

/** A versão da Formulação reescrita como versão de Modelo. */
export function modeloDe(
  version: FormulationVersionDTO,
  overrides: Partial<FormulationTemplateVersionDTO> = {},
): FormulationTemplateVersionDTO {
  return {
    id: `ftv-${version.id}`,
    formulationTemplateId: "ft-referencia",
    templateCode: "FT-000001",
    templateName: "Matriz de referência",
    versionNumber: version.versionNumber,
    versionLabel: version.versionLabel,
    status: version.status === "INACTIVE" ? "ARCHIVED" : version.status,
    basisQuantity: version.basisQuantity,
    calculationMode: version.calculationMode,
    dosesPerPackage: version.dosesPerPackage,
    dosageForm: version.dosageForm,
    presentationType: version.presentationType,
    capsulesPerDose: version.capsulesPerDose,
    capsulesPerPackage: version.capsulesPerPackage,
    doseAmount: version.doseAmount,
    doseUomCode: version.doseUomCode,
    packageContentAmount: version.packageContentAmount,
    packageContentUomCode: version.packageContentUomCode,
    expectedLossPercent: version.expectedLossPercent,
    outputUnitCode: version.outputUnitCode,
    notes: version.notes,
    components: version.components.map(componenteDoModelo),
    createdAt: version.createdAt,
    createdBy: version.createdBy,
    activatedAt: version.activatedAt,
    activatedBy: version.activatedBy,
    archivedAt: null,
    sourceVersionId: version.sourceVersionId,
    sourceVersionNumber: version.sourceVersionNumber,
    usageCount: 0,
    componentIssues: [],
    ...overrides,
  };
}

/** Modelo em CÁPSULA, rascunho — a receita do Ácido Fólico (7 MP, 6 embalagens). */
export function modeloCapsula(
  overrides: Partial<FormulationTemplateVersionDTO> = {},
): FormulationTemplateVersionDTO {
  return modeloDe(versaoCapsula(), {
    templateCode: "FT-000001",
    templateName: "Base multivitamínica — cápsula 120",
    ...overrides,
  });
}

/** Modelo em PÓ, ativo — a receita do Beef Protein (8 MP, 5 embalagens). */
export function modeloPo(
  overrides: Partial<FormulationTemplateVersionDTO> = {},
): FormulationTemplateVersionDTO {
  return modeloDe(versaoPo(), {
    templateCode: "FT-000002",
    templateName: "Base proteica — pó 900 g",
    ...overrides,
  });
}

/** Modelo LONGO — 48 matérias-primas e 12 embalagens: a paginação. */
export function modeloLongo(): FormulationTemplateVersionDTO {
  return modeloDe(versaoLonga(), {
    templateCode: "FT-000009",
    templateName: "Matriz longa de referência",
  });
}

/**
 * Modelo LEGADO — gravado antes da bancada: sem forma, sem apresentação, sem
 * cápsulas nem dose, e a receita em BASE FIXA (22 kg para 300 unidades), como
 * as matrizes antigas da planilha.
 */
export function modeloLegado(
  overrides: Partial<FormulationTemplateVersionDTO> = {},
): FormulationTemplateVersionDTO {
  const base = modeloCapsula();
  const [primeira, segunda] = base.components;
  const embalagem = base.components.find((component) => component.itemType === "PACKAGING")!;
  return {
    ...base,
    id: "ftv-legado-1",
    templateCode: "FT-000003",
    templateName: "Matriz legada — base fixa",
    status: "ACTIVE",
    createdAt: "2026-08-01T12:00:00.000Z",
    activatedAt: "2026-08-10T12:00:00.000Z",
    activatedBy: "Qualidade",
    basisQuantity: "300",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    dosageForm: null,
    presentationType: null,
    capsulesPerDose: null,
    capsulesPerPackage: null,
    doseAmount: null,
    doseUomCode: null,
    packageContentAmount: null,
    packageContentUomCode: null,
    expectedLossPercent: null,
    components: [
      /* 22 kg para 300 unidades, pureza 70% autorizada: 22 ÷ 300 ÷ 0,7 kg por unidade. */
      { ...primeira!, basis: "FIXED_BASIS", quantity: "22", unitCode: "kg", position: 0 },
      /* Sem pureza registrada: a física é a teórica. */
      {
        ...segunda!,
        basis: "FIXED_BASIS",
        quantity: "3",
        unitCode: "kg",
        purityPercentApplied: null,
        applyPurityAdjustment: false,
        position: 1,
      },
      { ...embalagem, position: 2 },
    ],
    ...overrides,
  };
}
