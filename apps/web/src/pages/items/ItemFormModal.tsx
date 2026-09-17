import { useCallback } from "react";
import type { ItemDTO, UnitOfMeasureDTO } from "@veridi/shared";
import { isLabelItem } from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FornecedoresDoItemSection } from "../supplier-items/FornecedoresDoItem";
import { ItemCostReferenceSection } from "../../components/ItemCostReferenceSection";
import { ItemLabelFileSection } from "../../components/ItemLabelFileSection";
import { formatDate } from "../../lib/dates";
import { ITEM_FORM_ID, ItemFormFields, useItemForm } from "./item-form";

interface ItemFormModalProps {
  mode: "create" | "edit";
  item: ItemDTO | null;
  units: UnitOfMeasureDTO[];
  onClose: () => void;
  /** Recebe o registro criado — permite selecioná-lo de volta na origem. */
  onSaved: (created?: ItemDTO) => void;
  /**
   * Abre o Item existente em CONSULTA: o perfil não edita o cadastro
   * (MASTER-DATA-EDIT-PERMISSIONS-01). Quem hospeda decide pela sessão; o modal
   * só não oferece o que a API recusaria.
   */
  readOnly?: boolean;
}

/**
 * Modal fullscreen de criação/edição de item.
 *
 * Os campos vivem em `item-form`, compartilhados com a página
 * `/cadastros/itens/novo`. Aqui fica só a casca: a moldura do modal e o
 * rodapé. Editar continua sendo exclusividade deste modal — a página oficial
 * cobre a criação, que é a que precisa de URL própria.
 */
export function ItemFormModal({
  mode,
  item,
  units,
  onClose,
  onSaved,
  readOnly = false,
}: ItemFormModalProps) {
  // Consulta só existe para registro que já existe: criar é sempre edição.
  const consulta = readOnly && mode === "edit" && item !== null;
  const controller = useItemForm({ mode, item, units, onSaved, readOnly: consulta });
  const { saving } = controller;

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

  /*
   * Criou e o arquivo do Rótulo não subiu (ITEM-FORM-BY-TYPE-01): nada de
   * "Criar item" de novo. Concluir — também pelo ✕ e pelo Esc — devolve o Item
   * criado a quem abriu, como numa criação completa.
   */
  const criadoSemArquivo = controller.criadoSemArquivo !== null;

  const rodapeDeEdicao = criadoSemArquivo ? (
    <div className="modal-fullscreen__actions">
      <button type="button" className="btn btn--accent" onClick={controller.concluirCriacao}>
        Concluir
      </button>
    </div>
  ) : mode === "create" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          O item será criado como <b>Ativo</b>.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={fechar}>
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
          <button type="button" className="btn btn--ghost" onClick={fechar}>
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

  // Consulta: nada a gravar, então nada de "Cancelar" nem de "Salvar".
  const footer = consulta ? (
    <>
      <span className="modal-fullscreen__foot-meta">
        Última alteração: {item ? formatDate(item.updatedAt) : "—"}
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

  const codeChip = controller.criadoSemArquivo
    ? controller.criadoSemArquivo.item.code
    : mode === "create"
      ? "Código gerado ao salvar"
      : item?.code;

  return (
    <FullWorkspaceModal
      open
      onClose={criadoSemArquivo ? controller.concluirCriacao : fechar}
      crumb="Cadastros / Itens de estoque"
      crumbActive={mode === "create" ? "Novo" : consulta ? "Consulta" : "Editar"}
      title={mode === "create" ? "Novo item de estoque" : item?.name}
      {...(codeChip ? { codeChip } : {})}
      footer={footer}
    >
      <ItemFormFields {...controller} />

      {/* Arquivo versionado só existe para Rótulo — embalagem com subtipo
          Rótulo, pelo cadastro GRAVADO, nunca pelo nome (LABEL-ATTACHMENTS-01).
          Os demais itens não mostram nada. Permissão própria: aparece também
          em consulta. Vem logo depois do cadastro, antes de fornecedores e
          custo, para não ficar escondido no fim (ITEM-FORM-BY-TYPE-01). Na
          criação quem cuida do arquivo é o próprio formulário. */}
      {mode === "edit" && item && isLabelItem(item) && <ItemLabelFileSection itemId={item.id} />}

      {/* Fornecedores existem depois que o item existe — o modal de criacao
          continua enxuto. A seção tem permissão própria (ITEM-SUPPLIER-UX-01) e
          aparece também em consulta: quem só consulta o Item vê os fornecedores
          e abre o detalhe da relação. */}
      {mode === "edit" && item && <FornecedoresDoItemSection item={item} />}

      {/* Custo de referência vem DEPOIS dos fornecedores de propósito: a
          referência manual é a última fonte da seleção automática, e a
          ordem na tela repete a ordem da regra. Produto acabado não é
          comprado — não tem custo de aquisição a referenciar. A seção tem
          permissão própria e aparece também em consulta: o Comercial não
          edita o Item, mas define a referência de custo dele. */}
      {mode === "edit" && item && item.type !== "FINISHED_PRODUCT" && (
        <ItemCostReferenceSection itemId={item.id} />
      )}
    </FullWorkspaceModal>
  );
}
