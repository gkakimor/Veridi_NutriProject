import type { ChangeEvent, CSSProperties, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  DocumentoCitadoDTO,
  EntregaDoCompromissoDTO,
  GranularidadeDaTendencia,
  IndicadorDeContagemDTO,
  IndicadorMonetarioDTO,
  IntervaloDeDias,
  ManagementDashboardDTO,
  ManagementPeriodPreset,
  ValorDoRecorteDTO,
} from "@veridi/shared";
import {
  Decimal,
  MANAGEMENT_DASHBOARD_ROLES,
  MANAGEMENT_PERIOD_PRESETS,
  MANAGEMENT_PERIOD_PRESET_LABELS,
  ehDiaCivil,
  ehPeriodoGerencial,
  recusaDoPeriodoGerencial,
  resolverPeriodoGerencial,
  valorComparavel,
} from "@veridi/shared";
import { useAuth } from "../../app/AuthProvider";
import { PAUSA_DO_PERIODO_MS } from "../../components/filters/DateRangeFilter";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { formatBRL } from "../../lib/currency";
import { formatDate } from "../../lib/dates";
import { useListQuery } from "../../lib/list-query";
import type { ManagementDashboardParams } from "../../lib/management-dashboard-api";
import { getManagementDashboard } from "../../lib/management-dashboard-api";
import {
  LINK_A_FATURAR,
  LINK_DA_CARTEIRA,
  linkDaVisaoDoClienteFaturamentos,
  linkDaVisaoDoClienteProduto,
  linkDasComprasContratadas,
  linkDosFaturamentos,
} from "../../lib/management-dashboard-links";
import { formatIntegerPtBr, formatPercentPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity } from "../../lib/quantity";
import "./management-dashboard.css";

/* ------------------------------------------------------------------ *
 * Texto
 * ------------------------------------------------------------------ */

interface Substantivo {
  um: string;
  varios: string;
  /** Concorda com o substantivo: "todos os documentos", "todas as OCs". */
  todos: "todos" | "todas";
}

const DOCUMENTOS: Substantivo = { um: "documento", varios: "documentos", todos: "todos" };
const PEDIDOS: Substantivo = { um: "pedido", varios: "pedidos", todos: "todos" };
const OCS: Substantivo = { um: "OC", varios: "OCs", todos: "todas" };
const EXPEDICOES: Substantivo = { um: "expedição", varios: "expedições", todos: "todas" };
const ENTREGAS: Substantivo = { um: "entrega", varios: "entregas", todos: "todas" };

function contagem(quantidade: number, nome: Substantivo): string {
  return `${formatIntegerPtBr(quantidade)} ${quantidade === 1 ? nome.um : nome.varios}`;
}

/** "01/09/2026 a 15/09/2026" — dia civil, lido como o dia gravado. */
function intervaloPorExtenso({ from, to }: IntervaloDeDias): string {
  return from === to ? formatDate(from) : `${formatDate(from)} a ${formatDate(to)}`;
}

/** Quantos têm valor — nunca "0 de 0": sem documento a tela diz outra coisa. */
function notaDoRecorte(recorte: ValorDoRecorteDTO, nome: Substantivo, criterio: string): string {
  if (recorte.amount === null) {
    return `${formatIntegerPtBr(recorte.withValue)} de ${contagem(recorte.count, nome)} ${criterio}.`;
  }
  return recorte.count === 1
    ? `1 ${nome.um}, ${criterio}.`
    : `${contagem(recorte.count, nome)}, ${nome.todos} ${criterio}.`;
}

/** "+8,2%", "−75,0%", "0,0%" — ou a frase de quando não há o que comparar. */
function variacaoPorExtenso(variacao: string | null): string {
  if (variacao === null) return "Sem base de comparação";
  const negativa = variacao.startsWith("-");
  const corpo = formatPercentPtBr(negativa ? variacao.slice(1) : variacao, { scale: 1, minFractionDigits: 1 });
  if (variacao === "0.0") return corpo;
  return `${negativa ? "−" : "+"}${corpo}`;
}

function anteriorPorExtenso(recorte: ValorDoRecorteDTO): string {
  if (recorte.count === 0) return "sem registros";
  return recorte.amount === null ? "valores incompletos" : formatBRL(recorte.amount);
}

/* ------------------------------------------------------------------ *
 * Cartões
 * ------------------------------------------------------------------ */

/**
 * O valor de um recorte, nas três leituras que não se confundem (D2): sem
 * documento é "—" e a frase do vazio; documento sem valor é "Valores
 * incompletos" e "N de M", sem subtotal; todos com valor é o total.
 */
function ValorDoRecorte({
  recorte,
  nome,
  criterio,
  vazio,
}: {
  recorte: ValorDoRecorteDTO;
  nome: Substantivo;
  criterio: string;
  vazio: string;
}) {
  if (recorte.count === 0) {
    return (
      <>
        <p className="mgmt-card__value">—</p>
        <p className="mgmt-card__note">{vazio}</p>
      </>
    );
  }
  return (
    <>
      {recorte.amount === null ? (
        <p className="mgmt-card__value mgmt-card__value--incomplete">Valores incompletos</p>
      ) : (
        <p className="mgmt-card__value">{formatBRL(recorte.amount)}</p>
      )}
      <p className="mgmt-card__note">{notaDoRecorte(recorte, nome, criterio)}</p>
    </>
  );
}

/** Os documentos que deixam o valor incompleto — cada um abre, para ser completado. */
function DocumentosSemValor({
  rotulo,
  documentos,
  total,
  abrir,
}: {
  rotulo: string;
  documentos: DocumentoCitadoDTO[];
  total: number;
  abrir: (id: string) => string;
}) {
  if (total <= 0) return null;
  return (
    <details className="mgmt-missing">
      <summary>
        {rotulo} ({formatIntegerPtBr(total)})
      </summary>
      <ul>
        {documentos.map((documento) => (
          <li key={documento.id}>
            <Link to={abrir(documento.id)}>{documento.code}</Link>
          </li>
        ))}
      </ul>
      {total > documentos.length && (
        <p className="mgmt-missing__more">e mais {formatIntegerPtBr(total - documentos.length)}.</p>
      )}
    </details>
  );
}

interface Destino {
  to: string;
  rotulo: string;
}

function CartaoMonetario({
  titulo,
  indicador,
  nome,
  criterio,
  vazio,
  rotuloSemValor,
  abrirDocumento,
  destino,
}: {
  titulo: string;
  indicador: IndicadorMonetarioDTO;
  nome: Substantivo;
  criterio: string;
  vazio: string;
  rotuloSemValor: string;
  abrirDocumento: (id: string) => string;
  /** Só quando a tela de destino filtra exatamente o que o cartão conta. */
  destino?: Destino;
}) {
  const { current, previous, variationPercent, withoutValue } = indicador;
  return (
    <article className="mgmt-card" aria-label={titulo}>
      <h3 className="mgmt-card__label">{titulo}</h3>
      <ValorDoRecorte recorte={current} nome={nome} criterio={criterio} vazio={vazio} />
      <p className="mgmt-card__compare">
        Anterior: {anteriorPorExtenso(previous)} · {variacaoPorExtenso(variationPercent)}
      </p>
      <DocumentosSemValor
        rotulo={rotuloSemValor}
        documentos={withoutValue}
        total={current.count - current.withValue}
        abrir={abrirDocumento}
      />
      {destino && current.count > 0 && (
        <Link className="mgmt-card__link" to={destino.to}>
          {destino.rotulo}
        </Link>
      )}
    </article>
  );
}

function CartaoDeClientes({ indicador }: { indicador: IndicadorDeContagemDTO }) {
  return (
    <article className="mgmt-card" aria-label="Clientes faturados">
      <h3 className="mgmt-card__label">Clientes faturados</h3>
      <p className="mgmt-card__value">{formatIntegerPtBr(indicador.current)}</p>
      <p className="mgmt-card__note">
        {indicador.current === 0
          ? "Nenhum cliente com faturamento emitido no período."
          : indicador.current === 1
            ? "Cliente distinto com faturamento emitido."
            : "Clientes distintos com faturamento emitido."}
      </p>
      <p className="mgmt-card__compare">
        Anterior: {formatIntegerPtBr(indicador.previous)} · {variacaoPorExtenso(indicador.variationPercent)}
      </p>
    </article>
  );
}

function CartaoDaPosicao({
  titulo,
  posicao,
  nome,
  vazio,
  rotuloSemValor,
  abrirDocumento,
  destino,
}: {
  titulo: string;
  posicao: ManagementDashboardDTO["position"]["toShip"];
  nome: Substantivo;
  vazio: string;
  rotuloSemValor: string;
  abrirDocumento: (id: string) => string;
  destino: Destino;
}) {
  return (
    <article className="mgmt-card" aria-label={titulo}>
      <h3 className="mgmt-card__label">{titulo}</h3>
      <ValorDoRecorte recorte={posicao} nome={nome} criterio="com preço acordado" vazio={vazio} />
      <DocumentosSemValor
        rotulo={rotuloSemValor}
        documentos={posicao.withoutValue}
        total={posicao.count - posicao.withValue}
        abrir={abrirDocumento}
      />
      {posicao.count > 0 && (
        <Link className="mgmt-card__link" to={destino.to}>
          {destino.rotulo}
        </Link>
      )}
    </article>
  );
}

/**
 * A proporção entre A expedir e A faturar — só com os dois valores completos.
 * Sobre valor incompleto, qualquer proporção desenhada seria falsa.
 */
function ComposicaoDaCarteira({ aExpedir, aFaturar }: { aExpedir: ValorDoRecorteDTO; aFaturar: ValorDoRecorteDTO }) {
  const expedir = valorComparavel(aExpedir);
  const faturar = valorComparavel(aFaturar);
  if (expedir === null || faturar === null) {
    return (
      <p className="mgmt-note">
        Sem composição da carteira: há valores incompletos, e uma proporção sobre eles enganaria.
      </p>
    );
  }
  const soma = new Decimal(expedir).plus(faturar);
  if (!soma.greaterThan(0)) return null;

  const parteExpedir = new Decimal(expedir).dividedBy(soma).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  const parteFaturar = new Decimal(100).minus(parteExpedir);
  const textoExpedir = formatPercentPtBr(parteExpedir.toFixed(1), { scale: 1, minFractionDigits: 1 });
  const textoFaturar = formatPercentPtBr(parteFaturar.toFixed(1), { scale: 1, minFractionDigits: 1 });

  return (
    <figure className="mgmt-composition">
      <figcaption className="mgmt-section__hint">Composição da carteira, pelo valor acordado</figcaption>
      <div
        className="mgmt-composition__bar"
        role="img"
        aria-label={`Composição da carteira: A expedir ${textoExpedir}, A faturar ${textoFaturar}`}
      >
        <span
          className="mgmt-composition__segment mgmt-composition__segment--ship"
          style={{ flexGrow: parteExpedir.toNumber() }}
        />
        <span
          className="mgmt-composition__segment mgmt-composition__segment--bill"
          style={{ flexGrow: parteFaturar.toNumber() }}
        />
      </div>
      <p className="mgmt-composition__legend">
        <span>
          <i className="mgmt-composition__swatch mgmt-composition__swatch--ship" aria-hidden="true" />
          A expedir {textoExpedir}
        </span>
        <span>
          <i className="mgmt-composition__swatch mgmt-composition__swatch--bill" aria-hidden="true" />
          A faturar {textoFaturar}
        </span>
      </p>
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Tendência
 * ------------------------------------------------------------------ */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const TITULO_DA_TENDENCIA: Record<GranularidadeDaTendencia, string> = {
  day: "Faturado por dia",
  week: "Faturado por semana",
  month: "Faturado por mês",
};

function rotuloDoBalde(balde: IntervaloDeDias, granularidade: GranularidadeDaTendencia): string {
  const [ano = "", mes = "", dia = ""] = balde.from.split("-");
  if (granularidade === "month") return `${MESES[Number(mes) - 1] ?? mes}/${ano.slice(2)}`;
  return `${dia}/${mes}`;
}

/**
 * Faturado por intervalo, em barras de CSS — sem biblioteca de gráfico. A
 * altura é relativa à maior barra COMPLETA; intervalo com faturamento sem valor
 * aparece como "Incompleto", sem altura nenhuma. Cada barra com faturamento
 * abre os faturamentos emitidos daquele intervalo.
 */
function TendenciaDoFaturado({ tendencia }: { tendencia: ManagementDashboardDTO["trend"] }) {
  const { buckets, granularity } = tendencia;
  // Período sem faturamento não vira um quadro de barras zeradas: a frase diz que não houve.
  if (buckets.every((balde) => balde.count === 0)) {
    return <p className="mgmt-empty">Sem faturamentos no período.</p>;
  }
  const maior = buckets.reduce(
    (atual, balde) =>
      balde.amount !== null && new Decimal(balde.amount).greaterThan(atual) ? new Decimal(balde.amount) : atual,
    new Decimal(0),
  );
  const passoDoRotulo = Math.max(1, Math.ceil(buckets.length / 12));
  const temIncompleto = buckets.some((balde) => balde.count > 0 && balde.amount === null);

  return (
    <>
      <ol className="mgmt-trend" aria-label={TITULO_DA_TENDENCIA[granularity]}>
        {buckets.map((balde, indice) => {
          const incompleto = balde.count > 0 && balde.amount === null;
          const leitura =
            balde.count === 0 ? "sem faturamento" : balde.amount === null ? "valores incompletos" : formatBRL(balde.amount);
          const altura =
            balde.amount !== null && maior.greaterThan(0)
              ? new Decimal(balde.amount).dividedBy(maior).times(100).toDecimalPlaces(1).toNumber()
              : 0;
          const corpo = (
            <>
              <span className="sr-only">{`${intervaloPorExtenso(balde)}: ${leitura}`}</span>
              <span className="mgmt-trend__track" aria-hidden="true">
                {incompleto ? (
                  <span className="mgmt-trend__incomplete">Incompleto</span>
                ) : (
                  <span className="mgmt-trend__bar" style={{ "--altura": altura } as CSSProperties} />
                )}
              </span>
              <span className="mgmt-trend__label" aria-hidden="true">
                {indice % passoDoRotulo === 0 ? rotuloDoBalde(balde, granularity) : ""}
              </span>
            </>
          );
          return (
            <li key={balde.from} className="mgmt-trend__item">
              {balde.count > 0 ? (
                <Link className="mgmt-trend__target" to={linkDosFaturamentos(balde)} title={leitura}>
                  {corpo}
                </Link>
              ) : (
                <span className="mgmt-trend__target">{corpo}</span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mgmt-note">
        Cada barra com faturamento abre os faturamentos emitidos no intervalo.
        {temIncompleto ? " “Incompleto”: há faturamento sem valor no intervalo, e a barra fica sem altura." : ""}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Rankings
 * ------------------------------------------------------------------ */

function nomeDoCliente({ code, name }: { code: string | null; name: string | null }): string {
  return [code, name].filter(Boolean).join(" ") || "Cliente sem identificação";
}

function RankingDeClientes({
  ranking,
  periodo,
}: {
  ranking: ManagementDashboardDTO["rankings"]["customers"];
  periodo: IntervaloDeDias;
}) {
  return (
    <section className="mgmt-ranking" aria-labelledby="mgmt-ranking-clientes">
      <h2 id="mgmt-ranking-clientes">Clientes — Faturado no período</h2>
      {ranking.rows.length === 0 ? (
        <p className="mgmt-empty">
          {ranking.excludedTotal > 0
            ? "Nenhum cliente com todos os faturamentos com valor no período."
            : "Nenhum cliente faturado no período."}
        </p>
      ) : (
        <ol className="mgmt-ranking__list">
          {ranking.rows.map((linha, indice) => (
            <li key={linha.customerId} className="mgmt-ranking__row">
              <span className="mgmt-ranking__pos">{formatIntegerPtBr(indice + 1)}</span>
              <Link className="mgmt-ranking__name" to={linkDaVisaoDoClienteFaturamentos(linha.customerId)}>
                {nomeDoCliente(linha)}
              </Link>
              <span className="mgmt-ranking__value">{formatBRL(linha.amount)}</span>
              <Link className="mgmt-ranking__detail" to={linkDosFaturamentos(periodo, linha.customerId)}>
                {contagem(linha.billingCount, DOCUMENTOS)} no período
              </Link>
            </li>
          ))}
        </ol>
      )}
      {ranking.excludedTotal > 0 && (
        <div className="mgmt-ranking__excluded">
          <p>Fora do ranking — faturamento sem valor no período:</p>
          <ul>
            {ranking.excluded.map((cliente) => (
              <li key={cliente.customerId}>
                <Link to={linkDosFaturamentos(periodo, cliente.customerId)}>{nomeDoCliente(cliente)}</Link>
                {` · ${formatIntegerPtBr(cliente.withoutValue)} de ${contagem(cliente.billingCount, DOCUMENTOS)} sem valor`}
              </li>
            ))}
          </ul>
          {ranking.excludedTotal > ranking.excluded.length && (
            <p>e mais {formatIntegerPtBr(ranking.excludedTotal - ranking.excluded.length)}.</p>
          )}
        </div>
      )}
    </section>
  );
}

function RankingDeProdutos({ ranking }: { ranking: ManagementDashboardDTO["rankings"]["products"] }) {
  return (
    <section className="mgmt-ranking" aria-labelledby="mgmt-ranking-produtos">
      <h2 id="mgmt-ranking-produtos">Produtos — valor das linhas, antes do desconto</h2>
      <p className="mgmt-section__hint">
        A soma deste ranking não é o Faturado: o desconto do pedido não é dividido entre as linhas. Quantidade só
        dentro do produto, na unidade dele.
      </p>
      {ranking.rows.length === 0 ? (
        <p className="mgmt-empty">
          {ranking.excludedTotal > 0
            ? "Nenhum produto com todas as linhas com preço no período."
            : "Nenhum produto faturado no período."}
        </p>
      ) : (
        <ol className="mgmt-ranking__list">
          {ranking.rows.map((linha, indice) => (
            <li key={linha.productId} className="mgmt-ranking__row">
              <span className="mgmt-ranking__pos">{formatIntegerPtBr(indice + 1)}</span>
              {linha.customerId ? (
                <Link
                  className="mgmt-ranking__name"
                  to={linkDaVisaoDoClienteProduto(linha.customerId, linha.productId)}
                >{`${linha.code} ${linha.name}`}</Link>
              ) : (
                <span className="mgmt-ranking__name">{`${linha.code} ${linha.name}`}</span>
              )}
              <span className="mgmt-ranking__value">{formatBRL(linha.amount)}</span>
              <span className="mgmt-ranking__detail">
                {linha.quantities.map((item) => `${formatQuantity(item.quantity)} ${item.unitCode}`).join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      )}
      {ranking.excludedTotal > 0 && (
        <div className="mgmt-ranking__excluded">
          <p>Fora do ranking — linha faturada sem preço:</p>
          <ul>
            {ranking.excluded.map((produto) => (
              <li key={produto.productId}>
                {`${produto.code} ${produto.name} · ${formatIntegerPtBr(produto.linesWithoutPrice)} ${
                  produto.linesWithoutPrice === 1 ? "linha" : "linhas"
                } sem preço`}
              </li>
            ))}
          </ul>
          {ranking.excludedTotal > ranking.excluded.length && (
            <p>e mais {formatIntegerPtBr(ranking.excludedTotal - ranking.excluded.length)}.</p>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Próximos compromissos
 * ------------------------------------------------------------------ */

function ListaDeEntregas({ itens, total, vazio }: { itens: EntregaDoCompromissoDTO[]; total: number; vazio: string }) {
  if (total === 0) return <p className="mgmt-empty">{vazio}</p>;
  return (
    <>
      <ul className="mgmt-list">
        {itens.map((item) => (
          <li key={item.deliveryId}>
            <Link to={`/comercial/pedidos/${item.customerOrderId}`}>{item.customerOrderCode}</Link>
            {` · Entrega ${item.sequence} · ${formatDate(item.scheduledDate)}`}
            {item.customerName ? ` · ${item.customerName}` : ""}
          </li>
        ))}
      </ul>
      {total > itens.length && <p className="mgmt-list__more">e mais {formatIntegerPtBr(total - itens.length)}.</p>}
    </>
  );
}

function ProximosCompromissos({ compromissos }: { compromissos: ManagementDashboardDTO["commitments"] }) {
  const { scheduledDeliveries: programadas, lateDeliveries: atrasadas, expectedPurchases: compras } = compromissos;
  return (
    <section className="mgmt-section" aria-labelledby="mgmt-compromissos">
      <div className="mgmt-section__head">
        <h2 id="mgmt-compromissos">Próximos compromissos</h2>
        <span className="mgmt-section__hint">
          Hoje e os 29 dias seguintes ({intervaloPorExtenso(compromissos.window)}) — só o que está registrado; não
          depende do período.
        </span>
      </div>
      <div className="mgmt-commitments">
        <article className="mgmt-card" aria-label="Entregas programadas">
          <h3 className="mgmt-card__label">Entregas programadas</h3>
          <p className="mgmt-card__value">{formatIntegerPtBr(programadas.count)}</p>
          {programadas.count > 0 &&
            (programadas.amount === null ? (
              <p className="mgmt-card__note mgmt-card__note--incomplete">
                Valores incompletos — {formatIntegerPtBr(programadas.withValue)} de {contagem(programadas.count, ENTREGAS)}{" "}
                com preço acordado.
              </p>
            ) : (
              <p className="mgmt-card__note">{formatBRL(programadas.amount)} acordado, antes do desconto do pedido.</p>
            ))}
          <ListaDeEntregas itens={programadas.items} total={programadas.count} vazio="Nenhuma entrega programada na janela." />
        </article>

        <article className="mgmt-card" aria-label="Entregas atrasadas">
          <h3 className="mgmt-card__label">Entregas atrasadas</h3>
          <p className="mgmt-card__value">{formatIntegerPtBr(atrasadas.count)}</p>
          <p className="mgmt-card__note">O dia prometido já passou e ainda há saldo.</p>
          <ListaDeEntregas itens={atrasadas.items} total={atrasadas.count} vazio="Nenhuma entrega atrasada." />
        </article>

        <article className="mgmt-card" aria-label="Compras esperadas">
          <h3 className="mgmt-card__label">Compras esperadas</h3>
          <p className="mgmt-card__value">{formatIntegerPtBr(compras.count)}</p>
          <p className="mgmt-card__note">Ordens de compra com saldo e previsão na janela — contagem, sem valor previsto.</p>
          {compras.count === 0 ? (
            <p className="mgmt-empty">Nenhuma compra prevista na janela.</p>
          ) : (
            <>
              <ul className="mgmt-list">
                {compras.items.map((compra) => (
                  <li key={compra.purchaseOrderId}>
                    <Link to={`/compras/ordens/${compra.purchaseOrderId}`}>{compra.code}</Link>
                    {` · ${compra.supplierName} · ${formatDate(compra.expectedDeliveryDate)}`}
                  </li>
                ))}
              </ul>
              {compras.count > compras.items.length && (
                <p className="mgmt-list__more">e mais {formatIntegerPtBr(compras.count - compras.items.length)}.</p>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Período
 * ------------------------------------------------------------------ */

/** Ponta que pode virar consulta: vazia, ou um dia de verdade (nada de ano 0002 no meio da digitação). */
function pontaAplicavel(valor: string, incompleta: boolean): boolean {
  if (incompleta) return false;
  return valor === "" || (ehDiaCivil(valor) && !valor.startsWith("0"));
}

/**
 * As datas do Personalizado. Cada tecla aparece no campo na hora; a consulta só
 * sai quando a digitação para (`PAUSA_DO_PERIODO_MS`) ou no Enter — o mesmo
 * comportamento do filtro de período das listas.
 */
function CamposDoPersonalizado({
  dateFrom,
  dateTo,
  recusada,
  aoAplicar,
}: {
  dateFrom: string;
  dateTo: string;
  recusada: boolean;
  aoAplicar: (de: string, ate: string) => void;
}) {
  const [digitadas, setDigitadas] = useState({ dateFrom, dateTo });
  const [incompletas, setIncompletas] = useState({ dateFrom: false, dateTo: false });
  const [aplicadas, setAplicadas] = useState({ dateFrom, dateTo });
  if (aplicadas.dateFrom !== dateFrom || aplicadas.dateTo !== dateTo) {
    setAplicadas({ dateFrom, dateTo });
    setDigitadas({ dateFrom, dateTo });
    setIncompletas({ dateFrom: false, dateTo: false });
  }

  const pendente = digitadas.dateFrom !== dateFrom || digitadas.dateTo !== dateTo;
  const podeAplicar =
    pendente &&
    pontaAplicavel(digitadas.dateFrom, incompletas.dateFrom) &&
    pontaAplicavel(digitadas.dateTo, incompletas.dateTo);

  const aoAplicarAtual = useRef(aoAplicar);
  aoAplicarAtual.current = aoAplicar;

  useEffect(() => {
    if (!podeAplicar) return;
    const timer = setTimeout(() => aoAplicarAtual.current(digitadas.dateFrom, digitadas.dateTo), PAUSA_DO_PERIODO_MS);
    return () => clearTimeout(timer);
  }, [podeAplicar, digitadas.dateFrom, digitadas.dateTo]);

  function digitar(ponta: "dateFrom" | "dateTo") {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const valor = event.target.value;
      const incompleta = event.target.validity?.badInput === true;
      setDigitadas((atuais) => ({ ...atuais, [ponta]: valor }));
      setIncompletas((atuais) => ({ ...atuais, [ponta]: incompleta }));
    };
  }

  function aplicarNoEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && podeAplicar) aoAplicar(digitadas.dateFrom, digitadas.dateTo);
  }

  return (
    <span className="mgmt-filter__custom">
      <label className="sr-only" htmlFor="mgmt-date-from">
        Data inicial
      </label>
      <input
        id="mgmt-date-from"
        type="date"
        value={digitadas.dateFrom}
        aria-invalid={recusada ? true : undefined}
        aria-describedby={recusada ? "mgmt-period-error" : undefined}
        onChange={digitar("dateFrom")}
        onKeyDown={aplicarNoEnter}
      />
      <label className="sr-only" htmlFor="mgmt-date-to">
        Data final
      </label>
      <input
        id="mgmt-date-to"
        type="date"
        value={digitadas.dateTo}
        aria-invalid={recusada ? true : undefined}
        aria-describedby={recusada ? "mgmt-period-error" : undefined}
        onChange={digitar("dateTo")}
        onKeyDown={aplicarNoEnter}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * A tela
 * ------------------------------------------------------------------ */

function ConteudoDoPainel({ painel }: { painel: ManagementDashboardDTO }) {
  const { period, result, position, trend, rankings, commitments } = painel;
  return (
    <>
      <section className="mgmt-section" aria-labelledby="mgmt-resultado">
        <div className="mgmt-section__head">
          <h2 id="mgmt-resultado">Resultado do período</h2>
          <span className="mgmt-section__hint">{intervaloPorExtenso(period.current)}</span>
        </div>
        <div className="mgmt-cards">
          <CartaoMonetario
            titulo="Faturado"
            indicador={result.billed}
            nome={DOCUMENTOS}
            criterio="com valor"
            vazio="Sem faturamentos no período."
            rotuloSemValor="Faturamentos sem valor"
            abrirDocumento={(id) => `/comercial/faturamento/${id}`}
            destino={{ to: linkDosFaturamentos(period.current), rotulo: "Ver faturamentos" }}
          />
          <CartaoMonetario
            titulo="Pedidos confirmados"
            indicador={result.confirmedOrders}
            nome={PEDIDOS}
            criterio="com preço acordado"
            vazio="Nenhum pedido confirmado no período."
            rotuloSemValor="Pedidos sem preço acordado"
            abrirDocumento={(id) => `/comercial/pedidos/${id}`}
          />
          <CartaoMonetario
            titulo="Compras contratadas"
            indicador={result.contractedPurchases}
            nome={OCS}
            criterio="com preço"
            vazio="Nenhuma ordem de compra contratada no período."
            rotuloSemValor="OCs sem preço completo"
            abrirDocumento={(id) => `/compras/ordens/${id}`}
            destino={{ to: linkDasComprasContratadas(period.current), rotulo: "Ver ordens de compra" }}
          />
          <CartaoDeClientes indicador={result.billedCustomers} />
        </div>
      </section>

      <section className="mgmt-section" aria-labelledby="mgmt-posicao">
        <div className="mgmt-section__head">
          <h2 id="mgmt-posicao">Posição atual</h2>
          <span className="mgmt-section__hint">
            Não depende do período · preço acordado, antes do desconto do pedido
          </span>
        </div>
        <div className="mgmt-position">
          <CartaoDaPosicao
            titulo="A expedir"
            posicao={position.toShip}
            nome={PEDIDOS}
            vazio="Nenhum pedido com saldo a expedir."
            rotuloSemValor="Pedidos sem preço acordado"
            abrirDocumento={(id) => `/comercial/pedidos/${id}`}
            destino={{ to: LINK_DA_CARTEIRA, rotulo: "Ver pedidos da carteira" }}
          />
          <CartaoDaPosicao
            titulo="A faturar"
            posicao={position.toBill}
            nome={EXPEDICOES}
            vazio="Nenhuma expedição aguardando faturamento."
            rotuloSemValor="Expedições sem preço acordado"
            abrirDocumento={(id) => `/comercial/expedicoes/${id}`}
            destino={{ to: LINK_A_FATURAR, rotulo: "Ver expedições a faturar" }}
          />
        </div>
        <ComposicaoDaCarteira aExpedir={position.toShip} aFaturar={position.toBill} />
      </section>

      <section className="mgmt-section" aria-labelledby="mgmt-tendencia">
        <div className="mgmt-section__head">
          <h2 id="mgmt-tendencia">Tendência — {TITULO_DA_TENDENCIA[trend.granularity]}</h2>
          <span className="mgmt-section__hint">{intervaloPorExtenso(period.current)}</span>
        </div>
        <TendenciaDoFaturado tendencia={trend} />
      </section>

      <div className="mgmt-rankings">
        <RankingDeClientes ranking={rankings.customers} periodo={period.current} />
        <RankingDeProdutos ranking={rankings.products} />
      </div>

      <ProximosCompromissos compromissos={commitments} />
    </>
  );
}

/**
 * Gestão → Painel Gerencial (MANAGEMENT-DASHBOARD-V1-01).
 *
 * Faturamento, carteira e compras — valores comerciais, não financeiros. Tudo
 * vem do read model `GET /management-dashboard`, que é a autoridade do perfil:
 * a tela só não pergunta o que seria recusado. O período mora na URL, para a
 * volta de um documento aberto pelo painel reabrir o mesmo recorte.
 */
export function ManagementDashboardPage() {
  const { user } = useAuth();
  const permitido = user ? MANAGEMENT_DASHBOARD_ROLES.includes(user.role) : false;

  const [params, setParams] = useSearchParams();
  const periodoDaUrl = params.get("period") ?? "";
  const period: ManagementPeriodPreset = ehPeriodoGerencial(periodoDaUrl) ? periodoDaUrl : "mes-atual";
  const dateFrom = period === "custom" ? (params.get("dateFrom") ?? "") : "";
  const dateTo = period === "custom" ? (params.get("dateTo") ?? "") : "";
  const recusa = recusaDoPeriodoGerencial(period, dateFrom, dateTo);

  const consultaParams = useMemo<ManagementDashboardParams>(
    () => (period === "custom" ? { period, dateFrom, dateTo } : { period }),
    [period, dateFrom, dateTo],
  );
  // Resposta de outro período nunca fica à vista sob o período novo: a consulta é por recorte.
  const consulta = useListQuery(getManagementDashboard, consultaParams, {
    enabled: permitido && recusa === null,
    fallbackError: "Falha ao carregar o Painel Gerencial.",
  });
  const painel = consulta.data;

  function escolher(preset: ManagementPeriodPreset) {
    if (preset === period) return;
    setParams(
      (atuais) => {
        const proximo = new URLSearchParams(atuais);
        proximo.delete("dateFrom");
        proximo.delete("dateTo");
        if (preset === "mes-atual") proximo.delete("period");
        else proximo.set("period", preset);
        if (preset === "custom") {
          // O Personalizado nasce com o período que estava na tela.
          const semente = painel?.period.current ?? resolverPeriodoGerencial(period, undefined, undefined).current;
          proximo.set("dateFrom", semente.from);
          proximo.set("dateTo", semente.to);
        }
        return proximo;
      },
      { replace: true },
    );
  }

  function aplicarPersonalizado(de: string, ate: string) {
    setParams(
      (atuais) => {
        const proximo = new URLSearchParams(atuais);
        proximo.set("period", "custom");
        proximo.set("dateFrom", de);
        proximo.set("dateTo", ate);
        return proximo;
      },
      { replace: true },
    );
  }

  const cabecalho = (
    <div className="page__header">
      <div>
        <h1 className="page__title">Painel Gerencial</h1>
        <p className="page__subtitle">Faturamento, carteira e compras — valores comerciais, não financeiros.</p>
      </div>
    </div>
  );

  if (!permitido) {
    return (
      <>
        {cabecalho}
        <p className="form-alert" role="alert">
          Seu perfil não permite ver o Painel Gerencial.
        </p>
      </>
    );
  }

  return (
    <>
      {cabecalho}
      <ContextHelp topic={helpTopics["painelGerencial.comoFunciona"]} />

      <div className="mgmt-filter" role="group" aria-label="Período">
        <span className="mgmt-filter__label">Período:</span>
        {MANAGEMENT_PERIOD_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={preset === period ? "btn btn--primary btn--sm" : "btn btn--secondary btn--sm"}
            aria-pressed={preset === period}
            onClick={() => escolher(preset)}
          >
            {MANAGEMENT_PERIOD_PRESET_LABELS[preset]}
          </button>
        ))}
        {period === "custom" && (
          <CamposDoPersonalizado
            dateFrom={dateFrom}
            dateTo={dateTo}
            recusada={recusa !== null}
            aoAplicar={aplicarPersonalizado}
          />
        )}
        {recusa && (
          <p id="mgmt-period-error" className="form-alert mgmt-filter__error" role="alert">
            {recusa.mensagem}
          </p>
        )}
      </div>

      {painel && (
        <p className="mgmt-compare">
          {intervaloPorExtenso(painel.period.current)} · comparado com {intervaloPorExtenso(painel.period.previous)}
        </p>
      )}

      {consulta.error && (
        <div className="form-alert mgmt-error" role="alert">
          <span>{consulta.error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={consulta.reload}>
            Tentar novamente
          </button>
        </div>
      )}
      {consulta.loading && (
        <p className="muted" role="status">
          Carregando…
        </p>
      )}

      {painel && <ConteudoDoPainel painel={painel} />}

      <p className="mgmt-footer">
        Esta tela não mostra contas a receber, contas a pagar, caixa, impostos, margem nem CMV. Faturado não é
        recebido; compra contratada não é paga.
      </p>
    </>
  );
}
