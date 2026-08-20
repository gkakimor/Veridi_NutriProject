/**
 * Endereço legado: uma string, três campos.
 *
 * A planilha guarda "Rua Vicente José de Almeida, n° 158, bairro Cupece" e o
 * ERP quer Logradouro, Número e Bairro separados. A auditoria VAL-LEG-01
 * quebrou isso à mão, cliente por cliente.
 *
 * Este parser resolve os padrões que o corpus realmente usa, e SÓ eles. A
 * regra que manda aqui é a mesma do resto da migração: quando não dá para
 * afirmar, não se afirma. Nada de "S/N", nada de número 0, nada de bairro
 * "desconhecido" — falsa precisão num cadastro de cliente é pior que campo
 * vazio, porque ninguém volta a conferir o que já parece preenchido.
 *
 * O texto original nunca é descartado: ele continua indo para as notas de
 * migração, e é ele que alguém vai ler para decidir os casos duvidosos.
 */

export interface ParsedLegacyAddress {
  street: string | null;
  number: string | null;
  district: string | null;
  /** `true` quando algo ficou por interpretar e um humano precisa olhar. */
  needsReview: boolean;
  /** Por que precisa de revisão — texto curto, para o relatório de plano. */
  reviewReason: string | null;
}

/** Tipos de logradouro que aparecem no corpus. Lista fechada de propósito. */
const TIPOS_LOGRADOURO =
  /^(rua|r\.|av\.?|avenida|travessa|tv\.?|alameda|al\.?|rodovia|rod\.?|estrada|est\.?|praça|praca|largo|via)\b/i;

/** "n° 158", "nº 158", "no 158", "n 158", "num 158", "número 158". */
const NUMERO_ROTULADO = /\b(?:n[º°o]?\.?|num\.?|n[uú]mero)\s*[:.]?\s*([0-9]+[a-zA-Z]?)\b/i;

/** "bairro Cupece", "b. Cupece", "bairro: Cupece". */
const BAIRRO_ROTULADO = /\bbairro\s*[:.]?\s*(.+)$/i;
const BAIRRO_ABREVIADO = /\bb\.\s*(.+)$/i;

function limpar(valor: string | null | undefined): string | null {
  if (!valor) return null;
  // Pontuação nas pontas não é conteúdo: "bairro:" sem nome depois tem de
  // sobrar `null`, não os dois-pontos.
  const texto = valor
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;.:\-]+/, "")
    .replace(/[,;.:\-]+$/, "")
    .trim();
  return texto.length > 0 ? texto : null;
}

/**
 * Interpreta um endereço legado.
 *
 * Devolve `needsReview` sempre que o resultado é parcial. O chamador decide
 * o que fazer com isso — aqui não se grava nem se descarta nada.
 */
export function parseLegacyAddress(raw: string | null | undefined): ParsedLegacyAddress {
  const texto = limpar(raw);
  const vazio: ParsedLegacyAddress = {
    street: null,
    number: null,
    district: null,
    needsReview: false,
    reviewReason: null,
  };
  if (!texto) return vazio;

  const partes = texto
    .split(",")
    .map((parte) => limpar(parte))
    .filter((parte): parte is string => parte !== null);

  if (partes.length === 0) {
    return { ...vazio, needsReview: true, reviewReason: "endereço vazio depois da limpeza" };
  }

  // ── Logradouro: só a primeira parte, e só se parecer um logradouro.
  const primeira = partes[0]!;
  const pareceLogradouro = TIPOS_LOGRADOURO.test(primeira);
  const street = pareceLogradouro ? primeira : null;

  // ── Número: preferir o rotulado; sem rótulo, aceitar uma parte que seja
  //    SÓ dígitos. "Apto 42" e "Km 13" não são número de porta.
  let number: string | null = null;
  const rotulado = texto.match(NUMERO_ROTULADO);
  if (rotulado) {
    number = rotulado[1] ?? null;
  } else {
    const soDigitos = partes.slice(1).find((parte) => /^[0-9]+[a-zA-Z]?$/.test(parte));
    number = soDigitos ?? null;
  }

  // ── Bairro: só quando vem rotulado. Adivinhar "a parte depois do número
  //    é o bairro" erra em endereços com complemento, e complemento é
  //    justamente o que aparece nos cadastros antigos.
  let district: string | null = null;
  for (const parte of partes) {
    const comRotulo = parte.match(BAIRRO_ROTULADO) ?? parte.match(BAIRRO_ABREVIADO);
    if (comRotulo) {
      district = limpar(comRotulo[1]);
      break;
    }
  }

  const faltando: string[] = [];
  if (!street) faltando.push("logradouro");
  if (!number) faltando.push("número");
  if (!district) faltando.push("bairro");

  return {
    street,
    number,
    district,
    needsReview: faltando.length > 0,
    reviewReason:
      faltando.length > 0 ? `não foi possível identificar: ${faltando.join(", ")}` : null,
  };
}
