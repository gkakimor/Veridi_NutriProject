import { Navigate, useNavigate } from "react-router-dom";
import type { IndustrialResourceDetailDTO } from "@veridi/shared";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { useAuth } from "../../app/AuthProvider";
import { useContextualCreateTarget } from "../../lib/use-contextual-create";
import {
  INDUSTRIAL_RESOURCE_FORM_ID,
  IndustrialResourceFormFields,
  useIndustrialResourceForm,
} from "./industrial-resource-form";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";

const LISTA = "/gestao/recursos-industriais";

/**
 * Tela oficial de cadastro de recurso industrial —
 * `/gestao/recursos-industriais/novo`.
 *
 * Mesmos campos do modal, do mesmo módulo. Serve ao acesso direto pelo menu
 * e à criação contextual disparada do campo "Recurso" da estrutura de
 * custos, que precisa voltar ao ponto de origem com o rascunho intacto.
 *
 * Criar recurso é `ADMIN` nas três pontas — no botão da listagem, aqui, e no
 * servidor, que é a autoridade final. O desvio abaixo não é a proteção; é
 * cortesia, para quem chega por link não encarar um formulário que vai
 * receber 403 no fim.
 */
export function IndustrialResourceCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const contexto = useContextualCreateTarget("industrialResource");

  const controller = useIndustrialResourceForm({
    onSaved: (created: IndustrialResourceDetailDTO) => {
      if (contexto.completeAndReturn({ entityId: created.id, label: created.name })) return;
      // Fora do contexto, o destino é o detalhe: é lá que a tarifa entra, e
      // recurso sem tarifa não serve a estrutura de custo nenhuma.
      navigate(`${LISTA}/${created.id}`, { replace: true });
    },
  });

  function cancelar() {
    if (contexto.cancelAndReturn()) return;
    navigate(LISTA);
  }

  if (user && user.role !== "ADMIN") return <Navigate to={LISTA} replace />;

  return (
    <>
      <PageBreadcrumbs
        items={[
          { label: "Gestão" },
          { label: "Recursos industriais", href: LISTA },
          { label: "Novo recurso", current: true },
        ]}
      />

      <div className="page__header">
        <div>
          <h1 className="page__title">Novo recurso industrial</h1>
          <p className="page__subtitle">
            O código é gerado ao salvar. A tarifa entra depois, no recurso criado.
          </p>
        </div>
        {contexto.isContextual && (
          <button type="button" className="btn btn--ghost" onClick={cancelar}>
            ← Voltar para {contexto.originLabel}
          </button>
        )}
      </div>

      {/* A mesma ajuda da lista: o fluxo A descreve exatamente este formulário. */}

      <ContextHelp topic={helpTopics["recursoIndustrial.comoFunciona"]} />

      <IndustrialResourceFormFields {...controller} />

      <div className="doc-actions">
        <div className="doc-actions__primary">
          <button type="button" className="btn btn--ghost" onClick={cancelar}>
            Cancelar
          </button>
          <button
            type="submit"
            form={INDUSTRIAL_RESOURCE_FORM_ID}
            className="btn btn--primary"
            disabled={controller.saving}
          >
            {controller.saving ? "Criando…" : "Criar recurso"}
          </button>
        </div>
      </div>
    </>
  );
}
