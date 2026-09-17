import { Fragment, useEffect, useState } from "react";
import type {
  StockCountCloseIssueDTO,
  StockCountDecision,
  StockCountDetailDTO,
  StockCountPositionDTO,
} from "@veridi/shared";
import {
  STOCK_COUNT_CLOSE_ISSUE_LABELS,
  STOCK_COUNT_DECISION_LABELS,
  STOCK_COUNT_POSITION_SITUATION_LABELS,
} from "@veridi/shared";
import { useMediaQuery } from "../../app/use-media-query";
import { TableEmptyRow } from "../../components/TableEmptyRow";
import { formatDate, formatDateTime } from "../../lib/dates";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantityWithUnit } from "../../lib/quantity";
import { MovimentosDaPosicao } from "./revisao-dialogos";
import {
  ajusteDaDiferenca,
  casaComBusca,
  diferencaComSinal,
  donoDaPosicao,
  pedeConfirmacaoDeMovimentacao,
  podeDecidir,
  podePedirRecontagem,
  registroQueVale,
  situacaoBadgeClass,
} from "./stock-count-display";

/**
 * A revisão do Inventário Físico — INVENTORY-PHYSICAL-COUNT-01, Fatia 2B.
 *
 * Mostra o que o servidor revelou depois da primeira contagem: confere,
 * divergente, recontagem pedida, decidida e com movimentação durante o
 * inventário. Quem opera escolhe posições PELO ID — caixa marcada a caixa
 * marcada, nunca "todas as divergências" deduzidas por filtro — e pede
 * recontagem, Ajustar ou Não ajustar. Encerrado ou cancelado, a mesma leitura
 * fica sem seleção.
 *
 * Abaixo de 640px cada posição é um cartão: a tabela de revisão tem números
 * demais para caber em 390px sem rolar de lado.
 */

type Recorte =
  | "todas"
  | "divergentes"
  | "com-movimentacao"
  | "recontagem"
  | "decididas"
  | "conferem"
  | "pendentes"
  | "retiradas"
  | "recusadas";

const LINHAS_POR_VEZ = 100;
const CELULAR = "(max-width: 639px)";

function noRecorte(posicao: StockCountPositionDTO, recorte: Recorte, recusadas: ReadonlySet<string>): boolean {
  switch (recorte) {
    case "todas":
      return true;
    case "divergentes":
      return posicao.situation === "DIVERGENT";
    case "com-movimentacao":
      return posicao.situation !== "REMOVED" && posicao.hasConcurrentMovement === true;
    case "recontagem":
      return posicao.situation === "RECOUNT_REQUESTED";
    case "decididas":
      return posicao.situation === "DECIDED";
    case "conferem":
      return posicao.situation === "MATCHES";
    case "pendentes":
      return posicao.situation === "PENDING";
    case "retiradas":
      return posicao.situation === "REMOVED";
    case "recusadas":
      return recusadas.has(posicao.id);
  }
}

function selecionavel(posicao: StockCountPositionDTO): boolean {
  return podeDecidir(posicao) || podePedirRecontagem(posicao);
}

function rodadaDoRegistro(rodada: number): string {
  return rodada === 1 ? "contagem" : `${formatIntegerPtBr(rodada)}ª contagem`;
}

/** A linha de situação: o que a posição é agora, a marca de movimentação e a última decisão ou recontagem. */
function situacaoDaPosicao(posicao: StockCountPositionDTO, recusas: StockCountCloseIssueDTO[]) {
  return (
    <span className="inv-celula-empilhada">
      <span>
        <span className={situacaoBadgeClass(posicao.situation)}>{STOCK_COUNT_POSITION_SITUATION_LABELS[posicao.situation]}</span>
        {posicao.situation !== "REMOVED" && posicao.hasConcurrentMovement && (
          <>
            {" "}
            <span className="badge badge--warn">Com movimentação</span>
          </>
        )}
      </span>
      {posicao.situation === "RECOUNT_REQUESTED" && (
        <small>
          Pedida por {posicao.recountRequestedByName ?? "—"} em {formatDateTime(posicao.recountRequestedAt)}
        </small>
      )}
      {posicao.decision && (
        <small>
          {STOCK_COUNT_DECISION_LABELS[posicao.decision]}
          {posicao.decision === "ADJUST" ? ` — ${ajusteDaDiferenca(posicao.finalDifference, posicao.unitCode)}` : ""}
          {posicao.decisionReason ? `: ${posicao.decisionReason}` : ""} · {posicao.decidedByName ?? "—"}
          {posicao.concurrentMovementConfirmed ? " · movimentação confirmada" : ""}
        </small>
      )}
      {posicao.situation === "DIVERGENT" && pedeConfirmacaoDeMovimentacao(posicao) && (
        <small>Decidir pede confirmar a movimentação — ou recontar.</small>
      )}
      {posicao.recountedByRequester && <small>Recontada por quem pediu a recontagem.</small>}
      {posicao.situation === "REMOVED" && (
        <small>
          Retirada por {posicao.removedByName ?? "—"}
          {posicao.removeReason ? `: ${posicao.removeReason}` : ""}
        </small>
      )}
      {recusas.map((recusa) => (
        <small key={recusa.issue} className="inv-texto-alerta">
          Recusada no encerramento: {STOCK_COUNT_CLOSE_ISSUE_LABELS[recusa.issue]}
        </small>
      ))}
    </span>
  );
}

/** O histórico da posição: cada registro de contagem, e os movimentos depois do início. */
function detalhesDaPosicao(inventarioId: string, posicao: StockCountPositionDTO) {
  return (
    <div className="inv-detalhes-da-posicao">
      <h4>Registros de contagem</h4>
      {posicao.entries.length === 0 ? (
        <p className="field__hint">Nenhum registro.</p>
      ) : (
        <ul className="inv-registros" aria-label={`Registros da posição ${formatIntegerPtBr(posicao.sequence)}`}>
          {posicao.entries.map((registro) => (
            <li key={registro.id}>
              <strong>{rodadaDoRegistro(registro.round)}</strong>: {formatQuantityWithUnit(registro.countedQuantity, posicao.unitCode)}{" "}
              · esperado {formatQuantityWithUnit(registro.expectedQuantity, posicao.unitCode)} · diferença{" "}
              {diferencaComSinal(registro.difference)} · {registro.countedByName} · {formatDateTime(registro.countedAt)}
              {registro.id === posicao.validEntryId ? " · vale" : ""}
              {registro.note ? ` · ${registro.note}` : ""}
            </li>
          ))}
        </ul>
      )}
      <h4>Movimentos depois do início do inventário</h4>
      <MovimentosDaPosicao inventarioId={inventarioId} posicao={posicao} />
    </div>
  );
}

export function RevisaoDoInventario({
  inventario,
  podeAgir,
  versao,
  recusa,
  aoPedirRecontagem,
  aoDecidir,
  aoLimparRecusa,
}: {
  inventario: StockCountDetailDTO;
  /** Quem opera, com o inventário em revisão. */
  podeAgir: boolean;
  /** Muda a cada ação gravada: a seleção recomeça sobre a revisão nova. */
  versao: number;
  recusa: StockCountCloseIssueDTO[] | null;
  aoPedirRecontagem: (posicoes: StockCountPositionDTO[]) => void;
  aoDecidir: (posicoes: StockCountPositionDTO[], decisao: StockCountDecision) => void;
  aoLimparRecusa: () => void;
}) {
  const celular = useMediaQuery(CELULAR);
  const [recorte, setRecorte] = useState<Recorte>("todas");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(LINHAS_POR_VEZ);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelecao(new Set());
  }, [versao]);

  useEffect(() => {
    if (recusa && recusa.length > 0) {
      setRecorte("recusadas");
      setLimite(LINHAS_POR_VEZ);
    } else {
      setRecorte((atual) => (atual === "recusadas" ? "todas" : atual));
    }
  }, [recusa]);

  const recusasPorPosicao = new Map<string, StockCountCloseIssueDTO[]>();
  for (const item of recusa ?? []) {
    recusasPorPosicao.set(item.positionId, [...(recusasPorPosicao.get(item.positionId) ?? []), item]);
  }
  const idsRecusados = new Set(recusasPorPosicao.keys());

  const contar = (alvo: Recorte) => inventario.positions.filter((posicao) => noRecorte(posicao, alvo, idsRecusados)).length;
  const opcoes: { chave: Recorte; rotulo: string; quantidade: number; sempre?: boolean }[] = [
    { chave: "todas", rotulo: "Todas", quantidade: inventario.positions.length, sempre: true },
    { chave: "divergentes", rotulo: "Divergentes", quantidade: contar("divergentes"), sempre: true },
    { chave: "com-movimentacao", rotulo: "Com movimentação", quantidade: contar("com-movimentacao"), sempre: true },
    { chave: "recontagem", rotulo: "Recontagem pedida", quantidade: contar("recontagem"), sempre: true },
    { chave: "decididas", rotulo: "Decididas", quantidade: contar("decididas"), sempre: true },
    { chave: "conferem", rotulo: "Conferem", quantidade: contar("conferem"), sempre: true },
    { chave: "pendentes", rotulo: "Sem contagem", quantidade: contar("pendentes") },
    { chave: "retiradas", rotulo: "Retiradas", quantidade: contar("retiradas") },
    { chave: "recusadas", rotulo: "Recusadas no encerramento", quantidade: idsRecusados.size },
  ];

  const visiveis = inventario.positions.filter(
    (posicao) => noRecorte(posicao, recorte, idsRecusados) && casaComBusca(posicao, busca),
  );
  const mostradas = visiveis.slice(0, limite);
  const selecionadas = inventario.positions.filter((posicao) => selecao.has(posicao.id));
  const decidiveis = selecionadas.length > 0 && selecionadas.every(podeDecidir);
  const recontaveis = selecionadas.length > 0 && selecionadas.every(podePedirRecontagem);
  const selecionaveisMostradas = mostradas.filter(selecionavel);
  const todasMostradasMarcadas =
    selecionaveisMostradas.length > 0 && selecionaveisMostradas.every((posicao) => selecao.has(posicao.id));

  function alternar(conjunto: Set<string>, id: string): Set<string> {
    const proximo = new Set(conjunto);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    return proximo;
  }

  function marcarMostradas() {
    setSelecao((atual) => {
      const proximo = new Set(atual);
      if (todasMostradasMarcadas) for (const posicao of selecionaveisMostradas) proximo.delete(posicao.id);
      else for (const posicao of selecionaveisMostradas) proximo.add(posicao.id);
      return proximo;
    });
  }

  const conferemNaSelecao = selecionadas.filter((posicao) => posicao.situation === "MATCHES").length;

  function caixaDaPosicao(posicao: StockCountPositionDTO) {
    if (!podeAgir) return null;
    const rotulo = `Selecionar a posição ${formatIntegerPtBr(posicao.sequence)}`;
    return selecionavel(posicao) ? (
      <input
        type="checkbox"
        className="inv-caixa"
        aria-label={rotulo}
        checked={selecao.has(posicao.id)}
        onChange={() => setSelecao((atual) => alternar(atual, posicao.id))}
      />
    ) : (
      <input type="checkbox" className="inv-caixa" aria-label={rotulo} disabled checked={false} onChange={() => undefined} />
    );
  }

  function botaoDeDetalhes(posicao: StockCountPositionDTO) {
    const aberta = abertas.has(posicao.id);
    return (
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-expanded={aberta}
        aria-label={`${aberta ? "Esconder" : "Ver"} histórico da posição ${formatIntegerPtBr(posicao.sequence)}`}
        onClick={() => setAbertas((atual) => alternar(atual, posicao.id))}
      >
        {aberta ? "Esconder" : "Histórico"}
      </button>
    );
  }

  const colunas = podeAgir ? 10 : 9;

  return (
    <div className="inv-revisao">
      {recusa && recusa.length > 0 && (
        <div className="callout" role="alert">
          <p>
            <strong>
              Encerramento recusado em {recusa.length === 1 ? "1 posição" : `${formatIntegerPtBr(idsRecusados.size)} posições`}
            </strong>{" "}
            — nada foi gravado. Resolva as posições do recorte "Recusadas no encerramento" e encerre de novo.
          </p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={aoLimparRecusa}>
            Dispensar aviso
          </button>
        </div>
      )}

      <div className="toolbar inv-barra-da-contagem">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="inv-revisao-busca">
            Buscar posição
          </label>
          <input
            id="inv-revisao-busca"
            type="search"
            placeholder="Item, código ou lote…"
            value={busca}
            onChange={(evento) => {
              setBusca(evento.target.value);
              setLimite(LINHAS_POR_VEZ);
            }}
          />
        </div>
        <div className="inv-chips" role="group" aria-label="Recorte da revisão">
          {opcoes
            .filter((opcao) => opcao.sempre || opcao.quantidade > 0 || opcao.chave === recorte)
            .map((opcao) => (
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
                {opcao.rotulo} · {formatIntegerPtBr(opcao.quantidade)}
              </button>
            ))}
        </div>
      </div>

      {podeAgir && (
        <div className="inv-barra-de-lote" role="region" aria-label="Ações nas posições selecionadas">
          <label className="inv-barra-de-lote__todas">
            <input
              type="checkbox"
              className="inv-caixa"
              checked={todasMostradasMarcadas}
              disabled={selecionaveisMostradas.length === 0}
              onChange={marcarMostradas}
            />
            <span>Selecionar as mostradas</span>
          </label>
          <span className="inv-barra-de-lote__contagem" aria-live="polite">
            {selecionadas.length === 0
              ? "Nenhuma posição selecionada"
              : selecionadas.length === 1
                ? "1 posição selecionada"
                : `${formatIntegerPtBr(selecionadas.length)} posições selecionadas`}
          </span>
          <div className="table__actions inv-barra-de-lote__acoes">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={!recontaveis}
              onClick={() => aoPedirRecontagem(selecionadas)}
            >
              Pedir recontagem
            </button>
            <button
              type="button"
              className="btn btn--accent btn--sm"
              disabled={!decidiveis}
              onClick={() => aoDecidir(selecionadas, "ADJUST")}
            >
              Ajustar
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={!decidiveis}
              onClick={() => aoDecidir(selecionadas, "NO_ADJUSTMENT")}
            >
              Não ajustar
            </button>
            {selecionadas.length > 0 && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelecao(new Set())}>
                Limpar seleção
              </button>
            )}
          </div>
          {conferemNaSelecao > 0 && (
            <span className="field__hint inv-barra-de-lote__dica">
              {conferemNaSelecao === 1 ? "1 posição selecionada confere" : `${formatIntegerPtBr(conferemNaSelecao)} posições selecionadas conferem`}
              : não há diferença a decidir — só recontagem.
            </span>
          )}
        </div>
      )}

      {celular ? (
        <ul className="inv-cartoes-da-revisao" aria-label="Posições da revisão">
          {mostradas.map((posicao) => {
            const valido = registroQueVale(posicao);
            return (
              <li key={posicao.id} className={selecao.has(posicao.id) ? "inv-cartao inv-cartao--selecionado" : "inv-cartao"}>
                <div className="inv-cartao__topo">
                  {caixaDaPosicao(posicao)}
                  <span className="inv-cartao__numero">Posição {formatIntegerPtBr(posicao.sequence)}</span>
                </div>
                <p className="inv-cartao__item">
                  {posicao.itemCode} · {posicao.itemName}
                </p>
                <p className="field__hint">
                  {[
                    posicao.lotCode ? `Lote ${posicao.lotCode}` : "Sem lote",
                    posicao.lotCode ? `val. ${formatDate(posicao.expiryDateAtReference)}` : null,
                    posicao.locationAtReference,
                    donoDaPosicao(posicao),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <dl className="inv-cartao__dados">
                  <dt>Saldo de referência</dt>
                  <dd>{formatQuantityWithUnit(posicao.referenceQuantity, posicao.unitCode)}</dd>
                  <dt>Esperado</dt>
                  <dd>{formatQuantityWithUnit(valido?.expectedQuantity, posicao.unitCode)}</dd>
                  <dt>Contagem</dt>
                  <dd>
                    {formatQuantityWithUnit(valido?.countedQuantity, posicao.unitCode)}
                    {valido && valido.round > 1 ? ` (${rodadaDoRegistro(valido.round)})` : ""}
                  </dd>
                  <dt>Diferença</dt>
                  <dd>
                    {posicao.finalDifference === null ? "—" : `${diferencaComSinal(posicao.finalDifference)} ${posicao.unitCode}`}
                  </dd>
                </dl>
                {situacaoDaPosicao(posicao, recusasPorPosicao.get(posicao.id) ?? [])}
                {botaoDeDetalhes(posicao)}
                {abertas.has(posicao.id) && detalhesDaPosicao(inventario.id, posicao)}
              </li>
            );
          })}
          {visiveis.length === 0 && <li className="callout">Nenhuma posição neste recorte.</li>}
        </ul>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                {podeAgir && <th className="col-tight" aria-label="Seleção" />}
                <th className="is-numeric col-tight">Nº</th>
                <th className="col-flex">Item</th>
                <th className="col-tight">Lote · validade · local</th>
                <th className="is-numeric col-tight">Saldo de referência</th>
                <th className="is-numeric col-tight">Esperado</th>
                <th className="is-numeric col-tight">Contagem</th>
                <th className="is-numeric col-tight">Diferença</th>
                <th className="col-flex">Situação</th>
                <th aria-label="Histórico" />
              </tr>
            </thead>
            <tbody>
              {mostradas.map((posicao) => {
                const valido = registroQueVale(posicao);
                return (
                  <Fragment key={posicao.id}>
                    <tr className={selecao.has(posicao.id) ? "is-selected" : undefined}>
                      {podeAgir && <td className="col-tight">{caixaDaPosicao(posicao)}</td>}
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
                              donoDaPosicao(posicao),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                      </td>
                      <td className="is-numeric col-tight">
                        {formatQuantityWithUnit(posicao.referenceQuantity, posicao.unitCode)}
                      </td>
                      <td className="is-numeric col-tight">
                        {formatQuantityWithUnit(valido?.expectedQuantity, posicao.unitCode)}
                      </td>
                      <td className="is-numeric col-tight">
                        <span className="inv-celula-empilhada">
                          <span>{formatQuantityWithUnit(valido?.countedQuantity, posicao.unitCode)}</span>
                          {valido && valido.round > 1 && <small>{rodadaDoRegistro(valido.round)}</small>}
                        </span>
                      </td>
                      <td className="is-numeric col-tight">{diferencaComSinal(posicao.finalDifference)}</td>
                      <td className="col-flex">{situacaoDaPosicao(posicao, recusasPorPosicao.get(posicao.id) ?? [])}</td>
                      <td>{botaoDeDetalhes(posicao)}</td>
                    </tr>
                    {abertas.has(posicao.id) && (
                      <tr className="inv-linha-de-detalhes">
                        <td colSpan={colunas}>{detalhesDaPosicao(inventario.id, posicao)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {visiveis.length === 0 && <TableEmptyRow colSpan={colunas}>Nenhuma posição neste recorte.</TableEmptyRow>}
            </tbody>
          </table>
        </div>
      )}

      {visiveis.length > limite && (
        <div className="line-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setLimite((atual) => atual + LINHAS_POR_VEZ)}
          >
            Mostrar mais {formatIntegerPtBr(Math.min(LINHAS_POR_VEZ, visiveis.length - limite))}
          </button>
        </div>
      )}
    </div>
  );
}
