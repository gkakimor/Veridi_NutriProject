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
}

/**
 * Modal fullscreen de criação/edição de cliente.
 *
 * Os campos vivem em `customer-form`, compartilhados com a página
 * `/cadastros/clientes/novo`. Aqui fica só a casca: a moldura do modal e o
 * rodapé. Editar continua sendo exclusividade deste modal — a página oficial
 * cobre a criação, que é a que precisa de URL própria.
 */
export function CustomerFormModal({ mode, customer, onClose, onSaved }: CustomerFormModalProps) {
  const controller = useCustomerForm({ mode, customer, onSaved });
  const { saving } = controller;

  const codeChip = mode === "create" ? "Código gerado ao salvar" : customer?.code;

  const footer =
    mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O cliente será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
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
          <button type="button" className="btn btn--ghost" onClick={onClose}>
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

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Cadastros / Clientes"
      crumbActive={mode === "create" ? "Novo" : "Editar"}
      title={mode === "create" ? "Novo cliente" : customer?.legalName}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      <CustomerFormFields {...controller} />
    </FullWorkspaceModal>
  );
}
