import type { SupplierDTO } from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { SupplierItemsSection } from "../../components/SupplierItemsSection";
import { formatDate } from "../../lib/dates";
import {
  SUPPLIER_FORM_ID,
  SupplierFormFields,
  useSupplierForm,
} from "./supplier-form";

interface SupplierFormModalProps {
  mode: "create" | "edit";
  supplier: SupplierDTO | null;
  onClose: () => void;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: SupplierDTO) => void;
}

/**
 * Modal fullscreen de criação/edição de fornecedor.
 *
 * Os campos vivem em `supplier-form`, compartilhados com a página
 * `/cadastros/fornecedores/novo`. Aqui fica só a casca: a moldura do modal e
 * o rodapé. Editar continua sendo exclusividade deste modal — a página
 * oficial cobre a criação, que é a que precisa de URL própria.
 */
export function SupplierFormModal({ mode, supplier, onClose, onSaved }: SupplierFormModalProps) {
  const controller = useSupplierForm({ mode, supplier, onSaved });
  const { saving } = controller;

  const codeChip = mode === "create" ? "Código gerado ao salvar" : supplier?.code;

  const footer =
    mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O fornecedor será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form={SUPPLIER_FORM_ID}
            className="btn btn--accent"
            disabled={saving}
          >
            {saving ? "Criando…" : "Criar fornecedor"}
          </button>
        </div>
      </>
    ) : (
      <>
        <span className="modal-fullscreen__foot-meta">
          Última alteração: {supplier ? formatDate(supplier.updatedAt) : "—"}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form={SUPPLIER_FORM_ID}
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
      crumb="Cadastros / Fornecedores"
      crumbActive={mode === "create" ? "Novo" : "Editar"}
      title={mode === "create" ? "Novo fornecedor" : supplier?.legalName}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      <SupplierFormFields {...controller} />

      {mode === "edit" && supplier && <SupplierItemsSection scope="supplier" id={supplier.id} />}
    </FullWorkspaceModal>
  );
}
