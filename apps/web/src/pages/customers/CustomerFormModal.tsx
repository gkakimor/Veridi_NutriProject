import { useCallback } from "react";
import type { CustomerDTO } from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { formatDate } from "../../lib/dates";
import { CUSTOMER_FORM_ID, CustomerFormFields, useCustomerForm } from "./customer-form";

interface CustomerFormModalProps {
  mode: "create" | "edit";
  customer: CustomerDTO | null;
  onClose: () => void;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: CustomerDTO) => void;
  /**
   * Abre o Cliente existente em CONSULTA: o perfil não edita o cadastro
   * (CUSTOMER-EDIT-PERMISSIONS-01). Quem hospeda decide pela sessão; o modal
   * só não oferece o que a API recusaria.
   */
  readOnly?: boolean;
}

/**
 * Modal fullscreen de criação/edição de cliente.
 *
 * Os campos vivem em `customer-form`, compartilhados com a página
 * `/cadastros/clientes/novo`. Aqui fica só a casca: a moldura do modal e o
 * rodapé. Editar continua sendo exclusividade deste modal — a página oficial
 * cobre a criação, que é a que precisa de URL própria.
 */
export function CustomerFormModal({
  mode,
  customer,
  onClose,
  onSaved,
  readOnly = false,
}: CustomerFormModalProps) {
  // Consulta só existe para registro que já existe: criar é sempre edição.
  const consulta = readOnly && mode === "edit" && customer !== null;
  const controller = useCustomerForm({ mode, customer, onSaved, readOnly: consulta });

  /**
   * Cancelar, ✕ e Esc: o router não vê nada disso — a guarda vê.
   *
   * Memorizado porque é dependência do efeito de foco e trap do modal: um
   * `onClose` novo a cada renderização remontava o efeito a cada tecla, e o
   * campo ficava com a primeira letra.
   */
  const fechar = useCallback(
    () => controller.confirmarSaida(onClose),
    [controller.confirmarSaida, onClose],
  );
  const { saving } = controller;

  const codeChip = mode === "create" ? "Código gerado ao salvar" : customer?.code;

  const rodapeDeEdicao =
    mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O cliente será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={fechar}>
            Cancelar
          </button>
          <button
            type="submit"
            form={CUSTOMER_FORM_ID}
            className="btn btn--accent"
            disabled={saving}
          >
            {saving ? "Criando…" : "Criar cliente"}
          </button>
        </div>
      </>
    ) : (
      <>
        <span className="modal-fullscreen__foot-meta">
          Última alteração: {customer ? formatDate(customer.updatedAt) : "—"}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={fechar}>
            Cancelar
          </button>
          <button
            type="submit"
            form={CUSTOMER_FORM_ID}
            className="btn btn--accent"
            disabled={saving}
          >
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </>
    );

  // Consulta: nada a gravar, então nada de "Cancelar" nem de "Salvar".
  const footer = consulta ? (
    <>
      <span className="modal-fullscreen__foot-meta">
        Última alteração: {customer ? formatDate(customer.updatedAt) : "—"}
      </span>
      <div className="modal-fullscreen__actions">
        <button type="button" className="btn btn--secondary" onClick={fechar}>
          Fechar
        </button>
      </div>
    </>
  ) : (
    rodapeDeEdicao
  );

  return (
    <FullWorkspaceModal
      open
      onClose={fechar}
      crumb="Cadastros / Clientes"
      crumbActive={mode === "create" ? "Novo" : consulta ? "Consulta" : "Editar"}
      title={mode === "create" ? "Novo cliente" : customer?.legalName}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      <CustomerFormFields {...controller} />
    </FullWorkspaceModal>
  );
}
