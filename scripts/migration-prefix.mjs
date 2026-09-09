/**
 * O prefixo de 14 digitos de uma migration e, ANTES DE TUDO, uma CHAVE DE
 * ORDENACAO — e so depois um carimbo de data.
 *
 * `prisma migrate deploy` aplica as pendentes em ordem lexicografica de pasta.
 * Em banco que ja existe isso nunca doi (so falta o que falta, na ordem em que
 * chegou); em banco VAZIO a ordem dos nomes e a ordem real, e uma migration
 * que altera tabela criada por outra de nome MAIOR quebra ali.
 *
 * A cadeia deste repositorio ja avancou ALEM do relogio: a ponta esta em
 * setembro de 2026 num dia posterior ao de hoje. Entao `prisma migrate dev`,
 * que carimba com o relogio real, gera um nome que ordena ANTES de migrations
 * das quais a nova depende. Foi exatamente o que aconteceu no COM-PRICE:
 * a migration nova referenciava `quote_lines` e, em banco novo, rodava antes
 * da migration que cria a tabela — `relation "quote_lines" does not exist`.
 *
 * Regra unica deste modulo:
 *
 *     prefixoNovo > maiorPrefixoExistente        SEMPRE
 *
 * SEMANTICA ESCOLHIDA (decisao registrada em `docs/TECH_BASELINE.md`): o
 * incremento e de UM SEGUNDO CIVIL, com carry real (…59 vira …00 do minuto
 * seguinte), e nao um `+1` no inteiro de 14 digitos. As duas alternativas
 * ordenam igual, porque em string de 14 digitos a ordem lexicografica e a
 * ordem numerica. A civil foi preferida por um motivo pratico: mantem todo
 * prefixo legivel como `YYYYMMDDHHMMSS` de verdade, e evita gravar no
 * historico nomes como `…093060` (60 segundos) ou `…13…` (mes 13), que
 * pareceriam data e nao seriam. O prefixo continua sendo chave de ordem; a
 * forma de data e preservada so para que as duas leituras nunca discordem.
 *
 * Modulo PURO: nao le disco, nao chama Prisma, nao renomeia nada. Quem faz
 * isso e `scripts/create-migration.mjs`. Assim o algoritmo se testa em
 * fixtures, sem criar migration nenhuma no repositorio.
 */

/** `20260925093008_quote_line_price_origin` -> prefixo + sufixo legivel. */
export const PADRAO_PASTA = /^(\d{14})_([a-z0-9_]+)$/;

export class PrefixoInvalidoError extends Error {
  constructor(motivo) {
    super(`Prefixo de migration invalido: ${motivo}`);
    this.name = "PrefixoInvalidoError";
  }
}

/** Divide o nome da pasta. `null` quando o nome nao segue a convencao. */
export function partesDaPasta(nome) {
  const m = PADRAO_PASTA.exec(nome);
  return m ? { prefixo: m[1], sufixo: m[2] } : null;
}

/** So as pastas que seguem a convencao, em ordem lexicografica. */
export function migrationsValidas(nomes) {
  return nomes.filter((nome) => PADRAO_PASTA.test(nome)).sort();
}

/** Maior prefixo da cadeia. `null` num repositorio sem migration nenhuma. */
export function maiorPrefixo(nomes) {
  const validas = migrationsValidas(nomes);
  if (validas.length === 0) return null;
  return partesDaPasta(validas[validas.length - 1]).prefixo;
}

function formatar(data) {
  const p = (n, casas = 2) => String(n).padStart(casas, "0");
  return (
    p(data.getUTCFullYear(), 4) +
    p(data.getUTCMonth() + 1) +
    p(data.getUTCDate()) +
    p(data.getUTCHours()) +
    p(data.getUTCMinutes()) +
    p(data.getUTCSeconds())
  );
}

/**
 * Soma um segundo civil ao prefixo.
 *
 * Exige que o prefixo seja um carimbo REAL: `Date.UTC` normaliza campo fora
 * de faixa em silencio, e `20260025000000` (mes 00) viraria dezembro de 2025 —
 * um numero MENOR. Recusar aqui e o que garante a monotonicidade; nenhum
 * prefixo do repositorio cai nesse caso, a guarda existe para o dia em que
 * alguem criar um a mao.
 */
export function incrementarPrefixo(prefixo) {
  if (!/^\d{14}$/.test(prefixo)) {
    throw new PrefixoInvalidoError(`"${prefixo}" nao tem 14 digitos.`);
  }
  const data = new Date(
    Date.UTC(
      Number(prefixo.slice(0, 4)),
      Number(prefixo.slice(4, 6)) - 1,
      Number(prefixo.slice(6, 8)),
      Number(prefixo.slice(8, 10)),
      Number(prefixo.slice(10, 12)),
      Number(prefixo.slice(12, 14)),
    ),
  );
  if (Number.isNaN(data.getTime()) || formatar(data) !== prefixo) {
    throw new PrefixoInvalidoError(`"${prefixo}" nao e um carimbo YYYYMMDDHHMMSS valido.`);
  }
  data.setUTCSeconds(data.getUTCSeconds() + 1);
  const proximo = formatar(data);
  if (proximo.length !== 14 || proximo <= prefixo) {
    throw new PrefixoInvalidoError(`nao foi possivel avancar depois de "${prefixo}".`);
  }
  return proximo;
}

/**
 * O menor prefixo estritamente maior que `prefixo` que ainda nao esta em uso.
 * Colisao nunca sobrescreve pasta: avanca mais um segundo.
 */
export function proximoPrefixoLivre(prefixo, nomesExistentes) {
  const usados = new Set(
    nomesExistentes.map((nome) => partesDaPasta(nome)?.prefixo).filter((p) => p !== undefined),
  );
  let candidato = incrementarPrefixo(prefixo);
  while (usados.has(candidato)) candidato = incrementarPrefixo(candidato);
  return candidato;
}

/**
 * O que fazer com a pasta que o Prisma acabou de gerar.
 *
 * `pastaGerada` e o nome novo; `outras` sao todas as demais pastas de
 * migration ja presentes. Devolve sempre uma decisao explicita — nunca
 * `undefined` — para que o chamador nao precise adivinhar.
 */
export function resolverRenomeacao(pastaGerada, outras) {
  const partes = partesDaPasta(pastaGerada);
  if (!partes) {
    throw new PrefixoInvalidoError(
      `"${pastaGerada}" nao segue \`YYYYMMDDHHMMSS_snake_case\` — nada foi renomeado.`,
    );
  }
  const ponta = maiorPrefixo(outras);

  // Repositorio sem migration nenhuma: qualquer prefixo ja e a ponta.
  if (ponta === null) {
    return { acao: "manter", de: pastaGerada, para: pastaGerada, prefixo: partes.prefixo, ponta: null };
  }
  // Relogio a frente da cadeia: o carimbo real ja e monotonico, e ele fica.
  if (partes.prefixo > ponta) {
    return { acao: "manter", de: pastaGerada, para: pastaGerada, prefixo: partes.prefixo, ponta };
  }
  // Relogio atras (ou empatado com) a ponta: renumera para o menor prefixo
  // valido depois dela. Nunca uma data futura inventada.
  const prefixo = proximoPrefixoLivre(ponta, [...outras, pastaGerada]);
  return { acao: "renomear", de: pastaGerada, para: `${prefixo}_${partes.sufixo}`, prefixo, ponta };
}

/**
 * Normaliza o nome legivel para o padrao ja adotado pelo repositorio
 * (`[a-z0-9_]+`). Sem framework de naming: minusculas, separador unico.
 */
export function sanitizarNome(bruto) {
  const nome = String(bruto ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (nome.length === 0) {
    throw new PrefixoInvalidoError("o nome da migration ficou vazio depois de normalizado.");
  }
  return nome;
}
