import { Link } from "react-router-dom";
import type { IndustrialCostPendencyDTO } from "@veridi/shared";
import { entityHref } from "./EntityLink";

/**
 * O que falta para a estrutura de custos poder ser ativada.
 *
 * A lista já existia, mas em texto de dica cinza no meio do resumo: quem
 * chegava numa estrutura "Com pendências" lia o rótulo, não achava o
 * motivo, e ficava sem saber por que o CMV do produto respondia vazio.
 *
 * Duas decisões:
 *
 * 1. BLOQUEANTE e CONTEXTO viram blocos separados, pela severidade que a
 *    API publica — a mesma que decide `complete`. A tela não reimplementa
 *    a regra.
 * 2. Cada pendência leva para onde ela se resolve. Aviso que não abre nada
 *    vira beco: a tarifa está no cadastro do recurso, as unidades por
 *    caixa no produto, e a energia nesta própria página.
 */

/** Seção desta página onde a pendência se resolve. */
const ANCHORS: Partial<Record<IndustrialCostPendencyDTO["code"], string>> = {
  RATE_NOT_INFORMED: "secao-premissas",
  ENERGY_NOT_CONFIGURED: "secao-energia",
  ENERGY_RATE_NOT_INFORMED: "secao-energia",
  ENERGY_RESOURCE_MISSING: "secao-recursos",
};

const ANCHOR_LABELS: Record<string, string> = {
  "secao-premissas": "Ir para Premissas de custo adicionais",
  "secao-energia": "Ir para Energia",
  "secao-recursos": "Ir para Recursos industriais",
};

interface Props {
  pendencies: IndustrialCostPendencyDTO[];
  productId: string;
  /**
   * `true` quando o painel é exibido na própria estrutura — aí "SELF" vira
   * âncora interna. Fora dela, leva para a página da estrutura.
   */
  onStructurePage?: boolean;
}

function ResolveLink({
  pendency,
  productId,
  onStructurePage,
}: {
  pendency: IndustrialCostPendencyDTO;
  productId: string;
  onStructurePage: boolean;
}) {
  if (pendency.target === "RESOURCE" && pendency.resourceId) {
    return (
      <Link to={entityHref("industrialResource", pendency.resourceId)}>
        Abrir o recurso para informar
      </Link>
    );
  }
  if (pendency.target === "PRODUCT") {
    return <Link to={`/produtos/${productId}`}>Abrir o cadastro do produto</Link>;
  }
  if (pendency.target === "FORMULATION") {
    return <Link to={`/produtos/${productId}/formulacao`}>Abrir a formulação</Link>;
  }
  const anchor = ANCHORS[pendency.code];
  if (!onStructurePage) {
    return <Link to={`/produtos/${productId}/custos`}>Abrir a estrutura de custos</Link>;
  }
  if (!anchor) return null;
  return <a href={`#${anchor}`}>{ANCHOR_LABELS[anchor]}</a>;
}

export function IndustrialCostPendencies({
  pendencies,
  productId,
  onStructurePage = false,
}: Props) {
  const blocking = pendencies.filter((pendency) => pendency.severity === "BLOCKING");
  const info = pendencies.filter((pendency) => pendency.severity === "INFO");
  if (pendencies.length === 0) return null;

  return (
    <div className="pendency-panel">
      {blocking.length > 0 && (
        <>
          <h4 className="pendency-panel__title">
            Falta {blocking.length === 1 ? "1 configuração" : `${blocking.length} configurações`}{" "}
            para ativar esta estrutura
          </h4>
          <p className="pendency-panel__sub">
            Enquanto estas pendências existirem, a estrutura fica incompleta e o CMV do produto não
            é calculado.
          </p>
          <ul className="pendency-panel__list">
            {blocking.map((pendency, index) => (
              <li key={`${pendency.code}-${index}`}>
                <span>{pendency.description}</span>{" "}
                <ResolveLink
                  pendency={pendency}
                  productId={productId}
                  onStructurePage={onStructurePage}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {info.length > 0 && (
        <>
          <h4 className="pendency-panel__title pendency-panel__title--info">
            Avisos de contexto — não impedem ativar
          </h4>
          <ul className="pendency-panel__list">
            {info.map((pendency, index) => (
              <li key={`${pendency.code}-${index}`}>
                <span>{pendency.description}</span>{" "}
                <ResolveLink
                  pendency={pendency}
                  productId={productId}
                  onStructurePage={onStructurePage}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
