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
  /**
   * Grupo da decisão. Na Onda A cada grupo é um par. Da Onda 2 em diante um
   * grupo pode ter mais de um absorvido: cada par é uma linha, e todas as linhas
   * do grupo descrevem o MESMO canônico, o mesmo nome e a mesma consolidação.
   */
  grupo: string;
  /** Nome do grupo; comparado sem espaço nas pontas e sem caixa. */
  nome: string;
  absorvido: LadoDaDecisao;
  canonico: LadoDaDecisao;
  /**
   * Par NOMEADO (Onda 2+): o nome exato do absorvido quando ele NÃO colide com
   * `nome` pela regra automática — a sílica, que difere por acento. A regra
   * geral continua preservando acento; o que junta os dois é a decisão
   * explícita do PO sobre este par, não o algoritmo. Ausente: o absorvido tem
   * de se chamar `nome`, como na Onda A.
   */
  nomeDoAbsorvido?: string;
  /**
   * Campos do canônico que a decisão consolida (Onda 2+), com o valor FINAL
   * esperado. A ferramenta calcula o valor pela regra e recusa o grupo se o
   * cálculo não der exatamente isto: nada é escrito no canônico sem estar
   * escrito aqui antes.
   */
  consolidar?: ConsolidacaoDecidida;
}

/**
 * O que a decisão escreve no canônico.
 *
 * `equivalentes` é a exceção declarada DESTE grupo: `{ "Clorogênico":
 * "Clorogênico**" }` diz que os dois termos são o mesmo e que fica a grafia da
 * direita. Não é regra geral — sem ela, termos que diferem por asterisco (ou
 * por qualquer coisa além de espaço nas pontas e caixa) continuam diferentes.
 */
export interface ConsolidacaoDecidida {
  declaredNutrient: string;
  equivalentes?: Readonly<Record<string, string>>;
}

const CODIGO_DO_ITEM = /^(MP|ME)-\d{6}$/;

/** Mesma chave de duplicidade do discovery: `trim` e sem caixa. */
export function nomeNormalizado(nome: string): string {
  return nome.trim().toUpperCase();
}

/** Separador dos termos de um campo consolidado: "Cálcio · Fósforo". */
export const SEPARADOR_DA_CONSOLIDACAO = " · ";

/** Erros estruturais do arquivo. Vazio = decisão utilizável. */
export function validarDecisoes(decisoes: readonly DecisaoDeDuplicata[]): string[] {
  const erros: string[] = [];
  const grupos = new Map<string, DecisaoDeDuplicata>();
  const absorvidos = new Set<string>();
  const canonicos = new Set(decisoes.flatMap((d) => [d.canonico.codigo, `planilha:${d.canonico.codigoPlanilha}`]));

  for (const decisao of decisoes) {
    const ref = `${decisao.onda}/${decisao.grupo}`;
    if (!decisao.onda.trim() || !decisao.grupo.trim()) erros.push(`${ref}: onda e grupo são obrigatórios`);
    const primeira = grupos.get(ref);
    if (!primeira) grupos.set(ref, decisao);
    else {
      // Grupo de mais de dois: cada absorvido é uma linha, e o grupo continua
      // um só — o mesmo canônico, o mesmo nome e a mesma consolidação.
      if (
        primeira.canonico.codigo !== decisao.canonico.codigo ||
        primeira.canonico.codigoPlanilha !== decisao.canonico.codigoPlanilha
      ) {
        erros.push(`${ref}: grupo repetido com outro canônico`);
      }
      if (nomeNormalizado(primeira.nome) !== nomeNormalizado(decisao.nome)) {
        erros.push(`${ref}: grupo repetido com outro nome`);
      }
      if (JSON.stringify(primeira.consolidar ?? null) !== JSON.stringify(decisao.consolidar ?? null)) {
        erros.push(`${ref}: grupo repetido com outra consolidação`);
      }
    }
    if (!nomeNormalizado(decisao.nome)) erros.push(`${ref}: nome vazio`);
    if (decisao.nomeDoAbsorvido !== undefined && nomeNormalizado(decisao.nomeDoAbsorvido) === nomeNormalizado(decisao.nome)) {
      // Par nomeado existe para o que a regra automática NÃO junta. Se junta,
      // a exceção não é exceção, e esconderia um grupo comum.
      erros.push(`${ref}: nomeDoAbsorvido só existe para nome que a regra automática não junta`);
    }
    if (decisao.consolidar) {
      const partes = decisao.consolidar.declaredNutrient.split(SEPARADOR_DA_CONSOLIDACAO);
      if (partes.some((parte) => !parte.trim() || parte !== parte.trim() || parte.includes("·"))) {
        erros.push(`${ref}: consolidação de declaredNutrient com termo vazio ou com espaço sobrando`);
      }
      // A equivalência declarada tem de levar a um termo que fica, e o termo
      // que ela junta não pode continuar no valor final.
      for (const [termo, fica] of Object.entries(decisao.consolidar.equivalentes ?? {})) {
        if (!termo.trim() || termo !== termo.trim() || !fica.trim() || fica !== fica.trim()) {
          erros.push(`${ref}: equivalência com termo vazio ou com espaço sobrando`);
        } else if (!partes.includes(fica)) {
          erros.push(`${ref}: a equivalência leva "${termo}" a "${fica}", que não está no valor consolidado`);
        } else if (partes.includes(termo)) {
          erros.push(`${ref}: "${termo}" é declarado igual a "${fica}" e continua no valor consolidado`);
        }
      }
    }

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
    // Só quando a decisão os tem: a impressão da Onda A fica a mesma de antes.
    ...(d.nomeDoAbsorvido !== undefined || d.consolidar !== undefined
      ? [d.nomeDoAbsorvido ?? null, d.consolidar ?? null]
      : []),
  ]);
  return createHash("sha256").update(JSON.stringify(forma)).digest("hex");
}

/** Duplicatas absorvidas pelo código da planilha — como o importador as encontra. */
export function absorvidosPorCodigoDaPlanilha(
  decisoes: readonly DecisaoDeDuplicata[] = DECISOES_DE_DUPLICATAS,
): Map<string, DecisaoDeDuplicata> {
  return new Map(decisoesValidadas(decisoes).map((decisao) => [decisao.absorvido.codigoPlanilha, decisao]));
}

/** Um grupo de decisão inteiro: o canônico e todos os absorvidos dele. */
export interface GrupoDeDecisao {
  onda: string;
  grupo: string;
  nome: string;
  canonico: LadoDaDecisao;
  absorvidos: (LadoDaDecisao & { nomeDoAbsorvido?: string })[];
  consolidar?: ConsolidacaoDecidida;
}

/**
 * Os grupos de uma onda, na ordem do arquivo. É a forma que a ferramenta
 * genérica lê: a Onda 2 tem grupo de três e de quatro Itens, e o que ela aplica
 * de uma vez é o grupo, não o par.
 */
export function gruposDaOnda(
  onda: string,
  decisoes: readonly DecisaoDeDuplicata[] = DECISOES_DE_DUPLICATAS,
): GrupoDeDecisao[] {
  const grupos = new Map<string, GrupoDeDecisao>();
  for (const decisao of decisoesDaOnda(onda, decisoes)) {
    const atual = grupos.get(decisao.grupo) ?? {
      onda: decisao.onda,
      grupo: decisao.grupo,
      nome: decisao.nome,
      canonico: decisao.canonico,
      absorvidos: [],
      ...(decisao.consolidar ? { consolidar: decisao.consolidar } : {}),
    };
    atual.absorvidos.push({
      ...decisao.absorvido,
      ...(decisao.nomeDoAbsorvido !== undefined ? { nomeDoAbsorvido: decisao.nomeDoAbsorvido } : {}),
    });
    grupos.set(decisao.grupo, atual);
  }
  return [...grupos.values()];
}

/** A decisão é da Onda 2 em diante — grupo de N, par nomeado ou consolidação? */
export function decisaoDeGrupo(decisao: DecisaoDeDuplicata, todas: readonly DecisaoDeDuplicata[]): boolean {
  return (
    decisao.consolidar !== undefined ||
    decisao.nomeDoAbsorvido !== undefined ||
    todas.filter((d) => d.onda === decisao.onda && d.grupo === decisao.grupo).length > 1
  );
}
