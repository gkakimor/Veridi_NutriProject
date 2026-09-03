import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import type {
  CustomerDTO,
  CustomerOrderDTO,
  CustomerOrderStatus,
  FulfillmentPlanDTO,
  ProductDTO,
  PlanPurchaseSourcingDTO,
  PurchaseSuggestionDTO,
  ReservationStatusDTO,
  ShipmentStatus,
  SupplierDTO,
} from "@veridi/shared";
import {
  BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
} from "@veridi/shared";
import { formatBRL } from "../../lib/currency";
import {
  applyFulfillmentPlan,
  cancelCustomerOrder,
  confirmCustomerOrder,
  createCustomerOrder,
  createRemainderProductionOrder,
  generatePurchaseDrafts,
  getCustomerOrder,
  getFulfillmentPlan,
  getPlanPurchaseSourcing,
  getPurchaseSuggestion,
  updateCustomerOrder,
} from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { getProduct, listProducts } from "../../lib/products-api";
import { listSuppliers } from "../../lib/suppliers-api";
import {
  createShipmentDraft,
  getReservationStatus,
  reallocateReservationLine,
  reserveAvailable,
} from "../../lib/shipments-api";
import { ApiValidationError, apiErrorMessage } from "../../lib/api-errors";
import { mensagemDecimalInvalido, parseDecimalInput } from "../../lib/decimal-input";
import { exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
import { FormSection } from "../../components/FormSection";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { AgreedPriceCell, CommercialOriginSection } from "./CommercialOriginSection";
import { FlowContext } from "../../components/FlowContext";
import type { FlowStep } from "../../components/FlowContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";
import { ModalDialog } from "../../components/ModalDialog";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";

/**
 * Ícone de ajuda de uma coluna do Plano, lido do registro central.
 *
 * Existe para que o cabeçalho da tabela não carregue o texto: a explicação
 * de "Disponível" é a mesma em qualquer tela, e quem a revisa mexe em
 * `help-content`, não aqui.
 */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

interface LineRow {
  key: string;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  orderedQuantity: string;
}

function statusBadgeClass(status: CustomerOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "CONFIRMED":
      return "badge badge--active";
    case "IN_FULFILLMENT":
    case "PARTIALLY_SHIPPED":
      return "badge badge--warn";
    case "SHIPPED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function toIsoOrEmpty(dateInputValue: string): string {
  if (!dateInputValue) return "";
  return new Date(dateInputValue).toISOString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

let rowKeySeq = 0;
function nextRowKey(): string {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

/**
 * O contador reinicia junto com o módulo, e o rascunho atravessa um F5 na
 * tela de cadastro: sem empurrá-lo para além das chaves restauradas,
 * "Adicionar produto" devolveria uma chave que uma linha já usa — e duas
 * linhas passariam a mudar juntas.
 */
function absorverChaves(linhas: LineRow[]) {
  for (const linha of linhas) {
    const numero = Number(linha.key.split("-")[1]);
    if (Number.isFinite(numero) && numero > rowKeySeq) rowKeySeq = numero;
  }
}

/**
 * O que o Pedido leva junto ao sair para cadastrar cliente ou produto.
 *
 * São QUATRO campos, não os trinta `useState` da tela. Tudo o mais é
 * derivado do servidor e volta de lá na remontagem — o pedido carregado, os
 * catálogos, o plano de atendimento com seus ajustes, o sourcing, a
 * sugestão de compra, o status de reserva — ou é estado de diálogo, que não
 * é rascunho de coisa nenhuma.
 */
type RascunhoPedido = {
  customerId: string;
  requestedDeliveryDate: string;
  notes: string;
  lines: LineRow[];
};

/**
 * A linha que pediu o cadastro.
 *
 * O contexto atravessa `sessionStorage` e o token viaja na URL: é dado
 * desconhecido. Sem chave legítima o produto novo não entra em linha
 * nenhuma — melhor que entrar na primeira, que é a errada.
 */
function lerChaveDaLinha(contexto: Record<string, unknown> | null | undefined): string | null {
  const chave = contexto?.["rowKey"];
  return typeof chave === "string" && chave.length > 0 ? chave : null;
}

function lineFromDTO(line: CustomerOrderDTO["lines"][number]): LineRow {
  return {
    key: nextRowKey(),
    productId: line.productId,
    productCode: line.productCode,
    productName: line.productName,
    unitCode: line.unitCode,
    orderedQuantity: line.orderedQuantity,
  };
}

/**
 * Um valor digitado que ainda vale a pena enviar.
 *
 * Branco e zero não valem. **Ilegível vale**: o botão precisa continuar
 * clicável para que a mensagem que cita o separador chegue à pessoa.
 * Enquanto isto era `Number(texto) > 0`, `2,5` virava `NaN`, `NaN > 0` era
 * falso na hora de montar o payload e verdadeiro na hora de habilitar o
 * botão — clicar em "Reservar disponível" não fazia nada, em silêncio.
 */
function temValorParaEnviar(texto: string | undefined): boolean {
  const limpo = (texto ?? "").trim();
  if (limpo === "") return false;
  const valor = parseDecimalInput(limpo);
  return valor === null || Number(valor) > 0;
}

/**
 * O complemento de uma linha do Plano: o que não é reservado é produzido.
 *
 * Campo em branco continua valendo zero — o complemento vira o pedido
 * inteiro, como sempre foi. O que muda é `2,5`: era `NaN` e apagava o outro
 * campo sem explicar; agora é dois e meio.
 */
function complementoDaLinha(pedido: string, digitado: string): string {
  const valor = digitado.trim() === "" ? "0" : parseDecimalInput(digitado);
  if (valor === null) return "";
  return Math.max(Number(pedido) - Number(valor), 0).toString();
}

function situationLabel(situation: string): string {
  switch (situation) {
    case "ESTOQUE_SUFICIENTE":
      return "Estoque suficiente";
    case "REQUER_PRODUCAO":
      return "Requer produção";
    case "SEM_FORMULACAO_ATIVA":
      return "Sem formulação ativa";
    default:
      return situation;
  }
}

/**
 * Cadeia operacional do pedido. Só aparecem documentos que existem: sem
 * expedição, o pedido não mostra "expedição pendente" como se fosse um
 * documento — a pendência é assunto do status, não do fluxo.
 */
function orderFlowSteps(order: CustomerOrderDTO): FlowStep[] {
  const steps: FlowStep[] = [
    { kind: "Pedido", code: order.code, detail: order.customerName, current: true },
  ];

  for (const productionOrder of order.generatedProductionOrders) {
    steps.push({
      kind: "OP",
      code: productionOrder.code,
      path: `/producao/ordens/${productionOrder.id}`,
    });
  }
  for (const shipment of order.shipments) {
    steps.push({
      kind: "Expedição",
      code: shipment.code,
      path: `/comercial/expedicoes/${shipment.id}`,
    });
  }
  for (const billing of order.billings) {
    steps.push({
      kind: "Faturamento",
      code: billing.code,
      path: `/comercial/faturamento/${billing.id}`,
    });
  }

  return steps;
}

/**
 * Documento transacional — página própria dentro do workspace, não
 * FullWorkspaceModal. Atende `/comercial/pedidos/novo` (sem :id) e
 * `/comercial/pedidos/:id`.
 */
export function CustomerOrderPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  const [customerOrder, setCustomerOrder] = useState<CustomerOrderDTO | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);

  const [customerId, setCustomerId] = useState("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([]);

  const [activeCustomers, setActiveCustomers] = useState<CustomerDTO[]>([]);
  const [activeProducts, setActiveProducts] = useState<ProductDTO[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [plan, setPlan] = useState<FulfillmentPlanDTO | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planAdjustments, setPlanAdjustments] = useState<Record<string, { reserve: string; produce: string }>>({});
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  // Sourcing na fase de Plano — o Pedido ainda nao tem OP, mas ja sabe a falta.
  const [sourcing, setSourcing] = useState<PlanPurchaseSourcingDTO | null>(null);
  const [sourcingLoading, setSourcingLoading] = useState(false);

  const [suggestion, setSuggestion] = useState<PurchaseSuggestionDTO | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [activeSuppliers, setActiveSuppliers] = useState<SupplierDTO[]>([]);
  const [draftInputs, setDraftInputs] = useState<Record<string, { quantity: string; supplierId: string }>>({});
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [reservationStatus, setReservationStatus] = useState<ReservationStatusDTO | null>(null);
  const [reserveInputs, setReserveInputs] = useState<Record<string, string>>({});
  const [reserving, setReserving] = useState(false);
  const [reallocatingLineId, setReallocatingLineId] = useState<string | null>(null);
  const [preparingShipment, setPreparingShipment] = useState(false);

  const syncFormFromServer = useCallback((order: CustomerOrderDTO) => {
    setCustomerId(order.customerId);
    setRequestedDeliveryDate(toDateInputValue(order.requestedDeliveryDate));
    setNotes(order.notes ?? "");
    setLines(order.lines.map(lineFromDTO));
  }, []);

  /**
   * O rascunho restaurado ganha do servidor — uma vez.
   *
   * Quem volta do cadastro chega junto com a carga do pedido, e ela traz o
   * documento como está salvo. Sem esta trava a resposta chegaria depois e
   * apagaria as linhas recém-digitadas. Vale só para a primeira carga:
   * depois de salvar, confirmar ou cancelar, o servidor é a verdade.
   */
  const rascunhoRestaurado = useRef(false);

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    setNotFound(false);
    getCustomerOrder(id)
      .then((order) => {
        setCustomerOrder(order);
        if (rascunhoRestaurado.current) {
          rascunhoRestaurado.current = false;
          return;
        }
        syncFormFromServer(order);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, isNew, syncFormFromServer]);

  useEffect(() => {
    listCustomers({ active: true, pageSize: 50 })
      .then((result) => setActiveCustomers(result.customers))
      .catch(() => setActiveCustomers([]));
    // Produto técnico de projeto não é opção operacional.
    listProducts({ active: true, lifecycle: "APPROVED", pageSize: 50 })
      .then((result) => setActiveProducts(result.products))
      .catch(() => setActiveProducts([]));
  }, []);

  /*
   * Busca no SERVIDOR, com os MESMOS filtros da carga inicial: achar nao e o
   * mesmo que poder usar, e a busca torna encontravel quem ja era elegivel,
   * nunca quem nao era. O achado entra no estado de onde as opcoes derivam,
   * porque a escolha e resolvida por ele. A carga inicial passou a servir so
   * a abertura do campo — acima do teto o registro existia e nao aparecia,
   * com "+ Novo" logo acima convidando a duplicar.
   */
  async function buscarClientes(termo: string): Promise<EntityOption[]> {
    const resultado = await listCustomers({ active: true, search: termo, pageSize: 50 });
    const novos = resultado.customers;
    setActiveCustomers((atual) => {
      const conhecidos = new Set(atual.map((x) => x.id));
      return [...atual, ...novos.filter((x) => !conhecidos.has(x.id))];
    });
    return novos.map((c) => ({ id: c.id, code: c.code, name: c.tradeName ?? c.legalName }));
  }
  /*
   * Busca no SERVIDOR, com os MESMOS filtros da carga inicial: achar nao e o
   * mesmo que poder usar, e a busca torna encontravel quem ja era elegivel,
   * nunca quem nao era. O achado entra no estado de onde as opcoes derivam,
   * porque a escolha e resolvida por ele. A carga inicial passou a servir so
   * a abertura do campo — acima do teto o registro existia e nao aparecia,
   * com "+ Novo" logo acima convidando a duplicar.
   */
  async function buscarProdutos(termo: string): Promise<EntityOption[]> {
    const resultado = await listProducts({ active: true, lifecycle: "APPROVED", search: termo, pageSize: 50 });
    const novos = resultado.products;
    setActiveProducts((atual) => {
      const conhecidos = new Set(atual.map((x) => x.id));
      return [...atual, ...novos.filter((x) => !conhecidos.has(x.id))];
    });
    return novos.map((p) => ({ id: p.id, code: p.code, name: p.name }));
  }

  const status: CustomerOrderStatus = customerOrder?.status ?? "DRAFT";
  const isDraft = isNew || status === "DRAFT";
  /*
   * A coluna de preço só aparece quando há acordo a mostrar. Pedido digitado
   * direto não tem preço de origem, e uma coluna inteira de "—" só ocuparia
   * espaço para dizer que não há nada.
   */
  const temPrecoAcordado = Boolean(
    customerOrder?.lines.some((line) => line.agreedPrice !== null),
  );
  /*
   * Pedido nascido de proposta aceita não renegocia aqui: produto e
   * quantidade vieram de um acordo com o cliente. O backend já recusa a
   * alteração — a tela precisa parar de oferecê-la, senão a pessoa edita,
   * salva e só então descobre que não podia.
   */
  const origemComercial = customerOrder?.commercialOrigin ?? null;
  const linhasEditaveis = isDraft && origemComercial === null;
  const isCancellable = !isNew && (status === "DRAFT" || status === "CONFIRMED");
  const isConfirmable = !isNew && status === "DRAFT" && lines.length > 0;
  /*
   * Quem grava a "Entrega prevista".
   *
   * O campo mora no topo e o botão que o grava fica no fim da página, mais
   * de mil pixels abaixo: quem mudava a data não tinha como saber que ela
   * ainda não estava no pedido. O rótulo aqui é o MESMO texto do botão do
   * rodapé — e é aquele botão que salva; nenhum caminho novo de gravação
   * nasce ao lado do campo.
   */
  const rotuloDeSalvar = isDraft ? "Salvar rascunho" : "Salvar prazo e observações";
  /**
   * Existe botão de salvar no rodapé? Pedido cancelado não tem, e apontar
   * para um botão que não está na tela é pior que não dizer nada.
   */
  const temBotaoDeSalvar = isDraft || status !== "CANCELLED";
  /** Data no campo diferente da data que está no pedido salvo. */
  const prazoNaoSalvo =
    !isNew &&
    customerOrder !== null &&
    requestedDeliveryDate !== toDateInputValue(customerOrder.requestedDeliveryDate);
  const showPlan = !isNew && status === "CONFIRMED";
  const showPurchaseSuggestion = !isNew && status === "IN_FULFILLMENT";

  /* Falta por responsabilidade: material Veridi se resolve comprando,
     material do cliente nao. Separar aqui evita oferecer a acao errada. */
  const faltaVeridi = (plan?.materialImpact ?? []).filter(
    (row) => row.supplyResponsibility === "VERIDI" && Number(row.shortage) > 0,
  );
  const faltaCliente = (plan?.materialImpact ?? []).filter(
    (row) => row.supplyResponsibility === "CUSTOMER" && Number(row.shortage) > 0,
  );
  /** Reserva complementar/expedição continuam disponíveis até o pedido ser totalmente expedido. */
  const isOperational = !isNew && (status === "IN_FULFILLMENT" || status === "PARTIALLY_SHIPPED");
  /* Linhas cujo saldo ainda precisa ser PRODUZIDO — o que já está
     reservado ou em OP aberta não conta, senão sugeriríamos produzir o
     dobro. O cálculo é do servidor; aqui só se lê. */
  const linhasComSaldoPendente = (customerOrder?.lines ?? []).filter(
    (line) => Number(line.pendingProductionQuantity) > 0,
  );
  const [saldoDialogLineId, setSaldoDialogLineId] = useState<string | null>(null);
  const [gerandoSaldoLineId, setGerandoSaldoLineId] = useState<string | null>(null);

  async function handleGerarSaldo(lineId: string) {
    if (!id) return;
    setSaldoDialogLineId(null);
    setGerandoSaldoLineId(lineId);
    setError(null);
    try {
      setCustomerOrder(await createRemainderProductionOrder(id, { customerOrderLineId: lineId }));
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao gerar OP para o saldo restante"));
    } finally {
      setGerandoSaldoLineId(null);
    }
  }

  const hasFulfillmentResult =
    !!customerOrder && (customerOrder.reservation !== null || customerOrder.generatedProductionOrders.length > 0);

  useEffect(() => {
    if (!showPlan || !id) {
      setPlan(null);
      return;
    }
    setPlanLoading(true);
    getFulfillmentPlan(id)
      .then((result) => {
        setPlan(result);
        const initial: Record<string, { reserve: string; produce: string }> = {};
        for (const line of result.lines) {
          initial[line.customerOrderLineId] = {
            reserve: line.suggestedReserveQuantity,
            produce: line.suggestedProductionQuantity,
          };
        }
        setPlanAdjustments(initial);
      })
      .catch((err: unknown) => setError(apiErrorMessage(err, "Falha ao carregar plano de atendimento")))
      .finally(() => setPlanLoading(false));
  }, [showPlan, id]);

  const carregarSourcing = useCallback(() => {
    if (!id) return;
    setSourcingLoading(true);
    getPlanPurchaseSourcing(id)
      .then(setSourcing)
      .catch((err: unknown) =>
        setError(apiErrorMessage(err, "Falha ao carregar sugestão de compra")),
      )
      .finally(() => setSourcingLoading(false));
  }, [id]);

  const reloadSuggestion = useCallback(() => {
    if (!id) return;
    setSuggestionLoading(true);
    getPurchaseSuggestion(id)
      .then((result) => {
        setSuggestion(result);
        setDraftInputs((prev) => {
          const next: Record<string, { quantity: string; supplierId: string }> = {};
          for (const row of result.rows) {
            // Pre-seleciona SO o fornecedor recomendado (preferencial ou
            // unico homologado). Com varios homologados e nenhum
            // preferencial nada e escolhido: a decisao e do usuario.
            const recommended = row.supplierCandidates.find(
              (candidate) => candidate.supplierItemId === row.recommendedSupplierItemId,
            );
            next[row.itemId] = prev[row.itemId] ?? {
              quantity: recommended?.recommendedPurchaseQuantity ?? row.newSuggestedPurchase,
              supplierId: recommended?.supplierId ?? "",
            };
          }
          return next;
        });
      })
      .catch((err: unknown) => setError(apiErrorMessage(err, "Falha ao carregar sugestão de compra")))
      .finally(() => setSuggestionLoading(false));
  }, [id]);

  useEffect(() => {
    if (!showPurchaseSuggestion || !id) {
      setSuggestion(null);
      return;
    }
    reloadSuggestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPurchaseSuggestion, id]);

  useEffect(() => {
    if (!showPurchaseSuggestion) return;
    listSuppliers({ active: true, pageSize: 1000 })
      .then((result) => setActiveSuppliers(result.suppliers))
      .catch(() => setActiveSuppliers([]));
  }, [showPurchaseSuggestion]);

  const reloadReservationStatus = useCallback(() => {
    if (!id) return;
    getReservationStatus(id)
      .then((result) => {
        setReservationStatus(result);
        setReserveInputs((prev) => {
          const next: Record<string, string> = {};
          for (const line of result.lines) {
            next[line.customerOrderLineId] =
              prev[line.customerOrderLineId] ?? line.suggestedAdditionalReserve;
          }
          return next;
        });
      })
      .catch(() => setReservationStatus(null));
  }, [id]);

  useEffect(() => {
    if (!isOperational || !id) {
      setReservationStatus(null);
      return;
    }
    reloadReservationStatus();
  }, [isOperational, id, reloadReservationStatus]);

  const customerOptions: CustomerDTO[] = useMemo(() => {
    if (!customerOrder || activeCustomers.some((c) => c.id === customerOrder.customerId)) {
      return activeCustomers;
    }
    return [
      ...activeCustomers,
      {
        id: customerOrder.customerId,
        code: customerOrder.customerCode ?? "",
        legalName: customerOrder.customerName ?? "",
        tradeName: customerOrder.customerTradeName,
        cnpj: customerOrder.customerCnpj,
        email: null,
        phone: null,
        // Opção sintética para o select: o Pedido confirmado já tem o
        // snapshot próprio, o endereço não é lido daqui.
        street: null,
        number: null,
        complement: null,
        district: null,
        zipCode: null,
        city: customerOrder.customerAddress.city,
        state: customerOrder.customerAddress.state,
        notes: null,
        businessLotSuffix: null,
        active: false,
        createdAt: "",
        createdByName: null,
        updatedAt: "",
        updatedByName: null,
      },
    ];
  }, [activeCustomers, customerOrder]);

  function optionsForRow(row: LineRow): ProductDTO[] {
    const usedByOtherRows = new Set(lines.filter((l) => l.key !== row.key).map((l) => l.productId));
    const base = activeProducts.filter((product) => !usedByOtherRows.has(product.id) && product.finishedProductItem);
    if (row.productId && !base.some((product) => product.id === row.productId)) {
      const known = activeProducts.find((product) => product.id === row.productId);
      if (known) return [...base, known];
    }
    return base;
  }

  /**
   * Cadastro de cliente e de produto na TELA OFICIAL, sem perder o pedido.
   *
   * Cliente é campo único: basta saber que foi ele quem pediu. Produto vive
   * em linha de tabela, então o contexto carrega QUAL linha — sem isso o
   * produto criado voltaria para a primeira.
   */
  const origem = useContextualCreateOrigin<RascunhoPedido>({
    collectDraft: () => ({ customerId, requestedDeliveryDate, notes, lines }),
    restoreDraft: (draft) => {
      // Antes de qualquer `setState`: a carga do pedido está a caminho.
      rascunhoRestaurado.current = true;
      setCustomerId(draft.customerId ?? "");
      setRequestedDeliveryDate(draft.requestedDeliveryDate ?? "");
      setNotes(draft.notes ?? "");
      const linhas = Array.isArray(draft.lines) ? draft.lines : [];
      absorverChaves(linhas);
      setLines(linhas);
    },
    onCreated: (result, record) => {
      // Pelo id, sempre. O tipo do registro diz qual campo pediu.
      if (record.entityType === "customer") {
        setCustomerId(result.entityId);
        return;
      }
      const chave = lerChaveDaLinha(record.context);
      if (!chave) return;
      setLines((prev) =>
        prev.map((line) =>
          line.key === chave
            ? {
                ...line,
                productId: result.entityId,
                productCode: "",
                productName: result.label,
                // Como no resto da tela: a unidade vem do Finished Product
                // Item e só é conhecida depois de salvar.
                unitCode: "",
              }
            : line,
        ),
      );
      /*
       * O catálogo da tela é recarregado na volta e o produto novo estará
       * nele — mas só quando a resposta chegar, e até lá a coluna pareceria
       * vazia com a linha já escolhida. Buscar o produto pelo id fecha essa
       * janela e não depende do filtro da listagem. Falha aqui não desfaz a
       * seleção: o id já está na linha.
       */
      void getProduct(result.entityId)
        .then((produto) =>
          setActiveProducts((prev) => [produto, ...prev.filter((row) => row.id !== produto.id)]),
        )
        .catch(() => undefined);
    },
  });

  /**
   * O cliente do pedido viaja junto no cadastro de produto.
   *
   * Um Pedido já é de um cliente, e o produto que nasce dele é desse
   * cliente. A tela oficial trava o campo com o que chega aqui em vez de
   * oferecer a divergência — produto de um cliente dentro do documento de
   * outro.
   */
  function contextoDoProdutoNovo(rowKey: string): Record<string, unknown> {
    const cliente = customerOptions.find((row) => row.id === customerId);
    return {
      rowKey,
      ...(customerId ? { customerId } : {}),
      ...(cliente ? { customerLabel: cliente.tradeName ?? cliente.legalName } : {}),
    };
  }

  function handleAddLine() {
    setLines((prev) => [
      ...prev,
      { key: nextRowKey(), productId: "", productCode: "", productName: "", unitCode: "", orderedQuantity: "" },
    ]);
  }

  function handleRemoveLine(key: string) {
    setLines((prev) => prev.filter((line) => line.key !== key));
  }

  function handleLineProductChange(key: string, productId: string) {
    const product = activeProducts.find((option) => option.id === productId);
    setLines((prev) =>
      prev.map((line) =>
        line.key === key
          ? {
              ...line,
              productId,
              productCode: product?.code ?? "",
              productName: product?.name ?? "",
              // A unidade e sempre derivada do Finished Product Item no backend —
              // so fica conhecida apos salvar (ProductDTO nao expoe unitCode aqui).
              unitCode: "",
            }
          : line,
      ),
    );
  }

  function handleLineQuantityChange(key: string, value: string) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, orderedQuantity: value } : line)));
  }

  async function handleSaveDraft() {
    if (!customerId) {
      setError("Selecione um cliente.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      // A conversão acontece dentro do funil: uma quantidade ilegível
      // interrompe aqui, com o produto nomeado, e a requisição não sai.
      const linesPayload = lines
        .filter((line) => line.productId)
        .map((line) => ({
          productId: line.productId,
          orderedQuantity: exigirDecimal(
            line.orderedQuantity,
            `Quantidade de ${line.productCode || "produto"}`,
          ),
        }));

      const requestedIso = toIsoOrEmpty(requestedDeliveryDate);

      const payload = {
        customerId,
        notes: notes.trim(),
        lines: linesPayload,
        ...(requestedIso ? { requestedDeliveryDate: requestedIso } : {}),
      };

      if (isNew) {
        const created = await createCustomerOrder(payload);
        navigate(`/comercial/pedidos/${created.id}`, { replace: true });
      } else if (id) {
        const updated = await updateCustomerOrder(id, payload);
        setCustomerOrder(updated);
        syncFormFromServer(updated);
      }
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          nextFieldErrors[issue.path] = issue.message;
        }
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(apiErrorMessage(err, "Falha ao salvar pedido"));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveNotesOnly() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const requestedIso = toIsoOrEmpty(requestedDeliveryDate);
      const updated = await updateCustomerOrder(id, {
        notes: notes.trim(),
        ...(requestedIso ? { requestedDeliveryDate: requestedIso } : {}),
      });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao salvar"));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!id) return;
    setConfirmDialogOpen(false);
    setSaving(true);
    setError(null);
    try {
      const updated = await confirmCustomerOrder(id);
      setCustomerOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao confirmar pedido"));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelConfirm() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await cancelCustomerOrder(id, { reason: cancelReason.trim() });
      setCancelDialogOpen(false);
      setCancelReason("");
      setCustomerOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao cancelar pedido"));
    } finally {
      setSaving(false);
    }
  }

  function handleAdjustReserve(lineId: string, ordered: string, reserve: string) {
    setPlanAdjustments((prev) => ({
      ...prev,
      [lineId]: { reserve, produce: complementoDaLinha(ordered, reserve) },
    }));
  }

  function handleAdjustProduce(lineId: string, ordered: string, produce: string) {
    setPlanAdjustments((prev) => ({
      ...prev,
      [lineId]: { reserve: complementoDaLinha(ordered, produce), produce },
    }));
  }

  const planCoversEverything = useMemo(() => {
    if (!plan) return false;
    return plan.lines.every((line) => {
      const adjustment = planAdjustments[line.customerOrderLineId];
      if (!adjustment) return false;
      // Vazio é zero; ilegível não vira conta — sem isto a soma dava `NaN`
      // e a comparação recusava um plano que fecha, dizendo que não fecha.
      const reservado = parseDecimalInput(adjustment.reserve.trim() || "0");
      const produzido = parseDecimalInput(adjustment.produce.trim() || "0");
      if (reservado === null || produzido === null) return false;
      const sum = Number(reservado) + Number(produzido);
      return Math.abs(sum - Number(line.orderedQuantity)) < 1e-6;
    });
  }, [plan, planAdjustments]);

  /*
   * Reservar mais do que existe.
   *
   * O plano só conferia se `Reservar + Produzir` fecha com o pedido, e nunca
   * comparava a reserva com o disponível — que está renderizado na coluna ao
   * lado do campo. O servidor recusava com 400 e o preenchimento de TODAS as
   * linhas era descartado: o operador refazia o plano inteiro por causa de
   * um número que a tela já tinha condição de recusar antes.
   *
   * A Ordem de Produção faz o oposto no Consumo Real, onde o campo diz
   * "Máximo disponível nesta reserva" e desabilita antes do envio.
   */
  const linhasComReservaAcimaDoDisponivel = useMemo(() => {
    if (!plan) return [];
    return plan.lines.filter((line) => {
      const ajuste = planAdjustments[line.customerOrderLineId];
      if (!ajuste) return false;
      const reservado = parseDecimalInput(ajuste.reserve.trim() || "0");
      if (reservado === null) return false;
      return Number(reservado) > Number(line.finishedGoodsAvailable) + 1e-6;
    });
  }, [plan, planAdjustments]);

  /*
   * Um ajuste que nem o parser lê. O aviso de "precisa somar" está certo
   * para quem digitou 3 onde cabia 5, e completamente errado para quem
   * digitou `1.234,56` — nesse caso a soma nem existe.
   */
  const ajustePlanoIlegivel = useMemo(() => {
    if (!plan) return false;
    return plan.lines.some((line) => {
      const adjustment = planAdjustments[line.customerOrderLineId];
      if (!adjustment) return false;
      return (
        (adjustment.reserve.trim() !== "" && parseDecimalInput(adjustment.reserve) === null) ||
        (adjustment.produce.trim() !== "" && parseDecimalInput(adjustment.produce) === null)
      );
    });
  }, [plan, planAdjustments]);

  async function handleApplyPlan() {
    if (!id || !plan) return;
    setApplyDialogOpen(false);
    setApplying(true);
    setError(null);
    try {
      const updated = await applyFulfillmentPlan(id, {
        lines: plan.lines.map((line) => {
          const adjustment = planAdjustments[line.customerOrderLineId]!;
          return {
            customerOrderLineId: line.customerOrderLineId,
            reserveQuantity:
              exigirDecimalOpcional(adjustment.reserve, `Reservar de ${line.productCode}`) ?? "0",
            produceQuantity:
              exigirDecimalOpcional(adjustment.produce, `Produzir de ${line.productCode}`) ?? "0",
          };
        }),
      });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      setPlan(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao aplicar plano de atendimento"));
    } finally {
      setApplying(false);
    }
  }

  const draftLinesToGenerate = useMemo(() => {
    return Object.entries(draftInputs)
      .filter(([, value]) => temValorParaEnviar(value.quantity))
      .map(([itemId, value]) => ({ itemId, quantity: value.quantity, supplierId: value.supplierId }));
  }, [draftInputs]);

  const draftLinesMissingSupplier = draftLinesToGenerate.some((line) => !line.supplierId);
  const noAdditionalPurchaseSuggested =
    !!suggestion && suggestion.rows.every((row) => Number(row.newSuggestedPurchase) === 0);

  function handleDraftQuantityChange(itemId: string, quantity: string) {
    setDraftInputs((prev) => ({ ...prev, [itemId]: { quantity, supplierId: prev[itemId]?.supplierId ?? "" } }));
  }

  function handleDraftSupplierChange(itemId: string, supplierId: string) {
    // Trocar de fornecedor troca as condicoes comerciais: a quantidade
    // recomendada acompanha o MOQ daquele fornecedor (quando comparavel).
    const candidate = suggestion?.rows
      .find((row) => row.itemId === itemId)
      ?.supplierCandidates.find((option) => option.supplierId === supplierId);

    setDraftInputs((prev) => ({
      ...prev,
      [itemId]: {
        quantity: candidate?.recommendedPurchaseQuantity ?? prev[itemId]?.quantity ?? "0",
        supplierId,
      },
    }));
  }

  async function handleGenerateDrafts() {
    if (!id) return;
    setGenerateDialogOpen(false);
    setGenerating(true);
    setError(null);
    try {
      const updated = await generatePurchaseDrafts(id, {
        lines: draftLinesToGenerate.map((line) => {
          const codigo =
            suggestion?.rows.find((row) => row.itemId === line.itemId)?.itemCode ?? "material";
          return {
            ...line,
            quantity: exigirDecimal(line.quantity, `Comprar de ${codigo}`),
          };
        }),
      });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      reloadSuggestion();
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao gerar Ordens de Compra"));
    } finally {
      setGenerating(false);
    }
  }

  async function handleReserveAvailable() {
    if (!id || !reservationStatus) return;

    setReserving(true);
    setError(null);
    try {
      // Dentro do funil: linha em branco é zero e some no filtro; linha
      // ilegível interrompe nomeando o produto, em vez de sumir junto e
      // deixar o clique sem efeito nenhum.
      const lines = reservationStatus.lines
        .map((line) => ({
          customerOrderLineId: line.customerOrderLineId,
          quantity:
            exigirDecimalOpcional(
              reserveInputs[line.customerOrderLineId] ?? "",
              `Reservar de ${line.productCode}`,
            ) ?? "0",
        }))
        .filter((line) => Number(line.quantity) > 0);
      if (lines.length === 0) return;

      const updated = await reserveAvailable(id, { lines });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      setReserveInputs({});
      reloadReservationStatus();
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao reservar produto acabado"));
    } finally {
      setReserving(false);
    }
  }

  async function handleReallocate(reservationLineId: string) {
    if (!id) return;
    setReallocatingLineId(reservationLineId);
    setError(null);
    try {
      const updated = await reallocateReservationLine(id, {
        customerOrderReservationLineId: reservationLineId,
      });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      reloadReservationStatus();
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao realocar reserva"));
    } finally {
      setReallocatingLineId(null);
    }
  }

  async function handlePrepareShipment() {
    if (!id) return;
    setPreparingShipment(true);
    setError(null);
    try {
      const shipment = await createShipmentDraft(id);
      navigate(`/comercial/expedicoes/${shipment.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao preparar expedição"));
    } finally {
      setPreparingShipment(false);
    }
  }

  if (!isNew && loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Pedido do Cliente</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (!isNew && notFound) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Pedido não encontrado</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/pedidos")}>
            ← Voltar para Pedidos
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs items={[{ label: "Pedidos", href: "/comercial/pedidos" }, { label: isNew ? "Novo" : (customerOrder?.code ?? "Editar") }]} />
          <div className="doc-title">
            <h1>{isNew ? "Novo pedido" : customerOrder?.code}</h1>
            {customerOrder && (
              <span className={statusBadgeClass(status)}>{CUSTOMER_ORDER_STATUS_LABELS[status]}</span>
            )}
          </div>
        </div>
        <div className="table__actions">
          {customerOrder && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate(`/comercial/pedidos/${customerOrder.id}/imprimir`)}
            >
              Imprimir
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/pedidos")}>
            ← Voltar
          </button>
        </div>
      </div>

      {customerOrder && <FlowContext steps={orderFlowSteps(customerOrder)} />}

      <div className="doc-body">
        {/*
          A ajuda do DOCUMENTO fica aqui, fora de qualquer condicao de status.
          Ela vivia so dentro da secao do Plano, que so aparece com o pedido
          confirmado — entao sumia justamente em "Em atendimento", quando
          reserva, ordens e saldo a expedir passam a existir e a tela fica mais
          dificil, nao mais facil.
        */}
        <ContextHelp topic={helpTopics["comercial.pedido"]} />
        {error && <p className="form-alert" role="alert">{error}</p>}

        {customerOrder?.status === "CANCELLED" && (
          <FormSection title="Cancelamento">
            <div className="status-line">
              <span className="badge badge--err">Cancelado</span>
              <span className="field__hint">
                {formatDateTime(customerOrder.cancelledAt)} — {customerOrder.cancelledBy ?? "—"}
              </span>
            </div>
            {customerOrder.cancelReason && <p className="field__hint">Motivo: {customerOrder.cancelReason}</p>}
          </FormSection>
        )}

        {customerOrder && <CommercialOriginSection order={customerOrder} />}

        <FormSection
          title="Cliente e datas"
          subtitle={
            isDraft
              ? "Enquanto rascunho, cliente e datas podem ser alterados livremente."
              : "Após confirmado, cliente e produtos ficam congelados."
          }
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="co-customer">
                Cliente <span className="req">*</span>
              </label>
              {isDraft ? (
                <SearchableEntitySelect
                  id="co-customer"
                  value={customerId}
                  onChange={(selectedId) => setCustomerId(selectedId)}
                  placeholder="Digite código ou nome do cliente…"
                  onSearch={buscarClientes}
options={customerOptions.map((customer) => ({
                    id: customer.id,
                    code: customer.code,
                    name: customer.tradeName ?? customer.legalName,
                    ...(customer.active ? {} : { hint: "inativo" }),
                  }))}
                  canCreate
                  createLabel="Novo cliente"
                  onCreateNew={() =>
                    origem.goCreate({
                      route: "/cadastros/clientes/novo",
                      fieldKey: "customerId",
                      entityType: "customer",
                    })
                  }
                  /* Liga campo, `aria-invalid` e a mensagem, para leitor de tela também. */
                  {...(fieldErrors["customerId"]
                    ? {
                        "aria-invalid": true as const,
                        "aria-describedby": "co-customerId-error",
                      }
                    : {})}
                />
              ) : (
                <p className="field-readonly-value">
                  {customerOrder?.customerCode} — {customerOrder?.customerName}
                </p>
              )}
              {fieldErrors["customerId"] && (
                <p className="field__error" id="co-customerId-error">
                  {fieldErrors["customerId"]}
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor="co-delivery-date">Entrega prevista</label>
              <input
                id="co-delivery-date"
                type="date"
                value={requestedDeliveryDate}
                onChange={(event) => setRequestedDeliveryDate(event.target.value)}
                {...(temBotaoDeSalvar ? { "aria-describedby": "co-delivery-date-hint" } : {})}
              />
              {/* `role="status"` para que quem usa leitor de tela ouça a
                  mudança de "onde se salva" para "ainda não salvo". */}
              {temBotaoDeSalvar && (
                <p className="field__hint" id="co-delivery-date-hint" role="status">
                  {prazoNaoSalvo ? (
                    <>
                      <span className="badge badge--warn">Data ainda não salva</span> A nova
                      data entra no pedido com “{rotuloDeSalvar}”, no fim desta página.
                    </>
                  ) : (
                    <>Mudar a data aqui não grava sozinho: use “{rotuloDeSalvar}”, no fim desta página.</>
                  )}
                </p>
              )}
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Produtos"
          subtitle={
            origemComercial
              ? `Produtos e quantidades vieram do orçamento ${origemComercial.quoteCode}. Para mudar, renegocie criando uma nova versão do orçamento.`
              : "Um produto por pedido — a unidade vem do item de produto acabado."
          }
        >
          <div className="table-container">
            {/* Produto é a coluna de decisão: fica com o espaço, e a busca
                dentro dela precisa de largura para nomes longos. */}
            <table className="table table--order-lines">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="col-quantity is-numeric">Quantidade</th>
                  <th className="col-unit">Un.</th>
                  {temPrecoAcordado && <th className="is-numeric">Preço acordado</th>}
                  {!isDraft && <th className="is-numeric">Expedido</th>}
                  {!isDraft && <th className="is-numeric">Falta expedir</th>}
                  {linhasEditaveis && <th aria-hidden="true" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td>
                      {linhasEditaveis ? (
                        <SearchableEntitySelect
                          id={`pedido-produto-${line.key}`}
                          value={line.productId}
                          onChange={(productId) => handleLineProductChange(line.key, productId)}
                          placeholder="Digite código ou nome do produto…"
                          onSearch={buscarProdutos}
options={optionsForRow(line).map((product) => ({
                            id: product.id,
                            code: product.code,
                            name: product.name,
                          }))}
                          canCreate
                          createLabel="Novo produto"
                          onCreateNew={() =>
                            origem.goCreate({
                              route: "/cadastros/produtos/novo",
                              fieldKey: "productId",
                              entityType: "product",
                              context: contextoDoProdutoNovo(line.key),
                            })
                          }
                        />
                      ) : (
                        <>
                          <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                        </>
                      )}
                    </td>
                    <td className="is-numeric">
                      {linhasEditaveis ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Quantidade"
                          // Placeholder some ao digitar e nenhum leitor de tela
                          // o usa como nome: sem isto, o campo que decide a
                          // quantidade do pedido era só "editar texto".
                          aria-label={`Quantidade de ${line.productCode || "produto"}`}
                          value={line.orderedQuantity}
                          onChange={(event) => handleLineQuantityChange(line.key, event.target.value)}
                        />
                      ) : (
                        line.orderedQuantity
                      )}
                    </td>
                    <td>{line.unitCode || "—"}</td>
                    {temPrecoAcordado && (
                      <td className="is-numeric">
                        <AgreedPriceCell
                          price={
                            customerOrder?.lines.find((l) => l.productId === line.productId)
                              ?.agreedPrice ?? null
                          }
                        />
                      </td>
                    )}
                    {!isDraft && (
                      <td className="is-numeric">
                        {customerOrder?.lines.find((l) => l.productId === line.productId)?.shippedQuantity ?? "—"}
                      </td>
                    )}
                    {!isDraft && (
                      <td className="is-numeric">
                        {customerOrder?.lines.find((l) => l.productId === line.productId)?.outstandingQuantity ??
                          "—"}
                      </td>
                    )}
                    {linhasEditaveis && (
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-label="Remover linha"
                          onClick={() => handleRemoveLine(line.key)}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}

                {lines.length === 0 && (
                  <tr>
                    <td colSpan={(isDraft ? 4 : 5) + (temPrecoAcordado ? 1 : 0)} className="table__empty">
                      Nenhum produto adicionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {linhasEditaveis && (
            <div className="line-actions">
              <button type="button" className="btn btn--secondary btn--sm" onClick={handleAddLine}>
                + Adicionar produto
              </button>
            </div>
          )}
        </FormSection>

        {showPlan && (
          <FormSection
            title="Plano de Atendimento"
            subtitle="Análise/projeção — usa estoque disponível agora. Ao aplicar, tudo é recalculado de novo."
          >
            <ContextHelp
              topic={helpTopics["planoAtendimento.comoFunciona"]}
              triggerLabel="Como funciona o Plano"
            />

            {planLoading && <p className="field__hint">Calculando…</p>}
            {plan && (
              <>
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Pedido</th>
                        <th className="is-numeric">Disponível</th>
                        <th>Reservar</th>
                        <th>Produzir</th>
                        <th>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.lines.map((line) => {
                        const adjustment = planAdjustments[line.customerOrderLineId] ?? { reserve: "0", produce: "0" };
                        return (
                          <tr key={line.customerOrderLineId}>
                            <td>
                              <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                            </td>
                            <td>
                              {formatQuantity(line.orderedQuantity)} {line.unitCode}
                            </td>
                            <td className="is-numeric">{line.finishedGoodsAvailable}</td>
                            <td>
                              {/* Sem nome acessível, um leitor de tela anuncia
                                  só "editar texto" no campo que decide reserva
                                  de um pedido confirmado. */}
                              <input
                                type="text"
                                inputMode="decimal"
                                aria-label={`Reservar de ${line.productCode}`}
                                value={adjustment.reserve}
                                onChange={(event) =>
                                  handleAdjustReserve(line.customerOrderLineId, line.orderedQuantity, event.target.value)
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                inputMode="decimal"
                                aria-label={`Produzir de ${line.productCode}`}
                                value={adjustment.produce}
                                onChange={(event) =>
                                  handleAdjustProduce(line.customerOrderLineId, line.orderedQuantity, event.target.value)
                                }
                              />
                            </td>
                            <td>
                              <span
                                className={
                                  line.situation === "SEM_FORMULACAO_ATIVA" ? "badge badge--warn" : "badge badge--neutral"
                                }
                              >
                                {situationLabel(line.situation)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {ajustePlanoIlegivel ? (
                  <p className="field__hint">{mensagemDecimalInvalido("Reservar/Produzir")}</p>
                ) : linhasComReservaAcimaDoDisponivel.length > 0 ? (
                  <p className="form-alert" role="alert">
                    {linhasComReservaAcimaDoDisponivel
                      .map(
                        (line) =>
                          `${line.productCode}: reservar até ${formatQuantity(line.finishedGoodsAvailable)} ${line.unitCode}`,
                      )
                      .join(" · ")}
                    . O que passar disso precisa entrar em "Produzir".
                  </p>
                ) : (
                  !planCoversEverything && (
                    <p className="field__hint">Reservar + Produzir precisa somar exatamente a quantidade pedida em cada linha.</p>
                  )
                )}

                {plan.materialImpact.length > 0 && (
                  <>
                    <div className="table-container table-container--spaced">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Material</th>
                            <th>Fornecimento</th>
                            <th className="is-numeric">Necessário</th>
                            {/* Cinco palavras que decidem a ação e não querem
                                dizer a mesma coisa. "Necessário" e
                                "Fornecimento" já se explicam no contexto da
                                linha; estas não. */}
                            <th className="is-numeric">
                              Físico
                              <DicaDaColuna id="planoAtendimento.fisico" />
                            </th>
                            <th className="is-numeric">
                              Reservado
                              <DicaDaColuna id="planoAtendimento.reservado" />
                            </th>
                            <th className="is-numeric">
                              Disponível
                              <DicaDaColuna id="planoAtendimento.disponivel" />
                            </th>
                            <th className="is-numeric">
                              Em Compra
                              <DicaDaColuna id="planoAtendimento.emCompra" />
                            </th>
                            <th className="is-numeric">
                              Falta
                              <DicaDaColuna id="planoAtendimento.falta" />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.materialImpact.map((row) => (
                            <tr key={row.itemId}>
                              <td>
                                <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                              </td>
                              {/* Material do cliente enxerga somente lotes do
                                  próprio cliente — dizer de quem é o estoque
                                  explica os números da linha. */}
                              <td>
                                {row.supplyResponsibility === "CUSTOMER" ? (
                                  <>
                                    <span className="badge badge--info">Material do cliente</span>
                                    <div className="field__hint">
                                      {row.ownerCustomerName ?? "Cliente não identificado"}
                                    </div>
                                  </>
                                ) : (
                                  "Veridi"
                                )}
                              </td>
                              <td className="is-numeric">
                                {formatQuantity(row.requiredQuantity)} {row.unitCode}
                              </td>
                              <td className="is-numeric">{formatQuantity(row.onHand)}</td>
                              <td className="is-numeric">{formatQuantity(row.reserved)}</td>
                              <td className="is-numeric">{formatQuantity(row.available)}</td>
                              <td className="is-numeric">
                                {row.supplyResponsibility === "CUSTOMER" ? "—" : row.onOrder}
                              </td>
                              <td className="is-numeric">
                                <span className={Number(row.shortage) > 0 ? "badge badge--warn" : "badge badge--active"}>
                                  {formatQuantity(row.shortage)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* A falta era detectada aqui e o caminho ate Compras exigia
                        sair do Pedido e reconstruir item, quantidade e fornecedor
                        de cabeca. O CTA abre a MESMA analise de fornecedores da
                        Sugestao de Compra — nenhuma OC nasce sozinha. */}
                    {faltaVeridi.length > 0 && (
                      <div className="callout">
                        <p>
                          <strong>
                            {faltaVeridi.length === 1
                              ? "1 material Veridi com falta."
                              : faltaVeridi.length + " materiais Veridi com falta."}
                          </strong>{" "}
                          Ver fornecedores homologados, preço de referência e pedido mínimo sem sair do
                          Pedido.
                        </p>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={sourcingLoading}
                          onClick={carregarSourcing}
                        >
                          {sourcingLoading ? "Carregando…" : "Ver sugestão de compra"}
                        </button>
                      </div>
                    )}

                    {/* Falta de material do cliente nao se resolve comprando:
                        oferecer compra da Veridi aqui seria a sugestao errada. */}
                    {faltaCliente.length > 0 && (
                      <div className="callout">
                        <p>
                          <strong>Material fornecido pelo cliente com falta.</strong> Não há compra da
                          Veridi a sugerir — depende de nova remessa do cliente.
                        </p>
                        <ul>
                          {faltaCliente.map((row) => (
                            <li key={row.itemId}>
                              {row.itemCode} — {row.itemName}: faltam {formatQuantity(row.shortage)} {row.unitCode}
                              {row.ownerCustomerName ? " (" + row.ownerCustomerName + ")" : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {sourcing && sourcing.rows.length > 0 && (
                      <div className="table-container table-container--spaced">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Material</th>
                              <th className="is-numeric">Falta</th>
                              <th className="is-numeric">Em Compra</th>
                              <th>Fornecedores homologados</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sourcing.rows.map((row) => (
                              <tr key={row.itemId}>
                                <td>
                                  <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                                </td>
                                <td className="is-numeric">
                                  {formatQuantity(row.shortage)} {row.unitCode}
                                </td>
                                <td className="is-numeric">{formatQuantity(row.onOrder)}</td>
                                <td>
                                  {row.supplierCandidates.length === 0 ? (
                                    <span className="field__hint">
                                      Nenhum fornecedor homologado para este item.
                                    </span>
                                  ) : (
                                    <ul>
                                      {row.supplierCandidates.map((candidate) => (
                                        <li key={candidate.supplierItemId}>
                                          {candidate.supplierCode} — {candidate.supplierName}
                                          {candidate.supplierItemId === row.recommendedSupplierItemId ? (
                                            <span className="badge badge--active"> preferencial</span>
                                          ) : null}
                                          <div className="field__hint">
                                            {candidate.referencePriceInItemUom
                                              ? candidate.referencePriceInItemUom + " / " + row.unitCode
                                              : "sem preço vigente"}
                                            {candidate.minimumOrderInItemUom
                                              ? " · mínimo " + candidate.minimumOrderInItemUom + " " + row.unitCode
                                              : ""}
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="field__hint">
                          Análise de planejamento — nenhuma Ordem de Compra é criada aqui. Abra Compras
                          para registrar o pedido.
                        </p>
                      </div>
                    )}
                  </>
                )}

                <div className="line-actions">
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
                    disabled={
                      !planCoversEverything || linhasComReservaAcimaDoDisponivel.length > 0 || applying
                    }
                    onClick={() => setApplyDialogOpen(true)}
                  >
                    {applying ? "Aplicando…" : "Aplicar Plano de Atendimento"}
                  </button>
                </div>
              </>
            )}
          </FormSection>
        )}

        {showPurchaseSuggestion && (
          <FormSection
            title="Sugestão de Compra"
            subtitle="Análise dinâmica a partir das OPs deste Pedido — falta física e compra sugerida são conceitos diferentes."
          >
            {suggestionLoading && <p className="field__hint">Calculando…</p>}
            {suggestion && suggestion.pendingProductionOrders.length > 0 && (
              <div className="status-line">
                {suggestion.pendingProductionOrders.map((op) => (
                  <p key={op.id} className="field__hint">
                    Pendência de planejamento: {op.code} ({op.productCode} — {op.productName}) ainda não possui
                    requisitos de materiais.
                  </p>
                ))}
              </div>
            )}
            {suggestion && suggestion.rows.length > 0 && (
              <>
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th className="is-numeric">Necessário restante</th>
                        <th>Reservado p/ este Pedido</th>
                        <th className="is-numeric">Disponível</th>
                        <th className="is-numeric">Em Compra</th>
                        <th>Falta física</th>
                        <th>Já em rascunho</th>
                        <th>Comprar sugerido</th>
                        <th>Comprar agora</th>
                        <th>Fornecedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestion.rows.map((row) => {
                        const input = draftInputs[row.itemId] ?? { quantity: "0", supplierId: "" };
                        return (
                          <tr key={row.itemId}>
                            <td>
                              <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                              {/* Quem pode fornecer fica junto do material: e a
                                  informacao que sustenta a decisao de compra. */}
                              {row.supplierCandidates.length === 0 ? (
                                <div className="field__hint">
                                  Nenhum fornecedor homologado cadastrado para este item.
                                </div>
                              ) : (
                                <ul className="candidate-list">
                                  {row.supplierCandidates.map((candidate) => (
                                    <li key={candidate.supplierItemId}>
                                      {candidate.supplierName}
                                      {candidate.preferred && (
                                        <span className="badge badge--active"> Preferencial</span>
                                      )}
                                      {candidate.referenceUnitPrice ? (
                                        <span className="field__hint">
                                          {" "}
                                          {candidate.referenceUnitPrice}{" "}
                                          {candidate.referenceCurrencyCode}/
                                          {candidate.referencePriceUomCode}
                                        </span>
                                      ) : candidate.hasLegacyPriceReference ? (
                                        <span className="field__hint"> referência histórica</span>
                                      ) : (
                                        <span className="field__hint"> sem preço vigente</span>
                                      )}
                                      {candidate.minimumOrderQuantity && (
                                        <span className="field__hint">
                                          {" "}
                                          · mínimo {formatQuantity(candidate.minimumOrderQuantity)}{" "}
                                          {candidate.minimumOrderUomCode}
                                          {candidate.moqRaisedQuantity && " (eleva a quantidade)"}
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {row.supplierCandidates.length > 1 &&
                                row.recommendedSupplierItemId === null && (
                                  <div className="field__hint">
                                    Vários homologados e nenhum preferencial — escolha o fornecedor.
                                  </div>
                                )}
                            </td>
                            <td className="is-numeric">
                              {row.remainingRequired} {row.unitCode}
                            </td>
                            <td>{row.ownReserved}</td>
                            <td className="is-numeric">{formatQuantity(row.available)}</td>
                            <td className="is-numeric">{formatQuantity(row.onOrder)}</td>
                            <td>{row.operationalShortage}</td>
                            <td>{formatQuantity(row.draftPurchaseQuantity)}</td>
                            <td>{row.newSuggestedPurchase}</td>
                            <td>
                              <input
                                type="text"
                                inputMode="decimal"
                                aria-label={`Comprar de ${row.itemCode}`}
                                value={input.quantity}
                                onChange={(event) => handleDraftQuantityChange(row.itemId, event.target.value)}
                              />
                            </td>
                            <td>
                              <select
                                value={input.supplierId}
                                onChange={(event) => handleDraftSupplierChange(row.itemId, event.target.value)}
                              >
                                <option value="">Selecionar…</option>
                                {row.supplierCandidates.length > 0 && (
                                  <optgroup label="Homologados">
                                    {row.supplierCandidates.map((candidate) => (
                                      <option
                                        key={candidate.supplierItemId}
                                        value={candidate.supplierId}
                                      >
                                        {candidate.supplierCode} — {candidate.supplierName}
                                        {candidate.preferred ? " (preferencial)" : ""}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {/* Compra emergencial/amostra continua possivel: a
                                    homologacao orienta, nao bloqueia o modulo de compras. */}
                                <optgroup label="Demais fornecedores ativos">
                                  {activeSuppliers
                                    .filter(
                                      (supplier) =>
                                        !row.supplierCandidates.some(
                                          (candidate) => candidate.supplierId === supplier.id,
                                        ),
                                    )
                                    .map((supplier) => (
                                      <option key={supplier.id} value={supplier.id}>
                                        {supplier.code} — {supplier.tradeName ?? supplier.legalName}
                                      </option>
                                    ))}
                                </optgroup>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {draftLinesMissingSupplier && (
                  <p className="field__hint">Selecione o fornecedor para cada material com quantidade a comprar.</p>
                )}

                <div className="line-actions">
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
                    disabled={draftLinesToGenerate.length === 0 || draftLinesMissingSupplier || generating}
                    onClick={() => setGenerateDialogOpen(true)}
                  >
                    {generating ? "Gerando…" : "Gerar OCs em rascunho"}
                  </button>
                </div>
              </>
            )}
            {suggestion && suggestion.rows.length === 0 && suggestion.pendingProductionOrders.length === 0 && (
              <p className="field__hint">Nenhuma compra adicional sugerida neste momento.</p>
            )}
            {suggestion && noAdditionalPurchaseSuggested && suggestion.rows.length > 0 && (
              <p className="field__hint">Nenhuma compra adicional sugerida neste momento.</p>
            )}

            {suggestion && suggestion.customerSuppliedRows.length > 0 && (
              <>
                <h4>Materiais aguardando cliente</h4>
                <p className="field__hint">
                  Estes materiais são fornecidos pelo cliente e por isso não geram Ordem de Compra —
                  a falta é resolvida com o envio do próprio cliente.
                </p>
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Cliente</th>
                        <th className="is-numeric">Necessário</th>
                        <th>Disponível do cliente</th>
                        <th className="is-numeric">Falta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestion.customerSuppliedRows.map((row) => (
                        <tr key={row.itemId}>
                          <td>
                            <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                          </td>
                          <td>{row.customerName ?? "—"}</td>
                          <td className="is-numeric">
                            {row.remainingRequired} {row.unitCode}
                          </td>
                          <td>{formatQuantity(row.available)}</td>
                          <td className="is-numeric">
                            <span
                              className={
                                Number(row.shortage) > 0 ? "badge badge--warn" : "badge badge--active"
                              }
                            >
                              {formatQuantity(row.shortage)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </FormSection>
        )}

        {isOperational && reservationStatus && (() => {
          const temAlgoReservado = reservationStatus.lines.some(
            (line) => Number(line.reservedRemaining) > 0,
          );
          return (
          <FormSection
            /* Duas seções quase homônimas separavam mil e duzentos pixels de
               rolagem: esta AGE (separa produto para o pedido), a de baixo
               REGISTRA (mostra o que já foi separado, lote a lote). O título
               agora diz qual é qual. */
            title="Reservar Produto Acabado"
            subtitle="Produto produzido depois do Plano precisa ser explicitamente reservado antes de poder ser expedido."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Pedido</th>
                    <th className="is-numeric">Expedido</th>
                    <th className="is-numeric">Reservado restante</th>
                    <th className="is-numeric">Falta reservar</th>
                    <th className="is-numeric">Disponível agora</th>
                    <th>Reservar</th>
                  </tr>
                </thead>
                <tbody>
                  {reservationStatus.lines.map((line) => (
                    <tr key={line.customerOrderLineId}>
                      <td>
                        <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                      </td>
                      <td>
                        {formatQuantity(line.orderedQuantity)} {line.unitCode}
                      </td>
                      <td className="is-numeric">{formatQuantity(line.shippedQuantity)}</td>
                      <td className="is-numeric">{line.reservedRemaining}</td>
                      <td className="is-numeric">{line.stillToReserve}</td>
                      <td className="is-numeric">{line.currentAvailable}</td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Reservar de ${line.productCode}`}
                          disabled={Number(line.stillToReserve) <= 0}
                          value={reserveInputs[line.customerOrderLineId] ?? ""}
                          onChange={(event) =>
                            setReserveInputs((prev) => ({
                              ...prev,
                              [line.customerOrderLineId]: event.target.value,
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="line-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={
                  reserving ||
                  reservationStatus.lines.every(
                    (line) => !temValorParaEnviar(reserveInputs[line.customerOrderLineId]),
                  )
                }
                onClick={handleReserveAvailable}
              >
                {reserving ? "Reservando…" : "Reservar disponível"}
              </button>
              {/*
                Sem nada reservado não há o que expedir: o rascunho nasceria
                vazio. O botão irmão ao lado já desabilita nesse mesmo estado,
                e a diferença entre os dois lia como se preparar a expedição
                fizesse sentido ali.
              */}
              <button
                type="button"
                className="btn btn--accent btn--sm"
                disabled={preparingShipment || !temAlgoReservado}
                title={
                  temAlgoReservado
                    ? undefined
                    : "Reserve ao menos uma linha antes de preparar a expedição."
                }
                onClick={handlePrepareShipment}
              >
                {preparingShipment ? "Preparando…" : "Preparar Expedição"}
              </button>
            </div>
          </FormSection>
          );
        })()}

        {customerOrder && customerOrder.shipments.length > 0 && (
          <FormSection title="Expedições" subtitle="Somente uma expedição confirmada altera o estoque.">
            <div className="table-container">
              <table className="table table--clickable-rows">
                <thead>
                  <tr>
                    <th>Expedição</th>
                    <th>Data</th>
                    <th className="is-numeric">Quantidade</th>
                    <th>Status</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {customerOrder.shipments.map((shipment) => (
                    <tr
                      key={shipment.id}
                      tabIndex={0}
                      onClick={() => navigate(`/comercial/expedicoes/${shipment.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") navigate(`/comercial/expedicoes/${shipment.id}`);
                      }}
                    >
                      <td className="is-code">{shipment.code}</td>
                      <td>
                        {formatDate(shipment.shipmentDate)}
                      </td>
                      <td className="is-numeric">{formatQuantity(shipment.totalQuantity)}</td>
                      <td>
                        <span className="badge badge--neutral">
                          {SHIPMENT_STATUS_LABELS[shipment.status as ShipmentStatus] ?? shipment.status}
                        </span>
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <Link className="btn btn--ghost btn--sm" to={`/comercial/expedicoes/${shipment.id}`}>
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        {customerOrder && customerOrder.billingStatus !== "NOT_READY" && (
          <FormSection
            title="Faturamento"
            subtitle="Faturamento comercial do que foi realmente expedido — não emite Nota Fiscal."
          >
            <dl className="definition-list">
              <dt>Pedido</dt>
              <dd>
                {customerOrder.lines.reduce((sum, line) => sum + Number(line.orderedQuantity), 0)}
              </dd>
              <dt>Expedido</dt>
              <dd>
                {customerOrder.lines.reduce((sum, line) => sum + Number(line.shippedQuantity), 0)}
              </dd>
              <dt>Faturado</dt>
              <dd>
                {customerOrder.lines.reduce((sum, line) => sum + Number(line.billedQuantity), 0)}
              </dd>
              <dt>A faturar (expedido)</dt>
              <dd>
                {customerOrder.lines.reduce((sum, line) => sum + Number(line.unbilledShippedQuantity), 0)}
              </dd>
              <dt>Situação</dt>
              <dd>
                <span
                  className={
                    customerOrder.billingStatus === "BILLED" ? "badge badge--active" : "badge badge--warn"
                  }
                >
                  {CUSTOMER_ORDER_BILLING_STATUS_LABELS[customerOrder.billingStatus]}
                </span>
              </dd>
            </dl>

            {customerOrder.billings.length > 0 && (
              <div className="table-container table-container--spaced">
                <table className="table table--clickable-rows">
                  <thead>
                    <tr>
                      <th>Faturamento</th>
                      <th>Expedição</th>
                      <th className="is-numeric">Quantidade</th>
                      <th className="is-numeric">Valor</th>
                      <th>Status</th>
                      <th aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody>
                    {customerOrder.billings.map((billing) => (
                      <tr
                        key={billing.id}
                        tabIndex={0}
                        onClick={() => navigate(`/comercial/faturamento/${billing.id}`)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") navigate(`/comercial/faturamento/${billing.id}`);
                        }}
                      >
                        <td className="is-code">{billing.code}</td>
                        <td className="is-code">{billing.shipmentCode}</td>
                        <td className="is-numeric">{formatQuantity(billing.totalQuantity)}</td>
                        <td className="is-numeric">{billing.totalAmount ? formatBRL(billing.totalAmount) : "Não informado"}</td>
                        <td>
                          <span className="badge badge--neutral">
                            {BILLING_STATUS_LABELS[
                              billing.status as keyof typeof BILLING_STATUS_LABELS
                            ] ?? billing.status}
                          </span>
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <Link className="btn btn--ghost btn--sm" to={`/comercial/faturamento/${billing.id}`}>
                            Abrir
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FormSection>
        )}

        {customerOrder && customerOrder.linkedPurchaseOrders.length > 0 && (
          <FormSection title="Ordens de Compra Vinculadas">
            <div className="table-container">
              <table className="table table--clickable-rows">
                <thead>
                  <tr>
                    <th>OC</th>
                    <th>Fornecedor</th>
                    <th className="is-numeric">Itens</th>
                    <th>Status</th>
                    <th className="is-numeric">Valor</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {customerOrder.linkedPurchaseOrders.map((po) => (
                    <tr
                      key={po.id}
                      tabIndex={0}
                      onClick={() => navigate(`/compras/ordens/${po.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") navigate(`/compras/ordens/${po.id}`);
                      }}
                    >
                      <td className="is-code">{po.code}</td>
                      <td>{po.supplierName}</td>
                      <td className="is-numeric">{po.lineCount}</td>
                      <td>
                        <span className="badge badge--neutral">
                          {PURCHASE_ORDER_STATUS_LABELS[po.status as keyof typeof PURCHASE_ORDER_STATUS_LABELS] ?? po.status}
                        </span>
                      </td>
                      <td className="is-numeric">{po.orderTotal ?? "—"}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <Link className="btn btn--ghost btn--sm" to={`/compras/ordens/${po.id}`}>
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        {hasFulfillmentResult && (
          <>
            {customerOrder?.reservation && (
              <FormSection
                title="Produto Acabado já reservado — por lote"
                subtitle="Registro do que já foi separado para este pedido. Lote inelegível (vencido/bloqueado) pode ser realocado — o já expedido continua no lote original."
              >
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Lote</th>
                        <th className="is-numeric">Reservado</th>
                        <th>Expedido</th>
                        <th>Restante</th>
                        <th>Situação</th>
                        <th aria-hidden="true" />
                      </tr>
                    </thead>
                    <tbody>
                      {customerOrder.reservation.lines.map((line) => {
                        const isReleased = line.releasedAt !== null;
                        const canReallocate =
                          isOperational && !isReleased && Number(line.reservedRemaining) > 0;
                        return (
                          <tr key={line.id}>
                            <td>
                              <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                            </td>
                            <td>
                              {/* O lote que atendeu o pedido é a resposta de
                                  "de qual lote saiu?" — tem que ser clicável. */}
                              {line.lotCode && line.lotId ? (
                                <Link className="code" to={`/estoque/lotes/${line.lotId}`}>
                                  {line.lotCode}
                                </Link>
                              ) : (
                                (line.lotCode ?? "— (sem controle de lote)")
                              )}
                              {line.businessLotNumber ? ` — ${line.businessLotNumber}` : ""}
                              {line.replacesLineId && (
                                <>
                                  <br />
                                  <span className="field__hint">Realocado de outra linha</span>
                                </>
                              )}
                            </td>
                            <td className="is-numeric">
                              {formatQuantity(line.quantity)} {line.unitCode}
                            </td>
                            <td>{formatQuantity(line.shippedQuantity)}</td>
                            <td>{line.reservedRemaining}</td>
                            <td>
                              {isReleased ? (
                                <span className="badge badge--neutral">Realocada</span>
                              ) : (
                                <span className="badge badge--active">Ativa</span>
                              )}
                            </td>
                            <td>
                              {canReallocate && (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  disabled={reallocatingLineId === line.id}
                                  onClick={() => handleReallocate(line.id)}
                                >
                                  {reallocatingLineId === line.id ? "Realocando…" : "Realocar"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {customerOrder.reservation.lines.length === 0 && (
                        <tr>
                          <td colSpan={7} className="table__empty">
                            Nenhuma reserva de produto acabado.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </FormSection>
            )}

            {customerOrder && customerOrder.generatedProductionOrders.length > 0 && (
              <FormSection
                title="Ordens de produção"
                subtitle="O que a fábrica produz para atender este pedido. Cada ordem abre direto pelo código."
              >
                {/* Produção real abaixo do planejado é normal, e o pedido
                    já mostrava a pendência em toda parte — sem oferecer
                    como continuar. O Plano de Atendimento não serve: ele
                    só existe enquanto o pedido está confirmado e cobre a
                    quantidade inteira. */}
                {linhasComSaldoPendente.length > 0 && (
                  <div className="callout">
                    <p>
                      {linhasComSaldoPendente
                        .map(
                          (line) =>
                            `${line.productCode}: faltam ${formatQuantity(line.pendingProductionQuantity)} ${line.unitCode}`,
                        )
                        .join(" · ")}
                    </p>
                    <div className="line-actions">
                      {linhasComSaldoPendente.map((line) => (
                        <button
                          key={line.id}
                          type="button"
                          className="btn btn--accent btn--sm"
                          disabled={gerandoSaldoLineId !== null}
                          onClick={() => setSaldoDialogLineId(line.id)}
                        >
                          {gerandoSaldoLineId === line.id
                            ? "Gerando…"
                            : `Gerar OP para saldo restante${
                                linhasComSaldoPendente.length > 1 ? ` (${line.productCode})` : ""
                              }`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="table-container">
                  <table className="table table--clickable-rows">
                    <thead>
                      <tr>
                        <th>OP</th>
                        <th>Produto</th>
                        <th className="is-numeric">Planejado</th>
                        <th className="is-numeric">Produzido</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerOrder.generatedProductionOrders.map((op) => (
                        <tr
                      key={op.id}
                      tabIndex={0}
                      onClick={() => navigate(`/producao/ordens/${op.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") navigate(`/producao/ordens/${op.id}`);
                      }}
                    >
                          <td className="is-code">
                            <EntityLink kind="productionOrder" id={op.id} code={op.code} />
                          </td>
                          <td>
                            <EntityLink kind="product" id={op.productId} code={op.productCode} name={op.productName} />
                          </td>
                          <td className="is-numeric">
                            {formatQuantity(op.plannedQuantity)} {op.outputUnitCode}
                          </td>
                          <td className="is-numeric">
                            {formatQuantity(op.producedQuantity)} {op.outputUnitCode}
                          </td>
                          <td>
                            <span className="badge badge--neutral">
                              {PRODUCTION_ORDER_STATUS_LABELS[op.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </FormSection>
            )}
          </>
        )}

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="co-notes">Notas internas</label>
            <textarea id="co-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </FormSection>
      </div>

      <div className="doc-actions">
        {isCancellable && (
          <button type="button" className="btn btn--danger" disabled={saving} onClick={() => setCancelDialogOpen(true)}>
            Cancelar pedido
          </button>
        )}

        <div className="doc-actions__primary">
          {isDraft && (
            <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSaveDraft}>
              {saving ? "Salvando…" : "Salvar rascunho"}
            </button>
          )}
          {!isDraft && status !== "CANCELLED" && !isNew && (
            <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSaveNotesOnly}>
              {saving ? "Salvando…" : "Salvar prazo e observações"}
            </button>
          )}
          {isConfirmable && (
            <button type="button" className="btn btn--accent" disabled={saving} onClick={() => setConfirmDialogOpen(true)}>
              Confirmar pedido
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialogOpen}
        title={`Confirmar ${customerOrder?.code}?`}
        message="Produtos e quantidades do pedido serão congelados para planejamento operacional."
        confirmLabel="Confirmar"
        confirmTone="accent"
        onCancel={() => setConfirmDialogOpen(false)}
        onConfirm={handleConfirm}
      />

      <ConfirmDialog
        open={saldoDialogLineId !== null}
        title="Gerar OP para o saldo restante?"
        message={(() => {
          const linha = linhasComSaldoPendente.find((row) => row.id === saldoDialogLineId);
          return linha
            ? `Será criada uma Ordem de Produção em rascunho de ${formatQuantity(linha.pendingProductionQuantity)} ${linha.unitCode} de ${linha.productCode}, vinculada a este pedido. Nada é liberado nem reservado automaticamente.`
            : "";
        })()}
        confirmLabel="Gerar OP"
        confirmTone="accent"
        onCancel={() => setSaldoDialogLineId(null)}
        onConfirm={() => void handleGerarSaldo(saldoDialogLineId!)}
      />

      <ConfirmDialog
        open={applyDialogOpen}
        title="Aplicar Plano de Atendimento?"
        message="Produto acabado existente será reservado; OPs serão criadas em rascunho para o déficit. Nenhuma OP será liberada automaticamente e nenhuma compra será criada automaticamente."
        confirmLabel="Aplicar Plano"
        confirmTone="accent"
        onCancel={() => setApplyDialogOpen(false)}
        onConfirm={handleApplyPlan}
      />

      <ConfirmDialog
        open={generateDialogOpen}
        title="Gerar Ordens de Compra em rascunho?"
        message="Serão criadas OCs DRAFT agrupadas por fornecedor; nenhuma OC será enviada/confirmada automaticamente; preços permanecerão em branco; as OCs poderão ser revisadas no módulo de Compras."
        confirmLabel="Gerar OCs em rascunho"
        confirmTone="accent"
        onCancel={() => setGenerateDialogOpen(false)}
        onConfirm={handleGenerateDrafts}
      />

      {cancelDialogOpen && (
        <>
          <ModalDialog labelledBy="cancel-co-title" onClose={() => setCancelDialogOpen(false)}>
            <h2 id="cancel-co-title">Cancelar pedido?</h2>
            <p>{customerOrder?.code} permanecerá no histórico. Esta ação não pode ser desfeita.</p>
            <div className="field">
              <label htmlFor="co-cancel-reason">
                Motivo do cancelamento <span className="req">*</span>
              </label>
              <textarea
                id="co-cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </div>
            <div className="confirm-dialog__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setCancelDialogOpen(false)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={cancelReason.trim().length < 3 || saving}
                onClick={handleCancelConfirm}
              >
                Cancelar pedido
              </button>
            </div>
          </ModalDialog>
        </>
      )}

    </>
  );
}
