import { Link } from "react-router-dom";
import type { FormulationComponentIssueDTO } from "@veridi/shared";
import { entityHref } from "../../components/EntityLink";

/**
 * O que o cadastro do Item invalidou na receita do Modelo
 * (FORMULATION-TEMPLATE-WORKBENCH-01, fatia 3).
 *
 * Duas leituras do mesmo contrato, com frases diferentes porque o gesto que
 * resolve é diferente:
 *
 * - no RASCUNHO, a lista é o que barra a ativação, e se corrige ali mesmo;
 * - na versão ATIVA, a matriz está fechada: quem aplicar recebe a Formulação
 *   em rascunho com a receita como está, e a correção do Modelo é uma versão
 *   nova.
 *
 * Mesmo desenho do painel da Formulação — bloco de destaque, cada item
 * nomeado, com o caminho para o cadastro dele.
 */
export function PendenciasDoModelo({
  issues,
  versao,
}: {
  issues: readonly FormulationComponentIssueDTO[];
  versao: "rascunho" | "ativa";
}) {
  if (issues.length === 0) return null;
  const uma = issues.length === 1;
  return (
    <div className="pendency-panel" role="region" aria-label="Componentes que precisam de revisão">
      <h4 className="pendency-panel__title">
        {versao === "rascunho"
          ? uma
            ? "1 componente impede ativar esta versão do modelo"
            : `${issues.length} componentes impedem ativar esta versão do modelo`
          : uma
            ? "1 componente da versão ativa precisa de revisão"
            : `${issues.length} componentes da versão ativa precisam de revisão`}
      </h4>
      <p className="pendency-panel__sub">
        {versao === "rascunho"
          ? "O cadastro do item mudou depois que a linha foi gravada. Troque o componente ou ajuste o item antes de ativar — as outras versões não mudam."
          : "Quem aplicar este modelo recebe a formulação em rascunho, com a receita como está, e só consegue ativá-la depois de corrigir estes itens. Para corrigir o modelo, crie uma nova versão."}
      </p>
      <ul className="pendency-panel__list">
        {issues.map((issue) => (
          <li key={`${issue.code}-${issue.itemId}`}>
            {/* O código abre a frase; o nome vem junto, porque é por ele que
                quem monta a receita reconhece a linha. */}
            <span>
              {issue.description} ({issue.itemName})
            </span>{" "}
            <Link to={entityHref("item", issue.itemId)}>Abrir o item</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
