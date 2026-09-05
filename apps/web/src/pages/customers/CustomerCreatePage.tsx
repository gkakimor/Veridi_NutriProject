import { useNavigate } from "react-router-dom";
import type { CustomerDTO } from "@veridi/shared";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { useContextualCreateTarget } from "../../lib/use-contextual-create";
import { CUSTOMER_FORM_ID, CustomerFormFields, useCustomerForm } from "./customer-form";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";

/**
 * Tela oficial de cadastro de cliente — `/cadastros/clientes/novo`.
 *
 * Mesmos campos do modal, importados do mesmo módulo: o que a página traz de
 * novo é a URL. Com ela o cadastro sobrevive a um F5, pode ser aberto por
 * link direto e aparece no histórico do navegador — três coisas que um modal
 * não tem como dar.
 *
 * Serve a dois caminhos que não se misturam:
 *
 * - **Direto**, pelo menu ou pelo botão da listagem. Salvar volta para a
 *   lista; cancelar também.
 * - **Contextual**, quando alguém estava montando um Produto, um Pedido ou um
 *   recebimento de material do cliente, precisou de um cliente que ainda não
 *   existe e clicou em "+ Novo cliente". Aí salvar devolve ao documento com o
 *   rascunho intacto e o cliente já selecionado; cancelar devolve sem
 *   selecionar nada.
 *
 * A trilha permanece canônica nos dois casos — `Cadastros › Clientes › Novo
 * cliente`. De onde a pessoa veio é caminho de volta, não hierarquia do
 * sistema; misturar as duas coisas ensinaria uma estrutura que não existe.
 */
export function CustomerCreatePage() {
  const navigate = useNavigate();
  const contexto = useContextualCreateTarget("customer");

  const controller = useCustomerForm({
    mode: "create",
    customer: null,
    onSaved: (created?: CustomerDTO) => {
      if (
        created &&
        contexto.completeAndReturn({ entityId: created.id, label: created.legalName })
      ) {
        return;
      }
      // Caminho normal: a lista é onde o registro recém-criado passa a viver.
      navigate("/cadastros/clientes", { replace: true });
    },
  });

  function cancelar() {
    if (contexto.cancelAndReturn()) return;
    navigate("/cadastros/clientes");
  }

  return (
    <>
      <PageBreadcrumbs
        items={[
          { label: "Cadastros" },
          { label: "Clientes", href: "/cadastros/clientes" },
          { label: "Novo cliente", current: true },
        ]}
      />

      <div className="page__header">
        <div>
          <h1 className="page__title">Novo cliente</h1>
          <p className="page__subtitle">
            O código é gerado ao salvar. O cliente será criado como <b>Ativo</b>.
          </p>
        </div>
        {/*
          Só aparece em criação contextual, e diz PARA ONDE volta. "Voltar"
          sozinho não informa nada a quem saiu do meio de um documento.
        */}
        {contexto.isContextual && (
          <button type="button" className="btn btn--ghost" onClick={cancelar}>
            ← Voltar para {contexto.originLabel}
          </button>
        )}
      </div>

      {/* A mesma ajuda da lista: o fluxo descreve exatamente este formulário. */}

      <ContextHelp topic={helpTopics["cliente.comoFunciona"]} />

      <CustomerFormFields {...controller} />

      <div className="doc-actions">
        <div className="doc-actions__primary">
          <button type="button" className="btn btn--ghost" onClick={cancelar}>
            Cancelar
          </button>
          <button
            type="submit"
            form={CUSTOMER_FORM_ID}
            className="btn btn--accent"
            disabled={controller.saving}
          >
            {controller.saving ? "Criando…" : "Criar cliente"}
          </button>
        </div>
      </div>
    </>
  );
}
