import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ProductProductionProfileDTO,
  ProductionOrderDTO,
  ProductionProfileDTO,
  ProductionProfileListResponse,
} from "@veridi/shared";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";
import "../../lib/decimal.js";

/**
 * PRODUCTION-PROFILE-ARCHIVE-01 — Arquivar e Desarquivar o Perfil de Produção
 * (D4 do MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01), `PRODUCT_RULES.md` §89.
 *
 * O que está sob teste:
 *
 * 1. só Produção e Administração arquivam e desarquivam — os demais perfis
 *    recebem 403 antes do corpo e da existência, e continuam lendo;
 * 2. arquivar é do cadastro pai: carimba data e autor, e nenhuma versão muda de
 *    situação; desarquivar limpa as mesmas colunas; a transição repetida é 409 e
 *    não re-carimba;
 * 3. arquivado não entra em compromisso novo: some da lista padrão e dos
 *    seletores, não vira padrão de Produto e não entra em ordem — nem pela
 *    aplicação automática, que deixa a ordem nova sem cópia e não troca de
 *    roteiro sozinha;
 * 4. o que já existia fica: o Produto continua apontando, e a cópia congelada
 *    nas ordens não muda — nem o planejamento da ordem que já a tinha trava.
 */

type App = ReturnType<typeof buildTestApp>;
const admin: App = buildTestApp("ADMIN");
const producao: App = buildTestApp("PRODUCTION");
const SEM_PERMISSAO = ["QUALITY", "PURCHASING", "COMMERCIAL", "VIEWER"] as const;
const semPermissao = new Map(SEM_PERMISSAO.map((role) => [role, buildTestApp(role)]));

const fixtureProfileIds: string[] = [];
const fixtureResourceIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureItemIds: string[] = [];
const fixtureOrderIds: string[] = [];

const marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let contador = 0;
const proximo = () => `${marca}-${++contador}`;

let operadorId: string;

beforeAll(async () => {
  await admin.ready();
  await producao.ready();
  for (const app of semPermissao.values()) await app.ready();
  const prisma = getPrisma();
  for (const unit of [
    { code: "un", label: "Unidade", dimension: "COUNT" as const, toBaseFactor: "1" },
    { code: "kg", label: "Quilograma", dimension: "MASS" as const, toBaseFactor: "1000" },
  ]) {
    await prisma.unitOfMeasure.upsert({ where: { code: unit.code }, update: {}, create: unit });
  }
  const operador = await prisma.industrialResource.create({
    data: {
      code: `RIN-ARQ-${proximo()}`,
      name: `Mão de obra — Produção ${marca}`,
      type: "LABOR",
      defaultUsageUom: "HOUR",
    },
  });
  fixtureResourceIds.push(operador.id);
  operadorId = operador.id;
});

afterAll(async () => {
  const prisma = getPrisma();
  // Só o que ESTE arquivo criou, na ordem das referências.
  if (fixtureOrderIds.length > 0) {
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureProfileIds.length > 0) {
    await prisma.productionProfile.deleteMany({ where: { id: { in: fixtureProfileIds } } });
  }
  if (fixtureResourceIds.length > 0) {
    await prisma.industrialResource.deleteMany({ where: { id: { in: fixtureResourceIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
  await admin.close();
  await producao.close();
  for (const app of semPermissao.values()) await app.close();
});

// ─────────────────────────────────────────────────────────────── fixtures

const etapa = (name: string) => ({
  name,
  setupDurationMinutes: 10,
  runDurationMinutes: 120,
  scalingMode: "PROPORTIONAL",
  resources: [{ industrialResourceId: operadorId, resourceQuantity: 2 }],
});

/** Roteiro com a V1 ATIVA, com etapa e recurso — o que um Produto e uma OP usam. */
async function perfilAtivo(nomeDaEtapa = "Mistura") {
  const criado = await admin.inject({
    method: "POST",
    url: "/production-profiles",
    payload: { name: `Cápsulas ${proximo()}`, referenceQuantity: "1000", referenceUomCode: "un" },
  });
  expect(criado.statusCode).toBe(201);
  const perfil = criado.json() as ProductionProfileDTO;
  fixtureProfileIds.push(perfil.id);
  const versionId = perfil.draftVersion!.id;
  const salvo = await admin.inject({
    method: "PATCH",
    url: `/production-profile-versions/${versionId}`,
    payload: { steps: [etapa(nomeDaEtapa)] },
  });
  expect(salvo.statusCode).toBe(200);
  const ativa = await admin.inject({
    method: "POST",
    url: `/production-profile-versions/${versionId}/activate`,
  });
  expect(ativa.statusCode).toBe(200);
  return { perfilId: perfil.id, versionId, nome: perfil.name, codigo: perfil.code };
}

const arquivar = (app: App, id: string, archived = true) =>
  app.inject({ method: "POST", url: `/production-profiles/${id}/archive`, payload: { archived } });

const lerPerfil = async (id: string) =>
  (await admin.inject(`/production-profiles/${id}`)).json() as ProductionProfileDTO;

const colunasDoArquivo = (id: string) =>
  getPrisma().productionProfile.findUniqueOrThrow({
    where: { id },
    select: { archivedAt: true, archivedBy: true },
  });

async function produto(unitCode = "un") {
  const prisma = getPrisma();
  const item = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-ARQ-${proximo()}`,
      name: `Produto acabado ${marca}`,
      unitCode,
    },
  });
  fixtureItemIds.push(item.id);
  const criado = await prisma.product.create({
    data: { code: `PROD-ARQ-${proximo()}`, name: `Produto ${marca}`, finishedProductItemId: item.id },
  });
  fixtureProductIds.push(criado.id);
  return criado;
}

/** Produto com formulação V1 ATIVA — o mínimo para a OP planejar. Meio, não objeto. */
async function produtoPlanejavel() {
  const prisma = getPrisma();
  const item = await produto();
  const materia = await prisma.item.create({
    data: { type: "RAW_MATERIAL", code: `MP-ARQ-${proximo()}`, name: `Matéria-prima ${marca}`, unitCode: "kg" },
  });
  fixtureItemIds.push(materia.id);
  const criada = await admin.inject({ method: "POST", url: `/products/${item.id}/formulation-versions`, payload: {} });
  const versionId = criada.json().id as string;
  await admin.inject({
    method: "PATCH",
    url: `/formulation-versions/${versionId}`,
    payload: { basisQuantity: "1000", components: [{ itemId: materia.id, quantity: "10", unitCode: "kg" }] },
  });
  expect((await admin.inject({ method: "POST", url: `/formulation-versions/${versionId}/activate` })).statusCode).toBe(200);
  return item;
}

const definirPadrao = (productId: string, productionProfileVersionId: string | null) =>
  admin.inject({
    method: "PUT",
    url: `/products/${productId}/production-profile`,
    payload: { productionProfileVersionId },
  });

const padraoDoProduto = async (productId: string) =>
  (await admin.inject(`/products/${productId}/production-profile`)).json() as ProductProductionProfileDTO;

async function criarOP(productId: string): Promise<ProductionOrderDTO> {
  const resposta = await admin.inject({
    method: "POST",
    url: "/production-orders",
    payload: { productId, plannedQuantity: "3000" },
  });
  expect(resposta.statusCode).toBe(201);
  const ordem = resposta.json() as ProductionOrderDTO;
  fixtureOrderIds.push(ordem.id);
  return ordem;
}

const lerOP = async (id: string) => (await admin.inject(`/production-orders/${id}`)).json() as ProductionOrderDTO;

const aplicar = (id: string, payload: Record<string, unknown> = {}) =>
  admin.inject({ method: "POST", url: `/production-orders/${id}/production-profile`, payload });

const planejar = (id: string) => admin.inject({ method: "POST", url: `/production-orders/${id}/plan` });

async function lista(query: string): Promise<ProductionProfileListResponse> {
  const resposta = await admin.inject(`/production-profiles?${query}`);
  expect(resposta.statusCode).toBe(200);
  return resposta.json() as ProductionProfileListResponse;
}

const idsDa = (resposta: ProductionProfileListResponse) => resposta.profiles.map((perfil) => perfil.id);

// ────────────────────────────────────────────────────────────────── testes

describe("Arquivar e desarquivar — quem pode e o que muda", () => {
  it("ADMIN arquiva: carimba data e autor, e nenhuma versão muda de situação nem de conteúdo", async () => {
    const { perfilId, versionId } = await perfilAtivo();
    // Um rascunho aberto além da ativa: os dois têm de sair como entraram.
    const nova = await admin.inject({ method: "POST", url: `/production-profile-versions/${versionId}/new-version` });
    expect(nova.statusCode).toBe(201);
    const prisma = getPrisma();
    const versoesAntes = await prisma.productionProfileVersion.findMany({
      where: { productionProfileId: perfilId },
      include: { steps: { include: { resources: true } } },
      orderBy: { versionNumber: "asc" },
    });
    expect(versoesAntes.map((versao) => versao.status)).toEqual(["ACTIVE", "DRAFT"]);

    const resposta = await arquivar(admin, perfilId);

    expect(resposta.statusCode).toBe(200);
    const perfil = resposta.json() as ProductionProfileDTO;
    expect(perfil.archived).toBe(true);
    expect(perfil.archivedBy).toBe("Usuário de Teste ADMIN");
    expect(Number.isNaN(Date.parse(perfil.archivedAt ?? ""))).toBe(false);
    expect(perfil.activeVersion?.id).toBe(versionId);
    expect(perfil.activeVersion?.profileArchived).toBe(true);
    expect(perfil.draftVersion?.status).toBe("DRAFT");

    const versoesDepois = await prisma.productionProfileVersion.findMany({
      where: { productionProfileId: perfilId },
      include: { steps: { include: { resources: true } } },
      orderBy: { versionNumber: "asc" },
    });
    // Nada apagado, nada re-situado: a ativa não virou ARCHIVED, o rascunho não sumiu.
    expect(versoesDepois).toEqual(versoesAntes);
  });

  it("Produção arquiva e desarquiva; desarquivar limpa as mesmas colunas que os Modelos", async () => {
    const { perfilId } = await perfilAtivo();

    const arquivado = await arquivar(producao, perfilId);
    expect(arquivado.statusCode).toBe(200);
    expect(arquivado.json().archivedBy).toBe("Usuário de Teste PRODUCTION");

    const desarquivado = await arquivar(producao, perfilId, false);
    expect(desarquivado.statusCode).toBe(200);
    expect(desarquivado.json()).toMatchObject({ archived: false, archivedAt: null, archivedBy: null });
    expect(await colunasDoArquivo(perfilId)).toEqual({ archivedAt: null, archivedBy: null });
  });

  it.each(SEM_PERMISSAO)(
    "%s recebe 403 antes do corpo e da existência, nada é gravado — e continua lendo",
    async (role) => {
      const app = semPermissao.get(role)!;
      const { perfilId } = await perfilAtivo();

      const valido = await arquivar(app, perfilId);
      const corpoInvalido = await app.inject({
        method: "POST",
        url: `/production-profiles/${perfilId}/archive`,
        payload: { archived: "sim" },
      });
      const inexistente = await arquivar(app, "perfil-que-nao-existe");

      expect([valido.statusCode, corpoInvalido.statusCode, inexistente.statusCode], role).toEqual([403, 403, 403]);
      expect(valido.json().error, role).toBe("forbidden");
      expect(await colunasDoArquivo(perfilId), role).toEqual({ archivedAt: null, archivedBy: null });

      // Somente leitura, como antes: a consulta segue aberta.
      expect((await app.inject(`/production-profiles/${perfilId}`)).statusCode, role).toBe(200);
    },
  );

  it("transição repetida é 409 e não re-carimba; inexistente é 404; corpo inválido é 400", async () => {
    const { perfilId } = await perfilAtivo();

    expect((await arquivar(admin, perfilId)).statusCode).toBe(200);
    const primeiroCarimbo = await colunasDoArquivo(perfilId);

    const deNovo = await arquivar(producao, perfilId);
    expect(deNovo.statusCode).toBe(409);
    expect(deNovo.json()).toEqual({
      error: "invalid_status_transition",
      message: "Este Roteiro de Produção já está arquivado.",
    });
    // Nem data nem autor mudam: o segundo pedido não é um arquivamento novo.
    expect(await colunasDoArquivo(perfilId)).toEqual(primeiroCarimbo);

    expect((await arquivar(admin, perfilId, false)).statusCode).toBe(200);
    const desarquivarDeNovo = await arquivar(admin, perfilId, false);
    expect(desarquivarDeNovo.statusCode).toBe(409);
    expect(desarquivarDeNovo.json().message).toBe("Este Roteiro de Produção não está arquivado.");

    const inexistente = await arquivar(admin, "perfil-que-nao-existe");
    expect(inexistente.statusCode).toBe(404);
    expect(inexistente.json().error).toBe("not_found");

    for (const payload of [{}, { archived: "true" }, { archived: null }]) {
      const recusado = await admin.inject({ method: "POST", url: `/production-profiles/${perfilId}/archive`, payload });
      expect(recusado.statusCode, JSON.stringify(payload)).toBe(400);
      expect(recusado.json().error).toBe("validation_error");
    }
  });

  it("dois pedidos ao mesmo tempo: um arquiva, o outro cai no 409 — a condição está no UPDATE", async () => {
    const { perfilId } = await perfilAtivo();

    const respostas = await Promise.all([arquivar(admin, perfilId), arquivar(producao, perfilId)]);

    expect(respostas.map((resposta) => resposta.statusCode).sort()).toEqual([200, 409]);
    const vencedor = respostas.find((resposta) => resposta.statusCode === 200)!;
    expect((await colunasDoArquivo(perfilId)).archivedBy).toBe(vencedor.json().archivedBy);
  });
});

describe("Seletores e compromisso novo", () => {
  it("arquivado sai da lista padrão e dos seletores; `archived=true` mostra só os arquivados", async () => {
    const vivo = await perfilAtivo();
    const guardado = await perfilAtivo();
    expect((await arquivar(admin, guardado.perfilId)).statusCode).toBe(200);
    const busca = `search=${encodeURIComponent(marca)}&pageSize=100`;

    const padrao = idsDa(await lista(busca));
    expect(padrao).toContain(vivo.perfilId);
    expect(padrao).not.toContain(guardado.perfilId);

    // O que Produto e OP oferecem para escolher.
    const escolhiveis = idsDa(await lista(`${busca}&activeOnly=true`));
    expect(escolhiveis).toContain(vivo.perfilId);
    expect(escolhiveis).not.toContain(guardado.perfilId);

    const arquivados = await lista(`${busca}&archived=true`);
    expect(idsDa(arquivados)).toContain(guardado.perfilId);
    expect(idsDa(arquivados)).not.toContain(vivo.perfilId);
    expect(arquivados.profiles.find((perfil) => perfil.id === guardado.perfilId)?.archived).toBe(true);

    // Arquivado nunca é escolhível: a interseção é vazia.
    expect(idsDa(await lista(`${busca}&archived=true&activeOnly=true`))).not.toContain(guardado.perfilId);

    // Só "true"/"false" exatos, como nos Modelos.
    const permissivo = await admin.inject(`/production-profiles?archived=1`);
    expect(permissivo.statusCode).toBe(400);

    // Desarquivar devolve às duas listas.
    expect((await arquivar(admin, guardado.perfilId, false)).statusCode).toBe(200);
    expect(idsDa(await lista(busca))).toContain(guardado.perfilId);
    expect(idsDa(await lista(`${busca}&activeOnly=true`))).toContain(guardado.perfilId);
  });

  it("não vira padrão de Produto novo: 409 `profile_archived`, e o ponteiro não se mexe", async () => {
    const guardado = await perfilAtivo();
    const outro = await perfilAtivo();
    expect((await arquivar(admin, guardado.perfilId)).statusCode).toBe(200);

    const semPadrao = await produto();
    const recusado = await definirPadrao(semPadrao.id, guardado.versionId);
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("profile_archived");
    expect(recusado.json().message).toBe(
      `O Roteiro de Produção ${guardado.codigo} está arquivado e não pode ser escolhido para produto nem para ordem nova. Escolha um roteiro ativo ou desarquive este.`,
    );
    expect((await padraoDoProduto(semPadrao.id)).version).toBeNull();

    const comOutro = await produto();
    expect((await definirPadrao(comOutro.id, outro.versionId)).statusCode).toBe(200);
    expect((await definirPadrao(comOutro.id, guardado.versionId)).statusCode).toBe(409);
    expect((await padraoDoProduto(comOutro.id)).version?.id).toBe(outro.versionId);
  });

  it("Produto que já apontava continua apontando, com a marca de arquivado; tirar o padrão segue possível", async () => {
    const guardado = await perfilAtivo();
    const item = await produto();
    expect((await definirPadrao(item.id, guardado.versionId)).statusCode).toBe(200);

    expect((await arquivar(admin, guardado.perfilId)).statusCode).toBe(200);

    const padrao = await padraoDoProduto(item.id);
    expect(padrao.version).toMatchObject({
      id: guardado.versionId,
      productionProfileId: guardado.perfilId,
      status: "ACTIVE",
      profileArchived: true,
    });
    const gravado = await getPrisma().product.findUniqueOrThrow({
      where: { id: item.id },
      select: { defaultProductionProfileVersionId: true },
    });
    expect(gravado.defaultProductionProfileVersionId).toBe(guardado.versionId);
    // A consulta do roteiro continua dizendo quem o usa.
    expect((await lerPerfil(guardado.perfilId)).defaultProducts.map((linha) => linha.productId)).toEqual([item.id]);

    // Tirar não é compromisso novo.
    expect((await definirPadrao(item.id, null)).statusCode).toBe(200);
    expect((await padraoDoProduto(item.id)).version).toBeNull();
  });
});

describe("Ordem de Produção", () => {
  it("OP nova não deriva roteiro de perfil arquivado: nasce sem cópia, pendente, e nada troca sozinho", async () => {
    const guardado = await perfilAtivo();
    const ativo = await perfilAtivo("Encapsulamento");
    const item = await produtoPlanejavel();
    expect((await definirPadrao(item.id, guardado.versionId)).statusCode).toBe(200);
    expect((await arquivar(admin, guardado.perfilId)).statusCode).toBe(200);

    const ordem = await criarOP(item.id);

    expect(ordem.status).toBe("DRAFT");
    expect(ordem.planning.snapshot).toBeNull();
    expect(ordem.planning.routePending).toBe(true);
    expect(ordem.planning.productDefaultProfile).toMatchObject({
      versionId: guardado.versionId,
      profileArchived: true,
    });
    expect(ordem.planning.productDefaultCompatible).toBe(false);
    expect(ordem.planning.canApply).toBe(false);
    expect(ordem.planning.availableProfile).toBeNull();
    expect(ordem.planning.canChoose).toBe(true);

    expect((await planejar(ordem.id)).json().error).toBe("route_required");

    // Nem pelo padrão, nem escolhido, nem gravado como padrão e aplicado.
    for (const payload of [
      {},
      { productionProfileVersionId: guardado.versionId },
      { productionProfileVersionId: guardado.versionId, setAsProductDefault: true },
    ]) {
      const recusado = await aplicar(ordem.id, payload);
      expect(recusado.statusCode, JSON.stringify(payload)).toBe(409);
      expect(recusado.json().error).toBe("profile_archived");
    }
    expect((await lerOP(ordem.id)).planning.snapshot).toBeNull();

    // O fluxo permitido: escolher um roteiro ativo — e o padrão do Produto não troca sozinho.
    const escolhido = await aplicar(ordem.id, { productionProfileVersionId: ativo.versionId });
    expect(escolhido.statusCode).toBe(200);
    expect(escolhido.json().planning.applicationSource).toBe("MANUAL_ORDER");
    expect((await padraoDoProduto(item.id)).version?.id).toBe(guardado.versionId);
    expect((await planejar(ordem.id)).statusCode).toBe(200);
  });

  it("regularizar ordem planejada sem roteiro também recusa o arquivado", async () => {
    const guardado = await perfilAtivo();
    const item = await produto();
    const ordem = await criarOP(item.id);
    await getPrisma().productionOrder.update({ where: { id: ordem.id }, data: { status: "PLANNED" } });
    expect((await arquivar(admin, guardado.perfilId)).statusCode).toBe(200);

    const recusado = await aplicar(ordem.id, {
      productionProfileVersionId: guardado.versionId,
      confirmLegacyRepair: true,
      reason: "Ordem antiga sem roteiro",
    });

    expect(recusado.statusCode).toBe(409);
    expect(recusado.json().error).toBe("profile_archived");
    expect((await lerOP(ordem.id)).planning.snapshot).toBeNull();
  });

  it("OP que já copiou o roteiro continua: cópia intacta no arquivar e no desarquivar, e o planejamento não trava", async () => {
    const guardado = await perfilAtivo();
    const item = await produtoPlanejavel();
    expect((await definirPadrao(item.id, guardado.versionId)).statusCode).toBe(200);

    const rascunho = await criarOP(item.id);
    const planejada = await criarOP(item.id);
    expect((await planejar(planejada.id)).statusCode).toBe(200);

    const prisma = getPrisma();
    const linhas = () =>
      prisma.productionOrderPlanningSnapshot.findMany({
        where: { productionOrderId: { in: [rascunho.id, planejada.id] } },
        orderBy: { productionOrderId: "asc" },
      });
    const copiasAntes = await linhas();
    expect(copiasAntes).toHaveLength(2);
    expect(copiasAntes.every((copia) => copia.sourceProfileId === guardado.perfilId)).toBe(true);
    const snapshotAntes = (await lerOP(rascunho.id)).planning.snapshot;
    expect(snapshotAntes?.steps.map((passo) => passo.name)).toEqual(["Mistura"]);

    expect((await arquivar(admin, guardado.perfilId)).statusCode).toBe(200);

    // Nada da cópia foi reescrito — linha do banco inteira, com carimbos.
    expect(await linhas()).toEqual(copiasAntes);
    const lidaRascunho = await lerOP(rascunho.id);
    expect(lidaRascunho.planning.snapshot).toEqual(snapshotAntes);
    expect(lidaRascunho.planning.applicationSource).toBe("AUTO_PRODUCT_DEFAULT");
    // A projeção vem da cópia, não do perfil: continua calculada.
    expect(lidaRascunho.planning.plan?.steps.map((passo) => passo.name)).toEqual(["Mistura"]);
    const lidaPlanejada = await lerOP(planejada.id);
    expect(lidaPlanejada.status).toBe("PLANNED");
    expect(lidaPlanejada.planning.snapshot?.sourceProfileId).toBe(guardado.perfilId);

    // A ordem que já tinha a cópia segue o fluxo: o arquivamento não a alcança.
    expect((await planejar(rascunho.id)).statusCode).toBe(200);

    expect((await arquivar(admin, guardado.perfilId, false)).statusCode).toBe(200);
    const depois = await linhas();
    expect(depois.map((copia) => [copia.id, copia.sourceVersionId, copia.steps, copia.appliedAt])).toEqual(
      copiasAntes.map((copia) => [copia.id, copia.sourceVersionId, copia.steps, copia.appliedAt]),
    );
  });
});
