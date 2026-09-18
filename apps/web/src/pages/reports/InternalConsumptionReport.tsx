import { useEffect, useMemo, useState } from "react";
import type {
  CostSource,
  InternalConsumptionReportFilterOptionsDTO,
  InternalConsumptionReportSummaryDTO,
} from "@veridi/shared";
import {
  COST_SOURCE_LABELS,
  CUSTO_NAO_DISPONIVEL,
  INTERNAL_CONSUMPTION_COST_FILTER_LABELS,
  SEM_DESTINO_INFORMADO,
  recusaDoPeriodo,
} from "@veridi/shared";
import { EntityLink } from "../../components/EntityLink";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import { formatBRL } from "../../lib/currency";
import { formatEventDate } from "../../lib/dates";
import { itemDeUsoEConsumoFilterSource } from "../../lib/filter-sources";
import { formatIntegerPtBr, formatMoneyPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity } from "../../lib/quantity";
import {
  getInternalConsumptionReport,
  getInternalConsumptionReportFilterOptions,
} from "../../lib/reports-api";
import { ReportPage, ReportPagination, ReportSummaryItem, ReportTable } from "./ReportPage";
import { ariaDoPeriodoRecusado, diaDoRelatorio } from "./report-period";
import { useFiltrosDigitados } from "./useFiltrosDigitados";
import { useReport } from "./useReport";

const PAGE_SIZE = 25;

const ORIGENS_DO_CUSTO = Object.entries(COST_SOURCE_LABELS) as [CostSource, string][];

/** Custo numa célula: `null` é "Custo não disponível", nunca R$ 0,00. */
function custo(valor: string | null, formatar: (valor: string) => string): string {
  return valor === null ? CUSTO_NAO_DISPONIVEL : formatar(valor);
}

const custoUnitario = (valor: string) => formatMoneyPtBr(valor, { scale: 4 });

/**
 * O que o valor total NÃO contém, dito ao lado dele. Um total de custo
 * conhecido sem essa frase seria lido como a despesa inteira do recorte.
 */
function avisoDoValor(resumo: InternalConsumptionReportSummaryDTO): string | null {
  if (resumo.missingCostCount === 0) return null;
  if (resumo.knownCostCount === 0) {
    return "Nenhum consumo do recorte tem custo conhecido: o valor total é desconhecido, não R$ 0,00.";
  }
  const semCusto = resumo.missingCostCount;
  return semCusto === 1
    ? `Valor parcial: 1 consumo com ${CUSTO_NAO_DISPONIVEL.toLowerCase()} não entra na soma.`
    : `Valor parcial: ${formatIntegerPtBr(semCusto)} consumos com ${CUSTO_NAO_DISPONIVEL.toLowerCase()} não entram na soma.`;
}

/**
 * R-21 — Uso e consumo (INTERNAL-CONSUMPTION-REPORT-01, Fatia 3).
 *
 * O relatório GERENCIAL do consumo interno: quanto saiu, quanto custou, quais
 * itens mais pesaram, para qual destino, quem registrou e o que ficou sem
 * custo. O histórico operacional continua na tela de Uso e consumo.
 *
 * Todo número vem do servidor, sobre o MESMO recorte da tabela: resumo e
 * agrupamentos são do filtro inteiro, nunca da página aberta. O custo é o
 * gravado no dia de cada consumo — o relatório não o recalcula.
 */
export function InternalConsumptionReportPage() {
  const [itemId, setItemId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [registeredByUserId, setRegisteredByUserId] = useState("");
  const [costSource, setCostSource] = useState("");
  const [hasCost, setHasCost] = useState("");
  const [page, setPage] = useState(1);
  const digitados = useFiltrosDigitados({ search: "", from: diaDoRelatorio(-29), to: diaDoRelatorio(0) }, setPage);
  const { search, from, to } = digitados.aplicados;

  const [opcoes, setOpcoes] = useState<InternalConsumptionReportFilterOptionsDTO>({ purposes: [], users: [] });
  useEffect(() => {
    let vivo = true;
    getInternalConsumptionReportFilterOptions()
      .then((resposta) => {
        if (vivo) setOpcoes(resposta);
      })
      // Sem opções, os dois seletores ficam só com "Todos"; o relatório segue.
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  const filters = useMemo(
    () => ({
      search,
      itemId,
      purpose,
      registeredByUserId,
      costSource,
      hasCost,
      from,
      to,
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, itemId, purpose, registeredByUserId, costSource, hasCost, from, to, page],
  );
  const periodoRecusado = recusaDoPeriodo(from, to);
  const { data, loading, error } = useReport(getInternalConsumptionReport, filters, {
    enabled: periodoRecusado === null,
  });

  /** Seletor muda o recorte: volta à página 1 no mesmo render. */
  function escolher(definir: (valor: string) => void) {
    return (valor: string) => {
      setPage(1);
      definir(valor);
    };
  }

  const resumo = data?.summary;
  const aviso = resumo ? avisoDoValor(resumo) : null;

  return (
    <ReportPage
      title="R-21 · Uso e consumo"
      csvPath="/reports/inventory/internal-consumption/export.csv"
      reportCode="R-21"
      csvFilters={filters}
      total={data?.total}
      subtitle="Consumo interno por período, item, destino e usuário — com o custo gravado no dia de cada consumo."
      loading={loading}
      error={error}
      periodRefusal={periodoRecusado}
      filtersPending={digitados.pendente}
      summary={
        // Sem consumo no recorte não há valor a qualificar: o vazio é dito pela tabela.
        resumo &&
        resumo.consumptionCount > 0 && (
          <>
            <ReportSummaryItem label="Consumos" value={resumo.consumptionCount} />
            <ReportSummaryItem label="Valor total conhecido" value={custo(resumo.knownCostTotal, formatBRL)} />
            <ReportSummaryItem label="Consumos sem custo" value={resumo.missingCostCount} />
            <ReportSummaryItem label="Itens distintos" value={resumo.distinctItemCount} />
            {aviso && (
              <p className="report-summary__note" role="note">
                {aviso}
              </p>
            )}
          </>
        )
      }
      filters={
        <>
          <label htmlFor="ci-from">De</label>
          <input id="ci-from" type="date" {...digitados.campo("from")} {...ariaDoPeriodoRecusado(periodoRecusado)} />
          <label htmlFor="ci-to">até</label>
          <input id="ci-to" type="date" {...digitados.campo("to")} {...ariaDoPeriodoRecusado(periodoRecusado)} />
          <EntityFilterSelect
            id="ci-item"
            label="Item de uso e consumo"
            placeholder="Todos os itens"
            value={itemId}
            onChange={escolher(setItemId)}
            source={itemDeUsoEConsumoFilterSource}
          />
          <label htmlFor="ci-purpose">Destino/uso</label>
          <select id="ci-purpose" value={purpose} onChange={(event) => escolher(setPurpose)(event.target.value)}>
            <option value="">Todos os destinos</option>
            {opcoes.purposes.map((destino) => (
              <option key={destino} value={destino}>
                {destino}
              </option>
            ))}
          </select>
          <label htmlFor="ci-user">Usuário</label>
          <select
            id="ci-user"
            value={registeredByUserId}
            onChange={(event) => escolher(setRegisteredByUserId)(event.target.value)}
          >
            <option value="">Todos os usuários</option>
            {opcoes.users.map((usuario) => (
              <option key={usuario.id} value={usuario.id}>
                {usuario.name}
              </option>
            ))}
          </select>
          <label htmlFor="ci-cost-source">Origem do custo</label>
          <select
            id="ci-cost-source"
            value={costSource}
            onChange={(event) => escolher(setCostSource)(event.target.value)}
          >
            <option value="">Todas as origens</option>
            {ORIGENS_DO_CUSTO.map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
          <label htmlFor="ci-has-cost">Custo</label>
          <select id="ci-has-cost" value={hasCost} onChange={(event) => escolher(setHasCost)(event.target.value)}>
            <option value="">Com e sem custo</option>
            <option value="true">{INTERNAL_CONSUMPTION_COST_FILTER_LABELS.true}</option>
            <option value="false">{INTERNAL_CONSUMPTION_COST_FILTER_LABELS.false}</option>
          </select>
          <div className="toolbar__search">
            <input
              type="search"
              aria-label="Buscar consumo"
              placeholder="Buscar por CI-, código ou nome do item…"
              {...digitados.campo("search")}
            />
          </div>
        </>
      }
    >
      {data && data.summary.consumptionCount > 0 && (
        <div className="report-groups">
          <section className="report-block" aria-labelledby="ci-por-item">
            <h2 id="ci-por-item">Resumo por item</h2>
            <div className="table-container">
              <table className="table report-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Consumos</th>
                    <th>Quantidade</th>
                    <th>Valor conhecido</th>
                    <th>Sem custo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byItem.map((grupo) => (
                    <tr key={`${grupo.itemId}-${grupo.uomCode}`}>
                      <td>
                        <EntityLink kind="item" id={grupo.itemId} code={grupo.itemCode} name={grupo.itemName} />
                      </td>
                      <td className="is-number">{formatIntegerPtBr(grupo.consumptionCount)}</td>
                      <td className="is-number">
                        {formatQuantity(grupo.quantity)} {grupo.uomCode}
                      </td>
                      <td className="is-number">{custo(grupo.knownCostTotal, formatBRL)}</td>
                      <td className="is-number">{formatIntegerPtBr(grupo.missingCostCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="report-block" aria-labelledby="ci-por-destino">
            <h2 id="ci-por-destino">Resumo por destino/uso</h2>
            <div className="table-container">
              <table className="table report-table">
                <thead>
                  <tr>
                    <th>Destino/uso</th>
                    <th>Consumos</th>
                    <th>Valor conhecido</th>
                    <th>Sem custo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byPurpose.map((grupo) => (
                    <tr key={grupo.purpose ?? ""}>
                      <td>{grupo.purpose ?? SEM_DESTINO_INFORMADO}</td>
                      <td className="is-number">{formatIntegerPtBr(grupo.consumptionCount)}</td>
                      <td className="is-number">{custo(grupo.knownCostTotal, formatBRL)}</td>
                      <td className="is-number">{formatIntegerPtBr(grupo.missingCostCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <ReportTable
        columns={[
          "Data",
          "Consumo",
          "Item",
          "Quantidade",
          "Unidade",
          "Destino/uso",
          "Custo unitário",
          "Custo total",
          "Origem do custo",
          "Usuário",
        ]}
        emptyMessage="Nenhum consumo para os filtros informados."
        rows={(data?.rows ?? []).map((row) => (
          <tr key={row.id}>
            <td>{formatEventDate(row.occurredAt)}</td>
            <td>
              <span className="code">{row.code}</span>
            </td>
            <td>
              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
            </td>
            <td className="is-number">{formatQuantity(row.quantity)}</td>
            <td>{row.uomCode}</td>
            <td>{row.purpose ?? "—"}</td>
            <td className="is-number">{custo(row.unitCost, custoUnitario)}</td>
            <td className="is-number">{custo(row.totalCost, formatBRL)}</td>
            <td>{COST_SOURCE_LABELS[row.costSource]}</td>
            <td>{row.registeredByName}</td>
          </tr>
        ))}
      />
      {data && (
        <ReportPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
      )}
    </ReportPage>
  );
}
