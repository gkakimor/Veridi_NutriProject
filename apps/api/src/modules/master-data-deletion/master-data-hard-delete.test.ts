import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CostTemplateDTO,
  CustomerDTO,
  FormulationTemplateDTO,
  MasterDataDeletionCheckDTO,
  MasterDataDeletionResultDTO,
  MasterDataEntityType,
  PricingPolicyDTO,
  ProductionProfileDTO,
  SupplierDTO,
} from "@veridi/shared";
import {
  MASTER_DATA_DELETE_ABORTED_ERROR,
  MASTER_DATA_DELETION_PATHS,
  MASTER_DATA_ENTITY_TYPES,
  MASTER_DATA_IN_USE_ERROR,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { uniqueCnpj } from "../../test-support/br-documents.js";

/**
 * MASTER-DATA-HARD-DELETE-01 — exclusão física segura de cadastro mestre
 * (D1, D2, D3 e D6 do MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01).
 *
 * Tudo aqui roda sobre FIXTURES SINTÉTICAS que este arquivo cria no banco de
 * TESTE — nenhum cadastro real é excluído (adendo do PO). O que está sob
 * teste:
 *
 *  1. só o Administrador consulta e exclui — 403 antes do corpo e da existência;
 *  2. a prévia diz se pode e por quê, fonte por fonte, sem gravar nada;
 *  3. qualquer uso bloqueia: RESTRICT, CASCADE, SET NULL, id sem chave, código
 *     copiado, JSON, histórico, proveniência — e a V1 já trabalhada;
 *  4. sem uso, sai o agregado inteiro (a V1 técnica junto), com rastro
 *     append-only e retrato mínimo; motivo é obrigatório; o nome fica livre;
 *  5. a transação trava, reconta e confere o efeito real: clique duplo é 404,
 *     OC gravada no meio bloqueia, e efeito fora do agregado desfaz tudo.
 */

type App = ReturnType<typeof buildTestApp>;
const admin: App = buildTestApp("ADMIN");
const SEM_PERMISSAO = ["PRODUCTION", "QUALITY", "PURCHASING", "COMMERCIAL", "VIEWER"] as const;
const semPermissao = new Map(SEM_PERMISSAO.map((role) => [role, buildTestApp(role)]));

const marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let contador = 0;
const proximo = () => `${marca}-${++contador}`;

const criados = {
  fornecedores: [] as string[],
  clientes: [] as string[],
  modelosDeFormulacao: [] as string[],
  modelosDeCusto: [] as string[],
  politicas: [] as string[],
  roteiros: [] as string[],
  produtos: [] as string[],
  ordens: [] as string[],
  ordensDeCompra: [] as string[],
  contagens: [] as string[],
};

beforeAll(async () => {
  await admin.ready();
  for (const app of semPermissao.values()) await app.ready();
  await getPrisma().unitOfMeasure.upsert({
    where: { code: "un" },
    update: {},
    create: { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  });
});

afterAll(async () => {
  const prisma = getPrisma();
  const todos = Object.values(criados).flat();
  // O rastro é append-only para o sistema; o teste tira o que as SUAS fixtures
  // deixaram, para o usuário de teste (autor, RESTRICT) poder sair também.
  await prisma.masterDataDeletionHistory.deleteMany({ where: { entityId: { in: todos } } });
  await prisma.productionOrderPlanningSnapshot.deleteMany({ where: { productionOrderId: { in: criados.ordens } } });
  await prisma.productionOrder.deleteMany({ where: { id: { in: criados.ordens } } });
  await prisma.stockCount.deleteMany({ where: { id: { in: criados.contagens } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: criados.ordensDeCompra } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.productionProfile.deleteMany({ where: { id: { in: criados.roteiros } } });
  await prisma.formulationTemplate.deleteMany({ where: { id: { in: criados.modelosDeFormulacao } } });
  await prisma.industrialCostTemplate.deleteMany({ where: { id: { in: criados.modelosDeCusto } } });
  await prisma.pricingPolicyTemplate.deleteMany({ where: { id: { in: criados.politicas } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  await admin.close();
  for (const app of semPermissao.values()) await app.close();
});

// ─────────────────────────────────────────────────────────────── rotas

const caminho = (tipo: MasterDataEntityType, id: string) => `${MASTER_DATA_DELETION_PATHS[tipo]}/${id}`;

const consultar = (app: App, tipo: MasterDataEntityType, id: string) =>
  app.inject({ method: "GET", url: `${caminho(tipo, id)}/deletion-check` });

const MOTIVO = "Cadastro criado por engano no teste";

/** DELETE sem corpo nenhum — nem `{}`, nem content-type. */
const SEM_CORPO = Symbol("sem corpo");

const excluir = (
  app: App,
  tipo: MasterDataEntityType,
  id: string,
  corpo: object | typeof SEM_CORPO = { reason: MOTIVO },
) => app.inject({ method: "DELETE", url: caminho(tipo, id), ...(corpo === SEM_CORPO ? {} : { payload: corpo }) });

async function previa(tipo: MasterDataEntityType, id: string): Promise<MasterDataDeletionCheckDTO> {
  const resposta = await consultar(admin, tipo, id);
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as MasterDataDeletionCheckDTO;
}

async function excluido(tipo: MasterDataEntityType, id: string): Promise<MasterDataDeletionResultDTO> {
  const resposta = await excluir(admin, tipo, id);
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as MasterDataDeletionResultDTO;
}

/** O 409 de uso: devolve as fontes que a resposta listou. */
async function recusado(tipo: MasterDataEntityType, id: string): Promise<string[]> {
  const resposta = await excluir(admin, tipo, id);
  expect(resposta.statusCode, resposta.body).toBe(409);
  const corpo = resposta.json() as { error: string; references: { source: string }[] };
  expect(corpo.error).toBe(MASTER_DATA_IN_USE_ERROR);
  return corpo.references.map((referencia) => referencia.source);
}

// ─────────────────────────────────────────────────────────────── fixtures

async function fornecedor(extra: Record<string, unknown> = {}): Promise<SupplierDTO> {
  const resposta = await admin.inject({
    method: "POST",
    url: "/suppliers",
    payload: { legalName: `Fornecedor Fixture HD ${proximo()}`, ...extra },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const criado = resposta.json() as SupplierDTO;
  criados.fornecedores.push(criado.id);
  return criado;
}

async function cliente(extra: Record<string, unknown> = {}): Promise<CustomerDTO> {
  const resposta = await admin.inject({
    method: "POST",
    url: "/customers",
    payload: { legalName: `Cliente Fixture HD ${proximo()}`, ...extra },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const criado = resposta.json() as CustomerDTO;
  criados.clientes.push(criado.id);
  return criado;
}

async function criarPor<T extends { id: string }>(url: string, lista: string[], nome: string, extra = {}): Promise<T> {
  const resposta = await admin.inject({ method: "POST", url, payload: { name: nome, ...extra } });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const criado = resposta.json() as T;
  lista.push(criado.id);
  return criado;
}

const modeloDeFormulacao = () =>
  criarPor<FormulationTemplateDTO>("/formulation-templates", criados.modelosDeFormulacao, `Modelo Fixture HD ${proximo()}`);
const modeloDeCusto = () =>
  criarPor<CostTemplateDTO>("/cost-templates", criados.modelosDeCusto, `Custo Fixture HD ${proximo()}`);
const politica = () =>
  criarPor<PricingPolicyDTO>("/pricing-policies", criados.politicas, `Política Fixture HD ${proximo()}`);
const roteiro = () =>
  criarPor<ProductionProfileDTO>("/production-profiles", criados.roteiros, `Roteiro Fixture HD ${proximo()}`, {
    referenceQuantity: "1000",
    referenceUomCode: "un",
  });

async function produto(extra: Record<string, unknown> = {}) {
  const criado = await getPrisma().product.create({
    data: { code: `PROD-HD-${proximo()}`, name: `Produto Fixture HD ${proximo()}`, ...extra },
  });
  criados.produtos.push(criado.id);
  return criado;
}

async function ordemDeProducao(extra: Record<string, unknown> = {}) {
  const base = await produto();
  const criada = await getPrisma().productionOrder.create({
    data: { code: `OP-HD-${proximo()}`, productId: base.id, plannedQuantity: "10", outputUnitCode: "un", ...extra },
  });
  criados.ordens.push(criada.id);
  return criada;
}

async function ordemDeCompra(supplier: { id: string; code: string; legalName: string }) {
  const criada = await getPrisma().purchaseOrder.create({
    data: {
      code: `OC-HD-${proximo()}`,
      supplierId: supplier.id,
      supplierCode: supplier.code,
      supplierName: supplier.legalName,
      orderDate: new Date(),
    },
  });
  criados.ordensDeCompra.push(criada.id);
  return criada;
}

const TODOS: readonly MasterDataEntityType[] = MASTER_DATA_ENTITY_TYPES;

// ─────────────────────────────────────────────────────────────── D1

describe("D1 — só o Administrador", () => {
  it.each(SEM_PERMISSAO)("%s: 403 na prévia e na exclusão, antes do corpo e da existência", async (role) => {
    const app = semPermissao.get(role)!;
    const real = await fornecedor();
    for (const tipo of TODOS) {
      for (const id of [real.id, randomUUID()]) {
        const check = await consultar(app, tipo, id);
        expect(check.statusCode, `${role} ${tipo} check`).toBe(403);
        expect(check.json()).toMatchObject({ error: "forbidden" });
        // Sem corpo nenhum: o 403 vem antes do 400 do motivo e do 404.
        const semCorpo = await excluir(app, tipo, id, SEM_CORPO);
        expect(semCorpo.statusCode, `${role} ${tipo} delete`).toBe(403);
      }
    }
    // Nada mudou: o fornecedor real segue lá e o rastro não recebeu nada.
    expect(await getPrisma().supplier.count({ where: { id: real.id } })).toBe(1);
    expect(await getPrisma().masterDataDeletionHistory.count({ where: { entityId: real.id } })).toBe(0);
  });

  it("Administrador: cadastro inexistente é 404 na prévia e na exclusão", async () => {
    for (const tipo of TODOS) {
      expect((await consultar(admin, tipo, randomUUID())).statusCode).toBe(404);
      expect((await excluir(admin, tipo, randomUUID())).statusCode).toBe(404);
    }
  });
});

// ─────────────────────────────────────────────────────────────── prévia

describe("prévia — deletion-check", () => {
  it("sem uso: pode excluir, sem razão nenhuma, e a saída normal é Inativar", async () => {
    const criado = await fornecedor();
    expect(await previa("SUPPLIER", criado.id)).toEqual({
      entityType: "SUPPLIER",
      entityId: criado.id,
      entityCode: criado.code,
      entityName: criado.legalName,
      canDelete: true,
      references: [],
      removedTogether: [],
      alternative: "INACTIVATE",
      alternativeAvailable: true,
    });
  });

  it("não grava nada: roda em transação somente leitura", async () => {
    const criado = await fornecedor();
    const antes = await getPrisma().supplier.findUniqueOrThrow({ where: { id: criado.id } });
    await previa("SUPPLIER", criado.id);
    await previa("SUPPLIER", criado.id);
    expect(await getPrisma().supplier.findUniqueOrThrow({ where: { id: criado.id } })).toEqual(antes);
    expect(await getPrisma().masterDataDeletionHistory.count({ where: { entityId: criado.id } })).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────── D2: o que bloqueia

describe("D2 — qualquer uso bloqueia", () => {
  it("Fornecedor com OC: RESTRICT bloqueia, com a fonte, e a exclusão é 409", async () => {
    const criado = await fornecedor();
    await ordemDeCompra(criado);
    const check = await previa("SUPPLIER", criado.id);
    expect(check.canDelete).toBe(false);
    expect(check.removedTogether).toEqual([]);
    expect(check.references).toContainEqual({
      source: "Ordens de compra",
      count: 1,
      reason: "O fornecedor já foi usado em ordem de compra.",
    });
    expect(await recusado("SUPPLIER", criado.id)).toContain("Ordens de compra");
    expect(await getPrisma().supplier.count({ where: { id: criado.id } })).toBe(1);
    expect(await getPrisma().masterDataDeletionHistory.count({ where: { entityId: criado.id } })).toBe(0);
  });

  it("Cliente com histórico de situação: CASCADE conta e bloqueia — a saída é Inativar", async () => {
    const criado = await cliente();
    const bloqueio = await admin.inject({
      method: "POST",
      url: `/customers/${criado.id}/block`,
      payload: { reason: "Teste de histórico" },
    });
    expect(bloqueio.statusCode, bloqueio.body).toBe(200);
    const check = await previa("CUSTOMER", criado.id);
    expect(check.canDelete).toBe(false);
    expect(check.references.map((r) => r.source)).toContain("Histórico de situação");
    expect(check).toMatchObject({ alternative: "INACTIVATE", alternativeAvailable: true });
    await recusado("CUSTOMER", criado.id);
    expect(await getPrisma().customerStatusHistory.count({ where: { customerId: criado.id } })).toBe(1);
  });

  it("Cliente dono de produto private label: SET NULL conta e bloqueia", async () => {
    const criado = await cliente();
    await produto({ customerId: criado.id });
    expect(await recusado("CUSTOMER", criado.id)).toContain("Produtos private label");
    // Nada foi desligado: o produto continua apontando para o cliente.
    expect(await getPrisma().product.count({ where: { customerId: criado.id } })).toBe(1);
  });

  it("código copiado sem chave bloqueia: OP que só guarda o código do cliente", async () => {
    const criado = await cliente();
    await ordemDeProducao({ customerCode: criado.code });
    const check = await previa("CUSTOMER", criado.id);
    expect(check.references).toContainEqual({
      source: "Ordens de produção (cópia do cliente)",
      count: 1,
      reason: "Documento guarda o código deste cliente.",
    });
  });

  it("nome copiado sem código bloqueia: cálculo de custo que só guarda o nome", async () => {
    const criado = await cliente({ tradeName: `Fantasia HD ${proximo()}` });
    const outro = await cliente();
    await ordemDeProducao({ customerId: outro.id, customerName: criado.tradeName });
    const check = await previa("CUSTOMER", criado.id);
    expect(check.references.map((r) => r.source)).toContain("Ordens de produção (cópia do cliente)");
    expect(check.canDelete).toBe(false);
  });

  it("JSON bloqueia: escopo de contagem de estoque que cita o cliente", async () => {
    const criado = await cliente();
    const contagem = await getPrisma().stockCount.create({
      data: {
        code: `INV-HD-${proximo()}`,
        kind: "SESSION",
        mode: "BLIND",
        status: "CANCELLED",
        referenceAt: new Date(),
        createdByName: "Fixture HD",
        scopeFilters: { balance: "ANY", owner: "CUSTOMER", customerId: criado.id },
      },
    });
    criados.contagens.push(contagem.id);
    const check = await previa("CUSTOMER", criado.id);
    expect(check.references).toContainEqual({
      source: "Inventário físico (escopo da contagem)",
      count: 1,
      reason: "Dado gravado em JSON cita este cadastro.",
    });
  });

  it("id sem chave estrangeira bloqueia: roteiro copiado para OP (só o id do perfil)", async () => {
    const perfil = await roteiro();
    const op = await ordemDeProducao();
    await getPrisma().productionOrderPlanningSnapshot.create({
      data: {
        productionOrderId: op.id,
        sourceProfileId: perfil.id,
        // Versão e código de OUTRO roteiro: o que sobra é só o id sem chave.
        sourceProfileCode: `PPR-OUTRO-${proximo()}`,
        sourceProfileName: "Outro roteiro",
        sourceVersionId: randomUUID(),
        sourceVersionNumber: 1,
        referenceQuantity: "1000",
        referenceUomCode: "un",
        steps: [],
      },
    });
    const check = await previa("PRODUCTION_PROFILE", perfil.id);
    expect(check.references).toEqual([
      {
        source: "Roteiros copiados para ordens de produção",
        count: 1,
        reason: "O roteiro já foi copiado para ordem de produção.",
      },
    ]);
    expect(await recusado("PRODUCTION_PROFILE", perfil.id)).toEqual(["Roteiros copiados para ordens de produção"]);
  });

  it("referência à VERSÃO bloqueia: roteiro padrão de produto (RESTRICT na V1)", async () => {
    const perfil = await roteiro();
    await produto({ defaultProductionProfileVersionId: perfil.draftVersion!.id });
    const check = await previa("PRODUCTION_PROFILE", perfil.id);
    expect(check.references.map((r) => r.source)).toEqual(["Produtos com este roteiro como padrão"]);
    expect(check).toMatchObject({ alternative: "ARCHIVE", alternativeAvailable: true });
  });

});

// ─────────────────────────────────────────────────────────────── filhos técnicos

const CNPJ_VAZIO = {
  mainCnaeCode: null,
  mainCnaeDescription: null,
  legalNature: null,
  companySize: null,
  openedAt: null,
  establishmentType: null,
  simplesOptIn: null,
  meiOptIn: null,
  registrationStatus: null,
  registrationStatusDate: null,
};

function blocoDoCnpj(cnpj: string, extra: Record<string, unknown> = {}) {
  return { cnpj, ...CNPJ_VAZIO, ...extra };
}

describe("filhos técnicos — a V1 como a criação a deixou", () => {
  const VERSIONADOS = [
    ["FORMULATION_TEMPLATE", modeloDeFormulacao, "formulation_template_versions"],
    ["INDUSTRIAL_COST_TEMPLATE", modeloDeCusto, "industrial_cost_template_versions"],
    ["PRICING_POLICY_TEMPLATE", politica, "pricing_policy_template_versions"],
    ["PRODUCTION_PROFILE", roteiro, "production_profile_versions"],
  ] as const;

  it.each(VERSIONADOS)("%s com a V1 técnica vazia: pode, e a V1 sai junto", async (tipo, criar, tabela) => {
    const criado = await criar();
    const check = await previa(tipo, criado.id);
    expect(check.canDelete, JSON.stringify(check.references)).toBe(true);
    expect(check.removedTogether).toHaveLength(1);
    expect(check.removedTogether[0]!.count).toBe(1);
    expect(check).toMatchObject({ alternative: "ARCHIVE", alternativeAvailable: true });

    const resultado = await excluido(tipo, criado.id);
    expect(resultado).toMatchObject({ entityType: tipo, entityId: criado.id, entityCode: criado.code });
    const [linhas] = await getPrisma().$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${tabela}" WHERE id = $1`,
      criado.draftVersion!.id,
    );
    expect(linhas!.n).toBe(0);
  });

  it("V1 com conteúdo lançado (observações) bloqueia", async () => {
    const criado = await modeloDeFormulacao();
    const salvo = await admin.inject({
      method: "PATCH",
      url: `/formulation-template-versions/${criado.draftVersion!.id}`,
      payload: { notes: "Rascunho começado" },
    });
    expect(salvo.statusCode, salvo.body).toBe(200);
    const check = await previa("FORMULATION_TEMPLATE", criado.id);
    expect(check.canDelete).toBe(false);
    expect(check.references).toEqual([
      expect.objectContaining({ source: "Versão V1", reason: expect.stringContaining("observações") }),
    ]);
    await recusado("FORMULATION_TEMPLATE", criado.id);
  });

  it("V1 com faixa lançada bloqueia", async () => {
    const criado = await politica();
    await getPrisma().pricingPolicyTemplateTier.create({
      data: {
        pricingPolicyTemplateVersionId: criado.draftVersion!.id,
        quantity: "100",
        uomCode: "un",
        targetContributionMarginPercent: "30",
      },
    });
    const check = await previa("PRICING_POLICY_TEMPLATE", criado.id);
    expect(check.references).toEqual([
      expect.objectContaining({ source: "Versão V1", reason: "A V1 tem 1 faixa(s) lançado(s)." }),
    ]);
  });

  it("V1 com etapa lançada bloqueia", async () => {
    const criado = await roteiro();
    await getPrisma().productionProfileStep.create({
      data: {
        productionProfileVersionId: criado.draftVersion!.id,
        sequence: 1,
        name: "Mistura",
        runDurationMinutes: 30,
      },
    });
    const check = await previa("PRODUCTION_PROFILE", criado.id);
    expect(check.references.map((r) => r.reason)).toEqual(["A V1 tem 1 etapa(s) lançado(s)."]);
  });

  it("V1 já ativada, ou versão além da V1, bloqueia", async () => {
    const ativado = await modeloDeCusto();
    await getPrisma().industrialCostTemplateVersion.update({
      where: { id: ativado.draftVersion!.id },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedBy: "Fixture HD" },
    });
    const checkAtivado = await previa("INDUSTRIAL_COST_TEMPLATE", ativado.id);
    expect(checkAtivado.canDelete).toBe(false);
    expect(checkAtivado.references[0]!.reason).toMatch(/ACTIVE/);

    const comV2 = await modeloDeCusto();
    await getPrisma().industrialCostTemplateVersion.create({
      data: {
        industrialCostTemplateId: comV2.id,
        versionNumber: 2,
        referenceOutputQuantity: "1000",
        referenceOutputUomCode: "un",
      },
    });
    const checkV2 = await previa("INDUSTRIAL_COST_TEMPLATE", comV2.id);
    expect(checkV2.references).toEqual([
      expect.objectContaining({ source: "Versões", count: 2 }),
    ]);
  });

  it("modelo arquivado e nunca usado pode sair; a saída Arquivar já não está disponível", async () => {
    const criado = await modeloDeFormulacao();
    const arquivado = await admin.inject({
      method: "POST",
      url: `/formulation-templates/${criado.id}/archive`,
      payload: { archived: true },
    });
    expect(arquivado.statusCode, arquivado.body).toBe(200);
    const check = await previa("FORMULATION_TEMPLATE", criado.id);
    expect(check).toMatchObject({ canDelete: true, alternativeAvailable: false });
  });

});

// ─────────────────────────────────────────────────────────────── Cliente × histórico do CNPJ

/**
 * Decisão do PO (2026-09-18): o registro dos dados do CNPJ nascido NA criação
 * do Cliente é filho técnico; registro posterior é uso real. Só sai junto com
 * prova ESTRUTURAL de nascimento — "primeiro evento", hora parecida ou
 * `updatedAt` = `createdAt` não provam —, e o modelo atual não tem essa
 * prova: o evento não guarda marca nenhuma da criação. Até ela existir, todo
 * registro bloqueia, e nenhum sai em silêncio.
 */
describe("Cliente e o histórico dos dados do CNPJ", () => {
  const FONTE = "Histórico dos dados cadastrais do CNPJ";
  const CONSULTA = "2026-09-17T12:30:00.000Z";

  const eventos = (customerId: string) =>
    getPrisma().customerCnpjRegistrationHistory.findMany({
      where: { customerId },
      orderBy: { changedAt: "asc" },
      select: { id: true, kind: true },
    });

  async function alterado(id: string, payload: Record<string, unknown>): Promise<void> {
    const resposta = await admin.inject({ method: "PATCH", url: `/customers/${id}`, payload });
    expect(resposta.statusCode, resposta.body).toBe(200);
  }

  /** Bloqueado: a razão na prévia, 409 na exclusão, e NADA apagado — Cliente, registros e rastro. */
  async function confereBloqueado(customerId: string, registros: number): Promise<void> {
    const check = await previa("CUSTOMER", customerId);
    expect(check.canDelete).toBe(false);
    expect(check.removedTogether).toEqual([]);
    expect(check.references).toEqual([expect.objectContaining({ source: FONTE, count: registros })]);
    const antes = await eventos(customerId);
    expect(await recusado("CUSTOMER", customerId)).toEqual([FONTE]);
    expect(await getPrisma().customer.count({ where: { id: customerId } })).toBe(1);
    expect(await eventos(customerId)).toEqual(antes);
    expect(await getPrisma().masterDataDeletionHistory.count({ where: { entityId: customerId } })).toBe(0);
  }

  it("recém-criado SEM histórico do CNPJ: pode, sai só o Cliente, e o rastro fica", async () => {
    const criado = await cliente({ cnpj: uniqueCnpj() });
    expect(await eventos(criado.id)).toEqual([]);

    const check = await previa("CUSTOMER", criado.id);
    expect(check).toMatchObject({ canDelete: true, references: [], removedTogether: [] });
    const resultado = await excluido("CUSTOMER", criado.id);

    expect(await getPrisma().customer.count({ where: { id: criado.id } })).toBe(0);
    const rastro = await getPrisma().masterDataDeletionHistory.findMany({ where: { entityId: criado.id } });
    expect(rastro).toEqual([
      expect.objectContaining({ id: resultado.historyId, entityType: "CUSTOMER", entityCode: criado.code, reason: MOTIVO }),
    ]);
  });

  it.each([
    ["digitado à mão", (cnpj: string) => blocoDoCnpj(cnpj, { legalNature: "Sociedade Limitada" })],
    [
      "aplicado do OpenCNPJ antes do primeiro Salvar",
      (cnpj: string) =>
        blocoDoCnpj(cnpj, { legalNature: "Sociedade Limitada", consultedAt: CONSULTA, sources: { legalNature: "OPEN_CNPJ" } }),
    ],
  ])("registro gravado na criação (%s): sem prova estrutural de nascimento, bloqueia — e nada sai", async (_caso, bloco) => {
    const cnpj = uniqueCnpj();
    const criado = await cliente({ cnpj, cnpjRegistration: bloco(cnpj) });
    expect((await eventos(criado.id)).map((evento) => evento.kind)).toEqual(["EDIT"]);
    await confereBloqueado(criado.id, 1);
  });

  it("registro da criação + EDIT posterior: bloqueia, com os dois registros", async () => {
    const cnpj = uniqueCnpj();
    const criado = await cliente({ cnpj, cnpjRegistration: blocoDoCnpj(cnpj, { legalNature: "Sociedade Limitada" }) });
    await alterado(criado.id, { cnpjRegistration: blocoDoCnpj(cnpj, { legalNature: "Sociedade Anônima" }) });
    expect((await eventos(criado.id)).map((evento) => evento.kind)).toEqual(["EDIT", "EDIT"]);
    await confereBloqueado(criado.id, 2);
  });

  it("registro da criação + CONSULTATION posterior: bloqueia", async () => {
    const cnpj = uniqueCnpj();
    const criado = await cliente({ cnpj, cnpjRegistration: blocoDoCnpj(cnpj, { legalNature: "Sociedade Limitada" }) });
    await alterado(criado.id, {
      cnpjRegistration: blocoDoCnpj(cnpj, { legalNature: "Sociedade Limitada", consultedAt: CONSULTA }),
    });
    expect((await eventos(criado.id)).map((evento) => evento.kind)).toEqual(["EDIT", "CONSULTATION"]);
    await confereBloqueado(criado.id, 2);
  });

  it("CNPJ trocado (CNPJ_CHANGED): bloqueia", async () => {
    const cnpj = uniqueCnpj();
    const criado = await cliente({ cnpj, cnpjRegistration: blocoDoCnpj(cnpj, { legalNature: "Sociedade Limitada" }) });
    await alterado(criado.id, { cnpj: uniqueCnpj() });
    expect((await eventos(criado.id)).map((evento) => evento.kind)).toEqual(["EDIT", "CNPJ_CHANGED"]);
    await confereBloqueado(criado.id, 2);
  });
});

// ─────────────────────────────────────────────────────────────── exclusão

describe("exclusão — rastro, motivo, retrato e nome", () => {
  it.each([
    ["sem corpo", SEM_CORPO],
    ["corpo vazio", {}],
    ["motivo vazio", { reason: "" }],
    ["só espaços", { reason: "   " }],
    ["motivo que não é texto", { reason: 42 }],
  ] as const)("%s: 400 com a frase, e nada sai", async (_caso, corpo) => {
    const criado = await fornecedor();
    const resposta = await excluir(admin, "SUPPLIER", criado.id, corpo);
    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toMatchObject({ error: "validation_error" });
    expect(JSON.stringify(resposta.json())).toContain("Informe o motivo da exclusão.");
    expect(await getPrisma().supplier.count({ where: { id: criado.id } })).toBe(1);
  });

  it("sem uso: sai, com UMA linha de rastro — quem, quando, por quê — e retrato só da lista branca", async () => {
    const criado = await fornecedor({
      tradeName: "Fantasia Fixture",
      cnpj: uniqueCnpj(),
      email: "contato-fixture@example.com",
      phone: "11999998888",
      street: "Rua Fixture",
      number: "10",
      city: "São Paulo",
      state: "SP",
      notes: "Observação que não pode ir para o rastro",
    });
    const antes = Date.now();
    const resultado = await excluido("SUPPLIER", criado.id);

    expect(await getPrisma().supplier.count({ where: { id: criado.id } })).toBe(0);
    const rastro = await getPrisma().masterDataDeletionHistory.findMany({ where: { entityId: criado.id } });
    expect(rastro).toHaveLength(1);
    const [linha] = rastro;
    expect(linha).toMatchObject({
      id: resultado.historyId,
      entityType: "SUPPLIER",
      entityCode: criado.code,
      entityName: criado.legalName,
      reason: MOTIVO,
      deletedByUserName: "Usuário de Teste ADMIN",
    });
    expect(linha!.deletedAt.getTime()).toBeGreaterThanOrEqual(antes - 1000);

    const retrato = linha!.snapshot as { cadastro: Record<string, unknown>; removidosJunto: unknown[] };
    // jsonb guarda as chaves na ordem dele: o conjunto é o que importa.
    expect(Object.keys(retrato.cadastro).sort()).toEqual(
      ["code", "legalName", "tradeName", "cnpj", "active", "createdAt"].sort(),
    );
    expect(retrato.removidosJunto).toEqual([]);
    const texto = JSON.stringify(linha!.snapshot);
    for (const proibido of ["contato-fixture@example.com", "11999998888", "Rua Fixture", "Observação que não pode"]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it("o retrato do modelo leva a V1 técnica e o que saiu junto — sem descrição nem observação", async () => {
    const criado = await criarPor<PricingPolicyDTO>(
      "/pricing-policies",
      criados.politicas,
      `Política Fixture HD ${proximo()}`,
      { description: "Descrição livre que não vai para o rastro" },
    );
    await excluido("PRICING_POLICY_TEMPLATE", criado.id);
    const [linha] = await getPrisma().masterDataDeletionHistory.findMany({ where: { entityId: criado.id } });
    expect(linha!.snapshot).toMatchObject({
      formato: 1,
      cadastro: { code: criado.code, name: criado.name },
      versaoTecnica: { versionNumber: 1, status: "DRAFT" },
      removidosJunto: [{ tabela: "pricing_policy_template_versions", linhas: 1 }],
    });
    expect(JSON.stringify(linha!.snapshot)).not.toContain("Descrição livre");
  });

  it("depois da exclusão o nome fica livre para cadastrar de novo", async () => {
    const criado = await fornecedor();
    const repetido = await admin.inject({ method: "POST", url: "/suppliers", payload: { legalName: criado.legalName } });
    expect(repetido.statusCode).toBe(409);
    await excluido("SUPPLIER", criado.id);
    const denovo = await admin.inject({ method: "POST", url: "/suppliers", payload: { legalName: criado.legalName } });
    expect(denovo.statusCode, denovo.body).toBe(201);
    criados.fornecedores.push((denovo.json() as SupplierDTO).id);

    const modelo = await modeloDeFormulacao();
    await excluido("FORMULATION_TEMPLATE", modelo.id);
    const novoModelo = await admin.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: { name: modelo.name },
    });
    expect(novoModelo.statusCode, novoModelo.body).toBe(201);
    criados.modelosDeFormulacao.push((novoModelo.json() as FormulationTemplateDTO).id);
  });

  it("segunda exclusão é 404 e não grava outro rastro", async () => {
    const criado = await fornecedor();
    await excluido("SUPPLIER", criado.id);
    expect((await excluir(admin, "SUPPLIER", criado.id)).statusCode).toBe(404);
    expect((await consultar(admin, "SUPPLIER", criado.id)).statusCode).toBe(404);
    expect(await getPrisma().masterDataDeletionHistory.count({ where: { entityId: criado.id } })).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────── transação

/** Espera um pedido parar na trava: poll no `pg_stat_activity`. */
async function esperarTrava(padrao: string, minimo = 1): Promise<void> {
  const limite = Date.now() + 8_000;
  while (Date.now() < limite) {
    const [linha] = await getPrisma().$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE ${padrao}
        AND pid <> pg_backend_pid()`;
    if ((linha?.n ?? 0) >= minimo) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`nenhum pedido parou na trava (${padrao})`);
}

describe("transação — trava, recontagem e efeito real", () => {
  it("clique duplo: dois DELETE ao mesmo tempo — um exclui, o outro é 404", async () => {
    const criado = await fornecedor();
    const respostas = await Promise.all([excluir(admin, "SUPPLIER", criado.id), excluir(admin, "SUPPLIER", criado.id)]);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    expect(await getPrisma().masterDataDeletionHistory.count({ where: { entityId: criado.id } })).toBe(1);
  });

  it("Fornecedor × OC nova: a OC gravada durante a exclusão faz a recontagem sob trava recusar", async () => {
    const criado = await fornecedor();
    let soltar!: () => void;
    const segurando = new Promise<void>((resolve) => (soltar = resolve));
    let avisarAberta!: () => void;
    const aberta = new Promise<void>((resolve) => (avisarAberta = resolve));

    // A OC nasce numa transação que ainda não confirmou: o INSERT segura o
    // fornecedor em FOR KEY SHARE, e a exclusão (FOR UPDATE) espera por ela.
    const transacaoDaOc = getPrisma().$transaction(
      async (tx) => {
        const oc = await tx.purchaseOrder.create({
          data: {
            code: `OC-HD-${proximo()}`,
            supplierId: criado.id,
            supplierCode: criado.code,
            supplierName: criado.legalName,
            orderDate: new Date(),
          },
        });
        criados.ordensDeCompra.push(oc.id);
        avisarAberta();
        await segurando;
      },
      { timeout: 30_000 },
    );
    await aberta;

    const exclusao = excluir(admin, "SUPPLIER", criado.id);
    await esperarTrava("%FROM \"suppliers\"%FOR UPDATE%");
    soltar();
    await transacaoDaOc;

    const resposta = await exclusao;
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect((resposta.json() as { references: { source: string }[] }).references.map((r) => r.source)).toContain(
      "Ordens de compra",
    );
    expect(await getPrisma().supplier.count({ where: { id: criado.id } })).toBe(1);
    expect(await getPrisma().masterDataDeletionHistory.count({ where: { entityId: criado.id } })).toBe(0);
  });

  /**
   * Um gatilho AFTER DELETE que o catálogo não vê escreve fora do agregado. Só
   * dispara para o registro alvo (WHEN): vizinhos da suíte que apagam a mesma
   * tabela não o acionam.
   */
  async function comGatilhoFora(
    tabelaDoAlvo: "suppliers" | "customers",
    alvoId: string,
    escritaFora: string,
    corpo: () => Promise<void>,
  ): Promise<void> {
    const prisma = getPrisma();
    const funcao = `hd_efeito_inesperado_${tabelaDoAlvo}_${marca.replace(/[^a-z0-9]/g, "")}`;
    const gatilho = `${funcao}_trg`;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${funcao}"() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         ${escritaFora};
         RETURN OLD;
       END $$`,
    );
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${gatilho}" AFTER DELETE ON ${tabelaDoAlvo} FOR EACH ROW
         WHEN (OLD.id = '${alvoId}') EXECUTE FUNCTION "${funcao}"()`,
      );
      await corpo();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${gatilho}" ON ${tabelaDoAlvo}`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${funcao}"()`);
    }
  }

  async function abortada(tipo: MasterDataEntityType, id: string, tabelaFora: string): Promise<void> {
    const resposta = await excluir(admin, tipo, id);
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect(resposta.json()).toMatchObject({ error: MASTER_DATA_DELETE_ABORTED_ERROR });
    expect((resposta.json() as { message: string }).message).toContain(tabelaFora);
  }

  it("efeito fora do agregado (gatilho que o catálogo não vê) desfaz tudo: nada sai, nada fica no rastro", async () => {
    const alvo = await fornecedor();
    const testemunha = await cliente();
    const prisma = getPrisma();
    await comGatilhoFora(
      "suppliers",
      alvo.id,
      `UPDATE customers SET notes = 'tocado pelo gatilho' WHERE id = '${testemunha.id}'`,
      () => abortada("SUPPLIER", alvo.id, "customers"),
    );
    expect(await prisma.supplier.count({ where: { id: alvo.id } })).toBe(1);
    expect(await prisma.masterDataDeletionHistory.count({ where: { entityId: alvo.id } })).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: testemunha.id } })).notes).toBeNull();

    // Sem o gatilho, o mesmo fornecedor sai normalmente.
    await excluido("SUPPLIER", alvo.id);
  });

  it("no Cliente também: efeito fora do agregado desfaz a exclusão (pg_stat segue fechado)", async () => {
    const alvo = await cliente({ cnpj: uniqueCnpj() });
    const testemunha = await fornecedor();
    const prisma = getPrisma();
    await comGatilhoFora(
      "customers",
      alvo.id,
      `UPDATE suppliers SET notes = 'tocado pelo gatilho' WHERE id = '${testemunha.id}'`,
      () => abortada("CUSTOMER", alvo.id, "suppliers"),
    );
    expect(await prisma.customer.count({ where: { id: alvo.id } })).toBe(1);
    expect(await prisma.masterDataDeletionHistory.count({ where: { entityId: alvo.id } })).toBe(0);
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: testemunha.id } })).notes).toBeNull();

    await excluido("CUSTOMER", alvo.id);
  });
});
