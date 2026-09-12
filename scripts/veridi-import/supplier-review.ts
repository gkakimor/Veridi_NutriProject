import { digitsOnly, isValidCnpj } from "../veridi-data/corpus.js";
import type { FindingSink } from "../veridi-data/corpus.js";
import { normalizeSupplierName } from "../veridi-data/supplier-price-analysis.js";
import { aprovados, campo, naoImportar } from "./review-package.js";
import type { RegistroRevisado, WorkbookRevisado } from "./review-package.js";

/** `OFE-LEG-` + os 12 primeiros caracteres da chave de idempotência da oferta. */
export function chaveDaOferta(sourceKey: string): string {
  return `OFE-LEG-${sourceKey.slice(0, 12).toUpperCase()}`;
}

/**
 * Fornecedor a partir do pacote revisado — o Excel manda, não o CSV.
 *
 * Enquanto o importador montava o fornecedor a partir de `fornecedores.csv`,
 * toda correção humana (razão social, CNPJ, endereço, "não importar") era
 * descartada em silêncio. Aqui a fonte é o 02_FORNECEDORES devolvido: os
 * campos saem do workbook e a identidade é a CHAVE_MIGRACAO.
 */

/**
 * UFs aceitas. Cópia de `packages/shared/src/br-states.ts`, que não resolve
 * fora do workspace da API (mesmo motivo de `ITEM_CODE_SEQUENCE` no pipeline).
 * `supplier-review.test.ts` compara as duas listas para a cópia não envelhecer.
 */
export const UFS_ACEITAS: readonly string[] = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

/** Colunas do 02 que viram campo do Supplier. Fora daqui, nada é gravado. */
export const COLUNAS_ENDERECO = [
  "CEP", "LOGRADOURO", "NUMERO", "COMPLEMENTO", "BAIRRO", "CIDADE", "UF",
] as const;

export interface SupplierRevisado {
  /** CHAVE_MIGRACAO — identidade do fornecedor durante toda a migração. */
  key: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
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
  /** `true` quando pelo menos um campo de endereço veio preenchido. */
  temEndereco: boolean;
}

export interface LeituraDeFornecedores {
  aprovados: SupplierRevisado[];
  /** CHAVE_MIGRACAO dos fornecedores marcados NAO_IMPORTAR. */
  excluidos: Set<string>;
  /** `true` quando algo reprovou: o PLAN não pode seguir para carga. */
  bloqueado: boolean;
}

function simNao(valor: string | null, padrao: boolean): boolean {
  if (valor === null) return padrao;
  return valor.toUpperCase().startsWith("S");
}

/**
 * Converte os fornecedores aprovados do workbook em dados do domínio.
 *
 * Revalida CEP, UF e CNPJ mesmo o tooling do pacote já tendo validado: o JSON
 * exportado é um arquivo local e editável, e o importador não pode ser o elo
 * que confia sem conferir. Valor inválido vira finding BLOCKING — nunca é
 * corrigido, nunca é descartado em silêncio.
 */
export function lerFornecedoresRevisados(
  workbook: WorkbookRevisado,
  findings: FindingSink,
): LeituraDeFornecedores {
  const lidos: SupplierRevisado[] = [];
  let bloqueado = false;

  const reprovar = (code: string, registro: RegistroRevisado, detalhe: string): void => {
    findings.add(code, "Supplier", registro.chave, detalhe);
    bloqueado = true;
  };

  for (const registro of aprovados(workbook)) {
    const legalName = campo(registro, "RAZAO_SOCIAL_NOME");
    if (!legalName) {
      reprovar("SUPPLIER_REVIEW_WITHOUT_NAME", registro, "aprovado sem RAZAO_SOCIAL_NOME");
      continue;
    }

    const cnpjBruto = campo(registro, "CNPJ");
    const cnpj = cnpjBruto ? digitsOnly(cnpjBruto) : null;
    if (cnpjBruto && (!cnpj || !isValidCnpj(cnpj))) {
      reprovar("SUPPLIER_REVIEW_CNPJ_INVALID", registro, `CNPJ "${cnpjBruto}" nao passa na validacao do dominio`);
      continue;
    }

    const cepBruto = campo(registro, "CEP");
    const zipCode = cepBruto ? digitsOnly(cepBruto) : null;
    if (cepBruto && (!zipCode || zipCode.length !== 8)) {
      reprovar("SUPPLIER_REVIEW_ZIP_INVALID", registro, `CEP "${cepBruto}" nao tem 8 digitos`);
      continue;
    }

    const ufBruta = campo(registro, "UF");
    const state = ufBruta ? ufBruta.toUpperCase() : null;
    if (state && !UFS_ACEITAS.includes(state)) {
      reprovar("SUPPLIER_REVIEW_STATE_INVALID", registro, `UF "${ufBruta}" fora da lista oficial`);
      continue;
    }

    const endereco = {
      zipCode,
      street: campo(registro, "LOGRADOURO"),
      number: campo(registro, "NUMERO"),
      complement: campo(registro, "COMPLEMENTO"),
      district: campo(registro, "BAIRRO"),
      city: campo(registro, "CIDADE"),
      state,
    };

    lidos.push({
      key: registro.chave,
      legalName,
      tradeName: campo(registro, "NOME_FANTASIA"),
      cnpj,
      email: campo(registro, "EMAIL"),
      phone: campo(registro, "TELEFONE"),
      ...endereco,
      notes: campo(registro, "NOTAS_INTERNAS"),
      // Fornecedor sem endereço continua válido: o campo é complementar.
      active: simNao(campo(registro, "ATIVO"), true),
      temEndereco: Object.values(endereco).some((valor) => valor !== null),
    });
  }

  bloqueado = detectarColisoes(lidos, findings) || bloqueado;

  return { aprovados: lidos, excluidos: naoImportar(workbook), bloqueado };
}

/**
 * Dois fornecedores aprovados que o banco não consegue distinguir.
 *
 * O reencontro entre execuções é por `legalName` — é o único identificador
 * estável que o Supplier tem hoje. Se dois aprovados compartilham a razão
 * social, ou colidem depois de normalizar o nome, o importador não tem como
 * escolher: reprova. Nunca escolher um por ordem de planilha, nunca fundir.
 */
function detectarColisoes(lidos: readonly SupplierRevisado[], findings: FindingSink): boolean {
  let bloqueado = false;
  const porNomeExato = new Map<string, SupplierRevisado[]>();
  const porNomeNormalizado = new Map<string, SupplierRevisado[]>();

  for (const supplier of lidos) {
    const exato = porNomeExato.get(supplier.legalName) ?? [];
    exato.push(supplier);
    porNomeExato.set(supplier.legalName, exato);

    const normalizado = normalizeSupplierName(supplier.legalName);
    const grupo = porNomeNormalizado.get(normalizado) ?? [];
    grupo.push(supplier);
    porNomeNormalizado.set(normalizado, grupo);
  }

  const chavesDe = (grupo: readonly SupplierRevisado[]): string =>
    grupo.map((supplier) => supplier.key).join(" / ");

  for (const [nome, grupo] of porNomeExato) {
    if (grupo.length < 2) continue;
    findings.add(
      "SUPPLIER_REVIEW_NAME_COLLISION",
      "Supplier",
      chavesDe(grupo),
      `razao social identica aprovada em ${grupo.length} registros: "${nome}"`,
    );
    bloqueado = true;
  }

  for (const [normalizado, grupo] of porNomeNormalizado) {
    if (grupo.length < 2) continue;
    // Razão social idêntica já saiu como colisão exata; aqui só o caso em que
    // os nomes são diferentes e ainda assim colapsam na normalização.
    if (new Set(grupo.map((supplier) => supplier.legalName)).size === 1) continue;
    findings.add(
      "SUPPLIER_REVIEW_NAME_COLLISION_NORMALIZED",
      "Supplier",
      chavesDe(grupo),
      `nomes diferentes que o importador nao distingue apos normalizar ("${normalizado}"): ` +
        grupo.map((supplier) => `"${supplier.legalName}"`).join(", "),
    );
    bloqueado = true;
  }
  return bloqueado;
}

/* ─────────────── Relação item × fornecedor (07) ─────────────── */

/** O que o pipeline deve fazer com uma linha de preço do corpus. */
export type DestinoDaOferta =
  /** Aprovada: segue para SupplierItem e oferta. */
  | { situacao: "IMPORTAR"; supplierId: string; revisao: RegistroRevisado }
  /** A Veridi não aprovou esta oferta (REVISAR, PENDENTE ou NAO_IMPORTAR). */
  | { situacao: "FORA_DA_CARGA"; revisao: RegistroRevisado }
  /** Aponta para fornecedor excluído, inexistente ou sem chave: reprova. */
  | { situacao: "SEM_FORNECEDOR"; code: string; referencia: string; detalhe: string }
  /** Linha do corpus que não existe no workbook devolvido: reprova. */
  | { situacao: "FORA_DO_PACOTE"; code: string; referencia: string; detalhe: string };

export interface ContextoDaOferta {
  ofertas: WorkbookRevisado;
  excluidos: ReadonlySet<string>;
  supplierIdByKey: ReadonlyMap<string, string>;
}

/**
 * Resolve o fornecedor de uma oferta pela CHAVE_MIGRACAO, nunca pelo nome.
 *
 * O nome é o que faz a migração apontar para o fornecedor errado: duas
 * grafias parecidas, um "casou por normalização" e a oferta vai parar em
 * outra empresa. A chave da oferta no 07 diz de qual fornecedor APROVADO ela
 * é, e é só isso que vale aqui. Sem chave resolvível, a relação não entra.
 */
export function resolverFornecedorDaOferta(
  sourceKey: string,
  contexto: ContextoDaOferta,
): DestinoDaOferta {
  const chave = chaveDaOferta(sourceKey);
  const revisao = contexto.ofertas.porChave.get(chave) ?? null;
  if (!revisao) {
    return {
      situacao: "FORA_DO_PACOTE",
      code: "SUPPLIER_ITEM_OFFER_NOT_IN_REVIEW",
      referencia: chave,
      detalhe: "linha de preco do corpus sem registro correspondente no workbook devolvido",
    };
  }
  if (revisao.status !== "OK") return { situacao: "FORA_DA_CARGA", revisao };

  const chaveFornecedor = campo(revisao, "CHAVE_FORNECEDOR");
  if (!chaveFornecedor) {
    return {
      situacao: "SEM_FORNECEDOR",
      code: "SUPPLIER_ITEM_SUPPLIER_KEY_UNKNOWN",
      referencia: revisao.chave,
      detalhe: "oferta aprovada sem CHAVE_FORNECEDOR",
    };
  }
  if (contexto.excluidos.has(chaveFornecedor)) {
    return {
      situacao: "SEM_FORNECEDOR",
      code: "SUPPLIER_ITEM_SUPPLIER_NOT_IMPORTED",
      referencia: `${revisao.chave} → ${chaveFornecedor}`,
      detalhe: "oferta aprovada aponta para fornecedor marcado NAO_IMPORTAR",
    };
  }
  const supplierId = contexto.supplierIdByKey.get(chaveFornecedor);
  if (!supplierId) {
    return {
      situacao: "SEM_FORNECEDOR",
      code: "SUPPLIER_ITEM_SUPPLIER_KEY_UNKNOWN",
      referencia: `${revisao.chave} → ${chaveFornecedor}`,
      detalhe: "CHAVE_FORNECEDOR sem fornecedor aprovado no workbook de fornecedores",
    };
  }
  return { situacao: "IMPORTAR", supplierId, revisao };
}
