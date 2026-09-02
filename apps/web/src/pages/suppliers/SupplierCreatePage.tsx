import { useNavigate } from "react-router-dom";
import type { SupplierDTO } from "@veridi/shared";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { useContextualCreateTarget } from "../../lib/use-contextual-create";
import { SUPPLIER_FORM_ID, SupplierFormFields, useSupplierForm } from "./supplier-form";

/**
 * Tela oficial de cadastro de fornecedor — `/cadastros/fornecedores/novo`.
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
 * - **Contextual**, quando alguém estava preenchendo uma Ordem de Compra,
 *   precisou de um fornecedor que ainda não existe e clicou em "+ Novo
 *   fornecedor". Aí salvar devolve à ordem com o rascunho intacto e o
 *   fornecedor já selecionado; cancelar devolve sem selecionar nada.
 *
 * A trilha permanece canônica nos dois casos — `Cadastros › Fornecedores ›
 * Novo fornecedor`. De onde a pessoa veio é caminho de volta, não hierarquia
 * do sistema; misturar as duas coisas ensinaria uma estrutura que não existe.
 */
export function SupplierCreatePage() {
  const navigate = useNavigate();
  const contexto = useContextualCreateTarget("supplier");

  const controller = useSupplierForm({
    mode: "create",
    supplier: null,
    onSaved: (created?: SupplierDTO) => {
      if (
        created &&
        contexto.completeAndReturn({ entityId: created.id, label: created.legalName })
      ) {
        return;
      }
      // Caminho normal: a lista é onde o registro recém-criado passa a viver.
      navigate("/cadastros/fornecedores", { replace: true });
    },
  });

  function cancelar() {
    if (contexto.cancelAndReturn()) return;
    navigate("/cadastros/fornecedores");
  }

  return (
    <>
      <PageBreadcrumbs
        items={[
          { label: "Cadastros" },
          { label: "Fornecedores", href: "/cadastros/fornecedores" },
          { label: "Novo fornecedor", current: true },
        ]}
      />

      <div className="page__header">
        <div>
          <h1 className="page__title">Novo fornecedor</h1>
          <p className="page__subtitle">
            O código é gerado ao salvar. O fornecedor será criado como <b>Ativo</b>.
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

      <SupplierFormFields {...controller} />

      <div className="doc-actions">
        <div className="doc-actions__primary">
          <button type="button" className="btn btn--ghost" onClick={cancelar}>
            Cancelar
          </button>
          <button
            type="submit"
            form={SUPPLIER_FORM_ID}
            className="btn btn--accent"
            disabled={controller.saving}
          >
            {controller.saving ? "Criando…" : "Criar fornecedor"}
          </button>
        </div>
      </div>
    </>
  );
}
