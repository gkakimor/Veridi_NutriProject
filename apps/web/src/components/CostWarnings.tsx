import { Link } from "react-router-dom";
import type { IndustrialCostWarningDTO } from "@veridi/shared";
import { entityHref } from "./EntityLink";

/**
 * Observações do cálculo — cada uma com o caminho de quem vai resolver.
 *
 * A lista dizia o que estava faltando e escondia a saída: quem lia
 * "MP-000003: sem custo conhecido" tinha que descobrir sozinho que custo de
 * matéria-prima não é campo de cadastro, e sim consequência de um
 * recebimento com custo efetivo informado.
 *
 * O texto do link diz a AÇÃO, não o destino: "abrir o item" não ensina
 * nada; "informar o custo numa compra" ensina de onde o número vem.
 */

interface Props {
  warnings: IndustrialCostWarningDTO[];
  title: string;
  /** Quando presente, a observação de energia vira âncora para a seção. */
  productId?: string | undefined;
  /** `true` quando o painel já está DENTRO da estrutura de custos. */
  onStructurePage?: boolean | undefined;
  /**
   * `true` quando a estrutura de referência não é mais editável. Muda a saída:
   * o que se ajusta num rascunho, numa versão ativa vira versão nova.
   */
  structureLocked?: boolean | undefined;
}

function WarningAction({
  warning,
  productId,
  onStructurePage,
  structureLocked,
}: {
  warning: IndustrialCostWarningDTO;
  productId?: string | undefined;
  onStructurePage: boolean;
  structureLocked: boolean;
}) {
  /*
   * Custo de matéria-prima não é campo de cadastro — mandar para o item era
   * beco. Cada caso tem um caminho diferente, e o servidor já disse qual.
   */
  if (warning.target === "RECEIPT" && warning.receiptId) {
    return (
      <Link to={`/compras/recebimentos/${warning.receiptId}`}>
        Informar o custo no recebimento {warning.receiptCode}
      </Link>
    );
  }
  if (warning.target === "PURCHASE") {
    return (
      <Link to="/compras/ordens">
        Nunca foi comprado — o custo nasce de uma ordem de compra recebida
      </Link>
    );
  }
  if (warning.target === "STALE_BASIS") {
    return (
      <span>
        Já está resolvido no estado atual; este cálculo é anterior — salve um cálculo novo
        {productId ? (
          <>
            {" "}
            <Link to={`/produtos/${productId}/custos`}>na estrutura de custos</Link>
          </>
        ) : null}
        .
      </span>
    );
  }
  if (warning.target === "RESOURCE" && warning.resourceId) {
    return (
      <Link to={entityHref("industrialResource", warning.resourceId)}>
        Informar a tarifa no recurso
      </Link>
    );
  }
  /*
   * Não é defeito: o rascunho só ainda não valeu. Mas é o último passo, e
   * ficar sem ele deixa o CMV do produto sem base — a frase diz o que fazer
   * em vez de só constatar a situação.
   */
  if (warning.target === "ACTIVATE") {
    if (onStructurePage) {
      return <span>Ative a estrutura para esta referência passar a valer.</span>;
    }
    if (productId) {
      return (
        <Link to={`/produtos/${productId}/custos`}>Ativar a estrutura para esta valer</Link>
      );
    }
    return null;
  }

  if (warning.target === "ENERGY") {
    /*
     * Estrutura ativa é congelada, e a seção de energia dela é só leitura —
     * mandar para lá era mostrar o problema ao lado de um campo que não
     * existe. Numa versão ativa a correção acontece numa versão nova.
     */
    if (structureLocked) {
      return (
        <span>
          Esta estrutura já está ativa e não se edita — crie uma nova versão
          {!onStructurePage && productId ? (
            <>
              {" "}
              <Link to={`/produtos/${productId}/custos`}>na estrutura de custos</Link>
            </>
          ) : (
            " pelo botão “Nova versão”, no topo desta página"
          )}
          .
        </span>
      );
    }
    if (onStructurePage) return <a href="#secao-energia">Ir para Energia</a>;
    if (productId) {
      return <Link to={`/produtos/${productId}/custos#secao-energia`}>Ajustar a energia</Link>;
    }
  }
  return null;
}

export function CostWarnings({
  warnings,
  title,
  productId,
  onStructurePage = false,
  structureLocked = false,
}: Props) {
  if (warnings.length === 0) return null;
  return (
    <div className="cmv-warnings" role="status">
      <strong>{title}</strong>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${index}`}>
            {warning.message}{" "}
            <WarningAction
              warning={warning}
              productId={productId}
              onStructurePage={onStructurePage}
              structureLocked={structureLocked}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
