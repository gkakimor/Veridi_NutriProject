import type { ItemDTO, UnitOfMeasureDTO } from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { SupplierItemsSection } from "../../components/SupplierItemsSection";
import { formatDate } from "../../lib/dates";
import { ITEM_FORM_ID, ItemFormFields, useItemForm } from "./item-form";

interface ItemFormModalProps {
  mode: "create" | "edit";
  item: ItemDTO | null;
  units: UnitOfMeasureDTO[];
  onClose: () => void;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: ItemDTO) => void;
}

/**
 * Modal fullscreen de criação/edição de item.
 *
 * Os campos vivem em `item-form`, compartilhados com a página
 * `/cadastros/itens/novo`. Aqui fica só a casca: a moldura do modal e o
 * rodapé. Editar continua sendo exclusividade deste modal — a página oficial
 * cobre a criação, que é a que precisa de URL própria.
 */
export function ItemFormModal({ mode, item, units, onClose, onSaved }: ItemFormModalProps) {
  const controller = useItemForm({ mode, item, units, onSaved });
  const { saving } = controller;

  const footer =
    mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O item será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form={ITEM_FORM_ID}
            className="btn btn--accent"
            disabled={saving}
          >
            {saving ? "Criando…" : "Criar item"}
          </button>
        </div>
      </>
    ) : (
      <>
        <span className="modal-fullscreen__foot-meta">
          Última alteração: {item ? formatDate(item.updatedAt) : "—"}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form={ITEM_FORM_ID}
            className="btn btn--accent"
            disabled={saving}
          >
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </>
    );

  const codeChip = mode === "create" ? "Código gerado ao salvar" : item?.code;

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Cadastros / Itens de estoque"
      crumbActive={mode === "create" ? "Novo" : "Editar"}
      title={mode === "create" ? "Novo item de estoque" : item?.name}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      <ItemFormFields {...controller} />

      {/* Fornecedores existem depois que o item existe — o modal de criacao
          continua enxuto. */}
      {mode === "edit" && item && <SupplierItemsSection scope="item" id={item.id} />}
    </FullWorkspaceModal>
  );
}
