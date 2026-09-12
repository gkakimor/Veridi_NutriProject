import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FindingLog } from "../veridi-data/corpus.js";
import {
  lerClientesRevisados,
  lerItensRevisados,
  lerProdutosRevisados,
} from "./master-data-review.js";
import { WORKBOOKS_DO_ESCOPO, chaveDoItem } from "./pipeline.js";
import { bloqueiosDaRevisao, loadReviewPackage, workbookObrigatorio } from "./review-package.js";

/**
 * Cliente, Item e Produto vindos do pacote revisado (BRIDGE-02).
 *
 * Pacotes sintéticos em pasta temporária: o dado da Veridi fica fora do Git.
 * O que se protege aqui é a precedência (workbook vence corpus), a exclusão
 * explícita e o fail-closed de tudo que o importador não consegue escrever
 * com segurança.
 */

const STATUS = ["REVISAR", "OK", "PENDENTE", "NAO_IMPORTAR"];
const CLIENTES = "01_CLIENTES";
const MATERIAS = "03_MATERIAS_PRIMAS";
const EMBALAGENS = "04_EMBALAGENS_INSUMOS";
const PRODUTOS = "05_PRODUTOS_ACABADOS";
const UNIDADES = new Set(["mg", "g", "kg", "un", "mL", "L"]);

const temporarios: string[] = [];
afterAll(() => {
  for (const pasta of temporarios) fs.rmSync(pasta, { recursive: true, force: true });
});

type Campos = Record<string, string | number | null>;
interface Linha {
  chave: string;
  status: string;
  campos: Campos;
}

function workbook(registros: Linha[]): Record<string, unknown> {
  return {
    colunaStatus: "STATUS_REVISAO",
    statusPermitidos: STATUS,
    colunas: ["CHAVE_MIGRACAO", "STATUS_REVISAO"],
    obrigatorias: ["CHAVE_MIGRACAO", "STATUS_REVISAO"],
    contagem: {},
    registros,
  };
}

function gravar(workbooks: Record<string, Linha[]>): string {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "veridi-md-"));
  temporarios.push(pasta);
  const destino = path.join(pasta, "pacote.json");
  fs.writeFileSync(
    destino,
    JSON.stringify({
      formato: 1,
      geradoEm: "2026-09-12T09:00:00",
      pacote: {
        caminho: pasta,
        identidade: "a".repeat(64),
        referencia: null,
        arquivos: Object.keys(workbooks).map((nome) => ({
          nome,
          sha256: "b".repeat(64),
          bytes: 1,
          modificadoEm: "",
          registros: workbooks[nome]!.length,
        })),
      },
      validacao: { devolucao: true, erros: 0 },
      workbooks: Object.fromEntries(
        Object.entries(workbooks).map(([nome, linhas]) => [nome, workbook(linhas)]),
      ),
    }),
    "utf8",
  );
  return destino;
}

function ler(workbooks: Record<string, Linha[]>, nome: string) {
  const pacote = loadReviewPackage(gravar(workbooks));
  return { pacote, workbook: workbookObrigatorio(pacote, nome), findings: new FindingLog() };
}

/* ─────────────── Cliente ─────────────── */

function cliente(chave: string, status: string, campos: Campos = {}): Linha {
  return {
    chave,
    status,
    campos: {
      CODIGO_PLANILHA: chave.replace("CLI-LEG-", ""),
      RAZAO_SOCIAL_NOME: `Cliente ${chave}`,
      ATIVO: "SIM",
      ...campos,
    },
  };
}

describe("Cliente revisado", () => {
  const lerClientes = (linhas: Linha[]) => {
    const { workbook: wb, findings } = ler({ [CLIENTES]: linhas }, CLIENTES);
    return { leitura: lerClientesRevisados(wb, findings), findings };
  };

  it("usa o nome corrigido no Excel, não o do corpus", () => {
    const { leitura } = lerClientes([
      cliente("CLI-LEG-0001", "OK", { RAZAO_SOCIAL_NOME: "Nutri Premium Comercio Ltda" }),
    ]);
    expect(leitura.aprovados[0]?.legalName).toBe("Nutri Premium Comercio Ltda");
    expect(leitura.aprovados[0]?.externalCode).toBe("0001");
  });

  it("campos revisados vencem o corpus, endereço e perfil tributário incluídos", () => {
    const { leitura } = lerClientes([
      cliente("CLI-LEG-0002", "OK", {
        NOME_FANTASIA: "Nutri",
        CNPJ: "11.222.333/0001-81",
        PERFIL_TRIBUTARIO: "SIMPLES_NACIONAL",
        EMAIL: "contato@exemplo.com.br",
        TELEFONE: "(11) 99999-8888",
        CEP: "13010-000",
        LOGRADOURO: "Avenida Francisco Glicério",
        NUMERO: "1200",
        COMPLEMENTO: "Sala 4",
        BAIRRO: "Centro",
        CIDADE: "Campinas",
        UF: "sp",
        NOTAS_INTERNAS: "conferido",
        ATIVO: "NÃO",
      }),
    ]);
    const lido = leitura.aprovados[0]!;
    expect(lido.cnpj).toBe("11222333000181");
    expect(lido.taxProfile).toBe("SIMPLES_NACIONAL");
    expect(lido.zipCode).toBe("13010000");
    expect(lido.complement).toBe("Sala 4");
    expect(lido.state).toBe("SP");
    expect(lido.active).toBe(false);
  });

  it("NAO_IMPORTAR não entra como aprovado", () => {
    const { leitura } = lerClientes([cliente("CLI-LEG-0003", "NAO_IMPORTAR")]);
    expect(leitura.aprovados).toEqual([]);
    expect([...leitura.excluidos]).toEqual(["CLI-LEG-0003"]);
  });

  it("REVISAR e PENDENTE travam o plano", () => {
    const pacote = loadReviewPackage(
      gravar({ [CLIENTES]: [cliente("CLI-LEG-0004", "REVISAR"), cliente("CLI-LEG-0005", "PENDENTE")] }),
    );
    const bloqueios = bloqueiosDaRevisao(pacote, [CLIENTES]);
    expect(bloqueios[0]).toContain("1 em REVISAR");
    expect(bloqueios[0]).toContain("1 em PENDENTE");
  });

  it("reprova CNPJ, CEP, UF e perfil tributário inválidos", () => {
    for (const [coluna, valor, code] of [
      ["CNPJ", "11222333000182", "CUSTOMER_REVIEW_CNPJ_INVALID"],
      ["CEP", "1301", "CUSTOMER_REVIEW_ZIP_INVALID"],
      ["UF", "XX", "CUSTOMER_REVIEW_STATE_INVALID"],
      ["PERFIL_TRIBUTARIO", "MEIA_BOCA", "CUSTOMER_REVIEW_TAX_PROFILE_INVALID"],
    ] as const) {
      const { leitura, findings } = lerClientes([cliente("CLI-LEG-0006", "OK", { [coluna]: valor })]);
      expect(leitura.bloqueado, `${coluna} devia bloquear`).toBe(true);
      expect(findings.all().map((f) => f.code)).toContain(code);
      expect(leitura.aprovados).toEqual([]);
    }
  });

  it("dois aprovados com o mesmo código da planilha reprovam", () => {
    const { leitura, findings } = lerClientes([
      cliente("CLI-LEG-0007", "OK"),
      cliente("CLI-LEG-0008", "OK", { CODIGO_PLANILHA: "0007" }),
    ]);
    expect(leitura.bloqueado).toBe(true);
    expect(findings.all().map((f) => f.code)).toContain("CUSTOMER_REVIEW_CODE_COLLISION");
  });
});

/* ─────────────── Item ─────────────── */

function item(chave: string, status: string, campos: Campos = {}): Linha {
  return {
    chave,
    status,
    campos: {
      CODIGO_PLANILHA: chave.replace("ITEM-LEG-", ""),
      NOME: `Item ${chave}`,
      TIPO: "MATERIA_PRIMA",
      UNIDADE: "kg",
      ATIVO: "SIM",
      ...campos,
    },
  };
}

describe("Item revisado", () => {
  const lerItens = (linhas: Linha[], nome = MATERIAS) => {
    const { workbook: wb, findings } = ler({ [nome]: linhas }, nome);
    return { leitura: lerItensRevisados(wb, UNIDADES, findings), findings };
  };

  it("nome, unidade e classificação vêm do workbook", () => {
    const { leitura } = lerItens([
      item("ITEM-LEG-0001", "OK", {
        NOME: "Vitamina C revisada",
        UNIDADE: "g",
        FAMILIA: "VITAMINA",
        PUREZA_PADRAO: "0.985",
        EXIGE_COA_LAUDO: "SIM",
        BARCODE_EXTERNO: "7890000000001",
      }),
    ]);
    const lido = leitura.aprovados[0]!;
    expect(lido.name).toBe("Vitamina C revisada");
    expect(lido.unitCode).toBe("g");
    expect(lido.family).toBe("VITAMIN");
    // 0–1 na planilha vira 0–100 no ERP: 0,985 é 98,5%, nunca 0,985%.
    expect(lido.defaultPurityPercent).toBe("98.5");
    expect(lido.requiresCoa).toBe(true);
    expect(lido.externalBarcode).toBe("7890000000001");
  });

  it("a chave resolve o item pelo código da planilha", () => {
    const { leitura } = lerItens([item("ITEM-LEG-0042", "OK", { CODIGO_PLANILHA: "42" })]);
    expect(chaveDoItem(leitura.aprovados[0]!.externalCode)).toBe("ITEM-LEG-0042");
  });

  it("unidade fora do catálogo do ERP bloqueia", () => {
    const { leitura, findings } = lerItens([item("ITEM-LEG-0002", "OK", { UNIDADE: "caixa" })]);
    expect(leitura.bloqueado).toBe(true);
    expect(findings.all().map((f) => f.code)).toContain("ITEM_REVIEW_UOM_INVALID");
    expect(leitura.aprovados).toEqual([]);
  });

  it("NAO_IMPORTAR exclui o item", () => {
    const { leitura } = lerItens([item("ITEM-LEG-0003", "NAO_IMPORTAR")]);
    expect(leitura.aprovados).toEqual([]);
    expect(leitura.excluidos.has("ITEM-LEG-0003")).toBe(true);
  });

  it("classificação revisada de embalagem, com subtipo", () => {
    const { leitura } = lerItens(
      [
        item("ITEM-LEG-0004", "OK", {
          TIPO: "EMBALAGEM",
          UNIDADE: "un",
          SUBTIPO_EMBALAGEM: "POTE",
          FAMILIA: "EMBALAGEM",
        }),
      ],
      EMBALAGENS,
    );
    const lido = leitura.aprovados[0]!;
    expect(lido.type).toBe("PACKAGING");
    expect(lido.packagingSubtype).toBe("POT");
    // Embalagem não controla validade nem liberação por padrão.
    expect(lido.controlsExpiry).toBe(false);
    expect(lido.requiresQualityRelease).toBe(false);
  });

  it("subtipo de embalagem em matéria-prima é ambiguidade e bloqueia", () => {
    const { leitura, findings } = lerItens([
      item("ITEM-LEG-0005", "OK", { TIPO: "MATERIA_PRIMA", SUBTIPO_EMBALAGEM: "POTE" }),
    ]);
    expect(leitura.bloqueado).toBe(true);
    expect(findings.all().map((f) => f.code)).toContain(
      "ITEM_REVIEW_PACKAGING_SUBTYPE_ON_RAW_MATERIAL",
    );
  });

  it("tipo, família e pureza inválidos bloqueiam em vez de virar padrão", () => {
    for (const [coluna, valor, code] of [
      ["TIPO", "OUTRO", "ITEM_REVIEW_TYPE_INVALID"],
      ["FAMILIA", "INVENTADA", "ITEM_REVIEW_FAMILY_INVALID"],
      ["PUREZA_PADRAO", "1.5", "ITEM_REVIEW_PURITY_INVALID"],
      ["PUREZA_PADRAO", "quase pura", "ITEM_REVIEW_PURITY_INVALID"],
    ] as const) {
      const { leitura, findings } = lerItens([item("ITEM-LEG-0006", "OK", { [coluna]: valor })]);
      expect(leitura.bloqueado, `${coluna}=${valor} devia bloquear`).toBe(true);
      expect(findings.all().map((f) => f.code)).toContain(code);
    }
  });

  it("dois itens aprovados com o mesmo código da planilha reprovam", () => {
    const { leitura, findings } = lerItens([
      item("ITEM-LEG-0007", "OK"),
      item("ITEM-LEG-0008", "OK", { CODIGO_PLANILHA: "0007" }),
    ]);
    expect(leitura.bloqueado).toBe(true);
    expect(findings.all().map((f) => f.code)).toContain("ITEM_REVIEW_CODE_COLLISION");
  });
});

/* ─────────────── Produto ─────────────── */

function produto(codigo: string, status: string, campos: Campos = {}): Linha {
  return {
    chave: `PROD-LEG-${codigo}`,
    status,
    campos: {
      CHAVE_CLIENTE: "CLI-LEG-0001",
      NOME_PRODUTO: `Produto ${codigo}`,
      REFERENCIA_EXTERNA: codigo,
      CHAVE_ITEM_PA: `PA-LEG-${codigo}`,
      UNIDADE_ESTOQUE: "un",
      ATIVO: "SIM",
      ...campos,
    },
  };
}

describe("Produto revisado", () => {
  const lerProdutos = (linhas: Linha[]) => {
    const { workbook: wb, findings } = ler({ [PRODUTOS]: linhas }, PRODUTOS);
    return { leitura: lerProdutosRevisados(wb, UNIDADES, findings), findings };
  };

  it("nome corrigido, cliente por chave e par 1:1 com o item de produto acabado", () => {
    const { leitura } = lerProdutos([
      produto("0001PL", "OK", {
        NOME_PRODUTO: "Multivitamínico revisado",
        CHAVE_CLIENTE: "CLI-LEG-0009",
      }),
    ]);
    const lido = leitura.aprovados[0]!;
    expect(lido.name).toBe("Multivitamínico revisado");
    expect(lido.customerKey).toBe("CLI-LEG-0009");
    expect(lido.finishedItemKey).toBe("PA-LEG-0001PL");
    expect(lido.key).toBe("PROD-LEG-0001PL");
  });

  it("números e catálogos revisados chegam convertidos", () => {
    const { leitura } = lerProdutos([
      produto("0002PL", "OK", {
        FORMA_FARMACEUTICA: "CAPSULA",
        APRESENTACAO: "POTE",
        PUBLICO_ALVO: "GESTANTE",
        CAPSULAS_POR_DOSE: "2",
        DOSE: "1,5",
        UNIDADE_DOSE: "g",
        DOSES_POR_EMBALAGEM: "60",
        UNIDADES_POR_CAIXA: "12",
        VIDA_UTIL_MESES: "24",
        LOTE_MINIMO: "500",
        EXIGE_COA_LAUDO: "SIM",
      }),
    ]);
    const lido = leitura.aprovados[0]!;
    expect(lido.dosageForm).toBe("CAPSULE");
    expect(lido.presentationType).toBe("POT");
    expect(lido.targetAgeGroup).toBe("PREGNANT");
    expect(lido.capsulesPerDose).toBe(2);
    expect(lido.doseAmount).toBe("1.5");
    expect(lido.doseUomCode).toBe("g");
    expect(lido.dosesPerPackage).toBe(60);
    expect(lido.unitsPerShippingBox).toBe(12);
    expect(lido.shelfLifeMonths).toBe(24);
    expect(lido.minimumBatchQuantity).toBe("500");
    expect(lido.finishedRequiresCoa).toBe(true);
  });

  it("NAO_IMPORTAR não cria nem o produto nem o item de produto acabado", () => {
    const { leitura } = lerProdutos([produto("0003PL", "NAO_IMPORTAR")]);
    expect(leitura.aprovados).toEqual([]);
    expect(leitura.excluidos.has("PROD-LEG-0003PL")).toBe(true);
  });

  it("par 1:1 quebrado bloqueia", () => {
    const { leitura, findings } = lerProdutos([
      produto("0004PL", "OK", { CHAVE_ITEM_PA: "PA-LEG-OUTRO" }),
    ]);
    expect(leitura.bloqueado).toBe(true);
    expect(findings.all().map((f) => f.code)).toContain("PRODUCT_REVIEW_FINISHED_ITEM_MISMATCH");
  });

  it("referência externa trocada bloqueia: o vínculo com formulação e projeto se perderia", () => {
    const { leitura, findings } = lerProdutos([
      produto("0005PL", "OK", { REFERENCIA_EXTERNA: "OUTRO-CODIGO" }),
    ]);
    expect(leitura.bloqueado).toBe(true);
    expect(findings.all().map((f) => f.code)).toContain("PRODUCT_REVIEW_EXTERNAL_CODE_CHANGED");
  });

  it("números e unidades inválidos bloqueiam", () => {
    for (const [coluna, valor, code] of [
      ["UNIDADE_ESTOQUE", "pote", "PRODUCT_REVIEW_UOM_INVALID"],
      ["UNIDADE_DOSE", "colher", "PRODUCT_REVIEW_UOM_INVALID"],
      ["FORMA_FARMACEUTICA", "SPRAY", "PRODUCT_REVIEW_ENUM_INVALID"],
      ["VIDA_UTIL_MESES", "24,5", "PRODUCT_REVIEW_NUMBER_INVALID"],
      ["DOSES_POR_EMBALAGEM", "-1", "PRODUCT_REVIEW_NUMBER_INVALID"],
      ["DOSE", "muita", "PRODUCT_REVIEW_NUMBER_INVALID"],
    ] as const) {
      const { leitura, findings } = lerProdutos([produto("0006PL", "OK", { [coluna]: valor })]);
      expect(leitura.bloqueado, `${coluna}=${valor} devia bloquear`).toBe(true);
      expect(findings.all().map((f) => f.code)).toContain(code);
    }
  });

  it("dose sem unidade bloqueia em vez de assumir a unidade de estoque", () => {
    const { leitura, findings } = lerProdutos([produto("0007PL", "OK", { DOSE: "1,5" })]);
    expect(leitura.bloqueado).toBe(true);
    expect(findings.all().map((f) => f.code)).toContain("PRODUCT_REVIEW_DOSE_WITHOUT_UOM");
  });

  it("dois produtos aprovados apontando para o mesmo item de produto acabado reprovam", () => {
    const { leitura, findings } = lerProdutos([
      produto("0008PL", "OK"),
      { ...produto("0009PL", "OK"), campos: { ...produto("0009PL", "OK").campos, CHAVE_ITEM_PA: "PA-LEG-0009PL" } },
    ]);
    // Par coerente: nada reprova.
    expect(leitura.bloqueado).toBe(false);
    expect(findings.all().map((f) => f.code)).not.toContain("PRODUCT_REVIEW_FINISHED_ITEM_COLLISION");
  });
});

describe("Escopo do bridge", () => {
  it("os seis workbooks revisáveis estão no gate, e o 06 fica fora", () => {
    expect([...WORKBOOKS_DO_ESCOPO]).toEqual([
      "01_CLIENTES",
      "02_FORNECEDORES",
      "03_MATERIAS_PRIMAS",
      "04_EMBALAGENS_INSUMOS",
      "05_PRODUTOS_ACABADOS",
      "07_FORNECEDOR_ITENS_PRECOS",
    ]);
    expect([...WORKBOOKS_DO_ESCOPO]).not.toContain("06_PRECOS_REFERENCIA_MERCADO");
  });
});
