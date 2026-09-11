// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Decimal } from "@veridi/shared";
import type {
  DecimalInstance,
  IndustrialCostCalculationSnapshotDTO,
  IndustrialCostWarningDTO,
  IndustrialManualCostLineDTO,
  IndustrialMaterialCostLineDTO,
  IndustrialMaterialCostSource,
  IndustrialResourceCostLineDTO,
  PricingTierDTO,
  PricingVersionDTO,
  ProductionMaterialCostLineDTO,
  ProductionOrderCostDTO,
} from "@veridi/shared";
import { formatBRL, formatPdfDateTime } from "../format";
import { renderPdfBlob } from "../render";
import { lerPdf, type PdfLido } from "../testing/pdf-text";
import { CostCalculationPdf, costCalculationPdfFileName } from "./CostCalculationPdf";
import { PricingPdf, pricingPdfFileName } from "./PricingPdf";
import { ProductionCostPdf, productionCostPdfFileName } from "./ProductionCostPdf";

/**
 * Os três documentos de custo como ARQUIVO: PDF real, lido de volta página
 * por página com a mesma régua de `pdf-generator.test.tsx`.
 *
 * O conteúdo (DOM) é provado em `pages/print/base-calculada-impressos.test.tsx`;
 * aqui fica o que só existe no arquivo — A4 (retrato; paisagem na
 * precificação), "Página X de Y" e identidade do documento em toda folha,
 * cabeçalho de tabela repetido quando a tabela continua, linha que não se
 * divide, resumo que não se parte e nenhum rastro de navegador.
 *
 * As amostras são realistas — fórmula de whey com vitaminas e embalagem,
 * consumo em dois lotes por material — e os números fecham entre si.
 * `PDF_SAMPLES_DIR=<pasta>` grava os arquivos para inspeção visual.
 */

/** 09:30:45 em Brasília — os segundos não podem chegar ao papel. */
const GERADO_EM = new Date("2026-09-11T12:30:45.000Z");
const CARIMBO = "Gerado em 11/09/2026 09:30";
const GERADO_POR = "Equipe de Custos";
const RASTROS = ["http", "localhost", "127.0.0.1", "about:blank", "09:30:45"];
/** Documento grande no primeiro render: o motor de PDF carrega junto. */
const PRAZO = 60_000;

// ---------------------------------------------------------------- régua

type Orientacao = "retrato" | "paisagem";

/** A4 com a tolerância do gerador: 595,28 × 841,89 pt (paisagem: o inverso). */
function ehA4(mediaBox: string, orientacao: Orientacao): boolean {
  const [x, y, largura, altura] = mediaBox.trim().split(/\s+/);
  if (!x || !y || !largura || !altura) return false;
  const [w, h]: [string, string] = orientacao === "retrato" ? ["595.28", "841.89"] : ["841.89", "595.28"];
  const perto = (valor: string, alvo: string) => new Decimal(valor).minus(alvo).abs().lessThan("0.01");
  return new Decimal(x).isZero() && new Decimal(y).isZero() && perto(largura, w) && perto(altura, h);
}

async function gerar(documento: ReactElement, amostra: string): Promise<PdfLido> {
  const blob = await renderPdfBlob(documento);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pasta = process.env["PDF_SAMPLES_DIR"];
  if (pasta) {
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, amostra), bytes);
  }
  return lerPdf(bytes);
}

/** Nome da amostra: o nome real do arquivo + o cenário. */
function amostra(arquivo: string, cenario: string): string {
  return arquivo.replace(/\.pdf$/, `-${cenario}.pdf`);
}

function todasAsLinhas(pdf: PdfLido): string[] {
  return pdf.paginas.flatMap((pagina) => pagina.split("\n"));
}

/** A primeira linha do papel que contém o trecho — a linha inteira da tabela. */
function linhaCom(pdf: PdfLido, trecho: string): string {
  return todasAsLinhas(pdf).find((linha) => linha.includes(trecho)) ?? "";
}

function folhaCom(pdf: PdfLido, trecho: string): number {
  return pdf.paginas.findIndex((pagina) => pagina.includes(trecho));
}

/**
 * Toda folha: A4, "Página X de Y", carimbo sem segundos, natureza interna e
 * identidade do documento (cabeçalho na 1ª, corrido nas seguintes). Nenhum
 * rastro de navegador no arquivo.
 */
function conferirFolhas(
  pdf: PdfLido,
  { orientacao, titulo, codigo }: { orientacao: Orientacao; titulo: string; codigo: string },
) {
  expect(pdf.bruto.startsWith("%PDF-")).toBe(true);
  expect(pdf.folhas).toHaveLength(pdf.paginas.length);
  expect(pdf.folhas.every((folha) => ehA4(folha, orientacao)), pdf.folhas.join(" | ")).toBe(true);
  const total = pdf.paginas.length;
  pdf.paginas.forEach((pagina, indice) => {
    const folha = `folha ${indice + 1}`;
    expect(pagina, folha).toContain(`Página ${indice + 1} de ${total}`);
    expect(pagina, folha).toContain(CARIMBO);
    expect(pagina, folha).toContain("Documento interno");
    expect(pagina, folha).toContain(titulo);
    expect(pagina, folha).toContain(codigo);
  });
  const tudo = pdf.paginas.join("\n");
  for (const rastro of RASTROS) {
    expect(pdf.bruto).not.toContain(rastro);
    expect(tudo).not.toContain(rastro);
  }
}

/**
 * Toda folha em que a tabela tem linha também tem o cabeçalho dela — a
 * tabela que continua repete o cabeçalho. Devolve em quantas folhas a
 * tabela aparece.
 */
function conferirCabecalho(pdf: PdfLido, ehLinhaDaTabela: (linha: string) => boolean, cabecalho: string): number {
  let folhas = 0;
  pdf.paginas.forEach((pagina, indice) => {
    if (!pagina.split("\n").some(ehLinhaDaTabela)) return;
    folhas += 1;
    expect(pagina, `folha ${indice + 1} sem o cabeçalho ${cabecalho}`).toContain(cabecalho);
  });
  return folhas;
}

// ---------------------------------------------------------------- amostras

const soma = (valores: (string | null)[]): DecimalInstance =>
  valores.reduce<DecimalInstance>(
    (total, valor) => (valor === null ? total : total.plus(valor)),
    new Decimal(0),
  );

/** Dinheiro como a API serve: texto decimal, duas casas. */
const dinheiro = (valor: DecimalInstance): string => valor.toDecimalPlaces(2).toString();

const aviso = (code: string, message: string): IndustrialCostWarningDTO => ({ code, message });

type LinhaDaFormula = [
  codigo: string,
  nome: string,
  quantidade: string,
  unidade: string,
  custo: string | null,
  fonte: IndustrialMaterialCostSource,
];

/** Whey 900 g com vitaminas, aminoácidos e embalagem — base de 3000 potes. */
const FORMULA: LinhaDaFormula[] = [
  ["MP-000101", "Whey Protein Concentrado 80% (WPC 80)", "1450", "kg", "38.50", "WEIGHTED_AVG_30D"],
  ["MP-000102", "Whey Protein Isolado 90% (WPI 90)", "320", "kg", "62.00", "WEIGHTED_AVG_90D"],
  ["MP-000103", "Proteína isolada de soja", "180", "kg", "21.80", "SUPPLIER_OFFER_PREFERRED"],
  ["MP-000104", "Maltodextrina DE 10", "300", "kg", "4.20", "LAST_REAL"],
  ["MP-000105", "Dextrose anidra", "60", "kg", "5.10", "WEIGHTED_AVG_30D"],
  ["MP-000106", "Creatina monohidratada 200 mesh", "90", "kg", "72.00", "SUPPLIER_OFFER_SINGLE_APPROVED"],
  ["MP-000107", "Aroma idêntico ao natural de baunilha", "24", "kg", "145.00", "WEIGHTED_AVG_90D"],
  ["MP-000108", "Sucralose micronizada", "1.35", "kg", "690.00", "LAST_REAL"],
  ["MP-000109", "Glicosídeos de esteviol (Reb A 97%)", "0.9", "kg", "420.00", "MANUAL_REFERENCE"],
  ["MP-000110", "Goma xantana", "6.5", "kg", "48.00", "WEIGHTED_AVG_30D"],
  ["MP-000111", "Lecitina de girassol em pó", "13.5", "kg", "36.00", "WEIGHTED_AVG_30D"],
  ["MP-000112", "Cloreto de sódio refinado", "8.1", "kg", "2.10", "LAST_REAL"],
  ["MP-000113", "Citrato de potássio", "9.45", "kg", "18.50", "WEIGHTED_AVG_90D"],
  ["MP-000114", "Citrato de magnésio", "12.6", "kg", "31.00", "SUPPLIER_OFFER_PREFERRED"],
  ["MP-000115", "Carbonato de cálcio", "15.3", "kg", "3.40", "WEIGHTED_AVG_30D"],
  ["MP-000116", "Óxido de zinco", "0.27", "kg", "52.00", "LAST_REAL"],
  ["MP-000117", "Vitamina C (ácido ascórbico)", "2.7", "kg", "58.00", "WEIGHTED_AVG_30D"],
  ["MP-000118", "Vitamina D3 100.000 UI/g", "0.054", "kg", "390.00", "MANUAL_REFERENCE"],
  ["MP-000119", "Vitamina B12 0,1% (cianocobalamina)", "0.018", "kg", "2350.00", "MANUAL_REFERENCE"],
  ["MP-000120", "Vitamina B6 (cloridrato de piridoxina)", "0.0405", "kg", "310.00", "WEIGHTED_AVG_90D"],
  ["MP-000121", "Ácido fólico 90%", "0.00045", "kg", "1800.00", "LAST_REAL"],
  ["MP-000122", "Picolinato de cromo", "0.0027", "kg", "980.00", "SUPPLIER_OFFER_PREFERRED"],
  ["MP-000123", "L-glutamina", "45", "kg", "64.00", "WEIGHTED_AVG_30D"],
  ["MP-000124", "L-leucina instantânea", "27", "kg", "88.00", "WEIGHTED_AVG_30D"],
  ["MP-000125", "L-isoleucina", "13.5", "kg", "112.00", "SUPPLIER_OFFER_SINGLE_APPROVED"],
  ["MP-000126", "L-valina", "13.5", "kg", "105.00", "SUPPLIER_OFFER_SINGLE_APPROVED"],
  ["MP-000127", "Taurina", "18", "kg", "29.00", "LAST_REAL"],
  ["MP-000128", "Beta-alanina", "22.5", "kg", "49.00", "WEIGHTED_AVG_90D"],
  ["MP-000129", "Colágeno hidrolisado bovino", "54", "kg", "42.00", "WEIGHTED_AVG_30D"],
  ["MP-000130", "Inulina de chicória", "36", "kg", "27.00", "WEIGHTED_AVG_30D"],
  ["MP-000131", "Triglicerídeos de cadeia média (TCM) em pó", "27", "kg", "58.00", "MANUAL_REFERENCE"],
  ["MP-000132", "Dióxido de silício (antiumectante)", "5.4", "kg", "16.00", "LAST_REAL"],
  ["MP-000133", "Enzima lactase 100.000 FCC/g", "0.81", "kg", "860.00", "SUPPLIER_OFFER_PREFERRED"],
  ["MP-000134", "Blend de probióticos 100 bi UFC/g", "0.45", "kg", "1250.00", "MANUAL_REFERENCE"],
  ["EMB-000201", "Pote PEAD 900 g branco", "3000", "un", "1.85", "WEIGHTED_AVG_30D"],
  ["EMB-000202", "Tampa rosca 110 mm com lacre", "3000", "un", "0.62", "WEIGHTED_AVG_30D"],
  ["EMB-000203", "Selo de indução 110 mm", "3000", "un", "0.09", "LAST_REAL"],
  ["EMB-000204", "Dosador 30 mL", "3000", "un", "0.11", "WEIGHTED_AVG_90D"],
  ["EMB-000205", "Sachê dessecante de sílica 1 g", "3000", "un", "0.0032", "SUPPLIER_OFFER_PREFERRED"],
  ["EMB-000206", "Rótulo BOPP 900 g — Baunilha", "3000", "un", null, "EXCLUDED_CUSTOMER_SUPPLIED"],
  ["EMB-000207", "Cartucho promocional (arte do cliente)", "3000", "un", null, "EXCLUDED_CUSTOMER_SUPPLIED"],
];

function materiais(linhas: LinhaDaFormula[]): IndustrialMaterialCostLineDTO[] {
  return linhas.map(([itemCode, itemName, requiredQuantity, unitCode, unitCost, costSource]) => ({
    itemId: `item-${itemCode}`,
    itemCode,
    itemName,
    requiredQuantity,
    unitCode,
    customerSupplied: costSource === "EXCLUDED_CUSTOMER_SUPPLIED",
    unitCost,
    costSource,
    costSourceDetails: null,
    subtotal: unitCost === null ? null : dinheiro(new Decimal(requiredQuantity).times(unitCost)),
  }));
}

function recurso(
  resourceCode: string,
  resourceName: string,
  resourceType: IndustrialResourceCostLineDTO["resourceType"],
  quantity: string,
  rateValue: string | null,
): IndustrialResourceCostLineDTO {
  return {
    resourceId: `res-${resourceCode}`,
    resourceCode,
    resourceName,
    resourceType,
    quantity,
    quantityUom: resourceType === "ENERGY" ? "KWH" : "HOUR",
    rateValue,
    rateIsDraftReference: false,
    subtotal: rateValue === null ? null : dinheiro(new Decimal(quantity).times(rateValue)),
  };
}

/** Recursos da estrutura, na base (fator 1) ou aplicados na proporção produzida. */
function recursosDaEstrutura(fator = "1"): IndustrialResourceCostLineDTO[] {
  const escala = (uso: string) => new Decimal(uso).times(fator).toDecimalPlaces(6).toString();
  return [
    recurso("RIN-000001", "Operador de produção", "LABOR", escala("18.5"), "42.00"),
    recurso("RIN-000002", "Auxiliar de envase", "LABOR", escala("12"), "28.50"),
    recurso("RIN-000010", "Misturador em V 500 L", "EQUIPMENT", escala("6"), "35.00"),
    recurso("RIN-000011", "Envasadora semiautomática de pó", "EQUIPMENT", escala("10.5"), "22.00"),
    recurso("RIN-000020", "Energia elétrica — linha de pó", "ENERGY", escala("186"), "0.92"),
  ];
}

const doTipo = (recursos: IndustrialResourceCostLineDTO[], tipo: IndustrialResourceCostLineDTO["resourceType"]) =>
  soma(recursos.filter((linha) => linha.resourceType === tipo).map((linha) => linha.subtotal));

function premissa(
  description: string,
  category: IndustrialManualCostLineDTO["category"],
  calculationBasis: IndustrialManualCostLineDTO["calculationBasis"],
  rateValue: string | null,
  subtotal: string | null,
  computedUnits: string | null = null,
): IndustrialManualCostLineDTO {
  return { lineId: `premissa-${description}`, category, description, calculationBasis, rateValue, computedUnits, subtotal };
}

const daCategoria = (linhas: IndustrialManualCostLineDTO[], categoria: IndustrialManualCostLineDTO["category"]) =>
  soma(linhas.filter((linha) => linha.category === categoria).map((linha) => linha.subtotal));

/** Cálculo completo com estimativas: 41 materiais, dois deles do cliente. */
function calculoCompleto(): IndustrialCostCalculationSnapshotDTO {
  const materials = materiais(FORMULA);
  const resources = recursosDaEstrutura();
  const manuais = [
    premissa("Caixa de embarque 6 potes", "SECONDARY_PACKAGING", "PER_SHIPPING_BOX", "4.80", "2400.00", "500"),
    premissa("Fita adesiva e etiqueta de expedição", "SECONDARY_PACKAGING", "PER_1000_OUTPUT_UNITS", "38.00", "114.00"),
    premissa("Análise microbiológica terceirizada", "THIRD_PARTY_SERVICE", "FIXED_PER_BATCH", "640.00", "640.00"),
    premissa("Laudo de rotulagem nutricional", "THIRD_PARTY_SERVICE", "FIXED_PER_BATCH", "280.00", "280.00"),
  ];
  const materiaisVeridi = soma(materials.map((linha) => linha.subtotal));
  const maoDeObra = doTipo(resources, "LABOR");
  const equipamentos = doTipo(resources, "EQUIPMENT");
  const energia = doTipo(resources, "ENERGY");
  const embalagemSecundaria = daCategoria(manuais, "SECONDARY_PACKAGING");
  const terceiros = daCategoria(manuais, "THIRD_PARTY_SERVICE");
  const direto = materiaisVeridi
    .plus(maoDeObra)
    .plus(equipamentos)
    .plus(energia)
    .plus(embalagemSecundaria)
    .plus(terceiros);
  const overhead = direto.times("0.08").toDecimalPlaces(2);
  const total = direto.plus(overhead);
  const porUnidade = total.dividedBy("3000").toDecimalPlaces(12);
  const fornecidos = materials.filter((linha) => linha.customerSupplied);

  return {
    id: "calc-123",
    code: "CALC-000123",
    calculatedByName: "Marina Albuquerque",
    structureStatusAtCalculation: "ACTIVE",
    notes: null,
    industrialCostVersionId: "ec-12",
    industrialCostVersionLabel: "EC-000012 · V3",
    structureStatus: "ACTIVE",
    draftReference: false,
    productId: "prod-45",
    productCode: "PROD-000045",
    productName: "Whey Protein Concentrado 900 g — Baunilha",
    customerName: "NutriViva Suplementos Ltda",
    formulationVersionNumber: 4,
    referenceOutputQuantity: "3000",
    referenceOutputUomCode: "un",
    unitsPerShippingBox: 6,
    costReferenceDate: "2026-09-01T00:00:00.000Z",
    calculatedAt: "2026-09-10T17:42:10.000Z",
    materials,
    resources,
    manualLines: [
      ...manuais,
      premissa("Overhead industrial", "OVERHEAD", "PERCENT_OF_DIRECT_INDUSTRIAL_COST", "8", dinheiro(overhead)),
    ],
    customerSuppliedMaterials: fornecidos.map(({ itemId, itemCode, itemName, requiredQuantity, unitCode }) => ({
      itemId,
      itemCode,
      itemName,
      requiredQuantity,
      unitCode,
    })),
    hasCustomerSuppliedMaterials: fornecidos.length > 0,
    energyCalculationMode: "DIRECT",
    derivedEnergyKwh: null,
    energyRate: "0.92",
    materialsSubtotalKnown: dinheiro(materiaisVeridi),
    laborSubtotalKnown: dinheiro(maoDeObra),
    equipmentSubtotalKnown: dinheiro(equipamentos),
    energySubtotal: dinheiro(energia),
    secondaryPackagingSubtotalKnown: dinheiro(embalagemSecundaria),
    thirdPartySubtotalKnown: dinheiro(terceiros),
    otherSubtotalKnown: "0.00",
    overheadSubtotalKnown: dinheiro(overhead),
    directIndustrialCost: dinheiro(direto),
    totalIndustrialCost: dinheiro(total),
    knownSubtotal: dinheiro(total),
    costPerUnit: porUnidade.toString(),
    costPer1000: dinheiro(porUnidade.times(1000)),
    quality: "COMPLETE_WITH_ESTIMATES",
    warnings: [
      aviso(
        "SUPPLIER_OFFER_USED",
        "Proteína isolada de soja (MP-000103): custo por oferta válida de fornecedor, não por compra real.",
      ),
      aviso(
        "MANUAL_REFERENCE_USED",
        "Vitamina B12 0,1% (MP-000119): referência manual de custo vigente desde 01/08/2026.",
      ),
    ],
  };
}

/** Creatina 300 g sobre estrutura em rascunho: um material sem custo e a tarifa de energia em aberto. */
function calculoParcial(): IndustrialCostCalculationSnapshotDTO {
  const materials = materiais([
    ["MP-000140", "Creatina monohidratada micronizada", "150", "kg", "68.00", "WEIGHTED_AVG_30D"],
    ["MP-000141", "Dióxido de silício (antiumectante)", "0.75", "kg", "16.00", "LAST_REAL"],
    ["MP-000142", "Aroma natural de limão", "1.2", "kg", null, "NO_COST"],
    ["EMB-000210", "Pote PEAD 300 g preto", "500", "un", "1.12", "SUPPLIER_OFFER_PREFERRED"],
    ["EMB-000211", "Tampa flip-top 63 mm", "500", "un", "0.38", "WEIGHTED_AVG_90D"],
    ["EMB-000212", "Selo de indução 63 mm", "500", "un", "0.05", "LAST_REAL"],
    ["EMB-000213", "Rótulo BOPP 300 g — Limão", "500", "un", "0.21", "MANUAL_REFERENCE"],
    ["EMB-000214", "Dosador 5 g", "500", "un", "0.04", "WEIGHTED_AVG_30D"],
  ]);
  const resources = [
    recurso("RIN-000001", "Operador de produção", "LABOR", "6", "42.00"),
    recurso("RIN-000020", "Energia elétrica — linha de pó", "ENERGY", "38", null),
  ];
  const manuais = [
    premissa("Caixa de embarque 12 potes", "SECONDARY_PACKAGING", "PER_SHIPPING_BOX", "3.90", "163.80", "42"),
    premissa("Overhead industrial", "OVERHEAD", "PERCENT_OF_DIRECT_INDUSTRIAL_COST", "8", null),
  ];
  const materiaisConhecidos = soma(materials.map((linha) => linha.subtotal));
  const maoDeObra = doTipo(resources, "LABOR");
  const embalagemSecundaria = daCategoria(manuais, "SECONDARY_PACKAGING");

  return {
    id: "calc-124",
    code: "CALC-000124",
    calculatedByName: "Marina Albuquerque",
    structureStatusAtCalculation: "DRAFT",
    notes: null,
    industrialCostVersionId: "ec-15",
    industrialCostVersionLabel: "EC-000015 · V1",
    structureStatus: "DRAFT",
    draftReference: true,
    productId: "prod-52",
    productCode: "PROD-000052",
    productName: "Creatina Monohidratada 300 g — Limão",
    customerName: null,
    formulationVersionNumber: 2,
    referenceOutputQuantity: "500",
    referenceOutputUomCode: "un",
    unitsPerShippingBox: 12,
    costReferenceDate: "2026-09-10T00:00:00.000Z",
    calculatedAt: "2026-09-11T11:58:00.000Z",
    materials,
    resources,
    manualLines: manuais,
    customerSuppliedMaterials: [],
    hasCustomerSuppliedMaterials: false,
    energyCalculationMode: "DIRECT",
    derivedEnergyKwh: null,
    energyRate: null,
    materialsSubtotalKnown: dinheiro(materiaisConhecidos),
    laborSubtotalKnown: dinheiro(maoDeObra),
    equipmentSubtotalKnown: "0.00",
    energySubtotal: null,
    secondaryPackagingSubtotalKnown: dinheiro(embalagemSecundaria),
    thirdPartySubtotalKnown: "0.00",
    otherSubtotalKnown: "0.00",
    overheadSubtotalKnown: "0.00",
    directIndustrialCost: null,
    totalIndustrialCost: null,
    knownSubtotal: dinheiro(materiaisConhecidos.plus(maoDeObra).plus(embalagemSecundaria)),
    costPerUnit: null,
    costPer1000: null,
    quality: "PARTIAL",
    warnings: [
      aviso("MATERIAL_WITHOUT_COST", "Aroma natural de limão (MP-000142): nunca foi comprado — sem referência de custo."),
      aviso("RESOURCE_WITHOUT_RATE", "Energia elétrica — linha de pó (RIN-000020): tarifa não informada."),
    ],
  };
}

/**
 * OP de 2850 potes sobre base 3000 (fator 0,95): materiais realizados em dois
 * lotes cada (FEFO) ao longo do turno, mais os custos padrão aplicados.
 */
function custoHibrido(): ProductionOrderCostDTO {
  const fator = "0.95";
  const consumidos = [...FORMULA.slice(0, 18), ...FORMULA.slice(34)];
  const materials: ProductionMaterialCostLineDTO[] = [];
  let sequencia = 400;
  consumidos.forEach(([itemCode, itemName, quantidade, unitCode, custo, fonte], indice) => {
    const total = new Decimal(quantidade).times(fator);
    const lotes = indice < 19 ? [total.times("0.6"), total.times("0.4")] : [total];
    lotes.forEach((parte, lote) => {
      sequencia += 1;
      const customerSupplied = fonte === "EXCLUDED_CUSTOMER_SUPPLIED";
      materials.push({
        consumptionId: `cons-${sequencia}`,
        itemCode,
        itemName,
        lotCode: `LT-202608${String(10 + ((indice + lote) % 19)).padStart(2, "0")}-${String(sequencia).padStart(6, "0")}`,
        quantity: parte.toDecimalPlaces(6).toString(),
        unitCode,
        consumedAt: new Date(Date.UTC(2026, 8, 10, 11, 4 + materials.length * 6)).toISOString(),
        customerSupplied,
        unitCost: custo,
        costSource: customerSupplied ? "CUSTOMER_SUPPLIED" : "REAL",
        subtotal: custo === null ? null : dinheiro(parte.times(custo)),
      });
    });
  });
  const standardApplied = recursosDaEstrutura(fator);
  const manuais = [
    premissa("Caixa de embarque 6 potes", "SECONDARY_PACKAGING", "PER_SHIPPING_BOX", "4.80", "2280.00", "475"),
    premissa("Fita adesiva e etiqueta de expedição", "SECONDARY_PACKAGING", "PER_1000_OUTPUT_UNITS", "38.00", "108.30"),
    premissa("Análise microbiológica terceirizada", "THIRD_PARTY_SERVICE", "FIXED_PER_BATCH", "640.00", "608.00"),
  ];
  const realizados = soma(materials.map((linha) => linha.subtotal));
  const maoDeObra = doTipo(standardApplied, "LABOR");
  const equipamentos = doTipo(standardApplied, "EQUIPMENT");
  const energia = doTipo(standardApplied, "ENERGY");
  const embalagem = daCategoria(manuais, "SECONDARY_PACKAGING");
  const terceiros = daCategoria(manuais, "THIRD_PARTY_SERVICE");
  const overhead = realizados
    .plus(maoDeObra)
    .plus(equipamentos)
    .plus(energia)
    .plus(embalagem)
    .plus(terceiros)
    .times("0.08")
    .toDecimalPlaces(2);
  const padrao = maoDeObra.plus(equipamentos).plus(energia).plus(embalagem).plus(terceiros).plus(overhead);
  const total = realizados.plus(padrao);

  return {
    productionOrderId: "op-87",
    productionOrderCode: "OP-000087",
    productCode: "PROD-000045",
    productName: "Whey Protein Concentrado 900 g — Baunilha",
    formulationVersionNumber: 4,
    industrialCostVersionId: "ec-12",
    industrialCostVersionLabel: "EC-000012 · V3",
    producedQuantity: "2850",
    outputUnitCode: "un",
    allocationFactor: fator,
    materials,
    standardApplied,
    standardAppliedManual: [
      ...manuais,
      premissa("Overhead industrial", "OVERHEAD", "PERCENT_OF_DIRECT_INDUSTRIAL_COST", "8", dinheiro(overhead)),
    ],
    actualMaterialCostKnown: dinheiro(realizados),
    standardAppliedLaborKnown: dinheiro(maoDeObra),
    standardAppliedEquipmentKnown: dinheiro(equipamentos),
    standardAppliedEnergy: dinheiro(energia),
    standardAppliedSecondaryPackagingKnown: dinheiro(embalagem),
    standardAppliedThirdPartyKnown: dinheiro(terceiros),
    standardAppliedOtherKnown: "0.00",
    standardAppliedOverheadKnown: dinheiro(overhead),
    standardAppliedCostKnown: dinheiro(padrao),
    totalIndustrialCost: dinheiro(total),
    knownSubtotal: dinheiro(total),
    costPerProducedUnit: total.dividedBy("2850").toDecimalPlaces(12).toString(),
    quality: "COMPLETE_REAL_REFERENCE",
    status: "FINAL",
    hybrid: true,
    hasCustomerSuppliedMaterials: true,
    warnings: [
      aviso("CUSTOMER_SUPPLIED", "Rótulo e cartucho fornecidos pelo cliente: sem valor econômico atribuído à Veridi."),
    ],
    snapshotId: "snap-87",
    snapshotCreatedAt: "2026-09-10T21:15:00.000Z",
  };
}

/** OP sem estrutura de custos, em andamento, com um material sem custo. */
function custoSemEstrutura(): ProductionOrderCostDTO {
  const linhas: [string, string, string, string, string | null, boolean][] = [
    ["MP-000140", "Creatina monohidratada micronizada", "354", "kg", "68.00", false],
    ["MP-000141", "Dióxido de silício (antiumectante)", "1.77", "kg", "16.00", false],
    ["MP-000142", "Aroma natural de limão", "2.83", "kg", null, false],
    ["EMB-000210", "Pote PEAD 300 g preto", "1180", "un", "1.12", false],
    ["EMB-000211", "Tampa flip-top 63 mm", "1180", "un", "0.38", false],
    ["EMB-000215", "Rótulo do cliente 300 g — Limão", "1180", "un", null, true],
  ];
  const materials: ProductionMaterialCostLineDTO[] = linhas.map(
    ([itemCode, itemName, quantity, unitCode, unitCost, customerSupplied], indice) => ({
      consumptionId: `cons-9${indice}`,
      itemCode,
      itemName,
      lotCode: `LT-20260902-${String(510 + indice).padStart(6, "0")}`,
      quantity,
      unitCode,
      consumedAt: new Date(Date.UTC(2026, 8, 11, 10, 15 + indice * 9)).toISOString(),
      customerSupplied,
      unitCost,
      costSource: customerSupplied ? "CUSTOMER_SUPPLIED" : unitCost === null ? "NO_COST" : "REAL",
      subtotal: unitCost === null ? null : dinheiro(new Decimal(quantity).times(unitCost)),
    }),
  );
  const conhecido = soma(materials.map((linha) => linha.subtotal));

  return {
    productionOrderId: "op-91",
    productionOrderCode: "OP-000091",
    productCode: "PROD-000052",
    productName: "Creatina Monohidratada 300 g — Limão",
    formulationVersionNumber: 2,
    industrialCostVersionId: null,
    industrialCostVersionLabel: null,
    producedQuantity: "1180",
    outputUnitCode: "un",
    allocationFactor: null,
    materials,
    standardApplied: [],
    standardAppliedManual: [],
    actualMaterialCostKnown: dinheiro(conhecido),
    standardAppliedLaborKnown: "0.00",
    standardAppliedEquipmentKnown: "0.00",
    standardAppliedEnergy: null,
    standardAppliedSecondaryPackagingKnown: "0.00",
    standardAppliedThirdPartyKnown: "0.00",
    standardAppliedOtherKnown: "0.00",
    standardAppliedOverheadKnown: "0.00",
    standardAppliedCostKnown: "0.00",
    totalIndustrialCost: null,
    knownSubtotal: dinheiro(conhecido),
    costPerProducedUnit: null,
    quality: "PARTIAL",
    status: "PROVISIONAL",
    hybrid: false,
    hasCustomerSuppliedMaterials: true,
    warnings: [
      aviso("MATERIAL_WITHOUT_COST", "Aroma natural de limão (MP-000142): recebimento REC-000233 sem custo informado."),
    ],
    snapshotId: null,
    snapshotCreatedAt: null,
  };
}

type Preco =
  | { modo: "TARGET_MARGIN"; margem: string; comissao: string }
  | { modo: "MANUAL_PRICE"; preco: string; comissao: string };

/**
 * Faixa como o motor devolve: custo da SUA quantidade e preço/margem
 * derivados dele. Custo desconhecido não forma margem — só existe o
 * subtotal conhecido.
 */
function faixa(
  quantidade: string,
  lotes: string,
  custoTotal: string | null,
  subtotalConhecido: string,
  qualidade: PricingTierDTO["costQuality"],
  preco: Preco,
  warnings: IndustrialCostWarningDTO[] = [],
): PricingTierDTO {
  const q = new Decimal(quantidade);
  const cem = new Decimal(100);
  const comissao = new Decimal(preco.comissao).dividedBy(cem);
  const custoUn = custoTotal === null ? null : new Decimal(custoTotal).dividedBy(q).toDecimalPlaces(8);
  const sugerido =
    preco.modo === "TARGET_MARGIN" && custoUn !== null
      ? custoUn
          .dividedBy(new Decimal(1).minus(new Decimal(preco.margem).dividedBy(cem)).minus(comissao))
          .toDecimalPlaces(4)
      : null;
  const selecionado = preco.modo === "MANUAL_PRICE" ? new Decimal(preco.preco) : sugerido;
  const comissaoUn = selecionado === null ? null : selecionado.times(comissao).toDecimalPlaces(4);
  const contribuicaoUn =
    selecionado === null || comissaoUn === null || custoUn === null
      ? null
      : selecionado.minus(comissaoUn).minus(custoUn).toDecimalPlaces(4);
  const texto = (valor: DecimalInstance | null, casas: number) =>
    valor === null ? null : valor.toDecimalPlaces(casas).toString();

  return {
    id: `faixa-${quantidade}`,
    quantity: quantidade,
    uomCode: "un",
    priceMode: preco.modo,
    targetContributionMarginPercent: preco.modo === "TARGET_MARGIN" ? preco.margem : null,
    commissionPercent: preco.comissao,
    manualUnitPrice: preco.modo === "MANUAL_PRICE" ? preco.preco : null,
    notes: null,
    sortOrder: 0,
    industrialCostTotal: custoTotal,
    industrialCostPerUnit: texto(custoUn, 8),
    costPer1000: custoUn === null ? null : dinheiro(custoUn.times(1000)),
    knownSubtotal: subtotalConhecido,
    costQuality: qualidade,
    batchCount: lotes,
    suggestedUnitPrice: texto(sugerido, 4),
    selectedUnitPrice: texto(selecionado, 4),
    commissionPerUnit: texto(comissaoUn, 4),
    commissionTotal: comissaoUn === null ? null : dinheiro(comissaoUn.times(q)),
    grossRevenue: selecionado === null ? null : dinheiro(selecionado.times(q)),
    contributionPerUnit: texto(contribuicaoUn, 4),
    contributionTotal: contribuicaoUn === null ? null : dinheiro(contribuicaoUn.times(q)),
    contributionMarginPercent:
      contribuicaoUn === null || selecionado === null ? null : texto(contribuicaoUn.dividedBy(selecionado).times(cem), 2),
    markupPercent:
      selecionado === null || custoUn === null ? null : texto(selecionado.dividedBy(custoUn).minus(1).times(cem), 2),
    warnings,
  };
}

function versao(
  extra: Pick<
    PricingVersionDTO,
    "code" | "versionNumber" | "status" | "costQuality" | "tiers" | "warnings" | "activatedAt" | "activatedByName"
  >,
): PricingVersionDTO {
  return {
    id: `prc-${extra.code}`,
    label: `${extra.code} · V${extra.versionNumber}`,
    productId: "prod-45",
    productCode: "PROD-000045",
    productName: "Whey Protein Concentrado 900 g — Baunilha",
    customerName: "NutriViva Suplementos Ltda",
    industrialCostCalculationId: "calc-123",
    calculationCode: "CALC-000123",
    originPricingPolicyVersionId: null,
    originPricingPolicyCode: null,
    originPricingPolicyVersionNumber: null,
    originPricingPolicyName: null,
    industrialCostVersionLabel: "EC-000012 · V3",
    formulationVersionNumber: 4,
    costReferenceDate: "2026-09-01T00:00:00.000Z",
    referenceOutputQuantity: "3000",
    referenceOutputUomCode: "un",
    minimumBatchQuantity: null,
    pricingComplete: extra.tiers.every((tier) => tier.selectedUnitPrice !== null),
    hasCustomerSuppliedMaterials: true,
    notes: null,
    createdAt: "2026-09-10T18:20:00.000Z",
    createdByName: "Rafael Moura",
    ...extra,
  };
}

/** Rascunho com cinco faixas sobre o CALC completo com estimativas. */
function precificacaoRascunho(): PricingVersionDTO {
  const estimativa = "COMPLETE_WITH_ESTIMATES" as const;
  return versao({
    code: "PREC-000007",
    versionNumber: 2,
    status: "DRAFT",
    costQuality: estimativa,
    activatedAt: null,
    activatedByName: null,
    tiers: [
      faixa("300", "1", "4986.30", "4986.30", estimativa, { modo: "TARGET_MARGIN", margem: "35", comissao: "5" }, [
        aviso("BELOW_REFERENCE_BATCH", "Abaixo do lote de referência (3000 un): o custo fixo por lote não se dilui."),
      ]),
      faixa("1000", "1", "12874.00", "12874.00", estimativa, { modo: "TARGET_MARGIN", margem: "32", comissao: "5" }),
      faixa("3000", "1", "34518.60", "34518.60", estimativa, { modo: "TARGET_MARGIN", margem: "30", comissao: "5" }),
      faixa("6000", "2", "69037.20", "69037.20", estimativa, { modo: "MANUAL_PRICE", preco: "19.90", comissao: "4" }),
      faixa("12000", "4", "138074.40", "138074.40", estimativa, { modo: "MANUAL_PRICE", preco: "18.50", comissao: "3" }),
    ],
    warnings: [
      aviso(
        "ESTIMATED_COST",
        "O cálculo de custo CALC-000123 usa estimativas: ofertas de fornecedor e referências manuais de custo.",
      ),
    ],
  });
}

/** Versão ativa sobre custo parcial, com 24 faixas — prova a paginação em paisagem. */
function precificacaoParcial(): PricingVersionDTO {
  const parcial = "PARTIAL" as const;
  const tiers = Array.from({ length: 24 }, (_, indice) => {
    const quantidade = new Decimal(500).times(indice + 1);
    const lotes = quantidade.dividedBy(3000).ceil();
    const conhecido = dinheiro(quantidade.times("10.2").plus(lotes.times(1800)));
    const preco: Preco =
      indice % 2 === 0
        ? { modo: "MANUAL_PRICE", preco: dinheiro(new Decimal("23.90").minus(new Decimal("0.2").times(indice))), comissao: "5" }
        : { modo: "TARGET_MARGIN", margem: "30", comissao: "5" };
    return faixa(quantidade.toString(), lotes.toString(), null, conhecido, parcial, preco);
  });
  return versao({
    code: "PREC-000008",
    versionNumber: 1,
    status: "ACTIVE",
    costQuality: parcial,
    activatedAt: "2026-09-11T13:10:00.000Z",
    activatedByName: "Rafael Moura",
    tiers,
    warnings: [aviso("INCOMPLETE_COST", "Ativada com custo incompleto: o aroma MP-000142 não tem referência de custo.")],
  });
}

// ---------------------------------------------------------------- provas

describe("gerador de PDF — Cálculo de custo industrial", () => {
  it(
    "completo, 41 materiais: 2+ folhas A4, cabeçalho repetido, linha inteira e a base junto do total",
    async () => {
      const calculo = calculoCompleto();
      const pdf = await gerar(
        <CostCalculationPdf calculation={calculo} generatedAt={GERADO_EM} generatedBy={GERADO_POR} />,
        amostra(costCalculationPdfFileName(calculo), "completo"),
      );

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      conferirFolhas(pdf, { orientacao: "retrato", titulo: "CÁLCULO DE CUSTO INDUSTRIAL", codigo: "CALC-000123" });
      const [primeira = ""] = pdf.paginas;
      expect(primeira).toContain("Qualidade do custo: Completo — com estimativas");
      expect(primeira).toContain(`Gerado por ${GERADO_POR}`);

      // A tabela de materiais atravessa a folha e leva o cabeçalho junto.
      const codigosVeridi = calculo.materials.filter((m) => !m.customerSupplied).map((m) => m.itemCode);
      const folhasDeMateriais = conferirCabecalho(
        pdf,
        (linha) => codigosVeridi.some((codigo) => linha.startsWith(`${codigo} — `)),
        "ORIGEM",
      );
      expect(folhasDeMateriais).toBeGreaterThanOrEqual(2);

      // Linha nunca se divide: código, custo e subtotal na mesma linha do papel.
      for (const material of calculo.materials) {
        const linha = linhaCom(pdf, `${material.itemCode} — `);
        expect(linha, material.itemCode).not.toBe("");
        expect(linha, material.itemCode).toContain(material.subtotal === null ? "—" : formatBRL(material.subtotal));
      }
      // Material do cliente: sem custo atribuído — "—", nunca R$ 0,00.
      expect(linhaCom(pdf, "EMB-000206 — ")).toContain("Material do cliente");
      expect(linhaCom(pdf, "EMB-000206 — ")).not.toContain("R$");

      // O resumo não se parte, e a base viaja com o total.
      const folhaDoResultado = folhaCom(pdf, "RESULTADO");
      expect(folhaDoResultado).toBeGreaterThanOrEqual(0);
      for (const trecho of [
        "Quantidade calculada",
        "Custo industrial total para 3000 un",
        "Equivalente por 1.000 un",
        "Valor normalizado a partir do custo por unidade",
      ]) {
        expect(pdf.paginas[folhaDoResultado], trecho).toContain(trecho);
      }
      expect(linhaCom(pdf, "Quantidade calculada")).toContain("3000 un");
      expect(linhaCom(pdf, "Custo industrial total para 3000 un")).toContain(
        formatBRL(calculo.totalIndustrialCost),
      );
      expect(linhaCom(pdf, "Equivalente por 1.000 un")).toContain(formatBRL(calculo.costPer1000));
      expect(pdf.paginas.join("\n")).toContain("Pertencem à estrutura física do produto");

      // Seção curta não deixa o título órfão no pé da folha.
      for (const [titulo, conteudo] of [
        ["RECURSOS INDUSTRIAIS", "RIN-000001 — "],
        ["PREMISSAS DE CUSTO", "Caixa de embarque 6 potes"],
        ["MATERIAIS FORNECIDOS PELO CLIENTE", "Pertencem à estrutura física do produto"],
        ["OBSERVAÇÕES DO CÁLCULO", "Proteína isolada de soja (MP-000103)"],
      ] as const) {
        expect(folhaCom(pdf, titulo), titulo).toBeGreaterThanOrEqual(0);
        expect(folhaCom(pdf, titulo), titulo).toBe(folhaCom(pdf, conteudo));
      }
      // Número e unidade das caixas não se separam na quebra de linha.
      expect(todasAsLinhas(pdf).some((linha) => /\(500\scx\)/.test(linha))).toBe(true);
    },
    PRAZO,
  );

  it(
    "parcial, estrutura em rascunho: subtotal conhecido nunca vira total e desconhecido é —",
    async () => {
      const calculo = calculoParcial();
      const pdf = await gerar(
        <CostCalculationPdf calculation={calculo} generatedAt={GERADO_EM} />,
        amostra(costCalculationPdfFileName(calculo), "parcial-rascunho"),
      );

      conferirFolhas(pdf, { orientacao: "retrato", titulo: "CÁLCULO DE CUSTO INDUSTRIAL", codigo: "CALC-000124" });
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("Qualidade do custo: Parcial — há custos não informados");
      expect(tudo).toContain("Cálculo parcial — existem premissas");
      expect(tudo).toContain("Estrutura em rascunho no momento do cálculo");
      expect(tudo).not.toContain("Custo industrial total");
      expect(tudo).not.toContain("Gerado por");

      expect(linhaCom(pdf, "Subtotal conhecido para 500 un")).toContain(formatBRL(calculo.knownSubtotal));
      const linhas = todasAsLinhas(pdf);
      for (const desconhecido of [
        "Energia —",
        "Custo industrial direto —",
        "Custo por unidade —",
        "Equivalente por 1.000 un —",
      ]) {
        expect(linhas, desconhecido).toContain(desconhecido);
      }
      const semCusto = linhaCom(pdf, "MP-000142 — ");
      expect(semCusto).toContain("Sem referência de custo");
      expect(semCusto).not.toContain("R$");
    },
    PRAZO,
  );
});

describe("gerador de PDF — Custo industrial da produção", () => {
  it(
    "híbrido final, 44 consumos: 2+ folhas A4, cabeçalho repetido e linha de consumo inteira",
    async () => {
      const custo = custoHibrido();
      const pdf = await gerar(
        <ProductionCostPdf cost={custo} generatedAt={GERADO_EM} generatedBy={GERADO_POR} />,
        amostra(productionCostPdfFileName(custo), "hibrido-final"),
      );

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      conferirFolhas(pdf, { orientacao: "retrato", titulo: "CUSTO INDUSTRIAL DA PRODUÇÃO", codigo: "OP-000087" });
      const [primeira = ""] = pdf.paginas;
      expect(primeira).toContain("Status: Final — produção concluída");
      expect(primeira).toContain("Qualidade do custo: Completo — referências reais de compra");
      expect(primeira).toContain("Híbrido: materiais realizados + custos industriais padrão aplicados.");

      const folhasDeConsumo = conferirCabecalho(pdf, (linha) => /LT-\d{8}-\d{6}/.test(linha), "CONSUMIDO EM");
      expect(folhasDeConsumo).toBeGreaterThanOrEqual(2);
      // Lote inteiro, carimbo e subtotal na mesma linha — o consumo não se parte.
      for (const material of custo.materials) {
        const lote = material.lotCode ?? "";
        const linha = linhaCom(pdf, lote);
        expect(linha, lote).not.toBe("");
        expect(linha, lote).toContain(formatPdfDateTime(material.consumedAt));
        expect(linha, lote).toContain(material.customerSupplied ? "Material do cliente" : formatBRL(material.subtotal));
      }

      const folhaDoResultado = folhaCom(pdf, "RESULTADO");
      expect(pdf.paginas[folhaDoResultado]).toContain("Custo por unidade produzida");
      expect(linhaCom(pdf, "Custo industrial da produção")).toContain(formatBRL(custo.totalIndustrialCost));
    },
    PRAZO,
  );

  it(
    "sem estrutura, provisório e parcial: materiais realizados e subtotal conhecido",
    async () => {
      const custo = custoSemEstrutura();
      const pdf = await gerar(
        <ProductionCostPdf cost={custo} generatedAt={GERADO_EM} />,
        amostra(productionCostPdfFileName(custo), "sem-estrutura-parcial"),
      );

      conferirFolhas(pdf, { orientacao: "retrato", titulo: "CUSTO INDUSTRIAL DA PRODUÇÃO", codigo: "OP-000091" });
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("Status: Provisório — produção em andamento");
      expect(tudo).toContain("Materiais realizados. Os custos industriais adicionais dependem");
      expect(tudo).toContain("Cálculo parcial — existem custos não informados.");
      expect(tudo).toContain("Sem estrutura de custos vinculada");
      expect(tudo).not.toContain("Custo industrial da produção");
      expect(linhaCom(pdf, "Subtotal conhecido")).toContain(formatBRL(custo.knownSubtotal));
      expect(todasAsLinhas(pdf)).toContain("Custo por unidade produzida —");
      const semCusto = linhaCom(pdf, "MP-000142 — ");
      expect(semCusto).not.toContain("R$");
    },
    PRAZO,
  );
});

describe("gerador de PDF — Simulação de preço e margem", () => {
  it(
    "rascunho, 5 faixas: paisagem A4, rascunho marcado, custo da faixa e equivalência na mesma linha",
    async () => {
      const precificacao = precificacaoRascunho();
      const pdf = await gerar(
        <PricingPdf pricing={precificacao} generatedAt={GERADO_EM} generatedBy={GERADO_POR} />,
        amostra(pricingPdfFileName(precificacao), "rascunho-5-faixas"),
      );

      conferirFolhas(pdf, { orientacao: "paisagem", titulo: "SIMULAÇÃO DE PREÇO E MARGEM", codigo: "PREC-000007 · V2" });
      const [primeira = ""] = pdf.paginas;
      expect(primeira).toContain("RASCUNHO");
      expect(primeira).toContain("Status: Rascunho");
      expect(primeira).toContain("Qualidade do custo: Completo — com estimativas");
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("Contribuição = preço");
      expect(tudo).toContain("Valor normalizado a partir do custo por unidade");
      expect(tudo).toContain("Abaixo do lote de referência");

      conferirCabecalho(pdf, (linha) => linha.includes("Calcular pela margem") || linha.includes("Informar preço"), "MARKUP");
      conferirCabecalho(pdf, (linha) => /^\d+ un \d+ R\$/.test(linha), "CUSTO TOTAL DA FAIXA");
      // Seção curta não se parte: título, primeira e última faixa e ressalva na mesma folha.
      const folhaDoCusto = folhaCom(pdf, "CUSTO POR FAIXA");
      expect(folhaDoCusto).toBeGreaterThanOrEqual(0);
      expect(folhaCom(pdf, "300 un 1 R$")).toBe(folhaDoCusto);
      expect(folhaCom(pdf, "12000 un 4 R$")).toBe(folhaDoCusto);
      expect(folhaCom(pdf, "Valor normalizado a partir do custo por unidade")).toBe(folhaDoCusto);
      // Cada faixa é da sua quantidade: custo total e equivalência lado a lado.
      const linhas = todasAsLinhas(pdf);
      for (const tier of precificacao.tiers) {
        const inicio = `${tier.quantity} un ${tier.batchCount} `;
        expect(
          linhas.some(
            (linha) =>
              linha.startsWith(inicio) &&
              linha.includes(formatBRL(tier.industrialCostTotal)) &&
              linha.includes(formatBRL(tier.costPer1000)),
          ),
          inicio,
        ).toBe(true);
      }
    },
    PRAZO,
  );

  it(
    "ativa, custo parcial, 24 faixas: 2+ folhas em paisagem, cabeçalhos repetidos e subtotal conhecido",
    async () => {
      const precificacao = precificacaoParcial();
      const pdf = await gerar(
        <PricingPdf pricing={precificacao} generatedAt={GERADO_EM} generatedBy={GERADO_POR} />,
        amostra(pricingPdfFileName(precificacao), "ativa-parcial-24-faixas"),
      );

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      conferirFolhas(pdf, { orientacao: "paisagem", titulo: "SIMULAÇÃO DE PREÇO E MARGEM", codigo: "PREC-000008 · V1" });
      const tudo = pdf.paginas.join("\n");
      expect(tudo).not.toContain("RASCUNHO");
      expect(tudo).toContain("Status: Ativa");
      expect(tudo).toContain("Custo incompleto — margem não calculável");

      const folhasDeFaixas = conferirCabecalho(
        pdf,
        (linha) => linha.includes("Calcular pela margem") || linha.includes("Informar preço"),
        "MARKUP",
      );
      const folhasDeCusto = conferirCabecalho(pdf, (linha) => linha.includes("(subtotal conhecido)"), "CUSTO TOTAL DA FAIXA");
      expect(folhasDeFaixas).toBeGreaterThanOrEqual(2);
      expect(folhasDeCusto).toBeGreaterThanOrEqual(2);
      // Custo incompleto: a faixa mostra o subtotal conhecido com esse nome.
      const linhas = todasAsLinhas(pdf);
      for (const tier of precificacao.tiers) {
        const inicio = `${tier.quantity} un ${tier.batchCount} `;
        expect(
          linhas.some(
            (linha) => linha.startsWith(inicio) && linha.includes(`${formatBRL(tier.knownSubtotal)} (subtotal conhecido)`),
          ),
          inicio,
        ).toBe(true);
      }
    },
    PRAZO,
  );
});

describe("apoios dos documentos de custo", () => {
  it("nome de arquivo sai do código real — nunca document.pdf", () => {
    expect(costCalculationPdfFileName({ code: "CALC-000123" })).toBe("CALC-000123.pdf");
    expect(productionCostPdfFileName({ productionOrderCode: "OP-000087" })).toBe("Custo-producao-OP-000087.pdf");
    expect(pricingPdfFileName({ code: "PREC-000007", versionNumber: 2 })).toBe("PREC-000007-V2.pdf");
  });
});
