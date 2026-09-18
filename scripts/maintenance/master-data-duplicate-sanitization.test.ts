import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { planilhaDoSaneamento } from "./master-data-duplicate-report.js";
import {
  aplicar,
  conferirBackup,
  efeitoEsperado,
  lerVariantes,
  planejar,
  planejarCom,
  verificar,
} from "./master-data-duplicate-sanitization.js";
import type { GrupoPlanejado, OpcoesDaAplicacao, Plano } from "./master-data-duplicate-sanitization.js";
import { cadastroPorChave } from "./master-data-catalog.js";
import { gerarXlsx } from "./xlsx-writer.js";

/**
 * PLAN → APPLY → VERIFY contra o banco de TESTE
 * (MASTER-DATA-DUPLICATE-SANITIZATION-01).
 *
 * As fixtures nascem e saem em cada caso. O cadastro escolhido é o Recurso
 * industrial: está no escopo, é pequeno e nenhuma outra suíte escreve nele —
 * então o que o PLAN encontra é o que este arquivo criou.
 *
 * O PLAN varre a tabela inteira, e o banco de teste é compartilhado com as
 * outras faixas: por isso todo caso procura o SEU grupo pelo id e todo APPLY
 * usa `somente`, nunca "aplique o plano inteiro".
 */

const prisma = new PrismaClient();
/**
 * A trava consultiva é de todas as execuções reais. Este arquivo roda em
 * paralelo com outra suíte que também aplica: cada um usa a sua chave, e a
 * concorrência dentro do arquivo continua provando a trava.
 */
const TRAVA_DO_ARQUIVO = "teste:master-data-duplicate-sanitization";
const aplicarNoArquivo = (cliente: PrismaClient, plano: Plano, opcoes: OpcoesDaAplicacao = {}) =>
  aplicar(cliente, plano, { ...opcoes, trava: TRAVA_DO_ARQUIVO });


afterAll(async () => {
  await prisma.$disconnect();
});

const criados = {
  recursos: [] as string[],
  perfis: [] as string[],
  itens: [] as string[],
};

afterEach(async () => {
  await prisma.productionProfileStepResource.deleteMany({
    where: { OR: [{ industrialResourceId: { in: criados.recursos } }] },
  });
  await prisma.productionProfile.deleteMany({ where: { id: { in: criados.perfis } } });
  await prisma.industrialResourceRate.deleteMany({
    where: { industrialResourceId: { in: criados.recursos } },
  });
  await prisma.industrialResource.deleteMany({ where: { id: { in: criados.recursos } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  criados.recursos = [];
  criados.perfis = [];
  criados.itens = [];
});

let sequencia = Math.floor(Math.random() * 50_000);
const proximoCodigo = (prefixo: string): string => {
  sequencia += 1;
  return `${prefixo}-9${String(sequencia).padStart(5, "0")}`;
};
const marca = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();

async function criarRecurso(
  nome: string,
  extra: {
    powerKw?: number;
    type?: "LABOR" | "EQUIPMENT";
    notes?: string;
    /** Dois `create` seguidos empatam no `createdAt` do banco; quem testa a
     * antiguidade precisa da data explícita, senão o desempate cai no código. */
    criadoEm?: Date;
  } = {},
) {
  const recurso = await prisma.industrialResource.create({
    data: {
      code: proximoCodigo("REC"),
      name: nome,
      type: extra.type ?? "EQUIPMENT",
      defaultUsageUom: "HOUR",
      ...(extra.powerKw !== undefined ? { powerKw: extra.powerKw } : {}),
      ...(extra.notes !== undefined ? { notes: extra.notes } : {}),
      ...(extra.criadoEm !== undefined ? { createdAt: extra.criadoEm } : {}),
    },
  });
  criados.recursos.push(recurso.id);
  return recurso;
}

async function criarTarifa(recursoId: string) {
  return prisma.industrialResourceRate.create({
    data: { industrialResourceId: recursoId, rateValue: "10.0000", currencyCode: "BRL", rateUom: "HOUR" },
  });
}

/** Uma etapa de Perfil de Produção, para provar colisão de índice único. */
async function criarEtapa() {
  const perfil = await prisma.productionProfile.create({
    data: {
      code: proximoCodigo("PPR"),
      name: `Perfil ${marca()}`,
      versions: {
        create: {
          versionNumber: 1,
          referenceQuantity: "1",
          referenceUomCode: "kg",
          steps: { create: { sequence: 1, name: "Etapa", runDurationMinutes: 10 } },
        },
      },
    },
    include: { versions: { include: { steps: true } } },
  });
  criados.perfis.push(perfil.id);
  return perfil.versions[0]!.steps[0]!;
}

const planoDoRecurso = (): Promise<Plano> => planejar(prisma, ["INDUSTRIAL_RESOURCE"]);

function acharGrupo(plano: Plano, nome: string): GrupoPlanejado {
  const grupo = plano.grupos.find((g) => g.chaveDoNome === nome.trim().toUpperCase());
  if (!grupo) throw new Error(`grupo "${nome}" não saiu no plano: ${plano.grupos.map((g) => g.grupo).join(", ")}`);
  return grupo;
}

/* ------------------------------------------------------------------ *
 * PLAN — o que é duplicata
 * ------------------------------------------------------------------ */

describe("PLAN — a regra do PO", () => {
  it("caixa diferente é o MESMO nome, e o grupo sai PRONTO", async () => {
    const nome = `Encapsuladora ${marca()}`;
    const antigo = await criarRecurso(nome);
    const novo = await criarRecurso(nome.toUpperCase());

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    expect(grupo.situacao).toBe("PRONTO");
    expect(grupo.motivos).toEqual([]);
    expect([grupo.canonico.codigo, ...grupo.absorvidos.map((a) => a.codigo)].sort()).toEqual(
      [antigo.code, novo.code].sort(),
    );
  });

  it("espaço nas pontas não cria cadastro novo", async () => {
    const nome = `Mistura ${marca()}`;
    await criarRecurso(`  ${nome} `);
    await criarRecurso(nome);
    expect(acharGrupo(await planoDoRecurso(), nome).situacao).toBe("PRONTO");
  });

  it("acento diferente NÃO é duplicata — vira variante para a Veridi decidir", async () => {
    const sufixo = marca();
    const a = await criarRecurso(`Balanca ${sufixo}`);
    const b = await criarRecurso(`BALANÇA ${sufixo}`);

    const plano = await planoDoRecurso();
    expect(plano.grupos.some((g) => g.chaveDoNome.includes(sufixo))).toBe(false);

    const variantes = await prisma.$transaction((tx) => lerVariantes(tx, cadastroPorChave("INDUSTRIAL_RESOURCE")));
    const minha = variantes.find((v) => v.registros.some((r) => r.codigo === a.code));
    expect(minha?.motivo).toBe("ACENTO");
    expect(minha?.registros.map((r) => r.codigo).sort()).toEqual([a.code, b.code].sort());
  });

  it("nome diferente não vira grupo", async () => {
    const sufixo = marca();
    await criarRecurso(`Moinho ${sufixo}`);
    await criarRecurso(`Moinho ${sufixo} B`);
    const plano = await planoDoRecurso();
    expect(plano.grupos.filter((g) => g.chaveDoNome.includes(sufixo))).toEqual([]);
  });
});

describe("PLAN — critério de canônico e referências", () => {
  it("registro sem referência nenhuma: canônico é o mais antigo, e nada se move", async () => {
    const nome = `Seladora ${marca()}`;
    // O mais antigo é o de código MAIOR: se o critério caísse no código, o
    // teste passaria sem provar a antiguidade.
    await criarRecurso(nome.toLowerCase(), { criadoEm: new Date("2026-01-02T00:00:00.000Z") });
    const primeiro = await criarRecurso(nome, { criadoEm: new Date("2026-01-01T00:00:00.000Z") });

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    expect(grupo.canonico.codigo).toBe(primeiro.code);
    expect(grupo.criterio).toBe("mais-antigo");
    expect(grupo.movimentos).toEqual([]);
  });

  it("registro com FK ganha o canônico, e a FK entra como movimento", async () => {
    const nome = `Envasadora ${marca()}`;
    await criarRecurso(nome);
    const comHistorico = await criarRecurso(nome.toUpperCase());
    await criarTarifa(comHistorico.id);

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    expect(grupo.canonico.codigo).toBe(comHistorico.code);
    expect(grupo.criterio).toBe("referenciado");
    expect(grupo.movimentos).toEqual([]);
    expect(grupo.canonico.referencias).toEqual([
      { tabela: "industrial_resource_rates", coluna: "industrialResourceId", tipo: "fk", aoApagar: "c", linhas: 1 },
    ]);
  });

  it("FK no absorvido vira movimento declarado, com a tabela e a contagem", async () => {
    const nome = `Rotuladora ${marca()}`;
    const canonico = await criarRecurso(nome);
    await criarTarifa(canonico.id);
    await criarTarifa(canonico.id);
    const absorvido = await criarRecurso(nome.toUpperCase());
    await criarTarifa(absorvido.id);

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    expect(grupo.canonico.codigo).toBe(canonico.code);
    expect(grupo.movimentos).toEqual([
      { tabela: "industrial_resource_rates", coluna: "industrialResourceId", linhas: 1 },
    ]);
    expect(efeitoEsperado([grupo])).toEqual({
      industrial_resource_rates: { ins: 0, upd: 1, del: 0 },
      industrial_resources: { ins: 0, upd: 0, del: 1 },
    });
  });

  it("terceiro duplicado: um canônico e dois absorvidos", async () => {
    const nome = `Peneira ${marca()}`;
    const comUso = await criarRecurso(nome);
    await criarTarifa(comUso.id);
    await criarRecurso(nome.toUpperCase());
    await criarRecurso(` ${nome.toLowerCase()} `);

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    expect(grupo.situacao).toBe("PRONTO");
    expect(grupo.canonico.codigo).toBe(comUso.code);
    expect(grupo.absorvidos).toHaveLength(2);
  });
});

describe("PLAN — ABORTAR / revisão necessária", () => {
  it("conflito de campo bloqueia e diz qual campo e quais valores", async () => {
    const nome = `Compressor ${marca()}`;
    await criarRecurso(nome, { powerKw: 5 });
    await criarRecurso(nome.toUpperCase(), { powerKw: 9 });

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.conflitos).toEqual([{ coluna: "powerKw", valores: ["5", "9"] }]);
    expect(grupo.motivos[0]).toMatch(/conflito material em "powerKw": "5" × "9"/);
    expect(efeitoEsperado([grupo])).toEqual({});
  });

  it("histórico incompatível — tipos diferentes — bloqueia sem escolher", async () => {
    const nome = `Operador ${marca()}`;
    await criarRecurso(nome, { type: "LABOR" });
    await criarRecurso(nome.toUpperCase(), { type: "EQUIPMENT" });

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.conflitos.map((c) => c.coluna)).toContain("type");
  });

  it("o mais completo ganha o canônico, e então não se perde campo nenhum", async () => {
    const nome = `Esteira ${marca()}`;
    await criarRecurso(nome);
    const comNota = await criarRecurso(nome.toUpperCase(), { notes: "observação da fábrica" });

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    expect(grupo.situacao).toBe("PRONTO");
    expect(grupo.criterio).toBe("mais-completo");
    expect(grupo.canonico.codigo).toBe(comNota.code);
    expect(grupo.camposPerdidos).toEqual([]);
  });

  it("campo só no absorvido é PERDA declarada quando o canônico veio da referência", async () => {
    const nome = `Túnel ${marca()}`;
    const referenciado = await criarRecurso(nome);
    await criarTarifa(referenciado.id);
    const absorvido = await criarRecurso(nome.toUpperCase(), { notes: "observação da fábrica" });

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    expect(grupo.situacao).toBe("PRONTO");
    expect(grupo.criterio).toBe("referenciado");
    expect(grupo.canonico.codigo).toBe(referenciado.code);
    // O campo some com o registro: não bloqueia, mas fica escrito no plano e
    // vai inteiro para a planilha da Veridi.
    expect(grupo.camposPerdidos).toEqual([
      { coluna: "notes", codigo: absorvido.code, valor: "observação da fábrica" },
    ]);
  });

  it("colisão de índice único bloqueia antes de tentar o UPDATE", async () => {
    const nome = `Homogeneizador ${marca()}`;
    const canonico = await criarRecurso(nome);
    await criarTarifa(canonico.id);
    const absorvido = await criarRecurso(nome.toUpperCase());
    const etapa = await criarEtapa();
    for (const recurso of [canonico, absorvido]) {
      await prisma.productionProfileStepResource.create({
        data: { productionProfileStepId: etapa.id, industrialResourceId: recurso.id },
      });
    }

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(
      /production_profile_step_resources\.industrialResourceId: mover 1 linha\(s\) repetiria o índice único production_profile_step_resources_step_resource_key/,
    );
  });

  it("Item decidido pela ferramenta da Onda A é recusado aqui", async () => {
    // MP-000032 e MP-000034 são o grupo G1 do arquivo de decisão de
    // ITEM-DUPLICATE-SANITIZATION-01: as duas ferramentas nunca disputam o
    // mesmo registro.
    // Com o corpus carregado no banco de teste (a suíte do importador carrega),
    // os dois já existem com este nome: usa-os, e só cria — e só apaga — o que
    // faltar.
    for (const code of ["MP-000032", "MP-000034"]) {
      const existente = await prisma.item.findUnique({ where: { code } });
      if (existente) {
        expect(existente.name.trim().toUpperCase()).toBe("ÁCIDO NICOTÍNICO");
        continue;
      }
      const item = await prisma.item.create({
        data: { code, type: "RAW_MATERIAL", name: "Ácido nicotínico", unitCode: "kg" },
      });
      criados.itens.push(item.id);
    }
    const plano = await planejar(prisma, ["ITEM"]);
    const grupo = acharGrupo(plano, "Ácido nicotínico");
    expect(grupo.situacao).toBe("BLOQUEADO");
    expect(grupo.motivos.join("\n")).toMatch(
      /está no arquivo de decisão \(Onda A\) — quem executa é item-duplicate-sanitization\.ts --onda=A/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * APPLY e VERIFY
 * ------------------------------------------------------------------ */

describe("APPLY", () => {
  it("remove o absorvido, move a FK e o VERIFY prova", async () => {
    const nome = `Misturador ${marca()}`;
    const canonico = await criarRecurso(nome);
    await criarTarifa(canonico.id);
    const absorvido = await criarRecurso(nome.toUpperCase());
    const tarifaMovida = await criarTarifa(absorvido.id);

    const plano = await planoDoRecurso();
    const grupo = acharGrupo(plano, nome);
    const [resultado] = await aplicarNoArquivo(prisma, plano, { somente: [grupo.grupo] });

    expect(resultado?.situacao).toBe("APLICADO");
    expect(resultado?.efeito).toEqual({
      industrial_resource_rates: { ins: 0, upd: 1, del: 0 },
      industrial_resources: { ins: 0, upd: 0, del: 1 },
    });

    expect(await prisma.industrialResource.findUnique({ where: { id: absorvido.id } })).toBeNull();
    expect(await prisma.industrialResource.findUnique({ where: { id: canonico.id } })).not.toBeNull();
    const tarifa = await prisma.industrialResourceRate.findUniqueOrThrow({ where: { id: tarifaMovida.id } });
    expect(tarifa.industrialResourceId).toBe(canonico.id);
    expect(await prisma.industrialResourceRate.count({ where: { industrialResourceId: canonico.id } })).toBe(2);

    const conferencia = await verificar(prisma, [grupo]);
    expect(conferencia.problemas).toEqual([]);
    expect(conferencia.conferidos).toEqual([grupo.grupo]);
  });

  it("CASCADE não apaga em silêncio: a tarifa do absorvido sobrevive no canônico", async () => {
    const nome = `Dosadora ${marca()}`;
    const canonico = await criarRecurso(nome);
    await criarTarifa(canonico.id);
    const absorvido = await criarRecurso(nome.toUpperCase());
    await criarTarifa(absorvido.id);

    const plano = await planoDoRecurso();
    const grupo = acharGrupo(plano, nome);
    await aplicarNoArquivo(prisma, plano, { somente: [grupo.grupo] });

    // A FK é `onDelete: Cascade`. Sem mover antes, o DELETE levaria a tarifa
    // junto e o "sucesso" esconderia a perda.
    expect(await prisma.industrialResourceRate.count({ where: { industrialResourceId: canonico.id } })).toBe(2);
  });

  it("terceiro duplicado sai em um APPLY só", async () => {
    const nome = `Tanque ${marca()}`;
    const canonico = await criarRecurso(nome);
    await criarTarifa(canonico.id);
    await criarRecurso(nome.toUpperCase());
    await criarRecurso(nome.toLowerCase());

    const plano = await planoDoRecurso();
    const grupo = acharGrupo(plano, nome);
    const [resultado] = await aplicarNoArquivo(prisma, plano, { somente: [grupo.grupo] });

    expect(resultado?.situacao).toBe("APLICADO");
    expect(await prisma.industrialResource.count({ where: { name: { equals: nome, mode: "insensitive" } } })).toBe(1);
  });

  it("grupo BLOQUEADO não é aplicado e não impede o grupo seguro do mesmo plano", async () => {
    const bloqueado = `Autoclave ${marca()}`;
    await criarRecurso(bloqueado, { powerKw: 3 });
    await criarRecurso(bloqueado.toUpperCase(), { powerKw: 8 });
    const seguro = `Bomba ${marca()}`;
    await criarRecurso(seguro);
    const some = await criarRecurso(seguro.toUpperCase());

    const plano = await planoDoRecurso();
    const grupoBloqueado = acharGrupo(plano, bloqueado);
    const grupoSeguro = acharGrupo(plano, seguro);
    const resultados = await aplicarNoArquivo(prisma, plano, {
      somente: [grupoBloqueado.grupo, grupoSeguro.grupo],
    });

    expect(resultados.map((r) => [r.grupo, r.situacao])).toEqual([
      [grupoBloqueado.grupo, "BLOQUEADO"],
      [grupoSeguro.grupo, "APLICADO"],
    ]);
    expect(await prisma.industrialResource.count({ where: { name: { equals: bloqueado, mode: "insensitive" } } })).toBe(2);
    expect(await prisma.industrialResource.findUnique({ where: { id: some.id } })).toBeNull();
  });

  it("recusa arquivo que não é plano desta ferramenta", async () => {
    await expect(aplicarNoArquivo(prisma, { ferramenta: "outra", formato: 1 } as Plano)).rejects.toThrow(
      /não é um plano desta ferramenta/,
    );
  });
});

describe("APPLY — o banco tem de estar no estado do plano", () => {
  it("registro mudou depois do PLAN: o grupo falha e nada é gravado", async () => {
    const nome = `Reator ${marca()}`;
    const canonico = await criarRecurso(nome);
    const absorvido = await criarRecurso(nome.toUpperCase());

    const plano = await planoDoRecurso();
    const grupo = acharGrupo(plano, nome);

    // Alguém editou o absorvido entre o PLAN e o APPLY.
    await prisma.industrialResource.update({ where: { id: absorvido.id }, data: { notes: "mexido depois" } });

    const [resultado] = await aplicarNoArquivo(prisma, plano, { somente: [grupo.grupo] });
    expect(resultado?.situacao).toBe("FALHOU");
    expect(resultado?.motivo).toMatch(/impressão digital diferente/);
    expect(await prisma.industrialResource.findUnique({ where: { id: absorvido.id } })).not.toBeNull();
    expect(await prisma.industrialResource.findUnique({ where: { id: canonico.id } })).not.toBeNull();
  });

  it("referência nova depois do PLAN: o grupo falha e a referência continua onde estava", async () => {
    const nome = `Centrífuga ${marca()}`;
    const canonico = await criarRecurso(nome);
    await criarTarifa(canonico.id);
    const absorvido = await criarRecurso(nome.toUpperCase());

    const plano = await planoDoRecurso();
    const grupo = acharGrupo(plano, nome);
    const tarifaNova = await criarTarifa(absorvido.id);

    const [resultado] = await aplicarNoArquivo(prisma, plano, { somente: [grupo.grupo] });
    expect(resultado?.situacao).toBe("FALHOU");
    expect(resultado?.motivo).toMatch(/as referências a mover mudaram|impressão digital diferente/);
    const tarifa = await prisma.industrialResourceRate.findUniqueOrThrow({ where: { id: tarifaNova.id } });
    expect(tarifa.industrialResourceId).toBe(absorvido.id);
  });

  it("grupo que sumiu do banco falha sem derrubar os outros", async () => {
    const nome = `Filtro ${marca()}`;
    await criarRecurso(nome);
    const absorvido = await criarRecurso(nome.toUpperCase());

    const plano = await planoDoRecurso();
    const grupo = acharGrupo(plano, nome);
    await prisma.industrialResource.delete({ where: { id: absorvido.id } });

    const [resultado] = await aplicarNoArquivo(prisma, plano, { somente: [grupo.grupo] });
    expect(resultado?.situacao).toBe("FALHOU");
    expect(resultado?.motivo).toMatch(/não existe mais no banco/);
  });
});

describe("concorrência", () => {
  it("duas aplicações ao mesmo tempo: a segunda espera a trava e não duplica o trabalho", async () => {
    const nome = `Extrusora ${marca()}`;
    const canonico = await criarRecurso(nome);
    const absorvido = await criarRecurso(nome.toUpperCase());

    const plano = await planoDoRecurso();
    const grupo = acharGrupo(plano, nome);

    // Segundo cliente, conexão própria — é o caso real de duas sessões.
    const outro = new PrismaClient();
    try {
      const [primeiro, segundo] = await Promise.all([
        aplicarNoArquivo(prisma, plano, { somente: [grupo.grupo] }),
        aplicarNoArquivo(outro, plano, { somente: [grupo.grupo] }),
      ]);
      const situacoes = [primeiro[0]?.situacao, segundo[0]?.situacao].sort();
      // Uma aplica; a outra é recusada pela trava consultiva ou pela releitura
      // do estado — nunca as duas removem, nunca as duas gravam.
      expect(situacoes).toEqual(["APLICADO", "FALHOU"]);
      const perdedor = [primeiro[0], segundo[0]].find((r) => r?.situacao === "FALHOU");
      expect(perdedor?.motivo).toMatch(/saneamento está em andamento|não existe mais no banco|não está no estado do plano/);
    } finally {
      await outro.$disconnect();
    }

    expect(await prisma.industrialResource.findUnique({ where: { id: absorvido.id } })).toBeNull();
    expect(await prisma.industrialResource.findUnique({ where: { id: canonico.id } })).not.toBeNull();
  });

  it("PLAN não grava nada — a transação é READ ONLY", async () => {
    const nome = `Bomba de vácuo ${marca()}`;
    await criarRecurso(nome);
    await criarRecurso(nome.toUpperCase());

    const antes = await prisma.industrialResource.count();
    await planoDoRecurso();
    await planoDoRecurso();
    expect(await prisma.industrialResource.count()).toBe(antes);
  });
});

describe("VERIFY", () => {
  it("acusa o absorvido que continuou no banco", async () => {
    const nome = `Prensa ${marca()}`;
    await criarRecurso(nome);
    await criarRecurso(nome.toUpperCase());

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    const resultado = await verificar(prisma, [grupo]);
    expect(resultado.problemas.join("\n")).toMatch(/o absorvido .* continua no banco/);
    expect(resultado.problemas.join("\n")).toMatch(/2 cadastro\(s\) com o nome/);
  });

  it("lista a duplicidade que ainda existe no cadastro", async () => {
    const nome = `Elevador ${marca()}`;
    await criarRecurso(nome);
    await criarRecurso(nome.toUpperCase());

    const grupo = acharGrupo(await planoDoRecurso(), nome);
    const resultado = await verificar(prisma, [grupo]);
    expect(resultado.duplicidades.some((d) => d.nome === nome.trim().toUpperCase())).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Excel
 * ------------------------------------------------------------------ */

describe("planilha da rodada", () => {
  it("uma linha por absorvido, com o resultado real de cada grupo", async () => {
    const seguro = `Serra ${marca()}`;
    const fica = await criarRecurso(seguro);
    await criarTarifa(fica.id);
    const some = await criarRecurso(seguro.toUpperCase(), { notes: "nota que some" });
    const bloqueado = `Tacho ${marca()}`;
    await criarRecurso(bloqueado, { powerKw: 1 });
    const emRevisao = await criarRecurso(bloqueado.toUpperCase(), { powerKw: 2 });

    const plano = await planoDoRecurso();
    const grupoSeguro = acharGrupo(plano, seguro);
    const grupoBloqueado = acharGrupo(plano, bloqueado);
    const resultados = await aplicarNoArquivo(prisma, plano, { somente: [grupoSeguro.grupo] });

    const abas = planilhaDoSaneamento(plano, resultados, plano.variantes);
    expect(abas.map((a) => a.nome)).toEqual(["Removidos", "Resumo", "Revisão necessária"]);
    expect(abas[0]!.cabecalho).toEqual([
      "Tipo de cadastro",
      "Código/ID removido",
      "Nome original",
      "Código/ID canônico",
      "Nome canônico",
      "Motivo da consolidação",
      "Referências encontradas",
      "Referências movidas",
      "Data da ação",
      "Resultado",
      "Observação",
    ]);

    const linhaRemovida = abas[0]!.linhas.find((l) => l[1] === some.code)!;
    expect(linhaRemovida[0]).toBe("Recurso industrial");
    expect(linhaRemovida[9]).toBe("REMOVIDO");
    expect(String(linhaRemovida[10])).toContain("nota que some");
    expect(String(linhaRemovida[8])).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const linhaBloqueada = abas[0]!.linhas.find((l) => l[1] === emRevisao.code)!;
    expect(linhaBloqueada[9]).toBe("BLOQUEADO — revisão necessária");
    expect(String(linhaBloqueada[5])).toMatch(/conflito material em "powerKw"/);

    const revisao = abas[2]!.linhas.find((l) => String(l[1]) === bloqueado.trim().toUpperCase())!;
    expect(String(revisao[4])).toMatch(/powerKw/);

    // E o arquivo abre: o pacote é gerado de ponta a ponta.
    expect(gerarXlsx(abas).length).toBeGreaterThan(1_000);
  });

  it("aba Resumo conta grupos, removidos e bloqueados por cadastro", async () => {
    const nome = `Caldeira ${marca()}`;
    await criarRecurso(nome);
    await criarRecurso(nome.toUpperCase());

    const plano = await planoDoRecurso();
    const grupo = acharGrupo(plano, nome);
    const resultados = await aplicarNoArquivo(prisma, plano, { somente: [grupo.grupo] });

    const resumo = planilhaDoSaneamento(plano, resultados)[1]!;
    const linha = resumo.linhas.find((l) => l[1] === "industrial_resources")!;
    expect(linha[0]).toBe("Recurso industrial");
    expect(Number(linha[2])).toBeGreaterThanOrEqual(1);
    expect(Number(linha[4])).toBe(1);
    expect(Number(linha[5])).toBe(1);
  });

  it("sem APPLY, a planilha diz NÃO APLICADO em vez de inventar remoção", async () => {
    const nome = `Câmara fria ${marca()}`;
    await criarRecurso(nome);
    const absorvido = await criarRecurso(nome.toUpperCase());

    const plano = await planoDoRecurso();
    const linha = planilhaDoSaneamento(plano, [])[0]!.linhas.find((l) => l[1] === absorvido.code)!;
    expect(linha[9]).toBe("NÃO APLICADO (somente PLAN)");
    expect(String(linha[7])).toMatch(/^previsto: /);
  });
});

describe("o backup tem de cobrir o plano", () => {
  const MODELS = {
    industrial_resources: "IndustrialResource",
    industrial_resource_rates: "IndustrialResourceRate",
  };

  async function planoComGrupo(): Promise<{ plano: Plano; grupo: GrupoPlanejado; absorvido: string }> {
    const nome = `Granuladora ${marca()}`;
    await criarRecurso(nome);
    await criarRecurso(nome.toUpperCase());
    const plano = await planoDoRecurso();
    const grupo = acharGrupo(plano, nome);
    return { plano: { ...plano, grupos: [grupo] }, grupo, absorvido: grupo.absorvidos[0]!.id };
  }

  const backupDe = (absorvido: string, contagens: Record<string, number>) => ({
    mecanismo: "prisma-logical-json",
    falhas: [],
    contagens,
    dados: { IndustrialResource: [{ id: absorvido }], IndustrialResourceRate: [] },
  });

  it("aceita backup com as mesmas contagens e o absorvido dentro", async () => {
    const { plano, absorvido } = await planoComGrupo();
    const contagens = { IndustrialResource: 7, IndustrialResourceRate: 3 };
    expect(conferirBackup(backupDe(absorvido, contagens), plano, MODELS, contagens)).toEqual([]);
  });

  it("recusa arquivo que não é backup lógico", async () => {
    const { plano } = await planoComGrupo();
    expect(conferirBackup({ qualquer: "coisa" }, plano, MODELS, {})).toEqual([
      "não é um backup de scripts/maintenance/prod-backup-json.mjs",
    ]);
  });

  it("recusa backup de antes de outra gravação — contagem diferente da atual", async () => {
    const { plano, absorvido } = await planoComGrupo();
    const problemas = conferirBackup(
      backupDe(absorvido, { IndustrialResource: 7, IndustrialResourceRate: 3 }),
      plano,
      MODELS,
      { IndustrialResource: 9, IndustrialResourceRate: 3 },
    );
    expect(problemas).toEqual(["IndustrialResource: backup 7 · agora 9"]);
  });

  it("recusa backup sem a linha que vai ser removida", async () => {
    const { plano, grupo } = await planoComGrupo();
    const contagens = { IndustrialResource: 7, IndustrialResourceRate: 3 };
    const problemas = conferirBackup(backupDe("outro-id", contagens), plano, MODELS, contagens);
    expect(problemas).toEqual([`${grupo.grupo}: ${grupo.absorvidos[0]!.codigo} não está no backup`]);
  });

  it("recusa backup que registrou falha ao ler algum conjunto", async () => {
    const { plano, absorvido } = await planoComGrupo();
    const backup = { ...backupDe(absorvido, {}), falhas: ["Item"] };
    expect(conferirBackup(backup, plano, MODELS, {})).toEqual(["o backup registrou 1 falha(s)"]);
  });
});

describe("plano completo", () => {
  it("carrega ferramenta, formato, banco e impressão digital", async () => {
    const plano = await prisma.$transaction((tx) => planejarCom(tx, ["INDUSTRIAL_RESOURCE"]));
    expect(plano.ferramenta).toBe("master-data-duplicate-sanitization");
    expect(plano.formato).toBe(1);
    expect(plano.banco).toMatch(/test/);
    expect(plano.impressao).toMatch(/^[0-9a-f]{64}$/);
    expect(plano.cadastros).toEqual(["INDUSTRIAL_RESOURCE"]);
  });
});
