import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { DecisaoDeDuplicata } from "../veridi-import/item-duplicates.js";
import {
  ATOR_DA_IMPORTACAO,
  aplicar,
  conferirBackup,
  planejar,
  verificar,
} from "./item-duplicate-sanitization.js";
import type { Plano } from "./item-duplicate-sanitization.js";

/**
 * Saneamento de duplicatas de Item (ITEM-DUPLICATE-SANITIZATION-01) contra o banco de TESTE, com
 * fixtures sintéticas: decisão, Itens, fornecedores, relações e formulações nascem aqui e saem no
 * fim de cada caso. O arquivo de decisão real não entra — cada caso passa a própria decisão.
 */

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

const criados = { itens: [] as string[], fornecedores: [] as string[], produtos: [] as string[] };

afterEach(async () => {
  await prisma.formulationVersion.deleteMany({ where: { productId: { in: criados.produtos } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.supplierItem.deleteMany({
    where: { OR: [{ itemId: { in: criados.itens } }, { supplierId: { in: criados.fornecedores } }] },
  });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  criados.itens = [];
  criados.fornecedores = [];
  criados.produtos = [];
});

let sequencia = Math.floor(Math.random() * 50_000);
const codigoDoItem = (prefixo: "MP" | "ME" | "PA"): string => {
  sequencia += 1;
  return `${prefixo}-9${String(sequencia).padStart(5, "0")}`;
};
const marca = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();

async function criarItem(tipo: "RAW_MATERIAL" | "PACKAGING", nome: string, codigoPlanilha: string) {
  const item = await prisma.item.create({
    data: {
      code: codigoDoItem(tipo === "RAW_MATERIAL" ? "MP" : "ME"),
      type: tipo,
      name: nome,
      unitCode: tipo === "RAW_MATERIAL" ? "kg" : "un",
      externalCode: codigoPlanilha,
    },
  });
  criados.itens.push(item.id);
  return item;
}

/** Par canônico × absorvido com o mesmo nome em caixa diferente, e a decisão dele. */
async function criarGrupo(onda = `T${marca()}`, tipo: "RAW_MATERIAL" | "PACKAGING" = "RAW_MATERIAL") {
  const m = marca();
  const canonico = await criarItem(tipo, `Material ${m}`, `C${m}`);
  const absorvido = await criarItem(tipo, `MATERIAL ${m}`, `A${m}`);
  const decisao: DecisaoDeDuplicata = {
    onda,
    grupo: `G-${m}`,
    nome: `material ${m}`,
    absorvido: { codigo: absorvido.code, codigoPlanilha: `A${m}` },
    canonico: { codigo: canonico.code, codigoPlanilha: `C${m}` },
  };
  return { m, canonico, absorvido, decisao };
}

async function criarFornecedor() {
  const m = marca();
  const fornecedor = await prisma.supplier.create({ data: { code: `FOR-T${m}`, legalName: `Fornecedor teste ${m}` } });
  criados.fornecedores.push(fornecedor.id);
  return fornecedor;
}

/** Relação como a carga inicial grava: dois eventos e uma oferta legada, tudo do importador. */
async function criarRelacaoImportada(
  itemId: string,
  supplierId: string,
  extra: { qualificationStatus?: "PENDING" | "APPROVED"; preferred?: boolean } = {},
) {
  const status = extra.qualificationStatus ?? "APPROVED";
  const relacao = await prisma.supplierItem.create({
    data: {
      itemId,
      supplierId,
      qualificationStatus: status,
      preferred: extra.preferred ?? false,
      createdByNameSnapshot: ATOR_DA_IMPORTACAO,
      updatedByNameSnapshot: ATOR_DA_IMPORTACAO,
    },
  });
  await prisma.supplierItemQualificationHistory.create({
    data: { supplierItemId: relacao.id, fromStatus: null, toStatus: "PENDING", note: "Relacao importada da planilha", changedByNameSnapshot: ATOR_DA_IMPORTACAO },
  });
  if (status === "APPROVED") {
    await prisma.supplierItemQualificationHistory.create({
      data: { supplierItemId: relacao.id, fromStatus: "PENDING", toStatus: "APPROVED", note: "Homologacao marcada na planilha", changedByNameSnapshot: ATOR_DA_IMPORTACAO },
    });
  }
  const oferta = await prisma.supplierItemOffer.create({
    data: {
      supplierItemId: relacao.id,
      unitPrice: "10",
      currencyCode: "BRL",
      priceUomCode: "kg",
      source: "LEGACY_IMPORT",
      sourceKey: `teste-duplicata-${marca()}-${marca()}`,
      createdByNameSnapshot: ATOR_DA_IMPORTACAO,
    },
  });
  return { relacao, oferta };
}

async function criarFormulacao(status: "ACTIVE" | "DRAFT", itemId: string) {
  const m = marca();
  const acabado = await prisma.item.create({
    data: { code: codigoDoItem("PA"), type: "FINISHED_PRODUCT", name: `Produto ${m}`, unitCode: "un" },
  });
  criados.itens.push(acabado.id);
  const produto = await prisma.product.create({
    data: { code: `PROD-T${m}`, name: `Produto ${m}`, finishedProductItemId: acabado.id },
  });
  criados.produtos.push(produto.id);
  const versao = await prisma.formulationVersion.create({
    data: {
      productId: produto.id,
      versionNumber: 1,
      status,
      basisQuantity: "1",
      outputItemId: acabado.id,
      outputItemCode: acabado.code,
      outputItemName: acabado.name,
      outputUnitCode: "un",
    },
  });
  const componente = await prisma.formulationComponent.create({
    data: { formulationVersionId: versao.id, itemId, quantity: "1", unitCode: "kg", position: 0 },
  });
  return { versao, componente };
}

const grupoDo = (plano: Plano, decisao: DecisaoDeDuplicata) => {
  const grupo = plano.grupos.find((g) => g.grupo === decisao.grupo);
  if (!grupo) throw new Error(`grupo ${decisao.grupo} fora do plano`);
  return grupo;
};

describe("Saneamento de duplicatas de Item — PLAN, APPLY e VERIFY", () => {
  it("duplicado sem referência: remove só o absorvido, e reaplicar o plano recusa", async () => {
    const { canonico, absorvido, decisao } = await criarGrupo();
    const decisoes = [decisao];

    const plano = await planejar(prisma, decisao.onda, decisoes);
    expect(plano.pronto).toBe(true);
    expect(grupoDo(plano, decisao).operacoes).toEqual([
      { tipo: "REMOVER_ITEM", item: absorvido.id, codigo: absorvido.code },
    ]);
    expect(plano.efeitoEsperado).toEqual({ items: { ins: 0, upd: 0, del: 1 } });

    const resultado = await aplicar(prisma, plano, { decisoes });
    expect(resultado.efeito).toEqual(plano.efeitoEsperado);
    expect(await prisma.item.findUnique({ where: { id: absorvido.id } })).toBeNull();
    expect(await prisma.item.findUnique({ where: { id: canonico.id } })).toMatchObject({
      code: canonico.code,
      updatedAt: canonico.updatedAt,
    });
    expect((await verificar(prisma, decisao.onda, { decisoes, plano })).problemas).toEqual([]);

    expect(grupoDo(await planejar(prisma, decisao.onda, decisoes), decisao).situacao).toBe("JA_SANEADO");
    await expect(aplicar(prisma, plano, { decisoes })).rejects.toThrow(/não está no estado do plano/);
  });

  it("FK inesperada aborta — a de CASCADE também, que levaria a linha junto", async () => {
    const { absorvido, decisao } = await criarGrupo();
    const decisoes = [decisao];
    const planoLimpo = await planejar(prisma, decisao.onda, decisoes);
    expect(planoLimpo.pronto).toBe(true);

    // A referência aparece depois do plano aprovado.
    await prisma.itemCostReference.create({
      data: { itemId: absorvido.id, unitCost: "12", uomCode: "kg", effectiveFrom: new Date("2026-09-01T00:00:00Z") },
    });
    await expect(aplicar(prisma, planoLimpo, { decisoes })).rejects.toThrow(/não está no estado do plano/);
    expect(await prisma.itemCostReference.count({ where: { itemId: absorvido.id } })).toBe(1);
    expect(await prisma.item.findUnique({ where: { id: absorvido.id } })).not.toBeNull();

    const plano = await planejar(prisma, decisao.onda, decisoes);
    const grupo = grupoDo(plano, decisao);
    expect(plano.pronto).toBe(false);
    expect(grupo.situacao).toBe("ABORTAR");
    expect(grupo.operacoes).toEqual([]);
    expect(grupo.motivos.join("\n")).toContain("item_cost_references.itemId (1 linha(s))");
    await expect(aplicar(prisma, plano, { decisoes })).rejects.toThrow(/grupo em ABORTAR/);
  });

  it("impressão digital divergente aborta sem gravar nada", async () => {
    const { absorvido, decisao } = await criarGrupo();
    const decisoes = [decisao];
    const plano = await planejar(prisma, decisao.onda, decisoes);
    expect(plano.pronto).toBe(true);

    await prisma.item.update({ where: { id: absorvido.id }, data: { sourceName: "editado depois do plano" } });

    await expect(aplicar(prisma, plano, { decisoes })).rejects.toThrow(/impressão digital diferente/);
    expect(await prisma.item.findUnique({ where: { id: absorvido.id } })).toMatchObject({
      sourceName: "editado depois do plano",
    });
  });

  it("relação simples com fornecedor vai inteira para o canônico, com ofertas e eventos", async () => {
    const { canonico, absorvido, decisao } = await criarGrupo();
    const decisoes = [decisao];
    const fornecedor = await criarFornecedor();
    const { relacao, oferta } = await criarRelacaoImportada(absorvido.id, fornecedor.id);

    const plano = await planejar(prisma, decisao.onda, decisoes);
    expect(grupoDo(plano, decisao).operacoes).toEqual([
      {
        tipo: "MOVER_RELACAO",
        fornecedor: `${fornecedor.legalName} (${fornecedor.code})`,
        relacao: relacao.id,
        ofertas: 1,
        eventos: 2,
      },
      { tipo: "REMOVER_ITEM", item: absorvido.id, codigo: absorvido.code },
    ]);
    expect(plano.efeitoEsperado).toEqual({
      items: { ins: 0, upd: 0, del: 1 },
      supplier_items: { ins: 0, upd: 1, del: 0 },
    });

    await aplicar(prisma, plano, { decisoes });
    const movida = await prisma.supplierItem.findUniqueOrThrow({
      where: { id: relacao.id },
      include: { offers: true, qualificationHistory: true },
    });
    expect(movida.itemId).toBe(canonico.id);
    expect(movida.offers.map((o) => [o.id, o.sourceKey])).toEqual([[oferta.id, oferta.sourceKey]]);
    expect(movida.qualificationHistory).toHaveLength(2);
    expect((await verificar(prisma, decisao.onda, { decisoes, plano })).problemas).toEqual([]);
  });

  it("relação com o mesmo fornecedor nos dois lados: ofertas e eventos passam para a do canônico", async () => {
    const { canonico, absorvido, decisao } = await criarGrupo(undefined, "PACKAGING");
    const decisoes = [decisao];
    const fornecedor = await criarFornecedor();
    const doCanonico = await criarRelacaoImportada(canonico.id, fornecedor.id);
    const doAbsorvido = await criarRelacaoImportada(absorvido.id, fornecedor.id);
    const eventosDoAbsorvido = await prisma.supplierItemQualificationHistory.findMany({
      where: { supplierItemId: doAbsorvido.relacao.id },
      select: { id: true },
    });

    const plano = await planejar(prisma, decisao.onda, decisoes);
    expect(grupoDo(plano, decisao).operacoes[0]).toEqual({
      tipo: "CONSOLIDAR_RELACAO",
      fornecedor: `${fornecedor.legalName} (${fornecedor.code})`,
      relacaoAbsorvida: doAbsorvido.relacao.id,
      relacaoCanonica: doCanonico.relacao.id,
      ofertas: [{ id: doAbsorvido.oferta.id, sourceKey: doAbsorvido.oferta.sourceKey }],
      eventos: expect.arrayContaining(eventosDoAbsorvido.map((e) => e.id)),
    });
    expect(plano.efeitoEsperado).toEqual({
      items: { ins: 0, upd: 0, del: 1 },
      supplier_item_offers: { ins: 0, upd: 1, del: 0 },
      supplier_item_qualification_history: { ins: 0, upd: 2, del: 0 },
      supplier_items: { ins: 0, upd: 0, del: 1 },
    });

    await aplicar(prisma, plano, { decisoes });
    expect(await prisma.supplierItem.findUnique({ where: { id: doAbsorvido.relacao.id } })).toBeNull();
    const canonica = await prisma.supplierItem.findUniqueOrThrow({
      where: { id: doCanonico.relacao.id },
      include: { offers: true, qualificationHistory: true },
    });
    // A relação do canônico não muda; recebe o que era do absorvido, com a mesma sourceKey.
    expect(canonica).toMatchObject({
      itemId: canonico.id,
      qualificationStatus: "APPROVED",
      preferred: false,
      updatedAt: doCanonico.relacao.updatedAt,
    });
    expect(canonica.offers.map((o) => o.sourceKey).sort()).toEqual(
      [doCanonico.oferta.sourceKey, doAbsorvido.oferta.sourceKey].sort(),
    );
    expect(canonica.qualificationHistory.map((e) => e.id)).toEqual(
      expect.arrayContaining(eventosDoAbsorvido.map((e) => e.id)),
    );
    expect(canonica.qualificationHistory).toHaveLength(4);
    expect((await verificar(prisma, decisao.onda, { decisoes, plano })).problemas).toEqual([]);
  });

  it("preferencial dos dois lados, status divergente e histórico além da importação abortam", async () => {
    const onda = `T${marca()}`;
    const preferencial = await criarGrupo(onda, "PACKAGING");
    const divergente = await criarGrupo(onda, "PACKAGING");
    const manual = await criarGrupo(onda, "PACKAGING");
    const fornecedor = await criarFornecedor();
    await criarRelacaoImportada(preferencial.canonico.id, fornecedor.id, { preferred: true });
    await criarRelacaoImportada(preferencial.absorvido.id, fornecedor.id, { preferred: true });
    await criarRelacaoImportada(divergente.canonico.id, fornecedor.id);
    await criarRelacaoImportada(divergente.absorvido.id, fornecedor.id, { qualificationStatus: "PENDING" });
    const { relacao } = await criarRelacaoImportada(manual.absorvido.id, fornecedor.id);
    await prisma.supplierItemQualificationHistory.create({
      data: { supplierItemId: relacao.id, fromStatus: "APPROVED", toStatus: "APPROVED", note: "revisto", changedByNameSnapshot: "Qualidade (teste)" },
    });
    const decisoes = [preferencial.decisao, divergente.decisao, manual.decisao];

    const plano = await planejar(prisma, onda, decisoes);
    expect(plano.pronto).toBe(false);
    const esperado: [DecisaoDeDuplicata, RegExp][] = [
      [preferencial.decisao, /preferencial dos dois lados/],
      [divergente.decisao, /status divergente \(PENDING × APPROVED\)/],
      [manual.decisao, /histórico de homologação do absorvido além da importação/],
    ];
    for (const [decisao, motivo] of esperado) {
      const grupo = grupoDo(plano, decisao);
      expect(grupo.situacao, decisao.grupo).toBe("ABORTAR");
      expect(grupo.motivos.join("\n"), decisao.grupo).toMatch(motivo);
    }
    await expect(aplicar(prisma, plano, { decisoes })).rejects.toThrow(/grupo em ABORTAR/);
  });

  it("Formulação ACTIVE com o absorvido aborta; rascunho previsto vai para o canônico", async () => {
    const ativa = await criarGrupo();
    await criarFormulacao("ACTIVE", ativa.absorvido.id);
    const planoAtiva = await planejar(prisma, ativa.decisao.onda, [ativa.decisao]);
    expect(grupoDo(planoAtiva, ativa.decisao).situacao).toBe("ABORTAR");
    expect(grupoDo(planoAtiva, ativa.decisao).motivos.join("\n")).toMatch(/\(ACTIVE\) usa o absorvido/);

    const rascunho = await criarGrupo();
    const { versao, componente } = await criarFormulacao("DRAFT", rascunho.absorvido.id);
    const decisoes = [rascunho.decisao];
    const plano = await planejar(prisma, rascunho.decisao.onda, decisoes);
    expect(grupoDo(plano, rascunho.decisao).operacoes[0]).toMatchObject({
      tipo: "MOVER_COMPONENTE_RASCUNHO",
      componente: componente.id,
      versao: versao.id,
    });
    await aplicar(prisma, plano, { decisoes });
    expect(await prisma.formulationComponent.findUniqueOrThrow({ where: { id: componente.id } })).toMatchObject({
      itemId: rascunho.canonico.id,
      quantity: componente.quantity,
    });
    expect((await verificar(prisma, rascunho.decisao.onda, { decisoes, plano })).problemas).toEqual([]);
  });

  it("APPLY é atômico: falha no meio desfaz o grupo já aplicado", async () => {
    const onda = `T${marca()}`;
    const primeiro = await criarGrupo(onda);
    const segundo = await criarGrupo(onda, "PACKAGING");
    const fornecedor = await criarFornecedor();
    await criarRelacaoImportada(segundo.canonico.id, fornecedor.id);
    await criarRelacaoImportada(segundo.absorvido.id, fornecedor.id);
    const decisoes = [primeiro.decisao, segundo.decisao];
    const plano = await planejar(prisma, onda, decisoes);
    expect(plano.pronto).toBe(true);

    await expect(
      aplicar(prisma, plano, {
        decisoes,
        aoConcluirGrupo: (grupo) => {
          if (grupo === primeiro.decisao.grupo) throw new Error("falha simulada depois do primeiro grupo");
        },
      }),
    ).rejects.toThrow("falha simulada");

    expect(await prisma.item.count({ where: { id: { in: [primeiro.absorvido.id, segundo.absorvido.id] } } })).toBe(2);
    // Mesmo estado, mesma impressão: nada do primeiro grupo ficou gravado.
    expect((await planejar(prisma, onda, decisoes)).impressao).toBe(plano.impressao);

    // Trava consultiva: com outra execução em andamento, o APPLY recusa.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('veridi:item-duplicate-sanitization'))`);
      await expect(aplicar(prisma, plano, { decisoes })).rejects.toThrow(/outra execução/);
    });
    expect(await prisma.item.count({ where: { id: { in: [primeiro.absorvido.id, segundo.absorvido.id] } } })).toBe(2);
  });

  it("escrita fora do plano dentro da transação desfaz tudo", async () => {
    const { absorvido, decisao } = await criarGrupo();
    const decisoes = [decisao];
    const alheio = await criarFornecedor();
    const plano = await planejar(prisma, decisao.onda, decisoes);

    await expect(
      aplicar(prisma, plano, {
        decisoes,
        aoConcluirGrupo: async (_grupo, tx) => {
          await tx.supplier.update({ where: { id: alheio.id }, data: { legalName: "escrito fora do plano" } });
        },
      }),
    ).rejects.toThrow(/mexeu fora do plano/);

    expect(await prisma.supplier.findUniqueOrThrow({ where: { id: alheio.id } })).toMatchObject({
      legalName: alheio.legalName,
    });
    expect(await prisma.item.findUnique({ where: { id: absorvido.id } })).not.toBeNull();
  });

  it("VERIFY detecta resíduo: absorvido ainda no banco e duplicata recriada pela carga", async () => {
    const { m, canonico, absorvido, decisao } = await criarGrupo();
    const decisoes = [decisao];

    const antes = await verificar(prisma, decisao.onda, { decisoes });
    expect(antes.problemas.join("\n")).toContain(`${absorvido.code} ainda existe`);

    const plano = await planejar(prisma, decisao.onda, decisoes);
    await aplicar(prisma, plano, { decisoes });
    expect((await verificar(prisma, decisao.onda, { decisoes, plano })).problemas).toEqual([]);

    const recriada = await criarItem("RAW_MATERIAL", `Material ${m}`, decisao.absorvido.codigoPlanilha);
    const depois = (await verificar(prisma, decisao.onda, { decisoes, plano })).problemas.join("\n");
    expect(depois).toContain(`${recriada.code} tem o código da planilha do absorvido`);
    expect(depois).toContain(`esperado só ${canonico.code}`);
  });
});

describe("Saneamento de duplicatas de Item — backup do APPLY", () => {
  const plano = {
    grupos: [
      {
        grupo: "G1",
        operacoes: [
          {
            tipo: "CONSOLIDAR_RELACAO",
            fornecedor: "F",
            relacaoAbsorvida: "rel-a",
            relacaoCanonica: "rel-c",
            ofertas: [{ id: "of-1", sourceKey: "k" }],
            eventos: ["ev-1"],
          },
          { tipo: "REMOVER_ITEM", item: "item-a", codigo: "MP-000001" },
        ],
      },
    ],
  } as unknown as Plano;
  const contagens = { Item: 2, SupplierItem: 2, SupplierItemOffer: 2, SupplierItemQualificationHistory: 2, FormulationComponent: 0 };
  const backup = (dados: Record<string, { id: string }[]>, alterar: Partial<typeof contagens> = {}) => ({
    mecanismo: "prisma-logical-json",
    falhas: [],
    contagens: { ...contagens, ...alterar },
    dados,
  });
  const completo = {
    Item: [{ id: "item-a" }, { id: "item-c" }],
    SupplierItem: [{ id: "rel-a" }, { id: "rel-c" }],
    SupplierItemOffer: [{ id: "of-1" }, { id: "of-2" }],
    SupplierItemQualificationHistory: [{ id: "ev-1" }, { id: "ev-2" }],
  };

  it("aceita o backup que cobre o plano e recusa o desatualizado ou incompleto", () => {
    expect(conferirBackup(backup(completo), plano, contagens)).toEqual([]);
    expect(conferirBackup(backup(completo, { SupplierItemOffer: 1 }), plano, contagens)).toEqual([
      "SupplierItemOffer: backup 1 · agora 2",
    ]);
    expect(conferirBackup(backup({ ...completo, Item: [{ id: "item-c" }] }), plano, contagens).join("\n")).toContain(
      "MP-000001 (Item item-a) fora do backup",
    );
    expect(conferirBackup({ mecanismo: "pg_dump" }, plano, contagens)).toHaveLength(1);
  });
});
