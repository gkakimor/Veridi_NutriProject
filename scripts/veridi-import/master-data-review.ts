import { Prisma } from "@prisma/client";
import { digitsOnly, isValidCnpj } from "../veridi-data/corpus.js";
import type { FindingSink } from "../veridi-data/corpus.js";
import { aprovados, campo, naoImportar } from "./review-package.js";
import type { RegistroRevisado, WorkbookRevisado } from "./review-package.js";
import { UFS_ACEITAS } from "./supplier-review.js";

/**
 * Cliente, Item e Produto a partir do pacote revisado (BRIDGE-02).
 *
 * Mesma regra do Fornecedor: quando há devolução, o workbook aprovado é a
 * autoridade sobre os campos que ele expõe, e o corpus vira fonte histórica.
 * Campo presente no workbook nunca é substituído pelo valor bruto do CSV.
 *
 * Todo valor revisado é conferido contra a regra do domínio antes de virar
 * escrita. Valor inválido reprova — nunca é arredondado, completado com
 * padrão nem descartado em silêncio. O dado passou por gente: um número fora
 * da faixa é engano na revisão, e engano se corrige no Excel.
 */

/* ─────────────── rótulo em português → valor do ERP ─────────────── */
/*
 * As tabelas espelham `CATALOGOS` em `scripts/veridi-migration-pack/layout.py`,
 * que é quem escreve a aba VALORES_PERMITIDOS de cada workbook. Ficam aqui em
 * vez de virem no pacote de propósito: o rótulo é dado do arquivo, mas o valor
 * técnico é contrato do domínio, e contrato não se lê de um arquivo editável.
 * Rótulo desconhecido reprova.
 */

export const TIPO_ITEM_DO_PACOTE: Record<string, "RAW_MATERIAL" | "PACKAGING"> = {
  MATERIA_PRIMA: "RAW_MATERIAL",
  EMBALAGEM: "PACKAGING",
};

export const FAMILIA_DO_PACOTE: Record<string, string> = {
  VITAMINA: "VITAMIN",
  MINERAL: "MINERAL",
  AMINOACIDO: "AMINO_ACID",
  EXCIPIENTE: "EXCIPIENT",
  BOTANICO: "BOTANICAL",
  OUTRA_MATERIA_PRIMA: "OTHER_RAW_MATERIAL",
  EMBALAGEM: "PACKAGING",
  OUTRO: "OTHER",
};

export const SUBTIPO_EMBALAGEM_DO_PACOTE: Record<string, string> = {
  POTE: "POT",
  TAMPA: "CAP",
  DOSADOR: "SCOOP",
  SELO: "SEAL",
  ROTULO: "LABEL",
  CAIXA: "BOX",
  SACHE_POUCH: "POUCH",
  CARTUCHO: "CARTON",
  FRASCO: "BOTTLE",
  OUTRO: "OTHER",
};

export const PERFIL_TRIBUTARIO_DO_PACOTE: Record<string, string> = {
  NAO_INFORMADO: "NOT_INFORMED",
  MEI: "MEI",
  SIMPLES_NACIONAL: "SIMPLES_NACIONAL",
  LUCRO_PRESUMIDO: "LUCRO_PRESUMIDO",
  LUCRO_REAL: "LUCRO_REAL",
  OUTRO: "OTHER",
};

export const FORMA_FARMACEUTICA_DO_PACOTE: Record<string, string> = {
  CAPSULA: "CAPSULE",
  PO: "POWDER",
  COMPRIMIDO: "TABLET",
  LIQUIDO: "LIQUID",
  OUTRO: "OTHER",
};

export const APRESENTACAO_DO_PACOTE: Record<string, string> = {
  POTE: "POT",
  SACHE_POUCH: "POUCH",
  CARTUCHO: "CARTON",
  GRANEL: "BULK",
  FRASCO: "BOTTLE",
  OUTRA: "OTHER",
};

export const PUBLICO_ALVO_DO_PACOTE: Record<string, string> = {
  ADULTO: "ADULT",
  INFANTIL: "CHILD",
  GESTANTE: "PREGNANT",
  LACTANTE: "LACTATING",
  OUTRO: "OTHER",
};

/* ─────────────── leitura de campo ─────────────── */

const CEM = new Prisma.Decimal(100);
/** Scale de `Item.defaultPurityPercent` — `DECIMAL(9,6)`, PREC-MIG-C. */
const CASAS_PUREZA = 6;

export function simNaoRevisado(valor: string | null, padrao: boolean): boolean {
  if (valor === null) return padrao;
  return valor.toUpperCase().startsWith("S");
}

/** Número revisado. `undefined` = havia texto e não era número. */
export function numeroRevisado(
  registro: RegistroRevisado,
  coluna: string,
): Prisma.Decimal | null | undefined {
  const valor = campo(registro, coluna);
  if (valor === null) return null;
  try {
    const numero = new Prisma.Decimal(valor.replace(/\s/g, "").replace(",", "."));
    return numero.isFinite() ? numero : undefined;
  } catch {
    return undefined;
  }
}

/** Inteiro revisado. `undefined` = ilegível, fracionário ou negativo. */
export function inteiroRevisado(
  registro: RegistroRevisado,
  coluna: string,
): number | null | undefined {
  const numero = numeroRevisado(registro, coluna);
  if (numero === null || numero === undefined) return numero;
  if (!numero.isInteger() || numero.lessThan(0)) return undefined;
  return numero.toNumber();
}

/**
 * Acumula o que foi lido de um workbook e o que reprovou.
 *
 * `bloqueado` é o que impede o PLAN de virar carga: existe um registro
 * aprovado pela Veridi que o importador não consegue escrever com segurança.
 */
export interface LeituraRevisada<T> {
  aprovados: T[];
  /** CHAVE_MIGRACAO dos registros marcados NAO_IMPORTAR. */
  excluidos: Set<string>;
  bloqueado: boolean;
}

class Coletor<T> {
  readonly lidos: T[] = [];
  bloqueado = false;

  constructor(
    private readonly findings: FindingSink,
    private readonly entidade: string,
  ) {}

  reprovar(code: string, referencia: string, detalhe: string): void {
    this.findings.add(code, this.entidade, referencia, detalhe);
    this.bloqueado = true;
  }

  fechar(workbook: WorkbookRevisado): LeituraRevisada<T> {
    return { aprovados: this.lidos, excluidos: naoImportar(workbook), bloqueado: this.bloqueado };
  }
}

/** Duas linhas aprovadas que o banco não consegue distinguir: reprova. */
function reprovarDuplicidade<T extends { key: string }>(
  coletor: Coletor<T>,
  lidos: readonly T[],
  identidade: (registro: T) => string | null,
  code: string,
  oQueE: string,
): void {
  const porIdentidade = new Map<string, T[]>();
  for (const registro of lidos) {
    const valor = identidade(registro);
    if (!valor) continue;
    const grupo = porIdentidade.get(valor) ?? [];
    grupo.push(registro);
    porIdentidade.set(valor, grupo);
  }
  for (const [valor, grupo] of porIdentidade) {
    if (grupo.length < 2) continue;
    coletor.reprovar(
      code,
      grupo.map((registro) => registro.key).join(" / "),
      `${oQueE} "${valor}" aprovado em ${grupo.length} registros — o importador nao consegue distingui-los`,
    );
  }
}

/* ─────────────── Cliente (01) ─────────────── */

export interface ClienteRevisado {
  key: string;
  externalCode: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  taxProfile: string;
  email: string | null;
  phone: string | null;
  zipCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  active: boolean;
}

export function lerClientesRevisados(
  workbook: WorkbookRevisado,
  findings: FindingSink,
): LeituraRevisada<ClienteRevisado> {
  const coletor = new Coletor<ClienteRevisado>(findings, "Customer");

  for (const registro of aprovados(workbook)) {
    const legalName = campo(registro, "RAZAO_SOCIAL_NOME");
    if (!legalName) {
      coletor.reprovar("CUSTOMER_REVIEW_WITHOUT_NAME", registro.chave, "aprovado sem RAZAO_SOCIAL_NOME");
      continue;
    }
    // `externalCode` é a identidade persistente do Cliente no ERP e vem de
    // coluna técnica: se sumiu, o reencontro entre execuções some junto.
    const externalCode = campo(registro, "CODIGO_PLANILHA");
    if (!externalCode) {
      coletor.reprovar("CUSTOMER_REVIEW_WITHOUT_CODE", registro.chave, "aprovado sem CODIGO_PLANILHA");
      continue;
    }

    const cnpjBruto = campo(registro, "CNPJ");
    const cnpj = cnpjBruto ? digitsOnly(cnpjBruto) : null;
    if (cnpjBruto && (!cnpj || !isValidCnpj(cnpj))) {
      coletor.reprovar("CUSTOMER_REVIEW_CNPJ_INVALID", registro.chave, `CNPJ "${cnpjBruto}" nao passa na validacao do dominio`);
      continue;
    }

    const endereco = lerEndereco(registro, coletor, registro.chave, "CUSTOMER_REVIEW");
    if (!endereco) continue;

    const perfil = campo(registro, "PERFIL_TRIBUTARIO");
    const taxProfile = perfil ? PERFIL_TRIBUTARIO_DO_PACOTE[perfil] : "NOT_INFORMED";
    if (!taxProfile) {
      coletor.reprovar("CUSTOMER_REVIEW_TAX_PROFILE_INVALID", registro.chave, `perfil tributario "${perfil}" fora da lista`);
      continue;
    }

    coletor.lidos.push({
      key: registro.chave,
      externalCode,
      legalName,
      tradeName: campo(registro, "NOME_FANTASIA"),
      cnpj,
      taxProfile,
      email: campo(registro, "EMAIL"),
      phone: campo(registro, "TELEFONE"),
      ...endereco,
      notes: campo(registro, "NOTAS_INTERNAS"),
      active: simNaoRevisado(campo(registro, "ATIVO"), true),
    });
  }

  reprovarDuplicidade(
    coletor,
    coletor.lidos,
    (cliente) => cliente.externalCode,
    "CUSTOMER_REVIEW_CODE_COLLISION",
    "codigo da planilha",
  );
  return coletor.fechar(workbook);
}

interface EnderecoRevisado {
  zipCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
}

/** Endereço opcional, com a mesma regra de CEP e UF do runtime. */
function lerEndereco(
  registro: RegistroRevisado,
  coletor: Coletor<unknown> | { reprovar(code: string, referencia: string, detalhe: string): void },
  referencia: string,
  prefixo: string,
): EnderecoRevisado | null {
  const cepBruto = campo(registro, "CEP");
  const zipCode = cepBruto ? digitsOnly(cepBruto) : null;
  if (cepBruto && (!zipCode || zipCode.length !== 8)) {
    coletor.reprovar(`${prefixo}_ZIP_INVALID`, referencia, `CEP "${cepBruto}" nao tem 8 digitos`);
    return null;
  }
  const ufBruta = campo(registro, "UF");
  const state = ufBruta ? ufBruta.toUpperCase() : null;
  if (state && !UFS_ACEITAS.includes(state)) {
    coletor.reprovar(`${prefixo}_STATE_INVALID`, referencia, `UF "${ufBruta}" fora da lista oficial`);
    return null;
  }
  return {
    zipCode,
    street: campo(registro, "LOGRADOURO"),
    number: campo(registro, "NUMERO"),
    complement: campo(registro, "COMPLEMENTO"),
    district: campo(registro, "BAIRRO"),
    city: campo(registro, "CIDADE"),
    state,
  };
}

/* ─────────────── Item: matéria-prima (03) e embalagem (04) ─────────────── */

export interface ItemRevisado {
  key: string;
  externalCode: string;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING";
  unitCode: string;
  sourceName: string | null;
  declaredNutrient: string | null;
  family: string | null;
  defaultPurityPercent: string | null;
  packagingSubtype: string | null;
  controlsLot: boolean;
  controlsExpiry: boolean;
  requiresQualityRelease: boolean;
  requiresCoa: boolean;
  externalBarcode: string | null;
  active: boolean;
}

/**
 * Lê 03 ou 04. O mesmo leitor serve aos dois: o workbook não decide o tipo do
 * item, a coluna TIPO decide — e ela é revisável. Item que a Veridi reclassificou
 * de embalagem para matéria-prima muda de arquivo na próxima geração, não aqui.
 */
export function lerItensRevisados(
  workbook: WorkbookRevisado,
  unidadesValidas: ReadonlySet<string>,
  findings: FindingSink,
): LeituraRevisada<ItemRevisado> {
  const coletor = new Coletor<ItemRevisado>(findings, "Item");

  for (const registro of aprovados(workbook)) {
    const name = campo(registro, "NOME");
    if (!name) {
      coletor.reprovar("ITEM_REVIEW_WITHOUT_NAME", registro.chave, "aprovado sem NOME");
      continue;
    }
    const externalCode = campo(registro, "CODIGO_PLANILHA");
    if (!externalCode) {
      coletor.reprovar("ITEM_REVIEW_WITHOUT_CODE", registro.chave, "aprovado sem CODIGO_PLANILHA");
      continue;
    }

    const tipoBruto = campo(registro, "TIPO");
    const type = tipoBruto ? TIPO_ITEM_DO_PACOTE[tipoBruto] : undefined;
    if (!type) {
      coletor.reprovar("ITEM_REVIEW_TYPE_INVALID", registro.chave, `TIPO "${tipoBruto ?? "(vazio)"}" fora da lista`);
      continue;
    }

    // Unidade sai do catálogo real de UOM. Criar unidade a partir de texto do
    // Excel seria deixar a planilha inventar vocabulário do domínio.
    const unitCode = campo(registro, "UNIDADE");
    if (!unitCode || !unidadesValidas.has(unitCode)) {
      coletor.reprovar(
        "ITEM_REVIEW_UOM_INVALID",
        registro.chave,
        `unidade "${unitCode ?? "(vazio)"}" nao existe no catalogo de unidades do ERP`,
      );
      continue;
    }

    const familiaBruta = campo(registro, "FAMILIA");
    const family = familiaBruta ? (FAMILIA_DO_PACOTE[familiaBruta] ?? null) : null;
    if (familiaBruta && !family) {
      coletor.reprovar("ITEM_REVIEW_FAMILY_INVALID", registro.chave, `familia "${familiaBruta}" fora da lista`);
      continue;
    }

    const subtipoBruto = campo(registro, "SUBTIPO_EMBALAGEM");
    const packagingSubtype = subtipoBruto ? (SUBTIPO_EMBALAGEM_DO_PACOTE[subtipoBruto] ?? null) : null;
    if (subtipoBruto && !packagingSubtype) {
      coletor.reprovar("ITEM_REVIEW_PACKAGING_SUBTYPE_INVALID", registro.chave, `subtipo "${subtipoBruto}" fora da lista`);
      continue;
    }
    // Subtipo só existe para embalagem — a mesma coerência que o service cobra.
    if (packagingSubtype && type !== "PACKAGING") {
      coletor.reprovar(
        "ITEM_REVIEW_PACKAGING_SUBTYPE_ON_RAW_MATERIAL",
        registro.chave,
        `subtipo de embalagem "${subtipoBruto}" num item classificado como materia-prima`,
      );
      continue;
    }

    // A planilha guarda pureza em 0–1 e o ERP trabalha em 0–100, com o scale
    // de DECIMAL(9,6): acima disso o Postgres arredondaria sem avisar.
    const purezaBruta = numeroRevisado(registro, "PUREZA_PADRAO");
    let defaultPurityPercent: string | null = null;
    if (purezaBruta === undefined) {
      coletor.reprovar("ITEM_REVIEW_PURITY_INVALID", registro.chave, "PUREZA_PADRAO nao e numero");
      continue;
    }
    if (purezaBruta !== null) {
      const escalada = purezaBruta.times(CEM);
      if (!escalada.greaterThan(0) || !escalada.lessThanOrEqualTo(100)) {
        coletor.reprovar(
          "ITEM_REVIEW_PURITY_INVALID",
          registro.chave,
          `pureza ${escalada.toString()}% fora da faixa de 0 a 100`,
        );
        continue;
      }
      if (escalada.decimalPlaces() > CASAS_PUREZA) {
        coletor.reprovar(
          "ITEM_REVIEW_PURITY_INVALID",
          registro.chave,
          `pureza ${escalada.toString()}% tem mais de ${CASAS_PUREZA} casas decimais`,
        );
        continue;
      }
      defaultPurityPercent = escalada.toString();
    }

    coletor.lidos.push({
      key: registro.chave,
      externalCode,
      name,
      type,
      unitCode,
      sourceName: campo(registro, "FONTE"),
      declaredNutrient: campo(registro, "NUTRIENTE_DECLARADO"),
      family,
      defaultPurityPercent,
      packagingSubtype,
      controlsLot: simNaoRevisado(campo(registro, "CONTROLA_LOTE"), true),
      controlsExpiry: simNaoRevisado(campo(registro, "CONTROLA_VALIDADE"), type === "RAW_MATERIAL"),
      requiresQualityRelease: simNaoRevisado(campo(registro, "REQUER_LIBERACAO_QUALIDADE"), type === "RAW_MATERIAL"),
      requiresCoa: simNaoRevisado(campo(registro, "EXIGE_COA_LAUDO"), false),
      externalBarcode: campo(registro, "BARCODE_EXTERNO"),
      active: simNaoRevisado(campo(registro, "ATIVO"), true),
    });
  }

  reprovarDuplicidade(
    coletor,
    coletor.lidos,
    (item) => item.externalCode,
    "ITEM_REVIEW_CODE_COLLISION",
    "codigo da planilha",
  );
  return coletor.fechar(workbook);
}

/* ─────────────── Produto acabado (05) ─────────────── */

export interface ProdutoRevisado {
  key: string;
  /** CHAVE_MIGRACAO do Item de produto acabado — o par 1:1 do workbook. */
  finishedItemKey: string;
  customerKey: string;
  externalCode: string;
  name: string;
  finishedUnitCode: string;
  finishedRequiresCoa: boolean;
  dosageForm: string | null;
  presentationType: string | null;
  capsulesPerDose: number | null;
  doseAmount: string | null;
  doseUomCode: string | null;
  dosesPerPackage: number | null;
  unitsPerShippingBox: number | null;
  targetAgeGroup: string | null;
  shelfLifeMonths: number | null;
  minimumBatchQuantity: string | null;
  notes: string | null;
  active: boolean;
}

/** `PROD-LEG-` / `PA-LEG-` + o código legado normalizado (espelha `regras.slug`). */
function slugDaChave(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/ /g, "-");
}

export function lerProdutosRevisados(
  workbook: WorkbookRevisado,
  unidadesValidas: ReadonlySet<string>,
  findings: FindingSink,
): LeituraRevisada<ProdutoRevisado> {
  const coletor = new Coletor<ProdutoRevisado>(findings, "Product");

  for (const registro of aprovados(workbook)) {
    const name = campo(registro, "NOME_PRODUTO");
    if (!name) {
      coletor.reprovar("PRODUCT_REVIEW_WITHOUT_NAME", registro.chave, "aprovado sem NOME_PRODUTO");
      continue;
    }
    const customerKey = campo(registro, "CHAVE_CLIENTE");
    if (!customerKey) {
      coletor.reprovar("PRODUCT_REVIEW_WITHOUT_CUSTOMER", registro.chave, "aprovado sem CHAVE_CLIENTE");
      continue;
    }
    const finishedItemKey = campo(registro, "CHAVE_ITEM_PA");
    if (!finishedItemKey) {
      coletor.reprovar("PRODUCT_REVIEW_WITHOUT_FINISHED_ITEM", registro.chave, "aprovado sem CHAVE_ITEM_PA");
      continue;
    }
    // Produto e item de produto acabado são 1:1 e nascem do mesmo código
    // legado. Se as duas chaves deixarem de corresponder, o par se desfez.
    if (
      finishedItemKey.replace(/^PA-LEG-/, "") !== registro.chave.replace(/^PROD-LEG-/, "")
    ) {
      coletor.reprovar(
        "PRODUCT_REVIEW_FINISHED_ITEM_MISMATCH",
        `${registro.chave} / ${finishedItemKey}`,
        "CHAVE_ITEM_PA nao corresponde ao produto (a relacao e 1:1)",
      );
      continue;
    }

    // `externalCode` é o que liga o produto às formulações e aos projetos do
    // legado. Trocá-lo desfaz esse vínculo em silêncio, então tem de continuar
    // sendo o mesmo código de onde a CHAVE_MIGRACAO saiu.
    const externalCode = campo(registro, "REFERENCIA_EXTERNA");
    if (!externalCode) {
      coletor.reprovar("PRODUCT_REVIEW_WITHOUT_EXTERNAL_CODE", registro.chave, "aprovado sem REFERENCIA_EXTERNA");
      continue;
    }
    if (slugDaChave(externalCode) !== registro.chave.replace(/^PROD-LEG-/, "")) {
      coletor.reprovar(
        "PRODUCT_REVIEW_EXTERNAL_CODE_CHANGED",
        registro.chave,
        `REFERENCIA_EXTERNA "${externalCode}" nao corresponde a CHAVE_MIGRACAO — o vinculo com formulacao e projeto legado se perderia`,
      );
      continue;
    }

    const finishedUnitCode = campo(registro, "UNIDADE_ESTOQUE");
    if (!finishedUnitCode || !unidadesValidas.has(finishedUnitCode)) {
      coletor.reprovar(
        "PRODUCT_REVIEW_UOM_INVALID",
        registro.chave,
        `unidade de estoque "${finishedUnitCode ?? "(vazio)"}" nao existe no catalogo de unidades do ERP`,
      );
      continue;
    }

    const catalogos: [string, Record<string, string>, string][] = [
      ["FORMA_FARMACEUTICA", FORMA_FARMACEUTICA_DO_PACOTE, "forma farmaceutica"],
      ["APRESENTACAO", APRESENTACAO_DO_PACOTE, "apresentacao"],
      ["PUBLICO_ALVO", PUBLICO_ALVO_DO_PACOTE, "publico alvo"],
    ];
    const traduzidos: Record<string, string | null> = {};
    let catalogoInvalido = false;
    for (const [coluna, mapa, rotulo] of catalogos) {
      const bruto = campo(registro, coluna);
      const traduzido = bruto ? (mapa[bruto] ?? null) : null;
      if (bruto && !traduzido) {
        coletor.reprovar("PRODUCT_REVIEW_ENUM_INVALID", registro.chave, `${rotulo} "${bruto}" fora da lista`);
        catalogoInvalido = true;
        break;
      }
      traduzidos[coluna] = traduzido;
    }
    if (catalogoInvalido) continue;

    const inteiros: [string, string][] = [
      ["CAPSULAS_POR_DOSE", "capsulas por dose"],
      ["DOSES_POR_EMBALAGEM", "doses por embalagem"],
      ["UNIDADES_POR_CAIXA", "unidades por caixa"],
      ["VIDA_UTIL_MESES", "vida util em meses"],
    ];
    const numerosInteiros: Record<string, number | null> = {};
    let inteiroInvalido = false;
    for (const [coluna, rotulo] of inteiros) {
      const valor = inteiroRevisado(registro, coluna);
      if (valor === undefined) {
        coletor.reprovar(
          "PRODUCT_REVIEW_NUMBER_INVALID",
          registro.chave,
          `${rotulo}: "${campo(registro, coluna)}" nao e inteiro maior ou igual a zero`,
        );
        inteiroInvalido = true;
        break;
      }
      numerosInteiros[coluna] = valor;
    }
    if (inteiroInvalido) continue;

    const dose = numeroRevisado(registro, "DOSE");
    const loteMinimo = numeroRevisado(registro, "LOTE_MINIMO");
    if (dose === undefined || loteMinimo === undefined) {
      coletor.reprovar("PRODUCT_REVIEW_NUMBER_INVALID", registro.chave, "DOSE ou LOTE_MINIMO nao e numero");
      continue;
    }
    const doseUomCode = campo(registro, "UNIDADE_DOSE");
    if (doseUomCode && !unidadesValidas.has(doseUomCode)) {
      coletor.reprovar(
        "PRODUCT_REVIEW_UOM_INVALID",
        registro.chave,
        `unidade da dose "${doseUomCode}" nao existe no catalogo de unidades do ERP`,
      );
      continue;
    }
    if (dose !== null && !doseUomCode) {
      coletor.reprovar("PRODUCT_REVIEW_DOSE_WITHOUT_UOM", registro.chave, "DOSE preenchida sem UNIDADE_DOSE");
      continue;
    }

    coletor.lidos.push({
      key: registro.chave,
      finishedItemKey,
      customerKey,
      externalCode,
      name,
      finishedUnitCode,
      finishedRequiresCoa: simNaoRevisado(campo(registro, "EXIGE_COA_LAUDO"), false),
      dosageForm: traduzidos["FORMA_FARMACEUTICA"] ?? null,
      presentationType: traduzidos["APRESENTACAO"] ?? null,
      capsulesPerDose: numerosInteiros["CAPSULAS_POR_DOSE"] ?? null,
      doseAmount: dose ? dose.toString() : null,
      doseUomCode: dose ? doseUomCode : null,
      dosesPerPackage: numerosInteiros["DOSES_POR_EMBALAGEM"] ?? null,
      unitsPerShippingBox: numerosInteiros["UNIDADES_POR_CAIXA"] ?? null,
      targetAgeGroup: traduzidos["PUBLICO_ALVO"] ?? null,
      shelfLifeMonths: numerosInteiros["VIDA_UTIL_MESES"] ?? null,
      minimumBatchQuantity: loteMinimo ? loteMinimo.toString() : null,
      notes: campo(registro, "NOTAS_INTERNAS"),
      active: simNaoRevisado(campo(registro, "ATIVO"), true),
    });
  }

  reprovarDuplicidade(
    coletor,
    coletor.lidos,
    (produto) => produto.externalCode,
    "PRODUCT_REVIEW_CODE_COLLISION",
    "referencia externa",
  );
  reprovarDuplicidade(
    coletor,
    coletor.lidos,
    (produto) => produto.finishedItemKey,
    "PRODUCT_REVIEW_FINISHED_ITEM_COLLISION",
    "item de produto acabado",
  );
  return coletor.fechar(workbook);
}
