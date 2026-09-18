import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { DecisaoDeDuplicata } from "../veridi-import/item-duplicates.js";
import { ATOR_DA_IMPORTACAO, planejar as planejarComFerramentaDeItem } from "./item-duplicate-sanitization.js";
import { cadastroPorChave } from "./master-data-catalog.js";
import { planilhaDaOnda } from "./master-data-duplicate-report.js";
import {
  aplicar,
  efeitoEsperado,
  exigirOndaInteira,
  lerVariantes,
  planejar,
  verificar,
} from "./master-data-duplicate-sanitization.js";
import type { GrupoPlanejado, OpcoesDaAplicacao, Plano } from "./master-data-duplicate-sanitization.js";

/**
 * Onda de decisão — PLAN → APPLY → VERIFY contra o banco de TESTE
 * (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01).
 *
 * Cada caso cria os próprios Itens e passa a própria decisão: o arquivo real
 * de decisão não entra. O modo de decisão só toca os códigos da decisão, então
 * o que outras suítes deixarem no banco não muda o resultado.
 */

const prisma = new PrismaClient();
/**
 * A trava consultiva é de todas as execuções reais. Este arquivo roda em
 * paralelo com outra suíte que também aplica: cada um usa a sua chave, e a
 * concorrência dentro do arquivo continua provando a trava.
 */
const TRAVA_DO_ARQUIVO = "teste:master-data-duplicate-wave";
const aplicarNoArquivo = (cliente: PrismaClient, plano: Plano, opcoes: OpcoesDaAplicacao = {}) =>
  aplicar(cliente, plano, { ...opcoes, trava: TRAVA_DO_ARQUIVO });


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

let sequencia = Math.floor(Math.random() * 40_000) + 10_000;
const codigoDoItem = (prefixo: "MP" | "ME" | "PA"): string => {
  sequencia += 1;
  return `${prefixo}-9${String(sequencia).padStart(5, "0")}`;
};
const marca = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();

interface ItemCriado {
  id: string;
  code: string;
  name: string;
  externalCode: string;
}

async function criarItem(
  nome: string,
  extra: { nutriente?: string | null; tipo?: "RAW_MATERIAL" | "PACKAGING"; family?: "MINERAL" | "VITAMIN"; criadoEm?: Date } = {},
): Promise<ItemCriado> {
  const tipo = extra.tipo ?? "RAW_MATERIAL";
  const externalCode = `W2-${marca()}`;
  const item = await prisma.item.create({
    data: {
      code: codigoDoItem(tipo === "RAW_MATERIAL" ? "MP" : "ME"),
      type: tipo,
      name: nome,
      unitCode: tipo === "RAW_MATERIAL" ? "kg" : "un",
      externalCode,
      ...(extra.nutriente !== undefined ? { declaredNutrient: extra.nutriente } : {}),
      ...(extra.family !== undefined ? { family: extra.family } : {}),
      ...(extra.criadoEm !== undefined ? { createdAt: extra.criadoEm } : {}),
    },
  });
  criados.itens.push(item.id);
  return { id: item.id, code: item.code, name: item.name, externalCode };
}

async function criarFornecedor() {
  const m = marca();
  const fornecedor = await prisma.supplier.create({ data: { code: `FOR-W${m}`, legalName: `Fornecedor W2 ${m}` } });
  criados.fornecedores.push(fornecedor.id);
  return fornecedor;
}

/** Relação como a carga inicial grava: dois eventos e uma oferta legada, tudo do importador. */
async function criarRelacaoImportada(itemId: string, supplierId: string, extra: { preferred?: boolean } = {}) {
  const relacao = await prisma.supplierItem.create({
    data: {
      itemId,
      supplierId,
      qualificationStatus: "APPROVED",
      preferred: extra.preferred ?? false,
      createdByNameSnapshot: ATOR_DA_IMPORTACAO,
      updatedByNameSnapshot: ATOR_DA_IMPORTACAO,
    },
  });
  const eventos = [
    await prisma.supplierItemQualificationHistory.create({
      data: { supplierItemId: relacao.id, fromStatus: null, toStatus: "PENDING", note: "Relacao importada da planilha", changedByNameSnapshot: ATOR_DA_IMPORTACAO },
    }),
    await prisma.supplierItemQualificationHistory.create({
      data: { supplierItemId: relacao.id, fromStatus: "PENDING", toStatus: "APPROVED", note: "Homologacao marcada na planilha", changedByNameSnapshot: ATOR_DA_IMPORTACAO },
    }),
  ];
  const oferta = await prisma.supplierItemOffer.create({
    data: {
      supplierItemId: relacao.id,
      unitPrice: "10",
      currencyCode: "BRL",
      priceUomCode: "kg",
      source: "LEGACY_IMPORT",
      sourceKey: `teste-onda-${marca()}-${marca()}`,
      createdByNameSnapshot: ATOR_DA_IMPORTACAO,
    },
  });
  return { relacao, oferta, eventos };
}

async function criarVersao(status: "ACTIVE" | "DRAFT" | "INACTIVE") {
  const m = marca();
  const acabado = await prisma.item.create({
    data: { code: codigoDoItem("PA"), type: "FINISHED_PRODUCT", name: `Produto W2 ${m}`, unitCode: "un" },
  });
  criados.itens.push(acabado.id);
  const produto = await prisma.product.create({
    data: { code: `PROD-W${m}`, name: `Produto W2 ${m}`, finishedProductItemId: acabado.id },
  });
  criados.produtos.push(produto.id);
  return prisma.formulationVersion.create({
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
}

async function criarComponente(versaoId: string, itemId: string, posicao = 0) {
  return prisma.formulationComponent.create({
    data: {
      formulationVersionId: versaoId,
      itemId,
      quantity: "2.5",
      unitCode: "kg",
      position: posicao,
      // Fora do padrão (FIXED_BASIS): se a troca mexesse na base, o teste via.
      basis: "PER_DOSE",
      purityPercentApplied: "97.5",
      applyPurityAdjustment: true,
    },
  });
}

/** Um grupo de decisão: um par por absorvido, todos com o mesmo canônico. */
function decisaoDoGrupo(
  onda: string,
  canonico: ItemCriado,
  absorvidos: readonly ItemCriado[],
  extra: { consolidar?: string; equivalentes?: Record<string, string>; nomeDoAbsorvido?: string } = {},
): DecisaoDeDuplicata[] {
  return absorvidos.map((absorvido) => ({
    onda,
    grupo: "G1",
    nome: canonico.name,
    absorvido: { codigo: absorvido.code, codigoPlanilha: absorvido.externalCode },
    canonico: { codigo: canonico.code, codigoPlanilha: canonico.externalCode },
    ...(extra.consolidar !== undefined
      ? {
          consolidar: {
            declaredNutrient: extra.consolidar,
            ...(extra.equivalentes !== undefined ? { equivalentes: extra.equivalentes } : {}),
          },
        }
      : {}),
    ...(extra.nomeDoAbsorvido !== undefined ? { nomeDoAbsorvido: extra.nomeDoAbsorvido } : {}),
  }));
}

const onda = (): string => `T${marca()}`;
const planoDa = (o: string, decisoes: readonly DecisaoDeDuplicata[]): Promise<Plano> =>
  planejar(prisma, ["ITEM"], { onda: o, decisoes });
const unico = (plano: Plano): GrupoPlanejado => {
  expect(plano.grupos).toHaveLength(1);
  return plano.grupos[0]!;
};

/* ------------------------------------------------------------------ *
 * PLAN
 * ------------------------------------------------------------------ */

describe("PLAN da onda — canonicalUpdates e a regra do nutriente", () => {
  it("grupo de três: canônico pelo critério, ANTES/DEPOIS do nutriente e a equivalência declarada na decisão", async () => {
    const nome = `Tomate W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Clorogênico**" });
    const fornecedor = await criarFornecedor();
    await criarRelacaoImportada(canonico.id, fornecedor.id);
    const a = await criarItem(nome, { nutriente: "Adenosina" });
    const b = await criarItem(nome, { nutriente: "Clorogênico" });
    const o = onda();

    const grupo = unico(
      await planoDa(
        o,
        decisaoDoGrupo(o, canonico, [a, b], {
          consolidar: "Clorogênico** · Adenosina",
          equivalentes: { "Clorogênico": "Clorogênico**" },
        }),
      ),
    );
    expect(grupo.situacao).toBe("PRONTO");
    expect(grupo.canonico.codigo).toBe(canonico.code);
    expect(grupo.criterio).toBe("referenciado");
    expect(grupo.absorvidos.map((x) => x.codigo)).toEqual([a.code, b.code]);
    expect(grupo.atualizacoes).toEqual([
      {
        coluna: "declaredNutrient",
        antes: "Clorogênico**",
        depois: "Clorogênico** · Adenosina",
        fundidos: [{ termo: "Clorogênico", em: "Clorogênico**", motivo: "decisão" }],
      },
    ]);
    // A escrita no canônico entra no efeito previsto: um UPDATE e as remoções.
    expect(efeitoEsperado([grupo])).toEqual({ items: { ins: 0, upd: 1, del: 2 } });
  });

  it("asterisco não é regra: sem a equivalência declarada, 'Clorogênico' e 'Clorogênico**' ficam separados e o grupo BLOQUEIA", async () => {
    const nome = `Tomate sem equivalência W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Clorogênico**" });
    const a = await criarItem(nome, { nutriente: "Adenosina" });
    const b = await criarItem(nome, { nutriente: "Clorogênico" });
    const o = onda();

    const grupo = unico(
      await planoDa(o, decisaoDoGrupo(o, canonico, [a, b], { consolidar: "Clorogênico** · Adenosina" })),
    );
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toContain(
      'declaredNutrient consolidado dá "Clorogênico** · Adenosina · Clorogênico", e a decisão espera "Clorogênico** · Adenosina"',
    );
    expect(grupo.atualizacoes).toEqual([]);
    expect(efeitoEsperado([grupo])).toEqual({});
  });

  it("o cálculo diferente do valor escrito na decisão BLOQUEIA — nada é escrito sem estar decidido", async () => {
    const nome = `Fosfato W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Cálcio" });
    const absorvido = await criarItem(nome, { nutriente: "Fósforo" });
    const o = onda();

    const grupo = unico(await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "Cálcio · Magnésio" })));
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(
      /declaredNutrient consolidado dá "Cálcio · Fósforo", e a decisão espera "Cálcio · Magnésio"/,
    );
    expect(efeitoEsperado([grupo])).toEqual({});
  });

  it("sem consolidação na decisão, nutriente diferente continua sendo conflito material", async () => {
    const nome = `Fosfato sem consolidação ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Cálcio" });
    const absorvido = await criarItem(nome, { nutriente: "Fósforo" });
    const o = onda();

    const grupo = unico(await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido])));
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(/conflito material em "declaredNutrient"/);
  });

  it("só a coluna consolidada pode divergir: outro campo diferente BLOQUEIA", async () => {
    const nome = `Mineral W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Cálcio", family: "MINERAL" });
    const absorvido = await criarItem(nome, { nutriente: "Fósforo", family: "VITAMIN" });
    const o = onda();

    const grupo = unico(await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "Cálcio · Fósforo" })));
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(/conflito material em "family"/);
  });

  it("o critério aprovado tem de chegar ao canônico da decisão", async () => {
    const nome = `Critério W2 ${marca()}`;
    const semUso = await criarItem(nome, { nutriente: "A" });
    const comUso = await criarItem(nome, { nutriente: "B" });
    const fornecedor = await criarFornecedor();
    await criarRelacaoImportada(comUso.id, fornecedor.id);
    const o = onda();

    // A decisão diz "semUso", mas o critério escolhe o referenciado.
    const grupo = unico(await planoDa(o, decisaoDoGrupo(o, semUso, [comUso], { consolidar: "A · B" })));
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(new RegExp(`o critério escolhe ${comUso.code}`));
  });

  it("Item com o nome do grupo fora da decisão BLOQUEIA: o grupo mudou", async () => {
    const nome = `Membrana W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Colágeno" });
    const absorvido = await criarItem(nome, { nutriente: "Elastina" });
    const intruso = await criarItem(nome.toUpperCase(), { nutriente: "Colágeno" });
    const o = onda();

    const grupo = unico(await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "Colágeno · Elastina" })));
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(new RegExp(`${intruso.code} tem o nome do grupo e não está na decisão`));
  });
});

describe("par nomeado — fora da regra automática, só pela decisão", () => {
  it("acento diferente vira grupo pela decisão, e a regra automática continua separando", async () => {
    const sufixo = marca();
    const canonico = await criarItem(`Sachê Silica gel W2 ${sufixo}`, { tipo: "PACKAGING" });
    const absorvido = await criarItem(`SACHÊ SÍLICA GEL W2 ${sufixo}`, { tipo: "PACKAGING" });
    const o = onda();

    const grupo = unico(
      await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { nomeDoAbsorvido: absorvido.name })),
    );
    expect(grupo.situacao).toBe("PRONTO");
    expect(grupo.atualizacoes).toEqual([]);

    // Regra automática: sem grupo, e o par aparece como variante de ACENTO.
    const automatico = await planejar(prisma, ["ITEM"]);
    expect(automatico.grupos.some((g) => g.chaveDoNome.includes(sufixo))).toBe(false);
    const variantes = await prisma.$transaction((tx) => lerVariantes(tx, cadastroPorChave("ITEM")));
    expect(variantes.find((v) => v.registros.some((r) => r.codigo === absorvido.code))?.motivo).toBe("ACENTO");

    const [resultado] = await aplicarNoArquivo(prisma, await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { nomeDoAbsorvido: absorvido.name })), {
      decisoes: decisaoDoGrupo(o, canonico, [absorvido], { nomeDoAbsorvido: absorvido.name }),
    });
    expect(resultado?.situacao).toBe("APLICADO");
    expect(await prisma.item.findUnique({ where: { id: absorvido.id } })).toBeNull();
    // O canônico mantém o nome dele: renomear não é desta onda.
    expect((await prisma.item.findUniqueOrThrow({ where: { id: canonico.id } })).name).toBe(canonico.name);
  });

  it("nome do absorvido diferente do nome declarado no par BLOQUEIA", async () => {
    const sufixo = marca();
    const canonico = await criarItem(`Sachê Silica gel W2 ${sufixo}`, { tipo: "PACKAGING" });
    const absorvido = await criarItem(`SACHÊ SÍLICA GEL W2 ${sufixo}`, { tipo: "PACKAGING" });
    const o = onda();

    const grupo = unico(
      await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { nomeDoAbsorvido: `Silica gel outro ${sufixo}` })),
    );
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(new RegExp(`absorvido ${absorvido.code} se chama`));
  });
});

/* ------------------------------------------------------------------ *
 * Relações e Formulação
 * ------------------------------------------------------------------ */

describe("relação Item × Fornecedor — a regra da §110", () => {
  it("mesmo fornecedor consolida ofertas e eventos na relação do canônico; fornecedor novo passa a relação inteira", async () => {
    const nome = `Fornecido W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Cálcio" });
    const absorvido = await criarItem(nome, { nutriente: "Fósforo" });
    const comum = await criarFornecedor();
    const novo = await criarFornecedor();
    const doCanonico = await criarRelacaoImportada(canonico.id, comum.id);
    await criarRelacaoImportada(canonico.id, (await criarFornecedor()).id);
    const doAbsorvidoComum = await criarRelacaoImportada(absorvido.id, comum.id);
    const doAbsorvidoNovo = await criarRelacaoImportada(absorvido.id, novo.id);
    const o = onda();
    const decisoes = decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "Cálcio · Fósforo" });

    const plano = await planoDa(o, decisoes);
    const grupo = unico(plano);
    expect(grupo.situacao).toBe("PRONTO");
    expect(grupo.relacoes?.map((r) => r.operacao.tipo).sort()).toEqual(["CONSOLIDAR_RELACAO", "MOVER_RELACAO"]);
    expect(grupo.movimentos).toEqual([]);
    expect(efeitoEsperado([grupo])).toEqual({
      items: { ins: 0, upd: 1, del: 1 },
      supplier_item_offers: { ins: 0, upd: 1, del: 0 },
      supplier_item_qualification_history: { ins: 0, upd: 2, del: 0 },
      supplier_items: { ins: 0, upd: 1, del: 1 },
    });

    const [resultado] = await aplicarNoArquivo(prisma, plano, { decisoes });
    expect(resultado?.situacao, resultado?.motivo ?? "").toBe("APLICADO");

    // Consolidada: oferta e eventos do absorvido estão na relação do canônico, e a dele saiu.
    expect(await prisma.supplierItem.findUnique({ where: { id: doAbsorvidoComum.relacao.id } })).toBeNull();
    const canonica = await prisma.supplierItem.findUniqueOrThrow({
      where: { id: doCanonico.relacao.id },
      include: { offers: true, qualificationHistory: true },
    });
    expect(canonica.offers.map((x) => x.id).sort()).toEqual([doCanonico.oferta.id, doAbsorvidoComum.oferta.id].sort());
    expect(canonica.qualificationHistory).toHaveLength(4);
    expect((await prisma.supplierItemOffer.findUniqueOrThrow({ where: { id: doAbsorvidoComum.oferta.id } })).sourceKey).toBe(
      doAbsorvidoComum.oferta.sourceKey,
    );
    // Movida: a relação com o fornecedor novo é a mesma linha, agora do canônico.
    expect((await prisma.supplierItem.findUniqueOrThrow({ where: { id: doAbsorvidoNovo.relacao.id } })).itemId).toBe(canonico.id);

    expect((await verificar(prisma, plano.grupos)).problemas).toEqual([]);
  });

  it("relação preferencial no absorvido BLOQUEIA — preferência é decisão de Compras", async () => {
    const nome = `Preferencial W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "A" });
    const absorvido = await criarItem(nome, { nutriente: "B" });
    const fornecedor = await criarFornecedor();
    await criarRelacaoImportada(canonico.id, (await criarFornecedor()).id);
    await criarRelacaoImportada(absorvido.id, fornecedor.id, { preferred: true });
    const o = onda();

    const grupo = unico(await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "A · B" })));
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(/relação preferencial no absorvido/);
  });
});

describe("Formulação — só o Item referenciado muda", () => {
  it("versão ACTIVE com o absorvido: o componente passa ao canônico, e quantidade, unidade, base e pureza ficam", async () => {
    const nome = `Formulado W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Cálcio", criadoEm: new Date("2026-01-01T00:00:00Z") });
    const absorvido = await criarItem(nome, { nutriente: "Fósforo", criadoEm: new Date("2026-01-02T00:00:00Z") });
    const versao = await criarVersao("ACTIVE");
    const componente = await criarComponente(versao.id, absorvido.id);
    // O canônico também é usado — é o "mais histórico" do critério.
    const outraVersao = await criarVersao("ACTIVE");
    await criarComponente(outraVersao.id, canonico.id);
    await criarComponente((await criarVersao("INACTIVE")).id, canonico.id);
    const o = onda();
    const decisoes = decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "Cálcio · Fósforo" });

    const plano = await planoDa(o, decisoes);
    const grupo = unico(plano);
    expect(grupo.situacao, grupo.motivos.join("; ")).toBe("PRONTO");
    expect(grupo.movimentos).toEqual([{ tabela: "formulation_components", coluna: "itemId", linhas: 1 }]);

    const antes = await prisma.formulationComponent.findUniqueOrThrow({ where: { id: componente.id } });
    const [resultado] = await aplicarNoArquivo(prisma, plano, { decisoes });
    expect(resultado?.situacao, resultado?.motivo ?? "").toBe("APLICADO");

    const depois = await prisma.formulationComponent.findUniqueOrThrow({ where: { id: componente.id } });
    expect(depois.itemId).toBe(canonico.id);
    const { itemId: _a, updatedAt: _b, ...resto } = antes;
    const { itemId: _c, updatedAt: _d, ...restoDepois } = depois;
    expect(restoDepois).toEqual(resto);
    expect((await prisma.formulationVersion.findUniqueOrThrow({ where: { id: versao.id } })).status).toBe("ACTIVE");
  });

  it("versão que já tem o canônico BLOQUEIA: seria componente repetido", async () => {
    const nome = `Colisão W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "A" });
    const absorvido = await criarItem(nome, { nutriente: "B" });
    const versao = await criarVersao("ACTIVE");
    await criarComponente(versao.id, canonico.id, 0);
    await criarComponente(versao.id, absorvido.id, 1);
    const o = onda();

    const grupo = unico(await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "A · B" })));
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(/formulation_components\.itemId: mover 1 linha\(s\) repetiria o índice único/);
  });

  it("dois absorvidos na mesma versão BLOQUEIAM, mesmo sem o canônico lá", async () => {
    const nome = `Colisão dupla W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "A" });
    const um = await criarItem(nome, { nutriente: "B" });
    const dois = await criarItem(nome, { nutriente: "C" });
    const versao = await criarVersao("DRAFT");
    await criarComponente(versao.id, um.id, 0);
    await criarComponente(versao.id, dois.id, 1);
    const o = onda();

    const grupo = unico(await planoDa(o, decisaoDoGrupo(o, canonico, [um, dois], { consolidar: "A · B · C" })));
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(/repetiria o índice único formulation_components_formulationVersionId_itemId_key/);
  });
});

/* ------------------------------------------------------------------ *
 * APPLY e VERIFY
 * ------------------------------------------------------------------ */

describe("APPLY e VERIFY da onda", () => {
  it("consolida o nutriente, remove os absorvidos, o VERIFY prova — e rodar de novo dá JÁ SANEADO", async () => {
    const nome = `Arabino W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Fibra Alimentar" });
    const um = await criarItem(nome, { nutriente: "Arabinogalactana" });
    const dois = await criarItem(nome, { nutriente: "FIBRA ALIMENTAR" });
    const o = onda();
    const decisoes = decisaoDoGrupo(o, canonico, [um, dois], { consolidar: "Fibra Alimentar · Arabinogalactana" });

    const plano = await planoDa(o, decisoes);
    const [resultado] = await aplicarNoArquivo(prisma, plano, { decisoes });
    expect(resultado?.situacao, resultado?.motivo ?? "").toBe("APLICADO");
    expect(resultado?.efeito).toEqual({ items: { ins: 0, upd: 1, del: 2 } });

    const gravado = await prisma.item.findUniqueOrThrow({ where: { id: canonico.id } });
    expect(gravado.declaredNutrient).toBe("Fibra Alimentar · Arabinogalactana");
    expect(await prisma.item.count({ where: { id: { in: [um.id, dois.id] } } })).toBe(0);

    const conferencia = await verificar(prisma, plano.grupos);
    expect(conferencia.problemas).toEqual([]);

    // De novo: o grupo já saiu, e o canônico tem o valor decidido.
    const denovo = unico(await planoDa(o, decisoes));
    expect(denovo.situacao).toBe("JA_SANEADO");
    const [nada] = await aplicarNoArquivo(prisma, await planoDa(o, decisoes), { decisoes });
    expect(nada?.situacao).toBe("JA_SANEADO");
  });

  it("mexer no nutriente do canônico depois do PLAN derruba o grupo — a escrita está na impressão", async () => {
    const nome = `Impressão W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Magnésio" });
    const absorvido = await criarItem(nome, { nutriente: "Fósforo" });
    const o = onda();
    const decisoes = decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "Magnésio · Fósforo" });

    const plano = await planoDa(o, decisoes);
    await prisma.item.update({ where: { id: canonico.id }, data: { declaredNutrient: "Magnésio*" } });

    const [resultado] = await aplicarNoArquivo(prisma, plano, { decisoes });
    expect(resultado?.situacao).toBe("FALHOU");
    expect(resultado?.motivo).toMatch(/impressão digital diferente|o que se escreve no canônico mudou/);
    expect(await prisma.item.findUnique({ where: { id: absorvido.id } })).not.toBeNull();
    expect((await prisma.item.findUniqueOrThrow({ where: { id: canonico.id } })).declaredNutrient).toBe("Magnésio*");
  });

  it("arquivo de decisão diferente do plano: o APPLY recusa antes de tocar em qualquer grupo", async () => {
    const nome = `Decisão mudou W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "A" });
    const absorvido = await criarItem(nome, { nutriente: "B" });
    const o = onda();
    const plano = await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "A · B" }));

    await expect(
      aplicarNoArquivo(prisma, plano, { decisoes: decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "B · A" }) }),
    ).rejects.toThrow(/arquivo de decisão da Onda .* mudou desde o plano/);
    expect(await prisma.item.findUnique({ where: { id: absorvido.id } })).not.toBeNull();
  });

  it("a onda só aplica inteira: um grupo fora de PRONTO recusa o APPLY", async () => {
    const nome = `Inteira W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "A" });
    const absorvido = await criarItem(nome, { nutriente: "B" });
    const o = onda();
    const bloqueado = await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "A · C" }));
    expect(() => exigirOndaInteira(bloqueado)).toThrow(/só aplica com todos os grupos PRONTO \(0\/1\)/);

    const pronto = await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "A · B" }));
    expect(() => exigirOndaInteira(pronto)).not.toThrow();
  });

  it("a ferramenta de Item recusa a onda de grupo e aponta a ferramenta genérica", async () => {
    const nome = `Recusa W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "A" });
    const absorvido = await criarItem(nome, { nutriente: "B" });
    const o = onda();
    await expect(
      planejarComFerramentaDeItem(prisma, o, decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "A · B" })),
    ).rejects.toThrow(new RegExp(`master-data-duplicate-sanitization\\.ts --onda=${o}`));
  });
});

/* ------------------------------------------------------------------ *
 * Planilha
 * ------------------------------------------------------------------ */

describe("planilha da onda", () => {
  it("uma linha por removido, com campo consolidado, ANTES, DEPOIS, resultado e o que cada um trazia", async () => {
    const nome = `Planilha W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Cálcio" });
    const absorvido = await criarItem(nome, { nutriente: "Fósforo" });
    const sufixo = marca();
    const silica = await criarItem(`Sachê Silica W2 ${sufixo}`, { tipo: "PACKAGING" });
    const silicaAcento = await criarItem(`SACHÊ SÍLICA W2 ${sufixo}`, { tipo: "PACKAGING" });
    const o = onda();
    const decisoes = [
      ...decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "Cálcio · Fósforo" }),
      ...decisaoDoGrupo(o, silica, [silicaAcento], { nomeDoAbsorvido: silicaAcento.name }).map((d) => ({ ...d, grupo: "G2" })),
    ];

    const plano = await planoDa(o, decisoes);
    const resultados = await aplicarNoArquivo(prisma, plano, { decisoes });
    expect(resultados.map((r) => r.situacao)).toEqual(["APLICADO", "APLICADO"]);
    const recontagem = await planejar(prisma, ["ITEM"]);

    const [removidos, resumo, revisao] = planilhaDaOnda(plano, resultados, recontagem);
    expect(removidos!.nome).toBe("REMOVIDOS");
    expect(removidos!.cabecalho).toEqual([
      "Tipo de cadastro",
      "Código removido",
      "Nome removido",
      "Código canônico",
      "Nome canônico",
      "Campo consolidado",
      "Valor anterior",
      "Valor final",
      "Referências encontradas",
      "Referências movidas",
      "Motivo",
      "Resultado",
      "Data/hora",
      "Observação",
    ]);
    const linha = removidos!.linhas.find((l) => l[1] === absorvido.code)!;
    expect(linha.slice(0, 8)).toEqual([
      "Item",
      absorvido.code,
      absorvido.name,
      canonico.code,
      canonico.name,
      "declaredNutrient",
      "Cálcio",
      "Cálcio · Fósforo",
    ]);
    expect(linha[11]).toBe("REMOVIDO");
    expect(String(linha[12])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(linha[13])).toContain('nutriente declarado do removido: "Fósforo"');

    const linhaDoPar = removidos!.linhas.find((l) => l[1] === silicaAcento.code)!;
    expect(linhaDoPar[5]).toBe("");
    expect(String(linhaDoPar[13])).toMatch(/par nomeado por decisão do PO/);

    expect(resumo!.nome).toBe("RESUMO");
    const doItem = resumo!.linhas.find((l) => l[1] === "items")!;
    expect(doItem.slice(2, 6)).toEqual([2, 2, 2, 1]);

    expect(revisao!.nome).toBe("REVISÃO NECESSÁRIA");
    expect(revisao!.cabecalho[3]).toBe("Por que não foi consolidado");
  });

  it("o termo fundido aparece só na linha do registro que o trouxe", async () => {
    const nome = `Tomate planilha W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Clorogênico**" });
    const adenosina = await criarItem(nome, { nutriente: "Adenosina" });
    const clorogenico = await criarItem(nome, { nutriente: "Clorogênico" });
    const o = onda();
    const plano = await planoDa(
      o,
      decisaoDoGrupo(o, canonico, [adenosina, clorogenico], {
        consolidar: "Clorogênico** · Adenosina",
        equivalentes: { "Clorogênico": "Clorogênico**" },
      }),
    );

    const [removidos] = planilhaDaOnda(plano, [], null);
    const observacao = (codigo: string) => String(removidos!.linhas.find((l) => l[1] === codigo)![13]);
    expect(observacao(clorogenico.code)).toContain(
      '"Clorogênico" é o mesmo termo de "Clorogênico**" (equivalência declarada na decisão do grupo)',
    );
    expect(observacao(adenosina.code)).not.toContain("mesmo termo");
    expect(observacao(adenosina.code)).toContain('nutriente declarado do removido: "Adenosina"');
  });

  it("sem APPLY, a planilha diz NÃO APLICADO e mostra o previsto", async () => {
    const nome = `Prévia W2 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "A" });
    const absorvido = await criarItem(nome, { nutriente: "B" });
    const o = onda();
    const plano = await planoDa(o, decisaoDoGrupo(o, canonico, [absorvido], { consolidar: "A · B" }));

    const [removidos, , revisao] = planilhaDaOnda(plano, [], null);
    const linha = removidos!.linhas.find((l) => l[1] === absorvido.code)!;
    expect(linha[11]).toBe("NÃO APLICADO (somente PLAN)");
    expect(linha[7]).toBe("A · B");
    expect(String(revisao!.linhas[0]![3])).toMatch(/sem recontagem global/);
  });
});
