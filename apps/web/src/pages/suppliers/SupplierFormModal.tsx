import { useCallback } from "react";
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
  /**
   * Abre o Fornecedor existente em CONSULTA: o perfil não edita o cadastro
   * (MASTER-DATA-EDIT-PERMISSIONS-01). Quem hospeda decide pela sessão; o modal
   * só não oferece o que a API recusaria.
   */
  readOnly?: boolean;
}

/**
 * Modal fullscreen de criação/edição de fornecedor.
 *
 * Os campos vivem em `supplier-form`, compartilhados com a página
 * `/cadastros/fornecedores/novo`. Aqui fica só a casca: a moldura do modal e
 * o rodapé. Editar continua sendo exclusividade deste modal — a página
 * oficial cobre a criação, que é a que precisa de URL própria.
 */
export function SupplierFormModal({
  mode,
  supplier,
  onClose,
  onSaved,
  readOnly = false,
}: SupplierFormModalProps) {
  // Consulta só existe para registro que já existe: criar é sempre edição.
  const consulta = readOnly && mode === "edit" && supplier !== null;
  const controller = useSupplierForm({ mode, supplier, onSaved, readOnly: consulta });

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

  const codeChip = mode === "create" ? "Código gerado ao salvar" : supplier?.code;

  const rodapeDeEdicao =
    mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O fornecedor será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={fechar}>
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
          <button type="button" className="btn btn--ghost" onClick={fechar}>
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

  // Consulta: nada a gravar, então nada de "Cancelar" nem de "Salvar".
  const footer = consulta ? (
    <>
      <span className="modal-fullscreen__foot-meta">
        Última alteração: {supplier ? formatDate(supplier.updatedAt) : "—"}
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
      crumb="Cadastros / Fornecedores"
      crumbActive={mode === "create" ? "Novo" : consulta ? "Consulta" : "Editar"}
      title={mode === "create" ? "Novo fornecedor" : supplier?.legalName}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      <SupplierFormFields {...controller} />

      {mode === "edit" && supplier && <SupplierItemsSection scope="supplier" id={supplier.id} />}
    </FullWorkspaceModal>
  );
}
