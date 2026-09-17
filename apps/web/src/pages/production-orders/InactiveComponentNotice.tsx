import { Fragment } from "react";
import type { ProductionOrderDTO } from "@veridi/shared";
import { EntityLink } from "../../components/EntityLink";

/**
 * Aviso de componente inativo na Ordem de Produção —
 * PRODUCTION-INACTIVE-COMPONENT-GATE-01, §116.
 *
 * A formulação foi ativada com o item ativo, e o item foi inativado depois. A
 * ordem não some nem muda, e a formulação continua consultável; mas quem abre a
 * ordem precisa saber, ANTES de tentar, que planejar ou liberar vai ser
 * recusado — e quais itens, todos de uma vez, e não um por vez.
 *
 * É aviso, não autoridade: quem recusa é o servidor, e nada aqui desabilita
 * botão. A situação vem da própria leitura da ordem (`itemActive`) e é a ATUAL —
 * o aviso some na leitura seguinte à reativação. Decide pelo valor conhecido
 * (`false`): leitura sem o campo não vira aviso de inativo por exclusão.
 */
export function InactiveComponentNotice({
  requirements,
  passo,
}: {
  requirements: ProductionOrderDTO["requirements"];
  /** O passo que a guarda recusa nesta ordem, no infinitivo: "liberar a ordem". */
  passo: string;
}) {
  const vistos = new Set<string>();
  const inativos = requirements.filter((requirement) => {
    if (requirement.itemActive !== false || vistos.has(requirement.itemId)) return false;
    vistos.add(requirement.itemId);
    return true;
  });
  if (inativos.length === 0) return null;

  return (
    <div className="pendency-panel" role="status">
      <p className="pendency-panel__title">
        {inativos.length === 1 ? "Componente inativo" : "Componentes inativos"}
      </p>
      <p className="pendency-panel__sub">
        {inativos.map((requirement, indice) => (
          <Fragment key={requirement.itemId}>
            {indice > 0 && ", "}
            <EntityLink
              kind="item"
              id={requirement.itemId}
              code={requirement.itemCode}
              name={requirement.itemName}
            />
          </Fragment>
        ))}
        {`: a formulação segue disponível e nada foi cancelado, mas não é possível ${passo} enquanto ${
          inativos.length === 1 ? "o item estiver inativo" : "os itens estiverem inativos"
        }. Reative no cadastro de itens para continuar.`}
      </p>
    </div>
  );
}
