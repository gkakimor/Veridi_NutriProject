import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGREGADOS } from "./catalogo-de-exclusao.js";
import type { Linha } from "./filhos-tecnicos.js";
import type { Dono } from "./filhos-tecnicos.js";
import {
  FONTE_DO_HISTORICO_DO_CNPJ,
  FONTE_DO_PRODUTO_ACABADO,
  FONTE_DO_PROJETO_DE_ORIGEM,
  FONTE_DO_TIPO_DO_ITEM,
  REGRAS_DA_V1,
  julgarFilhosTecnicos,
  julgarHistoricoDoCnpj,
  julgarRaiz,
  julgarV1,
} from "./filhos-tecnicos.js";
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

/**
 * CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01: o registro dos dados do CNPJ
 * gravado NA criação do Cliente é filho técnico pela marca estrutural
 * `createdWithCustomerId` — e só por ela.
 */
describe("Cliente — o registro do CNPJ da criação, pela marca estrutural", () => {
  const CLIENTE = AGREGADOS.CUSTOMER;
  const HISTORICO = "customer_cnpj_registration_history";
  const ID = "cliente-1";
  const OUTRO = "cliente-2";
  let sequencia = 0;

  /** Um registro como `to_jsonb` o lê; por padrão, o da criação, marcado. */
  const registro = (extra: Linha = {}): Linha => ({
    id: `h${++sequencia}`,
    customerId: ID,
    createdWithCustomerId: ID,
    kind: "EDIT",
    cnpj: "11222333000181",
    previousCnpj: null,
    consultedAt: null,
    changes: [],
    changedAt: "2026-09-18T10:00:00.000",
    changedByUserId: "u1",
    changedByNameSnapshot: "Fulano",
    ...extra,
  });
  const historico = (...registros: Linha[]) => new Map<string, Linha[]>([[HISTORICO, registros]]);

  it("o histórico é tabela do agregado (sai por CASCADE); a marca em OUTRO Cliente é referência declarada", () => {
    expect(CLIENTE.internas).toEqual([
      { tabela: HISTORICO, coluna: "customerId", pai: "customers", rotulo: "Registro dos dados do CNPJ feito na criação" },
    ]);
    expect(CLIENTE.referencias).toContainEqual(
      expect.objectContaining({ tipo: "id", tabela: HISTORICO, coluna: "createdWithCustomerId", alvo: "customers" }),
    );
    expect(CLIENTE.referencias.some((r) => r.tabela === HISTORICO && r.coluna === "customerId")).toBe(false);
  });

  it("conferirCatalogo: a chave CASCADE do histórico é o vínculo da interna; banco sem a marca ou com outra ação bloqueia", () => {
    const chaves: ChaveReal[] = [
      ...CLIENTE.referencias
        .filter((referencia) => referencia.tipo === "fk")
        .map((referencia) => ({
          tabela: referencia.tabela,
          coluna: referencia.coluna,
          alvo: (referencia as { alvo: string }).alvo,
          acao: (referencia as { acao: string }).acao,
        })),
      { tabela: HISTORICO, coluna: "customerId", alvo: "customers", acao: "c" },
    ];
    const colunas: ColunaReal[] = CLIENTE.referencias.map((r) => ({ tabela: r.tabela, coluna: r.coluna, tipo: "text" }));
    expect(conferirCatalogo(CLIENTE, chaves, colunas)).toEqual([]);

    const semMarca = colunas.filter((coluna) => coluna.coluna !== "createdWithCustomerId");
    expect(conferirCatalogo(CLIENTE, chaves, semMarca).map((problema) => problema.reason)).toEqual([
      "customer_cnpj_registration_history.createdWithCustomerId está no catálogo da exclusão e não existe mais no banco.",
    ]);
    const restrita = chaves.map((chave) => (chave.tabela === HISTORICO ? { ...chave, acao: "r" } : chave));
    expect(conferirCatalogo(CLIENTE, restrita, colunas).map((problema) => problema.reason)).toEqual([
      "customer_cnpj_registration_history.customerId → customers é RESTRICT no banco e CASCADE no catálogo.",
    ]);
  });

  it("sem histórico nenhum, nada a julgar", () => {
    expect(julgarFilhosTecnicos("CUSTOMER", ID, new Map())).toEqual([]);
    expect(julgarFilhosTecnicos("CUSTOMER", ID, historico())).toEqual([]);
  });

  it("o registro marcado com o PRÓPRIO Cliente é filho técnico — qualquer que seja o tipo do evento", () => {
    for (const kind of ["EDIT", "CONSULTATION"]) {
      expect(julgarFilhosTecnicos("CUSTOMER", ID, historico(registro({ kind })))).toEqual([]);
    }
  });

  it("registro sem a marca (legado ou alteração) bloqueia, sozinho ou ao lado do técnico", () => {
    for (const kind of ["EDIT", "CONSULTATION", "CNPJ_CHANGED"]) {
      const [sozinho] = julgarHistoricoDoCnpj(ID, historico(registro({ kind, createdWithCustomerId: null })));
      expect(sozinho).toMatchObject({ source: FONTE_DO_HISTORICO_DO_CNPJ, count: 1 });
      expect(sozinho!.reason).toContain("sem a marca da criação");
    }
    const comTecnico = julgarHistoricoDoCnpj(ID, historico(registro(), registro({ createdWithCustomerId: null })));
    expect(comTecnico).toEqual([expect.objectContaining({ source: FONTE_DO_HISTORICO_DO_CNPJ, count: 1 })]);
  });

  it("marca de OUTRO Cliente (registro movido pelo saneamento) bloqueia — não é técnico de quem o recebeu", () => {
    const [movido] = julgarHistoricoDoCnpj(ID, historico(registro({ createdWithCustomerId: OUTRO })));
    expect(movido).toMatchObject({ source: FONTE_DO_HISTORICO_DO_CNPJ, count: 1 });
    expect(movido!.reason).toContain("criação de outro cliente");
    // Ao lado do próprio técnico, também.
    expect(julgarHistoricoDoCnpj(ID, historico(registro(), registro({ createdWithCustomerId: OUTRO })))).toEqual([
      expect.objectContaining({ count: 1 }),
    ]);
  });

  it("dois registros marcados como da criação bloqueiam: a criação grava um só", () => {
    const [dobro] = julgarHistoricoDoCnpj(ID, historico(registro(), registro()));
    expect(dobro).toMatchObject({ source: FONTE_DO_HISTORICO_DO_CNPJ, count: 2 });
    expect(dobro!.reason).toContain("a criação grava um só");
  });

  it("linha sem a coluna da marca (catálogo à frente do banco) bloqueia", () => {
    const semColuna = Object.fromEntries(
      Object.entries(registro()).filter(([coluna]) => coluna !== "createdWithCustomerId"),
    );
    expect(julgarHistoricoDoCnpj(ID, historico(semColuna))).toEqual([
      expect.objectContaining({ source: FONTE_DO_HISTORICO_DO_CNPJ, count: 1 }),
    ]);
  });

  it("nenhuma heurística: hora, ordem, menor id e tipo não mudam nada — só a marca decide", () => {
    // O sem marca vem PRIMEIRO, com o MENOR id e a MESMA hora da criação; o
    // marcado vem depois, anos mais tarde, com id maior.
    const falsoPrimeiro = registro({ id: "a0", createdWithCustomerId: null, changedAt: "2026-09-18T10:00:00.000" });
    const marcadoTardio = registro({ id: "z9", kind: "CONSULTATION", changedAt: "2031-01-01T00:00:00.000" });
    expect(julgarHistoricoDoCnpj(ID, historico(falsoPrimeiro))).toHaveLength(1);
    expect(julgarHistoricoDoCnpj(ID, historico(marcadoTardio))).toEqual([]);
    expect(julgarHistoricoDoCnpj(ID, historico(marcadoTardio, falsoPrimeiro))).toEqual(
      julgarHistoricoDoCnpj(ID, historico(falsoPrimeiro, marcadoTardio)),
    );

    // E no código: o juiz só lê `customerId` e `createdWithCustomerId` da linha.
    const fonte = readFileSync(new URL("./filhos-tecnicos.ts", import.meta.url), "utf8");
    const corpo = fonte.slice(
      fonte.indexOf("export function julgarHistoricoDoCnpj"),
      fonte.indexOf("export function julgarFilhosTecnicos"),
    );
    expect(corpo.length).toBeGreaterThan(0);
    expect(new Set([...corpo.matchAll(/registro\["(\w+)"\]/g)].map((m) => m[1]))).toEqual(
      new Set(["customerId", "createdWithCustomerId"]),
    );
    expect(corpo).not.toMatch(/changedAt|createdAt|xmin|\.sort\(|new Date|Date\.|\bkind\b/);
  });

  it("efeito esperado com o registro técnico: o Cliente, UM registro do histórico e o rastro — CASCADE a mais desfaz tudo", () => {
    const esperado = efeitoEsperado(CLIENTE, historico(registro()));
    expect(Object.fromEntries(esperado)).toEqual({
      customers: { ins: 0, upd: 0, del: 1 },
      customer_cnpj_registration_history: { ins: 0, upd: 0, del: 1 },
      master_data_deletion_history: { ins: 1, upd: 0, del: 0 },
    });
    const depois = new Map([
      ["customers", { ins: 0, upd: 0, del: 1 }],
      ["customer_cnpj_registration_history", { ins: 0, upd: 0, del: 2 }],
      ["master_data_deletion_history", { ins: 1, upd: 0, del: 0 }],
    ]);
    expect(efeitoInesperado(new Map(), depois, esperado)).toEqual({
      customer_cnpj_registration_history: { ins: 0, upd: 0, del: 2 },
    });
    // Sem histórico, o esperado é só o Cliente e o rastro.
    expect(Object.fromEntries(efeitoEsperado(CLIENTE, historico()))).toEqual({
      customers: { ins: 0, upd: 0, del: 1 },
      master_data_deletion_history: { ins: 1, upd: 0, del: 0 },
    });
  });

  it("o retrato leva o registro técnico só como tabela e quantidade, nunca o conteúdo", () => {
    const raiz: Linha = { id: ID, code: "CLI-000001", legalName: "ACME LTDA", cnpj: "11222333000181", active: true };
    const retrato = retratoDaExclusao("CUSTOMER", raiz, historico(registro({ changes: [{ field: "legalNature" }] })));
    expect(retrato.removidosJunto).toEqual([{ tabela: HISTORICO, linhas: 1 }]);
    expect(JSON.stringify(retrato)).not.toContain("legalNature");
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

/**
 * MASTER-DATA-HARD-DELETE-02: Item, Produto + o Item de produto acabado (PA)
 * que sai com ele, e Recurso industrial — as peças puras.
 */
describe("Fatia 2 — regras da raiz", () => {
  const DONO: Dono = { tabela: "products", coluna: "finishedProductItemId", id: "prod-1" };

  it("PA nunca sai sozinho — ligado a produto ou não", () => {
    const [bloqueio] = julgarRaiz("ITEM", { id: "i1", type: "FINISHED_PRODUCT" }, null);
    expect(bloqueio).toMatchObject({ source: FONTE_DO_PRODUTO_ACABADO, count: 1 });
    expect(bloqueio!.reason).toContain("nunca sozinho");
  });

  it("PA como vinculado do Produto (com dono) não bloqueia por ser PA", () => {
    expect(julgarRaiz("ITEM", { id: "i1", type: "FINISHED_PRODUCT" }, DONO)).toEqual([]);
  });

  it("item ligado ao Produto que não é PA não sai junto", () => {
    const [bloqueio] = julgarRaiz("ITEM", { id: "i1", type: "RAW_MATERIAL" }, DONO);
    expect(bloqueio).toMatchObject({ source: FONTE_DO_TIPO_DO_ITEM, count: 1 });
    expect(bloqueio!.reason).toContain("não é de produto acabado");
  });

  it("MP, ME e Uso e consumo sozinhos: a raiz não bloqueia", () => {
    for (const type of ["RAW_MATERIAL", "PACKAGING", "INTERNAL_CONSUMABLE"]) {
      expect(julgarRaiz("ITEM", { id: "i1", type }, null), type).toEqual([]);
    }
  });

  it("Produto nascido de Projeto é histórico do projeto; sem origem, a raiz não bloqueia", () => {
    expect(julgarRaiz("PRODUCT", { id: "p1", originProjectId: "proj-1" }, null)).toEqual([
      expect.objectContaining({ source: FONTE_DO_PROJETO_DE_ORIGEM, count: 1 }),
    ]);
    expect(julgarRaiz("PRODUCT", { id: "p1", originProjectId: null }, null)).toEqual([]);
    expect(julgarRaiz("INDUSTRIAL_RESOURCE", { id: "r1" }, null)).toEqual([]);
  });
});

describe("Fatia 2 — o vínculo Produto → PA", () => {
  const PRODUTO = AGREGADOS.PRODUCT;
  const chavesDoProduto = (): ChaveReal[] => [
    ...PRODUTO.referencias
      .filter((referencia) => referencia.tipo === "fk")
      .map((referencia) => ({
        tabela: referencia.tabela,
        coluna: referencia.coluna,
        alvo: (referencia as { alvo: string }).alvo,
        acao: (referencia as { acao: string }).acao,
      })),
    { tabela: "products", coluna: "finishedProductItemId", alvo: "items", acao: "n" },
  ];
  const colunas: ColunaReal[] = PRODUTO.referencias.map((r) => ({ tabela: r.tabela, coluna: r.coluna, tipo: "text" }));

  it("chave do vínculo presente e SET NULL: nada bloqueia", () => {
    expect(conferirCatalogo(PRODUTO, chavesDoProduto(), colunas)).toEqual([]);
  });

  it("chave do vínculo sumiu ou mudou de ação: bloqueia — a prova do PA é a chave", () => {
    const semVinculo = chavesDoProduto().filter((chave) => chave.coluna !== "finishedProductItemId");
    expect(conferirCatalogo(PRODUTO, semVinculo, colunas).map((p) => p.reason)).toEqual([
      "products.finishedProductItemId → items está no catálogo da exclusão e não existe mais no banco.",
    ]);
    const emCascata = chavesDoProduto().map((chave) =>
      chave.coluna === "finishedProductItemId" ? { ...chave, acao: "c" } : chave,
    );
    expect(conferirCatalogo(PRODUTO, emCascata, colunas).map((p) => p.reason)).toEqual([
      "products.finishedProductItemId → items é CASCADE no banco e SET NULL no catálogo.",
    ]);
  });

  it("efeito esperado: o Produto, o PA e o rastro — mais nada", () => {
    const esperado = efeitoEsperado(PRODUTO, new Map(), [{ agregado: AGREGADOS.ITEM, internos: new Map() }]);
    expect(Object.fromEntries(esperado)).toEqual({
      products: { ins: 0, upd: 0, del: 1 },
      items: { ins: 0, upd: 0, del: 1 },
      master_data_deletion_history: { ins: 1, upd: 0, del: 0 },
    });
    // Produto sem PA: só ele e o rastro.
    expect(Object.fromEntries(efeitoEsperado(PRODUTO, new Map()))).toEqual({
      products: { ins: 0, upd: 0, del: 1 },
      master_data_deletion_history: { ins: 1, upd: 0, del: 0 },
    });
    // Um movimento de estoque levado pelo CASCADE do PA é efeito inesperado.
    const depois = new Map([
      ["products", { ins: 0, upd: 0, del: 1 }],
      ["items", { ins: 0, upd: 0, del: 1 }],
      ["inventory_movements", { ins: 0, upd: 0, del: 1 }],
      ["master_data_deletion_history", { ins: 1, upd: 0, del: 0 }],
    ]);
    expect(efeitoInesperado(new Map(), depois, esperado)).toEqual({ inventory_movements: { ins: 0, upd: 0, del: 1 } });
  });

  it("o retrato do Produto leva a identidade do PA pela lista branca do Item — e o que saiu junto", () => {
    const produto: Linha = {
      id: "p1",
      code: "PROD-000001",
      name: "PRODUTO POR ENGANO",
      lifecycle: "APPROVED",
      active: true,
      notes: "observação que não vai",
      externalCode: null,
      createdAt: "2026-09-19T10:00:00.000",
    };
    const pa: Linha = {
      id: "i1",
      code: "PA-000001",
      name: "PRODUTO POR ENGANO",
      type: "FINISHED_PRODUCT",
      unitCode: "un",
      family: null,
      active: true,
      externalCode: null,
      sourceName: "fonte que não vai",
      createdAt: "2026-09-19T10:00:00.000",
    };
    const retrato = retratoDaExclusao("PRODUCT", produto, new Map(), [
      { tipo: "ITEM", tabela: "items", raiz: pa, internos: new Map() },
    ]);
    expect(retrato).toEqual({
      formato: 1,
      cadastro: {
        code: "PROD-000001",
        name: "PRODUTO POR ENGANO",
        lifecycle: "APPROVED",
        active: true,
        externalCode: null,
        createdAt: "2026-09-19T10:00:00.000",
      },
      vinculados: [
        {
          tipo: "ITEM",
          cadastro: {
            code: "PA-000001",
            name: "PRODUTO POR ENGANO",
            type: "FINISHED_PRODUCT",
            unitCode: "un",
            family: null,
            active: true,
            externalCode: null,
            createdAt: "2026-09-19T10:00:00.000",
          },
        },
      ],
      removidosJunto: [{ tabela: "items", linhas: 1 }],
    });
    expect(JSON.stringify(retrato)).not.toMatch(/observação|fonte que não vai/);
  });
});
