import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import type {
  CostTemplateDTO,
  CustomerDTO,
  FormulationTemplateDTO,
  IndustrialResourceDetailDTO,
  ItemDTO,
  MasterDataDeletionCheckDTO,
  MasterDataDeletionResultDTO,
  MasterDataEntityType,
  ProductDTO,
  ProductionProfileDTO,
  SupplierDTO,
} from "@veridi/shared";
import { MASTER_DATA_DELETE_ABORTED_ERROR, MASTER_DATA_DELETION_PATHS, MASTER_DATA_IN_USE_ERROR } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";

/**
 * MASTER-DATA-HARD-DELETE-02 — exclusão física de Item, Produto + Item de
 * produto acabado (PA) e Recurso industrial, sobre a infraestrutura da Fatia 1
 * (D1, D2 e D6 do MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01).
 *
 * Tudo roda sobre FIXTURES SINTÉTICAS criadas por este arquivo no banco de
 * TESTE — nenhum cadastro real é excluído. Permissão (403 antes do corpo e da
 * existência) e 404 dos nove cadastros já são cobertos pelo teste da Fatia 1,
 * que percorre `MASTER_DATA_ENTITY_TYPES` inteiro. Aqui:
 *
 *  1. Item: sem uso sai; estoque, movimento sem lote (CASCADE do ledger),
 *     fornecedor, formulação, referência de custo, consumo interno e estorno,
 *     inventário, código copiado e JSON bloqueiam; PA nunca sai sozinho;
 *  2. Produto: sem uso sai COM o PA (um rastro, o PA no retrato); qualquer uso
 *     do PA bloqueia o Produto e nada sai — o PA nunca fica órfão;
 *  3. Recurso: sem uso sai; tarifa, roteiro, energia de modelo e a cópia do
 *     roteiro na OP (JSON) bloqueiam;
 *  4. transação: referência criada durante a exclusão faz a recontagem sob
 *     trava recusar; efeito fora do agregado (inclusive no PA) desfaz tudo.
 */

type App = ReturnType<typeof buildTestApp>;
const admin: App = buildTestApp("ADMIN");

const marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let contador = 0;
const proximo = () => `${marca}-${++contador}`;

const criados = {
  itens: [] as string[],
  produtos: [] as string[],
  recursos: [] as string[],
  clientes: [] as string[],
  fornecedores: [] as string[],
  roteiros: [] as string[],
  modelosDeFormulacao: [] as string[],
  modelosDeCusto: [] as string[],
  ordens: [] as string[],
  contagens: [] as string[],
  lotes: [] as string[],
  consumos: [] as string[],
};

beforeAll(async () => {
  await admin.ready();
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
  await prisma.internalConsumptionReversal.deleteMany({ where: { originalConsumptionId: { in: criados.consumos } } });
  await prisma.internalConsumption.deleteMany({ where: { id: { in: criados.consumos } } });
  await prisma.productionOrderPlanningSnapshot.deleteMany({ where: { productionOrderId: { in: criados.ordens } } });
  await prisma.productionOrder.deleteMany({ where: { id: { in: criados.ordens } } });
  await prisma.stockCount.deleteMany({ where: { id: { in: criados.contagens } } });
  await prisma.supplierItem.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.formulationTemplate.deleteMany({ where: { id: { in: criados.modelosDeFormulacao } } });
  await prisma.industrialCostTemplate.deleteMany({ where: { id: { in: criados.modelosDeCusto } } });
  await prisma.productionProfile.deleteMany({ where: { id: { in: criados.roteiros } } });
  await prisma.formulationComponent.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.formulationVersion.deleteMany({ where: { productId: { in: criados.produtos } } });
  await prisma.lot.deleteMany({ where: { id: { in: criados.lotes } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.industrialResource.deleteMany({ where: { id: { in: criados.recursos } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  await admin.close();
});

// ─────────────────────────────────────────────────────────────── rotas

const caminho = (tipo: MasterDataEntityType, id: string) => `${MASTER_DATA_DELETION_PATHS[tipo]}/${id}`;
const MOTIVO = "Cadastro criado por engano no teste";

const excluir = (tipo: MasterDataEntityType, id: string) =>
  admin.inject({ method: "DELETE", url: caminho(tipo, id), payload: { reason: MOTIVO } });

async function previa(tipo: MasterDataEntityType, id: string): Promise<MasterDataDeletionCheckDTO> {
  const resposta = await admin.inject({ method: "GET", url: `${caminho(tipo, id)}/deletion-check` });
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as MasterDataDeletionCheckDTO;
}

async function excluido(tipo: MasterDataEntityType, id: string): Promise<MasterDataDeletionResultDTO> {
  const resposta = await excluir(tipo, id);
  expect(resposta.statusCode, resposta.body).toBe(200);
  return resposta.json() as MasterDataDeletionResultDTO;
}

/** O 409 de uso: devolve as fontes que a resposta listou. */
async function recusado(tipo: MasterDataEntityType, id: string): Promise<string[]> {
  const resposta = await excluir(tipo, id);
  expect(resposta.statusCode, resposta.body).toBe(409);
  const corpo = resposta.json() as { error: string; references: { source: string }[] };
  expect(corpo.error).toBe(MASTER_DATA_IN_USE_ERROR);
  return corpo.references.map((referencia) => referencia.source);
}

const rastros = (id: string) => getPrisma().masterDataDeletionHistory.count({ where: { entityId: id } });
const existeItem = (id: string) => getPrisma().item.count({ where: { id } });
const existeProduto = (id: string) => getPrisma().product.count({ where: { id } });

// ─────────────────────────────────────────────────────────────── fixtures

async function item(extra: Record<string, unknown> = {}): Promise<ItemDTO> {
  const resposta = await admin.inject({
    method: "POST",
    url: "/items",
    payload: { type: "RAW_MATERIAL", name: `ITEM FIXTURE HD2 ${proximo()}`, unitCode: "un", ...extra },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const criado = resposta.json() as ItemDTO;
  criados.itens.push(criado.id);
  return criado;
}

async function cliente(): Promise<CustomerDTO> {
  const resposta = await admin.inject({
    method: "POST",
    url: "/customers",
    payload: { legalName: `Cliente Fixture HD2 ${proximo()}` },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const criado = resposta.json() as CustomerDTO;
  criados.clientes.push(criado.id);
  return criado;
}

async function fornecedor(): Promise<SupplierDTO> {
  const resposta = await admin.inject({
    method: "POST",
    url: "/suppliers",
    payload: { legalName: `Fornecedor Fixture HD2 ${proximo()}` },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const criado = resposta.json() as SupplierDTO;
  criados.fornecedores.push(criado.id);
  return criado;
}

interface ProdutoComPa {
  produto: ProductDTO;
  pa: { id: string; code: string; name: string };
}

/** Produto pela porta normal (`POST /products`): nasce com o PA dele, na mesma transação. */
async function produtoComPa(nome = `PRODUTO FIXTURE HD2 ${proximo()}`, customerId?: string): Promise<ProdutoComPa> {
  const dono = customerId ?? (await cliente()).id;
  const resposta = await admin.inject({ method: "POST", url: "/products", payload: { name: nome, customerId: dono } });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const produto = resposta.json() as ProductDTO;
  criados.produtos.push(produto.id);
  const pa = produto.finishedProductItem!;
  criados.itens.push(pa.id);
  return { produto, pa: { id: pa.id, code: pa.code, name: pa.name } };
}

/** Produto de apoio (sem PA), direto no banco — para OP e formulação de fixture. */
async function produtoDeApoio(extra: Record<string, unknown> = {}) {
  const criado = await getPrisma().product.create({
    data: { code: `PROD-HD2-${proximo()}`, name: `Produto Apoio HD2 ${proximo()}`, ...extra },
  });
  criados.produtos.push(criado.id);
  return criado;
}

async function ordemDeProducao(extra: Record<string, unknown> = {}) {
  const base = await produtoDeApoio();
  const criada = await getPrisma().productionOrder.create({
    data: { code: `OP-HD2-${proximo()}`, productId: base.id, plannedQuantity: "10", outputUnitCode: "un", ...extra },
  });
  criados.ordens.push(criada.id);
  return criada;
}

async function lote(itemId: string) {
  const criado = await getPrisma().lot.create({
    data: { code: `LOT-HD2-${proximo()}`, itemId, origin: "OPENING_BALANCE", initialReceivedQuantity: "10" },
  });
  criados.lotes.push(criado.id);
  return criado;
}

/** Ajuste manual sem lote: o caso em que só o CASCADE do ledger está no caminho. */
const ajusteSemLote = (itemId: string) =>
  getPrisma().inventoryMovement.create({
    data: {
      itemId,
      lotId: null,
      type: "ADJUSTMENT_IN",
      quantity: "5",
      occurredAt: new Date(),
      sourceType: "MANUAL_ADJUSTMENT",
      reason: "Fixture HD2",
    },
  });

async function recurso(extra: Record<string, unknown> = {}): Promise<IndustrialResourceDetailDTO> {
  const resposta = await admin.inject({
    method: "POST",
    url: "/industrial-resources",
    payload: { name: `Recurso Fixture HD2 ${proximo()}`, type: "LABOR", ...extra },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const criado = resposta.json() as IndustrialResourceDetailDTO;
  criados.recursos.push(criado.id);
  return criado;
}

async function roteiro(): Promise<ProductionProfileDTO> {
  const resposta = await admin.inject({
    method: "POST",
    url: "/production-profiles",
    payload: { name: `Roteiro Fixture HD2 ${proximo()}`, referenceQuantity: "1000", referenceUomCode: "un" },
  });
  expect(resposta.statusCode, resposta.body).toBe(201);
  const criado = resposta.json() as ProductionProfileDTO;
  criados.roteiros.push(criado.id);
  return criado;
}

// ─────────────────────────────────────────────────────────────── Item

describe("Item — sem uso sai; qualquer realidade operacional bloqueia", () => {
  it("MP totalmente sem uso: prévia libera, sai com UM rastro, retrato da lista branca, e o nome fica livre", async () => {
    const criado = await item({ sourceName: "Fonte que não vai para o rastro" });
    expect(await previa("ITEM", criado.id)).toEqual({
      entityType: "ITEM",
      entityId: criado.id,
      entityCode: criado.code,
      entityName: criado.name,
      canDelete: true,
      references: [],
      removedTogether: [],
      alternative: "INACTIVATE",
      alternativeAvailable: true,
    });

    const resultado = await excluido("ITEM", criado.id);
    expect(resultado).toMatchObject({ entityType: "ITEM", entityId: criado.id, entityCode: criado.code });
    expect(await existeItem(criado.id)).toBe(0);
    const [linha, ...outras] = await getPrisma().masterDataDeletionHistory.findMany({ where: { entityId: criado.id } });
    expect(outras).toEqual([]);
    expect(linha).toMatchObject({ entityType: "ITEM", entityCode: criado.code, entityName: criado.name, reason: MOTIVO });
    const retrato = linha!.snapshot as { cadastro: Record<string, unknown>; removidosJunto: unknown[] };
    expect(Object.keys(retrato.cadastro).sort()).toEqual(
      ["code", "name", "type", "unitCode", "family", "active", "externalCode", "createdAt"].sort(),
    );
    expect(retrato.removidosJunto).toEqual([]);
    expect(JSON.stringify(linha!.snapshot)).not.toContain("Fonte que não vai");

    const denovo = await admin.inject({
      method: "POST",
      url: "/items",
      payload: { type: "RAW_MATERIAL", name: criado.name, unitCode: "un" },
    });
    expect(denovo.statusCode, denovo.body).toBe(201);
    criados.itens.push((denovo.json() as ItemDTO).id);
  });

  it("com estoque (lote e movimento): bloqueia, e nada sai", async () => {
    const criado = await item();
    const comLote = await lote(criado.id);
    await getPrisma().inventoryMovement.create({
      data: {
        itemId: criado.id,
        lotId: comLote.id,
        type: "OPENING_BALANCE",
        quantity: "10",
        occurredAt: new Date(),
        sourceType: "OPENING_BALANCE",
      },
    });
    const check = await previa("ITEM", criado.id);
    expect(check.canDelete).toBe(false);
    expect(check.removedTogether).toEqual([]);
    expect(check.references.map((r) => r.source)).toEqual(expect.arrayContaining(["Lotes", "Movimentos de estoque"]));
    await recusado("ITEM", criado.id);
    expect(await existeItem(criado.id)).toBe(1);
    expect(await getPrisma().inventoryMovement.count({ where: { itemId: criado.id } })).toBe(1);
    expect(await rastros(criado.id)).toBe(0);
  });

  it("movimento SEM lote (só o CASCADE do ledger no caminho): bloqueia e o movimento fica", async () => {
    const criado = await item();
    await ajusteSemLote(criado.id);
    const check = await previa("ITEM", criado.id);
    expect(check.references).toEqual([
      {
        source: "Movimentos de estoque",
        count: 1,
        reason: "O item já teve movimento de estoque — o histórico do estoque é permanente.",
      },
    ]);
    expect(await recusado("ITEM", criado.id)).toEqual(["Movimentos de estoque"]);
    expect(await getPrisma().inventoryMovement.count({ where: { itemId: criado.id } })).toBe(1);
  });

  it("com fornecedor: a relação Item × Fornecedor bloqueia", async () => {
    const criado = await item();
    const dono = await fornecedor();
    await getPrisma().supplierItem.create({ data: { itemId: criado.id, supplierId: dono.id } });
    expect(await recusado("ITEM", criado.id)).toEqual(["Relações Item × Fornecedor"]);
    expect(await existeItem(criado.id)).toBe(1);
  });

  it("em formulação: componente de formulação de produto bloqueia", async () => {
    const criado = await item();
    const base = await produtoDeApoio();
    const saida = await item({ type: "PACKAGING" });
    const versao = await getPrisma().formulationVersion.create({
      data: {
        productId: base.id,
        versionNumber: 1,
        basisQuantity: "1",
        outputItemId: saida.id,
        outputItemCode: saida.code,
        outputItemName: saida.name,
        outputUnitCode: "un",
      },
    });
    await getPrisma().formulationComponent.create({
      data: { formulationVersionId: versao.id, itemId: criado.id, quantity: "1", unitCode: "un", position: 1 },
    });
    expect(await recusado("ITEM", criado.id)).toEqual(["Formulações"]);
    // O item que a formulação produz também está preso — por chave e pelas cópias.
    expect(await recusado("ITEM", saida.id)).toEqual(
      expect.arrayContaining(["Formulações (item produzido)", "Formulações (cópia do item)"]),
    );
  });

  it("em modelo de formulação: componente da V1 do modelo bloqueia", async () => {
    const criado = await item();
    const resposta = await admin.inject({
      method: "POST",
      url: "/formulation-templates",
      payload: { name: `Modelo Fixture HD2 ${proximo()}` },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const modelo = resposta.json() as FormulationTemplateDTO;
    criados.modelosDeFormulacao.push(modelo.id);
    await getPrisma().formulationTemplateComponent.create({
      data: { formulationTemplateVersionId: modelo.draftVersion!.id, itemId: criado.id, quantity: "1", unitCode: "un", position: 1 },
    });
    expect(await recusado("ITEM", criado.id)).toEqual(["Modelos de formulação"]);
  });

  it("com referência de custo — mesmo a gravada na própria criação — bloqueia: é histórico de custo (D2)", async () => {
    const criado = await item({ initialCostReference: { unitCost: "12.5", uomCode: "un" } });
    expect(await getPrisma().itemCostReference.count({ where: { itemId: criado.id } })).toBe(1);
    expect(await recusado("ITEM", criado.id)).toEqual(["Referências de custo"]);
    expect(await getPrisma().itemCostReference.count({ where: { itemId: criado.id } })).toBe(1);
  });

  it("UC com consumo interno e estorno (CI/ECI): bloqueia, e a saída é Inativar", async () => {
    const uc = await item({ type: "INTERNAL_CONSUMABLE" });
    const { user: autor } = await createAuthenticatedUser("ADMIN");
    const prisma = getPrisma();
    const saida = await prisma.inventoryMovement.create({
      data: { itemId: uc.id, type: "INTERNAL_CONSUMPTION", quantity: "1", occurredAt: new Date(), sourceType: "INTERNAL_CONSUMPTION" },
    });
    const consumo = await prisma.internalConsumption.create({
      data: {
        code: `CI-HD2-${proximo()}`,
        itemId: uc.id,
        quantity: "1",
        uomCode: "un",
        occurredAt: new Date(),
        costSource: "NO_COST",
        inventoryMovementId: saida.id,
        registeredByUserId: autor.id,
        registeredByNameSnapshot: autor.name,
      },
    });
    criados.consumos.push(consumo.id);
    const volta = await prisma.inventoryMovement.create({
      data: {
        itemId: uc.id,
        type: "INTERNAL_CONSUMPTION_REVERSAL",
        quantity: "1",
        occurredAt: new Date(),
        sourceType: "INTERNAL_CONSUMPTION_REVERSAL",
      },
    });
    await prisma.internalConsumptionReversal.create({
      data: {
        code: `ECI-HD2-${proximo()}`,
        originalConsumptionId: consumo.id,
        quantity: "1",
        reason: "Estorno de fixture",
        costSource: "NO_COST",
        inventoryMovementId: volta.id,
        registeredByUserId: autor.id,
        registeredByNameSnapshot: autor.name,
      },
    });

    const check = await previa("ITEM", uc.id);
    expect(check.references.map((r) => r.source).sort()).toEqual(["Consumo interno", "Movimentos de estoque"]);
    expect(check.references.find((r) => r.source === "Movimentos de estoque")!.count).toBe(2);
    expect(check).toMatchObject({ canDelete: false, alternative: "INACTIVATE", alternativeAvailable: true });
    await recusado("ITEM", uc.id);
    expect(await prisma.internalConsumptionReversal.count({ where: { originalConsumptionId: consumo.id } })).toBe(1);
  });

  it("em inventário físico: posição (CASCADE) e a cópia do código e do nome bloqueiam", async () => {
    const criado = await item();
    const contagem = await getPrisma().stockCount.create({
      data: {
        code: `INV-HD2-${proximo()}`,
        kind: "SESSION",
        mode: "BLIND",
        status: "CANCELLED",
        referenceAt: new Date(),
        createdByName: "Fixture HD2",
        scopeFilters: { balance: "ANY" },
      },
    });
    criados.contagens.push(contagem.id);
    await getPrisma().stockCountPosition.create({
      data: {
        stockCountId: contagem.id,
        sequence: 1,
        // Item sem lote: a chave da posição é o próprio id do item (CHECK do banco).
        positionKey: criado.id,
        itemId: criado.id,
        itemCode: criado.code,
        itemName: criado.name,
        itemType: "RAW_MATERIAL",
        unitCode: "un",
        origin: "SCOPE",
        referenceQuantity: "0",
        referenceAt: new Date(),
      },
    });
    expect((await recusado("ITEM", criado.id)).sort()).toEqual(["Inventário físico", "Inventário físico (cópia do item)"]);
    expect(await getPrisma().stockCountPosition.count({ where: { itemId: criado.id } })).toBe(1);
  });

  it("código copiado sem chave bloqueia: OP que só guarda o código do item", async () => {
    const criado = await item();
    await ordemDeProducao({ finishedItemCode: criado.code });
    expect(await previa("ITEM", criado.id)).toMatchObject({
      canDelete: false,
      references: [{ source: "Ordens de produção (cópia do item)", count: 1, reason: "Documento guarda o código deste item." }],
    });
  });

  it("JSON bloqueia: escopo de contagem de estoque que cita o item", async () => {
    const criado = await item();
    const contagem = await getPrisma().stockCount.create({
      data: {
        code: `INV-HD2-${proximo()}`,
        kind: "SESSION",
        mode: "BLIND",
        status: "CANCELLED",
        referenceAt: new Date(),
        createdByName: "Fixture HD2",
        scopeFilters: { balance: "ANY", itemIds: [criado.id] },
      },
    });
    criados.contagens.push(contagem.id);
    expect((await previa("ITEM", criado.id)).references).toEqual([
      { source: "Inventário físico (escopo da contagem)", count: 1, reason: "Dado gravado em JSON cita este cadastro." },
    ]);
  });

  it("inativo e sem uso também sai; já inativo, a saída Inativar deixa de ser oferecida", async () => {
    const criado = await item();
    const inativar = await admin.inject({ method: "POST", url: `/items/${criado.id}/deactivate` });
    expect(inativar.statusCode, inativar.body).toBe(200);
    expect(await previa("ITEM", criado.id)).toMatchObject({ canDelete: true, alternativeAvailable: false });
    await ajusteSemLote(criado.id);
    expect(await previa("ITEM", criado.id)).toMatchObject({ canDelete: false, alternativeAvailable: false });
  });
});

describe("Item de produto acabado — nunca sai sozinho", () => {
  it("PA ligado ao Produto: pela tela de Itens, 409 — ele só sai com o Produto", async () => {
    const { produto, pa } = await produtoComPa();
    const check = await previa("ITEM", pa.id);
    expect(check.canDelete).toBe(false);
    expect(check.references.map((r) => r.source).sort()).toEqual(["Item de produto acabado", "Produto dono deste item"]);
    await recusado("ITEM", pa.id);
    expect(await existeItem(pa.id)).toBe(1);
    const intacto = await getPrisma().product.findUniqueOrThrow({ where: { id: produto.id } });
    expect(intacto.finishedProductItemId).toBe(pa.id);
  });

  it("PA órfão (sem Produto) também não sai pela tela de Itens", async () => {
    const orfao = await getPrisma().item.create({
      data: { code: `PA-HD2-${proximo()}`, type: "FINISHED_PRODUCT", name: `PA ORFAO HD2 ${proximo()}`, unitCode: "un" },
    });
    criados.itens.push(orfao.id);
    expect(await recusado("ITEM", orfao.id)).toEqual(["Item de produto acabado"]);
    expect(await existeItem(orfao.id)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────── Produto + PA

describe("Produto — sai com o PA técnico, ou não sai nada", () => {
  it("nunca usado: a prévia diz que o PA sai junto; sai o agregado inteiro, com UM rastro e o PA no retrato", async () => {
    const { produto, pa } = await produtoComPa();
    expect(await previa("PRODUCT", produto.id)).toEqual({
      entityType: "PRODUCT",
      entityId: produto.id,
      entityCode: produto.code,
      entityName: produto.name,
      canDelete: true,
      references: [],
      removedTogether: [{ source: `Item de produto acabado ${pa.code} — ${pa.name}`, count: 1 }],
      alternative: "INACTIVATE",
      alternativeAvailable: true,
    });

    await excluido("PRODUCT", produto.id);
    expect(await existeProduto(produto.id)).toBe(0);
    // O PA não fica órfão: sai na mesma transação.
    expect(await existeItem(pa.id)).toBe(0);
    // Um rastro só — do Produto —, com a identidade do PA no retrato.
    expect(await rastros(pa.id)).toBe(0);
    const [linha, ...outras] = await getPrisma().masterDataDeletionHistory.findMany({ where: { entityId: produto.id } });
    expect(outras).toEqual([]);
    expect(linha).toMatchObject({ entityType: "PRODUCT", entityCode: produto.code, entityName: produto.name });
    expect(linha!.snapshot).toMatchObject({
      formato: 1,
      cadastro: { code: produto.code, name: produto.name },
      vinculados: [{ tipo: "ITEM", cadastro: { code: pa.code, name: pa.name, type: "FINISHED_PRODUCT" } }],
      removidosJunto: [{ tabela: "items", linhas: 1 }],
    });
  });

  it("depois da exclusão o nome fica livre — o do Produto e o do PA: o mesmo nome nasce de novo, com PA novo", async () => {
    const dono = await cliente();
    const { produto, pa } = await produtoComPa(undefined, dono.id);
    const repetido = await admin.inject({
      method: "POST",
      url: "/products",
      payload: { name: produto.name, customerId: dono.id },
    });
    expect(repetido.statusCode).toBe(409);

    await excluido("PRODUCT", produto.id);
    const denovo = await produtoComPa(produto.name, dono.id);
    expect(denovo.produto.name).toBe(produto.name);
    expect(denovo.pa.name).toBe(pa.name);
    expect(denovo.pa.id).not.toBe(pa.id);
  });

  it.each([
    [
      "lote do PA",
      async (paId: string) => {
        await lote(paId);
      },
      "Lotes",
    ],
    [
      "movimento de estoque do PA, sem lote",
      async (paId: string) => {
        await ajusteSemLote(paId);
      },
      "Movimentos de estoque",
    ],
    [
      "ordem de produção que produz o PA",
      async (paId: string) => {
        await ordemDeProducao({ finishedItemId: paId });
      },
      "Ordens de produção (item produzido)",
    ],
  ] as const)("PA com uso (%s): bloqueia o Produto, e nada sai — nem o Produto, nem o PA", async (_caso, usar, fonte) => {
    const { produto, pa } = await produtoComPa();
    await usar(pa.id);
    const check = await previa("PRODUCT", produto.id);
    expect(check.canDelete).toBe(false);
    expect(check.removedTogether).toEqual([]);
    expect(check.references.map((r) => r.source)).toContain(`Item de produto acabado ${pa.code} — ${fonte}`);

    expect(await recusado("PRODUCT", produto.id)).toContain(`Item de produto acabado ${pa.code} — ${fonte}`);
    expect(await existeProduto(produto.id)).toBe(1);
    expect(await existeItem(pa.id)).toBe(1);
    expect((await getPrisma().product.findUniqueOrThrow({ where: { id: produto.id } })).finishedProductItemId).toBe(pa.id);
    expect(await rastros(produto.id)).toBe(0);
  });

  it("uso do próprio Produto (formulação em rascunho): bloqueia, e o PA fica com ele", async () => {
    const { produto, pa } = await produtoComPa();
    await getPrisma().formulationVersion.create({
      data: {
        productId: produto.id,
        versionNumber: 1,
        basisQuantity: "1",
        outputItemId: pa.id,
        outputItemCode: pa.code,
        outputItemName: pa.name,
        outputUnitCode: "un",
      },
    });
    const fontes = await recusado("PRODUCT", produto.id);
    expect(fontes).toContain("Formulações");
    // A mesma formulação produz o PA: o uso aparece do lado dele também.
    expect(fontes).toContain(`Item de produto acabado ${pa.code} — Formulações (item produzido)`);
    expect(await existeProduto(produto.id)).toBe(1);
    expect(await existeItem(pa.id)).toBe(1);
  });

  it("Produto sem PA (legado): sai sozinho, sem nada junto", async () => {
    const legado = await produtoDeApoio();
    expect(await previa("PRODUCT", legado.id)).toMatchObject({ canDelete: true, removedTogether: [] });
    await excluido("PRODUCT", legado.id);
    expect(await existeProduto(legado.id)).toBe(0);
  });

  it("item de outro tipo ligado ao Produto (legado): não é PA, não sai junto — bloqueia", async () => {
    const mp = await item();
    const legado = await produtoDeApoio({ finishedProductItemId: mp.id });
    expect(await recusado("PRODUCT", legado.id)).toEqual([`Item de produto acabado ${mp.code} — Tipo do item`]);
    expect(await existeItem(mp.id)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────── Recurso

describe("Recurso industrial — sem uso sai; tarifa, roteiro, custo e cópia na OP bloqueiam", () => {
  it("sem uso: sai com rastro (sem descrição nem observação) e o nome fica livre", async () => {
    const criado = await recurso({ description: "Descrição que não vai", notes: "Observação que não vai" });
    expect(await previa("INDUSTRIAL_RESOURCE", criado.id)).toMatchObject({
      canDelete: true,
      references: [],
      removedTogether: [],
      alternative: "INACTIVATE",
      alternativeAvailable: true,
    });
    await excluido("INDUSTRIAL_RESOURCE", criado.id);
    expect(await getPrisma().industrialResource.count({ where: { id: criado.id } })).toBe(0);
    const [linha] = await getPrisma().masterDataDeletionHistory.findMany({ where: { entityId: criado.id } });
    expect(linha).toMatchObject({ entityType: "INDUSTRIAL_RESOURCE", entityCode: criado.code, entityName: criado.name });
    expect(JSON.stringify(linha!.snapshot)).not.toMatch(/Descrição que não vai|Observação que não vai/);

    const denovo = await admin.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: criado.name, type: "LABOR" },
    });
    expect(denovo.statusCode, denovo.body).toBe(201);
    criados.recursos.push((denovo.json() as IndustrialResourceDetailDTO).id);
  });

  it("com tarifa: bloqueia — tarifa é histórico (D2), e a tarifa fica", async () => {
    const criado = await recurso();
    const tarifa = await admin.inject({
      method: "POST",
      url: `/industrial-resources/${criado.id}/rates`,
      payload: { rateValue: "42.5" },
    });
    expect(tarifa.statusCode, tarifa.body).toBe(201);
    expect(await recusado("INDUSTRIAL_RESOURCE", criado.id)).toEqual(["Tarifas"]);
    expect(await getPrisma().industrialResourceRate.count({ where: { industrialResourceId: criado.id } })).toBe(1);
  });

  it("em roteiro (etapa da V1 ainda em rascunho): bloqueia", async () => {
    const criado = await recurso();
    const perfil = await roteiro();
    const etapa = await getPrisma().productionProfileStep.create({
      data: { productionProfileVersionId: perfil.draftVersion!.id, sequence: 1, name: "Pesagem", runDurationMinutes: 10 },
    });
    await getPrisma().productionProfileStepResource.create({
      data: { productionProfileStepId: etapa.id, industrialResourceId: criado.id },
    });
    expect(await recusado("INDUSTRIAL_RESOURCE", criado.id)).toEqual(["Roteiros de produção (etapas)"]);
  });

  it("histórico: roteiro copiado para OP cita o recurso só no JSON (sem chave, §89) — bloqueia", async () => {
    const criado = await recurso();
    const op = await ordemDeProducao();
    await getPrisma().productionOrderPlanningSnapshot.create({
      data: {
        productionOrderId: op.id,
        sourceProfileId: `perfil-${proximo()}`,
        sourceProfileCode: `PPR-HD2-${proximo()}`,
        sourceProfileName: "Roteiro copiado",
        sourceVersionId: `versao-${proximo()}`,
        sourceVersionNumber: 1,
        referenceQuantity: "1000",
        referenceUomCode: "un",
        steps: [{ sequence: 1, name: "Pesagem", resources: [{ industrialResourceId: criado.id, code: criado.code }] }],
      },
    });
    expect((await previa("INDUSTRIAL_RESOURCE", criado.id)).references).toEqual([
      { source: "Roteiros copiados para ordens de produção", count: 1, reason: "Dado gravado em JSON cita este cadastro." },
    ]);
  });

  it("energia de modelo de custo (SET NULL): bloqueia — excluir tiraria a energia do modelo sem aviso", async () => {
    const criado = await recurso({ type: "ENERGY" });
    const resposta = await admin.inject({
      method: "POST",
      url: "/cost-templates",
      payload: { name: `Custo Fixture HD2 ${proximo()}` },
    });
    expect(resposta.statusCode, resposta.body).toBe(201);
    const modelo = resposta.json() as CostTemplateDTO;
    criados.modelosDeCusto.push(modelo.id);
    await getPrisma().industrialCostTemplateVersion.updateMany({
      where: { industrialCostTemplateId: modelo.id },
      data: { energyCalculationMode: "DIRECT", energyResourceId: criado.id },
    });
    expect(await recusado("INDUSTRIAL_RESOURCE", criado.id)).toEqual(["Modelos de custo industrial (energia)"]);
    const versao = await getPrisma().industrialCostTemplateVersion.findFirstOrThrow({
      where: { industrialCostTemplateId: modelo.id },
    });
    expect(versao.energyResourceId).toBe(criado.id);
  });
});

// ─────────────────────────────────────────────────────────────── transação

/** Espera um pedido parar na trava: poll no `pg_stat_activity`. */
async function esperarTrava(padrao: string): Promise<void> {
  const limite = Date.now() + 8_000;
  while (Date.now() < limite) {
    const [linha] = await getPrisma().$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE ${padrao}
        AND pid <> pg_backend_pid()`;
    if ((linha?.n ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`nenhum pedido parou na trava (${padrao})`);
}

/**
 * Uma escrita que chega durante a exclusão: nasce numa transação que ainda não
 * confirmou (o INSERT segura a linha apontada em FOR KEY SHARE), a exclusão
 * pede FOR UPDATE e espera, e só então a escrita confirma.
 */
async function durante(
  escrever: (tx: Prisma.TransactionClient) => Promise<void>,
  padrao: string,
  exclusao: () => ReturnType<typeof excluir>,
) {
  let soltar!: () => void;
  const segurando = new Promise<void>((resolve) => (soltar = resolve));
  let avisarAberta!: () => void;
  const aberta = new Promise<void>((resolve) => (avisarAberta = resolve));
  const escrita = getPrisma().$transaction(
    async (tx) => {
      await escrever(tx);
      avisarAberta();
      await segurando;
    },
    { timeout: 30_000 },
  );
  await aberta;
  const pedido = exclusao();
  await esperarTrava(padrao);
  soltar();
  await escrita;
  return pedido;
}

describe("transação — trava, recontagem e efeito real", () => {
  it("Item × relação com fornecedor criada durante a exclusão: a recontagem sob trava recusa", async () => {
    const criado = await item();
    const dono = await fornecedor();
    const resposta = await durante(
      async (tx) => {
        await tx.supplierItem.create({ data: { itemId: criado.id, supplierId: dono.id } });
      },
      '%FROM "items"%FOR UPDATE%',
      () => excluir("ITEM", criado.id),
    );
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect((resposta.json() as { references: { source: string }[] }).references.map((r) => r.source)).toEqual([
      "Relações Item × Fornecedor",
    ]);
    expect(await existeItem(criado.id)).toBe(1);
    expect(await rastros(criado.id)).toBe(0);
  });

  it("Produto × lote do PA criado durante a exclusão: recusa, e o Produto e o PA ficam", async () => {
    const { produto, pa } = await produtoComPa();
    const resposta = await durante(
      async (tx) => {
        const criado = await tx.lot.create({
          data: { code: `LOT-HD2-${proximo()}`, itemId: pa.id, origin: "OPENING_BALANCE", initialReceivedQuantity: "1" },
        });
        criados.lotes.push(criado.id);
      },
      // O Produto trava de primeira; é a trava do PA que espera o lote.
      '%FROM "items"%FOR UPDATE%',
      () => excluir("PRODUCT", produto.id),
    );
    expect(resposta.statusCode, resposta.body).toBe(409);
    expect((resposta.json() as { references: { source: string }[] }).references.map((r) => r.source)).toContain(
      `Item de produto acabado ${pa.code} — Lotes`,
    );
    expect(await existeProduto(produto.id)).toBe(1);
    expect(await existeItem(pa.id)).toBe(1);
    expect(await rastros(produto.id)).toBe(0);
  });

  it("clique duplo no Produto: um exclui (com o PA), o outro é 404 — um rastro só", async () => {
    const { produto, pa } = await produtoComPa();
    const respostas = await Promise.all([excluir("PRODUCT", produto.id), excluir("PRODUCT", produto.id)]);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    expect(await rastros(produto.id)).toBe(1);
    expect(await existeItem(pa.id)).toBe(0);
  });

  it("efeito fora do agregado disparado pela saída do PA desfaz tudo: Produto e PA ficam, nada no rastro", async () => {
    const { produto, pa } = await produtoComPa();
    const testemunha = await fornecedor();
    const prisma = getPrisma();
    const funcao = `hd2_efeito_pa_${marca.replace(/[^a-z0-9]/g, "")}`;
    const gatilho = `${funcao}_trg`;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${funcao}"() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         UPDATE suppliers SET notes = 'tocado pelo gatilho' WHERE id = '${testemunha.id}';
         RETURN OLD;
       END $$`,
    );
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${gatilho}" AFTER DELETE ON items FOR EACH ROW
         WHEN (OLD.id = '${pa.id}') EXECUTE FUNCTION "${funcao}"()`,
      );
      const resposta = await excluir("PRODUCT", produto.id);
      expect(resposta.statusCode, resposta.body).toBe(409);
      expect(resposta.json()).toMatchObject({ error: MASTER_DATA_DELETE_ABORTED_ERROR });
      expect((resposta.json() as { message: string }).message).toContain("suppliers");
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${gatilho}" ON items`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${funcao}"()`);
    }
    expect(await existeProduto(produto.id)).toBe(1);
    expect(await existeItem(pa.id)).toBe(1);
    expect(await rastros(produto.id)).toBe(0);
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: testemunha.id } })).notes).toBeNull();

    // Sem o gatilho, o mesmo Produto sai com o PA: o efeito real é o previsto.
    await excluido("PRODUCT", produto.id);
    expect(await existeItem(pa.id)).toBe(0);
  });
});
