import { useCallback } from "react";
import type { ItemDTO, ItemType } from "@veridi/shared";
import { ITEM_TYPE_LABELS } from "@veridi/shared";
import type {
  EntityConsultationColumn,
  EntityConsultationQuery,
} from "../../components/EntityConsultationDialog";
import { EntityConsultationDialog } from "../../components/EntityConsultationDialog";
import { listItems } from "../../lib/items-api";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { SELETOR_DE_ITEM_SEM_CADASTRO } from "./item-permissions";

/**
 * CONSULTA DE ITENS — o piloto da consulta assistida
 * (ASSISTED-ENTITY-SELECTOR-FOUNDATION-01).
 *
 * Abre de um seletor de Item e respeita o recorte DELE: o tipo que o campo
 * aceita e só itens ativos, os dois perguntados ao servidor — a mesma pergunta
 * da busca do seletor. Nada fica escolhível por ter vindo da consulta: o que o
 * campo recusaria aparece desabilitado, com o motivo, ou nem vem.
 *
 * Um tipo por campo, porque o servidor filtra um tipo por consulta. Campo que
 * aceita mais de um tipo (a linha da Ordem de Compra, por exemplo) precisa de
 * um filtro aditivo na API antes de ganhar a consulta — juntar páginas de dois
 * tipos no navegador quebraria a paginação e a contagem.
 */

/** O rótulo da ação no seletor — o que se consulta, não "Pesquisar". */
export const CONSULTAR_ITENS = "Consultar itens";

/** Colunas: código, nome (com o que a busca também enxerga), tipo, unidade e situação. */
const COLUNAS: readonly EntityConsultationColumn<ItemDTO>[] = [
  { header: "Código", kind: "code", cell: (item) => item.code },
  {
    header: "Nome",
    kind: "flex",
    cell: (item) => {
      /*
       * A busca do servidor acha também por fonte e nutriente. Sem mostrar os
       * dois, "folato" traria "L-metilfolato de cálcio" sem dizer por quê. O
       * código legado é o que se confere contra a planilha antiga.
       */
      const detalhes = [
        item.declaredNutrient,
        item.sourceName && item.sourceName !== item.name ? item.sourceName : null,
        item.externalCode ? `Código legado: ${item.externalCode}` : null,
      ].filter((parte): parte is string => Boolean(parte));
      return (
        <>
          {item.name}
          {detalhes.length > 0 && <span className="cell-sub">{detalhes.join(" · ")}</span>}
        </>
      );
    },
  },
  {
    header: "Tipo",
    cell: (item) => <span className="badge badge--neutral">{ITEM_TYPE_LABELS[item.type]}</span>,
  },
  { header: "Unidade", cell: (item) => item.unit.code },
  {
    header: "Situação",
    cell: (item) => (
      <span className={item.active ? "badge badge--active" : "badge badge--inactive"}>
        {item.active ? "Ativo" : "Inativo"}
      </span>
    ),
  },
];

export interface ItemConsultationDialogProps {
  /** O tipo que o campo aceita — o mesmo da busca do seletor. */
  type: ItemType;
  initialTerm: string;
  /** A tela de origem, para a trilha. */
  crumb: string;
  /** Recusa do CAMPO além de tipo e situação — "já está em outra linha". */
  unavailableReason?: ((item: ItemDTO) => string | null) | undefined;
  onSelect: (item: ItemDTO) => void;
  onClose: () => void;
  /** A criação no contexto que o seletor já oferece. Ausente = perfil não cria. */
  create?: { label: string; onCreate: (term: string) => void } | undefined;
  /** Para onde vai o escolhido. */
  footerNote: string;
}

export function ItemConsultationDialog({
  type,
  initialTerm,
  crumb,
  unavailableReason,
  onSelect,
  onClose,
  create,
  footerNote,
}: ItemConsultationDialogProps) {
  const buscar = useCallback(
    async ({ term, page, pageSize }: EntityConsultationQuery) => {
      const resposta = await listItems({
        type,
        active: true,
        ...(term ? { search: term } : {}),
        page,
        pageSize,
      });
      return { records: resposta.items, total: resposta.total };
    },
    [type],
  );

  /*
   * O servidor já devolve só o tipo e só ativos. A conferência aqui é a
   * segunda trava, a mesma de `itemElegivelParaSecao`: um registro fora do
   * recorte não vira escolha por nenhum caminho.
   */
  const motivo = useCallback(
    (item: ItemDTO): string | null => {
      if (item.type !== type) return `Este campo aceita só ${ITEM_TYPE_LABELS[type]}.`;
      if (!item.active) return "Item inativo não entra em escolha nova.";
      return unavailableReason ? unavailableReason(item) : null;
    },
    [type, unavailableReason],
  );

  return (
    <EntityConsultationDialog<ItemDTO>
      title="Consulta de itens"
      crumb={crumb}
      searchLabel="Buscar itens"
      searchPlaceholder="Buscar por código, nome, fonte, nutriente ou barcode…"
      initialTerm={initialTerm}
      scope={[`Tipo: ${ITEM_TYPE_LABELS[type]}`, "Situação: somente ativos"]}
      fetchPage={buscar}
      recordKey={(item) => item.id}
      recordLabel={(item) => `${item.code} · ${item.name}`}
      columns={COLUNAS}
      unavailableReason={motivo}
      onSelect={onSelect}
      onClose={onClose}
      create={create}
      emptyMessage={
        create
          ? "Nenhum item encontrado. Confira o termo ou cadastre um item novo."
          : SELETOR_DE_ITEM_SEM_CADASTRO.emptyMessage
      }
      countLabel={(total) => `${formatIntegerPtBr(total)} ${total === 1 ? "item" : "itens"}`}
      fallbackError="Falha ao consultar itens"
      footerNote={footerNote}
    />
  );
}
