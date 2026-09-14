import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import {
  assinaturaDoDocumento,
  decimalComparavel,
  textoComparavel,
} from "../../lib/dirty-fields";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import type {
  CustomerDTO,
  CustomerOrderDTO,
  CustomerOrderStatus,
  FulfillmentPlanDTO,
  ProductDTO,
  PlanPurchaseSourcingDTO,
  PurchaseSuggestionDTO,
  PurchaseSuggestionRowDTO,
  PurchaseSupplierCandidateDTO,
  ReservationStatusDTO,
  ReservationStatusLineDTO,
  ShipmentStatus,
  SupplierDTO,
} from "@veridi/shared";
import {
  Decimal,
  BILLING_STATUS_LABELS,
  INVENTORY_UNAVAILABLE_REASON_LABELS,
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
import { complementoDeQuantidade } from "../../lib/quantity-complement";
import { excedeLimiteExibido, resolverQuantidadeContraLimite } from "../../lib/quantity-limit";
import {
  decimalLegivel,
  erroDoDecimal,
  exigirDecimal,
  exigirDecimalOpcional,
} from "../../lib/decimal-field";
import { toPtBrEditText, formatDecimalPtBr, formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { CASAS_QUANTIDADE, OPCOES_QUANTIDADE, OPCOES_PRECO_UNITARIO } from "../../lib/numeric-scales";
import { DecimalField } from "../../components/NumericField";
import { FormSection } from "../../components/FormSection";
import { ContextHelp, InfoHint } from "../../components/help";
import { DeliveryScheduleSection } from "./DeliveryScheduleSection";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { AgreedPriceCell, CommercialOriginSection } from "./CommercialOriginSection";
import { FlowContext } from "../../components/FlowContext";
import type { FlowStep } from "../../components/FlowContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink } from "../../components/EntityLink";
import { formatDate, formatDateTime } from "../../lib/dates";
import { ModalDialog } from "../../components/ModalDialog";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { TableEmptyRow } from "../../components/TableEmptyRow";

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

/** Primeira página e tamanho de cada busca do fornecedor da sugestão de compra. */
const PAGINA_DE_FORNECEDORES_DA_COMPRA = 20;

/** Mescla sem duplicar e sem trocar a referência à toa. */
function mesclarFornecedores(atual: SupplierDTO[], novos: SupplierDTO[]): SupplierDTO[] {
  const conhecidos = new Set(atual.map((supplier) => supplier.id));
  const ineditos = novos.filter((supplier) => !conhecidos.has(supplier.id));
  return ineditos.length === 0 ? atual : [...atual, ...ineditos];
}

/** Sem caixa e sem acento: quem digita rápido não acentua. */
function semAcento(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Homologado do material — o grupo "Homologados" que o `<select>` tinha virou a dica. */
function opcaoDeCandidato(candidate: PurchaseSupplierCandidateDTO): EntityOption {
  return {
    id: candidate.supplierId,
    code: candidate.supplierCode,
    name: candidate.supplierName,
    hint: candidate.preferred ? "Homologado · preferencial" : "Homologado",
  };
}

/** Demais fornecedores ativos: compra emergencial/amostra continua possível. */
function opcaoDeFornecedorAtivo(supplier: SupplierDTO): EntityOption {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.tradeName ?? supplier.legalName,
    searchTerms: supplier.legalName,
  };
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
    // Texto do campo, em português: é o que a linha edita.
    orderedQuantity: toPtBrEditText(line.orderedQuantity, OPCOES_QUANTIDADE),
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
  const valor = decimalLegivel(limpo, OPCOES_QUANTIDADE);
  return valor === null || new Decimal(valor).greaterThan(0);
}

/**
 * O que a linha da Reserva Complementar responde sobre disponibilidade.
 *
 * DERIVADO da resposta do servidor a cada render, nunca guardado: estado
 * que mora em `useState` sobrevive à correção do fato que o criou — foi
 * assim que o alerta do recebimento ficou preso na tela (F-06-2).
 *
 * `COBERTA` não é "indisponível": a linha simplesmente não tem mais nada a
 * reservar, e cobrá-la de estoque seria alarme falso.
 */
type DisponibilidadeDaLinha =
  | "COBERTA"
  | "DISPONIVEL"
  | "PARCIAL"
  | "INDISPONIVEL";

function disponibilidadeDaLinha(line: ReservationStatusLineDTO): DisponibilidadeDaLinha {
  const falta = new Decimal(line.stillToReserve);
  if (falta.lessThanOrEqualTo(0)) return "COBERTA";
  const disponivel = new Decimal(line.currentAvailable);
  if (disponivel.lessThanOrEqualTo(0)) return "INDISPONIVEL";
  return disponivel.greaterThanOrEqualTo(falta) ? "DISPONIVEL" : "PARCIAL";
}

/**
 * "1.000 un aguardando liberação da Qualidade · 20 un vencido".
 *
 * As causas são as do domínio (`getUnavailabilityByItems`), as MESMAS que a
 * Posição de Estoque escreve — a tela traduz o código para português e não
 * inventa uma segunda leitura. Lista vazia significa que nada está retido,
 * o que é um fato diferente de "não sabemos".
 */
function explicarRetencao(line: ReservationStatusLineDTO): string {
  return line.unavailable
    .map(
      (linha) =>
        `${formatQuantity(linha.quantity)} ${line.unitCode} ${INVENTORY_UNAVAILABLE_REASON_LABELS[linha.reason]}`,
    )
    .join(" · ");
}

/**
 * O complemento de uma linha do Plano: o que não é reservado é produzido.
 *
 * Campo em branco continua valendo zero — o complemento vira o pedido
 * inteiro, como sempre foi. O que muda é `2,5`: era `NaN` e apagava o outro
 * campo sem explicar; agora é dois e meio.
 *
 * A subtração é em `Decimal` porque este número **é enviado**: passar
 * quantidade por `Number` aqui devolveria ao servidor um complemento com
 * ruído de ponto flutuante, e `10.000000000001 - 3` deixaria de fechar com o
 * pedido na décima segunda casa — §66. Zero é zero, nunca `-0`.
 */
function complementoDaLinha(pedido: string, digitado: string): string {
  const valor = digitado.trim() === "" ? "0" : decimalLegivel(digitado, OPCOES_QUANTIDADE);
  if (valor === null) return "";
  // O complemento vai para o OUTRO campo: no texto do campo, em português.
  return toPtBrEditText(complementoDeQuantidade(pedido, valor), OPCOES_QUANTIDADE);
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
  /*
   * A ação em curso pelo nome: "Salvando…" aparecia no botão de salvar
   * também enquanto o pedido era confirmado ou cancelado. O freio de clique
   * duplo continua um só (`saving`); o rótulo, não. Confirmar com pendência
   * passa por "salvar-para-confirmar" antes de "confirmar": o botão de
   * confirmar diz a etapa (CONFIRM-DISCARDS-DIRTY-01).
   */
  const [acaoEmCurso, setAcaoEmCurso] = useState<
    "rascunho" | "prazo" | "salvar-para-confirmar" | "confirmar" | "cancelar" | null
  >(null);
  const saving = acaoEmCurso !== null;
  /** O que a última gravação confirmou — uma frase, substituída pela próxima. */
  const [feito, setFeito] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /*
   * Erro de AÇÃO leva a pessoa até o alerta. Ele mora no topo do documento e os
   * botões — salvar, confirmar, plano, reservas — ficam lá embaixo: em 390px a
   * recusa aparecia fora da vista e o clique parecia não ter efeito. Um alerta
   * só, trazido à vista e com foco; erro de CARGA não rola a tela de ninguém.
   */
  const alertaRef = useRef<HTMLParagraphElement>(null);
  const [errosDeAcao, setErrosDeAcao] = useState(0);
  function avisarErro(mensagem: string) {
    setError(mensagem);
    setErrosDeAcao((total) => total + 1);
  }
  useEffect(() => {
    if (errosDeAcao === 0) return;
    // jsdom não implementa `scrollIntoView`; no navegador ele existe sempre.
    alertaRef.current?.scrollIntoView?.({ block: "center" });
    alertaRef.current?.focus();
  }, [errosDeAcao]);

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
  /**
   * Consulta que falhou não é estoque que falta.
   *
   * A seção inteira sumia da tela quando `getReservationStatus` rejeitava —
   * o mesmo `null` do "ainda não carregou". Quem tentasse reservar depois de
   * uma falha de rede via o assunto desaparecer, e a leitura óbvia ("não há
   * o que reservar") é justamente a que o sistema não sabe afirmar.
   */
  const [reservationStatusError, setReservationStatusError] = useState(false);
  const [reserveInputs, setReserveInputs] = useState<Record<string, string>>({});
  const [reserving, setReserving] = useState(false);
  const [reallocatingLineId, setReallocatingLineId] = useState<string | null>(null);
  const [preparingShipment, setPreparingShipment] = useState(false);

  /**
   * A assinatura do pedido de referência — o que sair daqui não se perde.
   *
   * `null` é "retome na próxima renderização". Toda leitura do servidor passa
   * por `syncFormFromServer` — salvar, confirmar, cancelar, reservar, aplicar
   * plano —, então a pendência zera sem cada caminho ter que lembrar disso.
   */
  const baseline = useRef<string | null>(null);

  const syncFormFromServer = useCallback((order: CustomerOrderDTO) => {
    setCustomerId(order.customerId);
    setRequestedDeliveryDate(toDateInputValue(order.requestedDeliveryDate));
    setNotes(order.notes ?? "");
    setLines(order.lines.map(lineFromDTO));
    baseline.current = null;
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
  }, []);

  /**
   * Qual cliente as respostas de produto em voo estão servindo.
   *
   * Trocar de cliente durante a busca é rápido, e a resposta do anterior chega
   * depois. Sem esta comparação o catálogo de A apareceria no seletor de B —
   * exatamente o produto que o backend recusaria no salvamento.
   */
  const clienteDoCatalogo = useRef("");

  /*
   * O catálogo de produtos é o DO CLIENTE, resolvido no servidor.
   *
   * Produto pertence a um cliente. Enquanto a tela pedia o catálogo inteiro,
   * ela oferecia produto de qualquer cliente dentro do documento de um só —
   * e a recusa só aparecia muito depois, na Ordem de Produção. Filtrar no
   * navegador não serve: a página carregada é um teto, e o produto elegível
   * que estivesse além dele sumiria sem aviso. Quem filtra é o banco.
   */
  useEffect(() => {
    clienteDoCatalogo.current = customerId;
    // Sem cliente não há catálogo — e o seletor de produto está desabilitado.
    setActiveProducts([]);
    if (!customerId) return;
    const doPedido = customerId;
    // Produto técnico de projeto não é opção operacional.
    listProducts({ active: true, lifecycle: "APPROVED", customerId: doPedido, pageSize: 50 })
      .then((result) => {
        if (clienteDoCatalogo.current !== doPedido) return;
        setActiveProducts((atual) => {
          /*
           * A página do catálogo ENTRA, não substitui. O que já está no estado
           * depois da troca de cliente é deste cliente — o produto recém
           * cadastrado na tela oficial, que volta pelo id — e substituir aqui
           * o apagava quando esta resposta chegasse depois dele.
           */
          const naPagina = new Set(result.products.map((produto) => produto.id));
          return [
            ...result.products,
            ...atual.filter((produto) => !naPagina.has(produto.id)),
          ];
        });
      })
      .catch(() => {
        if (clienteDoCatalogo.current !== doPedido) return;
        setActiveProducts([]);
      });
  }, [customerId]);

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
    // Sem cliente o campo está desabilitado; a guarda existe para que nenhum
    // caminho futuro consiga buscar no catálogo inteiro por aqui.
    if (!customerId) return [];
    const doPedido = customerId;
    const resultado = await listProducts({
      active: true,
      lifecycle: "APPROVED",
      customerId: doPedido,
      search: termo,
      pageSize: 50,
    });
    // Chegou depois de o cliente mudar: nem entra no catálogo, nem na lista.
    if (clienteDoCatalogo.current !== doPedido) return [];
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
  /*
   * Cliente e produtos do pedido andam juntos: o produto pertence a um
   * cliente. Com produto escolhido, trocar o cliente deixaria o documento
   * inconsistente — e as duas saídas automáticas são piores que o bloqueio:
   * apagar as linhas descartaria trabalho em silêncio, e mantê-las criaria a
   * mistura de propriedade. Quem decide é quem opera, removendo as linhas.
   */
  const clienteTravadoPorLinhas = lines.some((line) => line.productId !== "");
  /*
   * Linhas herdadas de antes desta regra — produto de outro cliente dentro
   * deste pedido. Nada é corrigido aqui: o documento continua abrindo, o
   * aviso aparece, e o servidor recusa a confirmação.
   */
  const linhasInconsistentes = (customerOrder?.lines ?? []).filter(
    (line) => line.productCustomerMismatch,
  );
  /*
   * IN_FULFILLMENT entra aqui porque o domínio SEMPRE permitiu cancelar
   * nesse estado — desde que não sobre reserva de produto acabado ativa nem
   * Ordem de Produção viva (`cancelCustomerOrder`). A tela escondia a ação,
   * então resolver as dependências pelo caminho oficial não devolvia o
   * Pedido: ele ficava em atendimento para sempre, sem saída pela interface.
   *
   * O servidor continua sendo a autoridade e recusa com o motivo quando
   * ainda houver dependência — oferecer a ação não é liberá-la. Expedição
   * confirmada (PARTIALLY_SHIPPED/SHIPPED) segue fora: ali a saída física
   * não se desfaz com um cancelamento simples.
   */
  const isCancellable =
    !isNew && (status === "DRAFT" || status === "CONFIRMED" || status === "IN_FULFILLMENT");
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
  /*
   * Entregas programadas aparecem a partir da CONFIRMAÇÃO: antes disso não
   * existe compromisso a prometer, e num pedido cancelado a promessa deixou
   * de valer — a seção fica em leitura, sem esconder o histórico.
   */
  const showDeliverySchedule =
    !isNew && ["CONFIRMED", "IN_FULFILLMENT", "PARTIALLY_SHIPPED", "SHIPPED", "CANCELLED"].includes(status);
  const deliveryScheduleEditable = ["CONFIRMED", "IN_FULFILLMENT", "PARTIALLY_SHIPPED"].includes(status);
  const showPurchaseSuggestion = !isNew && status === "IN_FULFILLMENT";

  /**
   * O pedido como ele está na tela, em forma comparável.
   *
   * Só o que o salvamento envia. Código, nome e unidade do produto vêm do
   * servidor e chegam depois — na linha recém-criada a unidade fica vazia até
   * o Produto Acabado existir —, e compará-los faria a tela se declarar
   * alterada por conta própria.
   */
  const assinaturaAtual = assinaturaDoDocumento({
    customerId: textoComparavel(customerId),
    requestedDeliveryDate: textoComparavel(requestedDeliveryDate),
    notes: textoComparavel(notes),
    lines: lines.map((line) => ({
      productId: textoComparavel(line.productId),
      orderedQuantity: decimalComparavel(line.orderedQuantity),
    })),
  });

  if (baseline.current === null) baseline.current = assinaturaAtual;
  /* Pedido cancelado não tem o que salvar; fora do rascunho ainda se altera
     prazo e observações, e isso também se perde ao sair. A mesma pendência
     prende a saída, acende a faixa e acorda os botões de salvar. */
  const alteracaoPendente = temBotaoDeSalvar && baseline.current !== assinaturaAtual;
  const { liberarGuarda } = useUnsavedChangesGuard({
    isDirty: alteracaoPendente,
    substantivo: "pedido",
  });

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
      avisarErro(apiErrorMessage(err, "Falha ao gerar OP para o saldo restante"));
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
            reserve: toPtBrEditText(line.suggestedReserveQuantity, OPCOES_QUANTIDADE),
            produce: toPtBrEditText(line.suggestedProductionQuantity, OPCOES_QUANTIDADE),
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
              quantity: toPtBrEditText(
                recommended?.recommendedPurchaseQuantity ?? row.newSuggestedPurchase,
                OPCOES_QUANTIDADE,
              ),
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

  /*
   * Fornecedores ativos do seletor da sugestão de compra: primeira página e
   * busca no servidor. Eram os 1000 primeiros num `<select>` — do fornecedor
   * ativo 1001 em diante a compra emergencial não tinha a quem ir. A página
   * ENTRA, não substitui: o achado pela busca e já escolhido numa linha
   * continua com nome quando a seção recarrega.
   */
  useEffect(() => {
    if (!showPurchaseSuggestion) return;
    listSuppliers({ active: true, pageSize: PAGINA_DE_FORNECEDORES_DA_COMPRA })
      .then((result) => setActiveSuppliers((atual) => mesclarFornecedores(result.suppliers, atual)))
      .catch(() => undefined);
  }, [showPurchaseSuggestion]);

  /**
   * Busca no SERVIDOR, com o MESMO filtro da primeira página: só ativos. Os
   * homologados do material vêm primeiro, como no grupo que o `<select>`
   * tinha — e são procurados também entre os candidatos da linha, para que
   * um homologado nunca fique de fora por não caber na página da busca.
   */
  async function buscarFornecedoresDaCompra(
    row: PurchaseSuggestionRowDTO,
    termo: string,
  ): Promise<EntityOption[]> {
    const { suppliers: achados } = await listSuppliers({
      active: true,
      search: termo,
      pageSize: PAGINA_DE_FORNECEDORES_DA_COMPRA,
    });
    setActiveSuppliers((atual) => mesclarFornecedores(atual, achados));
    const procurado = semAcento(termo);
    const candidatos = row.supplierCandidates.filter((candidate) =>
      semAcento(`${candidate.supplierCode} ${candidate.supplierName}`).includes(procurado),
    );
    const homologados = new Set(row.supplierCandidates.map((candidate) => candidate.supplierId));
    return [
      ...candidatos.map(opcaoDeCandidato),
      ...achados.filter((supplier) => !homologados.has(supplier.id)).map(opcaoDeFornecedorAtivo),
    ];
  }

  const reloadReservationStatus = useCallback(() => {
    if (!id) return;
    getReservationStatus(id)
      .then((result) => {
        setReservationStatusError(false);
        setReservationStatus(result);
        setReserveInputs((prev) => {
          const next: Record<string, string> = {};
          for (const line of result.lines) {
            next[line.customerOrderLineId] =
              prev[line.customerOrderLineId] ??
              toPtBrEditText(line.suggestedAdditionalReserve, OPCOES_QUANTIDADE);
          }
          return next;
        });
      })
      .catch(() => {
        setReservationStatus(null);
        setReservationStatusError(true);
      });
  }, [id]);

  useEffect(() => {
    if (!isOperational || !id) {
      setReservationStatus(null);
      setReservationStatusError(false);
      return;
    }
    setReservationStatusError(false);
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
        taxProfile: "NOT_INFORMED",
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

  function optionsForRow(row: LineRow): EntityOption[] {
    const usedByOtherRows = new Set(lines.filter((l) => l.key !== row.key).map((l) => l.productId));
    const base = activeProducts
      .filter((product) => !usedByOtherRows.has(product.id) && product.finishedProductItem)
      .map((product) => ({ id: product.id, code: product.code, name: product.name }));
    if (!row.productId || base.some((option) => option.id === row.productId)) return base;
    /*
     * O produto já escolhido nesta linha não está no catálogo do cliente.
     *
     * Acontece em pedido herdado de antes da regra de propriedade: o catálogo
     * é do cliente do documento e o produto é de outro. A opção sintética
     * existe para o campo continuar LEGÍVEL — o aviso de inconsistência está
     * logo acima e a confirmação é recusada pelo servidor. Esconder o nome só
     * deixaria a linha em branco, parecendo que nada foi escolhido.
     */
    return [
      ...base,
      { id: row.productId, code: row.productCode, name: row.productName },
    ];
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

  /**
   * O que "Salvar rascunho" envia — e o que "Confirmar pedido" grava antes de
   * confirmar. Um funil só: a conversão acontece aqui dentro, e uma quantidade
   * ilegível interrompe com o produto nomeado, antes de a requisição sair.
   */
  function payloadDoRascunho() {
    const linesPayload = lines
      .filter((line) => line.productId)
      .map((line) => ({
        productId: line.productId,
        orderedQuantity: exigirDecimal(
          line.orderedQuantity,
          `Quantidade de ${line.productCode || "produto"}`,
          OPCOES_QUANTIDADE,
        ),
      }));

    const requestedIso = toIsoOrEmpty(requestedDeliveryDate);

    return {
      customerId,
      notes: notes.trim(),
      lines: linesPayload,
      ...(requestedIso ? { requestedDeliveryDate: requestedIso } : {}),
    };
  }

  /** A recusa da gravação: campo a campo quando a API diz qual, a frase quando não. */
  function mostrarRecusaDaGravacao(err: unknown) {
    if (err instanceof ApiValidationError) {
      const nextFieldErrors: Record<string, string> = {};
      for (const issue of err.issues) {
        nextFieldErrors[issue.path] = issue.message;
      }
      setFieldErrors(nextFieldErrors);
      avisarErro("Corrija os campos destacados.");
    } else {
      avisarErro(apiErrorMessage(err, "Falha ao salvar pedido"));
    }
  }

  async function handleSaveDraft() {
    setFeito(null);
    if (!customerId) {
      avisarErro("Selecione um cliente.");
      return;
    }

    setAcaoEmCurso("rascunho");
    setError(null);
    setFieldErrors({});

    try {
      const payload = payloadDoRascunho();

      if (isNew) {
        const created = await createCustomerOrder(payload);
        /*
         * Gravou: o que está na tela virou documento. A troca de endereço
         * acontece nesta mesma função, antes de qualquer renderização — sem
         * isto a guarda leria a pendência de antes do salvamento e perguntaria
         * se a pessoa quer descartar o que ela acabou de gravar.
         */
        baseline.current = assinaturaAtual;
        liberarGuarda(() => navigate(`/comercial/pedidos/${created.id}`, { replace: true }));
      } else if (id) {
        const updated = await updateCustomerOrder(id, payload);
        setCustomerOrder(updated);
        syncFormFromServer(updated);
        // Só com a resposta do servidor: validação ou rede nunca viram "salvo".
        setFeito("Rascunho salvo.");
      }
    } catch (err) {
      mostrarRecusaDaGravacao(err);
    } finally {
      setAcaoEmCurso(null);
    }
  }

  async function handleSaveNotesOnly() {
    if (!id) return;
    setAcaoEmCurso("prazo");
    setError(null);
    setFeito(null);
    try {
      const requestedIso = toIsoOrEmpty(requestedDeliveryDate);
      const updated = await updateCustomerOrder(id, {
        notes: notes.trim(),
        ...(requestedIso ? { requestedDeliveryDate: requestedIso } : {}),
      });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      setFeito("Prazo e observações salvos.");
    } catch (err) {
      avisarErro(apiErrorMessage(err, "Falha ao salvar"));
    } finally {
      setAcaoEmCurso(null);
    }
  }

  async function handleConfirm() {
    if (!id || saving) return;
    setConfirmDialogOpen(false);
    setError(null);
    setFeito(null);
    /*
     * Gravar antes de agir (CONFIRM-DISCARDS-DIRTY-01). O servidor confirma o
     * pedido GRAVADO e congela produtos, quantidades e o cliente: confirmar com
     * alteração pendente congelava o que estava salvo, e a releitura apagava da
     * tela o que foi digitado. A pendência é a da guarda — a mesma que acende a
     * faixa e acorda o salvar —, e sem ela nada é gravado de novo.
     */
    if (alteracaoPendente) {
      if (!customerId) {
        avisarErro("Selecione um cliente.");
        return;
      }
      setAcaoEmCurso("salvar-para-confirmar");
      setFieldErrors({});
      try {
        const salvo = await updateCustomerOrder(id, payloadDoRascunho());
        /* A gravação vale por si: recusada a confirmação, a tela fica com o
           gravado e sem pendência — nunca com o que foi lido antes. */
        setCustomerOrder(salvo);
        syncFormFromServer(salvo);
      } catch (err) {
        // Gravação recusada não confirma: o digitado e a pendência ficam.
        mostrarRecusaDaGravacao(err);
        setAcaoEmCurso(null);
        return;
      }
    }
    setAcaoEmCurso("confirmar");
    try {
      const updated = await confirmCustomerOrder(id);
      setCustomerOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      avisarErro(apiErrorMessage(err, "Falha ao confirmar pedido"));
    } finally {
      setAcaoEmCurso(null);
    }
  }

  async function handleCancelConfirm() {
    if (!id) return;
    setAcaoEmCurso("cancelar");
    setError(null);
    setFeito(null);
    try {
      const updated = await cancelCustomerOrder(id, { reason: cancelReason.trim() });
      setCancelDialogOpen(false);
      setCancelReason("");
      setCustomerOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      avisarErro(apiErrorMessage(err, "Falha ao cancelar pedido"));
    } finally {
      setAcaoEmCurso(null);
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
      const reservado = decimalLegivel(adjustment.reserve.trim() || "0", OPCOES_QUANTIDADE);
      const produzido = decimalLegivel(adjustment.produce.trim() || "0", OPCOES_QUANTIDADE);
      if (reservado === null || produzido === null) return false;
      /* A soma fecha ou não fecha: sem folga de `1e-6`. A tolerância existia
         porque a conta passava por `Number`, e em `Decimal` ela não é
         necessária — §66. O domínio também não a reconhece: um plano que só
         "quase" fecha é um plano que não fecha. */
      return new Decimal(reservado).plus(produzido).equals(new Decimal(line.orderedQuantity));
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
    /* Havia aqui uma folga de `1e-6` — a tolerância que o domínio recusa por
       escrito. Ela existia para contornar o mesmo problema que o helper
       resolve de verdade: o disponível exibido é resumido, o real tem doze
       casas, e digitar o número da tela não pode virar "acima do limite". */
    return plan.lines.filter((line) =>
      excedeLimiteExibido(
        planAdjustments[line.customerOrderLineId]?.reserve ?? "",
        line.finishedGoodsAvailable,
      ),
    );
  }, [plan, planAdjustments]);

  /*
   * Um ajuste que nem o parser lê. O aviso de "precisa somar" está certo
   * para quem digitou 3 onde cabia 5, e completamente errado para quem
   * digitou o `1.234` ambíguo — nesse caso a soma nem existe. A frase é a do
   * campo, com o motivo (PTBR-NUMERIC-INPUT-ROLLOUT-01).
   */
  const ajustePlanoIlegivel = useMemo((): string | null => {
    if (!plan) return null;
    for (const line of plan.lines) {
      const adjustment = planAdjustments[line.customerOrderLineId];
      if (!adjustment) continue;
      const erro =
        erroDoDecimal(`Reservar de ${line.productCode}`, adjustment.reserve, OPCOES_QUANTIDADE) ??
        erroDoDecimal(`Produzir de ${line.productCode}`, adjustment.produce, OPCOES_QUANTIDADE);
      if (erro) return erro;
    }
    return null;
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
          /* Reservar o disponível que a tela mostra é reservar TUDO o que
             existe: vai o valor canônico, não o texto resumido — senão a
             validação da tela aprova e o servidor recusa o mesmo número. */
          const reserva = resolverQuantidadeContraLimite(
            adjustment.reserve,
            line.finishedGoodsAvailable,
          );
          return {
            customerOrderLineId: line.customerOrderLineId,
            reserveQuantity:
              reserva.status === "ok"
                ? reserva.valorCanonico
                : (exigirDecimalOpcional(
                    adjustment.reserve,
                    `Reservar de ${line.productCode}`,
                    OPCOES_QUANTIDADE,
                  ) ?? "0"),
            produceQuantity:
              exigirDecimalOpcional(
                adjustment.produce,
                `Produzir de ${line.productCode}`,
                OPCOES_QUANTIDADE,
              ) ?? "0",
          };
        }),
      });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      setPlan(null);
    } catch (err) {
      avisarErro(apiErrorMessage(err, "Falha ao aplicar plano de atendimento"));
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
        quantity:
          candidate?.recommendedPurchaseQuantity !== undefined && candidate.recommendedPurchaseQuantity !== null
            ? toPtBrEditText(candidate.recommendedPurchaseQuantity, OPCOES_QUANTIDADE)
            : (prev[itemId]?.quantity ?? "0"),
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
            quantity: exigirDecimal(line.quantity, `Comprar de ${codigo}`, OPCOES_QUANTIDADE),
          };
        }),
      });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      reloadSuggestion();
    } catch (err) {
      avisarErro(apiErrorMessage(err, "Falha ao gerar Ordens de Compra"));
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
              OPCOES_QUANTIDADE,
            ) ?? "0",
        }))
        .filter((line) => new Decimal(line.quantity).greaterThan(0));
      if (lines.length === 0) return;

      const updated = await reserveAvailable(id, { lines });
      setCustomerOrder(updated);
      syncFormFromServer(updated);
      setReserveInputs({});
      reloadReservationStatus();
    } catch (err) {
      avisarErro(apiErrorMessage(err, "Falha ao reservar produto acabado"));
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
      avisarErro(apiErrorMessage(err, "Falha ao realocar reserva"));
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
      avisarErro(apiErrorMessage(err, "Falha ao preparar expedição"));
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
              PDF
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
        {/* Com o diálogo de cancelamento aberto, o erro mora nele: aqui ficaria atrás. */}
        {error && !cancelDialogOpen && (
          <p className="form-alert" role="alert" ref={alertaRef} tabIndex={-1}>
            {error}
          </p>
        )}

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
                  disabled={clienteTravadoPorLinhas}
                  placeholder={
                    clienteTravadoPorLinhas
                      ? "Remova os produtos para trocar o cliente"
                      : "Digite código ou nome do cliente…"
                  }
                  onSearch={buscarClientes}
options={customerOptions.map((customer) => ({
                    id: customer.id,
                    code: customer.code,
                    name: customer.tradeName ?? customer.legalName,
                    ...(customer.active ? {} : { hint: "inativo" }),
                  }))}
                  canCreate
                  createLabel="Novo cliente"
                  /* Sair para cadastrar NÃO é descartar: o rascunho vai junto
                     e volta aplicado. */
                  onCreateNew={() =>
                    liberarGuarda(() =>
                      origem.goCreate({
                        route: "/cadastros/clientes/novo",
                        fieldKey: "customerId",
                        entityType: "customer",
                      }),
                    )
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
              {isDraft && clienteTravadoPorLinhas && (
                <p className="field__hint" id="co-customer-locked" role="status">
                  Remova os produtos do pedido antes de alterar o cliente — cada produto
                  pertence a um cliente.
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
          {/*
            Pedido herdado de antes da regra: produto de um cliente dentro do
            documento de outro. Nada é corrigido sozinho — o pedido continua
            abrindo e o aviso diz por que a confirmação vai ser recusada.
          */}
          {linhasInconsistentes.length > 0 && (
            <p className="form-alert" role="alert">
              {linhasInconsistentes.length === 1
                ? "Este pedido tem um produto que pertence a outro cliente"
                : `Este pedido tem ${linhasInconsistentes.length} produtos que pertencem a outro cliente`}
              {" — "}
              {linhasInconsistentes.map((line) => `${line.productCode} ${line.productName}`).join("; ")}.
              Enquanto essas linhas existirem, o pedido não pode ser confirmado. Remova-as e
              escolha produtos do cliente deste pedido.
            </p>
          )}

          {/*
            Cliente primeiro, produto depois: o catálogo oferecido é o do
            cliente do pedido, então antes dele não há o que escolher.
          */}
          {linhasEditaveis && !customerId && (
            <p className="field__hint" role="status">
              Selecione o cliente primeiro — o sistema mostra apenas os produtos vinculados a ele.
            </p>
          )}

          <div className="table-container">
            {/* Produto é a coluna de decisão: fica com o espaço, e a busca
                dentro dela precisa de largura para nomes longos. Em edição,
                a tela estreita empilha a linha (ORDER-LINE-390-OVERLAP-01). */}
            <table
              className={`table table--order-lines${linhasEditaveis ? " table--order-lines--editable" : ""}`}
            >
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
                          /*
                           * A identidade do campo inclui o cliente: trocar de
                           * cliente monta um campo novo, e nem o texto digitado
                           * nem o resultado da busca anterior sobrevivem à troca.
                           */
                          key={`${line.key}-${customerId}`}
                          id={`pedido-produto-${line.key}`}
                          value={line.productId}
                          onChange={(productId) => handleLineProductChange(line.key, productId)}
                          disabled={!customerId}
                          placeholder={
                            customerId
                              ? "Digite código ou nome do produto…"
                              : "Selecione o cliente primeiro."
                          }
                          noOptionsMessage="Este cliente ainda não possui produtos disponíveis para pedido."
                          onSearch={buscarProdutos}
                          options={optionsForRow(line)}
                          canCreate
                          createLabel="Novo produto"
                          onCreateNew={() =>
                            liberarGuarda(() =>
                              origem.goCreate({
                                route: "/cadastros/produtos/novo",
                                fieldKey: "productId",
                                entityType: "product",
                                context: contextoDoProdutoNovo(line.key),
                              }),
                            )
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
                        <DecimalField
                          scale={CASAS_QUANTIDADE}
                          placeholder="Quantidade"
                          // Placeholder some ao digitar e nenhum leitor de tela
                          // o usa como nome: sem isto, o campo que decide a
                          // quantidade do pedido era só "editar texto".
                          aria-label={`Quantidade de ${line.productCode || "produto"}`}
                          value={line.orderedQuantity}
                          onChangeValue={(valor) => handleLineQuantityChange(line.key, valor)}
                        />
                      ) : (
                        // Fora de edição a linha guarda o texto do campo (`1234,5`):
                        // lido de volta e exibido como leitura, com milhar.
                        formatQuantity(decimalLegivel(line.orderedQuantity, OPCOES_QUANTIDADE) ?? line.orderedQuantity)
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
                        {formatQuantity(customerOrder?.lines.find((l) => l.productId === line.productId)?.shippedQuantity)}
                      </td>
                    )}
                    {!isDraft && (
                      <td className="is-numeric">
                        {formatQuantity(
                          customerOrder?.lines.find((l) => l.productId === line.productId)?.outstandingQuantity,
                        )}
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
                  <TableEmptyRow colSpan={(isDraft ? 4 : 5) + (temPrecoAcordado ? 1 : 0)}>
                    Nenhum produto adicionado.
                  </TableEmptyRow>
                )}
              </tbody>
            </table>
          </div>

          {linhasEditaveis && (
            <div className="line-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                // Sem cliente a linha nasceria com um seletor desabilitado.
                disabled={!customerId}
                onClick={handleAddLine}
              >
                + Adicionar produto
              </button>
            </div>
          )}
        </FormSection>

        {showDeliverySchedule && id && (
          <DeliveryScheduleSection customerOrderId={id} editable={deliveryScheduleEditable} />
        )}

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
                            <td className="is-numeric">{formatQuantity(line.finishedGoodsAvailable)}</td>
                            <td>
                              {/* Sem nome acessível, um leitor de tela anuncia
                                  só "editar texto" no campo que decide reserva
                                  de um pedido confirmado. */}
                              <DecimalField
                                scale={CASAS_QUANTIDADE}
                                aria-label={`Reservar de ${line.productCode}`}
                                value={adjustment.reserve}
                                onChangeValue={(valor) =>
                                  handleAdjustReserve(line.customerOrderLineId, line.orderedQuantity, valor)
                                }
                              />
                            </td>
                            <td>
                              <DecimalField
                                scale={CASAS_QUANTIDADE}
                                aria-label={`Produzir de ${line.productCode}`}
                                value={adjustment.produce}
                                onChangeValue={(valor) =>
                                  handleAdjustProduce(line.customerOrderLineId, line.orderedQuantity, valor)
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
                  <p className="field__hint">{ajustePlanoIlegivel}</p>
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
                                {row.supplyResponsibility === "CUSTOMER" ? "—" : formatQuantity(row.onOrder)}
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
                                          {formatDecimalPtBr(candidate.referenceUnitPrice, { ...OPCOES_PRECO_UNITARIO, minFractionDigits: 2 })}{" "}
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
                            {/* Quantidade da API é DECIMAL(24,12) em string: sem
                                `formatQuantity` a necessidade sai `6.122448979592`,
                                com ponto decimal, ao lado do mesmo número
                                formatado na tabela de cima (F-07-1). */}
                            <td className="is-numeric">
                              {formatQuantity(row.remainingRequired)} {row.unitCode}
                            </td>
                            <td>{formatQuantity(row.ownReserved)}</td>
                            <td className="is-numeric">{formatQuantity(row.available)}</td>
                            <td className="is-numeric">{formatQuantity(row.onOrder)}</td>
                            <td>{formatQuantity(row.operationalShortage)}</td>
                            <td>{formatQuantity(row.draftPurchaseQuantity)}</td>
                            <td>{formatQuantity(row.newSuggestedPurchase)}</td>
                            <td>
                              <DecimalField
                                scale={CASAS_QUANTIDADE}
                                aria-label={`Comprar de ${row.itemCode}`}
                                value={input.quantity}
                                onChangeValue={(valor) => handleDraftQuantityChange(row.itemId, valor)}
                              />
                            </td>
                            <td>
                              <label className="sr-only" htmlFor={`purchase-supplier-${row.itemId}`}>
                                Fornecedor de {row.itemCode}
                              </label>
                              {/* Homologados primeiro, marcados na dica. Compra
                                  emergencial/amostra continua possivel: a
                                  homologacao orienta, nao bloqueia o modulo de
                                  compras — os demais ativos vêm na primeira
                                  página e na busca do servidor. */}
                              <SearchableEntitySelect
                                id={`purchase-supplier-${row.itemId}`}
                                value={input.supplierId}
                                onChange={(supplierId) => handleDraftSupplierChange(row.itemId, supplierId)}
                                placeholder="Selecionar…"
                                options={[
                                  ...row.supplierCandidates.map(opcaoDeCandidato),
                                  ...activeSuppliers
                                    .filter(
                                      (supplier) =>
                                        !row.supplierCandidates.some(
                                          (candidate) => candidate.supplierId === supplier.id,
                                        ),
                                    )
                                    .map(opcaoDeFornecedorAtivo),
                                ]}
                                onSearch={(termo) => buscarFornecedoresDaCompra(row, termo)}
                              />
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
                            {formatQuantity(row.remainingRequired)} {row.unitCode}
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

        {isOperational && (() => {
          const linhas = reservationStatus?.lines ?? [];
          const temAlgoReservado = linhas.some(
            (line) => Number(line.reservedRemaining) > 0,
          );
          /* Linha que ainda precisa de produto e nao tem tudo agora. Sai da
             resposta do servidor, nao de `available === 0`. */
          const travadas = linhas.filter((line) => {
            const estado = disponibilidadeDaLinha(line);
            return estado === "INDISPONIVEL" || estado === "PARCIAL";
          });
          const nadaDisponivel =
            linhas.length > 0 &&
            linhas.every((line) => disponibilidadeDaLinha(line) !== "DISPONIVEL" &&
              disponibilidadeDaLinha(line) !== "PARCIAL");
          const semValorDigitado = linhas.every(
            (line) => !temValorParaEnviar(reserveInputs[line.customerOrderLineId]),
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
            {/*
              Ajuda própria da seção: reservar é o pré-requisito da expedição
              e ele não aparece em lugar nenhum até a pessoa chegar lá e não
              encontrar nada para enviar.
            */}
            <ContextHelp
              topic={helpTopics["comercial.reservarProdutoAcabado"]}
              triggerLabel="Como funciona a reserva"
            />

            {/*
              Falha de consulta e ausência de estoque são fatos diferentes e
              a tela precisa dizer qual dos dois aconteceu. Sumir com a seção
              deixava a pessoa concluir o pior.
            */}
            {reservationStatusError && (
              <p className="form-alert" role="alert">
                Não foi possível verificar a disponibilidade do produto acabado. Isto não
                significa que falta estoque — a consulta não respondeu. Atualize a página para
                tentar de novo.
              </p>
            )}

            {!reservationStatus && !reservationStatusError && (
              <p className="field__hint" role="status">
                Verificando a disponibilidade do produto acabado…
              </p>
            )}

            {reservationStatus && (
            <>
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
                  {linhas.map((line) => (
                    <tr key={line.customerOrderLineId}>
                      <td>
                        <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                      </td>
                      <td>
                        {formatQuantity(line.orderedQuantity)} {line.unitCode}
                      </td>
                      <td className="is-numeric">{formatQuantity(line.shippedQuantity)}</td>
                      <td className="is-numeric">{formatQuantity(line.reservedRemaining)}</td>
                      <td className="is-numeric">{formatQuantity(line.stillToReserve)}</td>
                      <td className="is-numeric">
                        {formatQuantity(line.currentAvailable)}
                        {/*
                            Mil unidades produzidas e "0" na coluna ao lado é a
                            linha que alguém pergunta. A causa vem dos lotes
                            reais, pelo mesmo mecanismo da Posição de Estoque.
                        */}
                        {line.unavailable.length > 0 && (
                          <span className="cell-sub cell-sub--wrap">{explicarRetencao(line)}</span>
                        )}
                      </td>
                      <td>
                        <DecimalField
                          scale={CASAS_QUANTIDADE}
                          aria-label={`Reservar de ${line.productCode}`}
                          disabled={Number(line.stillToReserve) <= 0}
                          value={reserveInputs[line.customerOrderLineId] ?? ""}
                          onChangeValue={(valor) =>
                            setReserveInputs((prev) => ({
                              ...prev,
                              [line.customerOrderLineId]: valor,
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/*
              O botão continua desabilitado quando não há o que reservar — a
              correção não é liberar a ação, é dizer POR QUE ela não avança e
              para onde ir. Quantidade que falta e motivo saem do servidor;
              nada aqui recalcula disponibilidade.
            */}
            {travadas.length > 0 && (
              <div className="callout">
                <p>
                  <strong>
                    {travadas.length === 1
                      ? "1 produto sem disponibilidade suficiente para reservar."
                      : travadas.length + " produtos sem disponibilidade suficiente para reservar."}
                  </strong>{" "}
                  A reserva só alcança o que está livre agora.
                </p>
                <ul>
                  {travadas.map((line) => (
                    <li key={line.customerOrderLineId}>
                      {line.productCode} — {line.productName}: faltam{" "}
                      {formatQuantity(line.missingQuantity)} {line.unitCode} de{" "}
                      {formatQuantity(line.stillToReserve)} {line.unitCode}
                      {" — "}
                      {line.unavailable.length > 0
                        ? explicarRetencao(line)
                        : "nada retido em estoque: a quantidade que falta ainda não foi produzida nem recebida"}
                      .{" "}
                      <Link to={`/estoque/${line.itemId}`}>Ver disponibilidade</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={reserving || semValorDigitado}
                title={
                  reserving || !semValorDigitado
                    ? undefined
                    : nadaDisponivel
                      ? "Nenhuma linha tem produto disponível para reservar agora — o motivo está acima."
                      : "Informe a quantidade a reservar em pelo menos uma linha."
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
            </>
            )}
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
                {formatQuantity(
                  customerOrder.lines.reduce((soma, line) => soma.plus(line.orderedQuantity ?? 0), new Decimal(0)).toFixed(),
                )}
              </dd>
              <dt>Expedido</dt>
              <dd>
                {formatQuantity(
                  customerOrder.lines.reduce((soma, line) => soma.plus(line.shippedQuantity ?? 0), new Decimal(0)).toFixed(),
                )}
              </dd>
              <dt>Faturado</dt>
              <dd>
                {formatQuantity(
                  customerOrder.lines.reduce((soma, line) => soma.plus(line.billedQuantity ?? 0), new Decimal(0)).toFixed(),
                )}
              </dd>
              <dt>A faturar (expedido)</dt>
              <dd>
                {formatQuantity(
                  customerOrder.lines.reduce((soma, line) => soma.plus(line.unbilledShippedQuantity ?? 0), new Decimal(0)).toFixed(),
                )}
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
                      <td className="is-numeric">{formatIntegerPtBr(po.lineCount)}</td>
                      <td>
                        <span className="badge badge--neutral">
                          {PURCHASE_ORDER_STATUS_LABELS[po.status as keyof typeof PURCHASE_ORDER_STATUS_LABELS] ?? po.status}
                        </span>
                      </td>
                      <td className="is-numeric">{formatBRL(po.orderTotal)}</td>
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
                            <td>{formatQuantity(line.reservedRemaining)}</td>
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
                        <TableEmptyRow colSpan={7}>
                          Nenhuma reserva de produto acabado.
                        </TableEmptyRow>
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
                    <div className="form-actions">
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
                {/* Informativo: o Pedido segue; definir como fabricar é da Produção. */}
                {customerOrder.generatedProductionOrders.some((op) => op.routePending) && (
                  <p className="field__hint" role="note">
                    Produção pendente de roteiro.
                  </p>
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
                            {op.routePending && (
                              <span className="cell-sub">
                                <span className="badge badge--warn">Sem roteiro</span>
                              </span>
                            )}
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
          <button type="button" className="btn btn--danger" disabled={saving} onClick={() => { setError(null); setCancelDialogOpen(true); }}>
            Cancelar pedido
          </button>
        )}

        <div className="doc-actions__primary">
          {/* Pendência antes de confirmação, e a pendência é a MESMA da guarda
              de saída — nunca uma conta paralela. */}
          {alteracaoPendente ? (
            <span className="form-status form-status--dirty" role="status">
              Alterações não salvas
            </span>
          ) : (
            feito && (
              <span className="form-status" role="status">
                {feito}
              </span>
            )
          )}
          {/* Sem alteração pendente não há o que gravar: o botão só acorda com
              a pendência da guarda — a mesma que a faixa ao lado mostra. No
              pedido novo também: sem nada digitado não há o que validar. */}
          {isDraft && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving || !alteracaoPendente}
              onClick={handleSaveDraft}
            >
              {acaoEmCurso === "rascunho" ? "Salvando…" : "Salvar rascunho"}
            </button>
          )}
          {!isDraft && status !== "CANCELLED" && !isNew && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving || !alteracaoPendente}
              onClick={handleSaveNotesOnly}
            >
              {acaoEmCurso === "prazo" ? "Salvando…" : "Salvar prazo e observações"}
            </button>
          )}
          {isConfirmable && (
            <button type="button" className="btn btn--accent" disabled={saving} onClick={() => setConfirmDialogOpen(true)}>
              {acaoEmCurso === "salvar-para-confirmar"
                ? "Salvando…"
                : acaoEmCurso === "confirmar"
                  ? "Confirmando…"
                  : "Confirmar pedido"}
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
            {error && (
              <p className="form-alert" role="alert" ref={alertaRef} tabIndex={-1}>
                {error}
              </p>
            )}
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
