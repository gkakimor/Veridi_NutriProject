import { useCallback } from "react";
import type { ItemDTO, ItemType } from "@veridi/shared";
import { ITEM_FAMILY_LABELS, ITEM_TYPE_LABELS, PACKAGING_SUBTYPE_LABELS } from "@veridi/shared";
import type {
  EntityConsultationColumn,
  EntityConsultationMultipleSelection,
  EntityConsultationQuery,
  EntityConsultationSelection,
  EntityConsultationSingleSelection,
} from "../../components/EntityConsultationDialog";
import { EntityConsultationDialog } from "../../components/EntityConsultationDialog";
import { listItems } from "../../lib/items-api";
import { formatIntegerPtBr, formatPercentPtBr } from "../../lib/numeric-ptbr";
import { OPCOES_PERCENTUAL_TECNICO } from "../../lib/numeric-scales";
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
 *
 * AS COLUNAS SÃO DO TIPO (ASSISTED-ENTITY-MULTISELECT-01). A consulta é o lugar
 * de DECIDIR entre registros parecidos — dois "L-Triptofano" com pureza
 * diferente, duas "Tampa 38 mm" de subtipos diferentes —, então mostra o que o
 * cadastro sabe para distinguir, e só o que faz sentido para o tipo:
 * matéria-prima traz fonte, família, nutriente e a pureza CADASTRADA;
 * embalagem traz o subtipo e nunca pureza. A bancada continua compacta.
 */

/** O rótulo da ação no seletor — o que se consulta, não "Pesquisar". */
export const CONSULTAR_ITENS = "Consultar itens";

/** "item"/"itens" — o contador e o botão da seleção múltipla. */
const NOME_DO_REGISTRO = { singular: "item", plural: "itens" } as const;

const CODIGO: EntityConsultationColumn<ItemDTO> = {
  header: "Código",
  kind: "code",
  cell: (item) => item.code,
};

/*
 * O código legado junto do nome: é o que se confere contra a planilha antiga.
 * Fonte e nutriente têm coluna própria na matéria-prima — a busca do servidor
 * acha também por eles, e "folato" trazendo "L-metilfolato de cálcio" precisa
 * mostrar por quê.
 */
const NOME: EntityConsultationColumn<ItemDTO> = {
  header: "Nome",
  kind: "flex",
  cell: (item) => (
    <>
      {item.name}
      {item.externalCode && <span className="cell-sub">Código legado: {item.externalCode}</span>}
    </>
  ),
};

/**
 * Fonte / função — a mesma leitura da coluna da bancada: a fonte química em
 * cima; família e nutriente declarado, curtos, embaixo ("Aminoácido ·
 * Triptofano"). Sem fonte, a família e o nutriente sobem; sem nada, "Não
 * informada" — nunca um travessão que pareça valor.
 */
const FONTE_E_FUNCAO: EntityConsultationColumn<ItemDTO> = {
  header: "Fonte / Função",
  kind: "detail",
  cell: (item) => {
    const funcao = [item.family ? ITEM_FAMILY_LABELS[item.family] : null, item.declaredNutrient]
      .filter((parte): parte is string => Boolean(parte))
      .join(" · ");
    if (!item.sourceName) return funcao || "Não informada";
    return (
      <>
        {item.sourceName}
        {funcao && <span className="cell-sub">{funcao}</span>}
      </>
    );
  },
};

/**
 * A pureza do CADASTRO, com esse nome: a da formulação é outra coisa — é o
 * snapshot que cada versão aplica e edita na bancada. Sem pureza cadastrada a
 * célula diz "Não informada": `null` é desconhecida, nunca 0% nem 100%.
 */
const PUREZA_CADASTRADA: EntityConsultationColumn<ItemDTO> = {
  header: "Pureza cadastrada",
  kind: "detail",
  cell: (item) =>
    item.defaultPurityPercent === null
      ? "Não informada"
      : formatPercentPtBr(item.defaultPurityPercent, OPCOES_PERCENTUAL_TECNICO),
};

/** Pote, tampa, rótulo — o que separa duas embalagens de nome parecido. */
const SUBTIPO: EntityConsultationColumn<ItemDTO> = {
  header: "Subtipo",
  kind: "detail",
  cell: (item) =>
    item.packagingSubtype ? PACKAGING_SUBTYPE_LABELS[item.packagingSubtype] : "Não informado",
};

const UNIDADE: EntityConsultationColumn<ItemDTO> = {
  header: "Unidade",
  cell: (item) => item.unit.code,
};

const SITUACAO: EntityConsultationColumn<ItemDTO> = {
  header: "Situação",
  kind: "status",
  cell: (item) => (
    <span className={item.active ? "badge badge--active" : "badge badge--inactive"}>
      {item.active ? "Ativo" : "Inativo"}
    </span>
  ),
};

/** As colunas que distinguem registros DESTE tipo — nenhuma sem sentido para ele. */
export function colunasDaConsultaDeItens(type: ItemType): readonly EntityConsultationColumn<ItemDTO>[] {
  if (type === "RAW_MATERIAL") {
    return [CODIGO, NOME, FONTE_E_FUNCAO, PUREZA_CADASTRADA, UNIDADE, SITUACAO];
  }
  if (type === "PACKAGING") return [CODIGO, NOME, SUBTIPO, UNIDADE, SITUACAO];
  return [CODIGO, NOME, UNIDADE, SITUACAO];
}

interface ItemConsultationBaseProps {
  /** O tipo que o campo aceita — o mesmo da busca do seletor. */
  type: ItemType;
  initialTerm: string;
  /** A tela de origem, para a trilha. */
  crumb: string;
  /** Recusa do CAMPO além de tipo e situação — "já está em outra linha". */
  unavailableReason?: ((item: ItemDTO) => string | null) | undefined;
  onClose: () => void;
  /** Para onde vai o escolhido. */
  footerNote: string;
}

/**
 * Única (a linha): `onSelect` e, quando o perfil cria, `create`. Múltipla (a
 * seção): `onSelectMany`, o teto e, no lugar do "+ Novo", `createHint`. O nome
 * do que se marca é sempre "item".
 */
export type ItemConsultationDialogProps = ItemConsultationBaseProps &
  (
    | EntityConsultationSingleSelection<ItemDTO>
    | Omit<EntityConsultationMultipleSelection<ItemDTO>, "recordNoun">
  );

export function ItemConsultationDialog(props: ItemConsultationDialogProps) {
  const { type, initialTerm, crumb, unavailableReason, onClose, footerNote } = props;

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

  const selecao: EntityConsultationSelection<ItemDTO> =
    props.selectionMode === "multiple"
      ? {
          selectionMode: "multiple",
          onSelectMany: props.onSelectMany,
          maxSelection: props.maxSelection,
          recordNoun: NOME_DO_REGISTRO,
          createHint: props.createHint,
        }
      : { selectionMode: "single", onSelect: props.onSelect, create: props.create };
  /* Quem pode cadastrar ouve "cadastre"; quem não pode, a quem pedir. */
  const cadastra = props.selectionMode === "multiple" ? Boolean(props.createHint) : Boolean(props.create);

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
      columns={colunasDaConsultaDeItens(type)}
      unavailableReason={motivo}
      onClose={onClose}
      emptyMessage={
        cadastra
          ? "Nenhum item encontrado. Confira o termo ou cadastre um item novo."
          : SELETOR_DE_ITEM_SEM_CADASTRO.emptyMessage
      }
      countLabel={(total) => `${formatIntegerPtBr(total)} ${total === 1 ? "item" : "itens"}`}
      fallbackError="Falha ao consultar itens"
      footerNote={footerNote}
      {...selecao}
    />
  );
}
