const NAO_GERADO = "O documento não foi gerado para não sair incompleto.";
const LISTA_MUDOU = `A lista mudou enquanto era lida. ${NAO_GERADO} Gere de novo.`;

/**
 * O conjunto INTEIRO de uma consulta que o servidor pagina
 * (FO03-PENDING-CUTOFF-01).
 *
 * Para documento cuja rota não tem `all=true` e cujo `pageSize` tem teto no
 * servidor. A folha FO-03 pedia uma página de 100 e imprimia só ela: da 101ª
 * pendência em diante o lote sumia do papel sem aviso, e a folha contava as
 * que sobraram como se fossem todas.
 *
 * Lê página por página, na ordem do servidor, e concatena sem reordenar. O
 * `total` da primeira resposta é a guarda, e qualquer quebra dela lança:
 * - toda página repete o mesmo `total` — se mudou, a lista mudou no meio da
 *   leitura, e o deslocamento pode ter pulado ou repetido linha;
 * - cada página traz exatamente o que falta até o `total`, limitado ao
 *   `pageSize` — página curta antes do fim é corte, não fim;
 * - nenhuma chave se repete.
 * Falha de qualquer página também lança, sem devolver as anteriores: nenhum
 * documento é melhor que um que parece completo e não é.
 *
 * Uma requisição por página — `ceil(total / pageSize)`, e uma quando vazio —,
 * nunca uma por linha. Cada volta lança ou avança ao menos uma linha rumo ao
 * `total`, então o laço sempre termina.
 */
export async function loadAllPages<T>(
  consultar: (pagina: { page: number; pageSize: number }) => Promise<{ rows: T[]; total: number }>,
  { pageSize, chave }: { pageSize: number; chave: (row: T) => string },
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error(`Tamanho de página inválido: ${pageSize}.`);
  }

  let resposta = await consultar({ page: 1, pageSize });
  const { total } = resposta;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error(`A consulta não informou o total de linhas. ${NAO_GERADO}`);
  }

  const linhas: T[] = [];
  const chaves = new Set<string>();
  for (let page = 1; ; page += 1) {
    if (page > 1) resposta = await consultar({ page, pageSize });
    if (resposta.total !== total) throw new Error(LISTA_MUDOU);
    if (resposta.rows.length !== Math.min(pageSize, total - linhas.length)) {
      throw new Error(`A página ${page} não fecha com o total de ${total} linha(s). ${NAO_GERADO}`);
    }
    for (const row of resposta.rows) {
      const id = chave(row);
      if (chaves.has(id)) throw new Error(LISTA_MUDOU);
      chaves.add(id);
      linhas.push(row);
    }
    if (linhas.length === total) return linhas;
  }
}
