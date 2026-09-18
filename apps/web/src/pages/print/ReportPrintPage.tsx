import { useParams, useSearchParams } from "react-router-dom";
import type { UserRole } from "@veridi/shared";
import {
  COST_SOURCE_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  INVENTORY_MOVEMENT_SOURCE_LABELS,
  INVENTORY_MOVEMENT_TYPE_LABELS,
  INTERNAL_CONSUMPTION_COST_FILTER_LABELS,
  INVENTORY_OWNER_TYPE_LABELS,
  ITEM_TYPE_LABELS,
  LOT_STATUS_LABELS,
  PRICING_PROVENANCE_ROLES,
  PRODUCTION_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_ORIGIN_LABELS,
  PURCHASE_ORDER_STATUS_LABELS,
  QUOTE_PRICE_SOURCE_LABELS,
  QUOTE_STATUS_LABELS,
  REPORT_FILTER_CONTRACTS,
} from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { API_URL, apiFetch } from "../../lib/api";
import { apiErrorMessage, parseJsonOrThrow } from "../../lib/api-errors";
import {
  clienteFilterSource,
  fornecedorFilterSource,
  itemFilterSource,
  ordemDeCompraParaReceberSource,
  ordemDeProducaoFilterSource,
  pedidoFilterSource,
  produtoFilterSource,
  usuarioDoConsumoInternoFilterSource,
} from "../../lib/filter-sources";
import type { EntityFilterSource } from "../../components/filters/EntityFilterSelect";
import { PdfScreen } from "../../pdf/PdfScreen";
import { JANELAS_DE_VENCIMENTO } from "../reports/report-period";

/**
 * Relatórios R-01…R-20 em PDF, em ROTA DEDICADA.
 *
 * A origem nunca é a tela operacional: o documento é montado do zero, fora do
 * AppShell, a partir do MESMO endpoint de exportação que a tela usa — o que
 * garante o resultado filtrado COMPLETO (`ALL_ROWS`) e as mesmas colunas
 * rotuladas, sem reimplementar 17 relatórios nem duplicar definição de
 * coluna. O arquivo é PDF de verdade, gerado no navegador sobre o dado que
 * esta página buscou com a sessão do usuário; o módulo do documento só
 * carrega quando alguém gera o PDF.
 */

/** Separador e BOM usados pelo `buildCsv` da API. */
const SEPARATOR = ";";

/** Valor da URL → o que o papel escreve, por filtro. */
type FilterValueLabels = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Filtro liga/desliga: a URL leva `true`/`false`, o papel diz Sim/Não. */
const SIM_OU_NAO: Readonly<Record<string, string>> = { true: "Sim", false: "Não" };

interface ReportPrintDefinition {
  code: string;
  title: string;
  /**
   * Endpoint de exportação — mesmo filtro da tela, sempre `ALL_ROWS`. Vem do
   * contrato compartilhado (`REPORT_FILTER_CONTRACTS`), com `filterKeys`.
   */
  csvPath: string;
  /** Volta para a tela do relatório. */
  screenPath: string;
  /** Contém custo/margem: documento interno, nunca entregue ao cliente. */
  internal?: boolean;
  /**
   * Perfis que podem gerar o documento — a lista que a API aplica ao CSV. A
   * recusa de verdade é do servidor; aqui só não se pede o que seria negado.
   */
  roles?: readonly UserRole[];
  /**
   * Relatório largo demais para uma linha só. As colunas listadas aqui viram
   * a linha principal; TODAS as outras aparecem logo abaixo, rotuladas, na
   * mesma linha de detalhe. Nada some do papel — só deixa de disputar largura.
   */
  primaryColumns?: string[];
  /**
   * Chaves de filtro que o schema DESTE relatório aceita na API (sem
   * paginação). Só elas vão a "Filtros aplicados" e só elas disparam consulta
   * de nome: chave que o relatório não conhece a API descarta, e declará-la no
   * papel diria um recorte que não aconteceu — `R-08?customerId=…` saía
   * "Cliente: …" sobre todas as OCs (REPORTS-PRINT-UNACCEPTED-FILTER-01).
   *
   * Nunca escrita aqui: vem de `REPORT_FILTER_CONTRACTS` (shared), que o teste
   * de contrato da API compara com o schema de cada rota — filtro acrescentado
   * ou removido de um lado só reprova (REPORTS-PRINT-FILTER-KEYS-DRIFT-01).
   */
  filterKeys: readonly string[];
  /**
   * Chave aceita que o serviço só lê em certa combinação: fora dela a API a
   * ignora, e o papel também. Ex.: R-02 só filtra por `from`/`to` na janela
   * `CUSTOM`.
   */
  filterAppliesWhen?: Readonly<Record<string, (params: URLSearchParams) => boolean>>;
  /**
   * Rótulos dos filtros de lista fechada, com o MESMO mapa que a tela usa no
   * seletor. `status` muda de sentido de um relatório para outro — lote, OP,
   * OC, pedido, orçamento —, por isso o mapa é de cada relatório. Filtro fora
   * daqui sai como veio (REPORTS-PRESENTATION-WAVE-01).
   */
  filterValues?: FilterValueLabels;
}

export const REPORT_PRINT_DEFINITIONS: Record<string, ReportPrintDefinition> = {
  "R-01": {
    code: "R-01",
    title: "Posição de Estoque",
    ...REPORT_FILTER_CONTRACTS["R-01"],
    screenPath: "/relatorios/estoque/posicao",
    // 16 colunas não cabem numa linha da folha: lote do fornecedor, lote
    // Veridi, proprietário, fornecedor, tipo e CoA descem para o detalhe.
    primaryColumns: [
      "Item",
      "Descrição",
      "Lote interno",
      "Validade",
      "Localização",
      "On Hand",
      "Reservado",
      "Disponível",
      "Unidade",
      "Qualidade",
    ],
    filterValues: {
      itemType: ITEM_TYPE_LABELS,
      status: LOT_STATUS_LABELS,
      onlyWithBalance: SIM_OU_NAO,
      ownerType: INVENTORY_OWNER_TYPE_LABELS,
    },
  },
  "R-02": {
    code: "R-02",
    title: "Vencimentos",
    ...REPORT_FILTER_CONTRACTS["R-02"],
    screenPath: "/relatorios/estoque/vencimentos",
    // As pontas só são filtro na janela personalizada; nas prontas a API nem as lê.
    filterAppliesWhen: {
      from: (params) => params.get("window") === "CUSTOM",
      to: (params) => params.get("window") === "CUSTOM",
    },
    primaryColumns: [
      "Item",
      "Descrição",
      "Lote interno",
      "Validade",
      "Dias até vencer",
      "On Hand",
      "Reservado",
      "Disponível",
      "Unidade",
      "Qualidade",
    ],
    filterValues: { itemType: ITEM_TYPE_LABELS, window: JANELAS_DE_VENCIMENTO, onlyWithBalance: SIM_OU_NAO },
  },
  "R-03": {
    code: "R-03",
    title: "Movimentações",
    ...REPORT_FILTER_CONTRACTS["R-03"],
    screenPath: "/relatorios/estoque/movimentacoes",
    filterValues: { type: INVENTORY_MOVEMENT_TYPE_LABELS, sourceType: INVENTORY_MOVEMENT_SOURCE_LABELS },
  },
  "R-04": {
    code: "R-04",
    title: "Necessidade / Falta para OP",
    ...REPORT_FILTER_CONTRACTS["R-04"],
    screenPath: "/relatorios/producao/necessidades",
    primaryColumns: [
      "OP",
      "Produto",
      "Item",
      "Descrição",
      "Necessário",
      "Reservado",
      "Disponível",
      "Em compra",
      "Falta",
      "Unidade",
    ],
    filterValues: { status: PRODUCTION_ORDER_STATUS_LABELS, onlyShortage: SIM_OU_NAO },
  },
  "R-05": {
    code: "R-05",
    title: "Planejado x Realizado",
    ...REPORT_FILTER_CONTRACTS["R-05"],
    screenPath: "/relatorios/producao/planejado-realizado",
    // O custo e a qualidade que o explica ficam lado a lado.
    primaryColumns: [
      "OP",
      "Produto",
      "Nome do produto",
      "Planejado",
      "Produzido",
      "Variação",
      "Rendimento (%)",
      "Unidade",
      "Status",
      "Custo material unitário",
      "Qualidade do custo",
    ],
    filterValues: { status: PRODUCTION_ORDER_STATUS_LABELS, includeCost: SIM_OU_NAO },
  },
  "R-07": {
    code: "R-07",
    title: "Consumo por período",
    ...REPORT_FILTER_CONTRACTS["R-07"],
    screenPath: "/relatorios/producao/consumo",
  },
  "R-08": {
    code: "R-08",
    title: "Ordens de Compra",
    ...REPORT_FILTER_CONTRACTS["R-08"],
    screenPath: "/relatorios/compras/ordens",
    filterValues: { status: PURCHASE_ORDER_STATUS_LABELS, origin: PURCHASE_ORDER_ORIGIN_LABELS },
  },
  "R-09": {
    code: "R-09",
    title: "Recebimentos",
    ...REPORT_FILTER_CONTRACTS["R-09"],
    screenPath: "/relatorios/compras/recebimentos",
    primaryColumns: [
      "Recebimento",
      "Data",
      "OC",
      "Fornecedor",
      "Item",
      "Descrição",
      "Lote interno",
      "Quantidade",
      "Unidade",
      "Custo efetivo",
      "Qualidade do custo",
    ],
  },
  "R-10": {
    code: "R-10",
    title: "Em Compra",
    ...REPORT_FILTER_CONTRACTS["R-10"],
    screenPath: "/relatorios/compras/em-compra",
  },
  "R-11": {
    code: "R-11",
    title: "OCs atrasadas",
    ...REPORT_FILTER_CONTRACTS["R-11"],
    screenPath: "/relatorios/compras/atrasadas",
  },
  "R-12": {
    code: "R-12",
    title: "Pedidos do Cliente",
    ...REPORT_FILTER_CONTRACTS["R-12"],
    screenPath: "/relatorios/comercial/pedidos",
    filterValues: { status: CUSTOMER_ORDER_STATUS_LABELS },
  },
  "R-13": {
    code: "R-13",
    title: "Atendimento dos Pedidos",
    ...REPORT_FILTER_CONTRACTS["R-13"],
    screenPath: "/relatorios/comercial/atendimento",
    primaryColumns: [
      "Pedido",
      "Cliente",
      "Produto",
      "Nome do produto",
      "Qtd. pedida",
      "Expedido",
      "Faturado",
      "Falta expedir",
      "Unidade",
    ],
    filterValues: { status: CUSTOMER_ORDER_STATUS_LABELS },
  },
  "R-15": {
    code: "R-15",
    title: "Faturamento por período",
    ...REPORT_FILTER_CONTRACTS["R-15"],
    screenPath: "/relatorios/faturamento/periodo",
  },
  "R-16": {
    code: "R-16",
    title: "Aguardando faturamento",
    ...REPORT_FILTER_CONTRACTS["R-16"],
    screenPath: "/relatorios/faturamento/pendentes",
  },
  "R-17": {
    code: "R-17",
    title: "Pedido x Entregue x Faturado",
    ...REPORT_FILTER_CONTRACTS["R-17"],
    screenPath: "/relatorios/faturamento/pedido-entregue-faturado",
    primaryColumns: [
      "Pedido",
      "Cliente",
      "Produto",
      "Nome do produto",
      "Qtd. pedida",
      "Expedido",
      "Faturado",
      "Expedido sem faturar",
      "Falta entregar",
      "Unidade",
    ],
    filterValues: { status: CUSTOMER_ORDER_STATUS_LABELS },
  },
  "R-18": {
    code: "R-18",
    title: "Custo industrial por produto",
    ...REPORT_FILTER_CONTRACTS["R-18"],
    screenPath: "/relatorios/custos/industrial-por-produto",
    // Custo industrial por produto: documento interno, como o R-20.
    internal: true,
    primaryColumns: [
      "Produto",
      "Nome",
      "Cliente",
      "Qualidade",
      "Custo industrial total",
      "Custo/unidade",
      "Custo/1.000",
    ],
    filterValues: { active: SIM_OU_NAO },
  },
  "R-19": {
    code: "R-19",
    title: "Precificação por produto",
    ...REPORT_FILTER_CONTRACTS["R-19"],
    screenPath: "/relatorios/custos/precificacao-por-produto",
    // Preço, margem e contribuição: documento interno, como o R-20.
    internal: true,
    roles: PRICING_PROVENANCE_ROLES,
    primaryColumns: [
      "Produto",
      "Nome",
      "Cliente",
      "Quantidade",
      "Unidade",
      // Os dois custos com nome próprio, e a qualidade do que formou a margem;
      // o Modelo de Precificação desce para o detalhe, rotulado.
      "Custo do cálculo/un",
      "Custo p/ preço/un",
      "Preço",
      "Margem de contribuição (%)",
      "Contribuição/unidade",
      "Qualidade do custo p/ preço",
    ],
  },
  "R-20": {
    code: "R-20",
    title: "Orçamento × Precificação",
    ...REPORT_FILTER_CONTRACTS["R-20"],
    screenPath: "/relatorios/comercial/orcamento-precificacao",
    // Contém custo e margem: nunca é o documento entregue ao cliente.
    internal: true,
    roles: PRICING_PROVENANCE_ROLES,
    primaryColumns: [
      "Orçamento",
      "Projeto",
      "Cliente",
      "Produto",
      "Status",
      "Quantidade",
      "Unidade",
      "Preço unitário",
      "Total",
      "Origem do preço",
    ],
    filterValues: { status: QUOTE_STATUS_LABELS, priceSource: QUOTE_PRICE_SOURCE_LABELS },
  },
  "R-21": {
    code: "R-21",
    title: "Uso e consumo",
    ...REPORT_FILTER_CONTRACTS["R-21"],
    screenPath: "/relatorios/estoque/uso-e-consumo",
    // Lote e observação descem para o detalhe: uso e consumo quase nunca
    // controla lote, e a observação é texto livre.
    primaryColumns: [
      "Data",
      "Consumo",
      "Item",
      "Descrição",
      "Quantidade",
      "Unidade",
      "Destino/uso",
      "Custo unitário",
      "Custo total",
      "Origem do custo",
      "Usuário",
    ],
    filterValues: { costSource: COST_SOURCE_LABELS, hasCost: INTERNAL_CONSUMPTION_COST_FILTER_LABELS },
  },
};

/** Rótulos legíveis dos filtros — o papel precisa dizer o que está mostrando. */
const FILTER_LABELS: Record<string, string> = {
  search: "Busca",
  from: "De",
  to: "Até",
  itemId: "Item",
  itemType: "Tipo de item",
  lotId: "Lote",
  status: "Status",
  supplierId: "Fornecedor",
  customerId: "Cliente",
  productId: "Produto",
  productionOrderId: "Ordem de produção",
  customerOrderId: "Pedido",
  purchaseOrderId: "Ordem de compra",
  ownerType: "Proprietário",
  ownerCustomerId: "Cliente proprietário",
  location: "Localização",
  type: "Tipo",
  sourceType: "Origem",
  onlyWithBalance: "Somente com saldo",
  daysAhead: "Dias à frente",
  window: "Janela de vencimento",
  onlyShortage: "Somente com falta",
  includeCost: "Incluir custo",
  active: "Produto ativo",
  origin: "Origem",
  priceSource: "Origem do preço",
  purpose: "Destino/uso",
  registeredByUserId: "Usuário",
  costSource: "Origem do custo",
  hasCost: "Custo",
};

/**
 * Todo filtro por id técnico que os schemas dos relatórios aceitam, com a
 * fonte do seletor que o nomeia.
 *
 * Nenhum id vai ao papel como veio. Cliente e fornecedor têm seletor na tela;
 * item, produto, pedido, OP e OC só chegam por URL digitada, mas a aplicação
 * já tem o `porId` do seletor de cada um — o papel escreve `código · nome`
 * pela mesma consulta. Lote não tem seletor nem `porId`: não se inventa
 * consulta para ele, e o valor sai vazio, como o id que não se achou
 * (REPORTS-PRESENTATION-WAVE-02).
 */
const FILTROS_POR_ID: Readonly<Record<string, EntityFilterSource | null>> = {
  customerId: clienteFilterSource,
  ownerCustomerId: clienteFilterSource,
  supplierId: fornecedorFilterSource,
  itemId: itemFilterSource,
  productId: produtoFilterSource,
  customerOrderId: pedidoFilterSource,
  productionOrderId: ordemDeProducaoFilterSource,
  // O `porId` do Receber OC pergunta pela OC, em qualquer status.
  purchaseOrderId: ordemDeCompraParaReceberSource,
  // Quem registrou o consumo interno (R-21): pelas opções do próprio relatório.
  registeredByUserId: usuarioDoConsumoInternoFilterSource,
  lotId: null,
};

/** Nome de cada filtro por id da URL, pela chave dela, já resolvido pela página. */
export type ReportFilterNames = Readonly<Record<string, string | null | undefined>>;

/** O que da definição decide quais filtros da URL o papel declara e como os escreve. */
export type ReportFilterContract = Pick<ReportPrintDefinition, "filterKeys" | "filterAppliesWhen" | "filterValues">;

/**
 * A chave vale como filtro DESTE relatório: está no contrato dele e, se o
 * serviço só a lê em certa combinação, a combinação está na URL. Paginação
 * nunca está no contrato.
 */
function filtroAceito(contrato: ReportFilterContract, params: URLSearchParams, key: string): boolean {
  if (!contrato.filterKeys.includes(key)) return false;
  const condicao = contrato.filterAppliesWhen && Object.hasOwn(contrato.filterAppliesWhen, key)
    ? contrato.filterAppliesWhen[key]
    : undefined;
  return condicao ? condicao(params) : true;
}

/**
 * Filtros da URL, rotulados, na ordem em que vieram.
 *
 * Só entra a chave que o relatório aceita (`filterKeys`): parâmetro que a API
 * descarta — de outro relatório, digitado à mão (`foo=bar`) — não é recorte, e
 * o papel não o declara (REPORTS-PRINT-UNACCEPTED-FILTER-01).
 *
 * Paginação da tela (`page`, `pageSize`) não é filtro: o documento traz o
 * recorte inteiro, e "pageSize 25" no papel sugeriria um corte que não existe.
 *
 * Filtro por id técnico (`FILTROS_POR_ID`) nunca vai ao papel: sai a entidade
 * como o seletor da tela a escreve, resolvida pela página. Sem nome — id
 * legado, consulta que falhou, lote —, o valor fica vazio e o documento o
 * escreve "—", como todo desconhecido (R20-UX-CLEANUP-WAVE-01,
 * REPORTS-PRESENTATION-WAVE-01 e -02).
 *
 * Filtro de lista fechada sai pelo rótulo da tela (`filterValues`): "SENT" e
 * "RAW_MATERIAL" são a língua da API, não a de quem lê o papel.
 */
export function reportAppliedFilters(
  params: URLSearchParams,
  contract: ReportFilterContract,
  names: ReportFilterNames = {},
): { label: string; value: string }[] {
  const filterValues = contract.filterValues ?? {};
  return [...params.entries()]
    .filter(([key, value]) => value !== "" && filtroAceito(contract, params, key))
    .map(([key, value]) => ({
      label: FILTER_LABELS[key] ?? key,
      value: Object.hasOwn(FILTROS_POR_ID, key) ? (names[key] ?? "") : rotuloDoValor(filterValues[key], value),
    }));
}

/** Só a chave do próprio mapa: `?type=constructor` não vira o `Object` do protótipo. */
function rotuloDoValor(rotulos: Readonly<Record<string, string>> | undefined, value: string): string {
  return rotulos && Object.hasOwn(rotulos, value) ? (rotulos[value] ?? value) : value;
}

/**
 * "CLI-000012 · Razão social" do cliente, "OP-000010 · Produto" da OP — o
 * rótulo do seletor da tela, pela mesma consulta por id. Uma requisição, e
 * só quando há filtro; falhar não impede o documento.
 */
async function entityFilterLabel(source: EntityFilterSource, id: string | null): Promise<string | null> {
  if (!id) return null;
  const entidade = await source.porId(id).catch(() => null);
  return entidade ? [entidade.code, entidade.name].filter(Boolean).join(" · ") : null;
}

/**
 * Os nomes dos filtros por id que a URL traz — em paralelo, uma consulta por
 * filtro presente, nunca uma por linha do relatório. Sem filtro, nenhuma; id
 * que o relatório não aceita também não: ele não vai ao papel.
 */
async function nomesDosFiltrosPorId(
  params: URLSearchParams,
  contract: ReportFilterContract,
): Promise<ReportFilterNames> {
  const nomes = await Promise.all(
    Object.entries(FILTROS_POR_ID).map(async ([chave, fonte]) => {
      const aceito = filtroAceito(contract, params, chave);
      const nome = fonte && aceito ? await entityFilterLabel(fonte, params.get(chave)) : null;
      return [chave, nome] as const;
    }),
  );
  return Object.fromEntries(nomes);
}

/**
 * Por que o CSV não veio. Recusa de validação — período invertido, dia mal
 * formado — chega com a frase do servidor, a mesma que a tela mostra
 * (PERIOD-RANGE-VALIDATION-WAVE-01), e não como "(400)".
 */
async function motivoDaFalha(response: Response): Promise<string> {
  if (response.status === 400) {
    const frase = await parseJsonOrThrow(response).then(
      () => "",
      (err: unknown) => apiErrorMessage(err, ""),
    );
    if (frase) return frase;
  }
  return `Falha ao carregar o relatório (${response.status})`;
}

/** Parser do CSV gerado pela API (`;`, aspas duplas, BOM). */
export function parseReportCsv(content: string): { header: string[]; rows: string[][] } {
  const text = content.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === SEPARATOR) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [header = [], ...body] = rows;
  return {
    header,
    rows: body.filter((cells) => cells.some((value) => value.trim().length > 0)),
  };
}

type ReportPrintData = {
  definition: ReportPrintDefinition;
  header: string[];
  rows: string[][];
  filters: { label: string; value: string }[];
};

export function ReportPrintPage() {
  const { reportCode } = useParams<{ reportCode: string }>();
  const [params] = useSearchParams();
  const user = useOptionalAuth()?.user ?? null;
  // Quem gerou o documento — não substitui quem executou cada ato no sistema.
  const generatedBy = user?.name ?? null;
  const definition = reportCode ? REPORT_PRINT_DEFINITIONS[reportCode.toUpperCase()] : undefined;
  const query = params.toString();

  return (
    <PdfScreen<ReportPrintData>
      // Outro relatório ou outro filtro na mesma rota é outro documento.
      key={`${reportCode ?? ""}?${query}`}
      load={async () => {
        if (!definition) throw new Error(`Relatório desconhecido: ${reportCode ?? ""}`);
        if (definition.roles && !(user && definition.roles.includes(user.role))) {
          throw new Error("Seu perfil não permite ver este relatório.");
        }
        const response = await apiFetch(`${API_URL}${definition.csvPath}${query ? `?${query}` : ""}`);
        if (!response.ok) throw new Error(await motivoDaFalha(response));
        const csv = parseReportCsv(await response.text());
        // Nomes só depois do CSV aceito: perfil recusado não consulta ninguém.
        const nomes = await nomesDosFiltrosPorId(params, definition);
        return {
          definition,
          ...csv,
          filters: reportAppliedFilters(params, definition, nomes),
        };
      }}
      build={async ({ definition: relatorio, header, rows, filters }) => {
        const { ReportPdf, reportPdfFileName } = await import("../../pdf/documents/ReportPdf");
        const generatedAt = new Date();
        return {
          document: (
            <ReportPdf
              report={{
                code: relatorio.code,
                title: relatorio.title,
                internal: relatorio.internal,
                primaryColumns: relatorio.primaryColumns,
                header,
                rows,
                filters,
                generatedBy,
              }}
              generatedAt={generatedAt}
            />
          ),
          fileName: reportPdfFileName(relatorio.code, generatedAt),
        };
      }}
      backTo={definition?.screenPath ?? "/relatorios"}
    />
  );
}
