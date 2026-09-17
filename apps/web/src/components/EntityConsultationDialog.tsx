import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FullWorkspaceModal } from "./FullWorkspaceModal";
import { ListStatusRow } from "./ListStatusRow";
import { useFilteredPage, useListQuery } from "../lib/list-query";

/**
 * CONSULTA ASSISTIDA — a fundação (ASSISTED-ENTITY-SELECTOR-FOUNDATION-01).
 *
 * O seletor com busca (`SearchableEntitySelect`) é o caminho rápido: digitar,
 * ver, escolher. Quem não percebe que basta digitar, ou precisa ver uma lista
 * maior e comparar antes de escolher, ia para Cadastros e perdia o documento
 * que estava montando. A consulta abre POR CIMA da tela — a origem continua
 * montada, com o que foi digitado, o que não foi salvo e a rolagem onde
 * estava — e devolve o escolhido direto ao campo que a abriu.
 *
 * Esta casca não sabe de entidade nenhuma. Quem a usa diz:
 *
 * - o RECORTE do campo, já aplicado em `fetchPage` e dito em `scope`: a
 *   consulta nunca mostra como escolhível o que o seletor recusaria;
 * - as colunas e o motivo de uma linha não se escolher (`unavailableReason`) —
 *   a linha aparece, desabilitada, em vez de sumir sem explicação;
 * - o que fazer com o escolhido (`onSelect`) e, só quando o perfil cria, a
 *   criação no contexto (`create`) — a MESMA que o seletor já oferece.
 *
 * A busca e a paginação são as das listagens (`useListQuery`,
 * `useFilteredPage`, `ListStatusRow`): no servidor, página a página, com o
 * termo e a página preservados enquanto a consulta está aberta.
 */

/** Coluna da consulta. */
export interface EntityConsultationColumn<T> {
  /** Cabeçalho na tabela e rótulo do valor no cartão empilhado (≤ 640px). */
  header: string;
  cell: (record: T) => ReactNode;
  /**
   * `code` — código de negócio, em fonte de código; `flex` — texto que quebra
   * linha (nome); `tight` (padrão) — valor curto: tipo, unidade, situação.
   */
  kind?: "code" | "flex" | "tight";
}

export interface EntityConsultationQuery {
  term: string;
  page: number;
  pageSize: number;
}

export interface EntityConsultationPage<T> {
  records: T[];
  total: number;
}

export interface EntityConsultationDialogProps<T> {
  /** "Consulta de itens" — título e último segmento da trilha. */
  title: string;
  /** A tela de origem — "Formulação". A consulta é dela, não de Cadastros. */
  crumb: string;
  searchLabel: string;
  searchPlaceholder: string;
  /** O que já estava digitado no seletor: a consulta abre procurando por ele. */
  initialTerm: string;
  /** O recorte imposto pelo campo, em frases curtas ("Tipo: Matéria-prima"). */
  scope: readonly string[];
  /**
   * Uma página do servidor, com o recorte do campo já aplicado. Fica estável
   * enquanto a consulta está aberta: o recorte é o do campo que a abriu.
   */
  fetchPage: (query: EntityConsultationQuery) => Promise<EntityConsultationPage<T>>;
  pageSize?: number;
  recordKey: (record: T) => string;
  /** Nome do registro no botão acessível: "Selecionar MP-000030 · Cafeína". */
  recordLabel: (record: T) => string;
  columns: readonly EntityConsultationColumn<T>[];
  /** Por que a linha não se escolhe AGORA. `null` = selecionável. */
  unavailableReason?: (record: T) => string | null;
  onSelect: (record: T) => void;
  onClose: () => void;
  /** Criação no contexto. Ausente = o perfil não cria, e o botão não existe. */
  create?: { label: string; onCreate: (term: string) => void } | undefined;
  /** O vazio da consulta: "Nenhum item encontrado." */
  emptyMessage: string;
  /** "12 itens" — a contagem do recorte inteiro, não da página. */
  countLabel: (total: number) => string;
  fallbackError: string;
  /** Para onde a escolha vai — dito no rodapé, onde fica sempre à vista. */
  footerNote: string;
}

/** Página de 20, como as listagens de cadastro. */
export const CONSULTA_PAGE_SIZE = 20;

/** Espera da digitação antes de perguntar ao servidor — a das listagens. */
export const CONSULTA_DEBOUNCE_MS = 300;

function classeDaColuna(kind: EntityConsultationColumn<unknown>["kind"]): string {
  if (kind === "code") return "is-code col-tight";
  if (kind === "flex") return "col-flex";
  return "col-tight";
}

export function EntityConsultationDialog<T>({
  title,
  crumb,
  searchLabel,
  searchPlaceholder,
  initialTerm,
  scope,
  fetchPage,
  pageSize = CONSULTA_PAGE_SIZE,
  recordKey,
  recordLabel,
  columns,
  unavailableReason,
  onSelect,
  onClose,
  create,
  emptyMessage,
  countLabel,
  fallbackError,
  footerNote,
}: EntityConsultationDialogProps<T>) {
  const campoId = useId();
  const campo = useRef<HTMLInputElement>(null);
  const [digitado, setDigitado] = useState(initialTerm);
  /*
   * O termo que o servidor recebe. Nasce igual ao digitado: o que veio do
   * seletor é consultado na abertura, sem esperar a pausa da digitação.
   */
  const [termo, setTermo] = useState(initialTerm.trim());

  useEffect(() => {
    const espera = setTimeout(() => setTermo(digitado.trim()), CONSULTA_DEBOUNCE_MS);
    return () => clearTimeout(espera);
  }, [digitado]);

  /*
   * Cursor no FIM do termo trazido: quem abriu com "ribof" continua digitando
   * "lavina", não reescreve do começo. O modal já pôs o foco no campo — o
   * efeito dele roda antes deste, porque é filho.
   */
  useEffect(() => {
    const elemento = campo.current;
    if (!elemento) return;
    const fim = elemento.value.length;
    try {
      elemento.setSelectionRange(fim, fim);
    } catch {
      // Campo que não aceita seleção: o foco já basta.
    }
  }, []);

  /* Termo novo é página 1 no mesmo render — uma consulta por troca. */
  const [page, setPage] = useFilteredPage({ termo });
  const consulta = useListQuery(fetchPage, { term: termo, page, pageSize }, { fallbackError });
  const registros = consulta.data?.records ?? [];
  const total = consulta.data?.total ?? 0;
  const totalDePaginas = Math.max(1, Math.ceil(total / pageSize));
  const colunas = columns.length + 1;

  const rodape = (
    <>
      <span className="modal-fullscreen__foot-meta">{footerNote}</span>
      <div className="modal-fullscreen__actions">
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </>
  );

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb={crumb}
      crumbActive={title}
      title={title}
      footer={rodape}
      closeHint="Fecha a consulta sem escolher"
      initialFocus={campo}
    >
      <div className="consulta-assistida">
        {/*
          O recorte À VISTA. Sem ele, quem procura um produto acabado no campo
          de matéria-prima conclui que o registro não existe — quando o que
          acontece é que ele não serve àquele campo.
        */}
        <p className="consulta-assistida__recorte">
          <span>Mostrando só o que este campo aceita:</span>
          {scope.map((parte) => (
            <span key={parte} className="badge badge--neutral">
              {parte}
            </span>
          ))}
        </p>

        <div className="toolbar consulta-assistida__barra">
          <div className="toolbar__search">
            <label className="sr-only" htmlFor={campoId}>
              {searchLabel}
            </label>
            <input
              id={campoId}
              ref={campo}
              type="search"
              autoComplete="off"
              placeholder={searchPlaceholder}
              value={digitado}
              onChange={(event) => setDigitado(event.target.value)}
            />
          </div>
          {create && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => create.onCreate(digitado.trim())}
            >
              + {create.label}
            </button>
          )}
        </div>

        {consulta.error && (
          <p className="form-alert" role="alert">
            {consulta.error}{" "}
            <button type="button" className="btn btn--ghost btn--sm" onClick={consulta.reload}>
              Tentar de novo
            </button>
          </p>
        )}

        <div className="table-container" aria-busy={consulta.loading || undefined}>
          <table className="table table--consulta">
            <thead>
              <tr>
                {columns.map((coluna) => (
                  <th key={coluna.header} className={classeDaColuna(coluna.kind)}>
                    {coluna.header}
                  </th>
                ))}
                <th className="col-tight col-acao">
                  <span className="sr-only">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {registros.map((registro) => {
                const chave = recordKey(registro);
                const motivo = unavailableReason?.(registro) ?? null;
                return (
                  <tr key={chave}>
                    {columns.map((coluna) => (
                      <td
                        key={coluna.header}
                        className={classeDaColuna(coluna.kind)}
                        data-label={coluna.header}
                      >
                        {coluna.cell(registro)}
                      </td>
                    ))}
                    <td className="col-tight col-acao">
                      {/* O nome acessível COMEÇA pelo texto visível: quem
                          comanda por voz diz "Selecionar", e o leitor de tela
                          ouve de qual registro é o botão. */}
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={motivo !== null}
                        aria-label={`Selecionar ${recordLabel(registro)}`}
                        onClick={() => onSelect(registro)}
                      >
                        Selecionar
                      </button>
                      {motivo !== null && <span className="cell-sub">{motivo}</span>}
                    </td>
                  </tr>
                );
              })}
              <ListStatusRow colSpan={colunas} query={consulta} rowCount={registros.length}>
                {emptyMessage}
              </ListStatusRow>
            </tbody>
          </table>
          {consulta.data && <div className="table-foot">{countLabel(total)}</div>}
        </div>

        {consulta.data && totalDePaginas > 1 && (
          <div className="pagination">
            <span>
              Página {page} de {totalDePaginas}
            </span>
            <div className="table__actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={page >= totalDePaginas}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </FullWorkspaceModal>
  );
}
