import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BR_STATE_CODES } from "../../packages/shared/src/br-states.js";
import { FindingLog } from "../veridi-data/corpus.js";
import { legacyOfferSourceKey } from "../veridi-data/supplier-price-analysis.js";
import {
  ReviewPackageError,
  aprovados,
  bloqueiosDaRevisao,
  campo,
  carimboDoPacote,
  devolucaoArgumento,
  diferencasDoPacote,
  loadReviewPackage,
  naoImportar,
  naoRevisados,
  workbookObrigatorio,
} from "./review-package.js";
import {
  UFS_ACEITAS,
  chaveDaOferta,
  lerFornecedoresRevisados,
  resolverFornecedorDaOferta,
} from "./supplier-review.js";

/**
 * Ponte entre o pacote revisado e o importador (MIGRATION-REVIEW-BRIDGE-01).
 *
 * Tudo aqui roda sobre pacotes SINTÉTICOS escritos numa pasta temporária: os
 * workbooks reais têm dado de cliente e de fornecedor e ficam fora do Git. O
 * que os testes protegem é o contrato — quem entra, quem fica de fora, quem
 * trava a carga, e de qual fornecedor é cada oferta.
 */

const STATUS_REVISAO = ["REVISAR", "OK", "PENDENTE", "NAO_IMPORTAR"];
const FORNECEDORES = "02_FORNECEDORES";
const OFERTAS = "07_FORNECEDOR_ITENS_PRECOS";

const temporarios: string[] = [];

afterAll(() => {
  for (const pasta of temporarios) fs.rmSync(pasta, { recursive: true, force: true });
});

interface LinhaSintetica {
  chave: string;
  status: string;
  campos: Record<string, string | number | null>;
}

function workbookSintetico(
  registros: LinhaSintetica[],
  colunas: string[],
  statusPermitidos: string[] = STATUS_REVISAO,
): Record<string, unknown> {
  const contagem: Record<string, number> = {};
  for (const registro of registros) {
    contagem[registro.status] = (contagem[registro.status] ?? 0) + 1;
  }
  return {
    colunaStatus: "STATUS_REVISAO",
    statusPermitidos,
    colunas: ["CHAVE_MIGRACAO", ...colunas, "STATUS_REVISAO"],
    obrigatorias: ["CHAVE_MIGRACAO", "RAZAO_SOCIAL_NOME", "STATUS_REVISAO"],
    contagem,
    registros,
  };
}

/** Grava um pacote sintético numa pasta temporária e devolve o caminho do JSON. */
function gravarPacote(workbooks: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "veridi-review-"));
  temporarios.push(pasta);
  const destino = path.join(pasta, "pacote-revisao.json");
  const nomes = Object.keys(workbooks);
  fs.writeFileSync(
    destino,
    JSON.stringify({
      formato: 1,
      geradoEm: "2026-09-11T21:00:00",
      pacote: {
        caminho: path.join(pasta, "revisao-99"),
        identidade: "f".repeat(64),
        referencia: null,
        arquivos: nomes.map((nome, indice) => ({
          nome,
          sha256: String(indice).repeat(64).slice(0, 64),
          bytes: 1024,
          modificadoEm: "2026-09-11T20:00:00",
          registros: ((workbooks[nome] as { registros: unknown[] }).registros ?? []).length,
        })),
      },
      validacao: { devolucao: true, erros: 0 },
      workbooks,
      ...extra,
    }),
    "utf8",
  );
  return destino;
}

const COLUNAS_02 = [
  "NOME_PLANILHA", "RAZAO_SOCIAL_NOME", "NOME_FANTASIA", "CNPJ", "EMAIL", "TELEFONE",
  "CEP", "LOGRADOURO", "NUMERO", "COMPLEMENTO", "BAIRRO", "CIDADE", "UF", "NOTAS_INTERNAS", "ATIVO",
];

function fornecedor(
  chave: string,
  status: string,
  campos: Record<string, string | number | null> = {},
): LinhaSintetica {
  return {
    chave,
    status,
    campos: { NOME_PLANILHA: chave, RAZAO_SOCIAL_NOME: chave, ATIVO: "SIM", ...campos },
  };
}

/*
 * Os quatro fornecedores do cenário, sempre os mesmos:
 * A aprovado com endereço · B excluído · C ainda em revisão · D com o nome
 * corrigido à mão pela Veridi (é o caso que o importador antigo descartava).
 */
const SUPPLIER_A = fornecedor("FOR-LEG-ALFA", "OK", {
  RAZAO_SOCIAL_NOME: "Alfa Insumos Nutricionais Ltda",
  CEP: "13010-000",
  LOGRADOURO: "Avenida Francisco Glicério",
  NUMERO: "1200",
  COMPLEMENTO: "Sala 4",
  BAIRRO: "Centro",
  CIDADE: "Campinas",
  UF: "sp",
});
const SUPPLIER_B = fornecedor("FOR-LEG-BETA", "NAO_IMPORTAR");
const SUPPLIER_C = fornecedor("FOR-LEG-GAMA", "REVISAR");
const SUPPLIER_D = fornecedor("FOR-LEG-DELTA", "OK", {
  NOME_PLANILHA: "DELTA",
  RAZAO_SOCIAL_NOME: "Delta Comercio de Insumos Ltda",
  CIDADE: "Londrina",
});

function oferta(chave: string, status: string, chaveFornecedor: string | null): LinhaSintetica {
  return {
    chave,
    status,
    campos: {
      CHAVE_ITEM: "ITEM-LEG-0001",
      CHAVE_FORNECEDOR: chaveFornecedor,
      PRECO: "12,50",
      MOEDA: "BRL",
      UNIDADE_DO_PRECO: "kg",
      HOMOLOGACAO: "HOMOLOGADO",
      PREFERENCIAL: "NÃO",
      RELACAO_ATIVA: "SIM",
    },
  };
}

const COLUNAS_07 = [
  "CHAVE_ITEM", "CHAVE_FORNECEDOR", "PRECO", "MOEDA", "UNIDADE_DO_PRECO",
  "HOMOLOGACAO", "PREFERENCIAL", "RELACAO_ATIVA",
];

function pacotePadrao(extraFornecedores: LinhaSintetica[] = [], extraOfertas: LinhaSintetica[] = []): string {
  return gravarPacote({
    [FORNECEDORES]: workbookSintetico(
      [SUPPLIER_A, SUPPLIER_B, SUPPLIER_C, SUPPLIER_D, ...extraFornecedores],
      COLUNAS_02,
    ),
    [OFERTAS]: workbookSintetico(
      [
        oferta("OFE-LEG-AAAAAAAAAAAA", "OK", "FOR-LEG-ALFA"),
        oferta("OFE-LEG-BBBBBBBBBBBB", "OK", "FOR-LEG-BETA"),
        ...extraOfertas,
      ],
      COLUNAS_07,
    ),
  });
}

describe("Leitura do pacote", () => {
  it("recusa formato desconhecido", () => {
    const caminho = gravarPacote({ [FORNECEDORES]: workbookSintetico([SUPPLIER_A], COLUNAS_02) });
    const bruto = JSON.parse(fs.readFileSync(caminho, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(caminho, JSON.stringify({ ...bruto, formato: 99 }), "utf8");
    expect(() => loadReviewPackage(caminho)).toThrow(ReviewPackageError);
  });

  it("recusa arquivo inexistente e diz como gerar", () => {
    expect(() => loadReviewPackage(path.join(os.tmpdir(), "nao-existe-veridi.json"))).toThrow(
      /validar_pacote\.py/,
    );
  });

  it("recusa CHAVE_MIGRACAO repetida", () => {
    const caminho = gravarPacote({
      [FORNECEDORES]: workbookSintetico([SUPPLIER_A, { ...SUPPLIER_A }], COLUNAS_02),
    });
    expect(() => loadReviewPackage(caminho)).toThrow(/repetida/);
  });

  it("recusa status fora da lista do workbook", () => {
    const caminho = gravarPacote({
      [FORNECEDORES]: workbookSintetico([fornecedor("FOR-LEG-X", "APROVADO")], COLUNAS_02),
    });
    expect(() => loadReviewPackage(caminho)).toThrow(/APROVADO/);
  });

  it("recusa workbook exigido que não veio no pacote", () => {
    const pacote = loadReviewPackage(
      gravarPacote({ [FORNECEDORES]: workbookSintetico([SUPPLIER_A], COLUNAS_02) }),
    );
    expect(() => workbookObrigatorio(pacote, OFERTAS)).toThrow(/07_FORNECEDOR_ITENS_PRECOS/);
  });

  it("indexa por workbook e CHAVE_MIGRACAO, nunca por linha", () => {
    const pacote = loadReviewPackage(pacotePadrao());
    const workbook = workbookObrigatorio(pacote, FORNECEDORES);
    expect(workbook.porChave.get("FOR-LEG-ALFA")?.status).toBe("OK");
    expect(campo(workbook.porChave.get("FOR-LEG-DELTA")!, "RAZAO_SOCIAL_NOME")).toBe(
      "Delta Comercio de Insumos Ltda",
    );
  });

  it("separa o fluxo próprio do 06: ACEITA/REJEITADA não é decisão de carga", () => {
    const pacote = loadReviewPackage(
      gravarPacote({
        "06_PRECOS_REFERENCIA_MERCADO": workbookSintetico(
          [{ chave: "REF-ABCDEF012345", status: "ACEITA", campos: {} }],
          ["PRECO_PUBLICADO"],
          ["REVISAR", "ACEITA", "REJEITADA"],
        ),
      }),
    );
    const workbook = workbookObrigatorio(pacote, "06_PRECOS_REFERENCIA_MERCADO");
    expect(workbook.usaDecisoesDeRevisao).toBe(false);
    expect(naoRevisados(workbook)).toEqual([]);
    expect(bloqueiosDaRevisao(pacote, ["06_PRECOS_REFERENCIA_MERCADO"])).toEqual([]);
  });
});

describe("Regras de status", () => {
  const pacote = loadReviewPackage(pacotePadrao());
  const workbook = workbookObrigatorio(pacote, FORNECEDORES);

  it("OK é o único elegível", () => {
    expect(aprovados(workbook).map((registro) => registro.chave).sort()).toEqual([
      "FOR-LEG-ALFA",
      "FOR-LEG-DELTA",
    ]);
  });

  it("NAO_IMPORTAR fica explicitamente de fora", () => {
    expect([...naoImportar(workbook)]).toEqual(["FOR-LEG-BETA"]);
  });

  it("REVISAR e PENDENTE travam a carga, e o motivo é contado por workbook", () => {
    const comPendente = loadReviewPackage(pacotePadrao([fornecedor("FOR-LEG-EPSILON", "PENDENTE")]));
    const bloqueios = bloqueiosDaRevisao(comPendente, [FORNECEDORES]);
    expect(bloqueios).toHaveLength(1);
    expect(bloqueios[0]).toContain("1 em REVISAR");
    expect(bloqueios[0]).toContain("1 em PENDENTE");
  });

  it("pacote todo decidido não bloqueia", () => {
    const decidido = loadReviewPackage(
      gravarPacote({
        [FORNECEDORES]: workbookSintetico([SUPPLIER_A, SUPPLIER_B, SUPPLIER_D], COLUNAS_02),
      }),
    );
    expect(bloqueiosDaRevisao(decidido, [FORNECEDORES])).toEqual([]);
  });

  it("workbook exigido e ausente bloqueia", () => {
    const semOfertas = loadReviewPackage(
      gravarPacote({ [FORNECEDORES]: workbookSintetico([SUPPLIER_A], COLUNAS_02) }),
    );
    expect(bloqueiosDaRevisao(semOfertas, [FORNECEDORES, OFERTAS])[0]).toContain("ausente");
  });
});

describe("Identidade do pacote", () => {
  it("o APPLY recusa pacote diferente do aprovado no PLAN", () => {
    const carimbo = carimboDoPacote(loadReviewPackage(pacotePadrao()));
    const outro = carimboDoPacote(
      loadReviewPackage(pacotePadrao([fornecedor("FOR-LEG-NOVO", "OK")])),
    );
    expect(diferencasDoPacote(carimbo, carimbo)).toEqual([]);
    expect(diferencasDoPacote(carimbo, outro).join(" ")).toContain("mudou desde o PLAN");
  });

  it("PLAN sem pacote nenhum é recusado", () => {
    const carimbo = carimboDoPacote(loadReviewPackage(pacotePadrao()));
    expect(diferencasDoPacote(null, carimbo)).toEqual(["o PLAN não registrou pacote de revisão nenhum"]);
  });

  it("o carimbo guarda os dois hashes: dos workbooks e do JSON lido", () => {
    const carimbo = carimboDoPacote(loadReviewPackage(pacotePadrao()));
    expect(carimbo.identidade).toHaveLength(64);
    expect(carimbo.sha256Json).toHaveLength(64);
    expect(carimbo.devolucao).toBe(true);
  });
});

describe("Argumento --devolucao", () => {
  it("aceita as duas formas e nunca adivinha a pasta", () => {
    expect(devolucaoArgumento(["node", "apply.ts"])).toBeNull();
    expect(devolucaoArgumento(["node", "apply.ts", "--devolucao=pacote.json"])).toBe("pacote.json");
    expect(devolucaoArgumento(["node", "apply.ts", "--devolucao", "pacote.json"])).toBe("pacote.json");
  });

  it("recusa --devolucao sem caminho", () => {
    expect(() => devolucaoArgumento(["node", "apply.ts", "--devolucao", "--apply"])).toThrow(
      ReviewPackageError,
    );
  });
});

describe("Fornecedor a partir do workbook", () => {
  const ler = (extra: LinhaSintetica[] = []) => {
    const findings = new FindingLog();
    const pacote = loadReviewPackage(pacotePadrao(extra));
    const leitura = lerFornecedoresRevisados(workbookObrigatorio(pacote, FORNECEDORES), findings);
    return { leitura, findings };
  };

  it("usa o nome corrigido no Excel, não o nome bruto do CSV", () => {
    const { leitura } = ler();
    const delta = leitura.aprovados.find((supplier) => supplier.key === "FOR-LEG-DELTA");
    expect(delta?.legalName).toBe("Delta Comercio de Insumos Ltda");
    // O nome da planilha original continua existindo como coluna de conferência,
    // mas não é ele que vai para o banco.
    expect(leitura.aprovados.map((supplier) => supplier.legalName)).not.toContain("DELTA");
  });

  it("aplica o endereço completo e normaliza a UF", () => {
    const { leitura } = ler();
    const alfa = leitura.aprovados.find((supplier) => supplier.key === "FOR-LEG-ALFA")!;
    expect(alfa.zipCode).toBe("13010000");
    expect(alfa.street).toBe("Avenida Francisco Glicério");
    expect(alfa.number).toBe("1200");
    expect(alfa.complement).toBe("Sala 4");
    expect(alfa.district).toBe("Centro");
    expect(alfa.city).toBe("Campinas");
    expect(alfa.state).toBe("SP");
    expect(alfa.temEndereco).toBe(true);
  });

  it("aceita endereço parcial", () => {
    const { leitura } = ler();
    const delta = leitura.aprovados.find((supplier) => supplier.key === "FOR-LEG-DELTA")!;
    expect(delta.city).toBe("Londrina");
    expect(delta.zipCode).toBeNull();
    expect(delta.state).toBeNull();
    expect(delta.temEndereco).toBe(true);
  });

  it("aceita endereço vazio sem bloquear o fornecedor", () => {
    const { leitura, findings } = ler([fornecedor("FOR-LEG-SEM-ENDERECO", "OK")]);
    const semEndereco = leitura.aprovados.find((s) => s.key === "FOR-LEG-SEM-ENDERECO")!;
    expect(semEndereco.temEndereco).toBe(false);
    expect(semEndereco.zipCode).toBeNull();
    expect(leitura.bloqueado).toBe(false);
    expect(findings.all().filter((f) => f.code.startsWith("SUPPLIER_REVIEW_"))).toEqual([]);
  });

  it("não cria nem atualiza fornecedor marcado NAO_IMPORTAR", () => {
    const { leitura } = ler();
    expect(leitura.excluidos.has("FOR-LEG-BETA")).toBe(true);
    expect(leitura.aprovados.map((supplier) => supplier.key)).not.toContain("FOR-LEG-BETA");
  });

  it("registro em REVISAR não entra nem como aprovado nem como excluído", () => {
    const { leitura } = ler();
    expect(leitura.aprovados.map((supplier) => supplier.key)).not.toContain("FOR-LEG-GAMA");
    expect(leitura.excluidos.has("FOR-LEG-GAMA")).toBe(false);
  });

  it("reprova CEP, UF e CNPJ inválidos em vez de corrigir", () => {
    for (const [coluna, valor, code] of [
      ["CEP", "1301", "SUPPLIER_REVIEW_ZIP_INVALID"],
      ["UF", "XX", "SUPPLIER_REVIEW_STATE_INVALID"],
      ["CNPJ", "11222333000182", "SUPPLIER_REVIEW_CNPJ_INVALID"],
    ] as const) {
      const { leitura, findings } = ler([
        fornecedor("FOR-LEG-INVALIDO", "OK", { RAZAO_SOCIAL_NOME: "Invalido Ltda", [coluna]: valor }),
      ]);
      expect(leitura.bloqueado, `${coluna} inválida devia bloquear`).toBe(true);
      expect(findings.all().map((f) => f.code)).toContain(code);
      expect(leitura.aprovados.map((s) => s.key)).not.toContain("FOR-LEG-INVALIDO");
    }
  });

  it("bloqueia quando dois aprovados colidem na razão social", () => {
    const { leitura, findings } = ler([
      fornecedor("FOR-LEG-CLONE", "OK", { RAZAO_SOCIAL_NOME: "Alfa Insumos Nutricionais Ltda" }),
    ]);
    expect(leitura.bloqueado).toBe(true);
    expect(findings.all().map((f) => f.code)).toContain("SUPPLIER_REVIEW_NAME_COLLISION");
  });

  it("bloqueia quando dois nomes diferentes colapsam na normalização", () => {
    const { leitura, findings } = ler([
      fornecedor("FOR-LEG-CLONE", "OK", { RAZAO_SOCIAL_NOME: "ALFA INSUMOS NUTRICIONAIS LTDA." }),
    ]);
    expect(leitura.bloqueado).toBe(true);
    expect(findings.all().map((f) => f.code)).toContain("SUPPLIER_REVIEW_NAME_COLLISION_NORMALIZED");
  });

  it("a lista de UF é a mesma do domínio", () => {
    expect([...UFS_ACEITAS].sort()).toEqual([...BR_STATE_CODES].sort());
  });
});

describe("Relação item × fornecedor resolvida por chave", () => {
  const pacote = loadReviewPackage(pacotePadrao());
  const ofertas = workbookObrigatorio(pacote, OFERTAS);
  const excluidos = new Set(["FOR-LEG-BETA"]);
  const supplierIdByKey = new Map([["FOR-LEG-ALFA", "id-alfa"]]);
  const contexto = { ofertas, excluidos, supplierIdByKey };

  const sourceKeyDe = (chave: string): string => `${chave.replace("OFE-LEG-", "").toLowerCase()}${"0".repeat(20)}`;

  it("resolve pela CHAVE_FORNECEDOR do 07, não pelo nome", () => {
    const destino = resolverFornecedorDaOferta(sourceKeyDe("OFE-LEG-AAAAAAAAAAAA"), contexto);
    expect(destino.situacao).toBe("IMPORTAR");
    if (destino.situacao === "IMPORTAR") expect(destino.supplierId).toBe("id-alfa");
  });

  it("oferta apontando para fornecedor NAO_IMPORTAR vira erro, não associação", () => {
    const destino = resolverFornecedorDaOferta(sourceKeyDe("OFE-LEG-BBBBBBBBBBBB"), contexto);
    expect(destino.situacao).toBe("SEM_FORNECEDOR");
    if (destino.situacao === "SEM_FORNECEDOR") {
      expect(destino.code).toBe("SUPPLIER_ITEM_SUPPLIER_NOT_IMPORTED");
    }
  });

  it("relação órfã bloqueia em vez de casar com nome parecido", () => {
    const comOrfa = loadReviewPackage(
      pacotePadrao([], [oferta("OFE-LEG-CCCCCCCCCCCC", "OK", "FOR-LEG-INEXISTENTE")]),
    );
    const destino = resolverFornecedorDaOferta(sourceKeyDe("OFE-LEG-CCCCCCCCCCCC"), {
      ...contexto,
      ofertas: workbookObrigatorio(comOrfa, OFERTAS),
    });
    expect(destino.situacao).toBe("SEM_FORNECEDOR");
    if (destino.situacao === "SEM_FORNECEDOR") {
      expect(destino.code).toBe("SUPPLIER_ITEM_SUPPLIER_KEY_UNKNOWN");
    }
  });

  it("oferta não aprovada fica fora da carga sem virar erro", () => {
    const comRevisar = loadReviewPackage(
      pacotePadrao([], [oferta("OFE-LEG-DDDDDDDDDDDD", "REVISAR", "FOR-LEG-ALFA")]),
    );
    const destino = resolverFornecedorDaOferta(sourceKeyDe("OFE-LEG-DDDDDDDDDDDD"), {
      ...contexto,
      ofertas: workbookObrigatorio(comRevisar, OFERTAS),
    });
    expect(destino.situacao).toBe("FORA_DA_CARGA");
  });

  it("linha do corpus fora do pacote devolvido reprova", () => {
    const destino = resolverFornecedorDaOferta("ffffffffffff".padEnd(32, "0"), contexto);
    expect(destino.situacao).toBe("FORA_DO_PACOTE");
  });

  it("a chave da oferta é a mesma que o tooling do pacote escreve", () => {
    // `chave_oferta` no Python: 'OFE-LEG-' + sha256(payload)[:12].upper().
    const sourceKey = legacyOfferSourceKey({
      lineNumber: 1,
      itemExternalCode: "0001",
      supplierName: "Alfa Insumos",
      sourceName: null,
      nutrient: null,
      rawPrice: "12,50",
      price: null,
      rawMinimumOrder: null,
      qualified: false,
      bestPriceFlag: false,
    });
    expect(sourceKey).toHaveLength(32);
    expect(chaveDaOferta(sourceKey)).toBe(`OFE-LEG-${sourceKey.slice(0, 12).toUpperCase()}`);
    expect(chaveDaOferta(sourceKey)).toMatch(/^OFE-LEG-[0-9A-F]{12}$/);
  });
});
