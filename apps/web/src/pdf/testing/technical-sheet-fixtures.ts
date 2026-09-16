import { calcularQuantidadeDaDose, calcularQuantidadeDoComponente } from "@veridi/shared";
import type {
  FormulationComponentDTO,
  FormulationVersionDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";

/**
 * As duas formulações de referência da homologação, como a API as entrega.
 *
 * `EX-FORM-ACF-120` (Exemplo — Ácido Fólico PT 120 Caps): cápsula, 7
 * matérias-primas e 6 embalagens. `EX-FORM-BEEF-900` (Exemplo — Beef Protein
 * Abacaxi 900 g): pó, 8 matérias-primas e 5 embalagens. Os números — alvo,
 * pureza, reserva, dose — são os das versões reais do banco de desenvolvimento.
 *
 * As grandezas DERIVADAS (alvo e física por dose, por cápsula, por embalagem)
 * saem aqui dos MESMOS helpers de `@veridi/shared` que a API chama para montar
 * o DTO. Digitá-las à mão produziria um documento provado contra números que o
 * servidor nunca mandaria.
 */

export const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
  { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

const MOTOR = UNIDADES.map((unidade) => ({
  code: unidade.code,
  dimension: unidade.dimension,
  toBaseFactor: unidade.toBaseFactor,
}));

/** A matéria-prima como a receita a declara, antes de o motor responder. */
interface Materia {
  code: string;
  name: string;
  sourceName?: string;
  declaredNutrient?: string | null;
  family?: FormulationComponentDTO["itemFamily"];
  quantity: string;
  unitCode?: string;
  stockUnitCode?: string;
  purity: string | null;
  overage: string | null;
  /** Pureza do cadastro HOJE — só diverge quando o Item mudou desde a versão. */
  purityHoje?: string | null;
  supply?: FormulationComponentDTO["supplyResponsibility"];
  active?: boolean;
}

interface Embalagem {
  code: string;
  name: string;
  quantity: string;
  supply?: FormulationComponentDTO["supplyResponsibility"];
}

interface Premissas {
  dosesPerPackage: number;
  capsulesPerDose: number | null;
  basisQuantity: string;
}

function materiaPrima(
  materia: Materia,
  premissas: Premissas,
  position: number,
): FormulationComponentDTO {
  const unitCode = materia.unitCode ?? "mg";
  const stockUnitCode = materia.stockUnitCode ?? "kg";
  const entrada = {
    basis: "PER_DOSE" as const,
    quantity: materia.quantity,
    unitCode,
    purityPercent: materia.purity,
    overagePercent: materia.overage,
    /*
     * Pureza AUTORIZADA, reserva registrada e não autorizada: é assim que as
     * duas versões de referência estão gravadas — a reserva é premissa de
     * compra, não entra na dose.
     */
    quantityMode: "THEORETICAL_WITH_ADJUSTMENTS" as const,
    applyPurityAdjustment: materia.purity !== null,
    applyOverageAdjustment: false,
  };
  const dose = calcularQuantidadeDaDose(entrada, premissas.capsulesPerDose, MOTOR);
  const porUnidade = calcularQuantidadeDoComponente(
    { ...entrada, stockUnitCode },
    "1",
    { basisQuantity: premissas.basisQuantity, dosesPerPackage: premissas.dosesPerPackage },
    MOTOR,
  );
  const comDose = dose !== null && typeof dose !== "string" ? dose : null;
  const comUnidade = typeof porUnidade === "string" ? null : porUnidade;
  return {
    id: `comp-${materia.code}`,
    itemId: `item-${materia.code}`,
    itemCode: materia.code,
    itemName: materia.name,
    itemType: "RAW_MATERIAL",
    itemActive: materia.active ?? true,
    quantity: materia.quantity,
    unitCode,
    basis: "PER_DOSE",
    supplyResponsibility: materia.supply ?? "VERIDI",
    purityPercentApplied: materia.purity,
    overagePercent: materia.overage,
    quantityMode: entrada.quantityMode,
    applyPurityAdjustment: entrada.applyPurityAdjustment,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    stockUnitCode,
    theoreticalPerUnit: comUnidade ? comUnidade.theoretical.toFixed() : null,
    physicalPerUnit: comUnidade ? comUnidade.physical.toFixed() : null,
    itemSourceName: materia.sourceName ?? materia.name,
    itemDeclaredNutrient: materia.declaredNutrient ?? null,
    itemFamily: materia.family ?? null,
    itemPackagingSubtype: null,
    itemDefaultPurityPercent: materia.purityHoje ?? null,
    itemExternalCode: null,
    theoreticalPerDose: comDose ? comDose.teorica.toFixed() : null,
    physicalPerDose: comDose ? comDose.fisica.toFixed() : null,
    physicalPerCapsule: comDose && comDose.porCapsula ? comDose.porCapsula.toFixed() : null,
    notes: null,
    position,
  };
}

function itemDeEmbalagem(embalagem: Embalagem, position: number): FormulationComponentDTO {
  return {
    id: `comp-${embalagem.code}`,
    itemId: `item-${embalagem.code}`,
    itemCode: embalagem.code,
    itemName: embalagem.name,
    itemType: "PACKAGING",
    itemActive: true,
    quantity: embalagem.quantity,
    unitCode: "un",
    basis: "PER_FINISHED_UNIT",
    supplyResponsibility: embalagem.supply ?? "VERIDI",
    purityPercentApplied: null,
    overagePercent: null,
    quantityMode: "PHYSICAL_DIRECT",
    applyPurityAdjustment: false,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    stockUnitCode: "un",
    theoreticalPerUnit: embalagem.quantity,
    physicalPerUnit: embalagem.quantity,
    itemSourceName: null,
    itemDeclaredNutrient: null,
    itemFamily: "PACKAGING",
    itemPackagingSubtype: null,
    itemDefaultPurityPercent: null,
    itemExternalCode: null,
    theoreticalPerDose: null,
    physicalPerDose: null,
    physicalPerCapsule: null,
    notes: null,
    position,
  };
}

/** As matérias-primas do Ácido Fólico, na ordem da planilha. */
const ACIDO_FOLICO: Materia[] = [
  {
    code: "MP-000030",
    name: "L-metilfolato de cálcio",
    declaredNutrient: "Ácido Fólico",
    family: "VITAMIN",
    quantity: "0.4",
    purity: "70",
    overage: "10",
    // O cadastro subiu para 88,7% depois desta versão — a ficha mostra as duas.
    purityHoje: "88.7",
  },
  {
    code: "MP-000013",
    name: "Cloridrato de piridoxina",
    declaredNutrient: "Vitamina B6",
    family: "VITAMIN",
    quantity: "1.9",
    purity: "70",
    overage: "10",
    purityHoje: "98",
  },
  {
    code: "MP-000007",
    name: "Metilcobalamina",
    declaredNutrient: "Vitamina B12",
    family: "VITAMIN",
    quantity: "0.0026",
    purity: "70",
    overage: "10",
  },
  {
    code: "MP-000369",
    name: "Dióxido de Silício",
    family: "EXCIPIENT",
    quantity: "5",
    purity: "100",
    overage: "10",
    purityHoje: "100",
  },
  {
    code: "MP-000370",
    name: "Estearato de Magnésio",
    family: "EXCIPIENT",
    quantity: "20",
    purity: "100",
    overage: "10",
    purityHoje: "100",
  },
  {
    code: "MP-000120",
    name: "Celulose microcristalina 101",
    family: "EXCIPIENT",
    quantity: "5",
    purity: "100",
    overage: "10",
    purityHoje: "100",
  },
  {
    code: "MP-000259",
    name: "Carbonato de cálcio",
    declaredNutrient: "Cálcio",
    family: "MINERAL",
    quantity: "500",
    purity: "100",
    overage: "10",
    purityHoje: "100",
  },
];

const EMBALAGEM_DA_CAPSULA: Embalagem[] = [
  { code: "ME-000134", name: "Exemplo - CAPS 0 BCA/BCA 311/311", quantity: "120" },
  { code: "ME-000030", name: "POTE R220 PET 45 TRANSPARANTE HENRIPLAST", quantity: "1" },
  { code: "ME-000029", name: "TAMPA FLIP TOP 18785 BRANCA HENRIPLAST", quantity: "1" },
  { code: "ME-000005", name: "SÍLICA GEL BRANCA EM CÁPSULA SG", quantity: "1" },
  { code: "ME-000135", name: "Exemplo - Cartucho Sleeve", quantity: "1" },
  { code: "ME-000019", name: "CAIXA DE PAPELÃO G", quantity: "1" },
];

const BEEF_PROTEIN: Materia[] = [
  { code: "MP-000498", name: "PROTEÍNA BOVINA", quantity: "26000", purity: "95", overage: "2" },
  { code: "MP-000458", name: "Goma Xantana", quantity: "30", purity: "100", overage: "2" },
  {
    code: "MP-000373",
    name: "Ácido Cítrico",
    declaredNutrient: "ÁCIDO CÍTRICO",
    family: "OTHER_RAW_MATERIAL",
    quantity: "2100",
    purity: "100",
    overage: "2",
  },
  {
    code: "MP-000378",
    name: "Sucralose",
    family: "OTHER_RAW_MATERIAL",
    quantity: "60",
    purity: "100",
    overage: "2",
  },
  {
    code: "MP-000369",
    name: "Dióxido de Silício",
    family: "EXCIPIENT",
    quantity: "1320",
    purity: "100",
    overage: "2",
  },
  {
    code: "MP-000414",
    name: "Aroma AIN Abacaxi",
    family: "OTHER_RAW_MATERIAL",
    quantity: "450",
    purity: "100",
    overage: "2",
  },
  {
    code: "MP-000511",
    name: "Exemplo - Corante Colorpro amarelo (CORANTEC)",
    sourceName: "Corante Colorpro amarelo (CORANTEC)",
    quantity: "460",
    purity: "100",
    overage: "2",
  },
  {
    code: "MP-000512",
    name: "Exemplo - Corante verde (OTERRA)",
    sourceName: "Corante verde (OTERRA)",
    quantity: "40",
    purity: "100",
    overage: "2",
  },
];

const EMBALAGEM_DO_PO: Embalagem[] = [
  { code: "ME-000136", name: "Exemplo - POTE 1 KG SERITEC E TAMPA", quantity: "1" },
  { code: "ME-000137", name: "Exemplo - DOSADOR GRANDE", quantity: "1" },
  { code: "ME-000138", name: "Exemplo - Rótulo Sleeve", quantity: "1" },
  { code: "ME-000005", name: "SÍLICA GEL BRANCA EM CÁPSULA SG", quantity: "1" },
  { code: "ME-000019", name: "CAIXA DE PAPELÃO G", quantity: "1" },
];

function montar(
  base: Omit<FormulationVersionDTO, "components">,
  materias: Materia[],
  embalagens: Embalagem[],
  premissas: Premissas,
): FormulationVersionDTO {
  return {
    ...base,
    components: [
      ...materias.map((materia, indice) => materiaPrima(materia, premissas, indice)),
      ...embalagens.map((embalagem, indice) =>
        itemDeEmbalagem(embalagem, materias.length + indice),
      ),
    ],
  };
}

/** Versão em CÁPSULA — Ácido Fólico, 120 cápsulas por pote, 1 por dose. */
export function versaoCapsula(
  overrides: Partial<FormulationVersionDTO> = {},
): FormulationVersionDTO {
  const premissas: Premissas = { dosesPerPackage: 120, capsulesPerDose: 1, basisQuantity: "1" };
  return montar(
    {
      id: "ver-acf-1",
      productId: "prod-acf",
      productCode: "PROD-000174",
      productName: "Exemplo - Ácido Fólico PT 120 Caps",
      versionNumber: 1,
      versionLabel: "V1",
      status: "DRAFT",
      basisQuantity: "1",
      calculationMode: "PER_DOSE",
      dosesPerPackage: 120,
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 1,
      capsulesPerPackage: 120,
      doseAmount: null,
      doseUomCode: null,
      packageContentAmount: null,
      packageContentUomCode: null,
      expectedLossPercent: "4",
      productProfile: {
        dosageForm: "CAPSULE",
        presentationType: "POT",
        capsulesPerDose: 1,
        doseAmount: null,
        doseUomCode: null,
        dosesPerPackage: 120,
        targetAgeGroup: "ADULT",
        minimumBatchQuantity: "5000",
        unitsPerShippingBox: 60,
      },
      outputItemId: "item-pa-acf",
      outputItemCode: "PA-000174",
      outputItemName: "Exemplo - Ácido Fólico PT 120 Caps",
      outputUnitCode: "un",
      notes: null,
      createdAt: "2026-09-01T12:00:00.000Z",
      createdBy: "Equipe de Desenvolvimento",
      activatedAt: null,
      activatedBy: null,
      inactivatedAt: null,
      inactivatedBy: null,
      sourceVersionId: null,
      sourceVersionNumber: null,
      originTemplateVersionId: null,
      originTemplateCode: null,
      originTemplateVersionNumber: null,
      originTemplateName: null,
      componentIssues: [],
      ...overrides,
    },
    ACIDO_FOLICO,
    EMBALAGEM_DA_CAPSULA,
    premissas,
  );
}

/** Versão em PÓ — Beef Protein, 900 g por pote, dose de 30 g. */
export function versaoPo(overrides: Partial<FormulationVersionDTO> = {}): FormulationVersionDTO {
  const premissas: Premissas = { dosesPerPackage: 30, capsulesPerDose: null, basisQuantity: "1" };
  return montar(
    {
      id: "ver-beef-2",
      productId: "prod-beef",
      productCode: "PROD-000175",
      productName: "Exemplo - Beef Protein Abacaxi 900g Pote",
      versionNumber: 2,
      versionLabel: "V2",
      status: "ACTIVE",
      basisQuantity: "1",
      calculationMode: "PER_DOSE",
      dosesPerPackage: 30,
      dosageForm: "POWDER",
      presentationType: "POT",
      capsulesPerDose: null,
      capsulesPerPackage: null,
      doseAmount: "30000",
      doseUomCode: "mg",
      packageContentAmount: "900000",
      packageContentUomCode: "mg",
      expectedLossPercent: "2.5",
      productProfile: {
        dosageForm: "POWDER",
        presentationType: "POT",
        capsulesPerDose: null,
        doseAmount: "30000",
        doseUomCode: "mg",
        dosesPerPackage: 30,
        targetAgeGroup: "ADULT",
        minimumBatchQuantity: "1",
        unitsPerShippingBox: 20,
      },
      outputItemId: "item-pa-beef",
      outputItemCode: "PA-000175",
      outputItemName: "Exemplo - Beef Protein Abacaxi 900g Pote",
      outputUnitCode: "un",
      /*
       * A observação REAL desta versão no banco de desenvolvimento: texto
       * livre da bancada, citando a planilha de CMV e a palavra "overage". É
       * ela que prova que a ficha técnica não imprime o campo.
       */
      notes:
        'Massa de homologação — reproduz CMV BEEF PROTEIN ABACAXI 900G POTE.xlsx, aba "Base Cálculo". Reserva da referência: 2% — gravada em overage como DOCUMENTAÇÃO e NÃO aplicada.',
      createdAt: "2026-08-20T13:00:00.000Z",
      createdBy: "Equipe de Desenvolvimento",
      activatedAt: "2026-09-02T14:30:00.000Z",
      activatedBy: "Qualidade",
      inactivatedAt: null,
      inactivatedBy: null,
      sourceVersionId: "ver-beef-1",
      sourceVersionNumber: 1,
      originTemplateVersionId: null,
      originTemplateCode: null,
      originTemplateVersionNumber: null,
      originTemplateName: null,
      componentIssues: [],
      ...overrides,
    },
    BEEF_PROTEIN,
    EMBALAGEM_DO_PO,
    premissas,
  );
}

/**
 * Formulação LONGA — a que prova a paginação.
 *
 * 48 matérias-primas e 12 embalagens não cabem numa folha: é aí que o
 * cabeçalho da tabela precisa reaparecer no topo da página seguinte e que
 * nenhuma linha pode se partir no meio.
 */
export function versaoLonga(): FormulationVersionDTO {
  const premissas: Premissas = { dosesPerPackage: 60, capsulesPerDose: 2, basisQuantity: "1" };
  const materias: Materia[] = Array.from({ length: 48 }, (_, indice) => ({
    code: `MP-${String(900 + indice).padStart(6, "0")}`,
    name: `Matéria-prima de referência ${indice + 1}`,
    declaredNutrient: `Nutriente declarado ${indice + 1}`,
    family: "OTHER_RAW_MATERIAL" as const,
    quantity: String(10 + indice),
    purity: indice % 3 === 0 ? "97.5" : "100",
    overage: "5",
  }));
  const embalagens: Embalagem[] = Array.from({ length: 12 }, (_, indice) => ({
    code: `ME-${String(900 + indice).padStart(6, "0")}`,
    name: `Item de embalagem de referência ${indice + 1}`,
    quantity: "1",
  }));
  const { components: _ignoradas, ...base } = versaoCapsula();
  return montar(
    {
      ...base,
      id: "ver-longa-3",
      productCode: "PROD-000999",
      productName: "Exemplo - Formulação longa de referência",
      versionNumber: 3,
      versionLabel: "V3",
      status: "ACTIVE",
      dosesPerPackage: 60,
      capsulesPerDose: 2,
      capsulesPerPackage: 120,
      activatedAt: "2026-09-05T11:00:00.000Z",
      activatedBy: "Qualidade",
    },
    materias,
    embalagens,
    premissas,
  );
}
