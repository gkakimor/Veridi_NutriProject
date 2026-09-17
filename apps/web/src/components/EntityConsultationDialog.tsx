import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BulkSelectionCheckbox } from "./BulkSelection";
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
 *
 * SELEÇÃO MÚLTIPLA (ASSISTED-ENTITY-MULTISELECT-01). Onde a tela monta uma
 * LISTA — as linhas de uma seção da receita, os recursos de um modelo —, a
 * mesma consulta abre com `selectionMode: "multiple"`: caixa de marcar por
 * registro, contador no rodapé e uma confirmação só, que devolve todos os
 * marcados de uma vez (`onSelectMany`). A marcação é da CONSULTA, não da
 * página: guardada pelo `recordKey`, ela atravessa busca nova, busca limpa,
 * troca de página e recarga — marcar 3 numa busca, 2 noutra e 1 numa terceira
 * é adicionar 6. O teto é explícito (`maxSelection`, 10 no máximo): a caixa
 * que passaria dele não marca, e o rodapé diz por quê. O campo de uma linha
 * continua na seleção única — escolher UM registro para aquela linha.
 */

/** Coluna da consulta. */
export interface EntityConsultationColumn<T> {
  /** Cabeçalho na tabela e rótulo do valor no cartão empilhado (≤ 640px). */
  header: string;
  cell: (record: T) => ReactNode;
  /**
   * O papel do valor, que decide a largura e a ordem no cartão (≤ 640px):
   *
   * - `code` — código de negócio, em fonte de código, ao lado do nome;
   * - `flex` — o nome: quebra linha e divide a primeira linha do cartão com o
   *   código;
   * - `detail` — a informação técnica que DISTINGUE registros parecidos (fonte,
   *   pureza cadastrada, subtipo, capacidade): quebra linha e, no cartão, ganha
   *   linha própria com o nome da coluna, logo depois do nome;
   * - `status` — a situação: no cartão vem depois da informação técnica e antes
   *   dos demais valores;
   * - `tight` (padrão) — valor curto que completa a leitura (unidade): no
   *   cartão, por último.
   */
  kind?: "code" | "flex" | "detail" | "status" | "tight";
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

/** O que a consulta é e de onde lê — igual nos dois modos de seleção. */
export interface EntityConsultationBaseProps<T> {
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
  /** Nome do registro no controle acessível: "Selecionar MP-000030 · Cafeína". */
  recordLabel: (record: T) => string;
  columns: readonly EntityConsultationColumn<T>[];
  /** Por que a linha não se escolhe AGORA. `null` = selecionável. */
  unavailableReason?: ((record: T) => string | null) | undefined;
  onClose: () => void;
  /** O vazio da consulta: "Nenhum item encontrado." */
  emptyMessage: string;
  /** "12 itens" — a contagem do recorte inteiro, não da página. */
  countLabel: (total: number) => string;
  fallbackError: string;
  /** Para onde a escolha vai — dito no rodapé, onde fica sempre à vista. */
  footerNote: string;
}

/** Seleção única — o padrão: "Selecionar" na linha devolve aquele registro. */
export interface EntityConsultationSingleSelection<T> {
  selectionMode?: "single" | undefined;
  onSelect: (record: T) => void;
  /** Criação no contexto. Ausente = o perfil não cria, e o botão não existe. */
  create?: { label: string; onCreate: (term: string) => void } | undefined;
}

/** Seleção múltipla — caixas de marcar e uma confirmação para o lote inteiro. */
export interface EntityConsultationMultipleSelection<T> {
  selectionMode: "multiple";
  /** Os marcados, na ordem em que foram marcados. Chamado uma vez, ao confirmar. */
  onSelectMany: (records: T[]) => void;
  /** Quantos cabem numa confirmação. Padrão e teto: `CONSULTA_MULTIPLA_MAXIMO`. */
  maxSelection?: number | undefined;
  /**
   * O que se marca, no singular e no plural ("item"/"itens"): contador, botão e
   * aviso de limite falam dele. As frases concordam no masculino.
   */
  recordNoun: { singular: string; plural: string };
  /**
   * No lugar do "+ Novo": cadastrar sai da tela, e a marcação não atravessa
   * rotas. A frase diz onde cadastrar. Ausente = nada (o perfil não cria).
   */
  createHint?: string | undefined;
}

export type EntityConsultationSelection<T> =
  | EntityConsultationSingleSelection<T>
  | EntityConsultationMultipleSelection<T>;

export type EntityConsultationDialogProps<T> = EntityConsultationBaseProps<T> &
  EntityConsultationSelection<T>;

/** Página de 20, como as listagens de cadastro. */
export const CONSULTA_PAGE_SIZE = 20;

/** Espera da digitação antes de perguntar ao servidor — a das listagens. */
export const CONSULTA_DEBOUNCE_MS = 300;

/** Registros por confirmação na seleção múltipla — regra do produto, não da tela. */
export const CONSULTA_MULTIPLA_MAXIMO = 10;

function classeDaColuna(kind: EntityConsultationColumn<unknown>["kind"]): string {
  if (kind === "code") return "is-code col-tight";
  if (kind === "flex") return "col-flex";
  if (kind === "detail") return "col-detail";
  if (kind === "status") return "col-tight col-status";
  return "col-tight";
}

/** "Nenhum item selecionado", "1 item selecionado", "3 itens selecionados". */
function contadorDeMarcados(quantos: number, nome: { singular: string; plural: string }): string {
  if (quantos === 0) return `Nenhum ${nome.singular} selecionado`;
  if (quantos === 1) return `1 ${nome.singular} selecionado`;
  return `${quantos} ${nome.plural} selecionados`;
}

/** "Adicionar itens" (nada marcado), "Adicionar 1 item", "Adicionar 3 itens". */
function rotuloDaConfirmacao(quantos: number, nome: { singular: string; plural: string }): string {
  if (quantos === 0) return `Adicionar ${nome.plural}`;
  if (quantos === 1) return `Adicionar 1 ${nome.singular}`;
  return `Adicionar ${quantos} ${nome.plural}`;
}

export function EntityConsultationDialog<T>(props: EntityConsultationDialogProps<T>) {
  const {
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
    onClose,
    emptyMessage,
    countLabel,
    fallbackError,
    footerNote,
  } = props;
  const multipla = props.selectionMode === "multiple" ? props : null;
  const unica = props.selectionMode === "multiple" ? null : props;

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
  /* Múltipla: a caixa de marcar abre a linha, e o motivo fecha. */
  const colunas = columns.length + (multipla ? 2 : 1);

  /*
   * OS MARCADOS — pelo `recordKey`, com o registro inteiro.
   *
   * Não sai da página à vista: a página troca a cada busca, e marcar numa
   * busca e confirmar depois de outra é o gesto que a consulta existe para
   * permitir. O registro vai junto porque quem recebe precisa dele inteiro
   * (unidade, pureza, tipo) e ele pode não estar em página nenhuma à vista na
   * hora de confirmar. `Map` guarda a ordem em que foram marcados.
   */
  const [marcados, setMarcados] = useState<ReadonlyMap<string, T>>(() => new Map());
  const limite = Math.min(
    multipla?.maxSelection ?? CONSULTA_MULTIPLA_MAXIMO,
    CONSULTA_MULTIPLA_MAXIMO,
  );
  const noLimite = multipla !== null && marcados.size >= limite;
  /* Uma confirmação só: o segundo clique antes de a origem fechar não duplica o lote. */
  const confirmado = useRef(false);

  function alternar(registro: T) {
    const chave = recordKey(registro);
    setMarcados((atual) => {
      if (atual.has(chave)) {
        const proximo = new Map(atual);
        proximo.delete(chave);
        return proximo;
      }
      // A caixa já chega desabilitada; esta é a segunda trava, a da regra.
      if (atual.size >= limite || (unavailableReason?.(registro) ?? null) !== null) return atual;
      const proximo = new Map(atual);
      proximo.set(chave, registro);
      return proximo;
    });
  }

  function confirmar() {
    if (!multipla || marcados.size === 0 || confirmado.current) return;
    confirmado.current = true;
    multipla.onSelectMany([...marcados.values()]);
  }

  const idDoLimite = `${campoId}-limite`;
  const idDoMotivo = (chave: string) => `${campoId}-motivo-${chave}`;

  const rodape = multipla ? (
    <>
      <div className="consulta-assistida__selecao">
        {/* Quem usa leitor de tela ouve o contador mudar a cada caixa. */}
        <span className="consulta-assistida__contador" aria-live="polite" aria-atomic="true">
          {contadorDeMarcados(marcados.size, multipla.recordNoun)}
        </span>
        {noLimite ? (
          <span id={idDoLimite} className="consulta-assistida__limite" role="status">
            {`Você pode adicionar até ${limite} ${limite === 1 ? multipla.recordNoun.singular : multipla.recordNoun.plural} por vez.`}
          </span>
        ) : (
          <span className="modal-fullscreen__foot-meta">{footerNote}</span>
        )}
      </div>
      <div className="modal-fullscreen__actions">
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={marcados.size === 0}
          onClick={confirmar}
        >
          {rotuloDaConfirmacao(marcados.size, multipla.recordNoun)}
        </button>
      </div>
    </>
  ) : (
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
      closeHint={
        multipla ? "Fecha a consulta sem adicionar nada" : "Fecha a consulta sem escolher"
      }
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
          {unica?.create && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => unica.create?.onCreate(digitado.trim())}
            >
              + {unica.create.label}
            </button>
          )}
          {/* Múltipla não cadastra: sair para o cadastro perderia o que já foi marcado. */}
          {multipla?.createHint && (
            <p className="consulta-assistida__dica">{multipla.createHint}</p>
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
          <table
            className={
              multipla ? "table table--consulta table--consulta-multipla" : "table table--consulta"
            }
          >
            <thead>
              <tr>
                {multipla && (
                  <th className="table__select table__select--bulk">
                    <span className="sr-only">Marcar</span>
                  </th>
                )}
                {columns.map((coluna) => (
                  <th key={coluna.header} className={classeDaColuna(coluna.kind)}>
                    {coluna.header}
                  </th>
                ))}
                <th className="col-tight col-acao">
                  <span className="sr-only">{multipla ? "Observação" : "Ação"}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {registros.map((registro) => {
                const chave = recordKey(registro);
                const motivo = unavailableReason?.(registro) ?? null;
                const marcado = marcados.has(chave);
                /* Travada pelo teto: só a caixa ainda desmarcada, e o rodapé diz por quê. */
                const travadaPeloLimite = !marcado && motivo === null && noLimite;
                return (
                  <tr key={chave}>
                    {multipla && (
                      <td className="table__select table__select--bulk">
                        {/* O nome acessível COMEÇA pelo verbo: quem comanda por
                            voz diz "Selecionar", e o leitor de tela ouve de qual
                            registro é a caixa. */}
                        <BulkSelectionCheckbox
                          label={`Selecionar ${recordLabel(registro)}`}
                          checked={marcado}
                          disabled={!marcado && (motivo !== null || noLimite)}
                          describedBy={
                            motivo !== null && !marcado
                              ? idDoMotivo(chave)
                              : travadaPeloLimite
                                ? idDoLimite
                                : undefined
                          }
                          onChange={() => alternar(registro)}
                        />
                      </td>
                    )}
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
                      {unica && (
                        /* O nome acessível COMEÇA pelo texto visível: quem
                           comanda por voz diz "Selecionar", e o leitor de tela
                           ouve de qual registro é o botão. */
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={motivo !== null}
                          aria-label={`Selecionar ${recordLabel(registro)}`}
                          onClick={() => unica.onSelect(registro)}
                        >
                          Selecionar
                        </button>
                      )}
                      {motivo !== null && (
                        <span className="cell-sub" id={multipla ? idDoMotivo(chave) : undefined}>
                          {motivo}
                        </span>
                      )}
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
