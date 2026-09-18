import { describe, expect, it } from "vitest";
import { AGREGADOS } from "./catalogo-de-exclusao.js";
import type { Linha } from "./filhos-tecnicos.js";
import { REGRAS_DA_V1, julgarFilhosTecnicos, julgarV1 } from "./filhos-tecnicos.js";
import type { ChaveReal, ColunaReal } from "./master-data-deletion.service.js";
import { agruparPorFonte, conferirCatalogo, efeitoEsperado, efeitoInesperado } from "./master-data-deletion.service.js";
import { retratoDaExclusao } from "./retrato-da-exclusao.js";

/**
 * As peças puras da exclusão física (MASTER-DATA-HARD-DELETE-01): a
 * conferência do catálogo contra o banco (falha fechada), o julgamento dos
 * filhos técnicos, a conta do efeito real e o retrato por lista branca.
 */

const FORNECEDOR = AGREGADOS.SUPPLIER;

/** As chaves que o banco tem hoje para o Fornecedor, como o `pg_constraint` as descreve. */
const CHAVES_DO_FORNECEDOR: ChaveReal[] = FORNECEDOR.referencias
  .filter((referencia) => referencia.tipo === "fk")
  .map((referencia) => ({
    tabela: referencia.tabela,
    coluna: referencia.coluna,
    alvo: (referencia as { alvo: string }).alvo,
    acao: (referencia as { acao: string }).acao,
  }));

const COLUNAS_DO_FORNECEDOR: ColunaReal[] = FORNECEDOR.referencias.map((referencia) => ({
  tabela: referencia.tabela,
  coluna: referencia.coluna,
  tipo: "text",
}));

describe("conferirCatalogo — falha fechada", () => {
  it("catálogo e banco iguais: nada bloqueia", () => {
    expect(conferirCatalogo(FORNECEDOR, CHAVES_DO_FORNECEDOR, COLUNAS_DO_FORNECEDOR)).toEqual([]);
  });

  it("chave nova para o agregado, fora do catálogo, bloqueia com o nome dela", () => {
    const nova = { tabela: "supplier_contracts", coluna: "supplierId", alvo: "suppliers", acao: "c" };
    expect(conferirCatalogo(FORNECEDOR, [...CHAVES_DO_FORNECEDOR, nova], COLUNAS_DO_FORNECEDOR)).toEqual([
      {
        source: "Referência não catalogada",
        count: 1,
        reason:
          "supplier_contracts.supplierId → suppliers (CASCADE) aponta para este cadastro e não está no catálogo da exclusão. A exclusão fica bloqueada até o catálogo ser revisto.",
      },
    ]);
  });

  it("chave que mudou de ação bloqueia — RESTRICT virou CASCADE", () => {
    const trocadas = CHAVES_DO_FORNECEDOR.map((chave) =>
      chave.tabela === "purchase_orders" ? { ...chave, acao: "c" } : chave,
    );
    expect(conferirCatalogo(FORNECEDOR, trocadas, COLUNAS_DO_FORNECEDOR)).toEqual([
      expect.objectContaining({
        source: "Catálogo da exclusão desatualizado",
        reason: "purchase_orders.supplierId → suppliers é CASCADE no banco e RESTRICT no catálogo.",
      }),
    ]);
  });

  it("chave ou coluna do catálogo que o banco não tem mais bloqueia", () => {
    const semLotes = CHAVES_DO_FORNECEDOR.filter((chave) => chave.tabela !== "lots");
    const semCopia = COLUNAS_DO_FORNECEDOR.filter((coluna) => coluna.coluna !== "supplierCode");
    expect(conferirCatalogo(FORNECEDOR, semLotes, semCopia).map((problema) => problema.reason)).toEqual([
      "lots.supplierId → suppliers está no catálogo da exclusão e não existe mais no banco.",
      "purchase_orders.supplierCode está no catálogo da exclusão e não existe mais no banco.",
    ]);
  });

  it("chave para outra tabela, fora do agregado, não é da conta dele", () => {
    const alheia = { tabela: "lots", coluna: "itemId", alvo: "items", acao: "r" };
    expect(conferirCatalogo(FORNECEDOR, [...CHAVES_DO_FORNECEDOR, alheia], COLUNAS_DO_FORNECEDOR)).toEqual([]);
  });
});

const REGRA_DO_ROTEIRO = REGRAS_DA_V1.PRODUCTION_PROFILE!;

/** A V1 como `createProductionProfile` a grava. */
function v1DoRoteiro(extra: Linha = {}): Linha {
  return {
    id: "v1",
    productionProfileId: "p1",
    versionNumber: 1,
    status: "DRAFT",
    referenceQuantity: 1000,
    referenceUomCode: "un",
    notes: null,
    createdAt: "2026-09-18T10:00:00.000",
    createdBy: "Fulano",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    archivedBy: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    ...extra,
  };
}

const internosDo = (versoes: Linha[], etapas: Linha[] = []) =>
  new Map<string, Linha[]>([
    ["production_profile_versions", versoes],
    ["production_profile_steps", etapas],
    ["production_profile_step_resources", []],
  ]);

describe("julgarV1 — a V1 como a criação a deixou", () => {
  it("vazia, em rascunho, com a base da criação: filho técnico", () => {
    expect(julgarV1(REGRA_DO_ROTEIRO, internosDo([v1DoRoteiro({ referenceQuantity: 500 })]))).toEqual([]);
  });

  it("sem versão nenhuma, ou com mais de uma, bloqueia", () => {
    expect(julgarV1(REGRA_DO_ROTEIRO, internosDo([]))).toEqual([expect.objectContaining({ source: "Versões", count: 0 })]);
    expect(julgarV1(REGRA_DO_ROTEIRO, internosDo([v1DoRoteiro(), v1DoRoteiro({ id: "v2", versionNumber: 2 })]))).toEqual([
      expect.objectContaining({ source: "Versões", count: 2 }),
    ]);
  });

  it("ativada, com observação ou com etapa: rascunho trabalhado bloqueia", () => {
    const [ativa] = julgarV1(REGRA_DO_ROTEIRO, internosDo([v1DoRoteiro({ status: "ACTIVE", activatedAt: "x" })]));
    expect(ativa!.reason).toContain("ACTIVE");
    expect(julgarV1(REGRA_DO_ROTEIRO, internosDo([v1DoRoteiro({ notes: "algo" })]))[0]!.reason).toContain("observações");
    expect(julgarV1(REGRA_DO_ROTEIRO, internosDo([v1DoRoteiro()], [{ id: "e1" }]))[0]!.reason).toBe(
      "A V1 tem 1 etapa(s) lançado(s).",
    );
  });

  it("coluna nova na versão, que ninguém classificou, bloqueia — não se presume vazia", () => {
    const [problema] = julgarV1(REGRA_DO_ROTEIRO, internosDo([v1DoRoteiro({ setupPolicy: null })]));
    expect(problema!.reason).toContain("setupPolicy");
  });

  it("política: perfil tributário marcado é conteúdo lançado", () => {
    const regra = REGRAS_DA_V1.PRICING_POLICY_TEMPLATE!;
    const v1: Linha = { id: "v1", pricingPolicyTemplateId: "t1", versionNumber: 1, status: "DRAFT", createdAt: "x", createdBy: null };
    for (const [coluna, padrao] of Object.entries(regra.padroes)) v1[coluna] = padrao;
    const internos = new Map<string, Linha[]>([
      ["pricing_policy_template_versions", [v1]],
      ["pricing_policy_template_tiers", []],
    ]);
    expect(julgarV1(regra, internos)).toEqual([]);
    v1["applicableTaxProfiles"] = ["SIMPLES_NACIONAL"];
    expect(julgarV1(regra, internos)[0]!.reason).toContain("perfis tributários indicados");
  });
});

describe("Cliente — o registro do CNPJ, sem prova estrutural de nascimento", () => {
  const CLIENTE = AGREGADOS.CUSTOMER;

  it("é referência do catálogo (CASCADE), nunca linha interna: nenhum registro sai junto", () => {
    expect(CLIENTE.internas).toEqual([]);
    expect(CLIENTE.referencias).toContainEqual(
      expect.objectContaining({
        tipo: "fk",
        tabela: "customer_cnpj_registration_history",
        coluna: "customerId",
        alvo: "customers",
        acao: "c",
        fonte: "Histórico dos dados cadastrais do CNPJ",
      }),
    );
    expect(julgarFilhosTecnicos("CUSTOMER", new Map())).toEqual([]);
  });

  it("o efeito esperado do Cliente é só ele e o rastro — um CASCADE no histórico do CNPJ desfaz tudo", () => {
    const esperado = efeitoEsperado(CLIENTE, new Map());
    expect(Object.fromEntries(esperado)).toEqual({
      customers: { ins: 0, upd: 0, del: 1 },
      master_data_deletion_history: { ins: 1, upd: 0, del: 0 },
    });
    const depois = new Map([
      ["customers", { ins: 0, upd: 0, del: 1 }],
      ["customer_cnpj_registration_history", { ins: 0, upd: 0, del: 1 }],
      ["master_data_deletion_history", { ins: 1, upd: 0, del: 0 }],
    ]);
    expect(efeitoInesperado(new Map(), depois, esperado)).toEqual({
      customer_cnpj_registration_history: { ins: 0, upd: 0, del: 1 },
    });
  });
});

describe("efeito real × esperado", () => {
  const internos = new Map<string, Linha[]>([
    ["formulation_template_versions", [{ id: "v1" }]],
    ["formulation_template_components", []],
  ]);
  const esperado = efeitoEsperado(AGREGADOS.FORMULATION_TEMPLATE, internos);

  it("raiz e V1 saem, uma linha entra no rastro — e só isso", () => {
    expect(Object.fromEntries(esperado)).toEqual({
      formulation_templates: { ins: 0, upd: 0, del: 1 },
      formulation_template_versions: { ins: 0, upd: 0, del: 1 },
      master_data_deletion_history: { ins: 1, upd: 0, del: 0 },
    });
  });

  it("contadores de transações anteriores da conexão não contam: vale a diferença", () => {
    const antes = new Map([["items", { ins: 3, upd: 0, del: 1 }]]);
    const depois = new Map([
      ["items", { ins: 3, upd: 0, del: 1 }],
      ["formulation_templates", { ins: 0, upd: 0, del: 1 }],
      ["formulation_template_versions", { ins: 0, upd: 0, del: 1 }],
      ["master_data_deletion_history", { ins: 1, upd: 0, del: 0 }],
    ]);
    expect(efeitoInesperado(antes, depois, esperado)).toEqual({});
  });

  it("SET NULL disparado fora do agregado aparece, e o que faltou também", () => {
    const depois = new Map([
      ["formulation_templates", { ins: 0, upd: 0, del: 1 }],
      ["formulation_versions", { ins: 0, upd: 1, del: 0 }],
      ["master_data_deletion_history", { ins: 1, upd: 0, del: 0 }],
    ]);
    expect(efeitoInesperado(new Map(), depois, esperado)).toEqual({
      formulation_template_versions: { ins: 0, upd: 0, del: 0 },
      formulation_versions: { ins: 0, upd: 1, del: 0 },
    });
  });
});

describe("agruparPorFonte e retrato", () => {
  it("id, código e nome no mesmo documento viram uma linha, com as razões juntas", () => {
    expect(
      agruparPorFonte([
        { source: "Ordens de produção", count: 1, reason: "Guarda o id." },
        { source: "Ordens de produção", count: 2, reason: "Guarda o código." },
        { source: "Ordens de produção", count: 2, reason: "Guarda o código." },
        { source: "Projetos", count: 1, reason: "Tem projeto." },
      ]),
    ).toEqual([
      { source: "Ordens de produção", count: 2, reason: "Guarda o id. Guarda o código." },
      { source: "Projetos", count: 1, reason: "Tem projeto." },
    ]);
  });

  it("o retrato leva só a lista branca, mesmo que a linha traga contato e observação", () => {
    const raiz: Linha = {
      id: "s1",
      code: "FOR-000001",
      legalName: "ACME LTDA",
      tradeName: null,
      cnpj: "11222333000181",
      email: "compras@acme.com",
      phone: "11999990000",
      street: "Rua X",
      notes: "segredo",
      active: false,
      createdAt: "2026-09-18T10:00:00.000",
      updatedAt: "2026-09-18T11:00:00.000",
    };
    expect(retratoDaExclusao("SUPPLIER", raiz, new Map())).toEqual({
      formato: 1,
      cadastro: {
        code: "FOR-000001",
        legalName: "ACME LTDA",
        tradeName: null,
        cnpj: "11222333000181",
        active: false,
        createdAt: "2026-09-18T10:00:00.000",
      },
      removidosJunto: [],
    });
  });
});
