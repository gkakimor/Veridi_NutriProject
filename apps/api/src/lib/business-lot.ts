/**
 * SUGESTÃO de lote comercial (`businessLotNumber`).
 *
 * Máscara: `AAMM` + código do produto + sufixo do cliente.
 * Ex.: produção em 10/03/2026, produto `0340`, cliente `A3` → `26030340A3`.
 *
 * Três limites deliberados:
 * 1. É sugestão — o usuário pode digitar outro valor, e o valor manual
 *    sempre prevalece;
 * 2. não é identidade: `Lot.code` continua sendo o identificador interno
 *    único;
 * 3. nada é obrigatório — sem configuração de produto/cliente, devolve
 *    `null` e o usuário informa manualmente, como já fazia.
 */
export function suggestBusinessLotNumber(params: {
  producedAt: Date;
  productBusinessLotCode: string | null;
  customerBusinessLotSuffix: string | null;
}): string | null {
  const { producedAt, productBusinessLotCode, customerBusinessLotSuffix } = params;
  if (!productBusinessLotCode?.trim()) return null;

  const year = String(producedAt.getUTCFullYear()).slice(-2);
  const month = String(producedAt.getUTCMonth() + 1).padStart(2, "0");

  return [
    `${year}${month}`,
    productBusinessLotCode.trim(),
    customerBusinessLotSuffix?.trim() ?? "",
  ].join("");
}
