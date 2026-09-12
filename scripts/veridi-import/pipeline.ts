import { Prisma, PrismaClient } from "@prisma/client";
import { doseToKg, readCmvProducts, reconstructGroup } from "../veridi-data/formulation-analysis.js";
import {
  groupLegacyProjects,
  legacyQuoteVersions,
  readLegacyProjectRows,
} from "../veridi-data/project-analysis.js";
import {
  normalizeName,
  readLegacySampleRows,
  resolveSamples,
} from "../veridi-data/sample-analysis.js";
import {
  legacyOfferSourceKey,
  normalizeSupplierName,
  parseMinimumOrder,
  readLegacySupplierPriceRows,
} from "../veridi-data/supplier-price-analysis.js";
import { readCorpusCsv, cleanText, safeDecimal } from "../veridi-data/corpus.js";
import type { MappedItem } from "../veridi-data/mapping.js";
import {
  mapCustomers,
  mapItems,
  mapProducts,
  mapSuppliers,
  readFormulationRows,
  selectLatestGroups,
} from "../veridi-data/mapping.js";
import { nextSequenceCode } from "../../apps/api/src/lib/sequence-code.js";
import { ImportFindingLog } from "./findings.js";
import { campo, workbookObrigatorio } from "./review-package.js";
import type { PacoteRevisao, RegistroRevisado } from "./review-package.js";
import { lerFornecedoresRevisados, resolverFornecedorDaOferta } from "./supplier-review.js";
import type { LeituraDeFornecedores } from "./supplier-review.js";
import {
  lerClientesRevisados,
  lerItensRevisados,
  lerProdutosRevisados,
  numeroRevisado,
} from "./master-data-review.js";
import type {
  ClienteRevisado,
  ItemRevisado,
  LeituraRevisada,
  ProdutoRevisado,
} from "./master-data-review.js";
import type { Overrides } from "./overrides.js";

/**
 * Migração Veridi — o mesmo código roda em PLAN (dry-run) e em APPLY.
 *
 * Uma implementação só, com `write` como interruptor: um planejador
 * separado do aplicador acabaria divergindo, e o plano deixaria de
 * descrever o que o apply realmente faz.
 *
 * Regras estruturais que atravessam todos os domínios:
 * - **aditivo e idempotente**: nada é apagado, nada é truncado, e rodar de
 *   novo não duplica (chave = `externalCode`/`sourceKey`/chave de negócio);
 * - **erro do legado não vira erro do ERP**: dado ambíguo produz finding e
 *   fica de fora, nunca é "corrigido" por adivinhação;
 * - **registro editado no ERP não é sobrescrito** pelo legado;
 * - **importar master data NÃO movimenta estoque** — saldo de abertura é um
 *   processo separado, com reconciliação humana.
 */

const ACTOR = "Importação Veridi";
const MASS_UOM_CODES = new Set(["mg", "g", "kg"]);

const UNITS = [
  { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
  { code: "g", label: "Grama", dimension: "MASS" as const, toBaseFactor: "1" },
  { code: "mg", label: "Miligrama", dimension: "MASS" as const, toBaseFactor: "0.001" },
  { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
  { code: "L", label: "Litro", dimension: "VOLUME" as const, toBaseFactor: "1" },
  { code: "mL", label: "Mililitro", dimension: "VOLUME" as const, toBaseFactor: "0.001" },
];

/**
 * Códigos internos vêm das MESMAS sequences da aplicação. O mapa é copiado
 * (e não importado de `modules/items/item-codes.ts`) porque aquele módulo
 * depende de `@veridi/shared`, que não resolve fora do workspace da API —
 * a sequence no Postgres continua sendo a fonte única.
 */
const ITEM_CODE_SEQUENCE: Record<
  MappedItem["type"] | "FINISHED_PRODUCT",
  { sequence: string; prefix: string }
> = {
  RAW_MATERIAL: { sequence: "item_code_raw_material_seq", prefix: "MP" },
  PACKAGING: { sequence: "item_code_packaging_seq", prefix: "ME" },
  FINISHED_PRODUCT: { sequence: "item_code_finished_product_seq", prefix: "PA" },
};

export interface DomainCounts {
  /** Registros novos (ou que seriam criados, em dry-run). */
  created: number;
  /** Registros já presentes que foram completados com dado legado. */
  updated: number;
  /** Já existentes e intocados. */
  existing: number;
  /** Fora por finding BLOCKING ou por política. */
  skipped: number;
}

function emptyCounts(): DomainCounts {
  return { created: 0, updated: 0, existing: 0, skipped: 0 };
}

export interface OpeningInventoryRow {
  legacyItemCode: string;
  itemCode: string;
  itemName: string;
  expectedLegacyTotal: string;
  itemUom: string;
  controlsLot: boolean;
}

export interface PipelineResult {
  write: boolean;
  domains: {
    suppliers: DomainCounts;
    customers: DomainCounts;
    items: DomainCounts;
    products: DomainCounts;
    finishedProductItems: DomainCounts;
    formulations: DomainCounts;
    projects: DomainCounts;
    quotes: DomainCounts;
    samples: DomainCounts;
    supplierItems: DomainCounts;
    supplierItemOffers: DomainCounts;
  };
  formulationDetail: { perDose: number; fixedBasis: number; withoutUsableRows: number };
  golden: { comparable: number; matched: number; divergent: number };
  stock: { positive: number; zero: number; negative: number; unreadable: number };
  templates: {
    unresolvedItemCodes: { legacyItemCode: string; description: string }[];
    incompatiblePriceUom: {
      sourceKey: string;
      legacyItemCode: string;
      itemCode: string;
      itemUom: string;
      sourcePriceUom: string;
    }[];
    unresolvedSamples: {
      legacySample: string;
      description: string;
      testNumber: string;
    }[];
    openingInventory: OpeningInventoryRow[];
  };
  /** Retrato da revisão humana usada nesta execução. `null` = rodou sem pacote. */
  review: ReviewSummary | null;
  findings: ImportFindingLog;
}

export interface ReviewSummary {
  identity: string;
  path: string;
  workbooks: { name: string; records: number; counts: Record<string, number> }[];
  suppliers: {
    approved: number;
    excluded: number;
    created: number;
    updated: number;
    unchanged: number;
    withAddress: number;
  };
  customers: { approved: number; excluded: number };
  items: { approved: number; excluded: number };
  products: { approved: number; excluded: number };
  supplierItems: { approved: number; excluded: number; orphan: number };
  /** `true` quando a leitura do pacote produziu finding BLOCKING. */
  blocked: boolean;
}

export interface PipelineContext {
  prisma: PrismaClient;
  /** `false` = dry-run (PLAN): nenhuma escrita acontece. */
  write: boolean;
  overrides: Overrides;
  /**
   * Pacote de revisão devolvido pela Veridi. Quando presente, ele é a
   * autoridade sobre inclusão, exclusão e valores dos domínios que já passam
   * por ele — o corpus vira só a fonte histórica. Ausente, o pipeline roda
   * como sempre rodou, o que serve para desenvolvimento; o APPLY recusa.
   */
  review?: PacoteRevisao | null;
}

/**
 * Workbooks cuja revisão o pipeline consome de verdade.
 *
 * O 06 fica de fora de propósito: usa ACEITA/REJEITADA, é referência de
 * mercado e nunca vira custo — fluxo próprio, não decisão de carga.
 */
export const WORKBOOK_CLIENTES = "01_CLIENTES";
export const WORKBOOK_FORNECEDORES = "02_FORNECEDORES";
export const WORKBOOK_MATERIAS_PRIMAS = "03_MATERIAS_PRIMAS";
export const WORKBOOK_EMBALAGENS = "04_EMBALAGENS_INSUMOS";
export const WORKBOOK_PRODUTOS = "05_PRODUTOS_ACABADOS";
export const WORKBOOK_OFERTAS = "07_FORNECEDOR_ITENS_PRECOS";
export const WORKBOOKS_DO_ESCOPO: readonly string[] = [
  WORKBOOK_CLIENTES,
  WORKBOOK_FORNECEDORES,
  WORKBOOK_MATERIAS_PRIMAS,
  WORKBOOK_EMBALAGENS,
  WORKBOOK_PRODUTOS,
  WORKBOOK_OFERTAS,
];

/**
 * HOMOLOGACAO do workbook → `SupplierItemQualificationStatus`.
 *
 * O rótulo em português é o que a Veridi vê; o valor técnico é o mesmo que a
 * aba VALORES_PERMITIDOS documenta para cada um.
 */
const QUALIFICACAO_DO_PACOTE: Record<string, "PENDING" | "APPROVED" | "BLOCKED"> = {
  PENDENTE: "PENDING",
  HOMOLOGADO: "APPROVED",
  BLOQUEADO: "BLOCKED",
};

/** Id fictício usado no dry-run para manter o encadeamento entre domínios. */
function plannedId(kind: string, key: string): string {
  return `plan:${kind}:${key}`;
}

function isPlanned(id: string): boolean {
  return id.startsWith("plan:");
}

/**
 * `ITEM-LEG-` + o código da planilha em 4 dígitos — a mesma chave que o
 * tooling do pacote escreve para matéria-prima e embalagem.
 */
export function chaveDoItem(codigoPlanilha: string): string {
  return `ITEM-LEG-${codigoPlanilha.padStart(4, "0")}`;
}

/** O código legado corresponde a um item que a Veridi tirou da carga? */
function chaveDoItemLegado(codigoPlanilha: string, revisao: LeituraRevisada<ItemRevisado>): boolean {
  return revisao.excluidos.has(chaveDoItem(codigoPlanilha));
}

export async function runPipeline(ctx: PipelineContext): Promise<PipelineResult> {
  const { prisma, write, overrides } = ctx;
  const review = ctx.review ?? null;
  const findings = new ImportFindingLog();

  const domains: PipelineResult["domains"] = {
    suppliers: emptyCounts(),
    customers: emptyCounts(),
    items: emptyCounts(),
    products: emptyCounts(),
    finishedProductItems: emptyCounts(),
    formulations: emptyCounts(),
    projects: emptyCounts(),
    quotes: emptyCounts(),
    samples: emptyCounts(),
    supplierItems: emptyCounts(),
    supplierItemOffers: emptyCounts(),
  };

  const templates: PipelineResult["templates"] = {
    unresolvedItemCodes: [],
    incompatiblePriceUom: [],
    unresolvedSamples: [],
    openingInventory: [],
  };

  const nextCode = async (sequence: string, prefix: string, key: string): Promise<string> =>
    write ? nextSequenceCode(prisma, sequence, prefix) : plannedId(prefix, key);

  /* ── 1. Unidades de medida ─────────────────────────────── */
  if (write) {
    for (const unit of UNITS) {
      await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
    }
  }

  /* ── 2. Fornecedores ───────────────────────────────────── */
  // Com pacote de revisão, o 02 devolvido manda: razão social, contato e
  // endereço saem do workbook, a CHAVE_MIGRACAO é a identidade e o corpus não
  // é consultado. Sem pacote, segue o caminho antigo — que serve para
  // desenvolvimento, e que o APPLY recusa.
  const supplierIdByName = new Map<string, string>();
  const supplierIdByKey = new Map<string, string>();
  let supplierReview: LeituraDeFornecedores | null = null;
  const supplierStats = { created: 0, updated: 0, unchanged: 0, withAddress: 0 };

  if (review) {
    supplierReview = lerFornecedoresRevisados(workbookObrigatorio(review, WORKBOOK_FORNECEDORES), findings);

    for (const chave of supplierReview.excluidos) {
      findings.add(
        "SUPPLIER_REVIEW_NOT_IMPORTED",
        "Supplier",
        chave,
        "marcado NAO_IMPORTAR na revisao — nao criado, nao atualizado",
      );
      domains.suppliers.skipped += 1;
    }

    for (const supplier of supplierReview.aprovados) {
      const data = {
        legalName: supplier.legalName,
        tradeName: supplier.tradeName,
        cnpj: supplier.cnpj,
        email: supplier.email,
        phone: supplier.phone,
        zipCode: supplier.zipCode,
        street: supplier.street,
        number: supplier.number,
        complement: supplier.complement,
        district: supplier.district,
        city: supplier.city,
        state: supplier.state,
        notes: supplier.notes,
        active: supplier.active,
      };
      if (supplier.temEndereco) supplierStats.withAddress += 1;

      // Reencontro entre execuções é por razão social — é o único
      // identificador estável que o Supplier tem hoje. A colisão já foi
      // barrada na leitura, então este `findFirst` é determinístico.
      const existing = await prisma.supplier.findFirst({ where: { legalName: supplier.legalName } });
      if (existing) {
        const igual = (Object.keys(data) as (keyof typeof data)[]).every(
          (chave) => (existing[chave] ?? null) === (data[chave] ?? null),
        );
        if (igual) {
          domains.suppliers.existing += 1;
          supplierStats.unchanged += 1;
        } else {
          if (write) await prisma.supplier.update({ where: { id: existing.id }, data });
          findings.add(
            "SUPPLIER_REVIEW_EXISTING_UPDATED",
            "Supplier",
            supplier.key,
            `cadastro existente (${existing.code}) alinhado com os valores aprovados na revisao`,
          );
          domains.suppliers.updated += 1;
          supplierStats.updated += 1;
        }
        supplierIdByKey.set(supplier.key, existing.id);
        continue;
      }

      const code = await nextCode("supplier_code_seq", "FOR", supplier.key);
      const id = write
        ? (await prisma.supplier.create({ data: { code, ...data } })).id
        : plannedId("supplier", supplier.key);
      supplierIdByKey.set(supplier.key, id);
      domains.suppliers.created += 1;
      supplierStats.created += 1;
    }
    // Sem varredura por nome aqui, de propósito: com revisão, relação só
    // resolve pela CHAVE_MIGRACAO. Casar por nome parecido é como um
    // fornecedor excluído reapareceria pela porta dos fundos.
  } else {
    for (const supplier of mapSuppliers(findings)) {
      const existing = await prisma.supplier.findFirst({ where: { legalName: supplier.legalName } });
      if (existing) {
        domains.suppliers.existing += 1;
        supplierIdByName.set(normalizeSupplierName(supplier.legalName), existing.id);
        continue;
      }
      const code = await nextCode("supplier_code_seq", "FOR", supplier.legalName);
      const id = write
        ? (
            await prisma.supplier.create({
              data: { code, legalName: supplier.legalName, active: true },
            })
          ).id
        : plannedId("supplier", supplier.legalName);
      supplierIdByName.set(normalizeSupplierName(supplier.legalName), id);
      domains.suppliers.created += 1;
    }
    // Fornecedores já existentes que não vieram da planilha continuam válidos
    // para resolver preços — a base pode ter cadastro manual anterior.
    for (const supplier of await prisma.supplier.findMany()) {
      const key = normalizeSupplierName(supplier.legalName);
      if (!supplierIdByName.has(key)) supplierIdByName.set(key, supplier.id);
    }
  }

  /* ── 3. Clientes ───────────────────────────────────────── */
  /*
   * Com revisão, o 01 devolvido é a autoridade. O mapa por `externalCode`
   * continua sendo preenchido porque é por ele que formulações, projetos e
   * amostras — que não têm workbook — encontram o cliente; o mapa por
   * CHAVE_MIGRACAO é o que liga um workbook ao outro.
   */
  const customerIdByExternal = new Map<string, string>();
  const customerIdByKey = new Map<string, string>();
  let customerReview: LeituraRevisada<ClienteRevisado> | null = null;

  if (review) {
    customerReview = lerClientesRevisados(workbookObrigatorio(review, WORKBOOK_CLIENTES), findings);
    for (const chave of customerReview.excluidos) {
      findings.add("CUSTOMER_REVIEW_NOT_IMPORTED", "Customer", chave, "marcado NAO_IMPORTAR na revisao");
      domains.customers.skipped += 1;
    }
    for (const customer of customerReview.aprovados) {
      const data = {
        legalName: customer.legalName,
        tradeName: customer.tradeName,
        cnpj: customer.cnpj,
        taxProfile: customer.taxProfile as never,
        email: customer.email,
        phone: customer.phone,
        zipCode: customer.zipCode,
        street: customer.street,
        number: customer.number,
        complement: customer.complement,
        district: customer.district,
        city: customer.city,
        state: customer.state,
        notes: customer.notes,
        active: customer.active,
      };
      const existing = await prisma.customer.findFirst({ where: { externalCode: customer.externalCode } });
      if (existing) {
        if (write) await prisma.customer.update({ where: { id: existing.id }, data });
        domains.customers.updated += 1;
        customerIdByExternal.set(customer.externalCode, existing.id);
        customerIdByKey.set(customer.key, existing.id);
        continue;
      }
      const code = await nextCode("customer_code_seq", "CLI", customer.externalCode);
      const id = write
        ? (await prisma.customer.create({ data: { ...data, code, externalCode: customer.externalCode } })).id
        : plannedId("customer", customer.externalCode);
      customerIdByExternal.set(customer.externalCode, id);
      customerIdByKey.set(customer.key, id);
      domains.customers.created += 1;
    }
  } else {
  for (const customer of mapCustomers(findings)) {
    const data = {
      legalName: customer.legalName,
      tradeName: customer.tradeName,
      // CNPJ inválido nunca é "corrigido": o dígito legado fica no
      // relatório e o campo entra nulo quando o domínio o rejeita.
      cnpj: customer.cnpj,
      city: customer.city,
      state: customer.state,
      // Só o que o parser conseguiu afirmar. `null` continua null.
      street: customer.street,
      number: customer.number,
      district: customer.district,
      // Endereço legado fica em notas: decompor não é inequívoco e inventar
      // rua/número/CEP seria pior que preservar o texto original.
      notes: customer.legacyAddress ? `Endereço (planilha): ${customer.legacyAddress}` : null,
      active: true,
    };

    const existing = await prisma.customer.findFirst({
      where: { externalCode: customer.externalCode },
    });
    if (existing) {
      if (write) await prisma.customer.update({ where: { id: existing.id }, data });
      domains.customers.updated += 1;
      customerIdByExternal.set(customer.externalCode, existing.id);
      continue;
    }

    const code = await nextCode("customer_code_seq", "CLI", customer.externalCode);
    const id = write
      ? (
          await prisma.customer.create({
            data: { ...data, code, externalCode: customer.externalCode },
          })
        ).id
      : plannedId("customer", customer.externalCode);
    customerIdByExternal.set(customer.externalCode, id);
    domains.customers.created += 1;
  }
  }

  /* ── 4. Itens ──────────────────────────────────────────── */
  /*
   * 03 e 04 são o mesmo domínio (`Item`) em dois arquivos, e a coluna TIPO é
   * que decide qual é qual. Os dois workbooks entram no mesmo mapa.
   */
  const items = mapItems(findings);
  const itemIdByExternal = new Map<string, string>();
  const itemIdByKey = new Map<string, string>();
  const itemByExternalCode = new Map(items.map((item) => [item.externalCode, item]));
  const itemUnitByExternal = new Map<string, string>();
  let itemReview: LeituraRevisada<ItemRevisado> | null = null;

  if (review) {
    // Catálogo real de unidades: unidade revisada é conferida contra o que
    // existe no banco, nunca criada a partir de texto do Excel.
    const unidadesValidas = new Set(
      (await prisma.unitOfMeasure.findMany({ select: { code: true } })).map((unidade) => unidade.code),
    );
    const lidos: ItemRevisado[] = [];
    const excluidos = new Set<string>();
    let bloqueado = false;
    for (const nome of [WORKBOOK_MATERIAS_PRIMAS, WORKBOOK_EMBALAGENS]) {
      const leitura = lerItensRevisados(workbookObrigatorio(review, nome), unidadesValidas, findings);
      lidos.push(...leitura.aprovados);
      for (const chave of leitura.excluidos) excluidos.add(chave);
      bloqueado = bloqueado || leitura.bloqueado;
    }
    itemReview = { aprovados: lidos, excluidos, bloqueado };

    for (const chave of excluidos) {
      findings.add("ITEM_REVIEW_NOT_IMPORTED", "Item", chave, "marcado NAO_IMPORTAR na revisao");
      domains.items.skipped += 1;
    }
    for (const item of lidos) {
      const data = {
        name: item.name,
        type: item.type,
        unitCode: item.unitCode,
        sourceName: item.sourceName,
        declaredNutrient: item.declaredNutrient,
        family: item.family as never,
        defaultPurityPercent: item.defaultPurityPercent,
        packagingSubtype: item.packagingSubtype as never,
        controlsLot: item.controlsLot,
        controlsExpiry: item.controlsExpiry,
        requiresQualityRelease: item.requiresQualityRelease,
        requiresCoa: item.requiresCoa,
        externalBarcode: item.externalBarcode,
        active: item.active,
      };
      itemUnitByExternal.set(item.externalCode, item.unitCode);
      const existing = await prisma.item.findFirst({ where: { externalCode: item.externalCode } });
      if (existing) {
        if (write) await prisma.item.update({ where: { id: existing.id }, data });
        domains.items.updated += 1;
        itemIdByExternal.set(item.externalCode, existing.id);
        itemIdByKey.set(item.key, existing.id);
        continue;
      }
      const code = await nextCode(
        ITEM_CODE_SEQUENCE[item.type].sequence,
        ITEM_CODE_SEQUENCE[item.type].prefix,
        item.externalCode,
      );
      const id = write
        ? (await prisma.item.create({ data: { ...data, code, externalCode: item.externalCode } })).id
        : plannedId("item", item.externalCode);
      itemIdByExternal.set(item.externalCode, id);
      itemIdByKey.set(item.key, id);
      domains.items.created += 1;
    }
  } else {
  for (const item of items) {
    const data = {
      name: item.name,
      type: item.type,
      unitCode: item.unitCode,
      sourceName: item.sourceName,
      declaredNutrient: item.declaredNutrient,
      family: item.family as never,
      // Potência não-percentual (500.000 UI/g) não cabe aqui: fica null e
      // vira finding, nunca um número forçado no campo de pureza.
      defaultPurityPercent: item.defaultPurityPercent,
      controlsLot: true,
      controlsExpiry: item.type === "RAW_MATERIAL",
      requiresQualityRelease: item.type === "RAW_MATERIAL",
      active: true,
    };

    const existing = await prisma.item.findFirst({ where: { externalCode: item.externalCode } });
    if (existing) {
      if (write) await prisma.item.update({ where: { id: existing.id }, data });
      domains.items.updated += 1;
      itemIdByExternal.set(item.externalCode, existing.id);
      continue;
    }

    const code = await nextCode(
      ITEM_CODE_SEQUENCE[item.type].sequence,
      ITEM_CODE_SEQUENCE[item.type].prefix,
      item.externalCode,
    );
    const id = write
      ? (
          await prisma.item.create({
            data: { ...data, code, externalCode: item.externalCode },
          })
        ).id
      : plannedId("item", item.externalCode);
    itemIdByExternal.set(item.externalCode, id);
    domains.items.created += 1;
  }
  }

  /* ── 5. Produtos + item de produto acabado ─────────────── */
  const formulationRows = readFormulationRows(findings);
  const latestGroups = selectLatestGroups(formulationRows, findings);
  const products = mapProducts(new Set(latestGroups.keys()), findings);
  const cmvProducts = readCmvProducts();

  const productByExternal = new Map<
    string,
    { id: string; finishedItemId: string; customerId: string | null }
  >();
  let productReview: LeituraRevisada<ProdutoRevisado> | null = null;

  if (review) {
    const unidadesValidas = new Set(
      (await prisma.unitOfMeasure.findMany({ select: { code: true } })).map((unidade) => unidade.code),
    );
    productReview = lerProdutosRevisados(
      workbookObrigatorio(review, WORKBOOK_PRODUTOS),
      unidadesValidas,
      findings,
    );
    for (const chave of productReview.excluidos) {
      // Produto e item de produto acabado são uma decisão só no workbook:
      // excluir o produto exclui o par inteiro, sem cascata inventada.
      findings.add(
        "PRODUCT_REVIEW_NOT_IMPORTED",
        "Product",
        chave,
        "marcado NAO_IMPORTAR na revisao — nem o produto nem o item de produto acabado sao criados",
      );
      domains.products.skipped += 1;
      domains.finishedProductItems.skipped += 1;
    }

    for (const product of productReview.aprovados) {
      if (customerReview?.excluidos.has(product.customerKey)) {
        findings.add(
          "PRODUCT_REVIEW_CUSTOMER_NOT_IMPORTED",
          "Product",
          `${product.key} → ${product.customerKey}`,
          "produto aprovado aponta para cliente marcado NAO_IMPORTAR",
        );
        domains.products.skipped += 1;
        continue;
      }
      const customerId = customerIdByKey.get(product.customerKey) ?? null;
      if (!customerId) {
        findings.add(
          "PRODUCT_REVIEW_CUSTOMER_KEY_UNKNOWN",
          "Product",
          `${product.key} → ${product.customerKey}`,
          "CHAVE_CLIENTE sem cliente aprovado no workbook de clientes",
        );
        domains.products.skipped += 1;
        continue;
      }

      const existing = await prisma.product.findFirst({ where: { externalCode: product.externalCode } });
      const dadosProduto = {
        name: product.name,
        dosageForm: product.dosageForm as never,
        presentationType: product.presentationType as never,
        capsulesPerDose: product.capsulesPerDose,
        doseAmount: product.doseAmount,
        doseUomCode: product.doseUomCode,
        dosesPerPackage: product.dosesPerPackage,
        unitsPerShippingBox: product.unitsPerShippingBox,
        targetAgeGroup: product.targetAgeGroup as never,
        shelfLifeMonths: product.shelfLifeMonths,
        minimumBatchQuantity: product.minimumBatchQuantity,
        notes: product.notes,
        active: product.active,
      };
      const dadosItemPA = {
        name: product.name,
        unitCode: product.finishedUnitCode,
        requiresCoa: product.finishedRequiresCoa,
        active: product.active,
      };

      if (existing?.finishedProductItemId) {
        if (write) {
          await prisma.product.update({
            where: { id: existing.id },
            data: { ...dadosProduto, customerId },
          });
          await prisma.item.update({
            where: { id: existing.finishedProductItemId },
            data: dadosItemPA,
          });
        }
        domains.products.updated += 1;
        domains.finishedProductItems.updated += 1;
        productByExternal.set(product.externalCode, {
          id: existing.id,
          finishedItemId: existing.finishedProductItemId,
          customerId,
        });
        itemIdByKey.set(product.finishedItemKey, existing.finishedProductItemId);
        continue;
      }

      // Produto acabado real precisa do próprio Item físico (1:1).
      const finishedCode = await nextCode(
        ITEM_CODE_SEQUENCE.FINISHED_PRODUCT.sequence,
        ITEM_CODE_SEQUENCE.FINISHED_PRODUCT.prefix,
        product.externalCode,
      );
      const finishedItemId = write
        ? (
            await prisma.item.create({
              data: {
                ...dadosItemPA,
                code: finishedCode,
                type: "FINISHED_PRODUCT",
                controlsLot: true,
                controlsExpiry: true,
                requiresQualityRelease: true,
              },
            })
          ).id
        : plannedId("finished-item", product.externalCode);
      domains.finishedProductItems.created += 1;

      const productCode = await nextCode("product_code_seq", "PROD", product.externalCode);
      const productId = write
        ? (
            await prisma.product.create({
              data: {
                ...dadosProduto,
                code: productCode,
                externalCode: product.externalCode,
                finishedProductItemId: finishedItemId,
                ...(isPlanned(customerId) ? {} : { customerId }),
              },
            })
          ).id
        : plannedId("product", product.externalCode);

      domains.products.created += 1;
      productByExternal.set(product.externalCode, { id: productId, finishedItemId, customerId });
      itemIdByKey.set(product.finishedItemKey, finishedItemId);
    }
  } else {
  for (const product of products) {
    const existing = await prisma.product.findFirst({
      where: { externalCode: product.externalCode },
    });
    if (existing?.finishedProductItemId) {
      domains.products.existing += 1;
      productByExternal.set(product.externalCode, {
        id: existing.id,
        finishedItemId: existing.finishedProductItemId,
        customerId: existing.customerId,
      });
      continue;
    }

    const customerId = product.customerExternalCode
      ? (customerIdByExternal.get(product.customerExternalCode) ?? null)
      : null;

    // Produto acabado real precisa do próprio Item físico (1:1).
    const finishedCode = await nextCode(
      ITEM_CODE_SEQUENCE.FINISHED_PRODUCT.sequence,
      ITEM_CODE_SEQUENCE.FINISHED_PRODUCT.prefix,
      product.externalCode,
    );
    const finishedItemId = write
      ? (
          await prisma.item.create({
            data: {
              code: finishedCode,
              type: "FINISHED_PRODUCT",
              name: product.name,
              unitCode: "un",
              controlsLot: true,
              controlsExpiry: true,
              requiresQualityRelease: true,
              active: true,
            },
          })
        ).id
      : plannedId("finished-item", product.externalCode);
    domains.finishedProductItems.created += 1;

    const productCode = await nextCode("product_code_seq", "PROD", product.externalCode);
    const productId = write
      ? (
          await prisma.product.create({
            data: {
              code: productCode,
              externalCode: product.externalCode,
              name: product.name,
              finishedProductItemId: finishedItemId,
              ...(customerId && !isPlanned(customerId) ? { customerId } : {}),
              active: true,
            },
          })
        ).id
      : plannedId("product", product.externalCode);

    domains.products.created += 1;
    productByExternal.set(product.externalCode, {
      id: productId,
      finishedItemId,
      customerId,
    });
  }
  }

  /* ── 6. Formulações ────────────────────────────────────── */
  const formulationDetail = { perDose: 0, fixedBasis: 0, withoutUsableRows: 0 };
  const golden = { comparable: 0, matched: 0, divergent: 0 };

  for (const group of latestGroups.values()) {
    const product = productByExternal.get(group.productCode);
    const reconstruction = reconstructGroup(group, itemByExternalCode, cmvProducts, findings);
    golden.comparable += reconstruction.comparableRows;
    golden.matched += reconstruction.matchedRows;
    golden.divergent += reconstruction.divergences.length;

    if (!product) {
      domains.formulations.skipped += 1;
      continue;
    }

    const already = isPlanned(product.id)
      ? null
      : await prisma.formulationVersion.findFirst({ where: { productId: product.id } });
    if (already) {
      domains.formulations.existing += 1;
      continue;
    }

    interface ComponentDraft {
      itemId: string;
      quantity: string;
      unitCode: string;
      basis: "PER_DOSE" | "PER_FINISHED_UNIT" | "FIXED_BASIS";
      purityPercentApplied: string | null;
      overagePercent: string | null;
      legacyTotalQuantity: string | null;
      legacyTotalUnitCode: string | null;
      legacyBatchUnits: string | null;
    }

    const drafts: ComponentDraft[] = [];
    const usedItems = new Set<string>();
    const perDose = reconstruction.status === "PER_DOSE_RECONSTRUCTED";

    for (const row of group.rows) {
      const mapped = itemByExternalCode.get(row.itemCode);
      const itemId = itemIdByExternal.get(row.itemCode);
      /*
       * Sem revisão, item que o corpus não resolve continua sendo salto mudo:
       * é linha de formulação legada sem cadastro, e isso já sai como finding
       * na etapa dos itens. Com revisão é outra coisa — a fórmula de um
       * produto aprovado está pedindo um item que a Veridi tirou da carga, e
       * isso ninguém pode resolver adivinhando um item parecido.
       */
      if (itemReview && !itemId && chaveDoItemLegado(row.itemCode, itemReview)) {
        findings.add(
          "FORMULATION_ITEM_NOT_IMPORTED",
          "Formulation",
          `${group.productCode} → ${row.itemCode}`,
          "formula de produto aprovado usa item marcado NAO_IMPORTAR na revisao",
        );
      }
      if (!mapped || !itemId || usedItems.has(itemId)) continue;
      if (!row.legacyTotal || row.legacyTotal.lessThanOrEqualTo(0)) continue;

      const legacy = {
        legacyTotalQuantity: row.legacyTotal.toString(),
        legacyTotalUnitCode: mapped.type === "PACKAGING" ? "un" : "kg",
        legacyBatchUnits: row.batchUnits ? row.batchUnits.toString() : null,
      };

      if (mapped.type === "PACKAGING") {
        // Embalagem é BOM por unidade acabada — nunca cálculo por dose.
        const units = row.batchUnits && row.batchUnits.greaterThan(0) ? row.batchUnits : null;
        const perUnit = units ? row.legacyTotal.dividedBy(units) : row.legacyTotal;
        drafts.push({
          itemId,
          quantity: perUnit.toString(),
          unitCode: "un",
          basis: "PER_FINISHED_UNIT",
          purityPercentApplied: null,
          overagePercent: null,
          ...legacy,
        });
        usedItems.add(itemId);
        continue;
      }

      if (perDose && row.quantityPerDose && doseToKg(row.quantityPerDose, row.doseUnit)) {
        drafts.push({
          itemId,
          quantity: row.quantityPerDose.toString(),
          unitCode: (row.doseUnit ?? "MG").toLowerCase(),
          basis: "PER_DOSE",
          purityPercentApplied: mapped.defaultPurityPercent,
          /*
           * Seis casas, o scale da coluna desde o PREC-MIG-C.
           *
           * O overage aqui é DERIVADO — `fator ÷ doses − 1` costuma ter dízima
           * —, então algum corte existe. Ele acontece aqui, no valor que a
           * importação decidiu gravar, e não dentro do PostgreSQL depois: três
           * casas descartavam precisão que a coluna hoje guarda, e mais de seis
           * voltariam a ser arredondadas em silêncio pelo banco. O importador
           * escreve via Prisma, sem passar pelo validator da API, então o
           * limite precisa estar escrito aqui.
           */
          overagePercent: reconstruction.overagePercent
            ? reconstruction.overagePercent.toFixed(6)
            : null,
          ...legacy,
        });
        usedItems.add(itemId);
        continue;
      }

      // Sem como decompor dose/pureza/overage: importa o consumo REAL do
      // lote histórico, sem inventar fatores.
      drafts.push({
        itemId,
        quantity: row.legacyTotal.toString(),
        unitCode: "kg",
        basis: "FIXED_BASIS",
        purityPercentApplied: null,
        overagePercent: null,
        ...legacy,
      });
      usedItems.add(itemId);
    }

    if (drafts.length === 0) {
      formulationDetail.withoutUsableRows += 1;
      domains.formulations.skipped += 1;
      continue;
    }

    const batchUnits = group.rows.find((row) => row.batchUnits)?.batchUnits ?? new Prisma.Decimal(1);

    if (write) {
      const finishedItem = await prisma.item.findUniqueOrThrow({
        where: { id: product.finishedItemId },
      });
      const version = await prisma.formulationVersion.create({
        data: {
          productId: product.id,
          versionNumber: 1,
          status: "ACTIVE",
          // PER_DOSE: base é 1 unidade acabada. FIXED_BASIS legado: a base é
          // o próprio tamanho do lote histórico.
          basisQuantity: perDose ? "1" : batchUnits.toString(),
          calculationMode: perDose ? "PER_DOSE" : "FIXED_BASIS",
          ...(perDose && reconstruction.dosesPerPackage
            ? { dosesPerPackage: reconstruction.dosesPerPackage }
            : {}),
          outputItemId: finishedItem.id,
          outputItemCode: finishedItem.code,
          outputItemName: finishedItem.name,
          outputUnitCode: finishedItem.unitCode,
          notes: `Importada do histórico (lote ${group.lot}).`,
          createdBy: ACTOR,
          activatedAt: new Date(),
          activatedBy: ACTOR,
        },
      });

      await prisma.formulationComponent.createMany({
        data: drafts.map((draft, index) => ({
          formulationVersionId: version.id,
          itemId: draft.itemId,
          quantity: draft.quantity,
          unitCode: draft.unitCode,
          basis: draft.basis,
          purityPercentApplied: draft.purityPercentApplied,
          overagePercent: draft.overagePercent,
          /*
           * PUREZA IMPORTADA NAO ATIVA O AJUSTE, de proposito.
           *
           * O componente nasce `PHYSICAL_DIRECT` pelo default do schema, e e
           * isso que se quer: a quantidade que vem da planilha pode JA estar
           * corrigida — a Coenzima Q10 do corpus guarda 224,4898 mg, que e 220
           * dividido por 0,98. Ligar o ajuste porque o arquivo traz uma pureza
           * aplicaria a correcao uma segunda vez, em silencio.
           *
           * Nao remover este comentario para "completar" o mapeamento: a
           * ausencia das flags aqui e a decisao, nao um esquecimento.
           */
          legacyTotalQuantity: draft.legacyTotalQuantity,
          legacyTotalUnitCode: draft.legacyTotalUnitCode,
          legacyBatchUnits: draft.legacyBatchUnits,
          position: index,
        })),
      });
    }

    domains.formulations.created += 1;
    if (perDose) formulationDetail.perDose += 1;
    else formulationDetail.fixedBasis += 1;
  }

  /* ── 7. Projetos + orçamentos legados ──────────────────── */
  const projectRows = readLegacyProjectRows(findings);
  const projectGroups = groupLegacyProjects(projectRows, findings);
  const projectIdByKey = new Map<string, string>();

  for (const group of projectGroups.values()) {
    const first = group.rows[0]!;
    const customerId = customerIdByExternal.get(group.customerExternalCode) ?? null;
    if (!customerId) {
      const excluidoNaRevisao =
        customerReview !== null &&
        [...customerReview.excluidos].some(
          (chave) => chave === `CLI-LEG-${group.customerExternalCode.padStart(4, "0")}`,
        );
      findings.add(
        excluidoNaRevisao ? "PROJECT_CUSTOMER_NOT_IMPORTED" : "PROJECT_CUSTOMER_UNRESOLVED",
        "Project",
        group.key,
        excluidoNaRevisao
          ? "cliente do projeto foi marcado NAO_IMPORTAR na revisao — projeto nao importado"
          : "cliente do projeto nao encontrado na base — projeto nao importado",
      );
      domains.projects.skipped += 1;
      continue;
    }

    // Vínculo com o Product exige código legado E cliente iguais.
    const productMatch = productByExternal.get(group.productExternalCode) ?? null;
    let productId: string | null = null;
    if (productMatch) {
      if (productMatch.customerId === customerId) {
        productId = productMatch.id;
      } else {
        findings.add(
          "PROJECT_PRODUCT_CUSTOMER_MISMATCH",
          "Project",
          group.productExternalCode,
          "codigo legado bate com um Product de OUTRO cliente — vinculo nao criado",
        );
      }
    }

    const existing = isPlanned(customerId)
      ? null
      : await prisma.project.findFirst({
          where: { externalCode: group.productExternalCode, customerId },
        });

    if (existing) {
      // Idempotência: nunca sobrescreve o que o sistema editou; só completa
      // o vínculo com o Product quando ele ainda falta.
      if (!existing.productId && productId && !isPlanned(productId)) {
        if (write) {
          await prisma.project.update({ where: { id: existing.id }, data: { productId } });
        }
        domains.projects.updated += 1;
      } else {
        domains.projects.existing += 1;
      }
      projectIdByKey.set(group.key, existing.id);
    } else {
      const status = productId ? "APPROVED" : "WAITING";
      const code = await nextCode("project_code_seq", "PROJ", group.key);
      const projectId = write
        ? (
            await prisma.project.create({
              data: {
                code,
                externalCode: group.productExternalCode,
                customerId,
                name: first.productName,
                channel: first.channel,
                status,
                source: "LEGACY_IMPORT",
                entryDate: first.entryDate ?? new Date(),
                notes: first.notes,
                ...(productId && !isPlanned(productId) ? { productId } : {}),
              },
            })
          ).id
        : plannedId("project", group.key);

      if (write) {
        await prisma.projectStatusHistory.create({
          data: {
            projectId,
            fromStatus: null,
            toStatus: status,
            reason: "Importado da planilha (estagio historico nao exportado)",
          },
        });
      }

      // O export NÃO traz o estágio real: a inferência fica explícita no
      // relatório, nunca apresentada como status documentado.
      findings.add(
        "PROJECT_LEGACY_STATUS_NOT_EXPORTED",
        "Project",
        group.productExternalCode,
        productId
          ? "status assumido APPROVED por existir Product operacional — confirmar com o PO"
          : "status assumido WAITING — o export nao traz o estagio real",
      );

      projectIdByKey.set(group.key, projectId);
      domains.projects.created += 1;
    }

    // Versões históricas de orçamento: o corpus só tem o rótulo (V1..Vn),
    // sem preço nem evidência de envio — entram como ARCHIVED.
    const projectId = projectIdByKey.get(group.key)!;
    for (const version of legacyQuoteVersions(group)) {
      const alreadyQuoted = isPlanned(projectId)
        ? null
        : await prisma.quoteVersion.findFirst({
            where: { projectId, versionNumber: version.versionNumber },
          });
      if (alreadyQuoted) {
        domains.quotes.existing += 1;
        continue;
      }

      if (write) {
        await prisma.quoteVersion.create({
          data: {
            code: await nextSequenceCode(prisma, "quote_code_seq", "ORC"),
            projectId,
            versionNumber: version.versionNumber,
            externalCode: version.externalCode,
            status: "ARCHIVED",
            source: "LEGACY_IMPORT",
            quoteDate: first.entryDate ?? new Date(),
          },
        });
      }
      domains.quotes.created += 1;
    }
  }

  /* ── 8. Amostras ───────────────────────────────────────── */
  const legacySampleRows = readLegacySampleRows(findings);
  const legacyProjects = await prisma.project.findMany({
    where: { source: "LEGACY_IMPORT" },
    select: { id: true, code: true, name: true },
  });
  const projectsByName = new Map<string, string[]>();
  const projectIdByCode = new Map(legacyProjects.map((project) => [project.code, project.id]));
  for (const project of legacyProjects) {
    const key = normalizeName(project.name);
    projectsByName.set(key, [...(projectsByName.get(key) ?? []), project.id]);
  }

  for (const resolution of resolveSamples(legacySampleRows, projectsByName, findings)) {
    const row = resolution.row;
    const override = overrides.samples.get(row.externalCode);
    let projectId = resolution.projectId;

    if (!projectId && override) {
      if (override.action === "IGNORE") {
        domains.samples.skipped += 1;
        continue;
      }
      const target = override.targetProjectCode
        ? (projectIdByCode.get(override.targetProjectCode) ?? null)
        : null;
      if (!target) {
        findings.add(
          "SAMPLE_OVERRIDE_PROJECT_UNKNOWN",
          "ProjectSample",
          row.externalCode,
          `override aponta para ${override.targetProjectCode ?? "(vazio)"} — projeto inexistente`,
        );
        domains.samples.skipped += 1;
        continue;
      }
      projectId = target;
      findings.add(
        "SAMPLE_MAPPED_BY_OVERRIDE",
        "ProjectSample",
        row.externalCode,
        `ligada ao projeto ${override.targetProjectCode} por decisao humana registrada em override`,
      );
    }

    if (!projectId || row.testSequence === null) {
      // Sem projeto inequívoco (ou sem Tn) a amostra fica fora: nenhum
      // Project artificial é criado para acomodá-la.
      templates.unresolvedSamples.push({
        legacySample: row.externalCode,
        description: row.description ?? "",
        testNumber: row.testSequence === null ? "" : String(row.testSequence),
      });
      domains.samples.skipped += 1;
      continue;
    }

    const existing = await prisma.projectSample.findFirst({
      where: { externalCode: row.externalCode },
    });
    if (existing) {
      domains.samples.existing += 1;
      continue;
    }

    const clash = isPlanned(projectId)
      ? null
      : await prisma.projectSample.findFirst({
          where: { projectId, testSequence: row.testSequence },
        });
    if (clash) {
      findings.add(
        "SAMPLE_TEST_NUMBER_CLASH",
        "ProjectSample",
        row.externalCode,
        `T${row.testSequence} ja existe no projeto — amostra nao importada`,
      );
      domains.samples.skipped += 1;
      continue;
    }

    if (write) {
      await prisma.projectSample.create({
        data: {
          code: await nextSequenceCode(prisma, "project_sample_code_seq", "AM"),
          externalCode: row.externalCode,
          projectId,
          testSequence: row.testSequence,
          // A planilha registra amostras que existiram fisicamente; o
          // desfecho não está no export e nunca é inventado.
          status: "PRODUCED",
          source: "LEGACY_IMPORT",
          description: row.description,
        },
      });
    }
    findings.add(
      "SAMPLE_LEGACY_OUTCOME_UNKNOWN",
      "ProjectSample",
      row.externalCode,
      "export nao traz desfecho, data nem quantidade — importada como PRODUZIDA sem decisao",
    );
    domains.samples.created += 1;
  }

  /* ── 9. Item × Fornecedor + ofertas ────────────────────── */
  const priceRows = readLegacySupplierPriceRows(findings);
  const dbItems = await prisma.item.findMany({ where: { externalCode: { not: null } } });
  const itemIdByCode = new Map(dbItems.map((item) => [item.code, item]));
  const dbItemByExternal = new Map(dbItems.map((item) => [item.externalCode!, item]));

  const qualifiedPairs = new Set<string>();
  for (const row of priceRows) {
    if (row.qualified) {
      qualifiedPairs.add(`${row.itemExternalCode}::${normalizeSupplierName(row.supplierName)}`);
    }
  }

  const supplierItemIdByPair = new Map<string, string>();
  const reportedUnresolvedItems = new Set<string>();
  const ofertasRevisadas = review ? workbookObrigatorio(review, WORKBOOK_OFERTAS) : null;
  const relacaoStats = { approved: 0, excluded: 0, orphan: 0 };

  for (const row of priceRows) {
    const supplierKey = normalizeSupplierName(row.supplierName);
    const offerSourceKey = legacyOfferSourceKey(row);

    /*
     * Com revisão, a relação item × fornecedor é resolvida pela
     * CHAVE_MIGRACAO da oferta no 07 — nunca pela string do nome. É essa
     * chave que diz de qual fornecedor APROVADO a oferta é; casar por nome
     * parecido é exatamente como se aponta para o fornecedor errado.
     */
    let revisaoDaOferta: RegistroRevisado | null = null;
    let supplierId: string | null;

    if (ofertasRevisadas) {
      const destino = resolverFornecedorDaOferta(offerSourceKey, {
        ofertas: ofertasRevisadas,
        excluidos: supplierReview?.excluidos ?? new Set<string>(),
        supplierIdByKey,
      });
      if (destino.situacao === "FORA_DA_CARGA") {
        relacaoStats.excluded += 1;
        domains.supplierItems.skipped += 1;
        domains.supplierItemOffers.skipped += 1;
        continue;
      }
      if (destino.situacao !== "IMPORTAR") {
        findings.add(destino.code, "SupplierItem", destino.referencia, destino.detalhe);
        if (destino.situacao === "SEM_FORNECEDOR") relacaoStats.orphan += 1;
        domains.supplierItems.skipped += 1;
        domains.supplierItemOffers.skipped += 1;
        continue;
      }
      relacaoStats.approved += 1;
      revisaoDaOferta = destino.revisao;
      supplierId = destino.supplierId;
    } else {
      supplierId = supplierIdByName.get(supplierKey) ?? null;
    }

    /*
     * Resolução do item.
     *
     * Com revisão, vem da CHAVE_ITEM do 07 e o arquivo de override humano
     * sai de cena: quem decide qual item é aquele preço é o workbook, e
     * manter as duas fontes seria manter duas verdades.
     */
    let itemIdRevisado: string | null = null;
    if (revisaoDaOferta) {
      const chaveItem = campo(revisaoDaOferta, "CHAVE_ITEM");
      if (!chaveItem) {
        findings.add(
          "SUPPLIER_ITEM_ITEM_KEY_UNKNOWN",
          "SupplierItem",
          revisaoDaOferta.chave,
          "oferta aprovada sem CHAVE_ITEM",
        );
        domains.supplierItems.skipped += 1;
        domains.supplierItemOffers.skipped += 1;
        continue;
      }
      if (itemReview?.excluidos.has(chaveItem)) {
        findings.add(
          "SUPPLIER_ITEM_ITEM_NOT_IMPORTED",
          "SupplierItem",
          `${revisaoDaOferta.chave} → ${chaveItem}`,
          "oferta aprovada aponta para item marcado NAO_IMPORTAR",
        );
        relacaoStats.orphan += 1;
        domains.supplierItems.skipped += 1;
        domains.supplierItemOffers.skipped += 1;
        continue;
      }
      itemIdRevisado = itemIdByKey.get(chaveItem) ?? null;
      if (!itemIdRevisado) {
        findings.add(
          "SUPPLIER_ITEM_ITEM_KEY_UNKNOWN",
          "SupplierItem",
          `${revisaoDaOferta.chave} → ${chaveItem}`,
          "CHAVE_ITEM sem item aprovado nos workbooks de itens",
        );
        relacaoStats.orphan += 1;
        domains.supplierItems.skipped += 1;
        domains.supplierItemOffers.skipped += 1;
        continue;
      }
    }

    // Sem revisão: código legado direto ou override humano. Nunca criar Item
    // a partir de uma linha de preço — preço isolado não é fonte suficiente
    // para master data.
    const override = overrides.items.get(row.itemExternalCode);
    let item = dbItemByExternal.get(row.itemExternalCode) ?? null;

    if (!item && override) {
      if (override.action === "IGNORE") {
        domains.supplierItems.skipped += 1;
        continue;
      }
      const target = override.targetItemCode
        ? (itemIdByCode.get(override.targetItemCode) ?? null)
        : null;
      if (!target) {
        findings.add(
          "SUPPLIER_ITEM_OVERRIDE_TARGET_UNKNOWN",
          "SupplierItem",
          row.itemExternalCode,
          `override aponta para ${override.targetItemCode ?? "(vazio)"} — item inexistente`,
        );
        domains.supplierItems.skipped += 1;
        continue;
      }
      item = target;
      findings.add(
        "SUPPLIER_ITEM_MAPPED_BY_OVERRIDE",
        "SupplierItem",
        row.itemExternalCode,
        `resolvido para ${override.targetItemCode} por decisao humana registrada em override`,
      );
    }

    if (!item && !itemIdRevisado) {
      findings.add(
        "SUPPLIER_ITEM_ITEM_UNRESOLVED",
        "SupplierItem",
        row.itemExternalCode,
        "cod_item sem Item correspondente — relacao nao importada (use override para mapear)",
      );
      if (!reportedUnresolvedItems.has(row.itemExternalCode)) {
        reportedUnresolvedItems.add(row.itemExternalCode);
        templates.unresolvedItemCodes.push({
          legacyItemCode: row.itemExternalCode,
          description: row.sourceName ?? row.nutrient ?? "",
        });
      }
      domains.supplierItems.skipped += 1;
      continue;
    }

    if (!supplierId) {
      // Nunca criar Supplier só para acomodar um preço legado.
      findings.add(
        "SUPPLIER_ITEM_SUPPLIER_UNRESOLVED",
        "SupplierItem",
        row.supplierName,
        "fornecedor sem correspondencia exata de nome — relacao nao importada",
      );
      domains.supplierItems.skipped += 1;
      continue;
    }

    const itemIdDaRelacao = itemIdRevisado ?? item!.id;
    const pairKey = `${itemIdDaRelacao}::${supplierId}`;
    let supplierItemId = supplierItemIdByPair.get(pairKey);

    if (!supplierItemId) {
      const existing =
        isPlanned(supplierId) || isPlanned(itemIdDaRelacao)
          ? null
          : await prisma.supplierItem.findUnique({
              where: { supplierId_itemId: { supplierId, itemId: itemIdDaRelacao } },
            });

      if (existing) {
        supplierItemId = existing.id;
        domains.supplierItems.existing += 1;
      } else {
        // Com revisão, a relação sai do 07 devolvido: homologação,
        // preferência, código no fornecedor e observação são decisão da
        // Veridi. Sem revisão, vale o que a planilha bruta deixava concluir.
        const relacao = revisaoDaOferta
          ? {
              qualificationStatus: QUALIFICACAO_DO_PACOTE[campo(revisaoDaOferta, "HOMOLOGACAO") ?? ""] ?? "PENDING",
              preferred: campo(revisaoDaOferta, "PREFERENCIAL") === "SIM",
              active: campo(revisaoDaOferta, "RELACAO_ATIVA") !== "NÃO",
              supplierItemCode: campo(revisaoDaOferta, "CODIGO_DO_ITEM_NO_FORNECEDOR"),
              commercialNotes: campo(revisaoDaOferta, "OBSERVACOES_COMERCIAIS"),
            }
          : {
              // Homologado quando a planilha diz explicitamente;
              // ausência é desconhecimento (PENDING), nunca bloqueio.
              qualificationStatus: qualifiedPairs.has(`${row.itemExternalCode}::${supplierKey}`)
                ? ("APPROVED" as const)
                : ("PENDING" as const),
              // "melhor_preco" da planilha é snapshot de CMV, não
              // fornecedor preferencial oficial.
              preferred: false,
              active: true,
              supplierItemCode: null,
              commercialNotes: null,
            };
        const qualified = relacao.qualificationStatus === "APPROVED";
        supplierItemId = write
          ? (
              await prisma.supplierItem.create({
                data: {
                  itemId: itemIdDaRelacao,
                  supplierId,
                  ...relacao,
                  createdByNameSnapshot: ACTOR,
                  updatedByNameSnapshot: ACTOR,
                },
              })
            ).id
          : plannedId("supplier-item", pairKey);

        if (write) {
          await prisma.supplierItemQualificationHistory.create({
            data: {
              supplierItemId,
              fromStatus: null,
              toStatus: "PENDING",
              note: "Relacao importada da planilha",
              changedByNameSnapshot: ACTOR,
            },
          });
          if (qualified) {
            await prisma.supplierItemQualificationHistory.create({
              data: {
                supplierItemId,
                fromStatus: "PENDING",
                toStatus: "APPROVED",
                note: "Homologacao marcada na planilha (sem data nem responsavel no export)",
                changedByNameSnapshot: ACTOR,
              },
            });
          }
        }
        domains.supplierItems.created += 1;
      }
      supplierItemIdByPair.set(pairKey, supplierItemId);
    }

    /* Oferta */
    const sourceKey = offerSourceKey;
    const referencia = `${row.itemExternalCode}/${row.supplierName}`;

    /*
     * Com revisão, a oferta sai do 07 devolvido — preço, unidade do preço e
     * pedido mínimo inclusive.
     *
     * É para isso que o workbook existe: o corpus só traz `preco_brl_kg` e
     * um pedido mínimo em texto livre, e era essa ambiguidade que obrigava o
     * arquivo de override. Quando a Veridi já decidiu a unidade na planilha,
     * ler o valor bruto de novo seria ignorar a decisão dela.
     */
    let unitPrice: Prisma.Decimal;
    let priceUomCode: string;
    let moqQuantity: Prisma.Decimal | null = null;
    let moqUomCode: string | null = null;
    let offerNotes: string | null = row.sourceName;

    if (revisaoDaOferta) {
      const precoRevisado = numeroRevisado(revisaoDaOferta, "PRECO") ?? null;
      const unidadeRevisada = campo(revisaoDaOferta, "UNIDADE_DO_PRECO");
      if (!precoRevisado || !unidadeRevisada) {
        findings.add(
          "SUPPLIER_PRICE_INVALID",
          "SupplierItemOffer",
          revisaoDaOferta.chave,
          "oferta aprovada sem PRECO ou sem UNIDADE_DO_PRECO — oferta nao criada",
        );
        domains.supplierItemOffers.skipped += 1;
        continue;
      }
      unitPrice = precoRevisado;
      priceUomCode = unidadeRevisada;
      moqQuantity = numeroRevisado(revisaoDaOferta, "PEDIDO_MINIMO") ?? null;
      moqUomCode = moqQuantity ? campo(revisaoDaOferta, "UNIDADE_PEDIDO_MINIMO") : null;
      if (moqQuantity && !moqUomCode) {
        findings.add(
          "SUPPLIER_MOQ_AMBIGUOUS",
          "SupplierItemOffer",
          revisaoDaOferta.chave,
          "pedido minimo aprovado sem unidade — oferta sem MOQ estruturado",
        );
        moqQuantity = null;
      }
      offerNotes = campo(revisaoDaOferta, "OBSERVACAO_DA_OFERTA") ?? row.sourceName;
    } else {
      if (row.price === null) {
        findings.add(
          "SUPPLIER_PRICE_INVALID",
          "SupplierItemOffer",
          referencia,
          `preco nao interpretavel: "${row.rawPrice}" — oferta nao criada`,
        );
        domains.supplierItemOffers.skipped += 1;
        continue;
      }
      unitPrice = row.price;

      const uomOverride = overrides.priceUoms.get(sourceKey);
      // O corpus só traz preço por quilo (header `preco_brl_kg`).
      priceUomCode = "kg";
      const itemIsMass = MASS_UOM_CODES.has(item!.unitCode);
      if (!itemIsMass) {
        if (uomOverride?.action === "IGNORE_PRICE") {
          domains.supplierItemOffers.skipped += 1;
          continue;
        }
        if (uomOverride?.action === "MAP_UOM" && uomOverride.overridePriceUom) {
          priceUomCode = uomOverride.overridePriceUom;
          findings.add(
            "SUPPLIER_PRICE_UOM_BY_OVERRIDE",
            "SupplierItemOffer",
            referencia,
            `unidade do preco definida como ${priceUomCode} por decisao humana`,
          );
        } else {
          // Converter R$/kg em R$/un exigiria peso por unidade — dado que
          // não existe. Sem override não há oferta.
          findings.add(
            "SUPPLIER_PRICE_UOM_INCOMPATIBLE",
            "SupplierItemOffer",
            referencia,
            `preco por kg em item na unidade ${item!.unitCode} — oferta nao criada`,
          );
          templates.incompatiblePriceUom.push({
            sourceKey,
            legacyItemCode: row.itemExternalCode,
            itemCode: item!.code,
            itemUom: item!.unitCode,
            sourcePriceUom: "kg",
          });
          domains.supplierItemOffers.skipped += 1;
          continue;
        }
      }

      const parsedMoq = parseMinimumOrder(row.rawMinimumOrder);
      if (row.rawMinimumOrder && !parsedMoq) {
        findings.add(
          "SUPPLIER_MOQ_AMBIGUOUS",
          "SupplierItemOffer",
          referencia,
          `pedido minimo nao interpretavel: "${row.rawMinimumOrder}" — oferta sem MOQ estruturado`,
        );
      }

      // Número puro assume a unidade do item — transformação conhecida e
      // aceita porque a oferta legada nunca vira preço vigente.
      const moqUom = parsedMoq ? (parsedMoq.uomCode ?? item!.unitCode) : null;
      if (parsedMoq && parsedMoq.uomCode === null) {
        findings.add(
          "MOQ_ASSUMED_ITEM_UOM",
          "SupplierItemOffer",
          referencia,
          `pedido minimo "${row.rawMinimumOrder}" interpretado como ${parsedMoq.quantity.toString()} ${item!.unitCode}`,
        );
      }
      const moqCompatible =
        moqUom !== null && MASS_UOM_CODES.has(moqUom) === MASS_UOM_CODES.has(item!.unitCode);
      if (parsedMoq && !moqCompatible) {
        findings.add(
          "SUPPLIER_MOQ_UOM_INCOMPATIBLE",
          "SupplierItemOffer",
          referencia,
          `pedido minimo "${row.rawMinimumOrder}" incompativel com a unidade do item (${item!.unitCode}) — oferta sem MOQ`,
        );
      }
      if (parsedMoq && moqCompatible) {
        moqQuantity = parsedMoq.quantity;
        moqUomCode = moqUom;
      }
    }

    // Consulta também no dry-run: o plano precisa dizer a verdade sobre o
    // que já existe, e ler nunca escreve.
    const alreadyImported = await prisma.supplierItemOffer.findUnique({ where: { sourceKey } });
    if (alreadyImported) {
      domains.supplierItemOffers.existing += 1;
      continue;
    }

    if (write) {
      await prisma.supplierItemOffer.create({
        data: {
          supplierItemId,
          unitPrice,
          currencyCode: "BRL",
          priceUomCode,
          ...(moqQuantity && moqUomCode
            ? { minimumOrderQuantity: moqQuantity, minimumOrderUomCode: moqUomCode }
            : {}),
          // O export não tem data de cotação: observação histórica, nunca
          // preço vigente. A revisão não muda isso — a Veridi revisa o
          // preço observado, não cria cotação nova.
          effectiveAt: null,
          validUntil: null,
          source: "LEGACY_IMPORT",
          sourceKey,
          notes: offerNotes,
          createdByNameSnapshot: ACTOR,
        },
      });
    }
    domains.supplierItemOffers.created += 1;
  }

  /* ── 10. Estoque: nunca movimenta, só gera template ────── */
  const stock = { positive: 0, zero: 0, negative: 0, unreadable: 0 };
  for (const row of readCorpusCsv("estoque_saldos.csv").rows) {
    const legacyItemCode = cleanText(row["cod_item"]) ?? cleanText(row["cod_planilha"]) ?? "";
    const value = safeDecimal(row["saldo_final_kg"]);

    if (!value) {
      stock.unreadable += 1;
      findings.add(
        "UNREADABLE_STOCK",
        "Inventory",
        legacyItemCode || "(sem codigo)",
        "saldo ilegivel no export — nao migrado",
      );
      continue;
    }
    if (value.isZero()) {
      stock.zero += 1;
      continue;
    }
    if (value.lessThan(0)) {
      stock.negative += 1;
      findings.add(
        "NEGATIVE_LEGACY_STOCK",
        "Inventory",
        legacyItemCode || "(sem codigo)",
        `saldo negativo (${value.toString()}) — dado de migracao invalido, nunca migrado`,
      );
      continue;
    }

    stock.positive += 1;
    const item = legacyItemCode ? (dbItemByExternal.get(legacyItemCode) ?? null) : null;
    if (!item) {
      findings.add(
        "STOCK_NEEDS_LOT_RECONCILIATION",
        "Inventory",
        legacyItemCode || "(sem codigo)",
        "saldo positivo sem Item correspondente — fora do template de abertura",
      );
      continue;
    }

    // Saldo agregado não vira estoque: item loteado precisa de lote físico
    // real, e inventar lote destruiria a rastreabilidade.
    templates.openingInventory.push({
      legacyItemCode,
      itemCode: item.code,
      itemName: item.name,
      expectedLegacyTotal: value.toString(),
      itemUom: item.unitCode,
      controlsLot: item.controlsLot,
    });
    findings.add(
      "STOCK_NEEDS_LOT_RECONCILIATION",
      "Inventory",
      item.code,
      `saldo legado ${value.toString()} ${item.unitCode} — precisa de reconciliacao por lote no template de abertura`,
    );
  }

  /* ── 11. Fora de escopo, declarado ─────────────────────── */
  const receipts = readCorpusCsv("compras_recebimentos.csv");
  findings.add(
    "DEFERRED_RECEIPT_HISTORY",
    "Receipt",
    "compras_recebimentos.csv",
    `${receipts.rows.length} linhas usadas so para conferencia: importar entradas historicas sem as saidas correspondentes inflaria o On Hand`,
  );
  for (const file of ["cmv_produtos.csv", "cmv_componentes.csv", "cmv_precificacao.csv"]) {
    findings.add(
      "DEFERRED_CMV",
      "Cost",
      file,
      `${readCorpusCsv(file).rows.length} linhas — estrutura validada, persistencia no Bloco G`,
    );
  }
  findings.add(
    "DEFERRED_IN28",
    "Regulatory",
    "in28_limites.csv",
    `${readCorpusCsv("in28_limites.csv").rows.length} linhas — Bloco H continua gate`,
  );

  return {
    write,
    domains,
    formulationDetail,
    golden,
    stock,
    templates,
    review: review
      ? {
          identity: review.identidade,
          path: review.pasta,
          workbooks: [...review.workbooks.values()].map((workbook) => ({
            name: workbook.nome,
            records: workbook.porChave.size,
            counts: workbook.contagem,
          })),
          suppliers: {
            approved: supplierReview?.aprovados.length ?? 0,
            excluded: supplierReview?.excluidos.size ?? 0,
            created: supplierStats.created,
            updated: supplierStats.updated,
            unchanged: supplierStats.unchanged,
            withAddress: supplierStats.withAddress,
          },
          customers: {
            approved: customerReview?.aprovados.length ?? 0,
            excluded: customerReview?.excluidos.size ?? 0,
          },
          items: {
            approved: itemReview?.aprovados.length ?? 0,
            excluded: itemReview?.excluidos.size ?? 0,
          },
          products: {
            approved: productReview?.aprovados.length ?? 0,
            excluded: productReview?.excluidos.size ?? 0,
          },
          supplierItems: relacaoStats,
          blocked: Boolean(
            supplierReview?.bloqueado ||
              customerReview?.bloqueado ||
              itemReview?.bloqueado ||
              productReview?.bloqueado,
          ),
        }
      : null,
    findings,
  };
}
