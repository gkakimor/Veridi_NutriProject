import { Prisma } from "@prisma/client";
import type { FindingSink } from "./corpus.js";
import { cleanText, digitsOnly, isValidCnpj, readCorpusCsv, safeDecimal } from "./corpus.js";
import { parseLegacyAddress } from "./legacy-address.js";

/**
 * Tradução do corpus real da Veridi para o domínio do ERP.
 *
 * Princípio: **nunca inventar dado**. Onde a planilha não permite concluir,
 * o registro vira um *finding* e segue para revisão humana — jamais um
 * palpite gravado como se fosse verdade.
 */

const HUNDRED = new Prisma.Decimal(100);

/* ─────────────── Fornecedores ─────────────── */

export interface MappedSupplier {
  legalName: string;
}

export function mapSuppliers(findings: FindingSink): MappedSupplier[] {
  const file = readCorpusCsv("fornecedores.csv");
  const seen = new Set<string>();
  const suppliers: MappedSupplier[] = [];

  for (const row of file.rows) {
    const legalName = cleanText(row["nome_fornecedor"]);
    if (!legalName) {
      findings.add("SUPPLIER_WITHOUT_NAME", "Supplier", "-", "linha sem nome");
      continue;
    }
    const key = legalName.toUpperCase();
    if (seen.has(key)) {
      findings.add("SUPPLIER_DUPLICATE", "Supplier", legalName, "nome repetido no corpus");
      continue;
    }
    seen.add(key);
    // A planilha só tem o nome: CNPJ/e-mail/telefone não são inventados.
    suppliers.push({ legalName });
  }
  return suppliers;
}

/* ─────────────── Clientes ─────────────── */

export interface MappedCustomer {
  externalCode: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  city: string | null;
  state: string | null;
  /** Endereço legado preservado como texto — a origem, sempre. */
  legacyAddress: string | null;
  /**
   * Decomposição conservadora do endereço legado.
   *
   * Campos que o parser não conseguiu afirmar vêm `null` e viram finding.
   * O texto original continua em `legacyAddress` e nas notas de migração.
   */
  street: string | null;
  number: string | null;
  district: string | null;
}

export function mapCustomers(findings: FindingSink): MappedCustomer[] {
  const file = readCorpusCsv("clientes.csv");
  const customers: MappedCustomer[] = [];
  const byCnpj = new Map<string, string>();

  for (const row of file.rows) {
    const externalCode = cleanText(row["cod_planilha"]);
    if (!externalCode) {
      findings.add("CUSTOMER_WITHOUT_CODE", "Customer", "-", "sem cod_planilha");
      continue;
    }

    const tradeName = cleanText(row["nome_fantasia"]);
    const legalName = cleanText(row["razao_social"]) ?? tradeName;
    if (!legalName) {
      findings.add("CUSTOMER_WITHOUT_NAME", "Customer", externalCode, "sem razão social/fantasia");
      continue;
    }
    if (!cleanText(row["razao_social"])) {
      findings.add(
        "CUSTOMER_INCOMPLETE",
        "Customer",
        externalCode,
        "sem razão social — importado com o nome fantasia",
      );
    }

    // CNPJ inválido não aborta o seed e NUNCA é "corrigido": entra como
    // desconhecido e vira finding para revisão.
    const rawCnpj = digitsOnly(row["cnpj_digitos"]);
    let cnpj: string | null = null;
    if (rawCnpj) {
      if (isValidCnpj(rawCnpj)) {
        const duplicate = byCnpj.get(rawCnpj);
        if (duplicate) {
          findings.add("CUSTOMER_CNPJ_DUPLICATE", "Customer", externalCode, `mesmo CNPJ de ${duplicate}`);
        } else {
          byCnpj.set(rawCnpj, externalCode);
          cnpj = rawCnpj;
        }
      } else {
        findings.add("CUSTOMER_CNPJ_INVALID", "Customer", externalCode, `dígito verificador inválido: ${rawCnpj}`);
      }
    }

    const legacyAddress = cleanText(row["endereco"]);
    const endereco = parseLegacyAddress(legacyAddress);
    if (legacyAddress && endereco.needsReview) {
      /*
       * O que o parser não afirma continua em aberto.
       *
       * "S/N" e bairro "desconhecido" preencheriam a tela e apagariam a
       * pergunta — e ninguém volta a conferir um campo que já parece
       * respondido. O texto bruto segue nas notas para revisão.
       */
      findings.add(
        "ADDRESS_PARSE_REVIEW_REQUIRED",
        "Customer",
        externalCode,
        `${endereco.reviewReason} — original: "${legacyAddress}"`,
      );
    }

    customers.push({
      externalCode,
      legalName,
      tradeName,
      cnpj,
      city: cleanText(row["cidade"]),
      state: cleanText(row["uf"])?.toUpperCase() ?? null,
      legacyAddress,
      street: endereco.street,
      number: endereco.number,
      district: endereco.district,
    });
  }
  return customers;
}

/* ─────────────── Itens ─────────────── */

const FAMILY_MAP: Record<string, string> = {
  VITAMINA: "VITAMIN",
  MINERAL: "MINERAL",
  AMINOACIDO: "AMINO_ACID",
  "AMINOÁCIDO": "AMINO_ACID",
  EXCIPIENTE: "EXCIPIENT",
  BOTANICO: "BOTANICAL",
  "BOTÂNICO": "BOTANICAL",
  EMBALAGEM: "PACKAGING",
};

export interface MappedItem {
  externalCode: string;
  name: string;
  declaredNutrient: string | null;
  sourceName: string | null;
  family: string | null;
  /** Pureza convertida da escala 0–1 do CSV para 0–100 do ERP. */
  defaultPurityPercent: string | null;
  type: "RAW_MATERIAL" | "PACKAGING";
  unitCode: string;
  typeIsCertain: boolean;
}

export function mapItems(findings: FindingSink): MappedItem[] {
  const base = readCorpusCsv("itens.csv");
  const enrichment = readCorpusCsv("itens_enriquecimento.csv");

  const enrichmentByCode = new Map<string, Record<string, string>>();
  for (const row of enrichment.rows) {
    const code = cleanText(row["cod_item"]);
    if (code) enrichmentByCode.set(code, row);
  }

  const items: MappedItem[] = [];
  for (const row of base.rows) {
    const externalCode = cleanText(row["cod_planilha"]);
    if (!externalCode) {
      findings.add("ITEM_WITHOUT_CODE", "Item", "-", "sem cod_planilha");
      continue;
    }

    const sourceName = cleanText(row["materia_prima_fonte"]);
    const declaredNutrient = cleanText(row["nutriente_declarado"]);
    const name = sourceName ?? declaredNutrient;
    if (!name) {
      findings.add("ITEM_WITHOUT_NAME", "Item", externalCode, "sem fonte nem nutriente");
      continue;
    }

    const enriched = enrichmentByCode.get(externalCode);
    if (!enriched) {
      findings.add("ITEM_ENRICHMENT_UNMATCHED", "Item", externalCode, "sem linha em itens_enriquecimento");
    }

    // `tipo_sugerido` é heurística por nome: só é aceita quando inequívoca.
    const suggested = cleanText(row["tipo_sugerido"])?.toUpperCase() ?? null;
    let type: "RAW_MATERIAL" | "PACKAGING" = "RAW_MATERIAL";
    let typeIsCertain = true;
    if (suggested === "EMBALAGEM") {
      type = "PACKAGING";
    } else if (suggested === "MATERIA_PRIMA") {
      type = "RAW_MATERIAL";
    } else {
      typeIsCertain = false;
      findings.add("ITEM_TYPE_AMBIGUOUS", "Item", externalCode, `tipo_sugerido="${suggested ?? ""}" — assumido matéria-prima`);
    }

    const familyRaw = cleanText(enriched?.["familia"])?.toUpperCase() ?? null;
    let family: string | null = null;
    if (familyRaw) {
      family = FAMILY_MAP[familyRaw] ?? null;
      if (!family) {
        family = type === "PACKAGING" ? "PACKAGING" : "OTHER_RAW_MATERIAL";
        findings.add("ITEM_FAMILY_UNMAPPED", "Item", externalCode, `família "${familyRaw}" sem correspondência direta`);
      }
    }

    // CSV guarda pureza em 0–1; o ERP trabalha em 0–100. Conversão por
    // Decimal — 0.985 vira 98.5, nunca 0,985%.
    let defaultPurityPercent: string | null = null;
    const rawPurity = cleanText(enriched?.["grau_pureza"]);
    if (rawPurity) {
      const parsed = safeDecimal(rawPurity);
      try {
        if (!parsed) throw new Error("pureza ilegível");
        const scaled = parsed.times(HUNDRED);
        if (scaled.greaterThan(0) && scaled.lessThanOrEqualTo(100)) {
          defaultPurityPercent = scaled.toString();
        } else {
          findings.add("ITEM_PURITY_OUT_OF_RANGE", "Item", externalCode, `grau_pureza=${rawPurity}`);
        }
      } catch {
        findings.add("ITEM_PURITY_INVALID", "Item", externalCode, `grau_pureza=${rawPurity}`);
      }
    }

    items.push({
      externalCode,
      name,
      declaredNutrient,
      sourceName,
      family,
      defaultPurityPercent,
      type,
      // Conservador: matéria-prima em kg, embalagem em unidade.
      unitCode: type === "PACKAGING" ? "un" : "kg",
      typeIsCertain,
    });
  }
  return items;
}

/* ─────────────── Produtos (via projetos + formulações) ─────────────── */

export interface MappedProduct {
  externalCode: string;
  name: string;
  customerExternalCode: string | null;
}

export function mapProducts(neededCodes: Set<string>, findings: FindingSink): MappedProduct[] {
  const projects = readCorpusCsv("projetos.csv");

  // `projetos.csv` é usado APENAS como lookup de nome/cliente. Project é
  // entidade da capacidade 38 e não é criada aqui.
  const byProduct = new Map<string, { name: string; customers: Set<string> }>();
  for (const row of projects.rows) {
    const code = cleanText(row["cod_produto"]);
    if (!code) continue;
    const entry = byProduct.get(code) ?? { name: cleanText(row["produto"]) ?? code, customers: new Set() };
    const customer = cleanText(row["cod_cliente"]);
    if (customer) entry.customers.add(customer);
    byProduct.set(code, entry);
  }

  const products: MappedProduct[] = [];
  for (const code of [...neededCodes].sort()) {
    const entry = byProduct.get(code);
    if (!entry) {
      findings.add("PRODUCT_WITHOUT_PROJECT", "Product", code, "sem linha em projetos.csv — nome virá da formulação");
    }

    let customerExternalCode: string | null = null;
    if (entry && entry.customers.size === 1) {
      customerExternalCode = [...entry.customers][0]!;
    } else if (entry && entry.customers.size > 1) {
      // Vínculo ambíguo: nenhum cliente é escolhido arbitrariamente.
      findings.add("PRODUCT_CUSTOMER_AMBIGUOUS", "Product", code, `${entry.customers.size} clientes distintos`);
    } else if (entry) {
      findings.add("PRODUCT_CUSTOMER_UNRESOLVED", "Product", code, "projeto sem cod_cliente");
    }

    products.push({
      externalCode: code,
      name: entry?.name ?? code,
      customerExternalCode,
    });
  }
  return products;
}

/* ─────────────── Formulações ─────────────── */

export interface FormulationRow {
  productCode: string;
  productName: string;
  lot: string;
  itemCode: string;
  quantityPerDose: Prisma.Decimal | null;
  doseUnit: string | null;
  batchUnits: Prisma.Decimal | null;
  legacyTotal: Prisma.Decimal | null;
}

export interface FormulationGroup {
  productCode: string;
  productName: string;
  lot: string;
  rows: FormulationRow[];
}

export function readFormulationRows(findings: FindingSink): FormulationRow[] {
  const file = readCorpusCsv("formulacoes.csv");
  const rows: FormulationRow[] = [];

  for (const row of file.rows) {
    const productCode = cleanText(row["cod_produto"]);
    const itemCode = cleanText(row["cod_item"]);
    if (!productCode) {
      findings.add("FORMULATION_ROW_WITHOUT_PRODUCT", "Formulation", "-", "linha sem cod_produto");
      continue;
    }
    if (!itemCode) {
      // Tipicamente embalagem que nunca recebeu codigo na planilha
      // (tampa/pote/rotulo). Sem item nao ha o que referenciar: fica
      // registrado para a migracao definitiva (capacidade 41).
      findings.add(
        "FORMULATION_ROW_WITHOUT_ITEM_CODE",
        "Formulation",
        `${productCode}/${cleanText(row["item_mp"]) ?? "?"}`,
        "linha sem cod_item — não referenciável",
      );
      continue;
    }

    const decimal = safeDecimal;

    rows.push({
      productCode,
      productName: cleanText(row["produto"]) ?? productCode,
      lot: cleanText(row["n_lote"]) ?? "",
      itemCode,
      quantityPerDose: decimal(row["qtd_por_dose"]),
      doseUnit: cleanText(row["unidade_dose"])?.toUpperCase() ?? null,
      batchUnits: decimal(row["lote_qtd_unidades"]),
      legacyTotal: decimal(row["total_kg_com_pureza_overage"]),
    });
  }
  return rows;
}

/**
 * Agrupa por (produto, lote) — cada `n_lote` é uma variação histórica da
 * receita — e escolhe o grupo mais recente de forma DETERMINÍSTICA.
 *
 * O `n_lote` do corpus começa por `AAMM` (ex.: `24060001M`), então a ordem
 * lexicográfica decrescente é cronológica. Onde o padrão não se confirma, a
 * escolha continua determinística (maior string) e é reportada — a
 * migração completa do histórico é a capacidade 41.
 */
export function selectLatestGroups(
  rows: FormulationRow[],
  findings: FindingSink,
): Map<string, FormulationGroup> {
  const groups = new Map<string, FormulationGroup>();
  for (const row of rows) {
    const key = `${row.productCode}::${row.lot}`;
    const group = groups.get(key) ?? {
      productCode: row.productCode,
      productName: row.productName,
      lot: row.lot,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }

  const latestByProduct = new Map<string, FormulationGroup>();
  const chronological = /^\d{4}/;
  for (const group of groups.values()) {
    const current = latestByProduct.get(group.productCode);
    if (!current || group.lot.localeCompare(current.lot) > 0) {
      latestByProduct.set(group.productCode, group);
    }
    if (!chronological.test(group.lot)) {
      findings.add(
        "FORMULATION_LOT_NOT_CHRONOLOGICAL",
        "Formulation",
        `${group.productCode}/${group.lot}`,
        "n_lote fora do padrão AAMM — seleção determinística por ordenação",
      );
    }
  }
  return latestByProduct;
}
