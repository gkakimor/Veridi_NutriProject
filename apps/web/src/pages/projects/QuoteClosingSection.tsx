import { Link } from "react-router-dom";
import type { ProjectStatus, QuoteVersionDTO } from "@veridi/shared";
import { entityHref } from "../../components/EntityLink";

/**
 * Fechamento da proposta aceita.
 *
 * O que acontece depois do "sim" do cliente não estava em lugar nenhum: quem
 * aceitava a proposta ficava sem saber que ainda faltava aprovar o projeto, e
 * depois digitava o pedido à mão em outra tela — perdendo no caminho de onde
 * veio o preço.
 *
 * A seção mostra os dois passos que restam e oferece o que for possível
 * AGORA. Antes da aprovação ela explica o que falta em vez de apresentar um
 * botão que recusaria o clique.
 */

interface Props {
  quote: QuoteVersionDTO;
  projectId: string;
  projectStatus?: ProjectStatus | undefined;
  canEdit: boolean;
  saving: boolean;
  onGenerate: () => void;
}

export function QuoteClosingSection({
  quote,
  projectId,
  projectStatus,
  canEdit,
  saving,
  onGenerate,
}: Props) {
  if (quote.status !== "ACCEPTED") return null;

  const projetoAprovado = projectStatus === "APPROVED";
  const pedido = quote.sourcedOrder;

  return (
    <div className="quote-closing">
      <h4 className="quote-closing__title">Fechamento</h4>

      <dl className="definition-list">
        <dt>Orçamento</dt>
        <dd>
          <strong>Aceito</strong> — {quote.versionLabel}
        </dd>

        <dt>Projeto</dt>
        <dd>
          {projetoAprovado ? (
            "Aprovado"
          ) : (
            <>
              Ainda precisa de aprovação —{" "}
              <Link to={entityHref("project", projectId)}>abrir o projeto</Link>
            </>
          )}
        </dd>

        <dt>Pedido</dt>
        <dd>
          {pedido ? (
            <Link to={entityHref("customerOrder", pedido.id)}>{pedido.code}</Link>
          ) : (
            "Ainda não gerado"
          )}
        </dd>
      </dl>

      {/* Um caminho de cada vez: gerar, abrir, ou a explicação do que falta. */}
      {pedido ? (
        <div className="line-actions">
          <Link className="btn btn--secondary" to={entityHref("customerOrder", pedido.id)}>
            Abrir pedido {pedido.code}
          </Link>
        </div>
      ) : !projetoAprovado ? (
        <p className="field__hint">
          O cliente aceitou, mas os produtos ainda estão em desenvolvimento. Aprove o projeto para
          liberá-los e o pedido poderá ser gerado a partir deste orçamento.
        </p>
      ) : canEdit ? (
        <div className="line-actions">
          <button
            type="button"
            className="btn btn--accent"
            disabled={saving}
            onClick={onGenerate}
          >
            Gerar pedido a partir do orçamento aceito
          </button>
          <span className="field__hint">
            O pedido nasce com os produtos, as quantidades e os preços acordados aqui.
          </span>
        </div>
      ) : null}
    </div>
  );
}
