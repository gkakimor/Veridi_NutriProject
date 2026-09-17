import { Fragment } from "react";
import { EntityLink } from "../../components/EntityLink";

/**
 * Aviso de Produto inativo no documento em andamento —
 * PRODUCT-INACTIVE-COMMERCIAL-GATE-01, §108.
 *
 * O documento nasceu com o produto ATIVO, e depois o produto — ou o item de
 * produto acabado dele, que tem situação própria — foi inativado. O documento
 * não some nem muda, e nada é cancelado; mas quem o abre precisa saber, ANTES de
 * tentar, que o próximo passo vai ser recusado.
 *
 * É aviso, não autoridade: quem recusa é o servidor, e nada aqui desabilita
 * botão. A situação vem da própria leitura do documento e é a ATUAL — o aviso
 * some na leitura seguinte à reativação. Decide pelo valor conhecido (`false`):
 * leitura sem o campo não vira aviso de inativo por exclusão.
 */

export interface ProdutoDoDocumento {
  productId: string;
  productCode: string;
  productName: string;
  productActive?: boolean;
  finishedItemId?: string | null;
  finishedItemCode?: string | null;
  finishedItemName?: string | null;
  finishedItemActive?: boolean | null;
}

function semRepetir<T>(lista: readonly T[], chave: (valor: T) => string): T[] {
  const vistos = new Set<string>();
  return lista.filter((valor) => {
    const id = chave(valor);
    if (vistos.has(id)) return false;
    vistos.add(id);
    return true;
  });
}

export function ProductInactiveNotice({
  linhas,
  passo,
}: {
  linhas: readonly ProdutoDoDocumento[];
  /** O passo que a guarda recusa neste documento, no infinitivo: "enviar a proposta". */
  passo: string;
}) {
  const produtos = semRepetir(
    linhas.filter((linha) => linha.productActive === false),
    (linha) => linha.productId,
  );
  const itens = semRepetir(
    linhas.filter((linha) => linha.finishedItemActive === false && linha.finishedItemId),
    (linha) => linha.finishedItemId!,
  );
  if (produtos.length === 0 && itens.length === 0) return null;

  const titulo =
    produtos.length > 0 && itens.length > 0
      ? "Produto e item de produto acabado inativos"
      : produtos.length > 0
        ? produtos.length === 1
          ? "Produto inativo"
          : "Produtos inativos"
        : "Item de produto acabado inativo";

  return (
    <div className="pendency-panel" role="status">
      <p className="pendency-panel__title">{titulo}</p>
      {produtos.length > 0 && (
        <p className="pendency-panel__sub">
          {produtos.map((linha, indice) => (
            <Fragment key={linha.productId}>
              {indice > 0 && ", "}
              <EntityLink
                kind="product"
                id={linha.productId}
                code={linha.productCode}
                name={linha.productName}
              />
            </Fragment>
          ))}
          {`: o documento continua disponível, mas não é possível ${passo} enquanto o produto estiver inativo.`}
        </p>
      )}
      {itens.length > 0 && (
        <p className="pendency-panel__sub">
          {itens.map((linha, indice) => (
            <Fragment key={linha.finishedItemId}>
              {indice > 0 && ", "}
              <EntityLink
                kind="item"
                id={linha.finishedItemId}
                code={linha.finishedItemCode}
                name={linha.finishedItemName ?? null}
              />
              {` (de ${linha.productCode})`}
            </Fragment>
          ))}
          {`: o item de produto acabado está inativo, e não é possível ${passo} até reativá-lo. Produto e item mudam de situação separadamente.`}
        </p>
      )}
    </div>
  );
}
