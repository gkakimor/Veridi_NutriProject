import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { impressaoDasDecisoes } from "../veridi-import/item-duplicates.js";
import type {
  ConjuntoDeDecisoes,
  DecisaoDeDuplicata,
  DecisaoDeExclusaoDeAgregado,
  DecisaoDeRenomeacao,
  DecisaoDeRevisao,
} from "../veridi-import/item-duplicates.js";
import { ATOR_DA_IMPORTACAO } from "./item-duplicate-sanitization.js";
import { planilhaDaOnda } from "./master-data-duplicate-report.js";
import {
  aplicar,
  efeitoEsperado,
  exigirOndaInteira,
  planejar,
  verificar,
} from "./master-data-duplicate-sanitization.js";
import type { GrupoPlanejado, OpcoesDaAplicacao, Plano } from "./master-data-duplicate-sanitization.js";

/**
 * Onda 3 — fusão, renomeação, exclusão de agregado sem uso e grupo em revisão,
 * PLAN → APPLY → VERIFY contra o banco de TESTE
 * (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-3-01).
 *
 * Cada caso cria os próprios registros e passa o próprio conjunto de decisões:
 * o arquivo real não entra. O modo de decisão só toca os códigos da decisão.
 */

const prisma = new PrismaClient();
/** Chave própria da trava consultiva: este arquivo roda em paralelo com as outras suítes que aplicam. */
const TRAVA_DO_ARQUIVO = "teste:master-data-duplicate-wave-3";

afterAll(async () => {
  await prisma.$disconnect();
});

const criados = {
  itens: [] as string[],
  fornecedores: [] as string[],
  produtos: [] as string[],
  modelos: [] as string[],
};

afterEach(async () => {
  await prisma.formulationVersion.deleteMany({ where: { productId: { in: criados.produtos } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.formulationTemplate.deleteMany({ where: { id: { in: criados.modelos } } });
  await prisma.supplierItem.deleteMany({
    where: { OR: [{ itemId: { in: criados.itens } }, { supplierId: { in: criados.fornecedores } }] },
  });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  criados.itens = [];
  criados.fornecedores = [];
  criados.produtos = [];
  criados.modelos = [];
});

let sequencia = Math.floor(Math.random() * 40_000) + 10_000;
const proximo = (): string => {
  sequencia += 1;
  return String(sequencia).padStart(5, "0");
};
const marca = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();
const onda = (): string => `W3${marca()}`;

interface ItemCriado {
  id: string;
  code: string;
  name: string;
  externalCode: string;
}

async function criarItem(
  nome: string,
  extra: { nutriente?: string | null; family?: "OTHER_RAW_MATERIAL" | "VITAMIN" } = {},
): Promise<ItemCriado> {
  const externalCode = `W3-${marca()}`;
  const item = await prisma.item.create({
    data: {
      code: `MP-9${proximo()}`,
      type: "RAW_MATERIAL",
      name: nome,
      unitCode: "kg",
      externalCode,
      ...(extra.nutriente !== undefined ? { declaredNutrient: extra.nutriente } : {}),
      ...(extra.family !== undefined ? { family: extra.family } : {}),
    },
  });
  criados.itens.push(item.id);
  return { id: item.id, code: item.code, name: item.name, externalCode };
}

async function criarFornecedor() {
  const m = marca();
  const fornecedor = await prisma.supplier.create({ data: { code: `FOR-W${m}`, legalName: `Fornecedor W3 ${m}` } });
  criados.fornecedores.push(fornecedor.id);
  return fornecedor;
}

/** Relação como a carga inicial grava: dois eventos e uma oferta legada, tudo do importador. */
async function criarRelacaoImportada(itemId: string, supplierId: string) {
  const relacao = await prisma.supplierItem.create({
    data: {
      itemId,
      supplierId,
      qualificationStatus: "APPROVED",
      createdByNameSnapshot: ATOR_DA_IMPORTACAO,
      updatedByNameSnapshot: ATOR_DA_IMPORTACAO,
    },
  });
  await prisma.supplierItemQualificationHistory.create({
    data: { supplierItemId: relacao.id, fromStatus: null, toStatus: "PENDING", note: "Relacao importada da planilha", changedByNameSnapshot: ATOR_DA_IMPORTACAO },
  });
  await prisma.supplierItemQualificationHistory.create({
    data: { supplierItemId: relacao.id, fromStatus: "PENDING", toStatus: "APPROVED", note: "Homologacao marcada na planilha", changedByNameSnapshot: ATOR_DA_IMPORTACAO },
  });
  const oferta = await prisma.supplierItemOffer.create({
    data: {
      supplierItemId: relacao.id,
      unitPrice: "34.2",
      currencyCode: "BRL",
      priceUomCode: "kg",
      source: "LEGACY_IMPORT",
      sourceKey: `teste-onda-3-${marca()}-${marca()}`,
      createdByNameSnapshot: ATOR_DA_IMPORTACAO,
    },
  });
  return { relacao, oferta };
}

async function criarProduto() {
  const m = marca();
  const acabado = await prisma.item.create({
    data: { code: `PA-9${proximo()}`, type: "FINISHED_PRODUCT", name: `Produto W3 ${m}`, unitCode: "un" },
  });
  criados.itens.push(acabado.id);
  const produto = await prisma.product.create({
    data: { code: `PROD-W3${m}`, name: `Produto W3 ${m}`, finishedProductItemId: acabado.id },
  });
  criados.produtos.push(produto.id);
  return { produto, acabado };
}

async function criarVersao(
  status: "ACTIVE" | "DRAFT",
  origem: { versaoDoModelo: string; codigoDoModelo: string } | null = null,
) {
  const { produto, acabado } = await criarProduto();
  return prisma.formulationVersion.create({
    data: {
      productId: produto.id,
      versionNumber: 1,
      status,
      basisQuantity: "100",
      outputItemId: acabado.id,
      outputItemCode: acabado.code,
      outputItemName: acabado.name,
      outputUnitCode: "un",
      ...(origem
        ? {
            originTemplateVersionId: origem.versaoDoModelo,
            originTemplateCode: origem.codigoDoModelo,
            originTemplateVersionNumber: 1,
          }
        : {}),
    },
  });
}

async function criarComponente(versaoId: string, itemId: string, posicao = 0) {
  return prisma.formulationComponent.create({
    data: {
      formulationVersionId: versaoId,
      itemId,
      quantity: "2.45454545",
      unitCode: "kg",
      position: posicao,
      basis: "FIXED_BASIS",
    },
  });
}

interface ModeloCriado {
  id: string;
  code: string;
  name: string;
  versaoId: string;
}

/** Modelo como a biblioteca grava: o Modelo e a V1 DRAFT nascem no mesmo instante. */
async function criarModelo(
  nome: string,
  extra: { status?: "DRAFT" | "ACTIVE"; ativada?: boolean; alteradoDepois?: boolean } = {},
): Promise<ModeloCriado> {
  const quando = new Date(Date.now() - 60_000);
  const modelo = await prisma.formulationTemplate.create({
    data: {
      code: `FT-9${proximo()}`,
      name: nome,
      createdBy: "Administrador local",
      createdAt: quando,
      updatedAt: extra.alteradoDepois ? new Date() : quando,
    },
  });
  criados.modelos.push(modelo.id);
  const versao = await prisma.formulationTemplateVersion.create({
    data: {
      formulationTemplateId: modelo.id,
      versionNumber: 1,
      status: extra.status ?? "DRAFT",
      basisQuantity: "1",
      outputUnitCode: "un",
      createdBy: "Administrador local",
      createdAt: quando,
      ...(extra.ativada ? { activatedAt: new Date(), activatedBy: "Administrador local" } : {}),
    },
  });
  return { id: modelo.id, code: modelo.code, name: modelo.name, versaoId: versao.id };
}

/* --- decisões ------------------------------------------------------- */

const conjunto = (parcial: Partial<ConjuntoDeDecisoes>): ConjuntoDeDecisoes => ({
  fusoes: [],
  renomeacoes: [],
  exclusoes: [],
  revisoes: [],
  ...parcial,
});

function fusao(o: string, canonico: ItemCriado, absorvido: ItemCriado, consolidar: string): DecisaoDeDuplicata {
  return {
    onda: o,
    grupo: "G4",
    nome: canonico.name,
    absorvido: { codigo: absorvido.code, codigoPlanilha: absorvido.externalCode },
    canonico: { codigo: canonico.code, codigoPlanilha: canonico.externalCode },
    consolidar: { declaredNutrient: consolidar },
  };
}

function renomeacao(
  o: string,
  grupo: string,
  nome: string,
  renomear: readonly { item: ItemCriado; para: string }[],
  manter: readonly ItemCriado[] = [],
): DecisaoDeRenomeacao {
  return {
    onda: o,
    grupo,
    cadastro: "ITEM",
    nome,
    renomear: renomear.map(({ item, para }) => ({ codigo: item.code, codigoPlanilha: item.externalCode, de: item.name, para })),
    manter: manter.map((item) => ({ codigo: item.code, codigoPlanilha: item.externalCode, nome: item.name })),
    motivo: "material diferente: nome técnico distinto (§114)",
  };
}

function exclusao(o: string, nome: string, modelos: readonly ModeloCriado[]): DecisaoDeExclusaoDeAgregado {
  return {
    onda: o,
    grupo: "MODELO",
    cadastro: "FORMULATION_TEMPLATE",
    nome,
    excluir: modelos.map((m) => ({ codigo: m.code })),
    motivo: "cadastro de teste nunca usado",
  };
}

function revisao(o: string, nome: string, itens: readonly ItemCriado[]): DecisaoDeRevisao {
  return {
    onda: o,
    grupo: "REV",
    cadastro: "ITEM",
    nome,
    codigos: itens.map((i) => i.code),
    motivo: "em revisão: depende da Veridi",
    perguntas: ['O que significam "*" e "**"?', "Qual o teor de cada um?"],
  };
}

const planoDa = (o: string, c: ConjuntoDeDecisoes): Promise<Plano> => planejar(prisma, ["ITEM"], { onda: o, conjunto: c });
const aplicarNoArquivo = (plano: Plano, c: ConjuntoDeDecisoes, opcoes: OpcoesDaAplicacao = {}) =>
  aplicar(prisma, plano, { ...opcoes, conjunto: c, trava: TRAVA_DO_ARQUIVO });
const grupoDa = (plano: Plano, acao: NonNullable<GrupoPlanejado["acao"]>): GrupoPlanejado => {
  const achados = plano.grupos.filter((g) => g.acao === acao);
  expect(achados).toHaveLength(1);
  return achados[0]!;
};

/* ------------------------------------------------------------------ *
 * MERGE
 * ------------------------------------------------------------------ */

describe("MERGE — duplicado verdadeiro (G4, maçã)", () => {
  it("o canônico com fornecedor absorve, o nutriente vira 'Açúcar de maçã · Carboidrato', a oferta fica — e de novo dá JÁ SANEADO", async () => {
    const nome = `Concentrado de maçã W3 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Açúcar de maçã" });
    const { relacao, oferta } = await criarRelacaoImportada(canonico.id, (await criarFornecedor()).id);
    const absorvido = await criarItem(nome, { nutriente: "Carboidrato", family: "OTHER_RAW_MATERIAL" });
    const o = onda();
    const c = conjunto({ fusoes: [fusao(o, canonico, absorvido, "Açúcar de maçã · Carboidrato")] });

    const plano = await planoDa(o, c);
    const grupo = grupoDa(plano, "MERGE");
    expect(grupo.situacao, grupo.motivos.join("; ")).toBe("PRONTO");
    expect(grupo.canonico.codigo).toBe(canonico.code);
    expect(grupo.criterio).toBe("referenciado");
    expect(grupo.atualizacoes).toEqual([
      { coluna: "declaredNutrient", antes: "Açúcar de maçã", depois: "Açúcar de maçã · Carboidrato", fundidos: [] },
    ]);
    // Forma física nenhuma é inventada: o campo que só o absorvido tinha vai para o relatório, não para o canônico.
    expect(grupo.camposPerdidos).toEqual([{ coluna: "family", codigo: absorvido.code, valor: "OTHER_RAW_MATERIAL" }]);
    expect(efeitoEsperado([grupo])).toEqual({ items: { ins: 0, upd: 1, del: 1 } });

    const [resultado] = await aplicarNoArquivo(plano, c);
    expect(resultado?.situacao, resultado?.motivo ?? "").toBe("APLICADO");
    const gravado = await prisma.item.findUniqueOrThrow({ where: { id: canonico.id } });
    expect(gravado.declaredNutrient).toBe("Açúcar de maçã · Carboidrato");
    expect(gravado.name).toBe(nome);
    expect(gravado.family).toBeNull();
    expect(await prisma.item.findUnique({ where: { id: absorvido.id } })).toBeNull();
    expect((await prisma.supplierItemOffer.findUniqueOrThrow({ where: { id: oferta.id } })).supplierItemId).toBe(relacao.id);

    expect((await verificar(prisma, plano.grupos)).problemas).toEqual([]);
    expect(grupoDa(await planoDa(o, c), "MERGE").situacao).toBe("JA_SANEADO");
  });
});

/* ------------------------------------------------------------------ *
 * RENAME
 * ------------------------------------------------------------------ */

describe("RENAME — mesmo nome, material diferente (§114)", () => {
  it("só o nome muda: relações, ofertas e nutriente ficam; o resultado guarda antes, depois e motivo; de novo dá JÁ SANEADO", async () => {
    const nome = `Extrato de polpa de oliva W3 ${marca()}`;
    const verbascosideo = await criarItem(nome, { nutriente: "Verbascosídeo" });
    const hidroxitirosol = await criarItem(nome, { nutriente: "Hidroxitirosol" });
    const doVerbascosideo = await criarRelacaoImportada(verbascosideo.id, (await criarFornecedor()).id);
    const doHidroxitirosol = await criarRelacaoImportada(hidroxitirosol.id, (await criarFornecedor()).id);
    const o = onda();
    const c = conjunto({
      renomeacoes: [
        renomeacao(o, "G7", nome, [
          { item: verbascosideo, para: `${nome} — Verbascosídeo` },
          { item: hidroxitirosol, para: `${nome} — Hidroxitirosol` },
        ]),
      ],
    });

    const plano = await planoDa(o, c);
    const grupo = grupoDa(plano, "RENAME");
    expect(grupo.situacao, grupo.motivos.join("; ")).toBe("PRONTO");
    expect(grupo.absorvidos).toEqual([]);
    expect(grupo.renomeacoes?.map((r) => [r.codigo, r.de, r.para, r.referencias.map((x) => `${x.tabela}.${x.coluna}=${x.linhas}`)])).toEqual([
      [verbascosideo.code, nome, `${nome} — Verbascosídeo`, ["supplier_items.itemId=1"]],
      [hidroxitirosol.code, nome, `${nome} — Hidroxitirosol`, ["supplier_items.itemId=1"]],
    ]);
    expect(efeitoEsperado([grupo])).toEqual({ items: { ins: 0, upd: 2, del: 0 } });

    const [resultado] = await aplicarNoArquivo(plano, c);
    expect(resultado?.situacao, resultado?.motivo ?? "").toBe("APLICADO");
    expect(resultado?.efeito).toEqual({ items: { ins: 0, upd: 2, del: 0 } });
    expect(resultado?.renomeados).toEqual([
      { codigo: verbascosideo.code, antes: nome, depois: `${nome} — Verbascosídeo`, motivo: "material diferente: nome técnico distinto (§114)" },
      { codigo: hidroxitirosol.code, antes: nome, depois: `${nome} — Hidroxitirosol`, motivo: "material diferente: nome técnico distinto (§114)" },
    ]);
    const depois = await prisma.item.findUniqueOrThrow({ where: { id: verbascosideo.id } });
    expect(depois.name).toBe(`${nome} — Verbascosídeo`);
    expect(depois.declaredNutrient).toBe("Verbascosídeo");
    expect(depois.code).toBe(verbascosideo.code);
    expect((await prisma.supplierItem.findUniqueOrThrow({ where: { id: doVerbascosideo.relacao.id } })).itemId).toBe(verbascosideo.id);
    expect((await prisma.supplierItem.findUniqueOrThrow({ where: { id: doHidroxitirosol.relacao.id } })).itemId).toBe(hidroxitirosol.id);
    expect(await prisma.item.count({ where: { name: nome } })).toBe(0);

    expect((await verificar(prisma, plano.grupos)).problemas).toEqual([]);
    const denovo = await planoDa(o, c);
    expect(grupoDa(denovo, "RENAME").situacao).toBe("JA_SANEADO");
    const [nada] = await aplicarNoArquivo(denovo, c);
    expect(nada?.situacao).toBe("JA_SANEADO");
  });

  it("Formulação ACTIVE continua no MESMO Item: nenhum componente troca de Item, e quem mantém o nome fica como está (guaraná)", async () => {
    const nome = `Guaraná em pó soluvel W3 ${marca()}`;
    const extrato = await criarItem(nome, { nutriente: "EXT GUARANÁ 22%" });
    const soluvel = await criarItem(nome, { nutriente: nome });
    const capsula = await criarVersao("ACTIVE");
    const bebida = await criarVersao("ACTIVE");
    const doExtrato = await criarComponente(capsula.id, extrato.id);
    const doSoluvel = await criarComponente(bebida.id, soluvel.id);
    const o = onda();
    const c = conjunto({
      renomeacoes: [renomeacao(o, "G13", nome, [{ item: extrato, para: `Extrato de guaraná 22% W3 ${marca()}` }], [soluvel])],
    });

    const plano = await planoDa(o, c);
    const grupo = grupoDa(plano, "RENAME");
    expect(grupo.situacao, grupo.motivos.join("; ")).toBe("PRONTO");
    expect(grupo.mantidos?.map((m) => [m.codigo, m.nome])).toEqual([[soluvel.code, nome]]);
    expect(grupo.movimentos).toEqual([]);

    const antes = await prisma.formulationComponent.findMany({ where: { id: { in: [doExtrato.id, doSoluvel.id] } }, orderBy: { id: "asc" } });
    const [resultado] = await aplicarNoArquivo(plano, c);
    expect(resultado?.situacao, resultado?.motivo ?? "").toBe("APLICADO");
    const depois = await prisma.formulationComponent.findMany({ where: { id: { in: [doExtrato.id, doSoluvel.id] } }, orderBy: { id: "asc" } });
    expect(depois).toEqual(antes);
    expect((await prisma.formulationVersion.findUniqueOrThrow({ where: { id: capsula.id } })).status).toBe("ACTIVE");
    expect((await prisma.item.findUniqueOrThrow({ where: { id: soluvel.id } })).name).toBe(nome);
    expect((await verificar(prisma, plano.grupos)).problemas).toEqual([]);
  });

  it("nome destino que já existe em outro Item (sem caixa) ABORTA — a onda não aplica", async () => {
    const nome = `Oliva colisão W3 ${marca()}`;
    const um = await criarItem(nome, { nutriente: "A" });
    const dois = await criarItem(nome, { nutriente: "B" });
    const destino = `${nome} — A`;
    const ocupante = await criarItem(destino.toUpperCase(), { nutriente: "C" });
    const o = onda();
    const c = conjunto({
      renomeacoes: [renomeacao(o, "G7", nome, [{ item: um, para: destino }, { item: dois, para: `${nome} — B` }])],
    });

    const plano = await planoDa(o, c);
    const grupo = grupoDa(plano, "RENAME");
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(new RegExp(`já existe em ${ocupante.code} \\(sem caixa\\): ABORTAR`));
    expect(() => exigirOndaInteira(plano)).toThrow(/só aplica com todos os grupos PRONTO \(0\/1\)/);
    expect(efeitoEsperado([grupo])).toEqual({});
  });

  it("nome gravado mexido depois do PLAN derruba o grupo — o compare-and-set não escreve", async () => {
    const nome = `Oliva mexida W3 ${marca()}`;
    const um = await criarItem(nome, { nutriente: "A" });
    const dois = await criarItem(nome, { nutriente: "B" });
    const o = onda();
    const c = conjunto({
      renomeacoes: [renomeacao(o, "G7", nome, [{ item: um, para: `${nome} — A` }, { item: dois, para: `${nome} — B` }])],
    });
    const plano = await planoDa(o, c);
    await prisma.item.update({ where: { id: um.id }, data: { name: nome.toUpperCase() } });

    const [resultado] = await aplicarNoArquivo(plano, c);
    expect(resultado?.situacao).toBe("FALHOU");
    expect(resultado?.motivo).toMatch(/renomeia de|impressão digital diferente/);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: dois.id } })).name).toBe(nome);
  });
});

/* ------------------------------------------------------------------ *
 * DELETE_UNUSED_AGGREGATE
 * ------------------------------------------------------------------ */

describe("DELETE_UNUSED_AGGREGATE — Modelo de teste nunca usado", () => {
  it("os dois Modelos saem inteiros: o dono e a V1 criada junto, e nada mais — de novo dá JÁ SANEADO", async () => {
    const nome = `X W3 ${marca()}`;
    const um = await criarModelo(nome);
    const dois = await criarModelo(nome);
    const o = onda();
    const c = conjunto({ exclusoes: [exclusao(o, nome, [um, dois])] });

    const plano = await planoDa(o, c);
    expect(plano.cadastros).toEqual(["FORMULATION_TEMPLATE"]);
    const grupo = grupoDa(plano, "DELETE_UNUSED_AGGREGATE");
    expect(grupo.situacao, grupo.motivos.join("; ")).toBe("PRONTO");
    expect(grupo.exclusao?.registros.map((r) => r.codigo)).toEqual([um.code, dois.code].sort());
    expect(grupo.exclusao?.internos.map((i) => [i.tabela, i.id, i.descricao])).toEqual(
      [um, dois]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((m) => ["formulation_template_versions", m.versaoId, "V1 DRAFT"]),
    );
    // Só o dono e as V1 internas: nenhuma outra tabela aparece no efeito previsto.
    expect(efeitoEsperado([grupo])).toEqual({
      formulation_template_versions: { ins: 0, upd: 0, del: 2 },
      formulation_templates: { ins: 0, upd: 0, del: 2 },
    });

    const [resultado] = await aplicarNoArquivo(plano, c);
    expect(resultado?.situacao, resultado?.motivo ?? "").toBe("APLICADO");
    expect(resultado?.efeito).toEqual(efeitoEsperado([grupo]));
    expect(resultado?.excluidos?.map((e) => e.codigo)).toEqual([um.code, dois.code].sort());
    expect(await prisma.formulationTemplate.count({ where: { id: { in: [um.id, dois.id] } } })).toBe(0);
    expect(await prisma.formulationTemplateVersion.count({ where: { id: { in: [um.versaoId, dois.versaoId] } } })).toBe(0);

    expect((await verificar(prisma, plano.grupos)).problemas).toEqual([]);
    expect(grupoDa(await planoDa(o, c), "DELETE_UNUSED_AGGREGATE").situacao).toBe("JA_SANEADO");
  });

  it("Modelo já aplicado BLOQUEIA: Formulação derivada da V1 e proveniência pelo código", async () => {
    const nome = `X aplicado W3 ${marca()}`;
    const aplicado = await criarModelo(nome);
    const vazio = await criarModelo(nome);
    await criarVersao("DRAFT", { versaoDoModelo: aplicado.versaoId, codigoDoModelo: aplicado.code });
    const o = onda();

    const grupo = grupoDa(await planoDa(o, conjunto({ exclusoes: [exclusao(o, nome, [aplicado, vazio])] })), "DELETE_UNUSED_AGGREGATE");
    expect(grupo.situacao).toBe("BLOQUEADO");
    const motivos = grupo.motivos.join("\n");
    expect(motivos).toMatch(/1 Formulação\(ões\) derivada\(s\) da versão/);
    expect(motivos).toMatch(/proveniência: 1 Formulação\(ões\) guardam o código do Modelo/);
    expect(efeitoEsperado([grupo])).toEqual({});
  });

  it("componente na V1 BLOQUEIA: o Modelo não está vazio", async () => {
    const nome = `X com componente W3 ${marca()}`;
    const comComponente = await criarModelo(nome);
    const item = await criarItem(`Componente W3 ${marca()}`);
    await prisma.formulationTemplateComponent.create({
      data: { formulationTemplateVersionId: comComponente.versaoId, itemId: item.id, quantity: "1", unitCode: "kg", position: 0 },
    });
    const o = onda();

    const grupo = grupoDa(await planoDa(o, conjunto({ exclusoes: [exclusao(o, nome, [comComponente])] })), "DELETE_UNUSED_AGGREGATE");
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(/a V1 tem 1 componente\(s\)/);
  });

  it("V1 ACTIVE, V1 que já foi ativada ou Modelo alterado depois de criado BLOQUEIAM", async () => {
    const nome = `X ativo W3 ${marca()}`;
    const ativo = await criarModelo(nome, { status: "ACTIVE", ativada: true });
    const o = onda();
    const grupo = grupoDa(await planoDa(o, conjunto({ exclusoes: [exclusao(o, nome, [ativo])] })), "DELETE_UNUSED_AGGREGATE");
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(/a V1 está ACTIVE, não DRAFT/);
    expect(grupo.motivos.join("\n")).toMatch(/a V1 já foi ativada um dia/);

    const nomeAlterado = `X alterado W3 ${marca()}`;
    const alterado = await criarModelo(nomeAlterado, { alteradoDepois: true });
    const outraOnda = onda();
    const deAlterado = grupoDa(
      await planoDa(outraOnda, conjunto({ exclusoes: [exclusao(outraOnda, nomeAlterado, [alterado])] })),
      "DELETE_UNUSED_AGGREGATE",
    );
    expect(deAlterado.situacao).toBe("BLOQUEADO");
    expect(deAlterado.motivos.join("\n")).toMatch(/foi alterado depois de criado/);
  });

  it("CASCADE só da V1 interna: referência nova entre o PLAN e o APPLY derruba o grupo, e nada é apagado nem anulado", async () => {
    const nome = `X corrida W3 ${marca()}`;
    const modelo = await criarModelo(nome);
    const o = onda();
    const c = conjunto({ exclusoes: [exclusao(o, nome, [modelo])] });
    const plano = await planoDa(o, c);
    expect(grupoDa(plano, "DELETE_UNUSED_AGGREGATE").situacao).toBe("PRONTO");

    // Aplicar o Modelo depois do PLAN: um DELETE agora anularia (SET NULL) a proveniência da Formulação.
    const derivada = await criarVersao("DRAFT", { versaoDoModelo: modelo.versaoId, codigoDoModelo: modelo.code });
    const [resultado] = await aplicarNoArquivo(plano, c);
    expect(resultado?.situacao).toBe("FALHOU");
    expect(resultado?.motivo).toMatch(/não está no estado do plano/);
    expect(await prisma.formulationTemplate.count({ where: { id: modelo.id } })).toBe(1);
    expect((await prisma.formulationVersion.findUniqueOrThrow({ where: { id: derivada.id } })).originTemplateVersionId).toBe(modelo.versaoId);
  });

  it("efeito inesperado aborta: escrita fora do previsto dentro da transação desfaz o grupo inteiro", async () => {
    const nome = `X efeito W3 ${marca()}`;
    const modelo = await criarModelo(nome);
    const alheio = await criarFornecedor();
    const o = onda();
    const c = conjunto({ exclusoes: [exclusao(o, nome, [modelo])] });
    const plano = await planoDa(o, c);

    const [resultado] = await aplicarNoArquivo(plano, c, {
      antesDaConferencia: async (_grupo, tx) => {
        await tx.supplier.update({ where: { id: alheio.id }, data: { legalName: "escrito fora do plano" } });
      },
    });
    expect(resultado?.situacao).toBe("FALHOU");
    expect(resultado?.motivo).toMatch(/a transação mexeu fora do plano/);
    expect(await prisma.formulationTemplate.count({ where: { id: modelo.id } })).toBe(1);
    expect(await prisma.formulationTemplateVersion.count({ where: { id: modelo.versaoId } })).toBe(1);
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: alheio.id } })).legalName).toBe(alheio.legalName);
  });
});

/* ------------------------------------------------------------------ *
 * BLOCKED e a onda inteira
 * ------------------------------------------------------------------ */

describe("BLOCKED — grupo em revisão por decisão do PO", () => {
  it("aparece no PLAN com as perguntas, não impede os decididos, nada nele é tocado — e o VERIFY acusa se alguém mexer", async () => {
    const emRevisao = `Extrato de café verde W3 ${marca()}`;
    const cafeA = await criarItem(emRevisao, { nutriente: "Clorogênico" });
    const cafeB = await criarItem(emRevisao, { nutriente: "Clorogênico**" });
    const nome = `Oliva ao lado W3 ${marca()}`;
    const um = await criarItem(nome, { nutriente: "A" });
    const dois = await criarItem(nome, { nutriente: "B" });
    const o = onda();
    const c = conjunto({
      renomeacoes: [renomeacao(o, "G7", nome, [{ item: um, para: `${nome} — A` }, { item: dois, para: `${nome} — B` }])],
      revisoes: [revisao(o, emRevisao, [cafeA, cafeB])],
    });

    const plano = await planoDa(o, c);
    const bloqueado = grupoDa(plano, "BLOCKED");
    expect(bloqueado.situacao).toBe("BLOQUEADO");
    expect(bloqueado.perguntas).toEqual(['O que significam "*" e "**"?', "Qual o teor de cada um?"]);
    expect(bloqueado.motivos.join("\n")).toMatch(/conflito material em "declaredNutrient"/);
    expect(plano.pronto).toBe(true);
    expect(() => exigirOndaInteira(plano)).not.toThrow();
    expect(efeitoEsperado(plano.grupos)).toEqual({ items: { ins: 0, upd: 2, del: 0 } });

    const antes = await prisma.item.findMany({ where: { id: { in: [cafeA.id, cafeB.id] } }, orderBy: { id: "asc" } });
    const resultados = await aplicarNoArquivo(plano, c);
    expect(Object.fromEntries(resultados.map((r) => [r.grupo, r.situacao]))).toEqual({
      [bloqueado.grupo]: "BLOQUEADO",
      [grupoDa(plano, "RENAME").grupo]: "APLICADO",
    });
    expect(await prisma.item.findMany({ where: { id: { in: [cafeA.id, cafeB.id] } }, orderBy: { id: "asc" } })).toEqual(antes);

    const conferencia = await verificar(prisma, plano.grupos);
    expect(conferencia.problemas).toEqual([]);
    expect(conferencia.conferidos).toContain(`${bloqueado.grupo} (em revisão, intocado)`);

    await prisma.item.update({ where: { id: cafeB.id }, data: { declaredNutrient: "Clorogênico" } });
    expect((await verificar(prisma, plano.grupos)).problemas.join("\n")).toMatch(/\(em revisão\) mudou desde o plano/);
  });
});

describe("ondas anteriores continuam reconhecidas", () => {
  it("onda só de fusões mantém a impressão da decisão de antes — planos da Onda 2 continuam valendo", async () => {
    const nome = `Fosfato W3 ${marca()}`;
    const canonico = await criarItem(nome, { nutriente: "Cálcio" });
    const absorvido = await criarItem(nome, { nutriente: "Fósforo" });
    const o = onda();
    const fusoes = [fusao(o, canonico, absorvido, "Cálcio · Fósforo")];

    const plano = await planoDa(o, conjunto({ fusoes }));
    expect(plano.decisoes).toBe(impressaoDasDecisoes(fusoes));
    expect(plano.cadastros).toEqual(["ITEM"]);
    // Plano gravado antes da Onda 3 não tem `acao`: é fusão.
    const semAcao: Plano = { ...plano, grupos: plano.grupos.map(({ acao: _acao, ...g }) => g) };
    expect(() => exigirOndaInteira(semAcao)).not.toThrow();
    expect(efeitoEsperado(semAcao.grupos)).toEqual(efeitoEsperado(plano.grupos));
  });
});

/* ------------------------------------------------------------------ *
 * Planilha
 * ------------------------------------------------------------------ */

describe("planilha da Onda 3", () => {
  it("REMOVIDOS (fusão e Modelos, com a V1 na observação), RENOMEADOS, RESUMO e REVISÃO NECESSÁRIA com as perguntas", async () => {
    const maca = `Concentrado de maçã planilha W3 ${marca()}`;
    const canonico = await criarItem(maca, { nutriente: "Açúcar de maçã" });
    await criarRelacaoImportada(canonico.id, (await criarFornecedor()).id);
    const absorvido = await criarItem(maca, { nutriente: "Carboidrato" });
    const oliva = `Oliva planilha W3 ${marca()}`;
    const um = await criarItem(oliva, { nutriente: "A" });
    const dois = await criarItem(oliva, { nutriente: "B" });
    const x = `X planilha W3 ${marca()}`;
    const m1 = await criarModelo(x);
    const m2 = await criarModelo(x);
    const cafe = `Café planilha W3 ${marca()}`;
    const cafeA = await criarItem(cafe, { nutriente: "Clorogênico" });
    const cafeB = await criarItem(cafe, { nutriente: "Clorogênico**" });
    const o = onda();
    const c = conjunto({
      fusoes: [fusao(o, canonico, absorvido, "Açúcar de maçã · Carboidrato")],
      renomeacoes: [renomeacao(o, "G7", oliva, [{ item: um, para: `${oliva} — A` }, { item: dois, para: `${oliva} — B` }])],
      exclusoes: [exclusao(o, x, [m1, m2])],
      revisoes: [revisao(o, cafe, [cafeA, cafeB])],
    });

    const plano = await planoDa(o, c);
    expect(plano.grupos.map((g) => [g.acao, g.situacao]).sort()).toEqual([
      ["BLOCKED", "BLOQUEADO"],
      ["DELETE_UNUSED_AGGREGATE", "PRONTO"],
      ["MERGE", "PRONTO"],
      ["RENAME", "PRONTO"],
    ]);
    const resultados = await aplicarNoArquivo(plano, c);
    expect(resultados.filter((r) => r.situacao === "APLICADO")).toHaveLength(3);
    const recontagem = await planejar(prisma, ["ITEM", "FORMULATION_TEMPLATE"]);

    const abas = planilhaDaOnda(plano, resultados, recontagem);
    expect(abas.map((a) => a.nome)).toEqual(["REMOVIDOS", "RENOMEADOS", "RESUMO", "REVISÃO NECESSÁRIA"]);
    const [removidos, renomeados, resumo, revisaoNecessaria] = abas;

    const linhaDoAbsorvido = removidos!.linhas.find((l) => l[1] === absorvido.code)!;
    expect(linhaDoAbsorvido.slice(3, 8)).toEqual([canonico.code, maca, "declaredNutrient", "Açúcar de maçã", "Açúcar de maçã · Carboidrato"]);
    expect(linhaDoAbsorvido[11]).toBe("REMOVIDO");
    const linhaDoModelo = removidos!.linhas.find((l) => l[1] === m1.code)!;
    expect(linhaDoModelo[0]).toBe("Modelo de formulação");
    expect(linhaDoModelo[11]).toBe("EXCLUÍDO");
    expect(String(linhaDoModelo[12])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(linhaDoModelo[13])).toContain(`V1 DRAFT ${m1.versaoId}`);
    // A V1 é filho técnico: não vira linha de cadastro removido.
    expect(removidos!.linhas.some((l) => l[1] === m1.versaoId)).toBe(false);
    // Renomeado e em revisão não estão em REMOVIDOS.
    expect(removidos!.linhas.some((l) => [um.code, dois.code, cafeA.code, cafeB.code].includes(String(l[1])))).toBe(false);

    expect(renomeados!.cabecalho.slice(0, 4)).toEqual(["Tipo de cadastro", "Código", "Nome anterior", "Nome novo"]);
    const linhaRenomeada = renomeados!.linhas.find((l) => l[1] === um.code)!;
    expect(linhaRenomeada.slice(2, 4)).toEqual([oliva, `${oliva} — A`]);
    expect(linhaRenomeada[7]).toBe("RENOMEADO");
    expect(String(linhaRenomeada[8])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(linhaRenomeada[5])).toContain("material diferente");

    const doItem = resumo!.linhas.find((l) => l[1] === "items")!;
    expect(doItem[8]).toBe(2);
    const doModelo = resumo!.linhas.find((l) => l[1] === "formulation_templates")!;
    expect(doModelo[9]).toBe(2);

    const linhaDoCafe = revisaoNecessaria!.linhas.find((l) => String(l[2]).includes(cafeA.code))!;
    expect(String(linhaDoCafe[3])).toContain("em revisão: depende da Veridi");
    expect(String(linhaDoCafe[5])).toMatch(/Perguntas à Veridi \(não inferir a resposta\): 1\) O que significam "\*" e "\*\*"\? 2\) Qual o teor de cada um\?/);
  });
});
