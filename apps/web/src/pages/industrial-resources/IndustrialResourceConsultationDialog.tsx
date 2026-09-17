import { useCallback } from "react";
import type { IndustrialResourceDTO, IndustrialResourceType } from "@veridi/shared";
import {
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
  isCapacityResourceType,
} from "@veridi/shared";
import type {
  EntityConsultationColumn,
  EntityConsultationMultipleSelection,
  EntityConsultationQuery,
  EntityConsultationSelection,
  EntityConsultationSingleSelection,
} from "../../components/EntityConsultationDialog";
import { EntityConsultationDialog } from "../../components/EntityConsultationDialog";
import { listIndustrialResources } from "../../lib/industrial-resources-api";
import { formatDecimalPtBr, formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { OPCOES_VALOR_INDUSTRIAL } from "../../lib/numeric-scales";

/**
 * CONSULTA DE RECURSOS INDUSTRIAIS (ASSISTED-ENTITY-MULTISELECT-01).
 *
 * A mesma consulta assistida dos itens, com o que o cadastro do RECURSO sabe
 * para distinguir dois parecidos: o tipo (e a potência, no equipamento), a
 * capacidade — quantos trabalham ao mesmo tempo —, a unidade de uso e a
 * situação. Nada de tarifa: valor em reais é do cadastro na data do cálculo,
 * não da escolha. Nada de pureza, fonte ou subtipo: não existem no recurso.
 *
 * Um tipo por campo, ou todos: o servidor filtra um tipo por consulta, e
 * juntar páginas de dois tipos no navegador quebraria a paginação e a contagem
 * — por isso a etapa do Roteiro (mão de obra E equipamento) ainda não a usa.
 */

const NOME_DO_REGISTRO = { singular: "recurso", plural: "recursos" } as const;

const COLUNAS: readonly EntityConsultationColumn<IndustrialResourceDTO>[] = [
  { header: "Código", kind: "code", cell: (recurso) => recurso.code },
  {
    header: "Nome",
    kind: "flex",
    /* A busca acha também pela descrição: sem mostrá-la, o achado não diria por quê. */
    cell: (recurso) => (
      <>
        {recurso.name}
        {recurso.description && <span className="cell-sub">{recurso.description}</span>}
      </>
    ),
  },
  {
    header: "Tipo",
    kind: "detail",
    cell: (recurso) => (
      <>
        {INDUSTRIAL_RESOURCE_TYPE_LABELS[recurso.type]}
        {/* Potência só existe no equipamento; desconhecida é "não informada", nunca zero. */}
        {recurso.type === "EQUIPMENT" && (
          <span className="cell-sub">
            {recurso.powerKw
              ? `Potência: ${formatDecimalPtBr(recurso.powerKw, OPCOES_VALOR_INDUSTRIAL)} kW`
              : "Potência não informada"}
          </span>
        )}
      </>
    ),
  },
  {
    header: "Capacidade",
    kind: "detail",
    /*
     * Quantos deste recurso trabalham ao mesmo tempo. Sem número, "Não
     * cadastrada" — lacuna de cadastro, nunca "nenhum". Energia não ocupa
     * recurso: travessão, como na linha do modelo.
     */
    cell: (recurso) =>
      !isCapacityResourceType(recurso.type)
        ? "—"
        : recurso.capacityQuantity === null
          ? "Não cadastrada"
          : formatIntegerPtBr(recurso.capacityQuantity),
  },
  {
    header: "Unidade de uso",
    cell: (recurso) => INDUSTRIAL_RATE_UOM_LABELS[recurso.defaultUsageUom],
  },
  {
    header: "Situação",
    kind: "status",
    cell: (recurso) => (
      <span className={recurso.active ? "badge badge--active" : "badge badge--inactive"}>
        {recurso.active ? "Ativo" : "Inativo"}
      </span>
    ),
  },
];

interface IndustrialResourceConsultationBaseProps {
  /** O recorte do campo: um tipo só, ou todos (ausente). */
  type?: IndustrialResourceType | undefined;
  /** `false` quando o campo aceita inativos — o Modelo de Estrutura nunca os filtrou. */
  onlyActive: boolean;
  initialTerm: string;
  /** A tela de origem, para a trilha. */
  crumb: string;
  /** Recusa do CAMPO além de tipo e situação — "já adicionado neste modelo". */
  unavailableReason?: ((recurso: IndustrialResourceDTO) => string | null) | undefined;
  onClose: () => void;
  /** Para onde vai o escolhido. */
  footerNote: string;
}

export type IndustrialResourceConsultationDialogProps = IndustrialResourceConsultationBaseProps &
  (
    | EntityConsultationSingleSelection<IndustrialResourceDTO>
    | Omit<EntityConsultationMultipleSelection<IndustrialResourceDTO>, "recordNoun">
  );

export function IndustrialResourceConsultationDialog(props: IndustrialResourceConsultationDialogProps) {
  const { type, onlyActive, initialTerm, crumb, unavailableReason, onClose, footerNote } = props;

  const buscar = useCallback(
    async ({ term, page, pageSize }: EntityConsultationQuery) => {
      const resposta = await listIndustrialResources({
        ...(type ? { type } : {}),
        ...(onlyActive ? { active: true } : {}),
        ...(term ? { search: term } : {}),
        page,
        pageSize,
      });
      return { records: resposta.resources, total: resposta.total };
    },
    [type, onlyActive],
  );

  /* O servidor já aplica o recorte; esta é a segunda trava, a mesma do item. */
  const motivo = useCallback(
    (recurso: IndustrialResourceDTO): string | null => {
      if (type && recurso.type !== type) {
        return `Este campo aceita só ${INDUSTRIAL_RESOURCE_TYPE_LABELS[type]}.`;
      }
      if (onlyActive && !recurso.active) return "Recurso inativo não entra em escolha nova.";
      return unavailableReason ? unavailableReason(recurso) : null;
    },
    [type, onlyActive, unavailableReason],
  );

  const selecao: EntityConsultationSelection<IndustrialResourceDTO> =
    props.selectionMode === "multiple"
      ? {
          selectionMode: "multiple",
          onSelectMany: props.onSelectMany,
          maxSelection: props.maxSelection,
          recordNoun: NOME_DO_REGISTRO,
          createHint: props.createHint,
        }
      : { selectionMode: "single", onSelect: props.onSelect, create: props.create };

  return (
    <EntityConsultationDialog<IndustrialResourceDTO>
      title="Consulta de recursos industriais"
      crumb={crumb}
      searchLabel="Buscar recursos"
      searchPlaceholder="Buscar por código, nome ou descrição…"
      initialTerm={initialTerm}
      scope={[
        type ? `Tipo: ${INDUSTRIAL_RESOURCE_TYPE_LABELS[type]}` : "Tipo: todos",
        onlyActive ? "Situação: somente ativos" : "Situação: ativos e inativos",
      ]}
      fetchPage={buscar}
      recordKey={(recurso) => recurso.id}
      recordLabel={(recurso) => `${recurso.code} · ${recurso.name}`}
      columns={COLUNAS}
      unavailableReason={motivo}
      onClose={onClose}
      emptyMessage="Nenhum recurso industrial encontrado."
      countLabel={(total) => `${formatIntegerPtBr(total)} ${total === 1 ? "recurso" : "recursos"}`}
      fallbackError="Falha ao consultar recursos industriais"
      footerNote={footerNote}
      {...selecao}
    />
  );
}
