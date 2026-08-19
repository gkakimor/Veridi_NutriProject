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
}

function WarningAction({
  warning,
  productId,
  onStructurePage,
}: {
  warning: IndustrialCostWarningDTO;
  productId?: string | undefined;
  onStructurePage: boolean;
}) {
  // Destino por identidade, pelo mesmo montador que o resto do ERP usa:
  // link escrito à mão erra o parâmetro e cai na lista inteira.
  if (warning.target === "ITEM" && warning.itemId) {
    return (
      <Link to={entityHref("item", warning.itemId)}>
        Ver o item — o custo vem de um recebimento com custo informado
      </Link>
    );
  }
  if (warning.target === "RESOURCE" && warning.resourceId) {
    return (
      <Link to={entityHref("industrialResource", warning.resourceId)}>
        Informar a tarifa no recurso
      </Link>
    );
  }
  if (warning.target === "ENERGY") {
    if (onStructurePage) return <a href="#secao-energia">Ir para Energia</a>;
    if (productId) {
      return <Link to={`/produtos/${productId}/custos#secao-energia`}>Ajustar a energia</Link>;
    }
  }
  return null;
}

export function CostWarnings({ warnings, title, productId, onStructurePage = false }: Props) {
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
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
