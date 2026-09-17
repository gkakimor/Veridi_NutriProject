import { Fragment, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type {
  StockCountCloseIssueDTO,
  StockCountDecision,
  StockCountDetailDTO,
  StockCountPositionDTO,
  StockCountPositionMovementsDTO,
} from "@veridi/shared";
import {
  Decimal,
  INVENTORY_MOVEMENT_DIRECTION,
  INVENTORY_MOVEMENT_TYPE_LABELS,
  STOCK_COUNT_CLOSE_ISSUE_LABELS,
  STOCK_COUNT_DECISION_LABELS,
} from "@veridi/shared";
import { ModalDialog } from "../../components/ModalDialog";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatDateTime } from "../../lib/dates";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/quantity";
import {
  completeStockCount,
  decideStockCountPositions,
  getStockCount,
  getStockCountPositionMovements,
  isStockCountApiError,
  requestStockCountRecount,
} from "../../lib/stock-counts-api";
import { OrigemDoMovimento } from "./OrigemDoMovimento";
import type { ResumoDoEncerramento } from "./stock-count-display";
import {
  ajusteDaDiferenca,
  diferencaComSinal,
  pedeConfirmacaoDeMovimentacao,
  resumoDoEncerramento,
  rotaDaContagem,
} from "./stock-count-display";

/**
 * Diálogos da revisão do Inventário Físico — INVENTORY-PHYSICAL-COUNT-01, Fatia 2B.
 *
 * Pedir recontagem, decidir (Ajustar / Não ajustar) e encerrar. Cada um grava
 * uma coisa só, sobre as posições que a pessoa escolheu pelo id, e responde com
 * a revisão que o servidor devolveu. Nenhum decide por inferência: movimentação
 * durante o inventário pede confirmação marcada à mão, posição a posição.
 */

const MOTIVO_MINIMO = 3;

function rotuloDaPosicao(posicao: Pick<StockCountPositionDTO, "sequence" | "itemCode" | "itemName" | "lotCode">) {
  return `${formatIntegerPtBr(posicao.sequence)} · ${posicao.itemCode} · ${posicao.itemName}${posicao.lotCode ? ` · lote ${posicao.lotCode}` : ""}`;
}

/* ------------------------------------------------------------------ */

/**
 * Os movimentos do ledger da posição depois da referência, lidos sob demanda.
 * Lista, não tabela: cabe em 390px sem rolar de lado.
 */
export function MovimentosDaPosicao({
  inventarioId,
  posicao,
}: {
  inventarioId: string;
  posicao: Pick<StockCountPositionDTO, "id" | "unitCode">;
}) {
  const [dados, setDados] = useState<StockCountPositionMovementsDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro(null);
    getStockCountPositionMovements(inventarioId, posicao.id)
      .then((resposta) => {
        if (vivo) setDados(resposta);
      })
      .catch((falha: unknown) => {
        if (vivo) setErro(apiErrorMessage(falha, "Falha ao carregar os movimentos da posição"));
      });
    return () => {
      vivo = false;
    };
  }, [inventarioId, posicao.id]);

  if (erro) return <p className="form-alert form-alert--inline">{erro}</p>;
  if (!dados) return <p className="field__hint">Carregando movimentos…</p>;
  if (dados.balancesHidden) {
    return <p className="field__hint">Os movimentos aparecem quando a primeira contagem terminar.</p>;
  }
  if (dados.movements.length === 0) {
    return <p className="field__hint">Nenhum movimento lançado nesta posição depois do início do inventário.</p>;
  }
  return (
    <>
      <ul className="inv-movimentos" aria-label="Movimentos depois do início do inventário">
        {dados.movements.map((movimento) => (
          <li key={movimento.id} className={movimento.retroactive ? "inv-movimentos__item inv-movimentos__item--alerta" : "inv-movimentos__item"}>
            <span className="inv-movimentos__principal">
              <strong>
                {INVENTORY_MOVEMENT_DIRECTION[movimento.type] > 0 ? "+" : "−"}
                {formatQuantityWithUnit(movimento.quantity, posicao.unitCode)}
              </strong>{" "}
              {INVENTORY_MOVEMENT_TYPE_LABELS[movimento.type]} · <OrigemDoMovimento movimento={movimento} />
            </span>
            <span className="inv-movimentos__detalhe">
              Lançado em {formatDateTime(movimento.createdAt)} · ocorrência {formatDateTime(movimento.occurredAt)}
              {movimento.createdBy ? ` · ${movimento.createdBy}` : ""}
            </span>
            {(movimento.afterCount || movimento.retroactive) && (
              <span className="inv-movimentos__marcas">
                {movimento.retroactive ? (
                  <span className="badge badge--warn">Lançamento retroativo: ocorreu antes da contagem</span>
                ) : (
                  <span className="badge badge--neutral">Depois da contagem</span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {dados.total > dados.movements.length && (
        <p className="field__hint">
          Mostrando os primeiros {formatIntegerPtBr(dados.movements.length)} de {formatIntegerPtBr(dados.total)}.
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function AcoesDoDialogo({
  gravando,
  podeGravar,
  rotulo,
  rotuloGravando,
  aoFechar,
  formulario,
  aoConfirmar,
}: {
  gravando: boolean;
  podeGravar: boolean;
  rotulo: string;
  rotuloGravando: string;
  aoFechar: () => void;
  formulario?: string;
  aoConfirmar?: () => void;
}) {
  return (
    <div className="confirm-dialog__actions">
      <button type="button" className="btn btn--ghost" onClick={aoFechar} disabled={gravando}>
        Voltar
      </button>
      <button
        type={formulario ? "submit" : "button"}
        form={formulario}
        className="btn btn--accent"
        disabled={!podeGravar || gravando}
        onClick={formulario ? undefined : aoConfirmar}
      >
        {gravando ? rotuloGravando : rotulo}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function PedirRecontagemDialog({
  inventario,
  posicoes,
  aoFechar,
  aoPedir,
}: {
  inventario: Pick<StockCountDetailDTO, "id" | "code" | "mode">;
  posicoes: StockCountPositionDTO[];
  aoFechar: () => void;
  aoPedir: (detalhe: StockCountDetailDTO) => void;
}) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const decididas = posicoes.filter((posicao) => posicao.decision !== null).length;

  async function pedir() {
    setGravando(true);
    setErro(null);
    try {
      aoPedir(await requestStockCountRecount(inventario.id, { positionIds: posicoes.map((posicao) => posicao.id) }));
    } catch (falha) {
      setErro(apiErrorMessage(falha, "Falha ao pedir a recontagem"));
    } finally {
      setGravando(false);
    }
  }

  const quantas = posicoes.length === 1 ? "1 posição" : `${formatIntegerPtBr(posicoes.length)} posições`;
  return (
    <ModalDialog labelledBy="inv-recontar-titulo" onClose={aoFechar}>
      <div className="inv-dialogo-largo">
        <h2 id="inv-recontar-titulo">Pedir recontagem de {quantas}?</h2>
        <ul className="inv-lista-simples">
          <li>A contagem registrada continua no histórico; vale a da recontagem.</li>
          <li>
            A posição volta para <strong>Contar pendentes</strong>, e a recontagem congela o próprio saldo esperado.
          </li>
          {inventario.mode === "BLIND" && (
            <li>Contagem cega: quem reconta não vê a contagem anterior, o saldo nem a diferença.</li>
          )}
          {decididas > 0 && (
            <li>
              {decididas === 1 ? "A decisão já tomada numa delas é apagada" : `As decisões já tomadas em ${formatIntegerPtBr(decididas)} delas são apagadas`}
              : decide-se de novo sobre o número recontado.
            </li>
          )}
          <li>Nenhum ajuste de estoque é feito agora.</li>
        </ul>
        <ul className="inv-lista-de-posicoes" aria-label="Posições da recontagem">
          {posicoes.map((posicao) => (
            <li key={posicao.id}>{rotuloDaPosicao(posicao)}</li>
          ))}
        </ul>
        {erro && (
          <p className="form-alert" role="alert">
            {erro}
          </p>
        )}
        <AcoesDoDialogo
          gravando={gravando}
          podeGravar={posicoes.length > 0}
          rotulo="Pedir recontagem"
          rotuloGravando="Pedindo…"
          aoFechar={aoFechar}
          aoConfirmar={() => void pedir()}
        />
      </div>
    </ModalDialog>
  );
}

/* ------------------------------------------------------------------ */

export function DecidirPosicoesDialog({
  inventario,
  posicoes,
  decisaoInicial,
  aoFechar,
  aoDecidir,
}: {
  inventario: Pick<StockCountDetailDTO, "id" | "code">;
  posicoes: StockCountPositionDTO[];
  decisaoInicial: StockCountDecision;
  aoFechar: () => void;
  aoDecidir: (detalhe: StockCountDetailDTO) => void;
}) {
  const [decisao, setDecisao] = useState<StockCountDecision>(decisaoInicial);
  const [motivo, setMotivo] = useState("");
  const [confirmadas, setConfirmadas] = useState<Set<string>>(new Set());
  const [movimentosAbertos, setMovimentosAbertos] = useState<Set<string>>(new Set());
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const marcadas = posicoes.filter(pedeConfirmacaoDeMovimentacao);
  const faltaConfirmar = marcadas.filter((posicao) => !confirmadas.has(posicao.id));
  const podeGravar = posicoes.length > 0 && motivo.trim().length >= MOTIVO_MINIMO && faltaConfirmar.length === 0;

  function alternar(conjunto: Set<string>, id: string): Set<string> {
    const proximo = new Set(conjunto);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    return proximo;
  }

  async function gravar(evento: FormEvent) {
    evento.preventDefault();
    if (!podeGravar) return;
    setGravando(true);
    setErro(null);
    try {
      aoDecidir(
        await decideStockCountPositions(inventario.id, {
          decisions: posicoes.map((posicao) => ({
            positionId: posicao.id,
            decision: decisao,
            reason: motivo.trim(),
            // Só o que a pessoa marcou: nunca uma confirmação deduzida.
            ...(confirmadas.has(posicao.id) ? { confirmConcurrentMovement: true } : {}),
          })),
        }),
      );
    } catch (falha) {
      setErro(apiErrorMessage(falha, "Falha ao registrar a decisão"));
    } finally {
      setGravando(false);
    }
  }

  const quantas = posicoes.length === 1 ? "1 posição" : `${formatIntegerPtBr(posicoes.length)} posições`;
  const ajustar = decisao === "ADJUST";
  return (
    <ModalDialog labelledBy="inv-decidir-titulo" onClose={aoFechar}>
      <div className="inv-dialogo-largo">
        <h2 id="inv-decidir-titulo">Decidir {quantas}</h2>
        <form id="inv-decidir-form" onSubmit={(evento) => void gravar(evento)}>
          <fieldset className="field field--full">
            <legend>Decisão</legend>
            <div className="inv-escolha-da-decisao">
              {(["ADJUST", "NO_ADJUSTMENT"] as const).map((opcao) => (
                <label key={opcao} className={decisao === opcao ? "selection-row selection-row--selected" : "selection-row"}>
                  <span className="selection-row__label selection-row__label--full">
                    <input
                      type="radio"
                      name="inv-decidir-decisao"
                      value={opcao}
                      checked={decisao === opcao}
                      onChange={() => setDecisao(opcao)}
                    />
                    {STOCK_COUNT_DECISION_LABELS[opcao]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p>
            {ajustar
              ? "No encerramento, cada diferença abaixo vira um ajuste de estoque com este motivo — com a data do encerramento."
              : "Nenhum ajuste de estoque é gerado: a diferença fica registrada no inventário, com este motivo."}{" "}
            A decisão vale para o número registrado agora; contagem nova a apaga.
          </p>
          <ul className="inv-lista-de-decisao" aria-label="Posições da decisão">
            {posicoes.map((posicao) => {
              const pedeConfirmacao = marcadas.includes(posicao);
              return (
                <li key={posicao.id} className={pedeConfirmacao ? "inv-decisao inv-decisao--marcada" : "inv-decisao"}>
                  <span className="inv-decisao__posicao">{rotuloDaPosicao(posicao)}</span>
                  <span className="inv-decisao__numeros">
                    Diferença {diferencaComSinal(posicao.finalDifference)} {posicao.unitCode}
                    {ajustar ? ` · ${ajusteDaDiferenca(posicao.finalDifference, posicao.unitCode)}` : " · sem ajuste"}
                  </span>
                  {posicao.hasConcurrentMovement && (
                    <div className="inv-decisao__movimentacao">
                      <p>
                        <strong>Movimentação durante o inventário.</strong>{" "}
                        {pedeConfirmacao
                          ? "Houve lançamento nesta posição depois do início. Confira os movimentos: se algum aconteceu fisicamente antes da contagem, peça recontagem em vez de decidir."
                          : "A posição foi recontada: a recontagem já congelou o próprio saldo esperado."}
                      </p>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        aria-expanded={movimentosAbertos.has(posicao.id)}
                        onClick={() => setMovimentosAbertos((atual) => alternar(atual, posicao.id))}
                      >
                        {movimentosAbertos.has(posicao.id) ? "Esconder movimentos" : "Ver movimentos"}
                      </button>
                      {movimentosAbertos.has(posicao.id) && (
                        <MovimentosDaPosicao inventarioId={inventario.id} posicao={posicao} />
                      )}
                      {pedeConfirmacao && (
                        <label className="confirm-dialog__choice">
                          <input
                            type="checkbox"
                            checked={confirmadas.has(posicao.id)}
                            onChange={() => setConfirmadas((atual) => alternar(atual, posicao.id))}
                          />
                          <span>
                            Confirmo que os movimentos da posição {formatIntegerPtBr(posicao.sequence)} não invalidam a
                            contagem registrada.
                          </span>
                        </label>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="field field--full">
            <label htmlFor="inv-decidir-motivo">
              Motivo <span className="req">*</span>
            </label>
            <textarea
              id="inv-decidir-motivo"
              rows={3}
              maxLength={500}
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
            />
            <span className="field__hint">
              Mínimo de {MOTIVO_MINIMO} caracteres. {posicoes.length > 1 ? "O mesmo motivo vale para todas as posições." : ""}
            </span>
          </div>
        </form>
        {faltaConfirmar.length > 0 && (
          <p className="field__hint" role="status">
            {faltaConfirmar.length === 1
              ? "Falta confirmar a movimentação de 1 posição — ou volte e peça recontagem dela."
              : `Falta confirmar a movimentação de ${formatIntegerPtBr(faltaConfirmar.length)} posições — ou volte e peça recontagem delas.`}
          </p>
        )}
        {erro && (
          <p className="form-alert" role="alert">
            {erro}
          </p>
        )}
        <AcoesDoDialogo
          formulario="inv-decidir-form"
          gravando={gravando}
          podeGravar={podeGravar}
          rotulo={`${STOCK_COUNT_DECISION_LABELS[decisao]} ${quantas}`}
          rotuloGravando="Registrando…"
          aoFechar={aoFechar}
        />
      </div>
    </ModalDialog>
  );
}

/* ------------------------------------------------------------------ */

type AcaoDaRecusa = "recontar" | "decidir" | "contar";

/** O que resolve cada recusa: recontar, redecidir ou ir contar. */
function acoesDaRecusa(issue: StockCountCloseIssueDTO["issue"]): AcaoDaRecusa[] {
  switch (issue) {
    case "PENDING_COUNT":
    case "PENDING_RECOUNT":
      return ["contar"];
    case "UNDECIDED":
      return ["decidir", "recontar"];
    case "CONCURRENT_MOVEMENT_UNCONFIRMED":
    case "NEGATIVE_BALANCE":
    case "BELOW_RESERVED":
      return ["recontar", "decidir"];
    case "UNIT_CHANGED":
      return ["decidir"];
  }
}

const DICA_DA_RECUSA: Partial<Record<StockCountCloseIssueDTO["issue"], string>> = {
  BELOW_RESERVED: "Reconte, revise as reservas do lote ou decida Não ajustar.",
  NEGATIVE_BALANCE: "O saldo mudou depois da contagem: reconte ou decida Não ajustar.",
  UNIT_CHANGED: "Um ajuste na unidade antiga não entra no estoque: decida Não ajustar.",
  CONCURRENT_MOVEMENT_UNCONFIRMED: "Reconte, ou decida de novo confirmando a movimentação.",
};

/** As recusas do encerramento por posição — o que o servidor devolveu, sem conta nova aqui. */
export function RecusasDoEncerramento({
  inventario,
  issues,
  aoRecontar,
  aoDecidir,
}: {
  inventario: Pick<StockCountDetailDTO, "id" | "positions">;
  issues: StockCountCloseIssueDTO[];
  aoRecontar: (positionId: string) => void;
  aoDecidir: (positionId: string) => void;
}) {
  const porId = new Map(inventario.positions.map((posicao) => [posicao.id, posicao]));
  return (
    <ul className="inv-recusas" aria-label="Posições que impediram o encerramento">
      {issues.map((recusa, indice) => {
        const posicao = porId.get(recusa.positionId);
        const unidade = posicao?.unitCode ?? null;
        return (
          <li key={`${recusa.positionId}-${recusa.issue}-${indice}`} className="inv-recusa">
            <span className="inv-recusa__posicao">
              <strong>Posição {formatIntegerPtBr(recusa.sequence)}</strong> · {recusa.itemCode}
              {posicao ? ` · ${posicao.itemName}` : ""}
              {recusa.lotCode ? ` · lote ${recusa.lotCode}` : ""}
            </span>
            <span className="inv-recusa__motivo">{STOCK_COUNT_CLOSE_ISSUE_LABELS[recusa.issue]}</span>
            <dl className="inv-recusa__numeros">
              <dt>Saldo agora</dt>
              <dd>{formatQuantityWithUnit(recusa.balance, unidade)}</dd>
              <dt>Ajuste</dt>
              <dd>{recusa.adjustment === null ? "—" : `${diferencaComSinal(recusa.adjustment)}${unidade ? ` ${unidade}` : ""}`}</dd>
              <dt>Reservado</dt>
              <dd>{formatQuantityWithUnit(recusa.reserved, unidade)}</dd>
            </dl>
            {DICA_DA_RECUSA[recusa.issue] && <span className="field__hint">{DICA_DA_RECUSA[recusa.issue]}</span>}
            <div className="table__actions inv-recusa__acoes">
              {acoesDaRecusa(recusa.issue).map((acao) => (
                <Fragment key={acao}>
                  {acao === "contar" && (
                    <Link className="btn btn--secondary btn--sm" to={rotaDaContagem(inventario.id)}>
                      Contar
                    </Link>
                  )}
                  {acao === "recontar" && (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      aria-label={`Recontar a posição ${formatIntegerPtBr(recusa.sequence)}`}
                      onClick={() => aoRecontar(recusa.positionId)}
                    >
                      Recontar
                    </button>
                  )}
                  {acao === "decidir" && (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      aria-label={`Redecidir a posição ${formatIntegerPtBr(recusa.sequence)}`}
                      onClick={() => aoDecidir(recusa.positionId)}
                    >
                      Redecidir
                    </button>
                  )}
                </Fragment>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ResumoDaConsequencia({ resumo }: { resumo: ResumoDoEncerramento }) {
  const pendencias = resumo.semContagem + resumo.recontagemPedida + resumo.semDecisao + resumo.semConfirmacao;
  return (
    <>
      <ul className="inv-lista-simples inv-consequencia">
        <li>
          {resumo.ajustes === 0 ? (
            <strong>Nenhum ajuste de estoque será gerado.</strong>
          ) : (
            <>
              <strong>
                {resumo.ajustes === 1 ? "Será gerado 1 ajuste de estoque" : `Serão gerados ${formatIntegerPtBr(resumo.ajustes)} ajustes de estoque`}
              </strong>
              : {formatIntegerPtBr(resumo.entradas)} {resumo.entradas === 1 ? "entrada" : "entradas"} ·{" "}
              {formatIntegerPtBr(resumo.saidas)} {resumo.saidas === 1 ? "saída" : "saídas"} · {formatIntegerPtBr(resumo.itens)}{" "}
              {resumo.itens === 1 ? "item" : "itens"}
              {resumo.lotes > 0 ? ` · ${formatIntegerPtBr(resumo.lotes)} ${resumo.lotes === 1 ? "lote" : "lotes"}` : ""}.
            </>
          )}
        </li>
        {resumo.porUnidade.length > 0 && (
          <li>
            Por unidade:
            <ul className="inv-consequencia__unidades" aria-label="Ajustes por unidade">
              {resumo.porUnidade.map((total) => (
                <li key={total.unitCode}>
                  <strong>{total.unitCode}</strong>:{" "}
                  {[
                    new Decimal(total.entradas).isZero() ? null : `entradas +${formatQuantity(total.entradas)}`,
                    new Decimal(total.saidas).isZero() ? null : `saídas −${formatQuantity(total.saidas)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </li>
              ))}
            </ul>
          </li>
        )}
        <li>
          {formatIntegerPtBr(resumo.naoAjustar)} {resumo.naoAjustar === 1 ? "posição decidida" : "posições decididas"} Não ajustar ·{" "}
          {formatIntegerPtBr(resumo.conferem)} {resumo.conferem === 1 ? "confere" : "conferem"} ·{" "}
          {formatIntegerPtBr(resumo.ocorrencias)} {resumo.ocorrencias === 1 ? "ocorrência" : "ocorrências"} (não geram ajuste)
        </li>
        <li>Os ajustes entram com a data e a hora do encerramento. O inventário encerrado não reabre.</li>
      </ul>
      {pendencias > 0 && (
        <div className="callout" role="note">
          <p>
            <strong>Pelo que esta tela leu, o encerramento vai ser recusado:</strong>{" "}
            {[
              resumo.semContagem > 0 ? `${formatIntegerPtBr(resumo.semContagem)} sem contagem` : null,
              resumo.recontagemPedida > 0 ? `${formatIntegerPtBr(resumo.recontagemPedida)} com recontagem pedida` : null,
              resumo.semDecisao > 0 ? `${formatIntegerPtBr(resumo.semDecisao)} divergentes sem decisão` : null,
              resumo.semConfirmacao > 0 ? `${formatIntegerPtBr(resumo.semConfirmacao)} com movimentação sem confirmação` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            . O sistema confere de novo e lista cada posição.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Encerrar: a consequência real, lida da revisão fresca, e a tentativa. Não há
 * pré-checagem no servidor — o encerramento confere tudo e, recusado, devolve
 * as posições; nada fica gravado pela metade.
 */
export function EncerrarInventarioDialog({
  inventarioId,
  codigo,
  aoFechar,
  aoEncerrar,
  aoRecusar,
  aoAtualizar,
  aoRecontar,
  aoDecidir,
}: {
  inventarioId: string;
  codigo: string;
  /** Voltar — e, depois de uma recusa, "Voltar à revisão". */
  aoFechar: () => void;
  aoEncerrar: (detalhe: StockCountDetailDTO) => void;
  /** O servidor recusou: a página guarda as posições para o recorte da revisão. */
  aoRecusar: (issues: StockCountCloseIssueDTO[]) => void;
  /** A revisão lida depois da recusa — o estado real em que as ações vão agir. */
  aoAtualizar: (detalhe: StockCountDetailDTO) => void;
  aoRecontar: (positionId: string) => void;
  aoDecidir: (positionId: string) => void;
}) {
  const [atual, setAtual] = useState<StockCountDetailDTO | null>(null);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mudou, setMudou] = useState(false);
  const [recusa, setRecusa] = useState<StockCountCloseIssueDTO[] | null>(null);

  useEffect(() => {
    let vivo = true;
    setAtual(null);
    setErroDeCarga(null);
    getStockCount(inventarioId, "review")
      .then((detalhe) => {
        if (vivo) setAtual(detalhe);
      })
      .catch((falha: unknown) => {
        if (vivo) setErroDeCarga(apiErrorMessage(falha, "Falha ao ler o inventário"));
      });
    return () => {
      vivo = false;
    };
  }, [inventarioId, recarga]);

  const resumo = atual ? resumoDoEncerramento(atual) : null;

  async function encerrar() {
    if (!atual || !resumo) return;
    setGravando(true);
    setErro(null);
    setMudou(false);
    try {
      aoEncerrar(await completeStockCount(inventarioId, { expectedAdjustments: resumo.ajustesEsperados }));
    } catch (falha) {
      if (isStockCountApiError(falha, "stock_count_close_blocked")) {
        const issues = falha.body.issues ?? [];
        setRecusa(issues);
        aoRecusar(issues);
        // A revisão de agora, para as ações da recusa agirem sobre o estado real.
        getStockCount(inventarioId, "review")
          .then((detalhe) => {
            setAtual(detalhe);
            aoAtualizar(detalhe);
          })
          .catch(() => undefined);
      } else if (isStockCountApiError(falha, "stock_count_changed")) {
        setMudou(true);
        setErro(falha.message);
      } else {
        setErro(apiErrorMessage(falha, "Falha ao encerrar o inventário"));
      }
    } finally {
      setGravando(false);
    }
  }

  if (recusa && atual) {
    return (
      <ModalDialog labelledBy="inv-encerrar-titulo" onClose={aoFechar}>
        <div className="inv-dialogo-largo">
          <h2 id="inv-encerrar-titulo">Encerramento do {codigo} recusado</h2>
          <p className="form-alert" role="alert">
            <strong>Nada foi gravado:</strong> nenhum ajuste, nenhuma decisão mudou, e o inventário continua em revisão.{" "}
            {recusa.length === 1 ? "1 posição impediu o encerramento." : `${formatIntegerPtBr(recusa.length)} posições impediram o encerramento.`}
          </p>
          <RecusasDoEncerramento inventario={atual} issues={recusa} aoRecontar={aoRecontar} aoDecidir={aoDecidir} />
          <div className="confirm-dialog__actions">
            <button type="button" className="btn btn--accent" onClick={aoFechar}>
              Voltar à revisão
            </button>
          </div>
        </div>
      </ModalDialog>
    );
  }

  return (
    <ModalDialog labelledBy="inv-encerrar-titulo" onClose={aoFechar}>
      <div className="inv-dialogo-largo">
        <h2 id="inv-encerrar-titulo">Encerrar o {codigo}?</h2>
        {erroDeCarga && (
          <p className="form-alert" role="alert">
            {erroDeCarga}{" "}
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setRecarga((n) => n + 1)}>
              Tentar novamente
            </button>
          </p>
        )}
        {!erroDeCarga && !resumo && <p className="field__hint">Lendo a revisão…</p>}
        {resumo && <ResumoDaConsequencia resumo={resumo} />}
        {erro && (
          <p className="form-alert" role="alert">
            {erro}{" "}
            {mudou && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  setErro(null);
                  setMudou(false);
                  setRecarga((n) => n + 1);
                }}
              >
                Atualizar o resumo
              </button>
            )}
          </p>
        )}
        <AcoesDoDialogo
          gravando={gravando}
          podeGravar={resumo !== null && !mudou}
          rotulo="Confirmar encerramento"
          rotuloGravando="Encerrando…"
          aoFechar={aoFechar}
          aoConfirmar={() => void encerrar()}
        />
      </div>
    </ModalDialog>
  );
}
