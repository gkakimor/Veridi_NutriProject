import { createHash } from "node:crypto";
import { DECISOES_DE_DUPLICATAS } from "./item-duplicate-decisions.js";

/**
 * Leitura e validação do arquivo de decisão de duplicatas de Item
 * (`item-duplicate-decisions.ts`). Sem banco: importador, ferramenta de
 * saneamento e testes chegam à decisão por aqui, e só por aqui.
 */

export interface LadoDaDecisao {
  /** Código do ERP (MP-000000 / ME-000000). */
  codigo: string;
  /** Código da planilha legada — `Item.externalCode` e CODIGO_PLANILHA do pacote. */
  codigoPlanilha: string;
}

export interface DecisaoDeDuplicata {
  onda: string;
  grupo: string;
  /** Nome do grupo; comparado sem espaço nas pontas e sem caixa. */
  nome: string;
  absorvido: LadoDaDecisao;
  canonico: LadoDaDecisao;
}

const CODIGO_DO_ITEM = /^(MP|ME)-\d{6}$/;

/** Mesma chave de duplicidade do discovery: `trim` e sem caixa. */
export function nomeNormalizado(nome: string): string {
  return nome.trim().toUpperCase();
}

/** Erros estruturais do arquivo. Vazio = decisão utilizável. */
export function validarDecisoes(decisoes: readonly DecisaoDeDuplicata[]): string[] {
  const erros: string[] = [];
  const grupos = new Set<string>();
  const absorvidos = new Set<string>();
  const canonicos = new Set(decisoes.flatMap((d) => [d.canonico.codigo, `planilha:${d.canonico.codigoPlanilha}`]));

  for (const decisao of decisoes) {
    const ref = `${decisao.onda}/${decisao.grupo}`;
    if (!decisao.onda.trim() || !decisao.grupo.trim()) erros.push(`${ref}: onda e grupo são obrigatórios`);
    if (grupos.has(ref)) erros.push(`${ref}: grupo repetido`);
    grupos.add(ref);
    if (!nomeNormalizado(decisao.nome)) erros.push(`${ref}: nome vazio`);

    for (const [lado, valor] of [
      ["absorvido", decisao.absorvido],
      ["canônico", decisao.canonico],
    ] as const) {
      if (!CODIGO_DO_ITEM.test(valor.codigo)) {
        erros.push(`${ref}: código ${lado} "${valor.codigo}" fora do padrão MP-000000 / ME-000000`);
      }
      if (!valor.codigoPlanilha.trim()) erros.push(`${ref}: código da planilha do ${lado} vazio`);
    }

    const { absorvido, canonico } = decisao;
    if (absorvido.codigo === canonico.codigo || absorvido.codigoPlanilha === canonico.codigoPlanilha) {
      erros.push(`${ref}: absorvido e canônico são o mesmo Item`);
    }
    if (absorvido.codigo.slice(0, 3) !== canonico.codigo.slice(0, 3)) {
      erros.push(`${ref}: ${absorvido.codigo} e ${canonico.codigo} são de tipos diferentes`);
    }
    for (const chave of [absorvido.codigo, `planilha:${absorvido.codigoPlanilha}`]) {
      if (absorvidos.has(chave)) erros.push(`${ref}: ${absorvido.codigo} já é absorvido em outro grupo`);
      absorvidos.add(chave);
      // Absorvido que é canônico de outro grupo encadeia decisões: o importador
      // e a ferramenta resolvem um passo só, então o arquivo recusa.
      if (canonicos.has(chave)) erros.push(`${ref}: ${absorvido.codigo} é canônico de outro grupo (absorção em cadeia)`);
    }
  }
  return erros;
}

/** As decisões, ou erro legível — nunca meia decisão. */
export function decisoesValidadas(
  decisoes: readonly DecisaoDeDuplicata[] = DECISOES_DE_DUPLICATAS,
): readonly DecisaoDeDuplicata[] {
  const erros = validarDecisoes(decisoes);
  if (erros.length > 0) {
    throw new Error(`Arquivo de decisão de duplicatas inválido:\n  - ${erros.join("\n  - ")}`);
  }
  return decisoes;
}

export function decisoesDaOnda(
  onda: string,
  decisoes: readonly DecisaoDeDuplicata[] = DECISOES_DE_DUPLICATAS,
): readonly DecisaoDeDuplicata[] {
  const daOnda = decisoesValidadas(decisoes).filter((decisao) => decisao.onda === onda);
  if (daOnda.length === 0) throw new Error(`Onda "${onda}" não tem grupo no arquivo de decisão.`);
  return daOnda;
}

/** Impressão digital das decisões: plano de uma decisão não se aplica sobre outra. */
export function impressaoDasDecisoes(decisoes: readonly DecisaoDeDuplicata[]): string {
  const forma = decisoes.map((d) => [
    d.onda,
    d.grupo,
    nomeNormalizado(d.nome),
    d.absorvido.codigo,
    d.absorvido.codigoPlanilha,
    d.canonico.codigo,
    d.canonico.codigoPlanilha,
  ]);
  return createHash("sha256").update(JSON.stringify(forma)).digest("hex");
}

/** Duplicatas absorvidas pelo código da planilha — como o importador as encontra. */
export function absorvidosPorCodigoDaPlanilha(
  decisoes: readonly DecisaoDeDuplicata[] = DECISOES_DE_DUPLICATAS,
): Map<string, DecisaoDeDuplicata> {
  return new Map(decisoesValidadas(decisoes).map((decisao) => [decisao.absorvido.codigoPlanilha, decisao]));
}
