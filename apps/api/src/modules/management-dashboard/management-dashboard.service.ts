import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  ClienteDoRankingDTO,
  ClienteForaDoRankingDTO,
  CompraEsperadaDTO,
  DocumentoCitadoDTO,
  EntregaDoCompromissoDTO,
  IndicadorMonetarioDTO,
  IntervaloDeDias,
  ManagementDashboardDTO,
  PosicaoMonetariaDTO,
  ProdutoDoRankingDTO,
  ProdutoForaDoRankingDTO,
  QuantidadeNaUnidadeDTO,
  ValorDoRecorteDTO,
} from "@veridi/shared";
import {
  CONFIRMED_ORDER_STATUSES,
  CONTRACTED_PURCHASE_ORDER_STATUSES,
  FUSO_COMERCIAL,
  MANAGEMENT_COMMITMENT_WINDOW_DAYS,
  MANAGEMENT_LIST_LIMIT,
  MANAGEMENT_RANKING_LIMIT,
  PORTFOLIO_ORDER_STATUSES,
  baldesDaTendencia,
  calcularTotaisFaturamento,
  calcularTotaisOrdemCompra,
  diaCivil,
  diaCivilDeslocado,
  granularidadeDaTendencia,
  hojeComercial,
  intervaloDeDiasComerciais,
  resolverPeriodoGerencial,
  saldoDaLinhaProgramada,
  situacaoDaEntrega,
  valorComparavel,
  variacaoPercentual,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { diaDaColunaDeData, intervaloDeDiasCivis, marcadorDoDiaCivil } from "../../lib/business-day.js";
import { STATUS_QUE_RECEBEM } from "../purchase-orders/purchase-order-receivable.js";
import { resumirValorFaturado, valorDoFaturamento } from "../billings/billed-value.js";
import { getShippedByOrderLines } from "../shipments/shipments.service.js";
import type { ManagementDashboardQuery } from "./management-dashboard.schemas.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** Espera por conexão livre para abrir o retrato — a mesma do Painel Operacional. */
const RETRATO_MAX_WAIT_MS = 10_000;
/** Duração máxima do retrato. */
const RETRATO_TIMEOUT_MS = 30_000;

interface Janela {
  gte: Date;
  lt: Date;
}

/** Coluna de INSTANTE (`issuedAt`, `confirmedAt`): os instantes do dia comercial, fim exclusivo. */
function janelaDeInstantes({ from, to }: IntervaloDeDias): Janela {
  const { inicio, fimExclusivo } = intervaloDeDiasComerciais(from, to);
  return { gte: inicio!, lt: fimExclusivo! };
}

/** Coluna de DATA CIVIL (`orderDate` da OC): os marcadores dos dias, fim exclusivo. */
function janelaDeDatasCivis({ from, to }: IntervaloDeDias): Janela {
  const { inicio, fimExclusivo } = intervaloDeDiasCivis(from, to);
  return { gte: inicio!, lt: fimExclusivo! };
}

/**
 * Soma de valores de documentos, na regra de ausência de sempre (§30, D2): o
 * total só existe com TODOS os documentos com valor. Cada valor já está em duas
 * casas — a soma não arredonda nada.
 */
function resumirValores(valores: readonly (string | null)[]): ValorDoRecorteDTO {
  let withValue = 0;
  let soma = new Prisma.Decimal(0);
  for (const valor of valores) {
    if (valor === null) continue;
    withValue += 1;
    soma = soma.plus(valor);
  }
  const count = valores.length;
  return { count, withValue, amount: count > 0 && withValue === count ? soma.toFixed(2) : null };
}

function recorteDoAgregado(count: number, withValue: number, soma: Prisma.Decimal | null): ValorDoRecorteDTO {
  return {
    count,
    withValue,
    amount: count > 0 && withValue === count ? (soma ?? new Prisma.Decimal(0)).toFixed(2) : null,
  };
}

function indicadorMonetario(
  atual: ValorDoRecorteDTO,
  anterior: ValorDoRecorteDTO,
  semValor: DocumentoCitadoDTO[],
): IndicadorMonetarioDTO {
  return {
    current: atual,
    previous: anterior,
    variationPercent: variacaoPercentual(valorComparavel(atual), valorComparavel(anterior)),
    withoutValue: semValor,
  };
}

/** Ordem estável por código — texto ASCII, sem depender do idioma da máquina. */
function porCodigo(a: string | null, b: string | null): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * Faturado — D1: o valor do documento emitido
 * ------------------------------------------------------------------ */

async function recorteFaturado(prisma: PrismaOrTx, janela: Janela): Promise<ValorDoRecorteDTO> {
  const resumo = await resumirValorFaturado(prisma, { issuedAt: janela });
  return {
    count: resumo.billingCount,
    withValue: resumo.billingsWithCompletePricing,
    amount: resumo.totalAmount,
  };
}

interface FaturamentoDoPeriodo {
  id: string;
  code: string;
  issuedAt: Date;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  /** O valor do documento pela regra canônica; `null` = sem valor. */
  valor: string | null;
}

/**
 * Os faturamentos emitidos do período, um valor por documento — a tendência e o
 * ranking de clientes precisam dividir o Faturado, e dividem o MESMO valor que
 * o cartão soma.
 *
 * Só cabeçalhos: o documento com valor congelado não traz linha nenhuma. As
 * linhas vêm apenas dos documentos sem `totalAmount`, que é onde a regra
 * canônica as lê. Um ano de faturamentos são linhas de cabeçalho, não o ano de
 * linhas que o Painel Operacional carregava (G15 do discovery).
 */
async function carregarFaturamentosDoPeriodo(prisma: PrismaOrTx, janela: Janela): Promise<FaturamentoDoPeriodo[]> {
  const emitidos: Prisma.BillingWhereInput = { status: "ISSUED", issuedAt: janela };
  const [documentos, linhasSemTotal] = await Promise.all([
    prisma.billing.findMany({
      where: emitidos,
      select: {
        id: true,
        code: true,
        issuedAt: true,
        totalAmount: true,
        customerCode: true,
        customerName: true,
        customerOrder: { select: { customerId: true, customer: { select: { code: true, legalName: true } } } },
      },
      orderBy: [{ issuedAt: "asc" }, { code: "asc" }],
    }),
    prisma.billingLine.findMany({
      where: { billing: { is: { ...emitidos, totalAmount: null } } },
      select: { billingId: true, quantity: true, unitPrice: true },
    }),
  ]);

  const linhasPorDocumento = new Map<string, { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null }[]>();
  for (const linha of linhasSemTotal) {
    const doDocumento = linhasPorDocumento.get(linha.billingId) ?? [];
    doDocumento.push({ quantity: linha.quantity, unitPrice: linha.unitPrice });
    linhasPorDocumento.set(linha.billingId, doDocumento);
  }

  return documentos.map((documento) => ({
    id: documento.id,
    code: documento.code,
    // O filtro por `issuedAt` garante a data.
    issuedAt: documento.issuedAt!,
    customerId: documento.customerOrder.customerId,
    customerCode: documento.customerCode ?? documento.customerOrder.customer.code,
    customerName: documento.customerName ?? documento.customerOrder.customer.legalName,
    valor: valorDoFaturamento({
      totalAmount: documento.totalAmount,
      lines: linhasPorDocumento.get(documento.id) ?? [],
    }),
  }));
}

/* ------------------------------------------------------------------ *
 * Pedidos confirmados e compras contratadas
 * ------------------------------------------------------------------ */

function pedidosConfirmadosNa(janela: Janela): Prisma.CustomerOrderWhereInput {
  return { status: { in: [...CONFIRMED_ORDER_STATUSES] }, confirmedAt: janela };
}

/**
 * Pedidos confirmados no período pelo total ACORDADO. Pedido digitado direto
 * não tem acordo: conta no número de pedidos e deixa o valor incompleto — o
 * sistema não inventa preço para ele.
 */
async function recortePedidosConfirmados(prisma: PrismaOrTx, janela: Janela): Promise<ValorDoRecorteDTO> {
  const agregado = await prisma.customerOrder.aggregate({
    where: pedidosConfirmadosNa(janela),
    _count: { _all: true, agreedTotalAmount: true },
    _sum: { agreedTotalAmount: true },
  });
  return recorteDoAgregado(agregado._count._all, agregado._count.agreedTotalAmount, agregado._sum.agreedTotalAmount);
}

async function pedidosConfirmadosSemValor(prisma: PrismaOrTx, janela: Janela): Promise<DocumentoCitadoDTO[]> {
  return prisma.customerOrder.findMany({
    where: { ...pedidosConfirmadosNa(janela), agreedTotalAmount: null },
    select: { id: true, code: true },
    orderBy: [{ confirmedAt: "asc" }, { code: "asc" }],
    take: MANAGEMENT_LIST_LIMIT,
  });
}

function comprasContratadasNa(janela: Janela): Prisma.PurchaseOrderWhereInput {
  return { status: { in: [...CONTRACTED_PURCHASE_ORDER_STATUSES] }, orderDate: janela };
}

/** OC com valor: tem linha, e nenhuma linha sem preço — a regra do R-08. */
const OC_COM_PRECO_COMPLETO: Prisma.PurchaseOrderWhereInput = {
  AND: [{ lines: { some: {} } }, { lines: { none: { unitPrice: null } } }],
};

/**
 * Compras contratadas no período pelo total de cada OC (§61, a conta do
 * documento), por `orderDate`. Valor previsto e negociado — nunca pago.
 *
 * As linhas só são lidas quando todas as OCs têm preço: com qualquer uma
 * incompleta o total não existe, e não há o que somar.
 */
async function recorteComprasContratadas(prisma: PrismaOrTx, janela: Janela): Promise<ValorDoRecorteDTO> {
  const onde = comprasContratadasNa(janela);
  const [count, withValue] = await Promise.all([
    prisma.purchaseOrder.count({ where: onde }),
    prisma.purchaseOrder.count({ where: { AND: [onde, OC_COM_PRECO_COMPLETO] } }),
  ]);
  if (count === 0 || withValue !== count) return { count, withValue, amount: null };

  const linhas = await prisma.purchaseOrderLine.findMany({
    where: { purchaseOrder: { is: onde } },
    select: { purchaseOrderId: true, orderedQuantity: true, unitPrice: true },
  });
  const porOrdem = new Map<string, { orderedQuantity: string; unitPrice: string | null }[]>();
  for (const linha of linhas) {
    const daOrdem = porOrdem.get(linha.purchaseOrderId) ?? [];
    daOrdem.push({
      orderedQuantity: linha.orderedQuantity.toString(),
      unitPrice: linha.unitPrice !== null ? linha.unitPrice.toString() : null,
    });
    porOrdem.set(linha.purchaseOrderId, daOrdem);
  }

  let soma = new Prisma.Decimal(0);
  for (const daOrdem of porOrdem.values()) {
    const { orderTotal } = calcularTotaisOrdemCompra(daOrdem);
    // No mesmo retrato não acontece; se acontecer, nunca soma parcial.
    if (orderTotal === null) return { count, withValue, amount: null };
    soma = soma.plus(orderTotal);
  }
  return { count, withValue, amount: soma.toFixed(2) };
}

async function comprasContratadasSemValor(prisma: PrismaOrTx, janela: Janela): Promise<DocumentoCitadoDTO[]> {
  return prisma.purchaseOrder.findMany({
    where: {
      AND: [comprasContratadasNa(janela), { OR: [{ lines: { none: {} } }, { lines: { some: { unitPrice: null } } }] }],
    },
    select: { id: true, code: true },
    orderBy: [{ orderDate: "asc" }, { code: "asc" }],
    take: MANAGEMENT_LIST_LIMIT,
  });
}

/** Clientes distintos com faturamento emitido no período — o cliente do Pedido. */
function clientesFaturadosNa(prisma: PrismaOrTx, janela: Janela): Promise<number> {
  return prisma.customer.count({
    where: { customerOrders: { some: { billings: { some: { status: "ISSUED", issuedAt: janela } } } } },
  });
}

/* ------------------------------------------------------------------ *
 * Posição atual — D5: preço acordado, antes do desconto do Pedido
 * ------------------------------------------------------------------ */

/**
 * A EXPEDIR: o saldo de cada linha dos Pedidos em carteira — pedido menos
 * expedido em Expedições CONFIRMADAS (`getShippedByOrderLines`, a conta do
 * Pedido) — vezes o preço acordado da linha, cada linha fechada em duas casas
 * (`calcularTotaisFaturamento`, §55). Antes do desconto: a apropriação real
 * depende de qual faturamento vier a fechar o Pedido, e antecipá-la seria um
 * número que nenhum documento terá.
 *
 * Conta PEDIDOS com saldo; o Pedido com alguma linha de saldo sem preço
 * acordado fica sem valor, e o total sai incompleto.
 */
async function posicaoAExpedir(prisma: PrismaOrTx): Promise<PosicaoMonetariaDTO> {
  const pedidos = await prisma.customerOrder.findMany({
    where: { status: { in: [...PORTFOLIO_ORDER_STATUSES] } },
    select: {
      id: true,
      code: true,
      lines: { select: { id: true, orderedQuantity: true, agreedUnitPrice: true } },
    },
    orderBy: [{ confirmedAt: "asc" }, { code: "asc" }],
  });
  const expedido = await getShippedByOrderLines(
    prisma,
    pedidos.flatMap((pedido) => pedido.lines.map((linha) => linha.id)),
  );

  const valores: (string | null)[] = [];
  const semValor: DocumentoCitadoDTO[] = [];
  for (const pedido of pedidos) {
    const comSaldo = pedido.lines
      .map((linha) => ({
        saldo: Prisma.Decimal.max(linha.orderedQuantity.minus(expedido.get(linha.id) ?? 0), 0),
        preco: linha.agreedUnitPrice,
      }))
      .filter((linha) => linha.saldo.greaterThan(0));
    if (comSaldo.length === 0) continue;

    const { totalAmount } = calcularTotaisFaturamento(
      comSaldo.map((linha) => ({
        quantity: linha.saldo.toString(),
        unitPrice: linha.preco !== null ? linha.preco.toString() : null,
      })),
    );
    valores.push(totalAmount);
    if (totalAmount === null && semValor.length < MANAGEMENT_LIST_LIMIT) {
      semValor.push({ id: pedido.id, code: pedido.code });
    }
  }
  return { ...resumirValores(valores), withoutValue: semValor };
}

/**
 * A FATURAR: Expedições CONFIRMADAS sem faturamento EMITIDO — o conjunto do
 * contador do Painel Operacional e do R-16. Rascunho de faturamento não fatura:
 * a Expedição com rascunho continua aqui. Valor pelo preço acordado da linha do
 * Pedido, antes do desconto, cada linha em duas casas.
 */
async function posicaoAFaturar(prisma: PrismaOrTx): Promise<PosicaoMonetariaDTO> {
  const expedicoes = await prisma.shipment.findMany({
    where: { status: "CONFIRMED", billings: { none: { status: "ISSUED" } } },
    select: {
      id: true,
      code: true,
      lines: { select: { quantity: true, customerOrderLine: { select: { agreedUnitPrice: true } } } },
    },
    orderBy: [{ confirmedAt: "asc" }, { code: "asc" }],
  });

  const valores: (string | null)[] = [];
  const semValor: DocumentoCitadoDTO[] = [];
  for (const expedicao of expedicoes) {
    const { totalAmount } = calcularTotaisFaturamento(
      expedicao.lines.map((linha) => ({
        quantity: linha.quantity.toString(),
        unitPrice:
          linha.customerOrderLine.agreedUnitPrice !== null ? linha.customerOrderLine.agreedUnitPrice.toString() : null,
      })),
    );
    valores.push(totalAmount);
    if (totalAmount === null && semValor.length < MANAGEMENT_LIST_LIMIT) {
      semValor.push({ id: expedicao.id, code: expedicao.code });
    }
  }
  return { ...resumirValores(valores), withoutValue: semValor };
}

/* ------------------------------------------------------------------ *
 * Tendência e rankings — sempre sobre o período atual
 * ------------------------------------------------------------------ */

/**
 * Faturado por barra: cada documento cai na barra do DIA COMERCIAL da emissão
 * (23:30 de São Paulo é o próprio dia, não o seguinte). A barra só tem valor
 * com todos os documentos dela com valor.
 */
function tendenciaDoFaturado(
  faturamentos: readonly FaturamentoDoPeriodo[],
  periodo: IntervaloDeDias,
): ManagementDashboardDTO["trend"] {
  const baldes = baldesDaTendencia(periodo);
  const valoresPorBalde = baldes.map(() => [] as (string | null)[]);
  for (const faturamento of faturamentos) {
    const dia = diaCivil(faturamento.issuedAt, FUSO_COMERCIAL);
    const indice = baldes.findIndex((balde) => balde.from <= dia && dia <= balde.to);
    if (indice >= 0) valoresPorBalde[indice]!.push(faturamento.valor);
  }
  return {
    granularity: granularidadeDaTendencia(periodo),
    buckets: baldes.map((balde, indice) => ({ ...balde, ...resumirValores(valoresPorBalde[indice] ?? []) })),
  };
}

/**
 * Clientes por Faturado no período. O cliente é o do Pedido do faturamento, e
 * cliente com vários projetos é uma linha só; o nome é o do documento mais
 * recente.
 *
 * Cliente com QUALQUER documento sem valor sai do ranking inteiro e é nomeado
 * — mostrar a soma só dos documentos com valor seria um total dele menor do
 * que é (D2).
 */
function rankingDeClientes(faturamentos: readonly FaturamentoDoPeriodo[]): ManagementDashboardDTO["rankings"]["customers"] {
  const porCliente = new Map<string, { code: string | null; name: string | null; valores: (string | null)[] }>();
  for (const faturamento of faturamentos) {
    const cliente = porCliente.get(faturamento.customerId) ?? { code: null, name: null, valores: [] };
    // `faturamentos` vem da emissão mais antiga para a mais recente.
    cliente.code = faturamento.customerCode ?? cliente.code;
    cliente.name = faturamento.customerName ?? cliente.name;
    cliente.valores.push(faturamento.valor);
    porCliente.set(faturamento.customerId, cliente);
  }

  const completos: ClienteDoRankingDTO[] = [];
  const fora: ClienteForaDoRankingDTO[] = [];
  for (const [customerId, cliente] of porCliente) {
    const resumo = resumirValores(cliente.valores);
    if (resumo.amount === null) {
      fora.push({
        customerId,
        code: cliente.code,
        name: cliente.name,
        billingCount: resumo.count,
        withoutValue: resumo.count - resumo.withValue,
      });
    } else {
      completos.push({ customerId, code: cliente.code, name: cliente.name, amount: resumo.amount, billingCount: resumo.count });
    }
  }

  completos.sort((a, b) => new Prisma.Decimal(b.amount).comparedTo(a.amount) || porCodigo(a.code, b.code));
  fora.sort((a, b) => b.withoutValue - a.withoutValue || porCodigo(a.code, b.code));
  return {
    rows: completos.slice(0, MANAGEMENT_RANKING_LIMIT),
    excluded: fora.slice(0, MANAGEMENT_LIST_LIMIT),
    excludedTotal: fora.length,
  };
}

/**
 * Produtos pelo valor das LINHAS faturadas no período — cada linha em duas
 * casas pela conta do documento (`calcularTotaisFaturamento`), ANTES do
 * desconto do cabeçalho, que não é rateado. Por isso a soma do ranking não bate
 * com o Faturado, e a tela diz isso.
 *
 * Quantidade só dentro do produto e da unidade da linha: um produto faturado em
 * kg e em un tem duas quantidades, nunca uma soma. Produto com linha sem preço
 * sai do ranking e é nomeado.
 */
async function rankingDeProdutos(
  prisma: PrismaOrTx,
  janela: Janela,
): Promise<ManagementDashboardDTO["rankings"]["products"]> {
  const linhas = await prisma.billingLine.findMany({
    where: { billing: { is: { status: "ISSUED", issuedAt: janela } } },
    select: {
      productId: true,
      productCode: true,
      productName: true,
      quantity: true,
      unitCode: true,
      unitPrice: true,
      product: { select: { customerId: true } },
    },
    orderBy: [{ billing: { issuedAt: "asc" } }, { position: "asc" }],
  });

  const porProduto = new Map<
    string,
    {
      code: string;
      name: string;
      customerId: string | null;
      linhas: { quantity: string; unitPrice: string | null }[];
      porUnidade: Map<string, Prisma.Decimal>;
    }
  >();
  for (const linha of linhas) {
    const produto = porProduto.get(linha.productId) ?? {
      code: linha.productCode,
      name: linha.productName,
      customerId: linha.product.customerId,
      linhas: [],
      porUnidade: new Map<string, Prisma.Decimal>(),
    };
    // A linha mais recente dá o nome: `linhas` vem da emissão mais antiga para a mais recente.
    produto.code = linha.productCode;
    produto.name = linha.productName;
    produto.linhas.push({
      quantity: linha.quantity.toString(),
      unitPrice: linha.unitPrice !== null ? linha.unitPrice.toString() : null,
    });
    produto.porUnidade.set(
      linha.unitCode,
      (produto.porUnidade.get(linha.unitCode) ?? new Prisma.Decimal(0)).plus(linha.quantity),
    );
    porProduto.set(linha.productId, produto);
  }

  const completos: ProdutoDoRankingDTO[] = [];
  const fora: ProdutoForaDoRankingDTO[] = [];
  for (const [productId, produto] of porProduto) {
    const { totalAmount } = calcularTotaisFaturamento(produto.linhas);
    if (totalAmount === null) {
      fora.push({
        productId,
        code: produto.code,
        name: produto.name,
        customerId: produto.customerId,
        linesWithoutPrice: produto.linhas.filter((linha) => linha.unitPrice === null).length,
      });
      continue;
    }
    const quantities: QuantidadeNaUnidadeDTO[] = [...produto.porUnidade.entries()]
      .sort(([a], [b]) => porCodigo(a, b))
      .map(([unitCode, quantidade]) => ({ unitCode, quantity: quantidade.toFixed() }));
    completos.push({
      productId,
      code: produto.code,
      name: produto.name,
      customerId: produto.customerId,
      amount: totalAmount,
      quantities,
    });
  }

  completos.sort((a, b) => new Prisma.Decimal(b.amount).comparedTo(a.amount) || porCodigo(a.code, b.code));
  fora.sort((a, b) => b.linesWithoutPrice - a.linesWithoutPrice || porCodigo(a.code, b.code));
  return {
    rows: completos.slice(0, MANAGEMENT_RANKING_LIMIT),
    excluded: fora.slice(0, MANAGEMENT_LIST_LIMIT),
    excludedTotal: fora.length,
  };
}

/* ------------------------------------------------------------------ *
 * Próximos compromissos — só o que está registrado
 * ------------------------------------------------------------------ */

/**
 * Entregas programadas e atrasadas dos Pedidos em carteira, e compras
 * esperadas, na janela de hoje e dos 29 dias seguintes.
 *
 * A situação da entrega é a do Pedido (`situacaoDaEntrega`, `saldoDaLinhaProgramada`):
 * atendido é o que Expedições CONFIRMADAS entregaram, e atrasada é o dia
 * prometido ter passado com saldo. Entrega sem saldo não é compromisso. O valor
 * das programadas é o saldo pelo preço acordado, antes do desconto (D5).
 *
 * Compra esperada é OC aberta com saldo e previsão dentro da janela — em
 * contagem e lista, sem valor previsto: saldo de OC recebida em parte não se
 * encerra (G5), e o "a receber" do fornecedor ficou fora da versão 1.
 */
async function proximosCompromissos(prisma: PrismaOrTx, hoje: string): Promise<ManagementDashboardDTO["commitments"]> {
  const fimDaJanela = diaCivilDeslocado(hoje, MANAGEMENT_COMMITMENT_WINDOW_DAYS - 1);
  const depoisDaJanela = marcadorDoDiaCivil(diaCivilDeslocado(fimDaJanela, 1));

  const [entregas, compras] = await Promise.all([
    prisma.customerOrderDelivery.findMany({
      where: {
        cancelledAt: null,
        scheduledDate: { lt: depoisDaJanela },
        customerOrder: { status: { in: [...PORTFOLIO_ORDER_STATUSES] } },
      },
      select: {
        id: true,
        sequence: true,
        scheduledDate: true,
        customerOrder: { select: { id: true, code: true, customerName: true, customer: { select: { legalName: true } } } },
        lines: {
          select: {
            quantity: true,
            customerOrderLine: { select: { agreedUnitPrice: true } },
            shipmentLines: { select: { quantity: true, shipment: { select: { status: true } } } },
          },
        },
      },
      orderBy: [{ scheduledDate: "asc" }, { sequence: "asc" }],
    }),
    prisma.purchaseOrder.findMany({
      where: {
        status: { in: [...STATUS_QUE_RECEBEM] },
        expectedDeliveryDate: { gte: marcadorDoDiaCivil(hoje), lt: depoisDaJanela },
      },
      select: {
        id: true,
        code: true,
        supplierName: true,
        expectedDeliveryDate: true,
        lines: { select: { orderedQuantity: true, receiptLines: { select: { receivedQuantity: true } } } },
      },
      orderBy: [{ expectedDeliveryDate: "asc" }, { code: "asc" }],
    }),
  ]);

  const programadas: EntregaDoCompromissoDTO[] = [];
  const valoresProgramadas: (string | null)[] = [];
  const atrasadas: EntregaDoCompromissoDTO[] = [];
  for (const entrega of entregas) {
    const linhas = entrega.lines.map((linha) => {
      const atendido = linha.shipmentLines.reduce(
        (soma, expedida) => (expedida.shipment.status === "CONFIRMED" ? soma.plus(expedida.quantity) : soma),
        new Prisma.Decimal(0),
      );
      return {
        prometido: linha.quantity,
        atendido,
        saldo: saldoDaLinhaProgramada(linha.quantity, atendido),
        preco: linha.customerOrderLine.agreedUnitPrice,
      };
    });
    const pendentes = linhas.filter((linha) => linha.saldo.greaterThan(0));
    if (pendentes.length === 0) continue;

    const dia = diaDaColunaDeData(entrega.scheduledDate);
    const item: EntregaDoCompromissoDTO = {
      deliveryId: entrega.id,
      customerOrderId: entrega.customerOrder.id,
      customerOrderCode: entrega.customerOrder.code,
      sequence: entrega.sequence,
      scheduledDate: dia,
      customerName: entrega.customerOrder.customerName ?? entrega.customerOrder.customer.legalName,
    };
    const situacao = situacaoDaEntrega({
      cancelada: false,
      scheduledDateISO: dia,
      hojeISO: hoje,
      linhas: linhas.map(({ prometido, atendido }) => ({ prometido, atendido })),
    });
    if (situacao === "LATE") {
      atrasadas.push(item);
      continue;
    }
    if (dia < hoje) continue;
    programadas.push(item);
    valoresProgramadas.push(
      calcularTotaisFaturamento(
        pendentes.map((linha) => ({
          quantity: linha.saldo.toString(),
          unitPrice: linha.preco !== null ? linha.preco.toString() : null,
        })),
      ).totalAmount,
    );
  }

  const esperadas: CompraEsperadaDTO[] = compras
    .filter((compra) =>
      compra.lines.some((linha) =>
        linha.orderedQuantity
          .minus(linha.receiptLines.reduce((soma, recebida) => soma.plus(recebida.receivedQuantity), new Prisma.Decimal(0)))
          .greaterThan(0),
      ),
    )
    .map((compra) => ({
      purchaseOrderId: compra.id,
      code: compra.code,
      supplierName: compra.supplierName,
      expectedDeliveryDate: diaDaColunaDeData(compra.expectedDeliveryDate!),
    }));

  return {
    window: { from: hoje, to: fimDaJanela },
    scheduledDeliveries: { ...resumirValores(valoresProgramadas), items: programadas.slice(0, MANAGEMENT_LIST_LIMIT) },
    lateDeliveries: { count: atrasadas.length, items: atrasadas.slice(0, MANAGEMENT_LIST_LIMIT) },
    expectedPurchases: { count: esperadas.length, items: esperadas.slice(0, MANAGEMENT_LIST_LIMIT) },
  };
}

/* ------------------------------------------------------------------ *
 * O read model
 * ------------------------------------------------------------------ */

/**
 * O Painel Gerencial num contexto de banco dado — a transação do retrato em
 * `getManagementDashboard`, ou a do teste.
 *
 * `now` é o instante único da requisição: o período dos atalhos, a carteira e a
 * janela dos compromissos saem do mesmo dia comercial. Nada é persistido, nada
 * fica em cache: tudo sai dos documentos.
 */
export async function montarPainelGerencial(
  prisma: PrismaOrTx,
  query: ManagementDashboardQuery,
  now: Date,
): Promise<ManagementDashboardDTO> {
  const hoje = hojeComercial(now);
  const periodo = resolverPeriodoGerencial(query.period, query.dateFrom, query.dateTo, now);
  const atual = janelaDeInstantes(periodo.current);
  const anterior = janelaDeInstantes(periodo.previous);
  const atualCivil = janelaDeDatasCivis(periodo.current);
  const anteriorCivil = janelaDeDatasCivis(periodo.previous);

  const [
    faturadoAtual,
    faturadoAnterior,
    faturamentos,
    pedidosAtual,
    pedidosAnterior,
    pedidosSemValor,
    comprasAtual,
    comprasAnterior,
    comprasSemValor,
    clientesAtual,
    clientesAnterior,
    aExpedir,
    aFaturar,
    produtos,
    compromissos,
  ] = await Promise.all([
    recorteFaturado(prisma, atual),
    recorteFaturado(prisma, anterior),
    carregarFaturamentosDoPeriodo(prisma, atual),
    recortePedidosConfirmados(prisma, atual),
    recortePedidosConfirmados(prisma, anterior),
    pedidosConfirmadosSemValor(prisma, atual),
    recorteComprasContratadas(prisma, atualCivil),
    recorteComprasContratadas(prisma, anteriorCivil),
    comprasContratadasSemValor(prisma, atualCivil),
    clientesFaturadosNa(prisma, atual),
    clientesFaturadosNa(prisma, anterior),
    posicaoAExpedir(prisma),
    posicaoAFaturar(prisma),
    rankingDeProdutos(prisma, atual),
    proximosCompromissos(prisma, hoje),
  ]);

  const faturadoSemValor = faturamentos
    .filter((faturamento) => faturamento.valor === null)
    .slice(0, MANAGEMENT_LIST_LIMIT)
    .map(({ id, code }) => ({ id, code }));

  return {
    generatedAt: now.toISOString(),
    today: hoje,
    period: { preset: query.period, current: periodo.current, previous: periodo.previous },
    result: {
      billed: indicadorMonetario(faturadoAtual, faturadoAnterior, faturadoSemValor),
      confirmedOrders: indicadorMonetario(pedidosAtual, pedidosAnterior, pedidosSemValor),
      contractedPurchases: indicadorMonetario(comprasAtual, comprasAnterior, comprasSemValor),
      billedCustomers: {
        current: clientesAtual,
        previous: clientesAnterior,
        variationPercent: variacaoPercentual(String(clientesAtual), String(clientesAnterior)),
      },
    },
    position: { toShip: aExpedir, toBill: aFaturar },
    trend: tendenciaDoFaturado(faturamentos, periodo.current),
    rankings: { customers: rankingDeClientes(faturamentos), products: produtos },
    commitments: compromissos,
  };
}

/**
 * Read model do Painel Gerencial — um retrato do banco por requisição.
 *
 * Tudo numa transação `RepeatableRead` (o padrão de
 * DASHBOARD-SNAPSHOT-CONSISTENCY-01): o cartão do Faturado, a tendência e o
 * ranking de clientes dividem os mesmos documentos, e a carteira não mistura
 * uma expedição confirmada no meio da montagem. Só leitura — nenhuma trava além
 * da de qualquer SELECT. Sem tabela agregada, sem cache, sem job.
 */
export async function getManagementDashboard(
  query: ManagementDashboardQuery,
  now: Date,
): Promise<ManagementDashboardDTO> {
  return getPrisma().$transaction((prisma) => montarPainelGerencial(prisma, query, now), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: RETRATO_MAX_WAIT_MS,
    timeout: RETRATO_TIMEOUT_MS,
  });
}
