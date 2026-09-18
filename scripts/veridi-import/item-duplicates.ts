import { createHash } from "node:crypto";
import {
  DECISOES_DE_DUPLICATAS,
  EXCLUSOES_DE_AGREGADO,
  GRUPOS_EM_REVISAO,
  RENOMEACOES_DE_ITEM,
} from "./item-duplicate-decisions.js";

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
  return gruposDeFusao(decisoesDaOnda(onda, decisoes));
}

/** As linhas de fusão (já validadas) juntadas por grupo, na ordem do arquivo. */
export function gruposDeFusao(fusoes: readonly DecisaoDeDuplicata[]): GrupoDeDecisao[] {
  const grupos = new Map<string, GrupoDeDecisao>();
  for (const decisao of fusoes) {
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

/* ------------------------------------------------------------------ *
 * Onda 3 em diante: decisões que não são fusão
 * (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-3-01)
 * ------------------------------------------------------------------ */

/** Um registro que muda de nome — o de ANTES exato e o nome técnico novo. */
export interface RenomeacaoDecidida extends LadoDaDecisao {
  de: string;
  para: string;
}

/**
 * Mesmo nome, material diferente: a colisão se resolve por nome técnico
 * distinto (§114), sem fundir, sem mover referência e sem remover registro.
 * `manter` é quem fica com o nome de hoje, sem mudança nenhuma.
 */
export interface DecisaoDeRenomeacao {
  onda: string;
  grupo: string;
  cadastro: "ITEM";
  /** O nome que os registros dividem hoje — a colisão resolvida. */
  nome: string;
  renomear: RenomeacaoDecidida[];
  manter: (LadoDaDecisao & { nome: string })[];
  motivo: string;
}

/**
 * Cadastro de teste nunca usado: sai o AGREGADO inteiro — o registro e o que
 * nasceu junto com ele (a V1 DRAFT do Modelo) —, e nada mais. Qualquer linha
 * de fora apontando para ele barra a exclusão.
 */
export interface DecisaoDeExclusaoDeAgregado {
  onda: string;
  grupo: string;
  cadastro: "FORMULATION_TEMPLATE";
  nome: string;
  excluir: { codigo: string }[];
  motivo: string;
}

/** Grupo que o PO mantém em revisão: aparece no PLAN como BLOCKED e nada nele é tocado. */
export interface DecisaoDeRevisao {
  onda: string;
  grupo: string;
  cadastro: "ITEM";
  nome: string;
  codigos: string[];
  motivo: string;
  /** O que a Veridi precisa responder — vai para a aba de revisão da planilha. */
  perguntas: string[];
}

/** Todas as decisões do arquivo, por espécie. */
export interface ConjuntoDeDecisoes {
  fusoes: readonly DecisaoDeDuplicata[];
  renomeacoes: readonly DecisaoDeRenomeacao[];
  exclusoes: readonly DecisaoDeExclusaoDeAgregado[];
  revisoes: readonly DecisaoDeRevisao[];
}

export const CONJUNTO_DO_ARQUIVO: ConjuntoDeDecisoes = {
  fusoes: DECISOES_DE_DUPLICATAS,
  renomeacoes: RENOMEACOES_DE_ITEM,
  exclusoes: EXCLUSOES_DE_AGREGADO,
  revisoes: GRUPOS_EM_REVISAO,
};

/** Só fusões: o conjunto que os testes da Onda 2 passam sem as outras espécies. */
export function conjuntoDeFusoes(fusoes: readonly DecisaoDeDuplicata[]): ConjuntoDeDecisoes {
  return { fusoes, renomeacoes: [], exclusoes: [], revisoes: [] };
}

const CODIGO_DO_MODELO = /^FT-\d{6}$/;
const semEspacoNasPontas = (texto: string): boolean => texto.length > 0 && texto === texto.trim();

/**
 * O arquivo inteiro, espécie a espécie, e o que cruza entre elas: um código
 * está em UMA decisão só, e um grupo é de uma espécie só na onda.
 */
export function validarConjunto(conjunto: ConjuntoDeDecisoes): string[] {
  const erros = validarDecisoes(conjunto.fusoes);

  // Quem decide cada código — fusão conta o grupo inteiro (o canônico se repete nas linhas).
  const donos = new Map<string, string>();
  const reivindicar = (codigo: string, dono: string, ref: string): void => {
    const atual = donos.get(codigo);
    if (atual !== undefined && atual !== dono) erros.push(`${ref}: ${codigo} já está em outra decisão (${atual})`);
    donos.set(codigo, dono);
  };
  const especieDoGrupo = new Map<string, string>();
  const reservarGrupo = (onda: string, grupo: string, especie: string, ref: string): void => {
    const chave = `${onda}/${grupo}`;
    const atual = especieDoGrupo.get(chave);
    if (atual !== undefined && atual !== especie) erros.push(`${ref}: o grupo já é de outra espécie (${atual})`);
    especieDoGrupo.set(chave, especie);
  };

  for (const fusao of conjunto.fusoes) {
    const dono = `fusão ${fusao.onda}/${fusao.grupo}`;
    reservarGrupo(fusao.onda, fusao.grupo, "fusão", dono);
    reivindicar(fusao.absorvido.codigo, dono, dono);
    reivindicar(fusao.canonico.codigo, dono, dono);
  }

  const destinos = new Map<string, string>();
  for (const decisao of conjunto.renomeacoes) {
    const ref = `renomeação ${decisao.onda}/${decisao.grupo}`;
    if (!decisao.onda.trim() || !decisao.grupo.trim()) erros.push(`${ref}: onda e grupo são obrigatórios`);
    reservarGrupo(decisao.onda, decisao.grupo, "renomeação", ref);
    if (!nomeNormalizado(decisao.nome)) erros.push(`${ref}: nome vazio`);
    if (!decisao.motivo.trim()) erros.push(`${ref}: motivo vazio`);
    if (decisao.renomear.length === 0) erros.push(`${ref}: nenhum registro a renomear`);
    // Depois da renomeação, no máximo um registro fica com o nome de hoje.
    if (decisao.manter.length > 1) erros.push(`${ref}: mais de um registro mantém o nome — a colisão continuaria`);
    for (const lado of [...decisao.renomear, ...decisao.manter]) {
      if (!CODIGO_DO_ITEM.test(lado.codigo)) erros.push(`${ref}: código "${lado.codigo}" fora do padrão MP-000000 / ME-000000`);
      if (!lado.codigoPlanilha.trim()) erros.push(`${ref}: código da planilha de ${lado.codigo} vazio`);
      reivindicar(lado.codigo, ref, ref);
    }
    for (const mantido of decisao.manter) {
      if (nomeNormalizado(mantido.nome) !== nomeNormalizado(decisao.nome)) {
        erros.push(`${ref}: ${mantido.codigo} mantém "${mantido.nome}", que não é o nome do grupo`);
      }
    }
    for (const r of decisao.renomear) {
      if (nomeNormalizado(r.de) !== nomeNormalizado(decisao.nome)) {
        erros.push(`${ref}: ${r.codigo} sai de "${r.de}", que não é o nome do grupo`);
      }
      if (!semEspacoNasPontas(r.para)) erros.push(`${ref}: nome novo de ${r.codigo} vazio ou com espaço sobrando`);
      if (nomeNormalizado(r.para) === nomeNormalizado(decisao.nome)) {
        erros.push(`${ref}: o nome novo de ${r.codigo} é o mesmo nome do grupo (sem caixa)`);
      }
      const outro = destinos.get(nomeNormalizado(r.para));
      if (outro !== undefined) erros.push(`${ref}: "${r.para}" é o nome novo de dois registros (${outro} e ${r.codigo})`);
      destinos.set(nomeNormalizado(r.para), r.codigo);
    }
  }

  for (const decisao of conjunto.exclusoes) {
    const ref = `exclusão ${decisao.onda}/${decisao.grupo}`;
    if (!decisao.onda.trim() || !decisao.grupo.trim()) erros.push(`${ref}: onda e grupo são obrigatórios`);
    reservarGrupo(decisao.onda, decisao.grupo, "exclusão", ref);
    if (decisao.cadastro !== "FORMULATION_TEMPLATE") {
      erros.push(`${ref}: exclusão de agregado só existe para Modelo de formulação`);
    }
    if (!nomeNormalizado(decisao.nome)) erros.push(`${ref}: nome vazio`);
    if (!decisao.motivo.trim()) erros.push(`${ref}: motivo vazio`);
    if (decisao.excluir.length === 0) erros.push(`${ref}: nenhum registro a excluir`);
    for (const { codigo } of decisao.excluir) {
      if (!CODIGO_DO_MODELO.test(codigo)) erros.push(`${ref}: código "${codigo}" fora do padrão FT-000000`);
      reivindicar(codigo, ref, ref);
    }
  }

  for (const decisao of conjunto.revisoes) {
    const ref = `revisão ${decisao.onda}/${decisao.grupo}`;
    if (!decisao.onda.trim() || !decisao.grupo.trim()) erros.push(`${ref}: onda e grupo são obrigatórios`);
    reservarGrupo(decisao.onda, decisao.grupo, "revisão", ref);
    if (!nomeNormalizado(decisao.nome)) erros.push(`${ref}: nome vazio`);
    if (!decisao.motivo.trim()) erros.push(`${ref}: motivo vazio`);
    if (decisao.perguntas.length === 0 || decisao.perguntas.some((p) => !p.trim())) {
      erros.push(`${ref}: grupo em revisão sem a pergunta que o destrava`);
    }
    if (new Set(decisao.codigos).size < 2) erros.push(`${ref}: grupo em revisão precisa de dois registros distintos`);
    for (const codigo of decisao.codigos) {
      if (!CODIGO_DO_ITEM.test(codigo)) erros.push(`${ref}: código "${codigo}" fora do padrão MP-000000 / ME-000000`);
      reivindicar(codigo, ref, ref);
    }
  }
  return erros;
}

/** O conjunto, ou erro legível — nunca meia decisão. */
export function conjuntoValidado(conjunto: ConjuntoDeDecisoes = CONJUNTO_DO_ARQUIVO): ConjuntoDeDecisoes {
  const erros = validarConjunto(conjunto);
  if (erros.length > 0) {
    throw new Error(`Arquivo de decisão de duplicatas inválido:\n  - ${erros.join("\n  - ")}`);
  }
  return conjunto;
}

/** As decisões de UMA onda, de todas as espécies. Onda sem decisão nenhuma é erro. */
export function conjuntoDaOnda(onda: string, conjunto: ConjuntoDeDecisoes = CONJUNTO_DO_ARQUIVO): ConjuntoDeDecisoes {
  const valido = conjuntoValidado(conjunto);
  const daOnda: ConjuntoDeDecisoes = {
    fusoes: valido.fusoes.filter((d) => d.onda === onda),
    renomeacoes: valido.renomeacoes.filter((d) => d.onda === onda),
    exclusoes: valido.exclusoes.filter((d) => d.onda === onda),
    revisoes: valido.revisoes.filter((d) => d.onda === onda),
  };
  const total = daOnda.fusoes.length + daOnda.renomeacoes.length + daOnda.exclusoes.length + daOnda.revisoes.length;
  if (total === 0) throw new Error(`Onda "${onda}" não tem grupo no arquivo de decisão.`);
  return daOnda;
}

/**
 * Impressão digital da onda: plano feito sobre uma decisão não se aplica sobre
 * outra. Onda só de fusões (A e 2) tem a MESMA impressão de antes — planos
 * gravados continuam valendo; qualquer outra espécie entra na conta.
 */
export function impressaoDaOnda(onda: string, conjunto: ConjuntoDeDecisoes = CONJUNTO_DO_ARQUIVO): string {
  const daOnda = conjuntoDaOnda(onda, conjunto);
  const fusoes = daOnda.fusoes.length > 0 ? impressaoDasDecisoes(daOnda.fusoes) : null;
  if (daOnda.renomeacoes.length === 0 && daOnda.exclusoes.length === 0 && daOnda.revisoes.length === 0) {
    return fusoes!;
  }
  const forma = {
    fusoes,
    renomeacoes: daOnda.renomeacoes.map((d) => [
      d.grupo,
      nomeNormalizado(d.nome),
      d.renomear.map((r) => [r.codigo, r.codigoPlanilha, r.de, r.para]),
      d.manter.map((m) => [m.codigo, m.codigoPlanilha, m.nome]),
    ]),
    exclusoes: daOnda.exclusoes.map((d) => [d.grupo, d.cadastro, nomeNormalizado(d.nome), d.excluir.map((e) => e.codigo)]),
    revisoes: daOnda.revisoes.map((d) => [d.grupo, nomeNormalizado(d.nome), [...d.codigos].sort()]),
  };
  return createHash("sha256").update(JSON.stringify(forma)).digest("hex");
}

/** Os cadastros que a onda toca, na ordem estável. */
export function cadastrosDaOnda(onda: string, conjunto: ConjuntoDeDecisoes = CONJUNTO_DO_ARQUIVO): string[] {
  const daOnda = conjuntoDaOnda(onda, conjunto);
  const cadastros = new Set<string>();
  if (daOnda.fusoes.length > 0) cadastros.add("ITEM");
  for (const d of [...daOnda.renomeacoes, ...daOnda.exclusoes, ...daOnda.revisoes]) cadastros.add(d.cadastro);
  return [...cadastros].sort();
}

export type EspecieDeDecisao = "fusão" | "renomeação" | "exclusão" | "revisão";

export interface DecisaoDoCodigo {
  onda: string;
  grupo: string;
  especie: EspecieDeDecisao;
}

/** Código → a decisão que o tem, de todas as espécies: a regra automática não toca o que já tem decisão. */
export function decisaoDoCodigo(conjunto: ConjuntoDeDecisoes = CONJUNTO_DO_ARQUIVO): Map<string, DecisaoDoCodigo> {
  const mapa = new Map<string, DecisaoDoCodigo>();
  const marcar = (codigo: string, onda: string, grupo: string, especie: EspecieDeDecisao): void => {
    mapa.set(codigo, { onda, grupo, especie });
  };
  for (const d of conjunto.fusoes) {
    marcar(d.absorvido.codigo, d.onda, d.grupo, "fusão");
    marcar(d.canonico.codigo, d.onda, d.grupo, "fusão");
  }
  for (const d of conjunto.renomeacoes) {
    for (const lado of [...d.renomear, ...d.manter]) marcar(lado.codigo, d.onda, d.grupo, "renomeação");
  }
  for (const d of conjunto.exclusoes) for (const { codigo } of d.excluir) marcar(codigo, d.onda, d.grupo, "exclusão");
  for (const d of conjunto.revisoes) for (const codigo of d.codigos) marcar(codigo, d.onda, d.grupo, "revisão");
  return mapa;
}
