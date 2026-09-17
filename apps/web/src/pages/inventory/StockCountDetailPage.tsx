import { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  StockCountCloseIssueDTO,
  StockCountDecision,
  StockCountDetailDTO,
  StockCountPositionDTO,
} from "@veridi/shared";
import {
  STOCK_COUNT_DECISION_LABELS,
  STOCK_COUNT_FINDING_KIND_LABELS,
  STOCK_COUNT_MODE_LABELS,
  STOCK_COUNT_POSITION_SITUATION_LABELS,
  STOCK_COUNT_STATUS_LABELS,
} from "@veridi/shared";
import { useTituloDaTela } from "../../app/titulo-da-tela";
import { EntityLink } from "../../components/EntityLink";
import { FormSection } from "../../components/FormSection";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { TableEmptyRow } from "../../components/TableEmptyRow";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { NotFoundApiError, apiErrorMessage } from "../../lib/api-errors";
import { formatDate, formatDateTime } from "../../lib/dates";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/quantity";
import { getStockCount, isStockCountApiError } from "../../lib/stock-counts-api";
import {
  AdicionarPosicaoDialog,
  CancelarInventarioDialog,
  ConcluirPrimeiraContagemDialog,
  RegistrarOcorrenciaDialog,
  RetirarPosicaoDialog,
} from "./inventario-dialogos";
import { LinhaDoTempoDoInventario } from "./LinhaDoTempoDoInventario";
import { RevisaoDoInventario } from "./RevisaoDoInventario";
import { DecidirPosicoesDialog, EncerrarInventarioDialog, PedirRecontagemDialog } from "./revisao-dialogos";
import {
  ROTA_DOS_INVENTARIOS,
  aguardaContagem,
  casaComBusca,
  descreverEscopo,
  divergenciasDoInventario,
  donoDaPosicao,
  estaAberto,
  podeDecidir,
  podePedirRecontagem,
  progressoDoInventario,
  rotaDaContagem,
  situacaoBadgeClass,
  statusBadgeClass,
} from "./stock-count-display";
import { usePodeOperarInventario } from "./stock-count-permissions";
import "./inventario-fisico.css";

type Recorte = "todas" | "pendentes" | "contadas" | "retiradas";

const RECORTES: { chave: Recorte; rotulo: string }[] = [
  { chave: "todas", rotulo: "Todas" },
  { chave: "pendentes", rotulo: "Pendentes" },
  { chave: "contadas", rotulo: "Contadas" },
  { chave: "retiradas", rotulo: "Retiradas" },
];

const LINHAS_POR_VEZ = 100;

function noRecorte(posicao: StockCountPositionDTO, recorte: Recorte): boolean {
  if (recorte === "todas") return true;
  if (recorte === "retiradas") return posicao.situation === "REMOVED";
  if (posicao.situation === "REMOVED") return false;
  return recorte === "pendentes" ? aguardaContagem(posicao) : !aguardaContagem(posicao);
}

/** A contagem que vale na rodada atual — o número que a pessoa registrou, nunca o saldo. */
function contagemQueVale(posicao: StockCountPositionDTO): string | null {
  const valido = posicao.entries.find((registro) => registro.id === posicao.validEntryId);
  return valido && valido.round === posicao.currentRound ? valido.countedQuantity : null;
}

type Dialogo =
  | { tipo: "adicionar" }
  | { tipo: "retirar"; posicao: StockCountPositionDTO }
  | { tipo: "ocorrencia" }
  | { tipo: "cancelar" }
  | { tipo: "concluir" }
  | { tipo: "recontar"; posicoes: StockCountPositionDTO[] }
  | { tipo: "decidir"; posicoes: StockCountPositionDTO[]; decisao: StockCountDecision }
  | { tipo: "encerrar" };

function quantasPosicoes(quantidade: number): string {
  return quantidade === 1 ? "1 posição" : `${formatIntegerPtBr(quantidade)} posições`;
}

/**
 * Estoque → Inventário Físico → um inventário (INVENTORY-PHYSICAL-COUNT-01, Fatias 2A e 2B).
 *
 * Lê a leitura de REVISÃO, que o servidor mantém cega até a primeira contagem
 * terminar: numa contagem cega em contagem, esta tela não recebe saldo, esperado
 * nem diferença — não há o que esconder aqui. Concluída a primeira contagem, a
 * revisão revela, e o detalhe mostra o que o servidor passou a mostrar.
 *
 * Ações só para quem opera, e só as que o estado permite. Em revisão (2B):
 * pedir recontagem, decidir Ajustar ou Não ajustar e encerrar — com a
 * consequência lida da revisão e as recusas do servidor por posição.
 */
export function StockCountDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const podeOperar = usePodeOperarInventario();

  const [inventario, setInventario] = useState<StockCountDetailDTO | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [recorte, setRecorte] = useState<Recorte>("todas");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(LINHAS_POR_VEZ);
  const [versao, setVersao] = useState(0);
  const [recusa, setRecusa] = useState<StockCountCloseIssueDTO[] | null>(null);

  useTituloDaTela(inventario?.code);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setInventario(await getStockCount(id, "review"));
      setNaoEncontrado(false);
    } catch (falha) {
      if (falha instanceof NotFoundApiError || isStockCountApiError(falha, "not_found")) setNaoEncontrado(true);
      else setErro(apiErrorMessage(falha, "Falha ao carregar o inventário"));
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    setCarregando(true);
    void carregar();
  }, [carregar]);

  const trilha = (codigo: string) => (
    <PageBreadcrumbs items={[{ label: "Inventário Físico", href: ROTA_DOS_INVENTARIOS }, { label: codigo }]} />
  );

  if (carregando && !inventario) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Inventário</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (naoEncontrado || !inventario) {
    return (
      <>
        <div className="page__header">
          <div>
            <h1 className="page__title">{naoEncontrado ? "Inventário não encontrado" : "Inventário"}</h1>
          </div>
        </div>
        {erro && (
          <p className="form-alert" role="alert">
            {erro}{" "}
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void carregar()}>
              Tentar novamente
            </button>
          </p>
        )}
        <Link className="btn btn--ghost" to={ROTA_DOS_INVENTARIOS}>
          ← Voltar para Inventário Físico
        </Link>
      </>
    );
  }

  const aberto = estaAberto(inventario.status);
  const emContagem = inventario.status === "IN_PROGRESS";
  const ativas = inventario.positions.filter((posicao) => posicao.situation !== "REMOVED");
  const pendentes = ativas.filter(aguardaContagem).length;
  const revelado = !inventario.balancesHidden;
  const visiveis = inventario.positions.filter(
    (posicao) => noRecorte(posicao, recorte) && casaComBusca(posicao, busca),
  );
  /* A coluna de ação só existe quando há ação: em revisão ela empurrava a Situação para fora da tela. */
  const podeRetirar = podeOperar && emContagem;
  const colunas = (revelado ? 8 : 6) + (podeRetirar ? 1 : 0);
  const escopo = descreverEscopo(inventario.scopeFilters);

  function substituirPosicao(posicao: StockCountPositionDTO) {
    setInventario((atual) =>
      atual ? { ...atual, positions: atual.positions.map((p) => (p.id === posicao.id ? posicao : p)) } : atual,
    );
  }

  const emRevisao = inventario.status === "IN_REVIEW";
  const revisaoLiberada = inventario.firstRoundClosedAt !== null && !inventario.balancesHidden;

  /** Uma ação da revisão gravou: a revisão devolvida pelo servidor passa a ser a tela. */
  function aposAcaoDaRevisao(detalhe: StockCountDetailDTO, mensagem: string) {
    setDialogo(null);
    setInventario(detalhe);
    setVersao((atual) => atual + 1);
    setAviso(mensagem);
  }

  /** Ação oferecida por uma recusa do encerramento, sobre a posição como está agora. */
  function agirSobreRecusa(positionId: string, acao: "recontar" | "decidir") {
    if (!inventario) return;
    const posicao = inventario.positions.find((candidata) => candidata.id === positionId);
    if (!posicao) return;
    const numero = formatIntegerPtBr(posicao.sequence);
    const situacao = STOCK_COUNT_POSITION_SITUATION_LABELS[posicao.situation].toLocaleLowerCase("pt-BR");
    if (acao === "recontar") {
      if (podePedirRecontagem(posicao)) setDialogo({ tipo: "recontar", posicoes: [posicao] });
      else {
        setDialogo(null);
        setAviso(`A posição ${numero} não pode ser recontada agora: está ${situacao}.`);
      }
      return;
    }
    if (podeDecidir(posicao)) setDialogo({ tipo: "decidir", posicoes: [posicao], decisao: posicao.decision ?? "ADJUST" });
    else {
      setDialogo(null);
      setAviso(`A posição ${numero} não tem diferença a decidir agora: está ${situacao}.`);
    }
  }

  return (
    <>
      <div className="doc-header">
        <div>
          {trilha(inventario.code)}
          <div className="doc-title">
            <h1>{inventario.code}</h1>
            <span className={statusBadgeClass(inventario.status)}>{STOCK_COUNT_STATUS_LABELS[inventario.status]}</span>
            <span className="badge badge--neutral">{STOCK_COUNT_MODE_LABELS[inventario.mode]}</span>
          </div>
          {inventario.description && <p className="page__subtitle">{inventario.description}</p>}
        </div>
        {podeOperar && aberto && (
          <div className="table__actions">
            {emContagem ? (
              <Link className="btn btn--accent" to={rotaDaContagem(inventario.id)}>
                Contar
              </Link>
            ) : (
              pendentes > 0 && (
                <Link className="btn btn--accent" to={rotaDaContagem(inventario.id)}>
                  Contar pendentes
                </Link>
              )
            )}
            {emContagem && (
              <button type="button" className="btn btn--secondary" onClick={() => setDialogo({ tipo: "adicionar" })}>
                Adicionar posição
              </button>
            )}
            <button type="button" className="btn btn--secondary" onClick={() => setDialogo({ tipo: "ocorrencia" })}>
              Registrar ocorrência
            </button>
            <button type="button" className="btn btn--danger" onClick={() => setDialogo({ tipo: "cancelar" })}>
              Cancelar inventário
            </button>
            {emContagem && (
              <button type="button" className="btn btn--accent" onClick={() => setDialogo({ tipo: "concluir" })}>
                Concluir primeira contagem
              </button>
            )}
            {emRevisao && (
              <button type="button" className="btn btn--accent" onClick={() => setDialogo({ tipo: "encerrar" })}>
                Encerrar inventário
              </button>
            )}
          </div>
        )}
      </div>

      <ContextHelp topic={helpTopics["estoque.inventarioFisico"]} />

      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="callout" role="status">
          {aviso}
        </p>
      )}

      {inventario.status === "IN_REVIEW" && (
        <div className="callout" role="note">
          <p>
            <strong>Primeira contagem concluída</strong> em {formatDateTime(inventario.firstRoundClosedAt)} por{" "}
            {inventario.firstRoundClosedByName ?? "—"}. Revise as divergências: peça recontagem ou decida Ajustar ou Não
            ajustar, com motivo, e encerre. Nenhum ajuste de estoque é feito antes do encerramento.
          </p>
        </div>
      )}
      {inventario.status === "CANCELLED" && (
        <div className="callout" role="note">
          <p>
            <strong>Cancelado</strong> em {formatDateTime(inventario.cancelledAt)} por {inventario.cancelledByName ?? "—"}
            {inventario.cancelReason ? `: ${inventario.cancelReason}` : ""}. Somente leitura — nada foi apagado e nenhuma
            movimentação foi criada.
          </p>
        </div>
      )}
      {inventario.status === "COMPLETED" && (
        <div className="callout" role="note">
          <p>
            <strong>Encerrado</strong> em {formatDateTime(inventario.completedAt)} por {inventario.completedByName ?? "—"}.
            Somente leitura.{" "}
            {(() => {
              const ajustes = inventario.positions.filter((posicao) => posicao.adjustmentMovementId !== null).length;
              return ajustes === 0
                ? "Nenhum ajuste de estoque foi gerado."
                : `${ajustes === 1 ? "1 ajuste de estoque gerado" : `${formatIntegerPtBr(ajustes)} ajustes de estoque gerados`}, em Movimentações com o código ${inventario.code}.`;
            })()}
            {inventario.completedByCounter ? " Quem encerrou também registrou contagem neste inventário." : ""}
          </p>
        </div>
      )}

      <FormSection title="Resumo">
        <dl className="definition-list definition-list--faixa">
          <dt>Início</dt>
          <dd>
            {formatDateTime(inventario.createdAt)} · {inventario.createdByName}
          </dd>
          <dt>Progresso</dt>
          <dd>{progressoDoInventario(inventario)}</dd>
          <dt>Pendentes</dt>
          <dd>{formatIntegerPtBr(pendentes)}</dd>
          <dt>Retiradas</dt>
          <dd>{formatIntegerPtBr(inventario.removedCount)}</dd>
          <dt>Divergências</dt>
          <dd>{divergenciasDoInventario(inventario)}</dd>
          <dt>Ocorrências</dt>
          <dd>{formatIntegerPtBr(inventario.findings.length)}</dd>
        </dl>
      </FormSection>

      {escopo.length > 0 && (
        <FormSection title="Escopo">
          <dl className="definition-list definition-list--faixa">
            {escopo.map((linha, indice) => (
              <Fragment key={`${linha.rotulo}-${indice}`}>
                <dt>{linha.rotulo}</dt>
                <dd>{linha.valor}</dd>
              </Fragment>
            ))}
          </dl>
        </FormSection>
      )}

      {revisaoLiberada ? (
        <FormSection title={emRevisao ? "Revisão" : "Posições"}>
          <RevisaoDoInventario
            inventario={inventario}
            podeAgir={podeOperar && emRevisao}
            versao={versao}
            recusa={emRevisao ? recusa : null}
            aoPedirRecontagem={(posicoes) => setDialogo({ tipo: "recontar", posicoes })}
            aoDecidir={(posicoes, decisao) => setDialogo({ tipo: "decidir", posicoes, decisao })}
            aoLimparRecusa={() => setRecusa(null)}
          />
        </FormSection>
      ) : (
      <FormSection title="Posições">
        <div className="toolbar inv-barra-da-contagem">
          <div className="toolbar__search">
            <label className="sr-only" htmlFor="inv-detalhe-busca">
              Buscar posição
            </label>
            <input
              id="inv-detalhe-busca"
              type="search"
              placeholder="Item, código ou lote…"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
            />
          </div>
          <div className="inv-chips" role="group" aria-label="Recorte das posições">
            {RECORTES.map((opcao) => (
              <button
                key={opcao.chave}
                type="button"
                className="inv-chip"
                aria-pressed={recorte === opcao.chave}
                onClick={() => {
                  setRecorte(opcao.chave);
                  setLimite(LINHAS_POR_VEZ);
                }}
              >
                {opcao.rotulo}
              </button>
            ))}
          </div>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th className="is-numeric col-tight">Nº</th>
                <th className="col-flex">Item</th>
                <th className="col-tight">Lote · validade · local</th>
                <th className="col-label">Proprietário</th>
                <th className="is-numeric col-tight">Contagem</th>
                {revelado && <th className="is-numeric col-tight">Saldo de referência</th>}
                {revelado && <th className="is-numeric col-tight">Diferença</th>}
                <th className="col-flex">Situação</th>
                {podeRetirar && <th aria-label="Ações" />}
              </tr>
            </thead>
            <tbody>
              {visiveis.slice(0, limite).map((posicao) => {
                const valido = posicao.entries.find((registro) => registro.id === posicao.validEntryId) ?? null;
                return (
                  <tr key={posicao.id}>
                    <td className="is-numeric col-tight">{formatIntegerPtBr(posicao.sequence)}</td>
                    <td className="col-flex">
                      <span className="inv-celula-empilhada">
                        <span className="is-code inv-codigo-inteiro">{posicao.itemCode}</span>
                        <small>{posicao.itemName}</small>
                      </span>
                    </td>
                    <td className="col-tight">
                      <span className="inv-celula-empilhada">
                        <span className="inv-codigo-inteiro">{posicao.lotCode ?? "—"}</span>
                        <small>
                          {[
                            posicao.lotCode ? `val. ${formatDate(posicao.expiryDateAtReference)}` : null,
                            posicao.locationAtReference,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </small>
                      </span>
                    </td>
                    <td className="col-label">{donoDaPosicao(posicao)}</td>
                    <td className="is-numeric col-tight">
                      {formatQuantityWithUnit(contagemQueVale(posicao), posicao.unitCode)}
                    </td>
                    {revelado && (
                      <td className="is-numeric col-tight">
                        {formatQuantityWithUnit(posicao.referenceQuantity, posicao.unitCode)}
                      </td>
                    )}
                    {revelado && <td className="is-numeric col-tight">{formatQuantity(posicao.finalDifference)}</td>}
                    <td className="col-flex">
                      <span className={situacaoBadgeClass(posicao.situation)}>
                        {STOCK_COUNT_POSITION_SITUATION_LABELS[posicao.situation]}
                      </span>
                      {posicao.origin === "ADDED" && <span className="field__hint"> · adicionada</span>}
                      <br />
                      {posicao.situation === "REMOVED" ? (
                        <span className="field__hint">
                          Retirada por {posicao.removedByName ?? "—"} em {formatDateTime(posicao.removedAt)}
                          {posicao.removeReason ? `: ${posicao.removeReason}` : ""}
                        </span>
                      ) : valido ? (
                        <span className="field__hint">
                          {valido.countedByName} · {formatDateTime(valido.countedAt)}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    {podeRetirar && (
                      <td>
                        <div className="table__actions">
                          {posicao.situation !== "REMOVED" && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              aria-label={`Retirar a posição ${formatIntegerPtBr(posicao.sequence)}`}
                              onClick={() => setDialogo({ tipo: "retirar", posicao })}
                            >
                              Retirar
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {visiveis.length === 0 && (
                <TableEmptyRow colSpan={colunas}>Nenhuma posição neste recorte.</TableEmptyRow>
              )}
            </tbody>
          </table>
        </div>
        {visiveis.length > limite && (
          <div className="line-actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLimite((atual) => atual + LINHAS_POR_VEZ)}>
              Mostrar mais {formatIntegerPtBr(Math.min(LINHAS_POR_VEZ, visiveis.length - limite))}
            </button>
          </div>
        )}
      </FormSection>
      )}

      <FormSection title="Ocorrências">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th className="col-label">Tipo</th>
                <th className="col-flex">Identificação</th>
                <th className="col-flex">Item</th>
                <th className="is-numeric col-tight">Quantidade</th>
                <th className="col-flex">Observação</th>
                <th className="col-flex">Registrada por</th>
              </tr>
            </thead>
            <tbody>
              {inventario.findings.map((ocorrencia) => (
                <tr key={ocorrencia.id}>
                  <td className="col-label">{STOCK_COUNT_FINDING_KIND_LABELS[ocorrencia.kind]}</td>
                  <td className="col-flex">{ocorrencia.identification}</td>
                  <td className="col-flex">
                    <EntityLink kind="item" id={ocorrencia.itemId} code={ocorrencia.itemCode} name={ocorrencia.itemName} />
                  </td>
                  <td className="is-numeric col-tight">
                    {formatQuantityWithUnit(ocorrencia.quantity, ocorrencia.unitCode)}
                  </td>
                  <td className="col-flex">{ocorrencia.note ?? "—"}</td>
                  <td className="col-flex">
                    {ocorrencia.createdByName} · {formatDateTime(ocorrencia.createdAt)}
                  </td>
                </tr>
              ))}
              {inventario.findings.length === 0 && (
                <TableEmptyRow colSpan={6}>Nenhuma ocorrência registrada.</TableEmptyRow>
              )}
            </tbody>
          </table>
        </div>
      </FormSection>

      <FormSection title="Linha do tempo">
        <LinhaDoTempoDoInventario inventario={inventario} />
      </FormSection>

      {dialogo?.tipo === "adicionar" && (
        <AdicionarPosicaoDialog
          inventario={inventario}
          aoFechar={() => setDialogo(null)}
          aoAdicionar={(posicao) => {
            setDialogo(null);
            setAviso(`Posição ${formatIntegerPtBr(posicao.sequence)} adicionada: ${posicao.itemCode}${posicao.lotCode ? ` · ${posicao.lotCode}` : ""}.`);
            void carregar();
          }}
        />
      )}
      {dialogo?.tipo === "retirar" && (
        <RetirarPosicaoDialog
          inventarioId={inventario.id}
          posicao={dialogo.posicao}
          aoFechar={() => setDialogo(null)}
          aoRetirar={(posicao) => {
            setDialogo(null);
            substituirPosicao(posicao);
            setAviso(`Posição ${formatIntegerPtBr(posicao.sequence)} retirada.`);
            void carregar();
          }}
        />
      )}
      {dialogo?.tipo === "ocorrencia" && (
        <RegistrarOcorrenciaDialog
          inventario={inventario}
          aoFechar={() => setDialogo(null)}
          aoRegistrar={() => {
            setDialogo(null);
            setAviso("Ocorrência registrada.");
            void carregar();
          }}
        />
      )}
      {dialogo?.tipo === "cancelar" && (
        <CancelarInventarioDialog
          inventario={inventario}
          aoFechar={() => setDialogo(null)}
          aoCancelar={(detalhe) => {
            setDialogo(null);
            setAviso(null);
            setInventario(detalhe);
          }}
        />
      )}
      {dialogo?.tipo === "concluir" && (
        <ConcluirPrimeiraContagemDialog
          inventario={inventario}
          aoFechar={() => setDialogo(null)}
          aoConcluir={(detalhe) => {
            setDialogo(null);
            setAviso(null);
            setInventario(detalhe);
          }}
          aoIrParaPendentes={() => navigate(rotaDaContagem(inventario.id))}
        />
      )}
      {dialogo?.tipo === "recontar" && (
        <PedirRecontagemDialog
          inventario={inventario}
          posicoes={dialogo.posicoes}
          aoFechar={() => setDialogo(null)}
          aoPedir={(detalhe) =>
            aposAcaoDaRevisao(
              detalhe,
              `Recontagem pedida para ${quantasPosicoes(dialogo.posicoes.length)}. Quem conta usa "Contar pendentes".`,
            )
          }
        />
      )}
      {dialogo?.tipo === "decidir" && (
        <DecidirPosicoesDialog
          inventario={inventario}
          posicoes={dialogo.posicoes}
          decisaoInicial={dialogo.decisao}
          aoFechar={() => setDialogo(null)}
          aoDecidir={(detalhe) => {
            const decididas = detalhe.positions.filter((posicao) =>
              dialogo.posicoes.some((escolhida) => escolhida.id === posicao.id),
            );
            const decisao = decididas[0]?.decision;
            aposAcaoDaRevisao(
              detalhe,
              `Decisão registrada em ${quantasPosicoes(dialogo.posicoes.length)}${decisao ? `: ${STOCK_COUNT_DECISION_LABELS[decisao]}` : ""}.`,
            );
          }}
        />
      )}
      {dialogo?.tipo === "encerrar" && (
        <EncerrarInventarioDialog
          inventarioId={inventario.id}
          codigo={inventario.code}
          aoFechar={() => setDialogo(null)}
          aoEncerrar={(detalhe) => {
            const ajustes = detalhe.positions.filter((posicao) => posicao.adjustmentMovementId !== null).length;
            setRecusa(null);
            aposAcaoDaRevisao(
              detalhe,
              `${detalhe.code} encerrado: ${ajustes === 1 ? "1 ajuste de estoque gerado" : `${formatIntegerPtBr(ajustes)} ajustes de estoque gerados`}.`,
            );
          }}
          aoRecusar={(issues) => {
            setRecusa(issues);
            setAviso(null);
          }}
          aoAtualizar={(detalhe) => {
            setInventario(detalhe);
            setVersao((atual) => atual + 1);
          }}
          aoRecontar={(positionId) => agirSobreRecusa(positionId, "recontar")}
          aoDecidir={(positionId) => agirSobreRecusa(positionId, "decidir")}
        />
      )}
    </>
  );
}
